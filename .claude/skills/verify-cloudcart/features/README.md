# CloudCart feature map

Each file covers one feature a shopper or staff member uses: what it is, how to reach it, how to drive it with `scripts/drive.mjs`, and what end state proves it works.

| Feature | Who | Driven by |
|---|---|---|
| [Catalog and My store](catalog-and-my-store.md) | shopper | `drive.mjs catalog` |
| [Product stock by location](product-stock.md) | shopper | `drive.mjs catalog` |
| [Checkout: pickup or ship](checkout.md) | shopper, staff | `drive.mjs pickup-collect`, `drive.mjs ship` |
| [Order status and holds](order-status.md) | shopper | `drive.mjs pickup-collect`, `drive.mjs ship` |
| [Staff queues](staff-queues.md) | staff | `drive.mjs pickup-collect`, `drive.mjs ship` |

Not driven yet:
- sign-up and confirmation, which need a real inbox for Cognito's code;
- the cart page's quantity edits and Remove (only used to empty the cart);
- in-store sales (the staff "In-store sale" checkbox);
- the second store, `tidewater` (`TENANT_ID=tidewater npm run env:dev`);
- hold expiry, which takes 10 minutes in dev. To check it, see [order-status.md](order-status.md).
