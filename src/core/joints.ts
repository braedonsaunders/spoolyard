import { COMPONENT_TYPE_BY_CODE } from './components'
import { bolting, ratingClass, standardRow, stubEnd as standardStub } from './standards'
import { compose, draftLength, schedule, sizeText } from './format'
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

const NIPPLE_LENGTH = 'Screwed/Socket Weld General Parameters.Pipe Nipple Length'
/** A nipple's catalogued length (mm): the specification's nipple row, else its Pipe Nipple Length (in). */
export function nippleLength(spec: PipeSpec, nps: number): number | undefined {
  const own = spec.nipples?.find(n => n.nps === nps)?.length
  if (own && own > 0) return own
  const inches = Number(spec.parameters?.[NIPPLE_LENGTH])
  return inches > 0 ? inches * 25.4 : undefined
}
/** Nipple end finish from the end preparations: threaded both ends, plain one end, plain or bevelled both ends. */
export function nippleEnds(a: EndPrep, b: EndPrep): string {
  const threaded = [a, b].filter(p => p === 'THD').length, bevelled = [a, b].filter(p => p === 'BW').length
  return threaded === 2 ? 'TBE' : threaded ? 'POE' : bevelled === 2 ? 'BBE' : bevelled ? 'BOE' : 'PBE'
}
/**
 * BOM text of a nipple: size by length (catalogued in inches, as its size is), schedule, material and ends, e.g.
 * NIPPLE, 3/4" X 3" LG, XS, A106 GR. B, TBE.
 */
export function nippleText(spec: PipeSpec, nps: number, length: number, ends: string): string {
  const own = spec.nipples?.find(n => n.nps === nps), size = spec.sizes.find(s => s.nps === nps)
  if (own?.bomDescription) return own.bomDescription.toUpperCase()
  return compose(own?.description ?? 'NIPPLE', `${sizeText(nps)} X ${draftLength(length, 'imperial', Infinity)} LG`, schedule(own?.schedule ?? size?.schedule ?? spec.schedule),
    own?.material ?? size?.material ?? spec.material, ends)
}
/** A nipple placed as an in-line component (older drawings) takes half its catalogued length each side. */
function nippleRow(spec: PipeSpec, nps: number, named?: CatalogItem): CatalogItem | undefined {
  const length = nippleLength(spec, nps)
  if (!length) return named
  return {
    ...named, id: named?.id ?? `std:NIPPLE:${nps}`, kind: 'valve', nps, component: 'NIPPLE', takeout: length / 2, faceToFace: length,
    description: named?.description ?? nippleText(spec, nps, length, 'TBE'), takeoutMissing: undefined,
    source: "Specification nipple length; takeout = half the nipple, whose ends carry the thread engagement"
  }
}

