#!/bin/sh
# Read-only: is this instance worth driving? Exits non-zero on the first failed check.
# Usage: sh .claude/skills/verify-cloudcart/scripts/doctor.sh
set -u

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
PIDFILE="$ROOT/.verify/preview.pid"
DEV="$ROOT/infrastructure/environments/dev"
ok() { echo "ok    $1"; }
fail() { echo "FAIL  $1"; exit 1; }

aws sts get-caller-identity --region us-east-1 >/dev/null 2>&1 && ok "AWS credentials valid" || fail "AWS credentials missing or expired"
API="$(terraform -chdir="$DEV" output -raw api_endpoint 2>/dev/null)" && ok "dev Terraform outputs readable" || fail "can't read dev outputs (terraform init in $DEV?)"

[ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && ok "verify preview running (pid $(cat "$PIDFILE"))" || fail "no verify preview - run launch.sh"
owner="$(lsof -nP -t -iTCP:3000 -sTCP:LISTEN 2>/dev/null | head -1)"
[ "$owner" = "$(cat "$PIDFILE")" ] && ok "port 3000 owned by our preview" || fail "port 3000 owned by pid ${owner:-none}, not our preview"

built="$(grep -o 'NEXT_PUBLIC_API_URL=.*' "$ROOT/frontend/.env.local" | cut -d= -f2-)"
[ "$built" = "$API" ] && ok "build points at the current dev API" || fail "build targets $built, dev API is $API - relaunch"
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/products/)" = "200" ] && ok "storefront serves /products/" || fail "storefront not serving"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Tenant-Id: northlight' "$API/tenant")" = "200" ] && ok "dev API answers GET /tenant" || fail "dev API not answering"

[ -f "$ROOT/frontend/.env.demo" ] && ok "frontend/.env.demo present" || fail "frontend/.env.demo missing (CLOUDCART_DEMO_EMAIL / CLOUDCART_DEMO_PASSWORD)"
POOL="$(terraform -chdir="$DEV" output -raw cognito_user_pool_id)"
DEMO="$(grep '^CLOUDCART_DEMO_EMAIL=' "$ROOT/frontend/.env.demo" | cut -d= -f2-)"
groups="$(aws cognito-idp admin-list-groups-for-user --user-pool-id "$POOL" --username "$DEMO" --query 'Groups[].GroupName' --output text --region us-east-1 2>/dev/null)"
case "$groups" in *staff-northlight*) ok "demo user is staff-northlight";; *) fail "demo user not in staff-northlight (staff journeys will fail)";; esac
echo "doctor: all checks passed"
