import { nodeCode } from '../joints'
import { getNode, length, sub, type IsoDocument, type PipeNode, type PipeRun, type Vec3 } from '../model'
import type { Point } from '../drawing'

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

export interface Layout {
  /** Unscaled page position of every node in the sheet. */
  raw: Map<string, Point>
  /** Unscaled page position of any model point; total, so routing previews and welds land on the drawing. */
  rawProject: (p: Vec3) => Point
  /** Page units per model millimetre near a point, used to keep off-network previews at true scale. */
  scale: number
}

/** Drawn length of a straight in not-to-scale layouts: long runs are compressed, short pieces enlarged. */
export const schematicLength = (mm: number) => Math.max(320, 1000 * (Math.max(mm, 1) / 1000) ** 0.45)

/**
 * Room (sheet units) a node's symbol and its callouts need along each pipe it joins. Drafters size a not-to-scale
 * isometric by what is on each straight, not by its length, so valves and flanged joints get the space they need.
 */
/** Sheet room every pipe piece needs for its tag, weld dots and dimension text; fittings joined direct need less. */
const PIECE = 60
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
 * plus `base` times its compressed length, so the caller can choose `base` to fill the sheet.
 */
export function layoutSheet(doc: IsoDocument, runs: PipeRun[], nodes: PipeNode[], view: View, schematic: boolean, base = 1): Layout {
  const project = (p: Vec3) => viewProject(p, view, doc.north)
  if (!schematic || !runs.length) {
    const raw = new Map(nodes.map(n => [n.id, project(n.position)] as [string, Point]))
    return { raw, rawProject: project, scale: 1 }
  }
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
  const legOf = new Map<string, { nodes: string[]; runs: PipeRun[] }>()
  for (const run of runs) {
    if (legOf.has(run.id)) continue
    const leg = { nodes: [run.from, run.to], runs: [run] }
    for (let r: PipeRun | undefined = run, at = run.from; (r = inline(at, r!)) && !leg.runs.includes(r);) {
      leg.runs.unshift(r); at = r.from === at ? r.to : r.from; leg.nodes.unshift(at)
    }
    for (let r: PipeRun | undefined = run, at = run.to; (r = inline(at, r!)) && !leg.runs.includes(r);) {
      leg.runs.push(r); at = r.from === at ? r.to : r.from; leg.nodes.push(at)
    }
    for (const r of leg.runs) legOf.set(r.id, leg)
  }
  const legEdges = new Map<string, Array<{ nodes: string[]; runs: PipeRun[] }>>()
  for (const leg of new Set(legOf.values()))
    for (const id of leg.nodes) legEdges.set(id, [...(legEdges.get(id) ?? []), leg])
  let ratio = 0, count = 0
  const room = (id: string) => symbolRoom(doc, getNode(doc, id))
  // Supports and other attachments on a piece need their own room for symbols and labels.
  const attached = new Map<string, number>()
  for (const n of nodes) if (n.associatedRunId) attached.set(n.associatedRunId, (attached.get(n.associatedRunId) ?? 0) + 1)
  const between = (a: string, b: string) => runs.find(r => (r.from === a && r.to === b) || (r.from === b && r.to === a))
  const hung = (a: string, b: string) => 22 * (attached.get(between(a, b)?.id ?? '') ?? 0)
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
  const done = new Set<{ nodes: string[]; runs: PipeRun[] }>()
  const legs = [...new Set(legOf.values())]
  while (done.size < legs.length) {
    const left = legs.filter(l => !done.has(l))
    const ends = left.flatMap(l => [l.nodes[0], l.nodes.at(-1)!])
    // Branches fixed to a pipe (a nipple on an olet) grow from where their host is drawn.
    const hosted = ends.find(id => hostFoot(id))
    const start = ends.find(id => raw.has(id)) ?? hosted ?? ends.find(id => (legEdges.get(id) ?? []).length === 1) ?? ends[0]
    const foot = !raw.has(start) && hostFoot(start)
    if (foot) {
      const off = sub(position(start), foot.point), mm = length(off), page = sub2(project(position(start)), project(foot.point)), span = Math.hypot(...page)
      const drawn = base * schematicLength(mm) * 0.5 + room(start)
      raw.set(start, span > 1e-9 ? add2(foot.at, scale2(page, drawn / span)) : foot.at)
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
        // The leg is laid out from wherever it was reached: an end, or a tee on its run.
        const order = leg.nodes, first = order[0], last = order.at(-1)!, a = position(first), b = position(last)
        const page = sub2(project(b), project(a)), span = Math.hypot(...page), mm = length(sub(b, a))
        const origin = raw.get(at)!
        if (span < 1e-9 || mm < 1e-9) { for (const id of order) if (!raw.has(id)) { raw.set(id, origin); queue.push(id) } continue }
        // Each piece of the leg gets a compressed share of the length, so short pieces between fittings stay
        // readable, plus the room its end symbols and the hangers on it need.
        const pieces = order.slice(1).map((id, i) => length(sub(position(id), position(order[i]))))
        const d3 = sub(b, a), offsetLeg = Math.max(...d3.map(Math.abs)) / mm < 0.9999
        const weights = pieces.map((p, i) => (between(order[i], order[i + 1])?.connector && !offsetLeg ? PIECE * 0.3 : PIECE) + base * schematicLength(p) + room(order[i]) + room(order[i + 1]) + hung(order[i], order[i + 1]))
        const total = weights.reduce((x, y) => x + y, 0) || 1
        // Offsets get extra room for their triangles, angles and leg dimensions.
        const skew = offsetLeg ? 1.5 : 1
        // Offsets are drawn at full length whatever their foreshortening, so their constructions stay legible.
        const drawn = total * skew * (offsetLeg ? 1 : span / mm)
        const station = order.map((_, i) => weights.slice(0, i).reduce((x, y) => x + y, 0))
        const from = station[order.indexOf(at)]
        order.forEach((id, i) => {
          if (raw.has(id)) return
          raw.set(id, add2(origin, scale2(page, drawn * (station[i] - from) / total / span)))
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
  return { raw, rawProject, scale: meanScale }
}
const add2 = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]]
const sub2 = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const scale2 = (a: Point, k: number): Point => [a[0] * k, a[1] * k]
