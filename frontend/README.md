# CloudCart frontend

A thin Next.js storefront for demoing the CloudCart API. It's a static export (`output: "export"`):
plain HTML, CSS and JS that the deploy pipeline uploads to S3 and serves through CloudFront. There's
no Node.js server, and every page fetches its data in the browser.

- **Products** are public and fetched on every page visit, so stock levels are current. Each carries
  its stock per location.
- **My store** (in the bar under the navbar) is the shopper's local shop, kept in `localStorage` per
  storefront. The grid shows what's on that store's shelves and what's held elsewhere; the product
  page lists every location. One order line is filled from one location, so the quantity picker's
  maximum is the largest single location's stock.
- **Pages for a specific product or order** take the ID as a query parameter (`/product?id=…`,
  `/order?id=…`). A static export can only pre-build pages for IDs known at build time.
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

To check the production build as CloudFront will serve it:

```bash
npm run build     # writes the static export to out/
npm run preview   # serves out/ at http://localhost:3000 with the same URL rules as CloudFront
```

The hosted storefront's URL is the `site_url` Terraform output.

Each build is one store's storefront: `NEXT_PUBLIC_TENANT_ID` (written by `env:dev` from the
`storefront_tenant_id` output) is sent as `X-Tenant-Id` on every API call. To run the other seeded
store locally, use `TENANT_ID=tidewater npm run env:dev`.

Locally, the app calls the HTTP API's own endpoint, which only accepts browser requests from
`http://localhost:3000` (its CORS setting), so keep the default port. The hosted builds are made
with `NEXT_PUBLIC_API_URL=/api`: CloudFront serves the API under the storefront's own origin, so they
need no CORS, and catalog responses come from the edge cache.

## Recording the demo

`npm run demo:record` re-records the demo at the top of the root README. It drives headless Chrome
through the whole shopping flow against the running storefront, then uses ffmpeg to write
`docs/demo/cloudcart-demo.mp4` and `cloudcart-demo.gif`. It needs Google Chrome, ffmpeg, and a
confirmed user in the target Cognito pool whose credentials are in `.env.demo` (gitignored):

```bash
CLOUDCART_DEMO_EMAIL=demo@example.com
CLOUDCART_DEMO_PASSWORD=...
```

```bash
npm run build && npm run preview   # production build, so no Next.js dev overlay is recorded
npm run demo:record          # in a second terminal
```

Before recording, it empties that user's cart off camera, so every take starts the same way.

## How it maps to the backend

| File | Purpose |
|---|---|
| `lib/config.ts` | Reads the `NEXT_PUBLIC_*` values from `.env.local` (see `.env.example`) |
| `lib/api.ts` | HTTP API client; attaches the access token to cart and order calls |
| `lib/AuthContext.tsx` | Cognito sign-up, email confirmation, sign-in and sign-out |
| `lib/CartContext.tsx` | The signed-in user's cart; every change round-trips the Cart API |
| `lib/CatalogContext.tsx` | Product names and prices for the cart, checkout and order pages |
| `lib/TenantContext.tsx` | The store's name and tagline, for the navbar and catalog header |
| `lib/StoreContext.tsx` | The business's locations and the shopper's "My store" choice |
| `app/staff/page.tsx` | Staff only (members of `staff-<tenantId>`): a store's pickup queue or the shipping queue, with Mark ready, Mark picked up and Mark shipped. Staff also see an "In-store sale" option at checkout |
| `lib/stock.ts` | Totals, per-location quantities and the per-line maximum from a product's stock |

New orders start as `PENDING`. The order page polls until the asynchronous inventory flow (DynamoDB
Streams → EventBridge Pipe → SQS → Inventory Lambda) marks the order `RESERVED` (showing where each line was taken from) or `FAILED`. Checkout
offers pickup at a store (defaulting to My store) or shipping; a pickup order shows its store, its hold
deadline and which lines are being transferred in, and later `READY FOR PICKUP`, `FULFILLED` or `EXPIRED`.
