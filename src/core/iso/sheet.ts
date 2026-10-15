import type { Point, Primitive } from '../drawing'
import { sheetInfoOf, titleBlockOf, type IsoDocument } from '../model'
import { measureText, strokeText } from '../stroke-font'

export interface SheetRow { id: number; qtyText: string; nd: string; description: string }
/** Rectangles are [x0, y0, x1, y1] in sheet units. */
export type SheetRect = [number, number, number, number]
export interface SheetFrame {
  primitives: Primitive[]
  /** The model drawing area: inside the border and above the title block. */
  viewport: SheetRect
  /** Parts of the viewport the model and its annotations must keep clear of: north symbol, BOM blocks, notes. */
  exclusions: SheetRect[]
}

/*
 * The production sheet is laid out on the 17 × 11 in reference in dots of 1/150 in (2550 × 1650) and mapped onto
 * the sheet: x by width / 2550, y by height / 1650, lettering by the smaller of the two.
 */
const REF_W = 2550, REF_H = 1650
const LEFT = 81.5, RIGHT = 2466.5, TOP = 54, BOTTOM = 1598
const TB = 1294.5
const GAP = 15
const WEIGHT = { border: 2, title: 1.8, table: 0.6, north: 0.6 }

// Title block grid: horizontal [y, x0, x1] and vertical [x, y0, y1] centre lines.
const TB_H: Array<[number, number, number]> = [
  [TB, LEFT, RIGHT], [1464.5, LEFT, RIGHT],
  [1328.5, LEFT, 588.5], [1374.5, LEFT, 1242], [1420.5, LEFT, 588.5], [1509, LEFT, 588.5], [1553.5, LEFT, 588.5],
  [1328.5, 906.5, 1242], [1420.5, 906.5, 1242], [1516.5, 906.5, 1617], [1557.5, 906.5, 1520.5],
  [1357.5, 1760.5, RIGHT], [1420.5, 1760.5, RIGHT]
]
const TB_V: Array<[number, number, number]> = [
  ...[588.5, 747.5, 906.5, 1030, 1242, 1617, 1923.5, 2252.5, 2413.5].map((x): [number, number, number] => [x, TB, BOTTOM]),
  ...[1155.5, 1760.5, 1819.5, 2198.5, 2306.5, 2360].map((x): [number, number, number] => [x, TB, 1464.5]),
  [1520.5, 1516.5, BOTTOM]
]
const REFERENCE_ROWS = [1328.5, 1374.5, 1420.5, 1464.5, 1509, 1553.5, BOTTOM]
const REVISION_COLUMNS = [1760.5, 1819.5, 1923.5, 2198.5, 2252.5, 2306.5, 2360, 2413.5, RIGHT]
const REVISION_ROWS = [TB, 1357.5, 1420.5]
const REVISION_HEADER: Array<[string, number]> = [
  ['REV', 10], ['DATE\nYY-MM-DD', 10], ['DESCRIPTION', 10], ['DESIGNED\nBY', 9], ['CHECKED\nBY', 9],
  ['DISCIPLINE\nLEAD', 8], ['PROJECT\nLEADER', 9], ['APPROVED\nBY', 8]
]

// Bill of materials: column widths and lettering. A row is 34 dots for one line plus 22 per further line; lines that
// rise above the cap line (quotes, slashes) add 3, like the reference's at-least line spacing. Cells centre their ink.
const BOM_COLUMNS = [90, 135, 90, 493.5]
const BOM_CAP = 13, BOM_ROW = 34, BOM_PITCH = 22, BOM_RAISE = 3, BOM_INSET = 6

// Notes: lettering, baseline pitch and the label / text columns.
/** The issued notes are lettered wide. */
const NOTE_WIDTH = 1.27
const NOTE_CAP = 9.75, NOTE_PITCH = 16.6, NOTE_HEADER_X = 1621.4, NOTE_LABEL_X = 1629.7, NOTE_TEXT_X = 1661.5,
  NOTE_RIGHT = 2445, NOTE_BASELINE = TB - 11.5

