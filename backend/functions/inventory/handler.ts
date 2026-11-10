import { Context, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import { ConflictException, CreateScheduleCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { docClient, queryAll } from "../../shared/dynamodb";
import { keys } from "../../shared/keys";
import { createLogger } from "../../shared/logger";
import { Location, Order, OrderCreatedDetail, OrderLineItem, StockItem } from "../../shared/types";

const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;
const STOCK_TABLE_NAME = process.env.STOCK_TABLE_NAME;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME;
const HOLD_MINUTES = Number(process.env.HOLD_MINUTES);
const HOLD_SCHEDULE_GROUP = process.env.HOLD_SCHEDULE_GROUP;
const HOLD_EXPIRY_TARGET_ARN = process.env.HOLD_EXPIRY_TARGET_ARN;
const HOLD_SCHEDULER_ROLE_ARN = process.env.HOLD_SCHEDULER_ROLE_ARN;

// A stock condition can fail because another order took the stock between our read and our write.
// Each retry re-reads stock and re-allocates; past this, the message goes back to SQS.
const MAX_ALLOCATION_ATTEMPTS = 3;

// Scheduler can't fire in the past; a hold that lapsed while the order sat in the queue expires shortly after
const MIN_SCHEDULE_LEAD_MS = 60_000;

const scheduler = new SchedulerClient({});

type Outcome = "RESERVED" | "FAILED_INSUFFICIENT_STOCK" | "ALREADY_PROCESSED";

// Partial batch response: only the records listed here go back to the queue for retry
// (and eventually the DLQ). Every other record in the batch is deleted as done.
export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  const log = createLogger(context, { batchSize: event.Records.length });

  if (
    !ORDERS_TABLE_NAME ||
    !STOCK_TABLE_NAME ||
    !LOCATIONS_TABLE_NAME ||
    !(HOLD_MINUTES > 0) ||
    !HOLD_SCHEDULE_GROUP ||
    !HOLD_EXPIRY_TARGET_ARN ||
    !HOLD_SCHEDULER_ROLE_ARN
  ) {
    // Throwing fails the whole batch, so nothing is lost while the config is broken
    throw new Error("A table name or HOLD_* environment variable is not set");
  }

  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    let recordLog = log.child({ messageId: record.messageId });
    try {
      const { tenantId, orderId } = parseOrderRef(record);
      recordLog = recordLog.child({ tenantId, orderId });
      const outcome = await processOrder(tenantId, orderId);
      recordLog.info("order processed", { outcome });
    } catch (err) {
      recordLog.error("order processing failed", { error: err });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

// The tenant comes from the event, which the Pipe built from the order's own stream record -
// trusted data, unlike a request header, so there's no tenant lookup here
function parseOrderRef(record: SQSRecord): { tenantId: string; orderId: string } {
  // The SQS body is the whole EventBridge event; the Pipe's template output is its detail
  const event = JSON.parse(record.body) as { detail?: Partial<OrderCreatedDetail> };
  const tenantId = event.detail?.tenantId;
  const orderId = event.detail?.orderId;
  if (typeof tenantId !== "string" || tenantId === "" || typeof orderId !== "string" || orderId === "") {
    throw new Error("Message is not an OrderCreated event with a detail.tenantId and detail.orderId");
  }
  return { tenantId, orderId };
}

async function processOrder(tenantId: string, orderId: string): Promise<Outcome> {
  const result = await docClient.send(
    new GetCommand({ TableName: ORDERS_TABLE_NAME, Key: keys.order(tenantId, orderId) }),
  );
  const order = result.Item as Order | undefined;

  if (!order) {
    // The event only exists because the order was written, so this is unexpected -
    // fail the record and let retries/DLQ surface it rather than silently dropping it.
    throw new Error(`Order ${orderId} not found`);
  }

  // SQS is at-least-once: a redelivered message for a settled order is a no-op success
  if (order.status !== "PENDING") {
    return "ALREADY_PROCESSED";
  }

  const preference = sourcePreference(order, await loadLocations(tenantId));
  // Derived from createdAt, so every retry computes the same deadline as the schedule already made
  const holdExpiresAt =
    order.fulfillment.type === "PICKUP"
      ? new Date(Date.parse(order.createdAt) + HOLD_MINUTES * 60_000).toISOString()
      : undefined;

  for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt++) {
    const allocated = allocate(order, await loadStock(order), preference);
    if (!allocated) {
      await markFailed(order, "Not enough stock at any one location for one or more items");
      return "FAILED_INSUFFICIENT_STOCK";
    }

    // The expiry is scheduled before the stock is reserved, never after: if the transaction then
    // fails, the expiry finds no RESERVED order and does nothing, but a reservation can never
    // exist without its expiry. Scheduling is idempotent, so retries don't create a second one.
    if (holdExpiresAt) await scheduleHoldExpiry(order, holdExpiresAt);

    try {
      await reserveStock(order, allocated, holdExpiresAt);
      return "RESERVED";
    } catch (err) {
      if (!(err instanceof TransactionCanceledException)) throw err;

      const reasons = err.CancellationReasons ?? [];
      const orderReason = reasons[reasons.length - 1]; // the order update is the last transaction item
      const stockReasons = reasons.slice(0, -1);

      if (orderReason?.Code === "ConditionalCheckFailed") {
        // Another delivery of this same message settled the order first
        return "ALREADY_PROCESSED";
      }
      if (!stockReasons.some((reason) => reason.Code === "ConditionalCheckFailed")) {
        // Throttling, TransactionConflict, etc. are transient - rethrow so the message is retried
        throw err;
      }
      // Stock changed since it was read: read it again and re-allocate
    }
  }

  throw new Error(`Stock kept changing while allocating order ${orderId}; leaving it for an SQS retry`);
}

async function loadLocations(tenantId: string): Promise<Location[]> {
  return queryAll<Location>({
    TableName: LOCATIONS_TABLE_NAME,
    KeyConditionExpression: "tenantId = :tenantId",
    ExpressionAttributeValues: { ":tenantId": tenantId },
  });
}

// Where each line may come from, best first:
// - PICKUP at a store: that store's own shelf, then the warehouse, then another store (a transfer)
// - SHIP: the warehouse first, so store shelves stay stocked for walk-in and pickup customers, then the stores
// Within each type, a stable order by location ID.
function sourcePreference(order: Order, locations: Location[]): string[] {
  const byId = (a: Location, b: Location) => a.locationId.localeCompare(b.locationId);
  const warehouses = locations.filter((l) => l.type === "WAREHOUSE").sort(byId);
  const stores = locations.filter((l) => l.type === "STORE").sort(byId);
  const ids = (list: Location[]) => list.map((l) => l.locationId);

  if (order.fulfillment.type === "SHIP") return [...ids(warehouses), ...ids(stores)];

  const pickupAt = order.fulfillment.locationId;
  return [pickupAt, ...ids(warehouses), ...ids(stores).filter((id) => id !== pickupAt)];
}

// Quantity per product per location, for just the products on this order: one Query per line,
// each on that product's stock rows
async function loadStock(order: Order): Promise<Map<string, Map<string, number>>> {
  const perLine = await Promise.all(
    order.items.map((item) =>
      queryAll<StockItem>({
        TableName: STOCK_TABLE_NAME,
        KeyConditionExpression: "tenantId = :tenantId AND begins_with(stockKey, :prefix)",
        ExpressionAttributeValues: { ":tenantId": order.tenantId, ":prefix": keys.stockPrefix(item.productId) },
      }),
    ),
  );

  const stock = new Map<string, Map<string, number>>();
  order.items.forEach((item, index) => {
    stock.set(item.productId, new Map(perLine[index].map((row) => [row.locationId, row.quantity])));
  });
  return stock;
}

// Each line is filled from one location (never split), the first in preference order that holds
// the whole quantity. Null if any line can't be filled that way - the order then fails as a whole.
function allocate(
  order: Order,
  stock: Map<string, Map<string, number>>,
  preference: string[],
): OrderLineItem[] | null {
  const pickupAt = order.fulfillment.type === "PICKUP" ? order.fulfillment.locationId : undefined;
  const allocated: OrderLineItem[] = [];

  for (const item of order.items) {
    const atLocation = stock.get(item.productId);
    const source = preference.find((locationId) => (atLocation?.get(locationId) ?? 0) >= item.quantity);
    if (!source) return null;
    allocated.push({
      ...item,
      sourceLocationId: source,
      ...(pickupAt && { needsTransfer: source !== pickupAt }),
    });
  }
  return allocated;
}

// One-time schedule that runs the expiry Lambda when the hold lapses, then deletes itself.
// Named after the order, so a second attempt to create it fails with ConflictException.
async function scheduleHoldExpiry(order: Order, holdExpiresAt: string): Promise<void> {
  const fireAt = new Date(Math.max(Date.parse(holdExpiresAt), Date.now() + MIN_SCHEDULE_LEAD_MS));
  try {
    await scheduler.send(
      new CreateScheduleCommand({
        Name: `hold-${order.orderId}`,
        GroupName: HOLD_SCHEDULE_GROUP,
        ScheduleExpression: `at(${fireAt.toISOString().slice(0, 19)})`, // at() takes no milliseconds or zone
        ScheduleExpressionTimezone: "UTC",
        FlexibleTimeWindow: { Mode: "OFF" },
        ActionAfterCompletion: "DELETE",
        Target: {
          Arn: HOLD_EXPIRY_TARGET_ARN,
          RoleArn: HOLD_SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({ tenantId: order.tenantId, orderId: order.orderId }),
        },
      }),
    );
  } catch (err) {
    if (!(err instanceof ConflictException)) throw err; // already scheduled by an earlier attempt
  }
}

// One all-or-nothing transaction: decrement each line's stock at its allocated location (only if
// enough is still there) AND move the order PENDING -> RESERVED (only if still PENDING), recording
// where each line came from and, for a pickup, when the hold lapses. The status condition stops a
// duplicate delivery decrementing twice.
async function reserveStock(order: Order, allocated: OrderLineItem[], holdExpiresAt?: string): Promise<void> {
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        ...allocated.map((item) => ({
          Update: {
            TableName: STOCK_TABLE_NAME,
            Key: keys.stock(order.tenantId, item.productId, item.sourceLocationId!),
            UpdateExpression: "SET quantity = quantity - :qty",
            ConditionExpression: "quantity >= :qty", // also false when the stock row doesn't exist
            ExpressionAttributeValues: { ":qty": item.quantity },
          },
        })),
        {
          Update: {
            TableName: ORDERS_TABLE_NAME,
            Key: keys.order(order.tenantId, order.orderId),
            UpdateExpression: `SET #status = :reserved, #items = :items, updatedAt = :now${
              holdExpiresAt ? ", holdExpiresAt = :holdExpiresAt" : ""
            }`,
            ConditionExpression: "#status = :pending",
            // "status" and "items" are DynamoDB reserved words, so they must be aliased
            ExpressionAttributeNames: { "#status": "status", "#items": "items" },
            ExpressionAttributeValues: {
              ":reserved": "RESERVED",
              ":pending": "PENDING",
              ":items": allocated,
              ":now": new Date().toISOString(),
              ...(holdExpiresAt && { ":holdExpiresAt": holdExpiresAt }),
            },
          },
        },
      ],
    }),
  );
}

async function markFailed(order: Order, reason: string): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: ORDERS_TABLE_NAME,
        Key: keys.order(order.tenantId, order.orderId),
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
