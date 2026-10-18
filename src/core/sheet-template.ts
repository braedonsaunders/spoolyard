/**
 * Title-block templates: a sheet form described as data, in paper millimetres. A template has one or more layouts;
 * the sheet uses the layout made for its paper (else the nearest in proportion) and scales it uniformly to fit, so
 * cells keep their shape on every paper. Each item is placed from a paper corner (`place`), so a form drawn for one
 * proportion keeps its corners on another: the title block in the bottom right, the north symbol in the top left.
 *
 * Text is literal with `{bindings}` to the drawing (see TEMPLATE_BINDINGS); a text whose bindings are all empty is
 * not printed. Templates are stored in the drawing (`sheetTemplate`) or exchanged as JSON.
 */

export const TEMPLATE_SCHEMA = 'spoolyard-sheet-template'
export type TemplatePaper = 'letter' | 'tabloid' | 'a3' | 'a4'
/** The paper corner a position is measured from; the template's own corner maps onto the paper's. */
export type TemplatePlace = 'tl' | 'tr' | 'bl' | 'br'
export type TemplatePoint = [number, number]
export type TemplateRect = [number, number, number, number]
/** Print only on some sheets. */
export type TemplateCondition = 'multiSheet' | 'singleSheet' | 'toScale' | 'notToScale' | 'metric' | 'imperial'

interface Placed {
  /** Corner positions are measured from; a line or rectangle may give one per end / corner, to stretch with the paper. */
  place?: TemplatePlace | [TemplatePlace, TemplatePlace]
  when?: TemplateCondition
}
export interface TemplateText extends Placed {
  type: 'text'
  /** Baseline point at the anchor. */
  at: TemplatePoint
  /** Literal text with `{binding}`s; `\n` starts a new line `pitch` below. */
  text: string
  /** Cap height, mm. */
  size: number
  anchor?: 'start' | 'middle' | 'end'
  /** Widest the text may print, mm; wider text is lettered smaller. */
  fit?: number
  /** Baseline pitch of a multi-line text, mm (default 1.9 × size). */
  pitch?: number
  /** Width factor of the lettering. */
  widthFactor?: number
  /** Capitalise what the bindings print (literal text is printed as written). */
  upper?: boolean
  layer?: 'TITLE' | 'NOTES' | 'BOM'
}
export interface TemplateLine extends Placed { type: 'line'; a: TemplatePoint; b: TemplatePoint; /** Pen width, mm. */ weight?: number }
export interface TemplateBox extends Placed { type: 'rect'; rect: TemplateRect; weight?: number; fill?: boolean }
/** A logo panel: slot 0 is the company logo, slot 1 the client's, fitted at their own proportions. */
export interface TemplateLogo extends Placed { type: 'logo'; slot: 0 | 1; rect: TemplateRect; pad?: number }
export type RevisionField = 'rev' | 'date' | 'description' | 'designedBy' | 'checkedBy' | 'disciplineLead' | 'projectLeader' | 'approvedBy'
/** Revision rows: the latest revisions, one per row, filled from the headings outward (`fill`). */
export interface TemplateRevisions extends Placed {
  type: 'revisions'
  /** Column boundaries, left to right (one more than `fields`). */
  columns: number[]
  /** Row boundaries, top to bottom, of the rows revisions are printed in. */
  rows: number[]
  /** 'up': the oldest shown sits in the bottom row and later ones above it; 'down' the reverse. */
  fill: 'up' | 'down'
  fields: RevisionField[]
  size: number
  /** Baseline below the row centre, mm (default size / 2). */
  offset?: number
  /** Room kept either side of a value, mm. */
  inset?: number
  upper?: boolean
}
export type TemplateItem = TemplateText | TemplateLine | TemplateBox | TemplateLogo | TemplateRevisions

