import { COMPONENT_TYPE_BY_CODE, componentDrafting, type ComponentDrafting, type SymbolFamily } from '../components'
import { nodeCode, nodeItem } from '../joints'
import { connected, type IsoDocument, type PipeNode } from '../model'
import { boreClass, draftingSizes, nodeBore, type IsoContext } from './context'

/**
 * How a node is drafted: its own symbol family, else its specification row's, else its component type's metadata,
 * else the generic symbol of its kind. Codes are only looked up in the catalogue.
 */
export function drafting(doc: IsoDocument, node: PipeNode): ComponentDrafting {
  return componentDrafting(nodeCode(doc, node), node.kind, node.symbol ?? nodeItem(doc, node)?.symbol)
}
export const symbolOf = (doc: IsoDocument, node: PipeNode): SymbolFamily => drafting(doc, node).symbol
const lettering = (doc: IsoDocument) => draftingSizes(doc).text

/** A butterfly valve is drawn as its disc between its flanges, unless the node draws it as a bow-tie body. */
export function discValve(doc: IsoDocument, node: PipeNode): boolean {
  return symbolOf(doc, node) === 'butterfly' && node.valveSymbol !== 'bowtie'
}
/** A check valve drawn as a swing check: a bow-tie with its disc's arrow. */
export const swingCheck = (doc: IsoDocument, node: PipeNode) => symbolOf(doc, node) === 'check' && node.valveSymbol === 'swing'
/** A check valve drawn as a plain triangle pointing with the flow, lying flat on plan. */
export const triangleCheck = (doc: IsoDocument, node: PipeNode) => symbolOf(doc, node) === 'check' && node.valveSymbol === 'triangle'

/** Body of a swing or triangle check, half-length and half-width in lettering heights. */
const COMPACT_CHECK = { length: 2.27, width: 1.09 }
/** A butterfly disc's half-length for each inch of its size class, in lettering heights (a bow-tie body's least). */
const DISC_PER_INCH = 1.11
/**
 * Half-length of a butterfly valve's short wafer or lug body drawn as its disc between its flanges, for each inch of
 * its size class, and the least it is drawn at, in lettering heights: about a quarter of a flanged gate valve's face
 * to face, as API 609 bodies are.
 */
const DISC_BODY_PER_INCH = 0.3, LEAST_DISC_BODY = 0.9

/** A flange's half-height across its pipe for each inch of its size class, in lettering heights. */
export const FLANGE_PER_INCH = 0.57
/** Least share of its drafting length a valve body keeps in a small size class. */
const LEAST_CLASS_SCALE = 0.8
/**
 * How a valve body is drawn in its size class: never wider across its pipe than the flanges of that class (a small
 * bore valve is not drawn as large as a big one), its length in proportion, within `LEAST_CLASS_SCALE`.
 */
function classScale(doc: IsoDocument, node: PipeNode, width: number): { length: number; width: number } {
  const flange = FLANGE_PER_INCH * nodeBore(doc, node), k = width > flange ? flange / width : 1
  return { length: Math.max(LEAST_CLASS_SCALE, k), width: k }
}
/** Half of the drawn component body along its pipe before projecting it into the pipe's plane (sheet units). */
export function valveBodyHalfLength(doc: IsoDocument, node: PipeNode, T = lettering(doc)): number {
  const d = drafting(doc, node), length = (d.body?.length ?? 2.73) * classScale(doc, node, d.body?.width ?? 1.52).length * T
  if (swingCheck(doc, node) || triangleCheck(doc, node)) return COMPACT_CHECK.length * T
  if (d.symbol !== 'butterfly') return length
  // A butterfly disc spans its bore: drawn by its size class, never shorter than a valve body when drawn as one.
  if (discValve(doc, node)) return Math.max(LEAST_DISC_BODY, nodeBore(doc, node) * DISC_BODY_PER_INCH) * T
  return Math.max(length, nodeBore(doc, node) * DISC_PER_INCH * T)
}
export type ValveOperator = NonNullable<PipeNode['valveOperator']>
/** The operator a specification row or description names: an actuator, a lever, a handwheel or gear. */
export function operatorNamed(text: string): ValveOperator | undefined {
  if (/\bACTUAT|\bMOTORI[SZ]ED\b|\bMOV\b|\bPNEUMATIC/i.test(text)) return 'actuator'
  if (/\bLEVER\b/i.test(text)) return 'lever'
  if (/HAND ?WHEEL|\bGEAR\b|\bGEAR ?(OP|BOX)/i.test(text)) return 'handwheel'
  return undefined
}
/**
 * The operator a valve is drawn with, in 2D and 3D alike: its own (`valveOperator`), else the one its specification
 * row names ("..., LEVER"), else its symbol family's (an actuated bow-tie butterfly valve its actuator).
 */
