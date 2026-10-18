import { layerWeights, type Drawing, type DrawingNotice, type Point, type Primitive, type SheetFit } from '../drawing'
import { flangedJoints } from '../joints'
import { sheetMaterials } from '../material-list'
import { portPoint, styleOf, type IsoDocument, type PipeNode, type PipeRun, type Vec3 } from '../model'
import { draftingMemo, draftingSizes, forgetSearchHints, hintSearches, type DraftingSizes, type Found, type IsoContext, type LabelRecord, type RunGeometry } from './context'
import { drawDimensions } from './dimensions'
import { drawAnnotations } from './annotations'
import { layoutDirection, layoutMemo, layoutSheet, ON_PIPE, runDelta, straightAxis, tangles, untangle, viewDepth, viewDirection, viewProject, type Layout, type LegShape, type View } from './layout'
import { bbox, BoxIndex, clipOutside, overlaps, Placement, rectPoly, segmentPoly, textPoly, type Poly, type Rect, type SearchTrail } from './placement'
import { unit2, unit3 } from './plane'
import { drawPipes } from './symbols'
import { displaceHeld, hull, overprinting, paperLabels } from './declutter'
import { marginCallouts } from './margin'
import { squarePaper } from './square'
import { embedOnLattice, MIN_PAPER_CELL_IN, nearestPaperPoint, paperCell, paperLattice, type PaperLattice } from './lattice'
import { bestOpenRect, openRegions, standardScale, type SheetFrame, type SheetFrameFn, type SheetNumbering } from './sheet-frame'

export type { SheetFrame, SheetFrameFn } from './sheet-frame'

/** A sheet of a spool's drawing: its isometric (or view), or its material list on a sheet of its own. */
export type SheetKind = 'drawing' | 'materials'

/**
 * Model space: the true-scale view drawn without a sheet, on a page this size, at this many page units per model
 * millimetre, centred on the model's origin.
 */
