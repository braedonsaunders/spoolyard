import type { Primitive } from '../drawing'
import { styleOf, type IsoDocument } from '../model'
import { measureText } from '../stroke-font'
import { dimensionRoundingNote } from '../format'
import type { PaperSize } from '../paper'

/**
 * What a sheet frame (classic paper or a title-block template) gives the drawing: its ink, the model viewport and
 * every area the model must keep off, named, so layout can fit the model into the open paper. Shared by the frames
 * and the renderer; rectangles are [x0, y0, x1, y1] in sheet units (the sheet is 850 units tall).
 */
export type SheetRect = [number, number, number, number]
export type SheetView = 'iso' | 'plan' | 'front' | 'side'

/** One material-list row as the sheet prints it. */
export interface SheetRow {
  id: number
  key?: string
  qtyText: string
  nd: string
  description: string
  /** The calculated cells, when issued values replace them (see `sheets[spool].issuedValues`). */
  calculated?: { qtyText: string; nd: string; description: string }
  /** Cells entered by hand rather than calculated: all of them (`true`) or the named ones. */
  overridden?: boolean | Array<'qtyText' | 'nd' | 'description'>
}

export interface SheetFrameInput {
  doc: IsoDocument
  spool: string
  width: number
  height: number
  rows: SheetRow[]
  view?: SheetView
  /** View-direction note supplied by layout (an auxiliary view); defaults to the view's own direction. */
  viewNote?: string
  /**
   * How this sheet prints the spool's material list: in full beside the drawing ('on', the default); noted as
   * continued on the sheet `numbering.materials` ('apart'), the drawing having the sheet to itself; or as the whole of
   * a sheet of its own after the drawing ('only'), with the same title block and no model.
   */
  materials?: 'on' | 'apart' | 'only'
  /**
   * Where this sheet is in the issued set, when a spool's material list takes a sheet of its own: its number, how many
   * sheets the set has, and the number of the sheet its material list is on. Without it a sheet is numbered by its
   * spool (one sheet a spool).
   */
  numbering?: SheetNumbering
}
/** A sheet's place in the issued set (see `SheetFrameInput.numbering`). */
export interface SheetNumbering { number: number; count: number; materials?: number }
/** The note a drawing sheet prints where its material list would be, when the list has a sheet of its own. */
/**
 * The pipe specifications a spool's title block names: those of its pipes, in the order drawn. A sheet with no pipe
 * drawn yet names the document's specifications, so a new drawing's title block is filled in from the start.
 */
export function sheetPipeSpecs(doc: Pick<IsoDocument, 'runs' | 'specs'>, spool: string): string {
  const drawn = [...new Set(doc.runs.filter(r => !spool || r.spool === spool).map(r => r.specId))]
  return (drawn.length ? drawn : [...new Set((doc.specs ?? []).map(s => s.id))]).join(' / ')
}
export const materialsContinued = (sheet: number | undefined) => `MATERIAL LIST CONTINUED ON SHEET ${sheet ?? ''}`.trim()

/** Named parts of the frame, in sheet units. */
export interface SheetRegions {
  /** Inside the drawing border. */
  border: SheetRect
  /** Title block, revision block and other fixed form areas. */
  title: SheetRect[]
  /** Material-list blocks. */
  bom: SheetRect[]
  notes?: SheetRect
  north?: SheetRect
  /**
   * Where the model fits: of the viewport's open rectangles (`free`), the one holding the largest box of usual
   * isometric proportions (OPEN_ASPECT). Layout knowing the model's own proportions may choose from `free` with
   * `bestOpenRect`.
   */
  open: SheetRect
  /** Every maximal rectangle of the viewport clear of every exclusion, largest first. */
  free: SheetRect[]
}

/** What the renderer knows once the model is fitted, for the frame's scale and view notes. */
export interface SheetFinish {
  /** Paper length per true length (0.05 at 1:20). Omit on a sheet not drawn to scale. */
  scale?: number
}

export interface SheetFrame {
  primitives: Primitive[]
  /** The model drawing area: inside the border and clear of the title block. */
  viewport: SheetRect
  /** Parts of the viewport the model and its annotations must keep clear of: north symbol, BOM blocks, notes. */
  exclusions: SheetRect[]
  regions: SheetRegions
  /** Paper size in mm and sheet units per paper mm (uniform in x and y). */
  paper: { width: number; height: number; unitsPerMm: number }
  /**
   * Lettering that depends on the fitted model: the scale ratio of a to-scale sheet. Call once after fitting and
   * draw the result with the frame; without it a to-scale sheet's scale is left blank. Not-to-scale sheets return [].
   */
  finish: (fit: SheetFinish) => Primitive[]
}
export type SheetFrameFn = (input: SheetFrameInput) => SheetFrame

