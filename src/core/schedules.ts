import { COMPONENT_TYPE_BY_CODE } from './components'
import { flangedJoints, isLapJoint, matingFlange, nodeCode, type FlangedJoint } from './joints'
import { allowanceText, draftLength, scheduleText, sizeFor, sizeHeader, UNKNOWN } from './format'
import { feetThreshold } from './profile'
import { measureMember, packageSpools, pieceEnds, sheetMaterials, type MaterialRow, type PipeEnd, type PipePiece } from './material-list'
import {
  connected, csv, distance, getNode, getSpec, round, runResult, sheetInfoOf, takeout, weldDiameterInches, weldHours, welds, withIndex, runById,
  type IsoDocument, type PipeNode, type PipeRun, type Weld
} from './model'
export { allowanceText, scheduleText, UNKNOWN } from './format'
export { packageSpools, pipeEnd, type PipeEnd } from './material-list'

/**
 * The fabrication schedules issued with the sheets. Every one is numbered as the sheets are: material and pipe items
 * by each spool's bill of materials, welds in sequence along each spool.
 */
type Units = IsoDocument['units']
type Drawing = Pick<IsoDocument, 'units' | 'profile'>
const drawing = (on: Units | Drawing): Drawing => typeof on === 'string' ? { units: on } : on
export const lengthUnits = (units: Units) => units === 'mm' ? 'millimetres' : 'feet and inches'
/** A length as lists write it: whole millimetres, or feet-inches to 1/16" (inches below the profile's list threshold). */
export const lengthText = (mm: number, on: Units | Drawing) =>
  Number.isFinite(mm) ? draftLength(mm, drawing(on).units, feetThreshold(drawing(on), 'lists')) : UNKNOWN
/** An overall as the sheet dimensions it (inches below the profile's dimension threshold, two feet by default). */
export const overallText = (mm: number, on: Units | Drawing) =>
  Number.isFinite(mm) ? draftLength(mm, drawing(on).units, feetThreshold(drawing(on), 'dimensions')) : UNKNOWN
const sheetTitle = (doc: IsoDocument, spool: string) => sheetInfoOf(doc, spool).drawingNumber

