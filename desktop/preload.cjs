// The narrow bridge the Spoolyard web app uses for native file dialogs (see src/app/platform.ts).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spoolyardDesktop", {
  openFile: () => ipcRenderer.invoke("spoolyard:open"),
  saveFile: (options) => ipcRenderer.invoke("spoolyard:save", options),
  onOpenFile: (listener) => ipcRenderer.on("spoolyard:file", (_event, file) => listener(file)),
  onTheme: (listener) => ipcRenderer.on("spoolyard:theme", (_event, theme) => listener(theme)),
});
