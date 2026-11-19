/* The site's relay to your IPTV provider, the same one web/server.cjs runs:
   a browser page is refused when it asks a provider directly (no CORS), and
   the TV and the Mac app do this through native HTTP. It runs inside the
   Vite dev server on this machine only, and never logs what it fetches,
   because provider URLs carry the account's username and password.
   /api/proxy?u=<provider url> */
const { Readable } = require("node:stream");

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
    // a live playlist's segments, made absolute so they resolve against the provider, not this relay
    if (upstream.ok && (/mpegurl/i.test(upstream.headers.get("content-type") || "") || /\.m3u8$/i.test(new URL(upstream.url || url).pathname))) {
      const base = upstream.url || url.toString();
      const text = (await upstream.text()).split(/\r?\n/).map((line) => {
        const t = line.trim();
        const abs = (ref) => { try { return new URL(ref, base).toString(); } catch { return ref; } };
        if (!t) return line;
        if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, ref) => `URI="${abs(ref)}"`);
        return abs(t);
      }).join("\n");
      res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" });
      return res.end(text);
    }
    const out = { "cache-control": "no-store" };
    const packed = !!upstream.headers.get("content-encoding");   // fetch unpacked it: the old length is wrong
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      if (packed && h === "content-length") continue;
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

/* a Vite plugin that mounts it */
function relayPlugin() {
  return {
    name: "aurora-relay",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const u = new URL(req.url, "http://localhost");
        if (u.pathname !== "/api/proxy") return next();
        proxy(req, res, u.searchParams.get("u") || "");
      });
    },
  };
}

module.exports = { proxy, relayPlugin };
