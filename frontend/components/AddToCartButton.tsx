"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";

export default function AddToCartButton({
  productId,
  inventory,
}: {
  productId: string;
  inventory: number;
}) {
  const { user } = useAuth();
  const { addItem } = useCart();
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  async function handleAdd() {
    if (!user) {
      router.push("/login");
      return;
    }
    await addItem(productId, quantity);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  }

  if (inventory <= 0) {
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
    <div className="flex items-center gap-3">
      <input
        type="number"
        min={1}
        max={inventory}
        value={quantity}
        onChange={(e) => setQuantity(Math.max(1, Math.min(inventory, Number(e.target.value))))}
        className="w-16 rounded-md border border-foreground/15 px-2 py-2 text-sm"
      />
      <button
        onClick={handleAdd}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
      >
        {justAdded ? "Added ✓" : user ? "Add to cart" : "Log in to buy"}
      </button>
    </div>
  );
}