export const MODEL_SPACE = { width: 1100, height: 850, scale: 0.3 } as const

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
  model = false,
  kind: SheetKind = 'drawing'
): Drawing {
  const spools = [...new Set(doc.runs.map(r => r.spool))]
  if (!spool && spools.length === 1) spool = spools[0]
  if (!model && frame && kind === 'materials') return materialsSheet(doc, spool, view, width, height, frame)
  const style = styleOf(doc), sizes = draftingSizes(doc)
  const facing: View = model ? 'iso' : view
  const runs = doc.runs.filter(r => !spool || r.spool === spool)
  const runIds = new Set(runs.map(r => r.id)), ends = new Set(runs.flatMap(r => [r.from, r.to]))
  const nodes = doc.nodes.filter(n => ends.has(n.id) || (!!n.associatedRunId && runIds.has(n.associatedRunId)))
  const nodeById = new Map(doc.nodes.map(n => [n.id, n])), runById = new Map(runs.map(r => [r.id, r]))
  const materials = rowsOf(doc, spool), joints = flangedJoints(doc, spool), drafted = draftingMemo()
  // Each pipe's own run, between the points its centreline meets its ends (an eccentric reducer offsets its small end).
  const deltas = new Map(runs.map(r => [r.id, runDelta(doc, r, id => nodeById.get(id)!)]))
  const ports = (r: PipeRun): [Vec3, Vec3] => [portPoint(doc, nodeById.get(r.from)!, r.id), portPoint(doc, nodeById.get(r.to)!, r.id)]
  const looking = viewDirection(facing, doc.north)
  // A material list that would crowd the drawing off its sheet has a sheet of its own (see `materialsApart`).
  const apart = !model && !!frame && materialsApart(doc, spool, width, height, frame)
  const numbering = !model && frame ? sheetNumbering(doc, spool, 'drawing', width, height, frame) : undefined
  const sheet: SheetFrame | null = model || !frame ? null
    : framed(frame, { doc, spool, width, height, rows: materials, view, ...(facing !== 'iso' ? { viewNote: looking.note } : {}),
      ...(apart ? { materials: 'apart' as const } : {}), ...(numbering ? { numbering } : {}) })
  const viewport: Rect = sheet?.viewport ?? [-1e6, -1e6, 1e6, 1e6]
  const exclusions = sheet?.exclusions ?? []
  const schematic = style.layout === 'schematic' && !model
  // Not to scale, a sheet is drafted on its paper's lattice: isometric paper, or square paper for a plan or elevation.
  // A drawing too large for the paper's cells is drafted on a whole subdivision of them (held with the fit).
  const cell = paperCell(doc, height), smallest = paperCell({ paper: doc.paper, style: { paperGrid: MIN_PAPER_CELL_IN } }, height)
  let lattice: PaperLattice | undefined = schematic && sheet ? paperLattice(facing, hold?.cell ?? cell) : undefined
  const estimate = sizes.tier + sizes.tierStep + 2 * sizes.text
  /**
   * The open paper less the room the annotations reach. Lettering keeps its size however small the picture is drawn,
   * so where it would take more than the paper has, its room is cut in proportion and the picture keeps a share of
   * the paper (crowded, and reported so) rather than vanishing or turning inside out.
   */
  const inset = (reach: Reach): Rect => insetBy(open, reach)
  const notices: DrawingNotice[] = []

  let base = hold?.base ?? 1
  const shape: LegShape = { stretch: hold?.stretch ?? style.stretch ?? 0, legs: hold?.legs ?? {} }
  const memo = layoutMemo(), lay = (b: number) => layoutSheet(doc, runs, nodes, facing, schematic, b, shape, memo)
  // Laying the sheet out depends on the drawing's pipes and the sheet it is drawn on, not on its lettering: what an
  // earlier drawing of the same layout found is used again, so moving a label or retitling the sheet does not lay it out
  // anew. `state` names the layout reached so far (the fill it came from), which every later step starts from.
  const cache = layoutCache(doc, spool, [view, width, height, model, !!frame, hold ?? null, sheet?.paper?.unitsPerMm ?? null, cell, smallest])
  let state = 'start'
  let layout = cache.start ??= lay(base)
  // The picture fits the frame's open paper (clear of the BOM, notes and north symbol): of its open rectangles, the
  // one that holds the drawing's own proportions largest, with room around the drawing for its dimensions and
  // callouts (first as two tiers of dimensions and their lettering, then as the drawing is seen to reach).
  // The annotations' room does not grow with the picture, so each rectangle is judged by the picture it holds inside
  // that room: a wide, flat plan goes where it is drawn largest with room above and below it, not into a strip only
  // as tall as its lettering.
  const laidOut = boundsOf(layout.raw.values())
  let open: Rect = !sheet ? [0, 0, width, height] : openFor(sheet.regions?.free ?? openRegions(viewport, exclusions).free, laidOut, estimate) ?? sheet.regions?.open ?? viewport
  let reach: Reach = [estimate, estimate, estimate, estimate]
  /** Lays the sheet out to fill an area at full size: the largest base that fits, with tangled legs drawn apart. */
  // Filling depends only on the area and the leg shape it starts from, so a fill asked for again is the one found.
  const fills = cache.fills
  /** Whether the layout reached is too large for `area` at full size (and is drawn smaller, crowded). */
  const oversize = (area: Rect) => { const b = boundsOf(layout.raw.values()); return b[2] - b[0] > area[2] - area[0] + FIT_TOLERANCE || b[3] - b[1] > area[3] - area[1] + FIT_TOLERANCE }
  const fill = (area: Rect) => {
    const key = JSON.stringify([area, shape])
    state = key
    const known = fills.get(key)
    if (known) { base = known.base; layout = known.layout; shape.legs = { ...known.legs }; return }
    ;({ base, layout } = solveBase(lay, area))
    // Straights that would cross or run into each other are drawn longer or shorter until they clear (on isometric
    // paper; a plan or elevation shows pipes on one another truthfully). Refitting the sheet changes every pipe's
    // length, so the legs are checked again at the new fit.
    // A layout that cannot be drawn at full size at all is crowded whatever its legs: it is untangled once, briefly.
    for (let round = 0, rounds = 3; facing === 'iso' && round < rounds && tangles(doc, layout).length; round++) {
      const crowded = oversize(area)
      if (crowded) rounds = 1
      // Briefly from the legs as laid out, so the legs found depend on the area alone, as a full untangling's do.
      shape.legs = crowded ? untangle(doc, runs, nodes, facing, base, { ...shape, legs: {} }, CROWDED_UNTANGLE, memo) : untangle(doc, runs, nodes, facing, base, shape, undefined, memo)
      ;({ base, layout } = solveBase(lay, area))
    }
    fills.set(key, { base, layout, legs: { ...shape.legs } })
  }
  const fitOf = (area: Rect): SheetFit => {
    if (model) return { centre: [0, 0], scale: MODEL_SPACE.scale, at: [width / 2, height / 2] }
    const [x0, y0, x1, y1] = boundsOf(layout.raw.values()), w = area[2] - area[0], h = area[3] - area[1]
    const fits = Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0))
    // Not to scale the layout is drawn at full size (its room is sheet room), smaller only if it cannot fit (to
    // within the hundredth of a unit `solveBase` fits it to).
    const full = x1 - x0 <= w + FIT_TOLERANCE && y1 - y0 <= h + FIT_TOLERANCE
    // To scale on a sheet, the largest standard scale that fits (1:20, 1/2" = 1'-0"), so the sheet can say so.
    const perMm = sheet?.paper?.unitsPerMm ?? sizes.mm
    const standard = sheet && Number.isFinite(fits) && fits > 0 ? perMm / standardScale(fits / perMm, doc.units) : fits
    const scale = !layout.raw.size ? 1 : schematic ? full ? 1 : fits : standard
    return { centre: [(x0 + x1) / 2, (y0 + y1) / 2], scale, at: [(area[0] + area[2]) / 2, (area[1] + area[3]) / 2], ...(schematic ? { base, ...shape } : {}) }
  }
  const axis = (v: Vec3) => unit2(viewProject(v, facing, doc.north))
  const direction = (v: Vec3) => (schematic ? layoutDirection : viewProject)(v, facing, doc.north)
  const pins = !model && facing === 'iso' ? doc.sheets?.[spool]?.nodePositions : undefined
  // With every node held the drafter has placed the whole drawing: the layout only gives its pipes' directions, so it
  // is neither filled to the sheet nor fitted again.
  const placedByHand = !!pins && nodes.every(n => pins[n.id])

  /**
   * Where every node is drawn for a fit, as found for the same layout and lattice before when it was. Its notices are
   * the caller's own to add to; its projection reads the layout as it is when used.
   */
  const placeNodes = (fit: SheetFit): Placed => {
    const key = JSON.stringify([fit, state, lattice?.cell ?? null])
    let known = cache.placed.get(key)
    if (!known) cache.placed.set(key, known = placeAnew(fit))
    return placedFrom(known)
  }
  /**
   * A placement found before, for this drawing: its pipes' geometry is of this drawing's runs. Its positions are a
   * copy, so nothing this drawing (or whoever reads it) does with them reaches the next drawing.
   */
  const placedFrom = (known: PlacedNodes): Placed => {
    const pos = new Map([...known.pos].map(([id, p]) => [id, [p[0], p[1]] as Point])), geometry = new Map<string, RunGeometry>()
    for (const run of runs) {
      const a = pos.get(run.from), b = pos.get(run.to)
      if (!a || !b) continue
      const d: Point = [b[0] - a[0], b[1] - a[1]], length = Math.hypot(...d)
      geometry.set(run.id, { run, a, b, dir: length ? [d[0] / length, d[1] / length] : [1, 0], length, dir3: unit3(deltas.get(run.id)!) })
    }
    return { pos, toSheet: known.toSheet, notices: [...known.notices], geometry, project: projector(pos, known.toSheet) }
  }
  /** Where every node is drawn for a fit: the layout on the sheet, held positions squared up, then on the lattice. */
  const placeAnew = (fit: SheetFit) => {
    const at = fit.at ?? [width / 2, height / 2]
    const toSheet = (q: Point): Point => [(q[0] - fit.centre[0]) * fit.scale + at[0], (q[1] - fit.centre[1]) * fit.scale + at[1]]
    const pos = new Map([...layout.raw].map(([id, p]) => [id, toSheet(p)] as [string, Point]))
    const automatic = new Map(pos), found: DrawingNotice[] = []
    for (const [id, p] of Object.entries(pins ?? {})) if (pos.has(id)) pos.set(id, [...p])
    if (pins) {
      // Held ends are rebuilt along true isometric directions; components held on a pipe go back onto it.
      const hosts = new Map<string, PipeRun>()
      for (const node of nodes) {
        const run = node.associatedRunId && pins[node.id] ? runById.get(node.associatedRunId) : undefined
        if (run) hosts.set(node.id, run)
      }
      const square = squarePaper(runs, automatic, pos, r => straightAxis(deltas.get(r.id)!) != null, new Set(Object.keys(pins).filter(id => pos.has(id))), hosts)
      for (const [id, p] of square.positions) pos.set(id, p)
      for (const id of square.folded) found.push({ kind: 'held-folded', node: id, message: 'A held end would fold its pipe back on itself; the pipe is drawn at its laid-out length.' })
      for (const node of nodes) {
        if (!node.associatedRunId || pins[node.id]) continue
        const run = runById.get(node.associatedRunId)
        if (!run) continue
        const a = nodeById.get(run.from)!.position, b = nodeById.get(run.to)!.position, d = b.map((v, i) => v - a[i])
        const squared = d.reduce((s, v) => s + v * v, 0), t = squared ? d.reduce((s, v, i) => s + v * (node.position[i] - a[i]), 0) / squared : 0
        const from = pos.get(run.from)!, to = pos.get(run.to)!, oldFrom = automatic.get(run.from)!, oldTo = automatic.get(run.to)!, old = automatic.get(node.id)!
        pos.set(node.id, [0, 1].map(i => from[i] + (to[i] - from[i]) * t + old[i] - oldFrom[i] - (oldTo[i] - oldFrom[i]) * t) as Point)
      }
    }
    if (lattice) {
      const embedded = embedOnLattice({ runs, nodes, desired: pos, lattice, north: doc.north, runDelta: r => deltas.get(r.id)! })
      for (const [id, p] of embedded.positions) pos.set(id, p)
      for (const n of embedded.notices) found.push({ kind: `lattice-${n.kind}`, ...(n.id ? { node: n.id } : {}), message: n.message })
    }
    return { pos, toSheet, notices: found }
  }
  /**
   * A model point on the sheet. Nodes and points on a pipe are found through an index (a point within half a
   * millimetre of a pipe's centreline is on it) and drawn where the drawing puts them; a point off the network sits
   * beside the nearest node as the layout draws its surroundings.
   */
  const projector = (pos: Map<string, Point>, toSheet: (q: Point) => Point) => {
    const direct = (p: Vec3) => toSheet(layout.rawProject(p))
    if ((!pins && !lattice) || !nodes.length) return direct
    const cellOf = (v: number, size: number) => Math.floor(v / size)
    const NODE = 0.001, near = new Map<string, PipeNode[]>()
    for (const n of nodes) {
      const key = n.position.map(v => cellOf(v, NODE)).join()
      near.set(key, [...(near.get(key) ?? []), n])
    }
    // Straight pipes by the two coordinates they keep; rolling offsets in a list.
    const lines = new Map<string, PipeRun[]>(), offsets: PipeRun[] = []
    const ends = ports
    const lineKey = (k: number, p: Vec3, dx = 0, dy = 0) => { const [i, j] = [0, 1, 2].filter(x => x !== k); return `${k}:${cellOf(p[i], ON_PIPE) + dx},${cellOf(p[j], ON_PIPE) + dy}` }
    for (const r of runs) {
      const [a] = ends(r), k = straightAxis(deltas.get(r.id)!)
      if (k == null) { offsets.push(r); continue }
      const key = lineKey(k, a)
      lines.set(key, [...(lines.get(key) ?? []), r])
    }
    const onRun = (r: PipeRun, p: Vec3): Point | undefined => {
      const [a, b] = ends(r), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
      if (len2 < 1e-12) return undefined
      const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2
      if (t < -1e-9 || t > 1 + 1e-9) return undefined
      if (Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t, p[2] - a[2] - d[2] * t) > ON_PIPE) return undefined
      const from = pos.get(r.from)!, to = pos.get(r.to)!
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
    }
    return (p: Vec3): Point => {
      const c = p.map(v => cellOf(v, NODE))
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
        for (const n of near.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? [])
          if (Math.hypot(n.position[0] - p[0], n.position[1] - p[1], n.position[2] - p[2]) < NODE && pos.has(n.id)) return pos.get(n.id)!
      for (const k of [0, 1, 2]) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
        for (const r of lines.get(lineKey(k, p, dx, dy)) ?? []) { const q = onRun(r, p); if (q) return q }
      for (const r of offsets) { const q = onRun(r, p); if (q) return q }
      let nearest: PipeNode | undefined, gap = Infinity
      for (const n of nodes) {
        const d = Math.hypot(n.position[0] - p[0], n.position[1] - p[1], n.position[2] - p[2])
        if (d < gap && pos.has(n.id)) { gap = d; nearest = n }
      }
      if (!nearest) return direct(p)
      const old = direct(p), before = direct(nearest.position), after = pos.get(nearest.id)!
      return [old[0] + after[0] - before[0], old[1] + after[1] - before[1]]
    }
  }

  const paint = (placed: ReturnType<typeof placeNodes>) => {
    // Every label is placed in turn, clear of what is drawn so far. One that still lands on other lettering (on a label
    // drawn after it, or a label the drafter placed) is placed again with the room of every label already clear kept
    // for it, searching further out. A held callout that overprints is drawn at the nearest clear spot to where it is
    // held (the drawing keeps the held point). The attempt with the fewest overprints is kept, so a clean sheet is
    // drawn once.
    let ctx = attempt(placed), clashes = clashing(ctx), shifted = new Map<string, Point>()
    // Where most labels overprint, the sheet has no clear room to move them into: it is drawn once, crowded.
    for (let round = 0, retry = new Set<string>(); round < 4 && !heap(ctx, clashes); round++) {
      const automatic = new Set([...clashes.keys()].map(key => root(ctx, key)).filter(key => ctx.labels!.get(key)?.automatic))
      const moves = displaceHeld(ctx.out, ctx.labels!, ctx.place, clashes, automatic)
      if ((!automatic.size || [...automatic].every(key => retry.has(key))) && !moves.size) break
      // Held labels move clear first; automatic labels they were on are placed again only if still in the way after.
      if (!moves.size) for (const key of automatic) retry.add(key)
      const next = new Map(shifted)
      for (const [key, d] of moves) { const at = ctx.labels!.get(key)!.at!; next.set(key, [at[0] + d[0], at[1] + d[1]]) }
      const reserved = [...ctx.labels!.values()].filter(r => r.points.length && !retry.has(r.key) && !(r.parent && !r.held)).map(r => {
        const d = moves.get(r.key) ?? [0, 0]
        return { key: r.key, poly: hull(r.points).map(p => [p[0] + d[0], p[1] + d[1]] as Point) }
      })
      // With no automatic label to place again, nothing needs room kept: labels drawn before a moved one are drawn as
      // they were (it moved clear of them) and those after it see it, so holding the drawn spots reproduces this sheet.
      // Labels that are not placed again stay where they were found, unless something near them changes: where the
      // labels placed again were, and where the moved ones were and go.
      const again = retry.size ? retry : automatic, last = ctx
      const pinned = new Map([...last.found!].filter(([key]) => !again.has(root(last, key))))
      const changed = [...last.labels!.values()].flatMap(r => {
        const d = moves.get(r.key)
        return again.has(r.key) ? [coverOf(r)] : d ? [coverOf(r), coverOf(r, d)] : []
      })
      const tried = attempt(placed, retry.size ? reserved : undefined, retry.size ? new Set(retry) : undefined, next, { pinned, changed, labels: last.labels! }), now = clashing(tried)
      if (now.size >= clashes.size) break
      ctx = tried; clashes = now; shifted = next
    }
    for (const key of shifted.keys()) { const r = ctx.labels!.get(key); if (r) r.displaced = true }
    ctx.clashes = clashes
    return ctx
  }
  /** Whether most of a sheet's labels overprint: crowded past what placing them again can clear. */
  const heap = (ctx: IsoContext, clashes: Map<string, unknown>) => clashes.size * 2 > ctx.labels!.size
  /** The automatic callout a label is drawn with, while it has not been moved on its own. */
  const root = (ctx: IsoContext, key: string) => {
    let record = ctx.labels!.get(key)
    // A callout is never drawn inside its own line, but a chain is followed no further than there are labels.
    for (let up = ctx.labels!.size; up > 0 && record && !record.held && record.parent && ctx.labels!.has(record.parent); up--) record = ctx.labels!.get(record.parent)!
    return record?.key ?? key
  }
  /** The sheet's held label positions, with those drawn clear of an overprint where they are drawn. */
  const held = (shifted?: Map<string, Point>) => {
    const positions = doc.sheets?.[spool]?.labelPositions
    return positions && shifted?.size ? { ...positions, ...Object.fromEntries(shifted) } : positions
  }
  const clashing = (ctx: IsoContext) => overprinting(ctx.out, ctx.labels!, ctx.place)
  const trails = sheetTrails(JSON.stringify([spool, facing, width, height, model, !!frame]))
  let attempts = 0
  /**
   * One drawing of the sheet's pipes, dimensions and labels. `last` is the attempt it follows: where its labels were
   * found, those to be found again where they were, and the areas that change.
   */
  const attempt = (placed: ReturnType<typeof placeNodes>, reserved?: IsoContext['reserved'], retry?: Set<string>, shifted?: Map<string, Point>,
    last?: { pinned: Map<string, Found>; changed: Rect[]; labels: Map<string, LabelRecord> }) => {
    const { pos, project, geometry } = placed
    const ctx: IsoContext = {
      doc, spool, view: facing, style, schematic, runs, nodes, pos, project, axis, direction, geometry, size: sizes,
      labelPositions: !model && facing === 'iso' ? held(shifted) : undefined,
      heldPositions: !model && facing === 'iso' ? doc.sheets?.[spool]?.labelPositions : undefined,
      paperPositions: pins,
      place: new Placement(viewport, exclusions), materials, joints, extent: new Map(), out: [],
      labels: new Map(), reserved, retry, found: new Map(), memo: drafted, effort: { searches: 0, failed: 0 }, ...(last ? { pinned: last.pinned, changed: [...last.changed] } : {})
    }
    // Each attempt compares its placement with the same attempt of the drawing before on this sheet, so labels whose
    // surroundings are unchanged are found where they were without searching.
    const attemptNumber = attempts++
    ctx.place.follow(trails[attemptNumber])
    // Free notes stay where the drafter put them, so every label is placed clear of them.
    for (const note of doc.sheetNotes ?? [])
      if (note.spool === spool || !spool) ctx.place.add(textPoly(note.at, note.text.toUpperCase(), note.size ?? sizes.text, note.rotation, note.oblique, 'start', 1), 'text', note.id)
    drawPipes(ctx)
    drawDimensions(ctx)
    // Dimension lettering drawn elsewhere than last time changes what the labels around it see.
    if (last) for (const r of ctx.labels!.values()) {
      const was = last.labels.get(r.key), now = coverOf(r)
      if (!was) { ctx.changed!.push(now); continue }
      const before = coverOf(was)
      if (now.some((v, i) => v !== before[i])) ctx.changed!.push(now, before)
    }
    ctx.annotating = true
    drawAnnotations(ctx)
    ctx.annotating = false
    trails[attemptNumber] = ctx.place.trail()
    return ctx
  }
  /**
   * The fit that fills an area. On the lattice the drawing can come out larger than its layout (whole cells, legs a
   * cell apart, offsets in a lattice direction), so it is laid out again for an area smaller by what it outgrew, and
   * moved by whole cells to the middle of the area. One that still does not fit is drafted on halves of the paper's
   * cells, then thirds, and so on, while they are no finer than the finest paper a drawing may choose.
   */
  const fitAnew = (area: Rect) => {
    const free = !hold && !pins && runs.length > 0
    const once = () => {
      // Whole cells move each end by up to half a cell, so the drawing fits its area to within a cell.
      const excess = (placed: ReturnType<typeof placeNodes>) => {
        const box = boundsOf(placed.pos.values())
        return [box[2] - box[0] - (area[2] - area[0]), box[3] - box[1] - (area[3] - area[1])]
      }
      const fits = (e: number[]) => !lattice || (e[0] <= lattice.cell + 1e-9 && e[1] <= lattice.cell + 1e-9)
      // A layout too large for the area at full size is crowded in any part of it: the largest part is not searched for.
      const crowded = schematic && oversize(area)
      let fit = fitOf(area), placed = placeNodes(fit), e = excess(placed), last = Infinity
      // The last area laid out for that the lattice drawing outgrew, and the one it fits.
      let over: Rect | undefined = fits(e) ? undefined : area, under: Rect | undefined
      for (let i = 0; free && lattice && i < 4 && !fits(e); i++) {
        // Laid out again for an area smaller by what the lattice added; no use once it stops getting smaller.
        const worst = Math.max(...e)
        if (worst >= last - 1e-9) break
        last = worst
        const laid = boundsOf(layout.raw.values()), box = boundsOf(placed.pos.values())
        const grow = [box[2] - box[0] - (laid[2] - laid[0]) * fit.scale, box[3] - box[1] - (laid[3] - laid[1]) * fit.scale]
        const cx = (area[0] + area[2]) / 2, cy = (area[1] + area[3]) / 2
        const tw = Math.max(1, area[2] - area[0] - Math.max(0, grow[0])) / 2, th = Math.max(1, area[3] - area[1] - Math.max(0, grow[1])) / 2
        const target: Rect = [cx - tw, cy - th, cx + tw, cy + th]
        if (schematic) fill(target)
        fit = { ...fitOf(target), at: fit.at }
        placed = placeNodes(fit)
        e = excess(placed)
        if (fits(e)) under = target
        else over = target
      }
      // What the lattice adds does not shrink with the layout (whole cells, a cell between legs, the room symbols
      // take), so an area smaller by all of it can leave the drawing far smaller than its area, or squeezed below
      // full size: the largest area between the one it fits and the one it outgrew is found by halving the gap.
      for (let i = 0; schematic && !crowded && over && under && i < 4; i++) {
        const mid = over.map((v, k) => (v + under![k]) / 2) as Rect
        fill(mid)
        const f = { ...fitOf(mid), at: fit.at }, p = placeNodes(f), m = excess(p)
        if (fits(m)) { under = mid; fit = f; placed = p; e = m }
        else over = mid
      }
      if (under && schematic) fill(under)
      if (free && lattice) {
        // Centred by a whole lattice step, so every point stays on the lattice.
        const box = boundsOf(placed.pos.values()), centre: Point = [(area[0] + area[2]) / 2, (area[1] + area[3]) / 2]
        const move = nearestPaperPoint([centre[0] - (box[0] + box[2]) / 2, centre[1] - (box[1] + box[3]) / 2], lattice)
        if (move[0] || move[1]) { fit = { ...fit, at: [fit.at![0] + move[0], fit.at![1] + move[1]] }; placed = placeNodes(fit) }
      }
      return { fit, placed, fits: fits(e) }
    }
    for (let k = 1; ; k++) {
      if (lattice) lattice = paperLattice(facing, cell / k)
      const result = once()
      if (!lattice || !free || result.fits || cell / (k + 1) < smallest - 1e-9) {
        if (lattice && k > 1) {
          result.fit = { ...result.fit, cell: lattice.cell }
          result.placed.notices.push({ kind: 'lattice-subdivided', message: `The drawing is too large for its sheet on the paper's cells; it is drafted on 1/${k} cells.` })
        }
        return result
      }
      if (schematic) fill(area)
    }
  }
  /** The fit that fills an area from the layout reached, as found before for the same, with the layout it ends on. */
  const fitTo = (area: Rect): { fit: SheetFit; placed: Placed; fits: boolean } => {
    const key = JSON.stringify([area, state, !!lattice])
    let known = cache.fits.get(key)
    if (!known) {
      const { fit, placed, fits } = fitAnew(area)
      cache.fits.set(key, known = { fit, placed: { pos: placed.pos, toSheet: placed.toSheet, notices: [...placed.notices] }, fits, base, layout, legs: { ...shape.legs }, lattice, state })
    }
    ;({ base, layout, lattice, state } = known)
    shape.legs = { ...known.legs }
    return { fit: known.fit, fits: known.fits, placed: placedFrom(known.placed) }
  }
  let fit!: SheetFit, placed!: ReturnType<typeof placeNodes>, ctx!: IsoContext
  const fitSheet = () => {
    if (schematic && hold?.base == null && runs.length && !placedByHand) fill(inset(reach))
    if (hold) { fit = { ...hold, base, at: hold.at ?? fitOf(inset(reach)).at }; placed = placeNodes(fit) }
    else ({ fit, placed } = fitTo(inset(reach)))
    ctx = paint(placed)
    // The picture keeps off the north symbol, bill of materials and notes, and inside the frame: when its
    // constructions reach them, it is fitted again with the room they were seen to take.
    // A heap of labels reaches wherever it is fitted, so it is not fitted again for them.
    for (let i = 0; i < 2 && sheet && !hold && !placedByHand && runs.length && !heap(ctx, ctx.clashes!) && intrudes(ctx.out, viewport, exclusions); i++) {
      const seen = reachOf(ctx, placed.pos, sizes)
      // Fitted again only for more room than it had: the same room draws the same sheet.
      if (seen.every((r, k) => r <= reach[k] + 1e-9)) break
      reach = seen.map((r, k) => Math.max(r, reach[k])) as Reach
      if (schematic) fill(inset(reach))
      ;({ fit, placed } = fitTo(inset(reach)))
      ctx = paint(placed)
    }
  }
  // A drawing whose material list has a sheet of its own has the whole frame: it is fitted to all of it, centred, its
  // lettering placed clear of the heading and north arrow left in the corners. Only where its linework would then run
  // into them is it fitted to the largest open rectangle beside them instead.
  if (apart && sheet && !hold && !placedByHand && runs.length && exclusions.length) {
    const beside = open
    open = viewport
    fitSheet()
    if (intrudes(ctx.out, [-Infinity, -Infinity, Infinity, Infinity], exclusions)) {
      open = beside
      reach = [estimate, estimate, estimate, estimate]
      base = 1; shape.legs = {}; state = 'start'; layout = cache.start!
      fitSheet()
    }
  } else fitSheet()
  // No issued sheet overprints its lettering: what still does is drawn in the margin, or left off and reported.
  if (sheet) {
    const margin = marginCallouts(ctx, viewport, exclusions)
    // Only labels that overprinted before can still: the margin callouts were set on clear paper.
    if (margin.changed) { ctx.clashes = overprinting(ctx.out, ctx.labels!, ctx.place, ctx.clashes!.keys()); notices.push(...margin.notices) }
  }
  if (schematic && !placedByHand && fit.scale < 1 - 1e-9) notices.push({ kind: 'crowded', message: 'The drawing does not fit its sheet at full size: its pipe is drawn shorter, and its symbols and lettering, kept at their size, crowd.' })
  notices.push(...placed.notices)
  const pos = ctx.pos, project = ctx.project
  // Thin drafting lines break around lettering, as drafted, so a dimension or leader never strikes through text.
  // Indexed, so each line is broken only by the lettering near it, in drawing order.
  const lettering = new BoxIndex<{ poly: Poly; box: Rect; order: number }>()
  for (const p of ctx.out) if (p.type === 'text' && p.layer !== 'SYMBOL') {
    const poly = textPoly(p.p, p.text, p.size, p.rotation, p.oblique, p.anchor, 1.2)
    lettering.add({ poly, box: bbox(poly), order: lettering.items.length })
  }
  const drawn = crossingGaps(ctx, sizes).flatMap(p => {
    if (p.type !== 'line' || !['DIM', 'LEADER', 'HATCH'].includes(p.layer)) return [p]
    // Lettering that only touches the line still breaks it, so the search reaches a hair past it.
    const [x0, y0, x1, y1] = bbox([p.a, p.b]), near = lettering.near([x0 - 1e-6, y0 - 1e-6, x1 + 1e-6, y1 + 1e-6]).sort((m, n) => m.order - n.order)
    if (!near.length) return [p]
    let pieces: Array<[Point, Point]> = [[p.a, p.b]]
    for (const { poly } of near) pieces = pieces.flatMap(([a, b]) => clipOutside(a, b, poly))
    return pieces.map(([a, b]) => ({ ...p, a, b }))
  })
  // Lettering that depends on the fit (a to-scale sheet's ratio) is drawn with the frame once fitted.
  const finished = sheet?.finish?.(!schematic ? { scale: fit.scale / (sheet.paper?.unitsPerMm ?? sizes.mm) } : {}) ?? []
  const primitives = [...(sheet?.primitives ?? []), ...finished, ...drawn]
  primitives.sort((a, b) => Number(a.type === 'text') - Number(b.type === 'text'))
  return {
    width,
    height,
    area: model ? [0, 0, width, height] : viewport,
    // A copy: the fit may be one kept for later drawings of the same layout.
    fit: { ...fit, centre: [...fit.centre], ...(fit.at ? { at: [...fit.at] as Point } : {}), ...(fit.legs ? { legs: { ...fit.legs } } : {}) },
    primitives,
    positions: pos,
    project,
    view: facing,
    lettering: style.lettering,
    labels: paperLabels(ctx.labels!, ctx.clashes ?? new Map()),
    ...(lattice ? { lattice } : {}),
    viewNote: looking.note,
    weights: layerWeights(doc),
    ...(notices.length ? { notices } : {})
  }
}

