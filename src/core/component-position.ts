import { COMPONENT_TYPES, COMPONENT_TYPE_BY_CODE, type ComponentType } from './components';
import { catalogRow, defaultCode, flangedJoints, nodeCode } from './joints';
import { connected, fitting, getNode, getSpec, id, length, resizeRun, sub, add, mul, prepAt, runResult, insertComponent, attachComponent, applyComponent, makeNipple, setAutoFitting, takeout, type CatalogItem, type IsoDocument, type PipeNode, type PipeRun, type PipeSpec, type Vec3 } from './model';

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
    // An olet's branch goes with it: everything routed from the outlet moves across by the same distance, so the
    // branch keeps its length and direction.
    const branch = branchBeyond(doc, nodeId, leg.runs.map(r => r.id)), shift = sub(position, node.position);
    for (const n of doc.nodes)
      if (n.id !== nodeId && (branch.nodes.has(n.id) || (n.associatedRunId && branch.runs.has(n.associatedRunId)))) n.position = add(n.position, shift);
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

/** The pipes and nodes routed from an attached outlet; it may not come back to the header it sits on. */
function branchBeyond(doc: IsoDocument, nodeId: string, header: string[]): { nodes: Set<string>; runs: Set<string> } {
  const nodes = new Set<string>([nodeId]), runs = new Set<string>(), queue = [nodeId];
  const headerNodes = new Set(doc.runs.filter(r => header.includes(r.id)).flatMap(r => [r.from, r.to]));
  for (let i = 0; i < queue.length; i++)
    for (const edge of connected(doc, queue[i])) {
      if (runs.has(edge.id)) continue;
      runs.add(edge.id);
      const other = edge.from === queue[i] ? edge.to : edge.from;
      if (headerNodes.has(other) || header.includes(edge.id))
        throw new Error('This outlet\'s branch joins back into its header. Move the branch pipes individually.');
      if (!nodes.has(other)) { nodes.add(other); queue.push(other); }
    }
  nodes.delete(nodeId);
  return { nodes, runs };
}
/** Components that can terminate a pipe: flanges, blinds, caps and plugs. */
export const endCapable = (type: ComponentType) =>
  type.kind !== 'olet' && (type.kind === 'flange' || type.kind === 'cap' || type.ports === 1);

/** Reducers, tees and olets come in sizes: a reducer reduces or expands, a tee or olet sets its branch. */
export const sized = (type: ComponentType) =>
  type.kind === 'tee' || (type.kind === 'olet' && type.ports === 1) || (type.kind === 'reducer' && !!type.reducing);
/** A size a reducer, tee or olet comes in on a pipe; `to` is the size beyond it: downstream of a reducer, or the branch. */
export interface SizeChoice { row: CatalogItem; to: number }
/**
 * Sizes a reducer (reducing or expanding), tee or olet fits on a pipe of size `nps`, from the specification's rows, else
 * the standard ones. Reductions and reducing branches come closest size first; olet branches smallest first.
 */
export function sizeChoices(spec: PipeSpec, type: ComponentType, nps: number): SizeChoice[] {
  if (!sized(type)) return [];
  const sizes = spec.sizes.map(s => s.nps).sort((a, b) => a - b), smaller = sizes.filter(s => s < nps);
  const pairs: Array<[number, number | undefined, number]> =
    type.kind === 'olet' ? smaller.map(s => [s, undefined, s])
      : type.kind === 'tee' ? (type.reducing ? [...smaller].reverse().map(s => [nps, s, s]) : [[nps, undefined, nps]])
        : [...[...smaller].reverse().map((s): [number, number, number] => [nps, s, s]),
          ...sizes.filter(s => s > nps).map((s): [number, number, number] => [s, nps, s])];
  const own = { ...spec, fittings: spec.fittings.filter(f => f.component === type.code) };
  return pairs.flatMap(([large, small, to]) => {
    const row = catalogRow(own, type.code, large, small);
    return row ? [{ row, to }] : [];
  });
}

