// Deployment-specific values, written to .env.local from Terraform outputs by `npm run env:dev`.
// Next.js inlines NEXT_PUBLIC_* at build time, so each must be read with a literal property access.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Run "npm run env:dev" to write .env.local from Terraform outputs.`);
  }
  return value;
}

export const config = {
  apiUrl: required("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL).replace(/\/+$/, ""),
  userPoolId: required("NEXT_PUBLIC_COGNITO_USER_POOL_ID", process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID),
  userPoolClientId: required("NEXT_PUBLIC_COGNITO_CLIENT_ID", process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID),
  // One build per storefront: the business whose catalog, carts and orders this site shows
  tenantId: required("NEXT_PUBLIC_TENANT_ID", process.env.NEXT_PUBLIC_TENANT_ID),
};
