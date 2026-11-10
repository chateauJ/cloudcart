// Records the README demo: a real browser session against a running storefront (npm run build &&
// npm run preview, pointed at dev by npm run env:dev). Headless Chrome is driven over the DevTools
// protocol with no extra packages; ffmpeg turns the captured frames into an MP4 and a GIF.
//
// Usage: npm run demo:record
// Needs:  Google Chrome, ffmpeg, and .env.demo with CLOUDCART_DEMO_EMAIL / CLOUDCART_DEMO_PASSWORD
//         for a confirmed user in the target Cognito pool (never committed - .env* is gitignored)

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(FRONTEND_DIR, "..", "docs", "demo");
const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:3000"; // the only origin dev's CORS allows
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTH = 1280;
const HEIGHT = 800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadCredentials() {
  const file = join(FRONTEND_DIR, ".env.demo");
  const vars = existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => line.includes("=") && !line.startsWith("#"))
          .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
      )
    : {};
  const email = process.env.CLOUDCART_DEMO_EMAIL ?? vars.CLOUDCART_DEMO_EMAIL;
  const password = process.env.CLOUDCART_DEMO_PASSWORD ?? vars.CLOUDCART_DEMO_PASSWORD;
  if (!email || !password) throw new Error("Set CLOUDCART_DEMO_EMAIL and CLOUDCART_DEMO_PASSWORD in .env.demo");
  return { email, password };
}

// Minimal DevTools protocol client over Node's built-in WebSocket
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const call = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
        else call.resolve(msg.result);
      } else {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    };
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`Could not connect to ${url}`));
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  on(method, fn) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]);
  }
}

