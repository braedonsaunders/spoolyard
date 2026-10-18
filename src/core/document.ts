/**
 * Reading drawings (.piping, PCF with or without its .piping sidecar, a ZIP of them, Spoolyard DXF) and writing the sheet as an AutoCAD R2000 (AC1015) DXF.
 *
 * The DXF is a complete R2000 file: HEADER, CLASSES, TABLES (VPORT, LTYPE, LAYER, STYLE, VIEW, UCS, APPID, DIMSTYLE,
 * BLOCK_RECORD), BLOCKS (*Model_Space, *Paper_Space and the symbol definitions), ENTITIES owned by model space, and
 * OBJECTS (root dictionary, ACAD_GROUP with one group per drawn item, ACAD_LAYOUT, ACAD_PLOTSTYLENAME,
 * ACAD_WIPEOUT_VARS and the Spoolyard model). The sheet is drawn at 1:1 on its paper, in inches on imperial drawings
 * and millimetres on metric ones, with its lower-left corner at the origin, so it plots and references at full size.
 *
 * Every drawn symbol instance (`Primitive.symbol`: valves, flanges, welds, flow arrows, instruments, the north arrow,
 * the title block and the material list) is an INSERT of a block defined once per distinct geometry, in the
 * instance's own frame. Lettering that prints a field (`Primitive.field`: title-block bindings, revisions, material
 * list cells, instrument tags) is an attribute: an ATTDEF in the definition and the instance's value as an ATTRIB.
 * Dashed linework (`Primitive.linetype`) is one entity in the standard linetype, scaled (group 48) to print the
 * sheet's dash lengths with LTSCALE 1. Arcs are ARCs and circles CIRCLEs. Raster logos cannot be embedded in a DXF
 * (an IMAGE refers to an external file), so a logo is exported as its frame and name for the drafter to re-attach;
 * white masks under circles and note boxes are WIPEOUTs, as in the PDF and SVG.
 */
import { type IsoDocument, parseIsoJson } from './model'
import { LINETYPE_SCALE, arcPoint, arcSweep, createDrawing, drawingSheets, layerWeights, weightOf, type Drawing, type Linetype, type Point, type Primitive } from './drawing'
import { draftingSizes } from './iso/context'
import { LINE_SPACING, ROMANS_WIDTH_FACTOR, measureText } from './stroke-font'
import { importPcf, type PcfImportOptions } from './pcf'
import { decodeText } from './text-encoding'
import { isZip, unzip } from './zip'
import { PAPER_MM } from './paper'
import { lineweight, penMm } from './pens'

// ---------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------

export interface IsometricFile {
  doc: IsoDocument
  /** What the file could not carry exactly (PCF mapping, CAD edits since export, logos); show these to the drafter. */
  warnings: string[]
  format: 'piping' | 'pcf' | 'dxf'
}
/**
 * The drawing model is stored in an XRECORD: SPOOLYARD/SPOOLYARD_PIPING now, MLIGHT_XRECORD/BIDWRIGHT_PIPING_V1 in
 * earlier releases. The reader finds it by its content, so every release's DXF opens.
 */

/**
 * Read a Spoolyard .piping file, a PCF, or a DXF exported by Spoolyard (any release), with what the reader had to
 * warn about.
 */
export function readIsometricFile(content: string, options: { pcf?: PcfImportOptions } = {}): IsometricFile {
  const text = content.replace(/^﻿/, '')
  if (text.trimStart().startsWith('{')) return { doc: parseIsoJson(text), warnings: [], format: 'piping' }
  if (/^UNITS-CO-ORDS\s+/im.test(text) && /^UNITS-BORE\s+/im.test(text)) return { ...importPcf(text, options.pcf), format: 'pcf' }
  const records = dxfRecords(text)
  let model: IsoDocument | undefined, exported: ExportInfo | undefined
  for (const r of records) {
    if (r[0]?.[1] !== 'XRECORD') continue
    const encoded = r.filter(([code]) => code === 1).map(([, value]) => value).join('')
    let value: string
    try {
      value = decodeURIComponent(encoded)
    } catch {
      continue
    }
    if (!model && value.includes('"bidwright-piping"')) model = parseIsoJson(value)
    else if (!exported && value.includes('"spoolyardExport"')) {
      try {
        exported = JSON.parse(value).spoolyardExport
      } catch {}
    }
  }
  if (!model)
    throw new Error('This drawing has no measured piping model. Import a Spoolyard .piping file, a PCF, or a DXF exported by Spoolyard.')
  const warnings: string[] = []
  if (exported) {
    const now = geometryDigest([...entityRecords(records), ...blockRecords(records)])
    if (now.digest !== exported.geometry)
      warnings.push('The CAD geometry was changed after Spoolyard exported this DXF. Spoolyard opened the piping model stored with it; CAD-only edits are not part of the drawing.')
    if (exported.logos?.length)
      warnings.push(`Title-block logos are not stored in DXF (${exported.logos.join(', ')}). Attach them again in the title block.`)
  }
  return { doc: model, warnings, format: 'dxf' }
}
/** A file chosen to open or import, as its bytes (a ZIP is binary; text files are decoded by `decodeText`). */
export interface ChosenFile { name: string; bytes: Uint8Array }
/** What the chosen files come to: one drawing's text, and the `.piping` sidecar that goes with a PCF. */
export interface DrawingPackage {
  /** The drawing file's own name (the PCF's, when a ZIP or a PCF and its sidecar were chosen). */
  name: string
  content: string
  /** The `.piping` sidecar of a PCF, which restores what the PCF does not carry (see exportPcfPackage). */
  sidecar?: string
}
const PACKAGE_EXTENSION = /\.(piping|json|pcf|dxf)$/i
const isPcfText = (text: string) => /^UNITS-CO-ORDS\s+/im.test(text) && /^UNITS-BORE\s+/im.test(text)
const isPipingText = (text: string) => text.replace(/^﻿/, '').trimStart().startsWith('{')
const stem = (name: string) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').toLowerCase()
/**
 * The drawing in the files chosen: one .piping, PCF or DXF; a PCF with its .piping sidecar chosen beside it; or a ZIP
 * of them (the "PCF with its .piping sidecar" export). A sidecar is matched to its PCF by name when there are several.
 */
