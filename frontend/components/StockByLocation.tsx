"use client";

import { useStore } from "@/lib/StoreContext";
import { stockAt } from "@/lib/stock";
import { Product } from "@/lib/types";

// The product page's full picture: every location and what it holds, with the shopper's store first
export default function StockByLocation({ product }: { product: Product }) {
  const { locations, myStore } = useStore();
  if (locations.length === 0) return null;

  const ordered = [...locations].sort(
    (a, b) => Number(b.locationId === myStore?.locationId) - Number(a.locationId === myStore?.locationId),
  );

  return (
    <div className="mt-4 rounded-lg border border-foreground/10 text-sm">
      {ordered.map((location) => {
        const quantity = stockAt(product, location.locationId);
        const isMine = location.locationId === myStore?.locationId;
        return (
          <div
            key={location.locationId}
            className="flex items-center justify-between border-b border-foreground/10 px-3 py-2 last:border-b-0"
          >
            <span>
              {location.name}
              <span className="ml-2 text-xs text-foreground/40">
                {isMine ? "Your store" : location.type === "WAREHOUSE" ? "Warehouse" : "Store"}
              </span>
            </span>
            <span className={quantity > 0 ? "font-medium" : "text-foreground/40"}>
              {quantity > 0 ? `${quantity} in stock` : "None"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