export type BomField = 'id' | 'qty' | 'nd' | 'description'
export interface TemplateBomColumn {
  field: BomField
  title: string
  /** Width, mm. The description column takes what the others leave of the table width. */
  width?: number
  /** Widens to its longest entry up to this, mm. */
  max?: number
  /** Narrows to its longest entry down to this when the list would otherwise continue in another block, mm. */
  min?: number
  align?: 'start' | 'middle'
}
/** The material list: blocks hung from `top`, the first ending at `right`, more continuing to the left. */
export interface TemplateBom {
  place?: TemplatePlace
  right: number
  top: number
  /** Furthest left a continuation block may reach, mm. */
  left: number
  /** Table width, mm. */
  width: number
  title?: string
  columns: TemplateBomColumn[]
  /** Cap height, mm. */
  size: number
  /** Height of a one-line row (and of the title and heading rows), mm. */
  row: number
  /** Baseline pitch of wrapped lines, mm. */
  pitch: number
  /** Extra pitch for a line rising above the cap line (quotes, slashes), mm. */
  raise?: number
  /**
   * Room lettering keeps from the column rules, mm: centred cells half of it each side, the description all of it on
   * the left and a third of it on the right.
   */
  inset?: number
  /** Room a column that widens or narrows to its entries keeps beside the widest, mm. */
  pad?: number
  /** Room the description keeps when held column widths are applied, mm. */
  descriptionMin?: number
  /** While the whole list fits in one block, rows are at least this many lines tall. */
  minLines?: number
  /** Pen width of the table rules, mm. */
  weight?: number
}
/** General notes: numbered, hanging indent, growing up from `bottom`. */
export interface TemplateNotes {
  place?: TemplatePlace
  /** Area the notes keep the model off: [x0, -, x1, y1]; its top follows the notes. */
  area: [number, number, number]
  /** Header, number and text columns, mm. */
  header: number
  label: number
  text: number
  /** Right edge of the text, mm. */
  right: number
  /** Last baseline, mm. */
  bottom: number
  /** Highest the notes may reach, mm; they are lettered smaller rather than rise above it. */
  top: number
  size: number
  pitch: number
  widthFactor?: number
  title?: string
  /** Add the drafting notes the sheet's settings make true (scale, lengths, cut lengths, rounding). */
  drafting?: boolean
}
/** North symbol: an ellipse with a tick at each compass point as the view draws it, plant north an arrow. */
export interface TemplateNorth {
  place?: TemplatePlace
  /** The box the symbol stays in, mm. */
  box: TemplateRect
  centre?: TemplatePoint
  rx?: number
  ry?: number
  tick?: number
  arrow?: number
  barb?: number
  /** Outline of the filled N, relative to the centre, mm (default: a block N scaled to ry). */
  letter?: TemplatePoint[]
  weight?: number
}
export interface TemplateLayout {
  /** Paper the layout is drawn on, mm; it is scaled uniformly to the sheet's paper. */
  size: [number, number]
  /** Papers this layout is made for; others use the layout nearest in proportion. */
  papers?: TemplatePaper[]
  /** Corner positions are measured from unless an item says otherwise (default 'bl'). */
  place?: TemplatePlace
  border: { rect: TemplateRect; weight: number; /** Heavy filled rules along edges, by thickness in mm. */ bars?: Partial<Record<'top' | 'bottom' | 'left' | 'right', number>> }
  /** The model area; place is per corner (default top left and bottom right). */
  viewport: TemplateRect
  /** Clearance kept around the material list and notes, mm. */
  gap: number
  items: TemplateItem[]
  /** Form areas inside the viewport the model keeps off, such as a title block. */
  keepOut?: Array<{ rect: TemplateRect; place?: TemplatePlace }>
  bom?: TemplateBom
  notes?: TemplateNotes
  north?: TemplateNorth
}
export interface SheetTemplate {
  schema: typeof TEMPLATE_SCHEMA
  version: 1
  name: string
  description?: string
  /** Extra title-block fields this template prints as `{field.key}`; the drawing setup shows one box for each. */
  fields?: Array<{ key: string; label: string }>
  layouts: TemplateLayout[]
}

