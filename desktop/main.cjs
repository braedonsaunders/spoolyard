// Spoolyard desktop: the web app served from the packaged dist over a private app:// origin,
// with native open/save dialogs and .piping file associations.
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { writeDrawing } = require("./write-drawing.cjs");

const DIST = path.join(__dirname, "..", "dist");
const FILE_TYPES = [
  { name: "Spoolyard isometric", extensions: ["piping"] },
  { name: "Piping component file", extensions: ["pcf"] },
  { name: "DXF exported by Spoolyard", extensions: ["dxf"] },
  { name: "All files", extensions: ["*"] },
];

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;
let quitting = false;
let closePending = false;
let allowClose = false;
const pending = [];

async function readPiping(filePath) {
  return { name: path.basename(filePath), content: await fs.readFile(filePath, "utf8"), path: filePath };
}
async function deliver(filePath) {
  if (!filePath || !/\.(piping|pcf|dxf|json)$/i.test(filePath)) return;
  const file = await readPiping(filePath).catch(() => null);
  if (!file) return;
  if (win && !win.webContents.isLoading()) win.webContents.send("spoolyard:file", file);
  else pending.push(file);
}

function createWindow() {
  allowClose = false;
  closePending = false;
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 640,
    title: "Spoolyard",
    backgroundColor: "#081a26",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-finish-load", () => {
    while (pending.length) win.webContents.send("spoolyard:file", pending.shift());
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const destination = new URL(url);
    if (destination.protocol !== "app:" || destination.hostname !== "spoolyard") event.preventDefault();
  });
  win.on("close", (event) => {
    if (allowClose) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    win.webContents.send("spoolyard:before-close");
  });
  win.loadURL("app://spoolyard/index.html");
  win.on("closed", () => (win = null));
}

function menu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: "appMenu" }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "Open…",
            accelerator: "CmdOrCtrl+O",
            click: async () => {
              const result = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: FILE_TYPES });
              if (!result.canceled) await deliver(result.filePaths[0]);
            },
          },
          { type: "separator" },
          isMac ? { role: "close" } : { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          {
            label: "Theme",
            submenu: [
              { label: "Light", click: () => win?.webContents.send("spoolyard:theme", "light") },
              { label: "Dark", click: () => win?.webContents.send("spoolyard:theme", "dark") },
            ],
          },
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
        submenu: [
          { label: "Spoolyard on GitHub", click: () => shell.openExternal("https://github.com/braedonsaunders/spoolyard") },
          { label: "Report an issue", click: () => shell.openExternal("https://github.com/braedonsaunders/spoolyard/issues") },
        ],
      },
    ]),
  );
}

ipcMain.handle("spoolyard:open", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: FILE_TYPES });
  return result.canceled ? null : readPiping(result.filePaths[0]);
});
ipcMain.on("spoolyard:close-result", (event, saved) => {
  if (event.sender !== win?.webContents || !closePending) return;
  closePending = false;
  if (!saved) { quitting = false; return; }
  allowClose = true;
  if (quitting) app.quit();
  else win.close();
});
app.on("before-quit", () => { quitting = true; });

ipcMain.handle("spoolyard:save", async (_event, { content, name, path: target }) => {
  let filePath = target;
  if (!filePath) {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: name,
      filters: [{ name: "Spoolyard isometric", extensions: ["piping"] }],
    });
    if (result.canceled || !result.filePath) return null;
    filePath = result.filePath;
  }
  await writeDrawing(filePath, content);
  app.addRecentDocument(filePath);
  return { path: filePath, name: path.basename(filePath) };
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    void deliver(argv.find((a) => /\.(piping|pcf|dxf)$/i.test(a)));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    void deliver(filePath);
  });
  app.whenReady().then(() => {
    protocol.handle("app", (request) => {
      const { pathname } = new URL(request.url);
      const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
      if (!file.startsWith(DIST + path.sep)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    menu();
    createWindow();
    void deliver(process.argv.find((a) => /\.(piping|pcf|dxf)$/i.test(a)));
    app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
  app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
}
