import { withIndex, type IsoDocument, type Vec3 } from './model'
import { gridSvg, type GridSettings } from './grid'
import { LINE_SPACING, strokeTextPath } from './stroke-font'
import { draftingSizes } from './iso/context'
import { unitsPerMm, type PaperSize } from './paper'
import { MODEL_SPACE, drawingPass, renderIso, sheetNumbering, spoolSheets, type SheetKind } from './iso/render'
import { drawSheet as sheetFrame } from './iso/sheet'
import type { PaperLattice } from './iso/lattice'
export type Point = [number, number]
/**
 * Sheet primitives in sheet units (the sheet is 850 units tall). `weight` is the stroke width in sheet units;
 * without it each layer has its drafting default (LAYER_WEIGHT).
 */
export type Primitive = (
  | { type: 'line'; a: Point; b: Point; layer: string; owner?: string; weight?: number; linetype?: Linetype }
  | { type: 'polyline'; points: Point[]; closed?: boolean; fill?: boolean; layer: string; owner?: string; weight?: number; linetype?: Linetype }
  | { type: 'circle'; p: Point; r: number; fill?: boolean; layer: string; owner?: string; weight?: number; linetype?: Linetype }
  /**
   * A circular arc about centre `p`, drawn counter-clockwise on the page from `start` to `end` (degrees from the
   * sheet's +x, counter-clockwise on the page as `rotation` is). Exported as a CAD ARC.
   */
  | { type: 'arc'; p: Point; r: number; start: number; end: number; layer: string; owner?: string; weight?: number; linetype?: Linetype }
  | {
      type: 'text'
      /** Baseline point at the anchor. */
      p: Point
      text: string
      lettering?: 'cad' | 'sans'
      /** Cap height. */
      size: number
      layer: string
      owner?: string
      /** A paper label's stable placement handle; geometry and fabrication data are unaffected. */
      label?: { key: string; at: Point; spool: string; dimension?: { axis: Point; offset: number } }
      /** Set on a pipe dimension so the editor can edit that length in place. */
      role?: 'overall' | 'cut'
      /**
       * Set on any other dimension between two connections (a component face to an elbow, an overall run): editing it in
       * place moves the second connection along its straight (see `setSpanLength`).
       */
      span?: { from: string; to: string; mm: number }
      /** Degrees counter-clockwise on the page. */
      rotation?: number
      /** Slant in degrees, positive leaning right; isometric lettering uses the same angle as the rotation. */
      oblique?: number
      anchor?: 'start' | 'middle' | 'end'
      /** Width factor relative to standard ROMANS lettering. */
      width?: number
      /**
       * The title-block, revision or material-list field this lettering prints (a template binding such as
       * `sheet.drawingNumber`, `rev.1.date`, `bom.3.description`), so CAD exports it as a block attribute.
       */
      field?: string
    }
  | { type: 'image'; p: Point; width: number; height: number; href: string; layer: string; owner?: string }
) & {
  /** Explicit markup ink, as #RRGGBB. */
  color?: string
  /**
   * The drawn symbol instance this ink belongs to (a valve, weld, flow arrow, the title block): its name, insertion
   * point, turn in degrees counter-clockwise on the page and uniform scale. Every primitive of one instance carries
   * the same values, so CAD exports the instance as a block insert.
   */
  symbol?: SymbolRef
}
/** A drawn symbol instance (see `Primitive.symbol`). */
export interface SymbolRef { name: string; at: Point; rotation: number; scale?: number }
/** Line patterns drawn as one stroke with a dash pattern, rather than as separate dashes. */
export type Linetype = 'dashed' | 'hidden' | 'center' | 'phantom'
/**
 * Dash patterns in printed millimetres (dash, gap, …), the AutoCAD acad.lin patterns at 3 mm per inch, so the DXF
 * draws them as the standard linetypes at one linetype scale (`LINETYPE_SCALE`).
 */
