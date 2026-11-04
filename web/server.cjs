/* The web version of Aurora, served from this Mac.

     npm run web          then open http://localhost:5174

   Besides the files in web/, it does three things the browser cannot:
   - /config.js hands the page the TMDB key the app already ships, read from
     app/renderer.js so there is one copy of it;
   - /vendor/hls.js serves the HLS player the app already ships;
   - /api/proxy?u=<url> fetches from an IPTV provider on the page's behalf. On
     the television every request goes out through native HTTP, which has no
     CORS; a browser page asking a provider directly is refused. This is that
     native HTTP, for this machine only — it listens on 127.0.0.1 and nowhere
     else, and it never logs what it fetches, because provider URLs carry the
     account's username and password. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const ROOT = __dirname;
const REPO = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 5174;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".ico": "image/x-icon" };

const tmdbKey = () => {
  try { return fs.readFileSync(path.join(REPO, "app", "renderer.js"), "utf8").match(/tmdb: "([0-9a-f]{32})"/)[1]; } catch { return ""; }
};

async function proxy(req, res, target) {
  let url;
  try { url = new URL(target); } catch { res.writeHead(400); return res.end("bad url"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") { res.writeHead(400); return res.end("bad scheme"); }
  const headers = { "user-agent": "Aurora-IPTV/web" };
  if (req.headers.range) headers.range = req.headers.range;
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  try {
    const upstream = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    const out = { "cache-control": "no-store" };
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h); if (v) out[h] = v;
    }
    res.writeHead(upstream.status, out);
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  } catch (error) {
    if (!res.headersSent) { res.writeHead(502, { "content-type": "text/plain" }); res.end("The provider did not answer: " + (error.cause?.code || error.name)); }
    else res.destroy();
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/proxy") return proxy(req, res, url.searchParams.get("u") || "");
  if (url.pathname === "/config.js") {
    res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
    return res.end(`window.AURORA_CONFIG = ${JSON.stringify({ tmdb: tmdbKey() })};`);
  }
  if (url.pathname === "/vendor/hls.js") {
    res.writeHead(200, { "content-type": TYPES[".js"] });
    return fs.createReadStream(path.join(REPO, "app", "hls.min.js")).pipe(res);
  }
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || file === __filename) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`Aurora web on http://localhost:${PORT}`));
