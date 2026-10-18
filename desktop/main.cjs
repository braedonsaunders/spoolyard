// Spoolyard desktop: the web app served from the packaged dist over a private app:// origin,
// with native open/save dialogs and .piping file associations.
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { writeDrawing } = require("./write-drawing.cjs");
const { decodeText } = require("./read-text.cjs");

const DIST = path.join(__dirname, "..", "dist");
const FILE_TYPES = [
  { name: "Spoolyard isometric", extensions: ["piping", "json"] },
  { name: "Piping component file", extensions: ["pcf"] },
  { name: "PCF with its .piping sidecar (ZIP)", extensions: ["zip"] },
  { name: "DXF exported by Spoolyard", extensions: ["dxf"] },
  { name: "All files", extensions: ["*"] },
];
/** Files the app opens; a ZIP is a PCF with its .piping sidecar, as the PCF export writes it. */
const OPENABLE = /\.(piping|json|pcf|dxf|zip)$/i;
/** Files Save writes a drawing to: the native format only, never over an imported PCF or DXF. */
const SAVEABLE = /\.(piping|json)$/i;
/** Largest file opened (the .piping reader's own limit is 8 MB of text; PCF and DXF may be larger). */
const MAX_OPEN_BYTES = 64 * 1024 * 1024;
/**
 * Paths the user chose: files opened through a dialog, the OS (double-click, Open With) or the command line, and
 * Save As destinations. The renderer may only save back to one of these; any other path asks the user first.
 */
const approved = new Set();
const approve = (filePath) => {
  approved.add(path.resolve(filePath));
  rememberFolder(filePath);
};
/**
 * The folder Open and Save As start in: the last drawing's. Since Electron 43 a dialog without a defaultPath opens
 * Downloads and the OS no longer restores the last-used folder, so the app keeps it (across launches too).
 */
let lastFolder = null;
const folderFile = () => path.join(app.getPath("userData"), "last-folder.json");
function rememberFolder(filePath) {
  const folder = path.dirname(path.resolve(filePath));
  if (folder === lastFolder) return;
  lastFolder = folder;
  void fs.writeFile(folderFile(), JSON.stringify({ folder })).catch(() => {});
}
async function startFolder() {
  if (!lastFolder) {
    const saved = await fs.readFile(folderFile(), "utf8").then((text) => JSON.parse(text).folder).catch(() => null);
    lastFolder = typeof saved === "string" && path.isAbsolute(saved) ? saved : null;
  }
  const exists = lastFolder && (await fs.stat(lastFolder).then((s) => s.isDirectory()).catch(() => false));
  return exists ? lastFolder : app.getPath("documents");
}
const openDialog = async () => dialog.showOpenDialog(win, { defaultPath: await startFolder(), properties: ["openFile", "multiSelections"], filters: FILE_TYPES });
/**
 * Everything the app loads comes from its own packaged files: no remote scripts, styles, fonts or connections.
 * WebAssembly (the DWG writer) needs 'wasm-unsafe-eval'; drawings are SVG with inline <style>, hence 'unsafe-inline' styles.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;
let quitting = false;
let closePending = false;
let allowClose = false;
const pending = [];

async function readPiping(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_OPEN_BYTES) throw new Error("Not a drawing file Spoolyard can open.");
  const content = decodeText(await fs.readFile(filePath));
  approve(filePath);
  return { name: path.basename(filePath), content, path: filePath };
}
/**
 * The files chosen together: one text file as its text, or a ZIP, or a PCF and its .piping sidecar, as their bytes for
 * the app to unpack and pair (src/core/document.ts, drawingPackage).
 */
