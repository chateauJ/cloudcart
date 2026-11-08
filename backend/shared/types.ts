// One business sharing the deployment. Every other item carries its tenantId as the partition key.
export interface Tenant {
  tenantId: string;
  name: string;
  tagline: string;
}

export interface Product {
  tenantId: string;
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
  tenantId: string;
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
  tenantId: string;
  orderId: string;
  userId: string;
  tenantUser: string; // "<tenantId>#<userId>" - the user-index key; internal, never returned by the API
  status: OrderStatus;
  total: number;
  items: OrderLineItem[];
  createdAt: string;
  updatedAt: string;
  failureReason?: string; // set only when status is FAILED
}

// Shape of the Pipe's input_template output - the OrderCreated event's detail
export interface OrderCreatedDetail {
  tenantId: string;
  orderId: string;
  userId: string;
  total: string; // DynamoDB numbers are strings in stream records, and Pipes can't convert types
  createdAt: string;
}
