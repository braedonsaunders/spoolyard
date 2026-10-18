import type { Point, Primitive, SymbolRef } from '../drawing'
import { sheetInfoOf, styleOf, titleBlockOf, type IsoDocument } from '../model'
import { LINE_SPACING, strokeText } from '../stroke-font'
import { northOnPage } from './layout'
import {
  templateBindings, templateLayout, type SheetTemplate, type TemplateBom, type TemplateCondition, type TemplateItem,
  type TemplateNorth, type TemplateNotes, type TemplatePlace, type TemplatePoint, type TemplateRect
} from '../sheet-template'
import {
  PAPER_MM, deltaMark, draftingNotes, materialsContinued, openRegions, letterWidth, overriddenCells, paperOf, sheetPipeSpecs, sheetScale, viewNote,
  type SheetFinish, type SheetFrame, type SheetFrameInput, type SheetNumbering, type SheetRect, type SheetRow
} from './sheet-frame'

const up = (v: unknown) => String(v ?? '').trim().toUpperCase()

/** Splits text into lines no wider than `width`, breaking words only when a single word is too wide. */
export function wrapText(text: string, size: number, width: number, factor = 1, lettering: 'cad' | 'sans' = 'cad'): string[] {
  // A line that reaches the edge within a thousandth (rounding of the paper conversion) still fits.
  const measure = (s: string) => letterWidth(s, size, lettering, factor) / (1 + 1e-3)
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
      if (measure(next) <= width) { line = next; continue }
      if (line) out.push(line)
      while (word.length > 1 && measure(word) > width) {
        let n = word.length - 1
        while (n > 1 && measure(word.slice(0, n)) > width) n--
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

/** What each `{binding}` of a template prints on one spool's sheet. */
export function templateValues(doc: IsoDocument, spool: string, view: SheetFrameInput['view'] = 'iso', scale = '', note?: string,
  numbering?: SheetNumbering): Record<string, string> {
  const tb = titleBlockOf(doc), info = sheetInfoOf(doc, spool), metric = doc.units === 'mm'
  const spools = [...new Set(doc.runs.map(r => r.spool))]
  // One sheet a spool, unless a spool's material list has a sheet of its own and the set is numbered sheet by sheet.
  const number = numbering ? numbering.number - 1 : spools.indexOf(spool), count = numbering ? numbering.count : spools.length
  const values: Record<string, string> = {
    'doc.title': doc.title, 'doc.customer': doc.customer, 'doc.project': doc.project, 'doc.drawing': doc.drawing,
    'doc.drawnBy': doc.drawnBy, 'doc.checkedBy': doc.checkedBy,
    'sheet.drawingNumber': info.drawingNumber, 'sheet.lineNumber': info.lineNumber, 'sheet.revision': info.revision, 'sheet.spool': spool,
    'sheet.number': number >= 0 ? String(number + 1) : '', 'sheet.count': count ? String(count) : '',
    'sheet.of': number >= 0 ? `${number + 1} OF ${count}` : '',
    'units.pressure': metric ? 'kPa' : 'PSIG', 'units.temperature': metric ? '°C' : '°F', 'units.system': metric ? 'METRIC' : 'IMPERIAL',
    'units.length': metric ? 'MM' : 'FT-IN', dateFormat: up(tb.dateFormat) || 'YY-MM-DD', scale, view: view.toUpperCase(),
    viewNote: note ?? viewNote(view), paper: paperOf(doc).toUpperCase(),
    pipeSpecs: sheetPipeSpecs(doc, spool)
  }
  for (const key of ['designedBy', 'date', 'checkedBy', 'projectLeader', 'disciplineLeader', 'approvedBy', 'insulationThickness',
    'insulationCladding', 'tracing', 'pipeSpec', 'specRevision', 'designCode', 'product', 'refArea', 'lineNumber', 'projectNumber'] as const)
    values[`tb.${key}`] = tb[key] ?? ''
  // The title block's pipe spec is its pipes' until it is entered; before any pipe is drawn, the document's.
  if (!values['tb.pipeSpec'] && !doc.runs.length) values['tb.pipeSpec'] = [...new Set((doc.specs ?? []).map(s => s.id))].join(', ')
  for (const row of ['design', 'operating', 'test'] as const) {
    values[`tb.${row}.pressure`] = tb.conditions[row][0]
    values[`tb.${row}.temperature`] = tb.conditions[row][1]
  }
  tb.referenceDrawings.forEach((r, i) => { values[`tb.reference.${i + 1}`] = r.trim() })
  for (const [key, value] of Object.entries(tb.custom ?? {})) values[`field.${key}`] = value
  return values
}

/**
 * A title-block template drawn on one spool's sheet: border, items, revisions, logos, north symbol, notes and the
 * material list, with the model viewport and the named areas the model keeps off. Every template length is paper
 * mm, scaled by one factor in x and y.
 */
export function templateSheet(input: SheetFrameInput, template: SheetTemplate): SheetFrame {
  const { doc, spool, width, height, rows, view = 'iso' } = input, materials = input.materials ?? 'on'
  const paper = paperOf(doc), u = height / PAPER_MM[paper].height, paperW = width / u, paperH = height / u
  const layout = templateLayout(template, paper, [paperW, paperH])
  const [tw, th] = layout.size, s = Math.min(paperW / tw, paperH / th), k = s * u
  const style = styleOf(doc), lettering = style.lettering
  const spools = [...new Set(doc.runs.map(r => r.spool))]
  const multi = input.numbering ? input.numbering.count > 1 : spools.length > 1 && spools.indexOf(spool) >= 0
  const scale = sheetScale(doc), deferScale = style.layout === 'scale'
  const values = templateValues(doc, spool, view, scale, materials === 'only' ? 'MATERIAL LIST' : input.viewNote, input.numbering)
  const met: Record<TemplateCondition, boolean> = {
    multiSheet: multi, singleSheet: !multi, toScale: style.layout === 'scale', notToScale: style.layout !== 'scale',
    metric: doc.units === 'mm', imperial: doc.units !== 'mm'
  }
  const fallback: TemplatePlace = layout.place ?? 'bl'
  /** A template point on the sheet, measured from the paper corner `place`. */
  const at = (p: TemplatePoint, place: TemplatePlace = fallback): Point => [
    ((place[1] === 'r' ? paperW - tw * s : 0) + p[0] * s) * u,
    ((place[0] === 'b' ? paperH - th * s : 0) + p[1] * s) * u
  ]
  const box = (r: TemplateRect, place: TemplatePlace | [TemplatePlace, TemplatePlace] = fallback): SheetRect => {
    const [a, b] = Array.isArray(place) ? place : [place, place]
    const p = at([r[0], r[1]], a), q = at([r[2], r[3]], b)
    return [p[0], p[1], q[0], q[1]]
  }
  const pen = (mm = 0.25) => mm * u
  const out: Primitive[] = [], late: TemplateItem[] = []
  // The form (border, items, revisions) is one TITLEBLOCK and the material list one BOM, both inserted at the sheet's
  // lower-left corner; their bound lettering prints fields.
  const titleBlock: SymbolRef = { name: 'TITLEBLOCK', at: [0, height], rotation: 0 }
  const claim = (ink: Primitive[], symbol: SymbolRef, from = 0) => { for (let i = from; i < ink.length; i++) ink[i].symbol ??= symbol }
  const exclusions: SheetRect[] = [], obstacles: SheetRect[] = []
  /** Lettering at a baseline point in sheet units, made smaller to fit `room` when given. */
  const letter = (into: Primitive[], layer: string, value: string, p: Point, size: number, anchor: 'start' | 'middle' | 'end' = 'start', room = Infinity, factor = 1, field?: string) => {
    if (!value) return size
    const wide = letterWidth(value, size, lettering, factor), cap = wide > room ? size * room / wide : size
    into.push({ type: 'text', p, text: value, size: cap, layer, anchor, ...(factor !== 1 ? { width: factor } : {}), ...(field ? { field } : {}) })
    return cap
  }
  /** A template text with its bindings filled in; nothing when every binding is empty. */
  const fill = (text: string, upper?: boolean, scaleText = scale) => {
    const names = templateBindings(text)
    const value = (name: string) => { const v = name === 'scale' ? scaleText : values[name] ?? ''; return upper ? up(v) : v.trim() }
    if (names.length && names.every(n => !value(n))) return ''
    return text.replace(/\{([A-Za-z0-9_.-]+)\}/g, (_, n: string) => value(n))
  }
  const drawItem = (item: TemplateItem, into: Primitive[], scaleText = scale) => {
    if (item.when && !met[item.when]) return
    if (item.type === 'text') {
      const value = fill(item.text, item.upper, scaleText)
      if (!value) return
      const lines = value.split('\n'), size = item.size * k, factor = item.widthFactor ?? 1
      const widest = Math.max(...lines.map(l => letterWidth(l, size, lettering, factor)))
      const cap = item.fit != null && widest > item.fit * k ? size * item.fit * k / widest : size
      const p = at(item.at, Array.isArray(item.place) ? item.place[0] : item.place), pitch = (item.pitch ?? item.size * LINE_SPACING) * k
      // Lettering with bindings prints those fields; a fixed caption is part of the form.
      const field = [...new Set(templateBindings(item.text))].join('+')
      lines.forEach((l, i) => letter(into, item.layer ?? 'TITLE', l, [p[0], p[1] + i * pitch], cap, item.anchor, Infinity, factor, field && (i ? `${field}#${i + 1}` : field)))
    } else if (item.type === 'line') {
      const [a, b] = Array.isArray(item.place) ? item.place : [item.place, item.place]
      into.push({ type: 'line', a: at(item.a, a), b: at(item.b, b), layer: 'TITLE', weight: pen(item.weight) })
    } else if (item.type === 'rect') {
      const r = box(item.rect, item.place)
      into.push({ type: 'polyline', closed: true, layer: 'TITLE', weight: pen(item.weight), ...(item.fill ? { fill: true } : {}),
        points: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] })
    } else if (item.type === 'logo') {
      const logo = titleBlockOf(doc).logos[item.slot]
      // An unnamed placeholder keeps the client logo in its own slot; it draws nothing.
      if (!logo?.name) return
      const pad = (item.pad ?? 0) * k, r = box(item.rect, Array.isArray(item.place) ? item.place[0] : item.place)
      const bw = r[2] - r[0] - 2 * pad, bh = r[3] - r[1] - 2 * pad
      const aspect = imageAspect(logo.dataUrl) ?? bw / bh, w = Math.min(bw, bh * aspect), h = w / aspect
      into.push({ type: 'image', p: [(r[0] + r[2]) / 2 - w / 2, (r[1] + r[3]) / 2 - h / 2], width: w, height: h, href: logo.dataUrl, layer: 'TITLE' })
    } else if (item.type === 'revisions') {
      const place = Array.isArray(item.place) ? item.place[0] : item.place, slots = item.rows.length - 1
      const shown = titleBlockOf(doc).revisions.slice(-slots)
      shown.forEach((rev, i) => {
        const row = item.fill === 'up' ? slots - 1 - i : i, y = (item.rows[row] + item.rows[row + 1]) / 2 + (item.offset ?? item.size / 2)
        item.fields.forEach((field, c) => {
          const x0 = item.columns[c], x1 = item.columns[c + 1], inset = item.inset ?? 1
          letter(into, 'TITLE', item.upper ? up(rev[field]) : rev[field].trim(), at([(x0 + x1) / 2, y], place), item.size * k, 'middle', (x1 - x0 - 2 * inset) * k, 1, `rev.${row + 1}.${field}`)
        })
      })
    }
  }

  // Border, with heavy rules that end at the outside of the frame line.
  const border = box(layout.border.rect, ['tl', 'br']), half = pen(layout.border.weight) / 2
  out.push({ type: 'polyline', closed: true, layer: 'BORDER', weight: pen(layout.border.weight),
    points: [[border[0], border[1]], [border[2], border[1]], [border[2], border[3]], [border[0], border[3]]] })
  for (const [edge, mm] of Object.entries(layout.border.bars ?? {}) as Array<['top' | 'bottom' | 'left' | 'right', number]>) {
    if (!mm) continue
    const t = mm * k / 2, [x0, y0, x1, y1] = border
    const r: SheetRect = edge === 'top' || edge === 'bottom'
      ? [x0 - half, (edge === 'top' ? y0 : y1) - t, x1 + half, (edge === 'top' ? y0 : y1) + t]
      : [(edge === 'left' ? x0 : x1) - t, y0 - half, (edge === 'left' ? x0 : x1) + t, y1 + half]
    out.push({ type: 'polyline', layer: 'BORDER', closed: true, fill: true, weight: 0.001, points: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] })
  }
  const viewport = box(layout.viewport, ['tl', 'br'])
  claim(out, titleBlock)

  // North symbol, on plan and isometric views (a material-list sheet has no view).
  const northShown = !!layout.north && (view === 'iso' || view === 'plan') && materials !== 'only'
  if (northShown) {
    const north = drawNorth(doc, view, layout.north!, (p, place) => at(p, place ?? layout.north!.place ?? 'tl'), pen)
    claim(north.primitives, { name: 'NORTH-ARROW', at: [(north.box[0] + north.box[2]) / 2, (north.box[1] + north.box[3]) / 2], rotation: 0 })
    out.push(...north.primitives)
    exclusions.push(north.box); obstacles.push(north.box)
  }
  const northBox = exclusions[0]

  // Form areas the model keeps off.
  for (const r of layout.keepOut ?? []) { const b = box(r.rect, r.place); exclusions.push(b); obstacles.push(b) }

  // Notes, numbered with a hanging indent, growing up from their last baseline.
  let notesBox: SheetRect | undefined
  if (layout.notes) {
    const laid = drawNotes(doc, layout.notes, (p) => at(p, layout.notes!.place ?? fallback), k, lettering, layout.notes.drafting ? draftingNotes(doc, deferScale ? '' : scale) : [])
    if (laid) {
      out.push(...laid.primitives)
      const area = layout.notes.area, place = layout.notes.place ?? fallback
      const x0 = at([area[0], 0], place)[0], x1 = at([area[1], 0], place)[0], y1 = at([0, area[2]], place)[1], gap = layout.gap * k
      notesBox = [x0 - gap / 2, laid.top - gap / 2, x1, y1]
      exclusions.push(notesBox); obstacles.push([x0, laid.top, x1, y1])
    }
  }

  // The material list.
  const bomBlocks: SheetRect[] = []
  if (layout.bom) {
    const laid = materials === 'apart' ? continuedBom(layout.bom, input.numbering?.materials, k, lettering, obstacles, layout.gap * k, at, pen)
      : drawBom(doc, spool, layout.bom, rows, k, lettering, obstacles, viewport[3], layout.gap * k, at, pen)
    claim(laid.primitives, { name: 'BOM', at: [0, height], rotation: 0 })
    out.push(...laid.primitives)
    for (const b of laid.blocks) { exclusions.push(b); bomBlocks.push(b) }
  }

  // Template items; a to-scale sheet's scale waits for the fit.
  for (const item of layout.items) {
    if (deferScale && item.type === 'text' && templateBindings(item.text).includes('scale')) { late.push(item); continue }
    const from = out.length
    drawItem(item, out)
    claim(out, titleBlock, from)
  }

  const clip = (r: SheetRect): SheetRect => [Math.max(r[0], viewport[0]), Math.max(r[1], viewport[1]), Math.min(r[2], viewport[2]), Math.min(r[3], viewport[3])]
  const kept = exclusions.map(clip).filter(r => r[2] > r[0] && r[3] > r[1])
  const titleInk = out.filter(p => p.layer === 'TITLE').flatMap(p => p.type === 'line' ? [p.a, p.b] : p.type === 'polyline' ? p.points : [])
  const title: SheetRect[] = [...(layout.keepOut ?? []).map(r => box(r.rect, r.place))]
  if (titleInk.length) title.push([Math.min(...titleInk.map(p => p[0])), Math.min(...titleInk.map(p => p[1])), Math.max(...titleInk.map(p => p[0])), Math.max(...titleInk.map(p => p[1]))])
  return {
    primitives: out,
    viewport,
    exclusions: kept,
    regions: { border, title, bom: bomBlocks, notes: notesBox, north: northBox && northShown ? northBox : undefined, ...openRegions(viewport, kept) },
    paper: { width: paperW, height: paperH, unitsPerMm: u },
    finish: (fit: SheetFinish) => {
      const into: Primitive[] = [], printed = sheetScale(doc, fit)
      for (const item of late) drawItem(item, into, printed)
      claim(into, titleBlock)
      return into
    }
  }
}