async function readChosen(filePaths) {
  const paths = filePaths.filter((p) => OPENABLE.test(p));
  if (!paths.length) throw new Error("Not a drawing file Spoolyard can open.");
  if (paths.length === 1 && !/\.zip$/i.test(paths[0])) return readPiping(paths[0]);
  const files = [];
  for (const filePath of paths) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_OPEN_BYTES) throw new Error("Not a drawing file Spoolyard can open.");
    files.push({ name: path.basename(filePath), path: filePath, bytes: new Uint8Array(await fs.readFile(filePath)) });
  }
  // Only a lone drawing is saved back to; a package's files are approved for nothing but reading.
  rememberFolder(paths[0]);
  return { name: files[0].name, content: "", path: files[0].path, files };
}
async function deliver(filePaths) {
  const list = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter((p) => p && OPENABLE.test(p));
  if (!list.length) return;
  const file = await readChosen(list).catch(() => null);
  if (!file) return;
  if (win && !win.webContents.isLoading()) win.webContents.send("spoolyard:file", file);
  else pending.push(file);
  // macOS keeps running with no window: a file opened from Finder then needs one.
  if (!win && app.isReady()) createWindow();
  else if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
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
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
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
  // A crashed page cannot answer the close prompt (its edits are in the recovery copy): reload it once, and
  // never leave a window that cannot be closed.
  let lastCrash = 0;
  win.webContents.on("render-process-gone", (_event, details) => {
    closePending = false;
    if (details.reason === "clean-exit" || quitting || !win) return;
    const now = Date.now();
    if (now - lastCrash > 30000) win.webContents.reload();
    lastCrash = now;
  });
  // The app itself never holds an unload on the desktop (its edits are kept in the recovery copy and closing asks
  // through spoolyard:before-close); should a page beforeunload guard ever cancel one, which Electron does silently,
  // a close goes ahead and a reload asks here.
  win.webContents.on("will-prevent-unload", (event) => {
    if (allowClose) return event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Reload", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: "Reload Spoolyard?",
      detail: "This drawing has changes that are not saved to its file. They are kept in its recovery copy and reopen after the reload.",
    });
    if (choice === 0) event.preventDefault();
  });
  win.on("close", (event) => {
    if (allowClose || win.webContents.isCrashed()) return;
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
              const result = await openDialog();
              if (!result.canceled) await deliver(result.filePaths);
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
          // Developer tools are for development builds only.
          ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
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

ipcMain.handle("spoolyard:open", async (event) => {
  if (event.sender !== win?.webContents) return null;
  const result = await openDialog();
  return result.canceled ? null : readChosen(result.filePaths);
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

ipcMain.handle("spoolyard:save", async (event, options) => {
  if (event.sender !== win?.webContents || !options || typeof options.content !== "string") return null;
  const { content, name, path: target } = options;
  // Save writes back only to a drawing file the user opened or chose; anything else is a Save As.
  let filePath = typeof target === "string" && approved.has(path.resolve(target)) && SAVEABLE.test(target) ? path.resolve(target) : null;
  if (!filePath) {
    // A drawing reopened from Recent suggests its own file again; the user still confirms where it goes.
    const known = typeof target === "string" && path.isAbsolute(target) && SAVEABLE.test(target);
    const base = path.basename(typeof name === "string" && name ? name : typeof target === "string" ? target : "drawing.piping");
    const file = SAVEABLE.test(base) ? base : base.replace(/\.[^.]*$/, "") + ".piping";
    const result = await dialog.showSaveDialog(win, {
      defaultPath: known ? target : path.join(await startFolder(), file),
      filters: [{ name: "Spoolyard isometric", extensions: ["piping"] }],
    });
    if (result.canceled || !result.filePath) return null;
    filePath = SAVEABLE.test(result.filePath) ? result.filePath : result.filePath + ".piping";
    approve(filePath);
  }
  await writeDrawing(filePath, content);
  app.addRecentDocument(filePath);
  return { path: filePath, name: path.basename(filePath) };
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    const file = argv.slice(1).find((a) => OPENABLE.test(a));
    if (file) void deliver(file);
    else if (!win) createWindow();
    else {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // No webviews and no windows other than the app's own.
  app.on("web-contents-created", (_event, contents) => contents.on("will-attach-webview", (event) => event.preventDefault()));
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    void deliver(filePath);
  });
  app.whenReady().then(() => {
    protocol.handle("app", async (request) => {
      const { pathname } = new URL(request.url);
      const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
      if (!file.startsWith(DIST + path.sep)) return new Response("Not found", { status: 404 });
      const response = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
      if (!response?.ok) return new Response("Not found", { status: 404 });
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", CSP);
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    });
    // The app needs full screen (the editor's full-screen button) and clipboard writes; refuse every other browser
    // permission (camera, microphone, notifications, location, …).
    const allowed = new Set(["fullscreen", "clipboard-sanitized-write"]);
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => allowed.has(permission));
    menu();
    createWindow();
    void deliver(process.argv.find((a) => OPENABLE.test(a)));
    app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
  app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
}
