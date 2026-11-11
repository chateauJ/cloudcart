import { api, Config, loadConfig, login, poll } from "./client";

interface StockLevel {
  locationId: string;
  quantity: number;
}

const totalStock = (product: { stock: StockLevel[] }) => product.stock.reduce((sum, level) => sum + level.quantity, 0);
const stockAt = (product: { stock: StockLevel[] }, locationId: string) =>
  product.stock.find((level) => level.locationId === locationId)?.quantity ?? 0;

// One customer journey through every deployed piece: Cognito -> HTTP API + JWT authorizer ->
// Lambdas -> DynamoDB -> Streams -> Pipe -> EventBridge -> SQS -> Inventory Lambda.
// Assumes no one else is buying from dev at the same time - it checks an exact stock change.

let config: Config;
let token: string;

beforeAll(async () => {
  config = loadConfig();
  token = await login(config);
});

describe("CloudCart dev API", () => {
  it("rejects cart access without a token at the API Gateway authorizer", async () => {
    const res = await api(config, "GET", "/cart");

    expect(res.status).toBe(401);
  });

  it("serves the product catalog publicly", async () => {
    const res = await api(config, "GET", "/products");

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("names the store a request is for", async () => {
    const res = await api(config, "GET", "/tenant");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tenantId: config.tenantId, name: expect.any(String) });
  });

  it("lists the store's locations, and every product's stock is held at one of them", async () => {
    const locations = await api(config, "GET", "/locations");
    const catalog = await api(config, "GET", "/products");

    expect(locations.status).toBe(200);
    const types = locations.body.map((l: { type: string }) => l.type);
    expect(types).toContain("STORE");
    expect(types).toContain("WAREHOUSE");

    const known = new Set(locations.body.map((l: { locationId: string }) => l.locationId));
    for (const product of catalog.body) {
      expect(product).not.toHaveProperty("inventory");
      for (const level of product.stock) expect(known.has(level.locationId)).toBe(true);
    }
  });

  it("takes a shipping order from cart to RESERVED and takes the stock from the warehouse first", async () => {
    // Start from an empty cart so leftovers from earlier manual testing don't end up in the order
    const existing = await api(config, "GET", "/cart", { token });
    for (const item of existing.body.items) {
      await api(config, "DELETE", `/cart/items/${item.productId}`, { token });
    }

    // Each run consumes one unit, so pick the best-stocked product to keep the suite repeatable
    const catalog = await api(config, "GET", "/products");
    const product = [...catalog.body].sort((a, b) => totalStock(b) - totalStock(a))[0];
    if (!product || totalStock(product) < 1) {
      throw new Error("Every dev product is out of stock - re-seed the stock table before running");
    }
    const locations = await api(config, "GET", "/locations");
    const warehouse: string = locations.body.find((l: { type: string }) => l.type === "WAREHOUSE").locationId;

    const added = await api(config, "POST", "/cart/items", {
      token,
      body: { productId: product.productId, quantity: 1 },
    });
    expect(added.status).toBe(200);
    expect(added.body.items).toEqual([{ productId: product.productId, quantity: 1 }]);

    const created = await api(config, "POST", "/orders", { token, body: { fulfillment: { type: "SHIP" } } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      tenantId: config.tenantId,
      status: "PENDING",
      fulfillment: { type: "SHIP" },
      total: product.price,
    });
    const orderId: string = created.body.orderId;

    // Checkout clears the cart in the same transaction that writes the order
    const cartAfter = await api(config, "GET", "/cart", { token });
    expect(cartAfter.body.items).toEqual([]);

    // Inventory reservation is asynchronous - wait for the order to leave PENDING
    const settled = await poll(
      () => api(config, "GET", `/orders/${orderId}`, { token }),
      (res) => res.status === 200 && res.body.status !== "PENDING",
    );
    expect(settled.body).toMatchObject({ orderId, status: "RESERVED" });
    expect(settled.body).not.toHaveProperty("holdExpiresAt"); // only pickups are held against a deadline

    // Shipping prefers the warehouse; the order records where the unit came from
    const source: string = settled.body.items[0].sourceLocationId;
    if (stockAt(product, warehouse) >= 1) expect(source).toBe(warehouse);
    const productAfter = await api(config, "GET", `/products/${product.productId}`);
    expect(stockAt(productAfter.body, source)).toBe(stockAt(product, source) - 1);

    const history = await api(config, "GET", "/orders", { token });
    expect(history.body[0].orderId).toBe(orderId); // newest first

    // The same order doesn't exist from another store's point of view
    const elsewhere = await api(config, "GET", `/orders/${orderId}`, { token, tenant: config.otherTenantId });
    expect(elsewhere.status).toBe(404);
  });

  it("holds a pickup at a store, transferring stock the store doesn't have", async () => {
    // Find a store missing a product that another location holds - that line needs a transfer.
    // Holds expire in dev after a few minutes, so the stock this takes comes back on its own.
    const locations = await api(config, "GET", "/locations");
    const catalog = await api(config, "GET", "/products");
    const stores = locations.body.filter((l: { pickupEnabled: boolean }) => l.pickupEnabled);
    let pick: { storeId: string; product: { productId: string; stock: StockLevel[] } } | undefined;
    for (const store of stores) {
      const product = catalog.body.find(
        (p: { stock: StockLevel[] }) => stockAt(p, store.locationId) === 0 && p.stock.some((l) => l.quantity >= 1),
      );
      if (product) {
        pick = { storeId: store.locationId, product };
        break;
      }
    }
    if (!pick) throw new Error("No store is missing a product held elsewhere - check the seeded stock");

    const cart = await api(config, "GET", "/cart", { token });
    for (const item of cart.body.items) await api(config, "DELETE", `/cart/items/${item.productId}`, { token });
    await api(config, "POST", "/cart/items", { token, body: { productId: pick.product.productId, quantity: 1 } });

    const created = await api(config, "POST", "/orders", {
      token,
      body: { fulfillment: { type: "PICKUP", locationId: pick.storeId } },
    });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("tenantQueue"); // an index key, never returned
    expect(created.body.channel).toBe("ONLINE");

    const settled = await poll(
      () => api(config, "GET", `/orders/${created.body.orderId}`, { token }),
      (res) => res.status === 200 && res.body.status !== "PENDING",
    );
    expect(settled.body).toMatchObject({
      status: "RESERVED",
      fulfillment: { type: "PICKUP", locationId: pick.storeId },
      items: [{ productId: pick.product.productId, needsTransfer: true }],
    });
    expect(settled.body.items[0].sourceLocationId).not.toBe(pick.storeId);
    expect(Date.parse(settled.body.holdExpiresAt)).toBeGreaterThan(Date.parse(settled.body.createdAt));
  });

  it("refuses a pickup at the warehouse, which doesn't serve customers", async () => {
    const locations = await api(config, "GET", "/locations");
    const warehouse = locations.body.find((l: { type: string }) => l.type === "WAREHOUSE");

    const res = await api(config, "POST", "/orders", {
      token,
      body: { fulfillment: { type: "PICKUP", locationId: warehouse.locationId } },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PICKUP_LOCATION");
  });

  it("returns 404 for an order that doesn't exist", async () => {
    const res = await api(config, "GET", "/orders/order_does-not-exist", { token });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
  });
});

describe("Tenant isolation", () => {
  it("requires the X-Tenant-Id header", async () => {
    const res = await api(config, "GET", "/products", { tenant: null });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TENANT_REQUIRED");
  });

  it("rejects a store that doesn't exist", async () => {
    const res = await api(config, "GET", "/products", { tenant: "no-such-store" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TENANT_NOT_FOUND");
  });

  it("gives each store its own catalog, even where product IDs overlap", async () => {
    const mine = await api(config, "GET", "/products");
    const theirs = await api(config, "GET", "/products", { tenant: config.otherTenantId });

    expect(theirs.status).toBe(200);
    expect(theirs.body.every((p: { tenantId: string }) => p.tenantId === config.otherTenantId)).toBe(true);

    // A product ID both stores carry resolves to each store's own item, with its own price
    const shared = theirs.body.find((p: { productId: string }) =>
      mine.body.some((m: { productId: string }) => m.productId === p.productId),
    );
    expect(shared).toBeDefined();
    const mineShared = mine.body.find((m: { productId: string }) => m.productId === shared.productId);
    expect(mineShared.tenantId).toBe(config.tenantId);
    expect(mineShared.price).not.toBe(shared.price);
  });

  it("gives each store its own locations", async () => {
    const mine = await api(config, "GET", "/locations");
    const theirs = await api(config, "GET", "/locations", { tenant: config.otherTenantId });

    const ids = (res: { body: Array<{ locationId: string }> }) => res.body.map((l) => l.locationId).sort();
    expect(theirs.status).toBe(200);
    expect(ids(theirs)).not.toEqual(ids(mine));
  });

  it("keeps a shopper's carts separate per store", async () => {
    const theirs = await api(config, "GET", "/products", { tenant: config.otherTenantId });
    const productId: string = theirs.body[0].productId;

    // Clean slate in both stores, then add only at the other store
    for (const tenant of [config.tenantId, config.otherTenantId]) {
      const cart = await api(config, "GET", "/cart", { token, tenant });
      for (const item of cart.body.items) {
        await api(config, "DELETE", `/cart/items/${item.productId}`, { token, tenant });
      }
    }
    const added = await api(config, "POST", "/cart/items", {
      token,
      tenant: config.otherTenantId,
      body: { productId, quantity: 1 },
    });
    expect(added.status).toBe(200);

    const mine = await api(config, "GET", "/cart", { token });
    expect(mine.body.items).toEqual([]);

    await api(config, "DELETE", `/cart/items/${productId}`, { token, tenant: config.otherTenantId });
  });
});
