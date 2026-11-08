import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { apiEvent, parseResponse, TENANT, TENANTS_TABLE } from "../test/helpers";
import { resolveTenant } from "./tenant";

const ddb = mockClient(DynamoDBDocumentClient);

function resolve(tenantId: string | null) {
  return resolveTenant(apiEvent({ routeKey: "GET /products", tenantId }), TENANTS_TABLE);
}

async function errorOf(tenantId: string | null) {
  const result = await resolve(tenantId);
  if (result.ok) throw new Error("expected the tenant to be rejected");
  return parseResponse(result.response);
}

beforeEach(() => ddb.reset());

describe("resolveTenant", () => {
  it("resolves a known tenant from the X-Tenant-Id header", async () => {
    ddb.on(GetCommand, { TableName: TENANTS_TABLE, Key: { tenantId: "northlight" } }).resolves({ Item: TENANT });

    const result = await resolve("northlight");

    expect(result).toEqual({ ok: true, tenant: TENANT });
  });

  it("rejects a request with no tenant header, without a table read", async () => {
    const res = await errorOf(null);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("TENANT_REQUIRED");
    expect(ddb.calls()).toHaveLength(0);
  });

  it.each([["uppercase", "Northlight"], ["too short", "ab"], ["a space", "north light"], ["a key separator", "north#light"]])(
    "rejects a malformed tenant ID (%s) without a table read",
    async (_case, tenantId) => {
      const res = await errorOf(tenantId);

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("INVALID_TENANT");
      expect(ddb.calls()).toHaveLength(0);
    },
  );

  it("returns 404 for a tenant that doesn't exist", async () => {
    ddb.on(GetCommand).resolves({});

    const res = await errorOf("nobody");

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("TENANT_NOT_FOUND");
  });

  it("remembers known and unknown tenants, so repeat requests skip the table", async () => {
    ddb.on(GetCommand, { Key: { tenantId: "northlight" } }).resolves({ Item: TENANT });
    ddb.on(GetCommand, { Key: { tenantId: "nobody" } }).resolves({});

    await resolve("northlight");
    await resolve("northlight");
    await resolve("nobody");
    await resolve("nobody");

    expect(ddb).toHaveReceivedCommandTimes(GetCommand, 2);
  });

  it("looks a tenant up again once its cache entry expires", async () => {
    ddb.on(GetCommand).resolves({ Item: TENANT });
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);

    await resolve("northlight");
    now.mockReturnValue(1_000_000 + 5 * 60_000 + 1); // just past the 5-minute TTL
    await resolve("northlight");

    expect(ddb).toHaveReceivedCommandTimes(GetCommand, 2);
  });

  it("caps the cache, so a flood of random tenant IDs can't grow it without bound", async () => {
    ddb.on(GetCommand).resolves({});

    for (let i = 0; i < 1001; i++) await resolve(`tenant-${i}`); // the 1001st clears the full cache
    await resolve("tenant-0"); // evicted, so read again

    expect(ddb).toHaveReceivedCommandTimes(GetCommand, 1002);
  });

  it("lets a DynamoDB failure propagate, so the handler answers 500", async () => {
    ddb.on(GetCommand).rejects(new Error("Service unavailable"));

    await expect(resolve("northlight")).rejects.toThrow("Service unavailable");
  });
});
