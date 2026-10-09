import { formatLength, type IsoDocument, type Vec3 } from './model'
import type { Drawing, Point } from './drawing'

export type GridPlane = 'xy' | 'xz' | 'yz'
/** The graph paper stays in drawing coordinates, independent of the selected routing connection. */
export const GRID_ORIGIN: Vec3 = [0, 0, 0]
export interface GridSettings {
  visible: boolean
  snap: boolean
  spacing: number
  plane: GridPlane
  /** Constrain picked pipe to the nearest of the six iso directions (default on). */
  ortho?: boolean
}
export const defaultGrid = (): GridSettings => ({
  visible: true,
  snap: true,
  spacing: 100,
  plane: 'xy'
})
/** Centreline length of one isometric block. Imperial drawings start at 12 inches; metric drawings at 100 mm. */
export function defaultBlockSpacing(units: IsoDocument['units']): number {
  return units === 'imperial' ? 12 * 25.4 : 100
}
const axes = (plane: GridPlane): [number, number] =>
  plane === 'xy' ? [0, 1] : plane === 'xz' ? [0, 2] : [1, 2]

/** Invert the displayed projection on one physical routing plane. The third axis is held at the start connection. */
export function pickGridPoint(
  drawing: Drawing,
  sheet: Point,
  anchor: Vec3,
  settings: GridSettings
): Vec3 {
  if (!Number.isFinite(settings.spacing) || settings.spacing <= 0)
    throw new Error('Enter a positive grid spacing.')
  const [a, b] = axes(settings.plane)
  const origin = drawing.project(anchor)
  const pa: Vec3 = [...anchor],
    pb: Vec3 = [...anchor]
  pa[a] += 1
  pb[b] += 1
  const ap = drawing.project(pa),
    bp = drawing.project(pb)
  const ax = ap[0] - origin[0],
    ay = ap[1] - origin[1]
  const bx = bp[0] - origin[0],
    by = bp[1] - origin[1]
  const det = ax * by - ay * bx
  if (Math.abs(det) < 1e-10)
    throw new Error(
      'This routing plane is edge-on. Choose another plane or drawing view.'
    )
  const x = sheet[0] - origin[0],
    y = sheet[1] - origin[1]
  const deltaA = (x * by - y * bx) / det,
    deltaB = (y * ax - x * ay) / det
  const snap = (v: number) =>
    settings.snap ? Math.round(v / settings.spacing) * settings.spacing : v
  const result: Vec3 = [...anchor]
  result[a] += snap(deltaA)
  result[b] += snap(deltaB)
  return result
}

/**
 * Ortho routing: from the anchor, follow whichever physical axis (E/W, N/S, Up/Down) best matches
 * the pointer on screen, so a vertical riser is a click straight up the sheet in any routing plane.
 */
export function pickOrthoPoint(
  drawing: Drawing,
  sheet: Point,
  anchor: Vec3,
  settings: GridSettings
): Vec3 {
  if (!Number.isFinite(settings.spacing) || settings.spacing <= 0)
    throw new Error('Enter a positive grid spacing.')
  const origin = drawing.project(anchor),
    m: Point = [sheet[0] - origin[0], sheet[1] - origin[1]]
  let best: { axis: number; t: number; residual: number } | null = null
  for (const axis of [0, 1, 2]) {
    const unit: Vec3 = [...anchor]
    unit[axis] += 1
    const q = drawing.project(unit),
      d: Point = [q[0] - origin[0], q[1] - origin[1]],
      dd = d[0] * d[0] + d[1] * d[1]
    if (dd < 1e-12) continue // edge-on in this view
    const t = (m[0] * d[0] + m[1] * d[1]) / dd,
      residual = Math.hypot(m[0] - t * d[0], m[1] - t * d[1])
    if (!best || residual < best.residual) best = { axis, t, residual }
  }
  if (!best) throw new Error('No routing direction is visible in this view.')
  const t = settings.snap ? Math.round(best.t / settings.spacing) * settings.spacing : best.t
  const result: Vec3 = [...anchor]
  result[best.axis] += t
  return result
}

export interface GridLine {
  a: Point
  b: Point
  major: boolean
}

