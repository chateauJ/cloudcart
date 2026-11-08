export interface Tenant {
  tenantId: string;
  name: string;
  tagline: string;
}

export type ProductCategory = "cameras" | "phone-accessories";

export interface Product {
  productId: string;
  name: string;
  description: string;
  price: number;
  inventory: number;
  category: ProductCategory;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface Cart {
  userId: string;
  items: CartItem[];
  updatedAt?: string; // absent until the cart is first saved
}

export type OrderStatus = "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";

export interface OrderLineItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  orderId: string;
  userId: string;
  status: OrderStatus;
  total: number;
  items: OrderLineItem[];
  createdAt: string;
  updatedAt: string;
  failureReason?: string; // set only when status is FAILED
}
