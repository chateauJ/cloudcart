import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
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

const PREVIOUS_UPDATED_AT = "2026-11-01T00:00:00.000Z";
const savedCart = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  items: [{ productId: "prod_001", quantity: 1 }],
  updatedAt: PREVIOUS_UPDATED_AT,
};

function givenProductExists(productId = "prod_001") {
  ddb.on(GetCommand, { TableName: "products-table" }).resolves({ Item: { productId } });
}

function givenCart(cart: object | undefined) {
  ddb.on(GetCommand, { TableName: "carts-table" }).resolves({ Item: cart });
}

function addItem(body: unknown, options: { base64?: boolean } = {}) {
  return handler(apiEvent({ routeKey: "POST /cart/items", userId: USER_ID, body, ...options }), context);
}

function savedItem() {
  return ddb.commandCalls(PutCommand)[0].args[0].input;
}

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand, { TableName: TENANTS_TABLE }).resolves({ Item: TENANT });
});

describe("cart handler", () => {
  it("rejects a request without a verified user before touching DynamoDB", async () => {
    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /cart" }), context));

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(ddb.calls()).toHaveLength(0);
  });

  it("returns an empty cart for a user who has never added anything", async () => {
    givenCart(undefined);

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /cart", userId: USER_ID }), context));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ tenantId: TENANT_ID, userId: USER_ID, items: [] });
  });

  it("reads the cart by tenant and user, so each store keeps its own cart for the same shopper", async () => {
    givenCart(structuredClone(savedCart));

    await handler(apiEvent({ routeKey: "GET /cart", userId: USER_ID }), context);

    expect(ddb).toHaveReceivedCommandWith(GetCommand, {
      TableName: "carts-table",
      Key: { tenantId: TENANT_ID, userId: USER_ID },
    });
  });

  it("rejects a request without a tenant before reading the cart", async () => {
    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /cart", userId: USER_ID, tenantId: null }), context));

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("TENANT_REQUIRED");
    expect(dataCalls(ddb.calls())).toHaveLength(0);
  });

  describe("POST /cart/items", () => {
    it("creates the cart on first add, guarded so a concurrent first add can't be overwritten", async () => {
      givenProductExists();
      givenCart(undefined);

      const res = parseResponse(await addItem({ productId: "prod_001", quantity: 2 }));

      expect(res.statusCode).toBe(200);
      expect(res.body.items).toEqual([{ productId: "prod_001", quantity: 2 }]);
      expect(savedItem()).toMatchObject({
        TableName: "carts-table",
        Item: { tenantId: TENANT_ID, userId: USER_ID },
        ConditionExpression: "attribute_not_exists(userId)",
      });
      // The product must exist in this store's catalog, not just anywhere
      expect(ddb).toHaveReceivedCommandWith(GetCommand, {
        TableName: "products-table",
        Key: { tenantId: TENANT_ID, productId: "prod_001" },
      });
    });

    it("adds to an existing line, conditional on the cart being unchanged since it was read", async () => {
      givenProductExists();
      givenCart(structuredClone(savedCart));

      const res = parseResponse(await addItem({ productId: "prod_001", quantity: 2 }));

      expect(res.statusCode).toBe(200);
      expect(res.body.items).toEqual([{ productId: "prod_001", quantity: 3 }]);
      expect(savedItem()).toMatchObject({
        ConditionExpression: "updatedAt = :previousUpdatedAt",
        ExpressionAttributeValues: { ":previousUpdatedAt": PREVIOUS_UPDATED_AT },
      });
      expect(savedItem().Item?.updatedAt).not.toBe(PREVIOUS_UPDATED_AT);
    });

    it("accepts a base64-encoded body", async () => {
      givenProductExists();
      givenCart(undefined);

      const res = parseResponse(await addItem({ productId: "prod_001", quantity: 1 }, { base64: true }));

      expect(res.statusCode).toBe(200);
    });

    it("rejects malformed JSON", async () => {
      const res = parseResponse(
        await handler(apiEvent({ routeKey: "POST /cart/items", userId: USER_ID, rawBody: "{not json" }), context),
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_JSON");
    });

    it.each([
      ["no body", undefined],
      ["missing productId", { quantity: 1 }],
      ["blank productId", { productId: "  ", quantity: 1 }],
      ["zero quantity", { productId: "prod_001", quantity: 0 }],
      ["fractional quantity", { productId: "prod_001", quantity: 1.5 }],
      ["quantity over the limit", { productId: "prod_001", quantity: 100 }],
      ["quantity as a string", { productId: "prod_001", quantity: "2" }],
    ])("rejects an invalid body (%s) without touching the cart or catalog", async (_case, body) => {
      const res = parseResponse(await addItem(body));

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REQUEST");
      expect(dataCalls(ddb.calls())).toHaveLength(0);
    });

    it("returns 404 for a product that doesn't exist and leaves the cart alone", async () => {
      ddb.on(GetCommand, { TableName: "products-table" }).resolves({});

      const res = parseResponse(await addItem({ productId: "prod_999", quantity: 1 }));

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
      expect(ddb).not.toHaveReceivedCommand(PutCommand);
    });

    it("returns 409 when another request changed the cart first", async () => {
      givenProductExists();
      givenCart(structuredClone(savedCart));
      ddb.on(PutCommand).rejects(
        new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} }),
      );

      const res = parseResponse(await addItem({ productId: "prod_001", quantity: 1 }));

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe("CART_CONFLICT");
      expect(logLines()).toContainEqual(
        expect.objectContaining({ level: "WARN", message: "cart write conflict", userId: USER_ID }),
      );
    });
  });

  describe("DELETE /cart/items/{id}", () => {
    function removeItem(productId: string) {
      return handler(
        apiEvent({ routeKey: "DELETE /cart/items/{id}", userId: USER_ID, pathParameters: { id: productId } }),
        context,
      );
    }

    it("removes the line and saves the cart", async () => {
      givenCart(structuredClone(savedCart));

      const res = parseResponse(await removeItem("prod_001"));

      expect(res.statusCode).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(savedItem().Item?.items).toEqual([]);
    });

    it("is a no-op success for an item that isn't in the cart", async () => {
      givenCart(structuredClone(savedCart));

      const res = parseResponse(await removeItem("prod_999"));

      expect(res.statusCode).toBe(200);
      expect(res.body.items).toEqual(savedCart.items);
      expect(ddb).not.toHaveReceivedCommand(PutCommand);
    });
  });

  it("returns a generic 500 when DynamoDB fails", async () => {
    ddb.on(GetCommand).rejects(new Error("Service unavailable"));

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /cart", userId: USER_ID }), context));

    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });
});
