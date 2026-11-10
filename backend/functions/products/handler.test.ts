import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { apiEvent, context, dataCalls, logLines, parseResponse, TENANT, TENANT_ID, TENANTS_TABLE } from "../../test/helpers";
import { handler } from "./handler";

const ddb = mockClient(DynamoDBDocumentClient);

// As stored: products seeded before stock moved out still carry a legacy inventory count
const keyboard = {
  tenantId: TENANT_ID,
  productId: "prod_001",
  name: "Keyboard",
  description: "Mechanical keyboard",
  price: 79.99,
  category: "electronics",
  inventory: 10,
};
const { inventory: _legacy, ...keyboardFields } = keyboard;

const stockRow = (productId: string, locationId: string, quantity: number) => ({
  tenantId: TENANT_ID,
  stockKey: `${productId}#${locationId}`,
  productId,
  locationId,
  quantity,
});

function givenProducts(...items: object[]) {
  ddb.on(QueryCommand, { TableName: "products-table" }).resolves({ Items: items });
}

function givenStock(...items: object[]) {
  ddb.on(QueryCommand, { TableName: "stock-table" }).resolves({ Items: items });
}

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

  it("lists the tenant's locations with a Query on its partition", async () => {
    ddb.on(QueryCommand, { TableName: "locations-table" }).resolves({
      Items: [
        { tenantId: TENANT_ID, locationId: "store_downtown", name: "Downtown", type: "STORE", pickupEnabled: true },
        { tenantId: TENANT_ID, locationId: "warehouse_main", name: "Warehouse", type: "WAREHOUSE", pickupEnabled: false },
      ],
    });

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /locations" }), context));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([
      { locationId: "store_downtown", name: "Downtown", type: "STORE", pickupEnabled: true },
      { locationId: "warehouse_main", name: "Warehouse", type: "WAREHOUSE", pickupEnabled: false },
    ]);
    expect(ddb).toHaveReceivedCommandWith(QueryCommand, {
      TableName: "locations-table",
      KeyConditionExpression: "tenantId = :tenantId",
      ExpressionAttributeValues: { ":tenantId": TENANT_ID },
    });
  });

  it("lists the catalog with each product's stock per location, from two tenant Queries and no Scan", async () => {
    const mouse = { ...keyboard, productId: "prod_002", name: "Mouse" };
    givenProducts(keyboard, mouse);
    givenStock(stockRow("prod_001", "store_downtown", 2), stockRow("prod_001", "warehouse_main", 8));

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /products" }), context));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([
      {
        ...keyboardFields,
        stock: [
          { locationId: "store_downtown", quantity: 2 },
          { locationId: "warehouse_main", quantity: 8 },
        ],
      },
      { ...keyboardFields, productId: "prod_002", name: "Mouse", stock: [] }, // no stock rows: nothing anywhere
    ]);
    expect(res.body[0]).not.toHaveProperty("inventory");
    for (const table of ["products-table", "stock-table"]) {
      expect(ddb).toHaveReceivedCommandWith(QueryCommand, {
        TableName: table,
        KeyConditionExpression: "tenantId = :tenantId",
        ExpressionAttributeValues: { ":tenantId": TENANT_ID },
      });
    }
  });

  it("pages through a catalog larger than one Query page", async () => {
    const mouse = { ...keyboard, productId: "prod_002", name: "Mouse" };
    ddb
      .on(QueryCommand, { TableName: "products-table" })
      .resolvesOnce({ Items: [keyboard], LastEvaluatedKey: { tenantId: TENANT_ID, productId: "prod_001" } })
      .resolvesOnce({ Items: [mouse] });
    givenStock();

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /products" }), context));

    expect(res.body.map((p: { productId: string }) => p.productId)).toEqual(["prod_001", "prod_002"]);
    const productQueries = ddb
      .commandCalls(QueryCommand)
      .filter((call) => call.args[0].input.TableName === "products-table");
    expect(productQueries[1].args[0].input.ExclusiveStartKey).toEqual({ tenantId: TENANT_ID, productId: "prod_001" });
  });

  it("returns one product by its tenant-scoped key, with only that product's stock", async () => {
    ddb.on(GetCommand, { TableName: "products-table", Key: { tenantId: TENANT_ID, productId: "prod_001" } }).resolves({
      Item: keyboard,
    });
    givenStock(stockRow("prod_001", "warehouse_main", 8));

    const res = parseResponse(
      await handler(apiEvent({ routeKey: "GET /products/{id}", pathParameters: { id: "prod_001" } }), context),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ...keyboardFields, stock: [{ locationId: "warehouse_main", quantity: 8 }] });
    expect(ddb).toHaveReceivedCommandWith(QueryCommand, {
      TableName: "stock-table",
      KeyConditionExpression: "tenantId = :tenantId AND begins_with(stockKey, :prefix)",
      ExpressionAttributeValues: { ":tenantId": TENANT_ID, ":prefix": "prod_001#" },
    });
  });

  it("returns 404 for a product that doesn't exist in this tenant", async () => {
    ddb.on(GetCommand, { TableName: "products-table" }).resolves({});
    givenStock();

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
