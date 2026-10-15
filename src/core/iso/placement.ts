import type { Point } from '../drawing'
import { measureText, LINE_SPACING } from '../stroke-font'
import { add2, left2, scale2, sub2, unit2 } from './plane'

export type Poly = Point[]
export type Rect = [number, number, number, number]
export interface Occupant { poly: Poly; kind: string; owner?: string; box: Rect }

const bbox = (poly: Poly): Rect => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0, y0, x1, y1]
}
const project = (poly: Poly, axis: Point) => {
  let lo = Infinity, hi = -Infinity
  for (const p of poly) { const d = p[0] * axis[0] + p[1] * axis[1]; lo = Math.min(lo, d); hi = Math.max(hi, d) }
  return [lo, hi]
}
/** Separating-axis overlap test for convex polygons (a 2-point polygon is a segment). */
export function overlaps(a: Poly, b: Poly): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length]
      if (p[0] === q[0] && p[1] === q[1]) continue
      const axis = left2(unit2(sub2(q, p)))
      const [a0, a1] = project(a, axis), [b0, b1] = project(b, axis)
      if (a1 <= b0 || b1 <= a0) return false
    }
  }
  return true
}
export const rectPoly = (x0: number, y0: number, x1: number, y1: number): Poly => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
/** A segment thickened into a thin rectangle. */
export function segmentPoly(a: Point, b: Point, pad = 1): Poly {
  const u = unit2(sub2(b, a)), n = scale2(left2(u), pad), e = scale2(u, pad)
  return [add2(sub2(a, e), n), add2(add2(b, e), n), sub2(add2(b, e), n), sub2(sub2(a, e), n)]
}
/** The parallelogram covered by a (multi-line) text primitive, padded. */
export function textPoly(at: Point, text: string, size: number, rotation = 0, oblique = 0, anchor: 'start' | 'middle' | 'end' = 'start', pad = 1.5, factor = 1): Poly {
  const lines = text.split('\n'), width = Math.max(...lines.map(l => measureText(l, size, factor)))
  const below = (lines.length - 1) * size * LINE_SPACING
  const x0 = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0
  const r = rotation * Math.PI / 180, slant = Math.tan(oblique * Math.PI / 180)
  const local = (x: number, y: number): Point => {
    // y is up from the baseline here; oblique leans uprights right before the rotation.
    const sx = x + y * slant
    return [at[0] + sx * Math.cos(r) - y * Math.sin(r), at[1] - sx * Math.sin(r) - y * Math.cos(r)]
  }
  return [local(x0 - pad, -below - pad - size * 0.3), local(x0 + width + pad, -below - pad - size * 0.3), local(x0 + width + pad, size + pad), local(x0 - pad, size + pad)]
}

/** Everything already drawn in the model area, so each new label goes where it overlaps nothing. */
export class Placement {
  items: Occupant[] = []
  constructor(public bounds: Rect, public exclusions: Rect[] = []) {}
  add(poly: Poly, kind: string, owner?: string) {
    if (poly.length) this.items.push({ poly, kind, owner, box: bbox(poly) })
  }
  addSegment(a: Point, b: Point, kind: string, owner?: string, pad = 1) { this.add(segmentPoly(a, b, pad), kind, owner) }
  /** Whether a shape is inside the model area and clear of the title block, BOM and notes. */
  inside(poly: Poly): boolean {
    const [x0, y0, x1, y1] = bbox(poly), [bx0, by0, bx1, by1] = this.bounds
    if (x0 < bx0 || y0 < by0 || x1 > bx1 || y1 > by1) return false
    return !this.exclusions.some(e => overlaps(poly, rectPoly(...e)))
  }
  /** Occupants a shape would overlap, ignoring those the filter excuses (e.g. its own item). */
  hits(poly: Poly, excuse?: (o: Occupant) => boolean): Occupant[] {
    const [x0, y0, x1, y1] = bbox(poly), out: Occupant[] = []
    for (const o of this.items) {
      if (o.box[0] >= x1 || o.box[2] <= x0 || o.box[1] >= y1 || o.box[3] <= y0) continue
      if (excuse?.(o)) continue
      if (overlaps(poly, o.poly)) out.push(o)
    }
    return out
  }
  free(poly: Poly, excuse?: (o: Occupant) => boolean) { return this.inside(poly) && !this.hits(poly, excuse).length }
  /** Overlap cost for ranking candidate positions: text collisions are worst, crossing thin lines is mild. */
  cost(poly: Poly, excuse?: (o: Occupant) => boolean): number {
    let cost = this.inside(poly) ? 0 : 1000
    // Thin dimension and leader lines are broken around text afterwards, so crossing one costs little.
    for (const o of this.hits(poly, excuse)) cost += o.kind === 'text' || o.kind === 'symbol' || o.kind === 'tag' ? 100 : o.kind === 'pipe' ? 60 : 3
    return cost
  }
}

/** The parts of segment a–b outside a convex polygon (Cyrus–Beck). */
export function clipOutside(a: Point, b: Point, poly: Poly): Array<[Point, Point]> {
  const d = sub2(b, a)
  let enter = 0, leave = 1
  // Orientation decides which side of each edge is inside.
  let area = 0
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1] }
  const sign = area >= 0 ? 1 : -1
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], e = sub2(q, p)
    const n: Point = [e[1] * sign, -e[0] * sign]
    const num = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1], den = d[0] * n[0] + d[1] * n[1]
    if (Math.abs(den) < 1e-12) { if (num < 0) return [[a, b]]; continue }
    const t = num / den
    if (den < 0) enter = Math.max(enter, t)
    else leave = Math.min(leave, t)
    if (enter >= leave) return [[a, b]]
  }
  const at = (t: number): Point => [a[0] + d[0] * t, a[1] + d[1] * t], out: Array<[Point, Point]> = []
  if (enter > 1e-6) out.push([a, at(enter)])
  if (leave < 1 - 1e-6) out.push([at(leave), b])
  return out
}
