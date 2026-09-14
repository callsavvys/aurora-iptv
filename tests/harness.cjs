// Shared Electron harness: loads the real renderer with the real prefs and
// secrets IPC lifted out of main.cjs, against a throwaway userData directory.
const { app, BrowserWindow } = require("electron");
const path = require("node:path"), fs = require("node:fs"), os = require("node:os");
const ROOT = path.resolve(__dirname, "..");

function liftStoreHandlers() {
  const main = fs.readFileSync(path.join(ROOT, "main.cjs"), "utf8");
  const from = main.indexOf("const secretsFile = ()"), to = main.indexOf("// the renderer owns the theme");
  if (from < 0 || to < 0) throw new Error("main.cjs no longer has the prefs/secrets block this harness lifts");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aurora-test-")), "store.cjs");
  fs.writeFileSync(file, 'const { app, ipcMain, safeStorage } = require("electron");\nconst path = require("node:path");\nconst fs = require("node:fs");\nipcMain.handle("app:version", () => "test");\nipcMain.handle("updater:status", () => null);\n' + main.slice(from, to));
  return file;
}

async function openAurora({ dataDir, port }) {
  app.setPath("userData", dataDir);
  require(liftStoreHandlers());
  const { createAuroraServer } = require(path.join(ROOT, "server.cjs"));
  app.on("window-all-closed", () => {});
  await app.whenReady();
  const server = await createAuroraServer(path.join(ROOT, "app"), port);
  const win = new BrowserWindow({ width: 1280, height: 860, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(ROOT, "preload.cjs") } });
  const pageErrors = [];
  win.webContents.on("console-message", (e) => { if (/TypeError|ReferenceError|Uncaught/.test(e.message || "")) pageErrors.push(e.message) });
  await win.loadURL(server.origin);
  await new Promise((r) => setTimeout(r, 1200));
  const js = (code) => win.webContents.executeJavaScript(code);
  let failed = 0;
  const check = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed += 1;
    console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
  };
  const waitFor = async (expression, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await js(expression) === true) return true; await new Promise((r) => setTimeout(r, 300)) }
    return false;
  };
  const close = async () => {
    for (const message of pageErrors) { failed += 1; console.log(`FAIL  page error: ${message}`) }
    console.log(failed ? `\n${failed} failed` : "\nall passed");
    win.destroy(); await server.close(); app.exit(failed ? 1 : 0);
  };
  return { js, check, waitFor, close };
}

module.exports = { openAurora, ROOT };