// North symbol: ellipse, tick lines on the iso diagonals and a filled upright N.
const NORTH = { cx: 192, cy: 121.5, rx: 88, ry: 52.5, box: [104, 69, 280, 174] as SheetRect }
const NORTH_TICKS: Array<[number, number, number, number]> = [[254, 84, 280, 69], [130, 84, 104, 69], [254, 159, 280, 174], [130, 159, 104, 174]]
const NORTH_N: Point[] = [
  [147, 148.5], [147, 92.5], [161.9, 92.5], [221.25, 137], [221.25, 92.5], [235.25, 92.5], [235.25, 148.5], [220, 148.5],
  [161, 104.4], [161, 148.5]
]

const up = (v: unknown) => String(v ?? '').trim().toUpperCase()

/** Splits text into lines no wider than `width`, breaking words only when a single word is too wide. */
export function wrapText(text: string, size: number, width: number, factor = 1): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    // Words keep the spacing written between them (verbatim catalogue text has double spaces); a spaced dash stays
    // with the word before it ("BV -" then "CUT TO …").
    const words: Array<{ word: string; gap: string }> = []
    for (const [, word, gap] of paragraph.trim().matchAll(/(\S+)(\s*)/g)) {
      const last = words.at(-1)
      if (word === '-' && last) { last.word += last.gap + '-'; last.gap = gap }
      else words.push({ word, gap })
    }
    let gap = ''
    for (let { word, gap: after } of words) {
      const next = line ? `${line}${gap || ' '}${word}` : word
      gap = after
      if (measureText(next, size, factor) <= width) { line = next; continue }
      if (line) out.push(line)
      while (word.length > 1 && measureText(word, size, factor) > width) {
        let n = word.length - 1
        while (n > 1 && measureText(word.slice(0, n), size, factor) > width) n--
        out.push(word.slice(0, n))
        word = word.slice(n)
      }
      line = word
    }
    if (line) out.push(line)
  }
  return out.length ? out : ['']
}

/** Ink extent of a line of lettering above (negative) and below its baseline. */
const extent = (text: string, size: number): [number, number] => {
  const ys = strokeText(text, { at: [0, 0], size }).flat().map(p => p[1])
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : [-size, 0]
}

interface BomCell { lines: string[]; base: number[]; height: number; ink: [number, number] }
interface BomBlock { x0: number; x1: number; top: number; widths: number[]; rows: Array<{ row: SheetRow; cells: BomCell[]; height: number }> }

/**
 * The production sheet frame: border, north symbol, bill of materials, notes and title block for one spool, with
 * the model viewport and the areas the model must keep clear of.
 */
