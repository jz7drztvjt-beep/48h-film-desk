const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("F48Google", {
  login: () => ipcRenderer.invoke("F48_GOOGLE_LOGIN"),
  logout: () => ipcRenderer.invoke("F48_GOOGLE_LOGOUT"),
  status: () => ipcRenderer.invoke("F48_GOOGLE_STATUS"),
  createDoc: (data) => ipcRenderer.invoke("F48_GOOGLE_CREATE_DOC", data),
  exportTxt: (data) => ipcRenderer.invoke("F48_EXPORT_TXT", data),
  exportPdf: (data) => ipcRenderer.invoke("F48_EXPORT_PDF", data),
  exportPdfToDrive: (data) => ipcRenderer.invoke("F48_EXPORT_PDF_TO_DRIVE", data), exportCleanPdf: (data) => ipcRenderer.invoke("F48_EXPORT_CLEAN_PDF", data), exportCleanPdfToDrive: (data) => ipcRenderer.invoke("F48_EXPORT_CLEAN_PDF_TO_DRIVE", data)
});


