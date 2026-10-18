import { getNode, length, portPoint, sub, type IsoDocument, type PipeNode, type PipeRun, type Vec3 } from '../model'
import type { Point } from '../drawing'
import { draftLength } from '../format'
import { feetThreshold } from '../profile'
import { measureText } from '../stroke-font'
import { draftingSizes } from './context'
import { drafting, flangedGeometry, reducerGeometry, symbolOf, valveBodyHalfLength } from './valve-conventions'
import { COMPONENT_TYPE_BY_CODE } from '../components'
import { nodeCode } from '../joints'

export type View = 'iso' | 'plan' | 'front' | 'side'

/**
 * The plan rotation the drawing is projected with, in degrees: north turns the drawing only in quarter turns, so
 * the plant's axes stay on the paper's axes (and on its lattice). Any other angle turns only the north symbol.
 */
export function projectionNorth(north = 0): 0 | 90 | 180 | 270 {
  const q = Math.round((Number.isFinite(north) ? north : 0) / 90) * 90
  return (((q % 360) + 360) % 360) as 0 | 90 | 180 | 270
}
/** A plant vector along the drawing's axes (east, north, up after the drawing's quarter turn); exact. */
export function drawingAxes(p: Vec3, north = 0): Vec3 {
  switch (projectionNorth(north)) {
    case 90: return [-p[1], p[0], p[2]]
    case 180: return [-p[0], -p[1], p[2]]
    case 270: return [p[1], -p[0], p[2]]
    default: return [p[0], p[1], p[2]]
  }
}
/** Page direction (y down) of a vector along the drawing's axes, before scaling. */
function pageOf(r: Vec3, view: View): Point {
  if (view === 'plan') return [r[0], -r[1]]
  if (view === 'front') return [r[0], -r[2]]
  if (view === 'side') return [r[1], -r[2]]
  return [(r[0] - r[1]) * Math.cos(Math.PI / 6), -(r[0] + r[1]) * 0.5 - r[2]]
}
/** Page direction (y down) of a model vector, before scaling. Every view turns with the drawing's quarter turn. */
export function viewProject(p: Vec3, view: View, north = 0): Point {
  return pageOf(drawingAxes(p, north), view)
}
/** Page direction of plant north for the north symbol: turned by the whole north angle, not only its quarter turns. */
export function northOnPage(view: View, north = 0): Point {
  const a = ((Number.isFinite(north) ? north : 0) * Math.PI) / 180
  return pageOf([-Math.sin(a), Math.cos(a), 0], view)
}
/** How far a viewer is in front of a model point (greater is nearer), for which of two crossing pipes is behind. */
export function viewDepth(p: Vec3, view: View, north = 0): number {
  const r = drawingAxes(p, north)
  return view === 'plan' ? r[2] : view === 'front' ? -r[1] : view === 'side' ? r[0] : r[2] - r[0] - r[1]
}
const WORDS: Array<[Vec3, string]> = [[[0, 1, 0], 'NORTH'], [[0, -1, 0], 'SOUTH'], [[1, 0, 0], 'EAST'], [[-1, 0, 0], 'WEST']]
/**
 * The plant direction a view looks along and the note a sheet prints for it. Elevations look along a drawing axis
 * (front: the drawing's north, side: its west), which the drawing's quarter turn makes a plant direction; the plan
 * names the plant direction drawn up the page when it is not north. Lettered in the ROMANS character set.
 */
export function viewDirection(view: View, north = 0): { looking: Vec3; note: string } {
  // Plant direction of a drawing-axis vector: the quarter turn undone.
  const plant = (r: Vec3): Vec3 => { const q = projectionNorth(north); return drawingAxes(r, -q) }
  const word = (v: Vec3) => WORDS.find(([w]) => w.every((x, i) => Math.abs(x - v[i]) < 1e-9))?.[1] ?? ''
  if (view === 'plan') { const up = word(plant([0, 1, 0])); return { looking: [0, 0, -1], note: up === 'NORTH' ? 'PLAN VIEW' : `PLAN VIEW, ${up} UP` } }
  if (view === 'front') { const v = plant([0, 1, 0]); return { looking: v, note: `FRONT VIEW LOOKING ${word(v)}` } }
  if (view === 'side') { const v = plant([-1, 0, 0]); return { looking: v, note: `SIDE VIEW LOOKING ${word(v)}` } }
  const v = plant([1, 1, 0])
  return { looking: [v[0], v[1], -1], note: 'ISOMETRIC VIEW' }
}

