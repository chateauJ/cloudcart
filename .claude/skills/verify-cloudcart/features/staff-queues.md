# Staff queues

`/staff`, visible only to members of `staff-<tenantId>`: a store's pickup queue, or the business's shipping queue, oldest first, with one next-step button per order.

## Sub-features

- Queue picker: `main select`, with "Pickups at <store>" per store, plus "Shipping" (value `SHIP`). Refresh button.
- Cards: order ID, status badge, placed time, hold deadline, and an "in store at …" note for in-store sales. Each line reads "Transfer from <location>" in amber, "On the shelf here", or "From <location>".
- Buttons: Mark ready (pickup, RESERVED) → READY FOR PICKUP; Mark picked up (READY) → FULFILLED, which removes the card from the queue; Mark shipped (SHIP, RESERVED) → FULFILLED.
- Non-staff see "This page is for this store's staff". The API answers them 404.

## How to get to it (user POV)

Sign in as staff and click Staff in the navbar.

## Driving it with drive.mjs

- `pickup-collect`: Downtown queue, Mark ready, then Mark picked up.
- `ship`: Shipping queue, Mark shipped.

After each press, the order row's `status` in DynamoDB is checked. Screenshots are taken before each action and of the queue afterwards.

## Gotchas

- Other people's and CI's orders share these queues in dev. Journeys find their own card by order ID, so they're unaffected, but screenshots may show extra cards.
- A second press on a stale card gets a 409, shown as "Someone already moved this order - refresh the queue."
