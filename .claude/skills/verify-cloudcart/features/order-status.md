# Order status and holds

`/order?id=<orderId>` shows the status badge, how the order is being fulfilled, the hold deadline for a pickup, and where each line came from. It polls every 1.5 s while the order is PENDING, for at most 60 s; after that the page needs a reload.

## Sub-features

- Statuses:
  - pickup: PENDING → RESERVED → READY FOR PICKUP → FULFILLED;
  - shipment: PENDING → RESERVED → FULFILLED, never READY FOR PICKUP;
  - EXPIRED can follow RESERVED or READY FOR PICKUP;
  - FAILED shows the failureReason, e.g. "Not enough stock at any one location for one or more items".
- Pickup orders show "Pick up at <store>". While RESERVED they also show "Held for you until <time>", plus a transfer note when a line needsTransfer. While READY FOR PICKUP the banner reads "Ready at the <store> counter until <time>."
- Other banners:
  - PENDING: "Processing your order - stock is being reserved asynchronously."
  - RESERVED shipment: "Your items are set aside and will ship soon."
  - In-store sale: "Sold in store at <store>".
  - Missing order, or another user's: "Order not found."
- Each line shows "From <location>", with "· transfer to <store>" for transferred lines (pickup orders only).
- FULFILLED shows "Collected …" for a pickup or "Shipped …" for a shipment. EXPIRED explains that the items went back on sale.
- `/orders` lists the shopper's newest 50 orders, newest first.

## How to get to it (user POV)

Placing an order lands here. Later, open Orders in the navbar and click an order.

## Driving it with drive.mjs

`pickup-collect` and `ship` wait here for RESERVED, then check the order row in DynamoDB:
- `fulfillment`;
- `items[0].sourceLocationId` and `needsTransfer`;
- `holdExpiresAt` (pickup only);
- the stock row at the source, which must be down by 1.

They come back at the end for FULFILLED and Collected / Shipped.

## Gotchas

- **Hold expiry isn't journeyed**, because it takes `reservation_hold_minutes` (10 in dev). To prove it, place a pickup without collecting it, wait about 11 minutes, then check the order row reads `EXPIRED` and the source stock row is back up by the quantity:

  ```sh
  aws dynamodb get-item --table-name cloudcart-dev-orders --key '{"tenantId":{"S":"northlight"},"orderId":{"S":"ORDER_ID"}}' --query 'Item.status.S' --output text --region us-east-1
  ```

  The hold runs from the order's `createdAt`, not from when it was reserved, and the schedule fires at the later of the deadline and 60 s from reservation. Run `aws scheduler list-schedules --group-name cloudcart-dev-holds --region us-east-1` before expiry to see `hold-<orderId>`, and after to see it gone (it deletes itself).
- If an order stays PENDING, the async path is stuck. Check the order queue, the DLQ, and the inventory Lambda's logs.