export function valveOperatorOf(doc: IsoDocument, node: PipeNode): ValveOperator {
  if (node.valveOperator) return node.valveOperator
  const d = drafting(doc, node), item = nodeItem(doc, node) as { description?: string; bomDescription?: string } | undefined
  const named = d.defaultOperator === 'none' ? undefined : operatorNamed(`${item?.bomDescription ?? ''} ${item?.description ?? ''}`)
  if (named) return named
  if (d.symbol === 'butterfly' && !discValve(doc, node)) return 'actuator'
  return d.defaultOperator ?? 'handwheel'
}
/** Half-width of the drawn body across its pipe (sheet units). */
export function valveBodyHalfWidth(doc: IsoDocument, node: PipeNode, T = lettering(doc)): number {
  const d = drafting(doc, node), width = (d.body?.width ?? 1.52) * classScale(doc, node, d.body?.width ?? 1.52).width * T
  if (swingCheck(doc, node) || triangleCheck(doc, node)) return COMPACT_CHECK.width * T
  // A larger butterfly body is drawn a little wider, so it keeps its proportions.
  return d.symbol === 'butterfly' && valveBodyHalfLength(doc, node, T) > (d.body?.length ?? 2.73) * T ? width * 1.1 : width
}
/** Most of the drawn pipe either side of it a valve and its flanges take. */
const VALVE_SHARE = 0.4
/** Least half-length (lettering heights) a valve body is drawn at, however short the pipe beside it. */
const LEAST_BODY = 1.1
const fittedBodies = new WeakMap<object, Map<string, number>>()
/**
 * A valve body's half-length as a not-to-scale sheet draws it: its drafting size, but never so long that the valve
 * and its flanges take more than `VALVE_SHARE` of the drawn pipe on either side of it, where the next fitting, its
 * dimension arrows and the pipe between need the rest. Its symbol, the pipe stopping at it and its face dimensions all use it.
 */
export function valveBodyOnSheet(ctx: Pick<IsoContext, 'doc' | 'schematic' | 'geometry' | 'direction'>, node: PipeNode, T = lettering(ctx.doc)): number {
  const nominal = valveBodyHalfLength(ctx.doc, node, T)
  if (!ctx.schematic || node.kind !== 'valve' || drafting(ctx.doc, node).symbol === 'butterfly' || swingCheck(ctx.doc, node) || triangleCheck(ctx.doc, node)) return nominal
  let known = fittedBodies.get(ctx.geometry)
  if (!known) fittedBodies.set(ctx.geometry, known = new Map())
  const key = `${node.id}:${T}`, had = known.get(key)
  if (had != null) return had
  const flanges = COMPONENT_TYPE_BY_CODE[nodeCode(ctx.doc, node) ?? '']?.endPrep === 'FL' ? flangedGeometry(ctx.doc, node, nominal, T).plate - nominal : 0
  let body = nominal
  // Parts bolted straight to it (a connector, no pipe) are drawn against it whatever its size.
  for (const r of connected(ctx.doc, node.id)) {
    const g = !r.connector && ctx.geometry.get(r.id)
    if (!g || g.length < 1e-9) continue
    const axial = Math.max(1e-6, Math.hypot(...ctx.direction(g.dir3)))
    body = Math.min(body, g.length * VALVE_SHARE / axial - flanges)
  }
  body = Math.max(Math.min(nominal, LEAST_BODY * T), body)
  known.set(key, body)
  return body
}
/** Body, gasket mating and outer plate planes of a flanged component, from its centre (sheet units). */
export function flangedGeometry(doc: IsoDocument, node: PipeNode, body = valveBodyHalfLength(doc, node), T = lettering(doc)) {
  const bore = nodeBore(doc, node)
  return { body, mate: body + bore * 0.28 * T, plate: body + bore * 0.53 * T }
}
export const discGeometry = flangedGeometry

/** Camlock body and cap profiles keep their drafting proportions in each size class (sheet units). */
export function camlockGeometry(doc: IsoDocument, node: PipeNode, T = lettering(doc)) {
  const bore = nodeBore(doc, node, 1)
  return { halfLength: (0.71 + 0.24 * bore) * T, radius: Math.max(0.61, 0.28 * bore) * T, capRadius: Math.max(2, bore) * 0.57 * T }
}

/**
 * Least and most a reducer's small end is drawn of its large end's height, concentric or eccentric: by the ratio of
 * its size classes, enough that the pipe's centreline meets it, little enough that its taper reads and the block is
 * never drawn as a parallelogram.
 */
const REDUCER_TAPER = [0.55, 0.7] as const
/** An eccentric reducer's large end against a concentric one's. */
const ECCENTRIC_HEIGHT = 0.75
/**
 * Schematic concentric or eccentric reducer block, sized by the class of its large end (sheet units). Both draw their
 * small end by the ratio of their size classes (within `REDUCER_TAPER`), so the two read in the same proportions: a
 * concentric block tapers evenly about its centreline, an eccentric one keeps its flat side straight with the large
 * end's, its small end standing a small step toward the flat side.
 */
export function reducerGeometry(doc: IsoDocument, node: PipeNode, T = lettering(doc)) {
  const bore = nodeBore(doc, node), sizes = connected(doc, node.id).map(r => r.nps).filter(n => n > 0)
  const small = sizes.length ? boreClass(Math.min(...sizes), 1) : bore, ratio = Math.min(REDUCER_TAPER[1], Math.max(REDUCER_TAPER[0], small / bore))
  const large = bore * 0.56 * T
  // Drawn lower than a concentric block, so with its straight side it stays twice as long as it is high.
  const flat = large * ECCENTRIC_HEIGHT
  return { halfLength: bore * 0.84 * T, largeRadius: large, smallRadius: large * ratio, flatLarge: flat, flatSmall: flat * ratio }
}
