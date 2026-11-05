"use client";

// The product catalog, fetched once per page load, so the cart, checkout and order pages can show
// names and prices for the product IDs the cart and order APIs return.

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import * as api from "./api";
import { Product } from "./types";

interface CatalogContextValue {
  productById: (productId: string) => Product | undefined;
  isLoading: boolean;
  error: string | null;
}

const CatalogContext = createContext<CatalogContextValue | undefined>(undefined);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Map<string, Product> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listProducts()
      .then((list) => {
        if (!cancelled) setProducts(new Map(list.map((p) => [p.productId, p])));
      })
      .catch((err) => {
        if (!cancelled) setError(api.errorMessage(err, "Could not load the product catalog"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CatalogContext.Provider
      value={{
        productById: (id) => products?.get(id),
        isLoading: products === null && error === null,
        error,
      }}
    >
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used within CatalogProvider");
  return ctx;
}