/** The size beyond a sized component on a pipe of `nps`; an error when the row does not fit that pipe. */
function sizeBeyond(type: ComponentType, row: CatalogItem, nps: number): number {
  const fits = type.kind === 'olet' ? row.nps < nps
    : type.kind === 'tee' ? row.nps === nps
      : row.smallerNps != null && row.smallerNps !== row.nps && (row.nps === nps || row.smallerNps === nps);
  if (!fits)
    throw new Error(type.kind === 'olet'
      ? `A ${row.nps}″ ${type.label.toLowerCase()} branch is too large for a ${nps}″ pipe. Choose a smaller branch.`
      : `That ${type.label.toLowerCase()} does not fit a ${nps}″ pipe. Choose a size with a ${nps}″ end.`);
  return type.kind === 'olet' ? row.nps : type.kind === 'tee' ? row.smallerNps ?? row.nps : row.nps === nps ? row.smallerNps! : row.nps;
}

/** A node refitted to a new pipe size: routed fittings are chosen again, catalogue rows of the old size dropped. */
function refit(doc: IsoDocument, node: PipeNode, nps: number, specId: string) {
  setAutoFitting(doc, node.id);
  const row = fitting(doc, node);
  if (!row || row.nps === nps || ['end', 'weld', 'elbow90', 'elbow45', 'tee', 'reducer'].includes(node.kind)) return;
  const same = getSpec(doc, specId).fittings.find(f => f.component === row.component && f.nps === nps && !f.smallerNps);
  if (same) node.catalogId = same.id;
  else delete node.catalogId;
}
/**
 * Put a pipe on another specification. The components it carries follow it: routed fittings (elbows, tees, welds)
 * are chosen again from the new specification, an outlet on it and an in-line component whose row is not from a
 * specification of its pipes take the new specification's row for the same component and sizes, or, where it has
 * none, the standard part. Rows chosen from the specification a component's other pipe is on are kept (a spec break).
 */
export function setRunSpec(doc: IsoDocument, runId: string, specId: string): void {
  const run = doc.runs.find(r => r.id === runId);
  if (!run) return;
  const spec = getSpec(doc, specId);
  run.specId = specId;
  if (!spec.sizes.some(s => s.nps === run.nps) && spec.sizes.length) throw new Error(`Specification ${spec.name} has no ${run.nps}″ size.`);
  for (const node of [getNode(doc, run.from), getNode(doc, run.to), ...doc.nodes.filter(n => n.associatedRunId === run.id)]) refitToSpec(doc, node);
}
/** A component's row taken again from its pipes' specification, when the row it has is from none of theirs. */
export function refitToSpec(doc: IsoDocument, node: PipeNode): void {
  const edges = connected(doc, node.id), host = doc.runs.find(r => r.id === node.associatedRunId);
  const pipes = host ? [host] : edges;
  if (!pipes.length) return;
  if (['end', 'weld', 'elbow90', 'elbow45', 'tee'].includes(node.kind) && !host) return setAutoFitting(doc, node.id);
  const row = fitting(doc, node), code = node.component ?? row?.component;
  if (!row || !code) return;
  const own = new Set(pipes.map(r => r.specId));
  if (doc.specs.some(s => own.has(s.id) && s.fittings.includes(row))) return;
  const owner = pipes.reduce((a, b) => (b.nps > a.nps ? b : a)), spec = getSpec(doc, owner.specId);
  const same = spec.fittings.find(f => f.component === code && f.nps === row.nps && (f.smallerNps ?? f.nps) === (row.smallerNps ?? row.nps));
  // Without a row, the standard part; an outlet keeps its branch size in the standard part's name.
  if (same) node.catalogId = same.id;
  else if (node.kind === 'olet') node.catalogId = `std:${code}:${row.smallerNps ?? row.nps}`;
  else delete node.catalogId;
  node.component = code;
  delete node.description;
}

/**
 * The pipes at a sized fitting follow the catalogue row chosen for it: a reducer's two ends, a tee's branch and an
 * olet's branch take the row's sizes, carried along the line beyond (see `carrySize`), so choosing a 4"×2" row in
 * place of 4"×3" redraws and recuts the line at 2".
 */
