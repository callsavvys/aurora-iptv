// The new interface as the television runs it: the staged mobile/www from
// AURORA_TV_UI=web, with Capacitor stood in for (Preferences, the platform and
// the Back button), driven in a real Electron window.
//   electron tests/web-boot.cjs
const { app, BrowserWindow } = require("electron");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const WWW = path.join(ROOT, "mobile/www");

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const PREFS = JSON.stringify({ favorites: [], activeSource: "src-a", theme: "dark" });
const SECRETS = JSON.stringify({ sources: [{ id: "src-a", name: "Test line", server: "http://line.invalid:8080", username: "alice", password: "s3cret" }] });

/* Loaded before every other script, as Capacitor's bridge is on the device.
   ?stub=hang: Preferences never answers. Otherwise it holds PREFS/SECRETS and
   records every set(). fetch is recorded and refused, so nothing leaves. */
const STUB = `(() => {
  const mode = new URLSearchParams(location.search).get("stub");
  const values = { prefs: ${JSON.stringify(PREFS)}, secrets: ${JSON.stringify(SECRETS)} };
  window.__sets = []; window.__fetched = []; window.__back = []; window.__exited = false;
  window.fetch = (url) => { window.__fetched.push(String(url)); return Promise.reject(new TypeError("offline in tests")); };
  window.Capacitor = { getPlatform: () => "android", isNativePlatform: () => true, Plugins: {
    Preferences: {
      get: ({ key }) => mode === "hang" ? new Promise(() => {}) : Promise.resolve({ value: values[key] ?? null }),
      set: ({ key, value }) => { window.__sets.push(key); values[key] = value; return Promise.resolve(); },
    },
    App: { addListener: (name, fn) => { if (name === "backButton") window.__back.push(fn); }, exitApp: () => { window.__exited = true; } },
  } };
})();`;

(async () => {
  const staged = spawnSync("bash", [path.join(ROOT, "mobile/scripts/build-android.sh")], { env: { ...process.env, AURORA_TV_UI: "web", AURORA_STAGE_ONLY: "1" }, encoding: "utf8" });
  if (staged.status !== 0) { console.error(staged.stderr); process.exit(1); }

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    if (rel === "__stub.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(STUB); }
    const file = path.join(WWW, rel);
    if (!file.startsWith(WWW) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(file);
    if (rel === "index.html") body = Buffer.from(String(body).replace("<head>", '<head>\n<script src="__stub.js"></script>'));
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  app.on("window-all-closed", () => {});
  await app.whenReady();
  const win = new BrowserWindow({ width: 960, height: 540, show: false, useContentSize: true, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const pageErrors = [];
  win.webContents.on("console-message", (e) => { if (/TypeError(?!: offline)|ReferenceError|SyntaxError|Uncaught/.test(e.message || "")) pageErrors.push(e.message); });
  const js = (code) => win.webContents.executeJavaScript(code);
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    console.log("— storage that never answers: a read-only start —");
    await win.loadURL(`${origin}/?stub=hang&bootTimeout=50`);
    await settle(2500);
    check("the read-only banner is shown", await js(`!!document.querySelector(".boot-banner")`), true);
    check("it offers Try again, Continue without saving and Details", await js(`[...document.querySelectorAll(".boot-banner button")].map((b) => b.textContent)`), ["Try again", "Continue without saving", "Details"]);
    check("the app still starts behind it", await js(`!!document.querySelector("#screen").children.length`), true);
    check("nothing was written", await js(`window.__sets`), []);
    check("Details opens, names the timeout and carries no password", await js(`(() => { [...document.querySelectorAll(".boot-banner button")].find((b) => b.textContent === "Details").click(); const d = document.querySelector(".boot-banner .detail"); return [!d.hidden, d.textContent.startsWith("E_BOOT_STORAGE_TIMEOUT waited"), d.textContent.includes("s3cret")]; })()`), [true, true, false]);

    console.log("— a normal start on the old app's saved data —");
    await win.loadURL(`${origin}/?stub=ok`);
    await settle(4000);
    check("no banner", await js(`!!document.querySelector(".boot-banner")`), false);
    check("it is the new interface on a television", await js(`document.documentElement.className.split(" ").filter((c) => ["platform-tv", "ui-web", "platform-android"].includes(c)).sort()`), ["platform-android", "platform-tv", "ui-web"]);
    check("it opens the line the old app was playing, straight out (no /api/proxy)", await js(`(() => { const f = window.__fetched; return [f.some((u) => u.startsWith("http://line.invalid:8080/player_api.php?username=alice")), f.some((u) => u.includes("/api/proxy"))]; })()`), [true, false]);
    check("it never writes the old app's keys", await js(`window.__sets.filter((k) => k === "prefs" || k === "secrets" || k.endsWith(".locked"))`), []);
    check("the screen shows the provider's failure without the password", await js(`document.body.innerText.includes("s3cret")`), false);

    console.log("— the remote's Back —");
    await js(`document.querySelector(".bar .tab")?.focus(); true`);
    const first = await js(`window.__back.forEach((fn) => fn({ canGoBack: true })); window.__exited`);
    check("Back on Home with the tab bar focused leaves the app", first, true);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${error.message}`);
  }
  for (const message of pageErrors) { failed += 1; console.log(`FAIL  page error: ${message}`); }
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  win.destroy(); server.close(); app.exit(failed ? 1 : 0);
})();
