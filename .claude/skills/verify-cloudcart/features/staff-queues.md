# Staff queues

`/staff`, visible only to members of `staff-<tenantId>`: a store's pickup queue, or the business's shipping queue, oldest first, with one next-step button per order.

## Sub-features

- Queue picker: `main select`, with "Pickups at <store>" per store, plus "Shipping" (value `SHIP`). It opens on My store, else the first pickup store, else Shipping. Refresh button. An empty queue reads "Nothing waiting in this queue."
- Cards: order ID, status badge, placed time, "held until <time>", and an "in store at …" note for in-store sales. Each line reads "Transfer from <location>" in amber, "On the shelf here", or "From <location>".
- Buttons: Mark ready (pickup, RESERVED) → READY FOR PICKUP; Mark picked up (READY) → FULFILLED; Mark shipped (SHIP, RESERVED) → FULFILLED. Picked up and shipped both take the card off the queue. A button reads "Saving..." and is disabled while its request runs, and the queue reloads after every action, success or failure.
- Non-staff see "This page is for this store's staff". The API answers them 404, including staff of another business. Signed-out users are sent to `/login`, and the API answers them 401.
- API behaviour the page doesn't use: an optional `?status=` filter, 400 `INVALID_QUEUE` for an unknown queue or a store without pickup, and 404 `ORDER_NOT_FOUND` for an unknown order.

## How to get to it (user POV)

Sign in as staff and click Staff in the navbar.

## Driving it with drive.mjs

- `pickup-collect`: Downtown queue, Mark ready, then Mark picked up.
- `ship`: Shipping queue, Mark shipped.

After each press, the order row's `status` in DynamoDB is checked. Screenshots are taken before each action and of the queue afterwards.

## Gotchas

- Other people's and CI's orders share these queues in dev. Journeys find their own card by order ID, so they're unaffected, but screenshots may show extra cards.
- A second press on a stale card gets a 409, shown as "Someone already moved this order - refresh the queue." No journey drives this yet. To check it, open the same queue in two tabs and press the same card in each.
