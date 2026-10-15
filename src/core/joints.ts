import { COMPONENT_TYPE_BY_CODE } from './components'
import { bolting, ratingClass, standardRow } from './standards'
import {
  add, connected, fitting, getNode, getSpec, length, mul, sub,
  type CatalogItem, type EndPrep, type IsoDocument, type Kind, type PipeNode, type PipeRun, type PipeSpec, type Vec3
} from './model'

const family = (prep: EndPrep | undefined) => prep === 'SW' ? 'SW' : prep === 'THD' ? 'SC' : 'W'
/** The component a routed or inserted node is, when no specification row names one. */
export function defaultCode(kind: Kind, prep: EndPrep = 'BW', shape: 'reducing' | 'lateral' | 'cross' | 'reducing-cross' | 'reducing-lateral' | '' = ''): string | undefined {
  const f = family(prep)
  switch (kind) {
    case 'elbow90': return f === 'W' ? 'W-LR90EL' : `${f}-90ELL`
    case 'elbow45': return `${f}-45ELL`
    case 'tee': return `${f}-${({ reducing: 'RTEE', lateral: 'LAT', cross: 'CRS', 'reducing-cross': 'RCRS', 'reducing-lateral': 'RLAT', '': 'TEE' })[shape]}`
    case 'cap': return `${f}-CAP`
    case 'reducer': return prep === 'SW' ? 'R-CPLGSW' : prep === 'THD' ? 'R-CPLGSC' : 'C-RED'
    case 'flange': return prep === 'SW' ? 'FLG-RFSW' : prep === 'THD' ? 'FLG-RFSC' : 'FLG-RFWN'
    case 'valve': return prep === 'SW' ? 'GATE-SW' : prep === 'THD' ? 'GATE-SC' : 'GATE-FL'
    case 'olet': return prep === 'THD' ? 'TOL' : prep === 'SW' ? 'SOL' : 'WOL'
    case 'gasket': return 'GASK-RF'
    case 'bolt': return 'BOLT-RF'
    case 'support': return 'SHOE'
    default: return undefined
  }
}
export const isLapJoint = (code?: string) => !!code && /LJ$|^STUB-END/.test(code)
export const isBlind = (code?: string) => !!code && /BL$|SBLND/.test(code)
const flangedPort = (code?: string) => !!code && COMPONENT_TYPE_BY_CODE[code]?.endPrep === 'FL'

export const specRating = (spec: PipeSpec) =>
  ratingClass(spec.parameters?.['Welded/Flanged General Parameters.ANSI Rating']) ?? ratingClass(spec.rating) ?? 150
export const specFace = (spec: PipeSpec): 'RF' | 'FF' =>
  /^FF/i.test(spec.parameters?.['Welded/Flanged General Parameters.Flange Face'] ?? '') ? 'FF' : 'RF'
const sameBranch = (f: CatalogItem, nps: number, smallerNps?: number) =>
  smallerNps == null || smallerNps === nps ? !f.smallerNps || f.smallerNps === nps : f.smallerNps === smallerNps

/** A specification row with known dimensions, else the built-in ASME row for the same component. */
export function catalogRow(spec: PipeSpec, code: string, nps: number, smallerNps?: number): CatalogItem | undefined {
  const rows = spec.fittings.filter(f => f.component === code && f.nps === nps && sameBranch(f, nps, smallerNps))
  const row = rows.find(f => !f.takeoutMissing)
  if (row) return row
  const std = standardRow(code, nps, specRating(spec), smallerNps)
  if (!std) return rows[0]
  const named = rows[0]
  return {
    ...named,
    ...std,
    id: named?.id ?? `std:${code}:${nps}${smallerNps && smallerNps !== nps ? 'x' + smallerNps : ''}`,
    component: code,
    description: named?.description ?? std.description,
    takeoutMissing: undefined,
    source: std.source
  }
}

