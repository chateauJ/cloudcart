# Product stock by location

`/product?id=<productId>` lists every location with its quantity. When My store is chosen (and still takes pickups), that store is listed first and labelled "Your store". The page also shows the total across all locations. The quantity picker's maximum is the largest single location's stock, capped at 99, because one order line is filled from one location.

## Sub-features

- Rows: name, label (Your store / Store / Warehouse), and "N in stock" or "None".
- Total: "N in stock across all locations", or "Out of stock" when the total is 0.
- Add to cart, capped at the per-line maximum, at most 99; a disabled "Out of stock" button when the total is 0.
- Signed out, the button reads "Log in to buy" and goes to `/login`.
- An unknown ID shows "This product doesn't exist."

## How to get to it (user POV)

Click any product card in the grid.

## Driving it with drive.mjs

`catalog` opens a product that Downtown lacks but another location holds. The proof is a row containing "Downtown", "Your store" and "None", the total text matching the API's sum, and the screenshot `NN-product-stock-by-location.png`.

## Gotchas

- The product IDs in the URL are per tenant. The same ID at `tidewater` is a different item.
- If `GET /locations` fails, the stock table is hidden entirely. Stock rows for a location not in `/locations` count toward the total but get no row.
- The product-page half of `catalog` is skipped when no product has zero Downtown stock and some stock elsewhere. The run log then shows only the grid checks.