/** Every binding a template's text may use, with what it prints. */
/** Least width (template units) a material table leaves its description column. */
const BOM_DESCRIPTION_LEAST = 10
export const TEMPLATE_BINDINGS: Record<string, string> = {
  'doc.title': 'Drawing title', 'doc.customer': 'Customer', 'doc.project': 'Project', 'doc.drawing': 'Drawing number (whole set)',
  'doc.drawnBy': 'Drawn by', 'doc.checkedBy': 'Checked by',
  'tb.designedBy': 'Designed by', 'tb.date': 'Date', 'tb.checkedBy': 'Checked by', 'tb.projectLeader': 'Project leader',
  'tb.disciplineLeader': 'Discipline leader', 'tb.approvedBy': 'Approved by', 'tb.insulationThickness': 'Insulation thickness',
  'tb.insulationCladding': 'Insulation cladding', 'tb.tracing': 'Tracing', 'tb.pipeSpec': 'Pipe spec', 'tb.specRevision': 'Spec revision',
  'tb.designCode': 'Design code', 'tb.product': 'Product', 'tb.refArea': 'Ref. area', 'tb.lineNumber': 'Line number (all sheets)',
  'tb.projectNumber': 'Project number',
  'tb.design.pressure': 'Design pressure', 'tb.design.temperature': 'Design temperature',
  'tb.operating.pressure': 'Operating pressure', 'tb.operating.temperature': 'Operating temperature',
  'tb.test.pressure': 'Test pressure', 'tb.test.temperature': 'Test temperature',
  'tb.reference.1': 'Reference drawing 1', 'tb.reference.2': 'Reference drawing 2', 'tb.reference.3': 'Reference drawing 3',
  'tb.reference.4': 'Reference drawing 4', 'tb.reference.5': 'Reference drawing 5',
  'sheet.drawingNumber': 'Sheet drawing number', 'sheet.lineNumber': 'Sheet line number', 'sheet.revision': 'Sheet revision',
  'sheet.spool': 'Spool', 'sheet.number': 'Sheet number', 'sheet.count': 'Sheets in the set', 'sheet.of': 'Sheet n OF m',
  'units.pressure': 'kPa or PSIG', 'units.temperature': '°C or °F', 'units.system': 'METRIC or IMPERIAL', 'units.length': 'MM or FT-IN',
  dateFormat: 'Date format (YY-MM-DD)', scale: 'NTS or the scale ratio', view: 'ISO, PLAN, FRONT or SIDE', viewNote: 'View direction',
  paper: 'Paper size', pipeSpecs: 'Pipe specs on the sheet'
}
const BINDING = /\{([A-Za-z0-9_.-]+)\}/g
export const templateBindings = (text: string) => [...text.matchAll(BINDING)].map(m => m[1])
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/

/**
 * Checks a template read from a drawing or a JSON file and returns it typed; throws a message naming the first
 * problem. Unknown keys are rejected, so a misspelt property never silently prints nothing.
 */
