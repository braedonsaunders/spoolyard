import type { Drawing, Point } from "../core/drawing";

/**
 * The editor's view onto a drawing: a zoom about the sheet's centre and a pan from it, in sheet units. The SVG keeps
 * its aspect (`meet`), so the centre of the view box is always `centre + pan` whatever the zoom, which keeps zooming
 * about the pointer exact even when the sheet is letterboxed.
 */
export interface View {
  zoom: number;
  pan: Point;
}
/** The sheet the view looks at: its size in sheet units, and whether the view widens to the screen (model space). */
export interface Frame {
  width: number;
  height: number;
  fill: boolean;
  /** Paper around the sheet at zoom 1, as a fraction of its height. */
  pad?: number;
}
export interface Screen {
  width: number;
  height: number;
}
export type Box = [number, number, number, number];

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 32;
/** One wheel notch, or one press of + / −. */
export const ZOOM_STEP = 1.2;
/** Fraction of the screen left around a drawing fitted to it. */
export const FIT_MARGIN = 0.08;
export const HOME: View = { zoom: 1, pan: [0, 0] };

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
/** Width of the view box at zoom 1: the sheet, or in model space the screen's aspect at the sheet's height. */
export const baseWidth = (frame: Frame, screen: Screen) =>
  frame.fill && screen.height > 0 ? frame.height * screen.width / screen.height : frame.width;

export function viewBox(frame: Frame, view: View, screen: Screen): Box {
  const grow = 1 + 2 * (frame.pad ?? 0);
  const w = baseWidth(frame, screen) * grow / view.zoom, h = frame.height * grow / view.zoom;
  return [frame.width / 2 + view.pan[0] - w / 2, frame.height / 2 + view.pan[1] - h / 2, w, h];
}
/** Screen pixels per sheet unit. */
export function screenScale(frame: Frame, view: View, screen: Screen): number {
  const [, , w, h] = viewBox(frame, view, screen);
  if (!(w > 0 && h > 0) || !(screen.width > 0 && screen.height > 0)) return 1;
  return Math.min(screen.width / w, screen.height / h);
}
/** The sheet area visible on screen (wider or taller than the view box when letterboxed). */
export function visibleBox(frame: Frame, view: View, screen: Screen): Box {
  const k = screenScale(frame, view, screen), cx = frame.width / 2 + view.pan[0], cy = frame.height / 2 + view.pan[1];
  const w = screen.width / k, h = screen.height / k;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}
/** Zoom by `factor`, keeping the sheet point `at` where it is on screen. */
export function zoomAbout(frame: Frame, view: View, at: Point, factor: number): View {
  const zoom = clampZoom(view.zoom * factor);
  if (zoom === view.zoom) return view;
  const keep = 1 - view.zoom / zoom, cx = frame.width / 2 + view.pan[0], cy = frame.height / 2 + view.pan[1];
  return { zoom, pan: [view.pan[0] + (at[0] - cx) * keep, view.pan[1] + (at[1] - cy) * keep] };
}
/** Pan by a screen distance: the drawing follows the pointer. */
export function panScreen(frame: Frame, view: View, screen: Screen, dx: number, dy: number): View {
  const k = screenScale(frame, view, screen);
  return { zoom: view.zoom, pan: [view.pan[0] - dx / k, view.pan[1] - dy / k] };
}
/** The view that shows `box` as large as fits, with a margin; zoom window and zoom extents. */
export function fitView(frame: Frame, screen: Screen, box: Box, margin = FIT_MARGIN, minSize = 1): View {
  const w = Math.max(minSize, box[2] - box[0]), h = Math.max(minSize, box[3] - box[1]);
  const unit = screenScale(frame, HOME, screen);
  const zoom = clampZoom(Math.min(screen.width / (unit * w), screen.height / (unit * h)) * (1 - 2 * margin));
  return { zoom, pan: [(box[0] + box[2]) / 2 - frame.width / 2, (box[1] + box[3]) / 2 - frame.height / 2] };
}
/** Bounds of a set of points, or null for none. */
export function bounds(points: Iterable<Point>): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return x0 <= x1 ? [x0, y0, x1, y1] : null;
}
/** Screen point to sheet point, given where the SVG sits on screen. */
export function toSheet(frame: Frame, view: View, screen: Screen & { left: number; top: number }, clientX: number, clientY: number): Point {
  const k = screenScale(frame, view, screen), cx = frame.width / 2 + view.pan[0], cy = frame.height / 2 + view.pan[1];
  return [cx + (clientX - screen.left - screen.width / 2) / k, cy + (clientY - screen.top - screen.height / 2) / k];
}
export function toScreen(frame: Frame, view: View, screen: Screen & { left: number; top: number }, p: Point): Point {
  const k = screenScale(frame, view, screen), cx = frame.width / 2 + view.pan[0], cy = frame.height / 2 + view.pan[1];
  return [screen.left + screen.width / 2 + (p[0] - cx) * k, screen.top + screen.height / 2 + (p[1] - cy) * k];
}

