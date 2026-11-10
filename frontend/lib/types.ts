export interface Tenant {
  tenantId: string;
  name: string;
  tagline: string;
}

export type ProductCategory = "cameras" | "phone-accessories";

export interface Location {
  locationId: string;
  name: string;
  type: "STORE" | "WAREHOUSE";
  pickupEnabled: boolean;
}

export interface StockLevel {
  locationId: string;
  quantity: number;
}

export interface Product {
  productId: string;
  name: string;
  description: string;
  price: number;
  category: ProductCategory;
  stock: StockLevel[]; // per location; a location with no entry holds none
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
  sourceLocationId?: string; // where the stock was taken from, once the order is processed
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
