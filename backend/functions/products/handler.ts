import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../shared/dynamodb";
import { errorResponse, jsonResponse } from "../../shared/responses";
import { createLogger } from "../../shared/logger";

const TABLE_NAME = process.env.PRODUCTS_TABLE_NAME;

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  const log = createLogger(context, { route: event.routeKey });

  if (!TABLE_NAME) {
    log.error("PRODUCTS_TABLE_NAME environment variable is not set");
    return errorResponse(500, "CONFIGURATION_ERROR", "Server is misconfigured");
  }

  try {
    const productId = event.pathParameters?.id;
    return productId ? await getProduct(TABLE_NAME, productId) : await listProducts(TABLE_NAME);
  } catch (err) {
    log.error("products handler failed", { error: err });
    return errorResponse(500, "INTERNAL_ERROR", "Something went wrong while processing the request");
  }
}

async function listProducts(tableName: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(new ScanCommand({ TableName: tableName }));
  return jsonResponse(200, result.Items ?? []);
}

async function getProduct(tableName: string, productId: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(
    new GetCommand({ TableName: tableName, Key: { productId } }),
  );

  if (!result.Item) {
    return errorResponse(404, "PRODUCT_NOT_FOUND", `Product ${productId} does not exist`);
  }

  return jsonResponse(200, result.Item);
}
