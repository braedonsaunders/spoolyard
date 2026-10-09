import type { Drawing, Point } from '../core/drawing';
import type { IsoDocument } from '../core/model';

export interface PipeHit { runId: string; fraction: number; distance: number }

/** Hit the full measured centreline in screen pixels, including gaps behind dimension labels. */
export function pipeAtPoint(
  doc: IsoDocument,
  drawing: Drawing,
  point: Point,
  toScreen: (point: Point) => Point,
  preferred = '',
  tolerance = 12,
): PipeHit | null {
  const visible = new Set(drawing.primitives.filter(p => p.type === 'line' && p.layer === 'PIPE').map(p => p.owner));
  let closest: PipeHit | null = null;
  for (const run of doc.runs) {
    if (run.connector || !visible.has(run.id)) continue;
    const from = drawing.positions.get(run.from), to = drawing.positions.get(run.to);
    if (!from || !to) continue;
    const a = toScreen(from), b = toScreen(to);
    const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
    if (length2 < 1e-8) continue;
    const fraction = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
    const distance = Math.hypot(point[0] - a[0] - fraction * dx, point[1] - a[1] - fraction * dy);
    if (distance > tolerance) continue;
    if (!closest || distance < closest.distance - 0.01 ||
      Math.abs(distance - closest.distance) < 0.01 && run.id === preferred) {
      closest = { runId: run.id, fraction, distance };
    }
  }
  return closest;
}
