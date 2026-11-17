--------------------------- MODULE CloudCartStock ---------------------------
(***************************************************************************)
(* Stock and pickup holds in CloudCart, for one product at one tenant.      *)
(*                                                                          *)
(* Every action is one indivisible step in the code (one DynamoDB request,  *)
(* or one TransactWriteItems), named after the code it models:              *)
(*   backend/functions/inventory/handler.ts  processOrder, reserveStock,    *)
(*                                           markFailed, scheduleHoldExpiry *)
(*   backend/functions/expiry/handler.ts     expireHold, returnStockAndExpire *)
(*   backend/functions/staff/handler.ts      TRANSITIONS.ready / .fulfill   *)
(* SQS delivers each OrderCreated at least once, so every order has Copies  *)
(* deliveries, and a delivery the Lambda gives up on goes back to "queued". *)
(* Bug selects a broken variant of one guard, to show each property fails   *)
(* when the code it relies on is removed. "none" is the real code.          *)
(***************************************************************************)
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    Orders,       \* order IDs
    Copies,       \* SQS deliveries per order (at-least-once): {1, 2} allows a duplicate
    WarehouseSeq, \* warehouse location IDs, sorted by locationId (sourcePreference sorts byId)
    StoreSeq,     \* store location IDs, sorted by locationId
    InitStock,    \* [location -> quantity] as seeded in the stock table
    Qty,          \* [order -> quantity of its one line]
    Fulfil,       \* [order -> "PICKUP" | "SHIP"]
    PickupAt,     \* [order -> store location ID]; ignored for SHIP orders
    Bug           \* "none" | "NoStockCondition" | "NoStatusCondition" | "NoExpiryCondition" | "ScheduleAfterReserve"

Range(s) == {s[i] : i \in 1..Len(s)}
Locations == Range(WarehouseSeq) \cup Range(StoreSeq)
None == "none"
Deliveries == Orders \X Copies
Held == {"RESERVED", "READY_FOR_PICKUP"}
Statuses == {"PENDING", "FAILED", "EXPIRED", "FULFILLED"} \cup Held

VARIABLES
    stock,     \* stock table: quantity per location
    status,    \* orders table: status
    source,    \* orders table: items[0].sourceLocationId (None until reserved)
    collected, \* ghost: the goods physically left the business (FULFILLED was reached)
    pc,        \* per delivery: where the inventory Lambda is in processOrder
    plan,      \* per delivery: the location allocate() chose from its stock read
    schedule,  \* EventBridge Scheduler: is the order's hold-<orderId> schedule waiting to fire?
    expiry     \* per order: the expiry Lambda's progress ("idle" | "read")

vars == <<stock, status, source, collected, pc, plan, schedule, expiry>>

IsPickup(o) == Fulfil[o] = "PICKUP"

