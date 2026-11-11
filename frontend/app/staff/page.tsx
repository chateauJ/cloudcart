"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCatalog } from "@/lib/CatalogContext";
import { useStore } from "@/lib/StoreContext";
import * as api from "@/lib/api";
import { Order } from "@/lib/types";
import OrderStatusBadge from "@/components/OrderStatusBadge";

const SHIP_QUEUE = "SHIP";

// The counter and back room: a store's pickup queue, or the business's shipping queue, oldest
// first, with the one next step each order is waiting for
export default function StaffPage() {
  const { user, isLoading } = useAuth();
  const { productById } = useCatalog();
  const { locations, locationById, myStore } = useStore();
  const router = useRouter();
  const [queueChoice, setQueueChoice] = useState<string | null>(null);
  // Bumped after every action, to reload the queue
  const [version, setVersion] = useState(0);
  // Each result remembers the queue and version it was for, so switching queues never shows stale rows
  const [result, setResult] = useState<{ queue: string; version: number; orders?: Order[]; error?: string }>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const stores = locations.filter((l) => l.pickupEnabled);
  const queue = queueChoice ?? myStore?.locationId ?? stores[0]?.locationId ?? SHIP_QUEUE;

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user?.isStaff) return;
    let cancelled = false;
    api
      .listStaffQueue(queue)
      .then((orders) => !cancelled && setResult({ queue, version, orders }))
      .catch((err) => !cancelled && setResult({ queue, version, error: api.errorMessage(err, "Could not load the queue") }));
    return () => {
      cancelled = true;
    };
  }, [user, queue, version]);

  if (isLoading || !user) return null;
  if (!user.isStaff) {
    return <p className="text-foreground/60">This page is for this store&apos;s staff.</p>;
  }

  const current = result?.queue === queue ? result : undefined;

  async function act(orderId: string, step: (id: string) => Promise<Order>) {
    setActionError(null);
    setBusyId(orderId);
    try {
      await step(orderId);
    } catch (err) {
      setActionError(api.errorMessage(err, "Could not update the order"));
    } finally {
      setBusyId(null);
      setVersion((v) => v + 1);
    }
  }

  function nextStep(order: Order) {
    if (order.fulfillment.type === "SHIP") {
      return order.status === "RESERVED" ? { label: "Mark shipped", run: api.markFulfilled } : null;
    }
    if (order.status === "RESERVED") return { label: "Mark ready", run: api.markReady };
    if (order.status === "READY_FOR_PICKUP") return { label: "Mark picked up", run: api.markFulfilled };
    return null;
  }

  const locationName = (id?: string) => (id ? (locationById(id)?.name ?? id) : "");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Staff</h1>
        <div className="flex items-center gap-2">
          <select
            value={queue}
            onChange={(e) => setQueueChoice(e.target.value)}
            className="rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm"
          >
            {stores.map((store) => (
              <option key={store.locationId} value={store.locationId}>
                Pickups at {store.name}
              </option>
            ))}
            <option value={SHIP_QUEUE}>Shipping</option>
          </select>
          <button
            onClick={() => setVersion((v) => v + 1)}
            className="rounded-md border border-foreground/15 px-3 py-1.5 text-sm hover:bg-foreground/5"
          >
            Refresh
          </button>
        </div>
      </div>

      {actionError && <p className="mt-4 text-sm text-red-600">{actionError}</p>}
      {current?.error && <p className="mt-4 text-sm text-red-600">{current.error}</p>}
      {current?.orders?.length === 0 && <p className="mt-6 text-foreground/60">Nothing waiting in this queue.</p>}

      <div className="mt-6 space-y-3">
        {current?.orders?.map((order) => {
          const step = nextStep(order);
          return (
            <div key={order.orderId} className="rounded-lg border border-foreground/10 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{order.orderId}</span>
                <OrderStatusBadge status={order.status} />
              </div>
              <p className="mt-1 text-xs text-foreground/50">
                Placed {new Date(order.createdAt).toLocaleString()}
                {order.channel === "IN_STORE" && ` · in store at ${locationName(order.placedAtLocationId)}`}
                {order.holdExpiresAt && ` · held until ${new Date(order.holdExpiresAt).toLocaleString()}`}
              </p>

              <ul className="mt-3 space-y-1">
                {order.items.map((line) => (
                  <li key={line.productId} className="flex justify-between gap-4">
                    <span>
                      {productById(line.productId)?.name ?? line.productId} × {line.quantity}
                    </span>
                    <span className={line.needsTransfer ? "text-amber-700" : "text-foreground/50"}>
                      {line.needsTransfer
                        ? `Transfer from ${locationName(line.sourceLocationId)}`
                        : order.fulfillment.type === "PICKUP"
                          ? "On the shelf here"
                          : `From ${locationName(line.sourceLocationId)}`}
                    </span>
                  </li>
                ))}
              </ul>

              {step && (
                <button
                  onClick={() => act(order.orderId, step.run)}
                  disabled={busyId === order.orderId}
                  className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
                >
                  {busyId === order.orderId ? "Saving..." : step.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
