import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.js";
import { createApi } from "./api.js";

/* Venue server: serves the built app (dist/) and the API on one port.
   Run with `npm start`, which builds first. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const PORT = Number(process.env.PORT) || 8080;
const store = openStore(process.env.SELAE_DATA || path.join(root, "data/selae.json"));
const api = createApi(store);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("No build found. Run `npm start` (it builds first) or `npm run build`.");
  process.exit(1);
}

http.createServer(async (req, res) => {
  try {
    if ((await api(req, res, null)) || res.writableEnded || res.headersSent) return;
  } catch (e) {
    // Never let one bad request take the gate down mid-event
    console.error(e);
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
    return;
  }
  const url = new URL(req.url, "http://x");
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  fs.createReadStream(file).on("error", () => { if (!res.headersSent) res.statusCode = 500; res.end(); }).pipe(res);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`\nSELAE is running.\n`);
  console.log(`  Organizer (this laptop, camera works here):  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) console.log(`  Phones on the same Wi-Fi:                     http://${a.address}:${PORT}`);
  console.log(`\n  Data file: ${store.file}\n`);
});
