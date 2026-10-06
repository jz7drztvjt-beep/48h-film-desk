const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronDetached", {
  openWindow: (moduleName) => ipcRenderer.invoke("open-detached-window", moduleName)
});