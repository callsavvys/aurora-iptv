/* The television, on this Mac.

   Not an approximation of it. The panel is 1920x1080 at 320dpi, which Android
   serves to the WebView as a 960x540 viewport at two device pixels per CSS
   pixel. A Retina Mac is also two device pixels per CSS pixel, so a 960x540
   window here is the same 1920x1080 grid of real pixels, and — the part that
   matters — `window.innerWidth` is 960 in both, so the same media queries fire.
   A 1920-wide window does not: it reports 1861 and runs a branch of tv.css the
   television never sees.

   What is served is mobile/www, which is exactly what the APK ships; run
   `npm run package:tv` first if anything has changed since. The three things
   Capacitor provides on the device are stood in for so the app takes the same
   paths it takes there: see tv-preview-shim.js for storage and the Back
   button, and webSecurity below for networking.

     npm run tv                        open it
     npm run tv -- --shot out.png [ms] capture it after [ms] and exit */
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const WWW = path.join(__dirname, "..", "mobile", "www");
const SHIM = path.join(__dirname, "tv-preview-shim.js");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };

if (!fs.existsSync(path.join(WWW, "index.html"))) {
  console.error("mobile/www is not built yet — run `npm run package:tv` first.");
  process.exit(1);
}

// its own profile, so a source connected here is still there next time and
// never mixes with the Mac app's
app.setPath("userData", path.join(app.getPath("appData"), "Aurora TV Preview"));

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  if (rel === "__tv-preview-shim.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(fs.readFileSync(SHIM));
  }
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    if (rel === "index.html") {
      // before every other script, as Capacitor's own bridge is on the device
      body = Buffer.from(String(body).replace("<head>", '<head>\n  <script src="__tv-preview-shim.js"></script>'));
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  });
});

app.whenReady().then(() => {
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    const win = new BrowserWindow({
      width: 960, height: 540,        // CSS px: the television's own viewport
      useContentSize: true,           // so the title bar does not eat 28 of them
      resizable: false,               // resizing would change which media queries fire
      backgroundColor: "#070b0f",
      title: "Aurora TV — preview",
      webPreferences: {
        contextIsolation: true, sandbox: true, backgroundThrottling: false,
        /* On the device every fetch goes through CapacitorHttp, which is native
           HTTP and has no CORS. In a browser window an IPTV provider that sends
           no CORS headers is refused, which never happens on the television.
           Turning web security off here is the equivalent of that, for this
           local preview window only. */
        webSecurity: false,
      },
    });
    win.loadURL(`http://127.0.0.1:${port}/`);
    win.webContents.on("did-finish-load", async () => {
      const shape = await win.webContents.executeJavaScript(
        `({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
            zoom: document.documentElement.style.zoom || "(not set yet)",
            android: document.documentElement.classList.contains("platform-android"),
            under1500: matchMedia("(max-width: 1500px)").matches })`);
      console.log(`  viewport ${shape.w}x${shape.h} at ${shape.dpr}x  ->  ${shape.w * shape.dpr}x${shape.h * shape.dpr} real pixels`);
      console.log(`  zoom ${shape.zoom}   max-width:1500px branch: ${shape.under1500}   platform-android: ${shape.android}`);
      console.log(`  the television: 960x540 at 2x -> 1920x1080, branch: true, platform-android: true`);
      console.log("\n  arrows move, Enter selects, Backspace or Escape is the remote's Back.");

      const i = process.argv.indexOf("--shot");
      if (i !== -1 && process.argv[i + 1]) {
        const wait = Number(process.argv[i + 2]) || 9000;
        setTimeout(async () => {
          const image = await win.webContents.capturePage();
          fs.writeFileSync(process.argv[i + 1], image.toPNG());
          console.log("  captured ->", process.argv[i + 1]);
          win.close();
        }, wait);
      }
    });
    win.webContents.on("console-message", (event) => {
      if (/^\[remote\]/.test(event.message || "")) console.log("  " + event.message);
    });
    win.on("closed", () => { server.close(); app.quit(); });
  });
});
