const { app, BrowserWindow, Menu, ipcMain, nativeTheme, shell } = require("electron");
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
    { role: "viewMenu" },
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
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
