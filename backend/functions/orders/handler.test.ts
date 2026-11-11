import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import {
  apiEvent,
  context,
  dataCalls,
  logLines,
  parseResponse,
  TENANT,
  TENANT_ID,
  TENANTS_TABLE,
  USER_ID,
} from "../../test/helpers";
import { handler } from "./handler";

const ddb = mockClient(DynamoDBDocumentClient);

const CART_UPDATED_AT = "2026-11-01T00:00:00.000Z";
const TENANT_USER = `${TENANT_ID}#${USER_ID}`;
const cart = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  items: [
    { productId: "prod_001", quantity: 1 },
    { productId: "prod_002", quantity: 1 },
  ],
  updatedAt: CART_UPDATED_AT,
};
// 0.1 + 0.2 is 0.30000000000000004 in floating point; the handler must still return 0.3
const sticker = { productId: "prod_001", name: "Sticker", price: 0.1, inventory: 50 };
const pin = { productId: "prod_002", name: "Pin", price: 0.2, inventory: 50 };

// As stored: tenantUser and tenantQueue key indexes and are stripped from API responses
const storedOrder = {
  tenantId: TENANT_ID,
  orderId: "order_1",
  userId: USER_ID,
  tenantUser: TENANT_USER,
  tenantQueue: `${TENANT_ID}#SHIP`,
  status: "RESERVED",
  fulfillment: { type: "SHIP" },
  channel: "ONLINE",
  total: 0.5,
  items: [],
  createdAt: CART_UPDATED_AT,
  updatedAt: CART_UPDATED_AT,
};
const { tenantUser: _userIndexKey, tenantQueue: _queueIndexKey, ...returnedOrder } = storedOrder;

function givenCart(value: object | undefined) {
  ddb.on(GetCommand, { TableName: "carts-table" }).resolves({ Item: value });
}

function givenProducts(...products: object[]) {
  ddb.on(BatchGetCommand).resolves({ Responses: { "products-table": products } });
}

const SHIP = { fulfillment: { type: "SHIP" } };
const PICKUP_DOWNTOWN = { fulfillment: { type: "PICKUP", locationId: "store_downtown" } };

// Every checkout names its fulfillment; tests that aren't about it ship
function createOrder(body: unknown = SHIP) {
  return checkout(body);
}

// Sends exactly this body - undefined means none at all
function checkout(body: unknown) {
  return handler(apiEvent({ routeKey: "POST /orders", userId: USER_ID, body }), context);
}

function givenLocation(value: object | undefined) {
  ddb.on(GetCommand, { TableName: "locations-table" }).resolves({ Item: value });
}

function getOrder(orderId: string) {
  return handler(apiEvent({ routeKey: "GET /orders/{id}", userId: USER_ID, pathParameters: { id: orderId } }), context);
}

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand, { TableName: TENANTS_TABLE }).resolves({ Item: TENANT });
});

