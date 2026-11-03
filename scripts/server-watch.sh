#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# What the relay leg of chart-load.yml keeps of the server processes while it loads them, in the background:
#   server-watch.sh start <dir>   follows every server container's log into <dir>/server-<pod>.log, again after each
#                                 restart (the crash's own last lines are kept, which `logs --previous` loses after a
#                                 second restart), and samples each server process's open descriptors every second
#                                 into <dir>/fds.txt: `<epoch s> <pid> <open descriptors> <highest descriptor>`.
#                                 Ktor's native CIO server refuses a socket numbered FD_SETSIZE (1024) or above.
#   server-watch.sh stop <dir>    stops both.
# NS is the release's namespace, CLUSTER the kind cluster (its node container is `$CLUSTER-control-plane`).
set -euo pipefail
dir="${2:?a directory}"
selector=app.kubernetes.io/component=server

case "${1:-}" in
  start)
    mkdir -p "$dir"
    for pod in $(kubectl -n "$NS" get pods -l "$selector" -o jsonpath='{.items[*].metadata.name}'); do
      (
        # Each container once: after its log ends, wait for the next one (restartCount up) before following again, so a
        # crashed container's log is never copied twice. A pod gone ends the loop.
        seen=-1
        while :; do
          count=$(kubectl -n "$NS" get pod "$pod" -o jsonpath='{.status.containerStatuses[?(@.name=="server")].restartCount}' 2>/dev/null) || break
          ready=$(kubectl -n "$NS" get pod "$pod" -o jsonpath='{.status.containerStatuses[?(@.name=="server")].state.running}' 2>/dev/null)
          if [ -n "$count" ] && [ "$count" != "$seen" ] && [ -n "$ready" ]; then
            seen=$count
            echo "== $(date -u +%FT%TZ) following $pod, container after $count restarts" >> "$dir/server-$pod.log"
            kubectl -n "$NS" logs -f "$pod" -c server >> "$dir/server-$pod.log" 2>&1 || true
            echo "== $(date -u +%FT%TZ) the log of $pod ended (container stopped or restarted)" >> "$dir/server-$pod.log"
          fi
          sleep 1
        done
      ) < /dev/null > /dev/null 2>&1 &
      echo $! >> "$dir/watch.pids"
    done
    (
      while :; do
        ts=$(date +%s)
        # In the node: the server processes by name (/proc/<pid>/comm; the migrate init container is gone by now), one grep
        # over the node's processes and a few forks per server.
        docker exec "$CLUSTER-control-plane" sh -c '
          for p in $(grep -lx ostrom-server /proc/[0-9]*/comm 2>/dev/null | cut -d/ -f3); do
            fds=$(ls /proc/$p/fd 2>/dev/null)
            echo "$p $(echo "$fds" | grep -c .) $(echo "$fds" | sort -n | tail -n 1)"
          done' 2>/dev/null | sed "s|^|$ts |" || true
        sleep 1
      done
    ) >> "$dir/fds.txt" < /dev/null 2>/dev/null &
    echo $! >> "$dir/watch.pids"
    ;;
  stop)
    [ -f "$dir/watch.pids" ] || exit 0
    while read -r pid; do
      # The loop first, so it starts nothing more; then what it had running (kubectl logs -f, docker exec, sleep).
      kids=$(pgrep -P "$pid" || true)
      kill "$pid" 2>/dev/null || true
      [ -z "$kids" ] || kill $kids 2>/dev/null || true
    done < "$dir/watch.pids"
    rm -f "$dir/watch.pids"
    ;;
  *)
    echo "usage: server-watch.sh start <dir> | stop <dir>" >&2
    exit 2
    ;;
esac