export const LINETYPE_MM: Record<Linetype, number[]> = {
  dashed: [1.5, 0.75],
  hidden: [0.75, 0.375],
  center: [3.75, 0.75, 0.75, 0.75],
  phantom: [3.75, 0.75, 0.75, 0.75, 0.75, 0.75]
}
/** The linetype scale the DXF draws `LINETYPE_MM` at against the standard acad.lin patterns. */
export const LINETYPE_SCALE = 3 / 25.4
/** Sheet units per printed millimetre of a drawing, from its pens (`Drawing.weights`); tabloid without them. */
export const sheetUnitsPerMm = (weights: Record<string, number> = LAYER_WEIGHT) => (weights.BORDER / FRAME_PENS.BORDER) * unitsPerMm('tabloid')
/** A primitive's dash pattern in sheet units, as SVG `stroke-dasharray` lists it; none for a continuous line. */
export function dashArray(p: Primitive, weights?: Record<string, number>): string | undefined {
  const linetype = 'linetype' in p ? p.linetype : undefined
  if (!linetype || !LINETYPE_MM[linetype]) return undefined
  const k = sheetUnitsPerMm(weights)
  return LINETYPE_MM[linetype].map(v => +(v * k).toFixed(4)).join(' ')
}
/**
 * Pens of the frame and markup layers, as drafted on the 850-unit tabloid sheet (2 units is a 0.66 mm pen). They print
 * at the same width on every paper, so each is converted for the drawing's paper.
 */
const FRAME_PENS = { BORDER: 2, TITLE: 0.8, BOM: 0.8, NOTES: 0.8, WELD: 1, GRID: 0.6, MARKUP: 850 / 792 } as const
/**
 * Stroke widths in sheet units for a drawing's paper and pens: pipe at the style's pipe weight, drafting linework and
 * lettering at the thin CAD pen, frame layers at their pens, all printed sizes converted for the paper.
 */
export function layerWeights(doc: { paper?: PaperSize; style?: { pipeWeight?: number } } = {}): Record<string, number> {
  const s = draftingSizes(doc), thin = s.thin, onPaper = s.mm / unitsPerMm('tabloid')
  const frame = Object.fromEntries(Object.entries(FRAME_PENS).map(([layer, w]) => [layer, w * onPaper]))
  return { ...frame, PIPE: s.pipe, SYMBOL: thin, DIM: thin, LEADER: thin, TAG: thin, TEXT: thin, HATCH: thin }
}
/**
 * Stroke widths in sheet units of the reference (tabloid) sheet, for primitives drawn without a drawing; a drawing
 * carries its own for its paper and pens (`Drawing.weights`).
 */
export const LAYER_WEIGHT: Record<string, number> = layerWeights()
/** A primitive's stroke width: its own, else its layer's in `weights` (a drawing's `weights`, tabloid defaults otherwise). */
export const weightOf = (p: Primitive, weights: Record<string, number> = LAYER_WEIGHT) => ('weight' in p && p.weight) || weights[p.layer] || weights.TITLE
/** Single-stroke lettering is drawn with the thin CAD pen on every layer: the TEXT layer's weight in `weights`. */
export const letteringWeight = (weights: Record<string, number> = LAYER_WEIGHT) => weights.TEXT
/**
 * A movable paper label as drawn: what the editor picks, highlights and drags. Exports never read it; the sheet's
 * ink is in `primitives`.
 */
