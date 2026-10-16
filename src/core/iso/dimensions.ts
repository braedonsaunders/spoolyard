import type { Point } from '../drawing'
import { draftLength, angleText } from '../format'
import { connected, distance, getNode, length, runResult, sub, takeout, type PipeNode, type PipeRun, type Vec3 } from '../model'
import { nodeCode } from '../joints'
import { SIZE, emitters, type IsoContext } from './context'
import { measureText } from '../stroke-font'
import { segmentPoly, textPoly, type Poly } from './placement'
import { add2, dot2, isAxial, lerp2, planeText, scale2, sub2, unit2, unit3, uprightOf } from './plane'

interface Station { model: Vec3; page: Point; node?: string }
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

/** Where a leg is measured: fitting work points, flanged faces of valves, flange joints and open ends. */
function stations(ctx: IsoContext, leg: Leg): Station[] {
  const out: Array<Station & { along: number }> = []
  const origin = getNode(ctx.doc, leg.nodes[0]).position
  const along = (p: Vec3) => (p[0] - origin[0]) * leg.dir3[0] + (p[1] - origin[1]) * leg.dir3[1] + (p[2] - origin[2]) * leg.dir3[2]
  const at = (model: Vec3, page: Point, node?: string) => out.push({ model, page, node, along: along(model) })
  leg.nodes.forEach((id, i) => {
    const node = getNode(ctx.doc, id), page = ctx.pos.get(id)!
    const inner = i > 0 && i < leg.nodes.length - 1
    if (inner && node.kind === 'gasket') return
    const code = nodeCode(ctx.doc, node) ?? ''
    // Nipples, couplings, unions and regulators only join the pieces either side: the dimensions run through them.
    if (inner && /NIPPLE|UNION|CPLG|REGUL/.test(code)) return
    const joints = ctx.joints.filter(j => j.nodeId === id && j.kind === 'component-port')
    const e = ctx.extent.get(id) ?? 0
    if (inner && joints.length) {
      // A flanged valve is dimensioned between its mating flange faces, across both gaskets.
      for (const j of joints) {
        const run = ctx.runs.find(r => r.id === j.runIds[0]), g = run && ctx.geometry.get(run.id)
        if (!run || !g) continue
        const out3 = sub(getNode(ctx.doc, run.from === id ? run.to : run.from).position, node.position), l = length(out3) || 1
        const face: Vec3 = [0, 1, 2].map(k => j.position[k] + out3[k] / l * (j.gasket?.thickness ?? 0)) as Vec3
        const dir = run.from === id ? g.dir : scale2(g.dir, -1)
        at(face, add2(page, scale2(dir, Math.max(0, e - SIZE.flangeThickness - 0.4))))
      }
      return
    }
    if (inner && node.kind === 'reducer' && !/CPLG/.test(code)) {
      // A reducer is dimensioned to both its ends.
      for (const run of connected(ctx.doc, id).filter(r => ctx.geometry.has(r.id))) {
        const g = ctx.geometry.get(run.id)!, t = takeout(ctx.doc, node, run.id) ?? 0
        const out3 = sub(getNode(ctx.doc, run.from === id ? run.to : run.from).position, node.position), l = length(out3) || 1
        const dir = run.from === id ? g.dir : scale2(g.dir, -1)
        at([0, 1, 2].map(k => node.position[k] + out3[k] / l * t) as Vec3, add2(page, scale2(dir, e)))
      }
      return
    }
    at(node.position, page, id)
  })
  // Faces closer than a gasket (a flange pair at a break) are one station.
  return out.sort((a, b) => a.along - b.along).filter((s, i, all) => !i || s.along - all[i - 1].along > 3.2)
}

/**
 * Branch connections on the pipe (olets) and the supports the drafter chose to locate, each dimensioned from one
 * station of the leg in a tier of its own next to the pipe: olets from the nearest station, supports from the
 * fitting at an end of their pipe piece.
 */
