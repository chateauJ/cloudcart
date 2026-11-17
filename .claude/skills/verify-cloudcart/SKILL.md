---
name: verify-cloudcart
description: Drive the CloudCart storefront (Next.js static export, served locally against the deployed dev AWS stack) the way a shopper and a store staff member do, and prove a change works with screenshots plus the real DynamoDB side effects. Use after changing the frontend, an API handler, allocation, holds or staff flows, or whenever asked to "verify", "prove it works", or "check it in the browser".
---

# verify-cloudcart

CloudCart has no local backend: the Lambdas, DynamoDB, Cognito and EventBridge only run in AWS. Verification serves the storefront **locally** from your working tree and points it at the **deployed dev stack**. So:

- A **frontend** change is verifiable straight away.
- A **backend or infrastructure** change is only verifiable after it reaches dev. Dev is deployed by CI on merge to `main`; agents never run `terraform apply`. Until then, cover it with unit tests and say the browser proof is pending the dev deploy.
- Every journey uses real dev data. Orders consume real stock, and fulfilled orders don't return it. Pickup holds that are never collected return stock about 10 minutes after the order.

All scripts run from anywhere in the repo. Paths below are relative to the repo root.

## Launch

```sh
sh .claude/skills/verify-cloudcart/scripts/launch.sh
```

1. Writes `frontend/.env.local` from the dev Terraform outputs (`npm run env:dev`).
2. Builds the static export; the build log goes to `.verify/build.log`.
3. Starts `frontend/scripts/serve-static.mjs` on **port 3000** and records its pid in `.verify/preview.pid`.

It is ready when it prints `READY http://localhost:3000 …`, which it does only after both `/products/` and the dev API's `GET /tenant` return 200.

If Next.js stops a build to print a security-upgrade advisory (`SecurityFatalError`), `launch.sh` retries once and says so. Report the advisory to the user. Never run the upgrade command that the message suggests without asking.

Port 3000 is the only origin dev's CORS allows, so **only one instance can run**. `launch.sh` refuses to start if port 3000 is taken by anything it didn't start, for example a `npm run dev` you left running. Stop that process rather than driving it.

It needs AWS credentials that can read the dev Terraform state, Node 24, and Google Chrome at `/Applications/Google Chrome.app` (or set `CHROME_PATH`).

## Doctor

```sh
sh .claude/skills/verify-cloudcart/scripts/doctor.sh
```

Read-only. Run it first, and again whenever anything looks off. It checks:
- AWS credentials are valid and the dev outputs are readable;
- our preview is running and owns port 3000;
- the build points at the *current* dev API;
- the storefront and the API both answer;
- `frontend/.env.demo` exists;
- the demo user is in `staff-northlight`.

Every line must say `ok`.

## Drive

```sh
node .claude/skills/verify-cloudcart/scripts/drive.mjs <journey> [--base <url>]
```

| Journey | Proves |
|---|---|
| `catalog` | Grid lists every product the API returns. Choosing My store = Downtown switches availability. The product page's per-location stock and total match the API. |
| `pickup-collect` | A product Downtown lacks is ordered for pickup at Downtown. The order reaches RESERVED with `needsTransfer`, a hold deadline, and the stock decremented at its source. Staff then mark it ready (READY_FOR_PICKUP) and picked up (FULFILLED), and the shopper's page says Collected. |
| `ship` | A shipping order is filled from `warehouse_main` and decrements it. Staff ship it from the SHIP queue (FULFILLED), and the shopper's page says Shipped. |

How the driver works:
- **Browser:** headless Chrome over the DevTools protocol, with no npm packages, in light mode at 1280×900. It signs in as the demo user from `frontend/.env.demo` (gitignored; `CLOUDCART_DEMO_EMAIL` / `CLOUDCART_DEMO_PASSWORD`). That user must be in the `staff-northlight` Cognito group.
- **Store:** it always drives the `northlight` store, which is what `NEXT_PUBLIC_TENANT_ID` is built for.
- **Handles:**
  - My store: `header select`
  - Login: `#email`, `#password`, then the form button "Log in"
  - Product links: `a[href*="?id=<productId>"]`
  - Fulfillment radios: `input[name="fulfillment"]` (pickup first, ship second)
  - Pickup store: `fieldset select`
  - Staff queue: `main select`, whose values are a store's location ID or `SHIP`
  - Staff order cards: `div.rounded-lg` containing the order ID
  - Buttons by visible text: Add to cart, Place order, Mark ready, Mark picked up, Mark shipped
- **Data:** journeys pick their product from live API data, so a stock-out at one product doesn't break them. If no product fits a journey's precondition, it fails with `seed precondition: …`. Report that; don't weaken the journey.
- **Hosted site:** `--base "$(terraform -chdir=infrastructure/environments/dev output -raw site_url)"` drives the hosted dev site. That serves the last *deployed* frontend, which is right for checking a deploy and wrong for checking your working tree.

For an API-only proof, use the integration suites in `backend/integration/` (see the root README, "Run the tests"). They run the same flows over HTTP.

## Evidence

Each run writes `.verify/evidence/<timestamp>-<journey>/`:
- `NN-<step>.png`, a screenshot of each action and the state it produced;
- `log.md`, the steps and every check with its observed values;
- `result.json`.

A failed run ends with `NN-failure.png`.

Proof standards:
- **Use the real user path.** That means clicking the UI as a shopper or staff member, never calling internal endpoints to set state.
- **Check side effects, not just screens.** The pickup and ship journeys read the order and stock rows from dev's DynamoDB with `aws dynamodb get-item`. A screen saying RESERVED while the stock didn't move is a failure.
- **Hand over the evidence folder.** It is gitignored and survives cleanup.

## Cleanup

```sh
sh .claude/skills/verify-cloudcart/scripts/cleanup.sh
```

Stops only the preview whose pid is in `.verify/preview.pid` (never by process name), and keeps `.verify/evidence/`. Run it after every run, including failed ones.

Data the journeys create in dev stays: fulfilled orders and the stock they used. To top up stock, raise the quantities in `infrastructure/modules/app/products.json` for new rows, or edit the row in the dev stock table.

## Feature map

[`features/README.md`](features/README.md) lists each user-facing feature, how to reach it, and how to drive it. A proof that drives one convenient entry point is incomplete when the map lists others. Keep the map current with `/pstack:maintain-verification-skill`.
