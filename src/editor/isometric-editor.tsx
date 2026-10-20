import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleStop,
  Copy,
  Download,
  FileText,
  Grid3X3,
  Hand,
  Keyboard,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  MousePointer2,
  Move,
  MoveUpRight,
  Plus,
  Redo2,
  Ruler,
  Save,
  Scan,
  Settings2,
  Trash2,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
  GitBranch,
  X,
  Scissors,
} from "lucide-react";
import { cn } from "./cn";
import { EditContextMenu, type EditMenuItem } from "./edit-context-menu";
import { InspectorResize } from "./inspector-section";
import { Inspector, type InspectorIssue } from "./inspector/inspector";
import { LengthInput, Row as KitRow, Section as InspectorSectionKit, Segmented, Toggle, createRevealHub, revealProperty } from "./inspector/kit";
import { PipePanel } from "./inspector/pipe-panel";
import { NodePanel } from "./inspector/node-panel";
import { RoutingSections } from "./inspector/routing-panel";
import { LabelPanel, SAVE_AUTO_MOVED_HINT, labelKind, labelOwnerName, labelText, saveAutoMovedText } from "./inspector/label-panel";
import { MultiPanel } from "./inspector/multi-panel";
import { NotePanel } from "./inspector/note-panel";
import { materialGridMask } from "./editing-grid";
import { DEFAULT_PAPER_CELL_IN, nearestPaperPoint } from "../core/iso/lattice";
import { SheetLayer } from "./sheet-layer";
import { bendHandle, labelIndex, pickLabel, type LabelDrag, type LabelSelection } from "./label-editing";
import { SheetSettings } from "./sheet-settings";
import {
  appendRun,
  clone,
  connected,
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
  resizeRun,
  resizeRunToCut,
  sub,
  takeout,
  validateIso,
  welds,
  type IsoDocument,
  type CatalogItem,
  type PipeNode,
  type EndPrep,
  type Vec3,
} from "../core/model";
import { createDrawing, drawingSheets, type Drawing, type Point, type SheetFit, type SheetKind } from "../core/drawing";
import { defaultBlockSpacing, defaultGrid, gridAnchor, pickGridPoint, pickOrthoPoint } from "../core/grid";
import { standardScales } from "../core/iso/sheet-frame";
import { exportPcfPackage } from "../core/pcf";
import { coordinateText, sizeFor, sizeHeader } from "../core/format";
import { unitsPerMm } from "../core/paper";
import { cutSchedule, labourCsv, materialCsv, materialSchedule, weldSchedule } from "../core/schedules";
import { download } from "./download";
import { exportDwgSheets } from "./dwg";
import { drawingFileName, isometricDxf, readIsometricFile, readIsometricFiles } from "../core/document";
import { zip } from "../core/zip";
import { ExportSettings, dxfOptions, readExportPreferences } from "./export-settings";
import { usePipingSave, type FileSaveResult, type SaveStatus, type SaveTarget } from "./use-piping-save";
import { COMPONENT_TYPES, type ComponentType } from "../core/components";
import { SpecManager } from "./spec-manager";
import { defaultNps, loadLibrarySpec, loadSavedSpec, loadSpecIndex, newIsoWithDefaultSpec, routingSizes, type LibrarySpecSummary } from "./library";
import { SpoolyardMark } from "./mark";
import { ComponentLibrary, ComponentPalette, sizeLabel } from "./component-palette";
import { ComponentGlyph } from "./component-glyph";
import { pipeAtPoint, pipesAtPoint, type PipeHit } from "./pipe-hit";
import { bodyHulls, cycleIndex, insideHull, pickCandidates, pipeInkAt } from "./pick";
import {
  canRouteFrom,
  componentFaces,
  componentTrack,
  continueFlow,
  isSquareTurn,
  placeAtTurn,
  endCapable,
  placeAtOpenEnd,
  terminalCapable,
  legPoint,
  moveComponentAlongPipe,
  pipeLeg,
  placeComponentOnPipe,
  placementStep,
  reduceAtJoint,
  routeError,
  sized,
  setRunSpec,
  sizeChoices,
  snapAlongLeg,
  snapNearFace,
  type ComponentTrack,
} from "../core/component-position";
import { nodeItem } from "../core/joints";
import { reviewIso } from "../core/review";
import { createStore, useStore, type Store } from "./store";
import { paperUnits as paperUnitsOf } from "./paper";
import { EditHistory, remember, serialise } from "./history";
import { HOME, ZOOM_STEP, fitClearOf, fitView, inkExtents, panScreen, screenScale, toScreen, toSheet, zoomAbout, type Box, type Frame, type View } from "./viewport";
import { CanvasSvg, EMPTY_TRANSIENT, APERTURE_PX, GridLayer, Grips, InlineLength, LabelLayer, PointerLayer, lengthText, moveText, offsetText, type Transient, type ViewState } from "./canvas-layers";
import { OBJECT_SNAPS, gridSettings, initialDrafting, storeDrafting, type Drafting, type ObjectSnap } from "./drafting";
import { DIRECTIONS, dominantAxis, inputDelta, parseCommand, parsePointInput, type CommandId } from "./command-line";
import { CommandBar, type CommandOption } from "./command-bar";
import { resolveSnap, snapPoints, type Snap } from "./snaps";
import { clickSelect, existing, normaliseBox, pickInBox, boxMode, sameSelection, selectables } from "./selection";
import { CLIPBOARD_MIME, clipboardExtent, copySelection, eraseSelection, extendRun, fitOletToBranch, moveSelection, nextSpool, oletBranchSize, pastePieces, readClipboard, splitSheet, stretchLeg, type Clipboard } from "./edit-ops";
import { EditorDialog, ask, type DialogRequest } from "./dialogs";
import { KEYS, ShortcutHelp, isMac } from "./shortcuts";
import { MenuButton } from "./menu-button";
import { END_PREPS, KIND_LABELS, SCALES, SpecSelect, SpoolInput, VIEWS } from "./choices";
import { MaterialsView, WeldsView } from "./schedules-view";
import { RibbonField } from "./ribbon-field";
import { DraftingSettings } from "./drafting-settings";
import { ProfileSettings } from "./profile-settings";
import { overrideCount } from "./overrides-settings";
import "./isometric-editor.css";

/**
 * The last few drawings made, with the document each is of. A committed document is never changed again, so stepping
 * back to one (undo, redo) shows its drawing again at once rather than drafting it anew.
 */
const recentDrawings: Array<{ doc: IsoDocument; key: string; drawing: Drawing }> = [];
const RECENT_DRAWINGS = 6;
function drawn(doc: IsoDocument, spool: string, view: Drawing["view"], hold?: SheetFit, model = false, sheet: SheetKind = "drawing"): Drawing {
  const key = JSON.stringify([spool, view, hold ?? null, model, sheet]);
  const at = recentDrawings.findIndex((r) => r.doc === doc && r.key === key);
  if (at >= 0) {
    const [hit] = recentDrawings.splice(at, 1);
    recentDrawings.push(hit);
    return hit.drawing;
  }
  const drawing = createDrawing(doc, spool, view, hold, model ? { model: true } : sheet !== "drawing" ? { sheet } : undefined);
  recentDrawings.push({ doc, key, drawing });
  if (recentDrawings.length > RECENT_DRAWINGS) recentDrawings.shift();
  return drawing;
}

export type { SaveStatus } from "./use-piping-save";
export interface EditorController {
  /** Keeps a copy now: the recovery copy, the browser library or the host. */
  flush: () => Promise<void>;
  /** Save, as Ctrl/⌘+S: the file when there is one. */
  save: () => Promise<void>;
  /** Save As: asks where (or downloads). */
  saveAs: () => Promise<FileSaveResult>;
  /** Whether the drawing has changes its file does not. */
  fileDirty: () => boolean;
  /** A host confirmed this content after its save had timed out: keep it as saved and clear the error. */
  acknowledge: (content: string) => void;
}
export type IsometricEditorProps = {
  /** Fetched with credentials; ignored when `source` is given. */
  fileUrl?: string | null;
  /** File contents to open. Empty text (or neither source nor fileUrl) starts a new drawing on spec A. */
  source?: string;
  fileName: string;
  /** Keeps the drawing after a pause in editing: a recovery copy beside a file, else the drawing's only copy. */
  onSave: (content: string) => Promise<void>;
  /** Writes the drawing's file (Save, Save As). */
  onSaveFile?: (content: string, saveAs: boolean) => Promise<FileSaveResult>;
  /** Where Save writes. Defaults to the host when embedded, else this browser. */
  saveTarget?: SaveTarget;
  /** Opened from a recovery copy with changes its file does not have. */
  unsavedOnOpen?: boolean;
  headerActions?: ReactNode;
  /** "embedded" leaves the single header to the host application. */
  chrome?: "full" | "embedded";
  onStatus?: (status: SaveStatus, error: string) => void;
  controller?: MutableRefObject<EditorController | null>;
};

type Tool = "select" | "pan" | "pipe" | "insert" | "measure" | "move" | "copy" | "zoom-window" | "split";
/** Paper shown around the sheet at zoom 1, as a fraction of its height. */
const PAPER_PAD = 0.06;
/** The ribbon's routing length, and the gap a typed run with no start leaves beside the work, in grid blocks. */
const DEFAULT_ROUTE_BLOCKS = 10;
/** Pointer travel (screen px) before a press becomes a drag. */
const DRAG_PX = 4;
/** Pointer travel before a left press in a drawing command pans instead of clicking. */
const PAN_PX = 6;
const DOUBLE_CLICK_MS = 400;
/** Arrow-key nudges of a picked label, in printed millimetres (Shift for the larger). */
const NUDGE_MM = 0.5, NUDGE_LARGE_MM = 2.5;
/** Views kept for Zoom previous. */
const VIEW_HISTORY = 20;
const ICONS: Record<string, typeof ArrowUp> = { East: ArrowUpRight, North: ArrowUpLeft, Up: ArrowUp, West: ArrowDownLeft, South: ArrowDownRight, Down: ArrowDown };
const RIBBON_DIRECTIONS = ["East", "North", "Up", "West", "South", "Down"].map((name) => DIRECTIONS.find((d) => d.name === name)!);
const EXPORTS: Array<{ format: string; label: string; checked?: boolean }> = [
  { format: "PDF", label: "PDF drawing package", checked: true },
  { format: "DWG", label: "DWG sheets", checked: true },
  { format: "DXF", label: "DXF sheets", checked: true },
  { format: "PCF", label: "PCF" },
  { format: "SVG", label: "SVG sheets" },
  { format: "JSON", label: "Piping JSON" },
  { format: "bom", label: "Material CSV", checked: true },
  { format: "cut", label: "Cut list CSV", checked: true },
  { format: "weld", label: "Weld CSV", checked: true },
  { format: "labour", label: "Labour CSV", checked: true },
];
const TABS: Array<[string, string]> = [
  ["draw", "Draw"], ["materials", "Materials & cuts"], ["welds", "Weld map"], ["specs", "Specifications"],
  ["catalogue", "Component library"], ["sheet", "Drawing setup"], ["3d", "3D review"],
];

/** The last open pipe end: where typed routing carries on after opening, undo or delete. */
const lastOpenEnd = (d: IsoDocument) => [...d.nodes].reverse().find((n) => n.kind === "end" && connected(d, n.id).length === 1)?.id ?? "";
const componentName = (node: PipeNode) => COMPONENT_TYPES.find((t) => t.code === node.component)?.label ?? KIND_LABELS[node.kind] ?? "connection";
/** Why a pipe cannot start from a connection that has no free end. */
const noFreeEnd = (d: IsoDocument, nodeId: string) =>
  `The ${componentName(getNode(d, nodeId)).toLowerCase()} has no free end to route from. Select an open end, or click a pipe with the Pipe tool to branch from it.`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** A fabrication check as listed; checks that are not text are described, not dumped. */
const issueText = (issue: unknown): string =>
  typeof issue === "string" ? issue
    : issue && typeof issue === "object" && "message" in issue ? String((issue as { message: unknown }).message)
      : "A fabrication check failed.";
/** Typing in a field: keys belong to it. */
const typing = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.("input,select,textarea,[contenteditable]");
/** Clear space (px) kept between fitted ink and the floating view toolbars. */
const OVERLAY_GAP_PX = 6;
/** Fraction of the screen left around the whole sheet when it is fitted clear of the toolbars. */
const SHEET_MARGIN = 0.02;
/** Screen distance (px) from a pipe's centreline within which a click on nothing else picks the pipe. */
const PIPE_PICK_PX = 7;
/** A connection drawn with no body of its own (a pipe end, a plain turn) is on its point within this many pixels. */
const NODE_CORE_PX = 3;
/** Screen distance (px) around a component's outline still counted as its body. */
const BODY_PAD_PX = 1.5;
/** How the command line names selection cycling (and recognises its own message). */
const CYCLE_NOTICE = "Selection cycling";
/** Screen distance (px) from a pipe's drawn line that is on the line. */
const PIPE_INK_PX = 2;
/** A field holding what it was filled with: nothing typed in it to undo. */
const untouched = (el: EventTarget | null) =>
  el instanceof HTMLSelectElement ||
  (el instanceof HTMLInputElement && (["checkbox", "radio", "range", "color"].includes(el.type) || el.value === el.defaultValue)) ||
  (el instanceof HTMLTextAreaElement && el.value === el.defaultValue);
/** A focused control Space or Enter activates. */
const activates = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.("button,a,summary,[role=button],[role=menuitem],[role=tab],[role=switch],[role=radio],[role=checkbox]");

function ToolButton({ name, icon: Icon, active, onClick, disabled, shortcut }: {
  name: string; icon: typeof Ruler; active?: boolean; onClick: () => void; disabled?: boolean; shortcut?: string;
}) {
  return (
    <button type="button" className={cn("iso-tool", active && "active")} aria-label={name} aria-pressed={active} title={shortcut ? `${name} (${shortcut})` : name}
      onClick={onClick} disabled={disabled}>
      <Icon size={18} />
      <span>{name}</span>
    </button>
  );
}

type Gesture =
  | { kind: "pan"; pointerId: number; x: number; y: number; view: View; moved: boolean; button: number; target: Element }
  | { kind: "press"; pointerId: number; x: number; y: number; from: Point; additive: boolean; target: Element }
  | { kind: "box"; pointerId: number; from: Point; additive: boolean; zoom: boolean }
  | { kind: "click"; pointerId: number; x: number; y: number }
  | { kind: "node"; pointerId: number; x: number; y: number; id: string; point: Point; anchor: Vec3; destination: Vec3; moved: boolean; track: ComponentTrack | null; additive: boolean; leg?: string }
  | { kind: "label"; pointerId: number | null; drag: LabelDrag }
  | { kind: "vertex"; pointerId: number; path: string; points: Point[]; index: number; insert: boolean; at: Point; moved: boolean }
  | { kind: "note"; pointerId: number; x: number; y: number; id: string; point: Point; offset: Point; moved: boolean; additive: boolean };

