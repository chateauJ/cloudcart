"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";

export default function AddToCartButton({
  productId,
  available,
}: {
  productId: string;
  available: number; // the most one order line can take: the largest quantity at any one location
}) {
  const { user } = useAuth();
  const { addItem, error } = useCart();
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const [failed, setFailed] = useState(false);
  const maxQuantity = Math.min(available, 99); // the Cart API accepts at most 99 per add

  async function handleAdd() {
    if (!user) {
      router.push("/login");
      return;
    }
    const added = await addItem(productId, quantity);
    setFailed(!added);
    if (!added) return;
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  }

  if (available <= 0) {
    return (
      <button
        disabled
        className="rounded-md bg-foreground/20 px-4 py-2 text-sm font-medium text-foreground/50"
      >
        Out of stock
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="number"
        min={1}
        max={maxQuantity}
        value={quantity}
        onChange={(e) => setQuantity(Math.max(1, Math.min(maxQuantity, Number(e.target.value))))}
        className="w-16 rounded-md border border-foreground/15 px-2 py-2 text-sm"
      />
      <button
        onClick={handleAdd}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
      >
        {justAdded ? "Added ✓" : user ? "Add to cart" : "Log in to buy"}
      </button>
      {failed && error && <p className="w-full text-sm text-red-600">{error}</p>}
    </div>
  );
}
