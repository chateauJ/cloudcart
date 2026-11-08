import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../shared/dynamodb";
import { keys } from "../../shared/keys";
import { errorResponse, jsonResponse } from "../../shared/responses";
import { createLogger } from "../../shared/logger";
import { resolveTenant } from "../../shared/tenant";
import { Product, Tenant } from "../../shared/types";

const TABLE_NAME = process.env.PRODUCTS_TABLE_NAME;
const TENANTS_TABLE_NAME = process.env.TENANTS_TABLE_NAME;

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  let log = createLogger(context, { route: event.routeKey });

  if (!TABLE_NAME || !TENANTS_TABLE_NAME) {
    log.error("PRODUCTS_TABLE_NAME or TENANTS_TABLE_NAME environment variable is not set");
    return errorResponse(500, "CONFIGURATION_ERROR", "Server is misconfigured");
  }

  try {
    const resolved = await resolveTenant(event, TENANTS_TABLE_NAME);
    if (!resolved.ok) return resolved.response;
    const { tenant } = resolved;
    log = log.child({ tenantId: tenant.tenantId });

    switch (event.routeKey) {
      case "GET /tenant":
        return jsonResponse(200, publicTenant(tenant));
      case "GET /products":
        return await listProducts(TABLE_NAME, tenant.tenantId);
      case "GET /products/{id}": {
        const productId = event.pathParameters?.id;
        if (!productId) {
          return errorResponse(400, "INVALID_REQUEST", "Missing product id in path");
        }
        return await getProduct(TABLE_NAME, tenant.tenantId, productId);
      }
      default:
        return errorResponse(404, "ROUTE_NOT_FOUND", `No handler for ${event.routeKey}`);
    }
  } catch (err) {
    log.error("products handler failed", { error: err });
    return errorResponse(500, "INTERNAL_ERROR", "Something went wrong while processing the request");
  }
}

function publicTenant({ tenantId, name, tagline }: Tenant) {
  return { tenantId, name, tagline };
}

// A Query on the tenant's partition, not a Scan of the table: cost grows with one store's
// catalog, never with every store's. Pages through in case a catalog passes Query's 1 MB page.
async function listProducts(tableName: string, tenantId: string): Promise<APIGatewayProxyResultV2> {
  const products: Product[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "tenantId = :tenantId",
        ExpressionAttributeValues: { ":tenantId": tenantId },
        ExclusiveStartKey: startKey,
      }),
    );
    products.push(...((page.Items ?? []) as Product[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  return jsonResponse(200, products);
}

async function getProduct(tableName: string, tenantId: string, productId: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(
    new GetCommand({ TableName: tableName, Key: keys.product(tenantId, productId) }),
  );

  if (!result.Item) {
    return errorResponse(404, "PRODUCT_NOT_FOUND", `Product ${productId} does not exist`);
  }

  return jsonResponse(200, result.Item);
}