/** A specification row with known dimensions, else the built-in ASME row for the same component. */
export function catalogRow(spec: PipeSpec, code: string, nps: number, smallerNps?: number): CatalogItem | undefined {
  const rows = spec.fittings.filter(f => f.component === code && f.nps === nps && sameBranch(f, nps, smallerNps))
  const row = rows.find(f => !f.takeoutMissing)
  if (row) return row
  if (code === 'NIPPLE') return nippleRow(spec, nps, rows[0])
  const pipe = spec.sizes.find(s => s.nps === nps), std = standardRow(code, nps, specRating(spec), smallerNps, pipe?.schedule ?? spec.schedule)
  if (!std) return rows[0]
  const named = rows[0], wrought = /^(W-|STUB-END|[CE]-RED$|REDELL$|LR180R$|SR180R$)/.test(code)
  return {
    ...named,
    ...std,
    id: named?.id ?? `std:${code}:${nps}${smallerNps && smallerNps !== nps ? 'x' + smallerNps : ''}`,
    component: code,
    description: named?.description ?? std.description,
    // A standard part is bought in the specification's material, and a butt-weld fitting in its pipe's wall.
    material: named?.material ?? specMaterial(spec, std.kind, wrought, nps),
    schedule: named?.schedule ?? (wrought ? pipe?.schedule ?? spec.schedule : undefined),
    takeoutMissing: undefined,
    source: std.source
  }
}
/** The material the specification names for parts of a kind: butt-weld fittings, flanges, valves, gaskets or bolts. */
function specMaterial(spec: PipeSpec, kind: Kind, wrought: boolean, nps: number): string | undefined {
  const like = (f: CatalogItem) => !!f.material && (wrought ? /^W-|[CE]-RED$/.test(f.component ?? '') : f.kind === kind && !/^STUB-END/.test(f.component ?? ''))
  return (spec.fittings.find(f => like(f) && f.nps === nps) ?? spec.fittings.find(like))?.material
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
  if (run.connector && (other.kind === 'flange' || flangedPort(nodeCode(doc, other)))) return null
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

/** The node across a run from `node`. */
const across = (doc: IsoDocument, node: PipeNode, run: PipeRun) => getNode(doc, run.from === node.id ? run.to : run.from)
/** Two flanged components (a check valve and a gate valve) bolted face to face: one gasket, one bolt set, no pipe. */
export const boltedDirect = (doc: IsoDocument, node: PipeNode, run: PipeRun) =>
  !!run.connector && flangedPort(nodeCode(doc, node)) && flangedPort(nodeCode(doc, across(doc, node, run)))
/** A flange joined directly to a flanged component (an imported assembly) is that component's mate. */
const matesComponent = (doc: IsoDocument, node: PipeNode) => connected(doc, node.id).some(r =>
  r.connector && flangedPort(nodeCode(doc, across(doc, node, r))))
/** A stub-end node welded straight to its lap-joint flange node belongs to that flange's joint. */
const stubOfFlange = (doc: IsoDocument, node: PipeNode) => /^STUB-END/.test(nodeCode(doc, node) ?? '') &&
  connected(doc, node.id).some(r => r.connector && across(doc, node, r).kind === 'flange' && !/^STUB-END/.test(nodeCode(doc, across(doc, node, r)) ?? ''))
/**
 * A flange between two pieces, pipe or a fitting welded straight to it, is a bolted pair: two flanges, one gasket, one
 * set of bolts. Older drawings marked the second side FL with no flange.
 */
export function isFlangePair(doc: IsoDocument, node: PipeNode): boolean {
  const code = nodeCode(doc, node)
  if (node.kind !== 'flange' || flangedPort(code)) return false
  const edges = connected(doc, node.id)
  // A stub end welded between fittings is one part; only a stub-end node between two pipes stands for a pair.
  if (/^STUB-END/.test(code ?? '') && edges.some(r => r.connector)) return false
  const sides = pairSides(doc, node)
  return sides.length === 2 && sides.every(r => (r.from === node.id ? r.fromPrep : r.toPrep) !== 'FL') && !matesComponent(doc, node)
}
/**
 * A flange pair's sides are the pieces the joint bolts together: not a continuation point drawn beyond it, and not the
 * other flange of the same joint drawn as its own node.
 */
function pairSides(doc: IsoDocument, node: PipeNode): PipeRun[] {
  return connected(doc, node.id).filter(r => {
    if (!r.connector) return true
    const other = across(doc, node, r)
    return other.kind !== 'end' && !(other.kind === 'flange' && !/^STUB-END/.test(nodeCode(doc, other) ?? ''))
  })
}
/** A node whose pipes belong to more than one spool: a joint or component at a spool break. */
export const spansSpools = (doc: IsoDocument, node: PipeNode) => new Set(connected(doc, node.id).map(r => r.spool)).size > 1
/** The spool whose sheet lists a break's gasket, bolting and spanning component: as chosen, else its first pipe's. */
export const breakOwner = (doc: IsoDocument, node: PipeNode) => node.jointSupply?.spool ?? connected(doc, node.id)[0]?.spool ?? ''
/** Flanges of a pair on one spool's sheet: both, or at a spool break only the one on that sheet's pipe. */
export const pairFlangesOn = (doc: IsoDocument, node: PipeNode, spool: string) =>
  !spool || !spansSpools(doc, node) ? 2 : pairSides(doc, node).filter(r => r.spool === spool).length
/** Length a flanged connection adds beyond a component's own face: gasket and the mating flange. */
export function flangedAllowance(doc: IsoDocument, node: PipeNode, run: PipeRun): number {
  const code = nodeCode(doc, node)
  if (node.kind === 'flange' && !flangedPort(code)) {
    if (run.connector) return 0
    const spec = getSpec(doc, run.specId), gasket = gasketThickness(gasketRow(spec, run.nps, faceOf(code, spec)))
    // A pair splits its gasket. A flange at a pipe end is measured to its own face, unless the drawing measures to
    // the face it bolts to (a nozzle, the next drawing's flange), with the gasket it brings inside the dimension.
    const own = node.jointSupply
    const gap = isFlangePair(doc, node) ? gasket / 2 : own?.measuredTo === 'mate' && own.gasket !== false ? gasket : 0
    // A lap-joint flange is loose; the stub end welded to the pipe carries the length.
    return (isLapJoint(code) && !/^STUB-END/.test(code!) ? stubEnd(spec, run.nps)?.takeout ?? NaN : 0) + gap
  }
  if (!flangedPort(code)) return 0
  const mate = matingFlange(doc, node, run), spec = getSpec(doc, run.specId)
  // Bolted straight to another flanged component, each takes half the gasket between them.
  if (!mate) return boltedDirect(doc, node, run) ? gasketThickness(gasketRow(spec, run.nps, faceOf(code, spec))) / 2 : 0
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
  /** The joint's gasket and bolting; `supplied` says whether this drawing's material list provides them. */
  gasket: { item?: CatalogItem; thickness: number } | null
  bolts: JointBolts | null
  /** What this drawing's material list provides; the rest is on another drawing or by others. */
  supplied: { flange: boolean; gasket: boolean; bolts: boolean }
  /** The spool whose sheet lists the gasket and bolting (at a spool break, the break's owner). */
  supplySpool: string
  /** The explicit flange node a callout names, when the flange is drawn as its own node. */
  flangeNodeId?: string
  /** The pipes whose stub ends this joint supplies, one tag each. */
  stubRunIds: string[]
  /** Bolting is required but neither the specification nor the standard sizes it. */
  boltsUnknown: boolean
  spool: string
  line: string
  specId: string
}
function jointBolts(spec: PipeSpec, nps: number, face: 'RF' | 'FF', makeup: 'flange-pair' | 'lj-pair' | 'lug-valve-side' | 'wafer-valve'): JointBolts | null {
  const row = spec.fittings.find(f => f.kind === 'bolt' && f.nps === nps) ?? catalogRow(spec, 'BOLT-RF', nps)
  // Lap-joint studs pass through both stub-end laps and the gasket as specified.
  const stub = stubEnd(spec, nps), short = stub?.component === 'STUB-END-SHORT'
  const lap = stub?.thickness ?? standardStub(nps, short, spec.sizes.find(s => s.nps === nps)?.schedule ?? spec.schedule)?.lapThickness
  const std = bolting(nps, specRating(spec), face, makeup, makeup === 'lj-pair' ? { lap, gasket: gasketThickness(gasketRow(spec, nps, face)) } : {})
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
    // A joint at a spool break lists its gasket and bolting once, on the sheet that owns the break.
    const owner = spansSpools(doc, node) ? breakOwner(doc, node) : host.spool, owned = !spool || owner === spool
    const here = (r: PipeRun) => !spool || r.spool === spool
    const base = { nps: host.nps, rating: specRating(spec), spool: host.spool, supplySpool: owner, line: host.line, specId: spec.id }
    if (node.kind === 'flange' && !flangedPort(code) && code && !/^ORFC|^ORIFICE/.test(code)) {
      if (matesComponent(doc, node) || stubOfFlange(doc, node)) continue
      const face = faceOf(code, spec), lj = isLapJoint(code)
      const item = nodeItem(doc, node), stub = lj && !/^STUB-END/.test(code) ? stubEnd(spec, host.nps) : undefined
      const pair = isFlangePair(doc, node)
      const own = node.jointSupply
      const supply = pair ? { flange: true, gasket: owned, bolts: owned } : { flange: own?.flange !== false, gasket: own?.gasket !== false, bolts: own?.bolts !== false }
      // A stub-end node is the welded part; its loose lap-joint flange is supplied with the joint.
      const stubNode = /^STUB-END/.test(code)
      const flange = stubNode
        ? { code: `FLG-${face}LJ`, item: catalogRow(spec, `FLG-${face}LJ`, host.nps), implicit: true }
        : { code, item, implicit: false }
      // Each side gets a stub end unless one is drawn there as its own node.
      const stubRuns = stub ? edges.filter(r => {
        if (!r.connector) return true
        const other = across(doc, node, r)
        return other.kind !== 'end' && other.kind !== 'flange'
      }).slice(0, pair ? 2 : 1).filter(here) : []
      // A pair split by a spool break: each sheet has the flange on its own pipe.
      const sides = pair ? (spool ? pairSides(doc, node).filter(here).length : 2) : 1
      const gasket = gasketRow(spec, host.nps, face)
      const lug = !pair && own?.mate === 'lug'
      const bolts = jointBolts(spec, host.nps, face, lug ? 'lug-valve-side' : lj ? 'lj-pair' : 'flange-pair')
      out.push({
        ...base, id: node.id, nodeId: node.id, runIds: edges.map(r => r.id), position: node.position, face,
        kind: pair ? 'flange-pair' : 'equipment',
        flanges: pair ? Array(sides).fill(flange) : supply.flange ? [flange] : [],
        stubEnds: stubRuns.map(() => stub!), stubRunIds: stubRuns.map(r => r.id),
        gasket: { item: gasket, thickness: gasketThickness(gasket) },
        bolts, supplied: supply, boltsUnknown: supply.bolts && !bolts,
        ...(stubNode ? {} : { flangeNodeId: node.id })
      })
      continue
    }
    if (!flangedPort(code)) continue
    const wafer = code === 'BFLY-WAFER', lug = /^BFLY(-LUG)?$/.test(code!)
    const item = nodeItem(doc, node)
    for (const [index, run] of edges.entries()) {
      // A port on another sheet's pipe is listed here only for the gasket and bolting this sheet owns.
      const mine = here(run)
      if (!mine && !owned) continue
      const mate = matingFlange(doc, node, run), runSpec = getSpec(doc, run.specId)
      const choice = node.portFlanges?.[run.id], face = faceOf(mate?.code ?? code, runSpec)
      const far = getNode(doc, run.from === node.id ? run.to : run.from).position
      const toward = sub(far, node.position), span = length(toward) || 1
      const faceDistance = (node.branchEdgeId === run.id ? item?.branchTakeout : item?.takeout) ?? 0
      const gasket = gasketRow(runSpec, run.nps, face)
      const other = getNode(doc, run.from === node.id ? run.to : run.from), explicit = run.connector && other.kind === 'flange'
      // Two components bolted face to face share one joint; its gasket and bolts are listed with the first of them.
      const direct = boltedDirect(doc, node, run), second = direct && doc.nodes.indexOf(other) < doc.nodes.indexOf(node)
      const lugged = lug || (direct && /^BFLY(-LUG)?$/.test(nodeCode(doc, other) ?? ''))
      const makeup = lugged ? 'lug-valve-side' : wafer ? 'wafer-valve' : mate && isLapJoint(mate.code) ? 'lj-pair' : 'flange-pair'
      // A wafer valve's through-studs belong to its first joint.
      const physical = !(wafer && index > 0) && !second
      const bolts = physical ? jointBolts(runSpec, run.nps, face, makeup) : null
      out.push({
        ...base, nps: run.nps, spool: run.spool, line: run.line, specId: runSpec.id, rating: specRating(runSpec),
        id: `${node.id}:${run.id}`, nodeId: node.id, runIds: [run.id], face, kind: 'component-port',
        position: add(node.position, mul(toward, Math.min(faceDistance, span) / span)),
        flanges: !mine ? [] : mate ? [{ code: mate.code, item: mate.item, implicit: true }]
          : explicit ? [{ code: nodeCode(doc, other) ?? 'FLANGE', item: nodeItem(doc, other), implicit: false }] : [],
        stubEnds: mine && mate?.stub ? [mate.stub] : [], stubRunIds: mine && mate?.stub ? [run.id] : [],
        gasket: { item: gasket, thickness: gasketThickness(gasket) },
        bolts, supplied: { flange: mine && (!!mate || !!explicit), gasket: owned && choice?.gasket !== false && !second, bolts: owned && choice?.bolts !== false && physical },
        boltsUnknown: owned && choice?.bolts !== false && physical && !bolts,
        ...(explicit ? { flangeNodeId: other.id } : {})
      })
    }
  }
  return out
}
