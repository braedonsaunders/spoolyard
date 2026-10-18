import type { Drawing, Point } from "../core/drawing";
import type { IsoDocument, Vec3 } from "../core/model";
import type { ObjectSnap } from "./drafting";

/**
 * Object snaps: the point on the drawing a pick locks to when the pointer is within the aperture of it. Endpoints
 * and component centres win over midpoints, and midpoints over the nearest point on a pipe, as in AutoCAD; among
 * equals the closest wins. Each snap carries the plant point it stands for, so a snapped pick is exact even on a
 * not-to-scale sheet.
 */
export interface Snap {
  kind: ObjectSnap;
  /** Where it is drawn on the sheet. */
  at: Point;
  /** The plant point it stands for. */
  model: Vec3;
  /** The connection (endpoint, centre) or pipe (midpoint, nearest) snapped to. */
  id: string;
  /** Along the pipe, 0 at its start, for a pipe snap. */
  fraction?: number;
}
const PRIORITY: Record<ObjectSnap, number> = { endpoint: 0, centre: 0, midpoint: 1, nearest: 2 };
/** Kinds whose node is a pipe end or a change of direction rather than a component on the pipe. */
const JOINTS = new Set(["end", "elbow90", "elbow45", "tee", "weld"]);

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The fixed snap points of a drawing: every connection, component centre and pipe midpoint. */
export function snapPoints(doc: IsoDocument, drawing: Drawing): Snap[] {
  const out: Snap[] = [];
  for (const n of doc.nodes) {
    const at = drawing.positions.get(n.id);
    if (!at) continue;
    out.push({ kind: JOINTS.has(n.kind) && !n.associatedRunId ? "endpoint" : "centre", at, model: n.position, id: n.id });
  }
  const node = new Map(doc.nodes.map((n) => [n.id, n]));
  for (const r of doc.runs) {
    const a = drawing.positions.get(r.from), b = drawing.positions.get(r.to), pa = node.get(r.from), pb = node.get(r.to);
    if (!a || !b || !pa || !pb || r.connector) continue;
    out.push({ kind: "midpoint", at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], model: lerp(pa.position, pb.position, 0.5), id: r.id, fraction: 0.5 });
  }
  return out;
}

/** The nearest point on any pipe to `p`, as drawn. */
export function nearestOnPipe(doc: IsoDocument, drawing: Drawing, p: Point): Snap | null {
  const node = new Map(doc.nodes.map((n) => [n.id, n]));
  let best: Snap | null = null, gap = Infinity;
  for (const r of doc.runs) {
    const a = drawing.positions.get(r.from), b = drawing.positions.get(r.to), pa = node.get(r.from), pb = node.get(r.to);
    if (!a || !b || !pa || !pb || r.connector) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], dd = dx * dx + dy * dy;
    if (dd < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / dd));
    const at: Point = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(at[0] - p[0], at[1] - p[1]);
    if (d < gap) {
      gap = d;
      best = { kind: "nearest", at, model: lerp(pa.position, pb.position, t), id: r.id, fraction: t };
    }
  }
  return best;
}

/**
 * The snap a pick at `p` (sheet units) locks to within `aperture` (sheet units), given the enabled snap kinds, or
 * null. `exclude` leaves out the connection being moved or routed from.
 */
export function resolveSnap(points: Snap[], doc: IsoDocument, drawing: Drawing, p: Point, aperture: number,
  enabled: Record<ObjectSnap, boolean>, exclude?: ReadonlySet<string>): Snap | null {
  let best: Snap | null = null, score = Infinity;
  for (const s of points) {
    if (!enabled[s.kind] || exclude?.has(s.id)) continue;
    const d = Math.hypot(s.at[0] - p[0], s.at[1] - p[1]);
    if (d > aperture) continue;
    const rank = PRIORITY[s.kind] * aperture * 4 + d;
    if (rank < score) {
      score = rank;
      best = s;
    }
  }
  if (best || !enabled.nearest) return best;
  const near = nearestOnPipe(doc, drawing, p);
  return near && !exclude?.has(near.id) && Math.hypot(near.at[0] - p[0], near.at[1] - p[1]) <= aperture ? near : null;
}
