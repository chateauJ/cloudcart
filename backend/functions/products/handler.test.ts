import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { apiEvent, context, dataCalls, logLines, parseResponse, TENANT, TENANT_ID, TENANTS_TABLE } from "../../test/helpers";
import { handler } from "./handler";

const ddb = mockClient(DynamoDBDocumentClient);

const keyboard = {
  tenantId: TENANT_ID,
  productId: "prod_001",
  name: "Keyboard",
  description: "Mechanical keyboard",
  price: 79.99,
  inventory: 10,
  category: "electronics",
};

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand, { TableName: TENANTS_TABLE }).resolves({ Item: TENANT });
});

describe("products handler", () => {
  it("returns the storefront's tenant", async () => {
    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /tenant" }), context));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(TENANT);
  });

  it("lists the tenant's catalog with a Query on its partition, not a Scan", async () => {
    ddb.on(QueryCommand).resolves({ Items: [keyboard] });

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /products" }), context));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([keyboard]);
    expect(ddb).toHaveReceivedCommandWith(QueryCommand, {
      TableName: "products-table",
      KeyConditionExpression: "tenantId = :tenantId",
      ExpressionAttributeValues: { ":tenantId": TENANT_ID },
    });
  });

  it("pages through a catalog larger than one Query page", async () => {
    const mouse = { ...keyboard, productId: "prod_002", name: "Mouse" };
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [keyboard], LastEvaluatedKey: { tenantId: TENANT_ID, productId: "prod_001" } })
      .resolvesOnce({ Items: [mouse] });

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /products" }), context));

    expect(res.body).toEqual([keyboard, mouse]);
    expect(ddb.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual({
      tenantId: TENANT_ID,
      productId: "prod_001",
    });
  });

  it("returns one product by its tenant-scoped key", async () => {
    ddb.on(GetCommand, { TableName: "products-table", Key: { tenantId: TENANT_ID, productId: "prod_001" } }).resolves({
      Item: keyboard,
    });

    const res = parseResponse(
      await handler(apiEvent({ routeKey: "GET /products/{id}", pathParameters: { id: "prod_001" } }), context),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(keyboard);
  });

  it("returns 404 for a product that doesn't exist in this tenant", async () => {
    ddb.on(GetCommand, { TableName: "products-table" }).resolves({});

    const res = parseResponse(
      await handler(apiEvent({ routeKey: "GET /products/{id}", pathParameters: { id: "prod_999" } }), context),
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("rejects a product route without an id", async () => {
    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /products/{id}" }), context));

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 404 for a route it doesn't serve", async () => {
    const res = parseResponse(await handler(apiEvent({ routeKey: "DELETE /products" }), context));

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("rejects a request without a tenant before reading any product data", async () => {
    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /products", tenantId: null }), context));

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("TENANT_REQUIRED");
    expect(dataCalls(ddb.calls())).toHaveLength(0);
  });

  it("returns a generic 500 and logs the cause when DynamoDB fails", async () => {
    ddb.on(QueryCommand).rejects(new Error("ProvisionedThroughputExceededException"));

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /products" }), context));

    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    // The SDK's message goes to the logs, never to the client
    expect(JSON.stringify(res.body)).not.toContain("ProvisionedThroughput");
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        level: "ERROR",
        tenantId: TENANT_ID,
        error: expect.objectContaining({ message: "ProvisionedThroughputExceededException" }),
      }),
    );
  });
});
