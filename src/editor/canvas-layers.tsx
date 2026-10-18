import { memo, useLayoutEffect, useMemo, useRef, type ReactNode, type Ref, type SVGProps } from "react";
import type { Drawing, PaperLabel, Point, Primitive } from "../core/drawing";
import { gridLines, type GridSettings } from "../core/grid";
import { paperLines, type PaperLattice } from "../core/iso/lattice";
import { formatLength, sub, type IsoDocument, type Vec3 } from "../core/model";
import { cn } from "./cn";
import { LabelOverlay, type LabelDrag, type LabelSelection } from "./label-editing";
import { SheetLayer } from "./sheet-layer";
import type { PipeHit } from "./pipe-hit";
import type { Snap } from "./snaps";
import { useStore, type Store } from "./store";
import { textBox, textCorners, type TextPrimitive } from "./text-box";
import { screenScale, toScreen, viewBox, visibleBox, type Frame, type Screen, type View } from "./viewport";

/** Where the view is and how large the drawing surface is on screen. */
export interface ViewState { view: View; screen: Screen }
export type ViewStore = Store<ViewState>;
/** What follows the pointer: re-drawn on every move without re-rendering the editor. */
export interface Transient {
  /** The pointer on the sheet. */
  sheet: Point | null;
  /** The plant point a click would pick now (routing, measuring, moving). */
  cursor: Vec3 | null;
  /** The object snap the pick is locked to. */
  snap: Snap | null;
  hoverLabel: string | null;
  /** The pipe point a click inserts at or branches from. */
  insertHover: PipeHit | null;
  /** Where a dragged label (or bend) is being put. */
  labelPreview: Point | null;
  /** A component being dragged: where its connection would go, in plant and on the sheet. */
  drag: { id: string; destination: Vec3; at: Point; leg?: string } | null;
  /** A selection window or crossing, or a zoom window, being dragged. */
  box: { from: Point; to: Point; zoom?: boolean } | null;
  /** A grip of a paper polyline being dragged. */
  vertex: { path: Point[]; index: number; at: Point } | null;
  /** A sheet callout being dragged: its ink, moved by this much. */
  shift: { owner: string; offset: Point } | null;
}
export type TransientStore = Store<Transient>;
export const EMPTY_TRANSIENT: Transient = { sheet: null, cursor: null, snap: null, hoverLabel: null, insertHover: null, labelPreview: null, drag: null, box: null, vertex: null, shift: null };

/** Markers and grips are sized in screen pixels, like CAD grips, so they read the same at any zoom. */
export const GRIP_PX = 8;
export const SNAP_PX = 10;
/** The pick aperture for object snaps and grips. */
export const APERTURE_PX = 10;
/** Grid lines closer together than this on screen are thinned out. */
export const MIN_GRID_PX = 18;
export const MIN_LATTICE_PX = 8;
const LABEL_PX = 12;
const NO_IDS: ReadonlySet<string> = new Set();

/** Screen pixels per sheet unit, following the view. */
export function useScale(store: ViewStore, frame: Frame) {
  return useStore(store, (s) => screenScale(frame, s.view, s.screen));
}

type SvgProps = Omit<SVGProps<SVGSVGElement>, "ref" | "viewBox"> & { store: ViewStore; frame: Frame; svgRef: Ref<SVGSVGElement>; children: ReactNode };
/**
 * The drawing surface. Only the view box follows pan and zoom here; the sheet inside is passed in already rendered,
 * so panning re-renders this element and the screen-sized overlays, not the drawing.
 */
export function CanvasSvg({ store, frame, svgRef, children, ...props }: SvgProps) {
  const box = useStore(store, (s) => viewBox(frame, s.view, s.screen).join(" "));
  return <svg ref={svgRef} viewBox={box} {...props}>{children}</svg>;
}

/**
 * The editing grid: on a not-to-scale sheet the paper's own lattice (isometric, or square for a plan or elevation) at
 * the cell the drawing is drafted on, so every straight lies on a drawn line; plant blocks otherwise. Never exported.
 */
