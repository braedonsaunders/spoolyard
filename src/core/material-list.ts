import { COMPONENT_TYPE_BY_CODE } from './components'
import { breakOwner, flangedJoints, flangePipePrep, isFlangePair, nodeCode, nodeItem, pairFlangesOn, spansSpools, type FlangedJoint } from './joints'
import { ratingClass } from './standards'
import { boltSizeText, compose, draftLength, listLength, purchaseText, orderedLength, scheduleText, sizeFor, sizeText } from './format'
import { profileOf } from './profile'
import {
  bendArc, connected, deflection, dimensionSource, fitting, isReturnBody, returnPartner, flatSideText, getNode, getSpec, isFormedBend, withIndex, nippleDescription, nippleOf, pipePrepAt, round, runById, runResult, supportListed,
  type BomRow, type CatalogItem, type DimensionSource, type IsoDocument, type IssuedCells, type PipeNode, type PipeRun
} from './model'

export type MaterialCategory =
  | 'pipe' | 'cap' | 'nipple' | 'bend' | 'elbow90' | 'elbow45' | 'stub' | 'hose' | 'reducer' | 'tee' | 'olet' | 'regulator'
  | 'reducing-coupling' | 'union' | 'flange' | 'bolt' | 'gasket' | 'valve' | 'other' | 'support'
/** The cells of a material row that can be held as issued. */
export type IssuedCell = 'qtyText' | 'nd' | 'description'
export const ISSUED_CELLS: IssuedCell[] = ['qtyText', 'nd', 'description']

/** What is bought: the catalogue identity a row stands for. */
export interface MaterialIdentity {
  category: MaterialCategory
  /** Component code (or the node kind for an item with no catalogue entry). */
  code: string
  nps: number
  smallerNps?: number
  rating?: string
  schedule?: string
  material?: string
  /** Flange, gasket and bolting face. */
  face?: 'RF' | 'FF'
  /** An item with no catalogue entry is known only by its measured dimensions (takeout, branch, ports). */
  measured?: Array<number | null | number[]>
}
/** One pipe piece: pipes joined only by bends formed in the pipe itself are one piece, cut as one length. */
export interface PipePiece {
  /** The pipes of the piece, in order from `ends[0]` to `ends[1]`. */
  runIds: string[]
  /** Formed bends inside the piece, in order. */
  bendIds: string[]
  /** The piece's two ends: a pipe and which of its ends (0 `from`, 1 `to`). */
  ends: [{ runId: string; index: 0 | 1 }, { runId: string; index: 0 | 1 }]
  /** Length to cut: the straight tangents, each bend's arc R·θ and the profile's bend allowance per bend. */
  cut: number
  /** Each pipe's share of the cut (its straight plus half of each bend at its ends). */
  shares: Record<string, number>
  uncut: boolean
  specId: string
  nps: number
  spool: string
}
export interface PipeMaterial {
  pieces: PipePiece[]
  /** Cut length of each piece. */
  cut: number
  /** Listed by length without a cut: marked `run.uncut`, or exactly its stock length. */
  uncut: boolean
  /** Pieces' total with the kerf between them (mm). */
  total: number
  /** Ordered length: the total rounded up to the profile's order increment (mm). */
  ordered: number
  /** Stock length the pipe is bought in (mm). */
  stockLength: number
}
/** One row of a sheet's bill of materials, as printed. */
export interface MaterialRow {
  id: number
  /** Pipe: the pieces' total length with kerf (mm); otherwise the count. */
  qty: number
  qtyText: string
  nd: string
  description: string
  category: MaterialCategory
  /** Pipe ids, node ids, and joint parts (`<joint id>#flange|stub|gasket|bolts`) tagged with this ID. */
  memberIds: string[]
  /** What each member contributes: a pipe, its cut length (mm); anything else, its count on this sheet. */
  memberQty: Record<string, number>
  /** Pipe cut length per piece, for pipe rows. */
  cut?: number
  /** Stable identity of the row (purchased identity and its ordinal), for holding item numbers and cells as issued. */
  key: string
  /** Keys earlier versions held this row under; held numbers and cells under them still apply. */
  aliases: string[]
  /** The calculated cells, when any are held as issued. */
  calculated?: { qtyText: string; nd: string; description: string }
  /** The cells printed as issued rather than as calculated; a sheet marks them. */
  overridden?: IssuedCell[]
  identity: MaterialIdentity
  /** Shop material, or field (erection) material by the specification's S/F flag. */
  supply: 'shop' | 'field'
  /** The description without a pipe row's cut note. */
  text: string
  /** A pipe row's cut note after `text`, phrase by phrase (`-`, `CUT TO 2'-1"`, `(TOTAL OF 2 PIECES)`); keep each together. */
  noteParts?: string[]
  pipe?: PipeMaterial
  bolt?: { kind: 'stud' | 'lug' | 'machine'; diameter: number; length: number; system: 'inch' | 'metric' }
  /** Where the members' dimensions come from, when any is not the specification's or measured. */
  dimensionSource?: DimensionSource
  /** What the members' standard dimensions had to assume (no class, face, gasket…), for the inspector and sheet. */
  assumed?: string[]
}

export type PipeEnd = 'BE' | 'PE' | 'TE'
/** How a pipe end is prepared: bevelled for a butt weld, plain into a socket or slip-on, threaded. */
export function pipeEnd(doc: IsoDocument, run: PipeRun, index: number): PipeEnd {
  let prep = pipePrepAt(doc, run, index)
  if (prep === 'FL') {
    const node = getNode(doc, index ? run.to : run.from), code = nodeCode(doc, node)
    if (node.kind === 'flange' && code) prep = flangePipePrep(code)
  }
  return prep === 'THD' ? 'TE' : prep === 'SW' || prep === 'PLAIN' ? 'PE' : 'BE'
}
/** The ends of a pipe piece as the material list names them: BE, PE or TE alike, else both (BE/PE). */
export const pipeEndsText = (ends: readonly PipeEnd[]) => [...new Set(ends)].sort().join('/')
/** An end-finish phrase in a pipe description (BE, PE, TE, TBE, POE, BE/PE…), as one comma-separated part. */
const END_FINISH = /^(?:[BPT]E|[BPT]BE|[BPT]OE|[BPT]SE|T&C|[BPT]E\/[BPT]E)$/
/**
 * A specification's pipe text with its end finish replaced by the piece's actual ends where they disagree on whether
 * the pipe is threaded: a socket-weld or butt-weld pipe catalogued "TE" for threaded lines is listed PE or BE, a
 * threaded one catalogued "PE" is listed TE. Bevelled or plain (BE, PE) stays as the specification states it, the
 * finish it is bought in (thin walls are butt welded square cut, and shops bevel plain-end stock). Text without an end
 * finish is left as it is.
 */
