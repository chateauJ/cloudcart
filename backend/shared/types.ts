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