// A block N, relative to the symbol's centre in units of its ellipse's half-height.
const N_LETTER: TemplatePoint[] = [
  [-45, 27], [-45, -29], [-30.1, -29], [29.25, 15.5], [29.25, -29], [43.25, -29], [43.25, 27], [28, 27], [-31, -17.1], [-31, 27]
].map(([x, y]) => [x / 52.5, y / 52.5])

/** Ellipse, a tick out from it on each compass point as the view draws them, plant north an arrow, a filled N. */
function drawNorth(doc: IsoDocument, view: 'iso' | 'plan', spec: TemplateNorth, at: (p: TemplatePoint, place?: TemplatePlace) => Point, pen: (mm?: number) => number) {
  const [bx0, by0, bx1, by1] = spec.box
  const [cx, cy] = spec.centre ?? [(bx0 + bx1) / 2, (by0 + by1) / 2]
  const ry = spec.ry ?? (by1 - by0) / 4, rx = spec.rx ?? ry * 1.68, tick = spec.tick ?? ry * 0.55, arrow = spec.arrow ?? ry * 0.29, barb = spec.barb ?? ry * 0.095
  const letter = spec.letter ?? N_LETTER.map(([x, y]) => [x * ry, y * ry] as TemplatePoint)
  const weight = pen(spec.weight)
  // East, north, west and south of the plant as the view draws them, turned by the whole north angle.
  const ticks = [0, 1, 2, 3].map(i => {
    const v = northOnPage(view, (doc.north ?? 0) + (i - 1) * 90), l = Math.hypot(...v) || 1
    const u: Point = [v[0] / l, v[1] / l], r = 1 / Math.hypot(u[0] / rx, u[1] / ry)
    return { u, inner: [u[0] * r, u[1] * r] as Point, outer: [u[0] * (r + tick), u[1] * (r + tick)] as Point }
  })
  // Drawn at its own proportions, smaller when a rotated north puts a tick past its box.
  const half = [Math.min(cx - bx0, bx1 - cx), Math.min(cy - by0, by1 - cy)]
  const k = Math.min(1, ...ticks.map(t => Math.min(half[0] / Math.max(1e-9, Math.abs(t.outer[0])), half[1] / Math.max(1e-9, Math.abs(t.outer[1])))))
  const off = (p: Point) => at([cx + p[0] * k, cy + p[1] * k])
  const primitives: Primitive[] = []
  const n = 72
  primitives.push({ type: 'polyline', layer: 'TEXT', weight, closed: true,
    points: Array.from({ length: n }, (_, i) => off([rx * Math.cos(2 * Math.PI * i / n), ry * Math.sin(2 * Math.PI * i / n)])) })
  for (const t of ticks) primitives.push({ type: 'line', a: off(t.inner), b: off(t.outer), layer: 'TEXT', weight })
  // Plant north's tick ends in an arrowhead.
  const { u, outer } = ticks[1], base: Point = [outer[0] - u[0] * arrow, outer[1] - u[1] * arrow]
  if (styleOf(doc).northMark !== 'ticks') primitives.push({ type: 'polyline', layer: 'TEXT', weight: 0.2, closed: true, fill: true,
    points: [off(outer), off([base[0] - u[1] * barb, base[1] + u[0] * barb]), off([base[0] + u[1] * barb, base[1] - u[0] * barb])] })
  primitives.push({ type: 'polyline', layer: 'TEXT', weight: 0.2, closed: true, fill: true, points: letter.map(p => off(p)) })
  const a = at([bx0, by0]), b = at([bx1, by1])
  return { primitives, box: [a[0], a[1], b[0], b[1]] as SheetRect }
}

