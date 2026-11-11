"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";
import { useCatalog } from "@/lib/CatalogContext";
import { useStore } from "@/lib/StoreContext";
import { stockAt } from "@/lib/stock";
import { Fulfillment } from "@/lib/types";
import * as api from "@/lib/api";

export default function CheckoutPage() {
  const { user, isLoading } = useAuth();
  const { cart, refresh } = useCart();
  const { productById, isLoading: catalogLoading } = useCatalog();
  const { locations, locationById, myStore } = useStore();
  const router = useRouter();
  // null until the shopper picks; until then, pickup at their store if they have one, else shipping
  const [choice, setChoice] = useState<Fulfillment | null>(null);
  // Staff only: the store whose counter is ringing this sale up (null = the staff member's own online order)
  const [inStoreAt, setInStoreAt] = useState<string | null>(null);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router]);

  if (isLoading || !user || !cart || catalogLoading) return null;

  const stores = locations.filter((l) => l.pickupEnabled);
  const fulfillment: Fulfillment =
    choice ?? (myStore ? { type: "PICKUP", locationId: myStore.locationId } : { type: "SHIP" });
  const pickupStore = fulfillment.type === "PICKUP" ? locationById(fulfillment.locationId) : undefined;

  const lines = cart.items.map((item) => ({ item, product: productById(item.productId) }));
  // An estimate for display only - the Orders API prices the order itself from the catalog
  const total = lines.reduce((sum, l) => sum + (l.product?.price ?? 0) * l.item.quantity, 0);

  async function handlePlaceOrder() {
    setError(null);
    setIsPlacingOrder(true);
    try {
      const order = await api.createOrder(fulfillment, inStoreAt ?? undefined);
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

  const optionClass = (selected: boolean) =>
    `flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
      selected ? "border-foreground" : "border-foreground/15"
    }`;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold">Checkout</h1>

      <fieldset className="mt-6 space-y-2">
        <legend className="mb-2 text-sm font-medium">How would you like it?</legend>
        {stores.length > 0 && (
          <label className={optionClass(fulfillment.type === "PICKUP")}>
            <input
              type="radio"
              name="fulfillment"
              checked={fulfillment.type === "PICKUP"}
              onChange={() =>
                setChoice({ type: "PICKUP", locationId: pickupStore?.locationId ?? myStore?.locationId ?? stores[0].locationId })
              }
            />
            <span className="flex-1">Pick up in store</span>
            <select
              value={pickupStore?.locationId ?? myStore?.locationId ?? stores[0].locationId}
              onChange={(e) => setChoice({ type: "PICKUP", locationId: e.target.value })}
              className="rounded-md border border-foreground/15 bg-background px-2 py-1 text-sm"
            >
              {stores.map((store) => (
                <option key={store.locationId} value={store.locationId}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={optionClass(fulfillment.type === "SHIP")}>
          <input
            type="radio"
            name="fulfillment"
            checked={fulfillment.type === "SHIP"}
            onChange={() => setChoice({ type: "SHIP" })}
          />
          <span className="flex-1">Ship to me</span>
        </label>
      </fieldset>

      {user.isStaff && stores.length > 0 && (
        <label className="mt-4 flex items-center gap-3 rounded-lg border border-dashed border-foreground/20 px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={inStoreAt !== null}
            onChange={(e) => setInStoreAt(e.target.checked ? (myStore?.locationId ?? stores[0].locationId) : null)}
          />
          <span className="flex-1">In-store sale (staff)</span>
          {inStoreAt !== null && (
            <select
              value={inStoreAt}
              onChange={(e) => setInStoreAt(e.target.value)}
              className="rounded-md border border-foreground/15 bg-background px-2 py-1 text-sm"
            >
              {stores.map((store) => (
                <option key={store.locationId} value={store.locationId}>
                  at {store.name}
                </option>
              ))}
            </select>
          )}
        </label>
      )}

      <div className="mt-6 divide-y divide-foreground/10 rounded-lg border border-foreground/10">
        {lines.map(({ item, product }) => {
          // A preview only: the inventory Lambda makes the real allocation when it reserves the stock
          const onShelf = pickupStore && product ? stockAt(product, pickupStore.locationId) >= item.quantity : undefined;
          return (
            <div key={item.productId} className="flex justify-between px-4 py-3 text-sm">
              <span>
                {product?.name ?? item.productId} × {item.quantity}
                {pickupStore && onShelf !== undefined && (
                  <span className="block text-xs text-foreground/50">
                    {onShelf ? `On the shelf at ${pickupStore.name}` : `Transferred to ${pickupStore.name} from another location`}
                  </span>
                )}
              </span>
              <span className="font-medium">${((product?.price ?? 0) * item.quantity).toFixed(2)}</span>
            </div>
          );
        })}
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
        Order processing is asynchronous - status starts as PENDING and becomes RESERVED once the
        Inventory Lambda has set the stock aside.
      </p>
    </div>
  );
}
