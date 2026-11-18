# Catalog and My store

The product grid at `/products`, and the "My store" selector in the bar under the navbar. Choosing a store switches each card's availability line from a total to what's on that store's shelf.

## Sub-features

- Grid of the tenant's products (`GET /products`, which includes `stock` per location), with category filter links All / Cameras / Phone Accessories. A filter is the `?category=` query parameter, applied in the browser; an empty category shows "No products in this category yet."
- My store: `header select`, listing pickup-enabled stores only. The choice is kept in localStorage under `cloudcart:<tenantId>:my-store`.
- Card availability:
  - no store chosen: "N in stock";
  - chosen store has it: "N at Downtown", in green;
  - chosen store doesn't: "Not at Downtown · N elsewhere";
  - nothing anywhere: "Out of stock". This wins even when a store is chosen.

## How to get to it (user POV)

Open the site. `/` redirects to `/products`. Pick a store from "My store", in the second row of the header at the top right.

## Driving it with drive.mjs

`node .claude/skills/verify-cloudcart/scripts/drive.mjs catalog`

Proof:
- the grid card count equals the API's product count;
- after selecting `store_downtown`, a "Not at Downtown" card appears;
- screenshot `NN-catalog-my-store-downtown.png`;
- the journey then opens a product Downtown lacks and checks its stock table (see [product-stock.md](product-stock.md)).

The "Not at Downtown" wait needs at least one product with no Downtown stock but stock elsewhere. If none exists, the journey fails with that reason.

## Gotchas

- Signed-out users see the grid too. The catalog is public.
- The hosted site serves the catalog from CloudFront's 30-second cache, so stock can lag after an order. The local preview calls the API directly and doesn't.
- A saved store that later stops taking pickups is ignored, and the selector shows "Choose a store".
- If `GET /locations` fails, or no store takes pickups, the selector isn't rendered at all and cards show totals only. The error is swallowed.
