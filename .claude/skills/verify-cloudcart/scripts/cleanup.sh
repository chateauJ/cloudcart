#!/bin/sh
# Stops the preview launch.sh started (by its recorded pid, never by name). Evidence in
# .verify/evidence/ is kept. Usage: sh .claude/skills/verify-cloudcart/scripts/cleanup.sh
set -u

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
PIDFILE="$ROOT/.verify/preview.pid"

if [ -f "$PIDFILE" ]; then
  pid="$(cat "$PIDFILE")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in 1 2 3 4 5; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    echo "stopped preview pid $pid"
  fi
  rm -f "$PIDFILE"
fi
lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 && echo "note: something else still listens on 3000 (not ours, left alone)"
echo "evidence kept in $ROOT/.verify/evidence/"
