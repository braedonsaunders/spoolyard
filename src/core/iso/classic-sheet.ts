import type { Point, Primitive, SymbolRef } from '../drawing'
import { sheetInfoOf, styleOf, type IsoDocument } from '../model'
import { northOnPage } from './layout'
import { draftingSizes } from './context'
import { classicMaterials } from './classic-materials'
import {
  PAPER_MM, draftingNotes, materialsContinued, openRegions, letterWidth, paperOf, sheetPipeSpecs, sheetScale, viewNote,
  type SheetFrame, type SheetFrameInput, type SheetRect, type SheetRow, type SheetView
} from './sheet-frame'

/** Splits notes into lines no wider than `room` in sans lettering of cap height `size`. */
function wrapNotes(notes: string, size: number, room: number): string[] {
  return notes.split('\n').flatMap(value => {
    const lines: string[] = []
    let row = ''
    for (const word of value.split(/\s+/).filter(Boolean)) {
      const next = row ? `${row} ${word}` : word
      if (row && letterWidth(next, size, 'sans') > room) { lines.push(row); row = word }
      else row = next
    }
    if (row) lines.push(row)
    return lines
  })
}

/** Spoolyard's original paper presentation, with the current complete material schedule. */
export function classicSheet(doc: IsoDocument, spool: string, width: number, height: number, view: string, rows: SheetRow[], note?: string,
  sheet: Pick<SheetFrameInput, 'materials' | 'numbering'> = {}): SheetFrame {
  const materials = sheet.materials ?? 'on', numbering = sheet.numbering
  const out: Primitive[] = [], info = sheetInfoOf(doc, spool), scale = height / 850, Y = (y: number) => y * scale
  const pen = draftingSizes(doc).thin
  const line = (a: Point, b: Point, into = out) => into.push({ type: 'line', a, b, layer: 'BORDER', weight: pen })
  // Sans size is cap height; SVG/PDF use a larger em to obtain that height. Lettering wider than its room is smaller.
  const text = (p: Point, value: string, size: number, room = Infinity, into = out, field?: string) =>
    into.push({ type: 'text', p, text: value, size: Math.min(size * scale, size * scale * room / Math.max(1e-9, letterWidth(value, size * scale, 'sans'))), layer: 'TITLE', lettering: 'sans', ...(field ? { field } : {}) })
  // The frame and footer are one TITLEBLOCK and the material list one BOM, inserted at the sheet's lower-left corner.
  const titleBlock: SymbolRef = { name: 'TITLEBLOCK', at: [0, height], rotation: 0 }
  const claim = (ink: Primitive[], symbol: SymbolRef, from = 0) => { for (let i = from; i < ink.length; i++) ink[i].symbol ??= symbol }
  const rect = (x: number, y: number, w: number, h: number) => {
    line([x, Y(y)], [x + w, Y(y)]); line([x + w, Y(y)], [x + w, Y(y + h)]); line([x + w, Y(y + h)], [x, Y(y + h)]); line([x, Y(y + h)], [x, Y(y)])
  }
  const split = width - 385 * scale, leftWidth = split - 65 * scale, rightWidth = width - split - 65 * scale
  const short = wrapNotes(doc.notes, 9 * scale, leftWidth)
  // Notes that do not fit the footer continue above it, smaller.
  const long = short.length > 7
  const notes = long ? wrapNotes(doc.notes, 8 * scale, split - 48 * scale) : short
  // A drawing whose material list has a sheet of its own notes where the list is, in the list's place.
  const schedule = materials === 'apart' ? { primitives: [], exclusions: [], left: width - 235 * scale } : classicMaterials(doc, spool, width, height, rows, materials === 'only')
  const bomLeft = schedule.left
  const headingWidth = materials === 'on' ? Math.max(70 * scale, bomLeft - 165 * scale) : width - 400 * scale
  out.push(...schedule.primitives.filter(p => p.layer === 'BOM'))
  claim(out, { name: 'BOM', at: [0, height], rotation: 0 })
  const form = out.length
  rect(20 * scale, 20, width - 40 * scale, 810)
  const heading = out.length
  text([40 * scale, Y(48)], doc.title, 22, headingWidth, out, 'doc.title')
  text([40 * scale, Y(72)], `${info.drawingNumber}  |  ${spool || 'All spools'}  |  Revision ${info.revision}`, 13, headingWidth, out, 'sheet.heading')
  text([40 * scale, Y(94)], [doc.customer, doc.project].filter(Boolean).join(' / '), 12, headingWidth, out, 'doc.customer+doc.project')
  // A drawing whose material list has a sheet of its own says where the list is, under its heading, so the drawing
  // has the rest of the frame.
  if (materials === 'apart') out.push({ type: 'text', p: [40 * scale, Y(113)], text: materialsContinued(numbering?.materials), size: 9 * scale, layer: 'BOM', lettering: 'sans', field: 'materials.continued' })
  const headingInk = out.slice(heading).reduce((w, p) => p.type === 'text' ? Math.max(w, letterWidth(p.text, p.size, 'sans')) : w, 0)
  const headingBox: SheetRect = [20 * scale, Y(20), 40 * scale + headingInk + 12 * scale, Y(120)]
  rect(35 * scale, 650, width - 70 * scale, 160); line([35 * scale, Y(705)], [width - 35 * scale, Y(705)]); line([split, Y(650)], [split, Y(810)])
  const sheetOf = numbering ? `     SHEET ${numbering.number} OF ${numbering.count}` : ''
  text([48 * scale, Y(673)], `DRAWING: ${info.drawingNumber}     SPOOL: ${spool || 'ALL'}     REV: ${info.revision}${sheetOf}`, 12, leftWidth, out, 'sheet.identity')
  text([48 * scale, Y(694)], `DRAWN: ${doc.drawnBy}     CHECKED: ${doc.checkedBy}`, 11, leftWidth, out, 'doc.drawnBy+doc.checkedBy')
  text([split + 15 * scale, Y(673)], 'SPOOLYARD  /  PIPING ISOMETRIC', 13, rightWidth)
  const facing = materials === 'only' ? 'MATERIAL LIST' : view === 'iso' ? 'ISO VIEW' : note ?? viewNote(view as SheetView)
  text([split + 15 * scale, Y(694)], `${facing} · ${doc.units === 'mm' ? 'METRIC' : 'IMPERIAL'}`, 11, rightWidth, out, 'viewNote+units.system')
  if (!long) notes.forEach((v, i) => text([48 * scale, Y(726 + i * 13)], v, 9, leftWidth, out, `notes#${i + 1}`))
  else {
    const top = Y(630) - notes.length * 11 * scale
    notes.forEach((v, i) => out.push({ type: 'text', p: [48 * scale, top + i * 11 * scale], text: v, size: 8 * scale, layer: 'NOTES', lettering: 'sans' }))
    text([48 * scale, Y(728)], 'NOTES: SEE DRAWING ABOVE', 10)
  }
  // The drafting notes the settings make true; a to-scale sheet writes its ratio once the model is fitted.
  const toScale = styleOf(doc).layout === 'scale', drafting = draftingNotes(doc, sheetScale(doc))
  const pitch = Math.min(19, 43 / Math.max(1, drafting.length - 1)), slot = (i: number) => Y(727 + i * pitch)
  drafting.forEach((v, i) => { if (!(toScale && i === 0)) text([split + 15 * scale, slot(i)], v, i ? 9 : 10, rightWidth, out, `drafting.${i + 1}`) })
  text([split + 15 * scale, Y(789)], `PIPE SPEC: ${sheetPipeSpecs(doc, spool)}`, 10, rightWidth, out, 'pipeSpecs')
  claim(out, titleBlock, form)
  // Plant north as the view draws it, turned by the whole north angle (the drawing turns only in quarter turns).
  const dir = northOnPage(view as SheetView, doc.north), length = Math.hypot(...dir) || 1, u: Point = [dir[0] / length, dir[1] / length]
  const origin: Point = [materials === 'apart' ? width - 100 * scale : bomLeft - 65 * scale, Y(82)], tip: Point = [origin[0] + u[0] * 22 * scale, origin[1] + u[1] * 22 * scale]
  // A material-list sheet has no view to orient.
  const hasNorth = materials !== 'only' && Math.hypot(...dir) > 1e-6
  if (hasNorth) {
    const from = out.length
    line(origin, tip)
    for (const side of [-1, 1]) line(tip, [tip[0] - u[0] * 8 * scale - u[1] * 4 * side * scale, tip[1] - u[1] * 8 * scale + u[0] * 4 * side * scale])
    text([tip[0] + u[0] * 12 * scale - 4 * scale, tip[1] + u[1] * 12 * scale + 4 * scale], 'N', 13)
    claim(out, { name: 'NORTH-ARROW', at: origin, rotation: 0 }, from)
  }
  // A drawing with the sheet to itself (its material list on a sheet of its own) has the frame from under the border
  // down, keeping clear of the heading, the north arrow and the note where the list would be.
  const viewport: SheetRect = [40 * scale, Y(materials === 'apart' ? 30 : 115), width - 40 * scale, Y(630)]
  const notesBox: SheetRect | undefined = long ? [40 * scale, Y(630) - notes.length * 11 * scale - 12 * scale, split, Y(630)] : undefined
  const northBox: SheetRect = [origin[0] - 40 * scale, Y(40), origin[0] + 40 * scale, Y(110)]
  const exclusions: SheetRect[] = [...schedule.exclusions, ...(notesBox ? [notesBox] : []), northBox, ...(materials === 'apart' ? [headingBox] : [])]
  const u_mm = height / PAPER_MM[paperOf(doc)].height
  return {
    primitives: out, viewport, exclusions,
    regions: {
      border: [20 * scale, Y(20), width - 20 * scale, Y(830)], title: [[35 * scale, Y(650), width - 35 * scale, Y(810)]],
      bom: schedule.exclusions, notes: notesBox, north: hasNorth ? northBox : undefined, ...openRegions(viewport, exclusions)
    },
    paper: { width: width / u_mm, height: height / u_mm, unitsPerMm: u_mm },
    finish: fit => {
      if (!toScale) return []
      const into: Primitive[] = []
      text([split + 15 * scale, slot(0)], draftingNotes(doc, sheetScale(doc, fit))[0], 10, rightWidth, into, 'drafting.1')
      claim(into, titleBlock)
      return into
    }
  }
}

