import type { Drawing, Point, Primitive, SheetFit } from '../drawing'
import { flangedJoints } from '../joints'
import { sheetMaterials } from '../material-list'
import { getNode, styleOf, type IsoDocument, type Vec3 } from '../model'
import { SIZE, type IsoContext, type RunGeometry } from './context'
import { drawDimensions } from './dimensions'
import { drawAnnotations } from './annotations'
import { layoutDirection, layoutSheet, tangles, untangle, viewProject, type Layout, type LegShape, type View } from './layout'
import { clipOutside, Placement, textPoly, type Rect } from './placement'
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
  const fit: SheetFit = model ? { centre: [0, 0], scale: 0.3 } : hold ? { ...hold, base } : schematic ? { ...fitOf(layout), base, ...shape } : fitOf(layout)
  const cx = model ? 550 : (fitArea[0] + fitArea[2]) / 2, cy = model ? 425 : (fitArea[1] + fitArea[3]) / 2
  const toSheet = (q: Point): Point => [(q[0] - fit.centre[0]) * fit.scale + cx, (q[1] - fit.centre[1]) * fit.scale + cy]
  const pos = new Map([...layout.raw].map(([id, p]) => [id, toSheet(p)] as [string, Point]))
  const project = (p: Vec3) => toSheet(layout.rawProject(p))
  const axis = (v: Vec3) => unit2(viewProject(v, facing, doc.north))
  const direction = (v: Vec3) => (schematic ? layoutDirection : viewProject)(v, facing, doc.north)
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
  // Thin drafting lines break around lettering, as drafted, so a dimension or leader never strikes through text.
  const lettering = ctx.out.flatMap(p => p.type === 'text' && p.layer !== 'SYMBOL' ? [textPoly(p.p, p.text, p.size, p.rotation, p.oblique, p.anchor, 1.2)] : [])
  const drawn = ctx.out.flatMap(p => {
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