describe("orders handler", () => {
  it("rejects a request without a verified user before touching DynamoDB", async () => {
    const res = parseResponse(await handler(apiEvent({ routeKey: "POST /orders" }), context));

    expect(res.statusCode).toBe(401);
    expect(ddb.calls()).toHaveLength(0);
  });

  it("rejects a request for an unknown tenant before reading any order data", async () => {
    ddb.on(GetCommand, { TableName: TENANTS_TABLE }).resolves({});

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /orders", userId: USER_ID, tenantId: "nobody" }), context));

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("TENANT_NOT_FOUND");
    expect(dataCalls(ddb.calls())).toHaveLength(0);
  });

  describe("POST /orders", () => {
    it("creates a PENDING order and clears the cart in one transaction", async () => {
      givenCart(cart);
      givenProducts(sticker, pin);

      const res = parseResponse(await createOrder());

      expect(res.statusCode).toBe(201);
      expect(res.body).toMatchObject({
        tenantId: TENANT_ID,
        orderId: expect.stringMatching(/^order_[0-9a-f-]{36}$/),
        userId: USER_ID,
        status: "PENDING",
        fulfillment: { type: "SHIP" },
        total: 0.3,
        items: [
          { productId: "prod_001", quantity: 1, unitPrice: 0.1 },
          { productId: "prod_002", quantity: 1, unitPrice: 0.2 },
        ],
      });

      expect(res.body).not.toHaveProperty("tenantUser");

      // Prices come from this store's catalog
      expect(ddb.commandCalls(BatchGetCommand)[0].args[0].input.RequestItems).toEqual({
        "products-table": {
          Keys: [
            { tenantId: TENANT_ID, productId: "prod_001" },
            { tenantId: TENANT_ID, productId: "prod_002" },
          ],
        },
      });

      const transaction = ddb.commandCalls(TransactWriteCommand)[0].args[0].input;
      expect(transaction.TransactItems).toMatchObject([
        {
          Put: {
            TableName: "orders-table",
            Item: { tenantId: TENANT_ID, orderId: res.body.orderId, tenantUser: TENANT_USER },
            ConditionExpression: "attribute_not_exists(orderId)",
          },
        },
        {
          // The cart is deleted only if it's still the version that was priced
          Delete: {
            TableName: "carts-table",
            Key: { tenantId: TENANT_ID, userId: USER_ID },
            ExpressionAttributeValues: { ":cartUpdatedAt": CART_UPDATED_AT },
          },
        },
      ]);
      expect(logLines()).toContainEqual(
        expect.objectContaining({ message: "order created", orderId: res.body.orderId, total: 0.3, lineCount: 2 }),
      );
    });

    it.each([
      ["no cart", undefined],
      ["an empty cart", { ...cart, items: [] }],
    ])("rejects checkout with %s", async (_case, value) => {
      givenCart(value);

      const res = parseResponse(await createOrder());

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("CART_EMPTY");
      expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it("rejects a cart too large for the inventory transaction", async () => {
      const items = Array.from({ length: 100 }, (_, index) => ({ productId: `prod_${index}`, quantity: 1 }));
      givenCart({ ...cart, items });

      const res = parseResponse(await createOrder());

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("CART_TOO_LARGE");
    });

    it("rejects checkout when a product in the cart no longer exists", async () => {
      givenCart(cart);
      givenProducts(sticker);

      const res = parseResponse(await createOrder());

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
      expect(res.body.error.message).toContain("prod_002");
      expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it("fails rather than pricing an order from a partial product read", async () => {
      givenCart(cart);
      ddb.on(BatchGetCommand).resolves({
        Responses: { "products-table": [sticker] },
        UnprocessedKeys: { "products-table": { Keys: [{ productId: "prod_002" }] } },
      });

      const res = parseResponse(await createOrder());

      expect(res.statusCode).toBe(500);
      expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it("returns 409 when the cart changed between pricing and checkout", async () => {
      givenCart(cart);
      givenProducts(sticker, pin);
      ddb.on(TransactWriteCommand).rejects(
        new TransactionCanceledException({
          message: "Transaction cancelled",
          $metadata: {},
          CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
        }),
      );

      const res = parseResponse(await createOrder());

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe("CART_CONFLICT");
      expect(logLines()).toContainEqual(
        expect.objectContaining({ message: "checkout conflict", reasons: ["None", "ConditionalCheckFailed"] }),
      );
    });

    it("returns a generic 500 when DynamoDB fails", async () => {
      ddb.on(GetCommand).rejects(new Error("Service unavailable"));

      const res = parseResponse(await createOrder());

      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("POST /orders fulfillment", () => {
    it("records a pickup at one of the tenant's stores, queued at that store", async () => {
      givenLocation({ tenantId: TENANT_ID, locationId: "store_downtown", type: "STORE", pickupEnabled: true });
      givenCart(cart);
      givenProducts(sticker, pin);

      const res = parseResponse(await createOrder(PICKUP_DOWNTOWN));

      expect(res.statusCode).toBe(201);
      expect(res.body.fulfillment).toEqual({ type: "PICKUP", locationId: "store_downtown" });
      expect(res.body).not.toHaveProperty("tenantQueue"); // an index key, not part of the API
      expect(ddb).toHaveReceivedCommandWith(GetCommand, {
        TableName: "locations-table",
        Key: { tenantId: TENANT_ID, locationId: "store_downtown" },
      });
      const put = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[0].Put;
      expect(put?.Item).toMatchObject({
        fulfillment: { type: "PICKUP", locationId: "store_downtown" },
        tenantQueue: `${TENANT_ID}#store_downtown`,
        channel: "ONLINE",
      });
    });

    it("queues a shipment in the tenant's shipping queue", async () => {
      givenCart(cart);
      givenProducts(sticker, pin);

      await createOrder(SHIP);

      const put = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[0].Put;
      expect(put?.Item).toMatchObject({ tenantQueue: `${TENANT_ID}#SHIP`, channel: "ONLINE" });
      expect(ddb).not.toHaveReceivedCommandWith(GetCommand, { TableName: "locations-table" });
    });

    it.each([
      ["the warehouse, which doesn't serve customers", { tenantId: TENANT_ID, locationId: "warehouse_main", pickupEnabled: false }],
      ["a location this tenant doesn't have", undefined],
    ])("rejects a pickup at %s", async (_case, location) => {
      givenLocation(location);

      const res = parseResponse(await createOrder({ fulfillment: { type: "PICKUP", locationId: "warehouse_main" } }));

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_PICKUP_LOCATION");
      expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it.each([
      ["no body", undefined],
      ["no fulfillment", {}],
      ["an unknown type", { fulfillment: { type: "DRONE" } }],
      ["a pickup without a store", { fulfillment: { type: "PICKUP" } }],
      ["a malformed store ID", { fulfillment: { type: "PICKUP", locationId: "store#1" } }],
    ])("rejects checkout with %s before reading the cart", async (_case, body) => {
      const res = parseResponse(await checkout(body));

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REQUEST");
      expect(dataCalls(ddb.calls())).toHaveLength(0);
    });

    it("records an in-store sale rung up by the tenant's staff at one of its stores", async () => {
      ddb.on(GetCommand, { TableName: "locations-table" }).resolves({
        Item: { tenantId: TENANT_ID, locationId: "store_harbor", type: "STORE", pickupEnabled: true },
      });
      givenCart(cart);
      givenProducts(sticker, pin);

      const res = parseResponse(
        await handler(
          apiEvent({
            routeKey: "POST /orders",
            userId: USER_ID,
            groups: `[staff-${TENANT_ID}]`,
            body: { ...SHIP, channel: "IN_STORE", placedAtLocationId: "store_harbor" },
          }),
          context,
        ),
      );

      expect(res.statusCode).toBe(201);
      expect(res.body).toMatchObject({ channel: "IN_STORE", placedAtLocationId: "store_harbor" });
    });

    it.each([
      ["a shopper", "[]"],
      ["staff of another business", "[staff-tidewater]"],
    ])("refuses an in-store sale from %s", async (_case, groups) => {
      const res = parseResponse(
        await handler(
          apiEvent({
            routeKey: "POST /orders",
            userId: USER_ID,
            groups,
            body: { ...SHIP, channel: "IN_STORE", placedAtLocationId: "store_harbor" },
          }),
          context,
        ),
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_CHANNEL");
      expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it("refuses an in-store sale placed at the warehouse", async () => {
      ddb.on(GetCommand, { TableName: "locations-table" }).resolves({ Item: { type: "WAREHOUSE" } });

      const res = parseResponse(
        await handler(
          apiEvent({
            routeKey: "POST /orders",
            userId: USER_ID,
            groups: `[staff-${TENANT_ID}]`,
            body: { ...SHIP, channel: "IN_STORE", placedAtLocationId: "warehouse_main" },
          }),
          context,
        ),
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_LOCATION");
    });

    it.each([
      ["an unknown channel", { ...SHIP, channel: "PHONE" }],
      ["IN_STORE without a store", { ...SHIP, channel: "IN_STORE" }],
    ])("rejects %s", async (_case, body) => {
      const res = parseResponse(await checkout(body));

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REQUEST");
    });

    it("rejects a body that isn't JSON", async () => {
      const res = parseResponse(
        await handler(apiEvent({ routeKey: "POST /orders", userId: USER_ID, rawBody: "{not json" }), context),
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_JSON");
    });
  });

  describe("GET /orders", () => {
    it("lists the user's orders at this store, newest first, from the user index", async () => {
      ddb.on(QueryCommand).resolves({ Items: [storedOrder] });

      const res = parseResponse(await handler(apiEvent({ routeKey: "GET /orders", userId: USER_ID }), context));

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual([returnedOrder]);
      expect(ddb).toHaveReceivedCommandWith(QueryCommand, {
        IndexName: "tenantUser-createdAt-index",
        KeyConditionExpression: "tenantUser = :tenantUser",
        ExpressionAttributeValues: { ":tenantUser": TENANT_USER },
        ScanIndexForward: false,
        Limit: 50,
      });
    });
  });

  describe("GET /orders/{id}", () => {
    it("returns the user's own order, read by its tenant-scoped key", async () => {
      ddb.on(GetCommand, { TableName: "orders-table", Key: { tenantId: TENANT_ID, orderId: "order_1" } }).resolves({
        Item: storedOrder,
      });

      const res = parseResponse(await getOrder("order_1"));

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(returnedOrder);
    });

    it("returns 404 for an order that doesn't exist", async () => {
      ddb.on(GetCommand, { TableName: "orders-table" }).resolves({});

      const res = parseResponse(await getOrder("order_missing"));

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    });

    it("returns the same 404 for another user's order, so order IDs can't be probed", async () => {
      ddb.on(GetCommand, { TableName: "orders-table" }).resolves({ Item: { ...storedOrder, userId: "user-2" } });

      const res = parseResponse(await getOrder("order_1"));

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    });
  });
});