export function IsometricEditor({
  fileUrl,
  source,
  fileName,
  onSave,
  onSaveFile,
  saveTarget,
  unsavedOnOpen,
  headerActions,
  chrome = "full",
  onStatus,
  controller,
}: IsometricEditorProps) {
  const [doc, setDoc] = useState<IsoDocument>(() => newIso()),
    [ready, setReady] = useState(false),
    [isNew, setIsNew] = useState(false),
    [alert, setAlert] = useState<{ text: string; persistent?: boolean } | null>(null);
  const error = alert?.text ?? "";
  /**
   * A command's problem (a pipe that cannot go that way, a click on nothing): shown until Esc, another tool or the
   * next successful edit. `documentError` is for problems with the drawing itself, which stay until dismissed.
   */
  const setError = useCallback((text: string) => setAlert(text ? { text } : null), []);
  const documentError = (text: string) => setAlert({ text, persistent: true });
  const clearCommandError = () => setAlert((a) => (a?.persistent ? a : null));
  const [tab, setTab] = useState("draw"),
    [surface, setSurface] = useState<"paper" | "grid">("paper"),
    [tool, setTool] = useState<Tool>("select");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState<number>();
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [selection, setSelectionState] = useState<string[]>([]),
    [start, setStart] = useState(""),
    [spec, setSpec] = useState(""),
    [nps, setNps] = useState(0);
  const [routingPrep, setRoutingPrep] = useState<EndPrep>("BW");
  const [span, setSpan] = useState(""),
    [spool, setSpool] = useState("SP-001"),
    [line, setLine] = useState(""),
    [view, setView] = useState<Drawing["view"]>("iso");
  const [filter, setFilter] = useState(""),
    [fraction, setFraction] = useState(50);
  const [library, setLibrary] = useState<LibrarySpecSummary[] | null>(null),
    [libraryError, setLibraryError] = useState(""),
    [specBusy, setSpecBusy] = useState(""),
    [armed, setArmed] = useState<{ type: ComponentType; row?: CatalogItem } | null>(null);
  // A Pipe-tool start not in the drawing yet: a new run's first point, or the point on a pipe a branch will leave.
  const [pending, setPending] = useState<{ position: Vec3; runId?: string; fraction?: number } | null>(null);
  const [editMenu, setEditMenu] = useState<{ x: number; y: number; title: string; items: EditMenuItem[] } | null>(null);
  const closeEditMenu = useCallback(() => setEditMenu(null), []);
  const [lengthEdit, setLengthEdit] = useState<{ runId: string; role: "overall" | "cut" } | null>(null);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 }),
    [busy, setBusy] = useState("");
  const [drafting, setDraftingState] = useState<Drafting>(() => initialDrafting(newIso()));
  const [measure, setMeasure] = useState<{ from: Vec3; to?: Vec3 } | null>(null);
  // Move and Copy act on what was selected when they started: a copy selects what it made, but copying again
  // copies the originals from the same base point, as AutoCAD's multiple copy does.
  // Paste places what is on the clipboard as Copy does, from its base point (the clip's first connection).
  const [transform, setTransform] = useState<{ mode: "move" | "copy" | "paste"; base: Vec3 | null; ids: string[]; clip?: Clipboard; pasted?: number } | null>(null);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone?: "error" } | null>(null);
  // A paper label picked on its own with the Select tool: a callout, one of its lines, a tag, a dimension's text.
  const [selectedLabel, setSelectedLabel] = useState<LabelSelection | null>(null);
  const [spacePan, setSpacePan] = useState(false);
  const [viewStore] = useState(() => createStore<ViewState>({ view: HOME, screen: { width: 1100, height: 850 } }));
  const [transient] = useState(() => createStore<Transient>(EMPTY_TRANSIENT));
  const [reveal] = useState(createRevealHub);
  const [history] = useState(() => new EditHistory<IsoDocument, string[]>());
  const svg = useRef<SVGSVGElement>(null),
    stage = useRef<HTMLDivElement>(null),
    inspector = useRef<HTMLElement>(null),
    importInput = useRef<HTMLInputElement>(null),
    three = useRef<HTMLDivElement>(null),
    specInput = useRef<HTMLInputElement>(null),
    commandInput = useRef<HTMLInputElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastMiddle = useRef(0);
  const viewHistory = useRef<View[]>([]);
  const lastCommand = useRef<CommandId | null>(null);
  const clipboard = useRef<{ clip: Clipboard; pastes: number } | null>(null);
  const spaceUsed = useRef(false);
  const latest = useRef(doc);
  latest.current = doc;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const setSelection = useCallback((next: string[] | string) => {
    const ids = typeof next === "string" ? (next ? [next] : []) : next;
    selectionRef.current = ids;
    setSelectionState((current) => (sameSelection(current, ids) ? current : ids));
  }, []);
  const primary = selection.length === 1 ? selection[0] : "";
  useLayoutEffect(() => { if (inspector.current) inspector.current.scrollTop = 0; }, [primary, tab]);
  const activeSpec = doc.specs.find((s) => s.id === spec) ?? doc.specs[0];
  // A specification without a size table (read from a PCF) is routed at the sizes its pipes are drawn at.
  const activeSizes = useMemo(() => routingSizes(doc, activeSpec), [doc, activeSpec]);
  const grid = useMemo(() => gridSettings(drafting), [drafting]);
  const setDrafting = (patch: Partial<Drafting>) =>
    setDraftingState((d) => {
      const next = { ...d, ...patch };
      storeDrafting(next);
      return next;
    });
  /**
   * The grid block is the drawing's routing scale (one cell of the not-to-scale paper, one block of the to-scale or
   * model grid): it is kept with the drawing, so it reopens as drafted.
   */
  const setBlock = (spacing: number) => {
    setDrafting({ spacing });
    commit((d) => { d.grid = { ...(d.grid ?? defaultGrid()), spacing }; });
  };
  // Routing from a connection keeps its end preparation (an olet's socket, say) rather than the size's default.
  const connectionPrep = useRef<{ prep: EndPrep; spec: string; nps: number; fixed?: boolean } | null>(null);
  /** The end preparation routing starts with; `fixed` keeps it at any size (an olet's socket or thread). */
  const routeWith = (prep: EndPrep, specId: string, size: number, fixed = false) => {
    connectionPrep.current = { prep, spec: specId, nps: size, fixed };
    setRoutingPrep(prep);
  };
  useEffect(() => {
    if (!ready || !activeSpec) return;
    if (activeSpec.id !== spec) setSpec(activeSpec.id);
    if (!activeSizes.sizes.includes(nps)) setNps(activeSizes.listed ? defaultNps(activeSpec) : activeSizes.sizes.includes(2) ? 2 : activeSizes.sizes[0] ?? 2);
    const kept = connectionPrep.current;
    setRoutingPrep(kept && kept.spec === spec && (kept.nps === nps || kept.fixed) ? kept.prep : defaultEndPrep(activeSpec, nps));
  }, [spec, activeSpec, activeSizes, nps, ready]);

  const target: SaveTarget = saveTarget ?? (chrome === "embedded" ? "host" : onSaveFile ? "disk" : "browser");
  const persistence = usePipingSave(doc, ready, { autosave: onSave, saveFile: onSaveFile, target, isNew, unsavedOnOpen });
  if (controller) controller.current = { flush: persistence.flush, save: persistence.save, saveAs: persistence.saveAs, fileDirty: persistence.fileDirty, acknowledge: persistence.acknowledge };
  useEffect(() => { onStatus?.(persistence.status, persistence.error); }, [onStatus, persistence.status, persistence.error]);

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
        const file = fresh ? null : readIsometricFile(text);
        const loaded = file?.doc ?? (await newIsoWithDefaultSpec());
        if (abort.signal.aborted) return;
        if (file?.warnings.length) showWarnings(fileName, file.warnings, "opened");
        if (fresh) loaded.title = fileName.replace(/\.[^.]+$/, "") || loaded.title;
        open(loaded);
        setIsNew(fresh);
        setReady(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") documentError(e.message);
      });
    return () => abort.abort();
  }, [fileUrl, source]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Starts editing a document: its specification, sizes and drafting aids, a fresh history and the whole sheet. */
  const open = (loaded: IsoDocument) => {
    const aids = initialDrafting(loaded);
    latest.current = loaded;
    setDoc(loaded);
    history.clear();
    setCounts({ undo: 0, redo: 0 });
    setDraftingState(aids);
    // Routing carries on in the specification and size of the last pipe drawn.
    setSpec(loaded.runs.at(-1)?.specId ?? loaded.specs[0]?.id ?? "");
    setNps(loaded.runs.at(-1)?.nps ?? (loaded.specs[0] ? defaultNps(loaded.specs[0]) : 2));
    setStart(lastOpenEnd(loaded));
    setSelection([]);
    setSelectedLabel(null);
    setPending(null);
    setSpan(lengthInputValue(DEFAULT_ROUTE_BLOCKS * defaultBlockSpacing(loaded.units), loaded.units));
    setSpool(loaded.runs[0]?.spool ?? "SP-001");
    showHome();
    viewHistory.current = [];
  };

  /**
   * Applies an edit as one undo step. An edit that changes nothing adds no step; edits under the same `key` close
   * together (a label nudged with the arrows, a colour picked) are one step.
   */
  const commit = (edit: (d: IsoDocument) => void, options?: { key?: string }) => {
    if (!ready) {
      setError("Wait for the drawing to finish opening.");
      return false;
    }
    try {
      // What was selected before the edit: edits may select what they make.
      // A committed document is never changed again, so its copy is read back from the JSON already made for it.
      const before = latest.current, was = serialise(before), next = JSON.parse(was) as IsoDocument, selected = selectionRef.current;
      edit(next);
      const text = JSON.stringify(next);
      if (text === was) return true;
      parseIsoJson(text);
      remember(next, text);
      history.record(before, selected, options?.key);
      latest.current = next;
      setDoc(next);
      setCounts({ undo: history.undoCount, redo: history.redoCount });
      clearCommandError();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  };
  /** Ends whatever the pointer is doing (a drag, a label move, a window) without applying it. */
  const cancelGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g && "pointerId" in g && g.pointerId != null && svg.current?.hasPointerCapture(g.pointerId)) svg.current.releasePointerCapture(g.pointerId);
    transient.patch({ drag: null, labelPreview: null, box: null, vertex: null, shift: null });
    return !!g;
  };
  const stepHistory = (forward = false) => {
    cancelGesture();
    const entry = history.step(forward, latest.current, selectionRef.current);
    if (!entry) return;
    latest.current = entry.doc;
    setDoc(entry.doc);
    setCounts({ undo: history.undoCount, redo: history.redoCount });
    // The selection comes back with the drawing; routing carries on from it, as after undoing a segment.
    const kept = existing(entry.doc, entry.selection);
    setSelection(kept);
    const routeFrom = kept.length === 1 && entry.doc.nodes.some((n) => n.id === kept[0]) ? kept[0] : "";
    setStart(routeFrom && canRouteFrom(entry.doc, routeFrom) ? routeFrom : lastOpenEnd(entry.doc));
    setPending(null);
  };
  const erase = (ids = selectionRef.current) => {
    if (!ids.length) return;
    let problems: string[] = [];
    if (commit((d) => { problems = eraseSelection(d, ids); })) {
      setSelection([]);
      setStart(lastOpenEnd(latest.current));
      setPending(null);
      if (problems.length) setError(problems[0]);
    }
  };
  /** Starts a command (or tool): what was armed or half-done in another is put down. */
  const activateTool = (next: Tool) => {
    clearCommandError();
    setArmed(null);
    transient.patch({ insertHover: null, cursor: null, snap: null, box: null });
    setPending(null);
    setMeasure(null);
    setTransform(null);
    if ((next === "move" || next === "copy") && !selectionRef.current.length) {
      setNotice({ text: `Select the pipes or components to ${next}, then choose ${next === "move" ? "Move" : "Copy"}.` });
      setTool("select");
      return;
    }
    if (next === "move" || next === "copy") setTransform({ mode: next, base: null, ids: [...selectionRef.current] });
    setTool(next);
    if (next !== "select" && next !== "pan") lastCommand.current = next as CommandId;
  };
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
    // The drawing surface measures itself; the view and every screen-sized marker follow from it.
    const element = svg.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const was = viewStore.get().screen;
      viewStore.patch({ screen: { width, height } });
      // A fitted view (whole sheet, extents) is fitted again to the new size, clear of the toolbars; a view the user
      // zoomed or panned keeps its centre and zoom.
      if (was.width !== width || was.height !== height) refit.current();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tab, ready, viewStore]);
  const loadLibrary = useCallback(() => {
    setLibraryError("");
    loadSpecIndex().then(setLibrary).catch((e) => {
      setLibrary([]);
      setLibraryError(`The standard specification library could not load (${message(e)}).`);
    });
  }, []);
  useEffect(loadLibrary, [loadLibrary]);
  useEffect(() => {
    if (ready && doc.specs[0] && !doc.specs.some((s) => s.id === spec)) {
      setSpec(doc.specs[0].id);
      setNps(defaultNps(doc.specs[0]));
    }
  }, [doc, spec, ready]);

  const startNode = doc.nodes.find((n) => n.id === start);
  // A Pipe-tool click routes on only from a start the user chose: the connection they picked, the end they just
  // routed to, or a pending start. The last open end left over from opening, undo or delete is not one.
  const routing = !!pending || (!!startNode && primary === start);
  const spools = useMemo(() => [...new Set([...doc.runs.map((r) => r.spool), spool])].sort(), [doc.runs, spool]);
  /** A new sheet: the next spool, shown on its own blank sheet; the next pipe drawn starts it. */
  const newSpool = () => {
    const next = nextSpool(spools);
    setSpool(next);
    setStart("");
    setSelection([]);
    setPending(null);
    if (doc.runs.length) setFilter(next);
    activateTool("pipe");
    setNotice({ text: `New sheet ${next} · click the paper to start its first pipe, or pick an open end to continue onto it` });
  };
  /** Breaks the line onto a new sheet at a connection or a point on a pipe (see `splitSheet`). */
  const breakSheet = (at: Parameters<typeof splitSheet>[1]) => {
    const was = "runId" in at ? doc.runs.find((r) => r.id === at.runId)?.spool : connected(doc, at.nodeId)[0]?.spool;
    let made: { spool: string; nodeId: string } | undefined;
    if (commit((d) => { made = splitSheet(d, at); }) && made) {
      setSelection([made.nodeId]);
      setSpool(made.spool);
      // Each spool is a sheet of its own now: the paper shows the sheet that was being drawn, with its break lettered.
      if (!filter && was) setFilter(was);
      activateTool("select");
      setNotice({ text: `The line continues on ${made.spool}, a sheet of its own · both sheets say CONT'D ON the other's drawing number` });
    }
  };
  const anchor = pending?.position ?? startNode?.position ?? gridAnchor(doc);
  // While a run is being drawn on paper, hold the sheet's fit so the next click point stays put;
  // it re-fits once the run is finished, or if the new pipe would leave the drawing area.
  const heldFit = useRef<SheetFit | null>(null);
  const holding = surface === "paper" && tool === "pipe" && routing;
  // A spool whose material list has a sheet of its own is issued on more than one sheet; the paper shows one at a time.
  const [sheetKind, setSheetKind] = useState<SheetKind>("drawing");
  const sheetKinds = useMemo<SheetKind[]>(() => (surface === "paper" ? drawingSheets(doc, filter) : ["drawing"]), [doc, filter, surface]);
  const shownSheet: SheetKind = sheetKinds.includes(sheetKind) ? sheetKind : "drawing";
  const drawing = useMemo(() => {
    if (surface === "grid") return drawn(doc, filter, "iso", undefined, true);
    if (shownSheet !== "drawing") return drawn(doc, filter, view, undefined, false, shownSheet);
    if (!holding) {
      heldFit.current = null;
      return drawn(doc, filter, view);
    }
    const held = heldFit.current;
    const outside = (d: Drawing) => {
      const [x0, y0, x1, y1] = d.area;
      return [...d.positions.values()].some(([x, y]) => x < x0 || x > x1 || y < y0 || y > y1);
    };
    let d = drawn(doc, filter, view, held ?? undefined);
    if (held && outside(d)) {
      // Re-centre, and only ever zoom out mid-run: zooming in would move every point under the cursor.
      const fresh = drawn(doc, filter, view);
      d = fresh.fit.scale > held.scale ? drawn(doc, filter, view, { ...held, centre: fresh.fit.centre }) : fresh;
      if (outside(d)) d = fresh;
    }
    heldFit.current = d.fit;
    return d;
  }, [doc, filter, surface, view, holding, shownSheet]);
  // Each component's body on the sheet, for picking it apart from the pipes beside it.
  const bodies = useMemo(() => bodyHulls(drawing.primitives, new Set(doc.nodes.map((n) => n.id))), [drawing, doc.nodes]);
  const frame = useMemo<Frame>(() => (surface === "paper"
    ? { width: drawing.width, height: drawing.height, fill: false, pad: PAPER_PAD }
    : { width: drawing.width, height: drawing.height, fill: true }), [surface, drawing.width, drawing.height]);
  // Paper labels are picked and moved on the iso paper sheet, where their positions are held.
  const labelsEditable = surface === "paper" && view === "iso";
  const paperLabels = useMemo(() => labelIndex(drawing), [drawing]);
  /** The picked label as now drawn; for the properties panel. Undefined once it is no longer on the sheet. */
  const selectedLabelInfo = labelsEditable && selectedLabel ? paperLabels.get(selectedLabel.key) : undefined;
  /** A picked label is shown in the properties panel while no pipe or component is selected. */
  const pickedLabel = !selection.length ? selectedLabelInfo : undefined;
  const labelHighlight = useMemo(() => (selectedLabelInfo && !selectedLabelInfo.parent ? new Set(selectedLabelInfo.ink) : undefined), [selectedLabelInfo]);
  useEffect(() => { if (selection.length) setSelectedLabel(null); }, [selection]);
  // What an edit removed (an erase from the properties, a spool renumbered, an import) leaves the selection.
  useEffect(() => {
    const kept = existing(doc, selectionRef.current);
    if (kept.length !== selectionRef.current.length) setSelection(kept);
  }, [doc, setSelection]);
  useEffect(() => { if (!labelsEditable) { setSelectedLabel(null); transient.patch({ hoverLabel: null }); } }, [labelsEditable, transient]);
  const multiSpool = useMemo(() => new Set(doc.runs.map((r) => r.spool)).size > 1, [doc.runs]);
  /** Puts a label back where it is placed automatically, with its leader bend; one undo step. */
  const resetLabel = (key: string, spool = selectedLabel?.spool ?? "", bend = true) =>
    commit((d) => {
      const held = d.sheets?.[spool]?.labelPositions;
      if (!held) return;
      delete held[key];
      if (bend) delete held[`leader:${key}`];
      // Lines moved out of a callout go back into it with the callout.
      for (const k of Object.keys(held)) if (k.startsWith(key + "#")) delete held[k];
    });
  const resetLeader = (key: string, spool: string) => commit((d) => { const held = d.sheets?.[spool]?.labelPositions; if (held) delete held[`leader:${key}`]; });
  const resetDimension = (key: string, spool: string) =>
    commit((d) => { const info = d.sheets?.[spool]; if (info?.dimensionLayout) delete info.dimensionLayout[key]; if (info?.labelPositions) delete info.labelPositions[key]; });
  /** Every label on a sheet back to automatic placement; one undo step. */
  const resetSheetLabels = (spool: string) => commit((d) => { const info = d.sheets?.[spool]; if (info?.labelPositions) delete info.labelPositions; });
  /**
   * Keeps the layout as drawn: moved labels drawn clear of an overprint are held where they are now drawn, so nothing
   * jumps; one undo step. Labels that could not be cleared stay where they are (reset them to place them anew).
   */
  const keepClearedSpots = (spool: string) =>
    commit((d) => {
      const held = d.sheets?.[spool]?.labelPositions;
      if (held) for (const l of drawing.labels ?? []) if (l.spool === spool && l.displaced) held[l.key] = [l.at[0], l.at[1]];
    });
  const clearedSpots = (spool: string) => (drawing.labels ?? []).filter((l) => l.displaced && l.spool === spool).length;
  /** Moves the picked label by a sheet offset; repeated nudges close together are one undo step. */
  const nudgeLabel = (dx: number, dy: number) => {
    const label = selectedLabelInfo;
    if (!label || (!label.spool && multiSpool)) return;
    commit((d) => { ((d.sheets ??= {})[label.spool] ??= {}).labelPositions = { ...d.sheets[label.spool].labelPositions, [label.key]: [label.at[0] + dx, label.at[1] + dy] }; },
      { key: "nudge:" + label.key });
  };
  const sheetStyle = styleOf(doc);
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
  /**
   * Routing on not-to-scale paper is drafted on the paper's lattice: one cell of the visible isometric paper along a
   * routing direction is one grid block of pipe (12" by default on a feet-and-inches drawing), so the pointer steps
   * cell by cell, as the grid shows it, whatever scale the laid-out drawing happens to be drawn at. The pick and its
   * preview are measured from where the routing start is drawn, along the paper's own iso directions.
   */
  const latticeRoute = useMemo((): Drawing => {
    const lattice = drawing.lattice;
    if (tool !== "pipe" || !routing || surface !== "paper" || !lattice || !(drafting.spacing > 0)) return routeDrawing;
    const origin = routeDrawing.project(anchor), per = lattice.cell / drafting.spacing;
    const steps = [0, 1, 2].map((k): Point => {
      const q: Vec3 = [...anchor];
      q[k] += drafting.spacing;
      const p = routeDrawing.project(q), v: Point = [p[0] - origin[0], p[1] - origin[1]], l = Math.hypot(v[0], v[1]);
      return l > 1e-9 ? [(v[0] / l) * per, (v[1] / l) * per] : [0, 0];
    });
    return {
      ...routeDrawing,
      project: (p: Vec3): Point => [0, 1, 2].reduce<Point>((at, k) => [at[0] + (p[k] - anchor[k]) * steps[k][0], at[1] + (p[k] - anchor[k]) * steps[k][1]], [origin[0], origin[1]]),
    };
  }, [routeDrawing, drawing.lattice, tool, routing, surface, anchor, drafting.spacing]);
  const pick = (p: Point, from = anchor, ortho = routing && grid.ortho !== false) => {
    // A new run's first point on not-to-scale paper is where it is clicked, on the nearest point of the paper.
    if (tool === "pipe" && !routing && surface === "paper" && drawing.lattice)
      return pickGridPoint(routeDrawing, grid.snap ? nearestPaperPoint(p, drawing.lattice) : p, from, { ...grid, snap: false });
    return ortho ? pickOrthoPoint(latticeRoute, p, from, grid) : pickGridPoint(latticeRoute, p, from, grid);
  };

  // --- The view ---------------------------------------------------------------------------------------------------
  const screenRect = () => {
    const r = svg.current?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: 0, top: 0, ...viewStore.get().screen };
  };
  const sheetAt = (clientX: number, clientY: number): Point => toSheet(frame, viewStore.get().view, screenRect(), clientX, clientY);
  const toClient = (p: Point): Point => toScreen(frame, viewStore.get().view, screenRect(), p);
  const scale = () => screenScale(frame, viewStore.get().view, viewStore.get().screen);
  const setView2 = (next: View, remember = true) => {
    const current = viewStore.get().view;
    if (remember && (current.zoom !== next.zoom || current.pan[0] !== next.pan[0] || current.pan[1] !== next.pan[1]))
      viewHistory.current = [...viewHistory.current, current].slice(-VIEW_HISTORY);
    viewStore.patch({ view: next });
  };
  /** Zoom so the drawing point under the pointer stays under it. */
  const zoomAt = (clientX: number, clientY: number, factor: number) => setView2(zoomAbout(frame, viewStore.get().view, sheetAt(clientX, clientY), factor), false);
  const zoomCentre = (factor: number) => {
    const r = screenRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  };
  /**
   * The piping's extent on the sheet: all of its ink — connections, pipe, symbols, dimensions, leaders, tags and
   * labels — but not the sheet's frame, title block or material list.
   */
  const extents = (): Box | null => inkExtents(drawing);
  /** The floating view toolbars, as rectangles on the drawing surface (with a little clear space round each). */
  const overlayCovers = (): Box[] => {
    const host = svg.current?.getBoundingClientRect(), stageEl = stage.current;
    if (!host || !stageEl) return [];
    return [...stageEl.querySelectorAll<HTMLElement>(".iso-view-controls > *, .iso-bottom-controls > *")]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height)
      .map((r): Box => [r.left - host.left - OVERLAY_GAP_PX, r.top - host.top - OVERLAY_GAP_PX, r.right - host.left + OVERLAY_GAP_PX, r.bottom - host.top + OVERLAY_GAP_PX]);
  };
  /** The view that shows `box` as large as fits, clear of the floating toolbars. */
  const fitClear = (box: Box, margin?: number): View => fitClearOf(frame, viewStore.get().screen, box, overlayCovers(), margin);
  /** The whole sheet, as large as fits with a small margin, clear of the floating toolbars. */
  const sheetView = (): View => fitClear([0, 0, frame.width, frame.height], SHEET_MARGIN);
  /** The view last fitted (sheet or extents); while it is still the view, a resized window fits it again. */
  const fitted = useRef<{ kind: "sheet" | "extents"; view: View } | null>(null);
  const fitTo = (kind: "sheet" | "extents"): View => {
    const box = kind === "extents" || surface === "grid" ? extents() : null;
    const view = box ? fitClear(box) : surface === "paper" ? sheetView() : fitClear([0, 0, frame.width, frame.height]);
    fitted.current = { kind, view };
    return view;
  };
  const zoomExtents = () => setView2(fitTo("extents"));
  const zoomSheet = () => setView2(fitTo("sheet"));
  const refit = useRef(() => {});
  refit.current = () => {
    const f = fitted.current;
    if (f && viewStore.get().view === f.view) viewStore.patch({ view: fitTo(f.kind) });
  };
  // The home view once the surface is laid out and measured: on opening, importing, or switching paper and model space.
  const homeSoon = useRef(0);
  const showHome = () => {
    viewStore.patch({ view: HOME });
    cancelAnimationFrame(homeSoon.current);
    // Wait (a few frames at most) for the drawing surface to be on screen, then fit the sheet clear of the toolbars.
    let tries = 0;
    const fit = () => {
      if (viewStore.get().view !== HOME || surfaceRef.current !== "paper") return;
      if (!svg.current && tries++ < 30) { homeSoon.current = requestAnimationFrame(fit); return; }
      viewStore.patch({ view: sheetViewRef.current() });
    };
    homeSoon.current = requestAnimationFrame(fit);
  };
  const sheetViewRef = useRef(() => fitTo("sheet"));
  sheetViewRef.current = () => fitTo("sheet");
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const zoomPrevious = () => {
    const previous = viewHistory.current.pop();
    if (previous) viewStore.patch({ view: previous });
    else setNotice({ text: "No previous view." });
  };
  useEffect(() => {
    // Model space opens framed on the piping; paper opens on the whole sheet. Later edits keep the view the user left.
    if (surface === "grid") zoomExtents();
    else showHome();
  }, [surface]); // eslint-disable-line react-hooks/exhaustive-deps
  const nav = useRef({ zoomAt, pan: (dx: number, dy: number) => viewStore.patch({ view: panScreen(frame, viewStore.get().view, viewStore.get().screen, dx, dy) }), wheel: drafting.wheel });
  nav.current = { zoomAt, pan: (dx, dy) => viewStore.patch({ view: panScreen(frame, viewStore.get().view, viewStore.get().screen, dx, dy) }), wheel: drafting.wheel };
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    // React registers wheel listeners as passive; zooming and panning must cancel page scrolling.
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".iso-view-controls,.iso-bottom-controls,input,select,textarea")) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      // A pinch arrives as Ctrl + wheel; Ctrl/⌘ + wheel always zooms. Shift, or a sideways scroll, pans.
      const zoomGesture = e.ctrlKey || e.metaKey || (nav.current.wheel === "zoom" && !e.shiftKey && dx === 0);
      if (zoomGesture) nav.current.zoomAt(e.clientX, e.clientY, Math.exp(-Math.max(-100, Math.min(100, dy)) * Math.log(ZOOM_STEP) / 100));
      else if (e.shiftKey && dx === 0) nav.current.pan(-dy, 0);
      else nav.current.pan(-dx, -dy);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [tab, ready]);

  // --- What is drawn and selected ---------------------------------------------------------------------------------
  // Not to scale, paper is isometric paper: the sheet's own lattice, which the layout puts every leg on. Model space
  // and to-scale sheets measure blocks of plant length from the drawing's first connection.
  const paperLattice = surface === "paper" ? drawing.lattice ?? null : null;
  const gridOrigin = useMemo(() => gridAnchor(doc), [doc]);
  const gridMask = useMemo(() => (surface === "paper" ? materialGridMask(drawing) : null), [surface, drawing]);
  // Checks and schedules follow the drawing: an edit redraws the sheet first, and they are worked out for it straight
  // after, without holding up the redraw. The schedules are worked out while their tab is open.
  const checked = useDeferredValue(doc);
  const issues = useMemo(() => validateIso(checked), [checked]),
    materials = useMemo(() => (tab === "materials" ? materialSchedule(checked) : []), [checked, tab]),
    cuts = useMemo(() => checked.runs.filter((r) => !r.connector).map((r) => runResult(checked, r)), [checked]),
    pieces = useMemo(() => (tab === "materials" ? cutSchedule(checked) : []), [checked, tab]),
    joints = useMemo(() => (tab === "welds" ? weldSchedule(checked) : []), [checked, tab]),
    weldCount = useMemo(() => welds(checked).length, [checked]);
  const selectedRun = doc.runs.find((r) => r.id === primary),
    selectedNode = doc.nodes.find((n) => n.id === primary),
    selectedNote = doc.sheetNotes?.find((n) => n.id === primary);
  const selectedTrack = useMemo(() => (selectedNode ? componentTrack(doc, selectedNode.id) : null), [doc, selectedNode]);
  const selectedTurn = !!selectedNode && isSquareTurn(doc, selectedNode.id);
  const selectedFaces = useMemo(() => (selectedTrack && selectedNode ? componentFaces(doc, selectedNode.id) : null), [doc, selectedNode, selectedTrack]);
  const pendingCuts = useMemo(() => cuts.filter((c) => !Number.isFinite(c.cut) || c.cut <= 0), [cuts]);
  const missingTakeoutNodes = useMemo(() => {
    const missing = new Set<string>();
    for (const c of cuts) for (const key of [c.run.from, c.run.to]) {
      const node = checked.nodes.find((n) => n.id === key);
      if (node && !missing.has(key) && takeout(checked, node, c.run.id) == null) missing.add(key);
    }
    return checked.nodes.filter((n) => missing.has(n.id));
  }, [checked, cuts]);
  const selectedEdges = selectedNode ? connected(doc, selectedNode.id) : [];
  const selectedHeader = selectedEdges.reduce<typeof selectedEdges[number] | undefined>((largest, run) => (!largest || run.nps > largest.nps ? run : largest), undefined)
    ?? doc.runs.find((r) => r.id === selectedNode?.associatedRunId);
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const selectableItems = useMemo(() => selectables(doc, drawing), [doc, drawing]);
  const snapTargets = useMemo(() => snapPoints(doc, drawing), [doc, drawing]);
  // Errors stop the cut list; warnings are assumptions to confirm. Both are listed, apart.
  const review = useMemo(() => { try { return reviewIso(checked); } catch { return issues.map((message) => ({ severity: "error" as const, message })); } }, [checked, issues]);
  // How the paper sheet was drafted (crowded, on finer cells, a held end folded) is listed with the checks, never blocking.
  const issueList = useMemo<InspectorIssue[]>(() => [
    ...review.map((issue) => ({ text: issueText(issue.message), severity: issue.severity })),
    ...(surface === "paper" ? drawing.notices ?? [] : []).map((notice): InspectorIssue => {
      const subject = notice.node && (doc.nodes.some((n) => n.id === notice.node) || doc.runs.some((r) => r.id === notice.node)) ? notice.node : undefined;
      return { text: notice.message, severity: "notice", ...(subject ? { onSelect: () => setSelection([subject]) } : {}) };
    }),
  ], [review, surface, drawing, doc]);
  const warningCount = review.length - issues.length;

  const selectConnection = (key: string, d = doc) => {
    setStart(key);
    setSelection([key]);
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
      const size = oletBranchSize(d, node) ?? nodeItem(d, node)?.nps ?? host.nps;
      setSpool(host.spool);
      setLine(host.line);
      setSpec(host.specId);
      setNps(size);
      routeWith(branchPrep(node.component, prepAt(host, 0)), host.specId, size, true);
    }
  };
  const branchPrep = (code: string | undefined, header: EndPrep): EndPrep => {
    const prep = COMPONENT_TYPES.find((t) => t.code === code)?.endPrep;
    return prep && prep !== "PLAIN" && prep !== "FL" ? prep : header;
  };
  /** Start the branch of a tee or olet just placed: the Pipe tool routes from it at the branch size and its end. */
  const routeBranch = (d: IsoDocument, nodeId: string, size: number, route = true) => {
    selectConnection(nodeId, d);
    const node = getNode(d, nodeId), host = connected(d, nodeId)[0] ?? d.runs.find((r) => r.id === node.associatedRunId)!;
    setNps(size);
    routeWith(branchPrep(node.component, prepAt(host, host.from === nodeId ? 0 : 1)), host.specId, size, node.kind === "olet");
    if (route) setTool("pipe");
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

  /** Routes a pipe by a plant offset from the routing start; one undo step. */
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
        const gap = DEFAULT_ROUTE_BLOCKS * drafting.spacing;
        const origin = { id: id(), kind: "end" as const, position: [Math.max(...d.nodes.map((n) => n.position[0])) + gap, 0, 0] as Vec3 };
        d.nodes.push(origin);
        from = origin.id;
      }
      if (from && !pending && !canRouteFrom(d, from)) throw new Error(noFreeEnd(d, from));
      const problem = from && routeError(d, from, delta);
      if (problem) throw new Error(problem);
      // Straight on from an open end at the same size, the pipe lengthens: there is no joint to weld.
      const extended = from && !pending ? extendRun(d, from, delta, { specId: activeSpec.id, nps, spool, line, prep: routingPrep }) : null;
      const node = extended ? getNode(d, from!) : appendRun(d, from, delta, activeSpec.id, nps, spool, line, routingPrep);
      // An olet takes the row for the branch actually routed from it (header by branch size).
      if (from && !extended) fitOletToBranch(d, from);
      // Routed on at another size, the line gets a reducer at the joint; it carries its flow on.
      if (from && !extended) reduceAtJoint(d, from);
      if (!extended) continueFlow(d, d.runs.at(-1)!.id);
      setStart(node.id);
      setSelection([node.id]);
      setPending(null);
    });
  /**
   * What a select click at a point picks, first choice first (see `pickCandidates`), or null where the press is on
   * something picked by what it is (a label, a note, a dimension, the frame) rather than by where it is.
   */
  const pickStack = (clientX: number, clientY: number, target: Element): string[] | null => {
    if (target.closest("[data-length],[data-label],[data-path]")) return null;
    const hit = target.closest("[data-node],[data-owner]");
    const owner = hit?.getAttribute("data-node") ?? hit?.getAttribute("data-owner") ?? "";
    const isNode = (id: string) => doc.nodes.some((n) => n.id === id);
    if (owner && !isNode(owner) && !doc.runs.some((r) => r.id === owner)) return null;
    const s = scale(), at = sheetAt(clientX, clientY), radius = Math.max(6, Math.min(14 * s, 11));
    const near: Array<{ id: string; distance: number; body: "core" | "body" | false }> = [];
    for (const [id, p] of drawing.positions) {
      if (!isNode(id)) continue;
      const q = toClient(p), distance = Math.hypot(q[0] - clientX, q[1] - clientY), hull = bodies.get(id);
      const body = hull ? insideHull(hull, at, BODY_PAD_PX / s) && "body" : distance <= NODE_CORE_PX && "core";
      if (body || distance <= radius) near.push({ id, distance, body });
    }
    near.sort((a, b) => a.distance - b.distance);
    const pipes = pipesAtPoint(doc, drawing, [clientX, clientY], toClient, PIPE_PICK_PX).map((h) => h.runId);
    const inked = pipeInkAt(drawing.primitives, pipes, at, PIPE_INK_PX / s);
    const ids = pickCandidates({ pipes, inked, nodes: near });
    return ids.length || !owner ? ids : [owner];
  };
  /** Selection cycling: what was under the last pick, and which of it is selected. Tab picks the next. */
  const cycle = useRef<{ ids: string[]; index: number } | null>(null);
  const pickInCycle = (id: string) => (doc.nodes.some((n) => n.id === id) ? selectConnection(id) : setSelection([id]));
  const cycleName = (id: string) => {
    const run = doc.runs.find((r) => r.id === id), node = doc.nodes.find((n) => n.id === id);
    return run ? `${sizeFor(doc, run.nps)} pipe` : node ? componentName(node) : "object";
  };
  const cycleNotice = (c: { ids: string[]; index: number }) =>
    setNotice({ text: `${CYCLE_NOTICE} · ${c.index + 1} of ${c.ids.length}: ${cycleName(c.ids[c.index])} · Tab for the next, Shift+Tab back` });
  const insertionTarget = (clientX: number, clientY: number, owner = ""): PipeHit | null => {
    const nearest = pipeAtPoint(doc, drawing, [clientX, clientY], toClient, owner);
    // A dimension also identifies its pipe, even when its label is offset from the centreline.
    return nearest ?? (owner ? pipeAtPoint(doc, drawing, [clientX, clientY], toClient, owner, 32) : null);
  };
  const insertFitting = (runId: string, type: ComponentType, row?: CatalogItem, position = fraction / 100, clicked = false) => {
    const before = latest.current;
    let placed: PipeNode | undefined;
    commit((d) => {
      placed = placeComponentOnPipe(d, runId, type, position, row);
      if (clicked) snapNearFace(d, placed.id);
      setSelection([placed.id]);
    });
    if (latest.current === before) return;
    setArmed(null);
    transient.patch({ insertHover: null });
    // A tee or olet is placed to take a branch: the Pipe tool (P) routes it from there, at the branch size. Placing it
    // does not start routing, so more components can be placed, or none routed at all.
    if (placed && (type.kind === "tee" || type.kind === "olet") && canRouteFrom(latest.current, placed.id)) {
      const branch = type.kind === "olet" ? row && (row.smallerNps ?? row.nps) : row?.smallerNps ?? row?.nps;
      routeBranch(latest.current, placed.id, branch ?? latest.current.runs.find((r) => r.id === runId)!.nps, false);
      setNotice({ text: `${type.label} placed · press P to route its branch from it, or Esc` });
    }
  };
  // The size a reducer, tee or olet is placed at, on the pipe the palette is showing.
  const paletteSpec = doc.specs.find((s) => s.id === (selectedRun?.specId ?? spec)) ?? doc.specs[0];
  const paletteNps = selectedRun?.nps ?? nps;
  const armedChoices = armed && sized(armed.type) && paletteSpec ? sizeChoices(paletteSpec, armed.type, paletteNps) : [];
  const chooseComponent = (type: ComponentType, row?: CatalogItem) => {
    setTool("insert");
    setTab("draw");
    setError("");
    transient.patch({ insertHover: null });
    setPending(null);
    const choices = sized(type) && paletteSpec ? sizeChoices(paletteSpec, type, paletteNps) : [];
    const chosen = row ?? (choices.find((c) => type.kind === "tee" && c.to === paletteNps) ?? choices[0])?.row;
    setArmed((current) => (current && current.type.code === type.code && current.row?.id === chosen?.id ? null : { type, row: chosen }));
    lastCommand.current = "insert";
  };
  const chooseSpec = async (value: string, runId = "") => {
    if (value === "library:retry") return loadLibrary();
    const use = (d: IsoDocument, specId: string) => {
      const chosen = getSpec(d, specId);
      let size = defaultNps(chosen);
      if (runId) {
        const run = d.runs.find((r) => r.id === runId);
        if (run) {
          if (!chosen.sizes.some((s) => s.nps === run.nps)) run.nps = defaultNps(chosen);
          // Its fittings, outlets and in-line components take the new specification's rows.
          setRunSpec(d, run.id, specId);
          size = run.nps;
        }
      }
      setSpec(specId);
      setNps(size);
    };
    if (!value.startsWith("library:") && !value.startsWith("saved:")) {
      if (runId) commit((d) => use(d, value));
      else use(latest.current, value);
      return;
    }
    const saved = value.startsWith("saved:"), slug = value.slice(saved ? "saved:".length : "library:".length);
    setSpecBusy(saved ? value : slug);
    try {
      const next = saved ? await loadSavedSpec(slug, latest.current) : await loadLibrarySpec(slug, latest.current);
      commit((d) => {
        d.specs.push(next);
        use(d, next.id);
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setSpecBusy("");
    }
  };

  /** The pipe point the Pipe tool is over, where a click starts a branch. */
  const branchTarget = (clientX: number, clientY: number): PipeHit | null => {
    const hit = pipeAtPoint(doc, drawing, [clientX, clientY], toClient);
    return hit && hit.end == null ? hit : null;
  };
  /** A branch from a point on a pipe, at the pipe's size; its tee goes in once the branch is routed. */
  const startBranch = ({ runId, fraction: at }: { runId: string; fraction: number }) => {
    const run = doc.runs.find((r) => r.id === runId)!;
    const a = getNode(doc, run.from).position, b = getNode(doc, run.to).position;
    setPending({ position: a.map((v, i) => v + (b[i] - v) * at) as Vec3, runId, fraction: at });
    setStart("");
    setSelection([]);
    setSpool(run.spool);
    setLine(run.line);
    setSpec(run.specId);
    setNps(run.nps);
    routeWith(prepAt(run, 0), run.specId, run.nps);
    setError("");
    setArmed(null);
    setTool("pipe");
    lastCommand.current = "pipe";
  };
  // Clicks place at whole millimetres or sixteenths along the straight, as previewed.
  const snapHit = (hit: PipeHit): PipeHit => (hit.end == null ? { ...hit, ...snapAlongLeg(doc, hit.runId, hit.fraction) } : hit);

  // --- Object snaps and the pick point ------------------------------------------------------------------------------
  const snapsFor = (kinds?: ObjectSnap[]) => {
    if (!drafting.osnap) return null;
    const on = { ...drafting.snaps };
    if (kinds) for (const k of Object.keys(on) as ObjectSnap[]) on[k] = on[k] && kinds.includes(k);
    return on;
  };
  /** The snap a pick at `p` locks to for the active command. */
  const snapAt = (p: Point): Snap | null => {
    // Routing ends on a connection, not partway along a pipe; a click on a pipe already branches from it.
    const enabled = snapsFor(tool === "pipe" ? ["endpoint", "centre"] : undefined);
    if (!enabled || !["pipe", "measure", "move", "copy"].includes(tool)) return null;
    const exclude = tool === "pipe" && start ? new Set([start]) : undefined;
    return resolveSnap(snapTargets, doc, drawing, p, APERTURE_PX / scale(), enabled, exclude);
  };
  /** The plant point a command pick at `p` stands for: a snapped point exactly, else the grid pick from `from`. */
  const pickFor = (p: Point, snap: Snap | null, from: Vec3, ortho: boolean): Vec3 => (snap ? snap.model : pick(p, from, ortho));
  const lastPickError = useRef("");
  const showPickError = (e: unknown) => {
    const text = message(e);
    if (text !== lastPickError.current) setNotice({ text, tone: "error" });
    lastPickError.current = text;
  };

  /**
   * A Pipe-tool click: a connection with a free end starts a run from it; a pipe starts a branch from that point; open
   * sheet starts a new run or, with a run in progress, routes the pipe there. A fitting with no free end, or the title block, asks instead.
   */
  const routeClick = (clientX: number, clientY: number, node: string | null) => {
    try {
      const p = sheetAt(clientX, clientY), snap = transient.get().snap;
      const target = node ?? (snap && doc.nodes.some((n) => n.id === snap.id) ? snap.id : null);
      if (target) {
        if (routing && target !== start) add(sub(getNode(doc, target).position, anchor));
        else if (canRouteFrom(doc, target)) selectConnection(target);
        else setError(noFreeEnd(doc, target));
        return;
      }
      const hit = branchTarget(clientX, clientY);
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
        setSelection([]);
        setError("");
      }
    } catch (e) {
      setError(message(e));
    }
  };
  /** A pick for Measure, Move or Copy: snapped exactly, else on the grid from the previous point. */
  const commandPoint = (clientX: number, clientY: number, from: Vec3 | null): Vec3 => {
    const p = sheetAt(clientX, clientY), snap = transient.get().snap;
    return pickFor(p, snap, from ?? gridOrigin, !!from && grid.ortho !== false);
  };
  const measureText = (a: Vec3, b: Vec3) =>
    `${offsetText(a, b, doc.units)}  ·  from ${coordinateText(doc, a).join(" ")} to ${coordinateText(doc, b).join(" ")}`;
  const measureClick = (clientX: number, clientY: number) => {
    try {
      const at = commandPoint(clientX, clientY, measure && !measure.to ? measure.from : null);
      if (!measure || measure.to) setMeasure({ from: at });
      else {
        setMeasure({ from: measure.from, to: at });
        setNotice({ text: measureText(measure.from, at) });
      }
    } catch (e) {
      setError(message(e));
    }
  };
  /** Applies a Move or Copy offset to the selection. */
  const applyTransform = (delta: Vec3) => {
    if (!transform) return;
    if (transform.mode === "paste" && transform.clip) {
      let pasted: { ids: string[]; spools: string[] } | undefined;
      if (commit((d) => { pasted = pastePieces(d, transform.clip!, delta); }) && pasted) {
        setSelection(pasted.ids);
        setTransform({ ...transform, pasted: (transform.pasted ?? 0) + 1 });
        setNotice({ text: `Pasted into ${pasted.spools.join(", ")} · pick another point to paste again, or Esc` });
      }
      return;
    }
    const ids = existing(latest.current, transform.ids);
    if (!ids.length) return setError("What was selected for this command is no longer in the drawing.");
    if (transform.mode === "move") {
      if (commit((d) => moveSelection(d, ids, delta))) {
        setNotice({ text: `Moved ${ids.length} object${ids.length === 1 ? "" : "s"} ${moveText(delta, doc.units)}` });
        setTransform(null);
        setTool("select");
      }
      return;
    }
    const clip = copySelection(latest.current, ids);
    if (!clip) return setError("Copy takes whole pipes: select the pipes to copy, with their fittings.");
    let made: { ids: string[]; spools: string[] } | undefined;
    if (commit((d) => { made = pastePieces(d, clip, delta); }) && made) {
      setSelection(made.ids);
      setNotice({ text: `Copied to ${made.spools.join(", ")} · pick another point to copy again, or Esc` });
    }
  };
  const transformClick = (clientX: number, clientY: number) => {
    if (!transform) return;
    try {
      // A copied branch is pasted onto the pipe picked, at the point picked along it (unless a point snaps).
      const onPipe = transform.mode === "paste" && transform.base && !transient.get().snap && transform.clip?.nodes.some((n) => n.kind === "olet") ? branchTarget(clientX, clientY) : null;
      if (onPipe && transform.base) {
        const { runId, fraction } = snapAlongLeg(doc, onPipe.runId, onPipe.fraction), run = doc.runs.find((r) => r.id === runId)!;
        const a = getNode(doc, run.from).position, b = getNode(doc, run.to).position;
        return applyTransform(sub(a.map((v, i) => v + (b[i] - v) * fraction) as Vec3, transform.base));
      }
      const at = commandPoint(clientX, clientY, transform.base);
      if (!transform.base) setTransform({ ...transform, base: at });
      else applyTransform(sub(at, transform.base));
    } catch (e) {
      setError(message(e));
    }
  };

  /** A click in the drawing, by the active command. */
  const place = (clientX: number, clientY: number, target: Element, additive: boolean) => {
    if (!ready) return;
    const owner = target.closest("[data-owner]")?.getAttribute("data-owner"),
      node = target.closest("[data-node]")?.getAttribute("data-node");
    if (armed && tool === "insert" && armed.type.angle) {
      // An angle or relief valve goes at a square turn: click the elbow it replaces.
      const turn = node ?? (owner && doc.nodes.some((n) => n.id === owner) ? owner : undefined);
      if (turn && isSquareTurn(doc, turn)) {
        if (commit((d) => setSelection([placeAtTurn(d, turn, armed.type, undefined, armed.row).id]))) {
          setArmed(null);
          transient.patch({ insertHover: null });
        }
      } else setError(`${armed.type.label} has an angle body. Click a 90° elbow to put it there.`);
      return;
    }
    if (armed && tool === "insert") {
      const hit = insertionTarget(clientX, clientY, owner ?? "");
      if (hit) {
        // Flanges, blinds and caps dropped on an open pipe end become that end.
        const run = doc.runs.find((r) => r.id === hit.runId)!, endNode = hit.end == null ? undefined : getNode(doc, hit.end === 0 ? run.from : run.to);
        const open = !!endNode && endNode.kind === "end" && !endNode.associatedRunId && connected(doc, endNode.id).length === 1;
        const onEnd = open && endCapable(armed.type);
        // A valve, coupling or union on an open end closes the line there, with no pipe after it.
        if (open && !onEnd && terminalCapable(armed.type)) {
          const before = latest.current;
          commit((d) => setSelection([placeAtOpenEnd(d, hit.runId, hit.end!, armed.type, armed.row).id]));
          if (latest.current !== before) {
            setArmed(null);
            transient.patch({ insertHover: null });
          }
          return;
        }
        const at = onEnd ? { runId: hit.runId, fraction: hit.end! } : snapAlongLeg(doc, hit.runId, hit.fraction);
        const choices = sized(armed.type) ? sizeChoices(getSpec(doc, run.specId), armed.type, run.nps) : [];
        if (choices.length && !choices.some((c) => c.row.id === armed.row?.id)) {
          // The size was chosen for another pipe: offer this pipe's sizes and ask again.
          setSelection([run.id]);
          setArmed({ type: armed.type, row: choices[0].row });
          setError(`The size shown was for a ${sizeFor(doc, paletteNps)} pipe. Choose the size for this ${sizeFor(doc, run.nps)} pipe, then click it again.`);
          return;
        }
        insertFitting(at.runId, armed.type, armed.row, at.fraction, !onEnd);
      } else setError("No pipe at that point. Click a straight pipe or its dimension label to place " + armed.type.label + ".");
      return;
    }
    if (tool === "pipe") return routeClick(clientX, clientY, node ?? null);
    if (tool === "split") {
      const at = node ?? (owner && doc.nodes.some((n) => n.id === owner) ? owner : undefined);
      if (at && connected(doc, at).length >= 2) return breakSheet({ nodeId: at });
      const hit = branchTarget(clientX, clientY);
      if (hit) return breakSheet(snapAlongLeg(doc, hit.runId, hit.fraction));
      return setError("Click a pipe where the line goes on to the next sheet, or a connection (a weld, flange or fitting) to break at.");
    }
    if (tool === "measure") return measureClick(clientX, clientY);
    if (tool === "move" || tool === "copy") return transformClick(clientX, clientY);
    // Fittings are picked on their bodies and pipes on their lines, whichever pick target is on top; a pipe too short
    // on screen to have a line of its own to click is picked from near its centreline.
    const stack = pickStack(clientX, clientY, target);
    const picked = stack ? stack[0] ?? null
      : node ?? (owner && (doc.runs.some((r) => r.id === owner) || doc.nodes.some((n) => n.id === owner) || doc.sheetNotes?.some((n) => n.id === owner)) ? owner : null);
    cycle.current = stack && stack.length > 1 && !additive ? { ids: stack, index: 0 } : null;
    if (cycle.current) cycleNotice(cycle.current);
    else setNotice((n) => (n?.text.startsWith(CYCLE_NOTICE) ? null : n));
    if (additive) {
      if (picked) setSelection(clickSelect(selectionRef.current, [picked], "toggle"));
      return;
    }
    if (picked && doc.nodes.some((n) => n.id === picked)) selectConnection(picked);
    else setSelection(picked ? [picked] : []);
    // Insert with nothing chosen yet: the click picks the pipe (the palette shows its sizes) and says what comes next.
    if (tool === "insert" && !armed)
      setNotice({ text: picked && doc.runs.some((r) => r.id === picked) ? "Choose a component in the palette, then click where it goes on this pipe." : "Choose a component in the palette, then click the pipe it goes on." });
  };

  // --- Exports, imports --------------------------------------------------------------------------------------------
  /** Fabrication outputs are made with open checks only once the drafter has said so. */
  const confirmChecks = async (what: string) => {
    // The drawing as it is now, whether or not its checks have caught up with the last edit.
    const issues = validateIso(latest.current);
    if (!issues.length) return true;
    const choice = await ask(setDialog, {
      title: `${issues.length} fabrication check${issues.length === 1 ? " is" : "s are"} open`,
      body: (
        <>
          <p>The {what} may be wrong until these are resolved:</p>
          <ul className="iso-dialog-list">{issues.slice(0, 6).map((issue, i) => <li key={i}>{issueText(issue)}</li>)}</ul>
          {issues.length > 6 && <p>and {issues.length - 6} more.</p>}
        </>
      ),
      confirm: { label: `Export ${what} anyway` },
    });
    return choice === "ok";
  };
  const runExport = async (format: string) => {
    const entry = EXPORTS.find((x) => x.format === format);
    if (entry?.checked && !(await confirmChecks(entry.label))) return;
    setBusy(format);
    setError("");
    try {
      const { exportPdf, exportSchedule, exportSheets } = await import("./export");
      const prefs = readExportPreferences(), options = dxfOptions(prefs);
      if (format === "PDF") download(drawingFileName(doc) + ".pdf", await exportPdf(doc));
      // Model space is one true-size drawing; sheets are one file per spool and view, zipped when there are several.
      else if (format === "DXF" && prefs.space === "model") download(drawingFileName(doc) + "-model.dxf", isometricDxf(doc, createDrawing(doc, "", "iso", undefined, { model: true }), options), "application/dxf");
      else if (format === "DXF") exportSheets(doc, "dxf", options);
      else if (format === "DWG") { const { name, blob } = await exportDwgSheets(doc, options); download(name, blob); }
      else if (format === "PCF") {
        const { pcf, sidecar } = exportPcfPackage(doc);
        if (prefs.pcfSidecar) download(drawingFileName(doc) + "-pcf.zip", new Blob([zip([{ name: drawingFileName(doc) + ".pcf", content: pcf }, { name: drawingFileName(doc) + ".piping", content: sidecar }]) as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
        else download(drawingFileName(doc) + ".pcf", pcf);
      }
      else if (format === "SVG") exportSheets(doc, "svg");
      else if (format === "JSON") download(drawingFileName(doc) + ".piping", JSON.stringify(doc, null, 2), "application/json");
      else if (format === "bom") download(drawingFileName(doc) + "-materials.csv", materialCsv(doc), "text/csv");
      else if (format === "labour") download(drawingFileName(doc) + "-labour.csv", labourCsv(doc), "text/csv");
      else exportSchedule(doc, format as "cut" | "weld");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  };
  /**
   * Opens a PCF (with its .piping sidecar chosen beside it, or the ZIP the PCF export writes), piping JSON or legacy
   * DXF in place of this drawing, after asking; one undo step.
   */
  const importFile = async (files: File[]) => {
    try {
      const result = await readIsometricFiles(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      const file = { name: result.name };
      if (latest.current.runs.length || latest.current.nodes.length) {
        const choice = await ask(setDialog, {
          title: `Replace this drawing with ${file.name}?`,
          body: <p>Everything in the open drawing is replaced by the imported one. Undo brings the open drawing back.</p>,
          confirm: { label: "Replace drawing", danger: true },
        });
        if (choice !== "ok") return;
      }
      const next = result.doc;
      // The import replaces the document wholesale; nothing of the open drawing is merged into it.
      if (!commit((d) => {
        for (const key of Object.keys(d) as Array<keyof IsoDocument>) delete d[key];
        Object.assign(d, clone(next));
      })) return;
      // A command half-done in the old drawing (a pending start, a move base, a measurement) does not carry over.
      activateTool("select");
      setSpec(next.runs.at(-1)?.specId ?? next.specs[0]?.id ?? "");
      if (next.runs.length) setNps(next.runs.at(-1)!.nps);
      else if (next.specs[0]) setNps(defaultNps(next.specs[0]));
      setStart(lastOpenEnd(next));
      setSelection([]);
      setSelectedLabel(null);
      showHome();
      if (result.warnings.length) showWarnings(file.name, result.warnings, "imported");
      else setNotice({ text: `Imported ${file.name}: ${next.runs.length} pipes, ${next.nodes.length} connections.` });
    } catch (e) {
      setError(message(e));
    }
  };
  /** What a file could not carry exactly, listed once it is open, to be read and dismissed. */
  const showWarnings = (name: string, warnings: string[], how: "opened" | "imported") =>
    setDialog({
      title: `${name} ${how} with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
      body: <ul className="iso-dialog-list">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>,
      done: () => setDialog(null),
    });
  const importSpecs = async (file: File) => {
    try {
      const imported = JSON.parse(await file.text());
      const specs = Array.isArray(imported) ? imported : imported.specs;
      if (!Array.isArray(specs) || !specs.length) throw new Error("Choose a specification JSON containing a non-empty specification list.");
      commit((d) => { d.specs = [...d.specs.filter((s) => !specs.some((n) => n.id === s.id)), ...specs]; });
    } catch (e) {
      setError(message(e));
    }
  };

  // --- Lengths edited in place --------------------------------------------------------------------------------------
  const openLength = useCallback((runId: string, role: "overall" | "cut") => {
    const run = latest.current.runs.find((r) => r.id === runId && !r.connector);
    if (!run) return;
    setSelection([runId]);
    setTool("select");
    setArmed(null);
    setLengthEdit({ runId, role });
  }, [setSelection]);
  const lengthDraft = useMemo(() => {
    if (!lengthEdit) return "";
    const run = doc.runs.find((r) => r.id === lengthEdit.runId);
    if (!run) return "";
    const result = runResult(doc, run);
    return lengthInputValue(lengthEdit.role === "cut" ? result.cut : result.overall, doc.units);
  }, [lengthEdit, doc]);
  const finishLength = (raw: string) => {
    const edit = lengthEdit;
    setLengthEdit(null);
    if (!edit || raw.trim() === lengthDraft) return;
    try {
      const value = parseLength(raw, doc.units);
      const run = doc.runs.find((r) => r.id === edit.runId);
      if (!run || run.connector) throw new Error("Select a pipe to change its length.");
      const current = runResult(doc, run), target = edit.role === "cut" ? current.cut : current.overall;
      if (!Number.isFinite(target) || Math.abs(value - target) > 0.001)
        commit((d) => (edit.role === "cut" ? resizeRunToCut(d, edit.runId, value) : resizeRun(d, edit.runId, value)));
    } catch (e) {
      setError(message(e));
    }
  };
  const bindLengthInput = useCallback((el: HTMLInputElement | null) => {
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  const editingText = lengthEdit ? lengthText(drawing.primitives, lengthEdit.runId, lengthEdit.role) : undefined;
  useEffect(() => { if (lengthEdit && !editingText) setLengthEdit(null); }, [lengthEdit, editingText]);

  /** Opens the properties on a field, by name: the explicit way the inspector is brought back. */
  const focusProperty = (name?: string) => {
    setInspectorOpen(true);
    setTab((t) => (t === "sheet" ? t : "draw"));
    if (name) revealProperty(reveal, name);
    else requestAnimationFrame(() => inspector.current?.focus());
  };
  /** Double-click on a label: pick it and edit its text, or its lettering when its text comes from the model. */
  const editLabel = (key: string) => {
    const label = paperLabels.get(key);
    if (!label) return;
    setSelection([]);
    setSelectedLabel({ key: label.key, spool: label.spool });
    focusProperty(labelText(doc, label) ? "Label text" : "Letter height");
  };

  // --- Menus ---------------------------------------------------------------------------------------------------------
  /** What a right-click offers while a command runs: its options, as AutoCAD's shortcut menu does. */
  const commandOptions = (): CommandOption[] => {
    const cancel = { label: "Cancel", key: "Esc", action: () => escape() };
    if (tool === "pipe" && routing) return [
      { label: "Finish run", key: "Enter", action: finishRun },
      { label: "Undo last segment", key: KEYS.undo, action: () => stepHistory() },
      cancel,
    ];
    if (tool === "pipe") return [{ label: "Exit Pipe", key: "Esc", action: () => activateTool("select") }];
    if (tool === "insert" && armed) return [cancel];
    if (tool === "measure" || tool === "move" || tool === "copy" || tool === "zoom-window" || tool === "split") return [cancel];
    return [];
  };
  const showEditMenu = (target: Element, x: number, y: number, keyboard = false) => {
    const options = commandOptions();
    if (options.length) {
      setEditMenu({ x, y, title: tool === "pipe" ? "Pipe" : tool === "insert" ? "Insert" : tool === "measure" ? "Measure" : tool === "zoom-window" ? "Zoom window" : "Command", items: options.map((o) => ({ label: o.label, shortcut: o.key, action: o.action })) });
      return;
    }
    // A label is picked on its own, apart from what it describes; the menu offers to select that instead.
    const label = labelsEditable ? (keyboard && selectedLabelInfo && !target.closest("[data-label]") ? selectedLabelInfo : pickLabel(paperLabels, target, selectedLabel?.key, false, true)) : undefined;
    const owner = label ? "" : target.closest("[data-node]")?.getAttribute("data-node") ?? target.closest("[data-owner]")?.getAttribute("data-owner") ?? (keyboard ? primary : "");
    let ids = selectionRef.current;
    // Right-clicking something outside the selection selects it; inside the selection the menu acts on all of it.
    // Right-clicking empty paper leaves the selection alone (as AutoCAD does): the menu acts on what is selected.
    if (owner && !ids.includes(owner)) {
      if (doc.nodes.some((n) => n.id === owner)) selectConnection(owner);
      else setSelection(doc.runs.some((r) => r.id === owner) || doc.sheetNotes?.some((n) => n.id === owner) ? [owner] : []);
      ids = [owner];
    }
    if (label || owner) setSelectedLabel(label ? { key: label.key, spool: label.spool } : null);
    if (label) ids = [];
    const run = ids.length === 1 ? doc.runs.find((r) => r.id === ids[0]) : undefined, node = ids.length === 1 ? doc.nodes.find((n) => n.id === ids[0]) : undefined;
    const p = sheetAt(x, y);
    const a = run && drawing.positions.get(run.from), b = run && drawing.positions.get(run.to);
    const dx = a && b ? b[0] - a[0] : 0, dy = a && b ? b[1] - a[1] : 0;
    const along = a && b ? Math.max(0.001, Math.min(0.999, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))) : 0.5;
    const items: EditMenuItem[] = [];
    if (label) {
      const held = doc.sheets?.[label.spool]?.labelPositions ?? {};
      const move = (dimension = false) => {
        gesture.current = { kind: "label", pointerId: null, drag: { key: label.key, spool: label.spool, point: p, at: label.at, destination: [...label.at], label: label.key, moved: true, ...(dimension ? { dimension: label.dimension } : {}) } };
        transient.patch({ labelPreview: label.at });
        setNotice({ text: "Move the pointer and click to place the label · Esc cancels" });
      };
      items.push({ label: labelText(doc, label) ? "Edit text" : "Edit lettering", shortcut: "Double-click", action: () => editLabel(label.key) });
      items.push({ label: "Move label", action: () => move() });
      if (label.dimension) items.push({ label: "Move dimension line", action: () => move(true) });
      items.push({ label: "Reset label position", shortcut: "Del", danger: true, disabled: !held[label.key] && !Object.keys(held).some((k) => k.startsWith(label.key + "#")), action: () => resetLabel(label.key, label.spool, false) });
      if (label.leader) items.push({ label: "Reset leader bend", danger: true, disabled: !label.leader.held, action: () => resetLeader(label.key, label.spool) });
      if (label.dimension) items.push({ label: "Reset dimension layout", danger: true, action: () => resetDimension(label.key, label.spool) });
      const described = label.owner && (doc.runs.some((r) => r.id === label.owner) || doc.nodes.some((n) => n.id === label.owner)) ? label.owner : undefined;
      if (described) items.push({ label: doc.runs.some((r) => r.id === described) ? "Select pipe" : "Select component", action: () => { setSelectedLabel(null); if (doc.nodes.some((n) => n.id === described)) selectConnection(described); else setSelection([described]); } });
    }
    // Every held label on the sheet, or just those now drawn clear of an overprint, go back to automatic placement.
    const sheetSpool = label?.spool ?? (filter || (!multiSpool ? doc.runs[0]?.spool ?? "" : ""));
    const sheetHeld = labelsEditable && Object.keys(doc.sheets?.[sheetSpool]?.labelPositions ?? {}).length > 0;
    const cleared = clearedSpots(sheetSpool);
    if (labelsEditable && (label || !ids.length)) {
      if (cleared) items.push({ label: saveAutoMovedText(cleared), title: SAVE_AUTO_MOVED_HINT, action: () => keepClearedSpots(sheetSpool) });
      items.push({ label: "Reset all label positions on this sheet", danger: true, disabled: !sheetHeld, action: () => resetSheetLabels(sheetSpool) });
    }
    if (run) {
      if (!run.connector) items.push(
        { label: "Edit overall length", action: () => focusProperty("Pipe overall length") },
        { label: "Edit cut length", action: () => focusProperty("Pipe cut length") },
        { label: "Branch from here", action: () => startBranch(snapAlongLeg(doc, run.id, along)) },
        { label: "Continue on a new sheet here", action: () => breakSheet(snapAlongLeg(doc, run.id, along)) },
      );
      items.push({ label: "Insert component", shortcut: "I", action: () => { setFraction(along * 100); activateTool("insert"); } }, { label: "Pipe properties", action: () => focusProperty("Pipe overall length") });
    } else if (node) {
      items.push({ label: "Component properties", action: () => focusProperty() });
      if (canRouteFrom(doc, node.id)) items.push({ label: "Continue / branch here", shortcut: "P", action: () => { selectConnection(node.id); setTool("pipe"); lastCommand.current = "pipe"; } });
      if (connected(doc, node.id).length >= 2 && !node.associatedRunId) items.push({ label: "Continue on a new sheet here", action: () => breakSheet({ nodeId: node.id }) });
      if (surface === "paper") items.push({ label: "Reset paper position", danger: true, disabled: !Object.values(doc.sheets ?? {}).some((s) => s.nodePositions?.[node.id]), action: () => commit((d) => { for (const sheet of Object.values(d.sheets ?? {})) if (sheet.nodePositions) delete sheet.nodePositions[node.id]; }) });
    } else if (ids.length > 1) {
      items.push({ label: `Properties of ${ids.length} objects`, action: () => focusProperty() });
    } else if (!label) {
      items.push({ label: "Draw pipe", shortcut: "P", action: () => activateTool("pipe") }, { label: "Insert component", shortcut: "I", action: () => activateTool("insert") },
        { label: "Measure distance", shortcut: "D", action: () => activateTool("measure") });
      if (clipboard.current) items.push({ label: "Paste pieces", shortcut: KEYS.paste, action: () => paste(clipboard.current!.clip) });
    }
    if (ids.length) {
      items.push({ label: "Move", shortcut: "M", action: () => activateTool("move") }, { label: "Copy", shortcut: "C", action: () => activateTool("copy") });
      items.push({ label: ids.length > 1 ? `Erase ${ids.length} objects` : "Erase", shortcut: "Del", danger: true, action: () => erase(ids) });
    }
    items.push(
      { label: "Undo", shortcut: KEYS.undo, disabled: !history.undoCount, action: () => stepHistory() },
      { label: "Redo", shortcut: KEYS.redo, disabled: !history.redoCount, action: () => stepHistory(true) },
      { label: "Select all", shortcut: KEYS.selectAll, action: selectAll },
      { label: drafting.grid ? "Hide grid" : "Show grid", shortcut: "F7", action: () => setDrafting({ grid: !drafting.grid }) },
      { label: "Zoom extents", action: zoomExtents },
    );
    const title = run ? "Pipe" : node ? componentName(node) : ids.length > 1 ? `${ids.length} objects` : label ? labelKind(label) : "Drawing";
    // What throws work away (erase, resets) comes last, so a stray Enter on the opened menu never runs it.
    setEditMenu({ x, y, title, items: [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)] });
  };

  // --- Commands ------------------------------------------------------------------------------------------------------
  const finishRun = () => {
    // Finishing commits the run: its last pipe stays selected to check or edit, rather than the selection going.
    const last = start ? latest.current.runs.filter((r) => r.from === start || r.to === start).at(-1) : undefined;
    setStart("");
    setPending(null);
    setSelection(last ? [last.id] : []);
    transient.patch({ cursor: null, snap: null });
  };
  /** Esc: the drag in progress, then the command, then the selection. */
  const escape = () => {
    // Esc also puts away a command's error message, whatever else it cancels.
    clearCommandError();
    if (editMenu) return setEditMenu(null);
    if (lengthEdit) return setLengthEdit(null);
    if (cancelGesture()) return setNotice(null);
    // Esc ends the command outright, as in CAD: a run being routed is finished (what was drawn stays) and the Pipe
    // tool is put down, in one press. Enter or Space finishes the run and stays in the Pipe tool for the next.
    if (tool === "pipe" && (start && routing || pending)) {
      finishRun();
      setSelection([]);
      activateTool("select");
      return;
    }
    if (tool !== "select") { activateTool("select"); return; }
    if (selectedLabel) return setSelectedLabel(null);
    if (selectionRef.current.length) return setSelection([]);
    setNotice(null);
  };
  const selectAll = () => {
    const runs = doc.runs.filter((r) => !filter || r.spool === filter);
    const onSheet = new Set(runs.flatMap((r) => [r.from, r.to, r.id]));
    // Pipes and the components on them; the ends and turns come with their pipes.
    const nodes = doc.nodes.filter((n) => (onSheet.has(n.id) || (n.associatedRunId && onSheet.has(n.associatedRunId))) && !["end", "weld", "elbow90", "elbow45"].includes(n.kind));
    setSelection([...runs.map((r) => r.id), ...nodes.map((n) => n.id)]);
    setSelectedLabel(null);
    setTool("select");
  };
  const copyToClipboard = (event?: ClipboardEvent, cut = false) => {
    const clip = copySelection(latest.current, selectionRef.current);
    if (!clip) return setNotice({ text: "Select whole pipes to copy them, with their fittings." });
    clipboard.current = { clip, pastes: 0 };
    const text = JSON.stringify(clip);
    if (event?.clipboardData) {
      event.clipboardData.setData(CLIPBOARD_MIME, text);
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
    }
    setNotice({ text: `${cut ? "Cut" : "Copied"} ${clip.runs.length} pipe${clip.runs.length === 1 ? "" : "s"} · ${KEYS.paste} places them where you pick` });
    if (cut) erase(clip.runs.map((r) => r.id));
  };
  /**
   * Paste, as AutoCAD's: the pieces follow the pointer from their base point (a copied branch's olet, else the first
   * connection) and go where it is picked; a branch put on a pipe goes onto it with its olet. Enter instead pastes them
   * beside the pieces they were copied from.
   */
  const paste = (clip: Clipboard) => {
    if (clip.units !== latest.current.units) setNotice({ text: "Pasted from a drawing in other units; lengths are kept as measured." });
    activateTool("select");
    const pipes = new Set(clip.runs.map((r) => r.id));
    const base = clip.nodes.find((n) => n.kind === "olet" && n.associatedRunId && !pipes.has(n.associatedRunId)) ?? clip.nodes.find((n) => n.id === clip.runs[0]?.from);
    if (!base) return;
    setTransform({ mode: "paste", base: [...base.position], ids: [], clip });
    setTool("copy");
  };
  /** Enter in Paste: beside the pieces they were copied from, clear of the last paste. */
  const pasteBeside = (clip: Clipboard) => {
    const held = clipboard.current?.clip === clip ? clipboard.current : (clipboard.current = { clip, pastes: 0 });
    held.pastes++;
    const [lo, hi] = clipboardExtent(clip), step = hi[0] - lo[0] + DEFAULT_ROUTE_BLOCKS * drafting.spacing / 2;
    let made: { ids: string[]; spools: string[] } | undefined;
    if (commit((d) => { made = pastePieces(d, clip, [step * held.pastes, 0, 0]); }) && made) {
      setSelection(made.ids);
      setNotice({ text: `Pasted as ${made.spools.join(", ")} · Move (M) puts it where it belongs` });
    }
    setTransform(null);
    setTool("select");
  };
  /** A command started by its command-line name or alias. */
  const runCommand = (id: CommandId) => {
    switch (id) {
      case "select": case "pan": case "pipe": case "insert": case "measure": case "move": case "copy": case "zoom-window":
        return activateTool(id);
      case "erase": return selectionRef.current.length ? erase() : setNotice({ text: "Select what to erase first." });
      case "zoom-extents": return zoomExtents();
      case "zoom-previous": return zoomPrevious();
      case "zoom-sheet": return zoomSheet();
      case "undo": return stepHistory();
      case "redo": return stepHistory(true);
      case "grid": return setDrafting({ grid: !drafting.grid });
      case "snap": return setDrafting({ snap: !drafting.snap });
      case "ortho": return setDrafting({ ortho: !drafting.ortho });
      case "osnap": return setDrafting({ osnap: !drafting.osnap });
      case "help": return setHelp(true);
    }
  };
  /** Enter or Space with nothing typed: finish the command in progress, else repeat the last one. */
  const enter = () => {
    if (tool === "pipe" && routing) return finishRun();
    if (tool === "copy" && transform?.mode === "paste" && transform.clip && !transform.pasted) return pasteBeside(transform.clip);
    if (tool === "measure" || tool === "move" || tool === "copy") return activateTool("select");
    if (lastCommand.current) runCommand(lastCommand.current);
  };
  /** The direction the cursor points from the routing start (or move base), for a typed length. */
  const pointing = (from: Vec3) => {
    const cursor = transient.get().cursor;
    return cursor ? dominantAxis(sub(cursor, from)) : null;
  };
  /** What was typed in the command line: a length or offset for the command waiting for a point, else a command. */
  const submitCommand = (text: string): string | void => {
    if (!text) return void enter();
    const command = parseCommand(text);
    const wantsPoint = tool === "pipe" || ((tool === "move" || tool === "copy") && !!transform);
    if (command && !(wantsPoint && /^[ENSWUD]$/i.test(text.trim()))) return void runCommand(command.id);
    try {
      if (tool === "move" || tool === "copy") {
        const input = parsePointInput(text, doc.units);
        applyTransform(inputDelta(input, transform?.base ? pointing(transform.base) : null));
        return;
      }
      if (tool !== "pipe") {
        const input = parsePointInput(text, doc.units);
        // A length typed with no command routes from the selected connection, as the ribbon's direction buttons do.
        if (input.kind === "length") return "Point the cursor or type a direction too: N 10', U 600, @0,0,600. Or choose Pipe (P) first.";
        activateTool("pipe");
        add(inputDelta(input, null));
        return;
      }
      if (!routing && !start) return "Click where the run starts, or select an open end, then type its length.";
      add(inputDelta(parsePointInput(text, doc.units), pointing(anchor)));
    } catch (e) {
      return command ? undefined : message(e);
    }
  };
  const prompt = (() => {
    if (tool === "pipe") {
      if (pending?.runId) return "PIPE  Pick where the branch goes, or type a length, N 10', @E,N,EL";
      if (routing) return "PIPE  Pick the next point, or type a length the cursor's way, a direction and length (N 10'), or @E,N,EL";
      return `PIPE  Pick an open end to continue from it, a pipe to branch from it, or open sheet to start ${spool}`;
    }
    if (tool === "insert") return armed ? `INSERT  ${armed.type.angle ? "Click a 90° elbow for the" : "Click a pipe to place the"} ${armed.type.label}` : "INSERT  Choose a component in the palette";
    if (tool === "measure") return !measure || measure.to ? "MEASURE  Pick the first point" : "MEASURE  Pick the second point";
    if (tool === "move" || tool === "copy") {
      if (transform?.mode === "paste") return "PASTE  Pick the insertion point (a branch on a pipe goes onto it), type an offset, or Enter to paste beside the original";
      const name = tool.toUpperCase(), n = transform?.ids.length ?? selection.length;
      return transform?.base ? `${name}  Pick the second point, or type a distance the cursor's way, N 10' or @E,N,EL` : `${name} ${n} object${n === 1 ? "" : "s"}  Pick the base point, or type an offset (N 1500, @0,0,300)`;
    }
    if (tool === "zoom-window") return "ZOOM  Drag a window around what to see";
    if (tool === "split") return "SPLIT SHEET  Click a pipe where the line goes on to a new sheet, or a weld, flange or fitting to break at · Esc cancels";
    if (tool === "pan") return "PAN  Drag the drawing · Esc returns to Select";
    if (selection.length > 1) return `${selection.length} objects selected · Move (M), Copy (C), Erase (Del), or edit what they share in the properties`;
    if (surface === "paper" && labelsEditable) return "Select a pipe, component or label · drag left to right for a window, right to left for a crossing · double-click a label to edit it";
    return "Select a pipe or component · drag for a window or crossing · type a command";
  })();

  // --- Keyboard --------------------------------------------------------------------------------------------------------
  const keys = (e: KeyboardEvent) => {
    if (dialog || help || editMenu) return;
    if (e.defaultPrevented) return;
    const inField = typing(e.target), ctrl = e.ctrlKey || e.metaKey;
    if (e.key === "F1" || (e.key === "?" && !inField)) { e.preventDefault(); setHelp(true); return; }
    // Drafting aids, as AutoCAD's function keys.
    const aid = ({ F3: "osnap", F7: "grid", F8: "ortho", F9: "snap" } as const)[e.key as "F3"];
    if (aid) { e.preventDefault(); setDrafting({ [aid]: !drafting[aid] }); return; }
    if (e.key === "F2") { e.preventDefault(); commandInput.current?.focus(); return; }
    // In a field with nothing typed since it was filled (a specification cell just committed, a list), undo and redo
    // are the drawing's: the field has no typing of its own to take back.
    const historyKey = ctrl && !e.altKey && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y");
    if (inField && historyKey && untouched(e.target)) { e.preventDefault(); stepHistory(e.shiftKey || e.key.toLowerCase() === "y"); return; }
    if (inField) return;
    if (e.key === "Escape") {
      if (document.fullscreenElement && tool === "select" && !selectionRef.current.length && !selectedLabel && !gesture.current) {
        void document.exitFullscreen().catch(() => undefined);
        return;
      }
      escape();
      return;
    }
    // Undo and redo reach every tab that edits the drawing: specifications, weld map, drawing setup.
    if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); stepHistory(e.shiftKey); return; }
    if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); stepHistory(true); return; }
    if (tab !== "draw" && tab !== "sheet") return;
    // A picked paper label: arrows nudge it (Shift for a larger step), Delete puts it back.
    if (selectedLabelInfo && !selection.length && !ctrl && !e.altKey) {
      const step = (e.shiftKey ? NUDGE_LARGE_MM : NUDGE_MM) * unitsPerMm(doc.paper);
      const arrows: Record<string, Point> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[e.key]) { e.preventDefault(); nudgeLabel(...arrows[e.key]); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); resetLabel(selectedLabelInfo.key, selectedLabelInfo.spool); return; }
    }
    if (ctrl && e.key.toLowerCase() === "a") { e.preventDefault(); selectAll(); return; }
    // On a Mac ⌘C and ⌘V reach the system clipboard (the copy and paste events below); Ctrl+C and Ctrl+V, which
    // fingers trained on Windows reach for, copy and paste through the drawing's own clipboard.
    if (isMac && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (tab === "draw" || tab === "sheet")) {
      const k = e.key.toLowerCase();
      if (k === "c" && selectionRef.current.length) { e.preventDefault(); copyToClipboard(); return; }
      if (k === "v" && clipboard.current) { e.preventDefault(); paste(clipboard.current.clip); return; }
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (!selectionRef.current.length) return;
      e.preventDefault();
      erase();
      return;
    }
    // Selection cycling: Tab picks the next of what was under the last pick, while its pick is still selected.
    const c = cycle.current;
    const onCanvas = e.target === document.body || !!svg.current?.parentElement?.contains(e.target as Node);
    if (e.key === "Tab" && !ctrl && !e.altKey && onCanvas && c && tool === "select" && selectionRef.current.length === 1 && selectionRef.current[0] === c.ids[c.index]) {
      const ids = c.ids.filter((id) => doc.runs.some((r) => r.id === id) || doc.nodes.some((n) => n.id === id));
      if (ids.length > 1) {
        e.preventDefault();
        const index = cycleIndex(Math.max(0, ids.indexOf(c.ids[c.index])), ids.length, e.shiftKey);
        cycle.current = { ids, index };
        pickInCycle(ids[index]);
        cycleNotice(cycle.current);
        return;
      }
    }
    if (e.key === "Enter" && !activates(e.target)) { e.preventDefault(); enter(); return; }
    if (ctrl || e.altKey) return;
    // While a command waits for a point, typing a length, an offset or a direction (N 10', U 600) goes to the
    // command line; the direction letters are not tool shortcuts then.
    const wantsPoint = (tool === "pipe" && (routing || !!start)) || ((tool === "move" || tool === "copy") && !!transform);
    if (wantsPoint && !e.repeat && /^[\d@.'"ENSWUD-]$/i.test(e.key)) {
      e.preventDefault();
      const input = commandInput.current;
      if (input) {
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, e.key);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomCentre(ZOOM_STEP); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomCentre(1 / ZOOM_STEP); return; }
    const letter = e.key.toLowerCase();
    const shortcut: Record<string, Tool> = { v: "select", h: "pan", p: "pipe", i: "insert", m: "move", c: "copy", d: "measure" };
    if (shortcut[letter] && !e.repeat) { e.preventDefault(); activateTool(shortcut[letter]); }
  };
  const keyHandler = useRef(keys);
  keyHandler.current = keys;
  useEffect(() => {
    // Registered once; it reads the latest state through the ref.
    const key = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const spaceHandler = useRef({ enter });
  spaceHandler.current = { enter };
  useEffect(() => {
    // Hold Space to pan with the left button; a tap is Enter. A focused button or field keeps its own Space.
    const ownSpace = (e: KeyboardEvent) => typing(e.target) || activates(e.target) || !!(e.target as HTMLElement)?.closest?.("dialog,[role=menu]");
    let held = false;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || ownSpace(e)) return;
      e.preventDefault();
      if (!e.repeat) spaceUsed.current = false;
      held = true;
      setSpacePan(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tap = held && !spaceUsed.current && !ownSpace(e);
      held = false;
      setSpacePan(false);
      if (tap) spaceHandler.current.enter();
    };
    const blur = () => { held = false; setSpacePan(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const clipHandler = useRef({ copy: copyToClipboard, paste });
  clipHandler.current = { copy: copyToClipboard, paste };
  useEffect(() => {
    // The system clipboard, so pieces paste between drawings and windows; fields keep their own copy and paste.
    const copy = (e: ClipboardEvent) => { if (!typing(e.target) && selectionRef.current.length && (tabRef.current === "draw" || tabRef.current === "sheet")) clipHandler.current.copy(e); };
    const cut = (e: ClipboardEvent) => { if (!typing(e.target) && selectionRef.current.length && tabRef.current === "draw") clipHandler.current.copy(e, true); };
    const pasteEvent = (e: ClipboardEvent) => {
      if (typing(e.target) || (tabRef.current !== "draw" && tabRef.current !== "sheet")) return;
      const clip = readClipboard(e.clipboardData?.getData(CLIPBOARD_MIME) || e.clipboardData?.getData("text/plain") || "");
      if (!clip) return;
      e.preventDefault();
      clipHandler.current.paste(clip);
    };
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", pasteEvent);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", pasteEvent);
    };
  }, []);

  // --- Pointer ------------------------------------------------------------------------------------------------------------
  /** Where a dragged connection would go: along its pipe, on the routing plane, or along an axis with Ortho. */
  const dragDestination = (g: Extract<Gesture, { kind: "node" }>, p: Point): { destination: Vec3; at: Point } => {
    const origin = drawing.project(g.anchor), drawn = drawing.positions.get(g.id) ?? origin;
    const offset: Point = [p[0] - g.point[0], p[1] - g.point[1]];
    if (g.track) {
      // Slide between the points the component cannot pass, as drawn: on a not-to-scale sheet the
      // pipe between them is drawn to its own length, so map the pointer within that span.
      const track = g.track, node = getNode(doc, g.id);
      const host = doc.runs.find((r) => r.id === node.associatedRunId);
      const far = (runId: string) => { const r = doc.runs.find((x) => x.id === runId)!; return r.from === g.id ? r.to : r.from; };
      const [lo, hi] = host ? [host.from, host.to] : [far(track.runIds[0]), far(track.runIds[1])];
      const u = sub(track.to, track.from).map((v) => v / track.length) as Vec3;
      const station = (key: string) => sub(getNode(doc, key).position, track.from).reduce((sum, v, i) => sum + v * u[i], 0);
      const a = drawing.positions.get(lo)!, b = drawing.positions.get(hi)!, sa = station(lo), sb = station(hi);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = ((drawn[0] + offset[0] - a[0]) * dx + (drawn[1] + offset[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
      const margin = 0.0001 * track.length;
      const step = placementStep(doc.units), along = Math.round((sa + (sb - sa) * t) / step) * step;
      const distance = Math.max(Math.max(track.min, Math.min(sa, sb)) + margin, Math.min(Math.min(track.max, Math.max(sa, sb)) - margin, along));
      const k = (distance - sa) / (sb - sa || 1);
      return { destination: track.from.map((v, i) => v + u[i] * distance) as Vec3, at: [a[0] + dx * k, a[1] + dy * k] };
    }
    const target: Point = [origin[0] + offset[0], origin[1] + offset[1]];
    let destination: Vec3, leg: string | undefined;
    const legs = drafting.ortho ? connected(doc, g.id) : [];
    if (legs.length) {
      // With Ortho a connection slides along one of its own pipes, the one the pointer follows: that pipe stretches
      // and the line beyond moves with it, so every turn stays square.
      let best: { run: string; u: Vec3; t: number; residual: number } | null = null;
      for (const r of legs) {
        const far = getNode(doc, r.from === g.id ? r.to : r.from).position, v = sub(far, g.anchor), len = Math.hypot(...v);
        if (len < 1e-6) continue;
        const u = v.map((x) => x / len) as Vec3, q = drawing.project([g.anchor[0] + u[0], g.anchor[1] + u[1], g.anchor[2] + u[2]]);
        const s: Point = [q[0] - origin[0], q[1] - origin[1]], ss = s[0] * s[0] + s[1] * s[1];
        if (ss < 1e-12) continue;
        const t = (offset[0] * s[0] + offset[1] * s[1]) / ss, residual = Math.hypot(offset[0] - t * s[0], offset[1] - t * s[1]);
        if (!best || residual < best.residual) best = { run: r.id, u, t, residual };
      }
      if (best) {
        const t = grid.snap ? Math.round(best.t / grid.spacing) * grid.spacing : best.t;
        destination = g.anchor.map((x, i) => x + best!.u[i] * t) as Vec3;
        leg = best.run;
      } else destination = pickOrthoPoint(drawing, target, g.anchor, grid);
    } else destination = drafting.ortho ? pickOrthoPoint(drawing, target, g.anchor, grid) : pickGridPoint(drawing, target, g.anchor, grid);
    g.leg = leg;
    const moved = drawing.project(destination);
    let at: Point = [drawn[0] + moved[0] - origin[0], drawn[1] + moved[1] - origin[1]];
    // On isometric paper the connection is drawn on the paper's lattice.
    if (paperLattice) at = nearestPaperPoint(at, paperLattice);
    return { destination, at };
  };
  const capture = (e: PointerEvent) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer already left; the gesture still ends on pointerup */ }
  };
  /**
   * A property being typed in is committed before the drawing acts on a press, as leaving the field would: a press on
   * the drawing keeps the focus (it is prevented so a drag does not select text), and the selection it makes would
   * otherwise unmount the field with its edit. The command line keeps its focus while something is typed in it;
   * empty, it lets go, so the single-key shortcuts and Delete work on what the press picks.
   */
  const commitTypedField = () => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !typing(active)) return;
    if (active === commandInput.current) {
      if (!commandInput.current.value) active.blur();
      return;
    }
    flushSync(() => active.blur());
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!ready) return;
    commitTypedField();
    setNotice((n) => (n?.tone === "error" ? null : n));
    lastPickError.current = "";
    const target = e.target as Element, p = sheetAt(e.clientX, e.clientY);
    if (e.button === 1) {
      e.preventDefault();
      const now = performance.now();
      if (now - lastMiddle.current < DOUBLE_CLICK_MS) {
        lastMiddle.current = 0;
        zoomExtents();
        return;
      }
      lastMiddle.current = now;
    }
    // A label moved from its menu is placed by the next click.
    if (gesture.current?.kind === "label" && gesture.current.pointerId == null) { e.preventDefault(); return; }
    if (tool === "pan" || spacePan || e.button === 1 || e.button === 2) {
      // Middle, right, Space or the Pan tool pan; a right press that does not move opens the menu on release.
      e.preventDefault();
      capture(e);
      if (spacePan) spaceUsed.current = true;
      gesture.current = { kind: "pan", pointerId: e.pointerId, x: e.clientX, y: e.clientY, view: viewStore.get().view, moved: false, button: e.button, target };
      return;
    }
    if (e.button !== 0) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (tool === "zoom-window") {
      e.preventDefault();
      capture(e);
      gesture.current = { kind: "box", pointerId: e.pointerId, from: p, additive: false, zoom: true };
      transient.patch({ box: { from: p, to: p, zoom: true } });
      return;
    }
    // A grip on a paper polyline (hose route, continuation route, callout leader): drag it, or a midpoint grip to add a point.
    const pathGrip = target.closest("[data-path]");
    if (pathGrip && tool === "select") {
      const path = editablePaths.find((x) => x.id === pathGrip.getAttribute("data-path"));
      if (path) {
        e.preventDefault();
        capture(e);
        const insert = pathGrip.hasAttribute("data-insert"), index = Number(pathGrip.getAttribute(insert ? "data-insert" : "data-vertex"));
        const points = insert ? [...path.points.slice(0, index), p, ...path.points.slice(index)] : path.points;
        gesture.current = { kind: "vertex", pointerId: e.pointerId, path: path.id, points, index, insert, at: points[index], moved: insert };
        transient.patch({ vertex: { path: points, index, at: points[index] } });
        return;
      }
    }
    // Alt-drag (with Shift: its leader bend or dimension line) is an accelerator; the same moves are in the menus.
    const label = labelsEditable ? pickLabel(paperLabels, target, selectedLabel?.key, e.ctrlKey || e.metaKey, true) : undefined;
    if (e.altKey && !spacePan && labelsEditable && label && (label.spool || !multiSpool)) {
      const bend = e.shiftKey && !label.dimension && label.leader ? bendHandle(label) : undefined;
      if (e.shiftKey && !label.dimension && !bend) return;
      e.preventDefault();
      capture(e);
      const at = bend ?? label.at;
      gesture.current = { kind: "label", pointerId: e.pointerId, drag: { key: bend ? `leader:${label.key}` : label.key, spool: label.spool, point: p, at, destination: [...at], label: label.key, bend: !!bend, ...(e.shiftKey && label.dimension ? { dimension: label.dimension } : {}) } };
      return;
    }
    // The Select tool picks a paper label on its own and drags it straight away; its leader follows.
    if (!e.altKey && !spacePan && tool === "select" && labelsEditable) {
      const bend = target.closest("[data-leader-handle]") && selectedLabelInfo ? bendHandle(selectedLabelInfo) : undefined;
      if (bend && selectedLabelInfo) {
        e.preventDefault();
        capture(e);
        gesture.current = { kind: "label", pointerId: e.pointerId, drag: { key: `leader:${selectedLabelInfo.key}`, spool: selectedLabelInfo.spool, point: p, at: bend, destination: [...bend], label: selectedLabelInfo.key, bend: true } };
        return;
      }
      if (label && (label.spool || !multiSpool)) {
        e.preventDefault();
        setSelection([]);
        // Pressing a line inside the picked callout drags the callout; a click without moving drills in.
        let picked = label;
        for (let up = label.parent && paperLabels.get(label.parent); up && !(e.ctrlKey || e.metaKey); up = up.parent ? paperLabels.get(up.parent) : undefined)
          if (up.key === selectedLabel?.key) { picked = up; break; }
        setSelectedLabel({ key: picked.key, spool: picked.spool });
        const dimension = e.shiftKey && picked.dimension ? picked.dimension : undefined;
        gesture.current = { kind: "label", pointerId: e.pointerId, drag: { key: picked.key, spool: picked.spool, point: p, at: picked.at, destination: [...picked.at], label: picked.key,
          ...(dimension ? { dimension } : {}), ...(picked !== label ? { drill: { key: label.key, spool: label.spool } } : {}) } };
        return;
      }
    }
    if (!label) setSelectedLabel(null);
    const owner = target.closest("[data-owner]")?.getAttribute("data-owner");
    let node = target.closest("[data-node]")?.getAttribute("data-node") ?? doc.nodes.find((n) => n.id === owner)?.id;
    // A press on a short pipe between two fittings is on the pipe, though their pick circles cover it: it drags
    // the connection only where the connection is what the click would pick.
    if ((tool === "select" || (tool === "insert" && !armed)) && !spacePan) {
      const stack = pickStack(e.clientX, e.clientY, target);
      if (stack) node = stack[0] && doc.nodes.some((n) => n.id === stack[0]) ? stack[0] : undefined;
    }
    // A sheet callout is dragged where it is pressed, as a label is.
    const note = tool === "select" && !spacePan && owner ? doc.sheetNotes?.find((n) => n.id === owner) : undefined;
    if (note && surface === "paper") {
      e.preventDefault();
      capture(e);
      gesture.current = { kind: "note", pointerId: e.pointerId, x: e.clientX, y: e.clientY, id: note.id, point: p, offset: [0, 0], moved: false, additive };
      if (!additive) setSelection([note.id]);
      return;
    }
    if (!spacePan && (tool === "select" || (tool === "insert" && !armed)) && node) {
      e.preventDefault();
      capture(e);
      // The latest document: a field committed by this press may have just changed it.
      const position = getNode(latest.current, node).position;
      gesture.current = { kind: "node", pointerId: e.pointerId, x: e.clientX, y: e.clientY, id: node, point: p, anchor: [...position], destination: [...position], moved: false, track: componentTrack(latest.current, node), additive };
      if (!additive && !selectionRef.current.includes(node)) selectConnection(node);
      return;
    }
    if (tool === "select") {
      gesture.current = { kind: "press", pointerId: e.pointerId, x: e.clientX, y: e.clientY, from: p, additive, target };
      return;
    }
    gesture.current = { kind: "click", pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current, p = sheetAt(e.clientX, e.clientY);
    if (g?.kind === "pan") {
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_PX) return;
      g.moved = true;
      viewStore.patch({ view: panScreen(frame, g.view, viewStore.get().screen, dx, dy) });
      return;
    }
    if (g?.kind === "press") {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_PX) return;
      capture(e);
      gesture.current = { kind: "box", pointerId: g.pointerId, from: g.from, additive: g.additive, zoom: false };
      transient.patch({ box: { from: g.from, to: p }, hoverLabel: null });
      return;
    }
    if (g?.kind === "box") return transient.patch({ box: { from: g.from, to: p, zoom: g.zoom } });
    if (g?.kind === "click") {
      // A left drag in a drawing command pans, as before; a click stays a click.
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < PAN_PX) return;
      capture(e);
      gesture.current = { kind: "pan", pointerId: g.pointerId, x: g.x, y: g.y, view: viewStore.get().view, moved: true, button: 0, target: e.target as Element };
      transient.patch({ insertHover: null, cursor: null, snap: null });
      return;
    }
    if (g?.kind === "label") {
      const state = g.drag;
      state.destination = [state.at[0] + p[0] - state.point[0], state.at[1] + p[1] - state.point[1]];
      if (state.dimension) {
        const u = state.dimension.axis, delta = (p[0] - state.point[0]) * u[0] + (p[1] - state.point[1]) * u[1];
        state.destination = [state.at[0] + u[0] * delta, state.at[1] + u[1] * delta];
      }
      // A press moves its label once the pointer travels a few screen pixels, so a click only picks it.
      state.moved ||= Math.hypot(p[0] - state.point[0], p[1] - state.point[1]) * scale() >= DRAG_PX;
      if (state.moved) transient.patch({ labelPreview: state.destination });
      return;
    }
    if (g?.kind === "node") {
      try {
        const { destination, at } = dragDestination(g, p);
        g.destination = destination;
        g.moved ||= Math.hypot(e.clientX - g.x, e.clientY - g.y) >= DRAG_PX;
        if (g.moved) transient.patch({ drag: { id: g.id, destination, at, leg: g.leg } });
      } catch (err) {
        showPickError(err);
      }
      return;
    }
    if (g?.kind === "note") {
      g.moved ||= Math.hypot(e.clientX - g.x, e.clientY - g.y) >= DRAG_PX;
      g.offset = [p[0] - g.point[0], p[1] - g.point[1]];
      if (g.moved) transient.patch({ shift: { owner: g.id, offset: g.offset } });
      return;
    }
    if (g?.kind === "vertex") {
      g.at = paperLattice ? nearestPaperPoint(p, paperLattice) : p;
      g.moved ||= Math.hypot(...(sub([...g.at, 0], [...g.points[g.index], 0]).slice(0, 2) as [number, number])) * scale() >= DRAG_PX;
      transient.patch({ vertex: { path: g.points, index: g.index, at: g.at } });
      return;
    }
    // Nothing held: hover and the command's preview.
    const target = e.target as Element;
    const over = labelsEditable && tool === "select" && !spacePan ? pickLabel(paperLabels, target, selectedLabel?.key, e.ctrlKey || e.metaKey, true)?.key ?? null : null;
    const patch: Partial<Transient> = { sheet: p, hoverLabel: over };
    if (armed && tool === "insert") {
      const hit = armed.type.angle ? null : insertionTarget(e.clientX, e.clientY, target.closest("[data-owner]")?.getAttribute("data-owner") ?? "");
      patch.insertHover = hit && snapHit(hit);
    } else if (tool === "split") {
      const branch = !target.closest("[data-node]") ? branchTarget(e.clientX, e.clientY) : null;
      patch.insertHover = branch && snapHit(branch);
      patch.snap = null;
      patch.cursor = null;
    } else if (tool === "pipe" || tool === "measure" || tool === "move" || tool === "copy") {
      const snap = snapAt(p);
      patch.snap = snap;
      // Over a pipe, a Pipe-tool click branches from it: show where the tee goes instead of a route.
      const branch = tool === "pipe" && !snap && !target.closest("[data-node]") ? branchTarget(e.clientX, e.clientY) : null;
      patch.insertHover = branch && snapHit(branch);
      try {
        const from = tool === "pipe" ? anchor : tool === "measure" ? (measure && !measure.to ? measure.from : gridOrigin) : transform?.base ?? gridOrigin;
        const ortho = tool === "pipe" ? routing && grid.ortho !== false : (tool === "measure" ? !!measure && !measure.to : !!transform?.base) && grid.ortho !== false;
        patch.cursor = pickFor(p, snap, from, ortho);
        lastPickError.current = "";
      } catch (err) {
        patch.cursor = null;
        showPickError(err);
      }
    } else {
      patch.snap = null;
      patch.cursor = null;
      patch.insertHover = null;
    }
    transient.patch(patch);
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (g?.kind === "label" && g.pointerId == null) {
      // A label moved from its menu goes where it is clicked.
      if (e.button !== 0) return;
      gesture.current = null;
      transient.patch({ labelPreview: null });
      setNotice(null);
      return void placeLabel(g.drag);
    }
    gesture.current = null;
    if (g && "pointerId" in g && g.pointerId != null && e.currentTarget.hasPointerCapture(g.pointerId)) e.currentTarget.releasePointerCapture(g.pointerId);
    if (!g) return;
    switch (g.kind) {
      case "pan":
        if (g.button === 2 && !g.moved) showEditMenu(g.target, e.clientX, e.clientY);
        return;
      case "press":
        return place(e.clientX, e.clientY, g.target, g.additive);
      case "click":
        if (!armed && (e.target as Element).closest("[data-length]") && e.detail >= 2) return;
        return place(e.clientX, e.clientY, e.target as Element, false);
      case "box": {
        transient.patch({ box: null });
        const to = sheetAt(e.clientX, e.clientY), box = normaliseBox(g.from, to);
        if (g.zoom) {
          if ((box[2] - box[0]) * scale() >= DRAG_PX && (box[3] - box[1]) * scale() >= DRAG_PX) setView2(fitView(frame, viewStore.get().screen, box, 0));
          activateTool("select");
          return;
        }
        const ids = pickInBox(selectableItems, box, boxMode(g.from, to));
        setSelectedLabel(null);
        setSelection(g.additive ? clickSelect(selectionRef.current, ids, "add") : ids);
        return;
      }
      case "label": {
        transient.patch({ labelPreview: null });
        if (!g.drag.moved && g.drag.drill) setSelectedLabel(g.drag.drill);
        if (g.drag.moved) placeLabel(g.drag);
        return;
      }
      case "node": {
        transient.patch({ drag: null });
        if (!g.moved) {
          if (g.additive) setSelection(clickSelect(selectionRef.current, [g.id], "toggle"));
          else if (selectionRef.current.length > 1 || selectionRef.current[0] !== g.id) selectConnection(g.id);
          return;
        }
        commit((d) => {
          if (g.track) {
            moveComponentAlongPipe(d, g.id, Math.hypot(...sub(g.destination, g.track.from)));
            snapNearFace(d, g.id);
            return;
          }
          if (g.leg) {
            stretchLeg(d, g.leg, g.id, sub(g.destination, g.anchor));
            return;
          }
          getNode(d, g.id).position = g.destination;
          setAutoFitting(d, g.id);
          for (const r of connected(d, g.id)) {
            setAutoFitting(d, r.from);
            setAutoFitting(d, r.to);
          }
        });
        return;
      }
      case "note": {
        transient.patch({ shift: null });
        if (!g.moved) {
          if (g.additive) setSelection(clickSelect(selectionRef.current, [g.id], "toggle"));
          return;
        }
        const [dx, dy] = g.offset;
        commit((d) => {
          const n = d.sheetNotes?.find((x) => x.id === g.id);
          if (!n) return;
          n.at = [round(n.at[0] + dx, 2), round(n.at[1] + dy, 2)];
          if (n.box) n.box = { ...n.box, at: [round(n.box.at[0] + dx, 2), round(n.box.at[1] + dy, 2)] };
          // The leader's tip stays on what it points at; the rest comes with the lettering.
          if (n.leader) n.leader = n.leader.map((q, i) => (i ? [round(q[0] + dx, 2), round(q[1] + dy, 2)] : q));
        });
        return;
      }
      case "vertex": {
        transient.patch({ vertex: null });
        if (!g.moved) return;
        const path = editablePaths.find((x) => x.id === g.path);
        const points = g.points.map((q, i) => (i === g.index ? g.at : q)).map(([x, y]) => [round(x, 2), round(y, 2)] as [number, number]);
        path?.commit(points);
        return;
      }
    }
  };
  const placeLabel = (state: LabelDrag) => {
    if (Math.hypot(state.destination[0] - state.at[0], state.destination[1] - state.at[1]) <= 0.5) return;
    commit((d) => {
      const info = ((d.sheets ??= {})[state.spool] ??= {});
      if (state.dimension) {
        const u = state.dimension.axis, delta = (state.destination[0] - state.at[0]) * u[0] + (state.destination[1] - state.at[1]) * u[1];
        const layout = ((info.dimensionLayout ??= {})[state.key] ??= {});
        layout.offset = state.dimension.offset + delta;
        const held = info.labelPositions?.[state.key];
        if (held) info.labelPositions![state.key] = [held[0] + u[0] * delta, held[1] + u[1] * delta];
      } else (info.labelPositions ??= {})[state.key] = state.destination;
    });
  };
  const onPointerCancel = () => {
    cancelGesture();
    transient.patch({ cursor: null, insertHover: null, snap: null });
  };

  /**
   * Paper polylines edited by their grips: a selected hose's route, an open end's continuation route, a sheet
   * callout's leader. Each grip drags a point; a midpoint grip adds one.
   */
  const editablePaths = useMemo(() => {
    const paths: Array<{ id: string; points: Point[]; commit: (points: Array<[number, number]>) => void }> = [];
    if (surface !== "paper" || view !== "iso") return paths;
    if (selectedNode?.hosePath?.length) paths.push({ id: "hose", points: selectedNode.hosePath, commit: (points) => commit((d) => { getNode(d, selectedNode.id).hosePath = points; }) });
    if (selectedNode?.continuation?.paperPath?.length) paths.push({ id: "continuation", points: selectedNode.continuation.paperPath,
      commit: (points) => commit((d) => { const n = getNode(d, selectedNode.id); n.continuation = { ...n.continuation!, paperPath: points }; }) });
    if (selectedNote?.leader?.length) paths.push({ id: "leader", points: selectedNote.leader,
      commit: (points) => commit((d) => { const n = d.sheetNotes?.find((x) => x.id === selectedNote.id); if (n) n.leader = points; }) });
    return paths;
  }, [surface, view, selectedNode, selectedNote]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Render ------------------------------------------------------------------------------------------------------------
  const ends = useMemo(() => (selectedRun ? [selectedRun.from, selectedRun.to].map((key) => drawing.positions.get(key)).filter((p): p is Point => !!p) : []), [selectedRun, drawing]);
  const nodeGrips = useMemo(() => selection.map((key) => (doc.nodes.some((n) => n.id === key) ? drawing.positions.get(key) : undefined)).filter((p): p is Point => !!p), [selection, doc.nodes, drawing]);
  const routeAnchor = tool === "pipe" && !pending && start ? drawing.positions.get(start) ?? null : null;
  const statusLabel = persistence.status === "error" ? "Save failed"
    : persistence.status === "opening" ? "Opening…"
      : persistence.status === "saving" ? "Saving…"
        : persistence.status === "unsaved" ? (target === "disk" ? "Unsaved changes · recovery copy kept" : "Unsaved changes")
          : target === "browser" ? "Saved in this browser" : "Saved";
  const saveLabel = target === "browser" ? "Save in browser" : "Save";
  const saveTitle = persistence.error || (target === "disk" ? `Save to ${fileName} (${KEYS.save})` : target === "browser" ? `Keep in this browser's drawings (${KEYS.save}). Save to disk writes a file.` : `Save (${KEYS.save})`);
  const overrides = useMemo(() => overrideCount(doc), [doc]);
  const sheetSpool = filter || (doc.runs.some((r) => r.spool === spool) ? spool : doc.runs[0]?.spool ?? spool);
  const inspectorBody = (() => {
    if (tab === "sheet") return (
      <>
        <SheetSettings doc={doc} drawing={drawing} commit={commit} onError={setError} spool={sheetSpool} selectedNodeId={selectedNode?.id}
          onSelectNote={(key) => { setSelection([key]); setTab("draw"); setSurface("paper"); }}
          onUnitsChange={(units, previous) => {
            try { setSpan(lengthInputValue(parseLength(span, previous), units)); }
            catch { setSpan(lengthInputValue(DEFAULT_ROUTE_BLOCKS * defaultBlockSpacing(units), units)); }
            // A block still at the old units' default takes the new units' (100 mm becomes 1'-0"), so the grid keeps
            // stepping in round lengths of the units drawn in.
            if (Math.abs(drafting.spacing - defaultBlockSpacing(previous)) < 1e-6) setBlock(defaultBlockSpacing(units));
          }} />
        <ProfileSettings doc={doc} commit={commit} onError={setError} />
        <ExportSettings onError={setError} />
        <InspectorSectionKit id="sheet.output" title="Grid, scale & PDF views" defaultOpen summary={(doc.outputViews ?? ["iso"]).join(", ")}>
          {sheetStyle.layout === "schematic" && (
            <KitRow label="Isometric paper" keywords="grid lattice cell paper snap" group hint="Not to scale, every leg is drafted in whole cells of this lattice, measured on the printed sheet.">
              <Segmented aria="Isometric paper cell" value={String(sheetStyle.paperGrid ?? DEFAULT_PAPER_CELL_IN)}
                onChange={(v) => commit((d) => { d.style = { ...styleOf(d), paperGrid: Number(v) === DEFAULT_PAPER_CELL_IN ? undefined : Number(v) }; })}
                choices={[0.125, 0.1875, 0.25, 0.375].map((v) => ({ value: String(v), label: ({ 0.125: "⅛″", 0.1875: "³⁄₁₆″", 0.25: "¼″", 0.375: "⅜″" } as Record<number, string>)[v] }))} />
            </KitRow>
          )}
          <KitRow label={sheetStyle.layout === "schematic" ? "One paper cell routes" : "Grid block"} keywords="block grid snap model isometric scale routing"
            hint={sheetStyle.layout === "schematic"
              ? "The routing scale: each cell of the isometric paper is this length of pipe, and Snap steps a cell at a time. Dimensions always give the true lengths."
              : "Each block of the grid is this centreline length, and Snap steps by it."}>
            <LengthInput aria="Grid block length" mm={drafting.spacing} units={doc.units} positive onError={setError} onCommit={(spacing) => { if (spacing) setBlock(spacing); }} />
          </KitRow>
          {sheetStyle.layout === "scale" && (
            <KitRow label="Drawing scale" keywords="scale ratio to scale fit" hint="Automatic draws at the largest standard scale the drawing fits at.">
              <select aria-label="Drawing scale" value={String(sheetStyle.scale ?? "")}
                onChange={(e) => commit((d) => { d.style = { ...styleOf(d), scale: e.target.value ? Number(e.target.value) : undefined }; })}>
                <option value="">Automatic (fit the sheet)</option>
                {standardScales(doc.units).map(([n, label]) => <option key={n} value={n}>{label}</option>)}
              </select>
            </KitRow>
          )}
          {VIEWS.map((v) => (
            <Toggle key={v.value} label={`${v.label} PDF sheet`} aria={`${v.label} PDF sheet`} checked={(doc.outputViews ?? ["iso"]).includes(v.value)}
              onChange={(on) => commit((d) => { d.outputViews = on ? [...(d.outputViews ?? ["iso"]), v.value] : (d.outputViews ?? ["iso"]).filter((x) => x !== v.value); })} />
          ))}
        </InspectorSectionKit>
      </>
    );
    const routingSections = (idle?: boolean) => (
      <RoutingSections doc={doc} spool={spool} spools={spools} setSpool={setSpool} line={line} setLine={setLine} start={start} selectConnection={selectConnection} route={add} onError={setError} idle={idle} />
    );
    if (selection.length > 1) return <MultiPanel doc={doc} ids={selection} commit={commit} onError={setError} library={library} libraryError={libraryError} specBusy={specBusy} onSelect={setSelection} />;
    if (selectedRun) return (
      <PipePanel key={selectedRun.id} doc={doc} run={selectedRun} commit={commit} onError={setError} library={library} libraryError={libraryError}
        specBusy={specBusy} chooseSpec={(value, runId) => void chooseSpec(value, runId)} extra={routingSections()} />
    );
    if (selectedNode) return (
      <NodePanel key={selectedNode.id} doc={doc} node={selectedNode} commit={commit} onError={setError}
        track={selectedTrack} faces={selectedFaces} turn={selectedTurn} header={selectedHeader}
        fallback={{ specId: activeSpec?.id ?? "", nps }} missingTakeout={missingTakeoutNodes.some((n) => n.id === selectedNode.id)}
        sheetPoint={surface === "paper" && view === "iso" ? drawing.positions.get(selectedNode.id) : undefined}
        extra={routingSections()} />
    );
    if (selectedNote) return <NotePanel key={selectedNote.id} doc={doc} note={selectedNote} commit={commit} onError={setError} />;
    if (pickedLabel) {
      const owner = pickedLabel.owner && (doc.runs.some((r) => r.id === pickedLabel.owner) || doc.nodes.some((n) => n.id === pickedLabel.owner)) ? pickedLabel.owner : undefined;
      return (
        <LabelPanel key={pickedLabel.key} doc={doc} label={pickedLabel} commit={commit} onError={setError}
          reset={(bend) => resetLabel(pickedLabel.key, pickedLabel.spool, bend)} resetLeader={() => resetLeader(pickedLabel.key, pickedLabel.spool)}
          resetDimension={() => resetDimension(pickedLabel.key, pickedLabel.spool)}
          selectOwner={owner ? () => { setSelectedLabel(null); if (doc.nodes.some((n) => n.id === owner)) selectConnection(owner); else setSelection([owner]); } : undefined}
          cleared={clearedSpots(pickedLabel.spool)} keepCleared={() => keepClearedSpots(pickedLabel.spool)} resetSheet={() => resetSheetLabels(pickedLabel.spool)} />
      );
    }
    return routingSections(true);
  })();
  const identity = tab === "sheet"
    ? { glyph: <FileText size={17} />, title: "Drawing setup", subtitle: overrides ? `${overrides} override${overrides === 1 ? "" : "s"} active · see Overrides` : "Sheet, title block, scale and output",
        actions: overrides ? <span className="insp-badge" title="This drawing holds parts of its sheets as issued: see Overrides and Material table">{overrides} override{overrides === 1 ? "" : "s"}</span> : undefined }
    : selection.length > 1
      ? { glyph: <Layers size={17} />, title: `${selection.length} objects`, subtitle: [`${selection.filter((k) => doc.runs.some((r) => r.id === k)).length} pipes`, `${selection.filter((k) => doc.nodes.some((n) => n.id === k)).length} components`].join(" · ") }
      : selectedRun
        ? {
            glyph: <Ruler size={17} />,
            title: `${sizeFor(doc, selectedRun.nps)} ${selectedRun.connector ? "connector" : "pipe"}`,
            subtitle: [getSpec(doc, selectedRun.specId).name, selectedRun.spool, selectedRun.line].filter(Boolean).join(" · "),
            actions: (
              <>
                {!selectedRun.connector && (
                  <button type="button" className="is-primary" onClick={() => {
                    const leg = pipeLeg(doc, primary), at = leg && legPoint(doc, primary, leg.length * fraction / 100);
                    startBranch(at ?? { runId: primary, fraction: 0.5 });
                  }}><GitBranch size={13} /> Branch</button>
                )}
                <button type="button" onClick={() => activateTool("insert")}><Plus size={13} /> Insert component</button>
              </>
            ),
          }
        : selectedNode
          ? {
              glyph: <ComponentGlyph code={selectedNode.component ?? ""} kind={selectedNode.kind} size={24} />,
              title: componentName(selectedNode),
              subtitle: [selectedHeader && sizeFor(doc, selectedHeader.nps), selectedNode.tag, selectedNode.description || nodeItem(doc, selectedNode)?.description].filter(Boolean).join(" · "),
              actions: canRouteFrom(doc, selectedNode.id) ? (
                // Only a connection with a free end can be routed from; an in-line valve has none.
                <button type="button" className="is-primary" onClick={() => { selectConnection(primary); setPending(null); setTool("pipe"); lastCommand.current = "pipe"; }}>
                  <MoveUpRight size={13} />
                  {selectedNode.kind === "olet" || (selectedNode.kind === "tee" && selectedEdges.length === 2) ? "Route the branch" : selectedEdges.length > 1 ? "Branch here" : "Continue from here"}
                </button>
              ) : undefined,
            }
          : selectedNote
            ? { glyph: <Type size={17} />, title: "Sheet callout", subtitle: [selectedNote.text.split("\n")[0], selectedNote.spool].filter(Boolean).join(" · ") }
            : pickedLabel
              ? { glyph: <Type size={17} />, title: labelKind(pickedLabel), subtitle: [labelOwnerName(doc, pickedLabel) && "of " + labelOwnerName(doc, pickedLabel), pickedLabel.spool].filter(Boolean).join(" · ") }
              : { glyph: <MoveUpRight size={17} />, title: "Routing", subtitle: "Nothing selected · click or right-click the drawing" };
  const svgClass = cn("iso-sheet", surface === "grid" && "model-space", ["pipe", "measure", "move", "copy", "zoom-window"].includes(tool) && "routing",
    (tool === "pan" || spacePan) && "panning", armed && tool === "insert" && "placing", labelsEditable && tool === "select" && !spacePan && "labels-editable");

  return (
    <section className="iso-editor" aria-label="Piping isometric editor">
      {editMenu && <EditContextMenu x={editMenu.x} y={editMenu.y} title={editMenu.title} items={editMenu.items} onClose={closeEditMenu} />}
      {dialog && <EditorDialog request={dialog} />}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
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
            <span role={persistence.status === "error" ? "alert" : "status"} className={cn("iso-save-status", persistence.status === "error" && "error", persistence.status === "unsaved" && "unsaved")}
              title={persistence.error || (target === "disk" && persistence.status === "unsaved" ? "Your edits are kept in a recovery copy; Save writes them to the file." : undefined)}>
              {persistence.status === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {statusLabel}
            </span>
            <button onClick={() => void persistence.save().catch(() => undefined)} title={saveTitle} disabled={!ready}>
              <Save size={15} /> {saveLabel}
            </button>
            {headerActions}
            <button aria-label="Keyboard shortcuts" title="Keyboard shortcuts (F1)" onClick={() => setHelp(true)}><Keyboard size={16} /></button>
            <button aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
              aria-pressed={fullscreen} disabled={!document.fullscreenEnabled} onClick={() => void toggleFullscreen()}>
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </header>
      )}
      <div className="iso-ribbon-tabs" role="tablist" aria-label="Isometric ribbon">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={cn(tab === key && "active")} onClick={() => setTab(key)}>{label}</button>
        ))}
        <span className="iso-ribbon-spacer" />
        {tab !== "draw" && (
          // The Draw ribbon has Undo and Redo; the other tabs edit the drawing too.
          <>
            <button aria-label="Undo" title={`Undo (${KEYS.undo})`} disabled={!counts.undo} onClick={() => stepHistory()}><Undo2 size={14} /></button>
            <button aria-label="Redo" title={`Redo (${KEYS.redo})`} disabled={!counts.redo} onClick={() => stepHistory(true)}><Redo2 size={14} /></button>
          </>
        )}
        <button title="Import a PCF (with its .piping sidecar, or the PCF ZIP), piping JSON or legacy DXF in place of this drawing" onClick={() => importInput.current?.click()}>
          <Upload size={14} /> Import
        </button>
        <MenuButton className="iso-export-menu" label="Export" title="Export the drawing, its schedules or its data"
          items={EXPORTS.map(({ format, label }) => ({ label, disabled: !!busy || !ready, action: () => void runExport(format) }))}>
          <Download size={14} /> Export <ChevronDown size={12} />
        </MenuButton>
      </div>
      {tab === "draw" && (
        <div className="iso-ribbon">
          <div className="iso-ribbon-group">
            <div className="iso-ribbon-tools">
              <ToolButton name="Select" icon={MousePointer2} shortcut="V" active={tool === "select"} onClick={() => activateTool("select")} />
              <ToolButton name="Pan" icon={Hand} shortcut="H" active={tool === "pan"} onClick={() => activateTool("pan")} />
              <ToolButton name="Pipe" icon={MoveUpRight} shortcut="P" active={tool === "pipe"} onClick={() => activateTool("pipe")} />
              <ToolButton name="Insert" icon={Plus} shortcut="I" active={tool === "insert"} onClick={() => activateTool("insert")} />
            </div>
            <small>Draw</small>
          </div>
          <div className="iso-ribbon-group">
            <div className="iso-ribbon-controls">
              <RibbonField label="Specification">
                <SpecSelect doc={doc} aria="Pipe specification" value={spec} library={library} libraryError={libraryError} busy={specBusy} onChange={(v) => void chooseSpec(v)} />
              </RibbonField>
              <RibbonField label={sizeHeader(doc)}>
                <select aria-label="Pipe nominal size" value={nps} onChange={(e) => setNps(Number(e.target.value))}
                  title={activeSizes.listed ? undefined : `Specification ${activeSpec?.name ?? ""} lists no pipe sizes, so the sizes its pipes are drawn at are offered. Add its sizes under Specifications for their outside diameters, walls and weights.`}>
                  {activeSizes.sizes.map((size) => <option value={size} key={size}>{sizeFor(doc, size)}{activeSizes.listed ? "" : " (not in spec)"}</option>)}
                </select>
              </RibbonField>
              <RibbonField label={"Length · " + (doc.units === "mm" ? "mm" : "ft / in")}>
                <input aria-label="Measured pipe length" value={span} placeholder={lengthInputValue(DEFAULT_ROUTE_BLOCKS * defaultBlockSpacing(doc.units), doc.units)}
                  title={'Feet and inches or millimetres, for example 10\', 2\' 3 1/2", 12 in, or 1000 mm.'} onChange={(e) => setSpan(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }} />
              </RibbonField>
              <RibbonField label="Preparation">
                <select aria-label="Routing end preparation" value={routingPrep} onChange={(e) => setRoutingPrep(e.target.value as EndPrep)}>
                  {END_PREPS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </RibbonField>
            </div>
            <small>Measured routing</small>
          </div>
          <div className="iso-ribbon-group">
            <div className="iso-ribbon-controls">
              <RibbonField label="Sheet · spool">
                <SpoolInput aria="Active spool" value={spool} spools={spools} onChange={setSpool} />
              </RibbonField>
              <ToolButton name="New sheet" icon={Plus} onClick={newSpool} />
              <ToolButton name="Split sheet" icon={Scissors} active={tool === "split"} onClick={() => activateTool(tool === "split" ? "select" : "split")} />
              <ToolButton name="Finish run" icon={CircleStop} shortcut="Enter" disabled={!start && !pending} onClick={finishRun} />
            </div>
            <small>Sheets</small>
          </div>
          <div className="iso-ribbon-group">
            <div className="iso-axis-buttons">
              {RIBBON_DIRECTIONS.map(({ name, vector }) => {
                const Icon = ICONS[name];
                return (
                  <button key={name} aria-label={"Route " + name} disabled={!ready} title={`Route ${name.toLowerCase()} by the entered length (or type ${name[0]} and a length)`}
                    onClick={() => {
                      try {
                        const distance = parseLength(span, doc.units);
                        add(vector.map((v) => v * distance) as Vec3);
                      } catch (e) {
                        setError(message(e));
                      }
                    }}>
                    <Icon size={17} />
                    {name}
                  </button>
                );
              })}
            </div>
            <small>From selected connection</small>
          </div>
          <div className="iso-ribbon-group">
            <div className="iso-ribbon-tools">
              <ToolButton name="Move" icon={Move} shortcut="M" active={tool === "move"} disabled={!selection.length} onClick={() => activateTool("move")} />
              <ToolButton name="Copy" icon={Copy} shortcut="C" active={tool === "copy"} disabled={!selection.length} onClick={() => activateTool("copy")} />
              <ToolButton name="Erase" icon={Trash2} shortcut="Del" disabled={!selection.length} onClick={() => erase()} />
              <ToolButton name="Measure" icon={Ruler} shortcut="D" active={tool === "measure"} onClick={() => activateTool("measure")} />
            </div>
            <small>Modify</small>
          </div>
          <div className="iso-ribbon-group">
            <div className="iso-ribbon-tools">
              <ToolButton name="Undo" icon={Undo2} shortcut={KEYS.undo} disabled={!counts.undo} onClick={() => stepHistory()} />
              <ToolButton name="Redo" icon={Redo2} shortcut={KEYS.redo} disabled={!counts.redo} onClick={() => stepHistory(true)} />
            </div>
            <small>Edit</small>
          </div>
        </div>
      )}
      {(error || persistence.error) && (
        <div className="iso-alert" role="alert">
          {error || persistence.error}
          <button aria-label="Dismiss error" onClick={() => setAlert(null)}><X size={13} /></button>
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
                <RibbonField label={armed.type.kind === "reducer" ? "Size · reduce or expand" : armed.type.kind === "olet" ? "Header × branch" : "Run × branch"}>
                  <select aria-label="Component size" value={armed.row?.id ?? ""}
                    onChange={(e) => setArmed({ type: armed.type, row: armedChoices.find((c) => c.row.id === e.target.value)?.row })}>
                    {armedChoices.map((c) => <option key={c.row.id} value={c.row.id}>{sizeLabel(armed.type, c, paletteNps)}</option>)}
                  </select>
                </RibbonField>
              )}
              {armed && selectedRun && !selectedRun.connector && (() => {
                const overall = pipeLeg(doc, selectedRun.id)?.length ?? 0;
                return (
                  <>
                    <RibbonField label="Centre from start of straight">
                      <LengthInput aria="Component distance from pipe start" mm={overall * fraction / 100} units={doc.units} positive onError={setError}
                        onCommit={(distance) => {
                          if (distance == null || distance >= overall) { setError("Position must be between the ends of the straight pipe."); return false; }
                          setFraction((100 * distance) / overall);
                        }} />
                    </RibbonField>
                    <button className="iso-primary" onClick={() => {
                      const at = legPoint(doc, selectedRun.id, overall * fraction / 100);
                      if (at) insertFitting(at.runId, armed.type, armed.row, at.fraction);
                      else setError("Position must be between the ends of the straight pipe.");
                    }}>Place at this distance</button>
                  </>
                );
              })()}
            </div>
            {paletteSpec && <ComponentPalette spec={paletteSpec} nps={paletteNps} armed={armed ? { code: armed.type.code, rowId: armed.row?.id } : undefined} onInsert={chooseComponent} />}
          </aside>
        )}
        {["draw", "sheet"].includes(tab) && (
          <>
            <div ref={stage} className={cn("iso-stage", surface === "grid" && "iso-stage-grid")}>
              <div className="iso-view-controls">
                <div className="iso-segment">
                  <button className={cn(surface === "paper" && "active")} onClick={() => setSurface("paper")}><FileText size={14} /> Paper</button>
                  <button className={cn(surface === "grid" && "active")} onClick={() => { setSurface("grid"); setView("iso"); }}><Grid3X3 size={14} /> Model space</button>
                </div>
                <select aria-label="Drawing view" value={view} disabled={surface === "grid"} onChange={(e) => setView(e.target.value as Drawing["view"])}>
                  {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
                <select aria-label="Sheet scale" value={sheetStyle.layout} disabled={surface === "grid"} title={SCALES.find((s) => s.value === sheetStyle.layout)?.title}
                  onChange={(e) => commit((d) => { d.style = { ...styleOf(d), layout: e.target.value as "scale" | "schematic" }; })}>
                  {SCALES.map((s) => <option key={s.value} value={s.value} title={s.title}>{s.label}</option>)}
                </select>
                <select aria-label="Visible spool" value={filter} title="Each spool is issued on a sheet of its own" onChange={(e) => setFilter(e.target.value)}>
                  <option value="">All sheets</option>
                  {[...new Set([...doc.runs.map((r) => r.spool), ...(filter ? [filter] : [])])].map((s, i) => <option key={s} value={s}>{`Sheet ${i + 1} · ${s}`}</option>)}
                </select>
                {sheetKinds.length > 1 && (
                  <select aria-label="Sheet" value={shownSheet} title="This spool is issued on more than one sheet: its drawing, then its material list"
                    onChange={(e) => setSheetKind(e.target.value as SheetKind)}>
                    {sheetKinds.map((k, i) => <option key={k} value={k}>{`Sheet ${(drawing.sheet?.number != null ? drawing.sheet.number - drawing.sheet.index : 1) + i} · ${k === "materials" ? "Material list" : "Drawing"}`}</option>)}
                  </select>
                )}
                <button className="iso-properties-toggle" aria-label="Toggle properties panel" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((v) => !v)}>
                  <Settings2 size={14} /> Properties
                </button>
              </div>
              {pendingCuts.length > 0 && !armed && (
                <button className="iso-cut-notice" onClick={() => setTab("materials")}>
                  Pipe lengths pending · Review {pendingCuts.length} {pendingCuts.length === 1 ? "cut" : "cuts"}
                </button>
              )}
              {armed && tab === "draw" && (
                <div className="iso-place-hint" role="status">
                  {armed.type.angle ? "Click a 90° elbow to place " : "Click a pipe to place "}{armed.type.label}
                  <button type="button" onClick={() => { setArmed(null); transient.patch({ insertHover: null }); }}>Cancel</button>
                </div>
              )}
              {!ready ? (
                <div className="iso-empty">
                  <Loader2 className="animate-spin" />
                  <p>Opening isometric…</p>
                </div>
              ) : (
                <CanvasSvg store={viewStore} frame={frame} svgRef={svg} className={svgClass} aria-label="Editable isometric drawing" tabIndex={0}
                  onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
                  onPointerLeave={() => transient.patch({ insertHover: null, hoverLabel: null, snap: null, cursor: gesture.current ? transient.get().cursor : null, sheet: null })}
                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                  onKeyDown={(e) => {
                    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                      e.preventDefault();
                      const b = e.currentTarget.getBoundingClientRect();
                      showEditMenu(e.currentTarget, b.left + b.width / 2, b.top + b.height / 2, true);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    // A menu key or a two-finger tap arrives here without a right press; a right press opens it on release.
                    if (e.button !== 2) showEditMenu(e.target as Element, e.clientX, e.clientY, true);
                  }}
                  onDoubleClick={(e) => {
                    const target = e.target as Element;
                    if (target.closest("[data-length]") || !labelsEditable || tool !== "select") return;
                    if (target.closest("[data-leader-handle]") && selectedLabelInfo) { e.preventDefault(); return; }
                    const label = pickLabel(paperLabels, target, selectedLabel?.key, e.ctrlKey || e.metaKey, true);
                    if (label) {
                      e.preventDefault();
                      editLabel(label.key);
                    }
                  }}>
                  {surface === "paper" && <rect x="0" y="0" width={drawing.width} height={drawing.height} className="iso-paper" />}
                  {drafting.grid && <GridLayer store={viewStore} frame={frame} drawing={drawing} lattice={paperLattice} anchor={gridOrigin} grid={grid} units={doc.units} mask={gridMask} model={surface === "grid"} />}
                  <SheetLayer primitives={drawing.primitives} lettering={drawing.lettering} weights={drawing.weights} background={surface === "paper" ? "white" : "var(--iso-canvas)"}
                    selection={selectionSet} editing={lengthEdit} onEditLength={openLength} highlight={labelHighlight} />
                  <Grips store={viewStore} frame={frame} positions={drawing.positions} nodeGrips={tool === "pipe" ? [] : nodeGrips} endGrips={tool === "pipe" ? [] : ends}
                    paths={tool === "select" ? editablePaths : []} routeAnchor={routeAnchor} />
                  <PointerLayer store={transient} view={viewStore} frame={frame} doc={doc} drawing={drawing} project={latticeRoute.project}
                    routeFrom={tool === "pipe" && routing ? anchor : null} prompt={tool === "pipe" && !routing ? "Start " + spool : null}
                    pending={pending?.position ?? null} insertPreview={!!armed || tool === "pipe" || tool === "split"}
                    measure={tool === "measure" ? measure : null} moveBase={tool === "move" || tool === "copy" ? transform?.base ?? null : null}
                    labelLayer={labelsEditable ? (
                      <LabelLayer store={transient} view={viewStore} frame={frame} labels={drawing.labels ?? []} index={paperLabels} selected={selectedLabel}
                        drag={() => (gesture.current?.kind === "label" ? gesture.current.drag : null)} active={tool === "select" && !spacePan}
                        lettering={drawing.lettering} weights={drawing.weights} />
                    ) : undefined} />
                  {surface === "paper" && (
                    // The title block and notes open Drawing setup, where every field is edited.
                    <rect x={0} y={drawing.area[3]} width={drawing.width} height={drawing.height - drawing.area[3]} fill="transparent"
                      className="iso-title-hotspot" aria-label="Edit title block" onClick={() => setTab("sheet")} />
                  )}
                  {!doc.runs.length && (() => {
                    const [x0, y0, x1, y1] = drawing.area, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
                    return (
                      <g pointerEvents="none" className="iso-onboarding">
                        <text x={cx} y={cy - 30} textAnchor="middle" className="iso-onboarding-title">Your next spool starts here</text>
                        <text x={cx} y={cy} textAnchor="middle" className="iso-onboarding-detail">Enter a measured length and choose a direction</text>
                        <text x={cx} y={cy + 22} textAnchor="middle" className="iso-onboarding-detail">or select Pipe (P) and click to place connections.</text>
                      </g>
                    );
                  })()}
                </CanvasSvg>
              )}
              {lengthEdit && editingText && (
                <InlineLength key={lengthEdit.runId + ":" + lengthEdit.role} view={viewStore} frame={frame} text={editingText} draft={lengthDraft}
                  aria={lengthEdit.role === "cut" ? "Pipe cut length" : "Pipe overall length"} inputRef={bindLengthInput}
                  onFinish={finishLength} onCancel={() => setLengthEdit(null)} />
              )}
              <div className="iso-bottom-controls">
                <div>
                  <button aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomCentre(1 / ZOOM_STEP)}><ZoomOut size={15} /></button>
                  <ZoomPercent store={viewStore} />
                  <button aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomCentre(ZOOM_STEP)}><ZoomIn size={15} /></button>
                  <button aria-label="Zoom window" title="Zoom window (Z W)" aria-pressed={tool === "zoom-window"} onClick={() => activateTool("zoom-window")}><Scan size={15} /></button>
                  <button aria-label="Zoom extents" title="Zoom extents: fit the drawing (double middle-click)" onClick={zoomExtents}><Maximize2 size={15} /></button>
                  {surface === "paper" && <button aria-label="Zoom to sheet" title="Whole sheet" onClick={zoomSheet}><FileText size={15} /></button>}
                </div>
              </div>
            </div>
            {inspectorOpen && <InspectorResize width={inspectorWidth} onResize={setInspectorWidth} />}
            <Inspector ref={inspector} hidden={!inspectorOpen} width={inspectorWidth} reveal={reveal}
              subject={tab === "sheet" ? "sheet" : selection.join(",") || pickedLabel?.key || ""}
              issues={issueList} empty={!doc.runs.length}
              tabs={tab !== "sheet" && selection.length === 1 && !!(selectedRun || selectedNode)}
              onClose={tab === "sheet" ? undefined : selection.length ? () => setSelection([]) : pickedLabel ? () => setSelectedLabel(null) : undefined}
              onDelete={tab !== "sheet" && selection.length && !selectedNote ? { label: selection.length > 1 ? `Erase ${selection.length} objects` : selectedRun ? "Erase pipe" : "Erase component", action: () => erase() }
                : selectedNote ? { label: "Erase callout", action: () => commit((d) => { d.sheetNotes = d.sheetNotes?.filter((n) => n.id !== selectedNote.id); }) && setSelection([]) } : undefined}
              {...identity}>
              {inspectorBody}
            </Inspector>
          </>
        )}
        {tab === "materials" && (
          <MaterialsView doc={doc} materials={materials} pieces={pieces} pendingCuts={pendingCuts.length} missingTakeouts={missingTakeoutNodes}
            onSelect={(key) => { setSelection([key]); setTab("draw"); }}
            onTakeout={(key) => { setSelection([key]); setTab("draw"); setTool("select"); focusProperty("Measured takeout"); }}
            onExport={(format) => void runExport(format)} />
        )}
        {tab === "welds" && <WeldsView doc={doc} joints={joints} commit={commit} onError={setError} onSelect={(key) => { setSelection([key]); setTab("draw"); }} onExport={() => void runExport("weld")} />}
        {tab === "catalogue" && <ComponentLibrary specs={doc.specs} onInsert={chooseComponent} />}
        {tab === "specs" && <SpecManager doc={doc} commit={commit} onError={setError} importSpecs={() => specInput.current?.click()} />}
        {tab === "3d" && <div className="iso-3d" ref={three} aria-label="Interactive 3D piping review" />}
      </div>
      {["draw", "sheet"].includes(tab) && ready && (
        <CommandBar prompt={prompt} options={commandOptions()} message={notice} onSubmit={submitCommand} onCancel={escape} inputRef={commandInput} />
      )}
      <footer className="iso-status">
        <span><Layers size={12} />{doc.runs.length} pipes · {doc.nodes.length} connections · {weldCount} welds{busy ? ` · Preparing ${busy}…` : ""}</span>
        <CursorReadout store={transient} doc={doc} drawing={drawing} toScale={surface === "grid" || sheetStyle.layout === "scale"} />
        <DraftingSettings drafting={drafting} units={doc.units} onChange={(patch) => { const { spacing, ...rest } = patch; if (spacing) setBlock(spacing); if (Object.keys(rest).length) setDrafting(rest); }} open={settingsOpen} onOpen={setSettingsOpen} onError={setError} />
        <span className={issues.length ? "warning" : doc.runs.length ? "valid" : undefined}>
          {issues.length ? `${issues.length} error${issues.length === 1 ? "" : "s"}${warningCount > 0 ? ` · ${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}`
            : warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : doc.runs.length ? "Dimensions checked" : "No pipe drawn"}
        </span>
      </footer>
      <input ref={specInput} type="file" accept=".json" hidden
        onChange={(e) => { const file = e.target.files?.[0]; if (file) void importSpecs(file); e.target.value = ""; }} />
      <input ref={importInput} type="file" accept=".piping,.json,.pcf,.dxf,.zip" multiple hidden
        onChange={(e) => { const files = [...(e.target.files ?? [])]; if (files.length) void importFile(files); e.target.value = ""; }} />
    </section>
  );
}

/** The zoom as a percentage; it follows the view on its own, so zooming does not re-render the editor. */
function ZoomPercent({ store }: { store: Store<ViewState> }) {
  const zoom = useStore(store, (s) => s.view.zoom);
  return <span>{Math.round(zoom * 100)}%</span>;
}

/**
 * Where the cursor is: the plant point of the object snap it is on, or (where the drawing is to scale) the plant point
 * under it on the routing plane; on a not-to-scale sheet, its place on the paper.
 */
function CursorReadout({ store, doc, drawing, toScale }: { store: Store<Transient>; doc: IsoDocument; drawing: Drawing; toScale: boolean }) {
  const snap = useStore(store, (s) => s.snap), cursor = useStore(store, (s) => s.cursor), sheet = useStore(store, (s) => s.sheet);
  const point = snap?.model ?? cursor;
  let text = "";
  if (point && (snap || toScale)) text = (snap ? OBJECT_SNAPS.find((o) => o.id === snap.kind)?.label + " · " : "") + coordinateText(doc, point).join("  ");
  else if (sheet && sheet[0] >= 0 && sheet[1] >= 0 && sheet[0] <= drawing.width && sheet[1] <= drawing.height) {
    const paper = paperUnitsOf(doc), [x, y] = paper.point(sheet);
    text = `Sheet X ${paper.text(x)}  Y ${paper.text(y)} ${paper.unit}`;
  }
  return <span className="iso-cursor-readout" aria-live="off">{text}</span>;
}
