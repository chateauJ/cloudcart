import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { captureAWSv3Client } from "aws-xray-sdk-core";

// Lambda sets this only when active tracing is on. Outside Lambda (e.g. unit tests) there's
// no X-Ray segment to attach to, and the SDK would log a "context missing" error per call.
const tracingEnabled = Boolean(process.env.AWS_XRAY_DAEMON_ADDRESS);

// Created once per Lambda execution environment (module scope, not inside the
// handler) so warm invocations reuse the same client/connection instead of
// paying setup cost on every request.
const rawClient = new DynamoDBClient({});

// Wrapping the client records every DynamoDB call as an X-Ray subsegment (table, operation,
// latency, throttles) - without it a trace shows the Lambda but not where its time went.
const client = tracingEnabled ? captureAWSv3Client(rawClient) : rawClient;

export const docClient = DynamoDBDocumentClient.from(client);

// Every item a Query matches, following LastEvaluatedKey past Query's 1 MB page limit
export async function queryAll<T>(input: Omit<QueryCommandInput, "ExclusiveStartKey">): Promise<T[]> {
  const items: T[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...((page.Items ?? []) as T[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}
