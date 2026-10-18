/** File access: native dialogs in the desktop app, the File System Access API where browsers have it, else upload/download. */
import { drawingPackage, type ChosenFile } from "../core/document";
import { isZip } from "../core/zip";
export interface OpenedFile {
  name: string;
  content: string;
  /** Where Save writes back to, when the platform can. */
  handle?: unknown;
  /** The `.piping` sidecar of a PCF opened with it (chosen beside it, or in its ZIP). */
  sidecar?: string;
}
/** A file the desktop app read: its text, or, for a ZIP or several files chosen together, their bytes. */
export interface DesktopFile {
  name: string;
  content: string;
  path: string;
  files?: Array<{ name: string; path: string; bytes: Uint8Array }>;
}
interface DesktopBridge {
  openFile(): Promise<DesktopFile | null>;
  saveFile(options: { content: string; name: string; path?: string }): Promise<{ path: string; name: string } | null>;
  onOpenFile(listener: (file: DesktopFile) => void): () => void;
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
/** What Open accepts: a drawing, a PCF (with its .piping sidecar chosen beside it), or the ZIP the PCF export writes. */
export const OPEN_ACCEPT = ".piping,.json,.pcf,.dxf,.zip";
const types = [{ description: "Spoolyard isometric", accept: { "application/json": [".piping", ".json"], "text/plain": [".pcf", ".dxf"], "application/zip": [".zip"] } }];
const saveTypes = [{ description: "Spoolyard isometric", accept: { "application/json": [".piping", ".json"] } }];

/** The drawing in the files chosen: one file, a PCF and its sidecar, or a ZIP of them. `handle` is a lone file's. */
async function opened(files: ChosenFile[], handle?: unknown): Promise<OpenedFile> {
  const chosen = await drawingPackage(files);
  // Save writes back only to a drawing opened on its own, never to a file read as part of a package.
  return { name: chosen.name, content: chosen.content, ...(chosen.sidecar != null ? { sidecar: chosen.sidecar } : {}), ...(files.length === 1 && !isZip(files[0].bytes) ? { handle } : {}) };
}
const chosenFile = async (file: File): Promise<ChosenFile> => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
/** A file the desktop app delivered (its Open dialog, the menu, or the operating system), as the drawing it holds. */
export async function openedDesktopFile(file: DesktopFile): Promise<OpenedFile> {
  if (!file.files?.length) return { name: file.name, content: file.content, handle: file.path };
  return opened(file.files.map((f) => ({ name: f.name, bytes: f.bytes })), file.files.length === 1 ? file.files[0].path : undefined);
}

export async function openFile(): Promise<OpenedFile | null> {
  const bridge = desktop();
  if (bridge) {
    const file = await bridge.openFile();
    return file && openedDesktopFile(file);
  }
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({ types, excludeAcceptAllOption: false, multiple: true });
      return opened(await Promise.all(handles.map(async (h) => chosenFile(await h.getFile()))), handles[0]);
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  }
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: OPEN_ACCEPT, multiple: true });
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      try {
        const files = [...(input.files ?? [])];
        resolve(files.length ? await opened(await Promise.all(files.map(chosenFile))) : null);
      } catch (e) { reject(e); }
    };
    input.click();
  });
}

/** What a save came to: written (to `handle`, named `name`), the dialog closed, or a download. */
export type SavedFile = { result: "saved"; handle: unknown; name: string } | { result: "cancelled" | "downloaded" };

/** Save to the file it came from when possible; otherwise ask where (or download). */
export async function saveFile(name: string, content: string, handle?: unknown, saveAs = false): Promise<SavedFile> {
  const bridge = desktop();
  if (bridge) {
    const saved = await bridge.saveFile({ content, name, path: saveAs ? undefined : (handle as string | undefined) });
    // A closed Save dialog wrote nothing, whatever file the drawing had before.
    return saved ? { result: "saved", handle: saved.path, name: saved.name } : { result: "cancelled" };
  }
  const writable = handle as { createWritable?: () => Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>; name?: string };
  if (!saveAs && writable?.createWritable) {
    const stream = await writable.createWritable();
    await stream.write(content);
    await stream.close();
    return { result: "saved", handle, name: writable.name ?? name };
  }
  if (window.showSaveFilePicker) {
    try {
      const next = await window.showSaveFilePicker({ suggestedName: name, types: saveTypes });
      const stream = await next.createWritable();
      await stream.write(content);
      await stream.close();
      return { result: "saved", handle: next, name: next.name };
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return { result: "cancelled" };
      throw e;
    }
  }
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { result: "downloaded" };
}
