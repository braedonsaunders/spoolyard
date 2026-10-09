// The narrow bridge the Spoolyard web app uses for native file dialogs (see src/app/platform.ts).
const { contextBridge, ipcRenderer } = require("electron");

// Finder/Explorer can deliver a file before React has mounted.
const files = [];
let fileListener;
ipcRenderer.on("spoolyard:file", (_event, file) => {
  if (fileListener) fileListener(file);
  else files.push(file);
});
let closeListener;
ipcRenderer.on("spoolyard:before-close", async () => {
  let saved = false;
  try { saved = closeListener ? await closeListener() : true; } catch {}
  ipcRenderer.send("spoolyard:close-result", saved);
});

contextBridge.exposeInMainWorld("spoolyardDesktop", {
  openFile: () => ipcRenderer.invoke("spoolyard:open"),
  saveFile: (options) => ipcRenderer.invoke("spoolyard:save", options),
  onOpenFile: (listener) => {
    fileListener = listener;
    while (files.length) listener(files.shift());
    return () => { if (fileListener === listener) fileListener = undefined; };
  },
  onTheme: (listener) => {
    const handler = (_event, theme) => listener(theme);
    ipcRenderer.on("spoolyard:theme", handler);
    return () => ipcRenderer.removeListener("spoolyard:theme", handler);
  },
  onBeforeClose: (listener) => {
    closeListener = listener;
    return () => { if (closeListener === listener) closeListener = undefined; };
  },
});
