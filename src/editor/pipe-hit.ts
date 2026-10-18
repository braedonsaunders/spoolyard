import type { Drawing, Point } from '../core/drawing';
import type { IsoDocument } from '../core/model';

/** `end` is set when the point is on a pipe end, where flanges, blinds and caps attach. */
export interface PipeHit { runId: string; fraction: number; distance: number; end?: 0 | 1 }

/** Hit the full measured centreline in screen pixels, including gaps behind dimension labels. */
export function pipeAtPoint(
  doc: IsoDocument,
  drawing: Drawing,
  point: Point,
  toScreen: (point: Point) => Point,
  preferred = '',
  tolerance = 12,
): PipeHit | null {
  let closest: PipeHit | null = null;
  for (const hit of pipesAtPoint(doc, drawing, point, toScreen, tolerance))
    if (!closest || hit.distance < closest.distance - 0.01 || Math.abs(hit.distance - closest.distance) < 0.01 && hit.runId === preferred) closest = hit;
  return closest;
}

/** Every pipe whose centreline passes within `tolerance` screen pixels of the point, nearest first. */
export function pipesAtPoint(doc: IsoDocument, drawing: Drawing, point: Point, toScreen: (point: Point) => Point, tolerance = 12): PipeHit[] {
  // Pipes with ink on this sheet: their line, or for one so short its fittings' symbols cover it, its dimension.
  const owned = new Set(drawing.primitives.map(p => p.owner));
  const hits: PipeHit[] = [];
  for (const run of doc.runs) {
    if (run.connector) continue;
    const from = drawing.positions.get(run.from), to = drawing.positions.get(run.to);
    if (!from || !to || !owned.has(run.id)) continue;
    const a = toScreen(from), b = toScreen(to);
    const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
    if (length2 < 1e-8) continue;
    const fraction = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
    const distance = Math.hypot(point[0] - a[0] - fraction * dx, point[1] - a[1] - fraction * dy);
    if (distance > tolerance) continue;
    const near = Math.hypot(point[0] - a[0], point[1] - a[1]) <= tolerance ? 0
      : Math.hypot(point[0] - b[0], point[1] - b[1]) <= tolerance ? 1 : undefined;
    hits.push({ runId: run.id, fraction, distance, ...(near == null ? {} : { end: near }) });
  }
  // Stable: pipes equally near keep the drawing's order.
  return hits.sort((x, y) => x.distance - y.distance);
}
