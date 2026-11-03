import { context, logLines, orderCreatedMessage, snsEvent } from "../../test/helpers";
import { handler } from "./handler";

const detail = {
  orderId: "order_1",
  userId: "user-1",
  total: "329.99",
  createdAt: "2026-11-01T00:00:00.000Z",
};

describe("notifications handler", () => {
  it("logs one notification per OrderCreated message", async () => {
    await handler(snsEvent(orderCreatedMessage(detail)), context);

    expect(logLines()).toEqual([
      expect.objectContaining({
        level: "INFO",
        message: "order notification",
        notification: "Order order_1 received - total $329.99",
        snsMessageId: "sns-1",
        ...detail,
      }),
    ]);
  });

  it.each([
    ["not JSON", "not json"],
    ["no detail", JSON.stringify({ source: "cloudcart.orders" })],
    ["a missing orderId", orderCreatedMessage({ ...detail, orderId: undefined })],
    // Pipes delivers DynamoDB numbers as strings - a numeric total means the contract changed
    ["a numeric total", orderCreatedMessage({ ...detail, total: 329.99 })],
    ["a non-numeric total", orderCreatedMessage({ ...detail, total: "abc" })],
  ])("logs %s as unrecognized without throwing, so SNS doesn't retry it", async (_case, message) => {
    await expect(handler(snsEvent(message), context)).resolves.toBeUndefined();

    expect(logLines()).toEqual([
      expect.objectContaining({ level: "ERROR", message: "unrecognized notification", raw: message }),
    ]);
  });

  it("keeps processing the rest of the event after a bad record", async () => {
    await handler(snsEvent("not json", orderCreatedMessage(detail)), context);

    expect(logLines().map((line) => line.message)).toEqual(["unrecognized notification", "order notification"]);
  });
});
