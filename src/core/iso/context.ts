import type { Point, Primitive } from '../drawing'
import type { FlangedJoint } from '../joints'
import type { MaterialRow } from '../material-list'
import type { DrawingStyle, IsoDocument, PipeNode, PipeRun, Vec3 } from '../model'
import { textPoly, type Placement, type Poly } from './placement'
import { add2, scale2, sub2, unit2 } from './plane'
import type { View } from './layout'

/** Sheet-unit sizes (850 units = 11 in) taken from the production reference sheets. */
export const SIZE = {
  text: 6.6,
  tag: 12.5,
  arrow: 7.5,
  arrowWidth: 1.7,
  weld: 2.1,
  flange: 12,
  flangeThickness: 3.2,
  valve: 16,
  valveWidth: 14,
  tier: 26,
  tierStep: 22,
  extGap: 3,
  extOver: 4
}

export interface RunGeometry {
  run: PipeRun
  a: Point
  b: Point
  /** Page unit direction from `a` to `b`. */
  dir: Point
  length: number
  /** Model unit direction. */
  dir3: Vec3
}
export interface IsoContext {
  doc: IsoDocument
  spool: string
  view: View
  style: DrawingStyle
  runs: PipeRun[]
  nodes: PipeNode[]
  /** Sheet position of each node. */
  pos: Map<string, Point>
  project: (p: Vec3) => Point
  /** Page unit vector of a model direction. */
  axis: (v: Vec3) => Point
  geometry: Map<string, RunGeometry>
  place: Placement
  materials: MaterialRow[]
  joints: FlangedJoint[]
  /** Page extent of each node's symbol along its pipe, so pipes stop at valve bodies. */
  extent: Map<string, number>
  out: Primitive[]
}
export function emitters(ctx: Pick<IsoContext, 'out' | 'place'>) {
  const line = (a: Point, b: Point, layer: string, owner?: string, weight?: number, occupy = true) => {
    ctx.out.push({ type: 'line', a, b, layer, owner, ...(weight ? { weight } : {}) })
    if (occupy) ctx.place.addSegment(a, b, layer === 'PIPE' ? 'pipe' : layer === 'DIM' || layer === 'LEADER' ? 'line' : 'symbol', owner, layer === 'PIPE' ? 2 : 0.8)
  }
  const poly = (points: Point[], layer: string, owner?: string, options: { closed?: boolean; fill?: boolean; weight?: number; occupy?: boolean } = {}) => {
    ctx.out.push({ type: 'polyline', points, layer, owner, closed: options.closed, fill: options.fill, ...(options.weight ? { weight: options.weight } : {}) })
    if (options.occupy !== false)
      for (let i = 0; i + 1 < points.length; i++) ctx.place.addSegment(points[i], points[i + 1], 'symbol', owner, 0.8)
  }
  const circle = (p: Point, r: number, layer: string, owner?: string, fill = false) => {
    ctx.out.push({ type: 'circle', p, r, layer, owner, fill })
    ctx.place.add([[p[0] - r, p[1] - r], [p[0] + r, p[1] - r], [p[0] + r, p[1] + r], [p[0] - r, p[1] + r]], 'symbol', owner)
  }
  const text = (p: Point, value: string, size: number, layer: string, owner?: string,
    options: { rotation?: number; oblique?: number; anchor?: 'start' | 'middle' | 'end'; role?: 'overall' | 'cut' } = {}): Poly => {
    ctx.out.push({ type: 'text', p, text: value, size, layer, owner, ...options })
    const shape = textPoly(p, value, size, options.rotation, options.oblique, options.anchor, 1)
    ctx.place.add(shape, 'text', owner)
    return shape
  }
  /** Filled arrowhead with its tip at `tip`, pointing along `toward`. */
  const arrow = (tip: Point, toward: Point, layer: string, owner?: string, length = SIZE.arrow, width = SIZE.arrowWidth) => {
    const u = unit2(toward), base = sub2(tip, scale2(u, length)), n: Point = [u[1] * width, -u[0] * width]
    poly([tip, add2(base, n), sub2(base, n)], layer, owner, { closed: true, fill: true })
  }
  return { line, poly, circle, text, arrow }
}