export function sizePipesToRow(doc: IsoDocument, nodeId: string): void {
  const node = getNode(doc, nodeId), row = fitting(doc, node);
  if (!row) return;
  const edges = connected(doc, nodeId).filter(r => !r.connector || r.from === nodeId || r.to === nodeId);
  if (node.kind === 'reducer' && row.smallerNps != null && edges.length === 2) {
    const [large, small] = edges[0].nps >= edges[1].nps ? edges : [edges[1], edges[0]];
    if (small.nps !== row.smallerNps) carrySize(doc, nodeId, small.id, row.smallerNps);
    if (large.nps !== row.nps) carrySize(doc, nodeId, large.id, row.nps);
    return;
  }
  const branch = node.kind === 'olet' ? edges[0] : node.kind === 'tee' ? edges.find(r => r.id === node.branchEdgeId) : undefined;
  const size = node.kind === 'olet' ? row.smallerNps ?? row.nps : row.smallerNps ?? row.nps;
  if (branch && branch.nps !== size) carrySize(doc, nodeId, branch.id, size);
}

/**
 * Carry a new size along the line beyond a fitting: the pipe leaving `fromId` and the pipes it runs on into through
 * joints, elbows and in-line components, up to the next reducer, branch or open end.
 */
export function carrySize(doc: IsoDocument, fromId: string, runId: string, nps: number): void {
  let at = fromId, run = doc.runs.find(r => r.id === runId);
  const old = run?.nps, seen = new Set<string>();
  while (run && !seen.has(run.id)) {
    seen.add(run.id);
    run.nps = nps;
    const nextId = run.from === at ? run.to : run.from, node = getNode(doc, nextId), edges = connected(doc, nextId);
    const onward = edges.length === 2 && node.kind !== 'reducer' && !node.associatedRunId
      ? edges.find(r => r.id !== run!.id && r.nps === old && !r.connector && !seen.has(r.id)) : undefined;
    if (onward) onward.nps = nps;
    refit(doc, node, nps, run.specId);
    at = nextId;
    run = onward;
  }
}

/** Where a straight changes size at a plain joint, as when a pipe of another size is routed on, a reducer goes there. */
export function reduceAtJoint(doc: IsoDocument, nodeId: string): PipeNode | undefined {
  const node = getNode(doc, nodeId), edges = connected(doc, nodeId);
  if (node.kind !== 'weld' || edges.length !== 2 || edges[0].nps === edges[1].nps) return undefined;
  const [large, small] = edges[0].nps > edges[1].nps ? edges : [edges[1], edges[0]];
  const code = defaultCode('reducer', prepAt(large, large.from === nodeId ? 0 : 1))!;
  const row = getSpec(doc, large.specId).fittings.find(f => f.component === code && f.nps === large.nps && f.smallerNps === small.nps);
  applyComponent(doc, node, code, row);
  return node;
}

