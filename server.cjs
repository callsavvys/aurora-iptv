const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.includes(":")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function validateTarget(raw) {
  const target = new URL(raw);
  if (!["http:", "https:"].includes(target.protocol) || isPrivateHost(target.hostname)) throw new Error("Unsupported provider address");
  return target;
}

function proxyUrl(target, origin) {
  return `${origin}/proxy?src=${encodeURIComponent(target)}`;
}

function rewriteManifest(text, target, origin) {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${proxyUrl(new URL(uri, target).toString(), origin)}"`);
    }
    return proxyUrl(new URL(trimmed, target).toString(), origin);
  }).join("\n");
}

async function handleProxy(req, res, requestUrl, origin) {
  try {
    const raw = requestUrl.searchParams.get("src");
    if (!raw) throw new Error("Missing provider address");
    const target = validateTarget(raw);
    const headers = { Accept: req.headers.accept || "*/*", "User-Agent": "Aurora-IPTV-Mac/0.1" };
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(target, { headers, redirect: "follow" });
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const isManifest = /mpegurl|m3u8/i.test(contentType) || /\.m3u8($|\?)/i.test(target.pathname + target.search);
    res.statusCode = upstream.status;
    if (isManifest && upstream.ok) {
      const body = rewriteManifest(await upstream.text(), target, origin);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-store");
      res.end(body);
      return;
    }
    for (const name of ["content-type", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader("Cache-Control", contentType.includes("json") ? "no-store" : "private, max-age=30");
    if (!upstream.body) { res.end(); return }
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) await new Promise((resolve) => res.once("drain", resolve));
    }
    res.end();
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Provider request failed" }));
  }
}

function serveAsset(res, filePath) {
  const ext = path.extname(filePath);
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".vtt": "text/vtt" };
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error("Not a file");
    res.statusCode = 200;
    res.setHeader("Content-Type", types[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}

/* The new interface (site/, built into site-dist/ by scripts/build-mac.sh): its files, a page
   address it does not know falls back to index.html (the interface routes it itself), and the
   relay to your IPTV provider and Trakt that its dev server gives it in a browser (site/relay.cjs).
   Only this app's own page may use the relay: another site open in a browser cannot reach a
   provider, or your network, through it. */
function siteHandler(distDir) {
  const { proxy, traktToken } = require("./site/relay.cjs");
  const root = path.resolve(distDir);
  return (req, res, requestUrl) => {
    const site = req.headers["sec-fetch-site"];
    if (requestUrl.pathname.startsWith("/api/")) {
      if (site && site !== "same-origin" && site !== "none") { res.statusCode = 403; res.end("Forbidden"); return; }
      if (requestUrl.pathname === "/api/trakt/token" && req.method === "POST") return traktToken(req, res);
      if (requestUrl.pathname === "/api/proxy") {
        const target = requestUrl.searchParams.get("u") || "";
        let host = "";
        try { host = new URL(target).hostname; } catch { /* proxy() answers a bad address */ }
        if (host && isPrivateHost(host)) { res.statusCode = 403; res.end("Forbidden"); return; }
        return proxy(req, res, target);
      }
      res.statusCode = 404; res.end("Not found"); return;
    }
    const asset = requestUrl.pathname === "/" ? "index.html" : decodeURIComponent(requestUrl.pathname.slice(1));
    const safePath = path.resolve(root, asset);
    if (!safePath.startsWith(root + path.sep)) { res.statusCode = 403; res.end("Forbidden"); return; }
    let file = safePath;
    try { if (!fs.statSync(safePath).isFile()) throw new Error("no"); } catch { if (!path.extname(asset)) file = path.join(root, "index.html"); }
    serveAsset(res, file);
  };
}

function createAuroraServer(assetDir, port = 41791, { site = false } = {}) {
  const serveSite = site ? siteHandler(assetDir) : null;
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const requestUrl = new URL(req.url, origin);
      if (serveSite) return serveSite(req, res, requestUrl);
      if (requestUrl.pathname === "/proxy") return handleProxy(req, res, requestUrl, origin);
      // the record rules app/ shares with web/ live in web/js, beside this app's folder
      if (requestUrl.pathname === "/sync-core.js") return serveAsset(res, path.resolve(assetDir, "..", "web", "js", "sync-core.js"));
      const asset = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
      const safePath = path.resolve(assetDir, asset);
      if (!safePath.startsWith(path.resolve(assetDir) + path.sep) && safePath !== path.resolve(assetDir, "index.html")) {
        res.statusCode = 403; res.end("Forbidden"); return;
      }
      serveAsset(res, safePath);
    });
    const ready = () => resolve({
      origin: `http://127.0.0.1:${server.address().port}`,
      port: server.address().port,
      close: () => new Promise((done) => server.close(done)),
    });
    /* The renderer's storage is keyed to the origin, and the origin carries
       this port, so a different port means an empty IndexedDB. Walk a short
       fixed range before giving up and taking whatever the OS offers — that
       way a busy port costs a cache, not a different identity every launch. */
    const ladder = [port + 1, port + 2, port + 3, port + 4, port + 5, 0];
    let rung = 0;
    server.on("error", (error) => {
      if (error.code !== "EADDRINUSE" || rung >= ladder.length) return reject(error);
      server.listen(ladder[rung++], "127.0.0.1", ready);
    });
    server.listen(port, "127.0.0.1", ready);
  });
}

module.exports = { createAuroraServer };
