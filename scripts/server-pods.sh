#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# The server pods of the load pass, around a k6 phase (chart-load.yml), so that one phase's crash never passes for the
# next phase's result:
#   server-pods.sh ready             waits until every server pod is Ready again (3 min at most)
#   server-pods.sh restarts          prints the restarts of the server containers, summed
#   server-pods.sh crashed <before>  if the restarts grew past <before>: prints each pod's restarts and last
#                                    termination, the previous server container's last lines (its crash), and fails
# NS is the release's namespace.
set -euo pipefail
selector=app.kubernetes.io/component=server

restarts() {
  kubectl -n "$NS" get pods -l "$selector" \
    -o jsonpath='{range .items[*]}{.status.containerStatuses[*].restartCount}{"\n"}{end}' | awk '{ n += $1 } END { print n + 0 }'
}

case "${1:-}" in
  ready)
    kubectl -n "$NS" wait --for=condition=Ready pod -l "$selector" --timeout=180s
    ;;
  restarts)
    restarts
    ;;
  crashed)
    before="${2:?the restarts before the phase}"
    after=$(restarts)
    [ "$after" -gt "$before" ] || exit 0
    echo "::error title=server restarted::server pods restarted during the phase ($before → $after restarts)"
    kubectl -n "$NS" get pods -l "$selector" \
      -o custom-columns='P:.metadata.name,R:.status.containerStatuses[*].restartCount,L:.status.containerStatuses[*].lastState.terminated.reason,X:.status.containerStatuses[*].lastState.terminated.exitCode,AT:.status.containerStatuses[*].lastState.terminated.finishedAt'
    # Only the server container: `--all-containers --previous` gives nothing at all when the migrate init container
    # has no previous instance (run 41539188060 lost its crash that way).
    for p in $(kubectl -n "$NS" get pods -l "$selector" -o name); do
      echo "== $p, previous server container"
      kubectl -n "$NS" logs "$p" -c server --previous --tail=120 || true
    done
    exit 1
    ;;
  *)
    echo "usage: server-pods.sh ready | restarts | crashed <before>" >&2
    exit 2
    ;;
esac
