"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import * as api from "@/lib/api";
import { Order } from "@/lib/types";
import OrderStatusBadge from "@/components/OrderStatusBadge";

export default function OrdersPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
      return;
    }
    if (user) {
      api.listOrders(user.userId).then(setOrders);
    }
  }, [isLoading, user, router]);

  if (isLoading || !user || orders === null) return null;

  if (orders.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Your orders</h1>
        <p className="mt-4 text-foreground/60">
          You haven&apos;t placed any orders yet.{" "}
          <Link href="/products" className="underline">
            Browse products
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Your orders</h1>

      <div className="mt-6 divide-y divide-foreground/10 rounded-lg border border-foreground/10">
        {orders.map((order) => (
          <Link
            key={order.orderId}
            href={`/orders/${order.orderId}`}
            className="flex items-center justify-between px-4 py-4 hover:bg-foreground/5"
          >
            <div>
              <p className="font-medium">{order.orderId}</p>
              <p className="text-sm text-foreground/50">
                {new Date(order.createdAt).toLocaleString()} · {order.items.length} item
                {order.items.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="font-medium">${order.total.toFixed(2)}</span>
              <OrderStatusBadge status={order.status} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