export { PAPER_MM, paperMm, unitsPerMm, type PaperSize } from '../paper'
export const paperOf = (doc: Pick<IsoDocument, 'paper'>): PaperSize => doc.paper ?? 'tabloid'

/**
 * Sans lettering is set in Arial/Noto at the same cap height; its advance is about this much wider than the
 * single-stroke ROMANS face for capitals and figures, so it is measured from the stroke font and widened.
 */
export const SANS_ADVANCE = 1.12
/** Advance width of a line of lettering of cap height `size`, in the drawing's lettering. */
export function letterWidth(text: string, size: number, lettering: 'cad' | 'sans' = 'cad', factor = 1) {
  return measureText(text, size, factor) * (lettering === 'sans' ? SANS_ADVANCE : 1)
}

/** Standard drawing scales (paper : true), metric and imperial architectural/engineering. */
const METRIC_SCALES = [1, 2, 2.5, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 1000]
const IMPERIAL_SCALES: Array<[number, string]> = [
  [1, '1:1'], [2, '6" = 1\'-0"'], [4, '3" = 1\'-0"'], [8, '1 1/2" = 1\'-0"'], [12, '1" = 1\'-0"'], [16, '3/4" = 1\'-0"'],
  [24, '1/2" = 1\'-0"'], [32, '3/8" = 1\'-0"'], [48, '1/4" = 1\'-0"'], [64, '3/16" = 1\'-0"'], [96, '1/8" = 1\'-0"'],
  [128, '3/32" = 1\'-0"'], [192, '1/16" = 1\'-0"']
]
/**
 * The largest standard scale not larger than `scale` (paper per true length), so a drawing snapped to it still fits.
 * Returns the ratio denominator: 20 for 1:20.
 */
export function standardScale(scale: number, units: IsoDocument['units'] = 'mm'): number {
  const n = 1 / scale, list = units === 'imperial' ? IMPERIAL_SCALES.map(s => s[0]) : METRIC_SCALES
  return list.find(d => d >= n * (1 - 1e-6)) ?? Math.ceil(n / 100) * 100
}
/**
 * How the sheet's scale is written: a standard scale by its name, otherwise the plain ratio. Exact to 0.5%, so a
 * fitted, unsnapped scale is never mislabelled as a standard one.
 */
export function scaleText(scale: number, units: IsoDocument['units'] = 'mm'): string {
  const n = 1 / scale
  if (units === 'imperial') {
    const hit = IMPERIAL_SCALES.find(([d]) => Math.abs(d - n) / d < 0.005)
    if (hit) return hit[1]
  } else if (METRIC_SCALES.some(d => Math.abs(d - n) / d < 0.005)) return n < 1.0025 ? '1:1' : `1:${+n.toFixed(n < 10 ? 1 : 0)}`
  return n >= 1 ? `1:${+n.toPrecision(3)}` : `${+(1 / n).toPrecision(3)}:1`
}

/** The scale printed on a sheet: NTS when not to scale (unless switched off), the ratio once fitted to scale. */
export function sheetScale(doc: IsoDocument, fit?: SheetFinish): string {
  const style = styleOf(doc)
  if (style.layout === 'schematic') return style.scaleNote === false ? '' : 'NTS'
  return fit?.scale && Number.isFinite(fit.scale) && fit.scale > 0 ? scaleText(fit.scale, doc.units) : ''
}

/** Which way an orthographic view looks at the plant (+x east, +y north, +z up). */
export function viewNote(view: SheetView): string {
  return { iso: 'ISOMETRIC VIEW', plan: 'PLAN VIEW, LOOKING DOWN', front: 'FRONT VIEW, LOOKING NORTH', side: 'SIDE VIEW, LOOKING WEST' }[view]
}

/**
 * The drafting notes a sheet's settings make true: the scale, what the lengths measure, how a cut length is found
 * and how dimensions are rounded. `scale` is the printed scale ('NTS', '1:20', or '' when unknown).
 */
