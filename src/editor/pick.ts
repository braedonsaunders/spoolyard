import type { Point, Primitive } from "../core/drawing";

/**
 * Picking connections and pipes by what is drawn where the pointer is, rather than by which pick target happens to be
 * on top: a fitting is picked on its body, a pipe on its line, even where the generous pick circles of the
 * connections at both ends of a short pipe cover it. What lies under the pointer is kept in order so Tab can cycle
 * through it, as AutoCAD's selection cycling does.
 */

/**
 * Layers that are a component's body on the sheet: its symbol (and a bend's arc, drawn as pipe). Its lettering, item
 * tag, leaders and dimensions are not, nor its weld dots, which mark the joint with the pipe beside it.
 */
const BODY = new Set(["SYMBOL", "PIPE", "HATCH", "THD", "SOCKET"]);

/** Convex hull of the points, counter-clockwise (Andrew's monotone chain). */
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

const segmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/** Whether `p` is inside the convex hull, or within `pad` of its outline (a point or a line counts by distance). */
export function insideHull(hull: Point[], p: Point, pad = 0): boolean {
  if (!hull.length) return false;
  if (hull.length === 1) return Math.hypot(p[0] - hull[0][0], p[1] - hull[0][1]) <= pad;
  let inside = hull.length >= 3, near = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) inside = false;
    near = Math.min(near, segmentDistance(p, a, b));
  }
  return inside || near <= pad;
}

/** The outline of each component's body on the sheet, from the ink it owns (sheet units). */
export function bodyHulls(primitives: Primitive[], nodeIds: Set<string>): Map<string, Point[]> {
  const points = new Map<string, Point[]>();
  for (const p of primitives) {
    if (!p.owner || !nodeIds.has(p.owner) || !BODY.has(p.layer) || p.type === "text" || p.type === "image") continue;
    const list = points.get(p.owner) ?? (points.set(p.owner, []), points.get(p.owner)!);
    if (p.type === "line") list.push(p.a, p.b);
    else if (p.type === "polyline") list.push(...p.points);
    else if (p.type === "circle" || p.type === "arc") {
      // A circle by its octagon; enough for a pick outline.
      for (let k = 0; k < 8; k++) list.push([p.p[0] + p.r * Math.cos(k * Math.PI / 4), p.p[1] + p.r * Math.sin(k * Math.PI / 4)]);
    }
  }
  return new Map([...points].map(([id, list]) => [id, convexHull(list)]));
}

/**
 * What the pointer picks, first choice first:
 * 1. a connection drawn with no body of its own (a weld, a plain turn, an open end) when the pointer is on its point;
 * 2. a pipe whose drawn line is under the pointer (where pipe runs into a socket or thread, the line is the pipe's);
 * 3. a component whose body (symbol outline) is under the pointer;
 * 4. pipes whose pick band the pointer is in, nearest first;
 * 5. components merely near (within their pick circle), nearest first.
 * So on a short pipe between two fittings the pipe is picked between their bodies, and Tab reaches the rest.
 */
export function pickCandidates({ pipes, inked = [], nodes }: {
  /** Pipes within their pick band of the pointer, nearest first. */
  pipes: string[];
  /** Pipes whose drawn line is under the pointer, nearest first. */
  inked?: string[];
  /** Components near the pointer, nearest first: on their point (`core`), on their body (`body`), or only near. */
  nodes: Array<{ id: string; body: "core" | "body" | false }>;
}): string[] {
  const on = (kind: "core" | "body") => nodes.filter((n) => n.body === kind).map((n) => n.id);
  return [...new Set([...on("core"), ...inked, ...on("body"), ...pipes, ...nodes.map((n) => n.id)])];
}

/** Of the `pipes`, those whose drawn line (PIPE ink) passes within `tolerance` of the sheet point, in that order. */
export function pipeInkAt(primitives: Primitive[], pipes: string[], at: Point, tolerance: number): string[] {
  if (!pipes.length) return [];
  const wanted = new Set(pipes), hit = new Set<string>();
  for (const p of primitives)
    if (p.type === "line" && p.layer === "PIPE" && p.owner && wanted.has(p.owner) && segmentDistance(at, p.a, p.b) <= tolerance) hit.add(p.owner);
  return pipes.filter((id) => hit.has(id));
}

/** Selection cycling: the next candidate (Shift+Tab: the previous one). */
export const cycleIndex = (index: number, count: number, back = false) => (count ? (index + (back ? -1 : 1) + count) % count : 0);
