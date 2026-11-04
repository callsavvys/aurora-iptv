/* The television, on this Mac.

   Not an approximation of it. The panel is 1920x1080 at 320dpi, which Android
   serves to the WebView as a 960x540 viewport at two device pixels per CSS
   pixel. A Retina Mac is also two device pixels per CSS pixel, so a 960x540
   window here is the same 1920x1080 grid of real pixels, and — the part that
   matters — `window.innerWidth` is 960 in both, so the same media queries fire.
   A 1920-wide window does not: it reports 1861 and runs a branch of tv.css the
   television never sees.

   What is served is mobile/www, which is exactly what the APK ships; run
   `npm run package:tv` first if the stylesheet has changed since. Capacitor is
   not here, so anything that goes through native HTTP or native storage takes
   its fallback path — the layout and the remote are faithful, the networking
   is not necessarily. */
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const WWW = path.join(__dirname, "..", "mobile", "www");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };

if (!fs.existsSync(path.join(WWW, "index.html"))) {
  console.error("mobile/www is not built yet — run `npm run package:tv` first.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
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
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    win.loadURL(`http://127.0.0.1:${port}/`);
    win.webContents.on("did-finish-load", async () => {
      const shape = await win.webContents.executeJavaScript(
        `({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
            zoom: document.documentElement.style.zoom || "(not set yet)",
            under1500: matchMedia("(max-width: 1500px)").matches })`);
      console.log(`  viewport ${shape.w}x${shape.h} at ${shape.dpr}x  ->  ${shape.w * shape.dpr}x${shape.h * shape.dpr} real pixels`);
      console.log(`  zoom ${shape.zoom}   max-width:1500px branch active: ${shape.under1500}`);
      console.log(`  the television: 960x540 at 2x -> 1920x1080, branch active: true`);
      console.log("\n  arrows move, Enter selects, Backspace goes back.");

      // `npm run tv -- --shot out.png` captures the window and exits, for
      // looking at a change without sitting in front of it
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
    win.on("closed", () => { server.close(); app.quit(); });
  });
});