\* sourcePreference(): pickup -> own shelf, warehouses, other stores; ship -> warehouses, stores
Preference(o) ==
    IF IsPickup(o)
    THEN <<PickupAt[o]>> \o WarehouseSeq \o SelectSeq(StoreSeq, LAMBDA l : l # PickupAt[o])
    ELSE WarehouseSeq \o StoreSeq

\* allocate(): the first location in preference order that holds the whole line, else None
FirstFit(o) ==
    LET seq == Preference(o)
        fits == {i \in 1..Len(seq) : stock[seq[i]] >= Qty[o]}
    IN IF fits = {} THEN None ELSE seq[CHOOSE i \in fits : \A j \in fits : i <= j]

RECURSIVE SumQty(_)
SumQty(S) == IF S = {} THEN 0 ELSE LET o == CHOOSE x \in S : TRUE IN Qty[o] + SumQty(S \ {o})

Init ==
    /\ stock = InitStock
    /\ status = [o \in Orders |-> "PENDING"]      \* POST /orders wrote it PENDING
    /\ source = [o \in Orders |-> None]
    /\ collected = [o \in Orders |-> FALSE]
    /\ pc = [d \in Deliveries |-> "queued"]
    /\ plan = [d \in Deliveries |-> None]
    /\ schedule = [o \in Orders |-> FALSE]
    /\ expiry = [o \in Orders |-> "idle"]

-----------------------------------------------------------------------------
(* Inventory Lambda (processOrder) *)

\* GetItem on the order: anything but PENDING is ALREADY_PROCESSED
Receive(d) ==
    LET o == d[1] IN
    /\ pc[d] = "queued"
    /\ pc' = [pc EXCEPT ![d] = IF status[o] = "PENDING" THEN "allocating" ELSE "done"]
    /\ UNCHANGED <<stock, status, source, collected, plan, schedule, expiry>>

\* loadStock() + allocate(): read stock (a snapshot that may be stale by the write) and choose
Allocate(d) ==
    LET o == d[1]
        src == FirstFit(o)
    IN
    /\ pc[d] = "allocating"
    /\ IF src = None
       THEN /\ pc' = [pc EXCEPT ![d] = "failing"]
            /\ UNCHANGED plan
       ELSE /\ pc' = [pc EXCEPT ![d] = "planned"]
            /\ plan' = [plan EXCEPT ![d] = src]
    /\ UNCHANGED <<stock, status, source, collected, schedule, expiry>>

\* markFailed(): ConditionExpression "#status = :pending"
MarkFailed(d) ==
    LET o == d[1] IN
    /\ pc[d] = "failing"
    /\ status' = IF status[o] = "PENDING" THEN [status EXCEPT ![o] = "FAILED"] ELSE status
    /\ pc' = [pc EXCEPT ![d] = "done"]
    /\ UNCHANGED <<stock, source, collected, plan, schedule, expiry>>

\* scheduleHoldExpiry() then reserveStock(), as one step. Assumption (checked by anchors.sh):
\* the schedule fires at least MIN_SCHEDULE_LEAD_MS = 60 s after it is created, and the Lambda
\* times out after 10 s, so it cannot fire between the two calls of one invocation.
\* reserveStock() is one TransactWriteItems: stock "quantity >= :qty" AND order "#status = :pending".
Reserve(d) ==
    LET o == d[1]
        src == plan[d]
        stockOk == Bug = "NoStockCondition" \/ stock[src] >= Qty[o]
        statusOk == Bug = "NoStatusCondition" \/ status[o] = "PENDING"
    IN
    /\ pc[d] = "planned"
    /\ schedule' = IF IsPickup(o) /\ Bug # "ScheduleAfterReserve"
                   THEN [schedule EXCEPT ![o] = TRUE]     \* CreateSchedule; ConflictException if it exists
                   ELSE schedule
    /\ IF stockOk /\ statusOk
       THEN /\ stock' = [stock EXCEPT ![src] = @ - Qty[o]]
            /\ status' = [status EXCEPT ![o] = "RESERVED"]
            /\ source' = [source EXCEPT ![o] = src]
            /\ pc' = [pc EXCEPT ![d] = IF IsPickup(o) /\ Bug = "ScheduleAfterReserve"
                                       THEN "scheduling" ELSE "done"]
       ELSE /\ UNCHANGED <<stock, status, source>>
            /\ IF ~statusOk
               THEN pc' = [pc EXCEPT ![d] = "done"]          \* another delivery settled it first
               \* stock moved since the read: re-read and re-allocate, or after 3 attempts throw and let SQS redeliver
               ELSE pc' \in {[pc EXCEPT ![d] = "allocating"], [pc EXCEPT ![d] = "queued"]}
    /\ UNCHANGED <<collected, plan, expiry>>

\* Only in the ScheduleAfterReserve variant: the schedule is created after the reservation, so the
\* Lambda can crash in between. The redelivery then sees RESERVED and never schedules.
ScheduleLate(d) ==
    /\ pc[d] = "scheduling"
    /\ schedule' = [schedule EXCEPT ![d[1]] = TRUE]
    /\ pc' = [pc EXCEPT ![d] = "done"]
    /\ UNCHANGED <<stock, status, source, collected, plan, expiry>>

CrashBeforeSchedule(d) ==
    /\ pc[d] = "scheduling"
    /\ pc' = [pc EXCEPT ![d] = "queued"]
    /\ UNCHANGED <<stock, status, source, collected, plan, schedule, expiry>>

