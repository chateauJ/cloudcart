import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { context, logLines, TENANT_ID } from "../../test/helpers";
import { handler } from "./handler";

const ddb = mockClient(DynamoDBDocumentClient);

const NOW = Date.parse("2026-11-01T00:10:05.000Z");

const heldOrder = {
  tenantId: TENANT_ID,
  orderId: "order_1",
  userId: "user-1",
  status: "RESERVED",
  fulfillment: { type: "PICKUP", locationId: "store_downtown" },
  holdExpiresAt: "2026-11-01T00:10:00.000Z",
  total: 0.5,
  items: [
    { productId: "prod_001", quantity: 3, unitPrice: 0.1, sourceLocationId: "store_downtown", needsTransfer: false },
    { productId: "prod_002", quantity: 1, unitPrice: 0.2, sourceLocationId: "warehouse_main", needsTransfer: true },
  ],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:01.000Z",
};

function givenOrder(order: object | undefined) {
  ddb.on(GetCommand, { TableName: "orders-table", Key: { tenantId: TENANT_ID, orderId: "order_1" } }).resolves({
    Item: order,
  });
}

function expire() {
  return handler({ tenantId: TENANT_ID, orderId: "order_1" }, context);
}

beforeEach(() => {
  ddb.reset();
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
});

afterEach(() => jest.useRealTimers());

describe("expiry handler", () => {
  it("returns each line's stock to its source location and expires the order in one transaction", async () => {
    givenOrder(heldOrder);

    const result = await expire();

    expect(result).toEqual({ outcome: "EXPIRED" });
    const transaction = ddb.commandCalls(TransactWriteCommand)[0].args[0].input;
    expect(transaction.TransactItems).toMatchObject([
      {
        Update: {
          TableName: "stock-table",
          Key: { tenantId: TENANT_ID, stockKey: "prod_001#store_downtown" },
          UpdateExpression: "ADD quantity :qty",
          ExpressionAttributeValues: { ":qty": 3 },
        },
      },
      {
        Update: {
          TableName: "stock-table",
          Key: { tenantId: TENANT_ID, stockKey: "prod_002#warehouse_main" }, // back where it came from, not the pickup store
          ExpressionAttributeValues: { ":qty": 1 },
        },
      },
      {
        Update: {
          TableName: "orders-table",
          Key: { tenantId: TENANT_ID, orderId: "order_1" },
          ConditionExpression: "#status IN (:reserved, :ready) AND holdExpiresAt <= :now",
          ExpressionAttributeValues: { ":expired": "EXPIRED", ":now": "2026-11-01T00:10:05.000Z" },
        },
      },
    ]);
    expect(logLines()).toContainEqual(
      expect.objectContaining({ message: "hold expiry processed", outcome: "EXPIRED", orderId: "order_1" }),
    );
  });

  it("also expires an order that was ready at the counter but never collected", async () => {
    givenOrder({ ...heldOrder, status: "READY_FOR_PICKUP" });

    expect(await expire()).toEqual({ outcome: "EXPIRED" });
  });

  it.each([["FULFILLED"], ["EXPIRED"], ["FAILED"], ["PENDING"]])(
    "leaves a %s order and its stock alone",
    async (status) => {
      givenOrder({ ...heldOrder, status });

      expect(await expire()).toEqual({ outcome: "ALREADY_SETTLED" });
      expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
    },
  );

  it("never expires a shipment, which has no hold", async () => {
    givenOrder({ ...heldOrder, fulfillment: { type: "SHIP" } });

    expect(await expire()).toEqual({ outcome: "ALREADY_SETTLED" });
  });

  it("does nothing if invoked before the hold lapses", async () => {
    givenOrder({ ...heldOrder, holdExpiresAt: "2026-11-01T00:30:00.000Z" });

    expect(await expire()).toEqual({ outcome: "NOT_DUE" });
    expect(ddb).not.toHaveReceivedCommand(TransactWriteCommand);
  });

  it("treats an order collected between the read and the write as settled, so stock isn't returned twice", async () => {
    givenOrder(heldOrder);
    ddb.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        message: "Transaction cancelled",
        $metadata: {},
        CancellationReasons: [{ Code: "None" }, { Code: "None" }, { Code: "ConditionalCheckFailed" }],
      }),
    );

    expect(await expire()).toEqual({ outcome: "ALREADY_SETTLED" });
  });

  it("throws on a transient failure, so Scheduler retries", async () => {
    givenOrder(heldOrder);
    ddb.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        message: "Transaction cancelled",
        $metadata: {},
        CancellationReasons: [{ Code: "TransactionConflict" }, { Code: "None" }, { Code: "None" }],
      }),
    );

    await expect(expire()).rejects.toThrow(TransactionCanceledException);
  });

  it("reports an order that doesn't exist instead of retrying forever", async () => {
    givenOrder(undefined);

    expect(await expire()).toEqual({ outcome: "ORDER_NOT_FOUND" });
  });

  it("rejects an event that doesn't name an order", async () => {
    await expect(handler({} as never, context)).rejects.toThrow("tenantId and orderId");
  });
});
