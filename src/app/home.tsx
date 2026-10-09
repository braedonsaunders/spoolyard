import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Clock,
  Download,
  FilePlus2,
  FolderOpen,
  Github,
  LayoutGrid,
  LayoutTemplate,
  Layers,
  List,
  MessageSquareWarning,
  Moon,
  Search,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { SpoolyardMark } from "../editor/mark";
import { loadSpecIndex, TEMPLATES, type DrawingTemplate, type LibrarySpecSummary } from "../editor/library";
import { deleteDrawing, listDrawings, type StoredDrawing } from "./storage";
import { desktop } from "./platform";
import { Thumbnail } from "./thumbnail";

type Section = "recent" | "templates" | "specs" | "learn";
const REPO = "https://github.com/braedonsaunders/spoolyard";
const VIEW_KEY = "spoolyard.recent.view";

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
const display = (name: string) => name.replace(/\.piping$/i, "");

/** Split button: the main action, plus a caret menu of alternatives. */
function Split({
  icon: Icon,
  label,
  primary,
  onClick,
  items,
}: {
  icon: typeof FilePlus2;
  label: string;
  primary?: boolean;
  onClick: () => void;
  items: Array<{ label: string; detail?: string; onClick: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className={"sy-split" + (primary ? " primary" : "")} ref={ref}>
      <button className="sy-split-main" onClick={onClick}>
        <Icon size={16} /> {label}
      </button>
      <button className="sy-split-caret" aria-label={label + " options"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="sy-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              <strong>{item.label}</strong>
              {item.detail && <small>{item.detail}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Home({
  onNew,
  onOpenFile,
  onOpenSample,
  onOpenStored,
  dark,
  onTheme,
}: {
  onNew: (template?: DrawingTemplate) => void;
  onOpenFile: () => void;
  onOpenSample: () => void;
  onOpenStored: (drawing: StoredDrawing) => void;
  dark: boolean;
  onTheme: () => void;
}) {
  const [section, setSection] = useState<Section>("recent");
  const [drawings, setDrawings] = useState<StoredDrawing[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"opened" | "name">("opened");
  const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid"));
  const [specs, setSpecs] = useState<LibrarySpecSummary[] | null>(null);
  useEffect(() => {
    listDrawings()
      .then(setDrawings)
      .catch(() => setDrawings([]));
  }, []);
  useEffect(() => localStorage.setItem(VIEW_KEY, view), [view]);
  useEffect(() => {
    if (section === "specs" && !specs) loadSpecIndex().then(setSpecs).catch(() => setSpecs([]));
  }, [section, specs]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (drawings ?? [])
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt));
  }, [drawings, query, sort]);
  const remove = async (d: StoredDrawing) => {
    if (!confirm(`Remove “${display(d.name)}” from this device?`)) return;
    await deleteDrawing(d.id);
    setDrawings((list) => list?.filter((x) => x.id !== d.id) ?? null);
  };

  const nav: Array<[Section, string, typeof Clock]> = [
    ["recent", "Recent", Clock],
    ["templates", "Templates", LayoutTemplate],
    ["specs", "Specifications", Layers],
    ["learn", "Learn", BookOpen],
  ];

  return (
    <div className="sy-start">
      <aside className="sy-rail">
        <div className="sy-rail-brand">
          <SpoolyardMark size={34} />
          <span>
            spool<em>yard</em>
          </span>
        </div>
        <div className="sy-rail-actions">
          <Split
            icon={FilePlus2}
            label="New"
            primary
            onClick={() => onNew()}
            items={TEMPLATES.map((t) => ({ label: t.name, detail: t.detail, onClick: () => onNew(t) }))}
          />
          <Split
            icon={FolderOpen}
            label="Open"
            onClick={onOpenFile}
            items={[
              { label: "Open file…", detail: ".piping, PCF or Spoolyard DXF", onClick: onOpenFile },
              { label: "Open the sample drawing", detail: "Cooling water return, 4″ Spec A", onClick: onOpenSample },
            ]}
          />
        </div>
        <nav className="sy-rail-nav">
          {nav.map(([id, label, Icon]) => (
            <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        <div className="sy-rail-foot">
          <a href={REPO + "/releases"} target="_blank" rel="noreferrer">
            <Sparkles size={14} /> What’s new
          </a>
          {!desktop() && (
            <a href={REPO + "/releases/latest"} target="_blank" rel="noreferrer">
              <Download size={14} /> Desktop app
            </a>
          )}
          <a href={REPO + "/issues/new"} target="_blank" rel="noreferrer">
            <MessageSquareWarning size={14} /> Report an issue
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            <Github size={14} /> Source code
          </a>
          <button onClick={onTheme}>
            {dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? "Light theme" : "Dark theme"}
          </button>
        </div>
      </aside>

      <main className="sy-main">
        {section === "recent" && (
          <>
            <header className="sy-main-head">
              <h1>Recent</h1>
              <div className="sy-main-tools">
                <div className="sy-seg" role="group" aria-label="View">
                  <button className={view === "grid" ? "active" : ""} aria-label="Grid view" onClick={() => setView("grid")}>
                    <LayoutGrid size={15} />
                  </button>
                  <button className={view === "list" ? "active" : ""} aria-label="List view" onClick={() => setView("list")}>
                    <List size={15} />
                  </button>
                </div>
                <label className="sy-sort">
                  Sort by
                  <select value={sort} onChange={(e) => setSort(e.target.value as "opened" | "name")}>
                    <option value="opened">Last opened</option>
                    <option value="name">Name</option>
                  </select>
                </label>
                <label className="sy-search">
                  <Search size={14} />
                  <input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
              </div>
            </header>
            {drawings && drawings.length === 0 ? (
              <div className="sy-empty">
                <SpoolyardMark size={64} />
                <h2>No drawings yet</h2>
                <p>Start from a template, or open the sample to see a finished spool.</p>
                <div>
                  <button className="sy-btn primary" onClick={() => onNew()}>
                    <FilePlus2 size={15} /> New drawing
                  </button>
                  <button className="sy-btn" onClick={onOpenSample}>
                    Open the sample
                  </button>
                </div>
              </div>
            ) : view === "grid" ? (
              <div className="sy-grid">
                {shown.map((d) => (
                  <article key={d.id} className="sy-card" onClick={() => onOpenStored(d)}>
                    <Thumbnail content={d.content} />
                    <footer>
                      <span>
                        <strong title={d.name}>{display(d.name)}</strong>
                        <small>{ago(d.updatedAt)}</small>
                      </span>
                      <button
                        aria-label={"Remove " + display(d.name)}
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(d);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <table className="sy-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Last opened</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.id} onClick={() => onOpenStored(d)}>
                      <td>
                        <SpoolyardMark size={20} /> {display(d.name)}
                      </td>
                      <td>{ago(d.updatedAt)}</td>
                      <td>
                        <button
                          aria-label={"Remove " + display(d.name)}
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(d);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {section === "templates" && (
          <>
            <header className="sy-main-head">
              <h1>Templates</h1>
            </header>
            <div className="sy-templates">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="sy-template" onClick={() => onNew(t)}>
                  <span className={"sy-sheet " + t.paper}>
                    <i />
                  </span>
                  <strong>{t.name}</strong>
                  <small>{t.detail}</small>
                </button>
              ))}
              <button className="sy-template" onClick={onOpenSample}>
                <span className="sy-sheet sample">
                  <SpoolyardMark size={40} />
                </span>
                <strong>Sample drawing</strong>
                <small>Cooling water return · 4″ · Spec A</small>
              </button>
            </div>
          </>
        )}

        {section === "specs" && (
          <>
            <header className="sy-main-head">
              <h1>Specifications</h1>
              <p>Included with Spoolyard. Every row is editable inside a drawing, and you can add your own.</p>
            </header>
            <table className="sy-table">
              <thead>
                <tr>
                  <th>Spec</th>
                  <th>Material</th>
                  <th>Service</th>
                  <th>Rating</th>
                  <th>Rows</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(specs ?? []).map((s) => (
                  <tr key={s.slug}>
                    <td>
                      <strong>{s.id}</strong>
                    </td>
                    <td>{s.material}</td>
                    <td>{s.service}</td>
                    <td>{s.rating}</td>
                    <td>{s.rowCount.toLocaleString()}</td>
                    <td>
                      <button
                        className="sy-btn small"
                        onClick={() =>
                          onNew({ ...TEMPLATES[0], id: "spec-" + s.slug, spec: s.slug, name: "Spec " + s.id })
                        }
                      >
                        New drawing
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {section === "learn" && (
          <>
            <header className="sy-main-head">
              <h1>Learn</h1>
            </header>
            <div className="sy-learn">
              <section>
                <h2>Draw a spool</h2>
                <ol>
                  <li>
                    Choose <b>Pipe</b> (or press <kbd>P</kbd>) and click the grid to start a run.
                  </li>
                  <li>Click along the iso directions — Ortho snaps each pipe to East/West, North/South or Up/Down.</li>
                  <li>
                    Or type a length and press <b>East</b>, <b>North</b> or <b>Up</b> to route by measurement.
                  </li>
                  <li>
                    Press <kbd>Esc</kbd> to finish the run; <b>New spool</b> starts the next one.
                  </li>
                  <li>
                    Choose a component in Insert, then click the pipe. Or select the pipe first and the component
                    lands on it. Elbows appear when the run changes direction.
                  </li>
                </ol>
              </section>
              <section>
                <h2>Shortcuts</h2>
                <dl>
                  <dt>
                    <kbd>V</kbd>
                  </dt>
                  <dd>Select</dd>
                  <dt>
                    <kbd>P</kbd>
                  </dt>
                  <dd>Pipe</dd>
                  <dt>
                    <kbd>H</kbd>
                  </dt>
                  <dd>Pan</dd>
                  <dt>
                    <kbd>Esc</kbd>
                  </dt>
                  <dd>Finish run, then back to Select</dd>
                  <dt>
                    <kbd>⌘/Ctrl</kbd> <kbd>Z</kbd>
                  </dt>
                  <dd>Undo · add Shift to redo</dd>
                  <dt>
                    <kbd>⌘/Ctrl</kbd> <kbd>S</kbd>
                  </dt>
                  <dd>Save now</dd>
                  <dt>
                    <kbd>Delete</kbd>
                  </dt>
                  <dd>Remove the selection</dd>
                </dl>
              </section>
              <section>
                <h2>Cut lengths</h2>
                <p>
                  Each pipe&apos;s cut is its centreline length less the takeouts of the fittings at each end and the root
                  gap of each butt weld. Specification rows without a known dimension are flagged, and the drawing stays
                  in draft until you enter a measured takeout.
                </p>
              </section>
            </div>
          </>
        )}
      </main>

      <aside className="sy-side">
        <h2>Get started</h2>
        <button className="sy-side-card" onClick={onOpenSample}>
          <SpoolyardMark size={36} />
          <span>
            <strong>Open the sample</strong>
            <small>A finished 4″ spool with valves, a support, cut list and weld map.</small>
          </span>
        </button>
        <button className="sy-side-card" onClick={() => setSection("learn")}>
          <BookOpen size={22} />
          <span>
            <strong>Draw your first spool</strong>
            <small>Routing, components and shortcuts in two minutes.</small>
          </span>
        </button>
        {!desktop() && (
          <a className="sy-side-card" href={REPO + "/releases/latest"} target="_blank" rel="noreferrer">
            <Download size={22} />
            <span>
              <strong>Get the desktop app</strong>
              <small>macOS, Windows and Linux. Opens .piping files from disk.</small>
            </span>
          </a>
        )}
      </aside>
    </div>
  );
}
