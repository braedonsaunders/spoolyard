import { COMPONENT_TYPE_BY_CODE } from './components'
import { flangedJoints, flangePipePrep, isFlangePair, isLapJoint, matingFlange, nodeCode, nodeItem, type FlangedJoint } from './joints'
import { draftLength, sizeText } from './format'
import { sheetMaterials, type MaterialRow } from './material-list'
import {
  connected, csv, distance, getNode, getSpec, pipePrepAt, round, runResult, sheetInfoOf, takeout, welds,
  type CatalogItem, type IsoDocument, type PipeNode, type PipeRun, type Weld
} from './model'

/**
 * The fabrication schedules issued with the sheets. Every one is numbered as the sheets are: material and pipe items
 * by each spool's bill of materials, welds in sequence along each spool.
 */
type Units = IsoDocument['units']
/** Spools in the order the package issues their sheets. */
export const packageSpools = (doc: IsoDocument) => [...new Set(doc.runs.map(r => r.spool))]
/** Printed for a value the drawing does not know. */
export const UNKNOWN = '—'
export const lengthUnits = (units: Units) => units === 'mm' ? 'millimetres' : 'feet and inches'
/** A length as the sheets write it: whole millimetres, or feet-inches to 1/16". */
export const lengthText = (mm: number, units: Units) => Number.isFinite(mm) ? draftLength(mm, units) : UNKNOWN
/** An overall as the sheet dimensions it: inches below two feet. */
export const overallText = (mm: number, units: Units) => Number.isFinite(mm) ? draftLength(mm, units, 24) : UNKNOWN
/** A takeout or root gap: tenths of a millimetre, or inches to 1/16" (decimal inches only where that reads zero). */
export function allowanceText(mm: number, units: Units): string {
  if (!Number.isFinite(mm)) return UNKNOWN
  if (units === 'mm') return String(round(mm, 1))
  return !mm || Math.round(Math.abs(mm) / 25.4 * 16) ? draftLength(mm, units, 24) : `${round(mm / 25.4, 3)}"`
}
/** Wall schedule in drafting notation: STD, XS, XXS, SCH 40, SCH 10S. */
export function scheduleText(text = ''): string {
  const bare = text.trim().toUpperCase().replace(/\.$/, '').replace(/^SCH(EDULE)?\.?\s*/, '')
  return /^\d+S?$/.test(bare) ? 'SCH ' + bare : bare
}
const sheetTitle = (doc: IsoDocument, spool: string) => sheetInfoOf(doc, spool).drawingNumber

