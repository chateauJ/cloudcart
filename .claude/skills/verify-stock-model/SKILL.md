---
name: verify-stock-model
description: Model-check CloudCart's stock allocation, pickup holds and staff transitions with TLA+/TLC, proving no oversell and that every unit is accounted for across every interleaving of duplicate SQS deliveries, competing orders, hold expiry and staff actions. Use whenever a change touches backend/functions/inventory, expiry or staff handlers, the stock/order condition expressions, the schedule lead time, or Lambda timeouts.
---

# verify-stock-model

Tests check the orderings someone wrote down. This check covers **every** ordering of the steps below, within a small scope, using the TLC model checker on a TLA+ model of the design.

## What it proves

| Property | In plain words | Harm if broken |
|---|---|---|
| `NoOversell` | No location's stock ever goes below zero. | The business sells a unit it doesn't have. |
| `Conservation` | At every location, shelf stock + units held for orders + units collected by customers = the seeded stock. | Units appear or vanish: a duplicate delivery takes stock twice, an expiry returns it twice or after the customer collected it, or it returns to the wrong place. |
| `HeldPickupWillExpire` | A pickup that is RESERVED or READY_FOR_PICKUP always has its expiry schedule pending or running. | An uncollected pickup holds its stock forever. |
| `TypeOK` | Every variable stays in its expected range. | (model sanity) |

**Scope** (`model/MC.tla`):
- three orders competing for three units at the seeded locations (`warehouse_main` 1, `store_downtown` 0, `store_harbor` 2);
- o1 is a pickup at Downtown that needs a transfer, o2 is a shipment, and o3 is a 2-unit pickup at Harbor;
- every order is delivered **twice** by SQS;
- the inventory Lambda may re-allocate or hand back to SQS any number of times;
- the expiry schedule and both staff steps can happen at any point.

A pass covers this scope, not every catalog size.

**Assumptions** (all checked by `anchors.sh`):
- each modelled action is one DynamoDB request or transaction in the code, so DynamoDB conditions and `TransactWriteItems` are atomic;
- the hold schedule fires at least 60 s after it is created (`MIN_SCHEDULE_LEAD_MS`), and the inventory Lambda times out after 10 s, so the schedule can't fire between `scheduleHoldExpiry` and `reserveStock` in one invocation.

**Not covered:**
- orders with more than one line (each line is allocated independently, in the same transaction);
- other tenants (keys isolate them);
- cart and checkout writes;
- the CloudFront cache;
- Scheduler retry storms;
- stock edited by hand in the console.

## Coverage record

Last confirmed to describe the code at commit **`6ea3af0`**. Move this forward only after you've re-read the covered code at the new commit and confirmed the model still matches it, not merely because `check.sh` passes.

| Model action (`model/CloudCartStock.tla`) | Code |
|---|---|
| `Receive` | `backend/functions/inventory/handler.ts`, `processOrder`: the order GetItem and the `status !== "PENDING"` early return |
| `Allocate` | same file: `loadStock`, `sourcePreference`, `allocate` |
| `Reserve` | same file: `scheduleHoldExpiry` then `reserveStock` (one `TransactWriteCommand`), and the `MAX_ALLOCATION_ATTEMPTS` loop |
| `MarkFailed` | same file: `markFailed` |
| `ExpiryRead`, `ExpiryWrite` | `backend/functions/expiry/handler.ts`: `expireHold`, `returnStockAndExpire` |
| `StaffReady`, `StaffFulfil` | `backend/functions/staff/handler.ts`: `TRANSITIONS.ready` and `TRANSITIONS.fulfill` |
| Timing assumption | `MIN_SCHEDULE_LEAD_MS` in the inventory handler; `timeout` default in `infrastructure/modules/lambda/variables.tf`, not overridden for `inventory_lambda` in `infrastructure/modules/app/main.tf` |

**Does my change touch this?** Yes if `git diff 6ea3af0 -- backend/functions/inventory backend/functions/expiry backend/functions/staff infrastructure/modules/lambda infrastructure/modules/app/main.tf` shows changes to the functions above, their condition or update expressions, the schedule settings, or a Lambda timeout.

## Run

```sh
sh .claude/skills/verify-stock-model/scripts/check.sh
sh .claude/skills/verify-stock-model/scripts/check.sh --mutants
```

`check.sh` runs in two stages:
1. **`anchors.sh`:** confirms every guard and ordering the model relies on is still in the code, word for word.
2. **TLC:** checks the real model, which must print `PASS  real model`.

`--mutants` also runs each broken variant (the `Bug` constant). Each must be caught:

| Mutant | Removes | Caught by |
|---|---|---|
| `NoStockCondition` | `quantity >= :qty` | `NoOversell` |
| `NoStatusCondition` | `#status = :pending` | `NoOversell` or `Conservation` |
| `NoExpiryCondition` | `#status IN (:reserved, :ready)` | `Conservation` |
| `ScheduleAfterReserve` | creating the schedule *before* reserving | `HeldPickupWillExpire` |

Run the mutants after you change the model, to prove it can still fail. TLC output goes to `.verify/tlc/<timestamp>/` (gitignored).

## Reading a failure

- **`anchors.sh` reports MISS:** the code changed under the model. Open the code it names. If the change is intended, update the model action from the coverage record to match the new code, then the anchor text, then re-run with `--mutants`. Never delete an anchor just to make it pass.
- **TLC reports `Invariant X is violated`:** read the counterexample in `.verify/tlc/<run>/real.out` with the pstack **statechart** skill (`/pstack:statechart`). It shows the shortest path to the violation in plain words. Then decide which case it is:
  - **Real bug:** every step in the trace is something the code can do. Report it in the code's terms, for example "two SQS deliveries of o1 both read PENDING, both reserve, warehouse_main goes to -1". Don't weaken the property or the model, and don't change product code unless the user asks.
  - **Modelling error:** a step the code can't take, such as an action the code doesn't have, or two requests merged that the code issues separately. Fix the model to match the code, cite the code line, and re-run with `--mutants`.

When TLC passes, `/pstack:statechart` can also draw how orders move between states.

## Toolchain

| Tool | Install | Notes |
|---|---|---|
| Java 11+ | `brew install openjdk@21` | `check.sh` finds Homebrew's openjdk@21, or set `JAVA=/path/to/java`. The system Java 8 is too old. |
| TLC (`tla2tools.jar`) | `mkdir -p ~/.local/share/tla && curl -fL -o ~/.local/share/tla/tla2tools.jar https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar` | Or set `TLA_JAR`. The version and checksum last proven are recorded below. |

Last proven on 2026-11-17 at commit `6ea3af0`, with OpenJDK 21.0.13 and TLC 2.19 (08 August 2024). `tla2tools.jar` sha256 was `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`; if `latest` has moved on, compare with `shasum -a 256 ~/.local/share/tla/tla2tools.jar`.

On that run:
- **Real model:** passed, with 26,040,380 states generated, 4,879,931 distinct and none left on the queue, in about 30 s for the full `--mutants` run on an Apple-silicon Mac.
- **Mutants:** all four were caught.
- **Scratch break in the real code:** deleting `quantity >= :qty` from `reserveStock` was caught first by `anchors.sh`. Once the model mirrored it, TLC found the oversell: o1 and o2 both read `warehouse_main = 1`, both reserve it, and it ends at -1.
