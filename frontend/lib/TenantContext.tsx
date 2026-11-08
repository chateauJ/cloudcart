"use client";

// The store this storefront belongs to (its name and tagline), fetched once per page load for the
// navbar and the catalog header. Null until it loads, or if the API can't be reached.

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import * as api from "./api";
import { Tenant } from "./types";

const TenantContext = createContext<Tenant | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getTenant()
      .then((found) => !cancelled && setTenant(found))
      .catch(() => {}); // the page still works without a name; the catalog shows the API error itself
    return () => {
      cancelled = true;
    };
  }, []);

  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}

export function useTenant(): Tenant | null {
  return useContext(TenantContext);
}
