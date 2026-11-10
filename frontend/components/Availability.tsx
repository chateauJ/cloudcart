"use client";

import { useStore } from "@/lib/StoreContext";
import { stockAt, totalStock } from "@/lib/stock";
import { Product } from "@/lib/types";

// One line of availability for the product grid: what's at the shopper's store, and what the
// business holds everywhere else - the endless aisle in a sentence
export default function Availability({ product }: { product: Product }) {
  const { myStore } = useStore();
  const total = totalStock(product);

  if (total === 0) return <span className="text-xs text-foreground/50">Out of stock</span>;
  if (!myStore) return <span className="text-xs text-foreground/50">{total} in stock</span>;

  const here = stockAt(product, myStore.locationId);
  return here > 0 ? (
    <span className="text-xs text-green-700">
      {here} at {myStore.name}
    </span>
  ) : (
    <span className="text-xs text-foreground/50">
      Not at {myStore.name} · {total} elsewhere
    </span>
  );
}
