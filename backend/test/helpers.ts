import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
  SNSEvent,
  SNSEventRecord,
  SQSEvent,
  SQSRecord,
} from "aws-lambda";
import { OrderCreatedDetail } from "../shared/types";

export const context = {
  functionName: "cloudcart-test",
  awsRequestId: "request-1",
} as Context;

export const USER_ID = "user-1";

interface ApiEventOptions {
  routeKey: string;
  userId?: string; // omitted = no verified JWT, as if the authorizer were missing
  body?: unknown;
  rawBody?: string; // sent as-is, for malformed JSON
  base64?: boolean;
  pathParameters?: Record<string, string>;
}

export function apiEvent(options: ApiEventOptions): APIGatewayProxyEventV2 {
  const text = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return {
    routeKey: options.routeKey,
    pathParameters: options.pathParameters,
    body: text !== undefined && options.base64 ? Buffer.from(text).toString("base64") : text,
    isBase64Encoded: options.base64 ?? false,
    requestContext: {
      authorizer: options.userId ? { jwt: { claims: { sub: options.userId }, scopes: [] } } : undefined,
    },
  } as unknown as APIGatewayProxyEventV2;
}

export function parseResponse(result: APIGatewayProxyResultV2): { statusCode?: number; body: any } {
  if (typeof result === "string") throw new Error("Expected a structured API Gateway response");
  return { statusCode: result.statusCode, body: result.body ? JSON.parse(result.body) : undefined };
}

// The SQS body and SNS message are both the full EventBridge event; the Pipe's output is its detail
export function orderCreatedMessage(detail: Partial<OrderCreatedDetail> | Record<string, unknown>): string {
  return JSON.stringify({ source: "cloudcart.orders", "detail-type": "OrderCreated", detail });
}

export function sqsEvent(...bodies: string[]): SQSEvent {
  return {
    Records: bodies.map((body, index) => ({ messageId: `message-${index + 1}`, body }) as SQSRecord),
  };
}

export function snsEvent(...messages: string[]): SNSEvent {
  return {
    Records: messages.map(
      (Message, index) => ({ Sns: { MessageId: `sns-${index + 1}`, Message } }) as SNSEventRecord,
    ),
  };
}

// Every JSON line the logger wrote during the current test
export function logLines(): Array<Record<string, any>> {
  return jest
    .mocked(process.stdout.write)
    .mock.calls.map(([chunk]) => String(chunk))
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}