/** The general notes (and drafting notes), numbered with a hanging indent, lettered smaller rather than rise past `top`. */
function drawNotes(doc: IsoDocument, spec: TemplateNotes, at: (p: TemplatePoint) => Point, k: number, lettering: 'cad' | 'sans', drafting: string[]) {
  const notes = [...doc.notes.replace(/\r\n?/g, '\n').split('\n').map(s => up(s)).filter(Boolean)]
  if (notes[0] && /^NOTES?:?$/.test(notes[0])) notes.shift()
  notes.push(...drafting)
  if (!notes.length) return undefined
  const x = (mm: number) => at([mm, 0])[0], y = (mm: number) => at([0, mm])[1]
  const baseline = y(spec.bottom), room = baseline - y(spec.top), factor = spec.widthFactor ?? 1
  const textX = x(spec.text), wide = x(spec.right) - textX
  let scale = 1, laid: Array<{ label: string; lines: string[] }> = []
  for (let pass = 0; pass < 8; pass++) {
    let count = 0
    laid = notes.map(note => {
      const own = /^(\d+|[A-Z])[.)]\s+(.*)$/.exec(note)
      const label = own ? `${own[1]}.` : `${++count}.`
      if (own && /^\d+$/.test(own[1])) count = Number(own[1])
      return { label, lines: wrapText(own ? own[2] : note, spec.size * k * scale, wide, factor, lettering) }
    })
    const total = laid.reduce((sum, n) => sum + n.lines.length, 1)
    if (total * spec.pitch * k * scale <= room) break
    scale *= Math.max(0.5, Math.sqrt(room / (total * spec.pitch * k * scale)))
  }
  const cap = spec.size * k * scale, pitch = spec.pitch * k * scale, primitives: Primitive[] = []
  const put = (value: string, px: number, py: number, f = 1) =>
    primitives.push({ type: 'text', p: [px, py], text: value, size: cap, layer: 'NOTES', anchor: 'start', ...(f !== 1 ? { width: f } : {}) })
  let line = baseline - laid.reduce((sum, n) => sum + n.lines.length, 0) * pitch
  put(spec.title ?? 'NOTES:', x(spec.header), line)
  const top = line - cap
  for (const note of laid) {
    line += pitch
    put(note.label, x(spec.label), line)
    note.lines.forEach((l, i) => put(l, textX, line + i * pitch, factor))
    line += (note.lines.length - 1) * pitch
  }
  return { primitives, top }
}

