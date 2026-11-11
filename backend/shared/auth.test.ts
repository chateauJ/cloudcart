import { apiEvent } from "../test/helpers";
import { getGroups, isStaffOf } from "./auth";

function eventWithGroups(groups: unknown) {
  const event = apiEvent({ routeKey: "GET /staff/orders", userId: "user-1" });
  (event.requestContext as unknown as { authorizer: { jwt: { claims: Record<string, unknown> } } }).authorizer.jwt.claims[
    "cognito:groups"
  ] = groups;
  return event;
}

describe("getGroups", () => {
  it.each([
    ["the authorizer's flattened string", "[staff-northlight staff-tidewater]", ["staff-northlight", "staff-tidewater"]],
    ["a single flattened group", "[staff-northlight]", ["staff-northlight"]],
    ["a comma-separated string", "[staff-northlight,staff-tidewater]", ["staff-northlight", "staff-tidewater"]],
    ["a real array", ["staff-northlight", 42], ["staff-northlight"]],
    ["an empty claim", "[]", []],
    ["no claim at all", undefined, []],
  ])("reads %s", (_case, claim, expected) => {
    expect(getGroups(eventWithGroups(claim))).toEqual(expected);
  });

  it("reads nothing from a request without a verified token", () => {
    expect(getGroups(apiEvent({ routeKey: "GET /staff/orders" }))).toEqual([]);
  });
});

describe("isStaffOf", () => {
  it("is true only for the group named after the request's tenant", () => {
    const event = eventWithGroups("[staff-tidewater]");

    expect(isStaffOf(event, "tidewater")).toBe(true);
    expect(isStaffOf(event, "northlight")).toBe(false);
  });

  it("doesn't match a group that merely contains the tenant's name", () => {
    expect(isStaffOf(eventWithGroups("[staff-northlight-old]"), "northlight")).toBe(false);
  });
});
