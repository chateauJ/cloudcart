export interface Product {
  productId: string;
  name: string;
  description: string;
  price: number;
  inventory: number;
  category: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface Cart {
  userId: string;
  items: CartItem[];
  updatedAt?: string; // absent until the cart is first saved - saveCart relies on this
}

export type OrderStatus = "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";

export interface OrderLineItem {
  productId: string;
  quantity: number;
  unitPrice: number; // snapshot at order time, so later price changes don't rewrite history
}

export interface Order {
  orderId: string;
  userId: string;
  status: OrderStatus;
  total: number;
  items: OrderLineItem[];
  createdAt: string;
  updatedAt: string;
}
