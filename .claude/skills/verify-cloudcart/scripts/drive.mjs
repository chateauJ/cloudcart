// Drives the CloudCart storefront in headless Chrome (DevTools protocol, no packages) the way a
// shopper and a staff member would, and checks the real side effects in dev's DynamoDB.
//
// Usage: node .claude/skills/verify-cloudcart/scripts/drive.mjs <journey> [--base <url>]
//   journeys: catalog | pickup-collect | ship
//   --base defaults to http://localhost:3000 (launch.sh). The hosted dev site (terraform output
//   site_url) also works, but serves the last *deployed* frontend, not your working tree.
// Evidence: .verify/evidence/<timestamp>-<journey>/ - NN-<step>.png per step, log.md, result.json.
// Exit 0 = every check passed; 1 = a check failed (see log.md and the last screenshot).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
const DEV = join(ROOT, "infrastructure", "environments", "dev");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TENANT = "northlight";
const PICKUP_STORE = "store_downtown";

const args = process.argv.slice(2);
const journey = args[0];
const base = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3000").replace(/\/+$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- dev stack lookups (read-only) ----------
const output = (name) => spawnSync("terraform", [`-chdir=${DEV}`, "output", "-raw", name], { encoding: "utf8" }).stdout.trim();
const API = output("api_endpoint");
const ORDERS_TABLE = output("orders_table_name");
const STOCK_TABLE = output("stock_table_name");

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: { "X-Tenant-Id": TENANT } });
  return res.json();
}
function ddbGet(table, key) {
  const r = spawnSync("aws", ["dynamodb", "get-item", "--table-name", table, "--key", JSON.stringify(key), "--region", "us-east-1", "--output", "json"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`aws dynamodb get-item failed: ${r.stderr}`);
  return JSON.parse(r.stdout || "{}").Item;
}
const stockAt = (productId, locationId) =>
  Number(ddbGet(STOCK_TABLE, { tenantId: { S: TENANT }, stockKey: { S: `${productId}#${locationId}` } })?.quantity?.N ?? 0);
const orderItem = (orderId) => ddbGet(ORDERS_TABLE, { tenantId: { S: TENANT }, orderId: { S: orderId } });

function credentials() {
  const file = join(ROOT, "frontend", ".env.demo");
  const vars = Object.fromEntries(
    readFileSync(file, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  return { email: vars.CLOUDCART_DEMO_EMAIL, password: vars.CLOUDCART_DEMO_PASSWORD };
}

// ---------- evidence ----------
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${journey}`;
const EVIDENCE = join(ROOT, ".verify", "evidence", runId);
let stepNo = 0;
const result = { journey, base, api: API, checks: [], passed: false };
function log(line) {
  console.log(line);
  appendFileSync(join(EVIDENCE, "log.md"), `${line}\n`);
}
function check(name, ok, detail = "") {
  result.checks.push({ name, ok, detail });
  log(`${ok ? "- [x]" : "- [ ] FAILED:"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) throw new Error(`check failed: ${name}`);
}

// ---------- browser ----------
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      else for (const fn of this.listeners.get(m.method) ?? []) fn(m.params);
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method) { return new Promise((resolve) => this.listeners.set(method, [resolve])); }
}

let cdp;
const evaluate = async (expression) => {
  const { result: r, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.exception?.description}`);
  return r.value;
};
async function waitFor(expression, what, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(`!!(${expression})`).catch(() => false)) return;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function goto(path) {
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: `${base}${path}` });
  await loaded;
  await sleep(800); // React hydration
}
async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = `${String(++stepNo).padStart(2, "0")}-${name}.png`;
  writeFileSync(join(EVIDENCE, file), Buffer.from(data, "base64"));
  log(`  screenshot: ${file}`);
}
const byText = (sel, text) =>
  `[...document.querySelectorAll(${JSON.stringify(sel)})].find((el) => { const t = el.textContent.trim(); return (t === ${JSON.stringify(text)} || t.startsWith(${JSON.stringify(text + " ")})) && el.offsetParent !== null; })`;
const click = (expr) => evaluate(`(${expr}).click()`);
async function typeInto(selector, text) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await cdp.send("Input.insertText", { text });
}
// React reads a <select> change from the native value setter plus a bubbling change event
const select = (selector, value) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("change", { bubbles: true }));
})()`);
const staffCard = (orderId) => `[...document.querySelectorAll("div.rounded-lg")].find((el) => el.textContent.includes(${JSON.stringify(orderId)}))`;

