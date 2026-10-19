import { componentDrafting } from './components'
import { continuationPoint, nodeCode, nodeItem, type FlangedJoint } from './joints'
import { connected, distance, getNode, length, portPoint, styleOf, sub, takeout, type DimensionAnchor, type IsoDocument, type PipeNode, type PipeRun, type Vec3 } from './model'

/**
 * Measuring stations: the points along a straight a sheet dimensions to, and so the points the cut schedule measures
 * each pipe piece's overall and takeouts from. Both read them here, so a piece's overall in the cut schedule is the
 * sheet's dimension between the same two points and the two can never disagree.
 *
 * A straight (a "leg") is pipe and in-line parts joined end to end in one direction on one drawing (`continuingRun`).
 * Its stations are general drafting rules, each with its reason:
 *
 * - Elbows, bends and tees: their work point, where the centrelines meet. Fittings are set out by their work points.
 * - Open ends, plain welds, olets on a header and anything else: the node itself.
 * - A flanged component (valve, instrument) inside a straight, by `style.gasketSpan`:
 *   'component' (default): its mating flange faces, across its gaskets. The pipe spans either side then measure exactly
 *   the fabricated spool (pipe and its flange), and the gaskets go with the item bolted in between: the component's
 *   span is its face-to-face plus both gaskets, the length the gap between the spools must be.
 *   'pipe': the component's own body faces. The component's span is its catalogue face-to-face, and each gasket falls
 *   in the pipe span beside it.
 *   A drawing that ends at the component's own face leaves that gasket to the next drawing (the far node is closer
 *   than the gasket, so the face is not moved past it).
 * - A flange pair welded straight onto a fitting (no pipe between), by `style.fittingGasketSpan`, so the gasket goes
 *   whole into one span rather than half into each of two rounded chain dimensions:
 *   'pipe' (default): the face on the fitting's side. The fitting and its flange are one fixed make-up, dimensioned
 *   whole from the fitting's work point, and the gasket is in the pipe span on the other side.
 *   'fitting': the face on the pipe's side. The pipe span is then exactly the pipe and its flange, and the gasket is
 *   in the fitting's make-up, as some issued drawings dimension it.
 *   `gasketSpan` does not change it: there is no bolted-in component here for the gasket to go with.
 * - A flange pair between two pipes: the gasket centre (the pair's node), half the gasket in each pipe span.
 * - A reducer: both its ends, each its takeout from the reducer's centre, since a reducer's length is its own fixed
 *   dimension. Where it is welded straight onto the elbow or tee it reduces from, its large end is not a station:
 *   that make-up is dimensioned from the fitting's work point to the reducer's far end, as the fitting and reducer
 *   are set out together.
 * - Nipples, couplings, unions, quick couplings and regulators (`dimensionThrough`), gaskets drawn as their own nodes,
 *   and a branch work point given to the other chain (`dimensionChain`): no station; dimensions run through them.
 * - A part screwed into an olet at the end of a branch straight: the header's centreline at the olet, where branch
 *   connections are located from; the part's own station follows it.
 * - The second chain to component body faces (`style.componentFaces`): body faces instead of mating faces, and at an
 *   equipment flange that ends the straight, the face of the gasket this drawing supplies.
 *
 * Stations of one straight closer than its thickest gasket (plus `STATION_MERGE`) are then one point on the sheet:
 * two flange faces of one bolted joint. That merge keeps the station on the pipe, so it does not move a pipe's own
 * measuring point.
 *
 * A sheet whose dimensions are drafted (`SheetInfo.dimensions`, an issued drawing reproduced) measures to the points
 * its drafter chose (`anchorPoint`); along a pipe drafted to, the cut schedule measures from those points instead.
 */

/** Stations closer than this (mm) are one point: below the drafting resolution of either unit system. */
export const STATION_MERGE = 0.5

/** Where a pipe turns or branches: elbows, bends and tees are located at their work points. */
export const workPoint = (node: PipeNode) => /^(elbow|tee)/.test(node.kind)

/** Which gasket span a flanged component's gaskets go in (see the module comment). */
export type GasketSpan = 'component' | 'pipe'
export const gasketSpanOf = (doc: IsoDocument): GasketSpan => styleOf(doc).gasketSpan ?? 'component'
/** Which span the gasket of a flange pair welded onto a fitting goes in (see the module comment). */
export const fittingGasketSpanOf = (doc: IsoDocument): 'pipe' | 'fitting' => styleOf(doc).fittingGasketSpan ?? 'pipe'

