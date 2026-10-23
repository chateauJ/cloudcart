import { APIGatewayProxyResultV2 } from "aws-lambda";

// CORS headers are configured on the HTTP API itself (spec.md §2), not here -
// this only needs to describe the body format.
const headers = { "Content-Type": "application/json" };

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
}

export function errorResponse(
  statusCode: number,
  code: string,
  message: string,
): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, { error: { code, message } });
}
