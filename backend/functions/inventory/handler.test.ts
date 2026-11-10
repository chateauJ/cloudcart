import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { context, logLines, orderCreatedMessage, sqsEvent, TENANT_ID } from "../../test/helpers";
import { handler } from "./handler";

const ddb = mockClient(DynamoDBDocumentClient);

const pendingOrder = {
  tenantId: TENANT_ID,
  orderId: "order_1",
  userId: "user-1",
  status: "PENDING",
  total: 0.5,
  items: [
    { productId: "prod_001", quantity: 3, unitPrice: 0.1 },
    { productId: "prod_002", quantity: 1, unitPrice: 0.2 },
  ],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

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
  ddb.on(QueryCommand, { TableName: "locations-table" }).resolves({ Items: locations });
});

describe("inventory handler", () => {
  it("takes each line from the warehouse first and completes the order in one transaction", async () => {
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
            ":complete": "COMPLETE",
            // The order records where each line's stock was taken from
            ":items": [
              { productId: "prod_001", quantity: 3, unitPrice: 0.1, sourceLocationId: "warehouse_main" },
              { productId: "prod_002", quantity: 1, unitPrice: 0.2, sourceLocationId: "warehouse_main" },
            ],
          },
        },
      },
    ]);
    expect(outcomes()).toEqual(["COMPLETED"]);
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
    expect(outcomes()).toEqual(["COMPLETED"]);
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

  it("treats a duplicate event for a finished order as done, without touching stock", async () => {
    givenOrder({ ...pendingOrder, status: "COMPLETE" });

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
    expect(ddb).not.toHaveReceivedCommand(QueryCommand);
    expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    expect(outcomes()).toEqual(["ALREADY_PROCESSED"]);
  });

  it("treats a concurrent duplicate that completed the order first as done", async () => {
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
    expect(outcomes()).toEqual(["COMPLETED"]);
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
