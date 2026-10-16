import type { Point } from '../drawing'
import { draftLength, angleText } from '../format'
import { connected, distance, getNode, length, runResult, sub, takeout, type DimensionAnchor, type PipeNode, type PipeRun, type Vec3 } from '../model'
import { continuationPoint, nodeCode } from '../joints'
import { SIZE, emitters, type IsoContext } from './context'
import { measureText } from '../stroke-font'
import { segmentPoly, textPoly, type Poly } from './placement'
import { add2, dot2, isAxial, lerp2, planeText, scale2, sub2, unit2, unit3, uprightOf } from './plane'

/** A point a leg is measured to; `along` is its distance from the leg's first node, `of` the valve whose face it is. */
interface Station { model: Vec3; page: Point; along: number; node?: string; end?: boolean; of?: string }
interface Span { a: Station; b: Station; mm: number; approximate?: boolean }
/** Overlap costs for lettering that must not overprint other lettering. */
const LETTERED = { text: 1000, tag: 1000 }
interface Leg { runs: PipeRun[]; nodes: string[]; dir3: Vec3; dir: Point }

/** Straight legs of the sheet: in-line pipes joined through valves, flanges, reducers and welds. */
export function sheetLegs(ctx: IsoContext): Leg[] {
  const seen = new Set<string>(), legs: Leg[] = []
  // A leg runs through in-line components, fittings joined without pipe, and the run of a tee.
  const straightThrough = (node: PipeNode, from: PipeRun) => {
    if (node.kind === 'end' || node.kind.startsWith('elbow')) return undefined
    const a = ctx.geometry.get(from.id)!
    return connected(ctx.doc, node.id).filter(r => r.id !== from.id && ctx.geometry.has(r.id)).find(r => {
      const b = ctx.geometry.get(r.id)!
      return Math.abs(Math.abs(a.dir3[0] * b.dir3[0] + a.dir3[1] * b.dir3[1] + a.dir3[2] * b.dir3[2]) - 1) < 1e-4
    })
  }
  for (const g of ctx.geometry.values()) {
    if (seen.has(g.run.id)) continue
    const runs = [g.run], nodes = [g.run.from, g.run.to]
    seen.add(g.run.id)
    for (let r: PipeRun | undefined = g.run, at = g.run.from; (r = straightThrough(getNode(ctx.doc, at), r!)) && !seen.has(r.id);) {
      seen.add(r.id); runs.unshift(r); at = r.from === at ? r.to : r.from; nodes.unshift(at)
    }
    for (let r: PipeRun | undefined = g.run, at = g.run.to; (r = straightThrough(getNode(ctx.doc, at), r!)) && !seen.has(r.id);) {
      seen.add(r.id); runs.push(r); at = r.from === at ? r.to : r.from; nodes.push(at)
    }
    const a = ctx.pos.get(nodes[0])!, b = ctx.pos.get(nodes.at(-1)!)!
    const pa = getNode(ctx.doc, nodes[0]).position, pb = getNode(ctx.doc, nodes.at(-1)!).position
    legs.push({ runs, nodes, dir3: unit3(sub(pb, pa)), dir: unit2(sub2(b, a)) })
  }
  return legs
}

/**
 * Dimension tiers stand off the pipe along their extension lines by these sheet units (850 = 11 in), measured on the
 * issued sheets: the first 0.56 in out, each further tier 0.37 in beyond it.
 */
const TIER = 43.5, TIER_STEP = 29

/** Offset angles in whole degrees, but the half degree of a 22 1/2° or 67 1/2° offset made with standard fittings. */
const degrees = (a: number) => [22.5, 67.5].find(h => Math.abs(a - h) < 0.15) ?? Math.round(a)

/** Where the pipe turns or branches: elbows, bends and tees are located at their work points. */
const workPoint = (node: PipeNode) => /^(elbow|tee)/.test(node.kind)

/**
 * A screwed vent or drain stub: one straight run of parts joined without pipe off a branch, capped (an olet's stub may
 * also end at an instrument). Its parts give its length. Returns the node it stands on.
 */
function closedStub(ctx: IsoContext, leg: Leg): PipeNode | undefined {
  if (!leg.runs.every(r => r.connector || r.nipple)) return undefined
  const [a, b] = [leg.nodes[0], leg.nodes.at(-1)!].map(id => getNode(ctx.doc, id))
  const branch = (n: PipeNode) => !!n.associatedRunId || n.kind === 'tee'
  const [on, far] = branch(a) ? [a, b] : branch(b) ? [b, a] : []
  return on && far && (far.kind === 'cap' || (!!on.associatedRunId && far.kind === 'end' && !far.continuation)) ? on : undefined
}

/** Distance along a pipe's own direction, to tell where on it something attached sits. */
function alongRun(ctx: IsoContext, run: PipeRun) {
  const dir = unit3(sub(getNode(ctx.doc, run.to).position, getNode(ctx.doc, run.from).position))
  return (p: Vec3) => p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]
}

/** The olet a part attached off the pipe's centreline stands on (a nipple screwed into it). */
function oletUnder(ctx: IsoContext, node: PipeNode): PipeNode | undefined {
  const host = node.kind !== 'olet' && ctx.doc.runs.find(r => r.id === node.associatedRunId)
  if (!host) return undefined
  const along = alongRun(ctx, host)
  return ctx.nodes.find(o => o.kind === 'olet' && o.associatedRunId === host.id && Math.abs(along(o.position) - along(node.position)) < 1 &&
    distance(o.position, node.position) > 1)
}

/** Olets carrying a capped vent or drain stub: they are located on the pipe rather than cut into its chain. */
function ventOlets(ctx: IsoContext, legs: Leg[]): Set<string> {
  const out = new Set<string>()
  for (const leg of legs) {
    const on = closedStub(ctx, leg)
    if (!on || getNode(ctx.doc, on.id === leg.nodes[0] ? leg.nodes.at(-1)! : leg.nodes[0]).kind !== 'cap') continue
    const host = ctx.doc.runs.find(r => r.id === on.associatedRunId)
    if (!host) continue
    const along = alongRun(ctx, host)
    for (const n of ctx.nodes)
      if (n.kind === 'olet' && n.associatedRunId === host.id && Math.abs(along(n.position) - along(on.position)) < 1) out.add(n.id)
  }
  return out
}

