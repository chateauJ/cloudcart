import { api, ApiResponse, Config, loadConfig, login, poll } from "./client";

// A business's staff working its queues. Needs the test user in the staff-<tenantId> Cognito group
// for the golden path's tenant (and not in the other tenant's group).

let config: Config;
let token: string;

beforeAll(async () => {
  config = loadConfig();
  token = await login(config);

  // The access token's payload is the middle, base64url-encoded part
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const groups: string[] = claims["cognito:groups"] ?? [];
  if (!groups.includes(`staff-${config.tenantId}`)) {
    throw new Error(
      `The test user isn't in staff-${config.tenantId}. Add them with: aws cognito-idp admin-add-user-to-group ` +
        `--user-pool-id <pool> --username <test user> --group-name staff-${config.tenantId} --region us-east-1`,
    );
  }
});

// Checks out one unit of the best-stocked product and waits for allocation to settle the order
async function placeOrder(body: Record<string, unknown>): Promise<ApiResponse> {
  const cart = await api(config, "GET", "/cart", { token });
  for (const item of cart.body.items) await api(config, "DELETE", `/cart/items/${item.productId}`, { token });

  const catalog = await api(config, "GET", "/products");
  const total = (p: { stock: Array<{ quantity: number }> }) => p.stock.reduce((sum, l) => sum + l.quantity, 0);
  const product = [...catalog.body].sort((a, b) => total(b) - total(a))[0];
  await api(config, "POST", "/cart/items", { token, body: { productId: product.productId, quantity: 1 } });

  const created = await api(config, "POST", "/orders", { token, body });
  expect(created.status).toBe(201);
  return poll(
    () => api(config, "GET", `/orders/${created.body.orderId}`, { token }),
    (res) => res.status === 200 && res.body.status !== "PENDING",
  );
}

const ids = (res: ApiResponse) => res.body.map((order: { orderId: string }) => order.orderId);

describe("Staff", () => {
  it("works a pickup through its store's queue: ready, then picked up", async () => {
    const locations = await api(config, "GET", "/locations");
    const store: string = locations.body.find((l: { pickupEnabled: boolean }) => l.pickupEnabled).locationId;
    const order = await placeOrder({ fulfillment: { type: "PICKUP", locationId: store } });
    expect(order.body.status).toBe("RESERVED");
    const orderId: string = order.body.orderId;

    const queue = await api(config, "GET", `/staff/orders?queue=${store}`, { token });
    expect(queue.status).toBe(200);
    expect(ids(queue)).toContain(orderId);
    expect(queue.body[0]).not.toHaveProperty("tenantQueue");

    const ready = await api(config, "POST", `/staff/orders/${orderId}/ready`, { token });
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe("READY_FOR_PICKUP");

    // A second press of the same button can't move it again
    const again = await api(config, "POST", `/staff/orders/${orderId}/ready`, { token });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");

    const collected = await api(config, "POST", `/staff/orders/${orderId}/fulfill`, { token });
    expect(collected.body.status).toBe("FULFILLED");

    // The shopper sees it collected, and it has left the queue of work still to do
    const shopperView = await api(config, "GET", `/orders/${orderId}`, { token });
    expect(shopperView.body.status).toBe("FULFILLED");
    const after = await api(config, "GET", `/staff/orders?queue=${store}`, { token });
    expect(ids(after)).not.toContain(orderId);
  });

  it("rings up an in-store sale for shipping and ships it from the shipping queue", async () => {
    const locations = await api(config, "GET", "/locations");
    const store: string = locations.body.find((l: { type: string }) => l.type === "STORE").locationId;
    const order = await placeOrder({ fulfillment: { type: "SHIP" }, channel: "IN_STORE", placedAtLocationId: store });
    expect(order.body).toMatchObject({ status: "RESERVED", channel: "IN_STORE", placedAtLocationId: store });

    const queue = await api(config, "GET", "/staff/orders?queue=SHIP", { token });
    expect(ids(queue)).toContain(order.body.orderId);

    const shipped = await api(config, "POST", `/staff/orders/${order.body.orderId}/fulfill`, { token });
    expect(shipped.status).toBe(200);
    expect(shipped.body.status).toBe("FULFILLED");
  });

  it("hides the staff API from someone who isn't staff of that business", async () => {
    const res = await api(config, "GET", "/staff/orders?queue=SHIP", { token, tenant: config.otherTenantId });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("refuses an in-store sale at a business the user isn't staff of", async () => {
    const res = await api(config, "POST", "/orders", {
      token,
      tenant: config.otherTenantId,
      body: { fulfillment: { type: "SHIP" }, channel: "IN_STORE", placedAtLocationId: "store_boardwalk" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CHANNEL");
  });
});
