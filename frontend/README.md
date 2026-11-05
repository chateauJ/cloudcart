# CloudCart frontend

A thin Next.js storefront for demoing the CloudCart API. It runs locally against a deployed
environment; it isn't deployed to AWS itself.

- **Products** are public and rendered on the server per request, so stock levels are current.
- **Sign-up, sign-in and the session** use Amazon Cognito through Amplify. Sign-in uses SRP, so the
  password never leaves the browser.
- **Cart and orders** call the API with the Cognito access token. The API derives the user from the
  token; the frontend never sends a user ID.

## Running it

Requires Node.js 24 and AWS credentials that can read the environment's Terraform state.

```bash
npm install
npm run env:dev   # writes .env.local from the dev Terraform outputs (env:prod for prod)
npm run dev       # http://localhost:3000
```

The API only accepts browser requests from `http://localhost:3000` (its CORS setting), so keep the
default port.

## How it maps to the backend

| File | Purpose |
|---|---|
| `lib/config.ts` | Reads the `NEXT_PUBLIC_*` values from `.env.local` (see `.env.example`) |
| `lib/api.ts` | HTTP API client; attaches the access token to cart and order calls |
| `lib/AuthContext.tsx` | Cognito sign-up, email confirmation, sign-in and sign-out |
| `lib/CartContext.tsx` | The signed-in user's cart; every change round-trips the Cart API |
| `lib/CatalogContext.tsx` | Product names and prices for the cart, checkout and order pages |

New orders start as `PENDING`. The order page polls until the asynchronous inventory flow (DynamoDB
Streams → EventBridge Pipe → SQS → Inventory Lambda) marks the order `COMPLETE` or `FAILED`.
