import type { Point } from '../drawing'
import { draftLength, angleText } from '../format'
import { connected, distance, getNode, length, runResult, sub, type PipeNode, type PipeRun, type Vec3 } from '../model'
import { SIZE, emitters, type IsoContext } from './context'
import { measureText } from '../stroke-font'
import { segmentPoly, textPoly } from './placement'
import { add2, dot2, isAxial, lerp2, planeText, scale2, sub2, unit2, unit3, uprightOf } from './plane'

interface Station { model: Vec3; page: Point; node?: string }
interface Leg { runs: PipeRun[]; nodes: string[]; dir3: Vec3; dir: Point }

/** Straight legs of the sheet: in-line pipes joined through valves, flanges, reducers and welds. */
export function sheetLegs(ctx: IsoContext): Leg[] {
  const seen = new Set<string>(), legs: Leg[] = []
  const straightThrough = (node: PipeNode, from: PipeRun) => {
    if (node.kind === 'end' || node.kind === 'tee' || node.kind.startsWith('elbow')) return undefined
    const edges = connected(ctx.doc, node.id).filter(r => r.id !== from.id && ctx.geometry.has(r.id) && !r.connector)
    if (edges.length !== 1) return undefined
    const a = ctx.geometry.get(from.id)!, b = ctx.geometry.get(edges[0].id)!
    return Math.abs(Math.abs(a.dir3[0] * b.dir3[0] + a.dir3[1] * b.dir3[1] + a.dir3[2] * b.dir3[2]) - 1) < 1e-4 ? edges[0] : undefined
  }
  for (const g of ctx.geometry.values()) {
    if (seen.has(g.run.id) || g.run.connector) continue
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
  const out: Station[] = []
  leg.nodes.forEach((id, i) => {
    const node = getNode(ctx.doc, id), page = ctx.pos.get(id)!
    const inner = i > 0 && i < leg.nodes.length - 1
    if (inner && node.kind === 'gasket') return
    const joints = ctx.joints.filter(j => j.nodeId === id && j.kind === 'component-port')
    if (inner && joints.length === 2) {
      // A flanged valve is dimensioned face to face.
      const e = ctx.extent.get(id) ?? 0
      for (const j of joints.sort((x, y) => dot2(sub2(ctx.project(x.position), page), leg.dir) - dot2(sub2(ctx.project(y.position), page), leg.dir)))
        out.push({ model: j.position, page: add2(page, scale2(leg.dir, Math.sign(dot2(sub2(ctx.project(j.position), page), leg.dir)) * (e - 1))) })
      return
    }
    out.push({ model: node.position, page, node: id })
  })
  return out
}

export function drawDimensions(ctx: IsoContext) {
  const { line, poly, arrow } = emitters(ctx)
  const units = ctx.doc.units
  for (const leg of sheetLegs(ctx)) {
    const points = stations(ctx, leg)
    if (points.length < 2) continue
    if (!isAxial(leg.dir3)) { offset(leg, points); continue }
    const segments = points.slice(1).map((p, i) => ({ a: points[i], b: p, mm: distance(points[i].model, p.model) })).filter(s => s.mm > 0.5)
    if (!segments.length) continue
    const tiers = [segments]
    if (segments.length > 1) tiers.push([{ a: points[0], b: points.at(-1)!, mm: distance(points[0].model, points.at(-1)!.model) }])
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
          cost += ctx.place.cost(segmentPoly(a, b, 1)) + ctx.place.cost(labelPoly(s.mm, a, b, ext))
        }
      })
      // Prefer dimensions above and to the right, as drafted.
      cost += (ext[1] > 0 ? 3 : 0) + (ext[0] < -0.1 ? 2 : 0)
      if (!best || cost < best.cost) best = { cost, ext }
    }
    if (!best) continue
    const ext = best.ext
    tiers.forEach((tier, t) => {
      const off = SIZE.tier + t * SIZE.tierStep
      for (const s of tier) dimension(s.a, s.b, s.mm, ext, off, runBetween(leg, s), ownerOf(leg, s))
    })
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
  function dimension(pa: Station, pb: Station, mm: number, ext: Point, offset: number, editable?: PipeRun, owner?: string) {
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
    const at = spots.reduce((best, p, i) => {
      const c = ctx.place.cost(textPoly(p, value, SIZE.text, t.rotation, t.oblique, 'middle', 1)) + i * 4
      return c < best.c ? { p, c } : best
    }, { p: spots[0], c: Infinity }).p
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
    // A label moved beyond the end of a short dimension is joined to it.
    const offLine = Math.abs(dot2(sub2(at, mid), along)) > span / 2 + 2
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
  function offset(leg: Leg, points: Station[]) {
    const start = points[0], end = points.at(-1)!, d = sub(end.model, start.model), total = length(d)
    if (total < 1) return
    const comps = [0, 1, 2].filter(i => Math.abs(d[i]) > 0.5)
    const along = unit2(sub2(end.page, start.page)), pageSpan = Math.hypot(...sub2(end.page, start.page))
    const k = pageSpan / total
    // Corner of the triangle: travel the first axis component, then the second.
    const first = comps.find(i => i !== 2) ?? comps[0], axis3: Vec3 = [0, 0, 0]
    axis3[first] = Math.sign(d[first])
    const corner = add2(start.page, scale2(ctx.axis(axis3), Math.abs(d[first]) * k * Math.hypot(...ctx.axis(axis3))))
    line(start.page, corner, 'DIM', leg.runs[0].id)
    line(corner, end.page, 'DIM', leg.runs[0].id)
    for (let i = 1; i <= 5; i++) {
      const t = i / 6
      line(lerp2(start.page, corner, t), lerp2(start.page, end.page, t), 'HATCH', leg.runs[0].id, 0.4)
    }
    const plane = comps.includes(2) ? 'V' : 'H'
    const second = comps.find(i => i !== first)
    const angle = second == null ? 0 : Math.atan2(Math.abs(d[second]), Math.abs(d[first])) * 180 / Math.PI
    const label = angleText(Math.round(angle), plane)
    const at = add2(lerp2(start.page, lerp2(corner, end.page, 0.5), 0.35), scale2(along, 6))
    emitters(ctx).text(at, label, SIZE.text, 'DIM', leg.runs[0].id, { anchor: 'middle' })
    const legDim = (p: Point, q: Point, mm: number) => {
      const dir = unit2(sub2(q, p)), out = unit2(sub2(lerp2(p, q, 0.5), lerp2(start.page, end.page, 0.5)))
      const t = planeText(dir, out), up = uprightOf(t)
      arrow(p, scale2(dir, -1), 'DIM', leg.runs[0].id); arrow(q, dir, 'DIM', leg.runs[0].id)
      // Leg text goes outside the triangle when its reading side faces in.
      const side = dot2(up, out) >= 0 ? 2 : -(SIZE.text + 2)
      emitters(ctx).text(add2(lerp2(p, q, 0.5), scale2(up, side)), draftLength(mm, units, 24), SIZE.text, 'DIM', leg.runs[0].id, { rotation: t.rotation, oblique: t.oblique, anchor: 'middle' })
    }
    legDim(start.page, corner, Math.abs(d[first]))
    if (second != null) legDim(corner, end.page, Math.hypot(...comps.filter(i => i !== first).map(i => d[i])))
    void poly
  }
}