export function withPipeEnds(text: string, ends: readonly PipeEnd[]): string {
  const parts = text.split(','), at = parts.findIndex(p => END_FINISH.test(p.trim().toUpperCase()))
  if (at < 0 || !ends.length) return text
  const threaded = (finish: string) => /^T|\/T/.test(finish)
  if (threaded(parts[at].trim().toUpperCase()) === ends.includes('TE')) return text
  const lead = parts[at].match(/^\s*/)![0]
  parts[at] = lead + pipeEndsText(ends)
  return parts.join(',')
}
/** The ends of a pipe piece, first end first. */
export const pieceEnds = (doc: IsoDocument, piece: PipePiece): [PipeEnd, PipeEnd] =>
  piece.ends.map(e => pipeEnd(doc, runById(doc, e.runId)!, e.index)) as [PipeEnd, PipeEnd]
/** The material text of a pipe: its own description, else its size's BOM text or description with the piece's ends. */
export function pipeText(doc: IsoDocument, run: PipeRun, ends: readonly PipeEnd[]): string {
  if (run.description) return run.description.toUpperCase()
  const spec = getSpec(doc, run.specId), size = spec.sizes.find(s => s.nps === run.nps)
  if (size?.bomDescription) return withPipeEnds(size.bomDescription.toUpperCase(), ends)
  return compose(withPipeEnds(size?.description ?? 'PIPE', ends), size?.material ?? spec.material, scheduleText(size?.schedule ?? spec.schedule))
}

/**
 * Lug bolting described from the specification's bolt text: a lug row's own text as it is; from a stud row, lug studs
 * with the one nut each takes into a tapped lug (`STUD BOLTS C/W 2 HEAVY HEX NUTS` → `LUG BOLTS C/W 1 HEAVY HEX NUT`),
 * or hex-head cap screws with no nut, nor nut grade.
 */
export function lugBoltText(own: string, nuts: number): string {
  if (/LUG|CAP\s*SCREW/.test(own)) return own
  if (nuts === 0) {
    const named = own.replace(/\b(?:STUD|MACHINE)\s+BOLTS?\b(?:\s+(?:C\/W|W\/|WITH)\s+[^,]*)?/, 'HEX HEAD CAP SCREWS').replace(/\s*\/\s*A194\b[^,]*/, '')
    return /CAP SCREWS/.test(named) ? named : 'HEX HEAD CAP SCREWS, ' + named
  }
  // Only a count of nuts the bolt comes with is changed ("C/W 2 HEAVY HEX NUTS"), never a nut grade ("GR. 2 NUTS").
  const one = own.replace(/\b(C\/W|W\/|WITH)\s+(?:TWO|2)\s+((?:[A-Z.]+\s+)*?)NUTS\b/, '$1 1 $2NUT').replace(/C\/W\s+NUTS\b/, 'C/W 1 NUT')
  return /STUD/.test(one) ? one.replace(/STUD/g, 'LUG') : 'LUG BOLTS, ' + one
}

/** The drawing text of a catalogue row: its own BOM text, else description, material, schedule and rating. */
export function rowDescription(item: CatalogItem | undefined, fallback: string): string {
  if (item?.bomDescription) return item.bomDescription.toUpperCase()
  if (!item) return fallback.toUpperCase()
  return compose(item.description, item.material, scheduleText(item.schedule), item.rating)
}
function categoryOf(kind: PipeNode['kind'], code = ''): MaterialCategory {
  if (/^STUB-END/.test(code)) return 'stub'
  if (/^R-CPLG/.test(code)) return 'reducing-coupling'
  if (/UNION/.test(code)) return 'union'
  if (/NIPPLE|^F-CPLG|^CHICAGO/.test(code)) return 'nipple'
  if (/^HOSE|^CAMLOCK-ADPT/.test(code)) return 'hose'
  if (/^PSV|^PULS/.test(code)) return 'other'
  if (/REGUL/.test(code)) return 'regulator'
  if (/^TUBE$/.test(code)) return 'other'
  switch (kind) {
    case 'olet': return 'olet'
    case 'elbow90': return /180/.test(code) ? 'bend' : 'elbow90'
    case 'elbow45': return 'elbow45'
    case 'tee': return 'tee'
    case 'reducer': return 'reducer'
    case 'cap': return 'cap'
    case 'flange': return 'flange'
    case 'bolt': return 'bolt'
    case 'gasket': return 'gasket'
    case 'valve': return 'valve'
    case 'support': return 'support'
    default: return 'other'
  }
}
const faceOfCode = (code?: string): 'RF' | 'FF' | undefined => /FF/.test(code ?? '') ? 'FF' : /RF/.test(code ?? '') ? 'RF' : undefined
const supplyOf = (flag?: 'S' | 'F'): 'shop' | 'field' => flag === 'F' ? 'field' : 'shop'
/** The purchased identity as a key: what makes two items the same thing to buy. */
export const identityKey = (i: MaterialIdentity) =>
  JSON.stringify([i.category, i.code, i.nps, i.smallerNps ?? null, i.rating ?? null, i.schedule ?? null, i.material ?? null, i.face ?? null, ...(i.measured ? [i.measured] : [])])

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