/**
 * A component smaller than this share of a pipe's length off its main axis is drafting noise (a skew under 0.81°):
 * the pipe is drawn straight.
 */
const SKEW = Math.sqrt(1 - 0.9999 ** 2)
/** Pipe shorter than this in the plant (a gasket's thickness, mm) is drawn as one joint. */
export const ZERO_LEG = 6
/** The axes a model vector moves along, ignoring drafting noise. */
export function axisComponents(v: Vec3): number[] {
  const l = Math.hypot(...v), tolerance = Math.max(0.01, SKEW * l)
  return [0, 1, 2].filter(k => Math.abs(v[k]) > tolerance)
}
/** The axis a straight pipe runs along, or undefined for a rolling offset or a point. */
export function straightAxis(v: Vec3): number | undefined {
  const axes = axisComponents(v)
  return axes.length === 1 ? axes[0] : undefined
}
/**
 * A pipe's own run in the plant, from its first end to its last: between the points its centreline meets its end
 * nodes (an eccentric reducer's small end is offset from the reducer's node), so it gives the pipe's true direction.
 */
export function runDelta(doc: IsoDocument, run: PipeRun, node: (id: string) => PipeNode = id => getNode(doc, id)): Vec3 {
  const a = portPoint(doc, node(run.from), run.id), b = portPoint(doc, node(run.to), run.id)
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
}

/** Least angle off the vertical at which a not-to-scale layout draws a level pipe, and the iso axes' own angle. */
const LEAN = 15 * Math.PI / 180, AXIS = Math.PI / 3
/**
 * Page direction a not-to-scale layout draws a model vector along. Isometric, except that level directions between
 * two horizontal iso axes that would project near the vertical fan out from it: a 45° plan pipe leans 15° off the
 * vertical, clockwise, so it reads as a level offset and never lies on a riser. The axes keep their directions.
 */
export function layoutDirection(v: Vec3, view: View, north = 0): Point {
  const flat = viewProject([v[0], v[1], 0], view, north), rise = viewProject([0, 0, v[2]], view, north), l = Math.hypot(...flat)
  if (view !== 'iso' || l < 1e-9) return add2(flat, rise)
  // Clockwise angle of the level part off the upward vertical, taken as a line so a pipe drawn downward leans the same.
  let a = Math.atan2(flat[0], -flat[1]), turn = 0
  if (a > Math.PI / 2) { a -= Math.PI; turn = Math.PI } else if (a <= -Math.PI / 2) { a += Math.PI; turn = -Math.PI }
  if (Math.abs(a) < AXIS) a = (a < -1e-9 ? -1 : 1) * (LEAN + Math.abs(a) * (AXIS - LEAN) / AXIS)
  return add2([l * Math.sin(a + turn), -l * Math.cos(a + turn)], rise)
}

/** How a not-to-scale layout is shaped beyond its `base`; held with the sheet fit so routing does not move the drawing. */
export interface LegShape {
  /** Lengthens pipe drawn across the page by this share of its width, so a narrow drawing fills the open area. */
  stretch?: number
  /** Drawn-length factor of each straight leg, keyed by its first run, to keep legs from crossing. */
  legs?: Record<string, number>
}
interface Leg { key: string; nodes: string[]; runs: PipeRun[]; from?: string; parent?: Leg }
export interface Layout {
  /** Unscaled page position of every node in the sheet. */
  raw: Map<string, Point>
  /** Unscaled page position of any model point; total, so routing previews and welds land on the drawing. */
  rawProject: (p: Vec3) => Point
  /** Page units per model millimetre near a point, used to keep off-network previews at true scale. */
  scale: number
  /** Not to scale: each straight leg and the node it was laid out from. */
  legs: Leg[]
}

/**
 * Compressed drawn length of a straight in not-to-scale layouts, relative to a metre: long runs are compressed, short
 * pieces enlarged, never below a third of a metre's. `base` (sheet units per unit) scales it to the sheet.
 */
export const schematicLength = (mm: number) => Math.max(320, 1000 * (Math.max(mm, 1) / 1000) ** 0.45)

/**
 * Sheet room a not-to-scale layout keeps for what is drawn on a pipe, in sheet units; symbols and lettering are drawn
 * in proportion to the lettering height, so these are too.
 */
