import type { Point } from '../drawing'
import type { IsoDocument, PipeNode, PipeRun, Vec3 } from '../model'
import { axisComponents, drawingAxes, ZERO_LEG, type View } from './layout'

/**
 * Drafting paper. A not-to-scale sheet is drafted on a lattice laid on the paper itself, from the sheet's own origin:
 * isometric paper (lines at 30°, 150° and vertical) for an isometric, square paper for a plan or elevation. Every
 * change of direction, branch and end of pipe sits on a lattice point and every straight leg runs along lattice lines,
 * so the piping cannot leave the paper's lattice; it does not depend on plant coordinates or on any one drawing.
 */

const COS30 = Math.cos(Math.PI / 6)
/** Paper height in inches, for a cell given as a length on the printed sheet. */
const PAPER_HEIGHT_IN = { letter: 8.5, tabloid: 11, a3: 297 / 25.4, a4: 210 / 25.4 } as const
export const DEFAULT_PAPER_CELL_IN = 0.25
/** The finest paper cell a drawing may choose (in), and so the finest a crowded sheet is subdivided to. */
export const MIN_PAPER_CELL_IN = 0.05
/** One lattice cell in sheet units (sheets are 850 units tall). */
export function paperCell(doc: Pick<IsoDocument, 'paper'> & { style?: { paperGrid?: number } }, sheetHeight = 850): number {
  const inches = doc.style?.paperGrid ?? DEFAULT_PAPER_CELL_IN
  return inches * sheetHeight / PAPER_HEIGHT_IN[doc.paper ?? 'tabloid']
}

/**
 * The paper a view is drafted on: the page step of one cell along each drawing axis (east, north and up after the
 * drawing's quarter turn), zero for an axis seen end-on. Isometric paper's up step is the sum of the other two.
 */
export interface PaperLattice {
  kind: 'iso' | 'square'
  cell: number
  steps: [Point, Point, Point]
}
export function paperLattice(view: View, cell: number): PaperLattice {
  const c = cell
  switch (view) {
    case 'plan': return { kind: 'square', cell, steps: [[c, 0], [0, -c], [0, 0]] }
    case 'front': return { kind: 'square', cell, steps: [[c, 0], [0, 0], [0, -c]] }
    case 'side': return { kind: 'square', cell, steps: [[0, 0], [c, 0], [0, -c]] }
    default: return { kind: 'iso', cell, steps: [[c * COS30, -c / 2], [-c * COS30, -c / 2], [0, -c]] }
  }
}
/** The directions of the lattice's lines on the page, as unit vectors (one per family). */
export const latticeDirections = (lattice: Pick<PaperLattice, 'kind'>): Point[] =>
  lattice.kind === 'iso' ? [[COS30, -0.5], [-COS30, -0.5], [0, -1]] : [[1, 0], [0, -1]]
/** Lattice steps: east along 30°, north along 150°, up vertical (sheet y grows downward). */
export const latticeSteps = (cell: number): Point[] => {
  const e: Point = [cell * COS30, -cell / 2], n: Point = [-cell * COS30, -cell / 2], u: Point = [0, -cell]
  return [e, n, u, [-e[0], -e[1]], [-n[0], -n[1]], [-u[0], -u[1]]]
}
/** Isometric lattice coordinates of a sheet point: p = a·east + b·north. */
const coords = ([x, y]: Point, cell: number): Point => {
  const k = cell * COS30, h = cell / 2
  return [(x / k - y / h) / 2, (-y / h - x / k) / 2]
}
const at = (a: number, b: number, cell: number): Point => [cell * COS30 * (a - b), -cell / 2 * (a + b)]
/** The isometric lattice point nearest a sheet point. */
export function nearestLatticePoint(p: Point, cell: number): Point {
  const [a, b] = coords(p, cell)
  let best: Point = at(Math.round(a), Math.round(b), cell), gap = Infinity
  for (const i of [Math.floor(a), Math.ceil(a)]) for (const j of [Math.floor(b), Math.ceil(b)]) {
    const q = at(i, j, cell), d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (d < gap) { gap = d; best = q }
  }
  return best
}
/** The point of a paper's lattice nearest a sheet point. */
export function nearestPaperPoint(p: Point, lattice: Pick<PaperLattice, 'kind' | 'cell'>): Point {
  if (lattice.kind === 'iso') return nearestLatticePoint(p, lattice.cell)
  return [Math.round(p[0] / lattice.cell) * lattice.cell, Math.round(p[1] / lattice.cell) * lattice.cell]
}
/** Whether a sheet point is on a paper's lattice. */
export const onPaperLattice = (p: Point, lattice: Pick<PaperLattice, 'kind' | 'cell'>, tolerance = 1e-6) => {
  const q = nearestPaperPoint(p, lattice)
  return Math.hypot(p[0] - q[0], p[1] - q[1]) <= tolerance * Math.max(1, lattice.cell)
}

/** Something about the drafting the drawing reports rather than hides. */
export interface LatticeNotice {
  kind: 'offset-direction' | 'overlap' | 'touch' | 'coincide' | 'order'
  /** The node or pipe it concerns. */
  id?: string
  message: string
}
export interface LatticeEmbedding {
  /** Sheet position of every node given. */
  positions: Map<string, Point>
  /** Whole-cell coordinates along the drawing axes of each node on the lattice (branch points, turns, ends, olets). */
  cells: Map<string, Vec3>
  notices: LatticeNotice[]
}
export interface LatticeInput {
  runs: PipeRun[]
  /** The sheet's nodes: plant position and, for a component on a pipe, the pipe. */
  nodes: Array<Pick<PipeNode, 'id' | 'position' | 'associatedRunId'>>
  /** Where each node is wanted on the sheet: the not-to-scale layout, with the drafter's held positions. */
  desired: Map<string, Point>
  lattice: PaperLattice
  /** The drawing's rotation; only its quarter turn turns the paper axes. */
  north?: number
  /** A pipe's own run in the plant, end to end (between its port points); its end nodes' positions by default. */
  runDelta?: (run: PipeRun) => Vec3
}

