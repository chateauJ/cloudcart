// Minimal HTTP client for the deployed API. Configuration comes from the environment so the
// suite can target any stage - see the test:integration script.

const REQUIRED = [
  "CLOUDCART_API_URL",
  "CLOUDCART_COGNITO_CLIENT_ID",
  "CLOUDCART_TEST_USERNAME",
  "CLOUDCART_TEST_PASSWORD",
] as const;

export interface Config {
  apiUrl: string;
  clientId: string;
  username: string;
  password: string;
  region: string;
}

export function loadConfig(): Config {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Integration tests need these environment variables: ${missing.join(", ")}`);
  }
  return {
    apiUrl: process.env.CLOUDCART_API_URL!.replace(/\/+$/, ""),
    clientId: process.env.CLOUDCART_COGNITO_CLIENT_ID!,
    username: process.env.CLOUDCART_TEST_USERNAME!,
    password: process.env.CLOUDCART_TEST_PASSWORD!,
    region: process.env.CLOUDCART_REGION ?? "us-east-1",
  };
}

// InitiateAuth is a public Cognito API - the app client ID is the only credential, so no AWS
// SDK or IAM credentials are needed, exactly like a real frontend logging in.
export async function login(config: Config): Promise<string> {
  const res = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: config.clientId,
      AuthParameters: { USERNAME: config.username, PASSWORD: config.password },
    }),
  });
  const body = (await res.json()) as {
    AuthenticationResult?: { AccessToken?: string };
    __type?: string; // Cognito's error code, e.g. NotAuthorizedException
    message?: string;
  };
  const token = body?.AuthenticationResult?.AccessToken;
  if (!res.ok || typeof token !== "string") {
    throw new Error(`Cognito login failed (${res.status}): ${body?.__type ?? ""} ${body?.message ?? ""}`);
  }
  return token;
}

export interface ApiResponse {
  status: number;
  body: any;
}

export async function api(
  config: Config,
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

export async function poll<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { timeoutMs = 45000, intervalMs = 1000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    value = await read();
  }
  return value;
}
