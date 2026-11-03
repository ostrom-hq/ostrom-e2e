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
        while :; do
          kubectl -n "$NS" logs -f "$pod" -c server >> "$dir/server-$pod.log" 2>&1 || true
          echo "== $(date -u +%FT%TZ) the log of $pod ended (container stopped or restarted)" >> "$dir/server-$pod.log"
          sleep 1
        done
      ) < /dev/null > /dev/null 2>&1 &
      echo $! >> "$dir/watch.pids"
    done
    (
      while :; do
        ts=$(date +%s)
        # The node's /proc: one line per process whose command line names the server binary (not the migrate init
        # container, gone by now; not an exec of seed-test-account, which ends at once).
        docker exec "$CLUSTER-control-plane" sh -c '
          for d in /proc/[0-9]*; do
            c=$(tr "\0" " " < "$d/cmdline" 2>/dev/null) || continue
            case "$c" in */ostrom-server\ *|*/ostrom-server) ;; *) continue ;; esac
            case "$c" in *seed-test-account*|*migrate*) continue ;; esac
            n=$(ls "$d/fd" 2>/dev/null | wc -l)
            m=$(ls "$d/fd" 2>/dev/null | sort -n | tail -n 1)
            echo "${d#/proc/} $n ${m:-0}"
          done' 2>/dev/null | sed "s|^|$ts |" || true
        sleep 1
      done
    ) >> "$dir/fds.txt" < /dev/null 2>/dev/null &
    echo $! >> "$dir/watch.pids"
    ;;
  stop)
    [ -f "$dir/watch.pids" ] || exit 0
    while read -r pid; do
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    done < "$dir/watch.pids"
    rm -f "$dir/watch.pids"
    ;;
  *)
    echo "usage: server-watch.sh start <dir> | stop <dir>" >&2
    exit 2
    ;;
esac