/** sin 10°: an offset must lean at least this far off every lattice line, or it reads as a straight pipe. */
const LEAN = Math.sin(10 * Math.PI / 180)
/** Most cells, not whole, along an offset counted for where to lengthen it (see `fewestCrossing`). */
const CUT_CELLS = 4096
/** Most moves made to clear pipes lying on one another before the rest are reported. */
const REPAIRS = 48
/**
 * Largest whole-cell step along an axis tried for an offset's direction: enough for every direction clear of the
 * lattice lines, few enough that one step is never long beside the legs around it.
 */
const OFFSET_STEPS = 4
/** Weight of an offset's misfit in length (a share of it) against its misfit in angle (radians). */
const PROPORTION = 0.3

interface Leg {
  from: string
  to: string
  /** Every node along it, ends included, in order. */
  nodes: string[]
  runs: PipeRun[]
  /** Plant length along each drawing axis from `from` to `to`; zero where it does not move. */
  d: Vec3
  /** Drawing axes it moves along. */
  axes: number[]
}

/**
 * Embeds a not-to-scale sheet in the paper's lattice. Every turn, branch, end and olet gets whole-cell coordinates
 * along each drawing axis: nodes joined by pipe square to an axis share their coordinate on it (so a loop closes by
 * construction), the coordinates along an axis keep the order the layout gives them and stay at least one cell
 * apart (so distinct parallel legs never merge onto one line), and each is the layout's position rounded. Lengths
 * therefore follow the layout, cumulatively. Olets sit on lattice points of their header, clear of its ends; parallel
 * rolling offsets are drawn in one lattice direction that leans clearly off the lattice lines; pipes that would lie
 * on one another, end on unrelated pipe or meet another's end on the page are pushed apart a cell at a time.
 * Components in a straight (valves, flange pairs) keep their place along it in proportion, and attachments their
 * place on their pipe.
 */
