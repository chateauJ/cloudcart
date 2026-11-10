import { Context } from "aws-lambda";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { docClient } from "../../shared/dynamodb";
import { keys } from "../../shared/keys";
import { createLogger } from "../../shared/logger";
import { Order } from "../../shared/types";

const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;
const STOCK_TABLE_NAME = process.env.STOCK_TABLE_NAME;

// The Input of the one-time schedule the inventory Lambda creates for each pickup hold
export interface HoldExpiredEvent {
  tenantId: string;
  orderId: string;
}

type Outcome = "EXPIRED" | "ALREADY_SETTLED" | "NOT_DUE" | "ORDER_NOT_FOUND";

// Holds that can still lapse: reserved, or waiting at the counter but never collected
const HELD_STATUSES = ["RESERVED", "READY_FOR_PICKUP"];

// Invoked by EventBridge Scheduler when a pickup hold lapses: returns each line's stock to the
// location it was taken from and marks the order EXPIRED. Throwing makes Scheduler retry.
export async function handler(event: HoldExpiredEvent, context: Context): Promise<{ outcome: Outcome }> {
  let log = createLogger(context);

  if (!ORDERS_TABLE_NAME || !STOCK_TABLE_NAME) {
    throw new Error("ORDERS_TABLE_NAME or STOCK_TABLE_NAME environment variable is not set");
  }
  if (typeof event?.tenantId !== "string" || typeof event?.orderId !== "string") {
    throw new Error("Event is not a hold expiry with a tenantId and orderId");
  }
  log = log.child({ tenantId: event.tenantId, orderId: event.orderId });

  const outcome = await expireHold(event.tenantId, event.orderId);
  log.info("hold expiry processed", { outcome });
  return { outcome };
}

async function expireHold(tenantId: string, orderId: string): Promise<Outcome> {
  const result = await docClient.send(
    new GetCommand({ TableName: ORDERS_TABLE_NAME, Key: keys.order(tenantId, orderId) }),
  );
  const order = result.Item as Order | undefined;

  // Retrying can't make a missing order appear, so report it rather than throw
  if (!order) return "ORDER_NOT_FOUND";

  // Picked up, already expired, or never reserved (its allocation failed after the schedule was made)
  if (order.fulfillment?.type !== "PICKUP" || !HELD_STATUSES.includes(order.status)) {
    return "ALREADY_SETTLED";
  }

  const now = new Date().toISOString();
  // A stray early invocation must never cut a customer's hold short
  if (!order.holdExpiresAt || order.holdExpiresAt > now) return "NOT_DUE";

  try {
    await returnStockAndExpire(order, now);
    return "EXPIRED";
  } catch (err) {
    if (!(err instanceof TransactionCanceledException)) throw err;
    const orderReason = err.CancellationReasons?.[err.CancellationReasons.length - 1];
    // Staff fulfilled it, or a duplicate invocation expired it, between our read and write
    if (orderReason?.Code === "ConditionalCheckFailed") return "ALREADY_SETTLED";
    throw err;
  }
}

// One transaction: every line's stock goes back to its source location AND the order moves to
// EXPIRED, only if it's still held. The status condition is what makes a duplicate invocation
// unable to restock twice.
async function returnStockAndExpire(order: Order, now: string): Promise<void> {
  const allocatedLines = order.items.filter((item) => item.sourceLocationId);

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        ...allocatedLines.map((item) => ({
          Update: {
            TableName: STOCK_TABLE_NAME,
            Key: keys.stock(order.tenantId, item.productId, item.sourceLocationId!),
            UpdateExpression: "ADD quantity :qty",
            ExpressionAttributeValues: { ":qty": item.quantity },
          },
        })),
        {
          Update: {
            TableName: ORDERS_TABLE_NAME,
            Key: keys.order(order.tenantId, order.orderId),
            UpdateExpression: "SET #status = :expired, updatedAt = :now",
            ConditionExpression: "#status IN (:reserved, :ready) AND holdExpiresAt <= :now",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":expired": "EXPIRED",
              ":reserved": "RESERVED",
              ":ready": "READY_FOR_PICKUP",
              ":now": now,
            },
          },
        },
      ],
    }),
  );
}
