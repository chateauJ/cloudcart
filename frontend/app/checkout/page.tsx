"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";
import { useCatalog } from "@/lib/CatalogContext";
import * as api from "@/lib/api";

export default function CheckoutPage() {
  const { user, isLoading } = useAuth();
  const { cart, refresh } = useCart();
  const { productById, isLoading: catalogLoading } = useCatalog();
  const router = useRouter();
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router]);

  if (isLoading || !user || !cart || catalogLoading) return null;

  const lines = cart.items.map((item) => ({ item, product: productById(item.productId) }));
  // An estimate for display only - the Orders API prices the order itself from the catalog
  const total = lines.reduce((sum, l) => sum + (l.product?.price ?? 0) * l.item.quantity, 0);

  async function handlePlaceOrder() {
    setError(null);
    setIsPlacingOrder(true);
    try {
      const order = await api.createOrder();
      await refresh(); // the API cleared the cart in the same transaction that created the order
      router.push(`/order?id=${encodeURIComponent(order.orderId)}`);
    } catch (err) {
      setError(api.errorMessage(err, "Could not place order"));
      setIsPlacingOrder(false);
      await refresh();
    }
  }

  if (lines.length === 0) {
    return <p className="text-foreground/60">Your cart is empty - nothing to check out.</p>;
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold">Checkout</h1>

      <div className="mt-6 divide-y divide-foreground/10 rounded-lg border border-foreground/10">
        {lines.map(({ item, product }) => (
          <div key={item.productId} className="flex justify-between px-4 py-3 text-sm">
            <span>
              {product?.name ?? item.productId} × {item.quantity}
            </span>
            <span className="font-medium">${((product?.price ?? 0) * item.quantity).toFixed(2)}</span>
          </div>
        ))}
        <div className="flex justify-between px-4 py-3 text-base font-semibold">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        onClick={handlePlaceOrder}
        disabled={isPlacingOrder}
        className="mt-6 w-full rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
      >
        {isPlacingOrder ? "Placing order..." : "Place order"}
      </button>
      <p className="mt-3 text-center text-xs text-foreground/50">
        Order processing is asynchronous - status starts as PENDING and updates once inventory is
        reserved by the Inventory Lambda.
      </p>
    </div>
  );
}