const unit = (v: Vec3): Vec3 => { const l = length(v) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
const toward = (p: Vec3, dir: Vec3, d: number): Vec3 => [p[0] + dir[0] * d, p[1] + dir[1] * d, p[2] + dir[2] * d]
const farNode = (doc: IsoDocument, node: PipeNode, run: PipeRun) => getNode(doc, run.from === node.id ? run.to : run.from)

/** A pipe's model direction from its `from` end, between its centreline points at each end. */
export function runAxis(doc: IsoDocument, run: PipeRun): Vec3 {
  const a = getNode(doc, run.from), b = getNode(doc, run.to)
  return unit(sub(portPoint(doc, b, run.id), portPoint(doc, a, run.id)))
}
/**
 * The pipe a straight continues on through a node from `from`: one parallel to it, on the same drawing (`onDrawing`).
 * Elbows and open ends end a straight. Directions run between the pipes' centreline points, so the small end of an
 * eccentric reducer, offset across the axis toward its flat, still continues it.
 */
export function continuingRun(doc: IsoDocument, node: PipeNode, from: PipeRun, onDrawing: (run: PipeRun) => boolean): PipeRun | undefined {
  if (node.kind === 'end' || node.kind.startsWith('elbow')) return undefined
  const a = runAxis(doc, from)
  return connected(doc, node.id).filter(r => r.id !== from.id && onDrawing(r)).find(r => {
    const b = runAxis(doc, r)
    return Math.abs(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) - 1) < 1e-4
  })
}

/** The olet a part attached off the pipe's centreline stands on (a nipple screwed into it). */
export function oletUnder(doc: IsoDocument, node: PipeNode, nodes: readonly PipeNode[] = doc.nodes): PipeNode | undefined {
  const host = node.kind !== 'olet' && doc.runs.find(r => r.id === node.associatedRunId)
  if (!host) return undefined
  const dir = unit(sub(getNode(doc, host.to).position, getNode(doc, host.from).position))
  const along = (p: Vec3) => p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]
  return nodes.find(o => o.kind === 'olet' && o.associatedRunId === host.id && Math.abs(along(o.position) - along(node.position)) < 1 &&
    distance(o.position, node.position) > 1)
}

/** One measuring station at a node: its model point, and what it is (the sheet draws each kind at its own place). */
export type Station =
  /** The node itself: a work point, an open end, a weld. */
  | { kind: 'node'; point: Vec3 }
  /** The header centreline at the olet a branch part is screwed into. */
  | { kind: 'olet'; point: Vec3; olet: PipeNode }
  /**
   * A flange pair welded onto a fitting (`connector`, the pipe to it): its face on the fitting's side (`side` 1) or,
   * by `fittingGasketSpan` 'fitting', on the pipe's side (-1).
   */
  | { kind: 'pair-face'; point: Vec3; connector: PipeRun; side: 1 | -1 }
  /** A flanged component's mating flange face (across its gasket) or its own body face, on one pipe (`run`). */
  | { kind: 'port-face'; point: Vec3; run: PipeRun; joint: FlangedJoint; face: 'mate' | 'body' }
  /** A reducer's end on one pipe (`run`). */
  | { kind: 'reducer-end'; point: Vec3; run: PipeRun }
  /** An equipment flange ending the straight, in the body-face chain; `gasket` is the gasket thickness it includes. */
  | { kind: 'equipment-face'; point: Vec3; gasket: number }

export interface StationOptions {
  /** The node is the first or last of its straight. */
  end: boolean
  /** The pipes of the straight (at a node, the one or two it runs on). */
  inLeg: (run: PipeRun) => boolean
  /** Flanged joints of the drawing (`flangedJoints`). */
  joints: readonly FlangedJoint[]
  /** The second chain, to component body faces (`style.componentFaces`). Default the mating-face chain. */
  bodyFaces?: boolean
  /** The pipes the straight was found among (the sheet's), when not every pipe of the document. */
  onDrawing?: (run: PipeRun) => boolean
  /** Nodes the olet of a branch part is looked for among. */
  nodes?: readonly PipeNode[]
}

/**
 * The measuring stations a straight has at one of its nodes, by the rules in the module comment; none where the
 * dimensions run through the node.
 */
