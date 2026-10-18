import type { Point, Primitive } from '../drawing'
import { flangedJoints, type FlangedJoint } from '../joints'
import type { MaterialRow } from '../material-list'
import {connected, welds, type DrawingStyle, type IsoDocument, type PipeNode, type PipeRun, type Vec3, type Weld} from '../model'
import { unitsPerMm, type PaperSize } from '../paper'
import { cadStrokeWidth } from '../stroke-font'
import { boxesMeet, textPoly, type Placement, type Poly, type Rect } from './placement'
import { add2, len2, scale2, sub2, unit2 } from './plane'
import type { View } from './layout'

/**
 * Drafting sizes in sheet units, all in proportion to the lettering height, which is set in printed millimetres
 * (`style.textHeight`, default 2.5 mm: ISO 3098's minimum, about ASME Y14.2's 0.10 in) and converted for the paper.
 * Symbols are not to scale: a symbol keeps its size against the lettering whatever the sheet's scale.
 */
export interface DraftingSizes {
  /** Sheet units per printed millimetre. */
  mm: number
  /** Lettering cap height. */
  text: number
  /** Dimension and leader arrowhead length, and half its width. */
  arrow: number
  arrowWidth: number
  /** Flow arrowhead on a pipe, length and half-width. */
  flowArrow: number
  flowArrowWidth: number
  /** Shop weld dot radius; field weld circle radius. */
  weld: number
  fieldWeld: number
  /** A flange's drawn thickness, and the gap between the faces of a bolted pair. */
  flangeThickness: number
  flangeGap: number
  /** Gap between a valve body and its end flanges. */
  valveGap: number
  /** First dimension tier off the pipe, and each further tier beyond it (shared with the sheet's fit margin). */
  tier: number
  tierStep: number
  /** Extension line gap from the work and overshoot beyond the dimension line. */
  extGap: number
  extOver: number
  /** Run-out drawn beyond a cut: a continuation's S-break or a joint to an adjacent drawing. */
  stub: number
  /** Length an adjacent drawing's pipe is drawn to its next component. */
  adjacent: number
  /** Line weights: pipe, and the thin CAD pen. */
  pipe: number
  thin: number
}
/** Lettering height on paper when the drawing does not set one (mm). */
export const DEFAULT_TEXT_HEIGHT_MM = 2.5
/** Pipe line weight on paper when the drawing does not set one (mm). */
export const DEFAULT_PIPE_WEIGHT_MM = 0.5
/** Drafting sizes for a drawing's paper and style. */
export function draftingSizes(doc: { paper?: PaperSize; style?: Pick<DrawingStyle, 'textHeight' | 'pipeWeight'> }): DraftingSizes {
  const mm = unitsPerMm(doc.paper), T = (doc.style?.textHeight ?? DEFAULT_TEXT_HEIGHT_MM) * mm
  return {
    mm, text: T,
    arrow: 1.1 * T, arrowWidth: 0.2 * T,
    flowArrow: 0.68 * T, flowArrowWidth: 0.2 * T,
    weld: 0.32 * T, fieldWeld: 0.51 * T,
    flangeThickness: 0.48 * T, flangeGap: 0.18 * T, valveGap: 0.45 * T,
    tier: 6.6 * T, tierStep: 4.4 * T,
    extGap: 0.45 * T, extOver: 0.6 * T,
    stub: 4 * T, adjacent: 6.6 * T,
    pipe: (doc.style?.pipeWeight ?? DEFAULT_PIPE_WEIGHT_MM) * mm,
    thin: cadStrokeWidth(doc.paper)
  }
}
/** The drafting sizes a context draws with: its own, else its drawing's. */
export function sizeOf(ctx: { size?: DraftingSizes; doc?: IsoDocument }): DraftingSizes {
  return ctx.size ?? (ctx.doc ? draftingSizes(ctx.doc) : DEFAULT_SIZES)
}
const DEFAULT_SIZES = draftingSizes({})
/** First dimension tier off the pipe, for the sheet's fit margin. */
export const dimensionTier = (doc: Parameters<typeof draftingSizes>[0]) => draftingSizes(doc).tier

/** Not-to-scale symbols are drawn for a few nominal size classes (inches), so large bores stay in proportion. */
export const BORE_CLASSES = [1, 2, 3, 4] as const
/** The size class a symbol at this nominal size is drawn for, from `smallest` up. */
export function boreClass(nps: number, smallest = 2): number {
  const n = Math.max(nps, smallest)
  return BORE_CLASSES.find(c => c >= n - 1e-9) ?? BORE_CLASSES[BORE_CLASSES.length - 1]
}
/** The size class of a node's largest connection. */
export const nodeBore = (doc: IsoDocument, node: PipeNode, smallest = 2) => boreClass(Math.max(0, ...connected(doc, node.id).map(r => r.nps)), smallest)

