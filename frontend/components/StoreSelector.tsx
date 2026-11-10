"use client";

import { useStore } from "@/lib/StoreContext";

// "My store": the shopper's local shop, used to show what's on its shelves versus elsewhere
export default function StoreSelector() {
  const { locations, myStore, setMyStore } = useStore();
  const stores = locations.filter((l) => l.pickupEnabled);
  if (stores.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-sm text-foreground/60">
      My store
      <select
        value={myStore?.locationId ?? ""}
        onChange={(e) => setMyStore(e.target.value || null)}
        className="rounded-md border border-foreground/15 bg-background px-2 py-1 text-sm text-foreground"
      >
        <option value="">Choose a store</option>
        {stores.map((store) => (
          <option key={store.locationId} value={store.locationId}>
            {store.name}
          </option>
        ))}
      </select>
    </label>
  );
}
