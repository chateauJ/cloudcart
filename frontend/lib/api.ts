// Mock data layer. Every function here has the same signature it will have once
// it calls the real API Gateway endpoints from spec.md §12 - swapping the body
// of each function for a `fetch(...)` call is the only change needed later.
// Cart/order state is kept in localStorage, scoped by userId, to stand in for
// DynamoDB until the backend exists.

import { getAllProducts, getProductById } from "./products";
import { readJSON, writeJSON } from "./storage";
import { Cart, Order, Product } from "./types";

function cartKey(userId: string) {
  return `cloudcart:cart:${userId}`;
}

function ordersKey(userId: string) {
  return `cloudcart:orders:${userId}`;
}

function emptyCart(userId: string): Cart {
  return { userId, items: [], updatedAt: new Date().toISOString() };
}

export async function listProducts(): Promise<Product[]> {
  return getAllProducts();
}

export async function getProduct(productId: string): Promise<Product | null> {
  return getProductById(productId) ?? null;
}

export async function getCart(userId: string): Promise<Cart> {
  return readJSON<Cart>(cartKey(userId), emptyCart(userId));
}

export async function addToCart(
  userId: string,
  productId: string,
  quantity: number,
): Promise<Cart> {
  const cart = await getCart(userId);
  const existing = cart.items.find((i) => i.productId === productId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.items.push({ productId, quantity });
  }
  cart.updatedAt = new Date().toISOString();
  writeJSON(cartKey(userId), cart);
  return cart;
}

export async function updateCartItemQuantity(
  userId: string,
  productId: string,
  quantity: number,
): Promise<Cart> {
  const cart = await getCart(userId);
  if (quantity <= 0) {
    cart.items = cart.items.filter((i) => i.productId !== productId);
  } else {
    const existing = cart.items.find((i) => i.productId === productId);
    if (existing) existing.quantity = quantity;
  }
  cart.updatedAt = new Date().toISOString();
  writeJSON(cartKey(userId), cart);
  return cart;
}

export async function removeFromCart(userId: string, productId: string): Promise<Cart> {
  const cart = await getCart(userId);
  cart.items = cart.items.filter((i) => i.productId !== productId);
  cart.updatedAt = new Date().toISOString();
  writeJSON(cartKey(userId), cart);
  return cart;
}

export async function listOrders(userId: string): Promise<Order[]> {
  const orders = readJSON<Order[]>(ordersKey(userId), []);
  return [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getOrder(userId: string, orderId: string): Promise<Order | null> {
  const orders = await listOrders(userId);
  return orders.find((o) => o.orderId === orderId) ?? null;
}

// Simulates the real flow: order is created PENDING, then the (mock) async
// inventory processing completes it a couple seconds later - stands in for
// the DynamoDB Streams -> EventBridge Pipe -> SQS -> Inventory Lambda path
// in spec.md §4 until that backend exists.
export async function createOrder(userId: string): Promise<Order> {
  const cart = await getCart(userId);
  if (cart.items.length === 0) {
    throw new Error("Cannot create an order from an empty cart");
  }

  const items = cart.items.map((item) => {
    const product = getProductById(item.productId);
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: product?.price ?? 0,
    };
  });
  const total = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  const now = new Date().toISOString();
  const order: Order = {
    orderId: `order_${crypto.randomUUID().split("-")[0]}`,
    userId,
    status: "PENDING",
    total: Math.round(total * 100) / 100,
    items,
    createdAt: now,
    updatedAt: now,
  };

  const orders = readJSON<Order[]>(ordersKey(userId), []);
  orders.push(order);
  writeJSON(ordersKey(userId), orders);
  writeJSON(cartKey(userId), emptyCart(userId));

  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      const current = readJSON<Order[]>(ordersKey(userId), []);
      const updated = current.map((o) =>
        o.orderId === order.orderId
          ? { ...o, status: "COMPLETE" as const, updatedAt: new Date().toISOString() }
          : o,
      );
      writeJSON(ordersKey(userId), updated);
    }, 2500);
  }

  return order;
}