export function draftingNotes(doc: IsoDocument, scale: string): string[] {
  const style = styleOf(doc), out: string[] = []
  if (scale === 'NTS' || style.layout === 'schematic') out.push('DIMENSIONS GOVERN - NOT TO SCALE')
  else if (scale) out.push(`SCALE ${scale} - DIMENSIONS GOVERN`)
  else out.push('DIMENSIONS GOVERN')
  if (doc.dimensionMode === 'overall') out.push('ALL LENGTHS TO CENTRELINES UNLESS NOTED')
  else if (doc.dimensionMode === 'cut') out.push('LENGTHS MARKED CUT ARE PIPE CUT LENGTHS')
  else out.push('CENTRELINE LENGTHS; CUT LENGTHS MARKED CUT')
  if (doc.dimensionMode !== 'overall') out.push('CUT = OVERALL - FITTINGS - ROOT GAPS')
  const rounding = dimensionRoundingNote(doc)
  if (rounding) out.push(rounding.replace(/\.$/, ''))
  return out
}

/** Which cells of a material row were entered by hand rather than calculated. */
export function overriddenCells(row: SheetRow): Set<'qtyText' | 'nd' | 'description'> {
  const keys = ['qtyText', 'nd', 'description'] as const
  if (row.overridden === true) return new Set(keys)
  const out = new Set(Array.isArray(row.overridden) ? row.overridden : [])
  if (row.calculated) for (const k of keys) if (row[k] !== row.calculated[k]) out.add(k)
  return out
}
/** A small delta (revision triangle) marking a cell entered by hand, its base on the baseline at `p`. */
export function deltaMark(p: [number, number], size: number, layer: string): Primitive {
  const h = size * 0.9, w = h * 1.15
  return { type: 'polyline', closed: true, layer, points: [[p[0], p[1]], [p[0] + w, p[1]], [p[0] + w / 2, p[1] - h]] }
}

/**
 * Every maximal rectangle inside `area` that overlaps none of `obstacles` (none lies inside another), largest
 * first: the open paper the model may be fitted into.
 */
export function openRects(area: SheetRect, obstacles: SheetRect[]): SheetRect[] {
  const inside = obstacles
    .map((o): SheetRect => [Math.max(o[0], area[0]), Math.max(o[1], area[1]), Math.min(o[2], area[2]), Math.min(o[3], area[3])])
    .filter(o => o[2] > o[0] && o[3] > o[1])
  if (!inside.length) return [[...area]]
  const xs = [...new Set([area[0], area[2], ...inside.flatMap(o => [o[0], o[2]])])].sort((a, b) => a - b)
  const found: SheetRect[] = []
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++) {
      const x0 = xs[i], x1 = xs[j]
      // Clear vertical runs between the obstacles that cross this column.
      const blocking = inside.filter(o => o[0] < x1 - 1e-9 && o[2] > x0 + 1e-9).sort((a, b) => a[1] - b[1])
      let y = area[1]
      for (const o of [...blocking, [x0, area[3], x1, area[3]] as SheetRect]) {
        if (o[1] > y + 1e-9) found.push([x0, y, x1, o[1]])
        y = Math.max(y, o[3])
      }
    }
  const within = (a: SheetRect, b: SheetRect) => a !== b && a[0] >= b[0] - 1e-9 && a[1] >= b[1] - 1e-9 && a[2] <= b[2] + 1e-9 && a[3] <= b[3] + 1e-9
  const area_ = (r: SheetRect) => (r[2] - r[0]) * (r[3] - r[1])
  return found.filter(r => !found.some(o => within(r, o) && area_(o) > area_(r) + 1e-9)).sort((a, b) => area_(b) - area_(a))
}
/** The largest axis-aligned rectangle inside `area` that overlaps none of `obstacles`. */
export function largestOpenRect(area: SheetRect, obstacles: SheetRect[]): SheetRect {
  return openRects(area, obstacles)[0] ?? [area[0], area[1], area[0], area[1]]
}
/** Of `rects`, the one that holds the largest box of width-to-height `aspect`. */
export function bestOpenRect(rects: SheetRect[], aspect: number): SheetRect | undefined {
  const holds = (r: SheetRect) => Math.min((r[2] - r[0]) / aspect, r[3] - r[1])
  return rects.reduce<SheetRect | undefined>((best, r) => !best || holds(r) > holds(best) + 1e-9 ? r : best, undefined)
}
/** Width-to-height of the box a frame's `open` area is chosen for: an isometric of usual proportions. */
export const OPEN_ASPECT = 1.5
/** The `open` and `free` regions of a viewport with its exclusions. */
export function openRegions(viewport: SheetRect, exclusions: SheetRect[]): { open: SheetRect; free: SheetRect[] } {
  const free = openRects(viewport, exclusions)
  return { open: bestOpenRect(free, OPEN_ASPECT) ?? [...viewport], free }
}
