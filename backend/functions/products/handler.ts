import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, queryAll } from "../../shared/dynamodb";
import { keys } from "../../shared/keys";
import { errorResponse, jsonResponse } from "../../shared/responses";
import { createLogger } from "../../shared/logger";
import { resolveTenant } from "../../shared/tenant";
import { Location, Product, StockItem, StockLevel, Tenant } from "../../shared/types";

const TABLE_NAME = process.env.PRODUCTS_TABLE_NAME;
const TENANTS_TABLE_NAME = process.env.TENANTS_TABLE_NAME;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME;
const STOCK_TABLE_NAME = process.env.STOCK_TABLE_NAME;

interface Tables {
  products: string;
  locations: string;
  stock: string;
}

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  let log = createLogger(context, { route: event.routeKey });

  if (!TABLE_NAME || !TENANTS_TABLE_NAME || !LOCATIONS_TABLE_NAME || !STOCK_TABLE_NAME) {
    log.error("PRODUCTS_, TENANTS_, LOCATIONS_ or STOCK_TABLE_NAME environment variable is not set");
    return errorResponse(500, "CONFIGURATION_ERROR", "Server is misconfigured");
  }
  const tables: Tables = { products: TABLE_NAME, locations: LOCATIONS_TABLE_NAME, stock: STOCK_TABLE_NAME };

  try {
    const resolved = await resolveTenant(event, TENANTS_TABLE_NAME);
    if (!resolved.ok) return resolved.response;
    const { tenant } = resolved;
    log = log.child({ tenantId: tenant.tenantId });

    switch (event.routeKey) {
      case "GET /tenant":
        return jsonResponse(200, publicTenant(tenant));
      case "GET /locations":
        return await listLocations(tables, tenant.tenantId);
      case "GET /products":
        return await listProducts(tables, tenant.tenantId);
      case "GET /products/{id}": {
        const productId = event.pathParameters?.id;
        if (!productId) {
          return errorResponse(400, "INVALID_REQUEST", "Missing product id in path");
        }
        return await getProduct(tables, tenant.tenantId, productId);
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

async function listLocations(tables: Tables, tenantId: string): Promise<APIGatewayProxyResultV2> {
  const locations = await queryAll<Location>({
    TableName: tables.locations,
    KeyConditionExpression: "tenantId = :tenantId",
    ExpressionAttributeValues: { ":tenantId": tenantId },
  });

  return jsonResponse(
    200,
    locations.map(({ locationId, name, type, pickupEnabled }) => ({ locationId, name, type, pickupEnabled })),
  );
}

// Two Queries, each on the tenant's own partition, never a Scan: cost grows with one store's
// catalog, never with every store's. Stock for the whole catalog is one Query, joined here.
async function listProducts(tables: Tables, tenantId: string): Promise<APIGatewayProxyResultV2> {
  const byTenant = { KeyConditionExpression: "tenantId = :tenantId", ExpressionAttributeValues: { ":tenantId": tenantId } };
  const [products, stock] = await Promise.all([
    queryAll<Product>({ TableName: tables.products, ...byTenant }),
    queryAll<StockItem>({ TableName: tables.stock, ...byTenant }),
  ]);

  const stockByProduct = new Map<string, StockLevel[]>();
  for (const item of stock) {
    const levels = stockByProduct.get(item.productId) ?? [];
    levels.push(stockLevel(item));
    stockByProduct.set(item.productId, levels);
  }

  return jsonResponse(
    200,
    products.map((product) => publicProduct(product, stockByProduct.get(product.productId) ?? [])),
  );
}

async function getProduct(tables: Tables, tenantId: string, productId: string): Promise<APIGatewayProxyResultV2> {
  const [result, stock] = await Promise.all([
    docClient.send(new GetCommand({ TableName: tables.products, Key: keys.product(tenantId, productId) })),
    queryAll<StockItem>({
      TableName: tables.stock,
      KeyConditionExpression: "tenantId = :tenantId AND begins_with(stockKey, :prefix)",
      ExpressionAttributeValues: { ":tenantId": tenantId, ":prefix": keys.stockPrefix(productId) },
    }),
  ]);

  if (!result.Item) {
    return errorResponse(404, "PRODUCT_NOT_FOUND", `Product ${productId} does not exist`);
  }

  return jsonResponse(200, publicProduct(result.Item as Product, stock.map(stockLevel)));
}

function stockLevel({ locationId, quantity }: StockItem): StockLevel {
  return { locationId, quantity };
}

// Lists the fields the API promises. Products seeded before stock moved to its own table still carry
// a legacy "inventory" count, which nothing reads or updates any more, so it's left out here.
function publicProduct(
  { tenantId, productId, name, description, price, category }: Product,
  stock: StockLevel[],
) {
  return { tenantId, productId, name, description, price, category, stock };
}