export async function drawingPackage(files: ChosenFile[]): Promise<DrawingPackage> {
  const entries: Array<{ name: string; text: string }> = []
  for (const file of files) {
    if (isZip(file.bytes)) {
      for (const entry of await unzip(file.bytes)) {
        const base = entry.name.replace(/^.*\//, '')
        // Finder and Explorer metadata, and anything that is not a drawing file, are not part of the package.
        if (/^__MACOSX\//.test(entry.name) || base.startsWith('.') || !PACKAGE_EXTENSION.test(base)) continue
        entries.push({ name: base, text: decodeText(entry.content).text })
      }
    } else entries.push({ name: file.name.replace(/^.*[\\/]/, ''), text: decodeText(file.bytes).text })
  }
  if (!entries.length) throw new Error('Choose a .piping drawing, a PCF (with its .piping sidecar if it has one), a DXF exported by Spoolyard, or a ZIP of them.')
  if (entries.length === 1) return { name: entries[0].name, content: entries[0].text }
  const pcfs = entries.filter(e => isPcfText(e.text)), pipings = entries.filter(e => isPipingText(e.text))
  if (pcfs.length !== 1 || entries.length !== 1 + pipings.length)
    throw new Error('Choose one drawing, or one PCF with its .piping sidecar.')
  const pcf = pcfs[0], sidecar = pipings.length === 1 ? pipings[0] : pipings.find(p => stem(p.name) === stem(pcf.name))
  if (!sidecar) throw new Error(`Several .piping files were chosen with ${pcf.name}; choose the one exported with it.`)
  return { name: pcf.name, content: pcf.text, sidecar: sidecar.text }
}
/** Read the drawing in the files chosen (see drawingPackage), with what the reader had to warn about. */
export async function readIsometricFiles(files: ChosenFile[], options: { pcf?: PcfImportOptions } = {}): Promise<IsometricFile & { name: string }> {
  const chosen = await drawingPackage(files)
  const file = readIsometricFile(chosen.content, chosen.sidecar == null ? options : { pcf: { ...options.pcf, sidecar: chosen.sidecar } })
  return { ...file, name: chosen.name }
}

/** Read the original CAD extension record as well as standalone .piping JSON and PCF. */
export function readIsometric(content: string): IsoDocument {
  return readIsometricFile(content).doc
}

type Pair = [number, string]
/** Group-code pairs of a DXF, split into records at each group 0. */
function dxfRecords(text: string): Pair[][] {
  const lines = text.split(/\r?\n/),
    records: Pair[][] = []
  let record: Pair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim()),
      value = lines[i + 1].trim()
    if (code === 0) {
      if (record.length) records.push(record)
      record = []
    }
    record.push([code, value])
  }
  if (record.length) records.push(record)
  return records
}
/** The records of the ENTITIES section. */
function entityRecords(records: Pair[][]): Pair[][] {
  const start = records.findIndex(r => r[0]?.[1] === 'SECTION' && r.some(([c, v]) => c === 2 && v === 'ENTITIES'))
  if (start < 0) return []
  const end = records.findIndex((r, i) => i > start && r[0]?.[1] === 'ENDSEC')
  return records.slice(start + 1, end < 0 ? undefined : end)
}
/** The entity records of the named block definitions (not model or paper space) in the BLOCKS section. */
function blockRecords(records: Pair[][]): Pair[][] {
  const start = records.findIndex(r => r[0]?.[1] === 'SECTION' && r.some(([c, v]) => c === 2 && v === 'BLOCKS'))
  if (start < 0) return []
  const out: Pair[][] = []
  let inside = false
  for (let i = start + 1; i < records.length && records[i][0]?.[1] !== 'ENDSEC'; i++) {
    const type = records[i][0]?.[1]
    if (type === 'BLOCK') inside = !String(records[i].find(([c]) => c === 2)?.[1] ?? '*').startsWith('*')
    else if (type === 'ENDBLK') inside = false
    else if (inside) out.push(records[i])
  }
  return out
}
interface ExportInfo { geometry: string; entities: number; logos?: string[] }
/**
 * A fingerprint of the drawn geometry that survives a CAD program re-saving the file: entity types, layers, line,
 * circle and polyline coordinates (to 0.001 drawing unit) and text, in any order and with any handles.
 */