/** A pipe cut to length: not a fitting-to-fitting link, a bought nipple, or the body of a 180° return. */
const piecePipe = (doc: IsoDocument, r: PipeRun) => !r.connector && !r.nipple && !isReturnBody(doc, r)
/** The pipe pieces of a drawing (or one spool): each pipe, or pipes joined by formed bends, is one piece to cut. */
export function pipePieces(doc: IsoDocument, spool = ''): PipePiece[] {
  const runs = doc.runs.filter(r => piecePipe(doc, r) && (!spool || r.spool === spool)), seen = new Set<string>(), out: PipePiece[] = []
  const allowance = profileOf(doc).bendAllowance
  // Through a formed bend the piece runs on into the other pipe, when it is the same pipe size on the same spool.
  const through = (nodeId: string, from: PipeRun): PipeRun | undefined => {
    const node = getNode(doc, nodeId), edges = connected(doc, nodeId)
    if (!isFormedBend(doc, node) || edges.length !== 2) return undefined
    const next = edges.find(r => r !== from)!
    return piecePipe(doc, next) && next.specId === from.specId && next.nps === from.nps && next.spool === from.spool ? next : undefined
  }
  for (const start of runs) {
    if (seen.has(start.id)) continue
    // Walk back to the piece's first end, then forward along it.
    let first = start, firstEnd: 0 | 1 = 0
    for (const visited = new Set([start.id]); ;) {
      const at: string = firstEnd === 0 ? first.from : first.to, prev: PipeRun | undefined = through(at, first)
      if (!prev || visited.has(prev.id)) break
      visited.add(prev.id)
      firstEnd = prev.from === at ? 1 : 0
      first = prev
    }
    const piece: PipePiece = {
      runIds: [], bendIds: [], ends: [{ runId: first.id, index: firstEnd }, { runId: first.id, index: firstEnd === 0 ? 1 : 0 }],
      cut: 0, shares: {}, uncut: false, specId: first.specId, nps: first.nps, spool: first.spool
    }
    for (let run: PipeRun | undefined = first, entry: 0 | 1 = firstEnd; run && !seen.has(run.id);) {
      seen.add(run.id)
      piece.runIds.push(run.id)
      piece.uncut ||= !!run.uncut
      piece.ends[1] = { runId: run.id, index: entry === 0 ? 1 : 0 }
      const exit = entry === 0 ? run.to : run.from, next = through(exit, run)
      if (next && !seen.has(next.id)) piece.bendIds.push(exit)
      entry = next && next.from === exit ? 0 : 1
      run = next
    }
    for (const id of piece.runIds) piece.shares[id] = runResult(doc, doc.runs.find(r => r.id === id)!).cut
    for (const bend of piece.bendIds) {
      const node = getNode(doc, bend), extra = (bendArc(doc, node) ?? NaN) + allowance
      for (const r of connected(doc, bend)) if (r.id in piece.shares) piece.shares[r.id] += extra / 2
    }
    piece.cut = Object.values(piece.shares).reduce((a, b) => a + b, 0)
    out.push(piece)
  }
  return out
}

type Draft = Omit<MaterialRow, 'id' | 'qtyText' | 'key' | 'aliases'> & { size: number; flangeRank: number; first: number; group: string; key?: string; aliases: string[] }
interface SheetBuild { rows: MaterialRow[]; errors: string[]; warnings: string[] }
export interface SheetMaterialOptions {
  /** Print cells held as issued (the default for the sheet itself); false gives every cell as calculated. */
  issued?: boolean
}

/** The bill of materials printed on one sheet (spool); IDs start at 1 and match the sheet's tags. */
export function sheetMaterials(doc: IsoDocument, spool = '', options: SheetMaterialOptions = {}): MaterialRow[] {
  return buildSheet(doc, spool, options).rows
}

