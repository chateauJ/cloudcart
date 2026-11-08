"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCatalog } from "@/lib/CatalogContext";
import * as api from "@/lib/api";
import { Order } from "@/lib/types";
import OrderStatusBadge from "@/components/OrderStatusBadge";

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000; // stop polling a stuck order rather than hitting the API forever

// /order?id=<orderId>: order IDs are created at runtime, so a static export can't pre-build a
// page per order - the ID is a query parameter instead (useSearchParams needs the Suspense boundary)
export default function OrderPage() {
  return (
    <Suspense>
      <OrderDetail />
    </Suspense>
  );
}

function OrderDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { user, isLoading } = useAuth();
  const { productById } = useCatalog();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router]);

  // The order is created PENDING; the Streams -> Pipe -> SQS -> Inventory Lambda path moves it to
  // COMPLETE or FAILED a few seconds later, so poll until it settles
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    async function load() {
      try {
        const found = await api.getOrder(id);
        if (cancelled) return;
        setOrder(found);
        if (found?.status === "PENDING" && Date.now() - startedAt < POLL_TIMEOUT_MS) {
          timer = setTimeout(load, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!cancelled) setError(api.errorMessage(err, "Could not load this order"));
      }
    }

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, id]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (isLoading || !user || order === undefined) return null;

  if (order === null) {
    return (
      <div>
        <p className="text-foreground/60">Order not found.</p>
        <Link href="/orders" className="mt-2 inline-block text-sm underline">
          Back to orders
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link href="/orders" className="text-sm text-foreground/60 hover:underline">
        ← Back to orders
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{order.orderId}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="mt-1 text-sm text-foreground/50">
        Placed {new Date(order.createdAt).toLocaleString()}
      </p>

      {order.status === "PENDING" && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Processing your order - inventory is being reserved asynchronously.
        </p>
      )}
      {order.status === "FAILED" && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {order.failureReason ?? "This order could not be completed."}
        </p>
      )}

      <div className="mt-6 divide-y divide-foreground/10 rounded-lg border border-foreground/10">
        {order.items.map((line) => (
          <div key={line.productId} className="flex justify-between px-4 py-3 text-sm">
            <span>
              {productById(line.productId)?.name ?? line.productId} × {line.quantity}
            </span>
            {/* unitPrice is the price snapshotted when the order was placed */}
            <span className="font-medium">${(line.unitPrice * line.quantity).toFixed(2)}</span>
          </div>
        ))}
        <div className="flex justify-between px-4 py-3 text-base font-semibold">
          <span>Total</span>
          <span>${order.total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
