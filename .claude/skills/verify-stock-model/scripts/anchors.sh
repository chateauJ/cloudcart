#!/bin/sh
# Checks that every guard and ordering the model relies on is still in the code, verbatim.
# A miss means the code changed under the model: re-read that code and update the model before
# trusting a TLC pass. Usage: sh .claude/skills/verify-stock-model/scripts/anchors.sh
set -u
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
INV="$ROOT/backend/functions/inventory/handler.ts"
EXP="$ROOT/backend/functions/expiry/handler.ts"
STF="$ROOT/backend/functions/staff/handler.ts"
fails=0
has() { # file, text, what the model assumes
  if grep -qF -- "$2" "$1"; then echo "ok    $3"; else echo "MISS  $3 - not found in ${1#$ROOT/}: $2"; fails=$((fails + 1)); fi
}

has "$INV" 'ConditionExpression: "quantity >= :qty"' "Reserve: stock condition (Bug NoStockCondition)"
has "$INV" 'UpdateExpression: `SET #status = :reserved, #items = :items, updatedAt = :now${' "Reserve: order update in the same transaction"
has "$INV" 'ConditionExpression: "#status = :pending",' "Reserve/MarkFailed: status condition (Bug NoStatusCondition)"
has "$INV" 'if (order.status !== "PENDING") {' "Receive: non-PENDING is ALREADY_PROCESSED"
has "$INV" 'if (order.fulfillment.type === "SHIP") return [...ids(warehouses), ...ids(stores)];' "Preference: ship order"
has "$INV" 'return [pickupAt, ...ids(warehouses), ...ids(stores).filter((id) => id !== pickupAt)];' "Preference: pickup order"
has "$INV" '.sort(byId)' "Preference: locations sorted by locationId"
has "$INV" 'const source = preference.find((locationId) => (atLocation?.get(locationId) ?? 0) >= item.quantity);' "FirstFit: one location holds the whole line"
has "$INV" 'const MAX_ALLOCATION_ATTEMPTS = 3;' "Reserve: re-allocate then hand back to SQS"
has "$INV" 'const MIN_SCHEDULE_LEAD_MS = 60_000;' "Timing assumption: schedule fires >= 60 s after creation"
has "$INV" 'ActionAfterCompletion: "DELETE",' "Expiry: schedule deletes itself after it runs"
has "$INV" 'Name: `hold-${order.orderId}`,' "Reserve: one schedule name per order (ConflictException on repeat)"
has "$EXP" 'ConditionExpression: "#status IN (:reserved, :ready) AND holdExpiresAt <= :now",' "ExpiryWrite: status condition (Bug NoExpiryCondition)"
has "$EXP" 'UpdateExpression: "ADD quantity :qty",' "ExpiryWrite: stock returned in the same transaction"
has "$EXP" 'const HELD_STATUSES = ["RESERVED", "READY_FOR_PICKUP"];' "ExpiryRead: only held pickups expire"
has "$STF" 'condition: "fulfillment.#type = :pickup AND #status = :reserved",' "StaffReady condition"
has "$STF" 'condition: "(fulfillment.#type = :pickup AND #status = :ready) OR (fulfillment.#type = :ship AND #status = :reserved)",' "StaffFulfil condition"

# The schedule must be created before the reservation, in the same loop iteration (Bug ScheduleAfterReserve)
sched=$(grep -nF 'if (holdExpiresAt) await scheduleHoldExpiry(order, holdExpiresAt);' "$INV" | cut -d: -f1)
reserve=$(grep -nF 'await reserveStock(order, allocated, holdExpiresAt);' "$INV" | cut -d: -f1)
if [ -n "$sched" ] && [ -n "$reserve" ] && [ "$sched" -lt "$reserve" ]; then
  echo "ok    Reserve: scheduleHoldExpiry runs before reserveStock (lines $sched < $reserve)"
else
  echo "MISS  Reserve: scheduleHoldExpiry no longer runs before reserveStock in processOrder"; fails=$((fails + 1))
fi

# Timing assumption: the inventory Lambda's timeout (module default 10 s) stays below the 60 s lead
if grep -A12 'module "inventory_lambda"' "$ROOT/infrastructure/modules/app/main.tf" | grep -q 'timeout'; then
  echo "MISS  Timing assumption: inventory_lambda now sets its own timeout - check it is still < 60 s"; fails=$((fails + 1))
elif grep -A3 'variable "timeout"' "$ROOT/infrastructure/modules/lambda/variables.tf" | grep -q 'default     = 10'; then
  echo "ok    Timing assumption: inventory Lambda timeout 10 s < 60 s schedule lead"
else
  echo "MISS  Timing assumption: the lambda module's default timeout changed"; fails=$((fails + 1))
fi

[ "$fails" -eq 0 ] && echo "anchors: model matches the code" || { echo "anchors: $fails miss(es) - update the model before trusting TLC"; exit 1; }
