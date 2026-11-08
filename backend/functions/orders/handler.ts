import { randomUUID } from "node:crypto";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { docClient } from "../../shared/dynamodb";
import { errorResponse, jsonResponse } from "../../shared/responses";
import { getUserId } from "../../shared/auth";
import { keys } from "../../shared/keys";
import { createLogger, Logger } from "../../shared/logger";
import { resolveTenant } from "../../shared/tenant";
import { Cart, Order, OrderLineItem, Product } from "../../shared/types";

const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;
const ORDERS_USER_INDEX_NAME = process.env.ORDERS_USER_INDEX_NAME;
const CARTS_TABLE_NAME = process.env.CARTS_TABLE_NAME;
const PRODUCTS_TABLE_NAME = process.env.PRODUCTS_TABLE_NAME;
const TENANTS_TABLE_NAME = process.env.TENANTS_TABLE_NAME;

// Inventory reserves every line plus the order status update in one transaction,
// and DynamoDB transactions cap at 100 items - so 99 lines, not BatchGetItem's 100.
const MAX_ORDER_LINES = 99;
const ORDER_HISTORY_LIMIT = 50;

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  let log = createLogger(context, { route: event.routeKey });

  if (
    !ORDERS_TABLE_NAME ||
    !ORDERS_USER_INDEX_NAME ||
    !CARTS_TABLE_NAME ||
    !PRODUCTS_TABLE_NAME ||
    !TENANTS_TABLE_NAME
  ) {
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
    const { tenant } = resolved;
    const tenantId = tenant.tenantId;
    log = log.child({ tenantId });

    switch (event.routeKey) {
      case "POST /orders":
        return await createOrder(tenantId, userId, log);
      case "GET /orders":
        return await listOrders(tenantId, userId);
      case "GET /orders/{id}": {
        const orderId = event.pathParameters?.id;
        if (!orderId) {
          return errorResponse(400, "INVALID_REQUEST", "Missing order id in path");
        }
        return await getOrder(tenantId, userId, orderId);
      }
      default:
        return errorResponse(404, "ROUTE_NOT_FOUND", `No handler for ${event.routeKey}`);
    }
  } catch (err) {
    // A failed condition inside a transaction surfaces as TransactionCanceledException,
    // not ConditionalCheckFailedException - here it means the cart changed mid-checkout.
    if (err instanceof TransactionCanceledException) {
      log.warn("checkout conflict", { reasons: err.CancellationReasons?.map((reason) => reason.Code) });
      return errorResponse(409, "CART_CONFLICT", "Cart changed during checkout; review it and retry");
    }
    log.error("orders handler failed", { error: err });
    return errorResponse(500, "INTERNAL_ERROR", "Something went wrong while processing the request");
  }
}

async function createOrder(tenantId: string, userId: string, log: Logger): Promise<APIGatewayProxyResultV2> {
  const cartResult = await docClient.send(
    new GetCommand({ TableName: CARTS_TABLE_NAME, Key: keys.cart(tenantId, userId) }),
  );
  const cart = cartResult.Item as Cart | undefined;

  if (!cart || cart.items.length === 0) {
    return errorResponse(400, "CART_EMPTY", "Cannot create an order from an empty cart");
  }
  if (cart.items.length > MAX_ORDER_LINES) {
    return errorResponse(400, "CART_TOO_LARGE", `A cart can contain at most ${MAX_ORDER_LINES} products`);
  }

  const products = await loadProducts(tenantId, cart.items.map((item) => item.productId));
  const missing = cart.items.filter((item) => !products.has(item.productId));
  if (missing.length > 0) {
    return errorResponse(
      400,
      "PRODUCT_NOT_FOUND",
      `No longer available: ${missing.map((item) => item.productId).join(", ")}`,
    );
  }

  const items: OrderLineItem[] = cart.items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: products.get(item.productId)!.price,
  }));

  const now = new Date().toISOString();
  const order: Order = {
    tenantId,
    orderId: `order_${randomUUID()}`,
    userId,
    tenantUser: keys.tenantUser(tenantId, userId),
    status: "PENDING", // inventory is reserved asynchronously (Milestone 4), not here
    total: calculateTotal(items),
    items,
    createdAt: now,
    updatedAt: now,
  };

  // All-or-nothing: the order is created AND the cart is cleared, or neither happens.
  // The cart condition rejects checkout if the cart was edited after we read it.
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: ORDERS_TABLE_NAME,
            Item: order,
            ConditionExpression: "attribute_not_exists(orderId)",
          },
        },
        {
          Delete: {
            TableName: CARTS_TABLE_NAME,
            Key: keys.cart(tenantId, userId),
            ConditionExpression: "updatedAt = :cartUpdatedAt",
            ExpressionAttributeValues: { ":cartUpdatedAt": cart.updatedAt },
          },
        },
      ],
    }),
  );

  log.info("order created", { orderId: order.orderId, total: order.total, lineCount: items.length });
  return jsonResponse(201, publicOrder(order));
}

async function listOrders(tenantId: string, userId: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ORDERS_TABLE_NAME,
      IndexName: ORDERS_USER_INDEX_NAME,
      KeyConditionExpression: "tenantUser = :tenantUser",
      ExpressionAttributeValues: { ":tenantUser": keys.tenantUser(tenantId, userId) },
      ScanIndexForward: false, // GSI sort key is createdAt, so descending = newest first
      Limit: ORDER_HISTORY_LIMIT,
    }),
  );
  return jsonResponse(200, ((result.Items ?? []) as Order[]).map(publicOrder));
}

async function getOrder(tenantId: string, userId: string, orderId: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(
    new GetCommand({ TableName: ORDERS_TABLE_NAME, Key: keys.order(tenantId, orderId) }),
  );
  const order = result.Item as Order | undefined;

  // Another user's order is reported as not found, so order IDs can't be probed for existence
  if (!order || order.userId !== userId) {
    return errorResponse(404, "ORDER_NOT_FOUND", `Order ${orderId} does not exist`);
  }

  return jsonResponse(200, publicOrder(order));
}

// tenantUser only exists to key the user index - it isn't part of the API's order shape
function publicOrder({ tenantUser: _indexKey, ...order }: Order): Omit<Order, "tenantUser"> {
  return order;
}

async function loadProducts(tenantId: string, productIds: string[]): Promise<Map<string, Product>> {
  const result = await docClient.send(
    new BatchGetCommand({
      RequestItems: {
        [PRODUCTS_TABLE_NAME!]: { Keys: productIds.map((productId) => keys.product(tenantId, productId)) },
      },
    }),
  );

  // DynamoDB may return part of a batch under load; treat that as a retryable server error
  // rather than silently pricing an order from incomplete data.
  if (Object.keys(result.UnprocessedKeys ?? {}).length > 0) {
    throw new Error("BatchGetItem returned unprocessed keys for products");
  }

  const items = (result.Responses?.[PRODUCTS_TABLE_NAME!] ?? []) as Product[];
  return new Map(items.map((product) => [product.productId, product]));
}

// Sum in integer cents - floating point dollars drift (0.1 + 0.2 !== 0.3).
function calculateTotal(items: OrderLineItem[]): number {
  const cents = items.reduce(
    (sum, item) => sum + Math.round(item.unitPrice * 100) * item.quantity,
    0,
  );
  return cents / 100;
}