export function nodeStations(doc: IsoDocument, node: PipeNode, o: StationOptions): Station[] {
  const out: Station[] = [], id = node.id
  let end = o.end
  if (!end && (o.bodyFaces ? node.dimensionChain === 'mate' : node.dimensionChain === 'body')) return out
  if (!end && node.kind === 'gasket') return out
  const onDrawing = o.onDrawing ?? (() => true)
  const pair = o.joints.find(j => j.nodeId === id && j.kind === 'flange-pair')
  const connector = pair && connected(doc, id).find(r => r.connector && o.inLeg(r) && farNode(doc, node, r).kind !== 'flange')
  if (pair && connector) {
    const out3 = unit(sub(farNode(doc, node, connector).position, node.position)), side = fittingGasketSpanOf(doc) === 'fitting' ? -1 : 1
    return [{ kind: 'pair-face', point: toward(node.position, out3, side * (pair.gasket?.thickness ?? 0) / 2), connector, side }]
  }
  const olet = end ? oletUnder(doc, node, o.nodes) : undefined
  if (olet) { out.push({ kind: 'olet', point: olet.position, olet }); end = false }
  if (!end && componentDrafting(nodeCode(doc, node), node.kind, node.symbol ?? nodeItem(doc, node)?.symbol).dimensionThrough) return out
  const ports = o.joints.filter(j => { const run = j.nodeId === id && j.kind === 'component-port' ? getRun(doc, j.runIds[0]) : undefined; return !!run && o.inLeg(run) })
  if (!end && ports.length) {
    const toPipe = !o.bodyFaces && gasketSpanOf(doc) === 'component'
    for (const joint of ports) {
      const run = getRun(doc, joint.runIds[0])
      if (!run || !onDrawing(run)) continue
      const far = farNode(doc, node, run).position
      const gap = toPipe ? Math.min(joint.gasket?.thickness ?? 0, distance(joint.position, far)) : 0
      out.push({ kind: 'port-face', point: toward(joint.position, unit(sub(far, node.position)), gap), run, joint, face: toPipe ? 'mate' : 'body' })
    }
    return out
  }
  if (o.bodyFaces && end && node.kind === 'flange' && connected(doc, id).length === 1) {
    const joint = o.joints.find(j => j.nodeId === id && j.kind === 'equipment'), run = connected(doc, id)[0]
    const gasket = joint?.supplied.gasket && node.jointSupply?.measuredTo !== 'mate' ? joint.gasket?.thickness ?? 0 : 0
    const out3 = unit(sub(node.position, farNode(doc, node, run).position))
    return [...out, { kind: 'equipment-face', point: toward(node.position, out3, gasket), gasket }]
  }
  if (!end && node.kind === 'reducer') {
    const runs = connected(doc, id).filter(r => o.inLeg(r) && onDrawing(r)), large = Math.max(...runs.map(r => r.nps))
    for (const run of runs) {
      const across = farNode(doc, node, run)
      if (run.connector && run.nps === large && workPoint(across)) continue
      out.push({ kind: 'reducer-end', point: toward(node.position, unit(sub(across.position, node.position)), takeout(doc, node, run.id) ?? 0), run })
    }
    return out
  }
  out.push({ kind: 'node', point: node.position })
  return out
}
const getRun = (doc: IsoDocument, id: string): PipeRun | undefined => doc.runs.find(r => r.id === id)

/**
 * The model point a drafted dimension's end is measured to: the node itself, or with a `face` on a pipe, the face of
 * the part there on that pipe's side. 'body' is the part's own face, 'mate' the face across its gasket (the mating
 * flange's); at a flange pair 'body' is the face on the pipe's side and 'mate' the other; at an open-ended flange the
 * flange face, or the face of the mate it bolts to. Undefined for a point of a linked drawing (`adjacent`).
 */
export function anchorPoint(doc: IsoDocument, a: DimensionAnchor, joints: readonly FlangedJoint[]): Vec3 | undefined {
  const n = a.adjacent ? undefined : doc.nodes.find(n => n.id === a.nodeId)
  if (!n) return undefined
  if (!a.face || !a.runId) return n.position
  const run = getRun(doc, a.runId)
  if (!run) return undefined
  const out = unit(sub(farNode(doc, n, run).position, n.position))
  const pair = joints.find(j => j.nodeId === n.id && j.kind === 'flange-pair')
  if (pair && n.kind === 'flange') return toward(n.position, out, (pair.gasket?.thickness ?? 0) / 2 * (a.face === 'body' ? 1 : -1))
  if (n.kind === 'flange' && connected(doc, n.id).length === 1)
    return continuationPoint(doc, { ...n, continuation: { text: '', coordinateFace: a.face === 'mate' ? 'mate' : 'flange' } })
  const joint = joints.find(j => j.nodeId === n.id && j.kind === 'component-port' && j.runIds.includes(run.id))
  const body = joint?.position ?? toward(n.position, out, n.kind === 'flange' || n.kind === 'end' ? 0 : takeout(doc, n, run.id) ?? 0)
  return toward(body, out, a.face === 'mate' ? joint?.gasket?.thickness ?? 0 : 0)
}