function buildSheet(doc: IsoDocument, spool: string, options: SheetMaterialOptions): SheetBuild {
  return withIndex(doc, () => buildRows(doc, spool, options))
}
function buildRows(doc: IsoDocument, spool: string, options: SheetMaterialOptions): SheetBuild {
  const profile = profileOf(doc), errors: string[] = [], warnings: string[] = []
  const rows = new Map<string, Draft>()
  let seq = 0
  const size = (nps: number, small?: number) => sizeFor(doc, nps, small)
  /**
   * Rows by what the sheet prints for them (category, size, description, shop/field, bolt size): items reached two ways
   * (a gasket read as its own part and one supplied with a joint) that print the same are one purchased item, one row.
   * Pipe rows are listed by their cut pieces, and an item known only by its measured dimensions by them: neither is
   * merged by text.
   */
  const printed = new Map<string, string>()
  const printKey = (row: Pick<Draft, 'category' | 'nd' | 'description' | 'supply' | 'bolt'>) =>
    JSON.stringify([row.category, row.nd, row.description, row.supply, row.bolt ? [row.bolt.kind, round(row.bolt.diameter, 2), round(row.bolt.length, 2)] : null])
  const add = (group: string, row: Omit<Draft, 'memberIds' | 'memberQty' | 'first' | 'group' | 'flangeRank' | 'aliases'> & { flangeRank?: number }, member: string, qty: number, alias: string) => {
    const byText = row.category !== 'pipe' && !row.identity.measured
    const same = byText ? printed.get(printKey(row)) : undefined
    const found = rows.get(group) ?? (same ? rows.get(same) : undefined)
    if (found) {
      found.qty += qty
      if (!found.memberIds.includes(member)) found.memberIds.push(member)
      found.memberQty[member] = (found.memberQty[member] ?? 0) + qty
      if (!found.aliases.includes(alias)) found.aliases.push(alias)
      return found
    }
    const created: Draft = { ...row, qty, group, flangeRank: row.flangeRank ?? 0, first: seq++, memberIds: [member], memberQty: { [member]: qty }, aliases: [alias] }
    rows.set(group, created)
    if (byText && !printed.has(printKey(row))) printed.set(printKey(row), group)
    return created
  }
  const assume = (row: Draft, note?: string) => { if (note && !(row.assumed ??= []).includes(note)) row.assumed.push(note) }
  const flangeRank = (code: string) => profile.flangeOrder.findIndex(s => code.endsWith(s)) + 1 || profile.flangeOrder.length + 1
  // Fittings joined without pipe are walked through but are not pieces to cut.
  const spoolRuns = doc.runs.filter(r => !spool || r.spool === spool)
  const route = routeOrder(doc, spoolRuns), appears = new Map<string, number>()
  route.forEach((r, i) => { for (const id of [r.id, r.from, r.to]) if (!appears.has(id)) appears.set(id, i) })

  // Pipe pieces are listed size by size, each size in order along the line from an open end of that size.
  const pieces = pipePieces(doc, spool), pieceOf = new Map(pieces.flatMap(p => p.runIds.map(id => [id, p] as const)))
  const sizes = [...new Set(spoolRuns.filter(r => !r.connector).map(r => r.nps))].sort((a, b) => a - b)
  const listed = new Set<PipePiece>()
  for (const run of sizes.flatMap(nps => routeOrder(doc, spoolRuns, nps).filter(r => !r.connector && r.nps === nps))) {
    const spec = getSpec(doc, run.specId), pipeSize = spec.sizes.find(s => s.nps === run.nps)
    if (run.nipple) {
      // A nipple is a bought piece, counted like a fitting.
      const description = nippleDescription(doc, run), own = spec.nipples?.find(n => n.nps === run.nps)
      const identity: MaterialIdentity = { category: 'nipple', code: 'NIPPLE', nps: run.nps, schedule: scheduleText(own?.schedule ?? pipeSize?.schedule ?? spec.schedule), material: own?.material ?? pipeSize?.material ?? spec.material }
      add(JSON.stringify([identityKey(identity), description]), { category: 'nipple', nd: size(run.nps), description, text: description, qty: 0, size: run.nps, identity, supply: supplyOf(pipeSize?.shopField) },
        run.id, 1, JSON.stringify(['nipple', spec.id, run.nps, description]))
      continue
    }
    const piece = pieceOf.get(run.id)
    if (!piece || listed.has(piece)) continue
    listed.add(piece)
    // The pipe is described with the ends it is actually cut to, as the cut list gives them.
    const base = pipeText(doc, run, pieceEnds(doc, piece))
    const cut = piece.cut, known = Number.isFinite(cut) && cut > 0
    const rounded = known ? doc.units === 'mm' ? Math.round(cut) : Math.round(cut / 25.4 * 16) : NaN
    // A piece marked so (it runs on through a drawing break, or is used as it comes) is listed without a cut, and so is
    // a piece exactly the stock length it is bought in (a full random length, to the profile's `uncutTolerance`):
    // there is nothing to cut.
    // A longer piece is never assumed uncut; it is cut and flagged below.
    const stockLength = spec.stockLength ?? profile.stockLength, uncut = piece.uncut || (known && Math.abs(cut - stockLength) <= profile.uncutTolerance)
    const identity: MaterialIdentity = { category: 'pipe', code: 'PIPE', nps: run.nps, schedule: scheduleText(pipeSize?.schedule ?? spec.schedule), material: pipeSize?.material ?? spec.material }
    const row = add(JSON.stringify([identityKey(identity), spec.id, base, known ? rounded : run.id, ...(uncut ? [run.id] : [])]), {
      category: 'pipe', nd: size(run.nps), description: base, text: base, qty: 0, size: run.nps, cut: known ? cut : NaN, identity,
      supply: supplyOf(pipeSize?.shopField),
      pipe: { pieces: [], cut: known ? cut : NaN, uncut, total: 0, ordered: 0, stockLength }
    }, piece.runIds[0], 0, 'pipe:' + piece.runIds[0])
    // Every pipe of the piece carries the row's tag; each contributes its share of the length.
    for (const id of piece.runIds) {
      if (!row.memberIds.includes(id)) row.memberIds.push(id)
      row.memberQty[id] = piece.shares[id]
    }
    row.pipe!.pieces.push(piece)
    if (known && cut > row.pipe!.stockLength + 0.01)
      warnings.push(`${run.spool}: a ${size(run.nps)} pipe piece is ${listLength(doc, cut)} long, more than the ${listLength(doc, row.pipe!.stockLength)} stock length it is bought in. Add a butt weld (shop or field) to split it, or set a longer stock length (double random) for the project or specification.`)
  }

  // The second half of a 180° return is the same item as its first half.
  const halves: Array<{ node: PipeNode; first: PipeNode }> = []
  for (const node of doc.nodes) {
    if (['end', 'weld', 'annotation'].includes(node.kind) || (node.kind === 'support' && !supportListed(doc, node))) continue
    const ret = returnPartner(doc, node)
    if (ret && doc.nodes.indexOf(ret.partner) < doc.nodes.indexOf(node)) { halves.push({ node, first: ret.partner }); continue }
    const edges = connected(doc, node.id), host = edges[0] ?? doc.runs.find(r => r.id === node.associatedRunId)
    if (!host || (spool && !(edges.length ? edges : [host]).some(r => r.spool === spool))) continue
    const item = nodeItem(doc, node), code = nodeCode(doc, node) ?? item?.component ?? ''
    if (COMPONENT_TYPE_BY_CODE[code]?.byOthers) continue
    // A bend formed in the pipe is an operation on the pipe piece it is part of: listed by size, angle and radius.
    if (isFormedBend(doc, node)) {
      if (spool && spansSpools(doc, node) && breakOwner(doc, node) !== spool) continue
      const degrees = round((deflection(doc, node) ?? 0) * 180 / Math.PI, 1), radius = node.bendRadius
      const identity: MaterialIdentity = { category: 'bend', code, nps: host.nps, schedule: undefined, material: undefined }
      // The specification's own bend text is what is bought, as for every other row; without one, the bend is named by
      // its angle and radius.
      const description = item?.bomDescription ? item.bomDescription.toUpperCase()
        : compose('PIPE BEND', `${degrees}°`, radius ? `${draftLength(radius, doc.units, Infinity)} RADIUS` : 'RADIUS TBD')
      add(JSON.stringify([identityKey(identity), degrees, radius ?? null, description]), { category: 'bend', nd: size(host.nps), description, text: description, qty: 0, size: host.nps, identity, supply: 'shop' },
        node.id, 1, JSON.stringify(['bend', item?.id ?? code, description, sizeText(host.nps), null, null]))
      continue
    }
    // An olet is contoured to its header and bought as header by branch size; an angle body is sized inlet by outlet,
    // the outlet being its branch.
    const header = node.kind === 'olet' ? doc.runs.find(r => r.id === node.associatedRunId) : undefined
    const outlet = COMPONENT_TYPE_BY_CODE[code]?.angle ? edges.find(r => r.id === node.branchEdgeId) : undefined
    const inlet = outlet && edges.find(r => r !== outlet)
    const pipeSizes = edges.map(r => r.nps), nps = header?.nps ?? item?.nps ?? inlet?.nps ?? Math.max(...pipeSizes, host.nps)
    const small = header ? edges[0]?.nps ?? item?.smallerNps ?? item?.nps : item?.smallerNps ?? outlet?.nps ?? (pipeSizes.length > 1 ? Math.min(...pipeSizes) : undefined)
    const pair = isFlangePair(doc, node)
    // A flange the next drawing supplies is not listed here (its stub end is, with the joint).
    if (node.kind === 'flange' && !pair && node.jointSupply?.flange === false && !/^STUB-END/.test(code)) continue
    // At a spool break a flange pair lists each sheet's own flange; anything else spanning it, the owning sheet.
    const flanges = pair ? pairFlangesOn(doc, node, spool) : 0
    if (pair ? !flanges : spool && spansSpools(doc, node) && breakOwner(doc, node) !== spool) continue
    const label = node.description ?? COMPONENT_TYPE_BY_CODE[code]?.label ?? node.kind
    const named = node.description ? node.description.toUpperCase() : rowDescription(item, label), flat = flatSideText(node)
    // A description read with its flat side already in it (an imported material text) names it once.
    const description = flat && named.split(',').some(p => p.trim() === flat) ? named : [named, flat].filter(Boolean).join(', ')
    const category = categoryOf(node.kind, code)
    const smaller = small != null && small !== nps ? small : undefined
    // An item with no catalogue entry is known only by its measured dimensions; a catalogued one by what is bought,
    // whatever takeout was measured for it.
    const identity: MaterialIdentity = {
      category, code: code || node.kind, nps, smallerNps: smaller, rating: item?.rating, schedule: scheduleText(item?.schedule) || undefined,
      material: item?.material, face: node.kind === 'flange' || node.kind === 'gasket' ? faceOfCode(code) : undefined,
      ...(code || item ? {} : { measured: [node.takeout ?? null, node.branchTakeout ?? null, node.portTakeouts ? Object.values(node.portTakeouts).sort((a, b) => a - b) : null] })
    }
    // Bolting drawn as its own part is listed as joint bolting is: by diameter and length, where its row gives them.
    const bolt = node.kind === 'bolt' && item?.boltDiameter && item.boltLength
      ? { kind: item.boltKind ?? 'stud' as const, diameter: item.boltDiameter, length: item.boltLength, system: item.boltSystem ?? 'inch' as const } : undefined
    // (keyed as joint bolting is, so the same bolts drawn and supplied with joints are one row).
    const group = bolt ? JSON.stringify([bolt.kind, round(bolt.diameter, 2), round(bolt.length, 2), item?.material ?? null, description, supplyOf(item?.shopField)])
      : JSON.stringify([identityKey(identity), description, supplyOf(item?.shopField)])
    const row = add(group, {
      category, nd: bolt ? boltSizeText(bolt.diameter, bolt.length, bolt.system) : size(nps, node.kind === 'tee' && small === nps ? undefined : small), description, text: description, qty: 0, size: nps, identity,
      supply: supplyOf(item?.shopField), flangeRank: flangeRank(code), ...(bolt ? { bolt } : {})
    }, node.id, node.quantity ?? (pair ? flanges : 1), JSON.stringify([category, item?.id ?? code, description, sizeText(nps, small), node.takeout ?? null, node.branchTakeout ?? null]))
    assume(row, item?.assumed)
    const source = dimensionSource(doc, node)
    if (source === 'standard' || source === 'calculated' || source === 'missing') row.dimensionSource = row.dimensionSource === 'missing' ? 'missing' : source
  }
  for (const { node, first } of halves) {
    const row = [...rows.values()].find(r => r.memberIds.includes(first.id))
    if (row && !row.memberIds.includes(node.id)) { row.memberIds.push(node.id); row.memberQty[node.id] = 0 }
  }
  const joints = flangedJoints(doc, spool)
  for (const joint of joints) addJoint(joint)
  function addJoint(joint: FlangedJoint) {
    const rating = String(joint.rating)
    for (const flange of joint.flanges.filter(f => f.implicit)) {
      const description = rowDescription(flange.item, COMPONENT_TYPE_BY_CODE[flange.code]?.label ?? 'FLANGE')
      const identity: MaterialIdentity = { category: 'flange', code: flange.code, nps: joint.nps, rating: flange.item?.rating, schedule: scheduleText(flange.item?.schedule) || undefined, material: flange.item?.material, face: faceOfCode(flange.code) }
      assume(add(JSON.stringify([identityKey(identity), description, supplyOf(flange.item?.shopField)]), {
        category: 'flange', nd: size(joint.nps), description, text: description, qty: 0, size: joint.nps, identity, supply: supplyOf(flange.item?.shopField),
        flangeRank: flangeRank(flange.code)
      }, joint.id + '#flange', 1, JSON.stringify(['flange', flange.item?.id ?? flange.code, description, sizeText(joint.nps), null, null])), flange.item?.assumed)
    }
    for (const stub of joint.stubEnds) {
      const description = rowDescription(stub, 'STUB END')
      const identity: MaterialIdentity = { category: 'stub', code: stub.component ?? 'STUB-END', nps: joint.nps, schedule: scheduleText(stub.schedule) || undefined, material: stub.material }
      add(JSON.stringify([identityKey(identity), description, supplyOf(stub.shopField)]), { category: 'stub', nd: size(joint.nps), description, text: description, qty: 0, size: joint.nps, identity, supply: supplyOf(stub.shopField) },
        joint.id + '#stub', 1, JSON.stringify(['stub', stub.id, description, sizeText(joint.nps), null, null]))
    }
    // Parts supplied on another drawing or by others are neither counted nor named here.
    if (joint.gasket && joint.supplied.gasket) {
      const item = joint.gasket.item, description = rowDescription(item, 'GASKET')
      // The gasket bought is its row's: a specification gasket row used at a joint of the other face is the same item.
      const identity: MaterialIdentity = { category: 'gasket', code: item?.component ?? `GASK-${joint.face}`, nps: joint.nps, rating: item?.rating ?? rating, material: item?.material, face: faceOfCode(item?.component) ?? joint.face }
      assume(add(JSON.stringify([identityKey(identity), description, supplyOf(item?.shopField)]), { category: 'gasket', nd: size(joint.nps), description, text: description, qty: 0, size: joint.nps, identity, supply: supplyOf(item?.shopField) },
        joint.id + '#gasket', 1, JSON.stringify(['gasket', item?.id, description, joint.nps])), joint.gasket.assumed)
    }
    if (joint.bolts && joint.supplied.bolts) {
      const b = joint.bolts, own = rowDescription(b.item, b.kind === 'machine' ? 'MACHINE BOLTS C/W NUTS' : 'STUD BOLTS C/W 2 NUTS'), system = b.item?.boltSystem ?? 'inch'
      const description = b.kind === 'lug' ? lugBoltText(own, b.nuts) : own
      // Bolting is written in its own system: ASME bolting in inches on metric drawings too.
      const nd = boltSizeText(b.diameter, b.length, system)
      const identity: MaterialIdentity = { category: 'bolt', code: b.kind, nps: joint.nps, rating: b.item?.rating, material: b.item?.material }
      // Bolting follows joint size, then the joints' order along the line.
      assume(add(JSON.stringify([b.kind, round(b.diameter, 2), round(b.length, 2), b.item?.material ?? null, description, supplyOf(b.item?.shopField)]), {
        category: 'bolt', nd, description, text: description, qty: 0, size: joint.nps, identity, supply: supplyOf(b.item?.shopField),
        bolt: { kind: b.kind, diameter: b.diameter, length: b.length, system }
      }, joint.id + '#bolts', b.count, JSON.stringify(['bolt', b.kind, description, boltSizeText(b.diameter, b.length)])), b.assumed)
    }
  }

  // Stable keys: the purchased identity, numbered when the sheet has more than one row of it (by first appearance).
  const drafts = [...rows.values()], counts = new Map<string, number>()
  for (const row of drafts) {
    const base = row.category === 'bolt' && row.bolt
      ? JSON.stringify(['bolt', row.bolt.kind, round(row.bolt.diameter, 2), round(row.bolt.length, 2), row.identity.material ?? null])
      : identityKey(row.identity)
    const n = (counts.get(base) ?? 0) + 1
    counts.set(base, n)
    row.key = n > 1 ? `${base}#${n}` : base
  }
  const matches = (row: { key?: string; aliases: string[] }, key?: string) => !!key && (row.key === key || row.aliases.includes(key))

  // An issued joint callout may name an item already on the sheet: that joint's own part is then not bought again,
  // provided the item fits the joint.
  const held = spool ? doc.sheets?.[spool]?.jointItems : undefined
  for (const joint of held ? joints : []) {
    const refs = held![joint.id]
    if (!refs) continue
    for (const [part, category] of [['flange', 'flange'], ['bolts', 'bolt'], ['gasket', 'gasket']] as const) {
      const key = refs[part]
      if (!key) continue
      const member = part === 'flange' ? (joint.flanges.some(f => f.implicit) ? joint.id + '#flange' : joint.flangeNodeId ?? joint.nodeId) : `${joint.id}#${part}`
      const own = drafts.find(r => r.memberIds.includes(member))
      const target = drafts.find(r => r.category === category && matches(r, key))
      const where = `${joint.spool}: the ${joint.nps}″ flanged joint's ${part} callout`
      if (!target) { errors.push(`${where} refers to a material item that is no longer on the sheet. Choose the item again, or let the joint list its own ${part}.`); continue }
      if (target === own) continue
      const mismatch = jointMismatch(joint, part, target)
      if (mismatch) { errors.push(`${where} names item ${target.text} (${target.nd}), which ${mismatch}. Choose a matching item, or let the joint list its own ${part}.`); continue }
      if (own) {
        own.qty -= own.memberQty[member] ?? 0
        delete own.memberQty[member]
        own.memberIds = own.memberIds.filter(id => id !== member)
        if (!own.memberIds.length) rows.delete(own.group)
      }
    }
  }

  // Joint parts (`<node>[:<pipe>]#part`) come where their node does.
  const appear = (row: { memberIds: string[] }) => Math.min(1e9, ...row.memberIds.map(id => appears.get(id.split('#')[0].split(':')[0]) ?? 1e9))
  const order = profile.materialOrder, sign = profile.sizeOrder === 'descending' ? -1 : 1
  const rank = (c: MaterialCategory) => order.indexOf(c === 'elbow45' ? 'elbow90' : c)
  const sections = profile.materialSections === 'shop-field'
  // Within a type: size, then the order the items come along the line.
  const sorted = [...rows.values()].sort((a, b) =>
    (sections ? Number(a.supply === 'field') - Number(b.supply === 'field') : 0) ||
    rank(a.category) - rank(b.category) ||
    (a.category === 'pipe' ? sign * (a.size - b.size) || a.first - b.first
      : a.category === 'flange' ? a.flangeRank - b.flangeRank || sign * (a.size - b.size) || appear(a) - appear(b)
        : sign * (a.size - b.size) || appear(a) - appear(b) || a.first - b.first))
  // Item numbers held as issued keep their place; anything new follows in the usual order.
  const holdOrder = (spool && doc.sheets?.[spool]?.bomOrder) || []
  if (holdOrder.length) {
    const at = (row: Draft) => { const i = holdOrder.findIndex(k => matches(row, k)); return i < 0 ? Infinity : i }
    sorted.sort((a, b) => at(a) - at(b))
  }
  const result: MaterialRow[] = sorted.map((row, index) => {
    const { size: _size, flangeRank: _rank, first: _first, group: _group, ...rest } = row
    const base = { ...rest, key: row.key!, id: index + 1 }
    if (row.category !== 'pipe' || !row.pipe) return { ...base, qtyText: String(row.qty) }
    const pipe = row.pipe, n = pipe.pieces.length, cut = pipe.cut, known = Number.isFinite(cut) && cut > 0
    const total = known ? n * cut + (n - 1) * profile.kerf : NaN
    const noteParts = profile.cutNote === 'description' && !pipe.uncut
      ? ['-', `CUT TO ${known ? listLength(doc, cut) : '(PENDING)'}`, ...(n > 1 ? [`(TOTAL OF ${n} PIECES)`] : [])] : []
    return {
      ...base, qty: total, cut, qtyText: purchaseText(doc, total), description: [row.text, ...noteParts].join(' '),
      ...(noteParts.length ? { noteParts } : {}),
      pipe: { ...pipe, total, ordered: orderedLength(doc, total) }
    }
  })
  // Cells held as issued are printed (and marked) on the sheet; the calculated cells stay with the row.
  const issued = spool ? doc.sheets?.[spool]?.issuedValues : undefined
  const rowsOut = result.map(row => {
    const cells = issuedCells(issued, row)
    if (!cells) return row
    const calculated = { qtyText: row.qtyText, nd: row.nd, description: row.description }
    const overridden = ISSUED_CELLS.filter(k => cells[k] != null)
    for (const k of overridden) {
      if (cells[k] !== calculated[k])
        warnings.push(`${spool}: item ${row.id} prints ${CELL_NAME[k]} "${cells[k]}" as issued, but the model calculates "${calculated[k]}".` +
          (cells.calculated?.[k] != null && cells.calculated[k] !== calculated[k] ? ` The model has changed since the issued value was entered (it calculated "${cells.calculated[k]}" then).` : ''))
    }
    if (options.issued === false) return row
    const printed = Object.fromEntries(overridden.map(k => [k, cells[k]!]))
    return { ...row, ...printed, calculated, overridden }
  })
  return { rows: rowsOut, errors, warnings }
}
const CELL_NAME: Record<IssuedCell, string> = { qtyText: 'quantity', nd: 'size', description: 'description' }
const issuedCells = (issued: Record<string, IssuedCells> | undefined, row: MaterialRow) =>
  issued ? issued[row.key] ?? row.aliases.map(a => issued[a]).find(Boolean) : undefined
