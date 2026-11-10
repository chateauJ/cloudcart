import { api, ApiResponse, Config, loadConfig, login } from "./client";

// The same API through the storefront's CloudFront distribution, which serves it under /api/*.
// Catalog routes are cached per store for a few seconds; every other route goes straight through.
// Runs only when CLOUDCART_SITE_URL is set - the deploy pipeline always sets it.

const siteUrl = process.env.CLOUDCART_SITE_URL?.replace(/\/+$/, "");
const describeEdge = siteUrl ? describe : describe.skip;

function cacheStatus(res: ApiResponse): string {
  return res.headers.get("x-cache") ?? ""; // e.g. "Hit from cloudfront", "Miss from cloudfront"
}

describeEdge("CloudFront edge (/api/*)", () => {
  let config: Config;
  let token: string;
  let edge: string;

  beforeAll(async () => {
    config = loadConfig();
    token = await login(config);
    edge = `${siteUrl}/api`;
  });

  it("answers a repeat catalog request from the edge cache", async () => {
    // The first request may be a miss; a repeat within the TTL is served without calling the API
    let res = await api(config, "GET", "/products", { baseUrl: edge });
    for (let attempt = 0; attempt < 3 && !/Hit from cloudfront/i.test(cacheStatus(res)); attempt++) {
      res = await api(config, "GET", "/products", { baseUrl: edge });
    }

    expect(res.status).toBe(200);
    expect(cacheStatus(res)).toMatch(/Hit from cloudfront/i);
  });

  it("caches each store separately, so one store's catalog is never served to another", async () => {
    // Warm the cache for this store, then ask for the other store's name and catalog
    await api(config, "GET", "/tenant", { baseUrl: edge });
    await api(config, "GET", "/tenant", { baseUrl: edge });

    const mine = await api(config, "GET", "/tenant", { baseUrl: edge });
    const theirs = await api(config, "GET", "/tenant", { baseUrl: edge, tenant: config.otherTenantId });
    const theirProducts = await api(config, "GET", "/products", { baseUrl: edge, tenant: config.otherTenantId });

    expect(mine.body.tenantId).toBe(config.tenantId);
    expect(theirs.body.tenantId).toBe(config.otherTenantId);
    expect(theirProducts.body.every((p: { tenantId: string }) => p.tenantId === config.otherTenantId)).toBe(true);
  });

  it("forwards the shopper's token on a signed-in GET and never caches the answer", async () => {
    await api(config, "GET", "/cart", { token, baseUrl: edge });
    const res = await api(config, "GET", "/cart", { token, baseUrl: edge });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tenantId: config.tenantId, items: expect.any(Array) });
    expect(cacheStatus(res)).not.toMatch(/Hit from cloudfront/i);
  });

  it("forwards a POST with its body and token", async () => {
    // An invalid quantity is rejected by the cart Lambda before any write, so this changes nothing
    const res = await api(config, "POST", "/cart/items", {
      token,
      baseUrl: edge,
      body: { productId: "prod_001", quantity: 0 },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
  });

  it("passes the API's JSON errors through rather than the storefront's 404 page", async () => {
    const res = await api(config, "GET", "/products/prod_does-not-exist", { baseUrl: edge });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("rejects a signed-in route without a token", async () => {
    const res = await api(config, "GET", "/cart", { baseUrl: edge });

    expect(res.status).toBe(401);
  });
});