export const GridLayer = memo(function GridLayer({ store, frame, drawing, lattice, anchor, grid, units, mask, model }: {
  store: ViewStore; frame: Frame; drawing: Drawing; lattice: PaperLattice | null; anchor: Vec3; grid: GridSettings; units: IsoDocument["units"];
  mask: [number, number, number, number] | null; model: boolean;
}) {
  const scale = useScale(store, frame);
  // Model space draws the grid over what is in view; paper draws it over the drawing area.
  const area = useStore(store, (s) => (model ? visibleBox(frame, s.view, s.screen).map((v) => Math.round(v)).join(",") : ""));
  // The paper's lattice depends only on its cell and the drawing area, so an edit that keeps them keeps the lines.
  const paper = lattice ? `${lattice.kind}|${lattice.cell}|${drawing.area.join(",")}` : "";
  const lines = useMemo(() => {
    if (lattice) return paperLines(lattice, drawing.area, MIN_LATTICE_PX / scale).lines;
    const box = model ? (area.split(",").map(Number) as Drawing["area"]) : drawing.area;
    // An edge-on routing plane has no grid in this view.
    return gridLines(drawing, anchor, grid, units, { area: box, minSpacing: MIN_GRID_PX / scale })?.lines ?? [];
    // Rounded to whole steps so a small zoom does not redraw the grid.
  }, [lattice ? paper : drawing, anchor, grid, units, model, area, Math.round(Math.log2(scale) * 4)]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawn = useMemo(() => lines.map((line, i) => (
    <line key={i} x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]} className={cn("iso-grid-line", line.major && "major")} vectorEffect="non-scaling-stroke" />
  )), [lines]);
  return (
    <>
      <g data-isometric-grid="true" pointerEvents="none">{drawn}</g>
      {mask && <rect data-grid-mask="materials" x={mask[0]} y={mask[1]} width={mask[2] - mask[0]} height={mask[3] - mask[1]} className="iso-grid-mask" pointerEvents="none" />}
    </>
  );
});

/**
 * Pick targets for every connection, and grips on what is selected: hollow squares on components, filled ones on
 * pipe ends. Polyline grips (a hose route, a continuation route, a callout leader) are dragged to reshape the path.
 */
export const Grips = memo(function Grips({ store, frame, positions, nodeGrips, endGrips, paths, routeAnchor }: {
  store: ViewStore; frame: Frame; positions: Map<string, Point>; nodeGrips: Point[]; endGrips: Point[];
  /** Editable paper polylines: each vertex is a grip, each midpoint a grip that adds a vertex. */
  paths: Array<{ id: string; points: Point[] }>;
  routeAnchor: Point | null;
}) {
  const px = 1 / useScale(store, frame), half = (GRIP_PX / 2) * px;
  const grip = (at: Point, key: string, className: string, extra?: Record<string, string | number>) => (
    <rect key={key} className={className} vectorEffect="non-scaling-stroke" x={at[0] - half} y={at[1] - half} width={half * 2} height={half * 2} {...extra} />
  );
  return (
    <>
      {[...positions].map(([key, p]) => (
        <circle key={key} data-node={key} cx={p[0]} cy={p[1]} r={Math.max(6 * px, Math.min(14, 11 * px))} fill="transparent" className="iso-node-hit" vectorEffect="non-scaling-stroke" />
      ))}
      {routeAnchor && (
        <g className="iso-route-anchor" pointerEvents="none">
          <circle cx={routeAnchor[0]} cy={routeAnchor[1]} r={5 * px} vectorEffect="non-scaling-stroke" />
          <path vectorEffect="non-scaling-stroke"
            d={`M${routeAnchor[0] - 9 * px} ${routeAnchor[1]}H${routeAnchor[0] - 3 * px}M${routeAnchor[0] + 3 * px} ${routeAnchor[1]}H${routeAnchor[0] + 9 * px}M${routeAnchor[0]} ${routeAnchor[1] - 9 * px}V${routeAnchor[1] - 3 * px}M${routeAnchor[0]} ${routeAnchor[1] + 3 * px}V${routeAnchor[1] + 9 * px}`} />
        </g>
      )}
      <g pointerEvents="none">
        {endGrips.map((p, i) => grip(p, "end" + i, "iso-grip is-end"))}
        {nodeGrips.map((p, i) => grip(p, "node" + i, "iso-grip"))}
      </g>
      {paths.map((path) => (
        <g key={path.id} className="iso-path-grips">
          <polyline points={path.points.map((q) => q.join(",")).join(" ")} className="iso-path-line" pointerEvents="none" vectorEffect="non-scaling-stroke" />
          {path.points.slice(1).map((q, i) => {
            const a = path.points[i], mid: Point = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2];
            return grip(mid, `${path.id}:mid${i}`, "iso-grip is-add", { "data-path": path.id, "data-insert": i + 1 });
          })}
          {path.points.map((q, i) => grip(q, `${path.id}:${i}`, "iso-grip is-vertex", { "data-path": path.id, "data-vertex": i }))}
        </g>
      ))}
    </>
  );
});

