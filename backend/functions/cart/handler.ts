import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { docClient } from "../../shared/dynamodb";
import { errorResponse, jsonResponse } from "../../shared/responses";
import { getUserId } from "../../shared/auth";
import { keys } from "../../shared/keys";
import { createLogger } from "../../shared/logger";
import { parseJsonBody } from "../../shared/request";
import { resolveTenant } from "../../shared/tenant";
import { Cart } from "../../shared/types";

const CARTS_TABLE_NAME = process.env.CARTS_TABLE_NAME;
const PRODUCTS_TABLE_NAME = process.env.PRODUCTS_TABLE_NAME;
const TENANTS_TABLE_NAME = process.env.TENANTS_TABLE_NAME;

const MAX_QUANTITY_PER_ADD = 99;

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  let log = createLogger(context, { route: event.routeKey });

  if (!CARTS_TABLE_NAME || !PRODUCTS_TABLE_NAME || !TENANTS_TABLE_NAME) {
    log.error("One or more required table environment variables are not set");
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

    // 3 routes across 2 methods, so branch on the matched route rather than pathParameters
    switch (event.routeKey) {
      case "GET /cart":
        return await getCart(tenantId, userId);
      case "POST /cart/items":
        return await addItem(tenantId, userId, event);
      case "DELETE /cart/items/{id}": {
        const productId = event.pathParameters?.id;
        if (!productId) {
          return errorResponse(400, "INVALID_REQUEST", "Missing product id in path");
        }
        return await removeItem(tenantId, userId, productId);
      }
      default:
        return errorResponse(404, "ROUTE_NOT_FOUND", `No handler for ${event.routeKey}`);
    }
  } catch (err) {
    // Raised by saveCart when another request changed the cart between our read and write
    if (err instanceof ConditionalCheckFailedException) {
      log.warn("cart write conflict");
      return errorResponse(409, "CART_CONFLICT", "Cart was modified by another request; retry");
    }
    log.error("cart handler failed", { error: err });
    return errorResponse(500, "INTERNAL_ERROR", "Something went wrong while processing the request");
  }
}

async function getCart(tenantId: string, userId: string): Promise<APIGatewayProxyResultV2> {
  return jsonResponse(200, await loadCart(tenantId, userId));
}

async function addItem(
  tenantId: string,
  userId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  let body: unknown;
  try {
    body = parseJsonBody(event);
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON");
  }

  const input = validateAddItemBody(body);
  if (!input) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      `Body must be { productId: string, quantity: integer 1-${MAX_QUANTITY_PER_ADD} }`,
    );
  }

  const product = await docClient.send(
    new GetCommand({ TableName: PRODUCTS_TABLE_NAME, Key: keys.product(tenantId, input.productId) }),
  );
  if (!product.Item) {
    return errorResponse(404, "PRODUCT_NOT_FOUND", `Product ${input.productId} does not exist`);
  }

  const cart = await loadCart(tenantId, userId);
  const previousUpdatedAt = cart.updatedAt;

  const existing = cart.items.find((item) => item.productId === input.productId);
  if (existing) {
    existing.quantity += input.quantity;
  } else {
    cart.items.push({ productId: input.productId, quantity: input.quantity });
  }

  cart.updatedAt = new Date().toISOString();
  await saveCart(cart, previousUpdatedAt);

  return jsonResponse(200, cart);
}

async function removeItem(tenantId: string, userId: string, productId: string): Promise<APIGatewayProxyResultV2> {
  const cart = await loadCart(tenantId, userId);
  const previousUpdatedAt = cart.updatedAt;

  const remaining = cart.items.filter((item) => item.productId !== productId);

  // Idempotent: removing an item that isn't there is a no-op success, and skips the write
  if (remaining.length === cart.items.length) {
    return jsonResponse(200, cart);
  }

  cart.items = remaining;
  cart.updatedAt = new Date().toISOString();
  await saveCart(cart, previousUpdatedAt);

  return jsonResponse(200, cart);
}

function validateAddItemBody(body: unknown): { productId: string; quantity: number } | null {
  if (typeof body !== "object" || body === null) return null;

  const { productId, quantity } = body as Record<string, unknown>;

  if (typeof productId !== "string" || productId.trim() === "") return null;
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_QUANTITY_PER_ADD
  ) {
    return null;
  }

  return { productId, quantity };
}

async function loadCart(tenantId: string, userId: string): Promise<Cart> {
  const result = await docClient.send(
    new GetCommand({ TableName: CARTS_TABLE_NAME, Key: keys.cart(tenantId, userId) }),
  );
  return (result.Item as Cart | undefined) ?? { tenantId, userId, items: [] };
}

// Optimistic concurrency: only write if the cart is still exactly as we read it
async function saveCart(cart: Cart, previousUpdatedAt: string | undefined): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: CARTS_TABLE_NAME,
      Item: cart,
      ...(previousUpdatedAt
        ? {
            ConditionExpression: "updatedAt = :previousUpdatedAt",
            // only defined when referenced - DynamoDB rejects unused expression values
            ExpressionAttributeValues: { ":previousUpdatedAt": previousUpdatedAt },
          }
        : { ConditionExpression: "attribute_not_exists(userId)" }),
    }),
  );
}