export function embedOnLattice(input: LatticeInput): LatticeEmbedding {
  const { lattice } = input, notices: LatticeNotice[] = []
  /** Where each node is wanted, moved with its part onto the lattice. */
  const goal = new Map(input.desired), cells = new Map<string, Vec3>()
  const steps = lattice.steps, live = [0, 1, 2].filter(k => Math.hypot(...steps[k]) > 1e-12)
  if (!(lattice.cell > 0)) return { positions: goal, cells, notices }
  const nodeOf = new Map(input.nodes.map(n => [n.id, n]))
  const runs = input.runs.filter(r => r.from !== r.to && input.desired.has(r.from) && input.desired.has(r.to) && nodeOf.has(r.from) && nodeOf.has(r.to))
  if (!runs.length) return { positions: goal, cells, notices }
  const runOf = new Map(runs.map(r => [r.id, r]))
  const plant = (id: string) => drawingAxes(nodeOf.get(id)!.position, input.north)
  const delta = (a: string, b: string): Vec3 => { const p = plant(a), q = plant(b); return [q[0] - p[0], q[1] - p[1], q[2] - p[2]] }
  const desired = (id: string) => goal.get(id)!
  const runs3 = new Map(runs.map(r => {
    const d = input.runDelta?.(r) ?? (() => { const a = nodeOf.get(r.from)!.position, b = nodeOf.get(r.to)!.position; return [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as Vec3 })()
    return [r.id, drawingAxes(d, input.north)]
  }))
  /** A pipe's run in drawing axes, leaving a node. */
  const leaving = (r: PipeRun, id: string): Vec3 => { const d = runs3.get(r.id)!, s = r.from === id ? 1 : -1; return [s * d[0], s * d[1], s * d[2]] }
  const edges = new Map<string, PipeRun[]>()
  for (const r of runs) for (const id of [r.from, r.to]) edges.set(id, [...(edges.get(id) ?? []), r])
  const other = (r: PipeRun, id: string) => r.from === id ? r.to : r.from
  // A component on a pipe that a branch leaves from (an olet) is a point of the lattice on its header.
  const hostOf = (id: string) => { const h = nodeOf.get(id)?.associatedRunId; return h ? runOf.get(h) : undefined }
  const isLattice = (id: string) => {
    const list = edges.get(id) ?? []
    if (!list.length) return false
    if (hostOf(id) || list.length !== 2) return true
    const u = leaving(list[0], id), v = leaving(list[1], id)
    const lu = Math.hypot(...u), lv = Math.hypot(...v)
    // A straight through (in-line valve, flange pair, weld) is not; a turn is.
    return !(lu > 0 && lv > 0 && (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv) < -0.999999)
  }
  const points = [...edges.keys()].filter(isLattice)
  const pointSet = new Set(points)
  // Legs: from a lattice point through in-line components to the next.
  const walked: Leg[] = [], legOfRun = new Map<string, Leg>()
  const walk = (start: string, first: PipeRun) => {
    const nodes = [start], legRuns = [first]
    let run = first, cur = other(first, start)
    while (!pointSet.has(cur)) {
      nodes.push(cur)
      const onward = edges.get(cur)!.find(r => r !== run)
      if (!onward || legOfRun.has(onward.id) || legRuns.includes(onward)) break
      run = onward; legRuns.push(run); cur = other(run, cur)
    }
    if (!pointSet.has(cur)) { pointSet.add(cur); points.push(cur) }
    nodes.push(cur)
    const d: Vec3 = [0, 0, 0]
    legRuns.forEach((r, i) => { const e = leaving(r, nodes[i]); for (const k of [0, 1, 2]) d[k] += e[k] })
    const leg: Leg = { from: start, to: cur, nodes, runs: legRuns, d, axes: axisComponents(d) }
    walked.push(leg)
    for (const r of legRuns) legOfRun.set(r.id, leg)
  }
  for (let i = 0; i < points.length; i++) for (const r of edges.get(points[i]) ?? []) if (!legOfRun.has(r.id)) walk(points[i], r)
  // A ring of in-line parts only (impossible in a real plant) still gets a lattice point.
  for (const r of runs) if (!legOfRun.has(r.id)) { pointSet.add(r.from); points.push(r.from); walk(r.from, r) }
  const length3 = (v: Vec3) => Math.hypot(...v)
  const zero = (leg: Leg) => length3(leg.d) < ZERO_LEG
  // An olet is a lattice point on its header: the header is drafted as legs to and from it, so it sits on the
  // header's line (straight or a rolling offset) a whole number of steps from either end, in order along it.
  const along = (leg: Leg, id: string) => {
    const l2 = leg.d[0] ** 2 + leg.d[1] ** 2 + leg.d[2] ** 2, p = delta(leg.from, id)
    return l2 > 1e-12 ? Math.max(0, Math.min(1, (p[0] * leg.d[0] + p[1] * leg.d[1] + p[2] * leg.d[2]) / l2)) : 0
  }
  const oletsOn = new Map<Leg, string[]>()
  for (const id of points) { const h = hostOf(id), leg = h && legOfRun.get(h.id); if (leg) oletsOn.set(leg, [...(oletsOn.get(leg) ?? []), id]) }
  const legs: Leg[] = []
  for (const leg of walked) {
    const olets = oletsOn.get(leg)
    if (!olets) { legs.push(leg); continue }
    const stations = [
      ...leg.nodes.slice(1, -1).map(id => ({ id, t: along(leg, id), point: false })),
      ...olets.map(id => ({ id, t: along(leg, id), point: true }))
    ].sort((a, b) => a.t - b.t || Number(a.point) - Number(b.point))
    let from = { id: leg.from, t: 0 }, inner: string[] = []
    for (const s of [...stations, { id: leg.to, t: 1, point: true }]) {
      if (!s.point) { inner.push(s.id); continue }
      const d = leg.d.map(v => v * (s.t - from.t)) as Vec3
      legs.push({ from: from.id, to: s.id, nodes: [from.id, ...inner, s.id], runs: leg.runs, d, axes: length3(d) < ZERO_LEG ? [] : leg.axes })
      from = s; inner = []
    }
  }

  // Union-find per axis: what shares a coordinate along it.
  const parent = [0, 1, 2].map(() => new Map<string, string>())
  const find = (k: number, id: string): string => {
    const m = parent[k]
    let r = id
    while (m.has(r) && m.get(r) !== r) r = m.get(r)!
    for (let x = id; x !== r;) { const next = m.get(x)!; m.set(x, r); x = next }
    return r
  }
  const union = (k: number, a: string, b: string) => { const x = find(k, a), y = find(k, b); if (x !== y) parent[k].set(y, x) }
  for (const id of points) for (const k of [0, 1, 2]) parent[k].set(id, id)
  for (const leg of legs) for (const k of [0, 1, 2]) if (zero(leg) || !leg.axes.includes(k)) union(k, leg.from, leg.to)

  const page = (c: Vec3): Point => [c[0] * steps[0][0] + c[1] * steps[1][0] + c[2] * steps[2][0], c[0] * steps[0][1] + c[1] * steps[1][1] + c[2] * steps[2][1]]

  // Rolling offsets: one lattice direction per set of parallel offsets, leaning clearly off the lattice lines, each
  // offset a whole number of its steps long.
  const offsets = legs.filter(l => l.axes.length > 1 && !zero(l) && l.axes.filter(k => live.includes(k)).length > 1)
  const classes = new Map<string, Leg[]>()
  for (const leg of offsets) {
    const l = length3(leg.d), u = leg.d.map(v => v / l), s = Math.sign(u.find(v => Math.abs(v) > 1e-9) ?? 1)
    const key = u.map(v => (v * s).toFixed(4)).join()
    classes.set(key, [...(classes.get(key) ?? []), leg])
  }
  const directions = new Map<Leg, { step: Vec3; steps: number }>()
  for (const list of classes.values()) {
    const ref = list[0], refSign = (leg: Leg) => Math.sign(leg.d[ref.axes[0]]) === Math.sign(ref.d[ref.axes[0]]) ? 1 : -1
    // The way the layout draws them.
    const toward: Point = [0, 0]
    for (const leg of list) {
      const a = desired(leg.from), b = desired(leg.to), w: Point = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...w) || 1, s = refSign(leg)
      toward[0] += s * w[0] / l; toward[1] += s * w[1] / l
    }
    const step = bestDirection(list, toward)
    if (!step) { notices.push({ kind: 'offset-direction', id: ref.runs[0].id, message: 'No lattice direction reads as this rolling offset.' }); continue }
    for (const leg of list) {
      const own = step.map(v => v * refSign(leg)) as Vec3
      directions.set(leg, { step: own, steps: desiredSteps(leg, own) })
    }
  }
  /**
   * The lattice direction a set of parallel offsets is drawn in: whole steps along each axis it moves (a few at most,
   * so one step stays short beside the legs around it), leaning clearly off every lattice line. It is the direction
   * nearest the offset's true projection, in proportion: its steps along the axes in the plant's proportions (two
   * directions of isometric paper look alike, but only one keeps the legs either side where they are), and whole
   * steps near the length each is drawn. An offset seen within the lean of a lattice line (a 45° plan offset seen
   * end-on as a riser) is drawn with the drafter's conventional lean: the layout's direction, else the nearest
   * direction that reads as an offset.
   */
  function bestDirection(list: Leg[], toward: Point): Vec3 | undefined {
    const ref = list[0], lines = latticeDirections(lattice), axes = ref.axes.filter(k => live.includes(k))
    const clear = (p: Point) => { const l = Math.hypot(...p); return l > 1e-9 && !lines.some(d => Math.abs(d[0] * p[1] - d[1] * p[0]) / l < LEAN) }
    const truth = page(ref.d), target = clear(truth) ? truth : clear(toward) ? toward : Math.hypot(...truth) > 1e-9 ? truth : toward
    const tl = Math.hypot(...target), wl = Math.hypot(...toward), dl = Math.hypot(...axes.map(k => ref.d[k]))
    const angle = (p: Point, q: number[], ql: number) => ql > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, (p[0] * q[0] + p[1] * q[1]) / (Math.hypot(...p) * ql)))) : 0
    // The length each offset is laid out at, in cells.
    const wants = list.map(leg => { const a = desired(leg.from), b = desired(leg.to); return Math.hypot(b[0] - a[0], b[1] - a[1]) / lattice.cell })
    let best: { v: Vec3; score: number } | undefined
    const visit = (i: number, v: Vec3) => {
      if (i === axes.length) {
        // Common factors give the same direction; the smallest step is the one kept.
        if (gcd(axes.map(k => Math.abs(v[k]))) !== 1) return
        const p = page(v), l = Math.hypot(...p) / lattice.cell
        if (!clear(p)) return
        let misfit = 0
        for (const want of wants) { const m = Math.max(1, Math.round(want / l)); misfit += Math.abs(m * l - want) / Math.max(want, l) }
        const along = axes.reduce((sum, k) => sum + v[k] * ref.d[k], 0) / (Math.hypot(...axes.map(k => v[k])) * dl)
        const score = angle(p, target, tl) + Math.acos(Math.max(-1, Math.min(1, along))) + PROPORTION * misfit / wants.length + 0.01 * angle(p, toward, wl)
        if (!best || score < best.score - 1e-9) best = { v: [...v], score }
        return
      }
      for (let n = 1; n <= OFFSET_STEPS; n++) { v[axes[i]] = Math.sign(ref.d[axes[i]]) * n; visit(i + 1, v) }
    }
    visit(0, [0, 0, 0])
    return best?.v
  }
  function desiredSteps(leg: Leg, step: Vec3) {
    const a = desired(leg.from), b = desired(leg.to), l = Math.hypot(...page(step))
    return Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / l))
  }

  // Desired coordinates (cells along each axis), walked out from one point of each connected part.
  const want = new Map<string, Vec3>()
  const neighbours = new Map<string, Array<{ id: string; leg: Leg }>>()
  const link = (a: string, b: string, leg: Leg) => {
    neighbours.set(a, [...(neighbours.get(a) ?? []), { id: b, leg }])
    neighbours.set(b, [...(neighbours.get(b) ?? []), { id: a, leg }])
  }
  for (const leg of legs) link(leg.from, leg.to, leg)
  // Each part's elevations start from the sheet's lowest, so separate parts stand at their true relative heights.
  let mmPerCell = 0, cellsDrawn = 0
  for (const leg of legs) if (leg.axes.length === 1 && live.includes(leg.axes[0])) {
    const k = leg.axes[0], s = steps[k], a = desired(leg.from), b = desired(leg.to)
    cellsDrawn += Math.abs(((b[0] - a[0]) * s[0] + (b[1] - a[1]) * s[1]) / (s[0] * s[0] + s[1] * s[1])); mmPerCell += Math.abs(leg.d[k])
  }
  const cellsPerMm = mmPerCell > 0 ? cellsDrawn / mmPerCell : 0
  const low = [0, 1, 2].map(k => Math.min(...points.map(id => plant(id)[k])))
  for (const root of points) {
    if (want.has(root)) continue
    // The part is moved so its first point is on the lattice; whole-cell steps from there keep their lengths.
    const p = desired(root), q = nearestPaperPoint(p, lattice), shift: Point = [q[0] - p[0], q[1] - p[1]]
    const part: string[] = [], queue = [root], seen = new Set([root])
    while (queue.length) {
      const u = queue.shift()!
      part.push(u)
      for (const n of neighbours.get(u) ?? []) if (!seen.has(n.id)) { seen.add(n.id); queue.push(n.id) }
    }
    const members = new Set(part)
    for (const [id, p0] of goal) if (members.has(id) || inPart(id, members)) goal.set(id, [p0[0] + shift[0], p0[1] + shift[1]])
    want.set(root, rootCoordinates(root, q))
    for (const u of part) for (const n of neighbours.get(u) ?? []) {
      if (want.has(n.id)) continue
      const from = want.get(u)!, next: Vec3 = [...from]
      {
        const leg = n.leg, forward = leg.from === u ? 1 : -1
        const a = desired(u), b = desired(n.id), w: Point = [b[0] - a[0], b[1] - a[1]]
        if (leg.axes.length === 1) {
          const k = leg.axes[0], s = steps[k], l2 = s[0] * s[0] + s[1] * s[1]
          if (l2 > 0) next[k] += Math.sign(leg.d[k]) * forward * Math.max(0, Math.sign(leg.d[k]) * forward * (w[0] * s[0] + w[1] * s[1]) / l2)
        } else if (leg.axes.length > 1) {
          // A rolling offset keeps its plant proportions, at the length it is drawn.
          const page: Point = [0, 0]
          for (const k of leg.axes) { page[0] += leg.d[k] * steps[k][0]; page[1] += leg.d[k] * steps[k][1] }
          // One drawn in a lattice direction is its whole steps of it along each axis the paper shows.
          const t = Math.hypot(...page) > 1e-12 ? Math.hypot(...w) / Math.hypot(...page) : cellsPerMm, o = directions.get(leg)
          for (const k of leg.axes) next[k] += forward * (o && live.includes(k) ? o.steps * o.step[k] : leg.d[k] * t)
        }
      }
      want.set(n.id, next)
    }
  }
  /** Whether a node in no leg's end list (an in-line part or attachment) belongs to a part. */
  function inPart(id: string, members: Set<string>): boolean {
    if (pointSet.has(id)) return false
    const host = hostOf(id), leg = host ? legOfRun.get(host.id) : (edges.get(id) ?? []).map(r => legOfRun.get(r.id)).find(Boolean)
    return !!leg && members.has(leg.from)
  }
  function rootCoordinates(id: string, q: Point): Vec3 {
    const z = Math.round((plant(id)[2] - low[2]) * cellsPerMm), x = Math.round((plant(id)[0] - low[0]) * cellsPerMm), y = Math.round((plant(id)[1] - low[1]) * cellsPerMm)
    const c = lattice.cell
    if (lattice.kind === 'iso') { const [a, b] = coords(q, c); return [Math.round(a) - z, Math.round(b) - z, z] }
    const u = Math.round(q[0] / c), v = Math.round(-q[1] / c)
    return live.includes(2) ? live.includes(0) ? [u, y, v] : [x, u, v] : [u, v, z]
  }

  /** Lengthens everything at or beyond `from` along an axis by `by` cells: order and closed loops are kept. */
  const insert = (c: Map<string, Vec3>, k: number, from: number, by = 1) => { for (const v of c.values()) if (v[k] >= from) v[k] += by }

  // Whole cells along each axis: each the layout's position rounded, never before one laid out before it, and past
  // what it is joined to along the axis by at least a cell (an offset by its whole steps).
  const coord = new Map<string, Vec3>(points.map(id => [id, [0, 0, 0] as Vec3]))
  const groupsOf: Array<Map<string, string[]>> = [0, 1, 2].map(() => new Map())
  for (const k of [0, 1, 2]) for (const id of points) { const g = find(k, id); groupsOf[k].set(g, [...(groupsOf[k].get(g) ?? []), id]) }
  const rank = new Map(points.map((id, i) => [id, i]))
  for (const k of live) {
    const groups = groupsOf[k], value = new Map<string, number>()
    for (const [g, ids] of groups) value.set(g, ids.reduce((s, id) => s + want.get(id)![k], 0) / ids.length)
    // Order constraints: along each leg on this axis (an olet's header is legs to and from it).
    const after = new Map<string, Array<{ to: string; gap: number }>>(), indegree = new Map<string, number>([...groups.keys()].map(g => [g, 0]))
    const order = (lowId: string, highId: string, gap: number) => {
      const a = find(k, lowId), b = find(k, highId)
      if (a === b) { notices.push({ kind: 'order', id: highId, message: 'Pipe along an axis joins points that share their position on it.' }); return }
      after.set(a, [...(after.get(a) ?? []), { to: b, gap }]); indegree.set(b, indegree.get(b)! + 1)
    }
    // The far end of an offset is where its whole steps put it, not pushed on past them by the order of the points
    // laid out before it: an offset longer on one axis than its steps would be squared by lengthening it on the others.
    const offsetEnds = new Set<string>()
    for (const leg of legs) if (!zero(leg) && leg.axes.includes(k)) {
      const o = directions.get(leg), gap = o ? o.steps * Math.abs(o.step[k]) : 1
      leg.d[k] > 0 ? order(leg.from, leg.to, gap) : order(leg.to, leg.from, gap)
      if (o) offsetEnds.add(find(k, leg.d[k] > 0 ? leg.to : leg.from))
    }
    // Kahn's order, taking the lowest desired value first; a cycle (contradictory geometry) is broken the same way.
    const ready = [...groups.keys()].filter(g => indegree.get(g) === 0), done = new Set<string>(), sorted: string[] = []
    // Ties go by the drawing's own order of its pipes, never by identifiers.
    const lowest = (list: string[]) => list.reduce((i, g, j) => value.get(g)! < value.get(list[i])! || (value.get(g) === value.get(list[i]) && rank.get(g)! < rank.get(list[i])!) ? j : i, 0)
    while (sorted.length < groups.size) {
      let g: string
      if (ready.length) g = ready.splice(lowest(ready), 1)[0]
      else { const rest = [...groups.keys()].filter(x => !done.has(x)); g = rest[lowest(rest)] }
      if (done.has(g)) continue
      done.add(g); sorted.push(g)
      for (const e of after.get(g) ?? []) { indegree.set(e.to, indegree.get(e.to)! - 1); if (indegree.get(e.to) === 0 && !done.has(e.to)) ready.push(e.to) }
    }
    const least = new Map<string, number>()
    let last = -Infinity
    for (const g of sorted) {
      const x = Math.max(Math.round(value.get(g)!), offsetEnds.has(g) ? -Infinity : last, least.get(g) ?? -Infinity)
      for (const id of groups.get(g)!) coord.get(id)![k] = x
      for (const e of after.get(g) ?? []) least.set(e.to, Math.max(least.get(e.to) ?? -Infinity, x + e.gap))
      last = Math.max(last, x)
    }
  }

  /**
   * The first whole cell from `lo + 1` to `hi` along an axis that the fewest other offsets cross (an offset crosses
   * cell `x` when it starts before it and ends at or past it), else `hi`. The count only changes a cell past an
   * offset's ends, so on whole cells only those cells are counted: the work grows with the offsets, not with how many
   * cells the offset spans. Cells that are not whole are counted one by one, as many as `CUT_CELLS` of them.
   */
  const fewestCrossing = (leg: Leg, k: number, lo: number, hi: number, c: Map<string, Vec3>): number => {
    const others: Array<[number, number]> = []
    for (const o of directions.keys()) if (o !== leg) { const p = c.get(o.from)![k], q = c.get(o.to)![k]; others.push([Math.min(p, q), Math.max(p, q)]) }
    const crossing = (x: number) => { let n = 0; for (const [m, M] of others) if (m < x && M >= x) n++; return n }
    const whole = (v: number) => Number.isInteger(v) && Math.abs(v) < 2 ** 50
    let cut = hi, fewest = Infinity
    if (whole(lo) && whole(hi) && others.every(([m, M]) => whole(m) && whole(M))) {
      const cells = new Set<number>()
      for (const x of [lo + 1, ...others.flatMap(([m, M]) => [m + 1, M + 1])]) if (x >= lo + 1 && x <= hi) cells.add(x)
      for (const x of [...cells].sort((a, b) => a - b)) { const n = crossing(x); if (n < fewest) { fewest = n; cut = x } }
      return cut
    }
    for (let x = lo + 1, i = 0; x <= hi && i < CUT_CELLS; x++, i++) { const n = crossing(x); if (n < fewest) { fewest = n; cut = x } }
    return cut
  }
  /** Lengthens offsets to whole steps of their direction where other cells pushed them; a few passes, no more. */
  const squareOffsets = (c: Map<string, Vec3>) => {
    for (let round = 0; round < 3; round++) {
      let changed = false
      for (const [leg, { step, steps: m0 }] of directions) {
        const a = c.get(leg.from)!, b = c.get(leg.to)!
        const axes = leg.axes.filter(k => live.includes(k))
        const m = Math.max(m0, ...axes.map(k => Math.ceil(Math.abs(b[k] - a[k]) / Math.abs(step[k]) - 1e-9)))
        for (const k of axes) {
          const need = m * Math.abs(step[k]) - Math.abs(b[k] - a[k])
          if (need < 1e-9) continue
          const lo = Math.min(a[k], b[k]), hi = Math.max(a[k], b[k])
          // Where along the offset to cut: where the fewest other offsets cross.
          const cut = fewestCrossing(leg, k, lo, hi, c)
          insert(c, k, cut, need)
          changed = true
        }
      }
      if (!changed) return true
    }
    return false
  }
  if (!squareOffsets(coord)) notices.push({ kind: 'offset-direction', message: 'Parallel offsets could not all be drawn in one direction.' })

  // Pipes that would lie on one another, or end on unrelated pipe, are moved a cell apart while that clears them. On
  // square paper a plan or elevation shows pipes on one another truthfully where the plant has them so.
  {
    const flat = lattice.kind === 'iso' ? (v: Vec3): Point => [v[0] + v[2], v[1] + v[2]] : (v: Vec3): Point => [v[live[0]], v[live[1]]]
    const truly = lattice.kind === 'iso' ? undefined : (id: string): Point => { const p = plant(id); return [p[live[0]], p[live[1]]] }
    // Points joined only by pipe too short to draw (or tied on every axis) are one point of the paper by construction.
    const tied = (a: string, b: string) => [0, 1, 2].every(k => find(k, a) === find(k, b))
    const conflicts = (c: Map<string, Vec3>) => paperConflicts(legs, c, flat, truly, tied)
    let found = conflicts(coord)
    // Each pass clears at least one; a sheet with more than a few dozen is crowded past what moves can fix.
    for (let pass = 0; pass < REPAIRS && found.list.length; pass++) {
      const first = found.list[0]
      let best: { c: Map<string, Vec3>; found: ReturnType<typeof conflicts> } | undefined
      for (const k of live) {
        const values = new Set<number>()
        for (const id of [first.a.from, first.a.to, first.b.from, first.b.to]) { values.add(coord.get(id)![k]); values.add(coord.get(id)![k] + 1) }
        for (const from of values) {
          const trial = new Map([...coord].map(([id, v]) => [id, [...v] as Vec3]))
          insert(trial, k, from)
          if (directions.size) squareOffsets(trial)
          const f = conflicts(trial)
          if (!best || f.cost < best.found.cost) best = { c: trial, found: f }
        }
      }
      if (!best || best.found.cost >= found.cost) break
      for (const [id, v] of best.c) coord.set(id, v)
      found = best.found
    }
    const said = { overlap: 'Two pipes lie on one another on the paper.', touch: 'A pipe ends on another it does not join.', coincide: 'Two pipe ends that do not meet are drawn on one point of the paper.' }
    for (const f of found.list) notices.push({ kind: f.kind, id: f.a.runs[0].id, message: said[f.kind] })
  }

  // Positions: lattice points from their cells; in-line parts in proportion between the points along their leg;
  // attachments in proportion along their pipe.
  const positions = new Map(goal)
  for (const id of points) { const v = coord.get(id)!; cells.set(id, [...v]); positions.set(id, page(v)) }
  const fraction = (a: Point, b: Point, p: Point) => {
    const d: Point = [b[0] - a[0], b[1] - a[1]], l2 = d[0] * d[0] + d[1] * d[1]
    return l2 > 1e-12 ? ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2 : 0
  }
  for (const leg of legs) {
    const a0 = desired(leg.from), b0 = desired(leg.to), a = positions.get(leg.from)!, b = positions.get(leg.to)!
    for (const id of leg.nodes.slice(1, -1)) {
      const f = Math.max(0, Math.min(1, fraction(a0, b0, desired(id))))
      positions.set(id, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
    }
  }
  for (const n of input.nodes) {
    if (pointSet.has(n.id) || edges.has(n.id) || !goal.has(n.id)) continue
    const host = hostOf(n.id)
    if (!host) continue
    const p = desired(n.id), ha = desired(host.from), hb = desired(host.to), t = fraction(ha, hb, p)
    const foot: Point = [ha[0] + (hb[0] - ha[0]) * t, ha[1] + (hb[1] - ha[1]) * t]
    const na = positions.get(host.from)!, nb = positions.get(host.to)!
    positions.set(n.id, [na[0] + (nb[0] - na[0]) * t + p[0] - foot[0], na[1] + (nb[1] - na[1]) * t + p[1] - foot[1]])
  }
  return { positions, cells, notices }
}