export interface LayoutRoom {
  /** A pipe piece this long (mm): its own dimension value, as the sheet letters it, between its arrowheads. */
  piece: (mm: number) => number
  /** Fittings joined with no pipe: their two weld dots apart. */
  join: number
  /** An attachment on a pipe (a support, an olet): its tag box and a letter's clearance. */
  attachment: number
  /** Clear of a pipe's end fittings before the first attachment. */
  margin: number
  /** Clearance two unrelated straights keep, so neither reads as part of the other. */
  clear: number
  /** Cap height of the lettering. */
  text: number
}
export function layoutRoom(doc: IsoDocument): LayoutRoom {
  const s = draftingSizes(doc), T = s.text, below = feetThreshold(doc, 'dimensions')
  return {
    piece: mm => measureText(draftLength(mm, doc.units, below), T) + 2 * s.arrow + T,
    join: 4 * s.weld,
    attachment: 3.4 * T,
    margin: 1.5 * T,
    clear: 1.2 * T,
    text: T
  }
}
/**
 * Room (sheet units) a node's symbol and its callouts need along each pipe it joins. Drafters size a not-to-scale
 * isometric by what is on each straight, not by its length, so valves and flanged joints get the space they need.
 * A valve takes its drawn half-body and end flanges and the arrowhead and gap of the dimension to its face; parts a
 * dimension runs through (nipples, unions, couplings) take little; other fittings take their usual share, in
 * lettering heights.
 */
export function symbolRoom(doc: IsoDocument, node: PipeNode): number {
  const s = draftingSizes(doc), T = s.text
  switch (node.kind) {
    case 'valve': {
      const symbol = drafting(doc, node).symbol
      if (symbol === 'nipple') return 0.45 * T
      if (symbol === 'union' || symbol === 'coupling') return 1.8 * T
      const body = valveBodyHalfLength(doc, node, T), code = nodeCode(doc, node)
      const flanges = code && COMPONENT_TYPE_BY_CODE[code]?.endPrep === 'FL' ? flangedGeometry(doc, node, body, T).plate - body + s.thin : 0
      return body + flanges + s.arrow + s.extGap
    }
    case 'flange': return 2.7 * T
    // A reducer takes its drawn half-length and the arrowhead and gap of the dimension to its end.
    case 'reducer': return (symbolOf(doc, node) === 'reducing-coupling' ? (drafting(doc, node).body?.length ?? 2.73) * T : reducerGeometry(doc, node, T).halfLength) + s.arrow + s.extGap
    case 'gasket': return 2.1 * T
    case 'tee': case 'olet': return 1.5 * T
    default: return 0
  }
}

/**
 * Lay out the spool on the page. To scale, every point is projected directly. Not to scale, each straight keeps its
 * direction, laid out from an open end through the network: every piece gets the sheet room its components need
 * plus `base` times its compressed length, so the caller can choose `base` to fill the sheet; fittings joined with no
 * pipe between them stay close together. Room is in sheet units: the layout is drawn on the sheet at full size.
 */
/**
 * What a drawing's layouts share while it is drafted: the room each node's symbol needs (`symbolRoom`), which depends
 * only on the drawing, not on how long its pipes are drawn. Kept for one drafting pass, while nothing is edited.
 */