function geometryDigest(records: Array<Array<[number, string | number]>>): { digest: string; count: number } {
  const signatures: string[] = []
  for (const r of records) {
    const type = String(r[0]?.[1] ?? '')
    if (!type || type === 'ENDSEC' || type === 'SEQEND' || type === 'VERTEX') continue
    // Values compare trimmed: readers (this one included) drop the padding around a group value.
    const get = (code: number) => r.filter(([c]) => c === code).map(([, v]) => String(v).trim())
    const num = (v: string | number) => (Math.round(Number(v) * 1000) / 1000 || 0).toFixed(3)
    const coords = (...codes: number[]) => r.filter(([c]) => codes.includes(c)).map(([, v]) => num(v)).join(' ')
    const layer = String(get(8)[0] ?? '0')
    let detail = ''
    if (type === 'LINE') detail = coords(10, 20, 11, 21)
    else if (type === 'CIRCLE') detail = coords(10, 20, 40)
    else if (type === 'ARC') detail = coords(10, 20, 40, 50, 51)
    else if (type === 'LWPOLYLINE') detail = coords(10, 20)
    else if (type === 'TEXT' || type === 'ATTRIB' || type === 'ATTDEF') detail = [...get(2), ...get(1), Number(get(72)[0] ?? 0) ? coords(11, 21) : coords(10, 20)].join(' ')
    else if (type === 'INSERT') detail = [...get(2), coords(10, 20, 41, 50)].join(' ')
    else if (type === 'MTEXT') detail = [...get(3), ...get(1)].join('')
    signatures.push(`${type}|${layer}|${detail}`)
  }
  signatures.sort()
  // FNV-1a, 32 bit: a change detector, not a security measure.
  let hash = 0x811c9dc5
  for (const ch of signatures.join('\n')) {
    hash ^= ch.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return { digest: `${signatures.length}:${hash.toString(16).padStart(8, '0')}`, count: signatures.length }
}

// ---------------------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------------------

export type DxfLinetype = 'CONTINUOUS' | 'DASHED' | 'HIDDEN' | 'CENTER' | 'PHANTOM'
/** A layer's pen: AutoCAD colour index, linetype, lineweight (mm) and whether it plots. */
export interface DxfLayerStyle {
  color: number
  linetype: DxfLinetype
  /** Pen width in printed millimetres; by default the layer's drafting weight. */
  lineweight?: number
  plot: boolean
}
export interface DxfOptions {
  /** Prefix of every layer name, e.g. "ISO-" (default) or a company's layer standard. */
  layerPrefix?: string
  /** Pen table by drawing layer (PIPE, DIM, SYMBOL, TITLE…); unset fields keep the defaults. */
  layers?: Record<string, Partial<DxfLayerStyle>>
  /** Store the Spoolyard piping model in the DXF so Spoolyard can reopen it (default true). */
  snapshot?: boolean
  /** White masks as WIPEOUT entities (default true). */
  wipeouts?: boolean
  /**
   * Drawn symbols, the title block and the material list as block definitions and INSERTs, their fields as
   * attributes (default true); false writes every primitive as entities of its own.
   */
  blocks?: boolean
  /**
   * `sheet` (default): the drawing is a sheet, written 1:1 on its paper. `model`: a model-space view
   * (createDrawing(…, { model: true })), written at true size, 1 unit = 1 mm or 1 inch of plant.
   */
  space?: 'sheet' | 'model'
}
export const DXF_LAYER_PREFIX = 'ISO-'
/** Default pens: every layer prints black (ACI 7) and continuous, at its drafting weight, like the PDF. */
export const DXF_DEFAULT_LAYER: DxfLayerStyle = { color: 7, linetype: 'CONTINUOUS', plot: true }
const DXF_LAYER_DEFAULTS: Record<string, Partial<DxfLayerStyle>> = { GRID: { color: 8, plot: false }, MARKUP: { color: 1 } }
/** Linetype patterns, per drawing unit: acad.lin (inches) and acadiso.lin (millimetres). */
const LINETYPES: Record<Exclude<DxfLinetype, 'CONTINUOUS'>, { text: string; inches: number[] }> = {
  DASHED: { text: 'Dashed __ __ __ __', inches: [0.5, -0.25] },
  HIDDEN: { text: 'Hidden __ __ __ __', inches: [0.25, -0.125] },
  CENTER: { text: 'Center ____ _ ____ _', inches: [1.25, -0.25, 0.25, -0.25] },
  PHANTOM: { text: 'Phantom ______  __  __', inches: [1.25, -0.25, 0.25, -0.25, 0.25, -0.25] }
}
/** The standard linetype each primitive linetype is drawn in. */
const PRIMITIVE_LINETYPES: Record<Linetype, Exclude<DxfLinetype, 'CONTINUOUS'>> = { dashed: 'DASHED', hidden: 'HIDDEN', center: 'CENTER', phantom: 'PHANTOM' }
/** DXF $INSUNITS codes. */
const INSUNITS = { imperial: 1, mm: 4 } as const
/** Plot-device media names (DWG To PDF.pc3) of each paper. */
const MEDIA = {
  letter: 'ANSI_A_(11.00_x_8.50_Inches)',
  tabloid: 'ANSI_B_(17.00_x_11.00_Inches)',
  a3: 'ISO_full_bleed_A3_(420.00_x_297.00_MM)',
  a4: 'ISO_full_bleed_A4_(297.00_x_210.00_MM)'
} as const
/** Drafting symbols as TEXT control codes, and the typographic marks the SHX fonts lack as the stroke lettering draws them. */
const DXF_CHARS: Record<string, string> = {
  '°': '%%d', '±': '%%p', '⌀': '%%c', '′': "'", '’': "'", '‘': "'", '″': '"', '“': '"', '”': '"', '–': '-', '—': '-',
  '−': '-', ' ': ' ', '\t': ' ', '½': '1/2', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'
}
/** Longest TEXT value AutoCAD keeps; a longer line is written as MTEXT, whose value is split into 250-character groups. */
const TEXT_LIMIT = 250
/** A line of text as DXF tokens, one per character: literal %% kept, symbols as control codes, other Unicode as \U+ escapes. */
const dxfTokens = (s: string, mtext = false) =>
  [...s].map(ch => {
    const code = ch.codePointAt(0)!
    if (mtext && (ch === '\\' || ch === '{' || ch === '}')) return '\\' + ch
    return DXF_CHARS[ch] ?? (code < 32 ? '' : code < 127 ? ch : code > 0xffff ? '?' : '\\U+' + code.toString(16).toUpperCase().padStart(4, '0'))
  })
/** A literal "%%" stays literal: "%%%" is AutoCAD's escaped percent sign. */
const literalPercent = (s: string) => s.replace(/%%/g, '%%%%%%')
/** A TEXT value. */
const dxfText = (s: string) => dxfTokens(literalPercent(s)).join('')
/** The nearest AutoCAD colour index to a #RRGGBB colour, for R2000 readers that ignore true colour. */
function nearestAci(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  if (Math.max(r, g, b) - Math.min(r, g, b) < 24) return r < 96 || r > 224 ? 7 : r < 160 ? 8 : 9
  const palette: Array<[number, number, number, number]> = [[1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [30, 255, 127, 0]]
  return palette.reduce((best, p) => ((p[1] - r) ** 2 + (p[2] - g) ** 2 + (p[3] - b) ** 2 < (best[1] - r) ** 2 + (best[2] - g) ** 2 + (best[3] - b) ** 2 ? p : best))[0]
}
const isWhite = (color?: string) => !!color && /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(color)

/**
 * The sheet (or `drawing`) as an AutoCAD R2000 DXF, with the Spoolyard model stored in it so Spoolyard reopens the
 * measured piping. See the module comment for its structure.
 */
export function isometricDxf(doc: IsoDocument, drawing: Drawing = createDrawing(doc), options: DxfOptions = {}): string {
  const prefix = options.layerPrefix ?? DXF_LAYER_PREFIX, wipeouts = options.wipeouts !== false, blocks = options.blocks !== false
  const paperSize = doc.paper ?? 'tabloid', paperMm = PAPER_MM[paperSize].height
  // Drawing units per sheet unit: paper millimetres on the sheet, or plant millimetres through the view's scale.
  const unit = doc.units === 'imperial' ? 25.4 : 1, k = options.space === 'model' ? 1 / drawing.fit.scale / unit : paperMm / unit / drawing.height
  const paper = (v: number) => Number((v * k).toFixed(6))
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]
  const track = (x: number, y: number) => {
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y)
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y)
  }
  // Sheet units with y down to drawing units with y up from the sheet's lower-left corner.
  const X = (x: number) => paper(x), Y = (y: number) => paper(drawing.height - y)
  const width = paper(drawing.width), height = paper(drawing.height)

  let seed = 1
  const handle = () => (seed++).toString(16).toUpperCase()
  const H = {
    root: handle(), groups: handle(), layouts: handle(), plotStyles: handle(), normal: handle(), wipeoutVars: handle(), own: handle(),
    snapshot: handle(), info: handle(),
    vports: handle(), ltypes: handle(), layers: handle(), styles: handle(), views: handle(), ucs: handle(), appids: handle(), dimstyles: handle(),
    blockRecords: handle(), modelRecord: handle(), paperRecord: handle(), modelLayout: handle(), paperLayout: handle(),
    modelBlock: handle(), modelEnd: handle(), paperBlock: handle(), paperEnd: handle()
  }

  // Layers and their pens: the drawing's own weights for its paper, printed at that paper's size.
  const cad = drawing.lettering === 'cad', weights = drawing.weights ?? layerWeights(doc)
  const used = [...new Set(drawing.primitives.map(p => p.type === 'image' ? 'TITLE' : p.layer))]
  const style = (layer: string): DxfLayerStyle => {
    const s = { ...DXF_DEFAULT_LAYER, ...DXF_LAYER_DEFAULTS[layer], ...options.layers?.[layer] }
    return { ...s, lineweight: s.lineweight ?? penMm(weights[layer] ?? weights.TITLE, paperSize) }
  }
  const layerName = (layer: string) => (prefix + layer).replace(/[<>/\\":;?*|=`]/g, '_')
  const linetypesUsed = new Set<DxfLinetype>([
    ...used.map(l => style(l).linetype),
    ...drawing.primitives.flatMap(p => 'linetype' in p && p.linetype && PRIMITIVE_LINETYPES[p.linetype] ? [PRIMITIVE_LINETYPES[p.linetype]] : [])
  ])

  const out: Array<string | number> = []
  const put = (...pairs: Array<string | number>) => { out.push(...pairs) }

  // ENTITIES, collected as records so the geometry fingerprint is taken from exactly what is written. Entities are
  // written into a sink: model space, or a block definition in the block's own coordinates (`local`).
  type Rec = Array<[number, string | number]>
  interface Local { origin: [number, number]; cos: number; sin: number; inv: number; turn: number }
  interface Sink { records: Rec[]; owner: string; grouped: boolean; local?: Local }
  const entities: Rec[] = []
  const modelSink: Sink = { records: entities, owner: H.modelRecord, grouped: true }
  let sink = modelSink
  const owners = new Map<string, string[]>()
  let current: Rec = []
  let owner: string | undefined, color: string | undefined
  const pairs = (...values: Array<string | number>) => {
    for (let i = 0; i + 1 < values.length; i += 2) current.push([Number(values[i]), values[i + 1]])
  }
  /** Sheet point to drawing coordinates, counted in the extents. */
  const W = (q: Point): [number, number] => {
    const at: [number, number] = [X(q[0]), Y(q[1])]
    track(...at)
    return at
  }
  /** Drawing coordinates in the sink: as they are in model space, else relative to the block's insertion. */
  const L = (w: [number, number]): [number, number] => {
    const l = sink.local
    if (!l) return w
    const dx = w[0] - l.origin[0], dy = w[1] - l.origin[1]
    return [Number(((dx * l.cos + dy * l.sin) * l.inv).toFixed(6)), Number(((dy * l.cos - dx * l.sin) * l.inv).toFixed(6))]
  }
  const XY = (q: Point) => L(W(q))
  /** A sheet length in the sink's units. */
  const size = (v: number) => (sink.local ? Number((v * k * sink.local.inv).toFixed(6)) : paper(v))
  /** A sheet angle (degrees counter-clockwise on the page) in the sink. */
  const turn = (deg: number) => (sink.local ? deg - sink.local.turn : deg)
  const norm = (v: number) => Number(((((v % 360) + 360) % 360)).toFixed(6))
  // Primitive linetypes are the standard patterns at the scale that prints them at their sheet sizes.
  const sheetMm = draftingSizes(doc).mm, linetypeScale = Number((LINETYPE_SCALE * sheetMm * k * unit).toFixed(6))
  const entity = (type: string, layer: string, weight?: number, linetype?: Linetype) => {
    const h = handle()
    current = [[0, type], [5, h]]
    sink.records.push(current)
    if (owner && sink.grouped) owners.set(owner, [...(owners.get(owner) ?? []), h])
    pairs(330, sink.owner, 100, 'AcDbEntity', 8, layerName(layer))
    if (linetype) pairs(6, PRIMITIVE_LINETYPES[linetype])
    if (weight != null) {
      const lw = lineweight(penMm(weight, paperSize))
      if (lw !== lineweight(style(layer).lineweight!)) pairs(370, lw)
    }
    if (color) pairs(62, nearestAci(color), 420, parseInt(color.slice(1), 16))
    if (linetype && linetypeScale !== 1) pairs(48, linetypeScale)
    return h
  }
  const polyline = (points: Point[], closed: boolean, layer: string, weight: number, linetype?: Linetype) => {
    entity('LWPOLYLINE', layer, weight, linetype)
    // A patterned polyline runs its pattern on round its vertices (PLINEGEN), as the sheet draws it.
    pairs(100, 'AcDbPolyline', 90, points.length, 70, (closed ? 1 : 0) | (linetype ? 128 : 0))
    for (const q of points) {
      const [x, y] = XY(q)
      pairs(10, x, 20, y)
    }
  }
  const hatch = (layer: string, boundary: Array<string | number>, seedPoint: Point) => {
    entity('HATCH', layer)
    pairs(100, 'AcDbHatch', 10, 0, 20, 0, 30, 0, 210, 0, 220, 0, 230, 1, 2, 'SOLID', 70, 1, 71, 0, 91, 1, ...boundary)
    const [sx, sy] = XY(seedPoint)
    pairs(97, 0, 75, 0, 76, 1, 98, 1, 10, sx, 20, sy)
  }
  /** A white mask over what is drawn before it, the polygon `points` (sheet units). */
  const wipeout = (points: Point[], layer: string) => {
    const at = points.map(XY), xs = at.map(p => p[0]), ys = at.map(p => p[1])
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], w = x1 - x0 || 1e-6, h = y1 - y0 || 1e-6
    entity('WIPEOUT', layer)
    pairs(100, 'AcDbWipeout', 90, 0, 10, x0, 20, y0, 30, 0, 11, w, 21, 0, 31, 0, 12, 0, 22, h, 32, 0, 13, 1, 23, 1, 340, 0, 70, 7, 280, 1, 281, 50, 282, 50, 283, 0, 360, 0, 71, 2, 91, at.length + 1)
    for (const [x, y] of [...at, at[0]]) pairs(14, Number(((x - x0) / w - 0.5).toFixed(6)), 24, Number((0.5 - (y - y0) / h).toFixed(6)))
  }
  /**
   * One TEXT per line, stacked and slanted like the stroke lettering; middle/end text keeps its anchor as the
   * alignment point. As an attribute (`attribute`), each line is an ATTDEF (in a block) or ATTRIB (after its insert)
   * tagged `tag`, `tag_2`, ….
   */
  const text = (at: Point, value: string, size_: number, layer: string, rotation = 0, oblique = 0, anchor = 'start', factor = 1, textCad = cad,
    attribute?: { kind: 'ATTDEF' | 'ATTRIB'; tag: string; prompt?: string }) => {
    const angle = (rotation * Math.PI) / 180, cos = Math.cos(angle), sin = Math.sin(angle), slant = Math.tan((oblique * Math.PI) / 180)
    const widthFactor = (textCad ? ROMANS_WIDTH_FACTOR : 1) * factor, written = norm(turn(rotation))
    let rows = 0
    value.split(/\r?\n/).forEach((line, row) => {
      if (!line.trim()) return
      const v = row * LINE_SPACING * size_,
        base: Point = [at[0] - v * slant * cos + v * sin, at[1] + v * slant * sin + v * cos],
        shift = anchor === 'middle' ? 0.5 : anchor === 'end' ? 1 : 0,
        offset = measureText(line, size_, (textCad ? 1 : 1 / ROMANS_WIDTH_FACTOR) * factor) * shift,
        start: Point = [base[0] - offset * cos, base[1] + offset * sin]
      const content = dxfText(line)
      if (content.length <= TEXT_LIMIT) {
        entity(attribute?.kind ?? 'TEXT', layer)
        const [sx, sy] = XY(start)
        pairs(100, 'AcDbText', 10, sx, 20, sy, 30, 0, 40, size(size_), 1, content)
        if (written) pairs(50, written)
        if (widthFactor !== 1) pairs(41, widthFactor)
        if (oblique) pairs(51, Math.max(-85, Math.min(85, oblique)))
        pairs(7, textCad ? 'ROMANS' : 'STANDARD')
        if (shift) {
          const [bx, by] = XY(base)
          pairs(72, shift === 1 ? 2 : 1, 11, bx, 21, by, 31, 0)
        }
        if (!attribute) pairs(100, 'AcDbText', 73, 0)
        else {
          const tag = rows++ ? `${attribute.tag}_${rows}` : attribute.tag
          if (attribute.kind === 'ATTDEF') pairs(100, 'AcDbAttributeDefinition', 3, attribute.prompt ?? tag, 2, tag, 70, 0, 73, 0, 74, 0)
          else pairs(100, 'AcDbAttribute', 2, tag, 70, 0, 73, 0, 74, 0)
        }
        return
      }
      // MTEXT for a line longer than a TEXT holds: its width factor and slant as format codes, split into 250-character groups.
      const tokens = [...(widthFactor !== 1 ? [`\\W${widthFactor};`] : []), ...(oblique ? [`\\Q${Math.max(-85, Math.min(85, oblique))};`] : []), ...dxfTokens(literalPercent(line), true)]
      const chunks: string[] = []
      let chunk = ''
      for (const t of tokens) {
        if (chunk.length + t.length > TEXT_LIMIT) { chunks.push(chunk); chunk = '' }
        chunk += t
      }
      entity('MTEXT', layer)
      const [bx, by] = XY(base), local = (written * Math.PI) / 180
      pairs(100, 'AcDbMText', 10, bx, 20, by, 30, 0, 40, size(size_), 71, shift === 0.5 ? 8 : shift === 1 ? 9 : 7, 72, 1)
      for (const c of chunks) pairs(3, c)
      pairs(1, chunk, 7, textCad ? 'ROMANS' : 'STANDARD', 11, Number(Math.cos(local).toFixed(9)), 21, Number(Math.sin(local).toFixed(9)), 31, 0)
    })
  }
  const circleEdge = (p: Point, r: number, n = 24): Point[] => Array.from({ length: n }, (_, i) => [p[0] + r * Math.cos((2 * Math.PI * i) / n), p[1] + r * Math.sin((2 * Math.PI * i) / n)])
  const logos: string[] = []
  type TextPrimitive = Extract<Primitive, { type: 'text' }>
  const textCadOf = (p: TextPrimitive) => (p.lettering == null ? cad : p.lettering === 'cad')
  const letter = (p: TextPrimitive, attribute?: Parameters<typeof text>[9]) =>
    text(p.p, p.text, p.size, p.layer, p.rotation, p.oblique, p.anchor, p.width ?? 1, textCadOf(p), attribute)
  /** One primitive as entities in the current sink. */
  const draw = (p: Primitive) => {
    owner = p.owner
    color = p.color && !isWhite(p.color) ? p.color : undefined
    if (p.type === 'line') {
      entity('LINE', p.layer, weightOf(p, weights), p.linetype)
      const [ax, ay] = XY(p.a), [bx, by] = XY(p.b)
      pairs(100, 'AcDbLine', 10, ax, 20, ay, 30, 0, 11, bx, 21, by, 31, 0)
    } else if (p.type === 'polyline') {
      if (p.points.length < 2) return
      // A white fill is a mask (a note's box background), not ink.
      if (p.fill && isWhite(p.color)) {
        if (wipeouts && p.points.length > 2) wipeout(p.points, p.layer)
        return
      }
      polyline(p.points, !!(p.closed || p.fill), p.layer, weightOf(p, weights), p.linetype)
      if (p.fill && p.points.length > 2)
        hatch(p.layer, [92, 3, 72, 0, 73, 1, 93, p.points.length, ...p.points.flatMap(q => { const [x, y] = XY(q); return [10, x, 20, y] })], [
          p.points.reduce((s, q) => s + q[0], 0) / p.points.length,
          p.points.reduce((s, q) => s + q[1], 0) / p.points.length
        ])
    } else if (p.type === 'circle') {
      // An open circle is drawn over a white disc, as in the SVG and PDF.
      if (!p.fill && wipeouts) wipeout(circleEdge(p.p, p.r), p.layer)
      entity('CIRCLE', p.layer, weightOf(p, weights), p.linetype)
      const centre = W(p.p), [cx, cy] = L(centre)
      track(centre[0] - paper(p.r), centre[1] - paper(p.r)); track(centre[0] + paper(p.r), centre[1] + paper(p.r))
      pairs(100, 'AcDbCircle', 10, cx, 20, cy, 30, 0, 40, size(p.r))
      if (p.fill) hatch(p.layer, [92, 1, 93, 1, 72, 2, 10, cx, 20, cy, 40, size(p.r), 50, 0, 51, 360, 73, 1], p.p)
    } else if (p.type === 'arc') {
      const sweep = arcSweep(p), [cx, cy] = XY(p.p)
      for (let a = 0; a <= sweep; a += Math.max(1, sweep / 16)) W(arcPoint(p.p, p.r, p.start + a))
      entity(sweep >= 360 ? 'CIRCLE' : 'ARC', p.layer, weightOf(p, weights), p.linetype)
      pairs(100, 'AcDbCircle', 10, cx, 20, cy, 30, 0, 40, size(p.r))
      // Angles are counter-clockwise on the page in both the sheet and the drawing's y-up plane.
      if (sweep < 360) pairs(100, 'AcDbArc', 50, norm(turn(p.start)), 51, norm(turn(p.start) + sweep))
    } else if (p.type === 'text') letter(p)
    else {
      // A DXF cannot embed a raster (IMAGE refers to an external file): a logo is its frame and name to re-attach.
      const [x, y] = p.p,
        name = doc.titleBlock?.logos.find(logo => logo.dataUrl === p.href)?.name || 'LOGO',
        size = Math.max(1, Math.min(p.height * 0.3, (p.width * 0.85) / Math.max(1e-9, measureText(name, 1))))
      logos.push(name)
      polyline([[x, y], [x + p.width, y], [x + p.width, y + p.height], [x, y + p.height]], true, 'TITLE', weights.TITLE)
      text([x + p.width / 2, y + (p.height + size) / 2], name, size, 'TITLE', 0, 0, 'middle')
    }
  }

  // Symbols (and the title block and material list) as blocks: one definition per distinct drawn geometry, in the
  // instance's own frame (its insertion point, turn and scale), and one INSERT per instance. Lettering that prints a
  // field is an attribute: an ATTDEF in the definition, and the instance's value as an ATTRIB after its insert.
  interface BlockDef { name: string; record: string; begin: string; end: string; records: Rec[]; attributes: boolean }
  const blockDefs: BlockDef[] = [], byGeometry = new Map<string, BlockDef>(), nameCount = new Map<string, number>()
  const instanceKey = (p: Primitive) => p.symbol && blocks
    ? `${p.symbol.name}|${p.symbol.at[0]}|${p.symbol.at[1]}|${p.symbol.rotation}|${p.symbol.scale ?? 1}|${p.owner ?? ''}` : undefined
  /** An attribute holds one TEXT per line. */
  const attributable = (p: Primitive): p is TextPrimitive & { field: string } =>
    p.type === 'text' && !!p.field && p.text.split(/\r?\n/).every(l => dxfText(l).length <= TEXT_LIMIT)
  const tagOf = (field: string) => field.toUpperCase().replace(/#/g, '_').replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'FIELD'
  /** What makes two definitions the same: everything but handles, owners and attribute defaults and placement. */
  // Coordinates compare to a ten-thousandth of a drawing unit, so instances turned to the same frame match.
  const geometryKey = (records: Rec[]) => JSON.stringify(records.map(r => (r[0][1] === 'ATTDEF'
    ? r.filter(([c]) => c === 0 || c === 2 || c === 8)
    : r.filter(([c]) => c !== 5 && c !== 330)).map(([c, v]) => [c, typeof v === 'number' ? Math.round(v * 1e4) / 1e4 || 0 : v])))
  const insert = (members: Primitive[]) => {
    // The definition is in drawing units, at the instance's scale (a bubble drawn at radius r is scale r).
    const symbol = members[0].symbol!, origin = W(symbol.at), factor = symbol.scale ?? 1
    const radians = (symbol.rotation * Math.PI) / 180
    const local: Local = { origin, cos: Math.cos(radians), sin: Math.sin(radians), inv: 1 / factor, turn: symbol.rotation }
    // Tags are unique within the instance.
    const used = new Map<string, number>(), fields: Array<{ p: TextPrimitive; tag: string }> = []
    for (const p of members) if (attributable(p)) {
      const base = tagOf(p.field), n = (used.get(base) ?? 0) + 1
      used.set(base, n)
      fields.push({ p, tag: n > 1 ? `${base}_${n}` : base })
    }
    const definition: Sink = { records: [], owner: 'BLOCK', grouped: false, local }
    sink = definition
    for (const p of members) {
      const field = fields.find(f => f.p === p)
      if (!field) { draw(p); continue }
      owner = p.owner
      color = p.color && !isWhite(p.color) ? p.color : undefined
      letter(field.p, { kind: 'ATTDEF', tag: field.tag, prompt: field.p.field })
    }
    sink = modelSink
    const key = geometryKey(definition.records)
    let def = byGeometry.get(key)
    if (!def) {
      const base = symbol.name.toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'SYMBOL', n = (nameCount.get(base) ?? 0) + 1
      nameCount.set(base, n)
      def = { name: n > 1 ? `${base}-${n}` : base, record: handle(), begin: handle(), end: handle(), records: definition.records, attributes: fields.length > 0 }
      for (const r of def.records) for (const pair of r) if (pair[0] === 330 && pair[1] === 'BLOCK') pair[1] = def.record
      blockDefs.push(def)
      byGeometry.set(key, def)
    }
    owner = members[0].owner
    color = undefined
    const first = members.find(p => p.type !== 'text') ?? members[0], h = entity('INSERT', first.type === 'image' ? 'TITLE' : first.layer)
    pairs(100, 'AcDbBlockReference', ...(fields.length ? [66, 1] : []), 2, def.name, 10, origin[0], 20, origin[1], 30, 0)
    if (factor !== 1) pairs(41, Number(factor.toFixed(9)), 42, Number(factor.toFixed(9)), 43, Number(factor.toFixed(9)))
    if (norm(symbol.rotation)) pairs(50, norm(symbol.rotation))
    if (!fields.length) return
    sink = { records: entities, owner: h, grouped: false }
    for (const f of fields) {
      owner = f.p.owner
      color = f.p.color && !isWhite(f.p.color) ? f.p.color : undefined
      letter(f.p, { kind: 'ATTRIB', tag: f.tag })
    }
    color = undefined
    entity('SEQEND', first.type === 'image' ? 'TITLE' : first.layer)
    sink = modelSink
  }
  const instances = new Map<string, Primitive[]>()
  for (const p of drawing.primitives) {
    const key = instanceKey(p)
    if (key) instances.get(key)?.push(p) ?? instances.set(key, [p])
  }
  // Each instance is inserted where its first ink is drawn.
  for (const p of drawing.primitives) {
    const key = instanceKey(p)
    if (!key) draw(p)
    else if (instances.has(key)) { insert(instances.get(key)!); instances.delete(key) }
  }
  owner = color = undefined
  // Each drawn item (a pipe, a fitting's symbol and callouts, a note) is one group, selected and moved as a unit.
  const groups = [...owners].filter(([, members]) => members.length > 1).map(([key, members], i) => {
    const node = doc.nodes.find(n => n.id === key), run = doc.runs.find(r => r.id === key)
    const label = (node ? node.component ?? node.kind : run ? 'PIPE' : 'NOTE').toUpperCase().replace(/[^A-Z0-9-]/g, '-')
    return { name: `${label}-${i + 1}`, description: node?.tag || node?.description || run?.line || '', handle: handle(), members }
  })
  const groupOf = new Map(groups.flatMap(g => g.members.map(m => [m, g.handle] as const)))
  for (const e of entities) {
    const g = groupOf.get(String(e[1][1]))
    if (g) e.splice(2, 0, [102, '{ACAD_REACTORS'], [330, g], [102, '}'])
  }
  const digest = geometryDigest([...entities, ...blockDefs.flatMap(b => b.records)])

  // CLASSES
  put(0, 'SECTION', 2, 'CLASSES')
  for (const [name, cpp, app, flags, isEntity] of [
    ['ACDBDICTIONARYWDFLT', 'AcDbDictionaryWithDefault', 'ObjectDBX Classes', 0, 0],
    ['ACDBPLACEHOLDER', 'AcDbPlaceHolder', 'ObjectDBX Classes', 0, 0],
    ['LAYOUT', 'AcDbLayout', 'ObjectDBX Classes', 0, 0],
    ['WIPEOUTVARIABLES', 'AcDbWipeoutVariables', 'WipeOut|AutoCAD Express Tool|expresstools@autodesk.com', 0, 0],
    ['WIPEOUT', 'AcDbWipeout', 'WipeOut|AutoCAD Express Tool|expresstools@autodesk.com', 127, 1]
  ] as const)
    put(0, 'CLASS', 1, name, 2, cpp, 3, app, 90, flags, 280, 0, 281, isEntity)
  put(0, 'ENDSEC')

  // TABLES
  const table = (name: string, h: string, count: number, extra: Array<string | number> = []) =>
    put(0, 'TABLE', 2, name, 5, h, 330, 0, 100, 'AcDbSymbolTable', 70, count, ...extra)
  const record = (type: string, owner: string, subclass: string, name: string, flags = 0) =>
    put(0, type, 5, handle(), 330, owner, 100, 'AcDbSymbolTableRecord', 100, subclass, 2, name, 70, flags)
  put(0, 'SECTION', 2, 'TABLES')
  table('VPORT', H.vports, 1)
  record('VPORT', H.vports, 'AcDbViewportTableRecord', '*ACTIVE')
  put(10, 0, 20, 0, 11, 1, 21, 1, 12, width / 2, 22, height / 2, 13, 0, 23, 0, 14, 0.5, 24, 0.5, 15, 0.5, 25, 0.5, 16, 0, 26, 0, 36, 1,
    17, 0, 27, 0, 37, 0, 40, Number((height * 1.05).toFixed(6)), 41, Number((width / height).toFixed(6)), 42, 50, 43, 0, 44, 0, 50, 0, 51, 0,
    71, 0, 72, 1000, 73, 1, 74, 3, 75, 0, 76, 0, 77, 0, 78, 0, 281, 0, 65, 0, 146, 0)
  put(0, 'ENDTAB')
  const patterns = [...linetypesUsed].filter((l): l is Exclude<DxfLinetype, 'CONTINUOUS'> => l !== 'CONTINUOUS')
  table('LTYPE', H.ltypes, 3 + patterns.length)
  for (const [name, description] of [['ByBlock', ''], ['ByLayer', ''], ['Continuous', 'Solid line']]) {
    record('LTYPE', H.ltypes, 'AcDbLinetypeTableRecord', name)
    put(3, description, 72, 65, 73, 0, 40, 0)
  }
  for (const name of patterns) {
    const dashes = LINETYPES[name].inches.map(v => Number((v * 25.4 / unit).toFixed(6)))
    record('LTYPE', H.ltypes, 'AcDbLinetypeTableRecord', name)
    put(3, LINETYPES[name].text, 72, 65, 73, dashes.length, 40, Number(dashes.reduce((s, v) => s + Math.abs(v), 0).toFixed(6)))
    for (const d of dashes) put(49, d, 74, 0)
  }
  put(0, 'ENDTAB')
  table('LAYER', H.layers, used.length + 1)
  const layer = (name: string, s: DxfLayerStyle) => {
    record('LAYER', H.layers, 'AcDbLayerTableRecord', name)
    put(62, s.color, 6, s.linetype === 'CONTINUOUS' ? 'Continuous' : s.linetype, 290, s.plot ? 1 : 0, 370, lineweight(s.lineweight!), 390, H.normal)
  }
  layer('0', { ...DXF_DEFAULT_LAYER, lineweight: 0.25 })
  for (const l of used) layer(layerName(l), style(l))
  put(0, 'ENDTAB')
  table('STYLE', H.styles, 2)
  // ROMANS at width factor 0.8 is the single-stroke lettering every other output draws.
  for (const [name, font, factor] of [['STANDARD', 'txt', 1], ['ROMANS', 'romans.shx', ROMANS_WIDTH_FACTOR]] as const) {
    record('STYLE', H.styles, 'AcDbTextStyleTableRecord', name)
    put(40, 0, 41, factor, 50, 0, 71, 0, 42, 2.5, 3, font, 4, '')
  }
  put(0, 'ENDTAB')
  table('VIEW', H.views, 0)
  put(0, 'ENDTAB')
  table('UCS', H.ucs, 0)
  put(0, 'ENDTAB')
  table('APPID', H.appids, 1)
  record('APPID', H.appids, 'AcDbRegAppTableRecord', 'ACAD')
  put(0, 'ENDTAB')
  table('DIMSTYLE', H.dimstyles, 1, [100, 'AcDbDimStyleTable'])
  // DIMSTYLE records carry their handle in group 105. Spoolyard draws dimensions as lines and text.
  put(0, 'DIMSTYLE', 105, handle(), 330, H.dimstyles, 100, 'AcDbSymbolTableRecord', 100, 'AcDbDimStyleTableRecord', 2, 'Standard', 70, 0,
    40, 1, 41, Number((2.5 / unit).toFixed(6)), 42, Number((0.625 / unit).toFixed(6)), 43, Number((3.75 / unit).toFixed(6)), 44, Number((1.25 / unit).toFixed(6)),
    140, Number((2.5 / unit).toFixed(6)), 141, Number((2.5 / unit).toFixed(6)), 147, Number((0.625 / unit).toFixed(6)), 77, 1, 78, 8, 271, 2, 272, 2)
  put(0, 'ENDTAB')
  table('BLOCK_RECORD', H.blockRecords, 2 + blockDefs.length)
  put(0, 'BLOCK_RECORD', 5, H.modelRecord, 330, H.blockRecords, 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, '*Model_Space', 340, H.modelLayout)
  put(0, 'BLOCK_RECORD', 5, H.paperRecord, 330, H.blockRecords, 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, '*Paper_Space', 340, H.paperLayout)
  for (const b of blockDefs)
    put(0, 'BLOCK_RECORD', 5, b.record, 330, H.blockRecords, 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, b.name, 340, 0)
  put(0, 'ENDTAB', 0, 'ENDSEC')

  // BLOCKS
  put(0, 'SECTION', 2, 'BLOCKS')
  for (const [name, record, begin, end, space] of [
    ['*Model_Space', H.modelRecord, H.modelBlock, H.modelEnd, 0],
    ['*Paper_Space', H.paperRecord, H.paperBlock, H.paperEnd, 1]
  ] as const) {
    put(0, 'BLOCK', 5, begin, 330, record, 100, 'AcDbEntity', ...(space ? [67, 1] : []), 8, '0', 100, 'AcDbBlockBegin', 2, name, 70, 0, 10, 0, 20, 0, 30, 0, 3, name, 1, '')
    put(0, 'ENDBLK', 5, end, 330, record, 100, 'AcDbEntity', ...(space ? [67, 1] : []), 8, '0', 100, 'AcDbBlockEnd')
  }
  // Symbol definitions, drawn about their insertion point; a definition with attributes says so (flag 2).
  for (const b of blockDefs) {
    put(0, 'BLOCK', 5, b.begin, 330, b.record, 100, 'AcDbEntity', 8, '0', 100, 'AcDbBlockBegin', 2, b.name, 70, b.attributes ? 2 : 0, 10, 0, 20, 0, 30, 0, 3, b.name, 1, '')
    for (const e of b.records) for (const [code, value] of e) put(code, value)
    put(0, 'ENDBLK', 5, b.end, 330, b.record, 100, 'AcDbEntity', 8, '0', 100, 'AcDbBlockEnd')
  }
  put(0, 'ENDSEC')

  // ENTITIES
  put(0, 'SECTION', 2, 'ENTITIES')
  for (const e of entities) for (const [code, value] of e) put(code, value)
  put(0, 'ENDSEC')

  // OBJECTS
  const snapshot = options.snapshot !== false
  const dictionary = (h: string, parent: string, entries: Array<[string, string]>, type = 'DICTIONARY') =>
    put(0, type, 5, h, ...(parent !== '0' ? [102, '{ACAD_REACTORS', 330, parent, 102, '}'] : []), 330, parent, 100, 'AcDbDictionary', 281, 1, ...entries.flatMap(([k, v]) => [3, k, 350, v]))
  put(0, 'SECTION', 2, 'OBJECTS')
  dictionary(H.root, '0', [
    ['ACAD_GROUP', H.groups], ['ACAD_LAYOUT', H.layouts], ['ACAD_PLOTSTYLENAME', H.plotStyles], ['ACAD_WIPEOUT_VARS', H.wipeoutVars],
    ...(snapshot ? [['SPOOLYARD', H.own] as [string, string]] : [])
  ])
  dictionary(H.groups, H.root, groups.map(g => [g.name, g.handle]))
  dictionary(H.layouts, H.root, [['Model', H.modelLayout], ['Layout1', H.paperLayout]])
  dictionary(H.plotStyles, H.root, [['Normal', H.normal]], 'ACDBDICTIONARYWDFLT')
  put(100, 'AcDbDictionaryWithDefault', 340, H.normal)
  put(0, 'ACDBPLACEHOLDER', 5, H.normal, 102, '{ACAD_REACTORS', 330, H.plotStyles, 102, '}', 330, H.plotStyles)
  put(0, 'WIPEOUTVARIABLES', 5, H.wipeoutVars, 102, '{ACAD_REACTORS', 330, H.root, 102, '}', 330, H.root, 100, 'AcDbWipeoutVariables', 70, 0)
  // Both layouts plot the sheet's paper at 1:1, in the drawing's units.
  const [pw, ph] = [PAPER_MM[paperSize].width, PAPER_MM[paperSize].height]
  for (const [h, name, record, tab] of [[H.modelLayout, 'Model', H.modelRecord, 0], [H.paperLayout, 'Layout1', H.paperRecord, 1]] as const)
    put(0, 'LAYOUT', 5, h, 102, '{ACAD_REACTORS', 330, H.layouts, 102, '}', 330, H.layouts, 100, 'AcDbPlotSettings', 1, '', 2, 'DWG To PDF.pc3', 4, MEDIA[paperSize], 6, '',
      40, 0, 41, 0, 42, 0, 43, 0, 44, pw, 45, ph, 46, 0, 47, 0, 48, 0, 49, 0, 140, 0, 141, 0, 142, 1, 143, 1,
      70, tab ? 0 : 1024, 72, doc.units === 'imperial' ? 0 : 1, 73, 0, 74, 1, 7, '', 75, 16, 76, 0, 77, 2, 78, 300, 147, 1, 148, 0, 149, 0,
      100, 'AcDbLayout', 1, name, 70, 1, 71, tab, 10, 0, 20, 0, 11, width, 21, height, 12, 0, 22, 0, 32, 0,
      14, Number.isFinite(bounds[0]) ? bounds[0] : 0, 24, Number.isFinite(bounds[1]) ? bounds[1] : 0, 34, 0,
      15, Number.isFinite(bounds[2]) ? bounds[2] : width, 25, Number.isFinite(bounds[3]) ? bounds[3] : height, 35, 0,
      146, 0, 13, 0, 23, 0, 33, 0, 16, 1, 26, 0, 36, 0, 17, 0, 27, 1, 37, 0, 76, 1, 330, record)
  for (const g of groups)
    put(0, 'GROUP', 5, g.handle, 102, '{ACAD_REACTORS', 330, H.groups, 102, '}', 330, H.groups, 100, 'AcDbGroup', 300, dxfText(g.description).slice(0, 250), 70, 0, 71, 1,
      ...g.members.flatMap(m => [340, m]))
  if (snapshot) {
    dictionary(H.own, H.root, [['SPOOLYARD_PIPING', H.snapshot], ['SPOOLYARD_EXPORT', H.info]])
    // The drawing model, without its raster logos: a DXF does not carry images, and they would dominate its size.
    const model = doc.titleBlock?.logos.length ? { ...doc, titleBlock: { ...doc.titleBlock, logos: [] } } : doc
    const xrecord = (h: string, value: unknown) => {
      put(0, 'XRECORD', 5, h, 102, '{ACAD_REACTORS', 330, H.own, 102, '}', 330, H.own, 100, 'AcDbXrecord', 280, 1)
      const encoded = encodeURIComponent(JSON.stringify(value))
      for (let i = 0; i < encoded.length; i += 240) put(1, encoded.slice(i, i + 240))
    }
    xrecord(H.snapshot, model)
    const info: ExportInfo = { geometry: digest.digest, entities: digest.count, ...(doc.titleBlock?.logos.length ? { logos: doc.titleBlock.logos.map(l => l.name || 'LOGO') } : {}) }
    xrecord(H.info, { spoolyardExport: info })
  }
  put(0, 'ENDSEC', 0, 'EOF')

  // HEADER last: it records the extents and the next free handle.
  const [x0, y0, x1, y1] = Number.isFinite(bounds[0]) ? bounds : [0, 0, width, height]
  const header: Array<string | number> = [
    0, 'SECTION', 2, 'HEADER',
    9, '$ACADVER', 1, 'AC1015',
    9, '$ACADMAINTVER', 70, 6,
    9, '$DWGCODEPAGE', 3, 'ANSI_1252',
    9, '$INSBASE', 10, 0, 20, 0, 30, 0,
    9, '$EXTMIN', 10, x0, 20, y0, 30, 0,
    9, '$EXTMAX', 10, x1, 20, y1, 30, 0,
    9, '$LIMMIN', 10, 0, 20, 0,
    9, '$LIMMAX', 10, width, 20, height,
    9, '$LTSCALE', 40, 1,
    9, '$PSLTSCALE', 70, 1,
    9, '$TEXTSTYLE', 7, cad ? 'ROMANS' : 'STANDARD',
    9, '$CLAYER', 8, '0',
    9, '$CELTYPE', 6, 'ByLayer',
    9, '$CECOLOR', 62, 256,
    9, '$CELWEIGHT', 370, -1,
    9, '$DIMSTYLE', 2, 'Standard',
    9, '$LUNITS', 70, 2,
    9, '$LUPREC', 70, doc.units === 'imperial' ? 4 : 2,
    9, '$INSUNITS', 70, INSUNITS[doc.units],
    9, '$MEASUREMENT', 70, doc.units === 'imperial' ? 0 : 1,
    9, '$LWDISPLAY', 290, 1,
    9, '$TILEMODE', 70, 1,
    9, '$PSTYLEMODE', 290, 1,
    9, '$HANDSEED', 5, seed.toString(16).toUpperCase(),
    0, 'ENDSEC'
  ]
  return [...header, ...out].join('\n') + '\n'
}

/**
 * One sheet of a drawing package: a spool (or the whole drawing) in one output view, or (`sheet: 'materials'`) the
 * spool's material list on a sheet of its own.
 */
export interface PackageSheet { spool: string; view: NonNullable<IsoDocument['outputViews']>[number]; sheet?: 'materials' }
/**
 * The sheets a package issues, as the PDF does: each spool's sheet in each output view, then its material list when
 * that has a sheet of its own (see `drawingSheets`). Pipes without a spool are not drawn on a sheet of their own when
 * other pipes have spools; they are reported by validation.
 */
export function packageSheets(doc: IsoDocument): PackageSheet[] {
  const named = [...new Set(doc.runs.map(r => r.spool))].filter(Boolean)
  const spools = named.length ? named : ['']
  return spools.flatMap(spool => [
    ...(doc.outputViews ?? ['iso']).map(view => ({ spool, view })),
    ...(drawingSheets(doc, spool).includes('materials') ? [{ spool, view: 'iso' as const, sheet: 'materials' as const }] : [])
  ])
}
/** A package sheet's drawing. */
export const packageDrawing = (doc: IsoDocument, sheet: PackageSheet): Drawing =>
  createDrawing(doc, sheet.spool, sheet.view, undefined, sheet.sheet ? { sheet: sheet.sheet } : undefined)
/** A package sheet's part of a file name: its spool, its view when the package has several, `materials` for a material sheet. */
export function sheetFileName(doc: IsoDocument, sheet: PackageSheet, extension: string): string {
  const views = (doc.outputViews ?? ['iso']).length > 1
  return `${drawingFileName(doc)}${sheet.spool ? '-' + fileSafe(sheet.spool) : ''}${sheet.sheet ? '-materials' : views ? '-' + sheet.view : ''}.${extension}`
}
/** A file name part made safe for every file system; 'drawing' when there is nothing to name it by. */
export const fileSafe = (s: string | null | undefined) => String(s ?? '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'drawing'
/** The name a drawing's files start with: its drawing number, else its title, else 'drawing'. */
export const drawingFileName = (doc: Pick<IsoDocument, 'drawing' | 'title'>) => fileSafe(doc.drawing?.trim() || doc.title?.trim())
/** One DXF per sheet of the package, named drawing-spool-view. */
export function packageDxf(doc: IsoDocument, options: DxfOptions = {}): Array<{ name: string; content: string; sheet: PackageSheet }> {
  return packageSheets(doc).map(sheet => ({
    sheet,
    name: sheetFileName(doc, sheet, 'dxf'),
    content: isometricDxf(doc, packageDrawing(doc, sheet), options)
  }))
}