const gcd = (values: number[]) => values.reduce((a, b) => { while (b) [a, b] = [b, a % b]; return a }, 0)

interface Conflict { kind: 'overlap' | 'touch' | 'coincide'; a: Leg; b: Leg }
/**
 * Where legs drawn on the paper lie on one another, or one ends on the inside of another it is not joined to, with a
 * cost that also counts crossings (legal, but avoided where a move clears them). Exact: points are compared in whole
 * lattice coordinates (`flat`). With `truly` (a node's true position in the view), what the plant itself shows so is
 * not a conflict. Distinct points drawn on one point of the paper (two pipe ends that do not meet) always are, unless
 * `tied` makes them one point by construction.
 */
function paperConflicts(legs: Leg[], c: Map<string, Vec3>, flat: (v: Vec3) => Point, truly?: (id: string) => Point, tied?: (a: string, b: string) => boolean): { list: Conflict[]; cost: number } {
  const seg = legs.map(l => ({ l, a: flat(c.get(l.from)!), b: flat(c.get(l.to)!) })).filter(s => s.a[0] !== s.b[0] || s.a[1] !== s.b[1])
  const joined = (x: Leg, y: Leg) => x.from === y.from || x.from === y.to || x.to === y.from || x.to === y.to
  const cross = (o: Point, p: Point, q: Point) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const inside = (p: Point, a: Point, b: Point, tolerance = 0) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    return Math.abs(cross(a, b, p)) <= tolerance * l && (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]) > tolerance * l &&
      (p[0] - b[0]) * (a[0] - b[0]) + (p[1] - b[1]) * (a[1] - b[1]) > tolerance * l
  }
  // In the plant itself (a plan or elevation), within half a millimetre.
  const real = (x: Leg, y: Leg, kind: 'overlap' | 'touch') => {
    if (!truly) return false
    const [a, b, p, q] = [truly(x.from), truly(x.to), truly(y.from), truly(y.to)]
    if (kind === 'touch') return inside(a, p, q, ON) || inside(b, p, q, ON) || inside(p, a, b, ON) || inside(q, a, b, ON)
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (l < ON || Math.abs(cross(a, b, p)) > ON * l || Math.abs(cross(a, b, q)) > ON * l) return false
    const t = (r: Point) => ((r[0] - a[0]) * (b[0] - a[0]) + (r[1] - a[1]) * (b[1] - a[1])) / l
    return Math.min(l, Math.max(t(p), t(q))) - Math.max(0, Math.min(t(p), t(q))) > ON
  }
  const list: Conflict[] = []
  // Legs on one line: bucketed by primitive direction and line, then swept along it.
  const lines = new Map<string, Array<{ l: Leg; lo: number; hi: number }>>()
  for (const s of seg) {
    let p = s.b[0] - s.a[0], q = s.b[1] - s.a[1]
    const g = gcd([Math.abs(p), Math.abs(q)]); p /= g; q /= g
    if (p < 0 || (p === 0 && q < 0)) { p = -p; q = -q }
    const key = `${p},${q},${p * s.a[1] - q * s.a[0]}`, t0 = s.a[0] * p + s.a[1] * q, t1 = s.b[0] * p + s.b[1] * q
    lines.set(key, [...(lines.get(key) ?? []), { l: s.l, lo: Math.min(t0, t1), hi: Math.max(t0, t1) }])
  }
  for (const on of lines.values()) {
    on.sort((x, y) => x.lo - y.lo)
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length && on[j].lo < on[i].hi; j++)
      if (on[i].l !== on[j].l && !real(on[i].l, on[j].l, 'overlap')) list.push({ kind: 'overlap', a: on[i].l, b: on[j].l })
  }
  // Ends inside unrelated legs, and crossings: swept by box along the first coordinate.
  const box = seg.map(s => ({ s, x0: Math.min(s.a[0], s.b[0]), x1: Math.max(s.a[0], s.b[0]), y0: Math.min(s.a[1], s.b[1]), y1: Math.max(s.a[1], s.b[1]) })).sort((m, n) => m.x0 - n.x0)
  let crossings = 0
  for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length && box[j].x0 <= box[i].x1; j++) {
    const m = box[i], n = box[j]
    if (n.y0 > m.y1 || n.y1 < m.y0 || joined(m.s.l, n.s.l)) continue
    const s = m.s, t = n.s
    const touch = inside(s.a, t.a, t.b) || inside(s.b, t.a, t.b) || inside(t.a, s.a, s.b) || inside(t.b, s.a, s.b)
    if (touch) { if (!real(s.l, t.l, 'touch')) list.push({ kind: 'touch', a: s.l, b: t.l }) }
    else {
      const d1 = cross(t.a, t.b, s.a), d2 = cross(t.a, t.b, s.b), d3 = cross(s.a, s.b, t.a), d4 = cross(s.a, s.b, t.b)
      if (d1 * d2 < 0 && d3 * d4 < 0) crossings++
    }
  }
  // Distinct points on one point of the paper: the first leg drawn from each stands for it.
  const at = new Map<string, Array<{ id: string; leg: Leg }>>()
  for (const s of seg) for (const [id, p] of [[s.l.from, s.a], [s.l.to, s.b]] as const) {
    const key = `${p[0]},${p[1]}`, here = at.get(key)
    if (!here) at.set(key, [{ id, leg: s.l }])
    else if (!here.some(h => h.id === id)) here.push({ id, leg: s.l })
  }
  for (const here of at.values()) for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) {
    const x = here[i], y = here[j]
    if (tied?.(x.id, y.id)) continue
    if (truly) { const p = truly(x.id), q = truly(y.id); if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= ON) continue }
    list.push({ kind: 'coincide', a: x.leg, b: y.leg })
  }
  const index = new Map(legs.map((l, i) => [l, i]))
  const weight = { overlap: 0, coincide: 1, touch: 2 }
  list.sort((x, y) => weight[x.kind] - weight[y.kind] || index.get(x.a)! - index.get(y.a)! || index.get(x.b)! - index.get(y.b)!)
  return { list, cost: list.filter(f => f.kind !== 'touch').length * 1e6 + list.filter(f => f.kind === 'touch').length * 1e3 + crossings }
}
/** Plant tolerance (mm) for what a view truly shows on one line. */
const ON = 0.5