/** A distance and plant offset, as the measure tool and routing preview read them. */
export function offsetText(a: Vec3, b: Vec3, units: IsoDocument["units"]) {
  const d = sub(b, a);
  return `${formatLength(Math.hypot(...d), units)}  ·  ΔE ${formatLength(d[0], units)}  ΔN ${formatLength(d[1], units)}  ΔEL ${formatLength(d[2], units)}`;
}
/** Only the axes a move goes along, signed: "N +700 mm", "E −2′ 0″ · EL +300 mm". */
export function moveText(delta: Vec3, units: IsoDocument["units"]) {
  const names = [["E", "W"], ["N", "S"], ["UP", "DOWN"]];
  const parts = delta.map((v, i) => (Math.abs(v) < 0.01 ? "" : `${names[i][v < 0 ? 1 : 0]} ${formatLength(Math.abs(v), units)}`)).filter(Boolean);
  return parts.join(" · ") || "No move";
}

/** Everything that follows the pointer: route and move previews, rubber bands, snap markers and selection boxes. */
export function PointerLayer({ store, view, frame, doc, drawing, project, routeFrom, prompt, pending, insertPreview, measure, moveBase, labelLayer }: {
  store: TransientStore; view: ViewStore; frame: Frame; doc: IsoDocument; drawing: Drawing;
  /** Projects a plant point to the sheet the way the active command measures. */
  project: (p: Vec3) => Point;
  /** The plant point the pipe or move preview runs from; null when nothing is in progress. */
  routeFrom: Vec3 | null;
  /** What the cursor label says when nothing runs from it. */
  prompt: string | null;
  pending: Vec3 | null;
  insertPreview: boolean;
  measure: { from: Vec3; to?: Vec3 } | null;
  moveBase: Vec3 | null;
  /** The paper label layer: drawn last, following the hover and drag preview on its own. */
  labelLayer?: ReactNode;
}) {
  const t = useStore(store, (s) => s);
  const px = 1 / useScale(view, frame);
  const marker = (at: Point, r: number, className: string) => <circle cx={at[0]} cy={at[1]} r={r * px} className={className} vectorEffect="non-scaling-stroke" pointerEvents="none" />;
  const label = (at: Point, text: string) => (
    <text x={at[0] + LABEL_PX * px} y={at[1] - LABEL_PX * px} className="iso-route-label" fontSize={LABEL_PX * px} pointerEvents="none">{text}</text>
  );
  const run = t.insertHover && drawing.positions.get(doc.runs.find((r) => r.id === t.insertHover!.runId)?.from ?? "");
  const runEnd = t.insertHover && drawing.positions.get(doc.runs.find((r) => r.id === t.insertHover!.runId)?.to ?? "");
  const from = routeFrom && project(routeFrom), cursor = t.cursor && (t.snap ? t.snap.at : project(t.cursor));
  return (
    <g pointerEvents="none">
      {insertPreview && t.insertHover && run && runEnd && (
        <g className="iso-insert-preview">
          <line x1={run[0]} y1={run[1]} x2={runEnd[0]} y2={runEnd[1]} vectorEffect="non-scaling-stroke" />
          {marker([run[0] + (runEnd[0] - run[0]) * t.insertHover.fraction, run[1] + (runEnd[1] - run[1]) * t.insertHover.fraction], 6, "")}
        </g>
      )}
      {pending && marker(project(pending), 5, "iso-anchor")}
      {/* A component dragged: where it goes, and the pipes it stretches. */}
      {t.drag && (() => {
        const drag = t.drag, at = drawing.positions.get(drag.id), moved = !!at && Math.hypot(at[0] - drag.at[0], at[1] - drag.at[1]) > 0.01;
        const shift: Point = at ? [drag.at[0] - at[0], drag.at[1] - at[1]] : [0, 0];
        // Free, each pipe pivots on its far end; stretching along a pipe, the pipes beyond move with the connection.
        const lines = doc.runs.filter((r) => r.from === drag.id || r.to === drag.id).flatMap((r) => {
          const far = drawing.positions.get(r.from === drag.id ? r.to : r.from);
          if (!far) return [];
          const end: Point = drag.leg && r.id !== drag.leg ? [far[0] + shift[0], far[1] + shift[1]] : far;
          return [[end, drag.at] as [Point, Point]];
        });
        return (
          <g className="iso-drag-preview">
            {moved && lines.map(([p, q], i) => <line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} vectorEffect="non-scaling-stroke" />)}
            {marker(t.drag.at, 6, "iso-anchor")}
            {at && moved && label(t.drag.at, moveText(sub(t.drag.destination, doc.nodes.find((n) => n.id === t.drag!.id)!.position), doc.units))}
          </g>
        );
      })()}
      {cursor && t.cursor && !t.insertHover && !t.drag && (
        <g>
          {from && routeFrom && <line x1={from[0]} y1={from[1]} x2={cursor[0]} y2={cursor[1]} className="iso-route-preview" vectorEffect="non-scaling-stroke" />}
          {moveBase && <line x1={project(moveBase)[0]} y1={project(moveBase)[1]} x2={cursor[0]} y2={cursor[1]} className="iso-route-preview" vectorEffect="non-scaling-stroke" />}
          {marker(cursor, 4, "iso-anchor")}
          {routeFrom ? label(cursor, formatLength(Math.hypot(...sub(t.cursor, routeFrom)), doc.units))
            : moveBase ? label(cursor, moveText(sub(t.cursor, moveBase), doc.units))
              : prompt && label(cursor, prompt)}
        </g>
      )}
      {measure && (() => {
        const a = project(measure.from), to = measure.to ?? t.cursor, b = to && (measure.to ? project(measure.to) : cursor);
        return (
          <g className="iso-measure">
            {marker(a, 4, "iso-anchor")}
            {b && to && (
              <>
                <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} vectorEffect="non-scaling-stroke" />
                {marker(b, 4, "iso-anchor")}
                {label(b, offsetText(measure.from, to, doc.units))}
              </>
            )}
          </g>
        );
      })()}
      {t.snap && <SnapMarker snap={t.snap} px={px} />}
      {t.box && (() => {
        const [x0, y0] = [Math.min(t.box.from[0], t.box.to[0]), Math.min(t.box.from[1], t.box.to[1])];
        const crossing = !t.box.zoom && t.box.to[0] < t.box.from[0];
        return <rect className={cn("iso-select-box", crossing && "is-crossing", t.box.zoom && "is-zoom")} x={x0} y={y0} vectorEffect="non-scaling-stroke"
          width={Math.abs(t.box.to[0] - t.box.from[0])} height={Math.abs(t.box.to[1] - t.box.from[1])} />;
      })()}
      {t.vertex && <polyline className="iso-path-rubber" vectorEffect="non-scaling-stroke"
        points={t.vertex.path.map((q, i) => (i === t.vertex!.index ? t.vertex!.at : q).join(",")).join(" ")} />}
      {t.shift && (
        <g className="iso-label-ghost" transform={`translate(${t.shift.offset[0]} ${t.shift.offset[1]})`}>
          <SheetLayer primitives={drawing.primitives.filter((p) => p.owner === t.shift!.owner)} lettering={drawing.lettering} weights={drawing.weights} background="transparent" selection={NO_IDS} editing={null} />
        </g>
      )}
      {labelLayer}
    </g>
  );
}

