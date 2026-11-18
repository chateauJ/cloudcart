# Checkout: pickup or ship

`/checkout`: choose "Pick up in store" (with a store picker) or "Ship to me", then place the order. Staff also see an "In-store sale (staff)" checkbox.

## Sub-features

- Pickup is preselected when My store is set and still takes pickups; otherwise Ship is.
- The pickup radio, its store picker and the staff checkbox render only when the tenant has at least one pickup store. With none, only the Ship radio exists, which would break `drive.mjs`'s "first radio = pickup" assumption.
- With pickup, each line previews "On the shelf at <store>" or "Transferred to <store> from another location". This is a preview only; the inventory Lambda makes the real allocation.
- Place order → `POST /orders` with `{ fulfillment }`. The order starts PENDING, the cart is cleared, and the browser goes to `/order?id=…`.
- In-store sale, staff only: adds `channel: "IN_STORE", placedAtLocationId`. It has its own "at <store>" select outside the fieldset, defaulting to My store, else the first store.

## How to get to it (user POV)

Sign in, add items, open Cart, then click Checkout.

## Driving it with drive.mjs

- `pickup-collect` clicks the first `input[name="fulfillment"]` (pickup), sets `fieldset select` to `store_downtown`, and waits for the transfer preview.
- `ship` clicks the second radio.

Both place the order and wait for RESERVED. Screenshots: `checkout-pickup-downtown`, `checkout-ship`.

## Gotchas

- An empty cart shows "nothing to check out". The journeys empty the cart, then add one item.
- The in-store checkbox needs a fresh sign-in after the user is added to the staff group, because the group arrives in the token.
- The API enforces the rules itself and the page shows them as a red message:
  - 400 `INVALID_CHANNEL` for a non-staff in-store sale;
  - 400 `INVALID_LOCATION` for an unknown store;
  - 400 `INVALID_PICKUP_LOCATION` for a location that doesn't take pickups;
  - 400 `CART_EMPTY`;
  - 409 when the cart changed mid-checkout.
- The cart is cleared server-side, in the same transaction that writes the order. The page only refreshes it.