export interface LayoutMemo {
  rooms: Map<string, number>
  deltas: Map<string, Vec3>
  /** The network's legs and the room on each, which do not change with the base or the leg shape. */
  plan?: LayoutPlan
}
export const layoutMemo = (): LayoutMemo => ({ rooms: new Map(), deltas: new Map() })
/** A leg's run in the plant and the pieces along it, which every layout of the pass draws the same way. */
interface LegPlan {
  leg: Leg
  page: Point
  span: number
  mm: number
  offsetLeg: boolean
  /** Unit page direction. */
  u: Point
  assembly: boolean
  /** Its offset's dimension room and compressed length, when it is a rolling offset. */
  offsetPiece: number
  offsetLength: number
  /** Each piece: its plant length, the room its ends and hangers need and whether it is a pipe. */
  pieces: Array<{ p: number; ends: number; pipe: boolean; piece: number; length: number }>
}
interface LayoutPlan {
  doc: IsoDocument
  runs: PipeRun[]
  nodes: PipeNode[]
  view: View
  R: LayoutRoom
  ids: Set<string>
  node: (id: string) => PipeNode
  legs: Leg[]
  plans: Map<Leg, LegPlan>
  legEdges: Map<string, Leg[]>
  room: (id: string) => number
  runById: Map<string, PipeRun>
  attachments: Map<string, PipeNode[]>
  /** Each attachment's model fraction along its host. */
  fractions: Map<string, number>
  segments: Array<{ r: PipeRun; a: Vec3; b: Vec3; d: Vec3; len2: number }>
  /** The leg each pipe is part of. */
  legOf: Map<string, Leg>
}
/** The parts of a layout that depend only on the network, worked out once for the drafting pass. */
function layoutPlan(doc: IsoDocument, runs: PipeRun[], nodes: PipeNode[], view: View, memo: LayoutMemo): LayoutPlan {
  const known = memo.plan
  if (known && known.doc === doc && known.runs === runs && known.nodes === nodes && known.view === view) return known
  const R = layoutRoom(doc)
  const direction = (v: Vec3) => layoutDirection(v, view, doc.north)
  const ids = new Set(nodes.map(n => n.id))
  const edges = new Map<string, PipeRun[]>()
  for (const r of runs) for (const end of [r.from, r.to]) { const list = edges.get(end); if (list) list.push(r); else edges.set(end, [r]) }
  const nodeById = new Map(doc.nodes.map(n => [n.id, n]))
  const node = (id: string) => nodeById.get(id) ?? getNode(doc, id)
  const position = (id: string) => node(id).position
  const deltas = new Map(runs.map(r => {
    let d = memo.deltas.get(r.id)
    if (!d) memo.deltas.set(r.id, d = runDelta(doc, r, node))
    return [r.id, d]
  }))
  /** Unit direction of a pipe leaving a node, along its own run. */
  const leaving = (r: PipeRun, id: string) => { const d = deltas.get(r.id)!, l = length(d) || 1, s = r.from === id ? 1 : -1; return [s * d[0] / l, s * d[1] / l, s * d[2] / l] }
  // Straight legs run through in-line components and along the run of tees, keeping their ends fixed while a
  // component slides along them; fittings joined with no pipe between them are part of the leg.
  const inline = (id: string, from: PipeRun) => {
    const list = edges.get(id) ?? []
    if (list.length < 2 || node(id).kind === 'end') return undefined
    const u = leaving(from, id).map(v => -v)
    return list.find(next => {
      if (next === from) return false
      const v = leaving(next, id)
      return u[0] * v[0] + u[1] * v[1] + u[2] * v[2] > 0.999999
    })
  }
  const order = new Map(runs.map((r, i) => [r.id, i]))
  const legOf = new Map<string, Leg>()
  for (const run of runs) {
    if (legOf.has(run.id)) continue
    const leg: Leg = { key: run.id, nodes: [run.from, run.to], runs: [run] }
    const taken = new Set<PipeRun>([run])
    for (let r: PipeRun | undefined = run, at = run.from; (r = inline(at, r!)) && !taken.has(r);) {
      taken.add(r); leg.runs.unshift(r); at = r.from === at ? r.to : r.from; leg.nodes.unshift(at)
    }
    for (let r: PipeRun | undefined = run, at = run.to; (r = inline(at, r!)) && !taken.has(r);) {
      taken.add(r); leg.runs.push(r); at = r.from === at ? r.to : r.from; leg.nodes.push(at)
    }
    // Keyed by its first run in the document, which routing never changes.
    leg.key = leg.runs.reduce((a, b) => order.get(b.id)! < order.get(a.id)! ? b : a).id
    for (const r of leg.runs) legOf.set(r.id, leg)
  }
  const legs = [...new Set(legOf.values())]
  const legEdges = new Map<string, Leg[]>()
  for (const leg of legs)
    for (const id of leg.nodes) { const list = legEdges.get(id); if (list) list.push(leg); else legEdges.set(id, [leg]) }
  const rooms = memo.rooms
  const room = (id: string) => { let r = rooms.get(id); if (r == null) rooms.set(id, r = symbolRoom(doc, node(id))); return r }
  const runById = new Map(runs.map(r => [r.id, r]))
  // Supports and other attachments on a piece need their own room for symbols and labels.
  // A labelled attachment needs about half its label's width along the pipe, so neighbouring labels do not crowd.
  const attached = new Map<string, number>(), attachments = new Map<string, PipeNode[]>()
  for (const n of nodes) if (n.associatedRunId) {
    const label = Math.max(0, ...(n.calloutText ?? '').split('\n').map(l => measureText(l.trim(), R.text)))
    attached.set(n.associatedRunId, (attached.get(n.associatedRunId) ?? 0) + Math.max(R.attachment, label / 2 + R.margin))
    const list = attachments.get(n.associatedRunId)
    if (list) list.push(n); else attachments.set(n.associatedRunId, [n])
  }
  const pair = new Map<string, PipeRun>()
  for (const r of runs) { pair.set(`${r.from}|${r.to}`, r); pair.set(`${r.to}|${r.from}`, r) }
  const between = (a: string, b: string) => pair.get(`${a}|${b}`)
  const hung = (a: string, b: string) => attached.get(between(a, b)?.id ?? '') ?? 0
  /** Model fraction along its host pipe of an attached node. */
  const fraction = (id: string, host: PipeRun) => {
    const a = position(host.from), d = sub(position(host.to), a), len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], p = position(id)
    return len2 > 1e-12 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2)) : 0
  }
  const fractions = new Map<string, number>()
  for (const [hostId, list] of attachments) {
    const host = runById.get(hostId)
    if (host) for (const n of list) fractions.set(n.id, fraction(n.id, host))
  }
  const plans = new Map<Leg, LegPlan>()
  for (const leg of legs) {
    const order = leg.nodes
    // The leg's run in the plant: its pipes' own runs, end to end.
    const d3: Vec3 = [0, 0, 0]
    leg.runs.forEach((r, i) => { const d = deltas.get(r.id)!, s = r.from === order[i] ? 1 : -1; for (const k of [0, 1, 2]) d3[k] += s * d[k] })
    const page = direction(d3), span = Math.hypot(...page), mm = length(d3)
    const offsetLeg = straightAxis(d3) == null
    const pieces = order.slice(1).map((id, i) => {
      const p = length(sub(position(id), position(order[i]))), ends = room(order[i]) + room(id) + hung(order[i], id)
      const run = between(order[i], id), pipe = !run?.connector && !run?.nipple
      return { p, ends, pipe, piece: pipe ? R.piece(p) : 0, length: pipe ? schematicLength(p) : 0 }
    })
    const assembly = leg.runs.every(r => r.connector || r.nipple)
    plans.set(leg, {
      leg, page, span, mm, offsetLeg, u: [page[0] / span, page[1] / span], assembly,
      offsetPiece: offsetLeg && !assembly ? R.piece(mm) : 0, offsetLength: offsetLeg && !assembly ? schematicLength(mm) : 0, pieces
    })
  }
  const segments = runs.map(r => {
    const a = position(r.from), b = position(r.to), d = sub(b, a)
    return { r, a, b, d, len2: d[0] * d[0] + d[1] * d[1] + d[2] * d[2] }
  })
  return memo.plan = { doc, runs, nodes, view, R, ids, node, legs, plans, legEdges, room, runById, attachments, fractions, segments, legOf }
}
export function layoutSheet(doc: IsoDocument, runs: PipeRun[], nodes: PipeNode[], view: View, schematic: boolean, base = 1, shape: LegShape = {}, memo: LayoutMemo = layoutMemo()): Layout {
  const project = (p: Vec3) => viewProject(p, view, doc.north)
  if (!schematic || !runs.length) {
    const raw = new Map(nodes.map(n => [n.id, project(n.position)] as [string, Point]))
    return { raw, rawProject: project, scale: 1, legs: [] }
  }
  const plan = layoutPlan(doc, runs, nodes, view, memo)
  const { R, ids, node, legEdges, room, runById, attachments, fractions } = plan
  const direction = (v: Vec3) => layoutDirection(v, view, doc.north)
  const raw = new Map<string, Point>()
  const position = (id: string) => node(id).position
  // Each layout has legs of its own: where each was laid out from belongs to the layout.
  const fresh = new Map<Leg, Leg>(plan.legs.map(l => [l, { key: l.key, nodes: l.nodes, runs: l.runs }]))
  const legs = [...fresh.values()]
  const legOfRun = (id: string) => { const template = plan.legOf.get(id); return template && fresh.get(template) }
  let ratio = 0, count = 0
  const stretch = shape.stretch ?? 0
  // Attachments are spaced along their pipe as drawn, in order, clear of the fittings at its ends and of each other,
  // the way a drafter spreads olets and hangers along a compressed straight.
  const slots = new Map<string, number>()
  const slot = (id: string, host: PipeRun): number => {
    if (slots.has(id)) return slots.get(id)!
    const pa = raw.get(host.from)!, pb = raw.get(host.to)!, drawn = Math.hypot(...sub2(pb, pa))
    const mm = length(sub(position(host.to), position(host.from)))
    const groups: Array<{ t: number; ids: string[] }> = []
    for (const n of (attachments.get(host.id) ?? []).map(n => ({ id: n.id, t: fractions.get(n.id)! })).sort((x, y) => x.t - y.t)) {
      const last = groups.at(-1)
      if (last && (n.t - last.t) * mm < 1) last.ids.push(n.id)
      else groups.push({ t: n.t, ids: [n.id] })
    }
    const start = room(host.from) + R.margin, end = drawn - room(host.to) - R.margin, gap = R.attachment
    let at = groups.map(g => g.t * drawn)
    if (end - start < gap * (groups.length - 1)) at = groups.map((_, i) => drawn * (i + 1) / (groups.length + 1))
    else {
      at = at.map((s, i) => Math.max(s, start + gap * i))
      for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i], at[i - 1] + gap)
      for (let i = at.length - 1; i >= 0; i--) at[i] = Math.min(at[i], end - gap * (at.length - 1 - i), i + 1 < at.length ? at[i + 1] - gap : Infinity)
    }
    groups.forEach((g, i) => { for (const n of g.ids) slots.set(n, drawn > 1e-9 ? at[i] / drawn : g.t) })
    return slots.get(id)!
  }
  /** Where an attached node meets its host pipe, in the model and as drawn. */
  const hostFoot = (id: string): { point: Vec3; at: Point } | undefined => {
    const hostId = node(id).associatedRunId, host = hostId ? runById.get(hostId) : undefined
    const pa = host && raw.get(host.from), pb = host && raw.get(host.to)
    if (!host || !pa || !pb) return undefined
    const a = position(host.from), d = sub(position(host.to), a), t = fractions.get(id) ?? 0, u = slot(id, host)
    return { point: [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], at: [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u] }
  }
  const done = new Set<Leg>()
  // The leg that placed each node, so each leg knows the one it was laid out from.
  const placer = new Map<string, Leg>()
  let anchor: string | undefined
  while (done.size < legs.length) {
    const left = plan.legs.filter(l => !done.has(l))
    const ends = left.flatMap(l => [l.nodes[0], l.nodes.at(-1)!])
    // Branches fixed to a pipe (a nipple on an olet) grow from where their host is drawn.
    const hosted = ends.find(id => !raw.has(id) && hostFoot(id))
    const start = ends.find(id => raw.has(id)) ?? hosted ?? ends.find(id => (legEdges.get(id) ?? []).length === 1) ?? ends[0]
    const foot = !raw.has(start) && hostFoot(start)
    if (foot) {
      const off = sub(position(start), foot.point), mm = length(off), page = direction(off), span = Math.hypot(...page)
      const drawn = base * schematicLength(mm) * 0.5 + room(start)
      raw.set(start, span > 1e-9 ? add2(foot.at, scale2(page, drawn / span)) : foot.at)
      const host = legOfRun(node(start).associatedRunId ?? '')
      if (host) placer.set(start, host)
    } else if (!raw.has(start)) {
      // Later networks start beside the earlier ones at their true relative position.
      raw.set(start, anchor ? add2(raw.get(anchor)!, scale2(sub2(project(position(start)), project(position(anchor))), ratio / Math.max(count, 1))) : [0, 0])
    }
    anchor ??= start
    const queue = [start]
    for (let head = 0; head < queue.length;) {
      const at = queue[head++]
      for (const template of legEdges.get(at) ?? []) {
        if (done.has(template)) continue
        done.add(template)
        const legPlan = plan.plans.get(template)!, leg = fresh.get(template)!, { page, span, mm, offsetLeg, u, assembly, pieces } = legPlan
        leg.from = at
        leg.parent = placer.get(at)
        // The leg is laid out from wherever it was reached: an end, or a tee on its run.
        const order = leg.nodes
        const origin = raw.get(at)!
        if (span < 1e-9 || mm < 1e-9) { for (const id of order) if (!raw.has(id)) { raw.set(id, origin); queue.push(id) } continue }
        // Pipe drawn across the page is lengthened to fill a narrow drawing out.
        // A leg drawn longer or shorter to clear another changes its pipe and joints, never the room its symbols need.
        const factor = shape.legs?.[leg.key] ?? 1, stretched = (1 + stretch * Math.abs(u[0])) * factor
        // Each piece of the leg gets a compressed share of the length, so short pieces between fittings stay
        // readable, on top of the room it needs: its dimension lettered between its arrowheads, or its end symbols,
        // weld dots and the hangers on it, whichever is longer (the dimension stands off the pipe, clear of its
        // symbols). Fittings joined direct stay close.
        // Each piece's station along the leg is the sum of the pieces before it, in order.
        const station = [0]
        let total = 0
        for (const { p, ends, pipe, piece, length: compressed } of pieces) {
          total += pipe ? Math.max(piece * stretched, ends + R.join) + base * compressed * stretched : p < ZERO_LEG ? R.join / 2 : R.join * factor + ends
          station.push(total)
        }
        total = total || 1
        // Offsets are drawn at full length whatever their foreshortening, and never shorter than a pipe piece, so
        // their constructions stay legible without dwarfing the runs beside them.
        const drawn = offsetLeg ? assembly ? total : Math.max(total, legPlan.offsetPiece + base * legPlan.offsetLength * 0.5) : total * span / mm
        const from = station[order.indexOf(at)]
        order.forEach((id, i) => {
          if (raw.has(id)) return
          raw.set(id, add2(origin, scale2(page, drawn * (station[i] - from) / total / span)))
          placer.set(id, leg)
          queue.push(id)
        })
        ratio += drawn / span; count++
      }
    }
  }
  const meanScale = count ? ratio / count : 1
  const segments = plan.segments
  const rawProject = (p: Vec3): Point => {
    // Points on a pipe interpolate along its drawn straight; anything else sits off the nearest node at true scale.
    for (const { r, a, d, len2 } of segments) {
      if (len2 < 1e-12) continue
      const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2
      if (t < -1e-9 || t > 1 + 1e-9) continue
      const off = length(sub(p, [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]))
      if (off > ON_PIPE) continue
      const pa = raw.get(r.from), pb = raw.get(r.to)
      if (pa && pb) return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]
    }
    let best: PipeNode | undefined, distance = Infinity
    for (const n of nodes) {
      const d = length(sub(n.position, p))
      if (d < distance && raw.has(n.id)) { distance = d; best = n }
    }
    if (!best) return project(p)
    return add2(raw.get(best.id)!, scale2(sub2(project(p), project(best.position)), meanScale))
  }
  // Supports and other attachments sit on their pipe as drawn.
  for (const n of nodes) if (!raw.has(n.id) && ids.has(n.id)) raw.set(n.id, hostFoot(n.id)?.at ?? rawProject(n.position))
  return { raw, rawProject, scale: meanScale, legs }
}
/** A model point this close (mm) to a pipe's centreline is on the pipe. */
export const ON_PIPE = 0.5