/** AutoCAD's snap markers: a square at an endpoint, a triangle at a midpoint, a circle at a centre, an hourglass for nearest. */
function SnapMarker({ snap, px }: { snap: Snap; px: number }) {
  const r = (SNAP_PX / 2) * px, [x, y] = snap.at;
  const d = snap.kind === "endpoint" ? `M${x - r} ${y - r}H${x + r}V${y + r}H${x - r}Z`
    : snap.kind === "midpoint" ? `M${x} ${y - r}L${x + r} ${y + r * 0.8}H${x - r}Z`
      : snap.kind === "nearest" ? `M${x - r} ${y - r}H${x + r}L${x - r} ${y + r}H${x + r}Z` : "";
  return (
    <g className="iso-snap-marker" pointerEvents="none">
      {snap.kind === "centre" ? <circle cx={x} cy={y} r={r} vectorEffect="non-scaling-stroke" /> : <path d={d} vectorEffect="non-scaling-stroke" />}
      <title>{snap.kind}</title>
    </g>
  );
}

/**
 * The paper label overlay. It follows the hover and the drag preview, and keeps its grips a screen size at any zoom,
 * on its own: a pointer move that changes neither does not redraw the labels.
 */
export function LabelLayer({ store, view, frame, labels, index, selected, drag, active, lettering, weights }: {
  store: TransientStore; view: ViewStore; frame: Frame; labels: PaperLabel[]; index: Map<string, PaperLabel>; selected: LabelSelection | null;
  /** The label drag in progress, read as the layer draws. */
  drag: () => LabelDrag | null;
  active: boolean; lettering?: "cad" | "sans"; weights?: Record<string, number>;
}) {
  const hover = useStore(store, (s) => s.hoverLabel), preview = useStore(store, (s) => s.labelPreview);
  const px = 1 / useScale(view, frame);
  return <LabelOverlay labels={labels} index={index} hover={hover} selected={selected} drag={drag()} preview={preview}
    active={active} pixel={px} lettering={lettering} weights={weights} />;
}

