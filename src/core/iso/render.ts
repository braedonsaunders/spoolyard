import type { Drawing, Point, Primitive, SheetFit } from '../drawing'
import { flangedJoints } from '../joints'
import { sheetMaterials } from '../material-list'
import { getNode, styleOf, type IsoDocument, type PipeRun, type Vec3 } from '../model'
import { SIZE, type IsoContext, type RunGeometry } from './context'
import { drawDimensions } from './dimensions'
import { drawAnnotations } from './annotations'
import { layoutDirection, layoutSheet, tangles, untangle, viewProject, type Layout, type LegShape, type View } from './layout'
import { clipOutside, overlaps, Placement, rectPoly, segmentPoly, textPoly, type Rect } from './placement'
import { unit2, unit3 } from './plane'
import { drawPipes } from './symbols'

export interface SheetFrameResult { primitives: Primitive[]; viewport: Rect; exclusions: Rect[] }
export type SheetFrameFn = (input: { doc: IsoDocument; spool: string; width: number; height: number; rows: Array<{ id: number; qtyText: string; nd: string; description: string }>; view?: View }) => SheetFrameResult

/**
 * A production isometric: sheet frame, laid-out pipes with their symbols, dimensions, tags and callouts, all placed
 * so no label overlaps another. Model space (`model`) draws the same content at true scale without the sheet.
 */
