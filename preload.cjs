const { contextBridge, ipcRenderer } = require("electron");

// read before the page runs, because the theme and the saved list are needed
// on the first paint and an async round trip would flash the wrong ones
let prefs = {};
try { prefs = ipcRenderer.sendSync("prefs:load") || {} } catch { prefs = {} }

contextBridge.exposeInMainWorld("aurora", {
  version: () => ipcRenderer.invoke("app:version"),
  updateStatus: () => ipcRenderer.invoke("updater:status"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  onUpdateStatus: (callback) => ipcRenderer.on("updater:status", (_event, status) => callback(status)),
  setTheme: (theme) => ipcRenderer.send("app:theme", theme),
  prefs,
  setPrefs: (value) => ipcRenderer.invoke("prefs:set", value),
  getSecrets: () => ipcRenderer.invoke("secrets:get"),
  setSecrets: (value) => ipcRenderer.invoke("secrets:set", value),
  onMenu: (channel, callback) => ipcRenderer.on(`menu:${channel}`, () => callback()),
});
