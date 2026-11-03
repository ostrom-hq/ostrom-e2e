#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# What the relay leg of chart-load.yml keeps of the server processes while it loads them, in the background:
#   server-watch.sh start <dir>   follows every server container's log into <dir>/server-<pod>.log, again after each
#                                 restart (the crash's own last lines are kept, which `logs --previous` loses after a
#                                 second restart), and samples each server process's open descriptors every second
#                                 into <dir>/fds.txt: `<epoch s> <pid> <open descriptors> <highest descriptor>`.
#                                 Ktor's native CIO server refuses a socket numbered FD_SETSIZE (1024) or above.
#                                 Every two seconds it also splits each server process's resident memory (KiB, from
#                                 /proc/<pid>/smaps) into <dir>/mem.txt: `<epoch s> <pid> <threads> <rss> <[heap]> <anon>
#                                 <files> <stacks> <anon 60-66 MiB: rss count> <anon over 66 MiB: rss count>`. [heap] is
#                                 malloc's main arena, ~64 MiB mappings its thread arenas, the larger ones the Kotlin heap.
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
    # The split of /proc/<pid>/smaps, handed to the node's shell as its first argument.
    split='/^[0-9a-f]+-[0-9a-f]+ /{path=$6; next}
      /^Size:/{size=$2}
      /^Rss:/{r=$2; rss+=r
        if (path=="[heap]") h+=r; else if (path ~ /^\[stack/) st+=r; else if (path=="") an+=r; else f+=r
        if (path=="" && size>=60000 && size<=66000) {ar+=r; na++}
        if (path=="" && size>66000) {big+=r; nb++}}
      END{print rss+0, h+0, an+0, f+0, st+0, ar+0, na+0, big+0, nb+0}'
    (
      while :; do
        ts=$(date +%s)
        docker exec "$CLUSTER-control-plane" sh -c '
          for p in $(grep -lx ostrom-server /proc/[0-9]*/comm 2>/dev/null | cut -d/ -f3); do
            echo "$p $(ls /proc/$p/task 2>/dev/null | grep -c .) $(awk "$1" /proc/$p/smaps 2>/dev/null)"
          done' sh "$split" 2>/dev/null | sed "s|^|$ts |" || true
        sleep 2
      done
    ) >> "$dir/mem.txt" < /dev/null 2>/dev/null &
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