export interface MaterialScheduleRow extends MaterialRow {
  spool: string
  drawing: string
  weightKg: number | null
  areaM2: number | null
  cost: number
  hours: number
}
export interface ScheduleOptions {
  /** Use the cells held as issued instead of the calculated ones. Schedules and exports are calculated by default. */
  issued?: boolean
}
/** Each sheet's bill of materials, item for item and number for number, with weights for the schedule. */
export function materialSchedule(doc: IsoDocument, options: ScheduleOptions = {}): MaterialScheduleRow[] {
  return withIndex(doc, () => materialRows(doc, options))
}
function materialRows(doc: IsoDocument, options: ScheduleOptions): MaterialScheduleRow[] {
  const joints = flangedJoints(doc)
  return packageSpools(doc).flatMap(spool => sheetMaterials(doc, spool, { issued: !!options.issued }).map(row => {
    const parts = row.memberIds.map(member => measureMember(doc, member, row.memberQty[member] ?? 0, joints))
    const sum = (key: 'weightKg' | 'areaM2') => parts.some(p => p[key] == null) ? null : parts.reduce((s, p) => s + p[key]!, 0)
    return {
      ...row, spool, drawing: sheetTitle(doc, spool), weightKg: sum('weightKg'), areaM2: sum('areaM2'),
      cost: parts.reduce((s, p) => s + p.cost, 0), hours: parts.reduce((s, p) => s + p.hours, 0)
    }
  }))
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
  /** The piece's first pipe (the pipe itself, unless the piece runs on through formed bends). */
  run: PipeRun
  /** Every pipe of the piece, in order; more than one where it is formed through bends. */
  runIds: string[]
  /** Formed bends in the piece. */
  bends: number
  /**
   * Between the dimension points the sheet uses, with takeouts measured from the same points. A piece formed through
   * bends runs along its centreline through the bends' work points, so its cut is shorter than overall less takeouts.
   */
  overall: number
  takeouts: [number, number]
  gaps: [number, number]
  cut: number
  ends: [PipeEnd, PipeEnd]
  /** Field-fit makeup left on at each end (cut long, trimmed on site): added to the cut. */
  makeup: [number, number]
  /** Tangents of the formed bends inside the piece, measured to their work points: taken off the overall. */
  bendTangents: number
  /** Centreline arcs of those bends, with the profile's bend allowance: added to the cut. */
  bendArcs: number
  /** Listed on the sheet by length without a cut (the pipe is marked uncut). */
  uncut: boolean
}
/** cut = overall − takeouts − gaps + makeup − bend tangents + bend arcs; the terms beyond the first three, as a note. */
export function cutAdjustments(row: Pick<CutRow, 'makeup' | 'bendTangents' | 'bendArcs' | 'bends'>, units: Units): string {
  const parts: string[] = [], makeup = row.makeup[0] + row.makeup[1]
  if (makeup > 0) parts.push(`+ ${allowanceText(makeup, units)} FIELD-FIT MAKEUP`)
  if (row.bends > 0) parts.push(`- ${allowanceText(row.bendTangents, units)} BEND TANGENTS + ${allowanceText(row.bendArcs, units)} BEND ${row.bends > 1 ? 'ARCS' : 'ARC'}`)
  return parts.join(' ')
}
function cutRow(doc: IsoDocument, joints: FlangedJoint[], spool: string, row: MaterialRow, piece: PipePiece, i: number, pieces: number): CutRow {
  const run = (id: string) => runById(doc, id)!
  const runs = piece.runIds.map(run)
  const [start, finish] = piece.ends.map(e => ({ run: run(e.runId), index: e.index }))
  const station = (e: typeof start) => stationOffset(doc, getNode(doc, e.index === 0 ? e.run.from : e.run.to), e.run, joints)
  const result = (e: typeof start) => runResult(doc, e.run)
  return {
    spool, drawing: sheetTitle(doc, spool), item: row.id, piece: i + 1, pieces, run: runs[0], runIds: piece.runIds, bends: piece.bendIds.length,
    overall: runs.reduce((sum, r) => sum + runResult(doc, r).overall, 0) - station(start) - station(finish),
    takeouts: [result(start).takeouts[start.index] - station(start), result(finish).takeouts[finish.index] - station(finish)],
    gaps: [result(start).gaps[start.index], result(finish).gaps[finish.index]], cut: piece.cut,
    ends: pieceEnds(doc, piece), makeup: [result(start).makeup[start.index], result(finish).makeup[finish.index]],
    // Inside a piece formed through bends, each pipe stops at a bend's tangent point and the arc joins them.
    bendTangents: runs.reduce((sum, r) => sum + [r.from, r.to].reduce((t, id, i) => t + (piece.bendIds.includes(id) ? runResult(doc, r).takeouts[i] : 0), 0), 0),
    bendArcs: piece.cut - runs.reduce((sum, r) => sum + runResult(doc, r).cut, 0),
    uncut: !!row.pipe?.uncut
  }
}
/** Every pipe piece, numbered by its item on the sheet. */
export function cutSchedule(doc: IsoDocument): CutRow[] {
  return withIndex(doc, () => cutRows(doc))
}
function cutRows(doc: IsoDocument): CutRow[] {
  const joints = flangedJoints(doc)
  return packageSpools(doc).flatMap(spool => sheetMaterials(doc, spool, { issued: false }).filter(row => row.pipe).flatMap(row =>
    row.pipe!.pieces.map((piece, i) => cutRow(doc, joints, spool, row, piece, i, row.pipe!.pieces.length))))
}
export const pieceText = (row: Pick<CutRow, 'item' | 'piece' | 'pieces'>) => row.pieces > 1 ? `${row.item} (${row.piece} of ${row.pieces})` : String(row.item)
/** A piece's cut as the schedules print it; a cut that also takes field-fit makeup or formed bends says so. */
export const cutText = (row: Pick<CutRow, 'cut' | 'uncut'> & Partial<Pick<CutRow, 'makeup' | 'bendTangents' | 'bendArcs' | 'bends'>>, on: Units | Drawing) => {
  if (row.uncut) return 'NOT CUT'
  if (!(Number.isFinite(row.cut) && row.cut > 0)) return UNKNOWN
  const note = row.makeup && row.bends != null ? cutAdjustments({ makeup: row.makeup, bends: row.bends, bendTangents: row.bendTangents ?? 0, bendArcs: row.bendArcs ?? 0 }, drawing(on).units) : ''
  return lengthText(row.cut, on) + (note ? ` (${note})` : '')
}

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
  /** Weld size in diameter-inches, and its labour at the specification's hours per diameter-inch. */
  diameterInches: number
  hours: number
  /** Where the weld is made: in the shop, in the field, or in the field to a pipe cut long and fitted there (FFW). */
  site: WeldSite
}
export type WeldSite = 'SHOP' | 'FIELD' | 'FIELD-FIT'
/** Shop, field, or field-fit (a field weld made after trimming the makeup left on the pipe). */
export const weldSite = (weld: Pick<Weld, 'field' | 'fieldFit'>): WeldSite => weld.fieldFit ? 'FIELD-FIT' : weld.field ? 'FIELD' : 'SHOP'
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
export const weldSchedule = (doc: IsoDocument): WeldRow[] => withIndex(doc, () => welds(doc).map(weld => weldRow(doc, weld)))
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
    size: sizeFor(doc, run.nps, outlet), schedule: scheduleText(size?.schedule ?? spec.schedule),
    joint: `${other}–${own}`, diameterInches: weldDiameterInches(weld), hours: weldHours(doc, weld), site: weldSite(weld)
  }
}

