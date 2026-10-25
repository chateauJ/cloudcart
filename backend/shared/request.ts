import { APIGatewayProxyEventV2 } from "aws-lambda";

// Throws SyntaxError on malformed JSON - callers decide how to report it.
export function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return undefined;

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  return JSON.parse(raw);
}