export function validateSheetTemplate(raw: unknown): SheetTemplate {
  const fail = (where: string, what: string): never => { throw new Error(`Invalid sheet template: ${where} ${what}.`) }
  const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  const num = (v: unknown, where: string, min = -2000, max = 2000) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(where, `must be a number from ${min} to ${max}`)
  const opt = (v: unknown, where: string, min?: number, max?: number) => v == null || num(v, where, min, max)
  const str = (v: unknown, where: string, max = 500) => typeof v === 'string' && v.length <= max ? v : fail(where, `must be text of at most ${max} characters`)
  const oneOf = <T extends string>(v: unknown, list: readonly T[], where: string): T => list.includes(v as T) ? v as T : fail(where, `must be one of ${list.join(', ')}`)
  const only = (o: Record<string, unknown>, keys: string[], where: string) => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) fail(where, `has an unknown property "${k}"`)
  }
  const point = (v: unknown, where: string) => Array.isArray(v) && v.length === 2 ? v.forEach((n, i) => num(n, `${where}[${i}]`)) : fail(where, 'must be [x, y]')
  const rect = (v: unknown, where: string) => {
    if (!Array.isArray(v) || v.length !== 4) fail(where, 'must be [x0, y0, x1, y1]')
    ;(v as unknown[]).forEach((n, i) => num(n, `${where}[${i}]`))
    const r = v as number[]
    if (r[2] <= r[0] || r[3] <= r[1]) fail(where, 'must have x1 > x0 and y1 > y0')
  }
  const places = ['tl', 'tr', 'bl', 'br'] as const
  const place = (v: unknown, where: string, pair = false) => {
    if (v == null) return
    if (pair && Array.isArray(v) && v.length === 2) return v.forEach((p, i) => oneOf(p, places, `${where}[${i}]`))
    oneOf(v, places, where)
  }
  const fields = new Set<string>()
  const text = (v: unknown, where: string) => {
    const t = str(v, where)
    for (const b of templateBindings(t))
      // Own keys only: `constructor` or `toString` is no binding, though every object answers to it.
      if (!Object.hasOwn(TEMPLATE_BINDINGS, b) && !(b.startsWith('field.') && fields.has(b.slice(6)))) fail(where, `uses an unknown binding {${b}}`)
  }
  if (!plain(raw)) fail('the template', 'must be an object')
  const t = raw as Record<string, unknown>
  only(t, ['schema', 'version', 'name', 'description', 'fields', 'layouts'], 'the template')
  if (t.schema !== TEMPLATE_SCHEMA) fail('schema', `must be "${TEMPLATE_SCHEMA}"`)
  if (t.version !== 1) fail('version', 'must be 1')
  if (!str(t.name, 'name', 120).trim()) fail('name', 'must not be empty')
  if (t.description != null) str(t.description, 'description', 2000)
  if (t.fields != null) {
    if (!Array.isArray(t.fields) || t.fields.length > 40) fail('fields', 'must be a list of at most 40')
    ;(t.fields as unknown[]).forEach((f, i) => {
      const where = `fields[${i}]`
      if (!plain(f)) fail(where, 'must be an object')
      const field = f as Record<string, unknown>
      only(field, ['key', 'label'], where)
      if (typeof field.key !== 'string' || !FIELD_KEY.test(field.key)) fail(`${where}.key`, 'must be a short name of letters, digits, - or _')
      if (fields.has(field.key as string)) fail(`${where}.key`, 'is repeated')
      fields.add(field.key as string)
      str(field.label, `${where}.label`, 80)
    })
  }
  if (!Array.isArray(t.layouts) || !t.layouts.length || t.layouts.length > 8) fail('layouts', 'must list one to eight layouts')
  ;(t.layouts as unknown[]).forEach((l, li) => {
    const at = `layouts[${li}]`
    if (!plain(l)) fail(at, 'must be an object')
    const layout = l as Record<string, unknown>
    only(layout, ['size', 'papers', 'place', 'border', 'viewport', 'gap', 'items', 'keepOut', 'bom', 'notes', 'north'], at)
    if (!Array.isArray(layout.size) || layout.size.length !== 2) fail(`${at}.size`, 'must be [width, height]')
    ;(layout.size as unknown[]).forEach((n, i) => num(n, `${at}.size[${i}]`, 50, 2000))
    if (layout.papers != null && (!Array.isArray(layout.papers) || !layout.papers.length)) fail(`${at}.papers`, 'must be a list of paper sizes')
    ;((layout.papers as unknown[]) ?? []).forEach((p, i) => oneOf(p, ['letter', 'tabloid', 'a3', 'a4'] as const, `${at}.papers[${i}]`))
    place(layout.place, `${at}.place`)
    if (!plain(layout.border)) fail(`${at}.border`, 'must be an object')
    const border = layout.border as Record<string, unknown>
    only(border, ['rect', 'weight', 'bars'], `${at}.border`)
    rect(border.rect, `${at}.border.rect`)
    num(border.weight, `${at}.border.weight`, 0, 5)
    if (border.bars != null) {
      if (!plain(border.bars)) fail(`${at}.border.bars`, 'must be an object')
      const bars = border.bars as Record<string, unknown>
      only(bars, ['top', 'bottom', 'left', 'right'], `${at}.border.bars`)
      for (const [k, v] of Object.entries(bars)) num(v, `${at}.border.bars.${k}`, 0, 20)
    }
    rect(layout.viewport, `${at}.viewport`)
    num(layout.gap, `${at}.gap`, 0, 50)
    if (layout.keepOut != null) {
      if (!Array.isArray(layout.keepOut) || layout.keepOut.length > 40) fail(`${at}.keepOut`, 'must be a list of at most 40')
      ;(layout.keepOut as unknown[]).forEach((entry, i) => {
        if (!plain(entry)) fail(`${at}.keepOut[${i}]`, 'must be an object')
        const k = entry as Record<string, unknown>
        only(k, ['rect', 'place'], `${at}.keepOut[${i}]`)
        rect(k.rect, `${at}.keepOut[${i}].rect`)
        place(k.place, `${at}.keepOut[${i}].place`)
      })
    }
    if (!Array.isArray(layout.items) || layout.items.length > 3000) fail(`${at}.items`, 'must be a list of at most 3000')
    ;(layout.items as unknown[]).forEach((item, i) => {
      const where = `${at}.items[${i}]`
      if (!plain(item)) fail(where, 'must be an object')
      const it = item as Record<string, unknown>
      const common = ['type', 'place', 'when']
      if (it.when != null) oneOf(it.when, ['multiSheet', 'singleSheet', 'toScale', 'notToScale', 'metric', 'imperial'] as const, `${where}.when`)
      if (it.type === 'text') {
        only(it, [...common, 'at', 'text', 'size', 'anchor', 'fit', 'pitch', 'widthFactor', 'upper', 'layer'], where)
        place(it.place, `${where}.place`)
        point(it.at, `${where}.at`)
        text(it.text, `${where}.text`)
        num(it.size, `${where}.size`, 0.3, 100)
        if (it.anchor != null) oneOf(it.anchor, ['start', 'middle', 'end'] as const, `${where}.anchor`)
        opt(it.fit, `${where}.fit`, 0.5, 2000); opt(it.pitch, `${where}.pitch`, 0, 200); opt(it.widthFactor, `${where}.widthFactor`, 0.3, 3)
        if (it.upper != null && typeof it.upper !== 'boolean') fail(`${where}.upper`, 'must be true or false')
        if (it.layer != null) oneOf(it.layer, ['TITLE', 'NOTES', 'BOM'] as const, `${where}.layer`)
      } else if (it.type === 'line') {
        only(it, [...common, 'a', 'b', 'weight'], where)
        place(it.place, `${where}.place`, true)
        point(it.a, `${where}.a`); point(it.b, `${where}.b`); opt(it.weight, `${where}.weight`, 0, 20)
      } else if (it.type === 'rect') {
        only(it, [...common, 'rect', 'weight', 'fill'], where)
        place(it.place, `${where}.place`, true)
        rect(it.rect, `${where}.rect`); opt(it.weight, `${where}.weight`, 0, 20)
        if (it.fill != null && typeof it.fill !== 'boolean') fail(`${where}.fill`, 'must be true or false')
      } else if (it.type === 'logo') {
        only(it, [...common, 'slot', 'rect', 'pad'], where)
        place(it.place, `${where}.place`)
        if (it.slot !== 0 && it.slot !== 1) fail(`${where}.slot`, 'must be 0 (company) or 1 (client)')
        rect(it.rect, `${where}.rect`); opt(it.pad, `${where}.pad`, 0, 100)
      } else if (it.type === 'revisions') {
        only(it, [...common, 'columns', 'rows', 'fill', 'fields', 'size', 'offset', 'inset', 'upper'], where)
        place(it.place, `${where}.place`)
        const list = (v: unknown, w: string, n: number) => {
          if (!Array.isArray(v) || v.length < n || v.length > 30) fail(w, `must list ${n} to 30 numbers`)
          ;(v as unknown[]).forEach((x, k) => num(x, `${w}[${k}]`))
          if ((v as number[]).some((x, k, a) => k && x <= a[k - 1])) fail(w, 'must increase')
        }
        list(it.columns, `${where}.columns`, 2); list(it.rows, `${where}.rows`, 2)
        oneOf(it.fill, ['up', 'down'] as const, `${where}.fill`)
        if (!Array.isArray(it.fields) || it.fields.length !== (it.columns as number[]).length - 1) fail(`${where}.fields`, 'must name one field per column')
        ;(it.fields as unknown[]).forEach((f, k) => oneOf(f, ['rev', 'date', 'description', 'designedBy', 'checkedBy', 'disciplineLead', 'projectLeader', 'approvedBy'] as const, `${where}.fields[${k}]`))
        num(it.size, `${where}.size`, 0.3, 100); opt(it.offset, `${where}.offset`); opt(it.inset, `${where}.inset`, 0, 50)
        if (it.upper != null && typeof it.upper !== 'boolean') fail(`${where}.upper`, 'must be true or false')
      } else fail(`${where}.type`, 'must be text, line, rect, logo or revisions')
    })
    if (layout.bom != null) {
      const w = `${at}.bom`
      if (!plain(layout.bom)) fail(w, 'must be an object')
      const b = layout.bom as Record<string, unknown>
      only(b, ['place', 'right', 'top', 'left', 'width', 'title', 'columns', 'size', 'row', 'pitch', 'raise', 'inset', 'pad', 'descriptionMin', 'minLines', 'weight'], w)
      place(b.place, `${w}.place`)
      num(b.right, `${w}.right`); num(b.top, `${w}.top`); num(b.left, `${w}.left`); num(b.width, `${w}.width`, 10, 2000)
      if (b.title != null) str(b.title, `${w}.title`, 120)
      num(b.size, `${w}.size`, 0.3, 50); num(b.row, `${w}.row`, 0.5, 100); num(b.pitch, `${w}.pitch`, 0.3, 100)
      opt(b.raise, `${w}.raise`, 0, 20); opt(b.inset, `${w}.inset`, 0, 50); opt(b.pad, `${w}.pad`, 0, 50); opt(b.descriptionMin, `${w}.descriptionMin`, 0, 2000)
      opt(b.minLines, `${w}.minLines`, 1, 10); opt(b.weight, `${w}.weight`, 0, 5)
      if (!Array.isArray(b.columns) || b.columns.length < 1 || b.columns.length > 4) fail(`${w}.columns`, 'must list one to four columns')
      const seen = new Set<string>()
      ;(b.columns as unknown[]).forEach((c, k) => {
        const cw = `${w}.columns[${k}]`
        if (!plain(c)) fail(cw, 'must be an object')
        const col = c as Record<string, unknown>
        only(col, ['field', 'title', 'width', 'max', 'min', 'align'], cw)
        const f = oneOf(col.field, ['id', 'qty', 'nd', 'description'] as const, `${cw}.field`)
        if (seen.has(f)) fail(`${cw}.field`, 'is repeated')
        seen.add(f)
        str(col.title, `${cw}.title`, 60)
        if (f !== 'description') num(col.width, `${cw}.width`, 1, 500)
        opt(col.max, `${cw}.max`, 1, 1000); opt(col.min, `${cw}.min`, 1, 500)
        if (col.align != null) oneOf(col.align, ['start', 'middle'] as const, `${cw}.align`)
      })
      if (!seen.has('description')) fail(`${w}.columns`, 'must include the description')
      // The description takes what the other columns leave; they must leave it room to be read.
      const fixed = (b.columns as Array<Record<string, number>>).reduce((sum, c) => sum + (c.field === ('description' as unknown) ? 0 : c.min ?? c.width), 0)
      if ((b.width as number) - fixed < Math.max(BOM_DESCRIPTION_LEAST, (b.descriptionMin as number | undefined) ?? 0))
        fail(`${w}.width`, `leaves the description less than ${Math.max(BOM_DESCRIPTION_LEAST, (b.descriptionMin as number | undefined) ?? 0)} beside the other columns (${fixed})`)
    }
    if (layout.notes != null) {
      const w = `${at}.notes`
      if (!plain(layout.notes)) fail(w, 'must be an object')
      const n = layout.notes as Record<string, unknown>
      only(n, ['place', 'area', 'header', 'label', 'text', 'right', 'bottom', 'top', 'size', 'pitch', 'widthFactor', 'title', 'drafting'], w)
      place(n.place, `${w}.place`)
      if (!Array.isArray(n.area) || n.area.length !== 3) fail(`${w}.area`, 'must be [x0, x1, y1]')
      ;(n.area as unknown[]).forEach((x, k) => num(x, `${w}.area[${k}]`))
      for (const k of ['header', 'label', 'text', 'right', 'bottom', 'top']) num(n[k], `${w}.${k}`)
      num(n.size, `${w}.size`, 0.3, 50); num(n.pitch, `${w}.pitch`, 0.3, 100); opt(n.widthFactor, `${w}.widthFactor`, 0.3, 3)
      if (n.title != null) str(n.title, `${w}.title`, 60)
      if (n.drafting != null && typeof n.drafting !== 'boolean') fail(`${w}.drafting`, 'must be true or false')
    }
    if (layout.north != null) {
      const w = `${at}.north`
      if (!plain(layout.north)) fail(w, 'must be an object')
      const n = layout.north as Record<string, unknown>
      only(n, ['place', 'box', 'centre', 'rx', 'ry', 'tick', 'arrow', 'barb', 'letter', 'weight'], w)
      place(n.place, `${w}.place`)
      rect(n.box, `${w}.box`)
      if (n.centre != null) point(n.centre, `${w}.centre`)
      for (const k of ['rx', 'ry', 'tick', 'arrow', 'barb']) opt(n[k], `${w}.${k}`, 0, 500)
      opt(n.weight, `${w}.weight`, 0, 5)
      if (n.letter != null) {
        if (!Array.isArray(n.letter) || n.letter.length < 3 || n.letter.length > 200) fail(`${w}.letter`, 'must list 3 to 200 points')
        ;(n.letter as unknown[]).forEach((p, k) => point(p, `${w}.letter[${k}]`))
      }
    }
  })
  return raw as unknown as SheetTemplate
}

