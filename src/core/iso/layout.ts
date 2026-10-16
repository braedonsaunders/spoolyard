import { nodeCode } from '../joints'
import { getNode, length, sub, type IsoDocument, type PipeNode, type PipeRun, type Vec3 } from '../model'
import type { Point } from '../drawing'
import { measureText } from '../stroke-font'
import { SIZE } from './context'

export type View = 'iso' | 'plan' | 'front' | 'side'
/** Page direction (y down) of a model vector, before scaling. */
export function viewProject(p: Vec3, view: View, north = 0): Point {
  if (view === 'plan') return [p[0], -p[1]]
  if (view === 'front') return [p[0], -p[2]]
  if (view === 'side') return [p[1], -p[2]]
  const angle = north * Math.PI / 180
  const x = p[0] * Math.cos(angle) - p[1] * Math.sin(angle), y = p[0] * Math.sin(angle) + p[1] * Math.cos(angle)
  return [(x - y) * Math.cos(Math.PI / 6), -(x + y) * 0.5 - p[2]]
}

/** Least angle off the vertical at which a not-to-scale layout draws a level pipe, and the iso axes' own angle. */
const SKEW = 15 * Math.PI / 180, AXIS = Math.PI / 3
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
  if (Math.abs(a) < AXIS) a = (a < -1e-9 ? -1 : 1) * (SKEW + Math.abs(a) * (AXIS - SKEW) / AXIS)
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

/** Drawn length of a straight in not-to-scale layouts: long runs are compressed, short pieces enlarged. */
export const schematicLength = (mm: number) => Math.max(320, 1000 * (Math.max(mm, 1) / 1000) ** 0.45)

/** Sheet room every pipe piece needs for its tag, weld dots and dimension text. */
const PIECE = 60
/** Fittings joined with no pipe between them sit this close, plus their symbols' room, whatever the sheet's scale. */
const JOIN = 8
/** Joints this short (a gasket) are drawn as one joint. */
const GASKET = 6
/**
 * Room (sheet units) a node's symbol and its callouts need along each pipe it joins. Drafters size a not-to-scale
 * isometric by what is on each straight, not by its length, so valves and flanged joints get the space they need.
 */
export function symbolRoom(doc: IsoDocument, node: PipeNode): number {
  const code = nodeCode(doc, node) ?? ''
  switch (node.kind) {
    case 'valve': return /NIPPLE/.test(code) ? 3 : /UNION|CPLG/.test(code) ? 12 : 40
    case 'flange': return 18
    case 'reducer': return 20
    case 'gasket': return 14
    case 'tee': case 'olet': return 10
    default: return 0
  }
}

/**
 * Lay out the spool on the page. To scale, every point is projected directly. Not to scale, each straight keeps its
 * direction, laid out from an open end through the network: every piece gets the sheet room its components need
 * plus `base` times its compressed length, so the caller can choose `base` to fill the sheet; fittings joined with no
 * pipe between them stay close together.
 */
