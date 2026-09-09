const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aurora", {
  version: () => ipcRenderer.invoke("app:version"),
  updateStatus: () => ipcRenderer.invoke("updater:status"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  onUpdateStatus: (callback) => ipcRenderer.on("updater:status", (_event, status) => callback(status)),
  setTheme: (theme) => ipcRenderer.send("app:theme", theme),
  getSecrets: () => ipcRenderer.invoke("secrets:get"),
  setSecrets: (value) => ipcRenderer.invoke("secrets:set", value),
  onMenu: (channel, callback) => ipcRenderer.on(`menu:${channel}`, () => callback()),
});