/**
 * In the material list's place, on a drawing whose list has a sheet of its own: the list's title row over one row
 * noting the sheet it continues on, as wide as the table.
 */
function continuedBom(spec: TemplateBom, sheet: number | undefined, k: number, lettering: 'cad' | 'sans', obstacles: SheetRect[], gap: number,
  at: (p: TemplatePoint, place?: TemplatePlace) => Point, pen: (mm?: number) => number) {
  const place = spec.place ?? 'tr', [right, top0] = at([spec.right, spec.top], place)
  const width = spec.width * k, x0 = right - width, size = spec.size * k, row = spec.row * k, inset = (spec.inset ?? 1) * k
  let top = top0
  for (const o of obstacles) if (o[0] < right && o[2] > x0 && o[3] > top0 && o[1] < top0 + 3 * row) top = Math.max(top, o[3] + gap)
  const rows = spec.title ? 2 : 1, end = top + rows * row, primitives: Primitive[] = [], weight = pen(spec.weight)
  const line = (a: Point, b: Point) => primitives.push({ type: 'line', a, b, layer: 'BOM', weight })
  line([x0, top], [right, top]); line([x0, end], [right, end]); line([x0, top], [x0, end]); line([right, top], [right, end])
  const note = materialsContinued(sheet), room = width - 2 * inset
  const fit = (v: string) => Math.min(size, size * room / Math.max(1e-9, letterWidth(v, size, lettering)))
  const middle = (y0: number, cap: number) => (y0 + y0 + row) / 2 + cap / 2
  if (spec.title) {
    primitives.push({ type: 'text', p: [(x0 + right) / 2, middle(top, fit(spec.title))], text: spec.title, size: fit(spec.title), layer: 'BOM', anchor: 'middle' })
    line([x0, top + row], [right, top + row])
  }
  const y = top + (rows - 1) * row
  primitives.push({ type: 'text', p: [(x0 + right) / 2, middle(y, fit(note))], text: note, size: fit(note), layer: 'BOM', anchor: 'middle', field: 'materials.continued' })
  return { primitives, blocks: [[x0 - gap / 2, top, right, end + gap / 2]] as SheetRect[] }
}

