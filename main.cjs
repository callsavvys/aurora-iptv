const { app, BrowserWindow, Menu, ipcMain, nativeTheme, safeStorage, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createAuroraServer } = require("./server.cjs");
const { createUpdater } = require("./updater.cjs");
const { updates } = require("./package.json");

// Electron names the app from package.json, which put "aurora-iptv-mac" in the
// menu bar. userData is derived from that name, so pin the old path before
// renaming or every saved source, favorite and watch position moves with it.
if (!app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath("userData", path.join(app.getPath("appData"), "aurora-iptv-mac"));
}
app.setName("Aurora IPTV");

const WINDOW_BG = { dark: "#080d14", light: "#eff3f3" };

let server;
let mainWindow;
let updater;

const secretsFile = () => path.join(app.getPath("userData"), "secrets.bin");

/* Everything the renderer used to keep in localStorage. localStorage is keyed
   to the page origin, the origin carries the server port, and the port is not
   guaranteed — so favourites and resume positions could vanish because some
   unrelated process held 41791. This file is keyed to nothing. */
const prefsFile = () => path.join(app.getPath("userData"), "prefs.json");
let prefsCache = null;

function readPrefs() {
  if (prefsCache) return prefsCache;
  try { prefsCache = JSON.parse(fs.readFileSync(prefsFile(), "utf8")) } catch { prefsCache = {} }
  return prefsCache && typeof prefsCache === "object" ? prefsCache : (prefsCache = {});
}

/* Synchronous, because the renderer needs the theme and the favourites before
   it paints. sendSync blocks the renderer until this replies, so it MUST reply
   on every path — a throw here is a permanently blank window, not an error. */
ipcMain.on("prefs:load", (event) => {
  try { event.returnValue = readPrefs() } catch { event.returnValue = {} }
});

ipcMain.handle("prefs:set", (_event, value) => {
  try {
    prefsCache = value && typeof value === "object" ? value : {};
    // write beside the real file and rename, so a crash mid-write cannot
    // truncate the only copy of someone's list
    const target = prefsFile(), temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(prefsCache), { mode: 0o600 });
    fs.renameSync(temporary, target);
    return { saved: true };
  } catch (error) { return { saved: false, message: error.message } }
});

/* A failed read is not an empty store. If the keychain refuses this build — and
   a new signature after an update is enough — then returning null would tell the
   renderer nothing was ever saved, and its next write would erase the only copy
   of the sources, the API keys and the signed-in session.

   The two failures are not the same, and treating them alike loses data either
   way. A blob that cannot be decrypted is gone for good, so it is set aside and
   the renderer may start a new store. A keychain that is merely not up yet — a
   Mac still logging in — will work in a moment, so that file is left exactly
   where it is and the renderer is told to hold off rather than replace it. */
ipcMain.handle("secrets:get", () => {
  if (!fs.existsSync(secretsFile())) return null;
  let blob;
  try { blob = fs.readFileSync(secretsFile()) }
  catch (error) { return { unreadable: error.message || "could not be read", retryable: true } }
  if (!safeStorage.isEncryptionAvailable()) {
    // either written on a Mac with no keychain, or encrypted and the keychain is
    // not awake yet — only the first is safe to hand over
    try { return JSON.parse(blob.toString("utf8")) } catch { /* encrypted: wait for the keychain */ }
    return { unreadable: "the keychain is not available yet", retryable: true };
  }
  try { return JSON.parse(safeStorage.decryptString(blob)) }
  catch (error) {
    // one copy, under a fixed name: enough to recover by hand, never a growing
    // pile of files holding provider passwords
    try { fs.renameSync(secretsFile(), `${secretsFile()}.locked`) } catch { /* then it stays and the next write replaces it */ }
    return { unreadable: error.message || "could not be unlocked" };
  }
});

ipcMain.handle("secrets:set", (_event, value) => {
  try {
    const json = JSON.stringify(value ?? {});
    // fall back to plain text only where the OS keychain is unavailable, and
    // say so, rather than silently failing to save
    const encrypted = safeStorage.isEncryptionAvailable();
    fs.writeFileSync(secretsFile(), encrypted ? safeStorage.encryptString(json) : Buffer.from(json, "utf8"), { mode: 0o600 });
    return { saved: true, encrypted };
  } catch (error) { return { saved: false, encrypted: false, message: error.message } }
});

// the renderer owns the theme; the window just has to match so there is no
// flash of the wrong ground behind it
ipcMain.on("app:theme", (_event, theme) => {
  mainWindow?.setBackgroundColor(WINDOW_BG[theme] || WINDOW_BG.dark);
});

function buildMenu(checkForUpdates) {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Check for Updates…", click: checkForUpdates },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => mainWindow?.webContents.send("menu:settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Hide Sidebar", accelerator: "CmdOrCtrl+Ctrl+S", click: () => mainWindow?.webContents.send("menu:sidebar") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "Aurora on GitHub", click: () => shell.openExternal(`https://github.com/${updates.repository}`) }],
    },
  ]));
}

async function createWindow() {
  server = await createAuroraServer(path.join(__dirname, "app"));
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    title: "Aurora IPTV",
    backgroundColor: nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 19, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow = win;

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(server.origin)) event.preventDefault();
  });
  updater = updater || createUpdater(() => mainWindow, updates);
  buildMenu(() => updater.check({ manual: true }));
  await win.loadURL(server.origin);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(createWindow);
}
app.on("window-all-closed", () => {
  server?.close();
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
