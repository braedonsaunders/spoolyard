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
 * Lay out the spool on the page. To scale, every point is projected directly. Not to scale, each straight keeps its
 * direction but its drawn length is compressed, laid out from an open end through the network.
 */
export function layoutSheet(doc: IsoDocument, runs: PipeRun[], nodes: PipeNode[], view: View, schematic: boolean): Layout {
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
  // Straight legs through in-line components keep their ends fixed while a component slides along them.
  const inline = (id: string, from: PipeRun) => {
    const list = edges.get(id) ?? []
    if (list.length !== 2 || getNode(doc, id).kind === 'end') return undefined
    const next = list.find(r => r !== from)!
    const u = unit(position(from.from === id ? from.to : from.from), position(id)), v = unit(position(id), position(next.from === id ? next.to : next.from))
    return !from.connector && !next.connector && u[0] * v[0] + u[1] * v[1] + u[2] * v[2] > 0.999999 ? next : undefined
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
    for (const end of [leg.nodes[0], leg.nodes.at(-1)!]) legEdges.set(end, [...(legEdges.get(end) ?? []), leg])
  let ratio = 0, count = 0
  const done = new Set<{ nodes: string[]; runs: PipeRun[] }>()
  const legs = [...new Set(legOf.values())]
  while (done.size < legs.length) {
    const left = legs.filter(l => !done.has(l))
    const ends = left.flatMap(l => [l.nodes[0], l.nodes.at(-1)!])
    const start = ends.find(id => raw.has(id)) ?? ends.find(id => (legEdges.get(id) ?? []).length === 1) ?? ends[0]
    if (!raw.has(start)) {
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
        const order = leg.nodes[0] === at ? leg.nodes : [...leg.nodes].reverse()
        const far = order.at(-1)!, a = position(at), b = position(far)
        const page = sub2(project(b), project(a)), span = Math.hypot(...page), mm = length(sub(b, a))
        const origin = raw.get(at)!
        if (span < 1e-9 || mm < 1e-9) { for (const id of order) if (!raw.has(id)) raw.set(id, origin); queue.push(far); continue }
        // Each piece of the leg gets a compressed share, so short pieces between fittings stay readable.
        const pieces = order.slice(1).map((id, i) => length(sub(position(id), position(order[i]))))
        const weights = pieces.map(p => leg.runs[0].connector ? p : schematicLength(p))
        const total = weights.reduce((x, y) => x + y, 0) || 1
        // Offsets get extra room for their triangles, angles and leg dimensions.
        const d3 = sub(b, a), skew = Math.max(...d3.map(Math.abs)) / mm < 0.9999 ? 1.5 : 1
        const drawn = (leg.runs[0].connector ? Math.max(60, schematicLength(mm) * 0.5) : schematicLength(mm) * (1 + 0.3 * (pieces.length - 1)) * skew) * span / mm
        let along = 0
        order.slice(1).forEach((id, i) => {
          along += weights[i]
          if (!raw.has(id)) raw.set(id, add2(origin, scale2(page, drawn * along / total / span)))
        })
        ratio += drawn / span; count++
        queue.push(far)
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
  for (const n of nodes) if (!raw.has(n.id) && ids.has(n.id)) raw.set(n.id, rawProject(n.position))
  return { raw, rawProject, scale: meanScale }
}
const add2 = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]]
const sub2 = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const scale2 = (a: Point, k: number): Point => [a[0] * k, a[1] * k]