// ---------- shared steps ----------
async function signIn() {
  const { email, password } = credentials();
  await goto("/login/");
  await waitFor(`document.querySelector("#email")`, "login form");
  await typeInto("#email", email);
  await typeInto("#password", password);
  await click(byText("form button", "Log in"));
  await waitFor(byText("header a", "Orders"), "signed-in navbar");
  log("signed in as the demo user");
}
async function emptyCart() {
  await goto("/cart/");
  await waitFor(byText("h1", "Your cart"), "cart page");
  await sleep(1200);
  while (await evaluate(`!!(${byText("button", "Remove")})`)) { await click(byText("button", "Remove")); await sleep(1200); }
}
async function addToCart(productId) {
  await goto(`/product/?id=${productId}`);
  await waitFor(byText("button", "Add to cart"), "Add to cart button");
  await click(byText("button", "Add to cart"));
  await waitFor(byText("button", "Added ✓"), "added confirmation");
}
async function placeOrderAndWaitReserved() {
  await click(byText("button", "Place order"));
  await waitFor(`location.pathname.startsWith("/order")`, "order page");
  await waitFor(byText("span", "RESERVED"), "RESERVED badge", 60000);
  return evaluate(`document.querySelector("h1").textContent`);
}
async function staffAct(queue, orderId, buttonLabel, nextState) {
  await goto("/staff/");
  await waitFor(byText("h1", "Staff"), "staff page");
  await select("main select", queue);
  await waitFor(staffCard(orderId), `order in the ${queue} queue`);
  await shot(`staff-${queue}-before-${buttonLabel.toLowerCase().replace(/ /g, "-")}`);
  await waitFor(`(${staffCard(orderId)}).querySelector("button")?.textContent === ${JSON.stringify(buttonLabel)}`, `${buttonLabel} button`);
  await click(`(${staffCard(orderId)}).querySelector("button")`);
  await waitFor(nextState(staffCard(orderId)), `state after ${buttonLabel}`);
}