/** One screen pixel in sheet units, for overlays drawn outside the pointer layer. */
export function usePixel(view: ViewStore, frame: Frame) {
  return 1 / useScale(view, frame);
}

/**
 * The in-place editor for a pipe length, over its dimension text: placed from the text's own geometry on the sheet,
 * not by finding it in the page, and kept over it while the view moves.
 */
export function InlineLength({ view, frame, text, draft, aria, onFinish, onCancel, inputRef }: {
  view: ViewStore; frame: Frame; text: TextPrimitive; draft: string; aria: string;
  onFinish: (value: string) => void; onCancel: () => void; inputRef: (el: HTMLInputElement | null) => void;
}) {
  const state = useStore(view, (s) => s);
  const k = screenScale(frame, state.view, state.screen), box = textBox(text);
  const screen = { ...state.screen, left: 0, top: 0 };
  // The middle of the lettering as drawn, rotated with it.
  const corners = textCorners(text), mid: Point = [corners.reduce((sum, c) => sum + c[0], 0) / 4, corners.reduce((sum, c) => sum + c[1], 0) / 4];
  const centre = toScreen(frame, state.view, screen, mid);
  const width = Math.max(108, box.width * k + 36), height = Math.max(24, box.height * k + 8);
  const done = useRef(false);
  useLayoutEffect(() => { done.current = false; }, [text]);
  return (
    <input ref={inputRef} className="iso-inline-length" aria-label={aria} defaultValue={draft}
      style={{ left: centre[0] - width / 2, top: centre[1] - height / 2, width, height, fontSize: Math.max(13, box.height * k) }}
      onBlur={(e) => { if (!done.current) { done.current = true; onFinish(e.target.value); } }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }} />
  );
}

/** The primitives a pipe length is lettered with, by role. */
export function lengthText(primitives: Primitive[], runId: string, role: "overall" | "cut") {
  return primitives.find((p): p is TextPrimitive => p.type === "text" && p.owner === runId && p.role === role);
}
