import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConflictException, CreateScheduleCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { mockClient } from "aws-sdk-client-mock";
import { context, logLines, orderCreatedMessage, sqsEvent, TENANT_ID } from "../../test/helpers";
import { handler } from "./handler";

const ddb = mockClient(DynamoDBDocumentClient);
const scheduler = mockClient(SchedulerClient);

const pendingOrder = {
  tenantId: TENANT_ID,
  orderId: "order_1",
  userId: "user-1",
  status: "PENDING",
  fulfillment: { type: "SHIP" },
  total: 0.5,
  items: [
    { productId: "prod_001", quantity: 3, unitPrice: 0.1 },
    { productId: "prod_002", quantity: 1, unitPrice: 0.2 },
  ],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

// Collected at Downtown; HOLD_MINUTES is 10 in test/env.ts
const pickupOrder = { ...pendingOrder, fulfillment: { type: "PICKUP", locationId: "store_downtown" } };
const HOLD_EXPIRES_AT = "2026-11-01T00:10:00.000Z";

const orderCreated = orderCreatedMessage({ tenantId: TENANT_ID, orderId: "order_1", userId: "user-1", total: "0.5" });

// Listed in an order that isn't the shipping preference, to prove the handler sorts them
const locations = [
  { tenantId: TENANT_ID, locationId: "store_harbor", name: "Harbor", type: "STORE", pickupEnabled: true },
  { tenantId: TENANT_ID, locationId: "warehouse_main", name: "Warehouse", type: "WAREHOUSE", pickupEnabled: false },
  { tenantId: TENANT_ID, locationId: "store_downtown", name: "Downtown", type: "STORE", pickupEnabled: true },
];

type StockLevels = Record<string, number>; // locationId -> quantity

function stockRows(productId: string, levels: StockLevels) {
  return Object.entries(levels).map(([locationId, quantity]) => ({
    tenantId: TENANT_ID,
    stockKey: `${productId}#${locationId}`,
    productId,
    locationId,
    quantity,
  }));
}

function stockQuery(productId: string) {
  return { TableName: "stock-table", ExpressionAttributeValues: { ":tenantId": TENANT_ID, ":prefix": `${productId}#` } };
}

function givenStock(productId: string, ...reads: StockLevels[]) {
  // One entry per read: the handler re-reads stock when a race makes its transaction fail
  const stub = ddb.on(QueryCommand, stockQuery(productId));
  reads.forEach((levels) => stub.resolvesOnce({ Items: stockRows(productId, levels) }));
}

// Reasons are positional: one per transaction item, stock first and the order update last
function transactionCanceled(...codes: string[]) {
  return new TransactionCanceledException({
    message: "Transaction cancelled",
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

function givenOrder(order: object | undefined) {
  ddb.on(GetCommand, { TableName: "orders-table", Key: { tenantId: TENANT_ID, orderId: "order_1" } }).resolves({
    Item: order,
  });
}

function stockUpdates(callIndex = 0) {
  const items = ddb.commandCalls(TransactWriteCommand)[callIndex].args[0].input.TransactItems ?? [];
  return items.slice(0, -1).map((item) => item.Update?.Key);
}

function outcomes() {
  return logLines()
    .filter((line) => line.message === "order processed")
    .map((line) => line.outcome);
}

beforeEach(() => {
  ddb.reset();
  scheduler.reset();
  ddb.on(QueryCommand, { TableName: "locations-table" }).resolves({ Items: locations });
});

describe("inventory handler", () => {
  it("ships each line from the warehouse first and reserves the order in one transaction", async () => {
    givenOrder(pendingOrder);
    givenStock("prod_001", { store_downtown: 9, warehouse_main: 5 });
    givenStock("prod_002", { warehouse_main: 1 });

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
    const transaction = ddb.commandCalls(TransactWriteCommand)[0].args[0].input;
    expect(transaction.TransactItems).toMatchObject([
      {
        Update: {
          TableName: "stock-table",
          Key: { tenantId: TENANT_ID, stockKey: "prod_001#warehouse_main" },
          UpdateExpression: "SET quantity = quantity - :qty",
          ConditionExpression: "quantity >= :qty",
          ExpressionAttributeValues: { ":qty": 3 },
        },
      },
      {
        Update: {
          TableName: "stock-table",
          Key: { tenantId: TENANT_ID, stockKey: "prod_002#warehouse_main" },
          ExpressionAttributeValues: { ":qty": 1 },
        },
      },
      {
        Update: {
          TableName: "orders-table",
          Key: { tenantId: TENANT_ID, orderId: "order_1" },
          ConditionExpression: "#status = :pending",
          ExpressionAttributeValues: {
            ":reserved": "RESERVED",
            // The order records where each line's stock was taken from
            ":items": [
              { productId: "prod_001", quantity: 3, unitPrice: 0.1, sourceLocationId: "warehouse_main" },
              { productId: "prod_002", quantity: 1, unitPrice: 0.2, sourceLocationId: "warehouse_main" },
            ],
          },
        },
      },
    ]);
    expect(transaction.TransactItems?.[2].Update?.UpdateExpression).not.toContain("holdExpiresAt");
    expect(scheduler).not.toHaveReceivedCommand(CreateScheduleCommand); // a shipment has no hold to expire
    expect(outcomes()).toEqual(["RESERVED"]);
  });

  it("ships from a store when the warehouse can't fill the line, choosing stores in a stable order", async () => {
    givenOrder(pendingOrder);
    givenStock("prod_001", { warehouse_main: 2, store_harbor: 3, store_downtown: 3 });
    givenStock("prod_002", { store_harbor: 1 });

    await handler(sqsEvent(orderCreated), context);

    expect(stockUpdates()).toEqual([
      { tenantId: TENANT_ID, stockKey: "prod_001#store_downtown" },
      { tenantId: TENANT_ID, stockKey: "prod_002#store_harbor" },
    ]);
  });

  it("marks the order FAILED when no single location holds a line's whole quantity", async () => {
    givenOrder(pendingOrder);
    // 4 units exist in total, but a line is never split across locations
    givenStock("prod_001", { warehouse_main: 2, store_downtown: 2 });
    givenStock("prod_002", { warehouse_main: 1 });

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
    expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    expect(ddb).toHaveReceivedCommandWith(UpdateCommand, {
      TableName: "orders-table",
      Key: { tenantId: TENANT_ID, orderId: "order_1" },
      ConditionExpression: "#status = :pending",
      ExpressionAttributeValues: expect.objectContaining({ ":failed": "FAILED" }),
    });
    expect(outcomes()).toEqual(["FAILED_INSUFFICIENT_STOCK"]);
  });

  it("marks the order FAILED for a product with no stock anywhere", async () => {
    givenOrder(pendingOrder);
    givenStock("prod_001", { warehouse_main: 5 });
    givenStock("prod_002", {});

    await handler(sqsEvent(orderCreated), context);

    expect(outcomes()).toEqual(["FAILED_INSUFFICIENT_STOCK"]);
  });

  it("re-reads stock and re-allocates when another order took it first", async () => {
    givenOrder(pendingOrder);
    givenStock("prod_001", { warehouse_main: 5, store_downtown: 4 }, { warehouse_main: 1, store_downtown: 4 });
    givenStock("prod_002", { warehouse_main: 1 }, { warehouse_main: 1 });
    ddb
      .on(TransactWriteCommand)
      .rejectsOnce(transactionCanceled("ConditionalCheckFailed", "None", "None"))
      .resolves({});

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
    expect(ddb).toHaveReceivedCommandTimes(TransactWriteCommand, 2);
    expect(stockUpdates(1)[0]).toEqual({ tenantId: TENANT_ID, stockKey: "prod_001#store_downtown" });
    expect(outcomes()).toEqual(["RESERVED"]);
  });

  it("hands the message back to SQS when stock keeps changing on every attempt", async () => {
    givenOrder(pendingOrder);
    const levels = { warehouse_main: 5 };
    givenStock("prod_001", levels, levels, levels);
    givenStock("prod_002", levels, levels, levels);
    ddb.on(TransactWriteCommand).rejects(transactionCanceled("ConditionalCheckFailed", "None", "None"));

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "message-1" }]);
    expect(ddb).toHaveReceivedCommandTimes(TransactWriteCommand, 3);
    expect(ddb).not.toHaveReceivedCommand(UpdateCommand); // contention isn't a stock-out, so not FAILED
  });

  describe("pickup orders", () => {
    it("takes stock from the pickup store's own shelf first, with no transfer", async () => {
      givenOrder(pickupOrder);
      givenStock("prod_001", { warehouse_main: 50, store_downtown: 3 });
      givenStock("prod_002", { warehouse_main: 50, store_downtown: 1 });

      await handler(sqsEvent(orderCreated), context);

      expect(stockUpdates()).toEqual([
        { tenantId: TENANT_ID, stockKey: "prod_001#store_downtown" },
        { tenantId: TENANT_ID, stockKey: "prod_002#store_downtown" },
      ]);
      const items = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[2].Update
        ?.ExpressionAttributeValues?.[":items"];
      expect(items.map((item: { needsTransfer: boolean }) => item.needsTransfer)).toEqual([false, false]);
    });

    it("falls back to the warehouse, then another store, and flags those lines for transfer", async () => {
      givenOrder(pickupOrder);
      givenStock("prod_001", { store_downtown: 1, warehouse_main: 3 });
      givenStock("prod_002", { store_downtown: 0, warehouse_main: 0, store_harbor: 2 });

      await handler(sqsEvent(orderCreated), context);

      const update = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[2].Update;
      expect(update?.ExpressionAttributeValues?.[":items"]).toEqual([
        expect.objectContaining({ productId: "prod_001", sourceLocationId: "warehouse_main", needsTransfer: true }),
        expect.objectContaining({ productId: "prod_002", sourceLocationId: "store_harbor", needsTransfer: true }),
      ]);
    });

    it("sets the hold deadline from the order's creation time and schedules its expiry first", async () => {
      givenOrder(pickupOrder);
      givenStock("prod_001", { store_downtown: 5 });
      givenStock("prod_002", { store_downtown: 5 });
      jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-01T00:00:30.000Z"));

      await handler(sqsEvent(orderCreated), context);

      expect(scheduler).toHaveReceivedCommandWith(CreateScheduleCommand, {
        Name: "hold-order_1",
        GroupName: "holds-group",
        ScheduleExpression: "at(2026-11-01T00:10:00)",
        ScheduleExpressionTimezone: "UTC",
        ActionAfterCompletion: "DELETE",
        Target: {
          Arn: "arn:aws:lambda:us-east-1:123456789012:function:expiry",
          RoleArn: "arn:aws:iam::123456789012:role/hold-scheduler",
          Input: JSON.stringify({ tenantId: TENANT_ID, orderId: "order_1" }),
        },
      });
      const update = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[2].Update;
      expect(update?.UpdateExpression).toContain("holdExpiresAt = :holdExpiresAt");
      expect(update?.ExpressionAttributeValues?.[":holdExpiresAt"]).toBe(HOLD_EXPIRES_AT);
      // Scheduled before reserving, so a reservation can never exist without its expiry
      expect(
        scheduler.commandCalls(CreateScheduleCommand)[0].calledBefore(ddb.commandCalls(TransactWriteCommand)[0]),
      ).toBe(true);
    });

    it("schedules a hold that lapsed while queued for shortly after now, never in the past", async () => {
      givenOrder(pickupOrder);
      givenStock("prod_001", { store_downtown: 5 });
      givenStock("prod_002", { store_downtown: 5 });
      jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-01T01:00:00.000Z"));

      await handler(sqsEvent(orderCreated), context);

      expect(scheduler).toHaveReceivedCommandWith(CreateScheduleCommand, { ScheduleExpression: "at(2026-11-01T01:01:00)" });
    });

    it("carries on when a retry finds the expiry already scheduled", async () => {
      givenOrder(pickupOrder);
      givenStock("prod_001", { store_downtown: 5 });
      givenStock("prod_002", { store_downtown: 5 });
      scheduler.on(CreateScheduleCommand).rejects(new ConflictException({ message: "exists", Message: "exists", $metadata: {} }));

      const result = await handler(sqsEvent(orderCreated), context);

      expect(result.batchItemFailures).toEqual([]);
      expect(outcomes()).toEqual(["RESERVED"]);
    });

    it("leaves the message for a retry, with no stock reserved, when scheduling fails", async () => {
      givenOrder(pickupOrder);
      givenStock("prod_001", { store_downtown: 5 });
      givenStock("prod_002", { store_downtown: 5 });
      scheduler.on(CreateScheduleCommand).rejects(new Error("Rate exceeded"));

      const result = await handler(sqsEvent(orderCreated), context);

      expect(result.batchItemFailures).toEqual([{ itemIdentifier: "message-1" }]);
      expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    });

    it("schedules nothing when no location can fill the order", async () => {
      givenOrder(pickupOrder);
      givenStock("prod_001", {});
      givenStock("prod_002", {});

      await handler(sqsEvent(orderCreated), context);

      expect(scheduler).not.toHaveReceivedCommand(CreateScheduleCommand);
      expect(outcomes()).toEqual(["FAILED_INSUFFICIENT_STOCK"]);
    });
  });

  it("treats a duplicate event for a finished order as done, without touching stock", async () => {
    givenOrder({ ...pendingOrder, status: "RESERVED" });

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
    expect(ddb).not.toHaveReceivedCommand(QueryCommand);
    expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    expect(outcomes()).toEqual(["ALREADY_PROCESSED"]);
  });

  it("treats a concurrent duplicate that reserved the order first as done", async () => {
    givenOrder(pendingOrder);
    givenStock("prod_001", { warehouse_main: 5 });
    givenStock("prod_002", { warehouse_main: 5 });
    // The order condition failed: another delivery moved it out of PENDING between our read and write
    ddb.on(TransactWriteCommand).rejects(transactionCanceled("None", "None", "ConditionalCheckFailed"));

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
    expect(ddb).not.toHaveReceivedCommand(UpdateCommand);
    expect(outcomes()).toEqual(["ALREADY_PROCESSED"]);
  });

  it("succeeds when a concurrent delivery marked the order FAILED first", async () => {
    givenOrder(pendingOrder);
    givenStock("prod_001", {});
    givenStock("prod_002", {});
    ddb.on(UpdateCommand).rejects(
      new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} }),
    );

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
  });

  it("retries transient transaction failures instead of failing the order", async () => {
    givenOrder(pendingOrder);
    givenStock("prod_001", { warehouse_main: 5 });
    givenStock("prod_002", { warehouse_main: 5 });
    ddb.on(TransactWriteCommand).rejects(transactionCanceled("TransactionConflict", "None", "None"));

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "message-1" }]);
    expect(ddb).toHaveReceivedCommandTimes(TransactWriteCommand, 1);
    expect(ddb).not.toHaveReceivedCommand(UpdateCommand);
  });

  it("retries an event whose order can't be found", async () => {
    givenOrder(undefined);

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "message-1" }]);
  });

  it("reports only the failed records in a batch, so the good ones are deleted", async () => {
    givenOrder(pendingOrder);
    givenStock("prod_001", { warehouse_main: 5 });
    givenStock("prod_002", { warehouse_main: 5 });

    const result = await handler(
      sqsEvent(
        "not json",
        orderCreated,
        orderCreatedMessage({ userId: "user-1" }),
        orderCreatedMessage({ orderId: "order_1", userId: "user-1" }), // no tenant: the order can't be addressed
      ),
      context,
    );

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: "message-1" },
      { itemIdentifier: "message-3" },
      { itemIdentifier: "message-4" },
    ]);
    expect(outcomes()).toEqual(["RESERVED"]);
  });

  it("logs and retries when DynamoDB fails", async () => {
    ddb.on(GetCommand).rejects(new Error("Service unavailable"));

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "message-1" }]);
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        level: "ERROR",
        message: "order processing failed",
        tenantId: TENANT_ID,
        orderId: "order_1",
        messageId: "message-1",
        error: expect.objectContaining({ message: "Service unavailable" }),
      }),
    );
  });
});