/**
 * How badly unrelated straights tangle in a not-to-scale layout: one for each pair of pieces that cross or come
 * within the layout's clearance of each other. Pieces of one leg, of legs that meet, and branches on their host do
 * not count. Pieces are swept along the page so only those near each other are compared.
 */
export function tangles(doc: IsoDocument, layout: Layout): Array<[Leg, Leg, number]> {
  const clear = layoutRoom(doc).clear
  const pieces = layout.legs.flatMap(leg => leg.nodes.slice(1).flatMap((id, i) => {
    const a = layout.raw.get(leg.nodes[i]), b = layout.raw.get(id)
    return a && b && Math.hypot(...sub2(b, a)) > 1e-6 ? [{ leg, a, b, x0: Math.min(a[0], b[0]) - clear, x1: Math.max(a[0], b[0]) + clear, y0: Math.min(a[1], b[1]) - clear, y1: Math.max(a[1], b[1]) + clear }] : []
  }))
  // Branches meet their host, and branches off one host meet each other there.
  const nodeById = new Map(doc.nodes.map(n => [n.id, n]))
  const facts = new Map<Leg, { host?: string; nodes: Set<string>; runs: Set<string> }>()
  const of = (leg: Leg) => {
    let f = facts.get(leg)
    if (!f) facts.set(leg, f = { host: leg.nodes.map(id => (nodeById.get(id) ?? getNode(doc, id)).associatedRunId).find(Boolean), nodes: new Set(leg.nodes), runs: new Set(leg.runs.map(r => r.id)) })
    return f
  }
  const related = (x: Leg, y: Leg) => {
    if (x === y) return true
    const a = of(x), b = of(y)
    return x.nodes.some(id => b.nodes.has(id)) || (!!a.host && b.runs.has(a.host)) || (!!b.host && a.runs.has(b.host)) || (!!a.host && a.host === b.host)
  }
  // Each with how far the pair is from clearing.
  const out: Array<{ i: number; j: number; knot: [Leg, Leg, number] }> = []
  const order = pieces.map((_, i) => i).sort((i, j) => pieces[i].x0 - pieces[j].x0)
  for (let m = 0; m < order.length; m++)
    for (let n = m + 1; n < order.length && pieces[order[n]].x0 <= pieces[order[m]].x1; n++) {
      const [i, j] = order[m] < order[n] ? [order[m], order[n]] : [order[n], order[m]], p = pieces[i], q = pieces[j]
      if (q.y0 > p.y1 || q.y1 < p.y0 || related(p.leg, q.leg)) continue
      const gap = segmentGap(p.a, p.b, q.a, q.b)
      if (gap < clear) out.push({ i, j, knot: [p.leg, q.leg, clear - gap] })
    }
  // In the order a full comparison finds them, so the same pair is untangled first however the pieces lie.
  return out.sort((m, n) => m.i - n.i || m.j - n.j).map(o => o.knot)
}