function locations(ctx: IsoContext, leg: Leg, points: Station[]): Array<{ a: Station; b: Station; mm: number }> {
  const out: Array<{ a: Station; b: Station; mm: number }> = []
  const along = (p: Vec3) => p[0] * leg.dir3[0] + p[1] * leg.dir3[1] + p[2] * leg.dir3[2]
  for (const node of ctx.nodes) {
    if (!leg.runs.some(r => r.id === node.associatedRunId)) continue
    if (!(node.kind === 'olet' || (node.kind === 'support' && node.dimensioned))) continue
    const page = ctx.pos.get(node.id)
    if (!page) continue
    // A support is located from a fitting at an end of its own pipe piece, as the fitter sets it out.
    const host = leg.runs.find(r => r.id === node.associatedRunId)!
    const ends = points.filter(p => p.node && (p.node === host.from || p.node === host.to))
    const fittings = ends.filter(p => /^(elbow|tee)/.test(getNode(ctx.doc, p.node!).kind))
    const pool = node.kind === 'support' ? (fittings.length ? fittings : ends.length ? ends : points) : points
    const from = pool.reduce((best, p) => Math.abs(along(p.model) - along(node.position)) < Math.abs(along(best.model) - along(node.position)) ? p : best)
    const mm = Math.abs(along(from.model) - along(node.position))
    if (mm < 1) continue
    const station: Station = { model: node.position, page, node: node.id }
    out.push(along(from.model) < along(node.position) ? { a: from, b: station, mm } : { a: station, b: from, mm })
  }
  return out
}

