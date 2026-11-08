// Serves the static export (out/) the way CloudFront does, for checking a production build
// locally: /products and /products/ map to products/index.html, and anything missing gets
// 404.html with a 404 status. Mirrors the URL rewrite in infrastructure/modules/static-site.
//
// Usage: npm run build && npm run preview   (http://localhost:3000, the only origin dev's CORS allows)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const PORT = Number(process.env.PORT ?? 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

// Same rule as the CloudFront function: only extensionless paths are pages
function toFile(urlPath) {
  if (urlPath.endsWith("/")) return `${urlPath}index.html`;
  if (!extname(urlPath)) return `${urlPath}/index.html`;
  return urlPath;
}

async function send(res, status, file) {
  const body = await readFile(file);
  res.writeHead(status, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(body);
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = normalize(join(OUT_DIR, toFile(urlPath)));
  try {
    if (!file.startsWith(OUT_DIR + sep)) throw new Error("outside out/"); // no ../ escapes
    await send(res, 200, file);
  } catch {
    await send(res, 404, join(OUT_DIR, "404.html")).catch(() => {
      res.writeHead(500).end("out/ is missing - run npm run build first");
    });
  }
}).listen(PORT, () => console.log(`Serving out/ at http://localhost:${PORT}`));