/** Why a referenced item does not fit a joint's part, or undefined when it does. */
function jointMismatch(joint: FlangedJoint, part: 'flange' | 'bolts' | 'gasket', row: Draft): string | undefined {
  if (part === 'bolts') {
    const b = joint.bolts, have = row.bolt
    if (!b || !have) return undefined
    return Math.abs(b.diameter - have.diameter) > 0.5 || Math.abs(b.length - have.length) > 0.5
      ? `is ${boltSizeText(have.diameter, have.length, have.system)} bolting where the joint needs ${boltSizeText(b.diameter, b.length, have.system)}` : undefined
  }
  if (row.identity.nps !== joint.nps) return `is ${sizeText(row.identity.nps)} where the joint is ${sizeText(joint.nps)}`
  const cls = ratingClass(row.identity.rating)
  if (cls != null && cls !== joint.rating) return `is class ${cls} where the joint is class ${joint.rating}`
  // A gasket fits when it is the joint's own gasket's face (a specification row may serve the other face).
  const face = part === 'gasket' ? faceOfCode(joint.gasket?.item?.component) ?? joint.face : joint.face
  if (row.identity.face && row.identity.face !== face) return `is ${row.identity.face} where the joint is ${face}`
  return undefined
}
/** Spools in the order the package issues their sheets. */
export const packageSpools = (doc: IsoDocument) => [...new Set(doc.runs.map(r => r.spool))]
/** Material errors on every sheet: joint callouts naming items that do not fit, or are gone. */
export function materialErrors(doc: IsoDocument): string[] {
  return [...new Set(packageSpools(doc).flatMap(spool => buildSheet(doc, spool, {}).errors))]
}
/** Material warnings on every sheet: pieces longer than stock, issued cells that differ from the model. */
export function materialWarnings(doc: IsoDocument): string[] {
  return [...new Set(packageSpools(doc).flatMap(spool => buildSheet(doc, spool, {}).warnings))]
}
/** The row a held key names: by its key, or a key it was held under before. */
export const findMaterialRow = (rows: MaterialRow[], key: string | undefined, category?: MaterialCategory) =>
  key ? rows.find(r => (!category || r.category === category) && (r.key === key || r.aliases.includes(key))) : undefined

