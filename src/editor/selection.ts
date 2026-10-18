import type { Drawing, Point, Primitive } from "../core/drawing";
import type { IsoDocument } from "../core/model";
import type { Box } from "./viewport";

/**
 * What can be selected on the sheet, as drawn: each pipe by its centreline and each component by its symbol and
 * centre. Window selection (dragged left to right) takes what lies wholly inside; crossing selection (right to left)
 * takes whatever it touches, as in AutoCAD.
 */
export interface Selectable {
  id: string;
  segments: Array<[Point, Point]>;
  points: Point[];
}
export type BoxMode = "window" | "crossing";

/** Layers that draw the pipe or component itself; dimensions, tags and leaders are not part of its outline. */
const BODY_LAYERS = new Set(["PIPE", "SYMBOL", "WELD", "HATCH"]);
const segmentsOf = (p: Primitive): Array<[Point, Point]> => {
  if (p.type === "line") return [[p.a, p.b]];
  if (p.type === "polyline") {
    const out: Array<[Point, Point]> = [];
    for (let i = 1; i < p.points.length; i++) out.push([p.points[i - 1], p.points[i]]);
    if (p.closed && p.points.length > 2) out.push([p.points.at(-1)!, p.points[0]]);
    return out;
  }
  if (p.type === "circle") {
    const [x, y] = p.p, r = p.r;
    return [[[x - r, y - r], [x + r, y - r]], [[x + r, y - r], [x + r, y + r]], [[x + r, y + r], [x - r, y + r]], [[x - r, y + r], [x - r, y - r]]];
  }
  return [];
};

/** Every pipe and component drawn on the sheet. */
export function selectables(doc: IsoDocument, drawing: Drawing): Selectable[] {
  const items = new Map<string, Selectable>();
  const item = (id: string) => {
    let s = items.get(id);
    if (!s) items.set(id, (s = { id, segments: [], points: [] }));
    return s;
  };
  const runs = new Set(doc.runs.map((r) => r.id)), nodes = new Set(doc.nodes.map((n) => n.id));
  for (const r of doc.runs) {
    const a = drawing.positions.get(r.from), b = drawing.positions.get(r.to);
    if (a && b) item(r.id).segments.push([a, b]);
  }
  for (const n of doc.nodes) {
    const at = drawing.positions.get(n.id);
    if (at) item(n.id).points.push(at);
  }
  for (const p of drawing.primitives) {
    if (!p.owner || !BODY_LAYERS.has(p.layer) || !(runs.has(p.owner) || nodes.has(p.owner))) continue;
    item(p.owner).segments.push(...segmentsOf(p));
  }
  return [...items.values()].filter((s) => s.segments.length || s.points.length);
}

const inside = ([x, y]: Point, b: Box) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
/** Whether a segment touches a box (Liang–Barsky). */
export function segmentTouchesBox(a: Point, b: Point, box: Box): boolean {
  if (inside(a, box) || inside(b, box)) return true;
  const d: Point = [b[0] - a[0], b[1] - a[1]];
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-d[0], a[0] - box[0]], [d[0], box[2] - a[0]], [-d[1], a[1] - box[1]], [d[1], box[3] - a[1]]]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}
export const normaliseBox = (a: Point, b: Point): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
/** Dragged left to right is a window; right to left is a crossing. */
export const boxMode = (from: Point, to: Point): BoxMode => (to[0] >= from[0] ? "window" : "crossing");

/** The ids a window or crossing box selects. */
export function pickInBox(items: Selectable[], box: Box, mode: BoxMode): string[] {
  return items.filter((s) => {
    if (mode === "window") return s.segments.every(([a, b]) => inside(a, box) && inside(b, box)) && s.points.every((p) => inside(p, box));
    return s.segments.some(([a, b]) => segmentTouchesBox(a, b, box)) || s.points.some((p) => inside(p, box));
  }).map((s) => s.id);
}

/**
 * A click's effect on the selection: a plain click replaces it, Shift or Ctrl/⌘ adds an object that is not selected
 * and removes one that is (AutoCAD's Shift-to-remove and the add-by-default of most editors, in one gesture).
 */
export function clickSelect(current: readonly string[], ids: readonly string[], modifier: "replace" | "toggle" | "add" | "remove"): string[] {
  if (modifier === "replace") return [...new Set(ids)];
  const set = new Set(current);
  for (const id of ids) {
    if (modifier === "add") set.add(id);
    else if (modifier === "remove") set.delete(id);
    else if (set.has(id)) set.delete(id);
    else set.add(id);
  }
  // The newest pick is the primary object, shown first in the properties.
  const order = [...current.filter((id) => set.has(id) && !ids.includes(id)), ...ids.filter((id) => set.has(id))];
  return [...new Set(order)];
}
/** Only what still exists in the document: its pipes, components and sheet callouts. */
export function existing(doc: IsoDocument, ids: readonly string[]): string[] {
  if (!ids.length) return [];
  const known = new Set<string>([...doc.runs.map((r) => r.id), ...doc.nodes.map((n) => n.id), ...(doc.sheetNotes ?? []).map((n) => n.id)]);
  return ids.filter((id) => known.has(id));
}
export const sameSelection = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