export interface MaterialScheduleRow extends MaterialRow {
  spool: string
  drawing: string
  weightKg: number | null
  areaM2: number | null
  cost: number
  hours: number
}
interface Measure { weightKg: number | null; areaM2: number | null; cost: number; hours: number }
type Priced = Pick<CatalogItem, 'weightKg' | 'areaM2' | 'unitCost' | 'laborHours'>
const each = (item: Priced | undefined, qty = 1, per = 1): Measure => ({
  weightKg: item?.weightKg == null ? null : item.weightKg / per * qty,
  areaM2: item?.areaM2 == null ? null : item.areaM2 / per * qty,
  cost: (item?.unitCost ?? 0) * qty,
  hours: (item?.laborHours ?? 0) * qty
})
/** Weight, area, cost and labour of one member of a bill-of-materials row: a pipe, a node or a joint part. */
function measure(doc: IsoDocument, member: string, joints: FlangedJoint[]): Measure {
  const run = doc.runs.find(r => r.id === member)
  if (run) {
    const spec = getSpec(doc, run.specId), v = runResult(doc, run), m = Number.isFinite(v.cut) && v.cut > 0 ? v.cut / 1000 : NaN
    const known = Number.isFinite(m)
    return {
      weightKg: known && Number.isFinite(v.weightKg) ? v.weightKg : null,
      areaM2: known && Number.isFinite(v.areaM2) ? v.areaM2 : null,
      cost: known ? m * spec.pipeCostM : 0,
      hours: known ? m * spec.pipeLaborHoursM : 0
    }
  }
  const node = doc.nodes.find(n => n.id === member)
  if (node) {
    const item = nodeItem(doc, node), qty = node.quantity ?? (isFlangePair(doc, node) ? 2 : 1)
    return each({
      weightKg: node.weightKg ?? item?.weightKg, areaM2: node.areaM2 ?? item?.areaM2,
      unitCost: node.unitCost ?? item?.unitCost, laborHours: node.laborHours ?? item?.laborHours
    }, qty)
  }
  const [id, part] = member.split('#'), joint = joints.find(j => j.id === id)
  if (part === 'flange') return each(joint?.flanges.find(f => f.implicit)?.item)
  if (part === 'stub') return each(joint?.stubEnds[0])
  if (part === 'gasket') return each(joint?.gasket?.item)
  if (part === 'bolts' && joint?.bolts) return each(joint.bolts.item, joint.bolts.count, joint.bolts.item?.boltCount ?? joint.bolts.count)
  return { weightKg: null, areaM2: null, cost: 0, hours: 0 }
}
/** Each sheet's bill of materials, item for item and number for number, with weights for the schedule. */
export function materialSchedule(doc: IsoDocument): MaterialScheduleRow[] {
  const joints = flangedJoints(doc)
  return packageSpools(doc).flatMap(spool => sheetMaterials(doc, spool).map(row => {
    const parts = row.memberIds.map(member => measure(doc, member, joints))
    const sum = (key: 'weightKg' | 'areaM2') => parts.some(p => p[key] == null) ? null : parts.reduce((s, p) => s + p[key]!, 0)
    return {
      ...row, spool, drawing: sheetTitle(doc, spool), weightKg: sum('weightKg'), areaM2: sum('areaM2'),
      cost: parts.reduce((s, p) => s + p.cost, 0), hours: parts.reduce((s, p) => s + p.hours, 0)
    }
  }))
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
/**
 * How far in from a node the sheet dimensions its pipe: a flanged valve to its mating flange face, across the gasket;
 * a reducer to its end. Elsewhere the node itself is the dimension point.
 */
function stationOffset(doc: IsoDocument, node: PipeNode, run: PipeRun, joints: FlangedJoint[]): number {
  if (connected(doc, node.id).length < 2) return 0
  const port = joints.find(j => j.kind === 'component-port' && j.id === `${node.id}:${run.id}`)
  if (port) return distance(node.position, port.position) + (port.gasket?.thickness ?? 0)
  if (node.kind === 'reducer' && !/CPLG/.test(nodeCode(doc, node) ?? '')) return takeout(doc, node, run.id) ?? 0
  return 0
}
export interface CutRow {
  spool: string
  drawing: string
  /** The pipe's item number on its sheet; pieces of one item share it. */
  item: number
  piece: number
  pieces: number
  run: PipeRun
  /** Between the dimension points the sheet uses, with takeouts measured from the same points. */
  overall: number
  takeouts: [number, number]
  gaps: [number, number]
  cut: number
  ends: [PipeEnd, PipeEnd]
  /** Listed on the sheet by length without a cut. */
  uncut: boolean
}
/** Every pipe piece, numbered by its item on the sheet. */
export function cutSchedule(doc: IsoDocument): CutRow[] {
  const joints = flangedJoints(doc)
  return packageSpools(doc).flatMap(spool => sheetMaterials(doc, spool).filter(row => row.category === 'pipe').flatMap(row => {
    const runs = row.memberIds.flatMap(id => doc.runs.filter(r => r.id === id))
    return runs.map((run, i): CutRow => {
      const v = runResult(doc, run), [a, b] = [run.from, run.to].map(id => stationOffset(doc, getNode(doc, id), run, joints))
      return {
        spool, drawing: sheetTitle(doc, spool), item: row.id, piece: i + 1, pieces: runs.length, run,
        overall: v.overall - a - b, takeouts: [v.takeouts[0] - a, v.takeouts[1] - b], gaps: v.gaps, cut: v.cut,
        ends: [pipeEnd(doc, run, 0), pipeEnd(doc, run, 1)], uncut: !/ - CUT TO /.test(row.description)
      }
    })
  }))
}
export const pieceText = (row: Pick<CutRow, 'item' | 'piece' | 'pieces'>) => row.pieces > 1 ? `${row.item} (${row.piece} of ${row.pieces})` : String(row.item)
export const cutText = (row: Pick<CutRow, 'cut' | 'uncut'>, units: Units) =>
  row.uncut ? 'NOT CUT' : Number.isFinite(row.cut) && row.cut > 0 ? draftLength(row.cut, units) : UNKNOWN

export type WeldType = 'BUTT' | 'SOCKET FILLET' | 'BRANCH' | 'ATTACHMENT' | 'SLIP-ON FILLET'
const WELD_TYPE: Record<Weld['type'], WeldType> = { BW: 'BUTT', SW: 'SOCKET FILLET', SO: 'SLIP-ON FILLET', BR: 'BRANCH', RP: 'ATTACHMENT', AT: 'ATTACHMENT' }
export interface WeldRow {
  weld: Weld
  spool: string
  drawing: string
  line: string
  type: WeldType
  size: string
  schedule: string
  /** The parts the weld joins, e.g. PIPE–ELL. */
  joint: string
}
/** Shop name of the part a pipe or fitting meets at a node. */
function partName(doc: IsoDocument, node: PipeNode, run: PipeRun): string {
  const code = nodeCode(doc, node) ?? ''
  if (COMPONENT_TYPE_BY_CODE[code]?.endPrep === 'FL') {
    // A flanged component's pipe is welded to its mating flange.
    const mate = matingFlange(doc, node, run)
    if (mate) return isLapJoint(mate.code) ? 'STUB END' : 'FLG'
  }
  if (isLapJoint(code)) return 'STUB END'
  if (/NIPPLE/.test(code)) return 'NIPPLE'
  if (/UNION/.test(code)) return 'UNION'
  if (/CPLG/.test(code)) return 'CPLG'
  if (/SWG|SWAGE/.test(code)) return 'SWAGE'
  switch (node.kind) {
    case 'elbow90': case 'elbow45': return /BEND/.test(code) ? 'BEND' : 'ELL'
    case 'tee': return /LAT/.test(code) ? 'LAT' : /CRS/.test(code) ? 'CROSS' : 'TEE'
    case 'reducer': return 'RED'
    case 'cap': return 'CAP'
    case 'flange': return 'FLG'
    case 'valve': return 'VALVE'
    case 'olet': return code || 'OLET'
    case 'support': return code || 'SUPPORT'
    default: return 'PIPE'
  }
}
/** The weld map: every weld with its type, size, schedule and the parts it joins. */
export const weldSchedule = (doc: IsoDocument): WeldRow[] => welds(doc).map(weld => weldRow(doc, weld))
export function weldRow(doc: IsoDocument, weld: Weld): WeldRow {
  const node = getNode(doc, weld.nodeId)
  // A branch or pad weld joins the header the outlet sits on.
  const branch = weld.type === 'BR' || weld.type === 'RP'
  const run = (branch ? doc.runs.find(r => r.id === node.associatedRunId) : undefined) ?? doc.runs.find(r => r.id === weld.runId)!
  const spec = getSpec(doc, run.specId), size = spec.sizes.find(s => s.nps === run.nps)
  const type = WELD_TYPE[weld.type]
  // A pipe-to-pipe weld, a pipe into a fitting, or two fittings welded straight together.
  const far = run.from === node.id ? run.to : run.from
  const own = node.kind === 'weld' ? 'PIPE' : partName(doc, node, run)
  const other = run.connector ? partName(doc, getNode(doc, far), run) : 'PIPE'
  const outlet = weld.type === 'BR' ? weld.nps : undefined
  return {
    weld, spool: run.spool, drawing: sheetTitle(doc, run.spool), line: run.line, type,
    size: sizeText(run.nps, outlet), schedule: scheduleText(size?.schedule ?? spec.schedule),
    joint: `${other}–${own}`
  }
}

const csvLength = (mm: number, units: Units) => Number.isFinite(mm) ? draftLength(mm, units) : ''
const csvAllowance = (mm: number, units: Units) => Number.isFinite(mm) ? allowanceText(mm, units) : ''
const csvUnit = (units: Units) => units === 'mm' ? 'mm' : 'ft-in'
/** Each sheet's bill of materials with its item numbers. */
export function materialCsv(doc: IsoDocument): string {
  const imperial = doc.units === 'imperial'
  return csv([
    ['Drawing', 'Spool', 'Item', 'Quantity', 'Unit', 'ND', 'Description', imperial ? 'Weight lb' : 'Weight kg', imperial ? 'Surface ft2' : 'Surface m2', 'Cost', 'Labor hours'],
    ...materialSchedule(doc).map(r => [
      r.drawing, r.spool, r.id, r.qtyText, r.category === 'pipe' ? csvUnit(doc.units) : 'ea', r.nd, r.description,
      r.weightKg == null ? '' : round(r.weightKg / (imperial ? 0.45359237 : 1)),
      r.areaM2 == null ? '' : round(r.areaM2 / (imperial ? 0.09290304 : 1), 3),
      round(r.cost), round(r.hours)
    ])
  ])
}
/** Pipe pieces by sheet item number. */
export function cutCsv(doc: IsoDocument): string {
  const u = ` (${csvUnit(doc.units)})`
  return csv([
    ['Drawing', 'Spool', 'Item', 'Piece', 'NPS', 'Spec', 'Line', 'Heat', 'Overall' + u, 'Start takeout' + u, 'End takeout' + u,
      'Start gap' + u, 'End gap' + u, 'Cut' + u, 'Start end', 'End end'],
    ...cutSchedule(doc).map(r => [
      r.drawing, r.spool, r.item, `${r.piece} of ${r.pieces}`, sizeText(r.run.nps), r.run.specId, r.run.line, r.run.heat,
      Number.isFinite(r.overall) ? overallText(r.overall, doc.units) : '', ...r.takeouts.map(v => csvAllowance(v, doc.units)), ...r.gaps.map(v => csvAllowance(v, doc.units)),
      r.uncut ? 'NOT CUT' : r.cut > 0 ? csvLength(r.cut, doc.units) : '', ...r.ends
    ])
  ])
}
/** The weld map, with blank WPS, NDE and welder columns for the shop. */
export function weldCsv(doc: IsoDocument): string {
  return csv([
    ['Weld', 'Drawing', 'Spool', 'Line', 'Type', 'Size', 'Schedule', 'Joint', 'Shop/field', 'WPS', 'NDE %', 'Welder'],
    ...weldSchedule(doc).map(r => [r.weld.tag, r.drawing, r.spool, r.line, r.type, r.size, r.schedule, r.joint, r.weld.field ? 'FIELD' : 'SHOP', '', '', ''])
  ])
}