-----------------------------------------------------------------------------
(* Expiry Lambda, run by the order's one-time schedule. The schedule deletes itself after it runs
   (ActionAfterCompletion DELETE), whatever the outcome. Its fire time is never before
   holdExpiresAt, so the NOT_DUE branch is not modelled. *)

\* GetItem on the order: not a held pickup -> ALREADY_SETTLED
ExpiryRead(o) ==
    /\ schedule[o]
    /\ expiry[o] = "idle"
    /\ schedule' = [schedule EXCEPT ![o] = FALSE]
    /\ expiry' = [expiry EXCEPT ![o] = IF IsPickup(o) /\ status[o] \in Held THEN "read" ELSE "idle"]
    /\ UNCHANGED <<stock, status, source, collected, pc, plan>>

\* returnStockAndExpire(): one transaction, "ADD quantity :qty" at the source, and the order
\* "#status IN (:reserved, :ready) AND holdExpiresAt <= :now"
ExpiryWrite(o) ==
    /\ expiry[o] = "read"
    /\ IF Bug = "NoExpiryCondition" \/ status[o] \in Held
       THEN /\ stock' = [stock EXCEPT ![source[o]] = @ + Qty[o]]
            /\ status' = [status EXCEPT ![o] = "EXPIRED"]
       ELSE UNCHANGED <<stock, status>>                     \* staff settled it first
    /\ expiry' = [expiry EXCEPT ![o] = "idle"]
    /\ UNCHANGED <<source, collected, pc, plan, schedule>>

-----------------------------------------------------------------------------
(* Staff Lambda: TRANSITIONS, each one conditional UpdateItem *)

\* ready: "fulfillment.#type = :pickup AND #status = :reserved"
StaffReady(o) ==
    /\ IsPickup(o) /\ status[o] = "RESERVED"
    /\ status' = [status EXCEPT ![o] = "READY_FOR_PICKUP"]
    /\ UNCHANGED <<stock, source, collected, pc, plan, schedule, expiry>>

\* fulfill: "(pickup AND #status = :ready) OR (ship AND #status = :reserved)"
StaffFulfil(o) ==
    /\ \/ IsPickup(o) /\ status[o] = "READY_FOR_PICKUP"
       \/ ~IsPickup(o) /\ status[o] = "RESERVED"
    /\ status' = [status EXCEPT ![o] = "FULFILLED"]
    /\ collected' = [collected EXCEPT ![o] = TRUE]
    /\ UNCHANGED <<stock, source, pc, plan, schedule, expiry>>

-----------------------------------------------------------------------------
Next ==
    \/ \E d \in Deliveries :
        Receive(d) \/ Allocate(d) \/ MarkFailed(d) \/ Reserve(d) \/ ScheduleLate(d) \/ CrashBeforeSchedule(d)
    \/ \E o \in Orders : ExpiryRead(o) \/ ExpiryWrite(o) \/ StaffReady(o) \/ StaffFulfil(o)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Properties *)

TypeOK ==
    /\ stock \in [Locations -> Int]
    /\ status \in [Orders -> Statuses]
    /\ source \in [Orders -> Locations \cup {None}]
    /\ collected \in [Orders -> BOOLEAN]
    /\ pc \in [Deliveries -> {"queued", "allocating", "failing", "planned", "scheduling", "done"}]
    /\ schedule \in [Orders -> BOOLEAN]
    /\ expiry \in [Orders -> {"idle", "read"}]

\* Harm if broken: the business sells a unit it doesn't have
NoOversell == \A l \in Locations : stock[l] >= 0

\* Harm if broken: units appear or vanish. Every unit at a location is on the shelf, held for an
\* order, or gone with a customer; a duplicate delivery can't take it twice, an expiry can't return
\* it twice or after it was collected, and it goes back to the location it came from.
Conservation ==
    \A l \in Locations :
        stock[l] + SumQty({o \in Orders : source[o] = l /\ (status[o] \in Held \/ collected[o])})
            = InitStock[l]

\* Harm if broken: an uncollected pickup holds its stock forever
HeldPickupWillExpire ==
    \A o \in Orders : (IsPickup(o) /\ status[o] \in Held) => (schedule[o] \/ expiry[o] = "read")
=============================================================================
