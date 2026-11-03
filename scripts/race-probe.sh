#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Measurement only (perf/race-memory-probe, never merged): the server container's memory and threads around bursts of
# N simultaneous requests (load/race-probe.js). VmHWM is reset before each burst (clear_refs), so `peak` is the burst's
# own; a 50 ms sampler backs it up and snapshots the thread names when the thread count reaches its maximum.
set -uo pipefail
CONTAINER="${1:-ostrom-e2e-server}"
PID=$(docker inspect -f '{{.State.Pid}}' "$CONTAINER")
field() { sudo awk -v k="$1:" '$1==k {print $2}' "/proc/$PID/status" 2>/dev/null; }
mib() { awk -v kb="${1:-0}" 'BEGIN { printf "%.1f", kb / 1024 }'; }
# Thread names, trailing digits folded: "name×count" sorted by count.
names() { sudo sh -c "cat /proc/$PID/task/*/comm" 2>/dev/null | sed 's/[-_ #]*[0-9]*$//' | sort | uniq -c | sort -rn | awk '{c=$1; $1=""; sub(/^ /,""); printf "%s×%s, ", $0, c}' | sed 's/, $//'; }
# Per pool (name before its trailing number), the highest number seen: "io max 63".
poolmax() { sudo sh -c "cat /proc/$PID/task/*/comm" 2>/dev/null | awk 'match($0, /[-_ #]?[0-9]+$/) { p = substr($0, 1, RSTART - 1); n = substr($0, RSTART); gsub(/[^0-9]/, "", n); if (n + 0 > m[p] + 0) m[p] = n } END { for (p in m) printf "%s max %s, ", p, m[p] }' | sed 's/, $//'; }
NAMES=$(mktemp)
echo "| stage | codes | 503 / Retry-After | med / p95 / max (ms) | before | peak (VmHWM) | peak (50 ms) | +10 s | +60 s | threads before / peak / +60 s |"
echo "|---|---|---|---|---|---|---|---|---|---|"
stage() { # $1 = kind, $2 = N
  local before threads0 out
  sleep 2
  before=$(field VmRSS); threads0=$(field Threads)
  echo 5 | sudo tee "/proc/$PID/clear_refs" >/dev/null 2>&1 || echo "clear_refs refused" >&2
  names > /tmp/probe-names
  ( m=0; t=0; while :; do r=$(field VmRSS); th=$(field Threads); [ "${r:-0}" -gt "$m" ] && m=$r; if [ "${th:-0}" -gt "$t" ]; then t=$th; { names; echo " ["; poolmax; echo "]"; } | tr -d "\n" > /tmp/probe-names; fi; echo "$m $t" > /tmp/probe-max; sleep 0.05; done ) &
  local sampler=$!
  out=$(OSTROM_PROBE_KIND="$1" OSTROM_PROBE_VUS="$2" k6 run -q load/race-probe.js 2>&1 | grep '^PROBE' || true)
  kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null
  local smax tmax; read -r smax tmax < /tmp/probe-max || true
  local hwm; hwm=$(field VmHWM)
  local peaknames; peaknames=$(cat /tmp/probe-names)
  sleep 10; local a10; a10=$(field VmRSS)
  sleep 50; local a60 t60 names60; a60=$(field VmRSS); t60=$(field Threads); names60=$(names)
  local codes med ra s503
  codes=$(sed -n 's/.*codes=\[\([^]]*\)\].*/\1/p' <<< "$out")
  ra=$(sed -n 's/.* retry_after=\([0-9]*\).*/\1/p' <<< "$out")
  s503=$(grep -o '503x[0-9]*' <<< "$codes" | cut -dx -f2)
  med=$(sed -n 's/.* med=\([^ ]*\) p95=\([^ ]*\) max=\([^ ]*\).*/\1 \/ \2 \/ \3/p' <<< "$out")
  echo "| $1 × $2 | ${codes:-$out} | ${s503:-0} / ${ra:-?} | $med | $(mib "$before") | $(mib "$hwm") | $(mib "$smax") | $(mib "$a10") | $(mib "$a60") | $threads0 / $tmax / $t60 |"
  echo "$1 × $2 | peak: $peaknames | +60 s: $names60" >> "$NAMES"
  if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" | grep -q true; then
    echo "server died: $(docker inspect -f '{{.State.ExitCode}} oom={{.State.OOMKilled}}' "$CONTAINER")"
    echo; echo "Thread names:"; cat "$NAMES"; exit 1
  fi
}
# server#266 (JOURNAL 03/11 16:52): the three ceilings filled at once, 100 calls past each, /health polled all along.
saturate() {
  sleep 2
  local before threads0; before=$(field VmRSS); threads0=$(field Threads)
  echo "SATTHREADS before: $(names) [$(poolmax)]"
  echo 5 | sudo tee "/proc/$PID/clear_refs" >/dev/null 2>&1 || echo "clear_refs refused" >&2
  ( m=0; t=0; while :; do r=$(field VmRSS); th=$(field Threads); [ "${r:-0}" -gt "$m" ] && m=$r; if [ "${th:-0}" -gt "$t" ]; then t=$th; { names; echo " ["; poolmax; echo "]"; } | tr -d "\n" > /tmp/probe-names; fi; echo "$m $t" > /tmp/probe-max; sleep 0.05; done ) &
  local sampler=$!
  local out; out=$(k6 run -q load/saturate.js 2>&1 | grep -o 'SAT.*' | sort -u || true)
  kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null
  local smax tmax; read -r smax tmax < /tmp/probe-max || true
  local hwm; hwm=$(field VmHWM)
  sleep 60; local a60 t60; a60=$(field VmRSS); t60=$(field Threads)
  echo "$out"
  echo "SATMEM before=$(mib "$before") peak_hwm=$(mib "$hwm") peak_50ms=$(mib "$smax") after60=$(mib "$a60") threads=$threads0/$tmax/$t60"
  echo "SATTHREADS peak: $(cat /tmp/probe-names) | +60 s: $(names) [$(poolmax)]"
  docker inspect -f 'SATSTATE running={{.State.Running}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' "$CONTAINER"
}
saturate
