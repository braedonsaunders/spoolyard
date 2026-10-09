/** File access: native dialogs in the desktop app, the File System Access API where browsers have it, else upload/download. */
export interface OpenedFile {
  name: string;
  content: string;
  /** Where Save writes back to, when the platform can. */
  handle?: unknown;
}
interface DesktopBridge {
  openFile(): Promise<{ name: string; content: string; path: string } | null>;
  saveFile(options: { content: string; name: string; path?: string }): Promise<{ path: string; name: string } | null>;
  onOpenFile(listener: (file: { name: string; content: string; path: string }) => void): () => void;
  onTheme?(listener: (theme: "light" | "dark") => void): () => void;
  onBeforeClose?(listener: () => Promise<boolean>): () => void;
}
declare global {
  interface Window {
    spoolyardDesktop?: DesktopBridge;
    showOpenFilePicker?: (options?: unknown) => Promise<Array<{ getFile(): Promise<File>; name: string }>>;
    showSaveFilePicker?: (options?: unknown) => Promise<{ createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>; name: string }>;
  }
}

export const desktop = () => window.spoolyardDesktop;
const ACCEPT = ".piping,.json,.pcf,.dxf";
const types = [{ description: "Spoolyard isometric", accept: { "application/json": [".piping", ".json"], "text/plain": [".pcf", ".dxf"] } }];

export async function openFile(): Promise<OpenedFile | null> {
  const bridge = desktop();
  if (bridge) {
    const file = await bridge.openFile();
    return file && { name: file.name, content: file.content, handle: file.path };
  }
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types, excludeAcceptAllOption: false });
      const file = await handle.getFile();
      return { name: file.name, content: await file.text(), handle };
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  }
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ACCEPT });
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        resolve(file ? { name: file.name, content: await file.text() } : null);
      } catch (e) { reject(e); }
    };
    input.click();
  });
}

/** Save to the file it came from when possible; otherwise ask where (or download). Returns the new handle. */
export async function saveFile(name: string, content: string, handle?: unknown, saveAs = false): Promise<unknown> {
  const bridge = desktop();
  if (bridge) {
    const saved = await bridge.saveFile({ content, name, path: saveAs ? undefined : (handle as string | undefined) });
    return saved?.path ?? handle;
  }
  const writable = handle as { createWritable?: () => Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> };
  if (!saveAs && writable?.createWritable) {
    const stream = await writable.createWritable();
    await stream.write(content);
    await stream.close();
    return handle;
  }
  if (window.showSaveFilePicker) {
    try {
      const next = await window.showSaveFilePicker({ suggestedName: name, types });
      const stream = await next.createWritable();
      await stream.write(content);
      await stream.close();
      return next;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return handle;
      throw e;
    }
  }
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return handle;
}