/** Clip a segment to an axis-aligned box (Liang–Barsky); null when it misses. */
function clipLine(a: Point, b: Point, box: [number, number, number, number]): [Point, Point] | null {
  const d: Point = [b[0] - a[0], b[1] - a[1]]
  let t0 = 0,
    t1 = 1
  for (const [p, q] of [
    [-d[0], a[0] - box[0]],
    [d[0], box[2] - a[0]],
    [-d[1], a[1] - box[1]],
    [d[1], box[3] - a[1]]
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return null
  }
  return [
    [a[0] + d[0] * t0, a[1] + d[1] * t0],
    [a[0] + d[0] * t1, a[1] + d[1] * t1]
  ]
}

/**
 * Three families form traditional triangular isometric paper, aligned to the active routing plane and
 * clipped to the drawing's model viewport. Shared by the editor overlay and the PDF/DXF sheets.
 */
export function gridLines(
  drawing: Drawing,
  anchor: Vec3,
  settings: GridSettings,
  units: IsoDocument['units'] = 'mm',
  viewport?: { area: Drawing['area']; minSpacing: number }
): { lines: GridLine[]; caption: string } | null {
  const origin = drawing.project(anchor),
    [a, b] = axes(settings.plane)
  const pa: Vec3 = [...anchor],
    pb: Vec3 = [...anchor]
  pa[a] += settings.spacing
  pb[b] += settings.spacing
  const ap = drawing.project(pa),
    bp = drawing.project(pb)
  let u: Point = [ap[0] - origin[0], ap[1] - origin[1]],
    v: Point = [bp[0] - origin[0], bp[1] - origin[1]]
  const det = u[0] * v[1] - u[1] * v[0]
  if (Math.abs(det) < 1e-8) return null
  // Keep large models readable while retaining the finer, explicit physical snap spacing.
  const perpendicular = Math.min(Math.abs(det) / Math.hypot(...u), Math.abs(det) / Math.hypot(...v))
  const every = Math.max(1, Math.ceil((viewport?.minSpacing ?? 18) / perpendicular))
  u = [u[0] * every, u[1] * every]
  v = [v[0] * every, v[1] * every]
  const determinant = u[0] * v[1] - u[1] * v[0]
  const area = viewport?.area ?? drawing.area
  const corners: Point[] = [
    [area[0], area[1]],
    [area[2], area[1]],
    [area[0], area[3]],
    [area[2], area[3]]
  ]
  const lattice = corners.map(([px, py]) => {
    const x = px - origin[0],
      y = py - origin[1]
    return [(x * v[1] - y * v[0]) / determinant, (y * u[0] - x * u[1]) / determinant]
  })
  const lines: GridLine[] = []
  const families: Array<[Point, Point, number[]]> = [
    [u, v, lattice.map(p => p[1])],
    [v, u, lattice.map(p => p[0])]
  ]
  if (drawing.view === 'iso') families.push([[u[0] + v[0], u[1] + v[1]], u, lattice.map(p => p[0] - p[1])])
  const reach = Math.hypot(area[2] - area[0], area[3] - area[1])
  const centre: Point = [(area[0] + area[2]) / 2, (area[1] + area[3]) / 2]
  for (const [dir, step, limits] of families) {
    const length = Math.hypot(...dir)
    if (length < 1e-6) continue
    for (let i = Math.floor(Math.min(...limits)) - 1; i <= Math.ceil(Math.max(...limits)) + 1; i++) {
      const lineX = origin[0] + step[0] * i,
        lineY = origin[1] + step[1] * i,
        ux = dir[0] / length,
        uy = dir[1] / length,
        along = (centre[0] - lineX) * ux + (centre[1] - lineY) * uy,
        x = lineX + ux * along,
        y = lineY + uy * along,
        dx = ux * reach,
        dy = uy * reach
      const clipped = clipLine([x - dx, y - dy], [x + dx, y + dy], area)
      if (clipped) lines.push({ a: clipped[0], b: clipped[1], major: i % 5 === 0 })
    }
  }
  const block = formatLength(settings.spacing, units)
  return {
    lines,
    caption: `${settings.plane.toUpperCase()} · 1 block = ${block}${every > 1 ? ` · lines every ${every} blocks` : ''}`
  }
}

export function gridSvg(
  drawing: Drawing,
  anchor: Vec3,
  settings: GridSettings,
  units: IsoDocument['units'] = 'mm'
): string {
  if (!settings.visible) return ''
  const grid = gridLines(drawing, anchor, settings, units)
  const [x, y] = drawing.area
  if (!grid) return `<text x="${x + 5}" y="${y + 17}" font-size="10">Grid plane is edge-on in this view</text>`
  const out = grid.lines.map(
    l =>
      `<line x1="${l.a[0]}" y1="${l.a[1]}" x2="${l.b[0]}" y2="${l.b[1]}" class="iso-grid-line${l.major ? ' major' : ''}"/>`
  )
  return `<g data-isometric-grid="true" pointer-events="none">${out.join('')}</g><text x="${x + 5}" y="${y + 17}" font-size="10" class="iso-grid-caption" pointer-events="none">${grid.caption}</text>`
}