export function renderIso(
  doc: IsoDocument,
  spool: string,
  view: View,
  width: number,
  height: number,
  frame: SheetFrameFn | null,
  hold?: SheetFit,
  model = false
): Drawing {
  const style = styleOf(doc)
  const facing: View = model ? 'iso' : view
  const runs = doc.runs.filter(r => !spool || r.spool === spool)
  const nodes = doc.nodes.filter(n => runs.some(r => r.from === n.id || r.to === n.id || r.id === n.associatedRunId))
  const materials = sheetMaterials(doc, spool), joints = flangedJoints(doc, spool)
  const sheet = model || !frame ? null : frame({ doc, spool, width, height, rows: materials, view })
  const viewport: Rect = sheet?.viewport ?? [-1e6, -1e6, 1e6, 1e6]
  const exclusions = sheet?.exclusions ?? []
  const schematic = style.layout === 'schematic' && !model
  // Fit to the open part of the sheet: left of the bill of materials, clear of the frame, with room for callouts.
  const fitArea: Rect = sheet ? openArea(viewport, exclusions) : [0, 0, width, height]
  const fw = fitArea[2] - fitArea[0], fh = fitArea[3] - fitArea[1]
  const bounds = (layout: Layout) => {
    const raw = [...layout.raw.values()]
    const xs = raw.map(p => p[0]), ys = raw.map(p => p[1])
    return raw.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 1, 1]
  }
  const fitOf = (layout: Layout): SheetFit => {
    const [minX, minY, maxX, maxY] = bounds(layout)
    return {
      centre: [(maxX + minX) / 2, (maxY + minY) / 2],
      scale: layout.raw.size ? Math.min(fw * 0.8 / Math.max(1, maxX - minX), fh * 0.78 / Math.max(1, maxY - minY)) : 0.3
    }
  }
  let base = hold?.base ?? 1
  const shape: LegShape = { stretch: hold?.stretch ?? 0, legs: hold?.legs ?? {} }
  if (schematic && hold?.base == null && runs.length) {
    const lay = (b: number) => layoutSheet(doc, runs, nodes, facing, true, b, shape)
    // Not to scale, symbols and callouts keep their sheet size; share what is left of the sheet out by pipe
    // length, so the drawing fills the open area the way a drafter lays it out.
    const fill = () => {
      let lo = 1e-3, hi = 4
      for (let i = 0; i < 16; i++) {
        const mid = Math.sqrt(lo * hi)
        if (fitOf(lay(mid)).scale >= 1) lo = mid
        else hi = mid
      }
      return lo
    }
    // How much wider than tall the drawing is for the open area: 1 fills both ways.
    const wide = (layout: Layout) => {
      const [x0, y0, x1, y1] = bounds(layout)
      return (Math.max(1, x1 - x0) / (fw * 0.8)) / (Math.max(1, y1 - y0) / (fh * 0.78))
    }
    base = fill()
    // A narrow drawing that leaves much of the open area's width empty draws its level pipe longer, up to about
    // twice, as drafters fill the sheet; a wide one is left flat, as issued.
    if (wide(lay(base)) < BALANCE) {
      const fills = (s: number) => {
        shape.stretch = s
        base = fill()
        return wide(lay(base)) >= BALANCE
      }
      let lo = 0, hi = STRETCH
      if (!fills(hi)) lo = hi
      for (let i = 0; i < 8 && hi - lo > 0.02; i++) {
        const mid = (lo + hi) / 2
        if (fills(mid)) hi = mid
        else lo = mid
      }
      shape.stretch = hi
      base = fill()
    }
    // Straights that would cross or run into each other are drawn longer or shorter until they clear.
    // Refitting the sheet changes every pipe's length, so the legs are checked again at the new fit.
    for (let round = 0; round < 3 && tangles(doc, lay(base)).length; round++) {
      shape.legs = untangle(doc, runs, nodes, facing, base, shape)
      base = fill()
    }
  }
  const layout = layoutSheet(doc, runs, nodes, facing, schematic, base, shape)
  let fit: SheetFit = model ? { centre: [0, 0], scale: 0.3 } : hold ? { ...hold, base } : schematic ? { ...fitOf(layout), base, ...shape } : fitOf(layout)
  const cx = model ? 550 : (fitArea[0] + fitArea[2]) / 2, cy = model ? 425 : (fitArea[1] + fitArea[3]) / 2
  const axis = (v: Vec3) => unit2(viewProject(v, facing, doc.north))
  const direction = (v: Vec3) => (schematic ? layoutDirection : viewProject)(v, facing, doc.north)
  const paint = (fit: SheetFit) => {
    const toSheet = (q: Point): Point => [(q[0] - fit.centre[0]) * fit.scale + cx, (q[1] - fit.centre[1]) * fit.scale + cy]
    const pos = new Map([...layout.raw].map(([id, p]) => [id, toSheet(p)] as [string, Point]))
    const project = (p: Vec3) => toSheet(layout.rawProject(p))
    const geometry = new Map<string, RunGeometry>()
    for (const run of runs) {
      const a = pos.get(run.from), b = pos.get(run.to)
      if (!a || !b) continue
      const d: Point = [b[0] - a[0], b[1] - a[1]], length = Math.hypot(...d)
      const pa = getNode(doc, run.from).position, pb = getNode(doc, run.to).position
      geometry.set(run.id, { run, a, b, dir: length ? [d[0] / length, d[1] / length] : [1, 0], length, dir3: unit3([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]) })
    }
    const ctx: IsoContext = {
      doc, spool, view: facing, style, runs, nodes, pos, project, axis, direction, geometry,
      place: new Placement(viewport, exclusions), materials, joints, extent: new Map(), out: []
    }
    // Free notes stay where the drafter put them, so every label is placed clear of them.
    for (const note of doc.sheetNotes ?? [])
      if (note.spool === spool || !spool) ctx.place.add(textPoly(note.at, note.text.toUpperCase(), SIZE.text, 0, 0, 'start', 1), 'text', note.id)
    drawPipes(ctx)
    drawDimensions(ctx)
    drawAnnotations(ctx)
    return ctx
  }
  let ctx = paint(fit)
  // The picture keeps off the north symbol, bill of materials and notes, and inside the frame: when its constructions
  // reach them, the sheet is drawn again a little smaller.
  for (let i = 0; i < 3 && sheet && !hold && intrudes(ctx.out, viewport, exclusions); i++) ctx = paint(fit = { ...fit, scale: fit.scale * 0.9 })
  const pos = ctx.pos, project = ctx.project
  // Thin drafting lines break around lettering, as drafted, so a dimension or leader never strikes through text.
  const lettering = ctx.out.flatMap(p => p.type === 'text' && p.layer !== 'SYMBOL' ? [textPoly(p.p, p.text, p.size, p.rotation, p.oblique, p.anchor, 1.2)] : [])
  const drawn = crossingGaps(ctx).flatMap(p => {
    if (p.type !== 'line' || !['DIM', 'LEADER', 'HATCH'].includes(p.layer)) return [p]
    let pieces: Array<[Point, Point]> = [[p.a, p.b]]
    for (const box of lettering) pieces = pieces.flatMap(([a, b]) => clipOutside(a, b, box))
    return pieces.map(([a, b]) => ({ ...p, a, b }))
  })
  const primitives = [...(sheet?.primitives ?? []), ...drawn]
  primitives.sort((a, b) => Number(a.type === 'text') - Number(b.type === 'text'))
  return {
    width,
    height,
    area: model ? [0, 0, width, height] : viewport,
    fit,
    primitives,
    positions: pos,
    project,
    view: facing,
    lettering: style.lettering
  }
}
/** Whether any drawn line leaves the model viewport or reaches into an area the picture keeps off. */
export function intrudes(out: Primitive[], viewport: Rect, exclusions: Rect[]): boolean {
  const keepOut = exclusions.map(e => rectPoly(...e))
  return out.some(p => {
    if (p.type !== 'line' && p.type !== 'polyline') return false
    const pieces: Array<[Point, Point]> = p.type === 'line' ? [[p.a, p.b]] : p.points.slice(1).map((q, i) => [p.points[i], q])
    return pieces.some(([a, b]) => [a, b].some(q => q[0] < viewport[0] || q[0] > viewport[2] || q[1] < viewport[1] || q[1] > viewport[3]) ||
      keepOut.some(e => overlaps(segmentPoly(a, b, 0.5), e)))
  })
}
/** Breaks in the pipe behind where two pipes cross (0.25 in) and in a leader where it crosses a pipe. */
const PIPE_GAP = 850 / 11 * 0.25, LEADER_GAP = 850 / 11 * 0.08
type Line = Extract<Primitive, { type: 'line' }>
/** The drawing with the rear pipe broken at each crossing of two pipes, and leaders broken where they cross a pipe. */
function crossingGaps(ctx: IsoContext): Primitive[] {
  const { doc, view } = ctx, angle = doc.north * Math.PI / 180
  // How near the viewer a model point is.
  const depth = (p: Vec3) => view === 'plan' ? p[2] : view === 'front' ? -p[1] : view === 'side' ? p[0]
    : p[2] - (p[0] * Math.cos(angle) - p[1] * Math.sin(angle)) - (p[0] * Math.sin(angle) + p[1] * Math.cos(angle))
  const model = (run: PipeRun, at: Point): Vec3 => {
    const g = ctx.geometry.get(run.id)!, a = getNode(doc, run.from).position, b = getNode(doc, run.to).position
    const f = g.length ? ((at[0] - g.a[0]) * g.dir[0] + (at[1] - g.a[1]) * g.dir[1]) / g.length : 0
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
  }
  // Pipes that meet at a node, or a branch and the pipe it is fitted on, do not cross.
  const ends = (r: PipeRun) => [r.from, r.to]
  const joined = (a: PipeRun, b: PipeRun) => ends(a).some(id => ends(b).includes(id)) ||
    ends(a).some(id => getNode(doc, id).associatedRunId === b.id) || ends(b).some(id => getNode(doc, id).associatedRunId === a.id)
  const runOf = new Map(ctx.runs.map(r => [r.id, r]))
  const pipes = ctx.out.flatMap((p, i) => p.type === 'line' && p.layer === 'PIPE' && p.owner && runOf.has(p.owner) && ctx.geometry.has(p.owner) ? [{ i, p, run: runOf.get(p.owner)! }] : [])
  const cuts = new Map<number, Array<[number, number]>>()
  const cut = (i: number, line: Line, at: Point, gap: number) => {
    const l = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]), t = Math.hypot(at[0] - line.a[0], at[1] - line.a[1]) / l
    cuts.set(i, [...(cuts.get(i) ?? []), [t - gap / 2 / l, t + gap / 2 / l]])
  }
  for (let x = 0; x < pipes.length; x++)
    for (let y = x + 1; y < pipes.length; y++) {
      const a = pipes[x], b = pipes[y]
      if (a.run === b.run || joined(a.run, b.run)) continue
      const at = crossing(a.p, b.p)
      if (!at) continue
      const rear = depth(model(a.run, at)) < depth(model(b.run, at)) ? a : b
      cut(rear.i, rear.p, at, PIPE_GAP)
    }
  ctx.out.forEach((p, i) => {
    if (p.type !== 'line' || p.layer !== 'LEADER') return
    for (const pipe of pipes) {
      const at = pipe.p.owner !== p.owner && crossing(p, pipe.p)
      if (at) cut(i, p, at, LEADER_GAP)
    }
  })
  return ctx.out.flatMap((p, i) => {
    const gaps = cuts.get(i)
    if (!gaps || p.type !== 'line') return [p]
    const pieces: Line[] = []
    let from = 0
    for (const [t0, t1] of gaps.sort((m, n) => m[0] - n[0])) {
      if (t0 > from) pieces.push({ ...p, a: lerp(p, from), b: lerp(p, t0) })
      from = Math.max(from, t1)
    }
    if (from < 1) pieces.push({ ...p, a: lerp(p, from), b: p.b })
    return pieces
  })
}
const lerp = (l: Line, t: number): Point => [l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t]
/** Where two lines cross, clear of both their ends. */
function crossing(m: Line, n: Line): Point | undefined {
  const r: Point = [m.b[0] - m.a[0], m.b[1] - m.a[1]], s: Point = [n.b[0] - n.a[0], n.b[1] - n.a[1]], den = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(den) < 1e-9) return
  const q: Point = [n.a[0] - m.a[0], n.a[1] - m.a[1]], t = (q[0] * s[1] - q[1] * s[0]) / den, u = (q[0] * r[1] - q[1] * r[0]) / den
  const clear = (k: number, l: number) => k * l > 2 && (1 - k) * l > 2
  return clear(t, Math.hypot(...r)) && clear(u, Math.hypot(...s)) ? [m.a[0] + r[0] * t, m.a[1] + r[1] * t] : undefined
}
/** Width-to-height balance a narrow not-to-scale drawing is widened to, and the most its level pipe is stretched. */
const BALANCE = 0.8, STRETCH = 1.2
/** The largest clear rectangle of the model area, left of the BOM and above the notes. */
function openArea(viewport: Rect, exclusions: Rect[]): Rect {
  const [x0, y0, x1, y1] = viewport
  // Every bill-of-materials block hangs from the top border on the right.
  const right = exclusions.filter(e => e[1] <= y0 + 50 && e[0] > (x0 + x1) / 3).reduce((x, e) => Math.min(x, e[0]), x1)
  const top = exclusions.filter(e => e[0] <= x0 + 50 && e[1] <= y0 + 5).reduce((y, e) => Math.max(y, e[3]), y0)
  return [x0 + SIZE.tier, Math.max(y0 + SIZE.tier, top * 0.5 + y0 * 0.5), right - SIZE.tier, y1 - SIZE.tier]
}
