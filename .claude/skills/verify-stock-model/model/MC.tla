---------------------------------- MODULE MC ----------------------------------
(* The scope TLC checks: 3 orders racing for 3 units across the seeded location layout,
   each order delivered twice by SQS. Location IDs are the real seeded ones. *)
EXTENDS CloudCartStock

MCOrders == {"o1", "o2", "o3"}
MCCopies == {1, 2}
MCWarehouseSeq == <<"warehouse_main">>
MCStoreSeq == <<"store_downtown", "store_harbor">>      \* sorted by locationId, as sourcePreference does
\* Downtown has none, so o1's pickup must be transferred in; o2 and o3 compete for the rest
MCInitStock == [l \in {"warehouse_main", "store_downtown", "store_harbor"} |->
                    IF l = "warehouse_main" THEN 1 ELSE IF l = "store_harbor" THEN 2 ELSE 0]
MCQty == [o \in MCOrders |-> IF o = "o3" THEN 2 ELSE 1]
MCFulfil == [o \in MCOrders |-> IF o = "o2" THEN "SHIP" ELSE "PICKUP"]
MCPickupAt == [o \in MCOrders |-> IF o = "o3" THEN "store_harbor" ELSE "store_downtown"]
===============================================================================
