import { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

// The user's identity comes only from the JWT that API Gateway's authorizer already verified -
// never from anything the client sends. Returns null (caller responds 401) rather than ever
// falling back to a default user, so a route accidentally deployed without the authorizer
// fails closed instead of exposing one shared account.
export function getUserId(event: APIGatewayProxyEventV2): string | null {
  const claims = (event as APIGatewayProxyEventV2WithJWTAuthorizer).requestContext.authorizer?.jwt
    ?.claims;
  const sub = claims?.sub;
  return typeof sub === "string" && sub !== "" ? sub : null;
}

// Cognito groups from the verified access token. The HTTP API's JWT authorizer flattens array
// claims to a string like "[staff-northlight staff-tidewater]", so both that and a real array are read.
export function getGroups(event: APIGatewayProxyEventV2): string[] {
  const claims = (event as APIGatewayProxyEventV2WithJWTAuthorizer).requestContext.authorizer?.jwt
    ?.claims;
  const raw: unknown = claims?.["cognito:groups"];
  if (Array.isArray(raw)) return raw.filter((group): group is string => typeof group === "string");
  if (typeof raw !== "string") return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .filter((group) => group !== "");
}

// Staff membership is per business: staff-<tenantId>. Checked against the tenant the request is
// for, so being staff somewhere never grants access to another tenant's orders.
export function isStaffOf(event: APIGatewayProxyEventV2, tenantId: string): boolean {
  return getGroups(event).includes(`staff-${tenantId}`);
}
