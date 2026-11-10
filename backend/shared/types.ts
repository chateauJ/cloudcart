// One business sharing the deployment. Every other item carries its tenantId as the partition key.
export interface Tenant {
  tenantId: string;
  name: string;
  tagline: string;
}

// A store or warehouse belonging to one tenant. Stock is held per location.
export type LocationType = "STORE" | "WAREHOUSE";

export interface Location {
  tenantId: string;
  locationId: string;
  name: string;
  type: LocationType;
  pickupEnabled: boolean; // stores take pickups; the warehouse only ships
}

// One product's quantity at one location, keyed "<productId>#<locationId>" within the tenant.
// The only stock record: products carry no count of their own.
export interface StockItem {
  tenantId: string;
  stockKey: string;
  productId: string;
  locationId: string;
  quantity: number;
}

// How the API presents a stock record on a product
export interface StockLevel {
  locationId: string;
  quantity: number;
}

export interface Product {
  tenantId: string;
  productId: string;
  name: string;
  description: string;
  price: number;
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
  sourceLocationId?: string; // set by allocation: the location this line's stock was taken from
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
