import {
  type IsoDocument,
  type Vec3,
  type PipeNode,
  formatLength,
  runResult,
  welds,
  connected,
  bom,
  round
} from './model'
import { gridSvg, type GridSettings } from './grid'
import { symbolStrokes } from './symbols'
export type Point = [number, number]
export type Primitive =
  | { type: 'line'; a: Point; b: Point; layer: string; owner?: string }
  | { type: 'circle'; p: Point; r: number; layer: string; owner?: string }
  | {
      type: 'text'
      p: Point
      text: string
      size: number
      layer: string
      owner?: string
      /** Set on a pipe dimension so the editor can edit that length in place. */
      role?: 'overall' | 'cut'
    }
export interface Drawing {
  width: number
  height: number
  /** The model viewport on the sheet, inside the border and clear of the BOM and title block. */
  area: [number, number, number, number]
  /** Projected-model centre and scale used to fit the sheet; pass back to hold the view steady while routing. */
  fit: SheetFit
  primitives: Primitive[]
  positions: Map<string, Point>
  project: (p: Vec3) => Point
  view: 'iso' | 'plan' | 'front' | 'side'
}
export const escape = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  )
export function isoProject(p: Vec3, rotation = 0): Point {
  const angle = (rotation * Math.PI) / 180
  const x = p[0] * Math.cos(angle) - p[1] * Math.sin(angle),
    y = p[0] * Math.sin(angle) + p[1] * Math.cos(angle)
  return [(x - y) * Math.cos(Math.PI / 6), -(x + y) * 0.5 - p[2]]
}
/** Sheet proportions; drawings are laid out 850 units tall at the chosen paper's aspect ratio. */
export const PAPER_ASPECT = {
  letter: 11 / 8.5,
  tabloid: 17 / 11,
  a3: 420 / 297,
  a4: 297 / 210
} as const
export const SHEET_HEIGHT = 850
export const sheetWidth = (doc: Pick<IsoDocument, 'paper'>) =>
  Math.round(SHEET_HEIGHT * PAPER_ASPECT[doc.paper ?? 'tabloid'])
export interface SheetFit {
  centre: Point
  scale: number
}
/** A length for the drawing: no repeated unit, trailing zeroes dropped. */
function compactLength(mm: number, units: IsoDocument['units']): string {
  if (!Number.isFinite(mm)) return '—'
  if (units === 'mm') return String(round(mm, 1))
  return formatLength(mm, units)
}
function dimensionCopy(
  overall: number,
  cut: number,
  units: IsoDocument['units'],
  mode: IsoDocument['dimensionMode']
): { primary: string; secondary?: string } {
  const overallText = compactLength(overall, units),
    cutText = compactLength(cut, units),
    differ = Number.isFinite(overall) && Number.isFinite(cut) && Math.abs(overall - cut) > 0.05
  if (mode === 'cut') return { primary: 'CUT ' + cutText }
  if (mode === 'overall' || !differ) return { primary: overallText }
  return { primary: overallText, secondary: 'CUT ' + cutText }
}

