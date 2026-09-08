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
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
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

function createAuroraServer(assetDir, port = 41791) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const requestUrl = new URL(req.url, origin);
      if (requestUrl.pathname === "/proxy") return handleProxy(req, res, requestUrl, origin);
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
    server.on("error", (error) => {
      if (error.code !== "EADDRINUSE") return reject(error);
      server.listen(0, "127.0.0.1", ready);
    });
    server.listen(port, "127.0.0.1", ready);
  });
}

module.exports = { createAuroraServer };