/**
 * The view that shows `box` as large as fits within the screen (less `margin` of it at each edge) without any part of
 * it under the `covers`: screen rectangles, relative to the drawing surface, of toolbars floating over it. The box
 * stays centred where it can, and moves off centre only as far as clearing a toolbar needs; a toolbar in a corner
 * costs only the room it takes. Without covers this is `fitView`.
 */
export function fitClearOf(frame: Frame, screen: Screen, box: Box, covers: Box[], margin = FIT_MARGIN, minSize = 1): View {
  const plain = fitView(frame, screen, box, margin, minSize);
  if (!covers.length || !(screen.width > 0 && screen.height > 0)) return plain;
  const bw = Math.max(minSize, box[2] - box[0]), bh = Math.max(minSize, box[3] - box[1]), unit = screenScale(frame, HOME, screen);
  const mx = screen.width * margin, my = screen.height * margin;
  const clear = (r: Box) => covers.every((c) => r[2] <= c[0] || r[0] >= c[2] || r[3] <= c[1] || r[1] >= c[3]);
  /** Where the box can sit at this zoom: centred if clear, else the nearest clear place beside a toolbar. */
  const place = (zoom: number): Point | null => {
    const k = unit * zoom, w = bw * k, h = bh * k;
    if (w > screen.width - 2 * mx + 1e-6 || h > screen.height - 2 * my + 1e-6) return null;
    const lo: Point = [mx + w / 2, my + h / 2], hi: Point = [screen.width - mx - w / 2, screen.height - my - h / 2];
    const xs = [screen.width / 2, ...covers.flatMap((c) => [c[2] + w / 2, c[0] - w / 2])].filter((x) => x >= lo[0] - 1e-6 && x <= hi[0] + 1e-6);
    const ys = [screen.height / 2, ...covers.flatMap((c) => [c[3] + h / 2, c[1] - h / 2])].filter((y) => y >= lo[1] - 1e-6 && y <= hi[1] + 1e-6);
    let best: Point | null = null, cost = Infinity;
    for (const x of xs) for (const y of ys) {
      const d = Math.hypot(x - screen.width / 2, y - screen.height / 2);
      if (d < cost && clear([x - w / 2, y - h / 2, x + w / 2, y + h / 2])) { best = [x, y]; cost = d; }
    }
    return best;
  };
  // The largest zoom with a clear place: zoom shrinks in 1% steps from the plain fit.
  for (let zoom = plain.zoom / (1 - 2 * margin), i = 0; i < 200; zoom *= 0.99, i++) {
    const at = place(zoom);
    if (!at) continue;
    const k = unit * zoom, cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    const z = clampZoom(zoom);
    return { zoom: z, pan: [cx + (screen.width / 2 - at[0]) / k - frame.width / 2, cy + (screen.height / 2 - at[1]) / k - frame.height / 2] };
  }
  return plain;
}

/**
 * The extent of a sheet's piping ink: connections, pipe, symbols, dimensions, leaders, tags and labels (with their
 * lettering), not the frame, title block or material list.
 */
export function inkExtents(drawing: Pick<Drawing, "positions" | "primitives" | "labels">): Box | null {
  const points: Point[] = [...drawing.positions.values()];
  for (const p of drawing.primitives) {
    if (!(p.owner || (p.type === "text" && p.label)) || SHEET_FRAME.has(p.layer) || ("field" in p && p.field)) continue;
    if (p.type === "line") points.push(p.a, p.b);
    else if (p.type === "polyline") points.push(...p.points);
    else if (p.type === "circle" || p.type === "arc") points.push([p.p[0] - p.r, p.p[1] - p.r], [p.p[0] + p.r, p.p[1] + p.r]);
    else if (p.type === "text" && !p.label) {
      // Lettering about as wide as its characters, from its anchor along its rotation, a cap height tall.
      const w = p.text.length * p.size * (p.width ?? 1) * 0.9, a = ((p.rotation ?? 0) * Math.PI) / 180, u: Point = [Math.cos(a), -Math.sin(a)], v: Point = [Math.sin(a), Math.cos(a)];
      const start = p.anchor === "middle" ? -w / 2 : p.anchor === "end" ? -w : 0;
      for (const along of [start, start + w]) for (const up of [0, -p.size]) points.push([p.p[0] + u[0] * along + v[0] * up, p.p[1] + u[1] * along + v[1] * up]);
    }
  }
  for (const label of drawing.labels ?? []) points.push(...label.outline);
  return bounds(points);
}
/** The sheet's own furniture, never part of the piping's extent. */
const SHEET_FRAME = new Set(["TITLE", "BOM", "BORDER", "GRID"]);