/** Place an inline fitting or attached item at an explicit point along a measured pipe; 0 and 1 are the pipe ends. */
export function placeComponentOnPipe(doc: IsoDocument, runId: string, type: ComponentType, fraction: number, row?: CatalogItem) {
  const run = doc.runs.find(r => r.id === runId && !r.connector);
  if (!run) throw new Error('Select a pipe to insert this component.');
  if (type.kind === 'pipe') throw new Error('Use the Pipe tool to route a pipe.');
  if (!(fraction >= 0 && fraction <= 1)) throw new Error('Click on the pipe to place this component.');
  // A nipple is the clicked pipe itself, bought to its catalogued length.
  if (type.code === 'NIPPLE') return getNode(doc, makeNipple(doc, runId).to);
  const spec = getSpec(doc, run.specId), specRows = spec.fittings;
  const code = (f: CatalogItem) => f.component ?? COMPONENT_TYPES.find(t => t.kind === f.kind)?.code;
  // A reducer, tee or olet goes in at the size chosen for it; a reducer reduces or expands the pipe beyond it.
  // Unchosen, the size is the smallest the specification itself lists, then the smallest standard one.
  const choices = sized(type) ? sizeChoices(spec, type, run.nps) : []
  const size = sized(type) ? row ?? (choices.find(c => specRows.some(f => f.id === c.row.id)) ?? choices[0])?.row : undefined;
  const beyond = size && sizeBeyond(type, size, run.nps);
  const match = size
    ? specRows.find(f => f.id === size.id) ?? size
    : (row && row.nps === run.nps && specRows.some(f => f.id === row.id) ? row : undefined) ??
      specRows.find(f => code(f) === type.code && f.nps === run.nps && (row?.smallerNps == null || f.smallerNps === row.smallerNps));
  // An olet sits on its header pipe; its branch is routed from it.
  const attached = ['support', 'bolt', 'annotation', 'olet'].includes(type.kind);
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
  if (type.kind === 'reducer' && beyond != null) carrySize(doc, node.id, doc.runs.find(r => r.from === node.id)!.id, beyond);
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

/**
 * Weld the fittings at a pipe's ends straight to each other (close-coupled): the pipe becomes their makeup, its two
 * takeouts and the root gap, with no pipe piece cut; what lies beyond moves up to keep every other length.
 */
export function closeCouple(doc: IsoDocument, runId: string): void {
  const run = doc.runs.find(r => r.id === runId);
  if (!run) throw new Error('Select a pipe.');
  if (run.connector) return;
  const { overall, cut } = runResult(doc, run), makeup = overall - cut;
  if (!Number.isFinite(makeup) || makeup <= 0)
    throw new Error('The fittings at the ends of this pipe have no known lengths, so they cannot be welded together. Give them a takeout first.');
  if (Math.abs(overall - makeup) > 0.01) resizeRun(doc, runId, makeup);
  run.connector = true;
}

/**
 * Close an open end with a flange, blind, cap or plug: the end becomes the component, sized and specified by the
 * pipe or component it is the end of. Unlike a click on a pipe, this reaches an end with no pipe of its own: a valve's
 * open outlet takes a threaded plug or a blind there.
 */
export function capOpenEnd(doc: IsoDocument, nodeId: string, type: ComponentType, row?: CatalogItem): PipeNode {
  const node = getNode(doc, nodeId), edges = connected(doc, nodeId);
  if (!endCapable(type)) throw new Error(`${type.label} does not close a line. Click a pipe to place it.`);
  if (node.kind !== 'end' || node.associatedRunId || edges.length !== 1) throw new Error('That end already has a fitting. Click an open end.');
  const run = edges[0], spec = getSpec(doc, run.specId);
  const match = (row && row.nps === run.nps && spec.fittings.includes(row) ? row : undefined) ??
    spec.fittings.find(f => f.component === type.code && f.nps === run.nps && (f.smallerNps == null || f.smallerNps === f.nps));
  applyComponent(doc, node, type.code, match);
  return node;
}

/** In-line components that can close a line at its open end with no pipe after them: valves, couplings, unions, instruments. */
export const terminalCapable = (type: ComponentType) =>
  type.ports === 2 && !type.angle && ['valve', 'reducer'].includes(type.kind) && !/^(NIPPLE|SPACER|SPECBLD|SPEC-BLND|RF-SBLND)$/.test(type.code);
/**
 * Put an in-line component on a pipe's open end, with nothing after it: the line ends at the component's outlet. The
 * pipe keeps its cut; the component's inlet port is where the pipe ended, and its outlet is the new open end, joined
 * to it with no pipe between (a connector). A flanged component's outlet carries no mating flange: what bolts to it
 * is not on this drawing. Returns the component.
 */
export function placeAtOpenEnd(doc: IsoDocument, runId: string, end: 0 | 1, type: ComponentType, row?: CatalogItem): PipeNode {
  const run = doc.runs.find(r => r.id === runId && !r.connector);
  if (!run) throw new Error('Click the open end of a pipe.');
  if (!terminalCapable(type)) throw new Error(`${type.label} cannot end a line. Click between the pipe ends.`);
  const node = getNode(doc, end === 0 ? run.from : run.to);
  if (node.kind !== 'end' || node.associatedRunId || connected(doc, node.id).length !== 1)
    throw new Error('That pipe end already has a fitting. Click an open pipe end, or between the ends.');
  const far = getNode(doc, end === 0 ? run.to : run.from), span = length(sub(node.position, far.position));
  if (!(span > 0)) throw new Error('That pipe has no length to end with a component.');
  const u = mul(sub(node.position, far.position), 1 / span);
  const spec = getSpec(doc, run.specId);
  const match = (row && row.nps === run.nps && spec.fittings.includes(row) ? row : undefined) ??
    spec.fittings.find(f => f.component === type.code && f.nps === run.nps && (f.smallerNps == null || f.smallerNps === f.nps));
  const continuation = node.continuation, tiePoint = node.tiePoint;
  delete node.continuation;
  delete node.tiePoint;
  applyComponent(doc, node, type.code, match);
  // The outlet: an open end one takeout beyond the centre, with no pipe between.
  const outlet: PipeNode = { id: id(), kind: 'end', position: [...node.position] as Vec3, ...(continuation ? { continuation } : {}), ...(tiePoint ? { tiePoint } : {}) };
  doc.nodes.push(outlet);
  const prep = type.endPrep && type.endPrep !== 'PLAIN' ? type.endPrep : prepAt(run, end === 0 ? 0 : 1);
  const stub: PipeRun = { id: id(), from: node.id, to: outlet.id, specId: run.specId, nps: run.nps, spool: run.spool, line: run.line, heat: '', endPrep: prep, fromPrep: prep, toPrep: prep, connector: true };
  if (run.flow) stub.flow = (run.flow === 'forward') === (end === 1) ? 'forward' : 'reverse';
  doc.runs.push(stub);
  if (type.endPrep === 'FL') node.portFlanges = { ...node.portFlanges, [stub.id]: { component: 'NONE', gasket: false, bolts: false } };
  const inlet = takeout(doc, node, run.id), out = takeout(doc, node, stub.id);
  if (inlet == null || out == null || !Number.isFinite(inlet) || !Number.isFinite(out))
    throw new Error(`The ${type.label.toLowerCase()} has no length in the specification or the standards, so it cannot be placed on an open end. Place it between the pipe ends, or give its specification row a takeout.`);
  node.position = add(node.position, mul(u, inlet));
  outlet.position = add(node.position, mul(u, out));
  return node;
}

/** Whether a connection is a square turn between two pipes, where an angle body (angle or relief valve) can sit. */
export function isSquareTurn(doc: IsoDocument, nodeId: string): boolean {
  const node = getNode(doc, nodeId), edges = connected(doc, nodeId);
  if (node.associatedRunId || edges.length !== 2 || !(node.kind === 'elbow90' || COMPONENT_TYPE_BY_CODE[nodeCode(doc, node) ?? '']?.angle)) return false;
  const [a, b] = edges.map(r => sub(getNode(doc, r.from === nodeId ? r.to : r.from).position, node.position));
  return Math.abs(dot(a, b)) / ((length(a) * length(b)) || 1) < 0.017;
}
/**
 * Put an angle body, an angle or relief valve, at a square turn: the turn's connection becomes the body and its outlet
 * the branch. The outlet is the pipe chosen, else the one the flow leaves by, else the pipe drawn on from the turn.
 */
export function placeAtTurn(doc: IsoDocument, nodeId: string, type: ComponentType, outletId?: string, row?: CatalogItem): PipeNode {
  if (!type.angle) throw new Error(`${type.label} sits on a straight pipe, not at a turn.`);
  if (!isSquareTurn(doc, nodeId)) throw new Error(`${type.label} has an angle body. Click a 90° elbow to put it there.`);
  const node = getNode(doc, nodeId), edges = connected(doc, nodeId);
  const arriving = edges.find(r => r.flow && flowsInto(r, nodeId)), leaving = edges.find(r => r.flow && !flowsInto(r, nodeId));
  const outlet = edges.find(r => r.id === outletId) ?? leaving ?? edges.find(r => arriving && r !== arriving) ??
    edges.find(r => r.from === nodeId) ?? edges[1];
  const inlet = edges.find(r => r !== outlet)!, spec = getSpec(doc, inlet.specId);
  // A body is sized inlet by outlet.
  const fits = (f: CatalogItem) => f.component === type.code && f.nps === inlet.nps && (f.smallerNps ?? f.nps) === outlet.nps;
  const match = (row && fits(row) && spec.fittings.includes(row) ? row : undefined) ?? spec.fittings.find(fits);
  applyComponent(doc, node, type.code, match);
  node.branchEdgeId = outlet.id;
  return node;
}

/** Smallest step a click places a component along a pipe: 1 mm, or 1/16 in on imperial drawings. */
export const placementStep = (units: IsoDocument['units']) => units === 'mm' ? 1 : 25.4 / 16;
/** A clicked point on a pipe, moved along its straight to the nearest placement step. Pipe ends stay where they are. */
export function snapAlongLeg(doc: IsoDocument, runId: string, fraction: number): { runId: string; fraction: number } {
  const at = legPosition(doc, runId, fraction), leg = pipeLeg(doc, runId);
  if (!at || !leg || !(fraction > 0 && fraction < 1)) return { runId, fraction };
  const step = placementStep(doc.units), snapped = Math.round(at.distance / step) * step;
  if (leg.stations.some(s => Math.abs(s - snapped) < 1e-6)) return { runId, fraction };
  return legPoint(doc, runId, snapped) ?? { runId, fraction };
}

/**
 * The faces the sheet dimensions an in-line component to, as distances along its straight: a flanged component's
 * mating flange faces across the gaskets, a reducer's two ends. Null when the sheet measures it to its centre.
 */
export function componentFaces(doc: IsoDocument, nodeId: string): [number, number] | null {
  const node = getNode(doc, nodeId), track = componentTrack(doc, nodeId);
  if (!track || node.associatedRunId) return null;
  const u = mul(sub(track.to, track.from), 1 / track.length), along = (p: Vec3) => dot(sub(p, track.from), u);
  const outward = (run: PipeRun) => {
    const v = sub(getNode(doc, run.from === nodeId ? run.to : run.from).position, node.position);
    return mul(v, 1 / (length(v) || 1));
  };
  const ports = flangedJoints(doc).filter(j => j.nodeId === nodeId && j.kind === 'component-port');
  const faces = ports.length
    ? ports.flatMap(j => {
      const run = doc.runs.find(r => r.id === j.runIds[0]);
      return run ? [along(add(j.position, mul(outward(run), j.gasket?.thickness ?? 0)))] : [];
    })
    : node.kind === 'reducer' && !/CPLG/.test(nodeCode(doc, node) ?? '')
      ? connected(doc, nodeId).map(run => along(add(node.position, mul(outward(run), takeout(doc, node, run.id) ?? 0))))
      : [];
  return faces.length === 2 ? [Math.min(...faces), Math.max(...faces)] : null;
}

/** A component the sheet dimensions to its faces is placed with its near face, not its centre, on a placement step. */
export function snapNearFace(doc: IsoDocument, nodeId: string): void {
  const faces = componentFaces(doc, nodeId), track = componentTrack(doc, nodeId);
  if (!faces || !track) return;
  const step = placementStep(doc.units), nearest = Math.round(faces[0] / step) * step - faces[0];
  if (Math.abs(nearest) <= 1e-9) return;
  // The nearest step, else the step on the other side; where neither leaves pipe for the fittings, it stays as placed.
  for (const shift of [nearest, nearest > 0 ? nearest - step : nearest + step]) {
    if (!(track.distance + shift > track.min && track.distance + shift < track.max)) continue;
    try { moveComponentAlongPipe(doc, nodeId, track.distance + shift); return } catch { /* try the other side */ }
  }
}

/**
 * A connection a pipe can be routed from: an open end, a joint, elbow or tee that can take a branch, a fitting with a
 * free port, or an olet still waiting for its branch. An in-line valve between two pipes has no free end.
 */
export function canRouteFrom(doc: IsoDocument, nodeId: string): boolean {
  const node = getNode(doc, nodeId), edges = connected(doc, nodeId).length;
  if (node.associatedRunId) return node.kind === 'olet' && edges === 0 && COMPONENT_TYPE_BY_CODE[node.component ?? '']?.ports !== 0;
  if (['end', 'weld', 'elbow90', 'elbow45', 'tee'].includes(node.kind)) return edges < (node.kind === 'tee' ? 4 : 3);
  if (['support', 'annotation', 'gasket', 'bolt'].includes(node.kind)) return false;
  return edges < (COMPONENT_TYPE_BY_CODE[nodeCode(doc, node) ?? '']?.ports ?? (node.kind === 'cap' ? 1 : 2));
}
/** Why a pipe cannot be routed from a connection in a direction: along a pipe already there, or along an olet's header. */
export function routeError(doc: IsoDocument, nodeId: string, delta: Vec3): string | undefined {
  const node = getNode(doc, nodeId), l = length(delta);
  const cos = (v: Vec3) => dot(v, delta) / ((length(v) * l) || 1);
  if (connected(doc, nodeId).some(run => cos(sub(getNode(doc, run.from === nodeId ? run.to : run.from).position, node.position)) > 0.9999))
    return 'A pipe already runs that way from here. Route the new pipe in another direction.';
  const host = doc.runs.find(r => r.id === node.associatedRunId);
  if (host && Math.abs(cos(sub(getNode(doc, host.to).position, getNode(doc, host.from).position))) > 0.9999)
    return 'A branch leaves its header across it. Route the branch in another direction.';
  return undefined;
}

/** A model direction in plant words: "east", "north-west", "south and down". */
export function directionName([x, y, z]: Vec3): string {
  const tiny = 1e-6 * Math.hypot(x, y, z);
  const plan = [y > tiny ? 'north' : y < -tiny ? 'south' : '', x > tiny ? 'east' : x < -tiny ? 'west' : ''].filter(Boolean).join('-');
  const rise = z > tiny ? 'up' : z < -tiny ? 'down' : '';
  return [plan, rise].filter(Boolean).join(' and ') || 'nowhere';
}
/** Whether the flow along a pipe arrives at this end of it. */
const flowsInto = (run: PipeRun, nodeId: string) => (run.flow === 'forward') === (run.to === nodeId);
/** Hold or clear the dimension side along a connected straight, including in-line fittings and tee runs. */
export function setDimensionAxis(doc: IsoDocument, runId: string, axis?: Vec3): void {
  editDimensionStraight(doc,runId,run=>{if(axis)run.dimensionAxis=[...axis];else delete run.dimensionAxis;});
}
/** Reverse the lettering along a dimensioned straight without changing its measurements or extension side. */
export function setDimensionReverse(doc: IsoDocument, runId: string, reverse: boolean): void {
  editDimensionStraight(doc,runId,run=>{if(reverse)run.dimensionReverse=true;else delete run.dimensionReverse;});
}
function editDimensionStraight(doc: IsoDocument, runId: string, edit: (run: PipeRun)=>void): void {
  const first = doc.runs.find(r => r.id === runId);
  if (!first) return;
  const direction = sub(getNode(doc, first.to).position, getNode(doc, first.from).position), span = length(direction);
  const pending = [first], seen = new Set<string>();
  while (pending.length) {
    const run = pending.pop()!;
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    edit(run);
    for (const id of [run.from, run.to]) for (const next of connected(doc, id)) {
      if (next.spool !== first.spool || seen.has(next.id)) continue;
      const d = sub(getNode(doc, next.to).position, getNode(doc, next.from).position);
      if (Math.abs(dot(d, direction)) / (length(d) * span || 1) > 0.9999) pending.push(next);
    }
  }
}
/**
 * Set the flow along a line: this pipe and the pipes it runs on into through joints, elbows, in-line components and
 * the run of a tee, up to an open end. A tee's branch is a line of its own. Clearing it clears the same pipes.
 */
export function setLineFlow(doc: IsoDocument, runId: string, flow: PipeRun['flow']): void {
  const run = doc.runs.find(r => r.id === runId);
  if (!run) throw new Error('Select a pipe to set its flow.');
  const set = (r: PipeRun, f: PipeRun['flow']) => { if (f) r.flow = f; else delete r.flow; };
  set(run, flow);
  const seen = new Set([run.id]);
  for (const end of [run.from, run.to]) {
    for (let at = end, previous = run; ;) {
      const node = getNode(doc, at), edges = connected(doc, at);
      const through = node.kind === 'tee' && edges.length === 3 && node.branchEdgeId && node.branchEdgeId !== previous.id;
      const next = edges.length === 2 || through ? edges.find(r => r.id !== previous.id && r.id !== node.branchEdgeId) : undefined;
      if (node.kind === 'end' || !next || seen.has(next.id) || next.connector) break;
      seen.add(next.id);
      // Flow arriving through the previous pipe leaves through the next one, and the other way about.
      set(next, flow && ((next.from === at) === flowsInto(previous, at) ? 'forward' : 'reverse'));
      at = next.from === at ? next.to : next.from;
      previous = next;
    }
  }
}
/** A pipe routed on from a line carries the line's flow on. */
export function continueFlow(doc: IsoDocument, runId: string): void {
  const run = doc.runs.find(r => r.id === runId);
  if (!run || run.flow) return;
  for (const end of [run.from, run.to]) {
    const edges = connected(doc, end), previous = edges.find(r => r.id !== run.id);
    if (edges.length !== 2 || !previous?.flow) continue;
    run.flow = (run.from === end) === flowsInto(previous, end) ? 'forward' : 'reverse';
    return;
  }
}