/**
 * Of the open rectangles, the one that holds the picture (laid out `laid`) largest once `margin` is kept clear round
 * it for its dimensions and callouts; without one that has room for the margin, the one holding the picture and its
 * margin at the largest size.
 */
export function openFor(free: Rect[], laid: Rect, margin: number): Rect | undefined {
  const w = Math.max(1e-6, laid[2] - laid[0]), h = Math.max(1e-6, laid[3] - laid[1])
  const inner = free.map((r): Rect => [r[0] + margin, r[1] + margin, r[2] - margin, r[3] - margin]).filter(r => r[2] > r[0] && r[3] > r[1])
  const best = bestOpenRect(inner, w / h)
  if (best) return [best[0] - margin, best[1] - margin, best[2] + margin, best[3] + margin]
  return bestOpenRect(free, (w + 2 * margin) / (h + 2 * margin))
}
/** The sheet area a label covers, its lettering and boxes and its leader, moved by `d`. */
function coverOf(r: LabelRecord, d: Point = [0, 0]): Rect {
  const points = [...r.points, ...(r.leader ? [r.leader.from, r.leader.to, ...(r.leader.bend ? [r.leader.bend] : [])] : [])]
  if (!points.length) return [0, 0, 0, 0]
  const [x0, y0, x1, y1] = bbox(points)
  return [x0 + d[0], y0 + d[1], x1 + d[0], y1 + d[1]]
}
/** Where a layout's nodes are drawn for a fit, with the sheet transform and the projection of model points. */
interface Placed {
  pos: Map<string, Point>
  toSheet: (q: Point) => Point
  project: (p: Vec3) => Point
  geometry: Map<string, RunGeometry>
  notices: DrawingNotice[]
}
/** Where a layout's nodes are drawn, as kept between drawings: positions by node id, nothing of one drawing's own. */
type PlacedNodes = Pick<Placed, 'pos' | 'toSheet' | 'notices'>
/** Layouts found for one drawing's layout, kept for the next drawing of it. */
interface LayoutCache {
  start?: Layout
  fills: Map<string, { base: number; layout: Layout; legs: Record<string, number> }>
  placed: Map<string, PlacedNodes>
  fits: Map<string, { fit: SheetFit; placed: PlacedNodes; fits: boolean; base: number; layout: Layout; legs: Record<string, number>; lattice: PaperLattice | undefined; state: string }>
}
const layoutCaches = new Map<string, LayoutCache>()
let laidAnew = 0
/** How many drawings so far had to lay their sheet out anew, rather than use a layout an earlier drawing found. */
export const layoutsLaidAnew = () => laidAnew
/** Layouts kept, by drawing layout; and steps kept for one, past which it starts over. */
const LAYOUTS_KEPT = 4, STEPS_KEPT = 96
/**
 * The layouts found for a drawing's layout: what laying a sheet out reads of the drawing (its pipes, components,
 * specifications, units, style, paper and held node positions) and of the sheet it is drawn on. Its lettering, title
 * block, notes, held label positions and material-table settings are not read, so changing them keeps the layouts.
 */