export function layoutSheet(doc: IsoDocument, runs: PipeRun[], nodes: PipeNode[], view: View, schematic: boolean, base = 1, shape: LegShape = {}): Layout {
  const project = (p: Vec3) => viewProject(p, view, doc.north)
  if (!schematic || !runs.length) {
    const raw = new Map(nodes.map(n => [n.id, project(n.position)] as [string, Point]))
    return { raw, rawProject: project, scale: 1, legs: [] }
  }
  const direction = (v: Vec3) => layoutDirection(v, view, doc.north)
  const raw = new Map<string, Point>()
  const ids = new Set(nodes.map(n => n.id))
  const edges = new Map<string, PipeRun[]>()
  for (const r of runs) for (const end of [r.from, r.to]) edges.set(end, [...(edges.get(end) ?? []), r])
  const position = (id: string) => getNode(doc, id).position
  const unit = (a: Vec3, b: Vec3) => { const d = sub(b, a), l = length(d) || 1; return [d[0] / l, d[1] / l, d[2] / l] }
  // Straight legs run through in-line components and along the run of tees, keeping their ends fixed while a
  // component slides along them; fittings joined with no pipe between them are part of the leg.
  const inline = (id: string, from: PipeRun) => {
    const list = edges.get(id) ?? []
    if (list.length < 2 || getNode(doc, id).kind === 'end') return undefined
    const u = unit(position(from.from === id ? from.to : from.from), position(id))
    return list.find(next => {
      if (next === from) return false
      const v = unit(position(id), position(next.from === id ? next.to : next.from))
      return u[0] * v[0] + u[1] * v[1] + u[2] * v[2] > 0.999999
    })
  }
  const order = new Map(runs.map((r, i) => [r.id, i]))
  const legOf = new Map<string, Leg>()
  for (const run of runs) {
    if (legOf.has(run.id)) continue
    const leg: Leg = { key: run.id, nodes: [run.from, run.to], runs: [run] }
    for (let r: PipeRun | undefined = run, at = run.from; (r = inline(at, r!)) && !leg.runs.includes(r);) {
      leg.runs.unshift(r); at = r.from === at ? r.to : r.from; leg.nodes.unshift(at)
    }
    for (let r: PipeRun | undefined = run, at = run.to; (r = inline(at, r!)) && !leg.runs.includes(r);) {
      leg.runs.push(r); at = r.from === at ? r.to : r.from; leg.nodes.push(at)
    }
    // Keyed by its first run in the document, which routing never changes.
    leg.key = leg.runs.reduce((a, b) => order.get(b.id)! < order.get(a.id)! ? b : a).id
    for (const r of leg.runs) legOf.set(r.id, leg)
  }
  const legEdges = new Map<string, Leg[]>()
  for (const leg of new Set(legOf.values()))
    for (const id of leg.nodes) legEdges.set(id, [...(legEdges.get(id) ?? []), leg])
  let ratio = 0, count = 0
  const room = (id: string) => symbolRoom(doc, getNode(doc, id))
  // Supports and other attachments on a piece need their own room for symbols and labels.
  // A labelled attachment needs about half its label's width along the pipe, so neighbouring labels do not crowd.
  const attached = new Map<string, number>()
  for (const n of nodes) if (n.associatedRunId) {
    const label = Math.max(0, ...(n.calloutText ?? '').split('\n').map(l => measureText(l.trim(), SIZE.text)))
    attached.set(n.associatedRunId, (attached.get(n.associatedRunId) ?? 0) + Math.max(22, label * 0.6))
  }
  const between = (a: string, b: string) => runs.find(r => (r.from === a && r.to === b) || (r.from === b && r.to === a))
  const hung = (a: string, b: string) => attached.get(between(a, b)?.id ?? '') ?? 0
  const stretch = shape.stretch ?? 0
  /** Model fraction along its host pipe of an attached node. */
  const fraction = (id: string, host: PipeRun) => {
    const a = position(host.from), d = sub(position(host.to), a), len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], p = position(id)
    return len2 > 1e-12 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2)) : 0
  }
  // Attachments are spaced along their pipe as drawn, in order, clear of the fittings at its ends and of each other,
  // the way a drafter spreads olets and hangers along a compressed straight.
  const slots = new Map<string, number>()
  const slot = (id: string, host: PipeRun): number => {
    if (slots.has(id)) return slots.get(id)!
    const pa = raw.get(host.from)!, pb = raw.get(host.to)!, drawn = Math.hypot(...sub2(pb, pa))
    const mm = length(sub(position(host.to), position(host.from)))
    const groups: Array<{ t: number; ids: string[] }> = []
    for (const n of nodes.filter(n => n.associatedRunId === host.id).map(n => ({ id: n.id, t: fraction(n.id, host) })).sort((x, y) => x.t - y.t)) {
      const last = groups.at(-1)
      if (last && (n.t - last.t) * mm < 1) last.ids.push(n.id)
      else groups.push({ t: n.t, ids: [n.id] })
    }
    const start = room(host.from) + 10, end = drawn - room(host.to) - 10, gap = 22
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
    const host = runs.find(r => r.id === getNode(doc, id).associatedRunId)
    const pa = host && raw.get(host.from), pb = host && raw.get(host.to)
    if (!host || !pa || !pb) return undefined
    const a = position(host.from), d = sub(position(host.to), a), t = fraction(id, host), u = slot(id, host)
    return { point: [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], at: [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u] }
  }
  const done = new Set<Leg>()
  const legs = [...new Set(legOf.values())]
  // The leg that placed each node, so each leg knows the one it was laid out from.
  const placer = new Map<string, Leg>()
  while (done.size < legs.length) {
    const left = legs.filter(l => !done.has(l))
    const ends = left.flatMap(l => [l.nodes[0], l.nodes.at(-1)!])
    // Branches fixed to a pipe (a nipple on an olet) grow from where their host is drawn.
    const hosted = ends.find(id => hostFoot(id))
    const start = ends.find(id => raw.has(id)) ?? hosted ?? ends.find(id => (legEdges.get(id) ?? []).length === 1) ?? ends[0]
    const foot = !raw.has(start) && hostFoot(start)
    if (foot) {
      const off = sub(position(start), foot.point), mm = length(off), page = direction(off), span = Math.hypot(...page)
      const drawn = base * schematicLength(mm) * 0.5 + room(start)
      raw.set(start, span > 1e-9 ? add2(foot.at, scale2(page, drawn / span)) : foot.at)
      const host = legOf.get(getNode(doc, start).associatedRunId ?? '')
      if (host) placer.set(start, host)
    } else if (!raw.has(start)) {
      // Later networks start beside the earlier ones at their true relative position.
      const anchor = [...raw.keys()][0]
      raw.set(start, anchor ? add2(raw.get(anchor)!, scale2(sub2(project(position(start)), project(position(anchor))), ratio / Math.max(count, 1))) : [0, 0])
    }
    const queue = [start]
    while (queue.length) {
      const at = queue.shift()!
      for (const leg of legEdges.get(at) ?? []) {
        if (done.has(leg)) continue
        done.add(leg)
        leg.from = at
        leg.parent = placer.get(at)
        // The leg is laid out from wherever it was reached: an end, or a tee on its run.
        const order = leg.nodes, first = order[0], last = order.at(-1)!, a = position(first), b = position(last)
        const d3 = sub(b, a), page = direction(d3), span = Math.hypot(...page), mm = length(d3)
        const origin = raw.get(at)!
        if (span < 1e-9 || mm < 1e-9) { for (const id of order) if (!raw.has(id)) { raw.set(id, origin); queue.push(id) } continue }
        const offsetLeg = Math.max(...d3.map(Math.abs)) / mm < 0.9999
        // Pipe drawn across the page is lengthened to fill a narrow drawing out.
        const u = [page[0] / span, page[1] / span]
        const stretched = 1 + stretch * Math.abs(u[0])
        // Each piece of the leg gets a compressed share of the length, so short pieces between fittings stay
        // readable, plus the room its end symbols and the hangers on it need. Fittings joined direct stay close.
        const weights = order.slice(1).map((id, i) => {
          const p = length(sub(position(id), position(order[i]))), ends = room(order[i]) + room(id) + hung(order[i], id)
          if (!between(order[i], id)?.connector) return (PIECE + base * schematicLength(p)) * stretched + ends
          return p < GASKET ? JOIN / 2 : JOIN + ends
        })
        const total = weights.reduce((x, y) => x + y, 0) || 1
        // Offsets are drawn at full length whatever their foreshortening, and never shorter than a pipe piece, so
        // their constructions stay legible without dwarfing the runs beside them.
        const drawn = (offsetLeg ? Math.max(total, PIECE + base * schematicLength(mm) * 0.5) : total * span / mm) * (shape.legs?.[leg.key] ?? 1)
        const station = order.map((_, i) => weights.slice(0, i).reduce((x, y) => x + y, 0))
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
  const segments = runs.map(r => ({ r, a: getNode(doc, r.from).position, b: getNode(doc, r.to).position }))
  const rawProject = (p: Vec3): Point => {
    // Points on a pipe interpolate along its drawn straight; anything else sits off the nearest node at true scale.
    for (const { r, a, b } of segments) {
      const d = sub(b, a), len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
      if (len2 < 1e-12) continue
      const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2
      if (t < -1e-9 || t > 1 + 1e-9) continue
      const off = length(sub(p, [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]))
      if (off > 0.5) continue
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

/** Sheet clearance (layout units) two unrelated straights keep, so neither reads as part of the other. */
const CLEAR = 8
/**
 * How badly unrelated straights tangle in a not-to-scale layout: one for each pair of pieces that cross or come
 * within `CLEAR` of each other. Pieces of one leg, of legs that meet, and branches on their host do not count.
 */
export function tangles(doc: IsoDocument, layout: Layout): Array<[Leg, Leg]> {
  const pieces = layout.legs.flatMap(leg => leg.nodes.slice(1).flatMap((id, i) => {
    const a = layout.raw.get(leg.nodes[i]), b = layout.raw.get(id)
    return a && b && Math.hypot(...sub2(b, a)) > 1e-6 ? [{ leg, a, b }] : []
  }))
  // Branches meet their host, and branches off one host meet each other there.
  const host = (leg: Leg) => leg.nodes.map(id => getNode(doc, id).associatedRunId).find(Boolean)
  const related = (x: Leg, y: Leg) => x === y || x.nodes.some(id => y.nodes.includes(id)) ||
    [[x, y], [y, x]].some(([p, q]) => q.runs.some(r => r.id === host(p))) || (!!host(x) && host(x) === host(y))
  const out: Array<[Leg, Leg]> = []
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const p = pieces[i], q = pieces[j]
      if (!related(p.leg, q.leg) && segmentGap(p.a, p.b, q.a, q.b) < CLEAR) out.push([p.leg, q.leg])
    }
  return out
}

/**
 * Leg length factors that keep unrelated straights of a not-to-scale layout from crossing or running into each
 * other, found by lengthening or shortening the legs that join each tangled pair, a few at a time.
 */
export function untangle(doc: IsoDocument, runs: PipeRun[], nodes: PipeNode[], view: View, base: number, shape: LegShape = {}): Record<string, number> {
  let legs = { ...shape.legs }
  const lay = (factors: Record<string, number>) => layoutSheet(doc, runs, nodes, view, true, base, { ...shape, legs: factors })
  let layout = lay(legs), knots = tangles(doc, layout)
  const change = (factors: Record<string, number>) => Object.values(factors).reduce((s, f) => s + Math.abs(Math.log(f)), 0)
  for (let pass = 0; pass < 8 && knots.length; pass++) {
    const [x, y] = knots[0]
    // The legs that join the tangled pair: each back to where their ways from the first leg laid out meet.
    const ancestry = (leg: Leg) => { const out: Leg[] = []; for (let l: Leg | undefined = leg; l && !out.includes(l); l = l.parent) out.push(l); return out }
    const ax = ancestry(x), ay = ancestry(y), meet = ax.find(l => ay.includes(l))
    const path = [...ax.slice(0, meet ? ax.indexOf(meet) + 1 : ax.length), ...ay.slice(0, meet ? ay.indexOf(meet) : ay.length)]
    let best: { legs: Record<string, number>; layout: Layout; knots: Array<[Leg, Leg]> } | undefined
    for (const leg of path.reverse())
      for (const f of [1.6, 0.6, 2.5, 0.4]) {
        const factor = Math.min(4, Math.max(0.25, (legs[leg.key] ?? 1) * f))
        const trial = { ...legs, [leg.key]: factor }, l = lay(trial), k = tangles(doc, l)
        if (!best || k.length < best.knots.length || (k.length === best.knots.length && change(trial) < change(best.legs))) best = { legs: trial, layout: l, knots: k }
      }
    if (!best || best.knots.length >= knots.length) break
    ;({ legs, layout, knots } = best)
  }
  return legs
}

/** Least distance between two page segments (zero when they cross). */
function segmentGap(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (o: Point, p: Point, q: Point) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  const toSegment = (p: Point, s: Point, e: Point) => {
    const v = sub2(e, s), l2 = v[0] * v[0] + v[1] * v[1], t = l2 ? Math.max(0, Math.min(1, ((p[0] - s[0]) * v[0] + (p[1] - s[1]) * v[1]) / l2)) : 0
    return Math.hypot(p[0] - s[0] - v[0] * t, p[1] - s[1] - v[1] * t)
  }
  return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b))
}
const add2 = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]]
const sub2 = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const scale2 = (a: Point, k: number): Point => [a[0] * k, a[1] * k]