export interface LatticeLine { a: Point; b: Point; major: boolean }
/**
 * The lines of a paper's lattice over an area: three families on isometric paper, two on square, every fifth one
 * major. Where lines would be closer than `minSpacing` sheet units, only every n-th is drawn (still through lattice
 * points, so the drawing stays on them).
 */
export function paperLines(lattice: Pick<PaperLattice, 'kind' | 'cell'>, area: [number, number, number, number], minSpacing = 0): { lines: LatticeLine[]; every: number } {
  const cell = lattice.cell
  if (!(cell > 0)) return { lines: [], every: 1 }
  const iso = lattice.kind === 'iso', gap = iso ? cell * COS30 : cell, every = Math.max(1, Math.ceil(minSpacing / gap))
  const corners: Point[] = [[area[0], area[1]], [area[2], area[1]], [area[0], area[3]], [area[2], area[3]]]
  const lines: LatticeLine[] = []
  const reach = Math.hypot(area[2] - area[0], area[3] - area[1]) * 2
  // Isometric: lines of constant b run east (30°), of constant a north (150°), verticals have constant a − b.
  const families: Array<{ value: (p: Point) => number; through: (i: number) => Point; dir: Point }> = iso ? [
    { value: p => coords(p, cell)[1], through: i => at(0, i, cell), dir: [COS30, -0.5] },
    { value: p => coords(p, cell)[0], through: i => at(i, 0, cell), dir: [-COS30, -0.5] },
    { value: p => { const c = coords(p, cell); return c[0] - c[1] }, through: i => at(i, 0, cell), dir: [0, -1] },
  ] : [
    { value: p => p[1] / cell, through: i => [0, i * cell], dir: [1, 0] },
    { value: p => p[0] / cell, through: i => [i * cell, 0], dir: [0, -1] },
  ]
  for (const f of families) {
    const values = corners.map(f.value)
    const lo = Math.floor(Math.min(...values) / every) * every, hi = Math.ceil(Math.max(...values))
    for (let i = lo; i <= hi; i += every) {
      const p = f.through(i), seg = clipSegment([p[0] - f.dir[0] * reach, p[1] - f.dir[1] * reach], [p[0] + f.dir[0] * reach, p[1] + f.dir[1] * reach], area)
      if (seg) lines.push({ a: seg[0], b: seg[1], major: i % (5 * every) === 0 })
    }
  }
  return { lines, every }
}

/** A segment clipped to an axis-aligned box (Liang–Barsky); null when it misses. */
export function clipSegment(a: Point, b: Point, box: [number, number, number, number]): [Point, Point] | null {
  const d: Point = [b[0] - a[0], b[1] - a[1]]
  let t0 = 0, t1 = 1
  for (const [p, q] of [[-d[0], a[0] - box[0]], [d[0], box[2] - a[0]], [-d[1], a[1] - box[1]], [d[1], box[3] - a[1]]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return null
  }
  return [[a[0] + d[0] * t0, a[1] + d[1] * t0], [a[0] + d[0] * t1, a[1] + d[1] * t1]]
}