function layoutCache(doc: IsoDocument, spool: string, sheet: unknown[]): LayoutCache {
  if (!reusing) return { fills: new Map(), placed: new Map(), fits: new Map() }
  const key = JSON.stringify([sharedContent(doc), doc.runs, doc.nodes, spool, doc.sheets?.[spool]?.nodePositions ?? null, sheet])
  let cache = layoutCaches.get(key)
  if (cache) layoutCaches.delete(key)
  else { cache = { fills: new Map(), placed: new Map(), fits: new Map() }; laidAnew++ }
  for (const m of [cache.fills, cache.placed, cache.fits] as Array<Map<string, unknown>>) if (m.size > STEPS_KEPT) m.clear()
  layoutCaches.set(key, cache)
  if (layoutCaches.size > LAYOUTS_KEPT) layoutCaches.delete(layoutCaches.keys().next().value!)
  return cache
}
const searchTrails = new Map<string, SearchTrail[]>()
/** Sheets whose label searches are kept for the next drawing of them. */
const SHEETS_KEPT = 2
/** The label searches of the last drawing of a sheet (by spool, view and size), attempt by attempt, kept for the next. */
function sheetTrails(sheet: string): SearchTrail[] {
  if (!reusing) return []
  const trails = searchTrails.get(sheet) ?? []
  searchTrails.delete(sheet)
  searchTrails.set(sheet, trails)
  if (searchTrails.size > SHEETS_KEPT) searchTrails.delete(searchTrails.keys().next().value!)
  return trails
}
/**
 * Forgets everything kept from earlier drawings: layouts, label searches, material-list decisions and where labels
 * were found (for a drawing drawn from nothing). A drawing never depends on what was kept: drawn after any other
 * drawings, in any order, it is the drawing drawn from nothing, only sooner.
 */