export interface PaperLabel {
  /** The key its position is held under in `sheets[spool].labelPositions`. */
  key: string
  spool: string
  /** The pipe or component it describes. */
  owner?: string
  /** The point a held position replaces: the label's centre, or a dimension's text anchor. */
  at: Point
  /** Convex outline of its lettering and boxes on the sheet, leaders excluded. */
  outline: Point[]
  /** The callout it is drawn as part of, while it has not been moved on its own (a line of a valve callout). */
  parent?: string
  /** Its leader: leaving the label at `from`, through the bend held as `leader:<key>`, to the item at `to`. */
  leader?: { from: Point; bend?: Point; to: Point; held: boolean }
  /** Whether the drafter has placed it; automatic labels are placed clear of everything. */
  held: boolean
  /** A held label whose lettering overprints other lettering, symbols or pipe. */
  overlapping?: boolean
  /** A held label drawn (and exported) a little away from where it is held, to keep clear; `at` is where it is drawn. */
  displaced?: boolean
  /** A dimension's line axis and offset, for moving the dimension line. */
  dimension?: { axis: Point; offset: number }
  /** Its own ink (lettering, boxes), for drawing a preview while it is dragged. */
  ink: Primitive[]
}
export interface Drawing {
  /** Every movable paper label, in drawing order. */
  labels?: PaperLabel[]
  width: number
  height: number
  /** The model viewport on the sheet, inside the border and clear of the BOM and title block. */
  area: [number, number, number, number]
  /** Projected-model centre and scale used to fit the sheet; pass back to hold the view steady while routing. */
  fit: SheetFit
  primitives: Primitive[]
  positions: Map<string, Point>
  project: (p: Vec3) => Point
  view: 'iso' | 'plan' | 'front' | 'side'
  /** CAD lettering draws text with the single-stroke ROMANS font in every output. */
  lettering?: 'cad' | 'sans'
  /**
   * Not to scale: the paper lattice the sheet is drafted on (isometric, or square for a plan or elevation). Every
   * turn, branch and end is on one of its points; show it with `paperLines(drawing.lattice, area, minSpacing)`.
   */
  lattice?: PaperLattice
  /** What the view looks along, as a sheet notes it ("FRONT VIEW · LOOKING EAST"). */
  viewNote?: string
  /** What the drafting could not do as asked (a held end folding its pipe, a drawing too large for its sheet). */
  notices?: DrawingNotice[]
  /** Stroke width of each layer on this drawing's paper (see `weightOf`). */
  weights?: Record<string, number>
  /** Which of its spool's sheets this is, when the spool has more than one (see `drawingSheets`). */
  sheet?: { kind: SheetKind; index: number; count: number; number?: number; of?: number }
}
export type { SheetKind } from './iso/render'
/** Something the drawing reports about how it was drafted, rather than hiding it. */
export interface DrawingNotice {
  kind: string
  /** The node or pipe it concerns. */
  node?: string
  message: string
}
/** A point of an arc primitive at `angle` degrees (counter-clockwise on the page, sheet y down). */
export const arcPoint = (centre: Point, r: number, angle: number): Point => {
  const a = (angle * Math.PI) / 180
  return [centre[0] + r * Math.cos(a), centre[1] - r * Math.sin(a)]
}
/** An arc's sweep in degrees, 0 to 360, counter-clockwise from its start. */
export const arcSweep = (p: { start: number; end: number }) => {
  const sweep = (((p.end - p.start) % 360) + 360) % 360
  return sweep === 0 && p.end !== p.start ? 360 : sweep
}
/** SVG path data of an arc primitive (a full turn as two halves). */
export function arcPath(p: { p: Point; r: number; start: number; end: number }): string {
  const sweep = arcSweep(p), [x0, y0] = arcPoint(p.p, p.r, p.start)
  if (sweep >= 360) {
    const [x1, y1] = arcPoint(p.p, p.r, p.start + 180)
    return `M${x0} ${y0}A${p.r} ${p.r} 0 1 0 ${x1} ${y1}A${p.r} ${p.r} 0 1 0 ${x0} ${y0}`
  }
  const [x1, y1] = arcPoint(p.p, p.r, p.start + sweep)
  // Counter-clockwise on the page is SVG's negative sweep (y down).
  return `M${x0} ${y0}A${p.r} ${p.r} 0 ${sweep > 180 ? 1 : 0} 0 ${x1} ${y1}`
}
export const escape = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  )
/** Sheet proportions; drawings are laid out 850 units tall at the chosen paper's aspect ratio. */
export const PAPER_ASPECT = {
  letter: 11 / 8.5,
  tabloid: 17 / 11,
  a3: 420 / 297,
  a4: 297 / 210
} as const
export const SHEET_HEIGHT = 850
export const sheetWidth = (doc: Pick<IsoDocument, 'paper'>) =>
  Math.round(SHEET_HEIGHT * PAPER_ASPECT[doc.paper ?? 'tabloid'])