/**
 * Where a drafted sheet measures a pipe's end at `node`, as a distance toward the pipe's far end: the point a drafted
 * dimension along the pipe (both its ends on the pipe's line) is measured to at the node, where the dimension runs
 * from it toward the pipe and ends on it, by its other end (within that end's gasket). A dimension spanning the pipe
 * to its other end's node is the pipe's own and wins; else the nearest of the others. A dimension across the part at
 * the node (its face-to-face, a fitting's work point to its face), one running away from the pipe along the next, and
 * an overall running on past the pipe do not measure it. Undefined where none is drafted.
 */
function draftedStation(doc: IsoDocument, node: PipeNode, run: PipeRun, joints: readonly FlangedJoint[], dir: Vec3): number | undefined {
  const drafted = doc.sheets?.[run.spool]?.dimensions ?? [], far = farNode(doc, node, run), other = far.id
  const reach = offsetOf(node, dir, far.position) + STATION_MERGE + Math.max(0, ...joints.filter(j => j.nodeId === other).map(j => j.gasket?.thickness ?? 0))
  const offset = (p: Vec3) => offsetOf(node, dir, p)
  const onLine = (p: Vec3) => { const t = offset(p); return length([0, 1, 2].map(k => p[k] - node.position[k] - dir[k] * t) as Vec3) < 0.01 }
  const found = drafted.flatMap(d => [[d.from, d.to], [d.to, d.from]].flatMap(([a, b]) => {
    // A dimension across the part itself (its face-to-face, a fitting's work point to its face) is its own length.
    if (a.nodeId !== node.id || b.nodeId === node.id) return []
    const here = anchorPoint(doc, a, joints), there = anchorPoint(doc, b, joints)
    if (!here || !there || !onLine(here) || !onLine(there) || offset(there) <= offset(here) + 0.01 || offset(there) > reach) return []
    return [{ at: offset(here), spans: b.nodeId === other }]
  }))
  const best = found.some(f => f.spans) ? found.filter(f => f.spans) : found
  return best.length ? Math.max(...best.map(f => f.at)) : undefined
}

/** Distance of a point from a node along a direction. */
const offsetOf = (node: PipeNode, dir: Vec3, p: Vec3) => [0, 1, 2].reduce((sum, k) => sum + (p[k] - node.position[k]) * dir[k], 0)

/** The stations that measure a pipe end: those on that pipe, or the node's own. */
const onPipe = (s: Station, run: PipeRun) => !('run' in s) || s.run.id === run.id

/**
 * Where a pipe's end at `node` is measured from: the distance (mm) from the node toward the pipe's far end of the
 * station its span on the sheet starts at (negative when the station is beyond the node, as a flange pair's
 * fitting-side face is). A drafted dimension along the pipe from the node gives it (`draftedStation`); else the
 * sheet's own station (`nodeStations`), on the straight found on the pipe's own drawing (its spool), as the sheet
 * finds it. Where the dimensions run through the node there is no station; the pipe is measured from the node itself,
 * 0. Of several stations, the pipe's span starts at the one nearest it (a part screwed into an olet is nearer than
 * the olet).
 */
export function pipeStation(doc: IsoDocument, node: PipeNode, run: PipeRun, joints: readonly FlangedJoint[]): number {
  const dir = unit(sub(farNode(doc, node, run).position, node.position))
  const drafted = draftedStation(doc, node, run, joints, dir)
  if (drafted != null) return drafted
  const sameDrawing = (r: PipeRun) => r.spool === run.spool
  const next = continuingRun(doc, node, run, sameDrawing)
  const stations = nodeStations(doc, node, {
    end: !next, inLeg: r => r.id === run.id || r.id === next?.id, joints, onDrawing: sameDrawing,
    nodes: doc.nodes.filter(n => connected(doc, n.id).some(sameDrawing))
  }).filter(s => onPipe(s, run))
  if (!stations.length) return 0
  return Math.max(...stations.map(s => offsetOf(node, dir, s.point)))
}
