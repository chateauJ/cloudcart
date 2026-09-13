"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";
import { getProductById } from "@/lib/products";

export default function CartPage() {
  const { user, isLoading } = useAuth();
  const { cart, updateItem, removeItem } = useCart();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const lines = (cart?.items ?? [])
    .map((item) => ({ item, product: getProductById(item.productId) }))
    .filter((l) => l.product);

  const subtotal = lines.reduce((sum, l) => sum + l.product!.price * l.item.quantity, 0);

  if (lines.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Your cart</h1>
        <p className="mt-4 text-foreground/60">
          Your cart is empty.{" "}
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
      <h1 className="text-2xl font-semibold">Your cart</h1>

      <div className="mt-6 divide-y divide-foreground/10">
        {lines.map(({ item, product }) => (
          <div key={item.productId} className="flex items-center gap-4 py-4">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-foreground/5 to-foreground/10 text-xl font-semibold text-foreground/30">
              {product!.name.charAt(0)}
            </div>
            <div className="flex-1">
              <Link href={`/products/${item.productId}`} className="font-medium hover:underline">
                {product!.name}
              </Link>
              <p className="text-sm text-foreground/50">${product!.price.toFixed(2)} each</p>
            </div>
            <input
              type="number"
              min={1}
              max={product!.inventory}
              value={item.quantity}
              onChange={(e) => updateItem(item.productId, Number(e.target.value))}
              className="w-16 rounded-md border border-foreground/15 px-2 py-1.5 text-sm"
            />
            <span className="w-20 text-right font-medium">
              ${(product!.price * item.quantity).toFixed(2)}
            </span>
            <button
              onClick={() => removeItem(item.productId)}
              className="text-sm text-foreground/50 hover:text-red-600"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-foreground/10 pt-6">
        <span className="text-lg font-semibold">Subtotal: ${subtotal.toFixed(2)}</span>
        <Link
          href="/checkout"
          className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90"
        >
          Checkout
        </Link>
      </div>
    </div>
  );
}