export interface SheetFit {
  centre: Point
  scale: number
  /** Not to scale: sheet units per unit of compressed pipe length, chosen to fill the sheet. */
  base?: number
  /** Not to scale: lengthening of pipe drawn across the page, so a narrow drawing fills the open area. */
  stretch?: number
  /** Not to scale: drawn-length factors of straight legs that would otherwise cross. */
  legs?: Record<string, number>
  /** The sheet point `centre` is drawn at (the middle of the open paper, clear of the annotations' reach). */
  at?: Point
  /** Not to scale: the lattice cell drafted on, when a crowded sheet subdivides the paper's cells (sheet units). */
  cell?: number
}
/**
 * The issued isometric sheet (or, with `model`, the true-scale model-space view): production frame, laid-out pipe,
 * symbols, dimensions, tags and callouts. `hold` keeps the projected fit steady while routing.
 */
export function createDrawing(
  doc: IsoDocument,
  spool = '',
  view: 'iso' | 'plan' | 'front' | 'side' = 'iso',
  hold?: SheetFit,
  options?: { model?: boolean; sheet?: SheetKind }
): Drawing {
  const model = options?.model === true, kind = model ? 'drawing' : options?.sheet ?? 'drawing'
  // Drawing only reads the document, so its lookups are indexed for the pass.
  return withIndex(doc, () => drawingPass(doc, () => {
    const d = renderIso(doc, spool, view, model ? MODEL_SPACE.width : sheetWidth(doc), model ? MODEL_SPACE.height : SHEET_HEIGHT, model ? null : sheetFrame, hold, model, kind)
    if (model) return d
    const sheets = drawingSheets(doc, spool)
    if (sheets.length < 2 && kind === 'drawing') return d
    const numbering = sheetNumbering(doc, ownSpool(doc, spool), kind, sheetWidth(doc), SHEET_HEIGHT, sheetFrame)
    return { ...d, sheet: { kind, index: Math.max(0, sheets.indexOf(kind)), count: sheets.length, ...(numbering ? { number: numbering.number, of: numbering.count } : {}) } }
  }))
}
/** The spool a drawing of `spool` is of: the only spool when none is named. */
const ownSpool = (doc: IsoDocument, spool: string) => { const spools = [...new Set(doc.runs.map(r => r.spool))]; return !spool && spools.length === 1 ? spools[0] : spool }
/**
 * The sheets a spool's drawing is issued on, in order: its drawing (one sheet per output view), then its material list
 * when that has a sheet of its own (style `materialList`).
 */
