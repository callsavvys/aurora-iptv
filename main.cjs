const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { createAuroraServer } = require("./server.cjs");
const { createUpdater } = require("./updater.cjs");
const { updates } = require("./package.json");

let server;
let mainWindow;
let updater;

async function createWindow() {
  server = await createAuroraServer(path.join(__dirname, "app"));
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    title: "Aurora IPTV",
    backgroundColor: "#080d14",
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