export function forgetEarlierDrawings() {
  layoutCaches.clear()
  apartKnown.clear()
  searchTrails.clear()
  forgetSearchHints()
}
let reusing = true
/**
 * Whether drawings use what earlier drawings found (on, as they always are but to check that they need not): off,
 * every drawing is worked out from nothing, keeping nothing for the next.
 */
export function reuseEarlierDrawings(on: boolean) {
  reusing = on
  hintSearches(on)
  if (!on) forgetEarlierDrawings()
}
/**
 * What one drawing pass works out more than once (a spool's material rows, a sheet frame), kept for the pass: the
 * document is only read while it lasts (see `drawingPass`).
 */
let pass: { doc: IsoDocument; rows: Map<string, ReturnType<typeof sheetMaterials>>; frames: Map<string, SheetFrame>; apart: Map<string, boolean>; shared?: string } | undefined
/**
 * Runs `work` as one drawing pass of `doc` (passes of the same document nest), so what it asks for again is worked out
 * once. What a pass keeps is of its document alone: a drawing of another document made inside it has a pass of its own.
 */
export function drawingPass<T>(doc: IsoDocument, work: () => T): T {
  if (pass?.doc === doc) return work()
  const outer = pass
  pass = { doc, rows: new Map(), frames: new Map(), apart: new Map() }
  try { return work() } finally { pass = outer }
}
/** The pass kept for this document, if one is running. */
const passOf = (doc: IsoDocument) => pass?.doc === doc ? pass : undefined
const rowsOf = (doc: IsoDocument, spool: string) => {
  const kept = passOf(doc)
  let rows = kept?.rows.get(spool)
  if (!rows) { rows = sheetMaterials(doc, spool); kept?.rows.set(spool, rows) }
  return rows
}
function framed(frame: SheetFrameFn, input: Parameters<SheetFrameFn>[0]): SheetFrame {
  const pass = passOf(input.doc)
  if (!pass) return frame(input)
  const { doc, rows, ...rest } = input
  void doc
  const key = JSON.stringify([frameId(frame), rest, rows === pass.rows.get(input.spool) ? null : rows])
  let known = pass.frames.get(key)
  if (!known) pass.frames.set(key, known = frame(input))
  return known
}

