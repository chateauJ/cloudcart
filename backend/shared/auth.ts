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
