import { APIGatewayProxyEventV2 } from "aws-lambda";

const DEMO_USER_ID = "demo-user";

// Temporary fixed user until Cognito (Milestone 3) - this function is the single swap point.
export function getUserId(_event: APIGatewayProxyEventV2): string {
  return DEMO_USER_ID;
}
