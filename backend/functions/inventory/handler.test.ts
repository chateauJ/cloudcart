import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
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

// Reasons are positional: one per transaction item, products first and the order update last
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

function outcomes() {
  return logLines()
    .filter((line) => line.message === "order processed")
    .map((line) => line.outcome);
}

beforeEach(() => ddb.reset());

describe("inventory handler", () => {
  it("reserves every line and completes the order in one transaction", async () => {
    givenOrder(pendingOrder);

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
    const transaction = ddb.commandCalls(TransactWriteCommand)[0].args[0].input;
    expect(transaction.TransactItems).toMatchObject([
      {
        Update: {
          TableName: "products-table",
          Key: { tenantId: TENANT_ID, productId: "prod_001" },
          ConditionExpression: "attribute_exists(productId) AND inventory >= :qty",
          ExpressionAttributeValues: { ":qty": 3 },
        },
      },
      {
        Update: {
          TableName: "products-table",
          Key: { tenantId: TENANT_ID, productId: "prod_002" },
          ExpressionAttributeValues: { ":qty": 1 },
        },
      },
      {
        Update: {
          TableName: "orders-table",
          Key: { tenantId: TENANT_ID, orderId: "order_1" },
          ConditionExpression: "#status = :pending",
          ExpressionAttributeValues: { ":complete": "COMPLETE" },
        },
      },
    ]);
    expect(outcomes()).toEqual(["COMPLETED"]);
  });

  it("marks the order FAILED when a product has insufficient inventory", async () => {
    givenOrder(pendingOrder);
    ddb.on(TransactWriteCommand).rejects(transactionCanceled("None", "ConditionalCheckFailed", "None"));

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
    expect(ddb).toHaveReceivedCommandWith(UpdateCommand, {
      TableName: "orders-table",
      Key: { tenantId: TENANT_ID, orderId: "order_1" },
      ConditionExpression: "#status = :pending",
      ExpressionAttributeValues: expect.objectContaining({ ":failed": "FAILED" }),
    });
    expect(outcomes()).toEqual(["FAILED_INSUFFICIENT_INVENTORY"]);
  });

  it("treats a duplicate event for a finished order as done, without touching inventory", async () => {
    givenOrder({ ...pendingOrder, status: "COMPLETE" });

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
    expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    expect(outcomes()).toEqual(["ALREADY_PROCESSED"]);
  });

  it("treats a concurrent duplicate that completed the order first as done", async () => {
    givenOrder(pendingOrder);
    // The order condition failed: another delivery moved it out of PENDING between our read and write
    ddb.on(TransactWriteCommand).rejects(transactionCanceled("None", "None", "ConditionalCheckFailed"));

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
    expect(ddb).not.toHaveReceivedCommand(UpdateCommand);
    expect(outcomes()).toEqual(["ALREADY_PROCESSED"]);
  });

  it("succeeds when a concurrent delivery marked the order FAILED first", async () => {
    givenOrder(pendingOrder);
    ddb.on(TransactWriteCommand).rejects(transactionCanceled("ConditionalCheckFailed", "None", "None"));
    ddb.on(UpdateCommand).rejects(
      new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} }),
    );

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([]);
  });

  it("retries transient transaction failures instead of failing the order", async () => {
    givenOrder(pendingOrder);
    ddb.on(TransactWriteCommand).rejects(transactionCanceled("TransactionConflict", "None", "None"));

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "message-1" }]);
    expect(ddb).not.toHaveReceivedCommand(UpdateCommand);
  });

  it("retries an event whose order can't be found", async () => {
    givenOrder(undefined);

    const result = await handler(sqsEvent(orderCreated), context);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "message-1" }]);
  });

  it("reports only the failed records in a batch, so the good ones are deleted", async () => {
    givenOrder(pendingOrder);

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
