import { useEffect, useState } from "react";
import { Download, FilePlus2, FolderOpen, Github, Moon, Sun, Trash2 } from "lucide-react";
import { SpoolyardMark } from "../editor/mark";
import { deleteDrawing, listDrawings, type StoredDrawing } from "./storage";
import { desktop } from "./platform";

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : new Date(t).toLocaleDateString();
};

export function Home({
  onNew,
  onOpenFile,
  onOpenStored,
  dark,
  onTheme,
}: {
  onNew: () => void;
  onOpenFile: () => void;
  onOpenStored: (drawing: StoredDrawing) => void;
  dark: boolean;
  onTheme: () => void;
}) {
  const [drawings, setDrawings] = useState<StoredDrawing[] | null>(null);
  useEffect(() => {
    listDrawings().then(setDrawings).catch(() => setDrawings([]));
  }, []);
  return (
    <main className="sy-home">
      <header className="sy-home-bar">
        <div className="sy-home-brand">
          <SpoolyardMark size={30} />
          <strong>Spoolyard</strong>
        </div>
        <div className="sy-home-bar-actions">
          {!desktop() && (
            <a href="https://github.com/braedonsaunders/spoolyard/releases/latest" target="_blank" rel="noreferrer">
              <Download size={15} /> Desktop app
            </a>
          )}
          <a href="https://github.com/braedonsaunders/spoolyard" target="_blank" rel="noreferrer" aria-label="Source on GitHub">
            <Github size={15} />
          </a>
          <button onClick={onTheme} aria-label={dark ? "Light theme" : "Dark theme"}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>
      <section className="sy-home-hero">
        <h1>Piping isometrics</h1>
        <p>
          Route pipe by measured length, place fittings from a specification, and export the drawing, cut list,
          weld map and material list as PDF, DXF, DWG or PCF.
        </p>
        <div className="sy-home-actions">
          <button className="sy-primary" onClick={onNew}>
            <FilePlus2 size={17} /> New isometric
          </button>
          <button className="sy-secondary" onClick={onOpenFile}>
            <FolderOpen size={17} /> Open file…
          </button>
        </div>
        <small>Opens .piping, PCF and DXF files saved by Spoolyard.</small>
      </section>
      <section className="sy-home-recent">
        <h2>Your drawings</h2>
        {drawings === null ? null : drawings.length === 0 ? (
          <p className="sy-empty">Drawings you create are kept here on this device.</p>
        ) : (
          <ul>
            {drawings.map((d) => (
              <li key={d.id}>
                <button className="sy-recent-open" onClick={() => onOpenStored(d)}>
                  <SpoolyardMark size={26} />
                  <span>
                    <strong>{d.name}</strong>
                    <small>Edited {ago(d.updatedAt)}</small>
                  </span>
                </button>
                <button
                  className="sy-recent-delete"
                  aria-label={"Delete " + d.name}
                  onClick={async () => {
                    if (!confirm(`Delete “${d.name}” from this device?`)) return;
                    await deleteDrawing(d.id);
                    setDrawings((list) => list?.filter((x) => x.id !== d.id) ?? null);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
