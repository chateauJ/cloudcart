// Every DynamoDB key is built here, and every builder takes the tenant first. A handler can't
// read or write an item without naming the tenant it belongs to, so one store's request can
// never address another store's data by ID alone.
export const keys = {
  tenant: (tenantId: string) => ({ tenantId }),
  product: (tenantId: string, productId: string) => ({ tenantId, productId }),
  cart: (tenantId: string, userId: string) => ({ tenantId, userId }),
  order: (tenantId: string, orderId: string) => ({ tenantId, orderId }),
  location: (tenantId: string, locationId: string) => ({ tenantId, locationId }),
  stock: (tenantId: string, productId: string, locationId: string) => ({
    tenantId,
    stockKey: `${productId}#${locationId}`,
  }),
  // begins_with on this finds one product's stock at every location; the "#" stops prod_1 matching prod_10
  stockPrefix: (productId: string) => `${productId}#`,
  // The orders table's user-index partition key: one shopper's history at one store
  tenantUser: (tenantId: string, userId: string) => `${tenantId}#${userId}`,
  // A pickup order's store, for the pickup-queue index: one store's orders at one tenant
  tenantLocation: (tenantId: string, locationId: string) => `${tenantId}#${locationId}`,
};