/** Distance along a leg from its first node. */
function measureAlong(ctx: IsoContext, leg: Leg) {
  const origin = getNode(ctx.doc, leg.nodes[0]).position
  return (p: Vec3) => (p[0] - origin[0]) * leg.dir3[0] + (p[1] - origin[1]) * leg.dir3[1] + (p[2] - origin[2]) * leg.dir3[2]
}

/**
 * The chain stations of a leg: its ends, fitting work points, flange faces, the mating faces of flanged valves,
 * reducer ends and branch connections.
 */
function stations(ctx: IsoContext, leg: Leg, vents: Set<string>, bodyFaces = false): Station[] {
  const out: Station[] = []
  const along = measureAlong(ctx, leg), own = new Set(leg.runs.map(r => r.id))
  const at = (model: Vec3, page: Point, node?: string, end = false, of?: string) => out.push({ model, page, node, along: along(model), end, ...(of ? { of } : {}) })
  leg.nodes.forEach((id, i) => {
    const node = getNode(ctx.doc, id), page = ctx.pos.get(id)!
    let end = i === 0 || i === leg.nodes.length - 1
    if (!end && (bodyFaces ? node.dimensionChain === 'mate' : node.dimensionChain === 'body')) return
    if (!end && node.kind === 'gasket') return
    const code = nodeCode(ctx.doc, node) ?? ''
    // A branch standing on a part screwed into an olet is measured from the pipe's centreline, at the olet.
    const olet = end ? oletUnder(ctx, node) : undefined, base = olet && ctx.pos.get(olet.id)
    if (olet && base) { at(olet.position, base, olet.id, true); end = false }
    // Nipples, couplings, unions and regulators only join the pieces either side: the dimensions run through them.
    if (!end && /NIPPLE|UNION|CPLG|REGUL/.test(code)) return
    const joints = ctx.joints.filter(j => j.nodeId === id && j.kind === 'component-port' && own.has(j.runIds[0]))
    const e = ctx.extent.get(id) ?? 0
    if (!end && joints.length) {
      // A flanged valve is dimensioned between its mating flange faces, across its gaskets. A drawing that ends at the
      // valve's own face leaves that gasket to the next drawing.
      for (const j of joints) {
        const run = ctx.runs.find(r => r.id === j.runIds[0]), g = run && ctx.geometry.get(run.id)
        if (!run || !g) continue
        const far = getNode(ctx.doc, run.from === id ? run.to : run.from).position
        const out3 = sub(far, node.position), l = length(out3) || 1
        const gap = bodyFaces ? 0 : Math.min(j.gasket?.thickness ?? 0, distance(j.position, far))
        const face: Vec3 = [0, 1, 2].map(k => j.position[k] + out3[k] / l * gap) as Vec3
        const dir = run.from === id ? g.dir : scale2(g.dir, -1)
        const inset = bodyFaces && j.gasket?.thickness ? SIZE.flangeThickness : 0
        at(face, add2(page, scale2(dir, Math.max(0, e - SIZE.flangeThickness - 0.4 - inset))), undefined, false, id)
      }
      return
    }
    if (bodyFaces && end && node.kind === 'flange' && connected(ctx.doc, id).length === 1) {
      const joint = ctx.joints.find(j => j.nodeId === id && j.kind === 'equipment')
      const gap = joint?.supplied.gasket && node.jointSupply?.measuredTo !== 'mate' ? joint.gasket?.thickness ?? 0 : 0
      const far = getNode(ctx.doc, leg.nodes[i === 0 ? 1 : i - 1]).position
      const out3 = unit3(sub(node.position, far)), dir = i === 0 ? scale2(leg.dir, -1) : leg.dir
      at(node.position.map((v, k) => v + out3[k] * gap) as Vec3, add2(page, scale2(dir, gap ? SIZE.flangeThickness : 0)), id, true)
      return
    }
    if (!end && node.kind === 'reducer' && !/CPLG/.test(code)) {
      // A reducer is dimensioned to both its ends, except where it is welded straight onto the elbow or tee it reduces
      // from: that make-up is measured from the fitting's work point to the reducer's far end.
      const runs = connected(ctx.doc, id).filter(r => own.has(r.id) && ctx.geometry.has(r.id)), large = Math.max(...runs.map(r => r.nps))
      for (const run of runs) {
        const across = getNode(ctx.doc, run.from === id ? run.to : run.from)
        if (run.connector && run.nps === large && workPoint(across)) continue
        const g = ctx.geometry.get(run.id)!, t = takeout(ctx.doc, node, run.id) ?? 0
        const out3 = sub(across.position, node.position), l = length(out3) || 1
        const dir = run.from === id ? g.dir : scale2(g.dir, -1)
        at([0, 1, 2].map(k => node.position[k] + out3[k] / l * t) as Vec3, add2(page, scale2(dir, e)))
      }
      return
    }
    at(node.position, page, id, end)
  })
  // Branch connections on the pipe are stations of the chain; capped vents and drains are located instead.
  for (const n of ctx.nodes) {
    const page = ctx.pos.get(n.id)
    if (n.kind === 'olet' && page && n.associatedRunId && own.has(n.associatedRunId) && !vents.has(n.id)) at(n.position, page, n.id)
  }
  out.sort((a, b) => a.along - b.along)
  // Faces closer than a gasket are one station (a flange pair at a break), measured at the face on the pipe, so the
  // gasket goes with a stub end welded to a fitting; at the end of a leg the gasket is dimensioned.
  const onPipe = (s: Station) => !!s.node && connected(ctx.doc, s.node).some(r => own.has(r.id) && !r.connector)
  const kept: Station[] = []
  for (const s of out) {
    const last = kept.at(-1), gap = last ? s.along - last.along : Infinity
    // Two explicitly drawn flange faces are one bolted joint even at the end of a leg. Use the face on the pipe.
    const flangeGap = last?.node && s.node && getNode(ctx.doc, last.node).kind === 'flange' && getNode(ctx.doc, s.node).kind === 'flange'
    if (flangeGap && gap <= 3.2) {
      if (onPipe(s) && !onPipe(last!)) kept[kept.length - 1] = s
      continue
    }
    if (gap > 3.2 || ((s.end || last!.end) && gap > 0.5)) kept.push(s)
    else if (s.end || (!last!.end && onPipe(s) && !onPipe(last!))) kept[kept.length - 1] = s
  }
  return kept
}