/** The layout a paper uses: one made for it, else the one nearest its proportions. */
export function templateLayout(template: SheetTemplate, paper: TemplatePaper, size: [number, number]): TemplateLayout {
  const own = template.layouts.find(l => l.papers?.includes(paper))
  if (own) return own
  const aspect = size[0] / size[1]
  return template.layouts.reduce((a, b) => Math.abs(Math.log(b.size[0] / b.size[1] / aspect)) < Math.abs(Math.log(a.size[0] / a.size[1] / aspect)) ? b : a)
}

// The neutral built-in form. Drawn on A3 (420 × 297 mm) with ISO 3098 lettering; ISO paper is √2 in proportion,
// so on A4 it prints at 1/√2 with the next ISO lettering sizes down, and on letter and tabloid it is scaled to fit.
// The right-hand column holds, from the top, the material list, the general notes, the revision block and an
// ISO 7200-style title block.
const L = 230, R = 410, LABEL = 2.2, VALUE = 3.2
const cell = (x0: number, x1: number, y0: number, y1: number, label: string, value: string, size = VALUE, anchor: 'start' | 'middle' = 'start'): TemplateItem[] => [
  { type: 'text', at: [x0 + 1.5, y0 + 3.2], text: label, size: LABEL, fit: x1 - x0 - 3 },
  { type: 'text', at: [anchor === 'middle' ? (x0 + x1) / 2 : x0 + 1.5, y1 - 2.2], text: value, size, anchor, fit: x1 - x0 - 3, upper: true }
]
const vlines = (xs: number[], y0: number, y1: number, weight = 0.25): TemplateItem[] => xs.map(x => ({ type: 'line', a: [x, y0], b: [x, y1], weight }))
const ROWS = [223, 234, 245, 261, 272, 287]
const REV_ROWS = [193, 199, 205, 211, 217, 223]
const REV_COLUMNS = [L, 240, 258, 374, 386, 398, R]