/** Size of the pipes a node joins: largest and (for reducing items) smallest bore. */
function nodeSizes(doc: IsoDocument, node: PipeNode): { nps: number; smallerNps?: number; spec: PipeSpec } | undefined {
  const edges = connected(doc, node.id), host = edges[0] ?? doc.runs.find(r => r.id === node.associatedRunId)
  if (!host) return undefined
  const sizes = edges.length ? edges.map(r => r.nps) : [host.nps]
  const nps = Math.max(...sizes), small = Math.min(...sizes)
  const branch = edges.find(r => r.id === node.branchEdgeId)
  return { nps, smallerNps: node.kind === 'tee' ? branch?.nps ?? small : small !== nps ? small : undefined, spec: getSpec(doc, edges.reduce((a, b) => a.nps >= b.nps ? a : b, host).specId) }
}
export function nodeCode(doc: IsoDocument, node: PipeNode): string | undefined {
  return node.component ?? fitting(doc, node)?.component
}
/** The row a node is built from: its own dimensioned specification row, else the standard for its component. */
export function nodeItem(doc: IsoDocument, node: PipeNode): CatalogItem | undefined {
  const item = fitting(doc, node)
  if (item && !item.takeoutMissing) return item
  const code = item?.component ?? node.component, sizes = code && !node.bendAngle ? nodeSizes(doc, node) : undefined
  if (!code || !sizes) return item
  return catalogRow(sizes.spec, code, item?.nps ?? sizes.nps, item?.smallerNps ?? sizes.smallerNps) ?? item
}

export interface MatingFlange { code: string; item?: CatalogItem; stub?: CatalogItem }
/** The specification's flange for a flanged connection at this size. */
export function defaultFlangeCode(spec: PipeSpec, nps: number): string {
  const face = specFace(spec), chosen = spec.parameters?.['Default Flange']
  if (chosen) return chosen
  const has = (code: string) => spec.fittings.some(f => f.nps === nps && f.component === code)
  for (const code of [`FLG-${face}WN`, `FLG-${face}LJ`]) if (has(code)) return code
  if (has('STUB-END') || has('STUB-END-SHORT')) return `FLG-${face}LJ`
  for (const code of [`FLG-${face}SO`, `FLG-${face}SW`, `FLG-${face}SC`]) if (has(code)) return code
  return `FLG-${face}WN`
}
export function stubEnd(spec: PipeSpec, nps: number): CatalogItem | undefined {
  const code = spec.fittings.some(f => f.nps === nps && f.component === 'STUB-END-SHORT') && !spec.fittings.some(f => f.nps === nps && f.component === 'STUB-END')
    ? 'STUB-END-SHORT' : 'STUB-END'
  return catalogRow(spec, code, nps)
}
/** The flange a flanged component's port bolts to, or null when the mate is not part of this pipe. */
export function matingFlange(doc: IsoDocument, node: PipeNode, run: PipeRun): MatingFlange | null {
  const chosen = node.portFlanges?.[run.id]?.component
  if (chosen === 'NONE') return null
  const other = getNode(doc, run.from === node.id ? run.to : run.from)
  if (run.connector && other.kind === 'flange') return null
  const spec = getSpec(doc, run.specId), code = chosen ?? defaultFlangeCode(spec, run.nps)
  return { code, item: catalogRow(spec, code, run.nps), stub: isLapJoint(code) ? stubEnd(spec, run.nps) : undefined }
}
export function gasketRow(spec: PipeSpec, nps: number, face: 'RF' | 'FF'): CatalogItem | undefined {
  const rows = spec.fittings.filter(f => f.kind === 'gasket' && f.nps === nps)
  return rows.find(f => f.component === `GASK-${face}`) ?? rows[0] ?? catalogRow(spec, `GASK-${face}`, nps)
}
export const gasketThickness = (row?: CatalogItem) => row ? row.thickness ?? row.takeout * 2 : 0
/** Pipe-side length of a flange: weld-neck hub, slip-on set-back or stub-end length. */
const flangeLength = (flange: MatingFlange | null) =>
  !flange ? 0 : isLapJoint(flange.code) ? (flange.stub?.takeout ?? NaN) : (flange.item?.takeout ?? NaN)
/** End preparation of the pipe at a flanged connection. */
export const flangePipePrep = (code: string): EndPrep =>
  isLapJoint(code) ? 'BW' : COMPONENT_TYPE_BY_CODE[code]?.endPrep ?? 'BW'

/** A flange between two pipes is a bolted pair; older drawings marked the second side FL with no flange. */
const isPair = (node: PipeNode, pipes: PipeRun[]) =>
  pipes.length === 2 && pipes.every(r => (r.from === node.id ? r.fromPrep : r.toPrep) !== 'FL')
