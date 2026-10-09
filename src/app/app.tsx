import { useCallback, useEffect, useRef, useState } from "react";
import { HardDriveDownload, House, Moon, Sun } from "lucide-react";
import { IsometricEditor, type EditorController } from "../editor/isometric-editor";
import { Home } from "./home";
import { Splash } from "./splash";
import { getDrawing, putDrawing, type StoredDrawing } from "./storage";
import { desktop, openFile, saveFile } from "./platform";
import { newIsoFromTemplate, newIsoWithDefaultSpec, type DrawingTemplate } from "../editor/library";
import { readIsometric } from "../core/document";
import { getPreference, setPreference } from "./preferences";
import { assetUrl } from "../editor/assets";

interface Open {
  id: string;
  name: string;
  source: string;
  content?: string;
  /** Disk location (desktop path or browser file handle) for Save to disk. */
  handle?: unknown;
}
const THEME_KEY = "spoolyard.theme";
const piping = (name: string) => name.replace(/\.(json|pcf|dxf)$/i, "").replace(/(\.piping)?$/i, ".piping");

export function App() {
  const [splash, setSplash] = useState<"show" | "leaving" | "gone">("show");
  const [dark, setDark] = useState(
    () => getPreference(THEME_KEY) === "dark" || (!getPreference(THEME_KEY) && matchMedia("(prefers-color-scheme: dark)").matches),
  );
  const [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const switching = useRef(false);
  const editor = useRef<EditorController | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    setPreference(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const leave = setTimeout(() => setSplash("leaving"), 1900);
    const gone = setTimeout(() => setSplash("gone"), 2400);
    return () => {
      clearTimeout(leave);
      clearTimeout(gone);
    };
  }, []);

  const start = useCallback(async (next: Open) => {
    if (switching.current) return;
    switching.current = true;
    try {
      // Validate before replacing the current drawing, and retain unchanged imports in Recent.
      const parsed = next.source.trim() ? readIsometric(next.source) : await newIsoWithDefaultSpec();
      next.source = JSON.stringify(parsed);
      next.content = next.source;
      await editor.current?.save();
      await putDrawing({ id: next.id, name: next.name, content: next.source, updatedAt: Date.now(), path: typeof next.handle === "string" ? next.handle : undefined });
      setError("");
      setOpen(next);
      history.replaceState(null, "", "#" + next.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { switching.current = false; }
  }, []);
  const openFromDisk = useCallback(async () => {
    try {
      const file = await openFile();
      if (file) await start({ id: crypto.randomUUID(), name: piping(file.name), source: file.content, handle: /\.piping$/i.test(file.name) ? file.handle : undefined });
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
      const id = crypto.randomUUID(),
        name = "Cooling water return (sample).piping";
      await start({ id, name, source });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [start]);

  // Desktop: View ▸ Theme in the native menu.
  useEffect(() => {
    return desktop()?.onTheme?.((theme) => setDark(theme === "dark"));
  }, []);
  // Desktop: files opened from Finder/Explorer or a .piping double-click.
  useEffect(() => {
    return desktop()?.onOpenFile((file) => void start({ id: crypto.randomUUID(), name: piping(file.name), source: file.content, handle: /\.piping$/i.test(file.name) ? file.path : undefined }));
  }, [start]);
  useEffect(() => desktop()?.onBeforeClose?.(async () => {
    try { await editor.current?.save(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
  }), []);
  // Reopen the drawing in the address bar after a reload.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id)
      getDrawing(id)
        .then((d) => d && start({ id: d.id, name: d.name, source: d.content, handle: desktop() ? d.path : undefined }))
        .catch(() => undefined);
  }, [start]);

  const onSave = useCallback(
    async (content: string) => {
      if (!open) return;
      open.content = content;
      await putDrawing({ id: open.id, name: open.name, content, updatedAt: Date.now(), path: typeof open.handle === "string" ? open.handle : undefined });
      // The desktop app writes straight back to the file on disk; browsers save to disk on request.
      if (desktop() && typeof open.handle === "string") open.handle = await saveFile(open.name, content, open.handle);
    },
    [open],
  );
  const saveToDisk = async (saveAs = false) => {
    if (!open || fileBusy) return;
    setFileBusy(true);
    try {
      await editor.current?.save();
      open.handle = await saveFile(open.name, open.content ?? open.source, open.handle, saveAs);
      await putDrawing({ id: open.id, name: open.name, content: open.content ?? open.source, updatedAt: Date.now(), path: typeof open.handle === "string" ? open.handle : undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setFileBusy(false); }
  };
  const goHome = async () => {
    if (switching.current || fileBusy) return;
    switching.current = true;
    try {
      await editor.current?.save();
      editor.current = null;
      setOpen(null);
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { switching.current = false; }
  };

  return (
    <>
      {open ? (
        <IsometricEditor
          key={open.id}
          source={open.source}
          fileName={open.name}
          onSave={onSave}
          controller={editor}
          headerActions={
            <>
              <button title="Save a copy to disk" disabled={fileBusy} onClick={() => void saveToDisk(!open.handle)}>
                <HardDriveDownload size={15} /> {fileBusy ? "Saving…" : open.handle ? "Save to disk" : "Save as…"}
              </button>
              <button title={dark ? "Light theme" : "Dark theme"} aria-label="Toggle theme" onClick={() => setDark((v) => !v)}>
                {dark ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <button
                title="Back to your drawings"
                disabled={fileBusy}
                onClick={() => void goHome()}
              >
                <House size={15} /> Home
              </button>
            </>
          }
        />
      ) : (
        <Home
          dark={dark}
          onTheme={() => setDark((v) => !v)}
          onNew={(template) => void newDrawing(template)}
          onOpenFile={() => void openFromDisk()}
          onOpenSample={() => void openSample()}
          onOpenStored={(d: StoredDrawing) => void start({ id: d.id, name: d.name, source: d.content, handle: desktop() ? d.path : undefined })}
        />
      )}
      {error && (
        <div role="alert" className="sy-toast" onClick={() => setError("")}>
          {error}
        </div>
      )}
      {splash !== "gone" && <Splash leaving={splash === "leaving"} />}
    </>
  );
}
