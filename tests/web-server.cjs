// The Mac browser build's local server (npm run web): the routes the page
// cannot do without, served by web/server.cjs as a real process.
//   node tests/web-server.cjs
// Value: protects=/config.js carries every key extract-keys finds, /vendor/supabase.js and hls.js are served, server.cjs and ../ stay private;
//   fails_when=the server stops requiring extract-keys, drops a key from configJs, loses a vendor route or serves its own source;
//   why_new=tv-build.cjs covers the TV build's config.js and web-boot.cjs the staged TV www, nothing starts web/server.cjs;
//   seam=none; no_claim=the /api/proxy upstream fetch and the page in a browser (no provider is contacted)
const { spawn } = require("node:child_process");
const http = require("node:http"), path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const { extractKeys } = require("../scripts/extract-keys.cjs");

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const get = (port, p) => new Promise((resolve) => {
  http.get({ host: "127.0.0.1", port, path: p }, (res) => {
    let body = ""; res.setEncoding("utf8");
    res.on("data", (c) => { body += c; });
    res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", body }));
  }).on("error", (e) => resolve({ status: 0, type: "", body: e.message }));
});

(async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(ROOT, "web/server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 5000);
    child.stdout.on("data", (d) => { if (String(d).includes(`:${port}`)) { clearTimeout(t); resolve(); } });
    child.on("exit", (code) => { clearTimeout(t); reject(new Error(`server exited ${code}`)); });
  });
  try {
    const keys = extractKeys();
    const config = await get(port, "/config.js");
    check("/config.js is served as JavaScript", [config.status, config.type.startsWith("text/javascript")], [200, true]);
    check("it sets window.AURORA_CONFIG", config.body.includes("AURORA_CONFIG"), true);
    // compared as booleans so no key value is ever printed
    check("it carries every key app/renderer.js ships", Object.keys(keys).filter((k) => keys[k] && config.body.includes(keys[k])), Object.keys(keys));
    check("the browser build has no trace flag", config.body.includes('"trace":true'), false);

    const supa = await get(port, "/vendor/supabase.js");
    check("/vendor/supabase.js serves app/vendor/supabase.js", [supa.status, supa.body.length > 1000], [200, true]);
    const hls = await get(port, "/vendor/hls.js");
    check("/vendor/hls.js still serves the player", [hls.status, hls.body.length > 1000], [200, true]);

    const index = await get(port, "/");
    check("/ is web/index.html", [index.status, index.type.startsWith("text/html")], [200, true]);
    check("the server's own source is not served", (await get(port, "/server.cjs")).status, 404);
    check("nothing outside web/ is served", (await get(port, "/..%2Fapp%2Frenderer.js")).status, 404);
  } finally {
    child.kill();
  }
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
