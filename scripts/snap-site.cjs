// Capture a web page as the browser draws it: its rendered page structure
// (the DOM after scripts ran) and screenshots down the page. Used to copy
// atlantic.bz for the site/ web app and to compare the two, page by page.
//   npx electron scripts/snap-site.cjs <url> <outDir> <name> [width=1280] [height=720] [screens=4]
// Env: SNAP_CLICK (a selector to click first), SNAP_TYPE (text to type after),
// SNAP_THEN (a page to open after those, in the same browser, and capture instead),
// SNAP_JS (a script to run in the page, awaited, just before capturing),
// SNAP_GPU=1 (keep graphics acceleration on).
// Writes <name>.html (the rendered DOM) and <name>-0.png … <name>-N.png
// (one per screen, scrolling down by a screen each time).
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path");

const [url, outDir, name, w = "1280", h = "720", screens = "4"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!url || !outDir || !name) { console.error("usage: snap-site.cjs <url> <outDir> <name> [width] [height] [screens]"); process.exit(2); }

// SNAP_GPU=1 keeps graphics acceleration (a site may draw fewer effects without it)
if (!process.env.SNAP_GPU) app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: Number(w), height: Number(h), show: false, useContentSize: true, webPreferences: { sandbox: true, backgroundThrottling: false } });
  await win.loadURL(url);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  await new Promise((r) => setTimeout(r, 11000));
  // close the banners and tours a first visit shows, so they do not cover the page
  await js(`[...document.querySelectorAll('button')].filter(b => /^(Skip|Close|×|✕)$/.test(b.textContent.trim()) || b.getAttribute('aria-label') === 'Close').forEach(b => b.click()); 1`).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  // SNAP_CLICK="css selector" clicks something first (a search button, a tab);
  // SNAP_TYPE="text" then types it into whatever has focus
  if (process.env.SNAP_CLICK) { await js(`document.querySelector(${JSON.stringify(process.env.SNAP_CLICK)})?.click(); 1`); await new Promise((r) => setTimeout(r, 1500)); }
  if (process.env.SNAP_TYPE) { for (const ch of process.env.SNAP_TYPE) win.webContents.sendInputEvent({ type: "char", keyCode: ch }); await new Promise((r) => setTimeout(r, 3500)); }
  if (process.env.SNAP_THEN) { await win.loadURL(process.env.SNAP_THEN); await new Promise((r) => setTimeout(r, 8000)); }
  if (process.env.SNAP_JS) { await js(`(async () => { ${process.env.SNAP_JS} })().then(() => 1)`).catch((e) => console.error('SNAP_JS:', e.message)); await new Promise((r) => setTimeout(r, 1500)); }
  const n = Number(screens);
  for (let i = 0; i < n; i++) {
    await js(`window.scrollTo(0, ${i} * innerHeight); 1`);
    await new Promise((r) => setTimeout(r, 1500));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}-${i}.png`), img.toPNG());
  }
  await js("window.scrollTo(0, 0); 1");
  await new Promise((r) => setTimeout(r, 600));
  const html = await js("document.documentElement.outerHTML");
  fs.writeFileSync(path.join(outDir, `${name}.html`), html);
  console.log(`${name}: ${html.length} bytes, ${n} screens`);
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
