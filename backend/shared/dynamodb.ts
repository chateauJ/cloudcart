import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Created once per Lambda execution environment (module scope, not inside the
// handler) so warm invocations reuse the same client/connection instead of
// paying setup cost on every request.
const client = new DynamoDBClient({});

export const docClient = DynamoDBDocumentClient.from(client);
