import type { Point } from '../drawing'
import { draftLength, angleText } from '../format'
import { feetThreshold } from '../profile'
import { connected, distance, getNode, length, runResult, sub, type DimensionAnchor, type PipeNode, type PipeRun, type Vec3 } from '../model'
import { anchorPoint, continuingRun, nodeStations, runAxis, STATION_MERGE as MERGE, workPoint } from '../stations'
import { emitters, faceOnPaper, sizeOf, type IsoContext } from './context'
import { measureText } from '../stroke-font'
import { flangedGeometry, valveBodyOnSheet } from './valve-conventions'
import { segmentPoly, textPoly, type Poly } from './placement'
import { add2, dot2, isAxial, len2, lerp2, planeText, scale2, sub2, unit2, unit3, uprightOf } from './plane'

/** A point a leg is measured to; `along` is its distance from the leg's first node, `of` the valve whose face it is. */
interface Station {
  model: Vec3; page: Point; along: number; node?: string; end?: boolean; of?: string
  /** A component whose drawn outline the station is on: its extension line starts clear of the outline. */
  outline?: string
}
interface Span { a: Station; b: Station; mm: number; approximate?: boolean }
/** Overlap costs for lettering that must not overprint other lettering. */
const LETTERED = { text: 1000, tag: 1000 }
interface Leg { runs: PipeRun[]; nodes: string[]; dir3: Vec3; dir: Point }

/**
 * Lettering turned into a plane, kept readable: where the view sees the plane edge-on its uprights would lie along
 * the baseline (an oblique near 90°, sheared without end), so it stands upright on its baseline instead.
 */
export function readable<T extends { oblique: number }>(t: T): T {
  if (!(Math.abs(t.oblique) <= 80)) t.oblique = 0
  return t
}
/** Each context's legs, with the geometry they were found from; nothing moves a pipe while a sheet is drawn. */
const legsOf = new WeakMap<IsoContext, { geometry: IsoContext['geometry']; legs: Leg[] }>()
/** Straight legs of the sheet: in-line pipes joined through valves, flanges, reducers and welds. */
export function sheetLegs(ctx: IsoContext): Leg[] {
  const known = legsOf.get(ctx)
  if (known && known.geometry === ctx.geometry) return known.legs
  const legs = findLegs(ctx)
  legsOf.set(ctx, { geometry: ctx.geometry, legs })
  return legs
}
function findLegs(ctx: IsoContext): Leg[] {
  const seen = new Set<string>(), legs: Leg[] = []
  // A leg runs through in-line components, fittings joined without pipe, and the run of a tee (see `continuingRun`).
  const axis = (r: PipeRun) => runAxis(ctx.doc, r)
  const straightThrough = (node: PipeNode, from: PipeRun) => continuingRun(ctx.doc, node, from, r => ctx.geometry.has(r.id))
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
    const first = axis(runs[0]), forward = runs[0].from === nodes[0] ? 1 : -1
    legs.push({ runs, nodes, dir3: first.map(v => v * forward) as Vec3, dir: unit2(sub2(b, a)) })
  }
  return legs
}

/** Where a model point on a pipe is drawn: along the pipe as drawn, in proportion to how far along it it is. */
function onPipe(ctx: IsoContext, run: PipeRun, p: Vec3): Point {
  const g = ctx.geometry.get(run.id)!, a = getNode(ctx.doc, run.from).position, d = sub(getNode(ctx.doc, run.to).position, a)
  const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], t = l2 > 1e-12 ? ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2 : 0
  return lerp2(g.a, g.b, t)
}

/** The drafting resolution lengths are lettered to: whole millimetres, or sixteenths of an inch. */
export const dimensionQuantum = (units: 'mm' | 'imperial') => units === 'mm' ? 1 : 25.4 / 16

/**
 * Extension direction (model vector) for an offset's true length: square to the pipe in the plane of a plane offset;
 * for a rolling offset, in the vertical plane containing the pipe (horizontally across a vertical one). The dimension
 * then lies in a plane through the pipe, so its extension lines run along a projected plant direction.
 */
export function offsetExtension(d: Vec3): Vec3 {
  const u = unit3(d), comps = [0, 1, 2].filter(i => Math.abs(u[i]) > 1e-4)
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  if (comps.length === 2) {
    const normal: Vec3 = [0, 0, 0]
    normal[[0, 1, 2].find(i => !comps.includes(i))!] = 1
    return unit3(cross(normal, u))
  }
  // The vertical plane through the pipe: the vertical, less its part along the pipe.
  const up: Vec3 = [-u[2] * u[0], -u[2] * u[1], 1 - u[2] * u[2]]
  return Math.hypot(...up) > 1e-6 ? unit3(up) : [1, 0, 0]
}

/**
 * The offset construction's proportions, in lettering heights: the first hatch line off the apex and the spacing of
 * the rest, the right-angle mark, the angle arc's largest radius (a rolling offset's plan arc stands `nested` outside
 * its rise arc) and the roll arc's.
 */
const HATCH = { start: 2, spacing: 1.15, square: 0.9, arc: 5.2, nested: 2.5, roll: 3.6 }

