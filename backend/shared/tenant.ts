import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "./dynamodb";
import { keys } from "./keys";
import { errorResponse } from "./responses";
import { Tenant } from "./types";

// Which store a request is for. HTTP API delivers header names lowercased.
export const TENANT_HEADER = "x-tenant-id";
const TENANT_ID_PATTERN = /^[a-z0-9-]{3,32}$/;

// Tenants change rarely, so each Lambda environment remembers lookups instead of reading the
// table on every request. Unknown IDs are remembered too, but briefly, so random IDs can't
// turn into a table read each - and the cache is capped so they can't grow it without bound.
const FOUND_TTL_MS = 5 * 60_000;
const MISSING_TTL_MS = 60_000;
const MAX_CACHED = 1000;
const cache = new Map<string, { tenant: Tenant | null; expiresAt: number }>();

export type TenantResult = { ok: true; tenant: Tenant } | { ok: false; response: APIGatewayProxyResultV2 };

// Resolves the X-Tenant-Id header to a known tenant, or to the error response to send instead.
// DynamoDB failures are thrown, so the handler's catch turns them into a 500.
export async function resolveTenant(event: APIGatewayProxyEventV2, tableName: string): Promise<TenantResult> {
  const tenantId = event.headers?.[TENANT_HEADER];
  if (!tenantId) {
    return { ok: false, response: errorResponse(400, "TENANT_REQUIRED", "Missing X-Tenant-Id header") };
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    return {
      ok: false,
      response: errorResponse(400, "INVALID_TENANT", "X-Tenant-Id must be 3-32 lowercase letters, digits or hyphens"),
    };
  }

  const tenant = await lookUp(tenantId, tableName);
  if (!tenant) {
    return { ok: false, response: errorResponse(404, "TENANT_NOT_FOUND", `Store ${tenantId} does not exist`) };
  }
  return { ok: true, tenant };
}

async function lookUp(tenantId: string, tableName: string): Promise<Tenant | null> {
  const now = Date.now();
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > now) return cached.tenant;

  const result = await docClient.send(new GetCommand({ TableName: tableName, Key: keys.tenant(tenantId) }));
  const tenant = (result.Item as Tenant | undefined) ?? null;

  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(tenantId, { tenant, expiresAt: now + (tenant ? FOUND_TTL_MS : MISSING_TTL_MS) });
  return tenant;
}

// For tests: each one starts with an empty cache
export function clearTenantCache(): void {
  cache.clear();
}
