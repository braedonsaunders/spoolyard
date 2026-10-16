import { COMPONENT_TYPES, type ComponentType } from './components';
import { nodeCode } from './joints';
import { connected, getNode, getSpec, length, sub, add, mul, runResult, insertComponent, attachComponent, applyComponent, makeNipple, setAutoFitting, takeout, type CatalogItem, type IsoDocument, type PipeRun, type Vec3 } from './model';

export interface ComponentTrack {
  /** Ends of the whole straight leg, between changes of direction, branches and open ends. */
  from: Vec3;
  to: Vec3;
  length: number;
  /** Distance of the component from `from`, along the leg. */
  distance: number;
  /** The component can slide strictly between these leg distances (its neighbouring fittings). */
  min: number;
  max: number;
  runIds: string[];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export interface PipeLeg { runs: PipeRun[]; nodes: string[]; from: Vec3; to: Vec3; length: number; stations: number[] }
/** The straight leg containing a pipe: consecutive in-line pipes through valves, flanges, welds and reducers. */
export function pipeLeg(doc: IsoDocument, runId: string): PipeLeg | null {
  const run = doc.runs.find(r => r.id === runId && !r.connector);
  if (!run) return null;
  const a = getNode(doc, run.from).position, b = getNode(doc, run.to).position, span = length(sub(b, a));
  if (span < 1e-8) return null;
  const u = mul(sub(b, a), 1 / span);
  const step = (nodeId: string, previous: PipeRun, sign: 1 | -1): PipeRun | undefined => {
    const node = getNode(doc, nodeId);
    if (node.kind === 'end') return undefined;
    const edges = connected(doc, nodeId).filter(r => r.id !== previous.id);
    if (edges.length !== 1 || edges[0].connector) return undefined;
    const next = edges[0], far = getNode(doc, next.from === nodeId ? next.to : next.from).position;
    const v = sub(far, node.position), l = length(v);
    return l > 1e-8 && dot(v, u) * sign / l > 0.999999 ? next : undefined;
  };
  const runs = [run], nodes = [run.from, run.to];
  for (let r: PipeRun | undefined = run, at = run.from; (r = step(at, r!, -1)) && !runs.includes(r);) {
    runs.unshift(r);
    at = r.from === at ? r.to : r.from;
    nodes.unshift(at);
  }
  for (let r: PipeRun | undefined = run, at = run.to; (r = step(at, r!, 1)) && !runs.includes(r);) {
    runs.push(r);
    at = r.from === at ? r.to : r.from;
    nodes.push(at);
  }
  const from = getNode(doc, nodes[0]).position, to = getNode(doc, nodes.at(-1)!).position;
  const stations = nodes.map(id => dot(sub(getNode(doc, id).position, from), u));
  return { runs, nodes, from: [...from], to: [...to], length: length(sub(to, from)), stations };
}

/** Where a point at `fraction` along a pipe sits on its straight leg. */
export function legPosition(doc: IsoDocument, runId: string, fraction: number): { distance: number; length: number; percent: number } | null {
  const leg = pipeLeg(doc, runId), run = doc.runs.find(r => r.id === runId);
  if (!leg || !run) return null;
  const a = getNode(doc, run.from).position, b = getNode(doc, run.to).position;
  const distance = length(sub(add(a, mul(sub(b, a), fraction)), leg.from));
  return { distance, length: leg.length, percent: 100 * distance / leg.length };
}
/** The pipe and fraction at a distance along the leg containing `runId`. */
export function legPoint(doc: IsoDocument, runId: string, distance: number): { runId: string; fraction: number } | null {
  const leg = pipeLeg(doc, runId);
  if (!leg || !(distance > 0 && distance < leg.length)) return null;
  const i = leg.stations.findIndex((s, k) => k > 0 && distance <= s) - 1;
  if (i < 0) return null;
  const run = leg.runs[i], forward = run.from === leg.nodes[i];
  const t = (distance - leg.stations[i]) / (leg.stations[i + 1] - leg.stations[i]);
  return { runId: run.id, fraction: forward ? t : 1 - t };
}

/** A straight track for an attached item or an inline fitting; bends and live branches stay fixed. */
export function componentTrack(doc: IsoDocument, nodeId: string): ComponentTrack | null {
  const node = getNode(doc, nodeId);
  if (node.kind === 'end') return null;
  const host = doc.runs.find(r => r.id === node.associatedRunId && !r.connector);
  if (host) {
    const leg = pipeLeg(doc, host.id);
    if (!leg) return null;
    const u = mul(sub(leg.to, leg.from), 1 / leg.length);
    return { from: leg.from, to: leg.to, length: leg.length, distance: dot(sub(node.position, leg.from), u), min: 0, max: leg.length, runIds: leg.runs.map(r => r.id) };
  }
  const edges = connected(doc, nodeId);
  if (edges.length !== 2 || edges.some(r => r.connector)) return null;
  const leg = pipeLeg(doc, edges[0].id), index = leg?.nodes.indexOf(nodeId) ?? -1;
  if (!leg || index <= 0 || index >= leg.nodes.length - 1) return null;
  return {
    from: leg.from, to: leg.to, length: leg.length, distance: leg.stations[index],
    min: leg.stations[index - 1], max: leg.stations[index + 1],
    runIds: [leg.runs[index - 1].id, leg.runs[index].id]
  };
}

/** Slide along the leg without moving pipe ends or discarding catalogue/preparation data. */
export function moveComponentAlongPipe(doc: IsoDocument, nodeId: string, distance: number): void {
  const node = getNode(doc, nodeId), track = componentTrack(doc, nodeId);
  if (!track) throw new Error('This component cannot slide along a straight pipe.');
  if (!Number.isFinite(distance) || distance <= track.min || distance >= track.max)
    throw new Error(node.associatedRunId
      ? 'Position must be between the pipe ends.'
      : 'Position must be between the pipe ends and the neighbouring fittings.');
  const position = add(track.from, mul(sub(track.to, track.from), distance / track.length));
  if (node.associatedRunId) {
    const leg = pipeLeg(doc, node.associatedRunId)!, i = Math.max(0, leg.stations.findIndex((s, k) => k > 0 && distance <= s) - 1);
    node.position = position;
    node.associatedRunId = leg.runs[i].id;
    return;
  }
  for (const run of connected(doc, nodeId)) {
    const other = getNode(doc, run.from === nodeId ? run.to : run.from);
    const result = runResult(doc, run), allowance = result.overall - result.cut;
    if (Number.isFinite(allowance) && length(sub(position, other.position)) <= allowance)
      throw new Error('That position leaves no pipe after fitting takeouts and root gaps.');
  }
  // Supports and annotations stay at their physical location when an inline fitting passes them.
  for (const attached of doc.nodes.filter(n => n.associatedRunId && track.runIds.includes(n.associatedRunId))) {
    const along = dot(sub(attached.position, track.from), sub(track.to, track.from)) / track.length;
    attached.associatedRunId = track.runIds[along <= distance ? 0 : 1];
  }
  node.position = position;
}

/** Components that can terminate a pipe: flanges, blinds, caps and plugs. */
export const endCapable = (type: ComponentType) => type.kind === 'flange' || type.kind === 'cap' || type.ports === 1;

/** Place an inline fitting or attached item at an explicit point along a measured pipe; 0 and 1 are the pipe ends. */
export function placeComponentOnPipe(doc: IsoDocument, runId: string, type: ComponentType, fraction: number, row?: CatalogItem) {
  const run = doc.runs.find(r => r.id === runId && !r.connector);
  if (!run) throw new Error('Select a pipe to insert this component.');
  if (type.kind === 'pipe') throw new Error('Use the Pipe tool to route a pipe.');
  if (!(fraction >= 0 && fraction <= 1)) throw new Error('Click on the pipe to place this component.');
  // A nipple is the clicked pipe itself, bought to its catalogued length.
  if (type.code === 'NIPPLE') return getNode(doc, makeNipple(doc, runId).to);
  const specRows = getSpec(doc, run.specId).fittings;
  const code = (f: CatalogItem) => f.component ?? COMPONENT_TYPES.find(t => t.kind === f.kind)?.code;
  const match =
    (row && row.nps === run.nps && specRows.some(f => f.id === row.id) ? row : undefined) ??
    specRows.find(f => code(f) === type.code && f.nps === run.nps && (row?.smallerNps == null || f.smallerNps === row.smallerNps));
  const attached = ['support', 'bolt', 'annotation'].includes(type.kind);
  const atEnd = fraction <= 0 || fraction >= 1;
  if (atEnd && !attached) {
    // A flange, blind or cap dropped on an open end becomes that end; its face is the end point.
    const end = getNode(doc, fraction <= 0 ? run.from : run.to);
    if (!endCapable(type)) throw new Error(`Click between the pipe ends to place ${type.label.toLowerCase()}.`);
    if (end.kind !== 'end' || connected(doc, end.id).length !== 1)
      throw new Error('That pipe end already has a fitting. Click an open pipe end, or between the ends.');
    applyComponent(doc, end, type.code, match);
    return end;
  }
  if (!attached && type.ports === 1) throw new Error(`${type.label} goes on an open pipe end. Click the end of the pipe.`);
  if (!(fraction > 0 && fraction < 1)) throw new Error('Click between the pipe ends to place this component.');
  const node = attached
    ? attachComponent(doc, runId, type.kind, fraction)
    : insertComponent(doc, runId, type.kind, fraction);
  applyComponent(doc, node, type.code, match);
  if (type.kind === 'reducer' && match?.smallerNps) {
    const next = doc.runs.find(r => r.from === node.id)!;
    next.nps = match.smallerNps;
    setAutoFitting(doc, next.to);
  }
  // A flanged component dropped against another bolts straight to it, face to face, with no pipe between.
  for (const edge of connected(doc, node.id)) {
    const other = getNode(doc, edge.from === node.id ? edge.to : edge.from), cut = runResult(doc, edge).cut;
    if (!(Number.isFinite(cut) && cut <= 0) || type.endPrep !== 'FL' || COMPONENT_TYPES.find(t => t.code === nodeCode(doc, other))?.endPrep !== 'FL') continue;
    edge.connector = true;
    const span = (takeout(doc, other, edge.id) ?? NaN) + (takeout(doc, node, edge.id) ?? NaN), u = sub(node.position, other.position);
    if (Number.isFinite(span)) node.position = add(other.position, mul(u, span / (length(u) || 1)));
    else delete edge.connector;
  }
  for (const edge of connected(doc, node.id)) {
    const cut = runResult(doc, edge).cut;
    if (!edge.connector && Number.isFinite(cut) && cut <= 0)
      throw new Error('That position leaves no pipe after fitting takeouts and root gaps. Choose a point farther from the end.');
  }
  return node;
}
