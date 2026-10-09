
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ArrowUpLeft,
  CircleStop,
  Move3d,
  Plus,
  Box,
  Check,
  ChevronDown,
  Download,
  FileText,
  Grid3X3,
  Hand,
  Layers,
  Loader2,
  Magnet,
  Maximize2,
  MousePointer2,
  MoveUpRight,
  Redo2,
  Ruler,
  Save,
  Settings2,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
  GitBranch,
  X,
} from "lucide-react";
import { cn } from "./cn";
import {
  appendRun,
  applyComponent,
  attachComponent,
  bom,
  bomCsv,
  clone,
  connected,
  formatLength,
  formatAllowance,
  displayBom,
  getNode,
  getSpec,
  defaultEndPrep,
  id,
  insertComponent,
  lengthInputValue,
  newIso,
  parseIsoJson,
  parseLength,
  prepAt,
  round,
  runResult,
  setAutoFitting,
  removeComponent,
  resizeRun,
  resizeRunToCut,
  sub,
  validateIso,
  welds,
  type IsoDocument,
  type CatalogItem,
  type Kind,
  type EndPrep,
  type Vec3,
} from "../core/model";
import { createDrawing, sheetWidth, type Drawing, type Point, type SheetFit } from "../core/drawing";
import { defaultGrid, gridSvg, pickGridPoint, pickOrthoPoint } from "../core/grid";
import { importPcf, exportPcf } from "../core/pcf";
import { download } from "./download";
import { exportDwg } from "./dwg";
import { isometricDxf, readIsometric } from "../core/document";
import { usePipingSave } from "./use-piping-save";
import { COMPONENT_TYPES, type ComponentType } from "../core/components";
import { SpecManager, rowComponent } from "./spec-manager";
import { defaultNps, loadLibrarySpec, loadSpecIndex, newIsoWithDefaultSpec, type LibrarySpecSummary } from "./library";
import { SpoolyardMark } from "./mark";
import { ComponentLibrary, ComponentPalette } from "./component-palette";
import { ComponentGlyph } from "./component-glyph";
import "./isometric-editor.css";