/** The open paper `open` less the room `reach` its annotations take, cut in proportion where they would take most of it. */
function insetBy(open: Rect, reach: Reach): Rect {
  const across = (lo: number, hi: number, size: number) => { const k = Math.min(1, (1 - MIN_PICTURE) * size / Math.max(1e-9, lo + hi)); return [lo * k, hi * k] }
  const [l, r] = across(reach[0], reach[2], open[2] - open[0]), [t, b] = across(reach[1], reach[3], open[3] - open[1])
  return [open[0] + l, open[1] + t, open[2] - r, open[3] - b]
}

/**
 * A spool's material list on a sheet of its own, after its drawing: the same frame and title block, the list given
 * the whole of the frame, and no model.
 */
function materialsSheet(doc: IsoDocument, spool: string, view: View, width: number, height: number, frame: SheetFrameFn): Drawing {
  const numbering = sheetNumbering(doc, spool, 'materials', width, height, frame)
  const sheet = framed(frame, { doc, spool, width, height, rows: rowsOf(doc, spool), view, materials: 'only', ...(numbering ? { numbering } : {}) })
  const primitives = [...sheet.primitives, ...sheet.finish({})]
  primitives.sort((a, b) => Number(a.type === 'text') - Number(b.type === 'text'))
  const v = sheet.viewport, at: Point = [(v[0] + v[2]) / 2, (v[1] + v[3]) / 2]
  return {
    width, height, area: [...v], fit: { centre: [0, 0], scale: 1, at }, primitives, positions: new Map(), project: () => [...at] as Point,
    view, lettering: styleOf(doc).lettering, labels: [], viewNote: 'MATERIAL LIST', weights: layerWeights(doc)
  }
}