/** Hold a sheet's item numbers as they are now, or release them (`hold` false). */
export function holdItemNumbers(doc: IsoDocument, spool: string, hold = true) {
  const sheets = (doc.sheets ??= {}), info = { ...sheets[spool] }
  if (hold) info.bomOrder = sheetMaterials(doc, spool).map(r => r.key)
  else delete info.bomOrder
  if (Object.keys(info).length) sheets[spool] = info
  else delete sheets[spool]
  if (!Object.keys(sheets).length) delete doc.sheets
}
/**
 * Hold one cell of a material row as issued (`value`), or release it (undefined). The calculated cell at this moment
 * is kept with it, so a later change in the model is reported against the issued value.
 */
export function setIssuedCell(doc: IsoDocument, spool: string, key: string, cell: IssuedCell, value?: string) {
  const row = findMaterialRow(sheetMaterials(doc, spool, { issued: false }), key)
  const sheets = (doc.sheets ??= {}), info = (sheets[spool] ??= {}), cells = (info.issuedValues ??= {})
  const own = row ? row.key : key, entry: IssuedCells = { ...(cells[own] ?? (row && row.aliases.map(a => cells[a]).find(Boolean)) ?? {}) }
  if (row) for (const alias of row.aliases) delete cells[alias]
  if (value == null) {
    delete entry[cell]
    if (entry.calculated) delete entry.calculated[cell]
  } else {
    entry[cell] = value
    if (row) entry.calculated = { ...entry.calculated, [cell]: row[cell] }
  }
  if (entry.calculated && !Object.keys(entry.calculated).length) delete entry.calculated
  if (ISSUED_CELLS.some(k => entry[k] != null)) cells[own] = entry
  else delete cells[own]
  if (!Object.keys(cells).length) delete info.issuedValues
  if (!Object.keys(info).length) delete sheets[spool]
  if (!Object.keys(sheets).length) delete doc.sheets
}
/** The BOM ID that tags a pipe, node or joint part on a sheet. */
export const materialId = (rows: MaterialRow[], member: string) => rows.find(r => r.memberIds.includes(member))?.id

