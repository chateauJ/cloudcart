import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { docClient, queryAll } from "../../shared/dynamodb";
import { getUserId, isStaffOf } from "../../shared/auth";
import { keys } from "../../shared/keys";
import { createLogger, Logger } from "../../shared/logger";
import { errorResponse, jsonResponse } from "../../shared/responses";
import { resolveTenant } from "../../shared/tenant";
import { Location, Order, OrderStatus } from "../../shared/types";

const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;
const ORDERS_QUEUE_INDEX_NAME = process.env.ORDERS_QUEUE_INDEX_NAME;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME;
const TENANTS_TABLE_NAME = process.env.TENANTS_TABLE_NAME;

const SHIP_QUEUE = "SHIP";
const STATUSES: OrderStatus[] = ["PENDING", "RESERVED", "READY_FOR_PICKUP", "FULFILLED", "EXPIRED", "FAILED"];

// What each queue shows by default: the orders staff still have to act on
const ACTIVE: Record<"PICKUP" | "SHIP", OrderStatus[]> = {
  PICKUP: ["RESERVED", "READY_FOR_PICKUP"],
  SHIP: ["RESERVED"],
};

// Staff routes for one business's counter and back room. Only members of staff-<tenantId> may
// use them, and everyone else - including staff of another business - gets the same 404 as a
// route that doesn't exist, so the staff API can't be discovered. (The API never answers 403:
// CloudFront maps 403 to the storefront's 404 page.)
export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  let log = createLogger(context, { route: event.routeKey });

  if (!ORDERS_TABLE_NAME || !ORDERS_QUEUE_INDEX_NAME || !LOCATIONS_TABLE_NAME || !TENANTS_TABLE_NAME) {
    log.error("One or more required table/index environment variables are not set");
    return errorResponse(500, "CONFIGURATION_ERROR", "Server is misconfigured");
  }

  const userId = getUserId(event);
  if (!userId) {
    return errorResponse(401, "UNAUTHORIZED", "Missing or invalid authentication");
  }
  log = log.child({ userId });

  try {
    const resolved = await resolveTenant(event, TENANTS_TABLE_NAME);
    if (!resolved.ok) return resolved.response;
    const tenantId = resolved.tenant.tenantId;
    log = log.child({ tenantId });

    if (!isStaffOf(event, tenantId)) {
      log.warn("staff route refused", { reason: "not staff of this tenant" });
      return errorResponse(404, "ROUTE_NOT_FOUND", `No handler for ${event.routeKey}`);
    }

    switch (event.routeKey) {
      case "GET /staff/orders":
        return await listQueue(event, tenantId);
      case "POST /staff/orders/{id}/ready":
        return await transition(event, tenantId, userId, "ready", log);
      case "POST /staff/orders/{id}/fulfill":
        return await transition(event, tenantId, userId, "fulfill", log);
      default:
        return errorResponse(404, "ROUTE_NOT_FOUND", `No handler for ${event.routeKey}`);
    }
  } catch (err) {
    log.error("staff handler failed", { error: err });
    return errorResponse(500, "INTERNAL_ERROR", "Something went wrong while processing the request");
  }
}

// GET /staff/orders?queue=<store locationId | SHIP>&status=<comma-separated statuses>
// Oldest first: the order staff work through a queue
async function listQueue(event: APIGatewayProxyEventV2, tenantId: string): Promise<APIGatewayProxyResultV2> {
  const queue = event.queryStringParameters?.queue ?? "";
  const kind = queue === SHIP_QUEUE ? "SHIP" : "PICKUP";

  if (kind === "PICKUP") {
    const location = await docClient.send(
      new GetCommand({ TableName: LOCATIONS_TABLE_NAME, Key: keys.location(tenantId, queue || "-") }),
    );
    if (!(location.Item as Location | undefined)?.pickupEnabled) {
      return errorResponse(400, "INVALID_QUEUE", `queue must be ${SHIP_QUEUE} or one of your stores' location IDs`);
    }
  }

  const requested = event.queryStringParameters?.status;
  const statuses = requested ? requested.split(",") : ACTIVE[kind];
  if (statuses.some((status) => !STATUSES.includes(status as OrderStatus))) {
    return errorResponse(400, "INVALID_STATUS", `status must be a comma-separated list of ${STATUSES.join(", ")}`);
  }

  const queueKey = keys.tenantQueue(tenantId, kind === "SHIP" ? { type: "SHIP" } : { type: "PICKUP", locationId: queue });
  const orders = await queryAll<Order>({
    TableName: ORDERS_TABLE_NAME,
    IndexName: ORDERS_QUEUE_INDEX_NAME,
    KeyConditionExpression: "tenantQueue = :queue",
    FilterExpression: `#status IN (${statuses.map((_, i) => `:s${i}`).join(", ")})`,
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":queue": queueKey,
      ...Object.fromEntries(statuses.map((status, i) => [`:s${i}`, status])),
    },
    ScanIndexForward: true,
  });

  return jsonResponse(200, orders.map(publicOrder));
}

