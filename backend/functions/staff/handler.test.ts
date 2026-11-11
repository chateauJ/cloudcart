import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { apiEvent, context, dataCalls, logLines, parseResponse, TENANT, TENANT_ID, TENANTS_TABLE, USER_ID } from "../../test/helpers";
import { handler } from "./handler";

const ddb = mockClient(DynamoDBDocumentClient);

const STAFF = `[staff-${TENANT_ID}]`;

const reservedPickup = {
  tenantId: TENANT_ID,
  orderId: "order_1",
  userId: "shopper-1",
  tenantUser: `${TENANT_ID}#shopper-1`,
  tenantQueue: `${TENANT_ID}#store_downtown`,
  status: "RESERVED",
  fulfillment: { type: "PICKUP", locationId: "store_downtown" },
  channel: "ONLINE",
  total: 10,
  items: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:01.000Z",
};

function staffEvent(options: {
  routeKey: string;
  groups?: string;
  tenantId?: string;
  orderId?: string;
  query?: Record<string, string>;
}) {
  return apiEvent({
    routeKey: options.routeKey,
    userId: USER_ID,
    groups: options.groups ?? STAFF,
    tenantId: options.tenantId,
    pathParameters: options.orderId ? { id: options.orderId } : undefined,
    queryStringParameters: options.query,
  });
}

function listQueue(query: Record<string, string>) {
  return handler(staffEvent({ routeKey: "GET /staff/orders", query }), context);
}

function move(action: "ready" | "fulfill", orderId = "order_1") {
  return handler(staffEvent({ routeKey: `POST /staff/orders/{id}/${action}`, orderId }), context);
}

function conditionFailed(item?: Record<string, unknown>) {
  return new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {}, Item: item as never });
}

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand, { TableName: TENANTS_TABLE }).resolves({ Item: TENANT });
  ddb.on(GetCommand, { TableName: "locations-table" }).resolves({
    Item: { tenantId: TENANT_ID, locationId: "store_downtown", type: "STORE", pickupEnabled: true },
  });
});

