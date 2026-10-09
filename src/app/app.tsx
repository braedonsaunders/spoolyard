import { useCallback, useEffect, useRef, useState } from "react";
import { HardDriveDownload, House, Moon, Sun } from "lucide-react";
import { IsometricEditor } from "../editor/isometric-editor";
import { Home } from "./home";
import { Splash } from "./splash";
import { getDrawing, putDrawing, type StoredDrawing } from "./storage";
import { desktop, openFile, saveFile } from "./platform";
import { newIsoFromTemplate, type DrawingTemplate } from "../editor/library";
import { assetUrl } from "../editor/assets";

interface Open {
  id: string;
  name: string;
  source: string;
  /** Disk location (desktop path or browser file handle) for Save to disk. */
  handle?: unknown;
}
const THEME_KEY = "spoolyard.theme";
const piping = (name: string) => name.replace(/\.(json|pcf|dxf)$/i, "").replace(/(\.piping)?$/i, ".piping");

export function App() {
  const [splash, setSplash] = useState<"show" | "leaving" | "gone">("show");
  const [dark, setDark] = useState(
    () => localStorage.getItem(THEME_KEY) === "dark" || (!localStorage.getItem(THEME_KEY) && matchMedia("(prefers-color-scheme: dark)").matches),
  );
  const [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState("");
  const handle = useRef<unknown>(undefined);
  const latest = useRef("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const leave = setTimeout(() => setSplash("leaving"), 1900);
    const gone = setTimeout(() => setSplash("gone"), 2400);
    return () => {
      clearTimeout(leave);
      clearTimeout(gone);
    };
  }, []);

  const start = useCallback((next: Open) => {
    handle.current = next.handle;
    latest.current = next.source;
    setError("");
    setOpen(next);
    history.replaceState(null, "", "#" + next.id);
  }, []);
  const openFromDisk = useCallback(async () => {
    try {
      const file = await openFile();
      if (file) start({ id: crypto.randomUUID(), name: piping(file.name), source: file.content, handle: file.handle });
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
        await putDrawing({ id, name, content: source, updatedAt: Date.now() });
        start({ id, name, source });
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
      await putDrawing({ id, name, content: source, updatedAt: Date.now() });
      start({ id, name, source });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [start]);

  // Desktop: View ▸ Theme in the native menu.
  useEffect(() => {
    desktop()?.onTheme?.((theme) => setDark(theme === "dark"));
  }, []);
  // Desktop: files opened from Finder/Explorer or a .piping double-click.
  useEffect(() => {
    desktop()?.onOpenFile((file) => start({ id: crypto.randomUUID(), name: piping(file.name), source: file.content, handle: file.path }));
  }, [start]);
  // Reopen the drawing in the address bar after a reload.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id)
      getDrawing(id)
        .then((d) => d && start({ id: d.id, name: d.name, source: d.content }))
        .catch(() => undefined);
  }, [start]);

  const onSave = useCallback(
    async (content: string) => {
      if (!open) return;
      latest.current = content;
      await putDrawing({ id: open.id, name: open.name, content, updatedAt: Date.now() });
      // The desktop app writes straight back to the file on disk; browsers save to disk on request.
      if (desktop() && typeof handle.current === "string") handle.current = await saveFile(open.name, content, handle.current);
    },
    [open],
  );
  const saveToDisk = async (saveAs = false) => {
    if (!open) return;
    try {
      handle.current = await saveFile(open.name, latest.current, handle.current, saveAs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      {open ? (
        <IsometricEditor
          key={open.id}
          source={open.source}
          fileName={open.name}
          onSave={onSave}
          headerActions={
            <>
              <button title="Save a copy to disk" onClick={() => void saveToDisk(!handle.current)}>
                <HardDriveDownload size={15} /> {handle.current ? "Save to disk" : "Save as…"}
              </button>
              <button title={dark ? "Light theme" : "Dark theme"} aria-label="Toggle theme" onClick={() => setDark((v) => !v)}>
                {dark ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <button
                title="Back to your drawings"
                onClick={() => {
                  setOpen(null);
                  history.replaceState(null, "", location.pathname + location.search);
                }}
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
          onOpenStored={(d: StoredDrawing) => start({ id: d.id, name: d.name, source: d.content })}
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