/** A flange joined directly to a flanged component (an imported assembly) is that component's mate. */
const matesComponent = (doc: IsoDocument, node: PipeNode) => connected(doc, node.id).some(r => {
  if (!r.connector) return false
  return flangedPort(nodeCode(doc, getNode(doc, r.from === node.id ? r.to : r.from)))
})
/** Length a flanged connection adds beyond a component's own face: gasket and the mating flange. */
export function flangedAllowance(doc: IsoDocument, node: PipeNode, run: PipeRun): number {
  const code = nodeCode(doc, node)
  if (node.kind === 'flange' && !flangedPort(code)) {
    if (run.connector) return 0
    const pipes = connected(doc, node.id).filter(r => !r.connector), spec = getSpec(doc, run.specId)
    const half = isPair(node, pipes) ? gasketThickness(gasketRow(spec, run.nps, faceOf(code, spec))) / 2 : 0
    // A lap-joint flange is loose; the stub end welded to the pipe carries the length.
    return (isLapJoint(code) && !/^STUB-END/.test(code!) ? stubEnd(spec, run.nps)?.takeout ?? NaN : 0) + half
  }
  if (!flangedPort(code)) return 0
  const mate = matingFlange(doc, node, run)
  if (!mate) return 0
  const spec = getSpec(doc, run.specId)
  return gasketThickness(gasketRow(spec, run.nps, faceOf(mate.code, spec))) + flangeLength(mate)
}
const faceOf = (code: string | undefined, spec: PipeSpec): 'RF' | 'FF' => /FF/.test(code ?? '') ? 'FF' : /RF/.test(code ?? '') ? 'RF' : specFace(spec)

/** End preparation that governs welding and root gap at a pipe end, resolving flanged ports to their mate. */
export function pipeEndPrep(doc: IsoDocument, run: PipeRun, index: number, prep: EndPrep): EndPrep {
  if (prep !== 'FL') return prep
  const node = getNode(doc, index === 0 ? run.from : run.to), code = nodeCode(doc, node)
  if (!flangedPort(code)) return prep
  const mate = matingFlange(doc, node, run)
  return mate ? flangePipePrep(mate.code) : prep
}

export interface JointBolts { kind: 'stud' | 'lug'; count: number; diameter: number; length: number; item?: CatalogItem }
export interface FlangedJoint {
  id: string
  nodeId: string
  runIds: string[]
  /** Gasket centre in model millimetres. */
  position: Vec3
  nps: number
  rating: number
  face: 'RF' | 'FF'
  kind: 'equipment' | 'flange-pair' | 'component-port'
  /** Flanges at this joint; implicit ones are supplied with a flanged component and are not separate nodes. */
  flanges: Array<{ code: string; item?: CatalogItem; implicit: boolean }>
  stubEnds: CatalogItem[]
  gasket: { item?: CatalogItem; thickness: number } | null
  bolts: JointBolts | null
  /** Bolting is required but neither the specification nor the standard sizes it. */
  boltsUnknown: boolean
  spool: string
  line: string
  specId: string
}
function jointBolts(spec: PipeSpec, nps: number, face: 'RF' | 'FF', makeup: 'flange-pair' | 'lj-pair' | 'lug-valve-side' | 'wafer-valve'): JointBolts | null {
  const row = spec.fittings.find(f => f.kind === 'bolt' && f.nps === nps) ?? catalogRow(spec, 'BOLT-RF', nps)
  const std = bolting(nps, specRating(spec), face, makeup)
  // A specification's stud row describes flange pairs; lug and through-bolts for valves come from the standard.
  const own = makeup === 'flange-pair' || makeup === 'lj-pair'
  const count = (own ? row?.boltCount : undefined) ?? std?.count, diameter = (own ? row?.boltDiameter : undefined) ?? std?.diameter,
    len = (own ? row?.boltLength : undefined) ?? std?.length
  if (!count || !diameter || !len) return null
  return { kind: makeup === 'lug-valve-side' ? 'lug' : 'stud', count, diameter, length: len, item: row }
}