describe("staff handler", () => {
  describe("who may use it", () => {
    it("rejects a request without a verified user", async () => {
      const res = parseResponse(await handler(apiEvent({ routeKey: "GET /staff/orders" }), context));

      expect(res.statusCode).toBe(401);
    });

    it.each([
      ["a shopper with no groups", "[]"],
      ["staff of another business", "[staff-tidewater]"],
    ])("answers %s with the same 404 as a missing route, before reading any order", async (_case, groups) => {
      const res = parseResponse(
        await handler(staffEvent({ routeKey: "GET /staff/orders", groups, query: { queue: "SHIP" } }), context),
      );

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
      expect(dataCalls(ddb.calls())).toHaveLength(0);
      expect(logLines()).toContainEqual(expect.objectContaining({ message: "staff route refused" }));
    });

    it("checks membership against the request's tenant, not any staff group", async () => {
      // Staff of northlight asking about tidewater's orders
      ddb.on(GetCommand, { TableName: TENANTS_TABLE }).resolves({ Item: { ...TENANT, tenantId: "tidewater" } });

      const res = parseResponse(
        await handler(staffEvent({ routeKey: "GET /staff/orders", tenantId: "tidewater", query: { queue: "SHIP" } }), context),
      );

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /staff/orders", () => {
    it("lists a store's pickup queue oldest first, active orders only, without index keys", async () => {
      ddb.on(QueryCommand).resolves({ Items: [reservedPickup] });

      const res = parseResponse(await listQueue({ queue: "store_downtown" }));

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).not.toHaveProperty("tenantQueue");
      expect(res.body[0]).not.toHaveProperty("tenantUser");
      expect(ddb).toHaveReceivedCommandWith(QueryCommand, {
        IndexName: "tenantQueue-createdAt-index",
        KeyConditionExpression: "tenantQueue = :queue",
        FilterExpression: "#status IN (:s0, :s1)",
        ExpressionAttributeValues: { ":queue": `${TENANT_ID}#store_downtown`, ":s0": "RESERVED", ":s1": "READY_FOR_PICKUP" },
        ScanIndexForward: true,
      });
    });

    it("lists the shipping queue without a location lookup", async () => {
      ddb.on(QueryCommand).resolves({ Items: [] });

      await listQueue({ queue: "SHIP" });

      expect(ddb).toHaveReceivedCommandWith(QueryCommand, {
        ExpressionAttributeValues: { ":queue": `${TENANT_ID}#SHIP`, ":s0": "RESERVED" },
      });
      expect(ddb).not.toHaveReceivedCommandWith(GetCommand, { TableName: "locations-table" });
    });

    it("filters by the statuses asked for", async () => {
      ddb.on(QueryCommand).resolves({ Items: [] });

      await listQueue({ queue: "SHIP", status: "FULFILLED" });

      expect(ddb).toHaveReceivedCommandWith(QueryCommand, { ExpressionAttributeValues: { ":queue": `${TENANT_ID}#SHIP`, ":s0": "FULFILLED" } });
    });

    it.each([
      ["no queue", {}],
      ["the warehouse, which has no pickup counter", { queue: "warehouse_main" }],
    ])("rejects %s", async (_case, query) => {
      ddb.on(GetCommand, { TableName: "locations-table" }).resolves({ Item: { pickupEnabled: false } });

      const res = parseResponse(await listQueue(query));

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_QUEUE");
    });

    it("rejects an unknown status", async () => {
      const res = parseResponse(await listQueue({ queue: "SHIP", status: "LOST" }));

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_STATUS");
    });
  });

  describe("moving an order", () => {
    it("marks a reserved pickup ready, recording who did it, in one conditional update", async () => {
      ddb.on(UpdateCommand).resolves({ Attributes: { ...reservedPickup, status: "READY_FOR_PICKUP" } });

      const res = parseResponse(await move("ready"));

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("READY_FOR_PICKUP");
      expect(res.body).not.toHaveProperty("tenantQueue");
      const update = ddb.commandCalls(UpdateCommand)[0].args[0].input;
      expect(update).toMatchObject({
        TableName: "orders-table",
        Key: { tenantId: TENANT_ID, orderId: "order_1" },
        ConditionExpression: "attribute_exists(orderId) AND (fulfillment.#type = :pickup AND #status = :reserved)",
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      });
      expect(update.UpdateExpression).toContain("readyBy = :staff");
      expect(update.ExpressionAttributeValues).toMatchObject({ ":staff": USER_ID, ":ready": "READY_FOR_PICKUP" });
      // Every value sent is used by the expressions - DynamoDB rejects any that aren't
      expect(Object.keys(update.ExpressionAttributeValues ?? {}).sort()).toEqual(
        [":now", ":pickup", ":ready", ":reserved", ":staff"],
      );
    });

    it("fulfills a ready pickup or a reserved shipment", async () => {
      ddb.on(UpdateCommand).resolves({ Attributes: { ...reservedPickup, status: "FULFILLED" } });

      const res = parseResponse(await move("fulfill"));

      expect(res.body.status).toBe("FULFILLED");
      const update = ddb.commandCalls(UpdateCommand)[0].args[0].input;
      expect(update.ConditionExpression).toBe(
        "attribute_exists(orderId) AND ((fulfillment.#type = :pickup AND #status = :ready) OR (fulfillment.#type = :ship AND #status = :reserved))",
      );
      expect(update.UpdateExpression).toContain("fulfilledBy = :staff");
    });

    it("answers 409 with the current status when the order isn't in a state that allows the move", async () => {
      ddb.on(UpdateCommand).rejects(conditionFailed({ status: { S: "FULFILLED" } }));

      const res = parseResponse(await move("ready"));

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe("INVALID_TRANSITION");
      expect(res.body.error.message).toContain("FULFILLED");
    });

    it("answers 404 for an order that doesn't exist at this tenant", async () => {
      ddb.on(UpdateCommand).rejects(conditionFailed());

      const res = parseResponse(await move("fulfill", "order_missing"));

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    });

    it("rejects a move without an order id", async () => {
      const res = parseResponse(
        await handler(staffEvent({ routeKey: "POST /staff/orders/{id}/ready" }), context),
      );

      expect(res.statusCode).toBe(400);
    });

    it("returns a generic 500 when DynamoDB fails", async () => {
      ddb.on(UpdateCommand).rejects(new Error("Service unavailable"));

      const res = parseResponse(await move("ready"));

      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
    });
  });

  it("returns 404 for a route it doesn't serve", async () => {
    const res = parseResponse(await handler(staffEvent({ routeKey: "DELETE /staff/orders" }), context));

    expect(res.statusCode).toBe(404);
  });
});