/** Fixed fitting block on schematic paper, independent of the compressed pipe beside it. */
export function fittingTakeoutOnPaper(ctx: IsoContext, node: PipeNode, run: PipeRun): number {
  const geometry=ctx.geometry.get(run.id)
  return geometry ? nodeBore(ctx.doc, node) * 1.14 * sizeOf(ctx).text * len2(ctx.direction(geometry.dir3)) : 0
}
/** A fitting's joint on schematic paper: its drafted block, but never past the middle of a short piece. */
export function faceOnPaper(ctx: IsoContext, node: PipeNode, run: PipeRun): number {
  const g = ctx.geometry.get(run.id)
  return g ? Math.max(0, Math.min(fittingTakeoutOnPaper(ctx, node, run), g.length / 2 - sizeOf(ctx).fieldWeld)) : 0
}

export interface RunGeometry {
  run: PipeRun
  a: Point
  b: Point
  /** Page unit direction from `a` to `b`. */
  dir: Point
  length: number
  /** Model unit direction. */
  dir3: Vec3
}
export interface IsoContext {
  doc: IsoDocument
  spool: string
  view: View
  style: DrawingStyle
  schematic: boolean
  runs: PipeRun[]
  nodes: PipeNode[]
  /** Sheet position of each node. */
  pos: Map<string, Point>
  project: (p: Vec3) => Point
  /** Page unit vector of a model direction. */
  axis: (v: Vec3) => Point
  /** Page direction a straight along a model vector is drawn in; not to scale, plan diagonals lean off the vertical. */
  direction: (v: Vec3) => Point
  geometry: Map<string, RunGeometry>
  place: Placement
  materials: MaterialRow[]
  joints: FlangedJoint[]
  /** Page extent of each node's symbol along its pipe, so pipes stop at valve bodies. */
  extent: Map<string, number>
  out: Primitive[]
  /** Drafting sizes; the drawing's when unset (see `sizeOf`). */
  size?: DraftingSizes
  referenceDimensions?: Array<{ atNodeId: string; referenceId?: string; model: Vec3; page: Point }>
  labelPositions?: Record<string, Point>
  /** The positions the drafter holds, where `labelPositions` also draws some labels clear of an overprint. */
  heldPositions?: Record<string, Point>
  paperPositions?: Record<string, Point>
  /** Every movable label drawn so far, collected for the editor and for clearing overprints. */
  labels?: Map<string, LabelRecord>
  /** While annotating: labels drawn now are the automatic callouts that are re-placed when they overprint. */
  annotating?: boolean
  /** Automatic labels that overprinted on the last attempt, searched for over a wider area. */
  retry?: Set<string>
  /** Sheet room kept for labels already known to be clear, so labels drawn before them do not land on them. */
  reserved?: Array<{ key: string; poly: Poly }>
  /** Labels left overprinting once placement is done. */
  clashes?: Map<string, 'lettering' | 'linework'>
  /** Where the placement search put each label drawn so far, by label key, and the sheet area it covers. */
  found?: Map<string, Found>
  /**
   * Where the last attempt's search put the labels that are not placed again. One is drawn there again, unsearched,
   * unless something its search could see has changed (`changed`): a declutter round re-places only the labels that
   * overprinted and those around what moved.
   */
  pinned?: Map<string, Found>
  /** Sheet areas drawn differently from the last attempt: where moved and re-placed labels were and now are. */
  changed?: Rect[]
  /** Whole-drawing facts asked for again and again while the sheet is drawn, worked out once (see `draftingMemo`). */
  memo?: DraftingMemo
  /** The label searches made so far on this attempt, and how many found no clear spot (see `leanSearch`). */
  effort?: { searches: number; failed: number }
}
/**
 * Searches that found no clear spot past which, while they are most of the searches made, a sheet is taken to be
 * too dense for a full search to help: later labels weigh fewer spots (`leanSearch`). Counted from what searches found,
 * never from time or from how much work a search happened to do, so the same sheet always comes out the same.
 */
export const LEAN_AFTER = 40
/** Whether label searches on this attempt weigh only their nearest spots, the sheet being crowded past clearing. */
export const leanSearch = (ctx: Pick<IsoContext, 'effort'>) => !!ctx.effort && ctx.effort.failed >= LEAN_AFTER && ctx.effort.failed * 2 > ctx.effort.searches
/** Counts a label search and whether it found a clear spot. */
export function countSearch(ctx: Pick<IsoContext, 'effort'>, clear: boolean) {
  if (!ctx.effort) return
  ctx.effort.searches++
  if (!clear) ctx.effort.failed++
}
/** What a label's own box may overlap and still be clear: thin lines only, not lettering, symbols, tags or pipe. */
export const CLEAR_COST = 60
/**
 * Facts about a whole drawing (or a referenced one) that a drafting pass needs many times: its welds and its flanged
 * joints. They depend only on the document, which nothing changes while a sheet is drawn, so each is worked out once.
 */
