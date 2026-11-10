// Reading a product's per-location stock. An order line is always filled from one location, never
// split, so the most a shopper can buy in one line is the largest single location's quantity.

import { Product } from "./types";

export function totalStock(product: Product): number {
  return product.stock.reduce((sum, level) => sum + level.quantity, 0);
}

export function stockAt(product: Product, locationId: string): number {
  return product.stock.find((level) => level.locationId === locationId)?.quantity ?? 0;
}

export function maxPerLine(product: Product): number {
  return product.stock.reduce((max, level) => Math.max(max, level.quantity), 0);
}
