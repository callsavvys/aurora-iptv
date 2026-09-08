const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aurora", {
  version: () => ipcRenderer.invoke("app:version"),
  updateStatus: () => ipcRenderer.invoke("updater:status"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  onUpdateStatus: (callback) => ipcRenderer.on("updater:status", (_event, status) => callback(status)),
  setTheme: (theme) => ipcRenderer.send("app:theme", theme),
});
