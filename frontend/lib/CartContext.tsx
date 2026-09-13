"use client";

// Client-side cache of the cart so the navbar badge and /cart page stay in
// sync without prop drilling. Source of truth is still lib/api.ts (localStorage
// today, the real Cart API in spec.md §12 later).

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import * as api from "./api";
import { useAuth } from "./AuthContext";
import { Cart } from "./types";

interface CartContextValue {
  cart: Cart | null;
  itemCount: number;
  refresh: () => Promise<void>;
  addItem: (productId: string, quantity: number) => Promise<void>;
  updateItem: (productId: string, quantity: number) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [cart, setCart] = useState<Cart | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setCart(null);
      return;
    }
    setCart(await api.getCart(user.userId));
  }, [user]);

  useEffect(() => {
    // Re-sync the cart (from localStorage, later the real Cart API) whenever
    // the logged-in user changes - an external-system sync, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function addItem(productId: string, quantity: number) {
    if (!user) return;
    setCart(await api.addToCart(user.userId, productId, quantity));
  }

  async function updateItem(productId: string, quantity: number) {
    if (!user) return;
    setCart(await api.updateCartItemQuantity(user.userId, productId, quantity));
  }

  async function removeItem(productId: string) {
    if (!user) return;
    setCart(await api.removeFromCart(user.userId, productId));
  }

  const itemCount = cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;

  return (
    <CartContext.Provider value={{ cart, itemCount, refresh, addItem, updateItem, removeItem }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
