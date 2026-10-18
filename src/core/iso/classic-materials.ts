import type { Primitive } from '../drawing'
import type { IsoDocument } from '../model'
import { deltaMark, letterWidth, overriddenCells, type SheetRect, type SheetRow } from './sheet-frame'
import { sizeHeader } from '../format'
import { draftingSizes } from './context'
import type { MaterialRow } from '../material-list'

/** Rows from the material list carry the structure of their text: a pipe row's cut note, keys held under before. */
type ListedRow = SheetRow & Partial<Pick<MaterialRow, 'text' | 'noteParts' | 'aliases'>>
/** The description to wrap: a calculated cut note keeps each of its phrases on one line (non-breaking spaces). */
const wrapSource = (row: ListedRow) => row.noteParts && row.text != null && !overriddenCells(row).has('description')
  ? [row.text, ...row.noteParts.map(p => p.replace(/ /g, '\u00a0'))].join(' ') : row.description

/** Lettering of the classic list: sans, sized as cap height. */
const SANS = 'sans' as const
/** Line pitch of wrapped cells, in cap heights. */
const PITCH = 1.5
/** Item, quantity and size column widths (sheet units at 850 high) before they are fitted to their values. */
const DEFAULT_COLUMNS = [30, 54, 38]
/** Share of a narrow column its centred value may fill. */
const CELL_ROOM = 0.9
/** Least share of the table the description keeps when the narrow columns widen for their values. */
const DESCRIPTION_SHARE = 0.55

/** Splits a cell into lines no wider than `room` at cap height `size`, measured; non-breaking spaces hold words together. */
function wrapCellOnce(value: string, size: number, room: number): string[] {
  const shown = (s: string) => s.replace(/\u00a0/g, ' ')
  const fits = (s: string) => letterWidth(shown(s), size, SANS) <= room
  const lines: string[] = []
  for (const paragraph of value.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/ +/)) {
      const next = line ? `${line} ${word}` : word
      if (fits(next)) { line = next; continue }
      if (line) lines.push(line)
      let rest = word
      while (rest.length > 1 && !fits(rest)) {
        let n = rest.length - 1
        while (n > 1 && !fits(rest.slice(0, n))) n--
        lines.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      line = rest
    }
    if (line) lines.push(line)
  }
  return lines.length ? lines.map(shown) : ['']
}

/**
 * Splits a narrow cell's value (a size, a quantity) into lines no wider than `room`: after a size's X, or at a space
 * that is not between a whole number and its fraction (3 1/4"); a piece wider than the room is broken where it must.
 * With no room (`room` 0) it gives the pieces it can be broken into.
 */
function wrapNarrow(value: string, size: number, room: number): string[] {
  const fits = (v: string) => letterWidth(v, size, SANS) <= room
  const lines: string[] = []
  let rest = value.trim()
  while (rest) {
    if (fits(rest)) { lines.push(rest); break }
    const legal: number[] = []
    for (let i = 1; i < rest.length; i++) if (/[xX]/.test(rest[i - 1]) || rest[i - 1] === ' ' && !/^\d+\/\d/.test(rest.slice(i))) legal.push(i)
    let cut = room > 0 ? legal.filter(i => fits(rest.slice(0, i).trim())).at(-1) ?? -1 : legal[0] ?? rest.length
    // A cell too narrow for even one letter still takes a letter a line.
    if (cut < 0) { cut = Math.max(1, rest.length - 1); while (cut > 1 && !fits(rest.slice(0, cut))) cut-- }
    cut = Math.max(1, cut)
    lines.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim()
  }
  return lines.length ? lines : ['']
}

interface Columns { item: number; qty: number; size: number; description: number }
interface Laid { blocks: Array<Array<{ row: SheetRow; lines: string[]; height: number }>>; size: number; width: number; top: number }

/**
 * The original Spoolyard material list: description first, open rows, no production form grid. It is laid out by
 * the room it has: under the heading when it fits there, else beside it from the top of the frame; at the narrowest
 * width and largest lettering that hold it in one block, and only then continued in further blocks to the left.
 */
