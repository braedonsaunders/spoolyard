import { COMPONENT_TYPES, type ComponentType } from './components';
import { connected, getNode, getSpec, length, sub, add, mul, runResult, insertComponent, attachComponent, applyComponent, setAutoFitting, type CatalogItem, type IsoDocument, type Vec3 } from './model';

export interface ComponentTrack {
  from: Vec3;
  to: Vec3;
  length: number;
  distance: number;
  runIds: string[];
}

/** A straight track for an attached item or an inline fitting; bends and live branches stay fixed. */
export function componentTrack(doc: IsoDocument, nodeId: string): ComponentTrack | null {
  const node = getNode(doc, nodeId);
  if (node.kind === 'end') return null;
  const host = doc.runs.find(r => r.id === node.associatedRunId && !r.connector);
  const edges = connected(doc, nodeId);
  let from: Vec3, to: Vec3, runIds: string[];
  if (host) {
    from = getNode(doc, host.from).position;
    to = getNode(doc, host.to).position;
    runIds = [host.id];
  } else {
    if (edges.length !== 2 || edges.some(r => r.connector)) return null;
    const first = edges.find(r => r.to === nodeId) ?? edges[0];
    const second = edges.find(r => r !== first)!;
    from = getNode(doc, first.from === nodeId ? first.to : first.from).position;
    to = getNode(doc, second.from === nodeId ? second.to : second.from).position;
    const a = sub(node.position, from), b = sub(to, node.position), la = length(a), lb = length(b);
    if (la < 1e-8 || lb < 1e-8 || a.reduce((sum, v, i) => sum + v * b[i], 0) / la / lb < 0.999999) return null;
    runIds = [first.id, second.id];
  }
  const delta = sub(to, from), total = length(delta);
  if (total < 1e-8) return null;
  const distance = sub(node.position, from).reduce((sum, v, i) => sum + v * delta[i], 0) / total;
  return { from: [...from], to: [...to], length: total, distance, runIds };
}

/** Slide without moving pipe ends or discarding catalogue/preparation data. */
export function moveComponentAlongPipe(doc: IsoDocument, nodeId: string, distance: number): void {
  const node = getNode(doc, nodeId), track = componentTrack(doc, nodeId);
  if (!track) throw new Error('This component cannot slide along a straight pipe.');
  if (!Number.isFinite(distance) || distance <= 0 || distance >= track.length)
    throw new Error('Position must be between the pipe ends.');
  const position = add(track.from, mul(sub(track.to, track.from), distance / track.length));
  const edges = connected(doc, nodeId);
  for (const run of edges) {
    const other = getNode(doc, run.from === nodeId ? run.to : run.from);
    const result = runResult(doc, run), allowance = result.overall - result.cut;
    if (Number.isFinite(allowance) && length(sub(position, other.position)) <= allowance)
      throw new Error('That position leaves no pipe after fitting takeouts and root gaps.');
  }
  // Supports and annotations stay at their physical location when an inline fitting passes them.
  if (!node.associatedRunId) {
    for (const attached of doc.nodes.filter(n => n.associatedRunId && track.runIds.includes(n.associatedRunId))) {
      const along = sub(attached.position, track.from).reduce((sum, v, i) => sum + v * (track.to[i] - track.from[i]), 0) / track.length;
      attached.associatedRunId = track.runIds[along <= distance ? 0 : 1];
    }
  }
  node.position = position;
}

/** Place an inline fitting or attached item at an explicit point along a measured pipe. */
export function placeComponentOnPipe(doc: IsoDocument, runId: string, type: ComponentType, fraction: number, row?: CatalogItem) {
  const run = doc.runs.find(r => r.id === runId && !r.connector);
  if (!run) throw new Error('Select a pipe to insert this component.');
  if (!(fraction > 0 && fraction < 1)) throw new Error('Click between the pipe ends to place this component.');
  if (type.kind === 'pipe') throw new Error('Use the Pipe tool to route a pipe.');
  const specRows = getSpec(doc, run.specId).fittings;
  const code = (f: CatalogItem) => f.component ?? COMPONENT_TYPES.find(t => t.kind === f.kind)?.code;
  const match =
    (row && row.nps === run.nps && specRows.some(f => f.id === row.id) ? row : undefined) ??
    specRows.find(f => code(f) === type.code && f.nps === run.nps && (row?.smallerNps == null || f.smallerNps === row.smallerNps));
  const node = ['support', 'bolt', 'annotation'].includes(type.kind)
    ? attachComponent(doc, runId, type.kind, fraction)
    : insertComponent(doc, runId, type.kind, fraction);
  applyComponent(doc, node, type.code, match);
  if (type.kind === 'reducer' && match?.smallerNps) {
    const next = doc.runs.find(r => r.from === node.id)!;
    next.nps = match.smallerNps;
    setAutoFitting(doc, next.to);
  }
  for (const edge of connected(doc, node.id)) {
    const cut = runResult(doc, edge).cut;
    if (Number.isFinite(cut) && cut <= 0)
      throw new Error('That position leaves no pipe after fitting takeouts and root gaps. Choose a point farther from the end.');
  }
  return node;
}
