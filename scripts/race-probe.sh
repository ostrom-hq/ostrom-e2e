#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Measurement only (perf/race-memory-probe, never merged): the server container's memory around bursts of N
# simultaneous requests (load/race-probe.js). The kernel's peak (VmHWM) is reset before each burst through
# /proc/<pid>/clear_refs, so `peak` is the burst's own peak; a 50 ms sampler backs it up when the reset is refused.
set -uo pipefail
CONTAINER="${1:-ostrom-e2e-server}"
PID=$(docker inspect -f '{{.State.Pid}}' "$CONTAINER")
field() { sudo awk -v k="$1:" '$1==k {print $2}' "/proc/$PID/status" 2>/dev/null; }
mib() { awk -v kb="${1:-0}" 'BEGIN { printf "%.1f", kb / 1024 }'; }
echo "| stage | codes | med / max | before | peak (VmHWM) | peak (50 ms) | +0 s | +10 s | +30 s | threads before / peak |"
echo "|---|---|---|---|---|---|---|---|---|---|"
stage() { # $1 = kind, $2 = N
  local before threads0 tmax=0 smax=0 out
  sleep 2
  before=$(field VmRSS); threads0=$(field Threads)
  echo 5 | sudo tee "/proc/$PID/clear_refs" >/dev/null 2>&1 || echo "clear_refs refused" >&2
  ( m=0; t=0; while :; do r=$(field VmRSS); th=$(field Threads); [ "${r:-0}" -gt "$m" ] && m=$r; [ "${th:-0}" -gt "$t" ] && t=$th; echo "$m $t" > /tmp/probe-max; sleep 0.05; done ) &
  local sampler=$!
  out=$(OSTROM_PROBE_KIND="$1" OSTROM_PROBE_VUS="$2" k6 run -q load/race-probe.js 2>&1 | grep '^PROBE' || true)
  local a0; a0=$(field VmRSS)
  kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null
  read -r smax tmax < /tmp/probe-max || true
  local hwm; hwm=$(field VmHWM)
  sleep 10; local a10; a10=$(field VmRSS)
  sleep 20; local a30; a30=$(field VmRSS)
  local codes med
  codes=$(sed -n 's/.*codes=\[\([^]]*\)\].*/\1/p' <<< "$out")
  med=$(sed -n 's/.* med=\([^ ]*\) max=\([^ ]*\).*/\1 \/ \2/p' <<< "$out")
  echo "| $1 × $2 | ${codes:-$out} | $med | $(mib "$before") | $(mib "$hwm") | $(mib "$smax") | $(mib "$a0") | $(mib "$a10") | $(mib "$a30") | $threads0 / $tmax |"
  docker inspect -f '{{.State.Running}}' "$CONTAINER" | grep -q true || { echo "server died: $(docker inspect -f '{{.State.ExitCode}} oom={{.State.OOMKilled}}' "$CONTAINER")"; exit 1; }
}
stage unauth 100
stage read 100
stage ask 100
stage decided 100
stage race 25
stage race 50
stage race 100
stage race 200
stage race 100
stage race 100
stage decided 200