export interface Measure { weightKg: number | null; areaM2: number | null; cost: number; hours: number }
type Priced = Pick<CatalogItem, 'weightKg' | 'areaM2' | 'unitCost' | 'laborHours'>
const each = (item: Priced | undefined, qty = 1, per = 1): Measure => ({
  weightKg: item?.weightKg == null ? null : item.weightKg / per * qty,
  areaM2: item?.areaM2 == null ? null : item.areaM2 / per * qty,
  cost: (item?.unitCost ?? 0) * qty,
  hours: (item?.laborHours ?? 0) * qty
})
/**
 * Weight, area, cost and labour of one member of a bill-of-materials row: a pipe (`qty` its length, mm), a node or
 * a joint part (`qty` its count on the sheet, so a flange pair split at a spool break is weighed once per flange).
 */
export function measureMember(doc: IsoDocument, member: string, qty: number, joints: FlangedJoint[]): Measure {
  const run = doc.runs.find(r => r.id === member)
  if (run) {
    const spec = getSpec(doc, run.specId), size = spec.sizes.find(s => s.nps === run.nps)
    // A nipple is counted; it weighs its catalogued length of pipe.
    const length = run.nipple ? (nippleOf(doc, run)?.length ?? runResult(doc, run).cut) * qty : qty
    const m = Number.isFinite(length) && length > 0 ? length / 1000 : NaN, known = Number.isFinite(m)
    return {
      weightKg: known && size ? size.kgM * m : null,
      areaM2: known && size ? Math.PI * size.od * m / 1000 : null,
      cost: known ? m * spec.pipeCostM : 0,
      hours: known ? m * spec.pipeLaborHoursM : 0
    }
  }
  const node = doc.nodes.find(n => n.id === member)
  if (node) {
    // A formed bend's steel is its pipe piece's (the piece is cut to include the arc): the bend adds none of its own.
    if (isFormedBend(doc, node)) return each({ weightKg: node.weightKg ?? 0, areaM2: node.areaM2 ?? 0, laborHours: node.laborHours ?? fitting(doc, node)?.laborHours, unitCost: node.unitCost ?? fitting(doc, node)?.unitCost }, qty)
    const item = nodeItem(doc, node)
    return each({
      weightKg: node.weightKg ?? item?.weightKg, areaM2: node.areaM2 ?? item?.areaM2,
      unitCost: node.unitCost ?? item?.unitCost, laborHours: node.laborHours ?? item?.laborHours
    }, qty)
  }
  const [id, part] = member.split('#'), joint = joints.find(j => j.id === id)
  if (part === 'flange') return each(joint?.flanges.find(f => f.implicit)?.item, qty)
  if (part === 'stub') return each(joint?.stubEnds[0], qty)
  if (part === 'gasket') return each(joint?.gasket?.item, qty)
  if (part === 'bolts' && joint?.bolts) return each(joint.bolts.item, qty, joint.bolts.item?.boltCount ?? joint.bolts.count)
  return { weightKg: null, areaM2: null, cost: 0, hours: 0 }
}
/** Specification, heat, line and spool a row member is bought under. */
function memberContext(doc: IsoDocument, member: string, joints: FlangedJoint[], spool: string): { spec: string; heat: string; line: string; spool: string } {
  const run = doc.runs.find(r => r.id === member)
  if (run) return { spec: run.specId, heat: run.heat, line: run.line, spool }
  const node = doc.nodes.find(n => n.id === member)
  if (node) {
    const edges = connected(doc, node.id), edge = edges.find(r => r.spool === spool) ?? edges[0] ?? doc.runs.find(r => r.id === node.associatedRunId)
    return { spec: edges[0]?.specId ?? edge?.specId ?? '', heat: node.heat ?? '', line: edge?.line ?? '', spool }
  }
  const joint = joints.find(j => j.id === member.split('#')[0])
  return { spec: joint?.specId ?? '', heat: '', line: joint?.line ?? '', spool }
}

