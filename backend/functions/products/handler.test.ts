import { DynamoDBDocumentClient, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { apiEvent, context, logLines, parseResponse } from "../../test/helpers";
import { handler } from "./handler";

const ddb = mockClient(DynamoDBDocumentClient);

const keyboard = {
  productId: "prod_001",
  name: "Keyboard",
  description: "Mechanical keyboard",
  price: 79.99,
  inventory: 10,
  category: "electronics",
};

beforeEach(() => ddb.reset());

describe("products handler", () => {
  it("lists every product", async () => {
    ddb.on(ScanCommand).resolves({ Items: [keyboard] });

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /products" }), context));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([keyboard]);
    expect(ddb).toHaveReceivedCommandWith(ScanCommand, { TableName: "products-table" });
  });

  it("returns one product by id", async () => {
    ddb.on(GetCommand, { Key: { productId: "prod_001" } }).resolves({ Item: keyboard });

    const res = parseResponse(
      await handler(apiEvent({ routeKey: "GET /products/{id}", pathParameters: { id: "prod_001" } }), context),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(keyboard);
  });

  it("returns 404 for a product that doesn't exist", async () => {
    ddb.on(GetCommand).resolves({});

    const res = parseResponse(
      await handler(apiEvent({ routeKey: "GET /products/{id}", pathParameters: { id: "prod_999" } }), context),
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns a generic 500 and logs the cause when DynamoDB fails", async () => {
    ddb.on(ScanCommand).rejects(new Error("ProvisionedThroughputExceededException"));

    const res = parseResponse(await handler(apiEvent({ routeKey: "GET /products" }), context));

    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    // The SDK's message goes to the logs, never to the client
    expect(JSON.stringify(res.body)).not.toContain("ProvisionedThroughput");
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        level: "ERROR",
        error: expect.objectContaining({ message: "ProvisionedThroughputExceededException" }),
      }),
    );
  });
});
