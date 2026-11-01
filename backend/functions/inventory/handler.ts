import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import { docClient } from "../../shared/dynamodb";
import { Order, OrderCreatedDetail } from "../../shared/types";

const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;
const PRODUCTS_TABLE_NAME = process.env.PRODUCTS_TABLE_NAME;

type Outcome = "COMPLETED" | "FAILED_INSUFFICIENT_INVENTORY" | "ALREADY_PROCESSED";

// Partial batch response: only the records listed here go back to the queue for retry
// (and eventually the DLQ). Every other record in the batch is deleted as done.
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  if (!ORDERS_TABLE_NAME || !PRODUCTS_TABLE_NAME) {
    // Throwing fails the whole batch, so nothing is lost while the config is broken
    throw new Error("ORDERS_TABLE_NAME or PRODUCTS_TABLE_NAME environment variable is not set");
  }

  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const orderId = parseOrderId(record);
      const outcome = await processOrder(orderId);
      console.log(JSON.stringify({ message: "order processed", orderId, outcome }));
    } catch (err) {
      console.error(JSON.stringify({ message: "order processing failed", messageId: record.messageId, error: String(err) }));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

function parseOrderId(record: SQSRecord): string {
  // The SQS body is the whole EventBridge event; the Pipe's template output is its detail
  const event = JSON.parse(record.body) as { detail?: Partial<OrderCreatedDetail> };
  const orderId = event.detail?.orderId;
  if (typeof orderId !== "string" || orderId === "") {
    throw new Error("Message is not an OrderCreated event with a detail.orderId");
  }
  return orderId;
}

async function processOrder(orderId: string): Promise<Outcome> {
  const result = await docClient.send(
    new GetCommand({ TableName: ORDERS_TABLE_NAME, Key: { orderId } }),
  );
  const order = result.Item as Order | undefined;

  if (!order) {
    // The event only exists because the order was written, so this is unexpected -
    // fail the record and let retries/DLQ surface it rather than silently dropping it.
    throw new Error(`Order ${orderId} not found`);
  }

  // SQS is at-least-once: a redelivered message for a finished order is a no-op success
  if (order.status !== "PENDING") {
    return "ALREADY_PROCESSED";
  }

  try {
    await reserveInventoryAndComplete(order);
    return "COMPLETED";
  } catch (err) {
    if (!(err instanceof TransactionCanceledException)) throw err;

    const reasons = err.CancellationReasons ?? [];
    const orderReason = reasons[reasons.length - 1]; // order update is the last transaction item
    const productReasons = reasons.slice(0, -1);

    if (orderReason?.Code === "ConditionalCheckFailed") {
      // Another delivery of this same message completed the order first
      return "ALREADY_PROCESSED";
    }
    if (productReasons.some((reason) => reason.Code === "ConditionalCheckFailed")) {
      await markFailed(order.orderId, "Insufficient inventory for one or more items");
      return "FAILED_INSUFFICIENT_INVENTORY";
    }
    // Throttling, TransactionConflict, etc. are transient - rethrow so the message is retried
    throw err;
  }
}

// One all-or-nothing transaction: decrement every product (only if enough stock) AND move the
// order PENDING -> COMPLETE (only if still PENDING). No partial stock reservation is possible,
// and the status condition makes a duplicate delivery unable to decrement stock twice.
async function reserveInventoryAndComplete(order: Order): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        ...order.items.map((item) => ({
          Update: {
            TableName: PRODUCTS_TABLE_NAME,
            Key: { productId: item.productId },
            UpdateExpression: "SET inventory = inventory - :qty",
            ConditionExpression: "attribute_exists(productId) AND inventory >= :qty",
            ExpressionAttributeValues: { ":qty": item.quantity },
          },
        })),
        {
          Update: {
            TableName: ORDERS_TABLE_NAME,
            Key: { orderId: order.orderId },
            UpdateExpression: "SET #status = :complete, updatedAt = :now",
            ConditionExpression: "#status = :pending",
            // "status" is a DynamoDB reserved word, so it must be aliased
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":complete": "COMPLETE", ":pending": "PENDING", ":now": now },
          },
        },
      ],
    }),
  );
}

async function markFailed(orderId: string, reason: string): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: ORDERS_TABLE_NAME,
        Key: { orderId },
        UpdateExpression: "SET #status = :failed, failureReason = :reason, updatedAt = :now",
        ConditionExpression: "#status = :pending",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":failed": "FAILED",
          ":pending": "PENDING",
          ":reason": reason,
          ":now": new Date().toISOString(),
        },
      }),
    );
  } catch (err) {
    // Already moved out of PENDING by a concurrent delivery - nothing left to do
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}