export type SaveStatus = "opening" | "saved" | "unsaved" | "saving" | "error";
export interface EditorController {
  save: () => Promise<void>;
}
export type IsometricEditorProps = {
  /** Fetched with credentials; ignored when `source` is given. */
  fileUrl?: string | null;
  /** File contents to open. Empty text (or neither source nor fileUrl) starts a new drawing on spec A. */
  source?: string;
  fileName: string;
  onSave: (content: string) => Promise<void>;
  headerActions?: ReactNode;
  /** "embedded" leaves the single header to the host application. */
  chrome?: "full" | "embedded";
  onStatus?: (status: SaveStatus, error: string) => void;
  controller?: MutableRefObject<EditorController | null>;
};
const directions: Array<{ name: string; vector: Vec3; icon: typeof ArrowUp }> = [
  { name: "East", vector: [1, 0, 0], icon: ArrowUpRight },
  { name: "North", vector: [0, 1, 0], icon: ArrowUpLeft },
  { name: "Up", vector: [0, 0, 1], icon: ArrowUp },
  { name: "West", vector: [-1, 0, 0], icon: ArrowDown },
  { name: "South", vector: [0, -1, 0], icon: ArrowDown },
  { name: "Down", vector: [0, 0, -1], icon: ArrowDown },
];
const fittingKinds: Kind[] = [
  "elbow90",
  "elbow45",
  "tee",
  "valve",
  "flange",
  "reducer",
  "cap",
  "support",
  "weld",
  "olet",
  "gasket",
  "bolt",
];
const labels: Record<string, string> = {
  elbow90: "90° elbow",
  elbow45: "45° elbow",
  tee: "Tee",
  valve: "Valve",
  flange: "Flange",
  reducer: "Reducer",
  cap: "Cap",
  support: "Support",
  weld: "Weld",
  olet: "Olet",
  gasket: "Gasket",
  bolt: "Bolts",
  end: "Open end",
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="iso-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
const BLOCK_PRESETS = ["6 in", "12 in", "1 ft", "2 ft", "5 ft", "100 mm", "250 mm", "500 mm", "1 m"];
function BlockScaleInput({
  spacing,
  units,
  className,
  onCommit,
  onError,
}: {
  spacing: number;
  units: IsoDocument["units"];
  className?: string;
  onCommit: (mm: number) => void;
  onError: (message: string) => void;
}) {
  const shown = lengthInputValue(spacing, units);
  return (
    <input
      className={className}
      aria-label="Isometric block scale"
      title={'Length of one isometric block. 12 in, 1 ft, 2\' 6", or 100 mm.'}
      list="iso-block-scales"
      key={spacing + ":" + units}
      defaultValue={shown}
      onBlur={(e) => {
        if (e.target.value.trim() === shown) return;
        try {
          const value = parseLength(e.target.value, units);
          if (!(value > 0) || value > 1e7) throw new Error("Enter a positive block length.");
          if (Math.abs(value - spacing) > 0.001) onCommit(value);
          else e.target.value = shown;
        } catch (err) {
          e.target.value = shown;
          onError(err instanceof Error ? err.message : String(err));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = shown;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
function LengthInput({
  label,
  aria,
  mm,
  units,
  allowEmpty,
  onCommit,
  onError,
}: {
  label: string;
  aria: string;
  mm: number | undefined;
  units: IsoDocument["units"];
  allowEmpty?: boolean;
  onCommit: (mm: number | undefined) => void;
  onError: (message: string) => void;
}) {
  const shown = mm == null || !Number.isFinite(mm) ? "" : lengthInputValue(mm, units);
  return (
    <Field label={label}>
      <input
        aria-label={aria}
        title={'Feet and inches or millimetres, for example 2\' 3 1/2", 12 in, or 100 mm.'}
        key={shown + ":" + units + ":" + label}
        defaultValue={shown}
        placeholder={allowEmpty ? "spec" : units === "imperial" ? '0"' : "0"}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === shown) return;
          try {
            if (!raw) {
              if (allowEmpty) onCommit(undefined);
              else e.target.value = shown;
              return;
            }
            const value = parseLength(raw, units);
            if (!(value >= 0)) throw new Error("Enter a length of zero or more.");
            if (mm == null || Math.abs(value - mm) > 0.001) onCommit(value);
          } catch (err) {
            e.target.value = shown;
            onError(err instanceof Error ? err.message : String(err));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = shown;
            e.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}
function Tool({
  name,
  icon: Icon,
  active,
  onClick,
  disabled,
}: {
  name: string;
  icon: typeof Ruler;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn("iso-tool", active && "active")}
      aria-label={name}
      title={name}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={18} />
      <span>{name}</span>
    </button>
  );
}

export function IsometricEditor({
  fileUrl,
  source,
  fileName,
  onSave,
  headerActions,
  chrome = "full",
  onStatus,
  controller,
}: IsometricEditorProps) {
  const [doc, setDoc] = useState<IsoDocument>(() => newIso()),
    [ready, setReady] = useState(false),
    [isNew, setIsNew] = useState(false),
    [error, setError] = useState("");
  const [tab, setTab] = useState("draw"),
    [surface, setSurface] = useState<"paper" | "grid">("paper"),
    [tool, setTool] = useState("select");
  const [selection, setSelection] = useState(""),
    [start, setStart] = useState(""),
    [spec, setSpec] = useState("CS40"),
    [nps, setNps] = useState(2);
  const [routingPrep, setRoutingPrep] = useState<EndPrep>('BW');
  const [span, setSpan] = useState("1000"),
    [spool, setSpool] = useState("SP-001"),
    [line, setLine] = useState(""),
    [view, setView] = useState<Drawing["view"]>("iso");
  const [filter, setFilter] = useState(""),
    [kind, setKind] = useState<Kind>("valve"),
    [fraction, setFraction] = useState(50);
  const [library, setLibrary] = useState<LibrarySpecSummary[] | null>(null),
    [specBusy, setSpecBusy] = useState(""),
    [armed, setArmed] = useState<{ type: ComponentType; row?: CatalogItem } | null>(null);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState<Point>([0, 0]),
    [cursor, setCursor] = useState<Vec3 | null>(null);
  const [lengthEdit, setLengthEdit] = useState<{ runId: string; role: "overall" | "cut" } | null>(null);
  const [lengthBox, setLengthBox] = useState<{ left: number; top: number; width: number; height: number; fontSize: number } | null>(null);
  const [undoCount, setUndoCount] = useState(0),
    [redoCount, setRedoCount] = useState(0),
    [busy, setBusy] = useState("");
  const undo = useRef<IsoDocument[]>([]),
    redo = useRef<IsoDocument[]>([]),
    svg = useRef<SVGSVGElement>(null),
    stage = useRef<HTMLDivElement>(null),
    importInput = useRef<HTMLInputElement>(null),
    three = useRef<HTMLDivElement>(null),
    specInput = useRef<HTMLInputElement>(null),
    lengthInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; pan: Point; scale: number } | null>(null);
  const lengthCancel = useRef(false);
  const lengthClosing = useRef(false);
  const nodeDrag = useRef<{
    id: string;
    point: Point;
    anchor: Vec3;
    destination: Vec3;
    moved: boolean;
  } | null>(null);
  const latest = useRef(doc);
  latest.current = doc;
  const activeSpec = doc.specs.find(s => s.id === spec) ?? doc.specs[0];
  useEffect(() => {
    if (activeSpec.id !== spec) setSpec(activeSpec.id);
    if (!activeSpec.sizes.some(size => size.nps === nps)) setNps(defaultNps(activeSpec));
    setRoutingPrep(defaultEndPrep(activeSpec, nps));
  }, [spec, activeSpec.id, nps, ready]);
  const persistence = usePipingSave(doc, ready, onSave, isNew);
  const save = () => {
    // Native menus and file switching may save while a title or dimension is still being edited.
    flushSync(() => (document.activeElement as HTMLElement | null)?.blur());
    return persistence.save();
  };
  if (controller) controller.current = { save };
  useEffect(() => {
    onStatus?.(persistence.status, persistence.error);
  }, [onStatus, persistence.status, persistence.error]);
  useEffect(() => {
    const abort = new AbortController();
    setReady(false);
    const text =
      source != null
        ? Promise.resolve(source)
        : fileUrl
          ? fetch(fileUrl, { credentials: "include", signal: abort.signal, cache: "no-store" }).then((r) => {
              if (!r.ok) throw new Error("Could not open this isometric.");
              return r.text();
            })
          : Promise.resolve("");
    text
      .then(async (text) => {
        const fresh = !text.trim();
        const loaded = fresh ? await newIsoWithDefaultSpec() : readIsometric(text);
        if (abort.signal.aborted) return;
        if (fresh) loaded.title = fileName.replace(/\.[^.]+$/, "") || loaded.title;
        setIsNew(fresh);
        setDoc(loaded);
        setSpec(loaded.specs[0].id);
        setNps(loaded.runs.at(-1)?.nps ?? defaultNps(loaded.specs[0]));
        setStart(loaded.nodes.at(-1)?.id ?? "");
        setSpan(loaded.units === "imperial" ? "10'" : "1000");
        setReady(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, [fileUrl, source]);
  const commit = (edit: (d: IsoDocument) => void) => {
    if (!ready) {
      setError("Wait for the drawing to finish opening.");
      return;
    }
    try {
      const next = clone(latest.current);
      edit(next);
      parseIsoJson(JSON.stringify(next));
      undo.current.push(latest.current);
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
      setDoc(next);
      latest.current = next;
      setUndoCount(undo.current.length);
      setRedoCount(0);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const history = (forward = false) => {
    const from = forward ? redo.current : undo.current,
      to = forward ? undo.current : redo.current,
      next = from.pop();
    if (!next) return;
    to.push(latest.current);
    setDoc(next);
    latest.current = next;
    setUndoCount(undo.current.length);
    setRedoCount(redo.current.length);
    setSelection("");
    setStart(next.nodes.at(-1)?.id ?? "");
  };
  const remove = () =>
    commit((d) => {
      const run = d.runs.find((r) => r.id === selection);
      const node = d.nodes.find((n) => n.id === selection);
      if (run) {
        d.runs = d.runs.filter((r) => r.id !== run.id);
        d.nodes = d.nodes.filter((n) => n.associatedRunId !== run.id);
        for (const key of [run.from, run.to]) if (d.nodes.some((n) => n.id === key)) setAutoFitting(d, key);
      } else if (node) {
        removeComponent(d, node.id);
      }
      d.nodes = d.nodes.filter((n) => n.associatedRunId || connected(d, n.id).length);
      setSelection("");
      setStart(d.nodes.at(-1)?.id ?? "");
    });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,select,textarea")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        history(e.shiftKey);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        history(true);
      } else if (e.key === "Escape") {
        if (armed) {
          setArmed(null);
          return;
        }
        // First Esc finishes the run in progress; the next click starts a new one. A second Esc leaves the Pipe tool.
        if (tool === "pipe" && start) setStart("");
        else setTool("select");
        setCursor(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key.toLowerCase() === "p") setTool("pipe");
      else if (e.key.toLowerCase() === "h") setTool("pan");
      else if (e.key.toLowerCase() === "v") setTool("select");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    loadSpecIndex()
      .then(setLibrary)
      .catch(() => setLibrary([]));
  }, []);
  useEffect(() => {
    if (ready && !doc.specs.some((s) => s.id === spec) && doc.specs[0]) {
      setSpec(doc.specs[0].id);
      setNps(defaultNps(doc.specs[0]));
    }
  }, [doc, spec, ready]);
  // Paper follows the chosen sheet size so the editor matches the exported PDF exactly.
  const W = surface === "paper" ? sheetWidth(doc) : 1100,
    dx = W - 1100;
  const routing = doc.nodes.some((n) => n.id === start);
  const spools = [...new Set([...doc.runs.map((r) => r.spool), spool])].sort();
  const newSpool = () => {
    const numbers = spools.map((s) => Number(/(\d+)$/.exec(s)?.[1] ?? 0));
    setSpool("SP-" + String(Math.max(0, ...numbers) + 1).padStart(3, "0"));
    setStart("");
    setSelection("");
    setTool("pipe");
    setView("iso");
  };
  const grid = doc.grid ?? defaultGrid(),
    anchor = doc.nodes.find((n) => n.id === start)?.position ?? ([0, 0, 0] as Vec3);
  // While a run is being drawn on paper, hold the sheet's fit so the next click point stays put;
  // it re-fits once the run is finished, or if the new pipe would leave the drawing area.
  const heldFit = useRef<SheetFit | null>(null);
  const holding = surface === "paper" && tool === "pipe" && routing;
  const drawing = useMemo(() => {
    if (surface === "grid") return createDrawing(doc, filter, "iso", undefined, { model: true });
    if (!holding) {
      heldFit.current = null;
      return createDrawing(doc, filter, view);
    }
    const held = heldFit.current;
    const outside = (d: Drawing) => {
      const [x0, y0, x1, y1] = d.area;
      return [...d.positions.values()].some(([x, y]) => x < x0 || x > x1 || y < y0 || y > y1);
    };
    let d = createDrawing(doc, filter, view, held ?? undefined);
    if (held && outside(d)) {
      // Re-centre, and only ever zoom out mid-run: zooming in would move every point under the cursor.
      const fresh = createDrawing(doc, filter, view);
      d =
        fresh.fit.scale > held.scale
          ? createDrawing(doc, filter, view, { centre: fresh.fit.centre, scale: held.scale })
          : fresh;
      if (outside(d)) d = fresh;
    }
    heldFit.current = d.fit;
    return d;
  }, [doc, filter, surface, view, holding]);
  const pick = (p: Point) =>
    routing && grid.ortho !== false ? pickOrthoPoint(drawing, p, anchor, grid) : pickGridPoint(drawing, p, anchor, grid);
  const axes = grid.plane === "xy" ? [0, 1] : grid.plane === "xz" ? [0, 2] : [1, 2];
  const origin = drawing.project(anchor),
    ga = [...anchor] as Vec3,
    gb = [...anchor] as Vec3;
  ga[axes[0]] += 1;
  gb[axes[1]] += 1;
  const pa = drawing.project(ga),
    pb = drawing.project(gb);
  const ax = pa[0] - origin[0],
    ay = pa[1] - origin[1],
    bx = pb[0] - origin[0],
    by = pb[1] - origin[1];
  const visualSpacing =
    grid.spacing *
    Math.max(1, Math.ceil(12 / (grid.spacing * Math.max(Math.hypot(ax, ay), Math.hypot(bx, by)))));
  const gridTransform = "matrix(" + [ax, ay, bx, by, origin[0], origin[1]].join(" ") + ")";
  const issues = useMemo(() => validateIso(doc), [doc]),
    materials = useMemo(() => bom(doc), [doc]),
    cuts = useMemo(() => doc.runs.filter(r => !r.connector).map((r) => runResult(doc, r)), [doc]),
    joints = useMemo(() => welds(doc), [doc]);
  const selectedRun = doc.runs.find((r) => r.id === selection),
    selectedNode = doc.nodes.find((n) => n.id === selection);
  const selectedEdges = selectedNode ? connected(doc, selectedNode.id) : [];
  const selectedHeader = selectedEdges.reduce<typeof selectedEdges[number] | undefined>((largest, run) => !largest || run.nps > largest.nps ? run : largest, undefined)
    ?? doc.runs.find(r => r.id === selectedNode?.associatedRunId);
  const selectConnection = (key: string) => {
    setStart(key);
    setSelection(key);
    const run = connected(doc, key)[0];
    if (run) {
      setSpool(run.spool);
      setLine(run.line);
      setSpec(run.specId);
      setNps(run.nps);
      setRoutingPrep(prepAt(run, run.from === key ? 0 : 1));
    }
  };
  useEffect(() => {
    if (tab !== "3d" || !three.current) return;
    // three.js loads only when the 3D review opens.
    let dispose: (() => void) | undefined,
      cancelled = false;
    const element = three.current;
    void import("./preview3d").then(({ mountPreview3d }) => {
      if (!cancelled) dispose = mountPreview3d(element, doc, filter);
    }).catch(() => {
      if (!cancelled) setError("3D review could not start. Enable hardware acceleration or use a WebGL-capable browser. Your drawing is still available in Draw.");
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [tab, doc, filter]);
  const fit = () => {
    if (surface === "paper" || !drawing.positions.size) {
      setZoom(1);
      setPan([0, 0]);
      return;
    }
    const points = [...drawing.positions.values()],
      xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    setPan([(minX + maxX) / 2 - 550, (minY + maxY) / 2 - 425]);
    setZoom(
      Math.min(
        4,
        Math.max(0.01, Math.min(850 / Math.max(200, maxX - minX), 600 / Math.max(150, maxY - minY))),
      ),
    );
  };
  useEffect(() => {
    if (surface === "grid") fit();
    // Frame the spool when model space opens. Later edits keep the view the user left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);
  const add = (delta: Vec3) =>
    commit((d) => {
      let from = d.nodes.some((n) => n.id === start) ? start : null;
      if (!from && d.nodes.length) {
        // A new run typed by length starts beside the existing work rather than on top of it.
        const origin = { id: id(), kind: "end" as const, position: [Math.max(...d.nodes.map((n) => n.position[0])) + 1000, 0, 0] as Vec3 };
        d.nodes.push(origin);
        from = origin.id;
      }
      const node = appendRun(
        d,
        from,
        delta,
        activeSpec.id,
        nps,
        spool,
        line,
        routingPrep,
      );
      setStart(node.id);
      setSelection(node.id);
    });
  const point = (event: PointerEvent): Point | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [p.x, p.y];
  };
  const insertFitting = (runId: string, type: ComponentType, row?: CatalogItem) => {
    const before = latest.current;
    commit((d) => {
      const run = d.runs.find((r) => r.id === runId);
      if (!run || run.connector) throw new Error("Select a pipe to insert this component.");
      const t = fraction / 100;
      if (!(t > 0 && t < 1)) throw new Error("Position must be between the pipe ends.");
      const specRows = getSpec(d, run.specId).fittings;
      const match =
        (row && specRows.some((f) => f.id === row.id) ? row : undefined) ??
        specRows.find(
          (f) =>
            rowComponent(f)?.code === type.code &&
            f.nps === run.nps &&
            (row?.smallerNps == null || f.smallerNps === row.smallerNps),
        ) ??
        specRows.find((f) => rowComponent(f)?.code === type.code && f.nps === run.nps);
      const fittingKind = type.kind as Kind;
      const node = ["support", "bolt", "annotation"].includes(fittingKind)
        ? attachComponent(d, runId, fittingKind, t)
        : insertComponent(d, runId, fittingKind, t);
      applyComponent(d, node, type.code, match);
      if (fittingKind === "reducer" && match?.smallerNps) {
        const next = d.runs.find((r) => r.from === node.id);
        if (next) {
          next.nps = match.smallerNps;
          setAutoFitting(d, next.to);
        }
      }
      setSelection(node.id);
    });
    if (latest.current !== before) setArmed(null);
  };
  const chooseComponent = (type: ComponentType, row?: CatalogItem) => {
    const run = doc.runs.find((r) => r.id === selection && !r.connector);
    if (run) insertFitting(run.id, type, row);
    else {
      const key = row?.id ?? type.code;
      setArmed((current) => (current && (current.row?.id ?? current.type.code) === key ? null : { type, row }));
      setTool("select");
      setTab("draw");
    }
  };
  const chooseSpec = async (value: string, runId = "") => {
    const use = (d: IsoDocument, id: string) => {
      const chosen = getSpec(d, id);
      let size = defaultNps(chosen);
      if (runId) {
        const run = d.runs.find((r) => r.id === runId);
        if (run) {
          run.specId = id;
          if (!chosen.sizes.some((s) => s.nps === run.nps)) run.nps = defaultNps(chosen);
          size = run.nps;
        }
      }
      setSpec(id);
      setNps(size);
    };
    if (!value.startsWith("library:")) {
      if (runId)
        commit((d) => {
          use(d, value);
        });
      else use(latest.current, value);
      return;
    }
    const slug = value.slice("library:".length);
    setSpecBusy(slug);
    try {
      const next = await loadLibrarySpec(slug, latest.current);
      commit((d) => {
        d.specs.push(next);
        use(d, next.id);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSpecBusy("");
    }
  };
  const place = (event: PointerEvent) => {
    if (!ready || drag.current) return;
    const target = event.target as Element,
      owner = target.closest("[data-owner]")?.getAttribute("data-owner"),
      node = target.closest("[data-node]")?.getAttribute("data-node");
    if (armed && tool === "select" && owner && !node) {
      const run = doc.runs.find((r) => r.id === owner && !r.connector);
      if (run) {
        insertFitting(owner, armed.type, armed.row);
        return;
      }
    }
    if (node) {
      if (tool === 'pipe' && routing && node !== start) {
        add(sub(getNode(doc, node).position, anchor));
        return;
      }
      selectConnection(node);
      return;
    }
    if (owner && tool === "select") {
      setSelection(owner);
      return;
    }
    if (tool !== "pipe") {
      setSelection("");
      return;
    }
    try {
      const p = point(event);
      if (!p) return;
      const destination = pick(p);
      if (!doc.nodes.some((n) => n.id === start)) {
        commit((d) => {
          const node = { id: id(), kind: "end" as const, position: destination };
          d.nodes.push(node);
          setStart(node.id);
          setSelection(node.id);
        });
      } else add(sub(destination, anchor));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const runExport = async (format: string) => {
    setBusy(format);
    setError("");
    try {
      const { exportPdf, exportSchedule, exportSvg } = await import("./export");
      if (format === "PDF") download(doc.drawing + ".pdf", await exportPdf(doc));
      else if (format === "DXF") download(doc.drawing + ".dxf", isometricDxf(doc), "application/dxf");
      else if (format === "DWG") download(doc.drawing + ".dwg", await exportDwg(isometricDxf(doc)));
      else if (format === "PCF") download(doc.drawing + ".pcf", exportPcf(doc));
      else if (format === "SVG") exportSvg(doc);
      else if (format === "JSON")
        download(doc.drawing + ".piping", JSON.stringify(doc, null, 2), "application/json");
      else if (format === "bom") download(doc.drawing + "-materials.csv", bomCsv(doc), "text/csv");
      else exportSchedule(doc, format as "cut" | "weld");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const importFile = async (file: File) => {
    try {
      const text = await file.text(),
        next = file.name.toLowerCase().endsWith(".pcf") ? importPcf(text).doc : readIsometric(text);
      commit((d) => Object.assign(d, next));
      setSpec(next.specs[0].id);
      setNps(defaultNps(next.specs[0]));
      setStart(next.nodes.at(-1)?.id ?? "");
      setSelection("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const importSpecs = async (file: File) => {
    try {
      const imported = JSON.parse(await file.text());
      const specs = Array.isArray(imported) ? imported : imported.specs;
      if (!Array.isArray(specs) || !specs.length)
        throw new Error("Choose a specification JSON containing a non-empty specification list.");
      commit((d) => {
        d.specs = [...d.specs.filter((s) => !specs.some((n) => n.id === s.id)), ...specs];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const setGrid = (patch: Partial<typeof grid>) =>
    commit((d) => {
      d.grid = { ...(d.grid ?? defaultGrid()), ...patch };
    });
  const openLength = (runId: string, role: "overall" | "cut") => {
    const run = doc.runs.find((r) => r.id === runId && !r.connector);
    if (!run) return;
    lengthCancel.current = false;
    lengthClosing.current = false;
    setSelection(runId);
    setTool("select");
    setLengthEdit({ runId, role });
  };
  const finishLength = (raw: string) => {
    if (lengthClosing.current) return;
    lengthClosing.current = true;
    const edit = lengthEdit;
    setLengthEdit(null);
    if (lengthCancel.current) {
      lengthCancel.current = false;
      return;
    }
    if (!edit) return;
    if (raw.trim() === lengthDraft) return;
    try {
      const value = parseLength(raw, doc.units);
      const run = doc.runs.find((r) => r.id === edit.runId);
      if (!run || run.connector) throw new Error("Select a pipe to change its length.");
      const current = runResult(doc, run);
      const target = edit.role === "cut" ? current.cut : current.overall;
      if (!Number.isFinite(target) || Math.abs(value - target) > 0.001)
        commit((d) =>
          edit.role === "cut" ? resizeRunToCut(d, edit.runId, value) : resizeRun(d, edit.runId, value),
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const bindLengthInput = useCallback((el: HTMLInputElement | null) => {
    lengthInput.current = el;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  const lengthDraft = useMemo(() => {
    if (!lengthEdit) return "";
    const run = doc.runs.find((r) => r.id === lengthEdit.runId);
    if (!run) return "";
    const result = runResult(doc, run);
    return lengthInputValue(lengthEdit.role === "cut" ? result.cut : result.overall, doc.units);
  }, [lengthEdit, doc]);
  useLayoutEffect(() => {
    if (!lengthEdit || !svg.current || !stage.current) {
      setLengthBox(null);
      return;
    }
    const text = svg.current.querySelector(
      `text[data-length="${lengthEdit.role}"][data-owner="${CSS.escape(lengthEdit.runId)}"]`,
    );
    if (!text) {
      setLengthBox(null);
      return;
    }
    const box = text.getBoundingClientRect();
    const host = stage.current.getBoundingClientRect();
    const next = {
      left: box.left - host.left,
      top: box.top - host.top - 1,
      width: Math.max(108, box.width + 36),
      height: Math.max(24, box.height + 8),
      fontSize: Math.max(13, box.height),
    };
    setLengthBox((prev) =>
      prev &&
      Math.abs(prev.left - next.left) < 0.5 &&
      Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.width - next.width) < 0.5 &&
      Math.abs(prev.height - next.height) < 0.5
        ? prev
        : next,
    );
  }, [lengthEdit, doc, zoom, pan, view, surface, filter]);
  const titleInput = (
    key: "title" | "drawing" | "revision" | "customer" | "project" | "drawnBy" | "checkedBy" | "notes",
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    size = 12,
  ) => {
    const labelled = y >= 650;
    const props = {
      className: "iso-paper-input",
      "aria-label": label,
      defaultValue: doc[key],
      placeholder: label,
      style: { fontSize: size, height: labelled ? "calc(100% - 10px)" : "100%" },
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.target.value !== doc[key])
          commit((d) => {
            d[key] = e.target.value;
          });
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === "Enter" && key !== "notes") e.currentTarget.blur();
      },
    };
    return (
      <foreignObject
        key={key + "-" + x + "-" + y}
        x={x}
        y={y}
        width={w}
        height={h}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        {labelled && <div className="iso-paper-label">{label}</div>}
        {key === "notes" ? <textarea key={doc[key]} {...props} /> : <input key={doc[key]} {...props} />}
      </foreignObject>
    );
  };

  return (
    <section className="iso-editor" aria-label="Piping isometric editor">
      {chrome === "full" && (
      <header className="iso-header">
        <div className="iso-brand">
          <SpoolyardMark size={22} title="Spoolyard" />
          <div>
            <strong>{fileName}</strong>
            <span>Piping isometric</span>
          </div>
        </div>
        <div className="iso-header-actions">
          <span
            role={persistence.status === "error" ? "alert" : "status"}
            className={cn("iso-save-status", persistence.status === "error" && "error")}
          >
            {persistence.status === "saving" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Check size={12} />
            )}{" "}
            {persistence.status === "error"
              ? "Save failed"
              : persistence.status === "opening"
                ? "Opening…"
                : persistence.status === "unsaved"
                  ? "Unsaved changes"
                  : persistence.status === "saving"
                    ? "Saving…"
                    : "Saved"}
          </span>
          <button
            onClick={() => void save().catch(() => undefined)}
            title={persistence.error || "Save (Ctrl/Cmd+S)"}
            disabled={!ready}
          >
            <Save size={15} /> Save
          </button>
          {headerActions}
        </div>
      </header>
      )}
      <div className="iso-ribbon-tabs" role="tablist" aria-label="Isometric ribbon">
        {[
          ["draw", "Draw"],
          ["materials", "Materials & cuts"],
          ["welds", "Weld map"],
          ["specs", "Specifications"],
          ["catalogue", "Component library"],
          ["sheet", "Drawing setup"],
          ["3d", "3D review"],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={cn(tab === key && "active")}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        <span className="iso-ribbon-spacer" />
        <button title="Import PCF, piping JSON or legacy DXF" onClick={() => importInput.current?.click()}>
          <Upload size={14} /> Import
        </button>
        <details className="iso-export-menu">
          <summary>
            <Download size={14} /> Export <ChevronDown size={12} />
          </summary>
          <div>
            {["PDF", "DWG", "DXF", "PCF", "SVG", "JSON", "bom", "cut", "weld"].map((format) => (
              <button key={format} disabled={!!busy || !ready} onClick={() => void runExport(format)}>
                {format === "PDF"
                  ? "PDF drawing package"
                  : format === "bom"
                    ? "Material CSV"
                    : format === "cut"
                      ? "Cut list CSV"
                      : format === "weld"
                        ? "Weld CSV"
                        : format}
              </button>
            ))}
          </div>
        </details>
      </div>
      {tab === "draw" && (
        <div className="iso-ribbon">
          <div className="iso-ribbon-group">
            <div className="iso-ribbon-tools">
              <Tool
                name="Select"
                icon={MousePointer2}
                active={tool === "select"}
                onClick={() => setTool("select")}
              />
              <Tool
                name="Pipe"
                icon={MoveUpRight}
                active={tool === "pipe"}
                onClick={() => {
                  setTool("pipe");
                  setView("iso");
                }}
              />
              <Tool name="Pan" icon={Hand} active={tool === "pan"} onClick={() => setTool("pan")} />
            </div>
            <small>DRAW · V / P / H</small>
          </div>
          <div className="iso-ribbon-group">
            <div className="iso-ribbon-controls">
              <Field label="Specification">
                <select
                  aria-label="Pipe specification"
                  value={spec}
                  disabled={!!specBusy}
                  onChange={(e) => void chooseSpec(e.target.value)}
                >
                  {doc.specs.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                  {(library ?? []).some((l) => !doc.specs.some((s) => s.id === l.id)) && (
                    <optgroup label="Add from standard library">
                      {(library ?? [])
                        .filter((l) => !doc.specs.some((s) => s.id === l.id))
                        .map((l) => (
                          <option value={"library:" + l.slug} key={l.slug}>
                            {specBusy === l.slug ? "Adding " + l.id + "…" : l.id + " · " + l.service}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </Field>
              <Field label="NPS">
                <select
                  aria-label="Pipe nominal size"
                  value={nps}
                  onChange={(e) => setNps(Number(e.target.value))}
                >
                  {activeSpec.sizes.map((s) => (
                    <option value={s.nps} key={s.nps}>
                      {s.nps}″
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={"Length · " + (doc.units === "mm" ? "mm" : "ft / in")}>
                <input
                  aria-label="Measured pipe length"
                  value={span}
                  placeholder={doc.units === "imperial" ? "10' or 12\"" : "1000"}
                  title={'Feet and inches or millimetres, for example 10\', 2\' 3 1/2", 12 in, or 1000 mm.'}
                  onChange={(e) => setSpan(e.target.value)}
                />
              </Field>
              <Field label="Connection">
                <select aria-label="Routing end preparation" value={routingPrep} onChange={e => setRoutingPrep(e.target.value as EndPrep)}>
                  <option value="BW">Butt weld</option>
                  <option value="SW">Socket weld</option>
                  <option value="THD">Threaded</option>
                  <option value="FL">Flanged</option>
                  <option value="PLAIN">Plain</option>
                </select>
              </Field>
            </div>
            <small>MEASURED ROUTING</small>
          </div>
          <div className="iso-ribbon-group">
            <div className="iso-ribbon-controls">
              <Field label="Spool">
                <select aria-label="Active spool" value={spool} onChange={(e) => setSpool(e.target.value)}>
                  {spools.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Tool name="New spool" icon={Plus} onClick={newSpool} />
              <Tool
                name="Finish run"
                icon={CircleStop}
                disabled={!start}
                onClick={() => {
                  setStart("");
                  setSelection("");
                }}
              />
            </div>
            <small>SPOOLS · ESC FINISHES A RUN</small>
          </div>
          <div className="iso-ribbon-group">
            <div className="iso-axis-buttons">
              {directions.map(({ name, vector, icon: Icon }) => (
                <button
                  key={name}
                  aria-label={"Route " + name}
                  disabled={!ready}
                  title={"Route " + name.toLowerCase() + " by the entered length"}
                  onClick={() => {
                    try {
                      const distance = parseLength(span, doc.units);
                      add(vector.map((v) => v * distance) as Vec3);
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  <Icon size={17} />
                  {name}
                </button>
              ))}
            </div>
            <small>FROM SELECTED CONNECTION</small>
          </div>
          <div className="iso-ribbon-group">
            <div className="iso-ribbon-tools">
              <Tool name="Undo" icon={Undo2} disabled={!undoCount} onClick={() => history()} />
              <Tool name="Redo" icon={Redo2} disabled={!redoCount} onClick={() => history(true)} />
              <Tool name="Delete" icon={Trash2} disabled={!selection} onClick={remove} />
            </div>
            <small>EDIT</small>
          </div>
        </div>
      )}
      {(error || persistence.error) && (
        <div className="iso-alert" role="alert">
          {error || persistence.error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={13} />
          </button>
        </div>
      )}
      <div className="iso-main">
        {tab === "draw" && (
          <aside className="iso-components" aria-label="Insert component">
            <div className="iso-components-head">
              <strong>Insert</strong>
              <small>
                {armed
                  ? "Click a pipe to place " + armed.type.label + ". Esc cancels."
                  : selectedRun && !selectedRun.connector
                    ? "Choosing a component places it on the selected pipe."
                    : "Choose a component, then click the pipe it goes on."}
              </small>
              {selectedRun && !selectedRun.connector && (
                <>
                  <Field label="Position along pipe (%)">
                    <input
                      type="number"
                      min="1"
                      max="99"
                      aria-label="Position along pipe"
                      value={fraction}
                      onChange={(e) => setFraction(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Distance from pipe start">
                    <input
                      aria-label="Component distance from pipe start"
                      key={selection + "-" + fraction}
                      defaultValue={lengthInputValue(
                        runResult(doc, selectedRun).overall * fraction / 100,
                        doc.units,
                      )}
                      onBlur={(e) => {
                        if (e.target.value === e.target.defaultValue) return;
                        try {
                          const distance = parseLength(e.target.value, doc.units),
                            overall = runResult(doc, selectedRun).overall;
                          if (distance <= 0 || distance >= overall)
                            throw new Error("Position must be between the pipe ends.");
                          setFraction((100 * distance) / overall);
                        } catch (error) {
                          setError(error instanceof Error ? error.message : String(error));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </Field>
                </>
              )}
            </div>
            {doc.specs[0] && (
              <ComponentPalette
                spec={doc.specs.find((s) => s.id === (selectedRun?.specId ?? spec)) ?? doc.specs[0]}
                nps={selectedRun?.nps ?? nps}
                armedKey={armed ? (armed.row?.id ?? armed.type.code) : ""}
                onInsert={chooseComponent}
              />
            )}
          </aside>
        )}
        {["draw", "sheet"].includes(tab) && (
          <>
            <div
              ref={stage}
              className={cn("iso-stage", surface === "grid" && "iso-stage-grid")}
              onWheel={(e) => {
                e.preventDefault();
                setZoom((z) => Math.min(8, Math.max(0.01, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
              }}
            >
              <div className="iso-view-controls">
                <div className="iso-segment">
                  <button
                    className={cn(surface === "paper" && "active")}
                    onClick={() => {
                      setSurface("paper");
                      setPan([0, 0]);
                      setZoom(1);
                    }}
                  >
                    <FileText size={14} /> Paper
                  </button>
                  <button
                    className={cn(surface === "grid" && "active")}
                    onClick={() => {
                      setSurface("grid");
                      setView("iso");
                    }}
                  >
                    <Grid3X3 size={14} /> Model space
                  </button>
                </div>
                <select
                  aria-label="Drawing view"
                  value={view}
                  disabled={surface === "grid"}
                  onChange={(e) => setView(e.target.value as Drawing["view"])}
                >
                  {["iso", "plan", "front", "side"].map((v) => (
                    <option key={v} value={v}>
                      {v.toUpperCase()}
                    </option>
                  ))}
                </select>
                <select aria-label="Visible spool" value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="">All spools</option>
                  {[...new Set(doc.runs.map((r) => r.spool))].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              {armed && tab === "draw" && (
                <div className="iso-place-hint" role="status">
                  Click a pipe to insert {armed.type.label}
                  <button type="button" onClick={() => setArmed(null)}>
                    Cancel
                  </button>
                </div>
              )}
              {!ready ? (
                <div className="iso-empty">
                  <Loader2 className="animate-spin" />
                  <p>Opening isometric…</p>
                </div>
              ) : (
                <svg
                  ref={svg}
                  className={cn(
                    "iso-sheet",
                    surface === "grid" && "model-space",
                    tool === "pipe" && "routing",
                    tool === "pan" && "panning",
                    armed && tool === "select" && "placing",
                  )}
                  viewBox={[
                    W / 2 - W / 2 / zoom + pan[0],
                    425 - 425 / zoom + pan[1],
                    W / zoom,
                    850 / zoom,
                  ].join(" ")}
                  aria-label="Editable isometric drawing"
                  onPointerDown={(e) => {
                    const node = (e.target as Element).closest("[data-node]")?.getAttribute("data-node");
                    const p = point(e);
                    if (tool === "select" && node && p) {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const position = getNode(doc, node).position;
                      nodeDrag.current = {
                        id: node,
                        point: p,
                        anchor: [...position],
                        destination: [...position],
                        moved: false,
                      };
                      selectConnection(node);
                      return;
                    }
                    if (tool === "pan" || e.button === 1) {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      drag.current = { x: e.clientX, y: e.clientY, pan: [...pan], scale: svg.current?.getScreenCTM()?.a ?? 1 };
                    }
                  }}
                  onPointerMove={(e) => {
                    if (nodeDrag.current) {
                      const p = point(e),
                        state = nodeDrag.current;
                      if (p) {
                        const origin = drawing.project(state.anchor);
                        try {
                          state.destination = pickGridPoint(
                            drawing,
                            [origin[0] + p[0] - state.point[0], origin[1] + p[1] - state.point[1]],
                            state.anchor,
                            grid,
                          );
                          state.moved = Math.hypot(p[0] - state.point[0], p[1] - state.point[1]) > 4;
                          setCursor(state.destination);
                        } catch {}
                      }
                      return;
                    }
                    if (drag.current) {
                      setPan([
                        drag.current.pan[0] - (e.clientX - drag.current.x) / drag.current.scale,
                        drag.current.pan[1] - (e.clientY - drag.current.y) / drag.current.scale,
                      ]);
                      return;
                    }
                    if (tool === "pipe") {
                      try {
                        const p = point(e);
                        if (p) setCursor(pick(p));
                      } catch {}
                    }
                  }}
                  onPointerUp={(e) => {
                    if (nodeDrag.current) {
                      const state = nodeDrag.current;
                      nodeDrag.current = null;
                      e.currentTarget.releasePointerCapture(e.pointerId);
                      setCursor(null);
                      if (state.moved)
                        commit((d) => {
                          getNode(d, state.id).position = state.destination;
                          setAutoFitting(d, state.id);
                          for (const r of connected(d, state.id)) {
                            setAutoFitting(d, r.from);
                            setAutoFitting(d, r.to);
                          }
                        });
                      return;
                    }
                    if (drag.current) {
                      drag.current = null;
                      e.currentTarget.releasePointerCapture(e.pointerId);
                      return;
                    }
                    if ((e.target as Element).closest("[data-length]") && e.detail >= 2) return;
                    place(e);
                  }}
                >
                  <defs>
                    <pattern
                      id="iso-infinite-grid"
                      width={visualSpacing}
                      height={visualSpacing}
                      patternUnits="userSpaceOnUse"
                      patternTransform={gridTransform}
                    >
                      <path
                        d={
                          "M0 0H" +
                          visualSpacing +
                          "V" +
                          visualSpacing +
                          "H0ZM0 " +
                          visualSpacing +
                          "L" +
                          visualSpacing +
                          " 0"
                        }
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                    </pattern>
                  </defs>
                  {surface === "paper" ? (
                    <rect x="0" y="0" width={W} height="850" fill="#fff" />
                  ) : (
                    grid.visible && (
                      <rect
                        x={W / 2 - W / 2 / zoom + pan[0]}
                        y={425 - 425 / zoom + pan[1]}
                        width={W / zoom}
                        height={850 / zoom}
                        fill="url(#iso-infinite-grid)"
                        className="iso-infinite-grid"
                      />
                    )
                  )}
                  {surface === "paper" && grid.visible && (
                    <g dangerouslySetInnerHTML={{ __html: gridSvg(drawing, anchor, grid, doc.units) }} />
                  )}
                  {drawing.primitives
                    .filter(
                      (p) =>
                        !(
                          surface === "paper" &&
                          p.type === "text" &&
                          !p.owner &&
                          ((p.p[0] < 740 && p.p[1] < 100) || (p.p[0] < 700 + dx && p.p[1] >= 650))
                        ),
                    )
                    .map((p, i) =>
                      p.type === "line" ? (
                        <g key={i}>
                          <line
                            data-owner={p.owner}
                            x1={p.a[0]}
                            y1={p.a[1]}
                            x2={p.b[0]}
                            y2={p.b[1]}
                            className={cn(
                              "iso-primitive",
                              "iso-layer-" + p.layer.toLowerCase(),
                              p.owner === selection && "selected",
                            )}
                            strokeWidth={p.layer === "PIPE" ? 2.2 : p.layer === "SYMBOL" ? 1.6 : 0.75}
                          />
                          {p.layer === "PIPE" && p.owner && (
                            <line
                              data-owner={p.owner}
                              x1={p.a[0]}
                              y1={p.a[1]}
                              x2={p.b[0]}
                              y2={p.b[1]}
                              stroke="transparent"
                              strokeWidth={14}
                            />
                          )}
                        </g>
                      ) : p.type === "circle" ? (
                        <circle
                          key={i}
                          data-owner={p.owner}
                          cx={p.p[0]}
                          cy={p.p[1]}
                          r={p.r}
                          className={cn(
                            "iso-primitive",
                            "iso-layer-" + p.layer.toLowerCase(),
                            p.owner === selection && "selected",
                          )}
                          fill={surface === "paper" ? "white" : "var(--iso-canvas)"}
                        />
                      ) : (
                        <g key={i}>
                          <text
                            data-owner={p.owner}
                            data-length={p.role}
                            x={p.p[0]}
                            y={p.p[1]}
                            fontSize={p.size}
                            className={cn(
                              "iso-text",
                              "iso-layer-" + p.layer.toLowerCase(),
                              p.owner === selection && "selected",
                            )}
                            style={
                              lengthEdit != null && lengthEdit.runId === p.owner && lengthEdit.role === p.role
                                ? { visibility: "hidden" }
                                : undefined
                            }
                          >
                            {p.text}
                          </text>
                          {p.role && p.owner && !(lengthEdit != null && lengthEdit.runId === p.owner && lengthEdit.role === p.role) && (
                            <rect
                              data-owner={p.owner}
                              data-length={p.role}
                              x={p.p[0] - 4}
                              y={p.p[1] - p.size}
                              width={Math.max(36, p.text.length * p.size * 0.62 + 8)}
                              height={p.size + 8}
                              fill="transparent"
                              className="iso-length-hit"
                              onDoubleClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openLength(p.owner!, p.role!);
                              }}
                            >
                              <title>
                                {p.role === "cut"
                                  ? "Double-click to edit the cut length"
                                  : "Double-click to edit the centreline length"}
                              </title>
                            </rect>
                          )}
                        </g>
                      ),
                    )}
                  {[...drawing.positions].map(([key, p]) => (
                    <g key={key}>
                      <circle
                        data-node={key}
                        cx={p[0]}
                        cy={p[1]}
                        r={14}
                        fill="transparent"
                        className="iso-node-hit"
                      />
                      {key === start && (
                        <circle cx={p[0]} cy={p[1]} r={5} className="iso-anchor" pointerEvents="none" />
                      )}
                    </g>
                  ))}
                  {cursor && nodeDrag.current && (
                    <circle
                      cx={drawing.project(cursor)[0]}
                      cy={drawing.project(cursor)[1]}
                      r={8}
                      className="iso-anchor"
                      opacity=".6"
                      pointerEvents="none"
                    />
                  )}
                  {cursor && tool === "pipe" && (
                    <g pointerEvents="none">
                      {routing && (
                        <line
                          x1={drawing.project(anchor)[0]}
                          y1={drawing.project(anchor)[1]}
                          x2={drawing.project(cursor)[0]}
                          y2={drawing.project(cursor)[1]}
                          className="iso-route-preview"
                        />
                      )}
                      <circle
                        cx={drawing.project(cursor)[0]}
                        cy={drawing.project(cursor)[1]}
                        r={4}
                        className="iso-anchor"
                      />
                      <text
                        x={drawing.project(cursor)[0] + 12}
                        y={drawing.project(cursor)[1] - 12}
                        className="iso-route-label"
                      >
                        {routing ? formatLength(Math.hypot(...sub(cursor, anchor)), doc.units) : "Start " + spool}
                      </text>
                    </g>
                  )}
                  {surface === "paper" && (
                    <>
                      {titleInput("title", 40, 25, 660, 30, "Drawing title", 22)}
                      {titleInput("drawing", 40, 56, 240, 22, "Drawing number")}
                      {titleInput("revision", 300, 56, 150, 22, "Revision")}
                      {titleInput("customer", 40, 80, 320, 22, "Customer")}
                      {titleInput("project", 375, 80, 325, 22, "Project")}
                      {titleInput("drawing", 48, 655, 330, 24, "Drawing number")}
                      {titleInput("revision", 490 + dx, 655, 180, 24, "Revision")}
                      {titleInput("drawnBy", 48, 680, 300, 22, "Drawn by")}
                      {titleInput("checkedBy", 365 + dx / 2, 680, 300, 22, "Checked by")}
                      {titleInput("notes", 48, 713, 630 + dx, 75, "Drawing notes")}
                    </>
                  )}
                  {!doc.runs.length && (
                    <g pointerEvents="none">
                      <text x={410 + dx / 2} y="300" textAnchor="middle" className="iso-onboarding-title">
                        Your next spool starts here
                      </text>
                      <text x={410 + dx / 2} y="330" textAnchor="middle" className="iso-onboarding-detail">
                        Enter a measured length and choose a direction
                      </text>
                      <text x={410 + dx / 2} y="352" textAnchor="middle" className="iso-onboarding-detail">
                        or select Pipe to place connections on the grid.
                      </text>
                    </g>
                  )}
                </svg>
              )}
              {lengthEdit && lengthBox && (
                <input
                  key={lengthEdit.runId + ":" + lengthEdit.role}
                  ref={bindLengthInput}
                  className="iso-inline-length"
                  aria-label={lengthEdit.role === "cut" ? "Pipe cut length" : "Pipe overall length"}
                  style={{
                    left: lengthBox.left,
                    top: lengthBox.top,
                    width: lengthBox.width,
                    height: lengthBox.height,
                    fontSize: lengthBox.fontSize,
                  }}
                  defaultValue={lengthDraft}
                  onBlur={(event) => finishLength(event.target.value)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onWheel={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.preventDefault();
                      lengthCancel.current = true;
                      setLengthEdit(null);
                    }
                  }}
                />
              )}
              <div className="iso-bottom-controls">
                <div>
                  <button
                    className={cn(grid.visible && "active")}
                    onClick={() => setGrid({ visible: !grid.visible })}
                  >
                    <Grid3X3 size={14} /> Grid
                  </button>
                  <button className={cn(grid.snap && "active")} onClick={() => setGrid({ snap: !grid.snap })}>
                    <Magnet size={14} /> Snap
                  </button>
                  <button
                    className={cn(grid.ortho !== false && "active")}
                    title="Route along the six iso directions"
                    onClick={() => setGrid({ ortho: grid.ortho === false })}
                  >
                    <Move3d size={14} /> Ortho
                  </button>
                  <select
                    aria-label="Routing plane"
                    value={grid.plane}
                    onChange={(e) => setGrid({ plane: e.target.value as typeof grid.plane })}
                  >
                    {["xy", "xz", "yz"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                  <span>1 block</span>
                  <BlockScaleInput
                    className="iso-block-scale"
                    spacing={grid.spacing}
                    units={doc.units}
                    onCommit={(spacing) => setGrid({ spacing })}
                    onError={setError}
                  />
                  <datalist id="iso-block-scales">
                    {BLOCK_PRESETS.map((preset) => (
                      <option key={preset} value={preset} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.01, z / 1.2))}>
                    <ZoomOut size={15} />
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(32, z * 1.2))}>
                    <ZoomIn size={15} />
                  </button>
                  <button aria-label="Fit drawing" onClick={fit}>
                    <Maximize2 size={15} />
                  </button>
                </div>
              </div>
            </div>
            <aside className="iso-inspector">
              <div className="iso-inspector-heading">
                <Settings2 size={14} />
                <strong>
                  {tab === "sheet"
                    ? "Drawing setup"
                    : selectedRun
                      ? "Pipe properties"
                      : selectedNode
                        ? "Connection properties"
                        : "Routing properties"}
                </strong>
              </div>
              {tab === "sheet" ? (
                <>
                  {(
                    [
                      "title",
                      "drawing",
                      "revision",
                      "customer",
                      "project",
                      "drawnBy",
                      "checkedBy",
                      "notes",
                    ] as const
                  ).map((key) => (
                    <Field key={key} label={key.replace(/([A-Z])/g, " $1")}>
                      <input
                        aria-label={"Setup " + key}
                        value={doc[key]}
                        onChange={(e) =>
                          commit((d) => {
                            d[key] = e.target.value;
                          })
                        }
                      />
                    </Field>
                  ))}
                  <Field label="Paper size">
                    <select
                      value={doc.paper ?? "tabloid"}
                      onChange={(e) =>
                        commit((d) => {
                          d.paper = e.target.value as IsoDocument["paper"];
                        })
                      }
                    >
                      {["tabloid", "letter", "a3", "a4"].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Units">
                    <select
                      value={doc.units}
                      onChange={(e) => {
                        const units = e.target.value as IsoDocument["units"];
                        const previous = doc.units;
                        commit((d) => {
                          d.units = units;
                        });
                        try {
                          setSpan(lengthInputValue(parseLength(span, previous), units));
                        } catch {
                          setSpan(units === "imperial" ? "10'" : "1000");
                        }
                      }}
                    >
                      <option value="mm">Millimetres</option>
                      <option value="imperial">Feet / inches</option>
                    </select>
                  </Field>
                  <Field label="Isometric scale">
                    <BlockScaleInput
                      spacing={grid.spacing}
                      units={doc.units}
                      onCommit={(spacing) => setGrid({ spacing })}
                      onError={setError}
                    />
                  </Field>
                  <div className="iso-help">
                    One grid block is this centreline length. Type 12 in, 1 ft, or 100 mm — an explicit unit
                    works in either mode. Snap uses the same length. Double-click a pipe dimension to edit it.
                  </div>
                  {(["iso", "plan", "front", "side"] as const).map((v) => (
                    <label className="iso-check" key={v}>
                      <input
                        type="checkbox"
                        checked={(doc.outputViews ?? ["iso"]).includes(v)}
                        onChange={(e) =>
                          commit((d) => {
                            d.outputViews = e.target.checked
                              ? [...(d.outputViews ?? ["iso"]), v]
                              : (d.outputViews ?? ["iso"]).filter((x) => x !== v);
                          })
                        }
                      />
                      {v} PDF sheet
                    </label>
                  ))}
                  <Field label="North rotation (degrees)">
                    <input
                      type="number"
                      value={doc.north}
                      onChange={(e) =>
                        commit((d) => {
                          d.north = Number(e.target.value);
                        })
                      }
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Spool">
                    <input value={spool} onChange={(e) => setSpool(e.target.value)} />
                  </Field>
                  <Field label="Line number">
                    <input value={line} onChange={(e) => setLine(e.target.value)} />
                  </Field>
                  <Field label="Continue from">
                    <select value={start} onChange={(e) => selectConnection(e.target.value)}>
                      <option value="">New origin</option>
                      {doc.nodes
                        .filter((n) => !n.associatedRunId)
                        .map((n, i) => (
                          <option value={n.id} key={n.id}>
                            {labels[n.kind]} {i + 1} · {n.position.map((v) => formatLength(v, doc.units)).join(", ")}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <div className="iso-help">
                    Select an existing connection to continue or branch. Pipe cuts subtract fitting takeouts
                    and root gaps.
                  </div>
                  {selectedRun && (
                    <>
                      <Field label="Pipe specification">
                        <select
                          value={selectedRun.specId}
                          disabled={!!specBusy}
                          onChange={(e) => void chooseSpec(e.target.value, selection)}
                        >
                          {doc.specs.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                          {(library ?? []).some((l) => !doc.specs.some((s) => s.id === l.id)) && (
                            <optgroup label="Add from standard library">
                              {(library ?? [])
                                .filter((l) => !doc.specs.some((s) => s.id === l.id))
                                .map((l) => (
                                  <option value={"library:" + l.slug} key={l.slug}>
                                    {l.id + " · " + l.service}
                                  </option>
                                ))}
                            </optgroup>
                          )}
                        </select>
                      </Field>
                      <Field label="Pipe NPS">
                        <select
                          value={selectedRun.nps}
                          onChange={(e) =>
                            commit((d) => {
                              d.runs.find((r) => r.id === selection)!.nps = Number(e.target.value);
                            })
                          }
                        >
                          {getSpec(doc, selectedRun.specId).sizes.map((s) => (
                            <option key={s.nps} value={s.nps}>
                              {s.nps}″
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="iso-property-summary">
                        <span>
                          Overall
                          <strong>{formatLength(runResult(doc, selectedRun).overall, doc.units)}</strong>
                        </span>
                        <span>
                          Pipe cut<strong>{formatLength(runResult(doc, selectedRun).cut, doc.units)}</strong>
                        </span>
                      </div>
                      {!selectedRun.connector && <Field label="Overall length">
                        <input aria-label="Pipe overall length" key={selection + '-' + runResult(doc, selectedRun).overall + doc.units}
                          defaultValue={lengthInputValue(runResult(doc, selectedRun).overall, doc.units)}
                          onBlur={e => {
                            if (e.target.value === e.target.defaultValue) return;
                            try {
                              const value = parseLength(e.target.value, doc.units);
                              if (Math.abs(value - runResult(doc, selectedRun).overall) > 0.001)
                                commit(d => resizeRun(d, selection, value));
                            } catch (error) {
                              e.target.value = e.target.defaultValue;
                              setError(error instanceof Error ? error.message : String(error));
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') { e.currentTarget.value = e.currentTarget.defaultValue; e.currentTarget.blur(); }
                          }} />
                      </Field>}
                      {(["spool", "line", "heat"] as const).map((k) => (
                        <Field key={k} label={k}>
                          <input
                            value={selectedRun[k] ?? ""}
                            onChange={(e) =>
                              commit((d) => {
                                d.runs.find((r) => r.id === selection)![k] = e.target.value;
                              })
                            }
                          />
                        </Field>
                      ))}
                      {(["from", "to"] as const).map((end, i) => (
                        <div className="iso-connection" key={end}>
                          <strong>{i ? "End" : "Start"} connection</strong>
                          <Field label="Preparation">
                            <select
                              value={prepAt(selectedRun, i)}
                              onChange={(e) =>
                                commit((d) => {
                                  d.runs.find((r) => r.id === selection)![i ? "toPrep" : "fromPrep"] = e
                                    .target.value as "BW";
                                })
                              }
                            >
                              {["BW", "SW", "THD", "FL", "PLAIN"].map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </Field>
                          <label className="iso-check">
                            <input
                              type="checkbox"
                              checked={!!selectedRun[i ? "toField" : "fromField"]}
                              onChange={(e) =>
                                commit((d) => {
                                  d.runs.find((r) => r.id === selection)![i ? "toField" : "fromField"] =
                                    e.target.checked;
                                })
                              }
                            />
                            Field weld
                          </label>
                          <Field label="Weld tag">
                            <input
                              value={selectedRun[i ? "toTag" : "fromTag"] ?? ""}
                              onChange={(e) =>
                                commit((d) => {
                                  d.runs.find((r) => r.id === selection)![i ? "toTag" : "fromTag"] =
                                    e.target.value;
                                })
                              }
                            />
                          </Field>
                        </div>
                      ))}
                      <LengthInput
                        label="Root gap override"
                        aria="Root gap override"
                        mm={selectedRun.rootGap}
                        units={doc.units}
                        allowEmpty
                        onError={setError}
                        onCommit={(value) =>
                          commit((d) => {
                            d.runs.find((r) => r.id === selection)!.rootGap = value;
                          })
                        }
                      />
                      <div className="iso-inspector-section">
                        <strong>On this pipe</strong>
                        <p className="iso-help">
                          Choose a component in Insert to place it here. Elbows are added when the run changes
                          direction. Tees are added with Branch.
                        </p>
                        {!selectedRun.connector && <button className="iso-primary" onClick={() => commit(d => {
                          const junction = insertComponent(d, selection, 'tee', fraction / 100);
                          setStart(junction.id);
                          setSelection(junction.id);
                          setSpool(selectedRun.spool);
                          setLine(selectedRun.line);
                          setSpec(selectedRun.specId);
                          setNps(selectedRun.nps);
                          setTool('pipe');
                          setView('iso');
                        })}>Branch from this pipe</button>}
                      </div>
                    </>
                  )}
                  {selectedNode && (
                    <>
                      <div className="iso-node-title">
                        <ComponentGlyph
                          code={selectedNode.component ?? ""}
                          kind={selectedNode.kind}
                          size={28}
                        />
                        <span>
                          {COMPONENT_TYPES.find((t) => t.code === selectedNode.component)?.label ??
                            labels[selectedNode.kind]}
                          <small>{selectedNode.description}</small>
                        </span>
                      </div>
                      <Field label="Component type">
                        <select
                          value={selectedNode.component ?? ""}
                          onChange={(e) =>
                            commit((d) => {
                              const n = getNode(d, selection),
                                t = COMPONENT_TYPES.find((x) => x.code === e.target.value);
                              if (!t) return;
                              const edge = d.runs.find(r => r.id === selectedHeader?.id);
                              const row = edge
                                ? getSpec(d, edge.specId).fittings.find(
                                    (f) => rowComponent(f)?.code === t.code && f.nps === edge.nps,
                                  )
                                : undefined;
                              applyComponent(d, n, t.code, row);
                            })
                          }
                        >
                          {!selectedNode.component && <option value="">{labels[selectedNode.kind]}</option>}
                          {COMPONENT_TYPES.filter((t) =>
                            selectedNode.kind === "end"
                              ? t.kind === "cap" || t.kind === "flange"
                              : t.kind === selectedNode.kind ||
                                (["elbow90", "elbow45"].includes(selectedNode.kind) &&
                                  ["elbow90", "elbow45"].includes(t.kind)),
                          ).map((t) => (
                            <option value={t.code} key={t.code}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Catalogue">
                        <select
                          value={selectedNode.catalogId ?? ""}
                          onChange={(e) =>
                            commit((d) => {
                              const node = getNode(d, selection);
                              const row = d.specs.flatMap(s => s.fittings).find(f => f.id === e.target.value);
                              if (row?.component) applyComponent(d, node, row.component, row);
                              else node.catalogId = e.target.value || undefined;
                            })
                          }
                        >
                          <option value="">Custom / measured</option>
                          {getSpec(doc, selectedHeader?.specId ?? activeSpec.id)
                            .fittings.filter(
                              (f) =>
                                (selectedNode.component
                                  ? rowComponent(f)?.code === selectedNode.component
                                  : f.kind === selectedNode.kind) &&
                                f.nps ===
                                  (selectedHeader?.nps ?? nps),
                            )
                            .map((f) => (
                              <option key={f.id} value={f.id}>
                                {[f.smallerNps ? f.nps + "×" + f.smallerNps + "″" : "", f.rating, f.schedule, f.description]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <LengthInput
                        label="Measured takeout"
                        aria="Measured takeout"
                        mm={selectedNode.takeout}
                        units={doc.units}
                        allowEmpty
                        onError={setError}
                        onCommit={(value) =>
                          commit((d) => {
                            getNode(d, selection).takeout = value;
                          })
                        }
                      />
                      <details className="iso-offset">
                        <summary>Fabrication details</summary>
                        {(["weightKg", "areaM2", "unitCost", "laborHours", "quantity"] as const).map((k) => (
                          <Field key={k} label={k.replace(/([A-Z])/g, " $1")}>
                            <input
                              aria-label={"Component " + k}
                              type="number"
                              min="0"
                              value={selectedNode[k] ?? ""}
                              onChange={(e) =>
                                commit((d) => {
                                  getNode(d, selection)[k] =
                                    e.target.value === "" ? undefined : Number(e.target.value);
                                })
                              }
                            />
                          </Field>
                        ))}
                        <LengthInput
                          label="Branch takeout"
                          aria="Branch takeout"
                          mm={selectedNode.branchTakeout}
                          units={doc.units}
                          allowEmpty
                          onError={setError}
                          onCommit={(value) =>
                            commit((d) => {
                              getNode(d, selection).branchTakeout = value;
                            })
                          }
                        />
                        {connected(doc, selectedNode.id).map((r, i) => (
                          <LengthInput
                            key={r.id}
                            label={"Port " + (i + 1) + " takeout"}
                            aria={"Port " + (i + 1) + " takeout"}
                            mm={selectedNode.portTakeouts?.[r.id]}
                            units={doc.units}
                            allowEmpty
                            onError={setError}
                            onCommit={(value) =>
                              commit((d) => {
                                const n = getNode(d, selection);
                                n.portTakeouts ??= {};
                                if (value == null) delete n.portTakeouts[r.id];
                                else n.portTakeouts[r.id] = value;
                              })
                            }
                          />
                        ))}
                      </details>
                      <Field label="Description">
                        <input
                          value={selectedNode.description ?? ""}
                          onChange={(e) =>
                            commit((d) => {
                              getNode(d, selection).description = e.target.value;
                            })
                          }
                        />
                      </Field>
                      <button
                        className="iso-primary"
                        onClick={() => {
                          selectConnection(selection);
                          setTool("pipe");
                        }}
                      >
                        Continue / branch here
                      </button>
                    </>
                  )}
                  <details className="iso-offset">
                    <summary>Rolling offset · XYZ</summary>
                    <p className="iso-help">X = East / West, Y = North / South, Z = Up / Down. Use a minus sign for West, South or Down.</p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const values = new FormData(e.currentTarget);
                        try {
                          add(
                            ["x", "y", "z"].map((k) => parseLength(String(values.get(k)), doc.units, true)) as Vec3,
                          );
                        } catch (err) {
                          setError(String(err));
                        }
                      }}
                    >
                      {["x", "y", "z"].map((k) => (
                        <Field key={k} label={k.toUpperCase()}>
                          <input name={k} defaultValue="0" />
                        </Field>
                      ))}
                      <button className="iso-primary">Route offset</button>
                    </form>
                  </details>
                </>
              )}
              <div className={cn("iso-validation", issues.length ? "warning" : "valid")}>
                <strong>
                  {issues.length ? issues.length + " fabrication checks" : "Ready for fabrication review"}
                </strong>
                {issues.slice(0, 8).map((issue, i) => (
                  <p key={i}>{typeof issue === "string" ? issue : JSON.stringify(issue)}</p>
                ))}
              </div>
            </aside>
          </>
        )}
        {tab === "materials" && (
          <div className="iso-schedules">
            <div className="iso-schedule-title">
              <h2>Materials & pipe cuts</h2>
              <button onClick={() => void runExport("bom")}>
                <Download size={14} /> Material CSV
              </button>
              <button onClick={() => void runExport("cut")}>
                <Download size={14} /> Cut CSV
              </button>
            </div>
            <h3>Bill of materials</h3>
            <table>
              <thead>
                <tr>
                  {["Item", "Description", "Spec", "NPS", "Quantity", doc.units === "imperial" ? "Weight lb" : "Weight kg", "Spool", "Heat"].map(
                    (s) => (
                      <th key={s}>{s}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => {
                  const shown = displayBom(m, doc.units);
                  return (
                  <tr key={m.item}>
                    <td>{m.item}</td>
                    <td>{m.description}</td>
                    <td>{m.spec}</td>
                    <td>{m.nps}″</td>
                    <td>
                      {Number.isFinite(shown.quantity) ? round(shown.quantity) : "MISSING"} {shown.unit}
                    </td>
                    <td>{shown.weight == null ? "MISSING" : round(shown.weight)}</td>
                    <td>{m.spool}</td>
                    <td>{m.heat}</td>
                  </tr>
                )})}
              </tbody>
            </table>
            <h3>Pipe cut schedule</h3>
            <table>
              <thead>
                <tr>
                  {["Pipe", "Spool", "Overall", "Takeouts", "Root gaps", "Cut length"].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cuts.map((c, i) => (
                  <tr
                    key={c.run.id}
                    onClick={() => {
                      setSelection(c.run.id);
                      setTab("draw");
                    }}
                  >
                    <td>P{i + 1}</td>
                    <td>{c.run.spool}</td>
                    <td>{formatLength(c.overall, doc.units)}</td>
                    <td>{c.takeouts.map(v => Number.isFinite(v) ? formatAllowance(v, doc.units) : 'MISSING').join(" + ")}</td>
                    <td>{c.gaps.map(v => formatAllowance(v, doc.units)).join(" + ")}</td>
                    <td>
                      {Number.isFinite(c.cut) && c.cut > 0 ? formatLength(c.cut, doc.units) : "MISSING"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "welds" && (
          <div className="iso-schedules">
            <div className="iso-schedule-title">
              <h2>Weld map</h2>
              <Field label="Prefix">
                <input
                  value={doc.weldPrefix}
                  onChange={(e) =>
                    commit((d) => {
                      d.weldPrefix = e.target.value;
                    })
                  }
                />
              </Field>
              <Field label="Start">
                <input
                  type="number"
                  min="1"
                  value={doc.weldStart}
                  onChange={(e) =>
                    commit((d) => {
                      d.weldStart = Number(e.target.value);
                    })
                  }
                />
              </Field>
              <Field label="Numbering">
                <select
                  value={doc.weldNumbering ?? "numeric"}
                  onChange={(e) =>
                    commit((d) => {
                      d.weldNumbering = e.target.value as "numeric";
                    })
                  }
                >
                  <option value="numeric">Numeric</option>
                  <option value="alphabetic">Alphabetic</option>
                </select>
              </Field>
              <button onClick={() => void runExport("weld")}>
                <Download size={14} /> Weld CSV
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  {["Weld", "NPS", "Preparation", "Location", "Position XYZ"].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {joints.map((w, i) => (
                  <tr
                    key={w.tag + i}
                    onClick={() => {
                      setSelection(w.runId);
                      setTab("draw");
                    }}
                  >
                    <td>{w.tag}</td>
                    <td>{w.nps}″</td>
                    <td>{w.prep}</td>
                    <td>{w.field ? "Field" : "Shop"}</td>
                    <td>{w.position.map((v) => lengthInputValue(v, doc.units)).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "catalogue" && <ComponentLibrary specs={doc.specs} onInsert={chooseComponent} />}
        {tab === "specs" && (
          <SpecManager
            doc={doc}
            commit={commit}
            onError={setError}
            importSpecs={() => specInput.current?.click()}
          />
        )}
        {tab === "3d" && <div className="iso-3d" ref={three} aria-label="Interactive 3D piping review" />}
      </div>
      <footer className="iso-status">
        <span>
          <Layers size={12} />
          {doc.runs.length} pipes · {doc.nodes.length} connections · {joints.length} welds
        </span>
        <span>
          {busy
            ? "Preparing " + busy + "…"
            : tool === "pipe"
              ? start
                ? "Click to add pipe from the highlighted connection · Esc finishes this run"
                : "Click the grid to start a run on " + spool + " · or click a connection to continue from it"
              : surface === "paper"
                ? "Click the title block to edit · Scroll to zoom"
                : "Infinite model space · Drag with Pan or middle mouse"}
        </span>
        <span className={issues.length ? "warning" : "valid"}>
          {issues.length ? issues.length + " checks" : "Dimensions checked"}
        </span>
      </footer>
      <input
        ref={specInput}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importSpecs(file);
          e.target.value = "";
        }}
      />
      <input
        ref={importInput}
        type="file"
        accept=".piping,.json,.pcf,.dxf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = "";
        }}
      />
    </section>
  );
}
