# Product stock by location

`/product?id=<productId>` lists every location with its quantity. The shopper's own store is listed first and labelled "Your store". The page also shows the total across all locations, and the quantity picker's maximum is the largest single location's stock, because one order line is filled from one location.

## Sub-features

- Rows: name, label (Your store / Store / Warehouse), and "N in stock" or "None".
- Total: "N in stock across all locations".
- Add to cart, capped at the per-line maximum; "Out of stock" when the total is 0.

## How to get to it (user POV)

Click any product card in the grid.

## Driving it with drive.mjs

`catalog` opens a product that Downtown lacks but another location holds. The proof is a row containing "Downtown", "Your store" and "None", the total text matching the API's sum, and the screenshot `NN-product-stock-by-location.png`.

## Gotchas

- The product IDs in the URL are per tenant. The same ID at `tidewater` is a different item.
- If every product is stocked at Downtown, the product-page half of `catalog` is skipped, and the run log shows only the grid checks.
