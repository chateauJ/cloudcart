// Client for the CloudCart HTTP API (spec.md §12). Products are public; cart and order calls
// attach the signed-in user's Cognito access token, and the API derives the user from it -
// nothing here ever sends a user ID.

import { fetchAuthSession } from "aws-amplify/auth";
import { config } from "./config";
import { Cart, Order, Product } from "./types";

// Every handler returns errors as { error: { code, message } } (backend/shared/responses.ts)
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function accessToken(): Promise<string> {
  // Amplify refreshes an expired access token with the refresh token before returning it
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "You need to log in again");
  return token;
}

async function request<T>(
  method: string,
  path: string,
  options: { auth?: boolean; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.auth) headers.Authorization = `Bearer ${await accessToken()}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store", // stock levels and order status change constantly
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    // API Gateway's own 401 (authorizer rejected the token) has { message } instead of { error }
    const code = data?.error?.code ?? (res.status === 401 ? "UNAUTHORIZED" : "HTTP_ERROR");
    const message = data?.error?.message ?? data?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, code, message);
  }
  return data as T;
}

export function listProducts(): Promise<Product[]> {
  return request<Product[]>("GET", "/products");
}

export async function getProduct(productId: string): Promise<Product | null> {
  try {
    return await request<Product>("GET", `/products/${encodeURIComponent(productId)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function getCart(): Promise<Cart> {
  return request<Cart>("GET", "/cart", { auth: true });
}

// Adds to the line's existing quantity - the API has no "set quantity" route
export function addToCart(productId: string, quantity: number): Promise<Cart> {
  return request<Cart>("POST", "/cart/items", { auth: true, body: { productId, quantity } });
}

export function removeFromCart(productId: string): Promise<Cart> {
  return request<Cart>("DELETE", `/cart/items/${encodeURIComponent(productId)}`, { auth: true });
}

export function createOrder(): Promise<Order> {
  return request<Order>("POST", "/orders", { auth: true });
}

export function listOrders(): Promise<Order[]> {
  return request<Order[]>("GET", "/orders", { auth: true });
}

export async function getOrder(orderId: string): Promise<Order | null> {
  try {
    return await request<Order>("GET", `/orders/${encodeURIComponent(orderId)}`, { auth: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// Turns an unknown thrown value into something a page can show
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) {
    if (err.code === "CART_CONFLICT") return "Your cart changed in another tab - review it and try again.";
    return err.message;
  }
  return err instanceof Error ? err.message : fallback;
}