/**
 * Whether a spool's material list is printed on a sheet of its own rather than beside its drawing (style
 * `materialList`). Automatically ('auto', the default) only on a not-to-scale sheet whose drawing, laid out in the
 * paper the list leaves it, cannot be drawn at full size (its pipe would be drawn shorter and its lettering crowd)
 * and has clearly more room without the list. Worked out from the sheet frame and the drawing's layout alone (no
 * labels), and kept by what it reads of the spool, so numbering every sheet of a set stays quick.
 */
export function materialsApart(doc: IsoDocument, spool: string, width: number, height: number, frame: SheetFrameFn): boolean {
  const style = styleOf(doc), mode = style.materialList ?? 'auto'
  if (mode === 'onSheet' || !doc.runs.some(r => r.spool === spool || !spool)) return false
  if (mode === 'auto' && style.layout !== 'schematic') return false
  const pass = passOf(doc), once = `${spool}|${width}|${height}|${frameId(frame)}`, decided = pass?.apart.get(once)
  if (decided != null) return decided
  const key = JSON.stringify([spoolContent(doc, spool), width, height, frameId(frame)])
  let known = reusing ? apartKnown.get(key) : undefined
  if (known === undefined) {
    known = decideApart(doc, spool, width, height, frame, mode)
    if (reusing) apartKnown.set(key, known)
    if (apartKnown.size > 256) apartKnown.delete(apartKnown.keys().next().value!)
  } else { apartKnown.delete(key); apartKnown.set(key, known) }
  pass?.apart.set(once, known)
  return known
}
const apartKnown = new Map<string, boolean>()
/** A number for each sheet frame function, so decisions made with one are kept apart from another's. */
const frameIds = new WeakMap<SheetFrameFn, number>()
const frameId = (frame: SheetFrameFn) => { let id = frameIds.get(frame); if (id == null) frameIds.set(frame, id = nextFrame++); return id }
let nextFrame = 0
/**
 * Everything a spool's material-list decision reads: the document but for other spools' pipes and sheets, with the
 * spool's pipes, the pipes meeting them and their nodes, and the spool's sheet settings but its label positions.
 */
function spoolContent(doc: IsoDocument, spool: string): unknown[] {
  // The sheet frame letters the title block, which a longer entry can make take more paper: all of it is read.
  const { runs, nodes, sheets, sheetNotes, outputViews, title, drawing, revision, customer, project, drawnBy, checkedBy, notes, titleBlock } = doc
  const own = runs.filter(r => !spool || r.spool === spool), ends = new Set(own.flatMap(r => [r.from, r.to]))
  const near = runs.filter(r => ends.has(r.from) || ends.has(r.to)), ids = new Set(near.map(r => r.id)), at = new Set(near.flatMap(r => [r.from, r.to]))
  const { labelPositions, labelStyles, ...sheet } = sheets?.[spool] ?? {}
  void labelPositions, labelStyles
  // The heading's lettering takes paper from a drawing with the sheet to itself; the notes, from one beside its list.
  return [sharedContent(doc), [title, drawing, revision, customer, project, drawnBy, checkedBy, notes, titleBlock ?? null, sheetNotes ?? null, outputViews ?? null], spool, near, nodes.filter(n => at.has(n.id) || (!!n.associatedRunId && ids.has(n.associatedRunId))), sheet]
}
/**
 * The document as a sheet's layout reads it, but for its pipes, nodes and sheets and what only its lettering prints
 * (title, notes, title block): written out once a pass, for the keys layouts and decisions are kept under.
 */
function sharedContent(doc: IsoDocument): string {
  const pass = passOf(doc)
  if (pass?.shared != null) return pass.shared
  const { runs, nodes, sheets, sheetNotes, outputViews, title, drawing, revision, customer, project, drawnBy, checkedBy, notes, titleBlock, ...shared } = doc
  void runs, nodes, sheets, sheetNotes, outputViews, title, drawing, revision, customer, project, drawnBy, checkedBy, notes, titleBlock
  const text = JSON.stringify(shared)
  if (pass) pass.shared = text
  return text
}
function decideApart(doc: IsoDocument, spool: string, width: number, height: number, frame: SheetFrameFn, mode: 'auto' | 'separate'): boolean {
  const rows = rowsOf(doc, spool)
  if (!rows.length) return false
  if (mode === 'separate') return true
  const runs = doc.runs.filter(r => !spool || r.spool === spool)
  const runIds = new Set(runs.map(r => r.id)), ends = new Set(runs.flatMap(r => [r.from, r.to]))
  const nodes = doc.nodes.filter(n => ends.has(n.id) || (!!n.associatedRunId && runIds.has(n.associatedRunId)))
  const pins = doc.sheets?.[spool]?.nodePositions
  // A drawing the drafter has placed by hand is drawn where it is put.
  if (!runs.length || (pins && nodes.every(n => pins[n.id]))) return false
  const style = styleOf(doc), sizes = draftingSizes(doc), estimate = sizes.tier + sizes.tierStep + 2 * sizes.text
  const memo = layoutMemo(), shape: LegShape = { stretch: style.stretch ?? 0, legs: {} }
  const lay = (b: number) => layoutSheet(doc, runs, nodes, 'iso', true, b, shape, memo)
  const laid = boundsOf(lay(1).raw.values())
  // A layout grows with its base, so it fits an area at full size at some base if it fits at the least one; and one
  // that does not is drawn at that base, smaller (as `solveBase` finds).
  const least = boundsOf(lay(MIN_BASE).raw.values())
  /** How much of its full size the drawing can be drawn at in the paper the frame leaves it (1 when it fits). */
  const room = (materials: 'on' | 'apart') => {
    // As the drawing's own sheet asks for it, so the frame drawn here is the one it is drawn with.
    const sheet = framed(frame, { doc, spool, width, height, rows, view: 'iso', ...(materials === 'apart' ? { materials } : {}) })
    const open = openFor(sheet.regions?.free ?? openRegions(sheet.viewport, sheet.exclusions).free, laid, estimate) ?? sheet.regions?.open ?? sheet.viewport
    const area = insetBy(open, [estimate, estimate, estimate, estimate]), b = least
    if (b[2] - b[0] <= area[2] - area[0] + FIT_TOLERANCE && b[3] - b[1] <= area[3] - area[1] + FIT_TOLERANCE) return 1
    return Math.min(1, (area[2] - area[0]) / Math.max(1, b[2] - b[0]), (area[3] - area[1]) / Math.max(1, b[3] - b[1]))
  }
  const on = room('on')
  return on < 1 - 1e-9 && room('apart') > on * APART_GAIN
}
/** How much larger a drawing must be drawn without its material list beside it for the list to move to its own sheet. */
const APART_GAIN = 1.05

/**
 * The sheets of a spool's drawing, in issue order: its drawing, then its material list when that has a sheet of its
 * own (`materialsApart`).
 */
export function spoolSheets(doc: IsoDocument, spool: string, width: number, height: number, frame: SheetFrameFn): SheetKind[] {
  return materialsApart(doc, spool, width, height, frame) ? ['drawing', 'materials'] : ['drawing']
}
/**
 * Where a sheet is in the issued set, numbered sheet by sheet through the spools in order, when some spool's material
 * list has a sheet of its own; otherwise undefined, every spool being one sheet as before.
 */
