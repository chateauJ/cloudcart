"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";
import { useCatalog } from "@/lib/CatalogContext";
import ProductImage from "@/components/ProductImage";

// Commits on blur or Enter rather than every keystroke - typing "12" would otherwise send
// one request for 1 and another for 12
function QuantityInput({
  value,
  max,
  onCommit,
}: {
  value: number;
  max: number;
  onCommit: (quantity: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    // Show the server's quantity again after each change round-trips
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(String(value));
  }, [value]);

  function commit() {
    const next = Math.max(1, Math.min(max, Math.floor(Number(draft)) || 1));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }

  return (
    <input
      type="number"
      min={1}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="w-16 rounded-md border border-foreground/15 px-2 py-1.5 text-sm"
    />
  );
}

export default function CartPage() {
  const { user, isLoading } = useAuth();
  const { cart, error, updateItem, removeItem } = useCart();
  const { productById, isLoading: catalogLoading } = useCatalog();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router]);

  if (isLoading || !user || !cart || catalogLoading) return null;

  // A product removed from the catalog still shows, by ID, so it can be taken out of the cart
  const lines = cart.items.map((item) => ({ item, product: productById(item.productId) }));
  const subtotal = lines.reduce((sum, l) => sum + (l.product?.price ?? 0) * l.item.quantity, 0);

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
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 divide-y divide-foreground/10">
        {lines.map(({ item, product }) => (
          <div key={item.productId} className="flex items-center gap-4 py-4">
            <ProductImage
              productId={item.productId}
              name={product?.name ?? item.productId}
              className="h-16 w-20 flex-shrink-0 rounded-md"
              initialClassName="text-xl"
            />
            <div className="flex-1">
              <Link href={`/products/${item.productId}`} className="font-medium hover:underline">
                {product?.name ?? item.productId}
              </Link>
              <p className="text-sm text-foreground/50">
                {product ? `$${product.price.toFixed(2)} each` : "No longer available"}
              </p>
            </div>
            <QuantityInput
              value={item.quantity}
              max={Math.min(99, product?.inventory ?? item.quantity)}
              onCommit={(quantity) => updateItem(item.productId, quantity)}
            />
            <span className="w-20 text-right font-medium">
              ${((product?.price ?? 0) * item.quantity).toFixed(2)}
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