export function drawSheet(input: {
  doc: IsoDocument
  spool: string
  width: number
  height: number
  rows: SheetRow[]
  view?: 'iso' | 'plan' | 'front' | 'side'
}): SheetFrame {
  const { doc, spool, width, height, rows, view = 'iso' } = input
  const sx = width / REF_W, sy = height / REF_H, st = Math.min(sx, sy)
  // Lettering is measured in reference dots; a dot of line length is `kx` dots of lettering.
  const kx = sx / st
  const X = (d: number) => d * sx, Y = (d: number) => d * sy
  const out: Primitive[] = []
  const line = (layer: string, x0: number, y0: number, x1: number, y1: number, weight: number) =>
    out.push({ type: 'line', a: [X(x0), Y(y0)], b: [X(x1), Y(y1)], layer, weight })
  /** Lettering at a baseline point; shrinks to `fit` dots of width when given. */
  const text = (layer: string, value: string, x: number, y: number, size: number, anchor: 'start' | 'middle' = 'start', fit?: number, factor = 1) => {
    if (!value) return
    const room = fit == null ? Infinity : fit * kx
    const wide = measureText(value, size, factor)
    const s = wide > room ? (size * room) / wide : size
    out.push({ type: 'text', p: [X(x), Y(y)], text: value, size: s * st, layer, anchor, ...(factor !== 1 ? { width: factor } : {}) })
  }
  const rect = (r: SheetRect): SheetRect => [X(r[0]), Y(r[1]), X(r[2]), Y(r[3])]
  const exclusions: SheetRect[] = []

  // Border.
  out.push({ type: 'polyline', points: [[X(LEFT), Y(TOP)], [X(RIGHT), Y(TOP)], [X(RIGHT), Y(BOTTOM)], [X(LEFT), Y(BOTTOM)]], closed: true, layer: 'BORDER', weight: WEIGHT.border })

  // North symbol.
  const north = view === 'iso' || view === 'plan'
  const northBox: SheetRect = [LEFT + ((NORTH.box[0] - LEFT) * st) / sx, TOP + ((NORTH.box[1] - TOP) * st) / sy,
    LEFT + ((NORTH.box[2] - LEFT) * st) / sx, TOP + ((NORTH.box[3] - TOP) * st) / sy]
  if (north) {
    // Drawn at its own proportions from the frame corner.
    const at = (x: number, y: number): Point => [X(LEFT) + (x - LEFT) * st, Y(TOP) + (y - TOP) * st]
    const n = 72
    out.push({
      type: 'polyline', layer: 'TEXT', weight: WEIGHT.north, closed: true,
      points: Array.from({ length: n }, (_, i) => at(NORTH.cx + NORTH.rx * Math.cos((2 * Math.PI * i) / n), NORTH.cy + NORTH.ry * Math.sin((2 * Math.PI * i) / n)))
    })
    for (const [x0, y0, x1, y1] of NORTH_TICKS) out.push({ type: 'line', a: at(x0, y0), b: at(x1, y1), layer: 'TEXT', weight: WEIGHT.north })
    out.push({ type: 'polyline', layer: 'TEXT', weight: 0.2, closed: true, fill: true, points: NORTH_N.map(([x, y]) => at(x, y)) })
    exclusions.push(rect(northBox))
  }

  // Notes, numbered with a hanging indent, growing up from the title block.
  const notes = doc.notes.replace(/\r\n?/g, '\n').split('\n').map(s => up(s)).filter(Boolean)
  if (notes[0] && /^NOTES?:?$/.test(notes[0])) notes.shift()
  let notesTop = Infinity
  if (notes.length) {
    let scale = 1, laid: Array<{ label: string; lines: string[] }> = []
    for (let pass = 0; pass < 8; pass++) {
      let count = 0
      laid = notes.map(note => {
        const own = /^(\d+|[A-Z])[.)]\s+(.*)$/.exec(note)
        const label = own ? `${own[1]}.` : `${++count}.`
        if (own && /^\d+$/.test(own[1])) count = Number(own[1])
        return { label, lines: wrapText(own ? own[2] : note, NOTE_CAP * scale, (NOTE_RIGHT - NOTE_TEXT_X) * kx, NOTE_WIDTH) }
      })
      const total = laid.reduce((sum, n) => sum + n.lines.length, 1)
      const room = (NOTE_BASELINE - TOP) / 2
      if (total * NOTE_PITCH * scale <= room) break
      scale *= Math.max(0.5, Math.sqrt(room / (total * NOTE_PITCH * scale)))
    }
    const cap = NOTE_CAP * scale, pitch = NOTE_PITCH * scale
    const total = laid.reduce((sum, n) => sum + n.lines.length, 0)
    let y = NOTE_BASELINE - total * pitch
    text('NOTES', 'NOTES:', NOTE_HEADER_X, y, cap)
    notesTop = y - cap
    for (const note of laid) {
      y += pitch
      text('NOTES', note.label, NOTE_LABEL_X, y, cap)
      note.lines.forEach((l, i) => text('NOTES', l, NOTE_TEXT_X, y + i * pitch, cap, 'start', undefined, NOTE_WIDTH))
      y += (note.lines.length - 1) * pitch
    }
    exclusions.push(rect([NOTE_HEADER_X - GAP / 2, notesTop - GAP / 2, RIGHT - GAP / 2, TB - 4]))
  }
  const notesBox: SheetRect = [NOTE_HEADER_X, notesTop, RIGHT, TB]

  // Bill of materials: blocks from the top-right corner leftwards; the rows that do not fit continue in the next block.
  const layoutBom = (f: number, compact = false): BomBlock[] | null => {
    const blockWidth = BOM_COLUMNS.reduce((a, b) => a + b, 0) * f
    // A long list narrows the QTY and ND columns to their contents, as drafted, so descriptions wrap less.
    const fitted = (values: string[], header: string, least: number, most: number) =>
      Math.min(most, Math.max(least, ...[header, ...values].map(v => Math.max(...wrapText(up(v), BOM_CAP, Infinity).map(l => measureText(l, BOM_CAP))) / kx + 14)))
    // A wide QTY or ND widens its column rather than wrapping.
    const columns = compact
      ? [BOM_COLUMNS[0], fitted(rows.map(r => r.qtyText), 'QTY', 78, BOM_COLUMNS[1]), fitted(rows.flatMap(r => r.nd.split(' ')), 'ND', 73, BOM_COLUMNS[2])]
      : [BOM_COLUMNS[0], fitted(rows.map(r => r.qtyText), 'QTY', BOM_COLUMNS[1], BOM_COLUMNS[1] * 1.5),
        // Words never split, so the ND column is as wide as its longest word ("1/2"X1/4""); bolt sizes still wrap.
        fitted(rows.flatMap(r => r.nd.split(' ')), 'ND', BOM_COLUMNS[2], BOM_COLUMNS[2] * 1.8)]
    const cap = BOM_CAP * f
    const cell = (value: string, room: number): BomCell => {
      const lines = wrapText(value, cap, room * kx)
      const raised = lines.map(l => extent(l, cap)[0] < -cap * 1.05)
      const base = [0]
      for (let i = 1; i < lines.length; i++) base.push(base[i - 1] + (BOM_PITCH + (raised[i] ? BOM_RAISE : 0)) * f)
      const height = BOM_ROW * f + base[base.length - 1] + (lines.length > 1 && raised[0] ? BOM_RAISE * f : 0)
      const ink = lines.reduce<[number, number]>((acc, l, i) => {
        const [a, b] = extent(l, cap)
        return [Math.min(acc[0], base[i] + a), Math.max(acc[1], base[i] + b)]
      }, [Infinity, -Infinity])
      return { lines, base, height, ink }
    }
    const blocks: BomBlock[] = []
    let next = 0, x1 = RIGHT
    while (next < rows.length || !blocks.length) {
      let x0 = x1 - blockWidth
      if (x0 < LEFT + GAP) {
        if (x1 - (LEFT + GAP) < blockWidth * 0.6) return null
        x0 = LEFT + GAP
      }
      const span = (r: SheetRect) => r[0] < x1 && r[2] > x0
      const top = north && span(northBox) ? northBox[3] + GAP : TOP
      const bottom = (notes.length && span(notesBox) ? notesTop : TB) - GAP
      const widths = [...columns, BOM_COLUMNS.reduce((a, b) => a + b, 0) - columns.reduce((a, b) => a + b, 0)].map(w => w * f)
      widths[3] -= blockWidth - (x1 - x0)
      const block: BomBlock = { x0, x1, top, widths, rows: [] }
      let y = top + 2 * BOM_ROW * f
      while (next < rows.length) {
        const row = rows[next]
        const cells = [
          cell(String(row.id), widths[0] - 6 * f), cell(up(row.qtyText), widths[1] - 6 * f),
          cell(up(row.nd), widths[2] - 6 * f), cell(up(row.description), widths[3] - (BOM_INSET + 2) * f)
        ]
        const h = Math.max(...cells.map(c => c.height))
        if (y + h > bottom) break
        block.rows.push({ row, cells, height: h })
        y += h
        next++
      }
      if (y > bottom || (!block.rows.length && next < rows.length)) return null
      blocks.push(block)
      x1 = x0 - GAP
    }
    return blocks
  }
  let bom: BomBlock[] | null = layoutBom(1)
  if (bom && bom.length > 1) {
    // Before splitting the table, narrow QTY and ND and, if that is nearly enough, letter the table a little smaller.
    for (const f of [1, 0.97, 0.94, 0.91]) {
      const compact = layoutBom(f, true)
      if (compact && compact.length === 1) { bom = compact; break }
      if (f === 1 && compact && compact.length < bom.length) bom = compact
    }
  }
  for (let f = 1; !bom && f > 0.2; f *= 0.9) bom = layoutBom(f)
  bom ??= layoutBom(0.2)
  for (const block of bom ?? []) {
    const f = block.widths[0] / BOM_COLUMNS[0]
    const cap = BOM_CAP * f, row = BOM_ROW * f
    const xs = block.widths.reduce((acc, w) => [...acc, acc[acc.length - 1] + w], [block.x0])
    const end = block.top + 2 * row + block.rows.reduce((sum, r) => sum + r.height, 0)
    const middle = (value: string, y0: number, y1: number) => {
      const [a, b] = extent(value, cap)
      return (y0 + y1) / 2 - (a + b) / 2
    }
    line('BOM', block.x0, block.top, block.x1, block.top, WEIGHT.table)
    line('BOM', block.x0, block.top, block.x0, end, WEIGHT.table)
    line('BOM', block.x1, block.top, block.x1, end, WEIGHT.table)
    for (const x of xs.slice(1, -1)) line('BOM', x, block.top + row, x, end, WEIGHT.table)
    text('BOM', 'BILL OF MATERIALS', (block.x0 + block.x1) / 2, middle('BILL OF MATERIALS', block.top, block.top + row), cap, 'middle')
    line('BOM', block.x0, block.top + row, block.x1, block.top + row, WEIGHT.table)
    ;['ID', 'QTY', 'ND', 'DESCRIPTION'].forEach((h, i) =>
      text('BOM', h, (xs[i] + xs[i + 1]) / 2, middle(h, block.top + row, block.top + 2 * row), cap, 'middle'))
    let y = block.top + 2 * row
    line('BOM', block.x0, y, block.x1, y, WEIGHT.table)
    for (const r of block.rows) {
      const centre = y + r.height / 2
      r.cells.forEach((c, i) => {
        const first = centre - (c.ink[0] + c.ink[1]) / 2
        c.lines.forEach((l, j) => i < 3
          ? text('BOM', l, (xs[i] + xs[i + 1]) / 2, first + c.base[j], cap, 'middle')
          : text('BOM', l, xs[i] + BOM_INSET * f, first + c.base[j], cap))
      })
      y += r.height
      line('BOM', block.x0, y, block.x1, y, WEIGHT.table)
    }
    exclusions.push(rect([block.x0 - GAP / 2, block.top, block.x1, end + GAP / 2]))
  }

  // Title block.
  const tb = titleBlockOf(doc), info = sheetInfoOf(doc, spool)
  const metric = doc.units === 'mm'
  for (const [y, x0, x1] of TB_H) line('TITLE', x0, y, x1, y, WEIGHT.title)
  for (const [x, y0, y1] of TB_V) line('TITLE', x, y0, x, y1, WEIGHT.title)
  const title = (value: string, x: number, y: number, size: number, anchor: 'start' | 'middle' = 'start', fit?: number) =>
    text('TITLE', value, x, y, size, anchor, fit)

  title('REFERENCE DRAWINGS:', 91.2, 1321, 17)
  tb.referenceDrawings.slice(0, REFERENCE_ROWS.length - 1).forEach((ref, i) =>
    title(ref.trim(), 91.2, REFERENCE_ROWS[i + 1] - 12.5, 17, 'start', 588.5 - 91.2 - 8))

  const people: Array<[string, string, number, number, number, number, number?]> = [
    ['DESIGNED BY', tb.designedBy, 588.5, 1326.5, 1363, 747.5],
    ['DATE (YY-MM-DD)', tb.date, 747.5, 1326.5, 1363, 906.5],
    ['CHECKED BY', tb.checkedBy, 588.5, 1407, 1452, 747.5],
    ['PROJECT LEADER', tb.projectLeader, 747.5, 1407, 1452, 906.5],
    ['DISCIPLINE LEADER', tb.disciplineLeader, 588.5, 1512, 1578, 747.5, 9],
    ['APPROVED BY', tb.approvedBy, 747.5, 1512, 1578, 906.5]
  ]
  for (const [label, value, x0, labelY, valueY, x1, size = 10] of people) {
    title(label, x0 + 10, labelY, size, 'start', x1 - x0 - 14)
    title(up(value), (x0 + x1) / 2, valueY, 17, 'middle', x1 - x0 - 10)
  }

  title('CONDITION', 912.4, 1318, 13, 'start', 1030 - 912.4 - 3)
  title(metric ? 'PRESS(kPa)' : 'PRESS(PSIG)', 1036.9, 1318, 13, 'start', 1155.5 - 1036.9 - 3)
  title(metric ? 'TEMP(°C)' : 'TEMP(°F)', 1161.4, 1318, 13, 'start', 1242 - 1161.4 - 3)
  const conditions: Array<[string, [string, string], number]> = [
    ['DESIGN', tb.conditions.design, 1358], ['OPERATING', tb.conditions.operating, 1404], ['TEST', tb.conditions.test, 1450]
  ]
  for (const [label, [press, temp], y] of conditions) {
    title(label, 912.4, y, 13, 'start', 1030 - 912.4 - 3)
    title(up(press), (1030 + 1155.5) / 2, y, 13, 'middle', 1155.5 - 1030 - 8)
    title(up(temp), (1155.5 + 1242) / 2, y, 13, 'middle', 1242 - 1155.5 - 8)
  }
  const services: Array<[string, string, number]> = [
    ['INSUL. THK.', tb.insulationThickness, 1495], ['INSUL. CLAD.', tb.insulationCladding, 1539], ['TRACING', tb.tracing, 1582]
  ]
  for (const [label, value, y] of services) {
    title(label, 912.4, y, 13, 'start', 1030 - 912.4 - 2)
    title(up(value), (1030 + 1242) / 2, y, 13, 'middle', 1242 - 1030 - 10)
  }

  title('PIPE SPEC:', 1247.7, 1487, 13.5)
  title(up(tb.pipeSpec), 1248, 1508, 12, 'start', 1440 - 1248)
  title('SPEC REV:', 1445.4, 1496, 13)
  const specRev = 1445.4 + measureText('SPEC REV: ', 13) / kx
  title(up(tb.specRevision), specRev, 1496, 13, 'start', 1617 - 5 - specRev)
  title('DESIGN CODE:', 1246.7, 1544, 13.5)
  const code = 1246.7 + measureText('DESIGN CODE:', 13.5) / kx
  title(up(tb.designCode), code, 1544, 13.5, 'start', 1520.5 - 4 - code)
  title('REF. AREA', 1526.4, 1537, 9.5, 'start', 1617 - 1526.4 - 4)
  title(up(tb.refArea), (1520.5 + 1617) / 2, 1580, 13, 'middle', 1617 - 1520.5 - 8)
  title('PRODUCT:', 1247.9, 1584, 13)
  title(up(tb.product), 1405, 1584, 13, 'start', 1520.5 - 4 - 1405)

  // Logos, fitted into their panels at their own proportions.
  const panels: Array<[SheetRect, number]> = [[[1242, TB, 1617, 1464.5], 15], [[1617, TB, 1760.5, 1464.5], 3]]
  tb.logos.slice(0, 2).forEach((logo, i) => {
    // An unnamed placeholder keeps the client logo in its own slot; it draws nothing.
    if (!logo.name) return
    const [[x0, y0, x1, y1], pad] = panels[i]
    const bw = X(x1 - x0 - 2 * pad), bh = Y(y1 - y0 - 2 * pad)
    const aspect = imageAspect(logo.dataUrl) ?? bw / bh
    const w = Math.min(bw, bh * aspect), h = w / aspect
    out.push({ type: 'image', p: [X((x0 + x1) / 2) - w / 2, Y((y0 + y1) / 2) - h / 2], width: w, height: h, href: logo.dataUrl, layer: 'TITLE' })
  })

  // Revisions: the latest at the bottom, just above the column headings.
  const shown = tb.revisions.slice(-(REVISION_ROWS.length - 1))
  shown.forEach((rev, i) => {
    const y0 = REVISION_ROWS[REVISION_ROWS.length - 1 - shown.length + i], y1 = REVISION_ROWS[REVISION_ROWS.length - shown.length + i]
    ;[rev.rev, rev.date, rev.description, rev.designedBy, rev.checkedBy, rev.disciplineLead, rev.projectLeader, rev.approvedBy]
      .forEach((value, c) => title(up(value), (REVISION_COLUMNS[c] + REVISION_COLUMNS[c + 1]) / 2, (y0 + y1) / 2 + 5, 10, 'middle',
        REVISION_COLUMNS[c + 1] - REVISION_COLUMNS[c] - 6))
  })
  REVISION_HEADER.forEach(([label, size], c) => {
    const x = (REVISION_COLUMNS[c] + REVISION_COLUMNS[c + 1]) / 2, room = REVISION_COLUMNS[c + 1] - REVISION_COLUMNS[c] - 4
    const parts = label.split('\n')
    const fit = Math.min(size, ...parts.map(p => (size * room * kx) / measureText(p, size)))
    if (parts.length === 1) title(label, x, 1448, fit, 'middle')
    else parts.forEach((p, j) => title(p, x, j ? 1458 : 1439, fit, 'middle'))
  })

  const identity: Array<[string, string, number, number, number, number, number]> = [
    ['LINE No.', info.lineNumber, 1617, 1923.5, 1499, 13, 22],
    ['DRAWING No.', info.drawingNumber, 1923.5, 2252.5, 1497, 13, 22],
    ['PROJ. No.', tb.projectNumber, 2252.5, 2413.5, 1498, 13, 21],
    ['REV.', info.revision, 2413.5, RIGHT, 1496, 10, 21]
  ]
  for (const [label, value, x0, x1, y, labelSize, valueSize] of identity) {
    title(label, x0 + 14.5, y, labelSize, 'start', x1 - x0 - 16)
    title(up(value), (x0 + x1) / 2, 1559, valueSize, 'middle', x1 - x0 - 8)
  }

  const viewport = rect([LEFT + GAP, TOP + GAP, RIGHT - GAP, TB - GAP])
  const clip = (r: SheetRect): SheetRect =>
    [Math.max(r[0], viewport[0]), Math.max(r[1], viewport[1]), Math.min(r[2], viewport[2]), Math.min(r[3], viewport[3])]
  return { primitives: out, viewport, exclusions: exclusions.map(clip).filter(r => r[2] > r[0] && r[3] > r[1]) }
}

/** Width / height of a PNG or JPEG data URL, read from its header. */
export function imageAspect(dataUrl: string): number | undefined {
  const match = /^data:image\/(png|jpeg);base64,(.*)$/.exec(dataUrl)
  if (!match) return
  let bytes: Uint8Array
  try {
    const raw = atob(match[1] === 'png' ? match[2].slice(0, 44) : match[2])
    bytes = Uint8Array.from(raw, c => c.charCodeAt(0))
  } catch {
    return
  }
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1]
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
  let w = 0, h = 0
  if (match[1] === 'png' && bytes.length >= 24) {
    w = u32(16)
    h = u32(20)
  } else {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        h = u16(i + 5)
        w = u16(i + 7)
        break
      }
      i += 2 + u16(i + 2)
    }
  }
  return w > 0 && h > 0 ? w / h : undefined
}