/** Offset angles in whole degrees, but the half degree of a 22 1/2° or 67 1/2° offset made with standard fittings. */
const degrees = (a: number) => [22.5, 67.5].find(h => Math.abs(a - h) < 0.15) ?? Math.round(a)

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

/**
 * The thickest gasket in a leg's joints (mm): faces closer than it (plus MERGE) are one bolted joint. The leg's
 * thickest, so a leg with mixed gaskets still merges each of its joints; two separate joints are never that close.
 */
function legGasket(ctx: IsoContext, leg: Leg): number {
  const nodes = new Set(leg.nodes)
  return Math.max(0, ...ctx.joints.filter(j => nodes.has(j.nodeId)).map(j => j.gasket?.thickness ?? 0))
}

/** Distance along a leg from its first node. */
function measureAlong(ctx: IsoContext, leg: Leg) {
  const origin = getNode(ctx.doc, leg.nodes[0]).position
  return (p: Vec3) => (p[0] - origin[0]) * leg.dir3[0] + (p[1] - origin[1]) * leg.dir3[1] + (p[2] - origin[2]) * leg.dir3[2]
}

/**
 * The chain stations of a leg: its ends, fitting work points, flange faces, the mating faces of flanged valves,
 * reducer ends and branch connections. Where each is, and why, is `nodeStations` (src/core/stations.ts), which the
 * cut schedule measures from too; this places each on the paper.
 */