export function classicMaterials(doc: IsoDocument, spool: string, width: number, height: number, rows: SheetRow[], whole = false) {
  const s = height / 850, info = doc.sheets?.[spool] ?? {}
  const bottom = 640 * s, right = width - 40 * s, headerHeight = 45 * s, gap = 18 * s
  /**
   * Widest the blocks together may be, leaving the drawing and its heading room on the left; a sheet of its own (`whole`)
   * gives the list the whole frame below the heading, flush left.
   */
  const room = whole ? width - 80 * s : width - 220 * s
  const largest = 8.5 * s, smallest = 5.6 * s
  const widths = info.bomWidth != null ? [Math.min(width - 100 * s, info.bomWidth)] : [300, 360, 420].map(w => Math.min(width - 100 * s, w * s))
  const tops = whole ? [110 * s] : [110 * s, 30 * s]
  /**
   * Lettering in the list is never drawn smaller than the drawing's own lettering (or the list's, when that is
   * smaller): a value too long for its column at that height is wrapped in the column instead.
   */
  const least = (size: number) => Math.min(size, draftingSizes(doc).text)
  // A list is laid out at several widths, lettering sizes and tops; each cell is wrapped, and each set of columns
  // fitted, once.
  const wrapped = new Map<string, string[]>(), fittedColumns = new Map<string, Columns>()
  const wrapCell = (value: string, size: number, room: number) => {
    const key = `${size}|${room}|${value}`
    let lines = wrapped.get(key)
    if (!lines) wrapped.set(key, lines = wrapCellOnce(value, size, room))
    return lines
  }
  const columns = (tableWidth: number, size: number): Columns => {
    const key = `${tableWidth}|${size}`
    let c = fittedColumns.get(key)
    if (!c) fittedColumns.set(key, c = columnsOnce(tableWidth, size))
    return c
  }
  const columnsOnce = (tableWidth: number, size: number): Columns => {
    const held = info.bomColumns
    const narrow = Math.min(1, (tableWidth - 90 * s) / (held ?? DEFAULT_COLUMNS.map(v => v * s)).reduce((a, b) => a + b, 0))
    const base = (held ?? DEFAULT_COLUMNS.map(v => v * s)).map(v => v * narrow)
    const of = ([item, qty, nd]: number[]): Columns => ({ item, qty, size: nd, description: tableWidth - item - qty - nd })
    if (held) return of(base)
    /**
     * A narrow column (item, quantity, size) is as wide as its longest value at the list's lettering needs, taken
     * from the description, which keeps at least `DESCRIPTION_SHARE` of the table; or, where that would wrap the
     * descriptions onto more lines, it wraps its long values (a bolt size, a reducing size) at their spaces and X,
     * widening only for its heading or a piece that cannot be broken.
     */
    const fitted = (whole: boolean) => {
      const need = (values: string[], heading: string, width: number) => Math.max(width, letterWidth(heading, 9 * s, SANS) / CELL_ROOM + 2 * s,
        ...values.flatMap(v => whole ? [v] : wrapNarrow(v, least(size), 0)).map(v => letterWidth(v, least(size), SANS) / CELL_ROOM + 2 * s))
      const wanted = [need(rows.map(r => String(r.id)), '#', base[0]), need(rows.map(r => r.qtyText), 'QTY', base[1]), need(rows.map(r => r.nd), sizeHeader(doc), base[2])]
      const spare = tableWidth * (1 - DESCRIPTION_SHARE), total = wanted.reduce((a, b) => a + b, 0)
      // Beyond what the description can spare, each column gives back in proportion to what it grew, and wraps.
      const grown = wanted.map((w, i) => w - base[i]), extra = grown.reduce((a, b) => a + b, 0)
      const k = total <= spare || extra <= 1e-9 ? 1 : Math.max(0, (spare - base.reduce((a, b) => a + b, 0)) / extra)
      return of(base.map((w, i) => w + grown[i] * Math.min(1, k)))
    }
    const lines = (c: Columns) => rows.reduce((sum, row) => sum + rowLines(row, c, size), 0)
    const whole = fitted(true), wrapped = fitted(false)
    return lines(whole) <= lines(wrapped) ? whole : wrapped
  }
  /** The lines a row takes: its description's, or a narrow cell's where that wraps to more. */
  const rowLines = (row: SheetRow, c: Columns, size: number) => {
    const flagged = overriddenCells(row).has('description')
    const description = wrapCell(wrapSource(row), size, c.description - 10 * s - (flagged ? mark(size) : 0)).length
    return Math.max(description, ...Object.values(cells(row, c, size)).map(v => v.lines.length))
  }
  /** A centred cell: one line at the list's lettering, smaller only down to `least`, else wrapped in its column. */
  const cell = (value: string, size: number, room: number): { cap: number; lines: string[] } => {
    const wide = letterWidth(value, size, SANS)
    if (wide <= room) return { cap: size, lines: [value] }
    const cap = Math.max(least(size), size * room / Math.max(1e-9, wide))
    if (letterWidth(value, cap, SANS) <= room + 1e-6) return { cap, lines: [value] }
    return { cap: least(size), lines: wrapNarrow(value, least(size), room) }
  }
  const cells = (row: SheetRow, c: Columns, size: number) => {
    const flagged = overriddenCells(row)
    return {
      id: cell(String(row.id), size, c.item * CELL_ROOM),
      nd: cell(row.nd, size, c.size * CELL_ROOM - (flagged.has('nd') ? mark(size) : 0)),
      qty: cell(row.qtyText, size, c.qty * CELL_ROOM - (flagged.has('qtyText') ? mark(size) : 0))
    }
  }
  const marks = rows.some(r => overriddenCells(r).size)
  /** Room the hand-entry mark takes at the end of a cell. */
  const mark = (size: number) => size * 1.4
  const layout = (tableWidth: number, top: number, size: number): Laid => {
    const c = columns(tableWidth, size), blocks: Laid['blocks'] = [[]]
    let y = top + headerHeight
    for (const row of rows) {
      const flagged = overriddenCells(row).has('description')
      const lines = wrapCell(wrapSource(row), size, c.description - 10 * s - (flagged ? mark(size) : 0))
      const held = [row.key, ...((row as ListedRow).aliases ?? [])].map(k => k ? info.bomRowHeights?.[k] : undefined).find(h => h != null)
      const h = Math.max(held ?? 0, (rowLines(row, c, size) + 1) * size * PITCH)
      if (y + h > bottom - (marks ? size * 2 : 0) && blocks.at(-1)!.length) { blocks.push([]); y = top + headerHeight }
      blocks.at(-1)!.push({ row, lines, height: h }); y += h
    }
    return { blocks, size, width: tableWidth, top }
  }
  const fitsDown = (l: Laid) => l.blocks.every(b => b.reduce((y, e) => y + e.height, l.top + headerHeight) <= bottom - (marks ? l.size * 2 : 0) + 1e-6)
  const across = (l: Laid) => l.blocks.length * (l.width + gap) - gap
  const sizes: number[] = []
  for (let v = largest; v >= smallest - 1e-9; v *= 0.9) sizes.push(v)
  let chosen: Laid | undefined
  // One block, below the heading if it fits there, else from the top of the frame beside it; lettering only as small
  // as needed.
  // Of the widths that hold it, the narrowest whose descriptions wrap little more than at the widest.
  const length = (l: Laid) => l.blocks.flat().reduce((y, e) => y + e.height, 0)
  for (const size of sizes) {
    for (const top of tops) {
      const fitting = widths.map(w => layout(w, top, size)).filter(l => l.blocks.length === 1 && fitsDown(l))
      if (!fitting.length) continue
      const shortest = Math.min(...fitting.map(length))
      chosen = fitting.find(l => length(l) <= shortest * 1.15)
      break
    }
    if (chosen) break
  }
  // Otherwise as few blocks as fit across the sheet, at the largest lettering that lets them.
  if (!chosen)
    for (const size of [...sizes, ...[0.9, 0.8, 0.7].map(f => smallest * f)]) {
      const fitting = widths.map(w => layout(w, tops.at(-1)!, size)).filter(l => across(l) <= room)
      if (fitting.length) { chosen = fitting.reduce((a, b) => across(b) < across(a) ? b : a); break }
    }
  chosen ??= layout(widths[0], tops.at(-1)!, smallest * 0.7)
  const { blocks, size, width: tableWidth, top } = chosen
  const c = columns(tableWidth, size)
  const left = whole ? 40 * s : right - blocks.length * tableWidth - (blocks.length - 1) * gap
  const primitives: Primitive[] = [], exclusions: SheetRect[] = []
  const text = (x: number, y: number, value: string, cap: number, anchor?: 'middle', field?: string) =>
    primitives.push({ type: 'text', p: [x, y], text: value, size: cap, lettering: SANS, layer: 'BOM', ...(anchor ? { anchor } : {}), ...(field ? { field } : {}) })
  let lastEnd = top, lastX = left
  for (const [i, block] of blocks.entries()) {
    const x = left + i * (tableWidth + gap), descX = x + c.item, sizeX = x + tableWidth - c.qty - c.size, qtyX = x + tableWidth - c.qty
    text(x + 5 * s, top + 16 * s, 'BILL OF MATERIALS', 13 * s)
    text(x + c.item / 2, top + 36 * s, '#', 9 * s, 'middle')
    text(descX + 5 * s, top + 36 * s, 'DESCRIPTION', 9 * s)
    text(sizeX + c.size / 2, top + 36 * s, sizeHeader(doc), 9 * s, 'middle')
    text(qtyX + c.qty / 2, top + 36 * s, 'QTY', 9 * s, 'middle')
    primitives.push({ type: 'line', a: [x, top + headerHeight], b: [x + tableWidth, top + headerHeight], layer: 'BOM' })
    let y = top + headerHeight
    for (const entry of block) {
      const flagged = overriddenCells(entry.row), middle = y + entry.height / 2 + size * .4
      const baseline = y + (entry.height - (entry.lines.length - 1) * size * PITCH) / 2 + size * .4
      // Each cell prints the material-list field of its row and column, as CAD attributes carry it.
      const field = (column: string, n = 0) => `bom.${entry.row.id}.${column}${n ? `#${n + 1}` : ''}`
      const narrow = cells(entry.row, c, size)
      // A wrapped narrow cell is centred on the row like a one-line one.
      const centred = (x0: number, v: { cap: number; lines: string[] }, column: string) => v.lines.forEach((line, n) =>
        text(x0, middle + (n - (v.lines.length - 1) / 2) * size * PITCH, line, v.cap, 'middle', field(column, n)))
      centred(x + c.item / 2, narrow.id, 'id')
      entry.lines.forEach((line, n) => text(descX + 5 * s, baseline + n * size * PITCH, line, size, undefined, field('description', n)))
      centred(sizeX + c.size / 2, narrow.nd, 'nd')
      centred(qtyX + c.qty / 2, narrow.qty, 'qty')
      // A cell entered by hand is marked, so an override is never silent.
      const at = (x1: number) => primitives.push(deltaMark([x1 - size * 1.2, middle], size * 0.8, 'BOM'))
      if (flagged.has('description')) at(sizeX)
      if (flagged.has('nd')) at(qtyX)
      if (flagged.has('qtyText')) at(x + tableWidth)
      y += entry.height
    }
    exclusions.push([x - 8 * s, top - 8 * s, x + tableWidth + 8 * s, y + 8 * s + (marks ? size * 2 : 0)])
    lastEnd = y; lastX = x
  }
  if (marks) {
    primitives.push(deltaMark([lastX + 5 * s, lastEnd + size * 1.6], size * 0.8, 'BOM'))
    text(lastX + 5 * s + size * 1.4, lastEnd + size * 1.6, 'ENTERED BY HAND, NOT CALCULATED', size * 0.85)
  }
  return { primitives, exclusions, left }
}
