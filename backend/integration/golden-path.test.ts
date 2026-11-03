import { api, Config, loadConfig, login, poll } from "./client";

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

  it("takes an order from cart to COMPLETE and decrements inventory", async () => {
    // Start from an empty cart so leftovers from earlier manual testing don't end up in the order
    const existing = await api(config, "GET", "/cart", { token });
    for (const item of existing.body.items) {
      await api(config, "DELETE", `/cart/items/${item.productId}`, { token });
    }

    // Each run consumes one unit, so pick the best-stocked product to keep the suite repeatable
    const catalog = await api(config, "GET", "/products");
    const product = [...catalog.body].sort((a, b) => b.inventory - a.inventory)[0];
    if (!product || product.inventory < 1) {
      throw new Error("Every dev product is out of stock - re-seed the products table before running");
    }
    const stockBefore = product.inventory;

    const added = await api(config, "POST", "/cart/items", {
      token,
      body: { productId: product.productId, quantity: 1 },
    });
    expect(added.status).toBe(200);
    expect(added.body.items).toEqual([{ productId: product.productId, quantity: 1 }]);

    const created = await api(config, "POST", "/orders", { token });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "PENDING", total: product.price });
    const orderId: string = created.body.orderId;

    // Checkout clears the cart in the same transaction that writes the order
    const cartAfter = await api(config, "GET", "/cart", { token });
    expect(cartAfter.body.items).toEqual([]);

    // Inventory reservation is asynchronous - wait for the order to leave PENDING
    const settled = await poll(
      () => api(config, "GET", `/orders/${orderId}`, { token }),
      (res) => res.status === 200 && res.body.status !== "PENDING",
    );
    expect(settled.body).toMatchObject({ orderId, status: "COMPLETE" });

    const productAfter = await api(config, "GET", `/products/${product.productId}`);
    expect(productAfter.body.inventory).toBe(stockBefore - 1);

    const history = await api(config, "GET", "/orders", { token });
    expect(history.body[0].orderId).toBe(orderId); // newest first
  });

  it("returns 404 for an order that doesn't exist", async () => {
    const res = await api(config, "GET", "/orders/order_does-not-exist", { token });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
  });
});
