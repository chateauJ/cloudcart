"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as api from "@/lib/api";
import { Product } from "@/lib/types";
import ProductCard from "@/components/ProductCard";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "cameras", label: "Cameras" },
  { value: "phone-accessories", label: "Phone Accessories" },
];

// useSearchParams needs a Suspense boundary in a static export: the HTML is built without a query string
export default function ProductsPage() {
  return (
    <Suspense>
      <ProductGrid />
    </Suspense>
  );
}

function ProductGrid() {
  const category = useSearchParams().get("category") ?? "";
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listProducts()
      // Scan returns items in hash order, which reshuffles as the catalog changes - sort for a stable grid
      .then((list) =>
        setProducts(
          list.sort((a, b) => a.category.localeCompare(b.category) || a.productId.localeCompare(b.productId)),
        ),
      )
      .catch((err) => setError(api.errorMessage(err, "Couldn't load products from the API")));
  }, []);

  useEffect(() => {
    load(); // fetched on every visit, so stock levels are current
  }, [load]);

  function retry() {
    setError(null);
    load();
  }

  const visible = products?.filter((p) => !category || p.category === category) ?? [];

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-sm text-foreground/60">Cameras and phone accessories.</p>
        </div>
        <div className="flex gap-2">
          {CATEGORIES.map((c) => (
            <Link
              key={c.value}
              href={c.value ? `/products?category=${c.value}` : "/products"}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                category === c.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/15 hover:bg-foreground/5"
              }`}
            >
              {c.label}
            </Link>
          ))}
        </div>
      </div>

      {error && (
        <div>
          <p className="text-foreground/60">{error}.</p>
          <button
            onClick={retry}
            className="mt-4 rounded-md border border-foreground/15 px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
          >
            Try again
          </button>
        </div>
      )}

      {products && visible.length === 0 && (
        <p className="text-foreground/60">No products in this category yet.</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((product) => (
          <ProductCard key={product.productId} product={product} />
        ))}
      </div>
    </div>
  );
}