export function drawingSheets(doc: IsoDocument, spool = ''): SheetKind[] {
  return withIndex(doc, () => drawingPass(doc, () => spoolSheets(doc, ownSpool(doc, spool), sheetWidth(doc), SHEET_HEIGHT, sheetFrame)))
}
export function drawingSvg(
  d: Drawing,
  selected = '',
  interactive = false,
  grid?: { settings: GridSettings; anchor: Vec3; units?: IsoDocument['units'] }
): string {
  const shape = (p: Primitive) => {
    const attrs = `${p.color ? `style="stroke:${escape(p.color)};color:${escape(p.color)}${p.type==='text'?`;fill:${p.lettering==='sans'?escape(p.color):'none'}`:''}" ` : ''}data-owner="${escape(p.owner ?? '')}" class="${p.layer.toLowerCase()}${p.owner === selected ? ' selected' : ''}"`
    if (p.type === 'image')
      return `<image ${attrs} x="${p.p[0]}" y="${p.p[1]}" width="${p.width}" height="${p.height}" href="${escape(p.href)}" preserveAspectRatio="xMidYMid meet"/>`
    const dashes = dashArray(p, d.weights), width = `${weightOf(p, d.weights)}"${dashes ? ` stroke-dasharray="${dashes}"` : ''}`
    if (p.type === 'line')
      return `<line ${attrs} x1="${p.a[0]}" y1="${p.a[1]}" x2="${p.b[0]}" y2="${p.b[1]}" stroke-width="${width}/>`
    if (p.type === 'polyline') {
      const points = p.points.map(q => q.join(',')).join(' ')
      return `<${p.closed || p.fill ? 'polygon' : 'polyline'} ${attrs} points="${points}" stroke-width="${width} fill="${p.fill ? 'currentColor' : 'none'}" stroke-linejoin="round"/>`
    }
    if (p.type === 'circle')
      return `<circle ${attrs} cx="${p.p[0]}" cy="${p.p[1]}" r="${p.r}" stroke-width="${width} fill="${p.fill ? 'currentColor' : 'white'}"/>`
    if (p.type === 'arc')
      return `<path ${attrs} d="${arcPath(p)}" stroke-width="${width} fill="none"/>`
    if ((p.lettering ?? d.lettering) === 'cad')
      return `<path ${attrs} d="${strokeTextPath(p.text, { at: p.p, size: p.size, rotation: p.rotation, oblique: p.oblique, anchor: p.anchor, width: p.width })}" fill="none" stroke-width="${letteringWeight(d.weights)}" stroke-linecap="round" stroke-linejoin="round" data-text="${escape(p.text)}"/>`
    const transform = p.rotation || p.oblique
      ? ` transform="translate(${p.p[0]} ${p.p[1]}) rotate(${-(p.rotation ?? 0)}) skewX(${-(p.oblique ?? 0)}) translate(${-p.p[0]} ${-p.p[1]})"` : ''
    const anchor = p.anchor && p.anchor !== 'start' ? ` text-anchor="${p.anchor}"` : ''
    // Lines stack at the stroke font's spacing so every output wraps text identically.
    const lines = p.text.split('\n').map((line, i) => `<tspan x="${p.p[0]}" y="${p.p[1] + i * p.size * LINE_SPACING}">${escape(line)}</tspan>`).join('')
    return `<text ${attrs} x="${p.p[0]}" y="${p.p[1]}" font-size="${p.size / 0.72}"${anchor}${transform}>${lines}</text>`
  }
  const hits = interactive
    ? [...d.positions]
        .map(
          ([key, p]) =>
            `<circle data-node="${escape(key)}" cx="${p[0]}" cy="${p[1]}" r="14" fill="transparent" stroke="none" class="node-hit"/>`
        )
        .join('')
    : ''
  // Outside the editor the sheet has its paper's printed size, so it is placed at true size wherever it is imported.
  const perMm = sheetUnitsPerMm(d.weights), size = interactive ? '' : ` width="${+(d.width / perMm).toFixed(2)}mm" height="${+(d.height / perMm).toFixed(2)}mm"`
  return `<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 ${d.width} ${d.height}" role="img" aria-label="Piping isometric drawing" style="background:white;color:#111"><style>text{font-family:Arial,sans-serif;fill:#111}line,circle,path,polyline,polygon{stroke:#111;stroke-linecap:round}.selected{stroke:#087fbe;color:#087fbe}text.selected{fill:#087fbe}.node-hit{cursor:pointer;stroke:none!important}.iso-grid-line{stroke:#c6dbea;stroke-width:0.6}.iso-grid-line.major{stroke:#a5c8df;stroke-width:0.85}.iso-grid-caption{fill:#4f7289}.grid-cursor{stroke:#087fbe;fill:#087fbe;pointer-events:none}text{user-select:none}</style>${interactive && grid ? gridSvg(d, grid.anchor, grid.settings, grid.units) : ''}${d.primitives.map(shape).join('')}${hits}${interactive ? '<g data-grid-cursor pointer-events="none"></g>' : ''}</svg>`
}