/**
 * What is located along a leg, next to the pipe: supports (unless their dimension is turned off) and annotations
 * marked dimensioned, chained support to support from a fitting; approximate locations, such as a wall, from the
 * nearest fitting and outside the chain; capped vents and drains from the nearest station.
 */
function locations(ctx: IsoContext, leg: Leg, points: Station[], vents: Set<string>): Span[] {
  const along = measureAlong(ctx, leg), own = new Set(leg.runs.map(r => r.id)), out: Span[] = []
  const span = (a: Station, b: Station, approximate = false) =>
    out.push({ ...(a.along <= b.along ? { a, b } : { a: b, b: a }), mm: Math.abs(b.along - a.along), ...(approximate ? { approximate } : {}) })
  const items = ctx.nodes.flatMap(node => {
    const page = ctx.pos.get(node.id)
    if (!page || !node.associatedRunId || !own.has(node.associatedRunId)) return []
    return [{ node, station: { model: node.position, page, node: node.id, along: along(node.position) } as Station }]
  }).sort((a, b) => a.station.along - b.station.along)
  const nearest = (s: Station, pool: Station[]) => pool.reduce((best, p) => Math.abs(p.along - s.along) < Math.abs(best.along - s.along) ? p : best)
  const fitting = (p: Station) => !!p.node && workPoint(getNode(ctx.doc, p.node))
  const located = items.filter(({ node }) => node.kind === 'support' ? node.dimensioned !== false : node.kind === 'annotation' && !!node.dimensioned)
  const chain = located.filter(i => !i.node.approximate).map(i => i.station)
  const hostEnds = (s: Station) => {
    const run = ctx.doc.runs.find(r => r.id === getNode(ctx.doc, s.node!).associatedRunId)
    return run ? [run.from, run.to] : []
  }
  const onPiece = (p: Station, s: Station) => { const id = p.node ?? p.of; return !!id && hostEnds(s).includes(id) }
  if (chain.length) {
    // Supports all on one pipe piece are located from its nearer end: a fitting, a valve face or the end of the leg. A
    // chain across joints starts from a fitting at an end of its first or last support's piece, else from the leg's end
    // there, else from the nearest fitting across joints, whichever lies nearer its support.
    const first = chain[0], last = chain.at(-1)!
    const before = points.filter(p => p.along < first.along - 0.5).reverse(), after = points.filter(p => p.along > last.along + 0.5)
    const choose = (ok: (p: Station, s: Station) => boolean) => {
      const b = before.find(p => ok(p, first)), a = after.find(p => ok(p, last))
      if (b && (!a || first.along - b.along <= a.along - last.along)) return { anchor: b, order: chain }
      return a ? { anchor: a, order: [...chain].reverse() } : undefined
    }
    const single = new Set(chain.map(s => getNode(ctx.doc, s.node!).associatedRunId)).size === 1
    const start = (single ? choose((p, s) => (fitting(p) || !!p.end || !!p.of) && onPiece(p, s)) : undefined) ??
      choose((p, s) => fitting(p) && onPiece(p, s)) ?? choose((p, s) => !!p.end && onPiece(p, s)) ?? choose(fitting) ?? choose(() => true)
    if (start) start.order.reduce((from, s) => { span(from, s); return s }, start.anchor)
  }
  // An approximate location is given from a fitting at an end of its pipe piece, else the nearest fitting or station.
  for (const { station } of located.filter(i => i.node.approximate)) {
    const pool = [points.filter(p => fitting(p) && onPiece(p, station)), points.filter(fitting), points].find(p => p.length)!
    span(nearest(station, pool), station, true)
  }
  for (const { node, station } of items) if (vents.has(node.id)) span(nearest(station, points), station)
  return out
}

/** Spans packed into as few tiers as they need without overlapping along the leg. */
function pack(spans: Span[]): Span[][] {
  const tiers: Span[][] = []
  for (const s of [...spans].sort((x, y) => x.a.along - y.a.along)) {
    const tier = tiers.find(t => t.every(o => s.b.along <= o.a.along + 0.5 || s.a.along >= o.b.along - 0.5))
    if (tier) tier.push(s)
    else tiers.push([s])
  }
  return tiers
}

