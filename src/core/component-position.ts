import { COMPONENT_TYPES, COMPONENT_TYPE_BY_CODE, type ComponentType } from './components';
import { catalogRow, defaultCode, flangedJoints, nodeCode } from './joints';
import { connected, fitting, getNode, getSpec, length, sub, add, mul, prepAt, runResult, insertComponent, attachComponent, applyComponent, setAutoFitting, takeout, type CatalogItem, type IsoDocument, type PipeNode, type PipeRun, type PipeSpec, type Vec3 } from './model';

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
  const spec = getSpec(doc, run.specId), specRows = spec.fittings;
  const code = (f: CatalogItem) => f.component ?? COMPONENT_TYPES.find(t => t.kind === f.kind)?.code;
  // A reducer, tee or olet goes in at the size chosen for it; a reducer reduces or expands the pipe beyond it.
  const size = sized(type) ? row ?? sizeChoices(spec, type, run.nps)[0]?.row : undefined;
  const beyond = size && sizeBeyond(type, size, run.nps);
  const match = size
    ? specRows.find(f => f.id === size.id)
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
  for (const edge of connected(doc, node.id)) {
    const cut = runResult(doc, edge).cut;
    if (Number.isFinite(cut) && cut <= 0)
      throw new Error('That position leaves no pipe after fitting takeouts and root gaps. Choose a point farther from the end.');
  }
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
  const step = placementStep(doc.units), shift = Math.round(faces[0] / step) * step - faces[0];
  if (Math.abs(shift) > 1e-9 && track.distance + shift > track.min && track.distance + shift < track.max)
    moveComponentAlongPipe(doc, nodeId, track.distance + shift);
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
