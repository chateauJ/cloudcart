"use client";

// The business's locations, and the shopper's chosen "My store" among them. The choice is kept in
// localStorage per tenant, so it survives reloads and each storefront remembers its own.

import { createContext, useContext, useEffect, useState, useSyncExternalStore, ReactNode } from "react";
import * as api from "./api";
import { config } from "./config";
import { Location } from "./types";

interface StoreContextValue {
  locations: Location[];
  locationById: (locationId: string) => Location | undefined;
  myStore: Location | null; // null until chosen, or if the saved store no longer takes pickups
  setMyStore: (locationId: string | null) => void;
}

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

const STORAGE_KEY = `cloudcart:${config.tenantId}:my-store`;
const listeners = new Set<() => void>();

// localStorage as an external store: read during render, re-rendered when it changes in this tab
// (setMyStore) or another one (the "storage" event)
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked, e.g. some private windows: the choice just isn't remembered
  }
}

function save(locationId: string | null) {
  try {
    if (locationId) localStorage.setItem(STORAGE_KEY, locationId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // as above
  }
  listeners.forEach((onChange) => onChange());
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const savedId = useSyncExternalStore(subscribe, readSaved, () => null);

  useEffect(() => {
    let cancelled = false;
    api
      .listLocations()
      .then((found) => !cancelled && setLocations(found))
      .catch(() => {}); // pages still work without locations; availability then shows totals only
    return () => {
      cancelled = true;
    };
  }, []);

  const myStore = locations.find((l) => l.locationId === savedId && l.pickupEnabled) ?? null;

  return (
    <StoreContext.Provider
      value={{
        locations,
        locationById: (id) => locations.find((l) => l.locationId === id),
        myStore,
        setMyStore: save,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