const csvLength = (mm: number, doc: Drawing) => Number.isFinite(mm) ? lengthText(mm, doc) : ''
const csvAllowance = (mm: number, units: Units) => Number.isFinite(mm) ? allowanceText(mm, units) : ''
const csvUnit = (units: Units) => units === 'mm' ? 'mm' : 'ft-in'
/**
 * A length as plain decimal numbers for spreadsheets, beside its drafting text: millimetres to 0.1 mm and inches to
 * 0.001 in; blank when unknown.
 */
export const decimalLength = (mm: number): [number | '', number | ''] =>
  Number.isFinite(mm) ? [round(mm, 1), round(mm / 25.4, 3)] : ['', '']
/** Column headings of `decimalLength` values for a named length. */
const decimalHeadings = (name: string) => [`${name} mm`, `${name} in`]
/** Each sheet's bill of materials with its item numbers; calculated cells unless `issued` asks for the issued ones. */
export function materialCsv(doc: IsoDocument, options: ScheduleOptions = {}): string {
  const imperial = doc.units === 'imperial'
  return csv([
    ['Drawing', 'Spool', 'Item', 'Quantity', 'Unit', 'ND', 'Description', imperial ? 'Weight lb' : 'Weight kg', imperial ? 'Surface ft2' : 'Surface m2', 'Cost', 'Labor hours', 'Shop/field',
      ...decimalHeadings('Pipe length')],
    ...materialSchedule(doc, options).map(r => [
      r.drawing, r.spool, r.id, r.qtyText, r.category === 'pipe' ? csvUnit(doc.units) : 'ea', r.nd, r.description,
      r.weightKg == null ? '' : round(r.weightKg / (imperial ? 0.45359237 : 1)),
      r.areaM2 == null ? '' : round(r.areaM2 / (imperial ? 0.09290304 : 1), 3),
      round(r.cost), round(r.hours), r.supply === 'field' ? 'FIELD' : 'SHOP',
      ...(r.category === 'pipe' ? decimalLength(r.qty) : ['', ''])
    ])
  ])
}
/** Labour by spool: pipe handling per metre, item labour from the specification rows, and welds by diameter-inch. */
export interface LabourRow { spool: string; drawing: string; pipeHours: number; itemHours: number; weldDiameterInches: number; weldHours: number; total: number }
export function labourSummary(doc: IsoDocument): LabourRow[] {
  const material = materialSchedule(doc), weldRows = weldSchedule(doc)
  return packageSpools(doc).map(spool => {
    const rows = material.filter(r => r.spool === spool), spoolWelds = weldRows.filter(w => w.spool === spool)
    const pipeHours = rows.filter(r => r.category === 'pipe').reduce((s, r) => s + r.hours, 0)
    const itemHours = rows.filter(r => r.category !== 'pipe').reduce((s, r) => s + r.hours, 0)
    const weldDiameterInches = spoolWelds.reduce((s, w) => s + w.diameterInches, 0), hours = spoolWelds.reduce((s, w) => s + w.hours, 0)
    return { spool, drawing: sheetTitle(doc, spool), pipeHours, itemHours, weldDiameterInches, weldHours: hours, total: pipeHours + itemHours + hours }
  })
}
export function labourCsv(doc: IsoDocument): string {
  return csv([
    ['Drawing', 'Spool', 'Pipe hours', 'Item hours', 'Weld dia-in', 'Weld hours', 'Total hours'],
    ...labourSummary(doc).map(r => [r.drawing, r.spool, round(r.pipeHours), round(r.itemHours), round(r.weldDiameterInches, 3), round(r.weldHours), round(r.total)])
  ])
}
/** Pipe pieces by sheet item number. */
export function cutCsv(doc: IsoDocument): string {
  const u = ` (${csvUnit(doc.units)})`
  return csv([
    ['Drawing', 'Spool', 'Item', 'Piece', sizeHeader(doc), 'Spec', 'Line', 'Heat', 'Overall' + u, 'Start takeout' + u, 'End takeout' + u,
      'Start gap' + u, 'End gap' + u, 'Cut' + u, 'Start end', 'End end',
      ...['Overall', 'Start takeout', 'End takeout', 'Start gap', 'End gap', 'Cut'].flatMap(decimalHeadings),
      // cut = overall − takeouts − gaps + makeup − bend tangents + bend arcs
      ...['Field-fit makeup', 'Bend tangents', 'Bend arcs'].flatMap(decimalHeadings)],
    ...cutSchedule(doc).map(r => [
      r.drawing, r.spool, r.item, `${r.piece} of ${r.pieces}`, sizeFor(doc, r.run.nps), r.run.specId, r.run.line, r.run.heat,
      Number.isFinite(r.overall) ? overallText(r.overall, doc) : '', ...r.takeouts.map(v => csvAllowance(v, doc.units)), ...r.gaps.map(v => csvAllowance(v, doc.units)),
      r.uncut ? 'NOT CUT' : r.cut > 0 ? csvLength(r.cut, doc) : '', ...r.ends,
      ...[r.overall, ...r.takeouts, ...r.gaps, r.uncut || !(r.cut > 0) ? NaN : r.cut].flatMap(decimalLength),
      ...[r.makeup[0] + r.makeup[1], r.bendTangents, r.bendArcs].flatMap(decimalLength)
    ])
  ])
}
/** The weld map, with blank WPS, NDE and welder columns for the shop. */
export function weldCsv(doc: IsoDocument): string {
  return csv([
    ['Weld', 'Drawing', 'Spool', 'Line', 'Type', 'Size', 'Schedule', 'Joint', 'Shop/field', 'WPS', 'NDE %', 'Welder'],
    ...weldSchedule(doc).map(r => [r.weld.tag, r.drawing, r.spool, r.line, r.type, r.size, r.schedule, r.joint, r.site, '', '', ''])
  ])
}