function stations(ctx: IsoContext, leg: Leg, vents: Set<string>, bodyFaces = false): Station[] {
  const out: Station[] = []
  const along = measureAlong(ctx, leg), own = new Set(leg.runs.map(r => r.id))
  const at = (model: Vec3, page: Point, node?: string, end = false, of?: string) => out.push({ model, page, node, along: along(model), end, ...(of ? { of } : {}) })
  // A pipe's direction on the paper, away from the node.
  const away = (run: PipeRun, id: string) => { const g = ctx.geometry.get(run.id)!; return run.from === id ? g.dir : scale2(g.dir, -1) }
  leg.nodes.forEach((id, i) => {
    const node = getNode(ctx.doc, id), page = ctx.pos.get(id)!
    const end = i === 0 || i === leg.nodes.length - 1
    const found = nodeStations(ctx.doc, node, { end, inLeg: r => own.has(r.id), joints: ctx.joints, bodyFaces, onDrawing: r => ctx.geometry.has(r.id), nodes: ctx.nodes })
    // A part standing on an olet is no longer the end: the leg is measured on from the olet at the pipe's centreline.
    const onOlet = found.some(s => s.kind === 'olet')
    for (const s of found) {
      switch (s.kind) {
        case 'pair-face': at(s.point, add2(page, scale2(away(s.connector, id), s.side * sizeOf(ctx).flangeThickness / 2)), id, end); break
        case 'olet': { const base = ctx.pos.get(s.olet.id); if (base) at(s.point, base, s.olet.id, true); break }
        case 'port-face': {
          const g = ctx.geometry.get(s.run.id)!, axial = Math.hypot(...ctx.direction(g.dir3))
          const reach = flangedGeometry(ctx.doc, node, valveBodyOnSheet(ctx, node))[s.face] * axial
          at(s.point, add2(page, scale2(away(s.run, id), reach)), undefined, false, id)
          break
        }
        case 'equipment-face': {
          const dir = i === 0 ? scale2(leg.dir, -1) : leg.dir
          at(s.point, add2(page, scale2(dir, s.gasket ? sizeOf(ctx).flangeThickness : 0)), id, true)
          break
        }
        case 'reducer-end':
          at(s.point, add2(page, scale2(away(s.run, id), ctx.extent.get(id) ?? 0)))
          out[out.length - 1].outline = id
          break
        case 'node': at(s.point, page, id, end && !onOlet)
      }
    }
  })
  // Branch connections on the pipe are stations of the chain; capped vents and drains are located instead.
  for (const n of ctx.nodes) {
    const page = ctx.pos.get(n.id)
    if (n.kind === 'olet' && page && n.associatedRunId && own.has(n.associatedRunId) && !vents.has(n.id)) at(n.position, page, n.id)
  }
  out.sort((a, b) => a.along - b.along)
  // Merging stations. Two faces closer than the leg's thickest gasket (plus MERGE, below the drafting resolution) are
  // the two sides of one bolted joint, such as a flange pair at a drawing break or a valve's mating face beside a
  // flange drawn as its own node. A dimension across a gasket alone is not a fabrication dimension (nobody sets out
  // 3 mm between two faces), and lettering it would crowd the chain, so they are one station:
  // - the station kept is the face on the pipe (a node joined by pipe, not a connector), so a pipe's own measuring
  //   point (src/core/stations.ts) never moves and the gasket goes with the stub end or fitting welded on the other
  //   side;
  // - at the end of a leg the end station is kept and anything farther than MERGE from it is dimensioned, so a gasket
  //   this drawing supplies at its end is shown, and the overall takes it in;
  // - two flange nodes drawn explicitly are one joint even at the end of a leg.
  const onPipe = (s: Station) => !!s.node && connected(ctx.doc, s.node).some(r => own.has(r.id) && !r.connector)
  const kept: Station[] = [], gasket = legGasket(ctx, leg) + MERGE
  for (const s of out) {
    const last = kept.at(-1), gap = last ? s.along - last.along : Infinity
    // Two explicitly drawn flange faces are one bolted joint even at the end of a leg. Use the face on the pipe.
    const flangeGap = last?.node && s.node && getNode(ctx.doc, last.node).kind === 'flange' && getNode(ctx.doc, s.node).kind === 'flange'
    if (flangeGap && gap <= gasket) {
      if (onPipe(s) && !onPipe(last!)) kept[kept.length - 1] = s
      continue
    }
    if (gap > gasket || ((s.end || last!.end) && gap > MERGE)) kept.push(s)
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
  const units = ctx.doc.units, size = sizeOf(ctx), T = size.text, feet = feetThreshold(ctx.doc, 'dimensions')
  let dimensionIndex = 0
  const handle = (key: string, at: Point) => ({ key, at: [...at] as Point, spool: ctx.spool })
  // Chains are measured between rounded station positions, so the pieces always add up to the rounded whole.
  const quantum = dimensionQuantum(units)
  const snap = (mm: number) => Math.round(mm / quantum) * quantum
  const measure = (a: Station, b: Station) => ctx.style.dimensionRounding === 'individual'
    ? snap(Math.abs(b.along - a.along)) : Math.abs(snap(b.along) - snap(a.along))
  const node = (id: string) => getNode(ctx.doc, id)
  const drafted = ctx.doc.sheets?.[ctx.spool]?.dimensions
  const replaced: Array<{ from: Vec3; to: Vec3; ext: Point }> = []
  if (drafted) {
    const anchor = (a: DimensionAnchor): Station | undefined => {
      if(a.adjacent){
        const point=ctx.referenceDimensions?.find(p=>p.atNodeId===a.nodeId&&p.referenceId===a.adjacent)
        return point?{model:point.model,page:point.page,along:0}:undefined
      }
      const n = ctx.nodes.find(n => n.id === a.nodeId), page = ctx.pos.get(a.nodeId)
      if (!n || !page) return
      // The point measured to is the shared rule the cut schedule measures from too (stations.ts `anchorPoint`).
      const model = anchorPoint(ctx.doc, a, ctx.joints)
      if (!model) return
      if (!a.face || !a.runId) return { model, page, along: 0, node: n.id }
      const run = ctx.runs.find(r => r.id === a.runId), g = run && ctx.geometry.get(run.id)
      if (!run || !g) return
      const far = getNode(ctx.doc, run.from === n.id ? run.to : run.from), out = unit3(sub(far.position, n.position))
      const dir = run.from === n.id ? g.dir : scale2(g.dir, -1)
      const pair = ctx.joints.find(j => j.nodeId === n.id && j.kind === 'flange-pair')
      if (pair && n.kind === 'flange')
        return { model, page: add2(page, scale2(dir, size.flangeThickness / 2 * (a.face === 'body' ? 1 : -1))), along: 0, node: n.id }
      if (n.kind === 'flange' && connected(ctx.doc, n.id).length === 1) {
        const shift = sub(model, n.position).reduce((s, v, i) => s + v * out[i], 0)
        return { model, page: add2(page, scale2(dir, Math.sign(shift) * Math.min(size.flangeThickness, Math.abs(shift)))), along: 0, node: n.id }
      }
      const joint = ctx.joints.find(j => j.nodeId === n.id && j.kind === 'component-port' && j.runIds.includes(run.id))
      if(!joint && workPoint(n)) {
        // Without a joint the face point is the fitting's end on the pipe, with no gasket beyond it.
        const point=ctx.schematic ? add2(page,scale2(dir,faceOnPaper(ctx,n,run))) : onPipe(ctx, run, model)
        return {model,page:point,along:0,of:n.id}
      }
      const extent = ctx.extent.get(n.id) ?? 0
      const inset = joint ? (size.flangeThickness + size.thin + (a.face === 'body' && joint.gasket ? size.flangeThickness : 0))*Math.hypot(...ctx.direction(g.dir3)) : 0
      const reach=joint ? flangedGeometry(ctx.doc,n,valveBodyOnSheet(ctx,n))[a.face==='body'?'body':'mate']*Math.hypot(...ctx.direction(g.dir3)) : Math.max(0,extent-inset)
      return { model, page: add2(page, scale2(dir, reach)), along: 0, of: n.id }
    }
    for (const [i, d] of drafted.entries()) {
      const a = anchor(d.from), b = anchor(d.to)
      if (!a || !b) continue
      const mm = distance(a.model, b.model), ext = unit2(ctx.axis(d.axis))
      if (mm < 0.01 || Math.hypot(...ext) < 0.01 || Math.abs(dot2(unit2(sub2(b.page, a.page)), ext)) > 0.999) continue
      replaced.push({ from: a.model, to: b.model, ext })
      const approximate = [d.from,d.to].some(point=>!point.adjacent && ctx.nodes.find(n=>n.id===point.nodeId)?.approximate)
      dimension(a, b, snap(mm), ext, d.offset, undefined, undefined, [], approximate, `drafted-dimension:${i}`, d.reverseText,d.format)
    }
    if (ctx.doc.sheets?.[ctx.spool]?.dimensionScope !== 'legs') return
  }
  const legs = sheetLegs(ctx), vents = ventOlets(ctx, legs)
  for (const leg of legs) {
    // A purchased flexible hose's catalogue length locates its ends; a hanging paper route is not a fabrication chain.
    if(leg.runs.every(r=>r.connector)&&leg.nodes.some(id=>node(id).hosePath?.length))continue
    const origin = node(leg.nodes[0]).position, span = distance(origin, node(leg.nodes.at(-1)!).position)
    // A drafted dimension may run to a face beyond the leg's end node, by at most the gasket there.
    const beyond = legGasket(ctx, leg) + MERGE
    const onLeg = (p: Vec3) => {
      const delta = sub(p, origin), along = delta.reduce((sum, v, i) => sum + v * leg.dir3[i], 0)
      return along >= -beyond && along <= span + beyond && length(delta.map((v, i) => v - along * leg.dir3[i]) as Vec3) < 0.01
    }
    const replacement = replaced.find(({ from, to }) => onLeg(from) && onLeg(to))
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
    // A drafted chain changes its dimensions, while the offset construction still describes the route.
    if (replacement) { if (skewed) offset(leg, points, replacement.ext); continue }
    // An offset with nothing along it is dimensioned by its construction alone.
    if (skewed && segments.length < 2 && !located.length) {
      const reference=(ctx.referenceDimensions??[]).find(ref=>{
        const index=leg.nodes.indexOf(ref.atNodeId)
        if(index!==0&&index!==leg.nodes.length-1)return false
        const end=index===0?points[0]:points.at(-1)!,delta=sub(ref.model,end.model),along=delta.reduce((s,v,i)=>s+v*leg.dir3[i],0)
        return Math.abs(Math.abs(along)-length(delta))<.1 && (index===0?along<0:along>0)
      })
      if(reference){
        const far=reference.atNodeId===leg.nodes[0]?points.at(-1)!:points[0],point:Station={model:reference.model,page:reference.page,along:0,end:true}
        const ext=offsetSide(sub(points.at(-1)!.model, points[0].model))
        dimension(far,point,snap(distance(far.model,point.model)),ext,size.tier,undefined,leg.runs[0].id)
        offset(leg,points,ext)
      }else offset(leg, points)
      continue
    }
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
        const off = size.tier + t * size.tierStep
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
    const heldAxis = leg.runs.find(r => r.dimensionAxis)?.dimensionAxis
    const heldExt = heldAxis && unit2(ctx.axis(heldAxis))
    const ext = heldExt && Math.hypot(...heldExt) > 0.1 && Math.abs(dot2(heldExt, leg.dir)) < 0.95 ? heldExt : best.ext
    tiers.forEach((tier, t) => {
      const off = size.tier + t * size.tierStep
      // Neighbouring pieces of a chain are no place for a short dimension's text.
      const spans = tier.map(s => [s.a.page, s.b.page] as [Point, Point])
      for (const s of tier) dimension(s.a, s.b, s.mm, ext, off, runBetween(leg, s), ownerOf(leg, s), spans.filter(([a]) => a !== s.a.page), s.approximate, undefined, leg.runs.some(r=>r.dimensionReverse))
    })
    // The overall of a skewed leg is its true length; the construction goes on the other side.
    if (skewed) offset(leg, points, ext)
  }
  /** Page extension direction of an offset's true length along model vector `d` (see `offsetExtension`). */
  function offsetSide(d: Vec3): Point {
    const ext = ctx.axis(offsetExtension(d))
    if (Math.hypot(...ext) >= 0.2) return unit2(ext)
    const normal: Vec3 = [0, 0, 0]
    normal[[0, 1, 2].reduce((a, b) => Math.abs(d[b]) < Math.abs(d[a]) ? b : a)] = 1
    return unit2(ctx.axis(normal))
  }
  /** A dimension's lettering: the length, marked "(±)" where the location is approximate. */
  function valueOf(s: { mm: number; approximate?: boolean },format?:'feet'|'inches'|'feet-short') {
    const value=draftLength(s.mm, units,format==='feet'||format==='feet-short'?12:format==='inches'?Infinity:feet)
    return (format==='feet-short'?value.replace(/'-0"$/,"'"):value) + (s.approximate ? '(±)' : '')
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
    const along = unit2(sub2(b, a)), t = readable(planeText(along, ext))
    return textPoly(add2(lerp2(a, b, 0.5), scale2(uprightOf(t), 0.3 * T)), value, T, t.rotation, t.oblique, 'middle', 1)
  }
  /**
   * How far along an extension line (in its own lengths) a station's component outline reaches: a reducer's end drawn
   * along the extension line would otherwise run on into it, and the two read as one tall edge of the symbol.
   */
  function clearOf(station: Station, ext: Point): number {
    const l = len2(ext)
    if (!station.outline || l < 1e-9) return 0
    const u = scale2(ext, 1 / l)
    let reach = 0
    for (const p of ctx.out) if (p.owner === station.outline && p.layer === 'SYMBOL' && p.type === 'polyline')
      for (const v of p.points) {
        const d = sub2(v, station.page)
        if (Math.abs(d[0] * u[1] - d[1] * u[0]) < 0.05 * T) reach = Math.max(reach, dot2(d, u))
      }
    return reach / l
  }
  /** One dimension: extension lines from both points, a dimension line with arrowheads, and iso-plane text. */
  function dimension(pa: Station, pb: Station, mm: number, ext: Point, offset: number, editable?: PipeRun, owner?: string,
    others: Array<[Point, Point]> = [], approximate = false, keyOverride?: string, reverseText = false,format?:'feet'|'inches'|'feet-short') {
    const key = keyOverride ?? `dimension:${dimensionIndex++}`, held = ctx.labelPositions?.[key]
    const layout = ctx.doc.sheets?.[ctx.spool]?.dimensionLayout?.[key]
    const requested = layout?.axis && unit2(ctx.axis(layout.axis))
    if (requested && Math.hypot(...requested)>0.1 && Math.abs(dot2(requested,unit2(sub2(pb.page,pa.page))))<0.95) ext=requested
    offset=layout?.offset ?? offset
    reverseText=layout?.reverseText ?? reverseText
    format=layout?.format ?? format
    const a = add2(pa.page, scale2(ext, offset)), b = add2(pb.page, scale2(ext, offset))
    const along = unit2(sub2(b, a)), span = Math.hypot(...sub2(b, a))
    const value = valueOf({ mm, approximate },format), t = readable(planeText(along, ext))
    if (reverseText) t.rotation = (t.rotation + 360) % 360 - 180
    const up = uprightOf(t)
    const width = measureText(value, T)
    const short = span < size.arrow * 2.2
    // Text stands on its reading side of the line; when that is taken it moves beyond an end or to the other side.
    // It is placed before its own lines are drawn, so only other work can push it away.
    const mid = lerp2(a, b, 0.5), reach = span / 2 + size.arrow * (short ? 2 : 0) + width / 2 + 0.45 * T, lift = 0.3 * T
    const spots: Point[] = short || span < width + 0.9 * T
      ? [add2(add2(mid, scale2(along, reach)), scale2(up, lift)), add2(add2(mid, scale2(along, -reach)), scale2(up, lift)), add2(mid, scale2(up, lift)), add2(mid, scale2(up, -T - lift))]
      : [add2(mid, scale2(up, lift)), add2(mid, scale2(up, -T - lift)), add2(add2(mid, scale2(along, reach)), scale2(up, lift)), add2(add2(mid, scale2(along, -reach)), scale2(up, lift))]
    // When every spot by the line is taken, the text stands clear with a leader back to the line.
    const away = unit2(sub2(mid, lerp2(pa.page, pb.page, 0.5)))
    for (const k of [1, 2, 3]) for (const side of [0, 1, -1])
      spots.push(add2(add2(mid, scale2(away, 1.9 * T * k + 0.6 * T)), scale2(along, side * (width / 2 + 0.9 * T))))
    // Measured back along the extension lines to the pipe, so the offset's slant does not shift it.
    const within = (p: Point) => others.some(([x, y]) => {
      const q = sub2(p, scale2(ext, offset)), u = sub2(y, x), l = Math.hypot(...u) || 1, s = dot2(sub2(q, x), u) / l
      return s > 0 && s < l && Math.abs(dot2(sub2(q, x), [u[1] / l, -u[0] / l])) < T * 3
    })
    const choice = spots.reduce((best, p, i) => {
      const c = ctx.place.cost(textPoly(p, value, T, t.rotation, t.oblique, 'middle', 1)) + i * 4 + (within(p) ? 40 : 0)
      return c < best.c ? { p, c, i } : best
    }, { p: spots[0], c: Infinity, i: 0 })
    const at = held ?? choice.p
    for (const [from, to, station] of [[pa.page, a, pa], [pb.page, b, pb]] as Array<[Point, Point, Station]>)
      line(add2(from, scale2(ext, size.extGap + clearOf(station, ext))), add2(to, scale2(ext, size.extOver)), 'DIM', owner)
    if (short) {
      // Too short for arrows inside: arrows point in from outside.
      line(sub2(a, scale2(along, size.arrow * 2)), add2(b, scale2(along, size.arrow * 2)), 'DIM', owner)
      arrow(a, along, 'DIM', owner); arrow(b, scale2(along, -1), 'DIM', owner)
    } else {
      line(a, b, 'DIM', owner)
      arrow(a, scale2(along, -1), 'DIM', owner); arrow(b, along, 'DIM', owner)
    }
    const normal:Point=[along[1],-along[0]]
    if (held ? Math.abs(dot2(sub2(at, mid), normal) - lift*dot2(up,normal)) > T * 2 : choice.i >= 4)
      line(mid, add2(at, scale2(away, -T * 0.6)), 'LEADER', owner)
    // A label moved beyond the end of a short dimension is joined to it.
    const offLine = choice.i < 4 && Math.abs(dot2(sub2(at, mid), along)) > span / 2 + lift
    if (offLine) {
      const end = dot2(sub2(at, mid), along) > 0 ? b : a, toward = dot2(sub2(at, mid), along) > 0 ? along : scale2(along, -1)
      line(end, add2(end, scale2(toward, Math.max(0, Math.abs(dot2(sub2(at, mid), along)) - span / 2 - width / 2 - 0.15 * T))), 'DIM', owner)
    }
    const mode = ctx.doc.dimensionMode, cut = editable ? runResult(ctx.doc, editable).cut : NaN
    if (editable && mode === 'cut') {
      emitters(ctx).text(at, 'CUT ' + valueOf({mm:cut},format), T, 'DIM', editable.id, { rotation: t.rotation, oblique: t.oblique, anchor: 'middle', role: 'cut', label: {...handle(key, at),dimension:{axis:ext,offset}} })
      return
    }
    // Any other dimension between two connections is edited in place too: the second connection moves along its straight.
    const from = pa.node ?? pa.of, to = pb.node ?? pb.of
    const edits = !editable && from && to && from !== to ? { span: { from, to, mm } } : {}
    emitters(ctx).text(at, value, T, 'DIM', editable?.id ?? owner, { rotation: t.rotation, oblique: t.oblique, anchor: 'middle', label: {...handle(key, at),dimension:{axis:ext,offset}}, ...(editable ? { role: 'overall' as const } : edits) })
    // Drawings set to show both put the cut length under the line, opposite the centreline length.
    if (editable && mode === 'both' && Number.isFinite(cut) && Math.abs(cut - mm) > 0.5)
      emitters(ctx).text(add2(lerp2(a, b, 0.5), scale2(up, -(T * 0.8 + 0.38 * T))), 'CUT ' + valueOf({mm:cut},format), T * 0.8, 'DIM', editable.id,
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
    const drafting = leg.runs.find(r=>r.offsetDrawing)?.offsetDrawing
    const comps = [0, 1, 2].filter(i => Math.abs(d[i]) > 0.5)
    const unitAxis = (i: number): Point => { const v: Vec3 = [0, 0, 0]; v[i] = 1; return ctx.axis(v) }
    // A plane offset is one right triangle; a rolling offset is a horizontal triangle (the travel in plan) and a
    // vertical one (the rise), drawn as the reference sheets do, starting along the run of the straights it joins.
    const run = comps.length === 3 ? runAxisOf(leg) : undefined
    const horizontal = comps.filter(i => i !== 2).sort((a, b) => {
      const difference=Math.abs(d[b])-Math.abs(d[a])
      return Number(b===run)-Number(a===run) || (Math.abs(difference)<1e-6?0:difference)
    })
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
      const selected = drafting?.planPoint
        ? options.reduce((x,y)=>len2(sub2(y.corner,drafting.planPoint!))<len2(sub2(x.corner,drafting.planPoint!))?y:x)
        : options.reduce((x, y) => score(y) < score(x) ? y : x)
      const {p,q}=selected,corner=drafting?.planPoint??selected.corner
      legs.push([start.page, corner, Math.abs(d[p]), q], [corner, end.page, Math.abs(d[q]), p])
      // The angle is given off the longer leg, at the end of the pipe where that leg meets it.
      const long = Math.abs(d[p]) + 1e-6 >= Math.abs(d[q])
      triangles.push({
        apex: long ? start.page : end.page, leg: corner, far: long ? end.page : start.page,
        angle: Math.atan2(Math.min(Math.abs(d[p]), Math.abs(d[q])), Math.max(Math.abs(d[p]), Math.abs(d[q]))) * 180 / Math.PI,
        plane: comps.includes(2) ? 'V' : 'H'
      })
    } else {
      // The drawn pipe splits into its travel in plan, drawn the way the layout draws it, and its rise.
      const first = horizontal[0], level: Vec3 = [d[0], d[1], 0]
      const [k] = split(sub2(end.page, start.page), ctx.direction(level), ctx.direction([0, 0, d[2]]))
      const plan = drafting?.planPoint ?? add2(start.page, scale2(ctx.direction(level), k)), corner = corner2(start.page, plan, level, first, horizontal[1])
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
    for (const [a, b] of thin) line(s(a), s(b), 'DIM', owner, size.thin * 0.8)
    const angleLabels: Array<() => void> = []
    for (const t of triangles) {
      // Hatching fills the acute corner between the pipe and the leg; a square marks the right angle. Hatching breaks
      // around lettering, so it is thin work for placing text, like a dimension line.
      for (let i = 0; i < (drafting?.hatchCount ?? 4); i++) {
        if(drafting?.hatchPlane && drafting.hatchPlane!==t.plane)continue
        // Hatch lines stand a constant paper distance apart along the pipe, from a little off the apex.
        const length=len2(sub2(t.far,t.apex)), spacing=drafting?.hatchSpacing ?? HATCH.spacing*T, first=drafting?.hatchStart ?? (drafting?.hatchSpacing ?? HATCH.start*T)
        const f=(first+i*spacing)/Math.max(length,1)
        if(f>=1)break
        const apex=drafting?.hatchFrom==='end'?t.far:t.apex,far=drafting?.hatchFrom==='end'?t.apex:t.far
        const a=lerp2(apex,t.leg,f), edge=lerp2(apex,far,f), span=len2(sub2(edge,a)), gap=drafting?.hatchGap ?? 0
        if(span<=gap)continue
        const b=lerp2(a,edge,1-gap/span)
        line(a, b, 'HATCH', owner, size.thin, false)
        ctx.place.addSegment(a, b, 'line', owner, 0.8)
      }
      const u1 = unit2(sub2(t.apex, t.leg)), u2 = unit2(sub2(t.far, t.leg)), m = drafting?.rightAngleSize ?? HATCH.square * T
      if(m>0)poly([add2(t.leg, scale2(u1, m)), add2(add2(t.leg, scale2(u1, m)), scale2(u2, m)), add2(t.leg, scale2(u2, m))], 'DIM', owner)
      // Angle arc at the apex, from the leg to the hypotenuse, with the angle and plane beside it.
      const angular=drafting?.[t.plane==='H'?'angleFromH':'angleFromV']==='end'?{...t,apex:t.far,far:t.apex,angle:90-t.angle}:t
      const a1 = Math.atan2(angular.leg[1] - angular.apex[1], angular.leg[0] - angular.apex[0]), a2 = Math.atan2(angular.far[1] - angular.apex[1], angular.far[0] - angular.apex[0])
      let sweep = a2 - a1
      if (sweep > Math.PI) sweep -= 2 * Math.PI
      if (sweep < -Math.PI) sweep += 2 * Math.PI
      // A rolling offset's two arcs share their apex: the plan arc stands outside the rise arc.
      const radius = Math.min(HATCH.arc * T, Math.hypot(...sub2(angular.leg, angular.apex)) * 0.45)
      const r = drafting?.[t.plane==='H'?'angleRadiusH':'angleRadiusV'] ?? radius + (t.plane === 'H' && triangles.length > 1 ? HATCH.nested * T : 0)
      const outward=drafting?.[t.plane==='H'?'angleOutwardH':'angleOutwardV']
      const tail=drafting?.angleArrows&&!outward?size.arrow*2/Math.max(r,1)*Math.sign(sweep):0
      const arc=Array.from({length:65},(_,i)=>add2(angular.apex,[Math.cos(a1-tail+(sweep+2*tail)*i/64)*r,Math.sin(a1-tail+(sweep+2*tail)*i/64)*r] as Point))
      for(let i=1;i<arc.length;i++)line(arc[i-1],arc[i],'DIM',owner)
      if(drafting?.angleArrows)for(const [angle,side] of [[a1,1],[a1+sweep,-1]]){
        const at=add2(angular.apex,[Math.cos(angle)*r,Math.sin(angle)*r]);arrow(at,[-Math.sin(angle)*Math.sign(sweep)*side*(outward?-1:1),Math.cos(angle)*Math.sign(sweep)*side*(outward?-1:1)],'DIM',owner)
      }
      // Angle labels are lettered after the leg values, which have nowhere else to go: beside the arc first, then further
      // out along the bisector, then anywhere round the apex.
      angleLabels.push(() => {
        const mid = a1 + sweep / 2, label = angleText(degrees(angular.angle), t.plane), w = measureText(label, T)
        const radial = (at: number): Point => add2(angular.apex, [Math.cos(mid) * at, Math.sin(mid) * at])
        const spots = [0.6, 2.4, 4.2, 6.4, 8.8].map(k => r + k * T).flatMap(at => [radial(at), add2(radial(at), [w / 2 + 0.3 * T, 0]), add2(radial(at), [-w / 2 - 0.3 * T, 0])])
          .concat([r + 1.5 * T, r + 3.6 * T].flatMap(at => Array.from({ length: 12 }, (_, i): Point => add2(angular.apex, [Math.cos(i * Math.PI / 6) * (at + w / 2), Math.sin(i * Math.PI / 6) * at]))))
        const auto = clearest(spots, q => textPoly([q[0], q[1] + T / 2], label, T, 0, 0, 'middle', 1))
        const key = `offset-angle:${owner}:${t.plane}`, at = ctx.labelPositions?.[key] ?? [auto[0], auto[1] + T / 2] as Point
        emitters(ctx).text(at, label, T, 'DIM', owner, { anchor: 'middle', label: handle(key, at) })
      })
    }
    // The true length is dimensioned along the pipe, on the side away from the construction, unless the chain
    // along the pipe already gives it.
    if (comps.length === 3 && !chainExt && drafting?.showTrueLength!==false) {
      const along = unit2(sub2(end.page, start.page)), mid = lerp2(start.page, end.page, 0.5)
      let ext = unit2(ctx.axis(offsetExtension(d)))
      if (Math.abs(dot2(ext, along)) > 0.95) ext = unit2(ctx.axis([0, 0, 1]))
      const bulk = legs.reduce<Point>((sum, [a, b]) => add2(sum, sub2(lerp2(a, b, 0.5), mid)), [0, 0])
      if (dot2(ext, bulk) > 0) ext = scale2(ext, -1)
      dimension(start, end, total, ext, drafting?.trueLengthOffset ?? size.tier, leg.runs.length === 1 ? leg.runs[0] : undefined, owner, [], false, undefined, leg.runs.some(r=>r.dimensionReverse))
    }
    if (comps.length === 2 && !chainExt && drafting?.showTrueLength!==false) {
      const normal: Vec3 = [0, 0, 0]
      normal[[0, 1, 2].find(i => !comps.includes(i)) ?? 2] = 1
      const across3 = offsetExtension(d)
      // A plane seen edge on gives no extension across the pipe in it: the plane's own normal axis is used.
      let ext = unit2(ctx.axis(across3))
      if (Math.hypot(...ctx.axis(across3)) < 0.2) ext = unit2(ctx.axis(normal))
      if (dot2(ext, sub2(corner, lerp2(start.page, end.page, 0.5))) > 0) ext = scale2(ext, -1)
      dimension(start, end, total, ext, drafting?.trueLengthOffset ?? size.tier, leg.runs.length === 1 ? leg.runs[0] : undefined, owner, [], false, undefined, leg.runs.some(r=>r.dimensionReverse))
    }
    const ends = legs.flatMap(([a, b]) => [a, b]), centre = scale2(ends.reduce(add2, [0, 0]), 1 / ends.length)
    for (const [i, [p, q, mm, standing]] of legs.entries()) {
      if (drafting?.showLegValues === false) continue
      // A leg the view looks along is not drawn, so it is not lettered.
      if (len2(sub2(q, p)) < 1e-6) continue
      const dir = unit2(sub2(q, p))
      const out = dot2(unitAxis(standing), sub2(lerp2(p, q, 0.5), centre)) >= 0 ? unitAxis(standing) : scale2(unitAxis(standing), -1)
      const t = readable(planeText(dir, drafting?.legPlane==='vertical'&&Math.abs(dir[0])>.1?[0,-1]:out)), up = uprightOf(t)
      if (drafting?.dimensionLegs) {
        dimension({model:start.model,page:p,along:0},{model:end.model,page:q,along:mm},mm,out,size.tier,undefined,owner,[],false,`offset-leg:${owner}:${i}`)
        continue
      }
      // Leg text goes outside the triangle when its reading side faces in, and slides along the leg or further out when
      // that is taken, so leg values never overprint other lettering.
      const gap = 0.3 * T, value = draftLength(mm, units, feet), outside = dot2(up, out) >= 0 ? gap : -(T + gap), inside = dot2(up, out) >= 0 ? -(T + gap) : gap
      const spots = [0.5, 0.32, 0.68, 0.18, 0.82].flatMap(f => [add2(lerp2(p, q, f), scale2(up, outside)), add2(lerp2(p, q, f), scale2(up, inside))])
        .concat([1, 2, 3].flatMap(k => [0.5, 0.32, 0.68].map(f => add2(lerp2(p, q, f), scale2(up, outside + Math.sign(outside) * 1.6 * T * k)))))
      const key = `offset-leg:${owner}:${i}`, at = ctx.labelPositions?.[key] ?? clearest(spots, c => textPoly(c, value, T, t.rotation, t.oblique, 'middle', 1))
      emitters(ctx).text(at, value, T, 'DIM', owner, { rotation: t.rotation, oblique: t.oblique, anchor: 'middle', label: handle(key, at) })
    }
    if (run !== undefined && drafting?.setAndRoll) {
      // A rolling offset's set is its true offset across the run: the diagonal of the roll and the rise (in plan when
      // the run is vertical), turned out of the plane by the roll angle.
      const across = [0, 1, 2].filter(i => i !== run), set = Math.hypot(d[across[0]], d[across[1]])
      const [p, q] = run === 2 ? [legs[0][0], legs[1][1]] : [legs[1][0], legs[2][1]]
      if (run !== 2) line(p, q, 'DIM', owner, size.thin * 0.8)
      const dir = unit2(sub2(q, p)), t = readable(planeText(dir, unitAxis(run))), up = uprightOf(t), value = 'SET ' + draftLength(set, units, feet)
      const spots = [0.5, 0.35, 0.65].flatMap(f => [add2(lerp2(p, q, f), scale2(up, 0.3 * T)), add2(lerp2(p, q, f), scale2(up, -1.3 * T))])
      emitters(ctx).text(clearest(spots, c => textPoly(c, value, T, t.rotation, t.oblique, 'middle', 1)), value, T, 'DIM', owner,
        { rotation: t.rotation, oblique: t.oblique, anchor: 'middle' })
      if (run !== 2) {
        const plan = legs[1][1], b1 = Math.atan2(plan[1] - p[1], plan[0] - p[0]), b2 = Math.atan2(q[1] - p[1], q[0] - p[0])
        let sweep = b2 - b1
        if (sweep > Math.PI) sweep -= 2 * Math.PI
        if (sweep < -Math.PI) sweep += 2 * Math.PI
        const r = Math.min(HATCH.roll * T, Math.hypot(...sub2(plan, p)) * 0.45), mid = b1 + sweep / 2
        poly(Array.from({ length: 9 }, (_, i) => add2(p, [Math.cos(b1 + sweep * i / 8) * r, Math.sin(b1 + sweep * i / 8) * r] as Point)), 'DIM', owner)
        const label = `${degrees(Math.atan2(Math.abs(d[2]), Math.abs(d[horizontal[1]])) * 180 / Math.PI)}° ROLL`
        const spots = [0.6, 2.4, 4.2].map(k => r + k * T).map(at => add2(p, [Math.cos(mid) * at, Math.sin(mid) * at] as Point))
        const at = clearest(spots, c => textPoly([c[0], c[1] + T / 2], label, T, 0, 0, 'middle', 1))
        emitters(ctx).text([at[0], at[1] + T / 2], label, T, 'DIM', owner, { anchor: 'middle' })
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
