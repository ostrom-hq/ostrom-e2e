#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# The server pods of the load pass, and the fake upstreams they call, around a k6 phase (chart-load.yml), so that one
# phase's crash never passes for the next phase's result:
#   server-pods.sh ready             waits until every server pod and the fakes are Ready again (3 min at most)
#   server-pods.sh restarts          prints one `namespace/pod=restarts` word per pod (all its containers summed)
#   server-pods.sh crashed <before>  after CRASH_GRACE seconds (20), fails when a pod of <before> restarted or is gone
#                                    (replaced): prints each pod's restarts and last termination, and the previous
#                                    server container's last lines
# NS is the release's namespace; the fakes are in ostrom-fakes.
set -euo pipefail
selector=app.kubernetes.io/component=server
FAKES=ostrom-fakes

pods() {
  local ns=$1 sel=$2
  kubectl -n "$ns" get pods -l "$sel" \
    -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.containerStatuses[*].restartCount}{"\n"}{end}' 2>/dev/null |
    awk -v ns="$ns" 'NF { n = 0; for (i = 2; i <= NF; i++) n += $i; printf "%s/%s=%d\n", ns, $1, n }'
}

restarts() {
  { pods "$NS" "$selector"; pods "$FAKES" app=fakes; } | sort | tr '\n' ' '
}

case "${1:-}" in
  ready)
    kubectl -n "$NS" wait --for=condition=Ready pod -l "$selector" --timeout=180s
    if kubectl get namespace "$FAKES" >/dev/null 2>&1; then
      kubectl -n "$FAKES" wait --for=condition=Ready pod -l app=fakes --timeout=180s
    fi
    ;;
  restarts)
    restarts
    ;;
  crashed)
    before="${2?the restarts before the phase}"
    # A killed container counts as a restart only once the kubelet has created the next one: checked the second
    # k6 ends, the race's 100 × 502 of run 41628103773 met pods that had just died and still counted 0 restarts.
    sleep "${CRASH_GRACE:-20}"
    after=" $(restarts) "
    gone=""
    for entry in $before; do
      pod=${entry%=*} count=${entry##*=}
      now=$(printf '%s\n' $after | awk -F= -v p="$pod" '$1 == p { print $2 }')
      if [ -z "$now" ]; then gone="$gone $pod (gone)"; elif [ "$now" -gt "$count" ]; then gone="$gone $pod ($count → $now)"; fi
    done
    [ -n "$gone" ] || exit 0
    echo "::error title=pod restarted::pods restarted or replaced during the phase:$gone"
    for ns in "$NS" "$FAKES"; do
      kubectl -n "$ns" get pods \
        -o custom-columns='P:.metadata.name,R:.status.containerStatuses[*].restartCount,L:.status.containerStatuses[*].lastState.terminated.reason,X:.status.containerStatuses[*].lastState.terminated.exitCode,AT:.status.containerStatuses[*].lastState.terminated.finishedAt' || true
    done
    # Only the server container: `--all-containers --previous` gives nothing at all when the migrate init container
    # has no previous instance (run 41539188060 lost its crash that way).
    for p in $(kubectl -n "$NS" get pods -l "$selector" -o name); do
      echo "== $p, previous server container"
      kubectl -n "$NS" logs "$p" -c server --previous --tail=120 || true
    done
    for p in $(kubectl -n "$FAKES" get pods -l app=fakes -o name 2>/dev/null); do
      echo "== $FAKES $p, previous fakes container"
      kubectl -n "$FAKES" logs "$p" -c fakes --previous --tail=60 || true
    done
    exit 1
    ;;
  *)
    echo "usage: server-pods.sh ready | restarts | crashed <before>" >&2
    exit 2
    ;;
esac
