# Checkout: pickup or ship

`/checkout`: choose "Pick up in store" (with a store picker) or "Ship to me", then place the order. Staff also see an "In-store sale (staff)" checkbox.

## Sub-features

- Pickup is preselected when My store is set; otherwise Ship is.
- With pickup, each line previews "On the shelf at <store>" or "Transferred to <store> from another location". This is a preview only; the inventory Lambda makes the real allocation.
- Place order → `POST /orders` with `{ fulfillment }`. The order starts PENDING, the cart is cleared, and the browser goes to `/order?id=…`.
- In-store sale, staff only: adds `channel: "IN_STORE", placedAtLocationId`.

## How to get to it (user POV)

Sign in, add items, open Cart, then click Checkout.

## Driving it with drive.mjs

- `pickup-collect` clicks the first `input[name="fulfillment"]` (pickup), sets `fieldset select` to `store_downtown`, and waits for the transfer preview.
- `ship` clicks the second radio.

Both place the order and wait for RESERVED. Screenshots: `checkout-pickup-downtown`, `checkout-ship`.

## Gotchas

- An empty cart shows "nothing to check out". The journeys empty the cart, then add one item.
- The in-store checkbox needs a fresh sign-in after the user is added to the staff group, because the group arrives in the token.