export const DEFAULT_TEMPLATE: SheetTemplate = {
  schema: TEMPLATE_SCHEMA,
  version: 1,
  name: 'ISO 7200 title block',
  description: 'Neutral title block, revision block, general notes and material list in a right-hand column. Drawn on A3, scaled uniformly to other papers.',
  layouts: [{
    size: [420, 297],
    place: 'br',
    border: { rect: [10, 10, 410, 287], weight: 0.5 },
    viewport: [13, 13, 407, 284],
    gap: 2.5,
    keepOut: [{ rect: [L, REV_ROWS[0], R, 287] }],
    items: [
      // Revision block: rows filled upward from the headings.
      { type: 'rect', rect: [L, REV_ROWS[0], R, ROWS[0]], weight: 0.35 },
      ...REV_ROWS.slice(1, -1).map((y): TemplateItem => ({ type: 'line', a: [L, y], b: [R, y], weight: 0.18 })),
      ...vlines(REV_COLUMNS.slice(1, -1), REV_ROWS[0], ROWS[0], 0.18),
      ...(['REV', 'DATE', 'DESCRIPTION', 'BY', 'CHKD', 'APPD'] as const).map((h, i): TemplateItem => ({
        type: 'text', at: [(REV_COLUMNS[i] + REV_COLUMNS[i + 1]) / 2, 221.1], text: h, size: LABEL, anchor: 'middle', fit: REV_COLUMNS[i + 1] - REV_COLUMNS[i] - 2
      })),
      { type: 'revisions', columns: REV_COLUMNS, rows: REV_ROWS.slice(0, -1), fill: 'up', fields: ['rev', 'date', 'description', 'designedBy', 'checkedBy', 'approvedBy'], size: 2.5, offset: 1.25, inset: 1, upper: true },
      // Title block.
      { type: 'rect', rect: [L, ROWS[0], R, ROWS[5]], weight: 0.5 },
      ...ROWS.slice(1, -1).map((y): TemplateItem => ({ type: 'line', a: [L, y], b: [R, y], weight: 0.25 })),
      ...vlines([290, 350], ROWS[0], ROWS[1]),
      ...cell(L, 290, ROWS[0], ROWS[1], 'LINE NO.', '{sheet.lineNumber}'),
      ...cell(290, 350, ROWS[0], ROWS[1], 'PIPE SPEC', '{tb.pipeSpec}'),
      ...cell(350, R, ROWS[0], ROWS[1], 'DESIGN CODE', '{tb.designCode}'),
      ...vlines([300, 360], ROWS[1], ROWS[2]),
      ...cell(L, 300, ROWS[1], ROWS[2], 'CLIENT', '{doc.customer}'),
      ...cell(300, 360, ROWS[1], ROWS[2], 'PROJECT', '{doc.project}'),
      ...cell(360, R, ROWS[1], ROWS[2], 'PROJECT NO.', '{tb.projectNumber}'),
      ...vlines([262, 378], ROWS[2], ROWS[3]),
      { type: 'logo', slot: 0, rect: [L, ROWS[2], 262, ROWS[3]], pad: 1.5 },
      { type: 'logo', slot: 1, rect: [378, ROWS[2], R, ROWS[3]], pad: 1.5 },
      { type: 'text', at: [263.5, ROWS[2] + 3.2], text: 'TITLE', size: LABEL },
      { type: 'text', at: [263.5, ROWS[2] + 9.6], text: '{doc.title}', size: 4, fit: 113, upper: true },
      { type: 'text', at: [263.5, ROWS[3] - 2], text: '{viewNote}', size: 2.2, fit: 113 },
      ...vlines([275, 320, 365], ROWS[3], ROWS[4]),
      ...cell(L, 275, ROWS[3], ROWS[4], 'DRAWN', '{tb.designedBy}'),
      ...cell(275, 320, ROWS[3], ROWS[4], 'CHECKED', '{tb.checkedBy}'),
      ...cell(320, 365, ROWS[3], ROWS[4], 'APPROVED', '{tb.approvedBy}'),
      ...cell(365, R, ROWS[3], ROWS[4], 'DATE ({dateFormat})', '{tb.date}'),
      ...vlines([310, 350, 364, 387], ROWS[4], ROWS[5]),
      ...cell(L, 310, ROWS[4], ROWS[5], 'DRAWING NO.', '{sheet.drawingNumber}', 5),
      ...cell(310, 350, ROWS[4], ROWS[5], 'SPOOL', '{sheet.spool}', 3.5),
      ...cell(350, 364, ROWS[4], ROWS[5], 'REV', '{sheet.revision}', 5, 'middle'),
      ...cell(364, 387, ROWS[4], ROWS[5], 'SHEET', '{sheet.of}', VALUE, 'middle'),
      ...cell(387, R, ROWS[4], ROWS[5], 'SCALE', '{scale}', VALUE, 'middle')
    ],
    bom: {
      place: 'tr', right: R, top: 10, left: 13, width: R - L, title: 'BILL OF MATERIALS',
      columns: [
        { field: 'id', title: 'ITEM', width: 10, align: 'middle' },
        { field: 'qty', title: 'QTY', width: 16, min: 11, max: 26, align: 'middle' },
        { field: 'nd', title: 'SIZE', width: 15, min: 11, max: 28, align: 'middle' },
        { field: 'description', title: 'DESCRIPTION' }
      ],
      size: 2.5, row: 6.5, pitch: 4.2, raise: 0.5, inset: 1.5, descriptionMin: 40, weight: 0.25
    },
    notes: { place: 'br', area: [L, R, 191], header: 231, label: 231.5, text: 237, right: 408.5, bottom: 188.5, top: 90, size: 2.5, pitch: 4.3, title: 'NOTES:', drafting: true },
    north: { place: 'tl', box: [14, 14, 56, 44], rx: 14, ry: 8.4, tick: 4.6, arrow: 2.6, barb: 0.85, weight: 0.25 }
  }]
}
/** Built-in templates by id. Without a prototype, so a name such as `toString` is no template. */
export const BUILTIN_TEMPLATES: Record<string, SheetTemplate> = Object.assign(Object.create(null) as Record<string, SheetTemplate>, { iso7200: DEFAULT_TEMPLATE })
export const DEFAULT_TEMPLATE_ID = 'iso7200'
