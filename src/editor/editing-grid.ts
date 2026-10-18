import type { Drawing, Point } from '../core/drawing';
import { textCorners } from './text-box';

/** Room left above and below a material-table line of lettering, in cap heights. */
const LINE_PAD = 0.4;

/** Material tables have transparent cells; keep the editing guide behind the open drawing area. */
export function materialGridMask(drawing: Drawing): [number, number, number, number] | null {
  const points = drawing.primitives.flatMap((p): Point[] => {
    if (p.layer !== 'BOM' || p.owner) return [];
    if (p.type === 'line') return [p.a, p.b];
    if (p.type === 'text') return textCorners(p, p.size * LINE_PAD);
    return [];
  });
  return points.length ? [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))] : null;
}
