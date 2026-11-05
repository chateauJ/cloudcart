"use client";

// Client-side copy of the signed-in user's cart, so the navbar badge and /cart page stay in sync.
// The Cart API is the source of truth: every change sends a request and stores the cart it returns.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import * as api from "./api";
import { useAuth } from "./AuthContext";
import { Cart } from "./types";

interface CartContextValue {
  cart: Cart | null;
  itemCount: number;
  error: string | null;
  refresh: () => Promise<void>;
  // Each returns false if the request failed; the message is in `error`
  addItem: (productId: string, quantity: number) => Promise<boolean>;
  updateItem: (productId: string, quantity: number) => Promise<boolean>;
  removeItem: (productId: string) => Promise<boolean>;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setCart(null);
      return;
    }
    try {
      setCart(await api.getCart());
    } catch (err) {
      setError(api.errorMessage(err, "Could not load your cart"));
    }
  }, [user]);

  useEffect(() => {
    // Re-fetch the cart whenever the signed-in user changes - an external-system sync
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function run(change: () => Promise<Cart>): Promise<boolean> {
    if (!user) return false;
    setError(null);
    try {
      setCart(await change());
      return true;
    } catch (err) {
      setError(api.errorMessage(err));
      await refresh(); // show what the server actually has after a failed change
      return false;
    }
  }

  function addItem(productId: string, quantity: number) {
    return run(() => api.addToCart(productId, quantity));
  }

  function updateItem(productId: string, quantity: number) {
    const current = cart?.items.find((i) => i.productId === productId)?.quantity ?? 0;
    if (quantity <= 0) return removeItem(productId);
    if (quantity > current) return run(() => api.addToCart(productId, quantity - current));
    if (quantity === current) return Promise.resolve(true);
    // The API only adds to a line, so lowering a quantity removes the line and re-adds it
    return run(async () => {
      await api.removeFromCart(productId);
      return api.addToCart(productId, quantity);
    });
  }

  function removeItem(productId: string) {
    return run(() => api.removeFromCart(productId));
  }

  const itemCount = cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;

  return (
    <CartContext.Provider
      value={{ cart, itemCount, error, refresh, addItem, updateItem, removeItem }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