// ---------- journeys ----------
const journeys = {
  // Catalog + My store: availability text and the product page agree with the API's stock
  async catalog() {
    const products = await api("/products");
    const target = products.find((p) => p.stock.every((l) => l.locationId !== PICKUP_STORE || l.quantity === 0) && p.stock.some((l) => l.quantity > 0));
    await goto("/products/");
    await waitFor(`document.querySelector('a[href*="?id="]')`, "product grid");
    const cards = await evaluate(`document.querySelectorAll('a[href*="?id="]').length`);
    check("grid shows every product the API lists", cards === products.length, `${cards} cards, ${products.length} products`);
    await select("header select", PICKUP_STORE);
    await waitFor(byText("span", "Not at Downtown"), "My store availability");
    await shot("catalog-my-store-downtown");
    if (target) {
      await goto(`/product/?id=${target.productId}`);
      await waitFor(byText("span", "Your store"), "stock by location table");
      const rows = await evaluate(`[...document.querySelectorAll("div.rounded-lg > div")].map((d) => d.textContent)`);
      const total = target.stock.reduce((s, l) => s + l.quantity, 0);
      check("product page names Downtown as Your store with none", rows.some((r) => r.includes("Downtown") && r.includes("Your store") && r.includes("None")));
      check("product page total matches the API", await evaluate(`document.body.textContent.includes("${total} in stock across all locations")`), `${target.productId}: ${total}`);
      await shot("product-stock-by-location");
    }
  },

  // Pickup at Downtown of stock Downtown doesn't have -> transfer, hold, staff ready + picked up
  async "pickup-collect"() {
    const products = await api("/products");
    const product = products
      .filter((p) => (p.stock.find((l) => l.locationId === PICKUP_STORE)?.quantity ?? 0) === 0)
      .find((p) => p.stock.some((l) => l.quantity >= 1));
    if (!product) throw new Error("seed precondition: no product is out at Downtown but in stock elsewhere");
    log(`product ${product.productId} (${product.name}): ${product.stock.map((l) => `${l.locationId}=${l.quantity}`).join(", ")}`);
    const before = Object.fromEntries(product.stock.map((l) => [l.locationId, stockAt(product.productId, l.locationId)]));

    await signIn();
    await emptyCart();
    await addToCart(product.productId);
    await goto("/checkout/");
    await waitFor(`document.querySelector('input[name="fulfillment"]')`, "fulfillment choice");
    await click(`document.querySelector('input[name="fulfillment"]')`); // Pick up in store
    await select("fieldset select", PICKUP_STORE);
    await waitFor(byText("span", "Transferred to Downtown from another location"), "transfer preview");
    await shot("checkout-pickup-downtown");
    const orderId = await placeOrderAndWaitReserved();
    log(`order ${orderId} RESERVED`);
    await waitFor(`document.body.textContent.includes("Held for you until")`, "hold deadline");
    await shot("order-reserved-with-hold");

    const order = orderItem(orderId);
    const line = order.items.L[0].M;
    const source = line.sourceLocationId.S;
    check("order is a PICKUP at Downtown", order.fulfillment.M.locationId.S === PICKUP_STORE);
    check("line is flagged needsTransfer from another location", line.needsTransfer.BOOL === true && source !== PICKUP_STORE, `source ${source}`);
    check("holdExpiresAt recorded", Boolean(order.holdExpiresAt?.S), order.holdExpiresAt?.S);
    check("stock at the source went down by 1", stockAt(product.productId, source) === before[source] - 1, `${before[source]} -> ${stockAt(product.productId, source)}`);

    await staffAct(PICKUP_STORE, orderId, "Mark ready", (c) => `(${c})?.textContent.includes("READY FOR PICKUP")`);
    check("staff Mark ready -> READY_FOR_PICKUP in DynamoDB", orderItem(orderId).status.S === "READY_FOR_PICKUP");
    await staffAct(PICKUP_STORE, orderId, "Mark picked up", (c) => `!(${c})`);
    await shot("staff-queue-after-pickup");
    check("staff Mark picked up -> FULFILLED in DynamoDB", orderItem(orderId).status.S === "FULFILLED");

    await goto(`/order/?id=${encodeURIComponent(orderId)}`);
    await waitFor(byText("span", "FULFILLED"), "FULFILLED badge");
    check("shopper's order page says Collected", await evaluate(`document.body.textContent.includes("Collected")`));
    await shot("order-collected");
  },

  // Ship -> warehouse first -> staff ships from the shipping queue
  async ship() {
    const products = await api("/products");
    const product = [...products].sort((a, b) =>
      (b.stock.find((l) => l.locationId === "warehouse_main")?.quantity ?? 0) - (a.stock.find((l) => l.locationId === "warehouse_main")?.quantity ?? 0))[0];
    const before = stockAt(product.productId, "warehouse_main");
    if (before < 1) throw new Error("seed precondition: no product has warehouse stock");
    log(`product ${product.productId} (${product.name}): warehouse_main=${before}`);

    await signIn();
    await emptyCart();
    await addToCart(product.productId);
    await goto("/checkout/");
    await waitFor(`document.querySelectorAll('input[name="fulfillment"]').length === 2`, "fulfillment choice");
    await click(`document.querySelectorAll('input[name="fulfillment"]')[1]`); // Ship to me
    await sleep(300);
    await shot("checkout-ship");
    const orderId = await placeOrderAndWaitReserved();
    log(`order ${orderId} RESERVED`);
    await shot("order-reserved-ship");

    const order = orderItem(orderId);
    check("order is a SHIP order with no hold", order.fulfillment.M.type.S === "SHIP" && !order.holdExpiresAt);
    check("line came from the warehouse", order.items.L[0].M.sourceLocationId.S === "warehouse_main");
    check("warehouse stock went down by 1", stockAt(product.productId, "warehouse_main") === before - 1, `${before} -> ${stockAt(product.productId, "warehouse_main")}`);

    await staffAct("SHIP", orderId, "Mark shipped", (c) => `!(${c})`);
    check("staff Mark shipped -> FULFILLED in DynamoDB", orderItem(orderId).status.S === "FULFILLED");
    await goto(`/order/?id=${encodeURIComponent(orderId)}`);
    await waitFor(byText("span", "FULFILLED"), "FULFILLED badge");
    check("shopper's order page says Shipped", await evaluate(`document.body.textContent.includes("Shipped")`));
    await shot("order-shipped");
  },
};

// ---------- main ----------
if (!journeys[journey]) {
  console.error(`usage: node drive.mjs <${Object.keys(journeys).join("|")}> [--base <url>]`);
  process.exit(2);
}
mkdirSync(EVIDENCE, { recursive: true });
log(`# verify-cloudcart: ${journey}\n\nbase ${base}, dev API ${API}, ${new Date().toISOString()}\n`);

const profile = mkdtempSync(join(tmpdir(), "verify-cloudcart-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1280,900", "--no-first-run", "about:blank"], { stdio: "ignore" });
try {
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

  await journeys[journey]();
  result.passed = true;
  log(`\nPASSED - evidence in ${EVIDENCE}`);
} catch (err) {
  await shot("failure").catch(() => {});
  log(`\nFAILED: ${err.message} - evidence in ${EVIDENCE}`);
  process.exitCode = 1;
} finally {
  writeFileSync(join(EVIDENCE, "result.json"), JSON.stringify(result, null, 2));
  chrome.kill();
  await sleep(500); // let Chrome release its profile before removing it
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}