export function drawDimensions(ctx: IsoContext) {
  const { line, poly, arrow } = emitters(ctx)
  const units = ctx.doc.units
  // Chains are measured between rounded station positions, so the pieces always add up to the rounded whole.
  const quantum = units === 'mm' ? 1 : 25.4 / 16
  const snap = (mm: number) => Math.round(mm / quantum) * quantum
  const measure = (a: Station, b: Station) => ctx.style.dimensionRounding === 'individual'
    ? snap(Math.abs(b.along - a.along)) : Math.abs(snap(b.along) - snap(a.along))
  const node = (id: string) => getNode(ctx.doc, id)
  const drafted = ctx.doc.sheets?.[ctx.spool]?.dimensions
  if (drafted) {
    const anchor = (a: DimensionAnchor): Station | undefined => {
      const n = ctx.nodes.find(n => n.id === a.nodeId), page = ctx.pos.get(a.nodeId)
      if (!n || !page) return
      if (!a.face || !a.runId) return { model: n.position, page, along: 0, node: n.id }
      const run = ctx.runs.find(r => r.id === a.runId), g = run && ctx.geometry.get(run.id)
      if (!run || !g) return
      const far = getNode(ctx.doc, run.from === n.id ? run.to : run.from), out = unit3(sub(far.position, n.position))
      if (n.kind === 'flange' && connected(ctx.doc, n.id).length === 1) {
        const model = continuationPoint(ctx.doc, { ...n, continuation: { text: '', coordinateFace: a.face === 'mate' ? 'mate' : 'flange' } })
        const dir = run.from === n.id ? g.dir : scale2(g.dir, -1), delta = sub(model, n.position)
        const shift = delta.reduce((s, v, i) => s + v * out[i], 0)
        return { model, page: add2(page, scale2(dir, Math.sign(shift) * Math.min(SIZE.flangeThickness, Math.abs(shift)))), along: 0, node: n.id }
      }
      const joint = ctx.joints.find(j => j.nodeId === n.id && j.kind === 'component-port' && j.runIds.includes(run.id))
      const body = joint?.position ?? n.position.map((v, i) => v + out[i] * (n.kind === 'flange' || n.kind === 'end' ? 0 : takeout(ctx.doc, n, run.id) ?? 0)) as Vec3
      const gap = a.face === 'mate' ? joint?.gasket?.thickness ?? 0 : 0
      const model = body.map((v, i) => v + out[i] * gap) as Vec3
      const dir = run.from === n.id ? g.dir : scale2(g.dir, -1)
      const extent = ctx.extent.get(n.id) ?? 0
      const inset = joint ? SIZE.flangeThickness + 0.4 + (a.face === 'body' && joint.gasket ? SIZE.flangeThickness : 0) : 0
      return { model, page: add2(page, scale2(dir, Math.max(0, extent - inset))), along: 0, of: n.id }
    }
    for (const d of drafted) {
      const a = anchor(d.from), b = anchor(d.to)
      if (!a || !b) continue
      const mm = distance(a.model, b.model), ext = unit2(ctx.axis(d.axis))
      if (mm < 0.01 || Math.hypot(...ext) < 0.01 || Math.abs(dot2(unit2(sub2(b.page, a.page)), ext)) > 0.999) continue
      dimension(a, b, snap(mm), ext, d.offset)
    }
    return
  }
  const legs = sheetLegs(ctx), vents = ventOlets(ctx, legs)
  for (const leg of legs) {
    // A capped vent or drain stub takes no dimensions: its parts give its length.
    if (closedStub(ctx, leg)) continue
    const points = stations(ctx, leg, vents)
    if (points.length < 2) continue
    const segments: Span[] = points.slice(1).map((p, i) => ({ a: points[i], b: p, mm: measure(points[i], p) })).filter(s => s.mm > 0.5)
    const located = locations(ctx, leg, points, vents).map(s => ({ ...s, mm: measure(s.a, s.b) })).filter(s => s.mm > 0.5)
    // A fitting's own short port to an open end is dimensioned by its length alone, with no offset construction.
    const ownPort = leg.runs.length === 1 && leg.runs[0].connector && [leg.nodes, [...leg.nodes].reverse()]
      .some(([a, b]) => workPoint(node(a)) && node(b).kind === 'end')
    const skewed = !isAxial(leg.dir3) && !ownPort
    // An offset with nothing along it is dimensioned by its construction alone.
    if (skewed && segments.length < 2 && !located.length) { offset(leg, points); continue }
    if (!segments.length) continue
    // Locations next to the pipe, then the chain between stations, then an overall for each part of the leg between
    // tees.
    const tiers: Span[][] = [...pack(located), segments]
    const sections: Span[][] = [[]]
    for (const s of segments) {
      sections.at(-1)!.push(s)
      if (s.b.node && s.b !== points.at(-1) && node(s.b.node).kind === 'tee') sections.push([])
    }
    const across = (sec: Span[]): Span => ({ a: sec[0].a, b: sec.at(-1)!.b, mm: measure(sec[0].a, sec.at(-1)!.b) })
    let overall = sections.filter(sec => sec.length > 1).map(across)
    // When tees cut the chain into single pieces, the overall runs the whole leg: always along an offset (its true
    // length), else only between two open ends and unless the leg is a fitting's own make-up.
    const open = [points[0], points.at(-1)!].every(p => !p.node || !workPoint(node(p.node)))
    const makeUp = leg.runs.length < 3 && leg.runs.every(r => r.connector)
    if (!overall.length && segments.length > 1 && (skewed || open && !makeUp)) overall = [across(segments)]
    const bodyPoints = ctx.style.componentFaces ? stations(ctx, leg, vents, true) : []
    // Only add body-face spans that differ from the flange-face chain. This replaces its redundant overall.
    const bodyChain = bodyPoints.slice(1).map((p, i) => ({ a: bodyPoints[i], b: p, mm: measure(bodyPoints[i], p) }))
      .filter(s => s.mm > 0.5 && !segments.some(t => distance(s.a.model, t.a.model) < 0.001 && distance(s.b.model, t.b.model) < 0.001))
    if (bodyChain.length && points.some(p => p.of)) tiers.push(bodyChain)
    else if (overall.length) tiers.push(overall)
    const contextSpans: Span[] = []
    for (const ref of ctx.referenceDimensions ?? []) {
      const index = leg.nodes.indexOf(ref.atNodeId)
      if (index !== 0 && index !== leg.nodes.length - 1) continue
      const end = index === 0 ? points[0] : points.at(-1)!, far = index === 0 ? points.at(-1)! : points[0]
      const delta = sub(ref.model, end.model), along = delta.reduce((s, v, i) => s + v * leg.dir3[i], 0)
      if (length(delta) < 0.01 || Math.abs(Math.abs(along) - length(delta)) > 0.1) continue
      // Only extend beyond the continuation, never back into the fabricated leg.
      if (index === 0 ? along >= 0 : along <= 0) continue
      const point: Station = { model: ref.model, page: ref.page, along: end.along + along, end: true }
      contextSpans.push({ a: far, b: point, mm: measure(far, point) })
    }
    if (contextSpans.length) tiers.push(contextSpans)
    // Extension lines run along an isometric axis across the leg: vertical for horizontal legs, horizontal for risers.
    // A level leg drawn upright on the page takes a level axis.
    const horizontal = Math.abs(leg.dir3[2]) < 0.7
    const options: Array<[Vec3, number]> = horizontal
      ? [[[0, 0, 1], 0], [[0, 0, -1], 0], [[1, 0, 0], 150], [[-1, 0, 0], 150], [[0, 1, 0], 150], [[0, -1, 0], 150]]
      : [[[1, 0, 0], 0], [[-1, 0, 0], 0], [[0, 1, 0], 0], [[0, -1, 0], 0]]
    let best: { cost: number; ext: Point } | null = null
    for (const [axis3, penalty] of options) {
      const ext = unit2(ctx.axis(axis3))
      if (Math.abs(dot2(ext, leg.dir)) > 0.95) continue
      let cost = penalty
      tiers.forEach((tier, t) => {
        const off = TIER + t * TIER_STEP
        for (const s of tier) {
          const a = add2(s.a.page, scale2(ext, off)), b = add2(s.b.page, scale2(ext, off))
          // A dimension line may cross a pipe; its lettering may not.
          cost += ctx.place.cost(segmentPoly(a, b, 1), undefined, { pipe: 8, symbol: 30 }) + ctx.place.cost(labelPoly(valueOf(s), a, b, ext))
        }
      })
      // An offset's construction goes on the other side of the pipe from its chain.
      if (skewed) cost += triangleCost(leg, points, ext)
      // Prefer dimensions above and to the right, as drafted.
      cost += (ext[1] > 0 ? 3 : 0) + (ext[0] < -0.1 ? 2 : 0)
      if (!best || cost < best.cost) best = { cost, ext }
    }
    if (!best) { if (skewed) offset(leg, points); continue }
    const ext = best.ext
    tiers.forEach((tier, t) => {
      const off = TIER + t * TIER_STEP
      // Neighbouring pieces of a chain are no place for a short dimension's text.
      const spans = tier.map(s => [s.a.page, s.b.page] as [Point, Point])
      for (const s of tier) dimension(s.a, s.b, s.mm, ext, off, runBetween(leg, s), ownerOf(leg, s), spans.filter(([a]) => a !== s.a.page), s.approximate)
    })
    // The overall of a skewed leg is its true length; the construction goes on the other side.
    if (skewed) offset(leg, points, ext)
  }
  /** A dimension's lettering: the length, marked "(±)" where the location is approximate. */
  function valueOf(s: { mm: number; approximate?: boolean }) {
    return draftLength(s.mm, units, 24) + (s.approximate ? '(±)' : '')
  }
  /** The pipe a dimension measures node to node, so its length can be edited in place. */
  function runBetween(leg: Leg, s: { a: Station; b: Station }) {
    return leg.runs.find(r => s.a.node && s.b.node && [r.from, r.to].includes(s.a.node) && [r.from, r.to].includes(s.b.node))
  }
  function ownerOf(leg: Leg, s: { a: Station; b: Station }) {
    const run = leg.runs.find(r => [r.from, r.to].includes(s.a.node ?? '') && [r.from, r.to].includes(s.b.node ?? ''))
    return run?.id ?? leg.runs[0].id
  }
  function labelPoly(value: string, a: Point, b: Point, ext: Point) {
    const along = unit2(sub2(b, a)), t = planeText(along, ext)
    return textPoly(add2(lerp2(a, b, 0.5), scale2(uprightOf(t), 2)), value, SIZE.text, t.rotation, t.oblique, 'middle', 1)
  }
  /** One dimension: extension lines from both points, a dimension line with arrowheads, and iso-plane text. */
  function dimension(pa: Station, pb: Station, mm: number, ext: Point, offset: number, editable?: PipeRun, owner?: string,
    others: Array<[Point, Point]> = [], approximate = false) {
    const a = add2(pa.page, scale2(ext, offset)), b = add2(pb.page, scale2(ext, offset))
    const along = unit2(sub2(b, a)), span = Math.hypot(...sub2(b, a))
    const value = valueOf({ mm, approximate }), t = planeText(along, ext), up = uprightOf(t)
    const width = measureText(value, SIZE.text)
    const short = span < SIZE.arrow * 2.2
    // Text stands on its reading side of the line; when that is taken it moves beyond an end or to the other side.
    // It is placed before its own lines are drawn, so only other work can push it away.
    const mid = lerp2(a, b, 0.5), reach = span / 2 + SIZE.arrow * (short ? 2 : 0) + width / 2 + 3
    const spots: Point[] = short || span < width + 6
      ? [add2(add2(mid, scale2(along, reach)), scale2(up, 2)), add2(add2(mid, scale2(along, -reach)), scale2(up, 2)), add2(mid, scale2(up, 2)), add2(mid, scale2(up, -SIZE.text - 2))]
      : [add2(mid, scale2(up, 2)), add2(mid, scale2(up, -SIZE.text - 2)), add2(add2(mid, scale2(along, reach)), scale2(up, 2)), add2(add2(mid, scale2(along, -reach)), scale2(up, 2))]
    // When every spot by the line is taken, the text stands clear with a leader back to the line.
    const away = unit2(sub2(mid, lerp2(pa.page, pb.page, 0.5)))
    for (const k of [1, 2, 3]) for (const side of [0, 1, -1])
      spots.push(add2(add2(mid, scale2(away, (SIZE.text + 6) * k + 4)), scale2(along, side * (width / 2 + 6))))
    // Measured back along the extension lines to the pipe, so the offset's slant does not shift it.
    const within = (p: Point) => others.some(([x, y]) => {
      const q = sub2(p, scale2(ext, offset)), u = sub2(y, x), l = Math.hypot(...u) || 1, s = dot2(sub2(q, x), u) / l
      return s > 0 && s < l && Math.abs(dot2(sub2(q, x), [u[1] / l, -u[0] / l])) < SIZE.text * 3
    })
    const choice = spots.reduce((best, p, i) => {
      const c = ctx.place.cost(textPoly(p, value, SIZE.text, t.rotation, t.oblique, 'middle', 1)) + i * 4 + (within(p) ? 40 : 0)
      return c < best.c ? { p, c, i } : best
    }, { p: spots[0], c: Infinity, i: 0 })
    const at = choice.p
    for (const [from, to] of [[pa.page, a], [pb.page, b]] as Array<[Point, Point]>)
      line(add2(from, scale2(ext, SIZE.extGap)), add2(to, scale2(ext, SIZE.extOver)), 'DIM', owner)
    if (short) {
      // Too short for arrows inside: arrows point in from outside.
      line(sub2(a, scale2(along, SIZE.arrow * 2)), add2(b, scale2(along, SIZE.arrow * 2)), 'DIM', owner)
      arrow(a, along, 'DIM', owner); arrow(b, scale2(along, -1), 'DIM', owner)
    } else {
      line(a, b, 'DIM', owner)
      arrow(a, scale2(along, -1), 'DIM', owner); arrow(b, along, 'DIM', owner)
    }
    if (choice.i >= 4) line(mid, add2(at, scale2(away, -SIZE.text * 0.6)), 'LEADER', owner)
    // A label moved beyond the end of a short dimension is joined to it.
    const offLine = choice.i < 4 && Math.abs(dot2(sub2(at, mid), along)) > span / 2 + 2
    if (offLine) {
      const end = dot2(sub2(at, mid), along) > 0 ? b : a, toward = dot2(sub2(at, mid), along) > 0 ? along : scale2(along, -1)
      line(end, add2(end, scale2(toward, Math.max(0, Math.abs(dot2(sub2(at, mid), along)) - span / 2 - width / 2 - 1))), 'DIM', owner)
    }
    const mode = ctx.doc.dimensionMode, cut = editable ? runResult(ctx.doc, editable).cut : NaN
    if (editable && mode === 'cut') {
      emitters(ctx).text(at, 'CUT ' + draftLength(cut, units, 24), SIZE.text, 'DIM', editable.id, { rotation: t.rotation, oblique: t.oblique, anchor: 'middle', role: 'cut' })
      return
    }
    emitters(ctx).text(at, value, SIZE.text, 'DIM', editable?.id ?? owner, { rotation: t.rotation, oblique: t.oblique, anchor: 'middle', ...(editable ? { role: 'overall' as const } : {}) })
    // Drawings set to show both put the cut length under the line, opposite the centreline length.
    if (editable && mode === 'both' && Number.isFinite(cut) && Math.abs(cut - mm) > 0.5)
      emitters(ctx).text(add2(lerp2(a, b, 0.5), scale2(up, -(SIZE.text * 0.8 + 2.5))), 'CUT ' + draftLength(cut, units, 24), SIZE.text * 0.8, 'DIM', editable.id,
        { rotation: t.rotation, oblique: t.oblique, anchor: 'middle', role: 'cut' })
  }
  /** Where the legs along axes `p` then `q` of the model vector `d` meet, splitting the drawn line from `a` to `b`. */
  function corner2(a: Point, b: Point, d: Vec3, p: number, q: number): Point {
    const along = (i: number): Point => { const v: Vec3 = [0, 0, 0]; v[i] = d[i]; return ctx.axis(v) }
    const [k] = split(sub2(b, a), along(p), along(q))
    return add2(a, scale2(along(p), k))
  }
  /** Clutter under the plane-offset triangle that would go opposite `ext`. */
  function triangleCost(leg: Leg, points: Station[], ext: Point) {
    const start = points[0], end = points.at(-1)!, d = sub(end.model, start.model)
    const comps = [0, 1, 2].filter(i => Math.abs(d[i]) > 0.5)
    if (comps.length !== 2) return 0
    const mid = lerp2(start.page, end.page, 0.5)
    const corners = [comps, [...comps].reverse()].map(([p, q]) => corner2(start.page, end.page, d, p, q))
    const corner = corners.find(c => dot2(sub2(c, mid), ext) <= 0) ?? corners[0]
    return ctx.place.cost([start.page, corner, end.page] as Poly, o => leg.runs.some(r => r.id === o.owner), { pipe: 40, line: 1 })
  }
  /** The axis of the straights an offset joins, when they all run along one: the run of a rolling offset. */
  function runAxisOf(leg: Leg): number | undefined {
    const own = new Set(leg.runs.map(r => r.id))
    const axes = [leg.nodes[0], leg.nodes.at(-1)!].flatMap(id => connected(ctx.doc, id).filter(r => !own.has(r.id) && ctx.geometry.has(r.id)))
      .map(r => ctx.geometry.get(r.id)!.dir3).filter(isAxial).map(v => [0, 1, 2].reduce((a, b) => Math.abs(v[b]) > Math.abs(v[a]) ? b : a))
    return axes.length && axes.every(a => a === axes[0]) ? axes[0] : undefined
  }
  /** The lettering spot of least clutter, preferring the earlier ones. */
  function clearest(spots: Point[], shape: (p: Point) => Poly) {
    return spots.reduce((best, p, i) => {
      const c = ctx.place.cost(shape(p), undefined, LETTERED) + i
      return c < best.c ? { p, c } : best
    }, { p: spots[0], c: Infinity }).p
  }
  /**
   * The offset construction of a skewed leg, a hatched triangle per plane with its legs and angle; `chainExt` is the
   * side its chain dimensions took, if it has them.
   */
  function offset(leg: Leg, points: Station[], chainExt?: Point) {
    const start = points[0], end = points.at(-1)!, d = sub(end.model, start.model), total = measure(start, end)
    if (total < 1) return
    const owner = leg.runs[0].id
    const comps = [0, 1, 2].filter(i => Math.abs(d[i]) > 0.5)
    const unitAxis = (i: number): Point => { const v: Vec3 = [0, 0, 0]; v[i] = 1; return ctx.axis(v) }
    // A plane offset is one right triangle; a rolling offset is a horizontal triangle (the travel in plan) and a
    // vertical one (the rise), drawn as the reference sheets do, starting along the run of the straights it joins.
    const run = comps.length === 3 ? runAxisOf(leg) : undefined
    const horizontal = comps.filter(i => i !== 2).sort((a, b) => Number(b === run) - Number(a === run) || Math.abs(d[b]) - Math.abs(d[a]))
    const centre0 = lerp2(start.page, end.page, 0.5)
    // Each leg, the length along its axis, and the axis its lettering stands on (the triangle's other axis).
    const legs: Array<[Point, Point, number, number]> = []
    const triangles: Array<{ apex: Point; leg: Point; far: Point; angle: number; plane: 'H' | 'V' }> = []
    const thin: Array<[Point, Point]> = []
    if (comps.length === 2) {
      // Either leg can come first; the triangle goes on the side clear of the run's chain dimensions, or of other work.
      const [a, b] = comps
      const build = ([p, q]: number[]) => ({ p, q, corner: corner2(start.page, end.page, d, p, q) })
      const options = [build([a, b]), build([b, a])]
      const score = (o: { corner: Point }) => chainExt
        ? (dot2(sub2(o.corner, centre0), chainExt) > 0 ? 1000 : 0)
        : ctx.place.cost([start.page, o.corner, end.page] as Poly)
      const { p, q, corner } = options.reduce((x, y) => score(y) < score(x) ? y : x)
      legs.push([start.page, corner, Math.abs(d[p]), q], [corner, end.page, Math.abs(d[q]), p])
      // The angle is given off the longer leg, at the end of the pipe where that leg meets it.
      const long = Math.abs(d[p]) >= Math.abs(d[q])
      triangles.push({
        apex: long ? start.page : end.page, leg: corner, far: long ? end.page : start.page,
        angle: Math.atan2(Math.min(Math.abs(d[p]), Math.abs(d[q])), Math.max(Math.abs(d[p]), Math.abs(d[q]))) * 180 / Math.PI,
        plane: comps.includes(2) ? 'V' : 'H'
      })
    } else {
      // The drawn pipe splits into its travel in plan, drawn the way the layout draws it, and its rise.
      const first = horizontal[0], level: Vec3 = [d[0], d[1], 0]
      const [k] = split(sub2(end.page, start.page), ctx.direction(level), ctx.direction([0, 0, d[2]]))
      const plan = add2(start.page, scale2(ctx.direction(level), k)), corner = corner2(start.page, plan, level, first, horizontal[1])
      legs.push([start.page, corner, Math.abs(d[first]), horizontal[1]], [corner, plan, Math.abs(d[horizontal[1]]), horizontal[0]], [plan, end.page, Math.abs(d[2]), horizontal[0]])
      triangles.push({ apex: start.page, leg: corner, far: plan, angle: Math.atan2(Math.abs(d[horizontal[1]]), Math.abs(d[horizontal[0]])) * 180 / Math.PI, plane: 'H' })
      thin.push([start.page, plan])
      triangles.push({ apex: start.page, leg: plan, far: end.page, angle: Math.atan2(Math.abs(d[2]), Math.hypot(d[horizontal[0]], d[horizontal[1]])) * 180 / Math.PI, plane: 'V' })
    }
    // A construction that would leave the drawing area is drawn smaller, on the part of the pipe at its angle.
    const anchor = triangles[0].apex
    const shrink = (f: number) => (p: Point): Point => add2(anchor, scale2(sub2(p, anchor), f))
    const s = shrink([1, 0.75, 0.55, 0.4].find(f => triangles.every(t => ctx.place.inside([t.apex, t.leg, t.far].map(shrink(f))))) ?? 0.4)
    for (const l of legs) { l[0] = s(l[0]); l[1] = s(l[1]) }
    for (const t of triangles) Object.assign(t, { apex: s(t.apex), leg: s(t.leg), far: s(t.far) })
    const corner = legs[0][1]
    for (const [a, b] of legs) line(a, b, 'DIM', owner)
    for (const [a, b] of thin) line(s(a), s(b), 'DIM', owner, 0.4)
    const angleLabels: Array<() => void> = []
    for (const t of triangles) {
      // Hatching fills the acute corner between the pipe and the leg; a square marks the right angle. Hatching breaks
      // around lettering, so it is thin work for placing text, like a dimension line.
      for (let i = 1; i <= 4; i++) {
        const f = 0.06 + i * 0.075, a = lerp2(t.apex, t.leg, f), b = lerp2(t.apex, t.far, f)
        line(a, b, 'HATCH', owner, 0.4, false)
        ctx.place.addSegment(a, b, 'line', owner, 0.8)
      }
      const u1 = unit2(sub2(t.apex, t.leg)), u2 = unit2(sub2(t.far, t.leg)), m = 6
      poly([add2(t.leg, scale2(u1, m)), add2(add2(t.leg, scale2(u1, m)), scale2(u2, m)), add2(t.leg, scale2(u2, m))], 'DIM', owner)
      // Angle arc at the apex, from the leg to the hypotenuse, with the angle and plane beside it.
      const a1 = Math.atan2(t.leg[1] - t.apex[1], t.leg[0] - t.apex[0]), a2 = Math.atan2(t.far[1] - t.apex[1], t.far[0] - t.apex[0])
      let sweep = a2 - a1
      if (sweep > Math.PI) sweep -= 2 * Math.PI
      if (sweep < -Math.PI) sweep += 2 * Math.PI
      const r = Math.min(34, Math.hypot(...sub2(t.leg, t.apex)) * 0.45) * (t.plane === 'H' && triangles.length > 1 ? 1.7 : 1)
      poly(Array.from({ length: 9 }, (_, i) => add2(t.apex, [Math.cos(a1 + sweep * i / 8) * r, Math.sin(a1 + sweep * i / 8) * r] as Point)), 'DIM', owner)
      // Angle labels are lettered after the leg values, which have nowhere else to go: beside the arc first, then further
      // out along the bisector, then anywhere round the apex.
      angleLabels.push(() => {
        const mid = a1 + sweep / 2, label = angleText(degrees(t.angle), t.plane), w = measureText(label, SIZE.text)
        const radial = (at: number): Point => add2(t.apex, [Math.cos(mid) * at, Math.sin(mid) * at])
        const spots = [r + 4, r + 16, r + 28, r + 42, r + 58].flatMap(at => [radial(at), add2(radial(at), [w / 2 + 2, 0]), add2(radial(at), [-w / 2 - 2, 0])])
          .concat([r + 10, r + 24].flatMap(at => Array.from({ length: 12 }, (_, i): Point => add2(t.apex, [Math.cos(i * Math.PI / 6) * (at + w / 2), Math.sin(i * Math.PI / 6) * at]))))
        const at = clearest(spots, q => textPoly([q[0], q[1] + SIZE.text / 2], label, SIZE.text, 0, 0, 'middle', 1))
        emitters(ctx).text([at[0], at[1] + SIZE.text / 2], label, SIZE.text, 'DIM', owner, { anchor: 'middle' })
      })
    }
    // The true length is dimensioned along the pipe, on the side away from the construction, unless the chain
    // along the pipe already gives it.
    if (comps.length === 3 && !chainExt) {
      const along = unit2(sub2(end.page, start.page)), mid = lerp2(start.page, end.page, 0.5)
      let ext: Point = [along[1], -along[0]]
      const bulk = legs.reduce<Point>((sum, [a, b]) => add2(sum, sub2(lerp2(a, b, 0.5), mid)), [0, 0])
      if (dot2(ext, bulk) > 0) ext = scale2(ext, -1)
      dimension(start, end, total, ext, TIER, leg.runs.length === 1 ? leg.runs[0] : undefined, owner)
    }
    if (comps.length === 2 && !chainExt) {
      const normal: Vec3 = [0, 0, 0]
      normal[[0, 1, 2].find(i => !comps.includes(i)) ?? 2] = 1
      const dir3 = unit3(d), across3: Vec3 = [normal[1] * dir3[2] - normal[2] * dir3[1], normal[2] * dir3[0] - normal[0] * dir3[2], normal[0] * dir3[1] - normal[1] * dir3[0]]
      const along = unit2(sub2(end.page, start.page))
      let ext = unit2(ctx.axis(across3))
      if (Math.hypot(...ctx.axis(across3)) < 0.2) ext = [along[1], -along[0]]
      if (dot2(ext, sub2(corner, lerp2(start.page, end.page, 0.5))) > 0) ext = scale2(ext, -1)
      dimension(start, end, total, ext, TIER, leg.runs.length === 1 ? leg.runs[0] : undefined, owner)
    }
    const ends = legs.flatMap(([a, b]) => [a, b]), centre = scale2(ends.reduce(add2, [0, 0]), 1 / ends.length)
    for (const [p, q, mm, standing] of legs) {
      const dir = unit2(sub2(q, p))
      const out = dot2(unitAxis(standing), sub2(lerp2(p, q, 0.5), centre)) >= 0 ? unitAxis(standing) : scale2(unitAxis(standing), -1)
      const t = planeText(dir, out), up = uprightOf(t)
      // Leg text goes outside the triangle when its reading side faces in, and slides along the leg or further out when
      // that is taken, so leg values never overprint other lettering.
      const value = draftLength(mm, units, 24), outside = dot2(up, out) >= 0 ? 2 : -(SIZE.text + 2), inside = dot2(up, out) >= 0 ? -(SIZE.text + 2) : 2
      const spots = [0.5, 0.32, 0.68, 0.18, 0.82].flatMap(f => [add2(lerp2(p, q, f), scale2(up, outside)), add2(lerp2(p, q, f), scale2(up, inside))])
        .concat([1, 2, 3].flatMap(k => [0.5, 0.32, 0.68].map(f => add2(lerp2(p, q, f), scale2(up, outside + Math.sign(outside) * (SIZE.text + 4) * k)))))
      const at = clearest(spots, c => textPoly(c, value, SIZE.text, t.rotation, t.oblique, 'middle', 1))
      emitters(ctx).text(at, value, SIZE.text, 'DIM', owner, { rotation: t.rotation, oblique: t.oblique, anchor: 'middle' })
    }
    if (run !== undefined) {
      // A rolling offset's set is its true offset across the run: the diagonal of the roll and the rise (in plan when
      // the run is vertical), turned out of the plane by the roll angle.
      const across = [0, 1, 2].filter(i => i !== run), set = Math.hypot(d[across[0]], d[across[1]])
      const [p, q] = run === 2 ? [legs[0][0], legs[1][1]] : [legs[1][0], legs[2][1]]
      if (run !== 2) line(p, q, 'DIM', owner, 0.4)
      const dir = unit2(sub2(q, p)), t = planeText(dir, unitAxis(run)), up = uprightOf(t), value = 'SET ' + draftLength(set, units, 24)
      const spots = [0.5, 0.35, 0.65].flatMap(f => [add2(lerp2(p, q, f), scale2(up, 2)), add2(lerp2(p, q, f), scale2(up, -SIZE.text - 2))])
      emitters(ctx).text(clearest(spots, c => textPoly(c, value, SIZE.text, t.rotation, t.oblique, 'middle', 1)), value, SIZE.text, 'DIM', owner,
        { rotation: t.rotation, oblique: t.oblique, anchor: 'middle' })
      if (run !== 2) {
        const plan = legs[1][1], b1 = Math.atan2(plan[1] - p[1], plan[0] - p[0]), b2 = Math.atan2(q[1] - p[1], q[0] - p[0])
        let sweep = b2 - b1
        if (sweep > Math.PI) sweep -= 2 * Math.PI
        if (sweep < -Math.PI) sweep += 2 * Math.PI
        const r = Math.min(24, Math.hypot(...sub2(plan, p)) * 0.45), mid = b1 + sweep / 2
        poly(Array.from({ length: 9 }, (_, i) => add2(p, [Math.cos(b1 + sweep * i / 8) * r, Math.sin(b1 + sweep * i / 8) * r] as Point)), 'DIM', owner)
        const label = `${degrees(Math.atan2(Math.abs(d[2]), Math.abs(d[horizontal[1]])) * 180 / Math.PI)}° ROLL`
        const spots = [r + 4, r + 16, r + 28].map(at => add2(p, [Math.cos(mid) * at, Math.sin(mid) * at] as Point))
        const at = clearest(spots, c => textPoly([c[0], c[1] + SIZE.text / 2], label, SIZE.text, 0, 0, 'middle', 1))
        emitters(ctx).text([at[0], at[1] + SIZE.text / 2], label, SIZE.text, 'DIM', owner, { anchor: 'middle' })
      }
    }
    for (const label of angleLabels) label()
  }
}
/** Coefficients of `v` along `a` and `b`; even shares when they are parallel. */
function split(v: Point, a: Point, b: Point): [number, number] {
  const det = a[0] * b[1] - a[1] * b[0]
  if (Math.abs(det) < 1e-9 * (Math.hypot(...a) * Math.hypot(...b) || 1)) {
    const s = Math.hypot(...v) / (Math.hypot(...add2(a, b)) || 1)
    return [s, s]
  }
  return [(v[0] * b[1] - v[1] * b[0]) / det, (a[0] * v[1] - a[1] * v[0]) / det]
}
