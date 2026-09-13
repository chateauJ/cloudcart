"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import * as api from "@/lib/api";
import { getProductById } from "@/lib/products";
import { Order } from "@/lib/types";
import OrderStatusBadge from "@/components/OrderStatusBadge";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [isLoading, user, router]);

  // Poll while the order is still processing so the status transition
  // (PENDING -> COMPLETE) driven by the mock async flow in lib/api.ts is visible.
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function load() {
      const found = await api.getOrder(user!.userId, id);
      if (cancelled) return;
      setOrder(found);
      if (!found || found.status !== "PENDING") {
        clearInterval(intervalId);
      }
    }

    load();
    const intervalId = setInterval(load, 1000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [user, id]);

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
          Processing your order — inventory is being reserved asynchronously.
        </p>
      )}

      <div className="mt-6 divide-y divide-foreground/10 rounded-lg border border-foreground/10">
        {order.items.map((line) => {
          const product = getProductById(line.productId);
          return (
            <div key={line.productId} className="flex justify-between px-4 py-3 text-sm">
              <span>
                {product?.name ?? line.productId} × {line.quantity}
              </span>
              <span className="font-medium">${(line.unitPrice * line.quantity).toFixed(2)}</span>
            </div>
          );
        })}
        <div className="flex justify-between px-4 py-3 text-base font-semibold">
          <span>Total</span>
          <span>${order.total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