export function drawDimensions(ctx: IsoContext) {
  const { line, poly, arrow } = emitters(ctx)
  const units = ctx.doc.units
  for (const leg of sheetLegs(ctx)) {
    // A screwed vent or drain (nipple and cap off a pipe) is made of its parts; it takes no dimensions.
    const node = (id: string) => getNode(ctx.doc, id)
    if (leg.runs.every(r => r.connector) && leg.nodes.some(id => /NIPPLE/.test(nodeCode(ctx.doc, node(id)) ?? '')) &&
      [leg.nodes[0], leg.nodes.at(-1)!].some(id => node(id).kind === 'cap' || !!node(id).associatedRunId)) continue
    const points = stations(ctx, leg)
    if (points.length < 2) continue
    const segments = points.slice(1).map((p, i) => ({ a: points[i], b: p, mm: distance(points[i].model, p.model) })).filter(s => s.mm > 0.5)
    const skewed = !isAxial(leg.dir3)
    // An offset with nothing along it is dimensioned by its construction alone.
    if (skewed && segments.length < 2 && !locations(ctx, leg, points).length) { offset(leg, points); continue }
    if (!segments.length) continue
    // Branch locations next to the pipe, then the chain between stations, then an overall dimension for each part
    // of the leg between branches.
    const located = locations(ctx, leg, points)
    const tiers = located.length ? [located, segments] : [segments]
    const sections: Array<typeof segments> = [[]]
    for (const s of segments) {
      sections.at(-1)!.push(s)
      if (s.b.node && s.b !== points.at(-1) && getNode(ctx.doc, s.b.node).kind === 'tee') sections.push([])
    }
    const across = (sec: typeof segments) => ({ a: sec[0].a, b: sec.at(-1)!.b, mm: distance(sec[0].a.model, sec.at(-1)!.b.model) })
    // When tees cut the chain into single pieces, the overall runs the whole leg instead.
    const overall = sections.every(sec => sec.length < 2) ? segments.length > 1 ? [across(segments)] : [] : sections.filter(sec => sec.length > 1).map(across)
    if (overall.length) tiers.push(overall)
    // Extension lines run along an isometric axis across the leg: vertical for horizontal legs, horizontal for risers.
    const horizontal = Math.abs(leg.dir3[2]) < 0.7
    const options: Vec3[] = horizontal ? [[0, 0, 1], [0, 0, -1]] : [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]
    let best: { cost: number; ext: Point } | null = null
    for (const axis3 of options) {
      const ext = unit2(ctx.axis(axis3))
      if (Math.abs(dot2(ext, leg.dir)) > 0.95) continue
      let cost = 0
      tiers.forEach((tier, t) => {
        const off = SIZE.tier + t * SIZE.tierStep
        for (const s of tier) {
          const a = add2(s.a.page, scale2(ext, off)), b = add2(s.b.page, scale2(ext, off))
          // A dimension line may cross a pipe; its lettering may not.
          cost += ctx.place.cost(segmentPoly(a, b, 1), undefined, { pipe: 8, symbol: 30 }) + ctx.place.cost(labelPoly(s.mm, a, b, ext))
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
      const off = SIZE.tier + t * SIZE.tierStep
      // Neighbouring pieces of a chain are no place for a short dimension's text.
      const spans = tier.map(s => [s.a.page, s.b.page] as [Point, Point])
      for (const s of tier) dimension(s.a, s.b, s.mm, ext, off, runBetween(leg, s), ownerOf(leg, s), spans.filter(([a]) => a !== s.a.page))
    })
    // The overall of a skewed leg is its true length; the construction goes on the other side.
    if (skewed) offset(leg, points, ext)
  }
  /** The pipe a dimension measures node to node, so its length can be edited in place. */
  function runBetween(leg: Leg, s: { a: Station; b: Station }) {
    return leg.runs.find(r => s.a.node && s.b.node && [r.from, r.to].includes(s.a.node) && [r.from, r.to].includes(s.b.node))
  }
  function ownerOf(leg: Leg, s: { a: Station; b: Station }) {
    const run = leg.runs.find(r => [r.from, r.to].includes(s.a.node ?? '') && [r.from, r.to].includes(s.b.node ?? ''))
    return run?.id ?? leg.runs[0].id
  }
  function labelPoly(mm: number, a: Point, b: Point, ext: Point) {
    const along = unit2(sub2(b, a)), t = planeText(along, ext)
    return textPoly(add2(lerp2(a, b, 0.5), scale2(uprightOf(t), 2)), draftLength(mm, units, 24), SIZE.text, t.rotation, t.oblique, 'middle', 1)
  }
  /** One dimension: extension lines from both points, a dimension line with arrowheads, and iso-plane text. */
  function dimension(pa: Station, pb: Station, mm: number, ext: Point, offset: number, editable?: PipeRun, owner?: string, others: Array<[Point, Point]> = []) {
    const a = add2(pa.page, scale2(ext, offset)), b = add2(pb.page, scale2(ext, offset))
    const along = unit2(sub2(b, a)), span = Math.hypot(...sub2(b, a))
    const value = draftLength(mm, units, 24), t = planeText(along, ext), up = uprightOf(t)
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
  /** Rolling or plane offsets: hatched triangle with both leg dimensions and the offset angle. */
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
  /** The offset construction of a skewed leg; `chainExt` is the side its chain dimensions took, if it has them. */
  function offset(leg: Leg, points: Station[], chainExt?: Point) {
    const start = points[0], end = points.at(-1)!, d = sub(end.model, start.model), total = length(d)
    if (total < 1) return
    const owner = leg.runs[0].id
    const comps = [0, 1, 2].filter(i => Math.abs(d[i]) > 0.5)
    const unitAxis = (i: number): Point => { const v: Vec3 = [0, 0, 0]; v[i] = 1; return ctx.axis(v) }
    // A plane offset is one right triangle; a rolling offset is a horizontal triangle (the travel in plan) and a
    // vertical one (the rise), drawn as the reference sheets do.
    const horizontal = comps.filter(i => i !== 2).sort((a, b) => Math.abs(d[b]) - Math.abs(d[a])), rises = comps.includes(2)
    const centre0 = lerp2(start.page, end.page, 0.5)
    // Each leg, the length along its axis, and the axis its lettering stands on (the triangle's other axis).
    const legs: Array<[Point, Point, number, number]> = []
    const triangles: Array<{ apex: Point; leg: Point; far: Point; angle: number; plane: 'H' | 'V' }> = []
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
      line(start.page, plan, 'DIM', owner, 0.4)
      triangles.push({ apex: start.page, leg: plan, far: end.page, angle: Math.atan2(Math.abs(d[2]), Math.hypot(d[horizontal[0]], d[horizontal[1]])) * 180 / Math.PI, plane: 'V' })
    }
    const corner = legs[0][1]
    for (const [a, b] of legs) line(a, b, 'DIM', owner)
    const angleLabels: Array<() => void> = []
    for (const t of triangles) {
      // Hatching fills the acute corner between the pipe and the leg; a square marks the right angle.
      for (let i = 1; i <= 4; i++) {
        const f = 0.06 + i * 0.075
        line(lerp2(t.apex, t.leg, f), lerp2(t.apex, t.far, f), 'HATCH', owner, 0.4)
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
      // Angle labels are lettered after the leg values, which have nowhere else to go.
      angleLabels.push(() => {
        const mid = a1 + sweep / 2, label = angleText(Math.round(t.angle), t.plane)
        const labelAt = add2(t.apex, [Math.cos(mid) * (r + 4), Math.sin(mid) * (r + 4)] as Point)
        // Further out along the bisector when the near spots are lettered already: angle labels never overprint text.
        const spots: Point[] = [labelAt, add2(labelAt, [measureText(label, SIZE.text) / 2 + 2, 0]), add2(labelAt, [-measureText(label, SIZE.text) / 2 - 2, 0]),
          add2(labelAt, [0, SIZE.text + 3]), ...[16, 28, 42, 58].map(k => add2(t.apex, [Math.cos(mid) * (r + k), Math.sin(mid) * (r + k)] as Point))]
        const at = spots.reduce((best, q, i) => {
          const c = ctx.place.cost(textPoly([q[0], q[1] + SIZE.text / 2], label, SIZE.text, 0, 0, 'middle', 1), undefined, LETTERED) + i
          return c < best.c ? { q, c } : best
        }, { q: spots[0], c: Infinity }).q
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
      dimension(start, end, total, ext, SIZE.tier, leg.runs.length === 1 ? leg.runs[0] : undefined, owner)
    }
    if (comps.length === 2 && !chainExt) {
      const normal: Vec3 = [0, 0, 0]
      normal[[0, 1, 2].find(i => !comps.includes(i)) ?? 2] = 1
      const dir3 = unit3(d), across3: Vec3 = [normal[1] * dir3[2] - normal[2] * dir3[1], normal[2] * dir3[0] - normal[0] * dir3[2], normal[0] * dir3[1] - normal[1] * dir3[0]]
      const along = unit2(sub2(end.page, start.page))
      let ext = unit2(ctx.axis(across3))
      if (Math.hypot(...ctx.axis(across3)) < 0.2) ext = [along[1], -along[0]]
      if (dot2(ext, sub2(corner, lerp2(start.page, end.page, 0.5))) > 0) ext = scale2(ext, -1)
      dimension(start, end, total, ext, SIZE.tier, leg.runs.length === 1 ? leg.runs[0] : undefined, owner)
    }
    const centre = lerp2(start.page, end.page, 0.5)
    for (const [p, q, mm, standing] of legs) {
      const dir = unit2(sub2(q, p)), away = sub2(lerp2(p, q, 0.5), centre)
      const out = dot2(unitAxis(standing), away) >= 0 ? unitAxis(standing) : scale2(unitAxis(standing), -1)
      const t = planeText(dir, out), up = uprightOf(t)
      // Leg text goes outside the triangle when its reading side faces in.
      const value = draftLength(mm, units, 24)
      // Either side of the leg, then slid along it, so leg values never overprint other lettering.
      const outward = dot2(up, out) >= 0 ? 1 : -1, beside = (f: number, k: number) => add2(lerp2(p, q, f), scale2(up, outward > 0 ? k : -(SIZE.text + k)))
      const spots: Point[] = [0.5, 0.32, 0.68, 0.18, 0.82].flatMap(f => [beside(f, 2), add2(lerp2(p, q, f), scale2(up, outward > 0 ? -(SIZE.text + 2) : 2))])
        .concat([0.5, 0.32, 0.68].flatMap(f => [beside(f, 10), beside(f, 18)]))
      const at = spots.reduce((best, q2, i) => {
        const c = ctx.place.cost(textPoly(q2, value, SIZE.text, t.rotation, t.oblique, 'middle', 1), undefined, LETTERED) + i * 4
        return c < best.c ? { q2, c } : best
      }, { q2: spots[0], c: Infinity }).q2
      emitters(ctx).text(at, value, SIZE.text, 'DIM', owner, { rotation: t.rotation, oblique: t.oblique, anchor: 'middle' })
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