/** Every flanged joint, with the flanges, stub ends, gasket and bolting it needs. */
export function flangedJoints(doc: IsoDocument, spool = ''): FlangedJoint[] {
  const out: FlangedJoint[] = []
  for (const node of doc.nodes) {
    const edges = connected(doc, node.id), code = nodeCode(doc, node)
    if (!edges.length || (spool && !edges.some(r => r.spool === spool))) continue
    const host = edges.reduce((a, b) => a.nps >= b.nps ? a : b), spec = getSpec(doc, host.specId)
    const base = { nps: host.nps, rating: specRating(spec), spool: host.spool, line: host.line, specId: spec.id }
    if (node.kind === 'flange' && !flangedPort(code) && code && !/^ORFC|^ORIFICE/.test(code)) {
      if (matesComponent(doc, node)) continue
      const face = faceOf(code, spec), lj = isLapJoint(code)
      const item = nodeItem(doc, node), stub = lj && !/^STUB-END/.test(code) ? stubEnd(spec, host.nps) : undefined
      const pair = isPair(node, edges.filter(r => !r.connector))
      const supply = pair ? { gasket: true, bolts: true } : node.jointSupply ?? { gasket: true, bolts: true }
      // A stub-end node is the welded part; its loose lap-joint flange is supplied with the joint.
      const stubNode = /^STUB-END/.test(code)
      const flange = stubNode
        ? { code: `FLG-${face}LJ`, item: catalogRow(spec, `FLG-${face}LJ`, host.nps), implicit: true }
        : { code, item, implicit: false }
      const gasket = gasketRow(spec, host.nps, face)
      const bolts = supply.bolts ? jointBolts(spec, host.nps, face, lj ? 'lj-pair' : 'flange-pair') : null
      out.push({
        ...base, id: node.id, nodeId: node.id, runIds: edges.map(r => r.id), position: node.position, face,
        kind: pair ? 'flange-pair' : 'equipment',
        flanges: pair ? [flange, flange] : [flange],
        stubEnds: stub ? (pair ? [stub, stub] : [stub]) : [],
        gasket: supply.gasket ? { item: gasket, thickness: gasketThickness(gasket) } : null,
        bolts, boltsUnknown: supply.bolts && !bolts
      })
      continue
    }
    if (!flangedPort(code)) continue
    const wafer = code === 'BFLY-WAFER', lug = /^BFLY(-LUG)?$/.test(code!)
    const item = nodeItem(doc, node)
    for (const [index, run] of edges.entries()) {
      const mate = matingFlange(doc, node, run), runSpec = getSpec(doc, run.specId)
      const choice = node.portFlanges?.[run.id], face = faceOf(mate?.code ?? code, runSpec)
      const far = getNode(doc, run.from === node.id ? run.to : run.from).position
      const toward = sub(far, node.position), span = length(toward) || 1
      const faceDistance = (node.branchEdgeId === run.id ? item?.branchTakeout : item?.takeout) ?? 0
      const gasket = gasketRow(runSpec, run.nps, face)
      const makeup = lug ? 'lug-valve-side' : wafer ? 'wafer-valve' : mate && isLapJoint(mate.code) ? 'lj-pair' : 'flange-pair'
      const wanted = choice?.bolts !== false && !(wafer && index > 0)
      const bolts = wanted ? jointBolts(runSpec, run.nps, face, makeup) : null
      const other = getNode(doc, run.from === node.id ? run.to : run.from), explicit = run.connector && other.kind === 'flange'
      out.push({
        ...base, nps: run.nps, spool: run.spool, line: run.line, specId: runSpec.id, rating: specRating(runSpec),
        id: `${node.id}:${run.id}`, nodeId: node.id, runIds: [run.id], face, kind: 'component-port',
        position: add(node.position, mul(toward, Math.min(faceDistance, span) / span)),
        flanges: mate ? [{ code: mate.code, item: mate.item, implicit: true }]
          : explicit ? [{ code: nodeCode(doc, other) ?? 'FLANGE', item: nodeItem(doc, other), implicit: false }] : [],
        stubEnds: mate?.stub ? [mate.stub] : [],
        gasket: choice?.gasket === false ? null : { item: gasket, thickness: gasketThickness(gasket) },
        bolts, boltsUnknown: wanted && !bolts
      })
    }
  }
  return out
}