/**
 * Leg length factors that keep unrelated straights of a not-to-scale layout from crossing or running into each
 * other, found by lengthening or shortening the legs that join each tangled pair, a step at a time while the
 * tangles get fewer or shallower. Each trial is a whole layout, so the search is bounded by `budget` layouts.
 */
export function untangle(doc: IsoDocument, runs: PipeRun[], nodes: PipeNode[], view: View, base: number, shape: LegShape = {}, budget = 96, memo: LayoutMemo = layoutMemo()): Record<string, number> {
  let legs = { ...shape.legs }
  const lay = (factors: Record<string, number>) => layoutSheet(doc, runs, nodes, view, true, base, { ...shape, legs: factors }, memo)
  const score = (k: Array<[Leg, Leg, number]>) => k.length * 1e4 + k.reduce((sum, t) => sum + t[2], 0)
  let knots = tangles(doc, lay(legs)), trials = 0
  const change = (factors: Record<string, number>) => Object.values(factors).reduce((s, f) => s + Math.abs(Math.log(f)), 0)
  for (let pass = 0; pass < 12 && knots.length && trials < budget; pass++) {
    const [x, y] = knots[0]
    // The legs that join the tangled pair: each back to where their ways from the first leg laid out meet.
    const ancestry = (leg: Leg) => { const out: Leg[] = []; for (let l: Leg | undefined = leg; l && !out.includes(l); l = l.parent) out.push(l); return out }
    const ax = ancestry(x), ay = ancestry(y), meet = ax.find(l => ay.includes(l))
    const path = [...ax.slice(0, meet ? ax.indexOf(meet) + 1 : ax.length), ...ay.slice(0, meet ? ay.indexOf(meet) : ay.length)]
    let best: { legs: Record<string, number>; knots: Array<[Leg, Leg, number]> } | undefined
    for (const leg of path.reverse())
      for (const f of [1.6, 0.6, 2.5, 0.4, 4, 0.25]) {
        if (trials >= budget) break
        const factor = Math.min(4, Math.max(0.25, (legs[leg.key] ?? 1) * f))
        const trial = { ...legs, [leg.key]: factor }, k = tangles(doc, lay(trial))
        trials++
        if (!best || score(k) < score(best.knots) - 1e-6 || (Math.abs(score(k) - score(best.knots)) < 1e-6 && change(trial) < change(best.legs))) best = { legs: trial, knots: k }
      }
    if (!best || score(best.knots) > score(knots) - 0.5) break
    ;({ legs, knots } = best)
  }
  return legs
}

/** Least distance between two page segments, or less than zero when they cross. */
function segmentGap(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (o: Point, p: Point, q: Point) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  const crossed = ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  const toSegment = (p: Point, s: Point, e: Point) => {
    const v = sub2(e, s), l2 = v[0] * v[0] + v[1] * v[1], t = l2 ? Math.max(0, Math.min(1, ((p[0] - s[0]) * v[0] + (p[1] - s[1]) * v[1]) / l2)) : 0
    return Math.hypot(p[0] - s[0] - v[0] * t, p[1] - s[1] - v[1] * t)
  }
  const near = Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b))
  // Crossed, the gap is negative: how far the nearest end would have to come back to clear.
  return crossed ? -near : near
}
const add2 = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]]
const sub2 = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const scale2 = (a: Point, k: number): Point => [a[0] * k, a[1] * k]
