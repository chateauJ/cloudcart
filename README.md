# CloudCart

**Endless-aisle commerce for physical retailers, serverless on AWS.** A shop's stock, spread across its stores and a warehouse, becomes sellable from anywhere: online, for pickup at any store, or across the counter by staff. One deployment serves many businesses. Every resource is defined in Terraform and shipped through GitHub Actions, with an approval-gated path to production.

> A website builder gives a business a website that contains a store. CloudCart makes a physical store's stock sellable from anywhere.

![CloudCart demo: a shopper whose store is Downtown buys a light that only the Harbor store stocks, picks it up at Downtown, and staff work the order through Downtown's pickup queue](docs/demo/cloudcart-demo.gif)

*A real session against the dev environment, recorded by [`frontend/scripts/record-demo.mjs`](frontend/scripts/record-demo.mjs). The shopper's store is Downtown, but the light they want is only at Harbor. They order it for pickup at Downtown. The inventory Lambda takes it from Harbor and flags it for transfer, takes the lens from Downtown's own shelf, and holds both until the pickup deadline. Staff then mark the order ready and picked up from Downtown's queue. [Full-resolution MP4](docs/demo/cloudcart-demo.mp4).*

## Why not a website builder?

A website builder such as Wix answers *"How do I get my business online?"* It starts from pages and a theme, and its store is a catalog of products with a stock count, sold to whoever visits the site. That's the right tool for a business that mostly sells online, or from one place.

CloudCart answers a different question: *"How do I sell the stock already sitting in my shops?"* It starts from the inventory, where each unit physically is, and builds the selling around that:

| | Website builder | CloudCart |
| --- | --- | --- |
| Starting point | A website, with a store section | A business's locations and the stock in each |
| Unit of stock | A count per product (multi-location stock, where offered, is usually a higher tier or an add-on) | A quantity per product **per location**, the only stock record there is |
| What a shopper sees | In stock or not | What's on *their* store's shelf, and what the business holds elsewhere |
| Where an order is filled from | Wherever the merchant ships from | Chosen per line by an allocation rule: the pickup store's shelf, then the warehouse, then another store, with a transfer flagged |
| Store pickup | A pickup option | A **hold** with a deadline, released automatically and returned to the shelf it came from if nobody collects |
| Store staff | Admin users of the website | A per-business staff role with pickup and shipping queues, and in-store sales of stock that isn't on their shelf |
| Shape | One site per merchant | One multi-tenant platform; each business is a tenant, isolated in every table key |

So CloudCart isn't a better website builder; it's the inventory and fulfilment layer that a multi-store retailer would otherwise stitch together from a website, a POS and spreadsheets. The storefront here is deliberately thin. The interesting part is the backend.

## The endless aisle, end to end

The demo above, step by step, with what each step exercises:

1. **A shopper picks their store.** They choose *Downtown* as their store. The catalog (`GET /products`, cached per business at CloudFront for 30 seconds) switches to what's on Downtown's shelf ("3 at Downtown"), and shows "Not at Downtown · 6 elsewhere" for the LumaRing light.
2. **They see where it is.** The product page lists every location's stock from the `stock` table: Downtown none, Harbor 6, the warehouse none.
3. **They order it for pickup at Downtown, along with a lens that is on Downtown's shelf.** Checkout previews which lines are on the shelf and which need a transfer. `POST /orders` writes the order `PENDING` and clears the cart in one transaction, and answers at once.
4. **The stock is allocated asynchronously.** The order's stream record becomes an `OrderCreated` event (DynamoDB Streams → EventBridge Pipe → EventBridge → SQS). The inventory Lambda takes the lens from Downtown and the light from Harbor (`needsTransfer: true`), schedules the hold's expiry with EventBridge Scheduler, then decrements both stock rows and marks the order `RESERVED` in one conditional transaction.
5. **Staff move it through the counter.** Downtown's staff (members of the `staff-northlight` Cognito group) see the order in their pickup queue, with the light marked "Transfer from Harbor". They mark it ready, then picked up; each press is one conditional update, so a double press can't skip a step.
6. **If the shopper never comes,** the schedule fires at the deadline (48 hours in prod), and the expiry Lambda puts the light back at Harbor and the lens back at Downtown, then marks the order `EXPIRED`.

Staff can also sell the endless aisle from behind the counter: an in-store sale (`channel: "IN_STORE"`) of something the shop doesn't have, shipped from the warehouse or collected at another store.

## Architecture

```mermaid
flowchart LR
    client[Browser] -->|HTTPS + Cognito JWT| cdn[CloudFront]
    cdn -->|pages| s3[(private S3)]
    cdn -->|"/api/* (catalog cached per store)"| api[API Gateway HTTP API]
    cognito[Cognito User Pool] -. issues / validates JWTs .- api
    api --> products[products λ] --> pt[(products)]
    products --> st[(locations + stock)]
    api --> cart[cart λ] --> ct[(carts)]
    api --> orders[orders λ] --> ot[(orders)]
    api --> staff[staff λ] -->|queues, ready, fulfilled| ot
    ot -->|DynamoDB Stream, INSERT only| pipe[EventBridge Pipe]
    pipe -->|OrderCreated| bus[EventBridge bus]
    bus --> sqs[SQS order queue] --> inventory[inventory λ]
    sqs -. after 5 failed receives .-> dlq[SQS DLQ]
    inventory -->|"conditional decrement, per location"| st
    inventory -->|status transition| ot
    inventory -->|one schedule per pickup hold| sched[EventBridge Scheduler]
    sched -->|at the hold deadline| expiry[expiry λ]
    expiry -->|return stock, order EXPIRED| st
    bus --> sns[SNS order notifications] --> notifications[notifications λ]
```

**Request path.** One CloudFront distribution serves both the storefront and its API: pages come from S3, and `/api/*` goes to the HTTP API with the `/api` prefix stripped by a CloudFront Function. The site and API share an origin, so the hosted storefront needs no CORS. API Gateway's built-in JWT authorizer validates Cognito tokens, so there is no custom authorizer Lambda. Handlers take the user ID from the token's `sub` claim and never from the request body.

**Order path.** The orders Lambda writes the order and nothing else. A DynamoDB Stream on the orders table feeds an EventBridge Pipe, which publishes `OrderCreated` to a custom bus. Two rules fan that event out: one to SQS for the inventory Lambda, one to SNS for the notifications Lambda.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant API as API Gateway
    participant O as orders λ
    participant DB as DynamoDB
    participant EB as Pipe and EventBridge
    participant Q as SQS
    participant I as inventory λ
    B->>API: POST /orders with Cognito access token
    API->>O: invoke after the JWT authorizer passes
    O->>DB: one transaction - put order (PENDING), delete cart
    O-->>B: 201 Created, status PENDING
    DB-->>EB: stream INSERT becomes OrderCreated
    EB->>Q: rule delivers to the order queue
    Q->>I: batch of messages
    I->>DB: read stock per location, pick one location per line
    I->>DB: one transaction - decrement those stock rows, order PENDING to RESERVED
    loop every 1.5 s until the order settles
        B->>API: GET /orders/{id}
    end
```

The API answers checkout before stock is reserved, so a slow or failing inventory step never blocks the customer. If no location can fill a line, the inventory Lambda marks the order `FAILED` with a reason instead.

**Order lifecycle.** Every arrow is a conditional write, so a duplicate or late event can't move an order twice.

```mermaid
stateDiagram-v2
    [*] --> PENDING: POST /orders
    PENDING --> RESERVED: inventory λ allocates stock
    PENDING --> FAILED: no location can fill a line
    RESERVED --> READY_FOR_PICKUP: staff, pickup
    RESERVED --> FULFILLED: staff, shipment
    READY_FOR_PICKUP --> FULFILLED: staff, picked up
    RESERVED --> EXPIRED: hold deadline (pickup)
    READY_FOR_PICKUP --> EXPIRED: hold deadline
    EXPIRED --> [*]: stock returned to its locations
```

### Screenshots

| Catalog with "My store" set to Downtown | Product page: stock at every location |
| --- | --- |
| ![Product grid showing what is on the Downtown shelf](docs/screenshots/products.png) | ![Product page listing Downtown none, Harbor 6, warehouse none](docs/screenshots/product-detail.png) |

| Checkout: pickup at Downtown, with a transfer preview | Staff: Downtown's pickup queue |
| --- | --- |
| ![Checkout with pickup at Downtown; one line on the shelf, one transferred](docs/screenshots/checkout.png) | ![Staff pickup queue with the order, one line flagged Transfer from Harbor](docs/screenshots/staff-queue.png) |

### Behind the scenes

**Deploy pipeline.** A merge to `main` reruns the tests, deploys and smoke-tests dev, plans prod, waits for a reviewer, then deploys and smoke-tests prod (see [CI/CD](#cicd)).

![GitHub Actions deploy run: tests, deploy dev, smoke test dev, plan prod, deploy prod, smoke test prod](docs/screenshots/pipeline.png)

**CloudCart dashboard in CloudWatch (dev), after the demo run.** Every alarm is OK, and the spike on the right is the recorded session (see [Monitoring](#monitoring)).

![CloudWatch dashboard with alarm status, API, Lambda, pipe, queue and DynamoDB widgets](docs/screenshots/dashboard.png)

**X-Ray trace map.** Each Lambda and the DynamoDB tables it calls, drawn from the traces of the same session.

<img src="docs/screenshots/xray-trace-map.png" alt="X-Ray trace map: the products, cart, orders, staff, inventory and notifications Lambdas and the DynamoDB tables they call" width="560">

### Key design decisions

- **No dual write.** If the orders Lambda wrote to DynamoDB and then called `PutEvents`, a crash between the two calls would leave an order with no event. Emitting events from the table's stream ties the event to the committed write, and the orders Lambda has no EventBridge permission at all.
- **Idempotent consumer without an idempotency table.** SQS and Pipes both deliver at least once. The inventory Lambda decrements stock with `ConditionExpression: quantity >= :qty`, which also prevents overselling, and moves order status only from the expected prior state. A redelivered message fails the condition and is treated as already processed.
- **Transactional checkout.** `POST /orders` uses `TransactWriteItems` to create the order and clear the cart together. A condition on the cart's `updatedAt` rejects a checkout against a cart that changed mid-request. Cart writes use the same optimistic-concurrency check.
- **Partial batch failures.** The inventory Lambda reports failed message IDs individually, so one bad message is retried without re-running the rest of the batch.
- **Stock per location, for endless aisle.** Each business has stores and a warehouse (`locations`), and stock is one row per product per location (`stock`, keyed `<productId>#<locationId>`), not a count on the product. A shopper sees what's at their chosen store and what the business holds everywhere else, and can buy either. The inventory Lambda fills each order line from one location: the warehouse first, so store shelves stay stocked for walk-in customers, then a store. If another order takes the stock between the read and the write, the transaction's condition fails and the Lambda re-reads and re-allocates, up to three times. The order records where each line came from.
- **Pickup holds that expire on time.** A pickup order's stock is held until `holdExpiresAt` (10 minutes in dev, so it can be demoed; 48 hours in prod). The inventory Lambda creates a one-time EventBridge Scheduler schedule for the deadline *before* it reserves the stock, so a reservation can't exist without its expiry, and the schedule deletes itself after it runs. At the deadline the expiry Lambda returns each line's stock to the location it came from and marks the order `EXPIRED`, in one transaction conditional on the order still being held, so a duplicate or late run changes nothing. DynamoDB TTL was the alternative, but its deletes can lag by days.
- **Pickup at any store, from any location.** For a pickup, each line comes from the pickup store's own shelf if it can, then the warehouse, then another store, and lines that come from elsewhere are flagged `needsTransfer`. That's the endless aisle: a shopper can collect at their local store something it doesn't stock.
- **Staff, scoped to one business.** A business's staff are the members of its Cognito group `staff-<tenantId>`, which arrives in the access token's `cognito:groups` claim. The staff Lambda checks it against the request's tenant, so being staff at one business grants nothing at another, and anyone else gets the same 404 as a route that doesn't exist. Staff work two kinds of queue from one index on the orders table (`tenantQueue`): each store's pickups, and the business's shipments. Each step (ready, then picked up or shipped) is one conditional update, so two people pressing the button at once can't both succeed. Staff can also ring up an in-store sale (`channel: "IN_STORE"`) to collect at any store or ship, which is how a shop sells stock it doesn't have on its own shelves.
- **Pool multi-tenancy.** One deployment serves many businesses. Every table's partition key is `tenantId`, every request names its store with `X-Tenant-Id` (checked against a `tenants` table), and every DynamoDB key is built by one helper that takes the tenant first, so no handler can address another store's data by ID alone. A shopper's single Cognito account works at every store, with a separate cart and order history at each. Listing a catalog is a `Query` on the tenant's partition rather than a `Scan` of the table.
- **Catalog caching at the edge, not in a cache cluster.** `GET /tenant`, `/products` and `/products/{id}` are cached at CloudFront for 30 seconds, with `X-Tenant-Id` in the cache key so each store is cached separately; a test proves one store's cached catalog is never served to another. Catalog reads are public, read-heavy and fine to be seconds stale, so this replaces DAX or ElastiCache at no cost. Every other route is never cached and is keyed on `Authorization`, because CloudFront strips that header from GET requests unless it's in the cache key. Stock is still enforced at checkout by the conditional write, so a stale catalog can't oversell.
- **Separate directories per environment, not workspaces.** Each environment is its own root module and state file, so applying to the wrong one takes an explicit `cd`. Both call the same `modules/app`, and they differ only in a handful of arguments.

## Tech stack

| Layer | Choice |
| --- | --- |
| Compute | AWS Lambda, Node.js 24, ARM64 (Graviton), bundled with esbuild |
| API | API Gateway HTTP API (v2), native JWT authorizer, behind CloudFront |
| Auth | Amazon Cognito User Pool + public app client |
| Data | DynamoDB on-demand: `tenants`, `locations`, `products`, `stock`, `carts`, `orders`, with `tenantUser` (order history) and `tenantQueue` (staff queues) GSIs |
| Events | DynamoDB Streams, EventBridge Pipes, EventBridge custom bus, SQS + DLQ, SNS, EventBridge Scheduler (pickup holds) |
| Observability | CloudWatch Logs (structured JSON), alarms, dashboard, Logs Insights queries, X-Ray |
| IaC | Terraform 1.14, AWS provider 6.x, S3 remote state with DynamoDB locking, tflint |
| CI/CD | GitHub Actions, GitHub OIDC → IAM role (no stored AWS keys) |
| Tests | Jest, ts-jest, aws-sdk-client-mock |
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |

## API

The hosted storefront calls the API at `<site_url>/api` (for example `/api/products`); the HTTP API's own endpoint serves the same routes at the root and is what local development uses. Every request names its store with an `X-Tenant-Id` header (for example `northlight`). A missing or malformed header returns 400 and an unknown store 404, before any store data is read.

| Method | Route | Auth | Lambda |
| --- | --- | --- | --- |
| GET | `/tenant` — the store's name and tagline | public | products |
| GET | `/locations` — the business's stores and warehouse | public | products |
| GET | `/products` — each with `stock: [{ locationId, quantity }]` | public | products |
| GET | `/products/{id}` — with its stock per location | public | products |
| GET | `/cart` | JWT | cart |
| POST | `/cart/items` — `{ productId, quantity }` | JWT | cart |
| DELETE | `/cart/items/{productId}` | JWT | cart |
| POST | `/orders` — checks out the caller's cart; body `{ fulfillment: { type: "SHIP" } }` or `{ fulfillment: { type: "PICKUP", locationId } }`, plus `channel: "IN_STORE", placedAtLocationId` for a staff sale | JWT | orders |
| GET | `/orders` — caller's orders, newest first | JWT | orders |
| GET | `/orders/{id}` | JWT | orders |
| GET | `/staff/orders?queue=<store>\|SHIP&status=` — a work queue, oldest first | JWT, staff | staff |
| POST | `/staff/orders/{id}/ready` — a pickup is on the counter | JWT, staff | staff |
| POST | `/staff/orders/{id}/fulfill` — picked up, or shipped | JWT, staff | staff |

New orders return `status: "PENDING"`. Once the inventory Lambda processes the event they move to `RESERVED`, with each line's `sourceLocationId` (and `needsTransfer` for a pickup) and a pickup's `holdExpiresAt`, or to `FAILED` when no location can fill a line. Staff then move a pickup to `READY_FOR_PICKUP` and `FULFILLED`, or a shipment straight to `FULFILLED`. A pickup that isn't collected by its deadline becomes `EXPIRED` and its stock goes back on sale.

Errors share one shape:

```json
{ "error": { "code": "PRODUCT_NOT_FOUND", "message": "Product prod_999 does not exist" } }
```

## Repository layout

```text
backend/
  functions/<name>/handler.ts   # products, cart, orders, inventory, expiry, staff, notifications (+ handler.test.ts)
  shared/                       # auth and staff groups, tenant resolution, key builders, DynamoDB client, logger, responses
  integration/                  # golden path, staff and CloudFront edge suites against a deployed environment
infrastructure/
  bootstrap/                    # one-time: state bucket, lock table, GitHub OIDC provider, deploy role, boundary, budget
  modules/
    app/                        # wires every module below into one environment
    api-gateway/ cognito/ dynamodb/ lambda/ order-events/ sqs/ sns/ monitoring/ static-site/
  environments/
    dev/                        # root module + state for dev
    prod/                       # root module + state for prod
frontend/                       # Next.js storefront, a static export: real API + Cognito (SRP) sign-in
docs/demo/                      # demo MP4 and GIF, recorded by frontend/scripts/record-demo.mjs
docs/screenshots/               # images used in this README
.github/
  workflows/test.yml            # PR checks, also reused by deploy.yml
  workflows/deploy.yml          # main → dev → smoke test → prod plan → approval → prod
  actions/terraform/            # composite action: build bundles, assume role, plan/apply
  actions/frontend/             # composite action: build the static export, upload to S3, invalidate CloudFront
```

## Getting started

Prerequisites: an AWS account, AWS CLI v2 configured for `us-east-1`, Terraform 1.14+, and Node.js 24.

### 1. Bootstrap (once per AWS account)

Terraform can't create the backend it stores its own state in, so this root module is applied by hand, once. It uses local state.

```bash
cd infrastructure/bootstrap
echo 'alarm_email = "you@example.com"' > local.auto.tfvars   # where budget alerts go; gitignored
terraform init
terraform apply
```

It creates the state bucket and lock table, the GitHub OIDC provider, the `cloudcart-github-actions` deploy role, the permissions boundary every app role must carry, and a $10 monthly AWS Budgets alert. Then:

- Put `state_bucket_name` and `lock_table_name` into each `environments/*/backend.tf`.
- Set `github_actions_role_arn` as the `AWS_ROLE_ARN` repository variable in GitHub.
- If you fork the repo, change `github_repository` in `bootstrap/variables.tf` first. The trust policy matches GitHub's immutable subject (`owner@id/repo@id`), not the repo name.

### 2. Deploy dev from your machine

```bash
cd backend
npm ci
npm run build

cd ../infrastructure/environments/dev
echo 'alarm_email = "you@example.com"' > local.auto.tfvars
terraform init
terraform apply
```

`local.auto.tfvars` is gitignored. Confirm the SNS subscription email to receive alarms. `terraform output api_endpoint` prints the API URL. Terraform seeds two businesses (`northlight` and `tidewater`), their locations, products and stock.

### 3. Run the tests

```bash
cd backend
npm test
npm run test:coverage
```

The integration suites run against a deployed environment as a confirmed Cognito test user who is a member of `staff-northlight`:

- **Golden path:** sign in, add to cart, check out for shipping, poll until the order is reserved, and check that the stock came from the warehouse and went down there. A pickup at a store that lacks the product must come back reserved, with the line flagged for transfer and a hold deadline.
- **Tenant isolation** between the two seeded businesses: each has its own catalog where product IDs overlap, its own cart for the same shopper and its own locations, and neither can see the other's orders.
- **Staff:** a pickup worked through its store's queue (ready, a refused second press, picked up), an in-store sale shipped from the shipping queue, and the staff API staying hidden at a business the user isn't staff of.
- **Edge** (with `CLOUDCART_SITE_URL`, the `site_url` output): through CloudFront's `/api`, a repeat catalog request is a cache hit, each business is cached separately, signed-in requests carry their token and are never cached, and API errors arrive as JSON.

```bash
cd backend
export CLOUDCART_API_URL=$(terraform -chdir=../infrastructure/environments/dev output -raw api_endpoint)
export CLOUDCART_COGNITO_CLIENT_ID=$(terraform -chdir=../infrastructure/environments/dev output -raw cognito_client_id)
export CLOUDCART_SITE_URL=$(terraform -chdir=../infrastructure/environments/dev output -raw site_url)
export CLOUDCART_TEST_USERNAME=you@example.com
export CLOUDCART_TEST_PASSWORD='your-test-password'
aws cognito-idp admin-add-user-to-group --user-pool-id "$(terraform -chdir=../infrastructure/environments/dev output -raw cognito_user_pool_id)" --username "$CLOUDCART_TEST_USERNAME" --group-name staff-northlight --region us-east-1
npm run test:integration
```

### 4. Run the storefront

```bash
cd frontend
npm ci
npm run env:dev   # writes .env.local from the dev Terraform outputs
npm run dev
```

Open http://localhost:3000 (the API's CORS setting allows only this origin; the hosted storefront needs no CORS because it calls `/api` on its own origin). Sign up with a real email address: Cognito emails a confirmation code, and sign-in then uses SRP, so the password never leaves the browser. See [`frontend/README.md`](frontend/README.md) for how the client maps to the API and how to re-record the demo.

## CI/CD

**`test.yml`** runs on every pull request with read-only permissions and no AWS credentials:

- Backend: `tsc --noEmit`, Jest with coverage, then an esbuild build of every Lambda
- Frontend: ESLint
- Terraform: `fmt -check`, `tflint --recursive`, and `validate` for `bootstrap`, `dev` and `prod`

```mermaid
flowchart LR
    pr[Pull request] --> checks[test.yml: 6 required checks]
    checks -->|rebase and merge| main[push to main]
    main --> rerun[test.yml again] --> dev[Deploy dev] --> smokedev[Smoke test dev]
    smokedev --> plan[Plan prod] --> gate{{Required reviewer approves}} --> prod[Deploy prod] --> smokeprod[Smoke test prod]
```

**`deploy.yml`** runs on push to `main`:

1. Reruns `test.yml`, so `main` can't deploy anything a PR wouldn't pass.
2. **Deploy dev:** builds the bundles, assumes the deploy role through OIDC, then plans and applies the saved plan. It then builds the storefront against `/api` and dev's Cognito, uploads it to S3 and invalidates CloudFront.
3. **Smoke test dev:** runs the integration suite against the API that was just deployed, both directly and through CloudFront's `/api` path, then checks that the storefront serves a page (200) and a missing page (404).
4. **Plan prod:** plans without applying, so the reviewer can read it first.
5. **Deploy prod:** waits for a required reviewer on the `prod` GitHub Environment, then re-plans, applies, and deploys the storefront the same way.
6. **Smoke test prod:** through the storefront's URL, `GET /api/products` must return 200, an anonymous `GET /api/cart` must return 401, and the `/products/` page must return 200.

Deploys queue rather than cancel, because interrupting `terraform apply` can leave state locked.

**Required GitHub settings:** the `AWS_ROLE_ARN` and `CLOUDCART_TEST_USERNAME` variables, the `ALARM_EMAIL` secret, and `dev` and `prod` environments. Put `CLOUDCART_TEST_PASSWORD` on `dev`, and add a required reviewer on `prod`.

## Security

- **No static AWS credentials.** GitHub Actions gets short-lived credentials through OIDC. The deploy role trusts only `main`-branch jobs and the `dev`/`prod` environment jobs, so pull requests never receive AWS credentials.
- **No privilege escalation from CI.** The deploy role can create IAM roles only if they carry the `cloudcart-workload-boundary` permissions boundary. It also can't detach or edit that boundary.
- **Least-privilege Lambda roles.** Each function gets only the DynamoDB actions it uses, on its own tables, and log permissions on its own log group. For example, the orders role has no EventBridge access, and the cart role can only read `products`.
- **Identity from the token.** Cart and order operations take the user ID from the verified JWT, never from the request. Staff rights come from the token's `cognito:groups` claim and are checked against the request's business on every staff call.
- **Private storefront bucket.** The site bucket blocks all public access. CloudFront reads it through Origin Access Control, and the bucket policy admits only that one distribution. CloudFront adds standard security headers (HSTS, `nosniff`, frame and referrer policies) to pages and API responses, and AWS Shield Standard DDoS protection to both.
- **Cost alarm.** An account-wide AWS Budgets alert (in `bootstrap/`) emails at 80% of a $10 monthly limit and when the month is forecast to pass it. With no WAF, it's the backstop against a flood of valid requests that throttling alone wouldn't make free.
- **Pinned Actions.** Third-party Actions are pinned to commit SHAs, and checkout doesn't persist credentials.

## Monitoring

Alarms publish to a `cloudcart-<env>-ops-alerts` SNS topic, which is separate from the customer-facing order notifications.

| Alarm | Why it exists |
| --- | --- |
| Lambda `Errors` > 0 (per function) | Any unhandled exception |
| Lambda `Throttles` > 0 (per function) | Concurrency limit reached; requests are being dropped |
| API `5xx` > 0 | Server-side failures callers can see |
| API 4xx rate | Rising client errors, measured as a rate so a few 401s on a quiet API don't page anyone |
| API p99 latency | The slowest 1% of requests are degrading |
| Order queue backlog / oldest message age | Inventory processing is falling behind |
| DLQ messages > 0 | An order failed 5 times and won't finish on its own |
| Pipe `ExecutionFailed` | Orders are being written but their events aren't being published |
| Rule `FailedInvocations` | EventBridge couldn't deliver to SQS or SNS |

A CloudWatch dashboard (`terraform output dashboard_url`) charts these metrics plus DynamoDB consumed capacity. There are four saved Logs Insights queries: `errors`, `order-timeline`, `inventory-outcomes` and `lambda-performance`. Every Lambda writes one JSON object per log line with `requestId`, `traceId` and `coldStart`, plus `userId` and `orderId` where they're known, so one Logs Insights query can follow an order across the functions that touch it. X-Ray active tracing is on for every Lambda, and the DynamoDB client is instrumented so each table call appears as its own subsegment.

## Cost

Nothing in the design bills while it sits idle:

- DynamoDB on-demand capacity: no provisioned throughput to pay for at demo traffic.
- ARM64 Lambdas: about 20% cheaper per GB-second than x86.
- HTTP API instead of REST API: about 70% cheaper per request, with a free native JWT authorizer.
- No VPC, so no NAT gateway. Every service is reached through its public AWS endpoint.
- A static storefront on S3 + CloudFront instead of a server: CloudFront's always-free tier covers 1 TB and 10 million requests a month.
- Pickup holds expire through one-time EventBridge Scheduler schedules, whose free tier covers 14 million invocations a month, instead of a process polling for expired holds.
- Catalog caching at CloudFront instead of DAX or ElastiCache, which bill per node-hour even when idle. Cached catalog requests never reach API Gateway or Lambda.
- No provisioned concurrency or custom domain.

## Production hardening I deliberately left out

This is an interview project built to production standards, not a running business, so a few things that cost money every month, or need a real business behind them, are documented here rather than built. Each one has a clear next step.

| Left out | Why | What production would do |
| --- | --- | --- |
| **AWS WAF** | WAF bills a fixed monthly charge per web ACL and per rule, plus a fee per request: more than everything else here costs at demo traffic. | Attach a web ACL to the CloudFront distribution with the AWS managed core and known-bad-inputs rule groups and a rate-based rule per IP. Today the compensating controls are Shield Standard (free with CloudFront), the API stage's throttling, short edge caching of the public catalog, and the AWS Budgets alert. |
| **Custom domain, and closing the API's default endpoint** | Needs a registered domain. Until there is one, the `execute-api` URL stays public for local development (CORS only restricts browsers). | A Route 53 domain with an ACM certificate on CloudFront, then `disable_execute_api_endpoint` on the HTTP API, so all traffic passes through CloudFront (and WAF). |
| **Multi-region disaster recovery** | DynamoDB global tables resolve concurrent writes with last-writer-wins. Two regions could each decrement the same stock row and both succeed, overselling the last unit, which is exactly what the conditional writes here exist to prevent. | Keep each business's stock writes in one home region, replicate read-only to a standby, and fail over deliberately (Route 53 health checks plus a runbook) rather than run active-active. Recovery objectives would be agreed with the retailer first. |
| **IAM-enforced tenant isolation** | Isolation is enforced in code today: every key is built by one helper that takes the tenant first, and integration tests prove it. | Per-request credentials scoped with `dynamodb:LeadingKeys` to the caller's `tenantId` (a token-vending role assumed with session tags), so even a bug in a handler couldn't read another business's partition. |
| **One very large business** | Each business is one partition key per table, which DynamoDB serves up to about 1,000 writes and 3,000 reads a second. That's plenty for a small or medium retailer. | Shard a large tenant's key (`tenantId#n`) or give it its own tables (silo tier). |
| **Tenant onboarding** | The two businesses are seeded by Terraform. | Self-service sign-up that creates the tenant, its locations and its staff group, plus per-business custom domains. |
| **Payments** | Out of scope for the inventory and fulfilment problem this project is about. | Stripe Connect, so each business is paid directly, with the order moving to `RESERVED` only after payment authorises. |
| **Shipping addresses and carriers** | Same. | An address on `SHIP` orders and a carrier integration for labels and tracking. |
| **Real notifications** | The notifications Lambda logs what it would send. | SES email and SNS SMS: "ready for pickup", "your hold ends tomorrow". |
| **POS integration** | Stock changes made at a till don't reach the `stock` table. | Sync from the retailer's POS through its webhooks into the same conditional stock writes. |
| **Order changes** | No customer cancellation, and an order line is always filled from one location. | A cancel route that reuses the expiry Lambda's restock transaction, and line splitting across locations in the allocation rule. |