export interface DraftingMemo { welds: (doc: IsoDocument) => Weld[]; joints: (doc: IsoDocument) => FlangedJoint[] }
export function draftingMemo(): DraftingMemo {
  const once = <T>(work: (doc: IsoDocument) => T) => {
    const known = new WeakMap<IsoDocument, T>()
    return (doc: IsoDocument) => { let v = known.get(doc); if (v === undefined) known.set(doc, v = work(doc)); return v }
  }
  return { welds: once(welds), joints: once(doc => flangedJoints(doc)) }
}
/** The welds of a drawing, worked out once for the pass when the context keeps a memo. */
export const weldsOf = (ctx: Pick<IsoContext, 'memo'>, doc: IsoDocument) => ctx.memo ? ctx.memo.welds(doc) : welds(doc)
/** A label's search result and the box it covers on the sheet (its lettering, boxes and leader). */
export interface Found { value: unknown; covers: Rect }
/**
 * The placement search for a label. Where the last attempt found it is used again while nothing within `near` of it
 * has changed since; a label placed anywhere else marks the area it left and the area it took as changed, so the
 * labels beside it are searched again too, and theirs in turn. `covers` is the area a result takes.
 */
export function searched<T>(ctx: Pick<IsoContext, 'found' | 'pinned' | 'changed'>, key: string | undefined, near: number, covers: (value: T) => Rect, search: () => T): T {
  if (key == null) return search()
  const pin = ctx.pinned?.get(key), changed = ctx.changed ?? []
  const around: Rect | undefined = pin && [pin.covers[0] - near, pin.covers[1] - near, pin.covers[2] + near, pin.covers[3] + near]
  let value: T
  if (pin && !changed.some(c => boxesMeet(c, around!))) value = pin.value as T
  else {
    value = search()
    const now = covers(value)
    if (ctx.pinned && !(pin && now.every((v, i) => v === pin.covers[i]))) { changed.push(now); if (pin) changed.push(pin.covers) }
  }
  ctx.found?.set(key, { value, covers: covers(value) })
  return value
}
/**
 * Where each label's placement search found its spot last time (the candidate's number in the search's order), by
 * label. A search weighs that candidate first, so that when it is still the best every other is bounded by it from the
 * start. Only the order candidates are weighed in depends on it, never the spot found: the best is the cheapest
 * candidate and the first in order among equals, every candidate's cost is worked out the same way whenever it is
 * weighed, and a candidate is passed over only when its least cost is over the best found so far (by `PRUNE`, far
 * more than rounding), which the cheapest never is. So it may be kept across drawings, of any document.
 */
const hints = new Map<string, number>()
let hinting = true
export const searchHint = (key: string) => hinting ? hints.get(key) : undefined
export function keepSearchHint(key: string, index: number) {
  if (!hinting) return
  if (hints.size > 50_000) hints.clear()
  hints.set(key, index)
}
/** Forgets every label's last spot (for drawing from nothing). */
export const forgetSearchHints = () => hints.clear()
/** Whether searches weigh a label's last spot first (off, to check that the spots found never depend on it). */
export function hintSearches(on: boolean) { hinting = on; if (!on) hints.clear() }
/** A label as it is drawn: its ink, outline points and leader. */
export interface LabelRecord {
  key: string
  spool: string
  owner?: string
  at?: Point
  held: boolean
  automatic: boolean
  /** Drawn while annotating, rather than with the pipes or dimensions. */
  annotation: boolean
  /** A held label drawn away from where it is held, to keep clear. */
  displaced?: boolean
  parent?: string
  points: Point[]
  ink: Primitive[]
  leader?: { from: Point; bend?: Point; to: Point; held: boolean }
  /** The leader ink drawn with it (lines and arrowheads), which is not part of `ink`. */
  leaders?: Primitive[]
  dimension?: { axis: Point; offset: number }
}
type LabelHost = Pick<IsoContext, 'out' | 'place'> & Partial<Pick<IsoContext, 'doc' | 'spool' | 'labels' | 'labelPositions' | 'heldPositions' | 'annotating' | 'size'>>
/** The record of a label, created on first use. */
export function labelRecord(ctx: LabelHost, key: string, owner?: string): LabelRecord | undefined {
  if (!ctx.labels) return undefined
  let record = ctx.labels.get(key)
  if (!record) {
    const held = !!(ctx.heldPositions ?? ctx.labelPositions)?.[key]
    record = { key, spool: ctx.spool ?? '', owner, held, automatic: !held && !!ctx.annotating, annotation: !!ctx.annotating, points: [], ink: [] }
    ctx.labels.set(key, record)
  }
  if (owner && !record.owner) record.owner = owner
  return record
}
/**
 * Draws one movable label: everything drawn inside belongs to it (and to the callout it is part of, unless it was moved
 * on its own), and the placement search ignores the room reserved for it.
 */