export function sheetNumbering(doc: IsoDocument, spool: string, kind: SheetKind, width: number, height: number, frame: SheetFrameFn): SheetNumbering | undefined {
  const spools = [...new Set(doc.runs.map(r => r.spool))]
  if (spools.indexOf(spool) < 0) return undefined
  let count = 0, number = 0, materials: number | undefined
  for (const s of spools) {
    const sheets = spoolSheets(doc, s, width, height, frame)
    if (s === spool) { number = count + 1 + (kind === 'materials' ? 1 : 0); if (sheets.length > 1) materials = count + 2 }
    count += sheets.length
  }
  if (count === spools.length) return undefined
  return { number, count, ...(materials ? { materials } : {}) }
}

/** The least share of the open paper's width and height the picture keeps when its annotations would take more. */
const MIN_PICTURE = 0.2
/** The least base a not-to-scale layout is drawn at (sheet units per unit of compressed pipe). */
const MIN_BASE = 1e-3
/** Layouts an untangling of a crowded layout (one too large for its area at any base) may try. */
const CROWDED_UNTANGLE = 16
/** A layout this little (sheet units) over its area still fits it. */
const FIT_TOLERANCE = 1e-2
/** Room around the drawing's nodes (left, top, right, bottom) its annotations take, in sheet units. */
type Reach = [number, number, number, number]
const boundsOf = (points: Iterable<Point>): Rect => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 1, 1]
}
/**
 * How far the drawn annotations reach past the drawing's nodes on each side, with half a letter's clearance. Labels
 * the drafter holds are where they are put whatever the fit, so they do not count.
 */
function reachOf(ctx: IsoContext, pos: Map<string, Point>, sizes: DraftingSizes): Reach {
  const held = new Set<Primitive>()
  for (const r of ctx.labels?.values() ?? []) if (r.held) for (const p of r.ink) held.add(p)
  const points: Point[] = []
  for (const p of ctx.out) {
    if (held.has(p)) continue
    if (p.type === 'line') points.push(p.a, p.b)
    else if (p.type === 'polyline') points.push(...p.points)
    else if (p.type === 'circle' || p.type === 'arc') points.push([p.p[0] - p.r, p.p[1] - p.r], [p.p[0] + p.r, p.p[1] + p.r])
    else if (p.type === 'text') points.push(...textPoly(p.p, p.text, p.size, p.rotation, p.oblique, p.anchor, 0))
  }
  const ink = boundsOf(points), nodes = boundsOf(pos.values()), clear = sizes.text / 2
  return [nodes[0] - ink[0], nodes[1] - ink[1], ink[2] - nodes[2], ink[3] - nodes[3]].map(r => Math.max(0, r) + clear) as Reach
}
/**
 * The largest `base` (sheet units per unit of compressed pipe length) whose not-to-scale layout fits `area` at full
 * size. A layout's width and height grow almost linearly with its base, so each is fitted with a line through the
 * last two layouts and the base solved from it, refined until it fits to within a hundredth of a unit of sheet.
 */
function solveBase(lay: (base: number) => Layout, area: Rect): { base: number; layout: Layout } {
  const w = Math.max(1, area[2] - area[0]), h = Math.max(1, area[3] - area[1]), MIN = MIN_BASE, MAX = 8
  const size = (layout: Layout) => { const b = boundsOf(layout.raw.values()); return [b[2] - b[0], b[3] - b[1]] }
  const tried: Array<{ base: number; layout: Layout; size: number[] }> = []
  const at = (base: number) => { const layout = lay(base), t = { base, layout, size: size(layout) }; tried.push(t); return t }
  const fits = (t: { size: number[] }) => t.size[0] <= w + FIT_TOLERANCE && t.size[1] <= h + FIT_TOLERANCE
  let a = at(1), b = at(2)
  for (let i = 0; i < 6; i++) {
    // Each extent as a line through the last two layouts, and the base where the first one reaches the area.
    let next = MAX
    for (const [k, room] of [[0, w], [1, h]] as const) {
      const slope = (b.size[k] - a.size[k]) / (b.base - a.base)
      if (slope > 1e-9) next = Math.min(next, b.base + (room - b.size[k]) / slope)
    }
    next = Math.max(MIN, Math.min(MAX, next))
    if (Math.abs(next - b.base) < 1e-4) break
    a = b; b = at(next)
    if (fits(b) && Math.min(w - b.size[0], h - b.size[1]) < 1e-2 * Math.max(w, h)) break
  }
  const ok = tried.filter(fits).sort((x, y) => y.base - x.base)[0]
  if (ok) return ok
  const smallest = tried.sort((x, y) => x.base - y.base)[0]
  return smallest.base <= MIN ? smallest : at(MIN)
}

/** Whether any drawn line leaves the model viewport or reaches into an area the picture keeps off. */
export function intrudes(out: Primitive[], viewport: Rect, exclusions: Rect[]): boolean {
  const keepOut = exclusions.map(e => rectPoly(...e))
  return out.some(p => {
    if (p.type !== 'line' && p.type !== 'polyline') return false
    const pieces: Array<[Point, Point]> = p.type === 'line' ? [[p.a, p.b]] : p.points.slice(1).map((q, i) => [p.points[i], q])
    return pieces.some(([a, b]) => [a, b].some(q => q[0] < viewport[0] || q[0] > viewport[2] || q[1] < viewport[1] || q[1] > viewport[3]) ||
      keepOut.some((e, i) => { const s = segmentPoly(a, b, 0.5), box = bbox(s), x = exclusions[i]; return !(box[0] >= x[2] || box[2] <= x[0] || box[1] >= x[3] || box[3] <= x[1]) && overlaps(s, e) }))
  })
}
type Line = Extract<Primitive, { type: 'line' }>
/** The drawing with the rear pipe broken at each crossing of two pipes (0.25 in), and leaders broken where they cross a pipe. */
function crossingGaps(ctx: IsoContext, sizes: DraftingSizes): Primitive[] {
  const { doc, view } = ctx, PIPE_GAP = 6.35 * sizes.mm, LEADER_GAP = 2.03 * sizes.mm
  const runOf = new Map(ctx.runs.map(r => [r.id, r])), nodeOf = new Map(ctx.nodes.map(n => [n.id, n]))
  const model = (run: PipeRun, at: Point): Vec3 => {
    const g = ctx.geometry.get(run.id)!, a = nodeOf.get(run.from)!.position, b = nodeOf.get(run.to)!.position
    const f = g.length ? ((at[0] - g.a[0]) * g.dir[0] + (at[1] - g.a[1]) * g.dir[1]) / g.length : 0
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
  }
  // Pipes that meet at a node, or a branch and the pipe it is fitted on, do not cross.
  const ends = (r: PipeRun) => [r.from, r.to]
  const joined = (a: PipeRun, b: PipeRun) => ends(a).some(id => ends(b).includes(id)) ||
    ends(a).some(id => nodeOf.get(id)?.associatedRunId === b.id) || ends(b).some(id => nodeOf.get(id)?.associatedRunId === a.id)
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
      const rear = viewDepth(model(a.run, at), view, doc.north) < viewDepth(model(b.run, at), view, doc.north) ? a : b
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
