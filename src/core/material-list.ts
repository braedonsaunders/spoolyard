import { COMPONENT_TYPE_BY_CODE } from './components'
import { flangedJoints, nodeCode, nodeItem, type FlangedJoint } from './joints'
import { boltSizeText, draftLength, purchaseLength, sizeText } from './format'
import { connected, getNode, getSpec, runResult, type CatalogItem, type IsoDocument, type PipeNode, type PipeRun } from './model'

export type MaterialCategory =
  | 'pipe' | 'elbow90' | 'elbow45' | 'bend' | 'stub' | 'tee' | 'reducer' | 'cap' | 'small' | 'flange' | 'bolt' | 'gasket' | 'valve' | 'other'
const ORDER: MaterialCategory[] = ['pipe', 'elbow90', 'elbow45', 'bend', 'stub', 'reducer', 'tee', 'cap', 'small', 'flange', 'bolt', 'gasket', 'valve', 'other']
/** 90° and 45° elbows share a place in the list and follow the order they appear along the line. */
const rank = (c: MaterialCategory) => c === 'elbow45' ? ORDER.indexOf('elbow90') : ORDER.indexOf(c)
const FLANGE_ORDER = [/SO$/, /WN$/, /LJ$/, /SW$/, /SC$/, /BL$/]

/** One row of a sheet's bill of materials, as printed. */
export interface MaterialRow {
  id: number
  qty: number
  qtyText: string
  nd: string
  description: string
  category: MaterialCategory
  /** Pipe ids, node ids, and joint parts (`<joint id>#flange|stub|gasket|bolts`) tagged with this ID. */
  memberIds: string[]
  /** Pipe cut length per piece, for pipe rows. */
  cut?: number
}
const KERF = 3.175
const compose = (...parts: Array<string | undefined>) =>
  parts.map(p => p?.trim()).filter(Boolean).join(', ').toUpperCase()
const schedule = (text?: string) => !text ? '' : /^(sch|std|xs|xxs)/i.test(text) ? text : 'SCH ' + text
/** The drawing text of a catalogue row: its own BOM text, else description, material, schedule and rating. */
export function rowDescription(item: CatalogItem | undefined, fallback: string): string {
  if (item?.bomDescription) return item.bomDescription.toUpperCase()
  if (!item) return fallback.toUpperCase()
  return compose(item.description, item.material, schedule(item.schedule), item.rating)
}
function categoryOf(kind: PipeNode['kind'], code = ''): MaterialCategory {
  if (/^STUB-END/.test(code)) return 'stub'
  if (/CPLG|UNION|NIPPLE/.test(code) || kind === 'olet') return 'small'
  switch (kind) {
    case 'elbow90': return /180|BEND/.test(code) ? 'bend' : 'elbow90'
    case 'elbow45': return 'elbow45'
    case 'tee': return 'tee'
    case 'reducer': return 'reducer'
    case 'cap': return 'cap'
    case 'flange': return 'flange'
    case 'bolt': return 'bolt'
    case 'gasket': return 'gasket'
    case 'valve': return 'valve'
    default: return 'other'
  }
}
/**
 * Pipes in the order a fitter follows them: from an open end straight through tees to the far end, then the next
 * open end back to the network, and so on.
 */
export function routeOrder(doc: IsoDocument, runs: PipeRun[], startSize?: number): PipeRun[] {
  const pending = new Set(runs.map(r => r.id)), out: PipeRun[] = []
  const left = () => runs.filter(r => pending.has(r.id))
  const open = (id: string) => connected(doc, id).filter(r => runs.includes(r)).length === 1
  const direction = (r: PipeRun, from: string) => {
    const a = getNode(doc, from).position, b = getNode(doc, r.from === from ? r.to : r.from).position
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1
    return d.map(v => v / l)
  }
  while (pending.size) {
    const ends = left().flatMap(r => [r.from, r.to])
    const free = (id: string) => open(id) && getNode(doc, id).kind !== 'weld'
    let at = (startSize != null && !out.length ? ends.find(id => free(id) && connected(doc, id).some(r => r.nps === startSize && runs.includes(r))) : undefined) ??
      ends.find(free) ?? ends.find(id => out.some(r => r.from === id || r.to === id)) ?? ends[0]
    let heading: number[] | null = null
    for (;;) {
      const next = connected(doc, at).filter(r => pending.has(r.id))
      if (!next.length) break
      // Carry straight on through a junction; turn only when the line turns.
      const run = heading ? next.reduce((a, b) => {
        const da = direction(a, at), db = direction(b, at)
        return db.reduce((s, v, i) => s + v * heading![i], 0) > da.reduce((s, v, i) => s + v * heading![i], 0) ? b : a
      }) : next[0]
      heading = direction(run, at)
      pending.delete(run.id)
      out.push(run)
      at = run.from === at ? run.to : run.from
    }
  }
  return out
}

