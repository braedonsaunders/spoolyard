import { clone, connected, distance, getNode, id, plantCoordinate, type DrawingReference, type IsoDocument } from './model'

/** Link a local snapshot of the next drawing at its nearest continuation. It supplies drawing context only. */
export function drawingReference(doc: IsoDocument, atNodeId: string, source: IsoDocument, anchorNodeId?: string): DrawingReference {
  const at = getNode(doc, atNodeId), plant = plantCoordinate(doc, at.position)
  const ends = source.nodes.filter(n => n.continuation || !n.associatedRunId && connected(source, n.id).length === 1)
  const anchor = anchorNodeId ? getNode(source, anchorNodeId) : ends.sort((a, b) =>
    distance(plant, plantCoordinate(source, a.position)) - distance(plant, plantCoordinate(source, b.position)))[0]
  if (!anchor) throw new Error('The adjacent drawing has no continuation or open end to link.')
  const runs = new Set<string>(), nodes = new Set([anchor.id]), queue = [{ node: anchor.id, depth: 0 }]
  while (queue.length) {
    const { node, depth } = queue.shift()!
    if (depth >= 6 || nodes.size > 60) continue
    for (const run of connected(source, node)) {
      if (runs.has(run.id)) continue
      runs.add(run.id)
      const far = run.from === node ? run.to : run.from
      if (!nodes.has(far)) { nodes.add(far); queue.push({ node: far, depth: depth + 1 }) }
    }
  }
  const refId = id(), key = (s: string) => `${refId}:${s}`
  const specIds = new Set(source.runs.filter(r => runs.has(r.id)).map(r => r.specId))
  const refNodes = clone(source.nodes.filter(n => nodes.has(n.id))).map(n => ({
    ...n, id: key(n.id), position: n.position.map((v, i) => v + at.position[i] - anchor.position[i]) as typeof n.position,
    continuation: undefined,
    associatedRunId: n.associatedRunId && runs.has(n.associatedRunId) ? key(n.associatedRunId) : undefined,
    branchEdgeId: n.branchEdgeId && runs.has(n.branchEdgeId) ? key(n.branchEdgeId) : undefined,
    portTakeouts: n.portTakeouts && Object.fromEntries(Object.entries(n.portTakeouts).filter(([r]) => runs.has(r)).map(([r, v]) => [key(r), v])),
    portFlanges: n.portFlanges && Object.fromEntries(Object.entries(n.portFlanges).filter(([r]) => runs.has(r)).map(([r, v]) => [key(r), v]))
  }))
  return {
    id: refId, atNodeId, name: source.drawing || source.title, anchorNodeId: key(anchor.id), components: 1,
    nodes: refNodes, runs: clone(source.runs.filter(r => runs.has(r.id))).map(r => ({ ...r, id: key(r.id), from: key(r.from), to: key(r.to) })),
    specs: clone(source.specs.filter(s => specIds.has(s.id)))
  }
}

/** A temporary isolated document for rendering reference symbols, never for the host drawing's quantities. */
export function referenceDocument(doc: IsoDocument, reference: DrawingReference): IsoDocument {
  const anchor = reference.nodes.find(n => n.id === reference.anchorNodeId)!, at = getNode(doc, reference.atNodeId)
  const delta = at.position.map((v, i) => v - anchor.position[i])
  const nodes = reference.nodes.map(n => ({ ...n, position: n.position.map((v, i) => v + delta[i]) as typeof n.position }))
  return { ...doc, nodes, runs: reference.runs, specs: reference.specs, references: undefined }
}
