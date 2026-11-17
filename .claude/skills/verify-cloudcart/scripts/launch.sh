#!/bin/sh
# Builds the storefront against the deployed dev stack and serves it at http://localhost:3000,
# the only origin dev's API CORS allows. Prints READY when a page and the dev API both answer.
# Usage: sh .claude/skills/verify-cloudcart/scripts/launch.sh   (from anywhere in the repo)
set -eu

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
STATE="$ROOT/.verify"
PIDFILE="$STATE/preview.pid"
mkdir -p "$STATE"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "A verify preview is already running (pid $(cat "$PIDFILE")). Run cleanup.sh first." >&2
  exit 1
fi
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3000 is taken by a process this skill didn't start (npm run dev or another preview?)." >&2
  echo "Refusing to double-drive it - stop that process, then launch again." >&2
  exit 1
fi

cd "$ROOT/frontend"
[ -d node_modules ] || npm ci --silent
npm run -s env:dev
# Next.js can stop a successful build once to print an upgrade advisory (SecurityFatalError) and
# continues on a rerun. Retry once for that case only, so a real compile error still fails here.
if ! npm run -s build >"$STATE/build.log" 2>&1; then
  grep -q "SecurityFatalError" "$STATE/build.log" || { echo "Build failed - see $STATE/build.log" >&2; exit 1; }
  echo "Next.js paused the build for a security advisory (see $STATE/build.log); retrying once" >&2
  npm run -s build >"$STATE/build.log" 2>&1 || { echo "Build failed - see $STATE/build.log" >&2; exit 1; }
fi

# Started directly (not through npm) so the recorded pid is the server itself
nohup node scripts/serve-static.mjs >"$STATE/preview.log" 2>&1 &
echo $! >"$PIDFILE"

API="$(terraform -chdir="$ROOT/infrastructure/environments/dev" output -raw api_endpoint)"
for _ in $(seq 1 30); do
  page=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/products/ || true)
  api=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Tenant-Id: northlight" "$API/tenant" || true)
  if [ "$page" = "200" ] && [ "$api" = "200" ]; then
    echo "READY http://localhost:3000 (pid $(cat "$PIDFILE"), dev API $API)"
    exit 0
  fi
  sleep 1
done
echo "Not ready after 30s: page $page, API $api. See $STATE/preview.log" >&2
exit 1