export function labelGroup<T>(ctx: LabelHost, key: string, owner: string | undefined, draw: () => T): T {
  const record = labelRecord(ctx, key, owner), parent = ctx.place.labels.at(-1)
  if (record && parent && parent !== key && !record.parent) record.parent = parent
  ctx.place.labels.push(key)
  try { return draw() } finally { ctx.place.labels.pop() }
}
export function emitters(ctx: LabelHost) {
  /** Ink belongs to its own label, then to each enclosing callout up to the first one moved on its own. */
  const track = (primitive: Primitive, points: Point[], own?: string) => {
    if (!ctx.labels) return
    const stack = [...new Set(ctx.place.labels)]
    if (own && stack.at(-1) !== own) { labelGroup(ctx, own, primitive.owner, () => undefined); stack.push(own) }
    if (primitive.type === 'text' && own) {
      const record = ctx.labels.get(own)!
      record.at ??= primitive.label?.at
      record.dimension ??= primitive.label?.dimension
    }
    if (primitive.layer === 'LEADER') { const top = ctx.labels.get(stack.at(-1) ?? ''); if (top) (top.leaders ??= []).push(primitive) }
    for (let i = stack.length - 1; i >= 0; i--) {
      const record = ctx.labels.get(stack[i])
      if (!record) break
      if (primitive.layer !== 'LEADER') { record.ink.push(primitive); record.points.push(...points) }
      if (record.held) break
    }
  }
  const line = (a: Point, b: Point, layer: string, owner?: string, weight?: number, occupy = true) => {
    const primitive: Primitive = { type: 'line', a, b, layer, owner, ...(weight ? { weight } : {}) }
    ctx.out.push(primitive)
    track(primitive, [a, b])
    if (occupy) ctx.place.addSegment(a, b, layer === 'PIPE' ? 'pipe' : layer === 'DIM' || layer === 'LEADER' ? 'line' : 'symbol', owner, layer === 'PIPE' ? 2 : 0.8)
  }
  const poly = (points: Point[], layer: string, owner?: string, options: { closed?: boolean; fill?: boolean; weight?: number; occupy?: boolean } = {}) => {
    const primitive: Primitive = { type: 'polyline', points, layer, owner, closed: options.closed, fill: options.fill, ...(options.weight ? { weight: options.weight } : options.fill ? {weight:.001} : {}) }
    ctx.out.push(primitive)
    track(primitive, points)
    if (options.occupy !== false)
      for (let i = 0; i + 1 < points.length; i++) ctx.place.addSegment(points[i], points[i + 1], 'symbol', owner, 0.8)
  }
  const circle = (p: Point, r: number, layer: string, owner?: string, fill = false) => {
    const primitive: Primitive = { type: 'circle', p, r, layer, owner, fill,...(fill?{weight:.001}:{}) }
    ctx.out.push(primitive)
    const box: Point[] = [[p[0] - r, p[1] - r], [p[0] + r, p[1] - r], [p[0] + r, p[1] + r], [p[0] - r, p[1] + r]]
    track(primitive, box)
    ctx.place.add(box, 'symbol', owner)
  }
  const text = (p: Point, value: string, size: number, layer: string, owner?: string,
    options: { rotation?: number; oblique?: number; anchor?: 'start' | 'middle' | 'end'; role?: 'overall' | 'cut'; label?: Extract<Primitive,{type:'text'}>['label'] } = {}): Poly => {
    const held=layer!=='TAG'&&options.label&&ctx.spool?ctx.doc?.sheets?.[ctx.spool]?.labelStyles?.[options.label.key]:undefined
    if(held){size=held.size??size;options={...options,...(held.rotation!=null?{rotation:held.rotation}:{}),...(held.oblique!=null?{oblique:held.oblique}:{})}}
    const primitive: Primitive = { type: 'text', p, text: value, size, layer, owner, ...options }
    ctx.out.push(primitive)
    const shape = textPoly(p, value, size, options.rotation, options.oblique, options.anchor, 1)
    track(primitive, shape, options.label?.key)
    ctx.place.add(shape, 'text', owner)
    return shape
  }
  /** Filled arrowhead with its tip at `tip`, pointing along `toward`. */
  const arrow = (tip: Point, toward: Point, layer: string, owner?: string, length = sizeOf(ctx).arrow, width = sizeOf(ctx).arrowWidth) => {
    const u = unit2(toward), base = sub2(tip, scale2(u, length)), n: Point = [u[1] * width, -u[0] * width]
    poly([tip, add2(base, n), sub2(base, n)], layer, owner, { closed: true, fill: true })
  }
  return { line, poly, circle, text, arrow }
}
