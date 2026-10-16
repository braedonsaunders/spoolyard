
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
  Minimize2,
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
import { SheetLayer } from "./sheet-layer";
import { ECCENTRIC, NodeCallouts } from "./node-callouts";
import { SheetSettings } from "./sheet-settings";
import {
  appendRun,
  applyComponent,
  clone,
  connected,
  formatLength,
  getNode,
  getSpec,
  defaultEndPrep,
  fitting,
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
  styleOf,
  removeComponent,
  resizeRun,
  resizeRunToCut,
  sub,
  takeout,
  validateIso,
  type IsoDocument,
  type CatalogItem,
  type Kind,
  type PipeNode,
  type PipeRun,
  type EndPrep,
  type Vec3,
} from "../core/model";
import { createDrawing, sheetWidth, type Drawing, type Point, type SheetFit } from "../core/drawing";
import { defaultGrid, GRID_ORIGIN, gridLines, gridSvg, pickGridPoint, pickOrthoPoint } from "../core/grid";
import { importPcf, exportPcf } from "../core/pcf";
import { sizeText } from "../core/format";
import {
  UNKNOWN,
  allowanceText,
  cutSchedule,
  cutText,
  overallText,
  lengthUnits,
  materialCsv,
  materialSchedule,
  pieceText,
  weldSchedule,
} from "../core/schedules";
import { download } from "./download";
import { exportDwg } from "./dwg";
import { isometricDxf, readIsometric } from "../core/document";
import { usePipingSave } from "./use-piping-save";
import { COMPONENT_TYPES, type ComponentType } from "../core/components";
import { SpecManager, rowComponent } from "./spec-manager";
import { defaultNps, loadLibrarySpec, loadSpecIndex, newIsoWithDefaultSpec, type LibrarySpecSummary } from "./library";
import { SpoolyardMark } from "./mark";
import { ComponentLibrary, ComponentPalette, inches, sizeLabel } from "./component-palette";
import { ComponentGlyph } from "./component-glyph";
import { pipeAtPoint, type PipeHit } from "./pipe-hit";
import {
  canRouteFrom,
  componentFaces,
  componentTrack,
  continueFlow,
  isSquareTurn,
  placeAtTurn,
  directionName,
  endCapable,
  legPoint,
  moveComponentAlongPipe,
  pipeLeg,
  placeComponentOnPipe,
  placementStep,
  reduceAtJoint,
  routeError,
  setLineFlow,
  sized,
  sizeChoices,
  snapAlongLeg,
  snapNearFace,
  type ComponentTrack,
} from "../core/component-position";
import { nodeItem } from "../core/joints";
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
/** The last open pipe end: where typed routing carries on after opening, undo or delete. */
const lastOpenEnd = (d: IsoDocument) => [...d.nodes].reverse().find((n) => n.kind === "end" && connected(d, n.id).length === 1)?.id ?? "";
/** Why a pipe cannot start from a connection that has no free end. */
const noFreeEnd = (d: IsoDocument, nodeId: string) => {
  const node = getNode(d, nodeId), name = COMPONENT_TYPES.find((t) => t.code === node.component)?.label ?? labels[node.kind] ?? "connection";
  return `The ${name.toLowerCase()} has no free end to route from. Select an open end, or click a pipe with the Pipe tool to branch from it.`;
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
  onCommit: (mm: number | undefined) => void | boolean;
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
            if (mm == null || Math.abs(value - mm) > 0.001) {
              if (onCommit(value) === false) e.target.value = shown;
            } else e.target.value = shown;
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
      aria-pressed={active}
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
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [stageSize, setStageSize] = useState({ width: 1100, height: 850 });
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
  const [insertHover, setInsertHover] = useState<PipeHit | null>(null);
  // A Pipe-tool start not in the drawing yet: a new run's first point, or the point on a pipe a branch will leave.
  const [pending, setPending] = useState<{ position: Vec3; runId?: string; fraction?: number } | null>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
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
  // A left-button press waits for movement before it pans, so the same press can still click.
  const drag = useRef<{ x: number; y: number; pan: Point; scale: number; pending: boolean; moved: boolean } | null>(null);
  const [spacePan, setSpacePan] = useState(false);
  const viewState = useRef({ zoom: 1, pan: [0, 0] as Point, width: 1100, sheet: 1100 });
  const lengthCancel = useRef(false);
  const lengthClosing = useRef(false);
  const nodeDrag = useRef<{
    id: string;
    point: Point;
    anchor: Vec3;
    destination: Vec3;
    moved: boolean;
    track: ComponentTrack | null;
  } | null>(null);
  const latest = useRef(doc);
  latest.current = doc;
  const activeSpec = doc.specs.find(s => s.id === spec) ?? doc.specs[0];
  // Routing from a connection keeps its end preparation (an olet's socket, say) rather than the size's default.
  const connectionPrep = useRef<{ prep: EndPrep; spec: string; nps: number } | null>(null);
  const routeWith = (prep: EndPrep, specId: string, size: number) => {
    connectionPrep.current = { prep, spec: specId, nps: size };
    setRoutingPrep(prep);
  };
  useEffect(() => {
    if (activeSpec.id !== spec) setSpec(activeSpec.id);
    if (!activeSpec.sizes.some(size => size.nps === nps)) setNps(defaultNps(activeSpec));
    const kept = connectionPrep.current;
    setRoutingPrep(kept && kept.spec === spec && kept.nps === nps ? kept.prep : defaultEndPrep(activeSpec, nps));
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
        setStart(lastOpenEnd(loaded));
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
      return false;
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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
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
    setStart(lastOpenEnd(next));
    setPending(null);
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
      setStart(lastOpenEnd(d));
      setPending(null);
    });
  const activateTool = (next: string) => {
    setArmed(null);
    setInsertHover(null);
    setCursor(null);
    setPending(null);
    setTool(next);
    if (next === "pipe") setView("iso");
  };
  const closeExport = () => {
    if (!exportMenu.current?.open) return false;
    exportMenu.current.open = false;
    return true;
  };
  useEffect(() => {
    closeExport();
  }, [tab]);
  useEffect(() => {
    // The Export menu closes on a click anywhere else.
    const outside = (e: globalThis.PointerEvent) => {
      if (!exportMenu.current?.contains(e.target as Node)) closeExport();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("Fullscreen could not start. Check that your browser allows fullscreen for this page.");
    }
  };
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width && height) setStageSize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tab]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeExport()) return;
      if (e.key === "Escape" && document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
        return;
      }
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
          setInsertHover(null);
          return;
        }
        // First Esc finishes the run in progress; the next click starts a new one. A second Esc leaves the Pipe tool.
        if (tool === "pipe" && (start || pending)) {
          setStart("");
          setPending(null);
        } else setTool("select");
        setCursor(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.ctrlKey || e.metaKey || e.altKey) return;
      else if (e.key.toLowerCase() === "p") activateTool("pipe");
      else if (e.key.toLowerCase() === "h") activateTool("pan");
      else if (e.key.toLowerCase() === "v") activateTool("select");
      else if (e.key.toLowerCase() === "i") activateTool("insert");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    // Hold Space to pan with the left button from any tool.
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement)?.closest("input,select,textarea,[contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e)) return;
      e.preventDefault();
      setSpacePan(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpacePan(false); };
    const blur = () => setSpacePan(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    // React registers wheel listeners as passive; zooming and trackpad panning must cancel page scrolling.
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".iso-view-controls,.iso-bottom-controls,input,select,textarea")) return;
      e.preventDefault();
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as a ctrl+wheel with small deltas; ctrl+mouse wheel steps.
        navigation.current.zoomAt(e.clientX, e.clientY, Math.exp(-Math.max(-50, Math.min(50, e.deltaY * lines)) * 0.01));
        return;
      }
      const notch = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50) ||
        (e.deltaX === 0 && Math.abs((e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0) % 120 === 0 && ((e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0) !== 0);
      if (notch) navigation.current.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      else navigation.current.panBy(e.deltaX * lines, e.deltaY * lines);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [tab, ready]);
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
  const startNode = doc.nodes.find((n) => n.id === start);
  // A Pipe-tool click routes on only from a start the user chose: the connection they picked, the end they just
  // routed to, or a pending start. The last open end left over from opening, undo or delete is not one.
  const routing = !!pending || (!!startNode && selection === start);
  const spools = [...new Set([...doc.runs.map((r) => r.spool), spool])].sort();
  const newSpool = () => {
    const numbers = spools.map((s) => Number(/(\d+)$/.exec(s)?.[1] ?? 0));
    setSpool("SP-" + String(Math.max(0, ...numbers) + 1).padStart(3, "0"));
    setStart("");
    setSelection("");
    setPending(null);
    setTool("pipe");
    setView("iso");
  };
  const grid = doc.grid ?? defaultGrid(),
    anchor = pending?.position ?? startNode?.position ?? ([0, 0, 0] as Vec3);
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
          ? createDrawing(doc, filter, view, { ...held, centre: fresh.fit.centre })
          : fresh;
      if (outside(d)) d = fresh;
    }
    heldFit.current = d.fit;
    return d;
  }, [doc, filter, surface, view, holding]);
  const sheetPrimitives = drawing.primitives;
  const sheetStyle = styleOf(doc), notToScale = surface === "paper" && sheetStyle.layout === "schematic";
  // A pending start is not in the drawing: off its pipes a not-to-scale sheet is drawn at one scale, so the route from
  // it is measured at that scale from where the start is drawn, not from whichever connection is nearest.
  const routeDrawing = useMemo((): Drawing => {
    if (!pending) return drawing;
    const far: Vec3 = [1e9, 1e9, 1e9], base = drawing.project(far), origin = drawing.project(pending.position);
    return {
      ...drawing,
      project: (p: Vec3): Point => {
        const q = drawing.project([0, 1, 2].map((i) => far[i] + p[i] - pending.position[i]) as Vec3);
        return [origin[0] + q[0] - base[0], origin[1] + q[1] - base[1]];
      },
    };
  }, [drawing, pending]);
  const pick = (p: Point) =>
    routing && grid.ortho !== false ? pickOrthoPoint(routeDrawing, p, anchor, grid) : pickGridPoint(routeDrawing, p, anchor, grid);
  const viewportWidth = surface === "grid" ? 850 * stageSize.width / stageSize.height : W;
  const viewportX = W / 2 - viewportWidth / 2 / zoom + pan[0];
  const viewportY = 425 - 425 / zoom + pan[1];
  viewState.current = { zoom, pan, width: viewportWidth, sheet: W };
  /** Zoom so the drawing point under the pointer stays under it. */
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const { zoom: current, pan: [px, py], width, sheet } = viewState.current;
    const next = Math.min(32, Math.max(0.01, current * factor)),
      matrix = svg.current?.getScreenCTM();
    if (next === current) return;
    if (!matrix) return setZoom(next);
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    const left = sheet / 2 - width / 2 / current + px, top = 425 - 425 / current + py;
    const nextLeft = p.x - (p.x - left) * current / next, nextTop = p.y - (p.y - top) * current / next;
    viewState.current = { ...viewState.current, zoom: next, pan: [nextLeft - sheet / 2 + width / 2 / next, nextTop - 425 + 425 / next] };
    setZoom(next);
    setPan(viewState.current.pan);
  };
  const panBy = (dx: number, dy: number) => {
    const scale = svg.current?.getScreenCTM()?.a || 1, [px, py] = viewState.current.pan;
    viewState.current = { ...viewState.current, pan: [px + dx / scale, py + dy / scale] };
    setPan(viewState.current.pan);
  };
  const navigation = useRef({ zoomAt, panBy });
  navigation.current = { zoomAt, panBy };
  const modelGrid = surface === "grid" && grid.visible
    ? gridLines(drawing, GRID_ORIGIN, grid, doc.units, {
        area: [viewportX, viewportY, viewportX + viewportWidth / zoom, viewportY + 850 / zoom],
        minSpacing: 18 * 850 / stageSize.height / zoom,
      })
    : null;
  const issues = useMemo(() => validateIso(doc), [doc]),
    materials = useMemo(() => materialSchedule(doc), [doc]),
    cuts = useMemo(() => doc.runs.filter(r => !r.connector).map((r) => runResult(doc, r)), [doc]),
    pieces = useMemo(() => cutSchedule(doc), [doc]),
    joints = useMemo(() => weldSchedule(doc), [doc]);
  const selectedRun = doc.runs.find((r) => r.id === selection),
    selectedNode = doc.nodes.find((n) => n.id === selection);
  const selectedTrack = selectedNode ? componentTrack(doc, selectedNode.id) : null;
  const selectedTurn = !!selectedNode && isSquareTurn(doc, selectedNode.id);
  const selectedFaces = useMemo(() => (selectedTrack && selectedNode ? componentFaces(doc, selectedNode.id) : null), [doc, selectedNode, selectedTrack]);
  const pendingCuts = cuts.filter(c => !Number.isFinite(c.cut) || c.cut <= 0);
  const missingTakeoutNodes = doc.nodes.filter(node => cuts.some(c =>
    (c.run.from === node.id || c.run.to === node.id) && takeout(doc, node, c.run.id) == null));
  const selectedEdges = selectedNode ? connected(doc, selectedNode.id) : [];
  const selectedHeader = selectedEdges.reduce<typeof selectedEdges[number] | undefined>((largest, run) => !largest || run.nps > largest.nps ? run : largest, undefined)
    ?? doc.runs.find(r => r.id === selectedNode?.associatedRunId);
  const selectConnection = (key: string, d = doc) => {
    setStart(key);
    setSelection(key);
    setPending(null);
    const node = d.nodes.find((n) => n.id === key), run = connected(d, key)[0], host = d.runs.find((r) => r.id === node?.associatedRunId);
    if (run) {
      setSpool(run.spool);
      setLine(run.line);
      setSpec(run.specId);
      setNps(run.nps);
      routeWith(prepAt(run, run.from === key ? 0 : 1), run.specId, run.nps);
    } else if (host && node?.kind === "olet") {
      // An olet's branch is routed at the olet's size, with its socket, thread or butt weld.
      const size = fitting(d, node)?.nps ?? nodeItem(d, node)?.nps ?? host.nps;
      setSpool(host.spool);
      setLine(host.line);
      setSpec(host.specId);
      setNps(size);
      routeWith(branchPrep(node.component, prepAt(host, 0)), host.specId, size);
    }
  };
  const branchPrep = (code: string | undefined, header: EndPrep): EndPrep => {
    const prep = COMPONENT_TYPES.find((t) => t.code === code)?.endPrep;
    return prep && prep !== "PLAIN" && prep !== "FL" ? prep : header;
  };
  /** Start the branch of a tee or olet just placed: the Pipe tool routes from it at the branch size and its end. */
  const routeBranch = (d: IsoDocument, nodeId: string, nps: number) => {
    selectConnection(nodeId, d);
    const node = getNode(d, nodeId), host = connected(d, nodeId)[0] ?? d.runs.find((r) => r.id === node.associatedRunId)!;
    setNps(nps);
    routeWith(branchPrep(node.component, prepAt(host, host.from === nodeId ? 0 : 1)), host.specId, nps);
    setTool("pipe");
    setView("iso");
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
        Math.max(0.01, Math.min(viewportWidth * 0.8 / Math.max(200, maxX - minX), 600 / Math.max(150, maxY - minY))),
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
      if (pending?.runId) {
        // A branch's tee goes into its pipe once the branch has somewhere to go.
        from = insertComponent(d, pending.runId, "tee", pending.fraction!).id;
      } else if (pending) {
        const origin = { id: id(), kind: "end" as const, position: pending.position };
        d.nodes.push(origin);
        from = origin.id;
      } else if (!from && d.nodes.length) {
        // A new run typed by length starts beside the existing work rather than on top of it.
        const origin = { id: id(), kind: "end" as const, position: [Math.max(...d.nodes.map((n) => n.position[0])) + 1000, 0, 0] as Vec3 };
        d.nodes.push(origin);
        from = origin.id;
      }
      if (from && !pending && !canRouteFrom(d, from)) throw new Error(noFreeEnd(d, from));
      const problem = from && routeError(d, from, delta);
      if (problem) throw new Error(problem);
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
      // Routed on at another size, the line gets a reducer at the joint; it carries its flow on.
      if (from) reduceAtJoint(d, from);
      continueFlow(d, d.runs.at(-1)!.id);
      setStart(node.id);
      setSelection(node.id);
      setPending(null);
    });
  const point = (event: PointerEvent): Point | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [p.x, p.y];
  };
  const insertionTarget = (event: PointerEvent): PipeHit | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const owner = (event.target as Element).closest("[data-owner]")?.getAttribute("data-owner") ?? '';
    const toScreen = ([x, y]: Point): Point => {
      const screen = new DOMPoint(x, y).matrixTransform(matrix);
      return [screen.x, screen.y];
    };
    const nearest = pipeAtPoint(doc, drawing, [event.clientX, event.clientY], toScreen, owner);
    // A dimension also identifies its pipe, even when its label is offset from the centreline.
    return nearest ?? (owner ? pipeAtPoint(doc, drawing, [event.clientX, event.clientY], toScreen, owner, 32) : null);
  };
  const insertFitting = (runId: string, type: ComponentType, row?: CatalogItem, position = fraction / 100, clicked = false) => {
    const before = latest.current;
    let placed: PipeNode | undefined;
    commit((d) => {
      placed = placeComponentOnPipe(d, runId, type, position, row);
      if (clicked) snapNearFace(d, placed.id);
      setSelection(placed.id);
    });
    if (latest.current === before) return;
    setArmed(null);
    setInsertHover(null);
    // A tee or olet is placed to take a branch: route it straight away, at the branch size.
    if (placed && (type.kind === "tee" || type.kind === "olet") && canRouteFrom(latest.current, placed.id)) {
      const branch = type.kind === "olet" ? row?.nps : row?.smallerNps ?? row?.nps;
      routeBranch(latest.current, placed.id, branch ?? latest.current.runs.find((r) => r.id === runId)!.nps);
    }
  };
  // The size a reducer, tee or olet is placed at, on the pipe the palette is showing.
  const paletteSpec = doc.specs.find((s) => s.id === (selectedRun?.specId ?? spec)) ?? doc.specs[0];
  const paletteNps = selectedRun?.nps ?? nps;
  const armedChoices = armed && sized(armed.type) ? sizeChoices(paletteSpec, armed.type, paletteNps) : [];
  const chooseComponent = (type: ComponentType, row?: CatalogItem) => {
    setTool("insert");
    setTab("draw");
    setError("");
    setInsertHover(null);
    setPending(null);
    const choices = sized(type) ? sizeChoices(paletteSpec, type, paletteNps) : [];
    const chosen = row ?? (choices.find((c) => type.kind === "tee" && c.to === paletteNps) ?? choices[0])?.row;
    setArmed((current) => (current && current.type.code === type.code && current.row?.id === chosen?.id ? null : { type, row: chosen }));
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
    if (armed && tool === "insert" && armed.type.angle) {
      // An angle or relief valve goes at a square turn: click the elbow it replaces.
      const turn = node ?? (owner && doc.nodes.some((n) => n.id === owner) ? owner : undefined);
      if (turn && isSquareTurn(doc, turn)) {
        if (commit((d) => setSelection(placeAtTurn(d, turn, armed.type, undefined, armed.row).id))) {
          setArmed(null);
          setInsertHover(null);
        }
      } else setError(`${armed.type.label} has an angle body. Click a 90° elbow to put it there.`);
      return;
    }
    if (armed && tool === "insert") {
      const hit = insertionTarget(event);
      if (hit) {
        // Flanges, blinds and caps dropped on an open pipe end become that end.
        const run = doc.runs.find(r => r.id === hit.runId)!, endNode = hit.end == null ? undefined : getNode(doc, hit.end === 0 ? run.from : run.to);
        const onEnd = endNode && endCapable(armed.type) && endNode.kind === "end" && connected(doc, endNode.id).length === 1;
        const at = onEnd ? { runId: hit.runId, fraction: hit.end! } : snapAlongLeg(doc, hit.runId, hit.fraction);
        const choices = sized(armed.type) ? sizeChoices(getSpec(doc, run.specId), armed.type, run.nps) : [];
        if (choices.length && !choices.some((c) => c.row.id === armed.row?.id)) {
          // The size was chosen for another pipe: offer this pipe's sizes and ask again.
          setSelection(run.id);
          setArmed({ type: armed.type, row: choices[0].row });
          setError(`The size shown was for a ${inches(paletteNps)} pipe. Choose the size for this ${inches(run.nps)} pipe, then click it again.`);
          return;
        }
        insertFitting(at.runId, armed.type, armed.row, at.fraction, !onEnd);
      }
      else setError("No pipe at that point. Click a straight pipe or its dimension label to place " + armed.type.label + ".");
      return;
    }
    if (tool === "pipe") {
      routeClick(event, node);
      return;
    }
    if (node) {
      selectConnection(node);
      return;
    }
    if (owner && (tool === "select" || tool === "insert")) {
      setSelection(owner);
      return;
    }
    setSelection("");
  };
  /** The point on a pipe the Pipe tool is over, where a click starts a branch. */
  const branchTarget = (event: PointerEvent): PipeHit | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const hit = pipeAtPoint(doc, drawing, [event.clientX, event.clientY], ([x, y]) => {
      const screen = new DOMPoint(x, y).matrixTransform(matrix);
      return [screen.x, screen.y];
    });
    return hit && hit.end == null ? hit : null;
  };
  /** A branch from a point on a pipe, at the pipe's size; its tee goes in once the branch is routed. */
  const startBranch = ({ runId, fraction: at }: { runId: string; fraction: number }) => {
    const run = doc.runs.find((r) => r.id === runId)!;
    const a = getNode(doc, run.from).position, b = getNode(doc, run.to).position;
    setPending({ position: a.map((v, i) => v + (b[i] - v) * at) as Vec3, runId, fraction: at });
    setStart("");
    setSelection("");
    setSpool(run.spool);
    setLine(run.line);
    setSpec(run.specId);
    setNps(run.nps);
    routeWith(prepAt(run, 0), run.specId, run.nps);
    setError("");
    setArmed(null);
    setTool("pipe");
    setView("iso");
  };
  // Clicks place at whole millimetres or sixteenths along the straight, as previewed.
  const snapHit = (hit: PipeHit): PipeHit => (hit.end == null ? { ...hit, ...snapAlongLeg(doc, hit.runId, hit.fraction) } : hit);
  /**
   * A Pipe-tool click: a connection with a free end starts a run from it; a pipe starts a branch from that point; open
   * sheet starts a new run or, with a run in progress, routes the pipe there. A fitting with no free end, or the title block, asks instead.
   */
  const routeClick = (event: PointerEvent, node?: string | null) => {
    try {
      const p = point(event);
      if (!p) return;
      if (node) {
        if (routing && node !== start) add(sub(getNode(doc, node).position, anchor));
        else if (canRouteFrom(doc, node)) selectConnection(node);
        else
          setError(noFreeEnd(doc, node));
        return;
      }
      const hit = branchTarget(event);
      if (hit) {
        startBranch(snapAlongLeg(doc, hit.runId, hit.fraction));
        return;
      }
      const [x0, y0, x1, y1] = drawing.area;
      if (surface === "paper" && !(p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1)) {
        setError("Click inside the drawing area to route a pipe, or on a pipe to branch from it.");
        return;
      }
      const destination = pick(p);
      if (routing) add(sub(destination, anchor));
      else {
        setPending({ position: destination });
        setStart("");
        setSelection("");
        setError("");
      }
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
      else if (format === "bom") download(doc.drawing + "-materials.csv", materialCsv(doc), "text/csv");
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
      setStart(lastOpenEnd(next));
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
    if (armed) return;
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
      `:is(text, path)[data-length="${lengthEdit.role}"][data-owner="${CSS.escape(lengthEdit.runId)}"]`,
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
          <button
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={fullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
            aria-pressed={fullscreen}
            disabled={!document.fullscreenEnabled}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
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
        <details className="iso-export-menu" ref={exportMenu}>
          <summary>
            <Download size={14} /> Export <ChevronDown size={12} />
          </summary>
          <div>
            {["PDF", "DWG", "DXF", "PCF", "SVG", "JSON", "bom", "cut", "weld"].map((format) => (
              <button key={format} disabled={!!busy || !ready} onClick={() => { closeExport(); void runExport(format); }}>
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
                onClick={() => activateTool("select")}
              />
              <Tool name="Pan" icon={Hand} active={tool === "pan"} onClick={() => activateTool("pan")} />
              <Tool
                name="Pipe"
                icon={MoveUpRight}
                active={tool === "pipe"}
                onClick={() => activateTool("pipe")}
              />
              <Tool name="Insert" icon={Plus} active={tool === "insert"} onClick={() => activateTool("insert")} />
            </div>
            <small>DRAW · V / H / P / I</small>
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
                      {inches(s.nps)}
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
        {tab === "draw" && tool === "insert" && (
          <aside className="iso-components" aria-label="Insert component">
            <div className="iso-components-head">
              <strong>Insert</strong>
              <small>
                {armed
                  ? (armed.type.angle ? "Click a 90° elbow to put " : "Click a pipe to place ") + armed.type.label + (armed.type.angle ? " there" : "") + ". Esc cancels."
                  : "Choose a component, then click where it belongs on the pipe. Drag it or enter a distance to adjust it."}
              </small>
              {armed && armedChoices.length > 0 && (
                <Field label={armed.type.kind === "reducer" ? "Size · reduce or expand" : armed.type.kind === "olet" ? "Header × branch" : "Run × branch"}>
                  <select
                    aria-label="Component size"
                    value={armed.row?.id ?? ""}
                    onChange={(e) => {
                      const row = armedChoices.find((c) => c.row.id === e.target.value)?.row;
                      setArmed({ type: armed.type, row });
                    }}
                  >
                    {armedChoices.map((c) => (
                      <option key={c.row.id} value={c.row.id}>
                        {sizeLabel(armed.type, c, paletteNps)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {armed && selectedRun && !selectedRun.connector && (
                <>
                  <Field label="Centre along straight (%)">
                    <input
                      type="number"
                      min="1"
                      max="99"
                      aria-label="Position along pipe"
                      value={round(fraction, 2)}
                      onChange={(e) => setFraction(Number(e.target.value))}
                    />
                  </Field>
                  <button className="iso-primary" onClick={() => {
                    const leg = pipeLeg(doc, selectedRun.id), target = leg && legPoint(doc, selectedRun.id, leg.length * fraction / 100);
                    if (target) insertFitting(target.runId, armed.type, armed.row, target.fraction);
                    else setError("Position must be between the ends of the straight pipe.");
                  }}>
                    Place at this distance
                  </button>
                  <Field label="Centre from start of straight">
                    <input
                      aria-label="Component distance from pipe start"
                      key={selection + "-" + fraction}
                      defaultValue={lengthInputValue(
                        (pipeLeg(doc, selectedRun.id)?.length ?? 0) * fraction / 100,
                        doc.units,
                      )}
                      onBlur={(e) => {
                        if (e.target.value === e.target.defaultValue) return;
                        try {
                          const distance = parseLength(e.target.value, doc.units),
                            overall = pipeLeg(doc, selectedRun.id)?.length ?? 0;
                          if (distance <= 0 || distance >= overall)
                            throw new Error("Position must be between the ends of the straight pipe.");
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
                spec={paletteSpec}
                nps={paletteNps}
                armed={armed ? { code: armed.type.code, rowId: armed.row?.id } : undefined}
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
                <select aria-label="Sheet scale" value={sheetStyle.layout} disabled={surface === "grid"}
                  title="Production isometrics are drawn not to scale so short pieces stay readable"
                  onChange={(e) => commit((d) => { d.style = { ...styleOf(d), layout: e.target.value as "scale" | "schematic" }; })}>
                  <option value="schematic">Not to scale</option>
                  <option value="scale">To scale</option>
                </select>
                <select aria-label="Visible spool" value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="">All spools</option>
                  {[...new Set(doc.runs.map((r) => r.spool))].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              {!!pendingCuts.length && !armed && <button className="iso-cut-notice" onClick={() => setTab("materials")}>
                Pipe lengths pending · Review {pendingCuts.length} {pendingCuts.length === 1 ? "cut" : "cuts"}
              </button>}
              {armed && tab === "draw" && (
                <div className="iso-place-hint" role="status">
                  {insertHover ? "Click to place " : armed.type.angle ? "Click a 90° elbow to place " : "Click a pipe to place "}{armed.type.label}
                  <button type="button" onClick={() => { setArmed(null); setInsertHover(null); }}>
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
                    (tool === "pan" || spacePan) && "panning",
                    armed && tool === "insert" && "placing",
                  )}
                  viewBox={[
                    viewportX,
                    viewportY,
                    viewportWidth / zoom,
                    850 / zoom,
                  ].join(" ")}
                  aria-label="Editable isometric drawing"
                  onPointerDown={(e) => {
                    const target = e.target as Element;
                    const owner = target.closest("[data-owner]")?.getAttribute("data-owner");
                    const node = target.closest("[data-node]")?.getAttribute("data-node") ?? doc.nodes.find(n => n.id === owner)?.id;
                    const p = point(e);
                    if (e.button === 0 && !spacePan && (tool === "select" || tool === "insert" && !armed) && node && p) {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const position = getNode(doc, node).position;
                      nodeDrag.current = {
                        id: node,
                        point: p,
                        anchor: [...position],
                        destination: [...position],
                        moved: false,
                        track: componentTrack(doc, node),
                      };
                      selectConnection(node);
                      return;
                    }
                    const immediate = tool === "pan" || spacePan || e.button === 1 || e.button === 2;
                    if (immediate || e.button === 0) {
                      // Middle, right, Space or the Pan tool pan at once; a plain left press pans only once it moves.
                      if (immediate) {
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }
                      drag.current = { x: e.clientX, y: e.clientY, pan: [...pan], scale: svg.current?.getScreenCTM()?.a ?? 1, pending: !immediate, moved: false };
                    }
                  }}
                  onPointerMove={(e) => {
                    if (nodeDrag.current) {
                      const p = point(e),
                        state = nodeDrag.current;
                      if (p) {
                        const origin = drawing.project(state.anchor);
                        try {
                          if (state.track) {
                            // Slide between the points the component cannot pass, as drawn: on a not-to-scale sheet the
                            // pipe between them is drawn to its own length, so map the pointer within that span.
                            const track = state.track, node = getNode(doc, state.id);
                            const host = doc.runs.find(r => r.id === node.associatedRunId);
                            const far = (runId: string) => { const r = doc.runs.find(x => x.id === runId)!; return r.from === state.id ? r.to : r.from; };
                            const [lo, hi] = host ? [host.from, host.to] : [far(track.runIds[0]), far(track.runIds[1])];
                            const u = sub(track.to, track.from).map(v => v / track.length) as Vec3;
                            const station = (id: string) => sub(getNode(doc, id).position, track.from).reduce((sum, v, i) => sum + v * u[i], 0);
                            const a = drawing.positions.get(lo)!, b = drawing.positions.get(hi)!, sa = station(lo), sb = station(hi);
                            const dx = b[0] - a[0], dy = b[1] - a[1];
                            const t = ((origin[0] + p[0] - state.point[0] - a[0]) * dx + (origin[1] + p[1] - state.point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
                            const margin = 0.0001 * track.length;
                            const step = placementStep(doc.units), along = Math.round((sa + (sb - sa) * t) / step) * step;
                            const distance = Math.max(Math.max(track.min, Math.min(sa, sb)) + margin, Math.min(Math.min(track.max, Math.max(sa, sb)) - margin, along));
                            state.destination = track.from.map((v, i) => v + u[i] * distance) as Vec3;
                          } else state.destination = pickGridPoint(
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
                      const state = drag.current, distance = Math.hypot(e.clientX - state.x, e.clientY - state.y);
                      if (state.pending) {
                        if (distance < 6) return;
                        state.pending = false;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setInsertHover(null);
                        setCursor(null);
                      }
                      state.moved ||= distance >= 3;
                      viewState.current = { ...viewState.current, pan: [state.pan[0] - (e.clientX - state.x) / state.scale, state.pan[1] - (e.clientY - state.y) / state.scale] };
                      setPan(viewState.current.pan);
                      return;
                    }
                    if (armed && tool === "insert") {
                      const hit = armed.type.angle ? null : insertionTarget(e);
                      setInsertHover(hit && snapHit(hit));
                      return;
                    }
                    if (tool === "pipe") {
                      // Over a pipe, a click branches from it: show where the tee goes instead of a route.
                      const over = (e.target as Element).closest("[data-node]") ? null : branchTarget(e);
                      setInsertHover(over && snapHit(over));
                      try {
                        const p = point(e);
                        if (p) setCursor(pick(p));
                      } catch {}
                    }
                  }}
                  onPointerLeave={() => setInsertHover(null)}
                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                  onContextMenu={(e) => e.preventDefault()}
                  onPointerCancel={() => { nodeDrag.current = null; drag.current = null; setCursor(null); setInsertHover(null); }}
                  onPointerUp={(e) => {
                    if (nodeDrag.current) {
                      const state = nodeDrag.current;
                      nodeDrag.current = null;
                      e.currentTarget.releasePointerCapture(e.pointerId);
                      setCursor(null);
                      if (state.moved)
                        commit((d) => {
                          if (state.track) {
                            moveComponentAlongPipe(d, state.id, Math.hypot(...sub(state.destination, state.track.from)));
                            snapNearFace(d, state.id);
                            return;
                          }
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
                      const state = drag.current;
                      drag.current = null;
                      if (!state.pending) {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                        return;
                      }
                    }
                    if (!armed && (e.target as Element).closest("[data-length]") && e.detail >= 2) return;
                    place(e);
                  }}
                >
                  {surface === "paper" && (
                    <rect x="0" y="0" width={W} height="850" fill="#fff" />
                  )}
                  {modelGrid && (
                    <g data-isometric-grid="true" pointerEvents="none">
                      {modelGrid.lines.map((line, i) => (
                        <line key={i} x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]}
                          className={cn("iso-grid-line", line.major && "major")} vectorEffect="non-scaling-stroke" />
                      ))}
                    </g>
                  )}
                  {surface === "paper" && grid.visible && !notToScale && (
                    <g dangerouslySetInnerHTML={{ __html: gridSvg(drawing, GRID_ORIGIN, grid, doc.units) }} />
                  )}
                  <SheetLayer
                    primitives={sheetPrimitives}
                    lettering={drawing.lettering}
                    background={surface === "paper" ? "white" : "var(--iso-canvas)"}
                    selection={selection}
                    editing={lengthEdit}
                    onEditLength={openLength}
                  />
                  {(armed || tool === "pipe") && insertHover && (() => {
                    const run = doc.runs.find(r => r.id === insertHover.runId);
                    if (!run) return null;
                    const a = drawing.positions.get(run.from), b = drawing.positions.get(run.to);
                    if (!a || !b) return null;
                    return <g pointerEvents="none" className="iso-insert-preview">
                      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} vectorEffect="non-scaling-stroke" />
                      <circle cx={a[0] + (b[0] - a[0]) * insertHover.fraction} cy={a[1] + (b[1] - a[1]) * insertHover.fraction}
                        r={6 / (svg.current?.getScreenCTM()?.a || 1)} vectorEffect="non-scaling-stroke" />
                    </g>;
                  })()}
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
                      {key === start && !pending && (tool !== "pipe" || routing) && (
                        <circle cx={p[0]} cy={p[1]} r={5} className="iso-anchor" pointerEvents="none" />
                      )}
                    </g>
                  ))}
                  {pending && (
                    <circle cx={drawing.project(pending.position)[0]} cy={drawing.project(pending.position)[1]} r={5}
                      className="iso-anchor" pointerEvents="none" />
                  )}
                  {cursor && nodeDrag.current && (
                    <circle
                      cx={routeDrawing.project(cursor)[0]}
                      cy={routeDrawing.project(cursor)[1]}
                      r={8}
                      className="iso-anchor"
                      opacity=".6"
                      pointerEvents="none"
                    />
                  )}
                  {cursor && tool === "pipe" && !insertHover && (
                    <g pointerEvents="none">
                      {routing && (
                        <line
                          x1={routeDrawing.project(anchor)[0]}
                          y1={routeDrawing.project(anchor)[1]}
                          x2={routeDrawing.project(cursor)[0]}
                          y2={routeDrawing.project(cursor)[1]}
                          className="iso-route-preview"
                        />
                      )}
                      <circle
                        cx={routeDrawing.project(cursor)[0]}
                        cy={routeDrawing.project(cursor)[1]}
                        r={4}
                        className="iso-anchor"
                      />
                      <text
                        x={routeDrawing.project(cursor)[0] + 12}
                        y={routeDrawing.project(cursor)[1] - 12}
                        className="iso-route-label"
                      >
                        {routing ? formatLength(Math.hypot(...sub(cursor, anchor)), doc.units) : "Start " + spool}
                      </text>
                    </g>
                  )}
                  {surface === "paper" && (
                    // The title block and notes open Drawing setup, where every field is edited.
                    <rect x={0} y={drawing.area[3]} width={W} height={850 - drawing.area[3]} fill="transparent"
                      className="iso-title-hotspot" aria-label="Edit title block" onClick={() => setTab("sheet")} />
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
                  <button aria-label="Zoom out" onClick={() => { const r = svg.current?.getBoundingClientRect(); if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2); }}>
                    <ZoomOut size={15} />
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button aria-label="Zoom in" onClick={() => { const r = svg.current?.getBoundingClientRect(); if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2); }}>
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
                  <SheetSettings
                    doc={doc}
                    commit={commit}
                    onError={setError}
                    spool={filter || spool}
                    selectedNodeId={selectedNode?.id}
                    onUnitsChange={(units, previous) => {
                      try {
                        setSpan(lengthInputValue(parseLength(span, previous), units));
                      } catch {
                        setSpan(units === "imperial" ? "10'" : "1000");
                      }
                    }}
                  />
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
                              {inches(s.nps)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {!selectedRun.connector && (() => {
                        const along = sub(getNode(doc, selectedRun.to).position, getNode(doc, selectedRun.from).position);
                        return (
                          <>
                            <Field label="Flow">
                              <select
                                aria-label="Flow direction"
                                value={selectedRun.flow ?? ""}
                                onChange={(e) => commit((d) => setLineFlow(d, selection, (e.target.value || undefined) as PipeRun["flow"]))}
                              >
                                <option value="">Not set</option>
                                <option value="forward">Flows {directionName(along)}</option>
                                <option value="reverse">Flows {directionName(along.map((v) => -v) as Vec3)}</option>
                              </select>
                            </Field>
                            <p className="iso-help">Set along the line through its fittings and the runs of its tees; each branch is set on its own.</p>
                          </>
                        );
                      })()}
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
                      {!selectedRun.connector && (
                        <>
                          <Field label="Bill of materials text">
                            <input
                              aria-label="Pipe BOM description"
                              key={selection + "-description"}
                              defaultValue={selectedRun.description ?? ""}
                              placeholder="As the specification"
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v !== (selectedRun.description ?? ""))
                                  commit((d) => {
                                    const run = d.runs.find((r) => r.id === selection)!;
                                    if (v) run.description = v.slice(0, 300);
                                    else delete run.description;
                                  });
                              }}
                              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                            />
                          </Field>
                          <label className="iso-check">
                            <input
                              type="checkbox"
                              checked={!!selectedRun.uncut}
                              onChange={(e) =>
                                commit((d) => {
                                  const run = d.runs.find((r) => r.id === selection)!;
                                  if (e.target.checked) run.uncut = true;
                                  else delete run.uncut;
                                })
                              }
                            />
                            List by length without a cut (runs on through a drawing break)
                          </label>
                        </>
                      )}
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
                          Choose a component in Insert to place it here, tees and olets included. Elbows are added
                          when the run changes direction. With the Pipe tool, click a pipe to branch from it.
                        </p>
                        {!selectedRun.connector && <button className="iso-primary" onClick={() => {
                          const leg = pipeLeg(doc, selection), target = leg && legPoint(doc, selection, leg.length * fraction / 100);
                          startBranch(target ?? { runId: selection, fraction: 0.5 });
                        }}>Branch from this pipe</button>}
                      </div>
                    </>
                  )}
                  {selectedNode && (
                    <>
                      {selectedTrack && <div className="iso-inspector-section">
                        <strong>Position along pipe</strong>
                        {/* The distance is given to what the sheet dimensions: flanged faces and reducer ends, else the centre. */}
                        <LengthInput label={selectedFaces ? "Near face from start of straight" : "Centre from start of straight"}
                          aria="Component distance from start"
                          mm={round(selectedFaces ? selectedFaces[0] : selectedTrack.distance, 3)} units={doc.units} onError={setError}
                          onCommit={value => value != null && commit(d => moveComponentAlongPipe(d, selection, value + (selectedFaces ? selectedTrack.distance - selectedFaces[0] : 0)))} />
                        {selectedFaces && <p className="iso-help">
                          The sheet dimensions this {selectedNode.kind === "reducer" ? "reducer to its ends" : "component to its mating flange faces, across the gaskets"}:
                          {" "}{formatLength(selectedFaces[1] - selectedFaces[0], doc.units)} face to face, centre {formatLength(selectedTrack.distance, doc.units)} from the start.
                        </p>}
                        <Field label="Centre position (%)">
                          <input aria-label="Component position percent" type="number" min="0.01" max="99.99" step="any"
                            key={selection + '-' + selectedTrack.distance}
                            defaultValue={round(selectedTrack.distance / selectedTrack.length * 100)}
                            onBlur={e => {
                              if (e.target.value !== e.target.defaultValue && !commit(d => moveComponentAlongPipe(d, selection, selectedTrack.length * Number(e.target.value) / 100)))
                                e.target.value = e.target.defaultValue;
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                        </Field>
                        <p className="iso-help">Drag the component along the pipe, or enter an exact position. Pipe ends stay fixed.</p>
                      </div>}
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
                              // An angle or relief valve takes the turn's place; an elbow put back is a turn again.
                              if (t.angle) {
                                placeAtTurn(d, n.id, t, n.branchEdgeId);
                                return;
                              }
                              if (COMPONENT_TYPES.find((x) => x.code === n.component)?.angle) delete n.branchEdgeId;
                              const edge = d.runs.find(r => r.id === selectedHeader?.id);
                              // A reducer or tee keeps its sizes when its type changes, concentric to eccentric say.
                              const smaller = n.kind === "reducer" ? Math.min(...connected(d, n.id).map((r) => r.nps))
                                : n.kind === "tee" ? d.runs.find((r) => r.id === n.branchEdgeId)?.nps : undefined;
                              const row = edge
                                ? getSpec(d, edge.specId).fittings.find(
                                    (f) => rowComponent(f)?.code === t.code && f.nps === edge.nps &&
                                      (smaller == null || (f.smallerNps ?? f.nps) === smaller),
                                  )
                                : undefined;
                              applyComponent(d, n, t.code, row);
                              if (!ECCENTRIC.test(t.code)) delete n.flat;
                            })
                          }
                        >
                          {!selectedNode.component && <option value="">{labels[selectedNode.kind]}</option>}
                          {COMPONENT_TYPES.filter((t) =>
                            selectedTurn
                              ? ["elbow90", "elbow45"].includes(t.kind) || !!t.angle
                              : selectedNode.kind === "end"
                                ? t.kind === "cap" || t.kind === "flange"
                                : (t.kind === selectedNode.kind && !t.angle) ||
                                  (["elbow90", "elbow45"].includes(selectedNode.kind) &&
                                    ["elbow90", "elbow45"].includes(t.kind)),
                          ).map((t) => (
                            <option value={t.code} key={t.code}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {selectedTurn && COMPONENT_TYPES.find((t) => t.code === selectedNode.component)?.angle && (
                        <Field label="Outlet">
                          <select
                            aria-label="Angle body outlet"
                            value={selectedNode.branchEdgeId ?? ""}
                            onChange={(e) => commit((d) => {
                              const n = getNode(d, selection);
                              placeAtTurn(d, n.id, COMPONENT_TYPES.find((t) => t.code === n.component)!, e.target.value);
                            })}
                          >
                            {selectedEdges.map((r) => (
                              <option key={r.id} value={r.id}>
                                {inches(r.nps)} pipe going {directionName(sub(getNode(doc, r.from === selectedNode.id ? r.to : r.from).position, selectedNode.position))}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      <Field label="Catalogue">
                        <select
                          value={selectedNode.catalogId ?? ""}
                          onChange={(e) =>
                            commit((d) => {
                              const node = getNode(d, selection);
                              const row = d.specs.flatMap(s => s.fittings).find(f => f.id === e.target.value);
                              if (row?.component) applyComponent(d, node, row.component, row);
                              else node.catalogId = e.target.value || undefined;
                              if (!ECCENTRIC.test(node.component ?? "")) delete node.flat;
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
                                {[f.smallerNps ? inches(f.nps) + " × " + inches(f.smallerNps) : "", f.rating, f.schedule, f.description]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <NodeCallouts doc={doc} nodeId={selectedNode.id} commit={commit} />
                      {missingTakeoutNodes.some(n => n.id === selectedNode.id) && <p className="iso-help iso-takeout-help">
                        This fitting has no known takeout. Enter the centre-to-pipe-end distance below to calculate the pipe cuts. Use the individual port takeouts in Fabrication details if they differ.
                      </p>}
                      {/BEND/.test(selectedNode.component ?? "") && (
                        <LengthInput
                          label="Bend radius"
                          aria="Bend radius"
                          mm={selectedNode.bendRadius}
                          units={doc.units}
                          allowEmpty
                          onError={setError}
                          onCommit={(value) =>
                            commit((d) => {
                              const n = getNode(d, selection);
                              if (value) n.bendRadius = value;
                              else delete n.bendRadius;
                            })
                          }
                        />
                      )}
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
                      {/* Only a connection with a free end can be routed from; an in-line valve has none. */}
                      {canRouteFrom(doc, selectedNode.id) && <button
                        className="iso-primary"
                        onClick={() => {
                          selectConnection(selection);
                          setPending(null);
                          setTool("pipe");
                          setView("iso");
                        }}
                      >
                        {selectedNode.kind === "olet" || (selectedNode.kind === "tee" && selectedEdges.length === 2)
                          ? "Route the branch from here"
                          : selectedEdges.length > 1 ? "Branch here" : "Continue from here"}
                      </button>}
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
              <div className={cn("iso-validation", issues.length ? "warning" : doc.runs.length ? "valid" : "empty")}>
                <strong>
                  {issues.length ? issues.length + " fabrication checks" : doc.runs.length ? "Ready for fabrication review" : "Nothing to check yet · draw a pipe"}
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
            {!!pendingCuts.length && <div className="iso-dimension-review" role="status">
              <strong>Pipe cut lengths are pending</strong>
              <p>Pipe quantities use cut lengths after fitting takeouts and root gaps. Overall centreline lengths are shown in the cut schedule below.</p>
              {missingTakeoutNodes.length ? <>
                <p>Enter a measured takeout for these fittings:</p>
                {missingTakeoutNodes.map(node => <button key={node.id} onClick={() => {
                  setSelection(node.id); setTab("draw"); setTool("select");
                  requestAnimationFrame(() => {
                    const input = document.querySelector<HTMLInputElement>('[aria-label="Measured takeout"]');
                    input?.focus(); input?.scrollIntoView({ block: "nearest" });
                  });
                }}>
                  {node.description || COMPONENT_TYPES.find(t => t.code === node.component)?.label || node.kind}
                  {node.tag ? " · " + node.tag : ""} · {connected(doc, node.id)[0]?.spool} · Enter takeout
                </button>)}
              </> : <p>One or more pipe cuts have no length remaining after fitting takeouts and root gaps. Review their measurements below.</p>}
            </div>}
            <h3>Bill of materials</h3>
            <p>Each sheet's bill of materials, numbered as tagged on that sheet. Pipe QTY is the order length in {lengthUnits(doc.units)}.</p>
            <table>
              <thead>
                <tr>
                  {["Spool", "Item", "QTY", "ND", "Description", doc.units === "imperial" ? "Weight lb" : "Weight kg"].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => (
                  <tr
                    key={m.spool + ":" + m.id}
                    onClick={() => {
                      // Joint parts (`<node>[:<pipe>]#part`) select their node.
                      setSelection(m.memberIds[0].split("#")[0].split(":")[0]);
                      setTab("draw");
                    }}
                  >
                    <td>{m.spool}</td>
                    <td>{m.id}</td>
                    <td>{m.qtyText}</td>
                    <td>{m.nd}</td>
                    <td>{m.description}</td>
                    <td>{m.weightKg == null ? UNKNOWN : round(m.weightKg / (doc.units === "imperial" ? 0.45359237 : 1))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Pipe cut schedule</h3>
            <p>
              Lengths in {lengthUnits(doc.units)}. Item is the pipe's number on its sheet; overall runs between the sheet's dimension
              points, and cut = overall − takeouts − root gaps. Ends: BE bevelled, PE plain, TE threaded.
            </p>
            <table>
              <thead>
                <tr>
                  {["Spool", "Item", "ND", "Overall", "Takeouts", "Root gaps", "Cut", "Ends"].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pieces.map((c) => (
                  <tr
                    key={c.run.id}
                    onClick={() => {
                      setSelection(c.run.id);
                      setTab("draw");
                    }}
                  >
                    <td>{c.spool}</td>
                    <td>{pieceText(c)}</td>
                    <td>{sizeText(c.run.nps)}</td>
                    <td>{overallText(c.overall, doc.units)}</td>
                    <td>{c.takeouts.map((v) => allowanceText(v, doc.units)).join(" + ")}</td>
                    <td>{c.gaps.map((v) => allowanceText(v, doc.units)).join(" + ")}</td>
                    <td>{cutText(c, doc.units)}</td>
                    <td>{c.ends.join(" / ")}</td>
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
                  {["Weld", "Spool", "Type", "Size", "Schedule", "Joint", "Shop / field"].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {joints.map((w, i) => (
                  <tr
                    key={w.weld.tag + i}
                    onClick={() => {
                      setSelection(w.weld.runId);
                      setTab("draw");
                    }}
                  >
                    <td>{w.weld.tag}</td>
                    <td>{w.spool}</td>
                    <td>{w.type}</td>
                    <td>{w.size}</td>
                    <td>{w.schedule}</td>
                    <td>{w.joint}</td>
                    <td>{w.weld.field ? "Field" : "Shop"}</td>
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
              ? insertHover
                ? "Click to branch from this pipe with a tee"
                : pending?.runId
                  ? "Click where the branch goes · Esc cancels it"
                  : routing
                    ? "Click to add pipe from the highlighted connection · Esc finishes this run"
                    : "Click an open end to continue from it, a pipe to branch from it, or open sheet to start a run on " + spool
              : surface === "paper"
                ? "Click the title block to edit · Drag empty space to pan · Scroll to zoom"
                : "Infinite model space · Drag empty space to pan · Scroll to zoom"}
        </span>
        <span className={issues.length ? "warning" : doc.runs.length ? "valid" : undefined}>
          {issues.length ? issues.length + " checks" : doc.runs.length ? "Dimensions checked" : "No pipe drawn"}
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
