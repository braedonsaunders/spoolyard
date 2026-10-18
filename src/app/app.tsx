import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { HardDriveDownload, House, Moon, Sun } from "lucide-react";
import { IsometricEditor, type EditorController } from "../editor/isometric-editor";
import type { FileSaveResult } from "../editor/use-piping-save";
import { EditorDialog, ask, type DialogRequest } from "../editor/dialogs";
import { Home } from "./home";
import { Splash } from "./splash";
import { getDrawing, putDrawing, type StoredDrawing } from "./storage";
import { desktop, openFile, openedDesktopFile, saveFile } from "./platform";
import { newIsoFromTemplate, newIsoWithDefaultSpec, type DrawingTemplate } from "../editor/library";
import { readIsometricFile } from "../core/document";
import { getPreference, setPreference } from "./preferences";
import { assetUrl } from "../editor/assets";

interface Open {
  id: string;
  name: string;
  source: string;
  content?: string;
  /** Disk location (desktop path or browser file handle) Save writes to. */
  handle?: unknown;
  /** The library copy holds edits its file does not (a recovery copy). */
  unsaved?: boolean;
  /** The .piping sidecar of a PCF opened with it: read once, with the PCF. */
  sidecar?: string;
}
const THEME_KEY = "spoolyard.theme";
/** How long the opening splash fades for, once the app is ready. */
const SPLASH_FADE_MS = 400;
const piping = (name: string) => name.replace(/\.(json|pcf|dxf)$/i, "").replace(/(\.piping)?$/i, ".piping");
/** A browser file handle Save can write back to. */
const writable = (handle: unknown) => typeof handle === "string" || !!(handle as { createWritable?: unknown } | undefined)?.createWritable;

/**
 * A drawing that fails to draw shows what went wrong, with a way back, instead of an empty window. The copy of the
 * drawing kept in this browser (or beside its file) is left as it was.
 */
class EditorBoundary extends Component<{ name: string; onHome: () => void; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="sy-empty sy-crash" role="alert">
        <h2>{this.props.name} could not be drawn</h2>
        <p>{error.message || String(error)}</p>
        <p>The drawing is kept in your drawings. Try again, or go back and reopen it.</p>
        <div>
          <button type="button" className="sy-btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" className="sy-btn" onClick={this.props.onHome}>Back to your drawings</button>
        </div>
      </main>
    );
  }
}