/**
 * The material take-off from the sheets' bills of materials: every sheet row split by specification and heat lot,
 * in model quantities (pipe in metres of cut pipe, everything else each), grouped by spool, line or drawing.
 */
export function materialTakeoff(doc: IsoDocument, group: 'spool' | 'line' | 'global' = 'spool'): BomRow[] {
  return withIndex(doc, () => takeoffRows(doc, group))
}
function takeoffRows(doc: IsoDocument, group: 'spool' | 'line' | 'global'): BomRow[] {
  const joints = flangedJoints(doc), map = new Map<string, BomRow>()
  for (const spool of packageSpools(doc))
    for (const row of sheetMaterials(doc, spool, { issued: false })) {
      const materialKey = row.category === 'bolt' && row.bolt
        ? JSON.stringify(['bolt', row.bolt.kind, round(row.bolt.diameter, 2), round(row.bolt.length, 2), row.identity.material ?? null])
        : identityKey(row.identity)
      for (const member of row.memberIds) {
        const ctx = memberContext(doc, member, joints, spool), amount = row.memberQty[member] ?? 0
        const m = measureMember(doc, member, amount, joints)
        const pipe = row.category === 'pipe'
        const qty = pipe ? (Number.isFinite(amount) && amount > 0 ? amount / 1000 : NaN) : amount
        const key = JSON.stringify([materialKey, row.text, ctx.spec, row.identity.nps, ctx.heat, row.supply, group === 'global' ? '' : ctx.line, group === 'spool' ? ctx.spool : ''])
        // Implicit mating flanges are also known by their joint, as older exports name them.
        const ids = member.endsWith('#flange') ? [member, member.slice(0, -'#flange'.length)] : [member]
        const found = map.get(key)
        if (found) {
          found.qty += qty
          found.cost += m.cost
          found.hours += m.hours
          found.weightKg = found.weightKg == null || m.weightKg == null ? null : found.weightKg + m.weightKg
          found.areaM2 = found.areaM2 == null || m.areaM2 == null ? null : found.areaM2 + m.areaM2
          found.memberIds!.push(...ids)
        } else map.set(key, {
          // Bolting is bought by diameter and length, which the take-off has no column for.
          item: map.size + 1, description: row.bolt ? `${row.text} ${row.nd}` : row.text, spec: ctx.spec, nps: row.identity.nps, qty, unit: pipe ? 'm' : 'ea',
          weightKg: m.weightKg, areaM2: m.areaM2, cost: m.cost, hours: m.hours, heat: ctx.heat, spool: ctx.spool, line: ctx.line,
          materialKey, memberIds: ids
        })
      }
    }
  return [...map.values()]
}