interface BomCell { lines: string[]; base: number[]; height: number; ink: [number, number] }
interface BomBlock { x0: number; x1: number; top: number; bottom: number; scale: number; widths: number[]; rows: Array<{ row: SheetRow; cells: BomCell[]; height: number }> }

/**
 * The material list in blocks hung from the top of its region: the first ends at the region's right, the rows that
 * do not fit continue in blocks to the left. Blocks keep clear of `obstacles` (the north symbol above, notes and
 * form areas below); a long list narrows its sized columns, then letters a little smaller, before it splits.
 */
function drawBom(doc: IsoDocument, spool: string, spec: TemplateBom, rows: SheetRow[], k: number, lettering: 'cad' | 'sans',
  obstacles: SheetRect[], floor: number, gap: number, at: (p: TemplatePoint, place?: TemplatePlace) => Point, pen: (mm?: number) => number) {
  const place = spec.place ?? 'tr', info = doc.sheets?.[spool]
  const [right, top0] = at([spec.right, spec.top], place), left = at([spec.left, spec.top], `${place[0]}l` as TemplatePlace)[0]
  const size = spec.size * k, rowH = spec.row * k, pitch = spec.pitch * k, raise = (spec.raise ?? 0) * k, inset = (spec.inset ?? 1) * k
  const pad = (spec.pad ?? 2.4) * k, weight = pen(spec.weight), headerRows = spec.title ? 2 : 1
  const order = spec.columns.map(c => c.field), sized = spec.columns.filter(c => c.field !== 'description')
  const bomWidth = info?.bomWidth ?? spec.width * k
  const text = (row: SheetRow, field: string) =>
    field === 'id' ? String(row.id) : field === 'qty' ? up(row.qtyText) : field === 'nd' ? row.nd : row.description
  const marked = (row: SheetRow, field: string) => {
    const cells = overriddenCells(row)
    return field === 'qty' ? cells.has('qtyText') : field === 'nd' ? cells.has('nd') : field === 'description' && cells.has('description')
  }
  const anyMarked = rows.some(r => overriddenCells(r).size)
  const delta = size * 0.75 * 1.15 + size * 0.3
  // Room for the hand-entry legend under the list.
  const legend = anyMarked ? pitch * 1.6 : 0
  const measure = (v: string) => Math.max(...wrapText(v, size, Infinity, 1, lettering).map(l => letterWidth(l, size, lettering)))
  const layout = (f: number, compact = false, tall = false): BomBlock[] | null => {
    const blockWidth = bomWidth * f
    // A wide QTY or ND widens its column rather than wrapping; a long list narrows them to their contents.
    let widths = sized.map(c => {
      const values = rows.flatMap(r => c.field === 'nd' ? r.nd.split(' ') : [text(r, c.field)])
      const need = Math.max(measure(c.title), ...values.map(measure)) + pad
      const least = (compact ? c.min ?? c.width! : c.width!) * k, most = (compact ? c.width! : c.max ?? c.width!) * k
      return Math.min(most, Math.max(least, need))
    })
    const held = info?.bomColumns
    if (held) {
      const wanted = held.slice(0, sized.length), sum = wanted.reduce((a, b) => a + b, 0)
      const fit = Math.min(1, Math.max(1, bomWidth - (spec.descriptionMin ?? 0) * k) / sum)
      widths = widths.map((w, i) => wanted[i] != null ? wanted[i] * fit : w)
    }
    const all = order.map(field => field === 'description' ? 0 : widths[sized.findIndex(c => c.field === field)])
    const d = order.indexOf('description')
    all[d] = bomWidth - all.reduce((a, b) => a + b, 0)
    const cap = size * f
    const cell = (value: string, room: number): BomCell => {
      const lines = wrapText(value, cap, room, 1, lettering)
      const raised = lines.map(l => extent(l, cap)[0] < -cap * 1.05)
      const base = [0]
      for (let i = 1; i < lines.length; i++) base.push(base[i - 1] + (pitch + (raised[i] ? raise : 0)) * f)
      const height = rowH * f + base[base.length - 1] + (lines.length > 1 && raised[0] ? raise * f : 0)
      const ink = lines.reduce<[number, number]>((acc, l, i) => {
        const [a, b] = extent(l, cap)
        return [Math.min(acc[0], base[i] + a), Math.max(acc[1], base[i] + b)]
      }, [Infinity, -Infinity])
      return { lines, base, height, ink }
    }
    /** Fills a block with rows from `from` while they fit above its bottom; where its last row ends. */
    const fillBlock = (block: BomBlock, from: number) => {
      const f = block.scale, ws = block.widths
      let y = block.top + headerRows * rowH * f
      for (let next = from; next < rows.length; next++) {
        const row = rows[next]
        const cells = order.map((field, i) => cell(text(row, field), ws[i] - (field === 'description' ? inset * 4 / 3 : inset) * f - (marked(row, field) ? delta * f : 0)))
        const heldHeight = row.key ? info?.bomRowHeights?.[row.key] : undefined
        const h = heldHeight == null ? Math.max(tall ? (rowH + ((spec.minLines ?? 1) - 1) * pitch) * f : 0, ...cells.map(c => c.height))
          : Math.max(heldHeight, ...cells.map(c => c.ink[1] - c.ink[0] + inset * f))
        if (y + h > block.bottom) break
        block.rows.push({ row, cells, height: h })
        y += h
      }
      return y
    }
    const blocks: BomBlock[] = []
    let next = 0, x1 = right
    while (next < rows.length || !blocks.length) {
      let x0 = x1 - blockWidth
      if (x0 < left) {
        if (x1 - left < blockWidth * 0.6) return null
        x0 = left
      }
      const span = (r: SheetRect) => r[0] < x1 && r[2] > x0
      const mid = (top0 + floor) / 2
      let top = top0, bottom = floor - legend
      for (const o of obstacles) if (span(o) && (o[1] + o[3]) / 2 < mid) top = Math.max(top, o[3] + gap)
      for (const o of obstacles) if (span(o) && (o[1] + o[3]) / 2 >= mid) bottom = Math.min(bottom, o[1] - gap - legend)
      const ws = all.map(w => w * f)
      ws[d] -= blockWidth - (x1 - x0)
      const block: BomBlock = { x0, x1, top, bottom, scale: f, widths: ws, rows: [] }
      const y = fillBlock(block, next)
      next += block.rows.length
      if (y > bottom || (!block.rows.length && next < rows.length)) return null
      blocks.push(block)
      x1 = x0 - gap
    }
    if (blocks.length < 2) return blocks
    // Read left to right: the blocks found for the list (the first at the region's right, the rest to its left) are
    // filled again from the leftmost, so the list runs on from each block to the next on its right.
    const reading = blocks.slice().reverse().map(b => ({ ...b, rows: [] as BomBlock['rows'] }))
    let from = 0
    for (const block of reading) {
      if (fillBlock(block, from) > block.bottom) return blocks
      from += block.rows.length
    }
    return from === rows.length ? reading.filter(b => b.rows.length) : blocks
  }
  // Rows at least `minLines` tall while the list fits one block; a list that then needs a second block keeps them short.
  const tall = (spec.minLines ?? 1) > 1 ? layout(1, false, true) : null
  let bom: BomBlock[] | null = tall?.length === 1 ? tall : layout(1)
  if (bom && bom.length > 1) {
    // Before splitting the table, narrow the sized columns and, if that is nearly enough, letter it a little smaller.
    for (const f of [1, 0.97, 0.94, 0.91]) {
      const compact = layout(f, true)
      if (compact && compact.length === 1) { bom = compact; break }
      if (f === 1 && compact && compact.length < bom.length) bom = compact
    }
  }
  for (let f = 1; !bom && f > 0.2; f *= 0.9) bom = layout(f)
  bom ??= layout(0.2)
  const primitives: Primitive[] = [], blocks: SheetRect[] = []
  const line = (x0: number, y0: number, x1: number, y1: number) => primitives.push({ type: 'line', a: [x0, y0], b: [x1, y1], layer: 'BOM', weight })
  const put = (value: string, x: number, y: number, cap: number, anchor: 'start' | 'middle' = 'start', field?: string) =>
    value && primitives.push({ type: 'text', p: [x, y], text: value, size: cap, layer: 'BOM', anchor, ...(field ? { field } : {}) })
  let lastEnd = 0, lastX0 = right
  for (const block of bom ?? []) {
    const f = block.scale, cap = size * f, row = rowH * f
    const xs = block.widths.reduce((acc, w) => [...acc, acc[acc.length - 1] + w], [block.x0])
    const head = block.top + headerRows * row
    const end = head + block.rows.reduce((sum, r) => sum + r.height, 0)
    const middle = (value: string, y0: number, y1: number) => {
      const [a, b] = extent(value, cap)
      return (y0 + y1) / 2 - (a + b) / 2
    }
    line(block.x0, block.top, block.x1, block.top)
    line(block.x0, block.top, block.x0, end)
    line(block.x1, block.top, block.x1, end)
    for (const x of xs.slice(1, -1)) line(x, head - row, x, end)
    if (spec.title) {
      put(spec.title, (block.x0 + block.x1) / 2, middle(spec.title, block.top, block.top + row), cap, 'middle')
      line(block.x0, block.top + row, block.x1, block.top + row)
    }
    spec.columns.forEach((c, i) => put(c.title, (xs[i] + xs[i + 1]) / 2, middle(c.title, head - row, head), cap, 'middle'))
    let y = head
    line(block.x0, y, block.x1, y)
    for (const r of block.rows) {
      const centre = y + r.height / 2
      r.cells.forEach((c, i) => {
        const column = spec.columns[i], first = centre - (c.ink[0] + c.ink[1]) / 2
        const align = column.align ?? (column.field === 'description' ? 'start' : 'middle')
        const field = (j: number) => `bom.${r.row.id}.${column.field}${j ? `#${j + 1}` : ''}`
        c.lines.forEach((l, j) => align === 'middle'
          ? put(l, (xs[i] + xs[i + 1]) / 2, first + c.base[j], cap, 'middle', field(j))
          : put(l, xs[i] + inset * f, first + c.base[j], cap, 'start', field(j)))
        // A cell entered by hand is marked, so an override is never silent.
        if (marked(r.row, column.field)) primitives.push(deltaMark([xs[i + 1] - delta * f + cap * 0.15, y + cap * 1.05], cap * 0.75, 'BOM'))
      })
      y += r.height
      line(block.x0, y, block.x1, y)
    }
    blocks.push([block.x0 - gap / 2, block.top, block.x1, end + gap / 2 + legend])
    lastEnd = end; lastX0 = block.x0
  }
  if (anyMarked && bom?.length) {
    const cap = size * bom.at(-1)!.scale * 0.85, y = lastEnd + pitch * 1.2
    primitives.push(deltaMark([lastX0, y], cap * 0.9, 'BOM'))
    put('ENTERED BY HAND, NOT CALCULATED', lastX0 + cap * 1.6, y, cap)
  }
  return { primitives, blocks }
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