export function App() {
  const [splash, setSplash] = useState<"show" | "leaving" | "gone">("show");
  const [dark, setDark] = useState(
    () => getPreference(THEME_KEY) === "dark" || (!getPreference(THEME_KEY) && matchMedia("(prefers-color-scheme: dark)").matches),
  );
  const [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const switching = useRef(false);
  const editor = useRef<EditorController | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // The window title names the open drawing's file, and follows it through Save As.
  useEffect(() => {
    document.title = open ? `${open.name.replace(/\.piping$/i, "")} - Spoolyard` : "Spoolyard";
  }, [open]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    setPreference(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);
  /** The splash stays only while the app restores what it was showing, then fades. */
  const ready = useCallback(() => {
    setSplash((s) => (s === "show" ? "leaving" : s));
    setTimeout(() => setSplash("gone"), SPLASH_FADE_MS);
  }, []);

  /** Before leaving a drawing: its copy is kept, and unsaved changes to its file are offered to be saved. */
  const leave = useCallback(async (): Promise<boolean> => {
    const current = editor.current, file = openRef.current;
    if (!current || !file) return true;
    await current.flush();
    if (!current.fileDirty()) return true;
    const choice = await ask(setDialog, {
      title: `Save changes to ${file.name}?`,
      body: <p>Your edits are kept in this browser's copy, but the file on disk does not have them yet.</p>,
      confirm: { label: "Save" },
      alternative: { label: "Don't save" },
    });
    if (choice === "cancel") return false;
    if (choice === "ok") await current.save();
    return true;
  }, []);

  const start = useCallback(async (next: Open) => {
    if (switching.current) return;
    switching.current = true;
    try {
      // Validate before replacing the current drawing, and retain unchanged imports in Recent.
      const file = next.source.trim() ? readIsometricFile(next.source, next.sidecar == null ? {} : { pcf: { sidecar: next.sidecar } }) : null;
      delete next.sidecar;
      const parsed = file?.doc ?? (await newIsoWithDefaultSpec());
      next.source = JSON.stringify(parsed);
      next.content = next.source;
      if (!(await leave())) return;
      await putDrawing({ id: next.id, name: next.name, content: next.source, updatedAt: Date.now(), path: typeof next.handle === "string" ? next.handle : undefined, unsaved: next.unsaved });
      setError("");
      setOpen(next);
      history.replaceState(null, "", "#" + next.id);
      // What a PCF or CAD file could not carry exactly, said once it is open.
      if (file?.warnings.length)
        void ask(setDialog, {
          title: `${next.name} opened with ${file.warnings.length} warning${file.warnings.length === 1 ? "" : "s"}`,
          body: <ul className="iso-dialog-list">{file.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>,
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { switching.current = false; }
  }, [leave]);
  const openFromDisk = useCallback(async () => {
    try {
      const file = await openFile();
      if (file) await start({ id: crypto.randomUUID(), name: piping(file.name), source: file.content, sidecar: file.sidecar, handle: /\.piping$/i.test(file.name) ? file.handle : undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [start]);

  const newDrawing = useCallback(
    async (template?: DrawingTemplate) => {
      const id = crypto.randomUUID();
      if (!template) return start({ id, name: "Untitled isometric.piping", source: "" });
      try {
        const source = JSON.stringify(await newIsoFromTemplate(template));
        const name = "Untitled " + template.name.toLowerCase().replace(" · ", " ") + ".piping";
        await start({ id, name, source });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [start],
  );
  const openSample = useCallback(async () => {
    try {
      const response = await fetch(assetUrl("samples/cooling-water-return.piping"));
      if (!response.ok) throw new Error("The sample drawing could not load.");
      const source = await response.text();
      await start({ id: crypto.randomUUID(), name: "Cooling water return (sample).piping", source });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [start]);

  // Desktop: View ▸ Theme in the native menu.
  useEffect(() => desktop()?.onTheme?.((theme) => setDark(theme === "dark")), []);
  // Desktop: files opened from Finder/Explorer or a .piping double-click.
  useEffect(() => desktop()?.onOpenFile((delivered) => void openedDesktopFile(delivered).then(
    (file) => start({ id: crypto.randomUUID(), name: piping(file.name), source: file.content, sidecar: file.sidecar, handle: /\.piping$/i.test(file.name) ? file.handle : undefined }),
    (e) => setError(e instanceof Error ? e.message : String(e)))), [start]);
  useEffect(() => desktop()?.onBeforeClose?.(async () => {
    try { return await leave(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
  }), [leave]);
  // Reopen the drawing in the address bar after a reload; the splash leaves once that is done.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!id) return ready();
    getDrawing(id)
      .then((d) => d && start({ id: d.id, name: d.name, source: d.content, handle: desktop() ? d.path : undefined, unsaved: !!d.unsaved && !!d.path }))
      .catch(() => undefined)
      .finally(ready);
  }, [start, ready]);

  /** The copy kept as the drawing is edited: a recovery copy beside a file, else the drawing itself. */
  const keep = useCallback(async (content: string) => {
    if (!open) return;
    open.content = content;
    const file = writable(open.handle);
    await putDrawing({ id: open.id, name: open.name, content, updatedAt: Date.now(), path: typeof open.handle === "string" ? open.handle : undefined, unsaved: file || undefined });
  }, [open]);
  /** Save and Save As: write the file, asking where when there is none (or downloading, without file access). */
  const writeFile = useCallback(async (content: string, saveAs: boolean): Promise<FileSaveResult> => {
    if (!open) return "cancelled";
    // Without file access the browser can only download a copy; the drawing stays in this browser's library.
    setFileBusy(true);
    try {
      const written = await saveFile(open.name, content, saveAs ? undefined : open.handle, saveAs || !writable(open.handle));
      // A closed Save dialog leaves the drawing as unsaved as it was, even when it already had a file.
      if (written.result !== "saved") return written.result;
      const handle = written.handle, name = piping(written.name || open.name);
      const saved = { ...open, handle, name, content, unsaved: undefined };
      await putDrawing({ id: open.id, name, content, updatedAt: Date.now(), path: typeof handle === "string" ? handle : undefined });
      const changed = handle !== open.handle || name !== open.name;
      Object.assign(open, saved);
      // A new file (Save As, or a first save) becomes the drawing's file; Save then writes to it.
      if (changed) setOpen(saved);
      return "saved";
    } finally {
      setFileBusy(false);
    }
  }, [open]);
  const goHome = async () => {
    if (switching.current || fileBusy) return;
    switching.current = true;
    try {
      if (!(await leave())) return;
      editor.current = null;
      setOpen(null);
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { switching.current = false; }
  };
  const hasFile = !!open && (writable(open.handle) || !!desktop());

  return (
    <>
      {open ? (
        <EditorBoundary key={open.id} name={open.name} onHome={() => void goHome()}>
          <IsometricEditor
            key={open.id}
            source={open.source}
            fileName={open.name}
            onSave={keep}
            onSaveFile={writeFile}
            saveTarget={hasFile ? "disk" : "browser"}
            unsavedOnOpen={open.unsaved}
            controller={editor}
            headerActions={
              <>
                <button title={hasFile ? "Save to a new file" : "Save a copy to disk"} disabled={fileBusy}
                  onClick={() => void editor.current?.saveAs().catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
                  <HardDriveDownload size={15} /> {fileBusy ? "Saving…" : hasFile ? "Save as…" : "Save to disk…"}
                </button>
                <button title={dark ? "Light theme" : "Dark theme"} aria-label="Toggle theme" onClick={() => setDark((v) => !v)}>
                  {dark ? <Sun size={15} /> : <Moon size={15} />}
                </button>
                <button title="Back to your drawings" disabled={fileBusy} onClick={() => void goHome()}>
                  <House size={15} /> Home
                </button>
              </>
            }
          />
        </EditorBoundary>
      ) : (
        <Home
          dark={dark}
          onTheme={() => setDark((v) => !v)}
          onNew={(template) => void newDrawing(template)}
          onOpenFile={() => void openFromDisk()}
          onOpenSample={() => void openSample()}
          onOpenStored={(d: StoredDrawing) => void start({ id: d.id, name: d.name, source: d.content, handle: desktop() ? d.path : undefined, unsaved: !!d.unsaved && !!d.path && !!desktop() })}
        />
      )}
      {dialog && <EditorDialog request={dialog} />}
      {error && (
        <div role="alert" className="sy-toast" onClick={() => setError("")}>
          {error}
        </div>
      )}
      {splash !== "gone" && <Splash leaving={splash === "leaving"} />}
    </>
  );
}