export function createDrawing(
  doc: IsoDocument,
  spool = '',
  view: 'iso' | 'plan' | 'front' | 'side' = 'iso',
  hold?: SheetFit,
  options?: { model?: boolean }
): Drawing {
  const model = options?.model === true
  const facing = model ? 'iso' : view
  const runs = doc.runs.filter(r => !spool || r.spool === spool),
    nodes = doc.nodes.filter(n =>
      runs.some(
        r => r.from === n.id || r.to === n.id || r.id === n.associatedRunId
      )
    )
  const project = (p: Vec3): Point =>
    facing === 'plan'
      ? [p[0], -p[1]]
      : facing === 'front'
        ? [p[0], -p[2]]
        : facing === 'side'
          ? [p[1], -p[2]]
          : isoProject(p, doc.north)
  const W = model ? 1100 : sheetWidth(doc),
    dx = W - 1100,
    cx = model ? 550 : 410 + dx / 2
  const raw = nodes.map(n => project(n.position))
  const xs = raw.map(p => p[0]),
    ys = raw.map(p => p[1])
  const minX = raw.length ? Math.min(...xs) : 0,
    minY = raw.length ? Math.min(...ys) : 0,
    maxX = raw.length ? Math.max(...xs) : 1,
    maxY = raw.length ? Math.max(...ys) : 1
  const fit: SheetFit = model
    ? { centre: [0, 0], scale: 0.3 }
    : hold ?? {
        centre: [(maxX + minX) / 2, (maxY + minY) / 2],
        scale: nodes.length
          ? Math.min((660 + dx) / Math.max(1, maxX - minX), 420 / Math.max(1, maxY - minY))
          : 0.3
      }
  const scale = fit.scale
  const toPoint = (q: Point): Point =>
    model
      ? [q[0] * 0.3 + 550, q[1] * 0.3 + 425]
      : [(q[0] - fit.centre[0]) * scale + cx, (q[1] - fit.centre[1]) * scale + 360]
  const positions = new Map(
    nodes.map((n, i) => [n.id, toPoint(raw[i])] as [string, Point])
  )
  const d: Drawing = {
    width: W,
    height: SHEET_HEIGHT,
    area: model ? [0, 0, W, SHEET_HEIGHT] : [50, 115, 780 + dx, 630],
    fit,
    primitives: [],
    positions,
    view: facing,
    project: p => toPoint(project(p))
  }
  const line = (a: Point, b: Point, layer = 'PIPE', owner?: string) =>
    d.primitives.push({ type: 'line', a, b, layer, owner })
  const boxes: Array<[number, number, number, number]> = []
  const textWidth = (value: string, size: number) => value.length * size * 0.62
  const overlaps = (box: [number, number, number, number]) =>
    boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])
  const text = (
    p: Point,
    value: string,
    size = 12,
    layer = 'TEXT',
    owner?: string,
    role?: 'overall' | 'cut'
  ) => {
    boxes.push([p[0] - 1, p[1] - size - 1, p[0] + textWidth(value, size) + 1, p[1] + 2])
    d.primitives.push({ type: 'text', p, text: value, size, layer, owner, role })
    return p
  }
  /** Centres a short note on a point. On a sheet, keeps it inside the model viewport. */
  const note = (
    center: Point,
    value: string,
    size: number,
    layer: string,
    owner?: string,
    role?: 'overall' | 'cut'
  ) => {
    const width = textWidth(value, size)
    let left = center[0] - width / 2,
      baseline = center[1] + size * 0.32
    if (!model) {
      const [x0, , x1] = d.area
      left = Math.max(x0, Math.min(left, x1 - width))
      baseline = Math.max(150, Math.min(baseline, 625))
    }
    return text([left, baseline], value, size, layer, owner, role)
  }
  const free = (center: Point, value: string, size: number) => {
    const width = textWidth(value, size)
    let left = center[0] - width / 2,
      baseline = center[1] + size * 0.32
    if (!model) {
      const [x0, , x1] = d.area
      left = Math.max(x0, Math.min(left, x1 - width))
      baseline = Math.max(150, Math.min(baseline, 625))
    }
    return !overlaps([left - 1, baseline - size - 1, left + width + 1, baseline + 2])
  }
  const circle = (p: Point, r: number, layer = 'SYMBOL', owner?: string) => {
    d.primitives.push({ type: 'circle', p, r, layer, owner })
    if (owner) boxes.push([p[0] - r - 2, p[1] - r - 2, p[0] + r + 2, p[1] + r + 2])
  }
  const rect = (x: number, y: number, w: number, h: number) => {
    line([x, y], [x + w, y], 'BORDER')
    line([x + w, y], [x + w, y + h], 'BORDER')
    line([x + w, y + h], [x, y + h], 'BORDER')
    line([x, y + h], [x, y], 'BORDER')
  }
  if (!model) {
    rect(20, 20, W - 40, 810)
    text(
      [40, 48],
      doc.title.length > 55 ? doc.title.slice(0, 54) + '…' : doc.title,
      22
    )
    text(
      [40, 72],
      `${doc.drawing}  |  ${spool || 'All spools'}  |  Revision ${doc.revision}`,
      13
    )
    text(
      [40, 94],
      `${doc.customer}${doc.project ? '  /  ' + doc.project : ''}`,
      12
    )
  }
  const allBom = bom(doc)
  const partMap = new Map<string, number>()
  for (const n of nodes) {
    const edge =
      connected(doc, n.id)[0] ?? doc.runs.find(r => r.id === n.associatedRunId)
    if (!edge) continue
    partMap.set(n.id, allBom.find(r => r.memberIds?.includes(n.id))?.item ?? 0)
  }
  const move = (p: Point, n: Point, s: number): Point => [p[0] + n[0] * s, p[1] + n[1] * s]
  const pipes = runs.filter(r => {
    if (r.connector) {
      const a = positions.get(r.from),
        b = positions.get(r.to)
      if (a && b) line(a, b, 'SYMBOL', r.id)
      return false
    }
    return positions.has(r.from) && positions.has(r.to)
  })
  const signature = (r: (typeof pipes)[number]) => r.nps + '\0' + r.specId
  const parent = new Map(pipes.map(r => [r.id, r.id]))
  const find = (id: string): string => {
    let x = id
    while (parent.get(x) !== x) x = parent.get(x)!
    return x
  }
  const atNode = new Map<string, typeof pipes>()
  for (const r of pipes)
    for (const end of [r.from, r.to]) atNode.set(end, [...(atNode.get(end) ?? []), r])
  for (const list of atNode.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (signature(list[i]) === signature(list[j])) {
          const pa = find(list[i].id),
            pb = find(list[j].id)
          if (pa !== pb) parent.set(pa, pb)
        }
  const spanOf = (r: (typeof pipes)[number]) => {
    const a = positions.get(r.from)!,
      b = positions.get(r.to)!
    return Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  const callout = new Set<string>()
  const groups = new Map<string, typeof pipes>()
  for (const r of pipes) {
    const g = find(r.id)
    groups.set(g, [...(groups.get(g) ?? []), r])
  }
  for (const list of groups.values())
    callout.add(list.reduce((a, b) => (spanOf(b) > spanOf(a) ? b : a)).id)
  const dimNormal = new Map<string, Point>()
  const geometry = pipes.map(r => {
    const a = positions.get(r.from)!,
      b = positions.get(r.to)!
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = Math.hypot(dx, dy) || 1
    const dir: Point = [dx / len, dy / len],
      up: Point = [-dir[1], dir[0]],
      down: Point = [dir[1], -dir[0]]
    const normal = up[1] + up[0] * 0.02 <= down[1] + down[0] * 0.02 ? up : down
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    return { r, a, b, dir, normal, mid, len }
  })
  const blocked = (mid: Point, normal: Point, dir: Point, self: string) =>
    geometry.some(o => {
      if (o.r.id === self) return false
      const vx = o.mid[0] - mid[0],
        vy = o.mid[1] - mid[1]
      const side = vx * normal[0] + vy * normal[1],
        along = vx * dir[0] + vy * dir[1]
      return side > 3 && side < 34 && Math.abs(along) < o.len / 2 + 40
    })
  for (const g of geometry) {
    const flip: Point = [-g.normal[0], -g.normal[1]]
    if (blocked(g.mid, g.normal, g.dir, g.r.id) && !blocked(g.mid, flip, g.dir, g.r.id))
      g.normal = flip
    dimNormal.set(g.r.id, g.normal)
    line(g.a, g.b, 'PIPE', g.r.id)
    const copy = dimensionCopy(
      runResult(doc, g.r).overall,
      runResult(doc, g.r).cut,
      doc.units,
      doc.dimensionMode
    )
    const primary = 10.5,
      off = 16,
      width = textWidth(copy.primary, primary),
      primaryRole = doc.dimensionMode === 'cut' ? 'cut' : 'overall'
    if (g.len > width + 22) {
      const gap = width / 2 + 5,
        centre = move(g.mid, g.normal, off)
      line(move(g.a, g.normal, off), move(centre, g.dir, -gap), 'DIM', g.r.id)
      line(move(centre, g.dir, gap), move(g.b, g.normal, off), 'DIM', g.r.id)
      line(move(g.a, g.normal, 4), move(g.a, g.normal, off + 3), 'DIM', g.r.id)
      line(move(g.b, g.normal, 4), move(g.b, g.normal, off + 3), 'DIM', g.r.id)
      note(centre, copy.primary, primary, 'DIM', g.r.id, primaryRole)
      if (copy.secondary) note([centre[0], centre[1] + 12], copy.secondary, 8, 'DIM', g.r.id, 'cut')
    } else {
      const at = move(g.mid, g.normal, off)
      note(at, copy.primary, primary, 'DIM', g.r.id, primaryRole)
      if (copy.secondary) note([at[0], at[1] + 12], copy.secondary, 8, 'DIM', g.r.id, 'cut')
    }
    if (callout.has(g.r.id)) {
      const value = `${g.r.nps}″ ${g.r.specId}`,
        spots = [move(g.mid, g.normal, -14), move(g.a, g.normal, -14), move(g.b, g.normal, -14)]
      note(spots.find(s => free(s, value, 9)) ?? spots[0], value, 9, 'TEXT', g.r.id)
    }
  }
  function symbol(n: PipeNode, p: Point) {
    const edges = connected(doc, n.id),
      edge = edges[0] ?? doc.runs.find(r => r.id === n.associatedRunId)
    const neighbour = edge
      ? positions.get(edge.from === n.id ? edge.to : edge.from)
      : undefined
    const delta: Point = n.associatedRunId && edge
      ? [positions.get(edge.to)![0] - positions.get(edge.from)![0], positions.get(edge.to)![1] - positions.get(edge.from)![1]]
      : neighbour
      ? [neighbour[0] - p[0], neighbour[1] - p[1]]
      : [1, 0]
    const norm = Math.hypot(...delta) || 1,
      u: Point = [delta[0] / norm, delta[1] / norm],
      v: Point = [-u[1], u[0]]
    const at = (x: number, y: number): Point => [
      p[0] + u[0] * x + v[0] * y,
      p[1] + u[1] * x + v[1] * y
    ]
    const l = (a: Point, b: Point) => line(a, b, 'SYMBOL', n.id)
    if (['valve', 'flange', 'gasket', 'reducer', 'cap', 'support', 'bolt', 'olet', 'annotation'].includes(n.kind)) {
      const code = n.component ?? doc.specs.flatMap(s => s.fittings).find(f => f.id === n.catalogId)?.component
      for (const stroke of symbolStrokes(code, n.kind)) {
        if ('l' in stroke) l(at(stroke.l[0], stroke.l[1]), at(stroke.l[2], stroke.l[3]))
        else if ('c' in stroke) circle(at(stroke.c[0], stroke.c[1]), stroke.c[2], 'SYMBOL', n.id)
        else text(at(stroke.at[0], stroke.at[1]), stroke.t, stroke.size ?? 9, 'SYMBOL', n.id)
      }
    } else if (n.kind === 'elbow90' || n.kind === 'elbow45') {
      circle(p, 6, 'SYMBOL', n.id)
    } else if (n.kind === 'tee' || n.kind === 'olet') {
      circle(p, 7, 'SYMBOL', n.id)
      text(
        [p[0] - 3, p[1] + 4],
        n.kind === 'tee' ? 'T' : 'O',
        9,
        'SYMBOL',
        n.id
      )
    } else if (n.kind === 'bolt') {
      text([p[0] - 5, p[1] + 4], 'B', 10, 'SYMBOL', n.id)
    } else if (n.kind !== 'weld') circle(p, 3, 'SYMBOL', n.id)
  }
  for (const n of nodes) symbol(n, positions.get(n.id)!)
  for (const w of welds(doc).filter(w => runs.some(r => r.id === w.runId))) {
    const p = d.project(w.position)
    const host = dimNormal.get(w.runId) ?? ([0, -1] as Point)
    const away: Point = [-host[0], -host[1]],
      tangent: Point = [-away[1], away[0]]
    circle(p, w.field ? 4.2 : 2.6, 'WELD', w.nodeId)
    if (w.field) circle(p, 6.2, 'WELD', w.nodeId)
    const spots: Point[] = []
    for (const slide of [0, 12, -12, 24, -24])
      for (const side of [1, -1]) spots.push(move(move(p, away, 16 * side), tangent, slide))
    note(spots.find(s => free(s, w.tag, 8.5)) ?? spots[0], w.tag, 8.5, 'WELD', w.nodeId)
  }
  for (const n of nodes) {
    const part = partMap.get(n.id)
    if (!part) continue
    const p = positions.get(n.id)!
    const host =
      connected(doc, n.id).map(e => dimNormal.get(e.id)).find(Boolean) ??
      ([0, -1] as Point)
    const value = String(part)
    const custom = n.labelOffset && (n.labelOffset[0] !== 24 || n.labelOffset[1] !== -24)
    const dest = custom
      ? ([p[0] + n.labelOffset![0], p[1] + n.labelOffset![1]] as Point)
      : ([0, 0.55, -0.55, 1.15, -1.15, 2.2, Math.PI, 2.6]
          .map(angle => {
            const c = Math.cos(angle),
              s = Math.sin(angle)
            return move(p, [host[0] * c - host[1] * s, host[0] * s + host[1] * c], 30)
          })
          .find(s => !overlaps([s[0] - 11, s[1] - 11, s[0] + 11, s[1] + 11])) ?? move(p, host, 30))
    const vx = dest[0] - p[0],
      vy = dest[1] - p[1],
      mag = Math.hypot(vx, vy) || 1
    line(p, [dest[0] - (vx / mag) * 8, dest[1] - (vy / mag) * 8], 'BOM', n.id)
    circle(dest, 8, 'BOM', n.id)
    note(dest, value, 9, 'BOM', n.id)
  }
  if (!model) {
  const north = project([0, 1, 0]),
    northLength = Math.hypot(...north)
  if (northLength > 0.001) {
    const u: Point = [north[0] / northLength, north[1] / northLength],
      v: Point = [-u[1], u[0]]
    const tip: Point = [745 + dx + u[0] * 22, 82 + u[1] * 22]
    line([745 + dx, 82], tip, 'TEXT')
    for (const sign of [-1, 1])
      line(
        tip,
        [
          tip[0] - u[0] * 8 + v[0] * 4 * sign,
          tip[1] - u[1] * 8 + v[1] * 4 * sign
        ],
        'TEXT'
      )
    text([tip[0] + u[0] * 12 - 4, tip[1] + u[1] * 12 + 4], 'N', 13)
  }
  text([815 + dx, 126], 'BILL OF MATERIALS', 13)
  text([810 + dx, 146], '#   DESCRIPTION                 NPS      QTY', 10)
  line([805 + dx, 155], [1060 + dx, 155], 'BORDER')
  const shown = allBom.filter(row => !spool || row.spool === spool)
  for (const [i, r] of shown.slice(0, 23).entries()) {
    const y = 175 + i * 19
    text([810 + dx, y], String(r.item), 10)
    text(
      [835 + dx, y],
      r.description.length > 25
        ? r.description.slice(0, 24) + '…'
        : r.description,
      9
    )
    text([990 + dx, y], String(r.nps), 10)
    text(
      [1032 + dx, y],
      `${Number.isFinite(r.qty) ? round(r.qty, 2) : 'MISSING'} ${r.unit}`,
      9
    )
  }
  if (shown.length > 23)
    text([810 + dx, 625], `+${shown.length - 23} rows: see material schedule`, 10)
  rect(35, 650, W - 70, 160)
  line([35, 705], [W - 35, 705], 'BORDER')
  line([700 + dx, 650], [700 + dx, 810], 'BORDER')
  text(
    [48, 673],
    `DRAWING: ${doc.drawing}     SPOOL: ${spool || 'ALL'}     REV: ${doc.revision}`,
    12
  )
  text([48, 694], `DRAWN: ${doc.drawnBy}     CHECKED: ${doc.checkedBy}`, 11)
  text([715 + dx, 673], 'SPOOLYARD  /  PIPING ISOMETRIC', 15)
  text(
    [715 + dx, 694],
    `${view.toUpperCase()} VIEW · ${doc.units === 'mm' ? 'METRIC' : 'IMPERIAL'}`,
    11
  )
  const noteLines = doc.notes
    .split('\n')
    .flatMap(s => s.match(new RegExp(`.{1,${90 + Math.floor(dx / 6)}}`, 'g')) ?? [''])
    .slice(0, 5)
  noteLines.forEach((s, i) => text([48, 728 + i * 15], s, 11))
  text([715 + dx, 727], 'DIMENSIONS GOVERN · NOT TO SCALE', 10)
  text([715 + dx, 746], 'ALL LENGTHS TO CENTRELINES UNLESS NOTED', 9)
  text([715 + dx, 765], 'CUT = OVERALL - FITTINGS - ROOT GAPS', 9)
  text(
    [715 + dx, 789],
    `ROOT GAP: ${[...new Set(doc.specs.map(s => formatLength(s.rootGap, doc.units)))].join(' / ')}`,
    10
  )
  }
  // Break drafting lines around annotation text so every export remains legible,
  // including legacy DWG versions without MTEXT background masks.
  const clearances = d.primitives
    .filter(
      (p): p is Extract<Primitive, { type: 'text' }> =>
        p.type === 'text' &&
        !!p.owner &&
        ['DIM', 'TEXT', 'WELD', 'BOM'].includes(p.layer)
    )
    .map(p => [
      p.p[0] - 2,
      p.p[1] - p.size - 1,
      p.p[0] + p.text.length * p.size * 0.62 + 2,
      p.p[1] + 3
    ])
  const clip = (a: Point, b: Point, box: number[]): Array<[Point, Point]> => {
    const delta: Point = [b[0] - a[0], b[1] - a[1]]
    let enter = 0,
      leave = 1
    for (const axis of [0, 1]) {
      if (Math.abs(delta[axis]) < 1e-9) {
        if (a[axis] < box[axis] || a[axis] > box[axis + 2]) return [[a, b]]
      } else {
        const t1 = (box[axis] - a[axis]) / delta[axis],
          t2 = (box[axis + 2] - a[axis]) / delta[axis]
        enter = Math.max(enter, Math.min(t1, t2))
        leave = Math.min(leave, Math.max(t1, t2))
      }
    }
    if (enter >= leave) return [[a, b]]
    const at = (t: number): Point => [a[0] + delta[0] * t, a[1] + delta[1] * t]
    const segments: Array<[Point, Point]> = []
    if (enter > 0) segments.push([a, at(enter)])
    if (leave < 1) segments.push([at(leave), b])
    return segments
  }
  d.primitives = d.primitives.flatMap(p => {
    if (p.type !== 'line' || p.layer === 'BORDER') return [p]
    let pieces: Array<[Point, Point]> = [[p.a, p.b]]
    for (const box of clearances)
      pieces = pieces.flatMap(([a, b]) => clip(a, b, box))
    return pieces.map(([a, b]) => ({ ...p, a, b }))
  })
  d.primitives.sort(
    (a, b) => Number(a.type === 'text') - Number(b.type === 'text')
  )
  return d
}
export function drawingSvg(
  d: Drawing,
  selected = '',
  interactive = false,
  grid?: { settings: GridSettings; anchor: Vec3; units?: IsoDocument['units'] }
): string {
  const shape = (p: Primitive) => {
    const attrs = `data-owner="${escape(p.owner ?? '')}" class="${p.layer.toLowerCase()}${p.owner === selected ? ' selected' : ''}"`
    if (p.type === 'line')
      return `<line ${attrs} x1="${p.a[0]}" y1="${p.a[1]}" x2="${p.b[0]}" y2="${p.b[1]}" stroke-width="${p.layer === 'PIPE' ? 2.2 : p.layer === 'SYMBOL' ? 1.6 : 0.75}"/>`
    if (p.type === 'circle')
      return `<circle ${attrs} cx="${p.p[0]}" cy="${p.p[1]}" r="${p.r}" fill="white"/>`
    return `<text ${attrs} x="${p.p[0]}" y="${p.p[1]}" font-size="${p.size}">${escape(p.text)}</text>`
  }
  const hits = interactive
    ? [...d.positions]
        .map(
          ([key, p]) =>
            `<circle data-node="${escape(key)}" cx="${p[0]}" cy="${p[1]}" r="14" fill="transparent" stroke="none" class="node-hit"/>`
        )
        .join('')
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.width} ${d.height}" role="img" aria-label="Piping isometric drawing" style="background:white;color:#17212c"><style>text{font-family:Arial,sans-serif;fill:#17212c;paint-order:stroke fill;stroke:#fff;stroke-width:3px;stroke-linejoin:round}text.dim{fill:#31404c}text.text{fill:#6d7a86}text.weld{fill:#0c6880;font-weight:600}text.bom{fill:#1c2b38;font-weight:600}text.symbol{stroke:none}line,circle{stroke:#17212c}line.pipe{stroke:#1c2b38}line.dim{stroke:#8ea4b4}line.weld,circle.weld{stroke:#0c6880}line.bom,circle.bom{stroke:#607180}.selected{stroke:#087fbe}text.selected{fill:#087fbe}.node-hit{cursor:pointer;stroke:none!important}.iso-grid-line{stroke:#c6dbea;stroke-width:0.6}.iso-grid-line.major{stroke:#a5c8df;stroke-width:0.85}.iso-grid-caption{fill:#4f7289}.grid-cursor{stroke:#087fbe;fill:#087fbe;pointer-events:none}text{user-select:none}</style>${interactive && grid ? gridSvg(d, grid.anchor, grid.settings, grid.units) : ''}${d.primitives.map(shape).join('')}${hits}${interactive ? '<g data-grid-cursor pointer-events="none"></g>' : ''}</svg>`
}