async function launchChrome(profileDir) {
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  // Chrome writes the port it picked to DevToolsActivePort once it is listening
  const portFile = join(profileDir, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error(`Chrome did not start (${CHROME})`);
  const port = readFileSync(portFile, "utf8").split("\n")[0];

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  return { chrome, cdp: await Cdp.connect(page.webSocketDebuggerUrl) };
}

// Headless Chrome has no visible pointer, so each page draws one that follows real mouse events
const CURSOR_SCRIPT = `(() => {
  const ensure = () => {
    let el = document.getElementById("__demo_cursor");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_cursor";
      el.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 2.5l14 9.2-6.3 1.3-3.6 5.9z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      el.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;margin:-3px 0 0 -5px";
      document.documentElement.appendChild(el);
    }
    return el;
  };
  addEventListener("mousemove", (e) => {
    ensure().style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)";
  }, true);
  addEventListener("mousedown", (e) => {
    const ring = document.createElement("div");
    ring.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;width:36px;height:36px;border-radius:50%;" +
      "background:rgba(59,130,246,.35);left:" + (e.clientX - 18) + "px;top:" + (e.clientY - 18) + "px;transition:transform .45s,opacity .45s";
    document.documentElement.appendChild(ring);
    requestAnimationFrame(() => { ring.style.transform = "scale(1.8)"; ring.style.opacity = "0"; });
    setTimeout(() => ring.remove(), 500);
  }, true);
})();`;

class Browser {
  constructor(cdp) {
    this.cdp = cdp;
    this.x = WIDTH / 2;
    this.y = HEIGHT / 2;
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.exception?.description}`);
    return result.value;
  }

  async waitFor(expression, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(`!!(${expression})`).catch(() => false)) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async goto(path) {
    const loaded = new Promise((resolve) => this.cdp.on("Page.loadEventFired", resolve));
    await this.cdp.send("Page.navigate", { url: `${BASE_URL}${path}` });
    await loaded;
    await sleep(800); // let React hydrate before interacting
    await this.mouseEvent("mouseMoved"); // redraw the cursor on the new document
  }

  mouseEvent(type, extra = {}) {
    return this.cdp.send("Input.dispatchMouseEvent", { type, x: this.x, y: this.y, ...extra });
  }

  // Glides the pointer to (x, y) with ease-in-out, the way a person moves a mouse
  async moveTo(x, y, durationMs = 650) {
    const [fromX, fromY] = [this.x, this.y];
    const steps = Math.max(8, Math.round(durationMs / 16));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      this.x = fromX + (x - fromX) * ease;
      this.y = fromY + (y - fromY) * ease;
      await this.mouseEvent("mouseMoved");
      await sleep(16);
    }
  }

  // Scrolls the element into view if needed and returns its centre in viewport coordinates
  async locate(expression) {
    await this.waitFor(expression);
    const offscreen = await this.evaluate(`(() => {
      const r = (${expression}).getBoundingClientRect();
      return r.top < 70 || r.bottom > innerHeight - 20;
    })()`);
    if (offscreen) {
      await this.evaluate(`(${expression}).scrollIntoView({ block: "center", behavior: "smooth" })`);
      await sleep(900);
    }
    return this.evaluate(`(() => {
      const r = (${expression}).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  }

  async click(expression, { pauseMs = 250 } = {}) {
    const { x, y } = await this.locate(expression);
    await this.moveTo(x, y);
    await sleep(pauseMs);
    await this.mouseEvent("mousePressed", { button: "left", clickCount: 1 });
    await sleep(70);
    await this.mouseEvent("mouseReleased", { button: "left", clickCount: 1 });
  }

  async type(text, delayMs = 70) {
    for (const ch of text) {
      await this.cdp.send("Input.insertText", { text: ch });
      await sleep(delayMs + Math.random() * 40);
    }
  }

  async press(key, code, keyCode) {
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
  }

  async scrollTo(top, settleMs = 1400) {
    await this.evaluate(`window.scrollTo({ top: ${top}, behavior: "smooth" })`);
    await sleep(settleMs);
  }
}

// Expression for the first visible element matching a selector whose text is `text` (or starts
// with "`text` ", so "Cart" matches "Cart (2)")
const byText = (selector, text) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => {
    const t = el.textContent.trim();
    return (t === ${JSON.stringify(text)} || t.startsWith(${JSON.stringify(text + " ")})) && el.offsetParent !== null;
  })`;
const bySelector = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
// trailingSlash: true serves /products as /products/, so compare without it
const path = (expected) => `location.pathname.replace(/(.)\\/$/, "$1") === ${JSON.stringify(expected)}`;
// Product links are /product?id=<id> (written with or without the trailing slash)
const productLink = (id) => `a[href*="?id=${id}"]`;

async function logIn(b, { email, password }) {
  await b.click(byText("header a", "Log in"));
  await b.waitFor(path("/login"));
  await sleep(600);
  await b.click(bySelector("#email"));
  await b.type(email);
  await b.click(bySelector("#password"));
  await b.type(password, 25);
  await b.click(byText("form button", "Log in"));
  await b.waitFor(`${path("/products")} && ${byText("header a", "Orders")}`);
}

// Off camera: empties a cart a failed earlier run may have left, so every take starts the same
async function resetCart(b, credentials) {
  await b.goto("/products");
  await logIn(b, credentials);
  await b.goto("/cart");
  await b.waitFor(`${byText("h1", "Your cart")}`);
  await sleep(1000);
  while (await b.evaluate(`!!(${byText("button", "Remove")})`)) {
    await b.evaluate(`(${byText("button", "Remove")}).click()`);
    await sleep(1200);
  }
  await b.evaluate(`(${byText("header button", "Log out")}).click()`);
  await b.waitFor(path("/login"));
}

async function demo(b, credentials) {
  // A shopper lands on the catalog, which the Products API serves from DynamoDB
  await b.goto("/products");
  await b.waitFor(bySelector(productLink("prod_012")));
  await sleep(1800);
  await b.moveTo(640, 420, 900);
  await b.scrollTo(720, 1800);
  await b.scrollTo(0, 1400);

  // Cognito sign-in (SRP - the password never leaves the browser)
  await logIn(b, credentials);
  await sleep(1200);

  // Two products into the cart
  await b.click(bySelector(productLink("prod_003")));
  await b.waitFor(byText("button", "Add to cart"));
  await sleep(1500);
  await b.click(byText("button", "Add to cart"));
  await b.waitFor(byText("button", "Added ✓"));
  await sleep(1300);

  await b.click(byText("header a", "Products"));
  await b.waitFor(path("/products"));
  await sleep(900);
  await b.click(bySelector(productLink("prod_010")));
  await b.waitFor(byText("button", "Add to cart"));
  await sleep(1300);
  await b.click(byText("button", "Add to cart"));
  await b.waitFor(byText("header a", "Cart (2)"));
  await sleep(1300);

  // Cart: bump the charger to 2
  await b.click(byText("header a", "Cart"));
  await b.waitFor(bySelector(productLink("prod_010")));
  await sleep(1500);
  const chargerQty = `document.querySelector('${productLink("prod_010")}').closest(".py-4").querySelector("input")`;
  await b.click(chargerQty);
  await b.evaluate(`(${chargerQty}).select()`);
  await sleep(300);
  await b.type("2");
  await b.press("Enter", "Enter", 13);
  await b.waitFor(byText("header a", "Cart (3)"));
  await sleep(1800);

  // Checkout: the Orders API writes the order PENDING and returns at once
  await b.click(byText("a", "Checkout"));
  await b.waitFor(byText("button", "Place order"));
  await sleep(1800);
  await b.click(byText("button", "Place order"));

  // DynamoDB Streams -> EventBridge Pipe -> SQS -> Inventory Lambda reserves its stock a few seconds later
  await b.waitFor(path("/order"));
  await b.waitFor(byText("span", "RESERVED"), 60_000);
  await sleep(3000);

  await b.click(byText("a", "← Back to orders"));
  await b.waitFor(byText("h1", "Your orders"));
  await sleep(3500);
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (result.error) throw new Error("ffmpeg not found - brew install ffmpeg");
  if (result.status !== 0) throw new Error(`ffmpeg exited with ${result.status}`);
}

async function main() {
  const credentials = loadCredentials();
  const res = await fetch(`${BASE_URL}/products`).catch(() => null);
  if (!res?.ok) throw new Error(`No storefront at ${BASE_URL} - run npm run build && npm run preview first`);

  const workDir = mkdtempSync(join(tmpdir(), "cloudcart-demo-"));
  const framesDir = join(workDir, "frames");
  mkdirSync(framesDir);
  const { chrome, cdp } = await launchChrome(join(workDir, "profile"));

  try {
    const b = new Browser(cdp);
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: CURSOR_SCRIPT });

    console.log("Resetting the demo user's cart...");
    await resetCart(b, credentials);

    // Screencast frames arrive only when the page repaints, so each is stamped with its arrival
    // time and held on screen until the next one
    const frames = [];
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      const file = `${String(frames.length).padStart(5, "0")}.jpg`;
      writeFileSync(join(framesDir, file), Buffer.from(data, "base64"));
      frames.push({ file, at: Date.now() });
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });

    console.log("Recording...");
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: WIDTH, maxHeight: HEIGHT });
    await demo(b, credentials);
    const endedAt = Date.now();
    await cdp.send("Page.stopScreencast");

    const list = frames.map((f, i) => {
      const next = i + 1 < frames.length ? frames[i + 1].at : endedAt;
      return `file '${join(framesDir, f.file)}'\nduration ${((next - f.at) / 1000).toFixed(3)}`;
    });
    // The concat demuxer ignores the last entry's duration unless the file is listed again
    list.push(`file '${join(framesDir, frames.at(-1).file)}'`);
    writeFileSync(join(workDir, "frames.txt"), list.join("\n") + "\n");
    console.log(`Captured ${frames.length} frames over ${((endedAt - frames[0].at) / 1000).toFixed(1)}s`);

    mkdirSync(OUT_DIR, { recursive: true });
    const mp4 = join(OUT_DIR, "cloudcart-demo.mp4");
    const gif = join(OUT_DIR, "cloudcart-demo.gif");
    ffmpeg([
      "-f", "concat", "-safe", "0", "-i", join(workDir, "frames.txt"),
      "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "slow",
      "-movflags", "+faststart", mp4,
    ]);
    // A per-video palette keeps the GIF's text sharp; diff mode only redraws what changed
    ffmpeg([
      "-i", mp4,
      "-vf", "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];" +
        "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
      gif,
    ]);
    console.log(`Wrote ${mp4}\nWrote ${gif}`);
  } finally {
    chrome.kill();
    await sleep(300);
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