/** The bill of materials printed on one sheet (spool); IDs start at 1 and match the sheet's tags. */
export function sheetMaterials(doc: IsoDocument, spool = ''): MaterialRow[] {
  const runs = doc.runs.filter(r => !r.connector && (!spool || r.spool === spool))
  const rows = new Map<string, Omit<MaterialRow, 'id'> & { size: number; flangeRank: number; first: number; pieces: number[] }>()
  let seq = 0
  const add = (key: string, row: Omit<MaterialRow, 'id' | 'qtyText' | 'memberIds'> & { size: number; flangeRank?: number }, member: string, qty: number) => {
    const found = rows.get(key)
    if (found) { found.qty += qty; found.memberIds.push(member); return found }
    const created = { ...row, qtyText: '', flangeRank: row.flangeRank ?? 0, first: seq++, memberIds: [member], qty, pieces: [] as number[] }
    rows.set(key, created)
    return created
  }
  // Fittings joined without pipe are walked through but are not pieces to cut.
  const spoolRuns = doc.runs.filter(r => !spool || r.spool === spool)
  const route = routeOrder(doc, spoolRuns), appears = new Map<string, number>()
  route.forEach((r, i) => { for (const id of [r.from, r.to]) if (!appears.has(id)) appears.set(id, i) })
  // Pipe pieces are listed size by size, each size in order along the line from an open end of that size.
  const sizes = [...new Set(spoolRuns.filter(r => !r.connector).map(r => r.nps))].sort((a, b) => a - b)
  for (const run of sizes.flatMap(nps => routeOrder(doc, spoolRuns, nps).filter(r => !r.connector && r.nps === nps))) {
    const spec = getSpec(doc, run.specId), size = spec.sizes.find(s => s.nps === run.nps), cut = runResult(doc, run).cut
    const base = size?.bomDescription?.toUpperCase() ??
      compose(size?.description ?? 'PIPE', size?.material ?? spec.material, schedule(size?.schedule ?? spec.schedule))
    const known = Number.isFinite(cut) && cut > 0
    const piece = known ? doc.units === 'mm' ? Math.round(cut) : Math.round(cut / 25.4 * 16) : NaN
    const row = add(JSON.stringify(['pipe', spec.id, run.nps, base, known ? piece : run.id]),
      { category: 'pipe', nd: sizeText(run.nps), description: base, qty: 0, size: run.nps, cut: known ? cut : NaN }, run.id, 0)
    row.pieces.push(cut)
  }
  for (const node of doc.nodes) {
    if (['end', 'weld', 'annotation', 'support'].includes(node.kind)) continue
    const edges = connected(doc, node.id), host = edges[0] ?? doc.runs.find(r => r.id === node.associatedRunId)
    if (!host || (spool && !(edges.length ? edges : [host]).some(r => r.spool === spool))) continue
    const item = nodeItem(doc, node), code = nodeCode(doc, node) ?? item?.component ?? ''
    const sizes = edges.map(r => r.nps), nps = item?.nps ?? Math.max(...sizes, host.nps)
    const small = item?.smallerNps ?? (sizes.length > 1 ? Math.min(...sizes) : undefined)
    const pipes = edges.filter(r => !r.connector)
    const pair = node.kind === 'flange' && pipes.length === 2 && COMPONENT_TYPE_BY_CODE[code]?.endPrep !== 'FL' &&
      pipes.every(r => (r.from === node.id ? r.fromPrep : r.toPrep) !== 'FL')
    const label = node.description ?? COMPONENT_TYPE_BY_CODE[code]?.label ?? node.kind
    const description = node.description ? node.description.toUpperCase() : rowDescription(item, label)
    const category = categoryOf(node.kind, code)
    add(JSON.stringify([category, item?.id ?? code, description, sizeText(nps, small), node.takeout ?? null, node.branchTakeout ?? null]), {
      category, nd: sizeText(nps, node.kind === 'tee' && small === nps ? undefined : small), description, qty: 0, size: nps,
      flangeRank: FLANGE_ORDER.findIndex(r => r.test(code)) + 1 || 9
    }, node.id, node.quantity ?? (pair ? 2 : 1))
  }
  const elsewhere: Array<[string, string]> = []
  for (const joint of flangedJoints(doc, spool)) addJoint(joint)
  function addJoint(joint: FlangedJoint) {
    for (const flange of joint.flanges.filter(f => f.implicit)) {
      const description = rowDescription(flange.item, COMPONENT_TYPE_BY_CODE[flange.code]?.label ?? 'FLANGE')
      add(JSON.stringify(['flange', flange.item?.id ?? flange.code, description, sizeText(joint.nps), null, null]), {
        category: 'flange', nd: sizeText(joint.nps), description, qty: 0, size: joint.nps,
        flangeRank: FLANGE_ORDER.findIndex(r => r.test(flange.code)) + 1 || 9
      }, joint.id + '#flange', 1)
    }
    for (const stub of joint.stubEnds) {
      const description = rowDescription(stub, 'STUB END')
      add(JSON.stringify(['stub', stub.id, description, sizeText(joint.nps), null, null]), { category: 'stub', nd: sizeText(joint.nps), description, qty: 0, size: joint.nps }, joint.id + '#stub', 1)
    }
    // Parts supplied elsewhere are not counted, but their callout still names the matching BOM item.
    const part = (key: string, row: Parameters<typeof add>[1], member: string, qty: number, supplied: boolean) =>
      supplied ? add(key, row, member, qty) : elsewhere.push([key, member])
    if (joint.gasket) {
      const description = rowDescription(joint.gasket.item, 'GASKET')
      part(JSON.stringify(['gasket', joint.gasket.item?.id, description, joint.nps]), { category: 'gasket', nd: sizeText(joint.nps), description, qty: 0, size: joint.nps }, joint.id + '#gasket', 1, joint.supplied.gasket)
    }
    if (joint.bolts) {
      const b = joint.bolts, own = rowDescription(b.item, 'STUD BOLTS C/W 2 NUTS')
      const description = b.kind === 'lug' ? (/STUD/.test(own) ? own.replace(/STUD/g, 'LUG') : 'LUG BOLTS, ' + own) : own
      // ASME bolting is sized in inches on metric drawings too.
      const nd = boltSizeText(b.diameter, b.length)
      // Bolting lists by diameter, then length.
      part(JSON.stringify(['bolt', b.kind, description, nd]), { category: 'bolt', nd, description, qty: 0, size: Math.round(b.diameter / 25.4 * 16) * 1e4 + b.length }, joint.id + '#bolts', b.count, joint.supplied.bolts)
    }
  }
  for (const [key, member] of elsewhere) rows.get(key)?.memberIds.push(member)
  const appear = (row: { memberIds: string[] }) => Math.min(...row.memberIds.map(id => appears.get(id) ?? Infinity))
  const sorted = [...rows.values()].sort((a, b) =>
    rank(a.category) - rank(b.category) ||
    (a.category === 'pipe' ? a.size - b.size || a.first - b.first
      : a.category === 'flange' ? a.flangeRank - b.flangeRank || a.size - b.size || a.description.localeCompare(b.description)
        : a.category.startsWith('elbow') ? a.size - b.size || appear(a) - appear(b) || a.description.localeCompare(b.description)
          : a.size - b.size || a.description.localeCompare(b.description)))
  return sorted.map((row, index) => {
    const { size, flangeRank, first, pieces, ...rest } = row
    if (row.category !== 'pipe') return { ...rest, id: index + 1, qtyText: String(row.qty) }
    const n = pieces.length, cut = pieces[0], known = Number.isFinite(cut) && cut > 0
    const total = known ? n * cut + (n - 1) * KERF : NaN
    return {
      ...rest, id: index + 1, qty: total, cut,
      qtyText: purchaseLength(total, doc.units),
      description: `${row.description} - CUT TO ${known ? draftLength(cut, doc.units) : '(PENDING)'}${n > 1 ? ` (TOTAL OF ${n} PIECES)` : ''}`
    }
  })
}
/** The BOM ID that tags a pipe, node or joint part on a sheet. */
export const materialId = (rows: MaterialRow[], member: string) => rows.find(r => r.memberIds.includes(member))?.id