// The two moves staff make, each a single conditional update, so two people pressing the button
// at once can't both succeed and a stale screen can't skip a step:
//   ready:   a PICKUP order, RESERVED -> READY_FOR_PICKUP (the stock is on the counter)
//   fulfill: a PICKUP order READY_FOR_PICKUP, or a SHIP order RESERVED -> FULFILLED
// DynamoDB rejects expression values an expression doesn't use, so each move lists its own.
const TRANSITIONS = {
  ready: {
    condition: "fulfillment.#type = :pickup AND #status = :reserved",
    set: "#status = :ready, readyAt = :now, readyBy = :staff, updatedAt = :now",
    values: { ":pickup": "PICKUP", ":reserved": "RESERVED", ":ready": "READY_FOR_PICKUP" },
    allowed: "a pickup order that is RESERVED",
  },
  fulfill: {
    condition: "(fulfillment.#type = :pickup AND #status = :ready) OR (fulfillment.#type = :ship AND #status = :reserved)",
    set: "#status = :fulfilled, fulfilledAt = :now, fulfilledBy = :staff, updatedAt = :now",
    values: {
      ":pickup": "PICKUP",
      ":ready": "READY_FOR_PICKUP",
      ":ship": "SHIP",
      ":reserved": "RESERVED",
      ":fulfilled": "FULFILLED",
    },
    allowed: "a pickup order that is READY_FOR_PICKUP or a shipping order that is RESERVED",
  },
} as const;

async function transition(
  event: APIGatewayProxyEventV2,
  tenantId: string,
  staffUserId: string,
  action: keyof typeof TRANSITIONS,
  log: Logger,
): Promise<APIGatewayProxyResultV2> {
  const orderId = event.pathParameters?.id;
  if (!orderId) {
    return errorResponse(400, "INVALID_REQUEST", "Missing order id in path");
  }
  const { condition, set, values, allowed } = TRANSITIONS[action];

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: ORDERS_TABLE_NAME,
        Key: keys.order(tenantId, orderId),
        UpdateExpression: `SET ${set}`,
        ConditionExpression: `attribute_exists(orderId) AND (${condition})`,
        ExpressionAttributeNames: { "#status": "status", "#type": "type" },
        ExpressionAttributeValues: { ...values, ":staff": staffUserId, ":now": new Date().toISOString() },
        ReturnValues: "ALL_NEW",
        ReturnValuesOnConditionCheckFailure: "ALL_OLD", // tells "no such order" apart from "wrong status"
      }),
    );
    const order = result.Attributes as Order;
    log.info("order moved by staff", { orderId, action, status: order.status });
    return jsonResponse(200, publicOrder(order));
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    // The old item comes back in DynamoDB's attribute-value form, e.g. { status: { S: "FULFILLED" } }
    const current = err.Item as Record<string, { S?: string }> | undefined;
    if (!current) {
      return errorResponse(404, "ORDER_NOT_FOUND", `Order ${orderId} does not exist`);
    }
    return errorResponse(
      409,
      "INVALID_TRANSITION",
      `Can't ${action} this order: it is ${current.status?.S ?? "in another state"}, and only ${allowed} can be`,
    );
  }
}

// tenantUser and tenantQueue only exist to key indexes - they aren't part of the API's order shape
function publicOrder({ tenantUser: _userIndexKey, tenantQueue: _queueIndexKey, ...order }: Order) {
  return order;
}
