import { type IsoDocument, type Vec3 } from './model'
import { gridSvg, type GridSettings } from './grid'
import { LINE_SPACING, strokeTextPath } from './stroke-font'
import { renderIso } from './iso/render'
import { drawSheet as sheetFrame } from './iso/sheet'
export type Point = [number, number]
/**
 * Sheet primitives in sheet units (the sheet is 850 units tall). `weight` is the stroke width in sheet units;
 * without it each layer has its drafting default (LAYER_WEIGHT).
 */
export type Primitive =
  | { type: 'line'; a: Point; b: Point; layer: string; owner?: string; weight?: number }
  | { type: 'polyline'; points: Point[]; closed?: boolean; fill?: boolean; layer: string; owner?: string; weight?: number }
  | { type: 'circle'; p: Point; r: number; fill?: boolean; layer: string; owner?: string; weight?: number }
  | {
      type: 'text'
      /** Baseline point at the anchor. */
      p: Point
      text: string
      /** Cap height. */
      size: number
      layer: string
      owner?: string
      /** Set on a pipe dimension so the editor can edit that length in place. */
      role?: 'overall' | 'cut'
      /** Degrees counter-clockwise on the page. */
      rotation?: number
      /** Slant in degrees, positive leaning right; isometric lettering uses the same angle as the rotation. */
      oblique?: number
      anchor?: 'start' | 'middle' | 'end'
      /** Width factor relative to standard ROMANS lettering. */
      width?: number
    }
  | { type: 'image'; p: Point; width: number; height: number; href: string; layer: string; owner?: string }
/** Default stroke widths in sheet units. */
export const LAYER_WEIGHT: Record<string, number> = {
  BORDER: 2, TITLE: 0.8, BOM: 0.8, NOTES: 0.8, PIPE: 1.7, WELD: 1, SYMBOL: 1.2, DIM: 0.6, LEADER: 0.6, TAG: 0.8, TEXT: 0.8, HATCH: 0.5, GRID: 0.6
}
export const weightOf = (p: Primitive) => ('weight' in p && p.weight) || LAYER_WEIGHT[p.layer] || 0.8
export interface Drawing {
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
}
export const escape = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  )
export function isoProject(p: Vec3, rotation = 0): Point {
  const angle = (rotation * Math.PI) / 180
  const x = p[0] * Math.cos(angle) - p[1] * Math.sin(angle),
    y = p[0] * Math.sin(angle) + p[1] * Math.cos(angle)
  return [(x - y) * Math.cos(Math.PI / 6), -(x + y) * 0.5 - p[2]]
}
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
  options?: { model?: boolean }
): Drawing {
  const model = options?.model === true
  return renderIso(doc, spool, view, model ? 1100 : sheetWidth(doc), SHEET_HEIGHT, model ? null : sheetFrame, hold, model)
}
export function drawingSvg(
  d: Drawing,
  selected = '',
  interactive = false,
  grid?: { settings: GridSettings; anchor: Vec3; units?: IsoDocument['units'] }
): string {
  const shape = (p: Primitive) => {
    const attrs = `data-owner="${escape(p.owner ?? '')}" class="${p.layer.toLowerCase()}${p.owner === selected ? ' selected' : ''}"`
    if (p.type === 'image')
      return `<image ${attrs} x="${p.p[0]}" y="${p.p[1]}" width="${p.width}" height="${p.height}" href="${escape(p.href)}" preserveAspectRatio="xMidYMid meet"/>`
    const width = weightOf(p)
    if (p.type === 'line')
      return `<line ${attrs} x1="${p.a[0]}" y1="${p.a[1]}" x2="${p.b[0]}" y2="${p.b[1]}" stroke-width="${width}"/>`
    if (p.type === 'polyline') {
      const points = p.points.map(q => q.join(',')).join(' ')
      return `<${p.closed || p.fill ? 'polygon' : 'polyline'} ${attrs} points="${points}" stroke-width="${width}" fill="${p.fill ? 'currentColor' : 'none'}" stroke-linejoin="round"/>`
    }
    if (p.type === 'circle')
      return `<circle ${attrs} cx="${p.p[0]}" cy="${p.p[1]}" r="${p.r}" stroke-width="${width}" fill="${p.fill ? 'currentColor' : 'white'}"/>`
    if (d.lettering === 'cad')
      return `<path ${attrs} d="${strokeTextPath(p.text, { at: p.p, size: p.size, rotation: p.rotation, oblique: p.oblique, anchor: p.anchor, width: p.width })}" fill="none" stroke-width="${Math.max(0.35, p.size * 0.1)}" stroke-linecap="round" stroke-linejoin="round" data-text="${escape(p.text)}"/>`
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.width} ${d.height}" role="img" aria-label="Piping isometric drawing" style="background:white;color:#111"><style>text{font-family:Arial,sans-serif;fill:#111}line,circle,path,polyline,polygon{stroke:#111;stroke-linecap:round}.selected{stroke:#087fbe;color:#087fbe}text.selected{fill:#087fbe}.node-hit{cursor:pointer;stroke:none!important}.iso-grid-line{stroke:#c6dbea;stroke-width:0.6}.iso-grid-line.major{stroke:#a5c8df;stroke-width:0.85}.iso-grid-caption{fill:#4f7289}.grid-cursor{stroke:#087fbe;fill:#087fbe;pointer-events:none}text{user-select:none}</style>${interactive && grid ? gridSvg(d, grid.anchor, grid.settings, grid.units) : ''}${d.primitives.map(shape).join('')}${hits}${interactive ? '<g data-grid-cursor pointer-events="none"></g>' : ''}</svg>`
}
