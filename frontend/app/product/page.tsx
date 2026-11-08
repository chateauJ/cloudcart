"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as api from "@/lib/api";
import { Product } from "@/lib/types";
import AddToCartButton from "@/components/AddToCartButton";
import ProductImage from "@/components/ProductImage";

// /product?id=<productId>: a static export can only pre-build pages for IDs known at build time,
// so the ID is a query parameter and the product is fetched in the browser
export default function ProductPage() {
  return (
    <Suspense>
      <ProductDetail />
    </Suspense>
  );
}

function ProductDetail() {
  const id = useSearchParams().get("id") ?? "";
  // Each result remembers which ?id= it was for, so navigating to another product shows nothing
  // stale while the next one loads. product is null when the API says it doesn't exist.
  const [result, setResult] = useState<{ id: string; product?: Product | null; error?: string }>();

  useEffect(() => {
    let cancelled = false;
    (id ? api.getProduct(id) : Promise.resolve(null))
      .then((product) => !cancelled && setResult({ id, product }))
      .catch((err) => !cancelled && setResult({ id, error: api.errorMessage(err, "Couldn't load this product") }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const current = result?.id === id ? result : undefined;
  const product = current?.product;
  const error = current?.error;

  const backLink = (
    <Link href="/products" className="text-sm text-foreground/60 hover:underline">
      ← Back to products
    </Link>
  );

  if (error) {
    return (
      <div>
        {backLink}
        <p className="mt-4 text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!current) return null; // still loading
  if (!product) {
    return (
      <div>
        {backLink}
        <p className="mt-4 text-foreground/60">This product doesn&apos;t exist.</p>
      </div>
    );
  }

  return (
    <div>
      {backLink}

      <div className="mt-4 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <ProductImage
          productId={product.productId}
          name={product.name}
          className="aspect-[4/3] w-full rounded-lg"
          initialClassName="text-6xl"
        />

        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">
            {product.category === "cameras" ? "Camera" : "Phone Accessory"}
          </span>
          <h1 className="mt-1 text-2xl font-semibold">{product.name}</h1>
          <p className="mt-3 text-foreground/70">{product.description}</p>
          <p className="mt-4 text-2xl font-semibold">${product.price.toFixed(2)}</p>
          <p className="mt-1 text-sm text-foreground/50">
            {product.inventory > 0 ? `${product.inventory} in stock` : "Out of stock"}
          </p>

          <div className="mt-6">
            <AddToCartButton productId={product.productId} inventory={product.inventory} />
          </div>
        </div>
      </div>
    </div>
  );
}
