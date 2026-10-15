import type { Point } from '../drawing'
import type { Vec3 } from '../model'

export const add2 = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]]
export const sub2 = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
export const scale2 = (a: Point, k: number): Point => [a[0] * k, a[1] * k]
export const len2 = (a: Point) => Math.hypot(a[0], a[1])
export const unit2 = (a: Point): Point => { const l = len2(a) || 1; return [a[0] / l, a[1] / l] }
export const dot2 = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
export const lerp2 = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
/** Perpendicular turned counter-clockwise on the page (y down). */
export const left2 = (a: Point): Point => [a[1], -a[0]]

export const unit3 = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
/** The model axis a direction is closest to, with sign. */
export function nearestAxis(v: Vec3): Vec3 {
  const u = unit3(v), i = [0, 1, 2].reduce((a, b) => Math.abs(u[b]) > Math.abs(u[a]) ? b : a)
  const out: Vec3 = [0, 0, 0]; out[i] = Math.sign(u[i]) || 1
  return out
}
export const isAxial = (v: Vec3) => { const u = unit3(v); return Math.max(...u.map(Math.abs)) > 0.9999 }
/**
 * The model axis drawn across a pipe for flange strokes and extension lines: vertical for horizontal pipes,
 * east-west for vertical pipes (north-south when the pipe itself runs east-west in plan).
 */
export function crossAxis(dir: Vec3): Vec3 {
  const u = unit3(dir)
  if (Math.abs(u[2]) < 0.7) return [0, 0, 1]
  return [1, 0, 0]
}
/** Page angle in degrees counter-clockwise (the page y axis points down). */
export const pageAngle = (v: Point) => Math.atan2(-v[1], v[0]) * 180 / Math.PI
const wrap = (a: number) => ((a + 180) % 360 + 360) % 360 - 180
/**
 * Rotation and oblique for lettering lying in an isometric plane: the baseline runs along `baseline` and letter
 * uprights along `up` (both page vectors). Text is turned to read left-to-right or bottom-to-top.
 */
export function planeText(baseline: Point, up: Point): { rotation: number; oblique: number; flipped: boolean } {
  let rotation = pageAngle(baseline), flipped = false
  if (rotation > 90.5 || rotation <= -89.5) { rotation = wrap(rotation + 180); flipped = true }
  let upright = pageAngle(up)
  // Uprights stand on the reading side of the baseline.
  if (Math.abs(wrap(upright - (rotation + 90))) > 90) upright = wrap(upright + 180)
  return { rotation, oblique: wrap(rotation + 90 - upright), flipped }
}
/** Page unit vector of the letter uprights for a rotation and oblique. */
export function uprightOf(t: { rotation: number; oblique: number }): Point {
  const a = (t.rotation + 90 - t.oblique) * Math.PI / 180
  return [Math.cos(a), -Math.sin(a)]
}
/** A local drawing frame on the page: x along `along`, y along `across`, both page vectors. */
export const frame = (origin: Point, along: Point, across: Point) => (x: number, y: number): Point =>
  [origin[0] + along[0] * x + across[0] * y, origin[1] + along[1] * x + across[1] * y]
