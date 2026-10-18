import { formatLength, parseLength } from "../core/format";
import { pipeOd } from "../core/standards";
import {
  add,
  clone,
  connected,
  fitting,
  getNode,
  getSpec,
  itemName,
  prepAt,
  runResult,
  WELDED_SUPPORTS,
  id as newId,
  pruneSheetAnchors,
  removeComponent,
  setAutoFitting,
  sub,
  type IsoDocument,
  type PipeNode,
  type PipeRun,
  type PipeSpec,
  type Vec3,
} from "../core/model";

/**
 * Edits that act on a selection of pipes and components: erase, move by a plant offset, and copy to and paste from
 * the clipboard. Each runs inside one commit, so the whole operation is one undo step.
 */

/** Kinds that are a pipe end or a change of direction: moving them reshapes the pipes they join. */
const JOINT_KINDS = new Set(["end", "weld", "elbow90", "elbow45", "tee"]);

/** Erases the pipes and components selected. Returns what could not be erased and why. */
export function eraseSelection(d: IsoDocument, ids: readonly string[]): string[] {
  const problems: string[] = [];
  // Sheet callouts go on their own; they hold no piping.
  if (d.sheetNotes?.some((n) => ids.includes(n.id))) d.sheetNotes = d.sheetNotes.filter((n) => !ids.includes(n.id));
  const runs = new Set(ids.filter((id) => d.runs.some((r) => r.id === id)));
  const ends = new Set<string>();
  for (const run of d.runs.filter((r) => runs.has(r.id))) { ends.add(run.from); ends.add(run.to); }
  d.runs = d.runs.filter((r) => !runs.has(r.id));
  d.nodes = d.nodes.filter((n) => !n.associatedRunId || !runs.has(n.associatedRunId));
  for (const nodeId of ids) {
    if (runs.has(nodeId)) continue;
    const node = d.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    // A joint at an end of an erased pipe (a window takes its corners with it) goes, or becomes an open end, with
    // the pipes it joined; erasing it as well would ask for the pipes it still joins to go first.
    if (!node.associatedRunId && JOINT_KINDS.has(node.kind) && ends.has(nodeId)) continue;
    // A fitting on a pipe end (a cap, a flange, an elbow left with one pipe) goes, leaving the pipe's open end; the
    // open end itself goes only with its pipe.
    if (!node.associatedRunId && connected(d, nodeId).length === 1) {
      if (node.kind === "end") problems.push("An open end goes with its pipe. Select the pipe to erase it.");
      else toOpenEnd(d, nodeId);
      continue;
    }
    try {
      removeComponent(d, nodeId);
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  // Connections left with no pipe go too; the rest are re-fitted for the pipes they still join.
  const orphan = (n: PipeNode) => !n.associatedRunId && !connected(d, n.id).length;
  d.nodes = d.nodes.filter((n) => !orphan(n));
  for (const key of ends) if (d.nodes.some((n) => n.id === key)) setAutoFitting(d, key);
  if (d.references) d.references = d.references.filter((r) => d.nodes.some((n) => n.id === r.atNodeId));
  pruneSheetAnchors(d);
  return problems;
}

/** The connections a selection moves: selected connections and both ends of selected pipes. */
export function movedNodes(d: IsoDocument, ids: readonly string[]): Set<string> {
  const moved = new Set<string>();
  for (const id of ids) {
    const run = d.runs.find((r) => r.id === id);
    if (run) { moved.add(run.from); moved.add(run.to); continue; }
    const node = d.nodes.find((n) => n.id === id);
    if (node && !node.associatedRunId) moved.add(node.id);
  }
  return moved;
}

const ZERO: Vec3 = [0, 0, 0];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const same = (a: Vec3, b: Vec3, tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const isZero = (a: Vec3) => same(a, ZERO);
const parallel = (u: Vec3, v: Vec3) => {
  const lu = Math.hypot(...u), lv = Math.hypot(...v);
  return lu > 0 && lv > 0 && Math.abs(dot(u, v)) / (lu * lv) > 1 - 1e-9;
};

/**
 * How far a component on a pipe (an olet, a support, an annotation, a tie point) moves when the pipe's ends move by
 * `atFrom` and `atTo`. A pipe moved whole carries it with it. A pipe that only grows or shrinks along its own line
 * leaves it where it is in the plant, so a branch from it keeps its length and stays square. A pipe swung to a new
 * direction keeps it at its fraction along.
 */
function attachmentShift(d: IsoDocument, n: PipeNode, host: PipeRun, atFrom: Vec3, atTo: Vec3): Vec3 {
  if (same(atFrom, atTo)) return atFrom;
  const a0 = getNode(d, host.from).position, b0 = getNode(d, host.to).position, u0 = sub(b0, a0);
  const u = sub(add(b0, atTo), add(a0, atFrom)), uu = dot(u0, u0);
  if (!uu) return atFrom;
  // Along the same line (or a parallel one): only the move across the pipe applies.
  if (parallel(u0, u)) return sub(atFrom, scale(u0, dot(atFrom, u0) / uu));
  const t = dot(sub(n.position, a0), u0) / uu;
  return add(atFrom, scale(sub(atTo, atFrom), t));
}

/** Clear distance (mm) from a component on a pipe to the nearer end weld or pipe end; negative when it is on it. */
function clearOfWelds(d: IsoDocument, n: PipeNode, host: PipeRun): { clear: number; end: PipeNode; onPipe: boolean } {
  const a = getNode(d, host.from), b = getNode(d, host.to), u = sub(b.position, a.position), l = Math.hypot(...u);
  const s = l ? dot(sub(n.position, a.position), u) / l : 0;
  const across = l ? Math.hypot(...sub(sub(n.position, a.position), scale(u, s / l))) : Infinity;
  const onPipe = across < 0.5 && s >= -0.5 && s <= l + 0.5;
  // Olets and welded supports are welded to the pipe; they must stand clear of the pipe's own end welds.
  const welded = n.kind === "olet" || (n.kind === "support" && WELDED_SUPPORTS.test(n.component ?? fitting(d, n)?.component ?? ""));
  if (!welded) return { clear: Math.min(s, l - s), end: s < l / 2 ? a : b, onPipe };
  let result: ReturnType<typeof runResult> | undefined;
  try { result = runResult(d, host); } catch { result = undefined; }
  const branch = connected(d, n.id)[0];
  const sizeOf = (r: PipeRun | undefined) => r && (getSpec(d, r.specId).sizes.find((z) => z.nps === r.nps)?.od ?? pipeOd(r.nps));
  const half = (sizeOf(branch) ?? pipeOd(fitting(d, n)?.nps ?? 0) ?? 0) / 2;
  const open = (e: PipeNode) => ["end", "support", "annotation"].includes(e.kind);
  const weld = (i: 0 | 1, e: PipeNode) => open(e) || !result ? 0 : (Number.isFinite(result.takeouts[i]) ? result.takeouts[i] : 0) + (result.gaps[i] ?? 0);
  const fromA = s - half - weld(0, a), fromB = l - s - half - weld(1, b);
  return { clear: Math.min(fromA, fromB), end: fromA <= fromB ? a : b, onPipe };
}

/**
 * Moves connections by the plant offsets in `shifts` (a connection not listed stays). Pipes between connections
 * moved differently stretch; the components on them follow (see `attachmentShift`), and an olet that moves takes
 * its branch with it as one piece, so the branch keeps its length and direction. A component pushed off its pipe or
 * onto one of the pipe's end welds stops the move. `fixed` connections may not move (the far end of a stretched pipe);
 * `refit` re-fits the joints for their new angles (a stretch keeps every angle).
 */
function displace(d: IsoDocument, shifts: Map<string, Vec3>, fixed: ReadonlySet<string> = new Set(), refit = true) {
  const runOf = new Map(d.runs.map((r) => [r.id, r]));
  const attachments = d.nodes.filter((n) => n.associatedRunId && runOf.has(n.associatedRunId));
  // How clear of its pipe's end welds each component on a reshaped pipe was before the move.
  const branchOf = (n: PipeNode) => connected(d, n.id).length > 0;
  const before = new Map<string, number>();
  const carry = (n: PipeNode, host: PipeRun, by: Vec3) => {
    const queue = [n.id], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++)
      for (const edge of connected(d, queue[i])) {
        const other = edge.from === queue[i] ? edge.to : edge.from;
        if (seen.has(other)) continue;
        seen.add(other);
        if (other === host.from || other === host.to || fixed.has(other))
          throw new Error(`The ${itemName(d, n)}'s branch joins back into its header. Move the branch pipes with it, or one at a time.`);
        const known = shifts.get(other);
        if (known) {
          if (!same(known, by, 1e-3)) throw new Error(`The ${itemName(d, n)} has to take its branch with it, but part of the branch is being moved differently. Select the branch with it, or move one at a time.`);
          continue;
        }
        shifts.set(other, by);
        queue.push(other);
      }
  };
  // Settle each component once its pipe's ends are known; an olet that moves adds its branch to what moves.
  const settled = new Map<string, Vec3>(), sliding = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const n of attachments) {
      if (settled.has(n.id)) continue;
      const host = runOf.get(n.associatedRunId!)!, atFrom = shifts.get(host.from), atTo = shifts.get(host.to), own = shifts.get(n.id);
      if (!atFrom && !atTo && !own) continue;
      if (!before.has(n.id)) before.set(n.id, clearOfWelds(d, n, host).clear);
      let by = attachmentShift(d, n, host, atFrom ?? ZERO, atTo ?? ZERO);
      if (own) {
        // Moved itself (its branch was selected): it may slide along its pipe, not leave it.
        const slide = sub(own, by), u = sub(getNode(d, host.to).position, getNode(d, host.from).position);
        if (!isZero(slide) && !parallel(slide, u)) {
          // Moving its branch out along the branch stretches the branch: the outlet stays on its pipe.
          const branch = connected(d, n.id)[0], far = branch && getNode(d, branch.from === n.id ? branch.to : branch.from);
          if (!far || !parallel(slide, sub(far.position, n.position)))
            throw new Error(`The ${itemName(d, n)} can only slide along its pipe. Move it along the pipe, or move the pipe with it.`);
          shifts.delete(n.id);
        } else { by = own; sliding.add(n.id); }
      }
      settled.set(n.id, by);
      changed = true;
      if (!isZero(by)) {
        shifts.set(n.id, by);
        if (branchOf(n)) carry(n, host, by);
      }
    }
  }
  // A pipe end a later branch moved after its components were settled would leave them stale: refuse.
  for (const [nodeId, by] of settled) {
    if (sliding.has(nodeId)) continue;
    const n = getNode(d, nodeId), host = runOf.get(n.associatedRunId!)!;
    if (!same(attachmentShift(d, n, host, shifts.get(host.from) ?? ZERO, shifts.get(host.to) ?? ZERO), by, 1e-3))
      throw new Error("Pipes branching from one another are moved by different amounts. Move them one at a time.");
  }
  for (const key of fixed) if (shifts.has(key) && !isZero(shifts.get(key)!)) throw new Error("This pipe is in a closed loop. Move its connections one at a time.");
  for (const n of d.nodes) {
    const by = shifts.get(n.id) ?? settled.get(n.id);
    if (by && !isZero(by)) n.position = add(n.position, by);
  }
  for (const r of d.runs) {
    const length = Math.hypot(...sub(getNode(d, r.to).position, getNode(d, r.from).position));
    if (length < 0.001) throw new Error("The move would close a pipe up to nothing. Move a shorter distance.");
  }
  // A component must stay on its pipe, and an olet or welded support may not be pushed onto an end weld.
  for (const n of attachments) {
    if (!before.has(n.id)) continue;
    const host = runOf.get(n.associatedRunId!)!, after = clearOfWelds(d, n, host), was = before.get(n.id) ?? after.clear;
    const name = itemName(d, n), end = after.end.kind === "end" ? "open end" : itemName(d, after.end);
    if (!after.onPipe) throw new Error(`The move would take the ${name} off its pipe. Move a shorter distance, or move the ${name} first.`);
    if (after.clear < -0.01 && after.clear < was - 0.01)
      throw new Error(`The move would put the ${name} ${after.clear < -0.5 ? `${formatLength(-after.clear, d.units)} onto` : "against"} the weld at the ${end}. Move a shorter distance, or slide the ${name} along its pipe first.`);
  }
  if (!refit) return;
  // Components in a pipe only slide along it; joints are re-fitted for the pipes they now join.
  const ends = new Set<string>();
  for (const r of d.runs) if (shifts.has(r.from) || shifts.has(r.to)) { ends.add(r.from); ends.add(r.to); }
  for (const key of ends) {
    const node = getNode(d, key), edges = connected(d, key);
    if (node.associatedRunId) continue;
    if (!JOINT_KINDS.has(node.kind) && edges.length === 2) {
      const [u, v] = edges.map((r) => sub(getNode(d, r.from === key ? r.to : r.from).position, node.position));
      const cos = dot(u, v) / (Math.hypot(...u) * Math.hypot(...v) || 1);
      if (cos > -0.99999) throw new Error("A component in a pipe can only slide along it. Move the pipe with it, or move it along its pipe.");
    }
    setAutoFitting(d, key);
  }
}

/**
 * Moves a selection by a plant offset. Pipes between a moved and a fixed connection stretch with it. A component on
 * a pipe keeps its plant position while its pipe only grows or shrinks, and moves with the pipe when the pipe moves;
 * an olet takes its branch with it. A component in a pipe may only slide along it: it cannot kink it.
 */
export function moveSelection(d: IsoDocument, ids: readonly string[], delta: Vec3) {
  if (!delta.every(Number.isFinite) || delta.every((v) => v === 0)) throw new Error("Enter how far to move.");
  const moved = movedNodes(d, ids);
  if (!moved.size) throw new Error("Select the pipes or connections to move.");
  displace(d, new Map([...moved].map((key) => [key, delta])));
}

/** What Copy puts on the clipboard: whole pipes with their connections and the components on them. */
export interface Clipboard {
  schema: "spoolyard-clipboard";
  version: 1;
  units: IsoDocument["units"];
  runs: PipeRun[];
  nodes: PipeNode[];
  specs: PipeSpec[];
}
export const CLIPBOARD_MIME = "application/x-spoolyard-pieces";

/** The selected pipes as pieces to paste; null when no pipe is selected. */
export function copySelection(doc: IsoDocument, ids: readonly string[]): Clipboard | null {
  const chosen = new Set(ids);
  // A selected connection brings the pipes between selected connections.
  const runs = doc.runs.filter((r) => chosen.has(r.id) || (chosen.has(r.from) && chosen.has(r.to)));
  if (!runs.length) return null;
  const runIds = new Set(runs.map((r) => r.id));
  const nodeIds = new Set(runs.flatMap((r) => [r.from, r.to]));
  const nodes = doc.nodes.filter((n) => nodeIds.has(n.id) || (n.associatedRunId && runIds.has(n.associatedRunId)));
  const specs = doc.specs.filter((s) => runs.some((r) => r.specId === s.id));
  return clone({ schema: "spoolyard-clipboard", version: 1, units: doc.units, runs, nodes, specs });
}
export function readClipboard(text: string): Clipboard | null {
  try {
    const value = JSON.parse(text);
    return value?.schema === "spoolyard-clipboard" && Array.isArray(value.runs) && Array.isArray(value.nodes) ? (value as Clipboard) : null;
  } catch {
    return null;
  }
}
/** The next free spool number after the drawing's highest, as SP-001. */
export function nextSpool(spools: Iterable<string>, prefix = "SP-") {
  const numbers = [...spools].map((s) => Number(/(\d+)$/.exec(s)?.[1] ?? 0));
  return prefix + String(Math.max(0, ...numbers) + 1).padStart(3, "0");
}
/** Plant extent of pasted pieces, to place a paste clear of what it was copied from. */
export function clipboardExtent(clip: Clipboard): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const n of clip.nodes) n.position.forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); });
  return [lo, hi];
}

/**
 * Pastes pieces offset by `delta`, as new spools so a pasted spool is a sheet of its own (a spool name not yet in the
 * drawing is kept). Returns the new pipes' and components' ids and the spools they went to.
 */
export function pastePieces(d: IsoDocument, clip: Clipboard, delta: Vec3): { ids: string[]; spools: string[] } {
  const ids = new Map<string, string>();
  const fresh = (old: string) => { let v = ids.get(old); if (!v) ids.set(old, (v = newId())); return v; };
  for (const spec of clip.specs) if (!d.specs.some((s) => s.id === spec.id)) d.specs.push(clone(spec));
  const taken = new Set(d.runs.map((r) => r.spool)), spoolMap = new Map<string, string>();
  for (const s of new Set(clip.runs.map((r) => r.spool))) {
    const name = taken.has(s) ? nextSpool([...taken, ...spoolMap.values()]) : s;
    spoolMap.set(s, name);
    taken.add(name);
  }
  const pipes = new Set(clip.runs.map((r) => r.id));
  const nodes = clip.nodes.map((n): PipeNode => {
    // A branch copied without its header leaves its olet behind: the pasted branch starts at an open end.
    if (n.associatedRunId && !pipes.has(n.associatedRunId)) return { id: fresh(n.id), kind: "end", position: add(n.position, delta) };
    const copy = clone(n);
    copy.id = fresh(n.id);
    copy.position = add(n.position, delta);
    if (copy.associatedRunId) copy.associatedRunId = fresh(copy.associatedRunId);
    if (copy.branchEdgeId) copy.branchEdgeId = clip.runs.some((r) => r.id === copy.branchEdgeId) ? fresh(copy.branchEdgeId) : undefined;
    if (copy.portTakeouts) copy.portTakeouts = Object.fromEntries(Object.entries(copy.portTakeouts).filter(([k]) => clip.runs.some((r) => r.id === k)).map(([k, v]) => [fresh(k), v]));
    if (copy.portFlanges) copy.portFlanges = Object.fromEntries(Object.entries(copy.portFlanges).filter(([k]) => clip.runs.some((r) => r.id === k)).map(([k, v]) => [fresh(k), v]));
    // Weld and tie-point tags are per sheet; the copy is numbered anew.
    delete copy.tag;
    delete copy.tiePoint;
    return copy;
  });
  const runs = clip.runs.map((r) => {
    const copy = clone(r);
    copy.id = fresh(r.id);
    copy.from = fresh(r.from);
    copy.to = fresh(r.to);
    copy.spool = spoolMap.get(r.spool) ?? r.spool;
    delete copy.fromTag;
    delete copy.toTag;
    return copy;
  });
  d.nodes.push(...nodes);
  d.runs.push(...runs);
  for (const n of nodes) if (!n.associatedRunId) setAutoFitting(d, n.id);
  return { ids: [...runs.map((r) => r.id)], spools: [...new Set(spoolMap.values())] };
}

/**
 * Drags a connection along one of its pipes: that pipe lengthens or shortens, and everything beyond the connection
 * (its other pipes and what they lead to) moves with it, so every other length and every square turn is kept, as
 * when a length is typed. Components on the stretched pipe keep their place along it from its fixed end.
 */
export function stretchLeg(d: IsoDocument, runId: string, nodeId: string, delta: Vec3) {
  const run = d.runs.find((r) => r.id === runId);
  if (!run || (run.from !== nodeId && run.to !== nodeId)) throw new Error("Drag a connection along one of its own pipes.");
  const fixed = run.from === nodeId ? run.to : run.from;
  const moving = new Set([nodeId]), queue = [nodeId];
  for (let i = 0; i < queue.length; i++)
    for (const edge of connected(d, queue[i]).filter((r) => r.id !== runId)) {
      const other = edge.from === queue[i] ? edge.to : edge.from;
      if (other === fixed) throw new Error("This pipe is in a closed loop. Move its connections one at a time.");
      if (!moving.has(other)) { moving.add(other); queue.push(other); }
    }
  const a = getNode(d, fixed).position, b0 = getNode(d, nodeId).position, along = sub(b0, a);
  const next = Math.hypot(...sub(add(b0, delta), a));
  if (!(next > 0.001) || along.reduce((s, v, i) => s + v * (b0[i] + delta[i] - a[i]), 0) <= 0) throw new Error("The pipe would close up to nothing. Drag a shorter distance.");
  // The components on the stretched pipe stay where they are; those beyond, with their branches, move with the line.
  displace(d, new Map([...moving].map((key) => [key, delta])), new Set([fixed]), false);
}

/** The branch size an olet is for: its row's branch (a header-by-branch row's smaller end), or a standard row's size. */
export function oletBranchSize(d: IsoDocument, node: PipeNode): number | undefined {
  const row = fitting(d, node);
  if (row) return row.smallerNps ?? row.nps;
  // A standard part (no specification row) is named std:CODE:SIZE.
  const size = Number(/^std:[^:]+:([\d.]+)$/.exec(node.catalogId ?? "")?.[1]);
  return Number.isFinite(size) && size > 0 ? size : undefined;
}

/**
 * Sizes an olet to the branch routed from it: the specification's row for this header and branch size (a
 * header-by-branch row, else a row by branch size), else the standard part for the branch, which its pipes size.
 * Returns whether the olet changed.
 */
export function fitOletToBranch(d: IsoDocument, nodeId: string): boolean {
  const node = d.nodes.find((n) => n.id === nodeId);
  const header = node?.kind === "olet" ? d.runs.find((r) => r.id === node.associatedRunId) : undefined;
  const branch = node && connected(d, node.id)[0];
  if (!node || !header || !branch || oletBranchSize(d, node) === branch.nps) return false;
  const code = node.component ?? fitting(d, node)?.component;
  if (!code) return false;
  const rows = getSpec(d, header.specId).fittings.filter((f) => f.component === code);
  const row = rows.find((f) => f.nps === header.nps && f.smallerNps === branch.nps) ?? rows.find((f) => f.nps === branch.nps && (f.smallerNps == null || f.smallerNps === f.nps));
  if (row) node.catalogId = row.id;
  else delete node.catalogId;
  // Dimensions entered for the old size do not hold for the new one.
  delete node.takeout;
  delete node.branchTakeout;
  delete node.portTakeouts;
  delete node.description;
  return true;
}

/**
 * A bend radius as the drafter writes it: a multiple of the pipe's outside diameter ("5D", "1.5 D", the usual way to
 * name a pipe bend) or a length ("600", "24\"", "2' 0"). `od` is the pipe's outside diameter (mm).
 */
export function parseBendRadius(raw: string, units: IsoDocument["units"], od: number | undefined): number {
  const multiple = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*d\s*$/i.exec(raw);
  if (multiple) {
    if (!(od && od > 0)) throw new Error("The pipe's outside diameter is not known, so a radius in D cannot be worked out. Enter the radius as a length.");
    const n = Number(multiple[1]);
    if (!(n > 0)) throw new Error("Enter a bend radius greater than zero, e.g. 5D or 600.");
    return n * od;
  }
  const value = parseLength(raw, units);
  if (!(value > 0)) throw new Error("Enter a bend radius greater than zero, e.g. 5D or 600.");
  return value;
}

/**
 * Routing on from an open end in the direction its pipe already runs, at the same size, specification and end
 * preparation, lengthens that pipe: there is no joint there to weld, so no new connection and no extra cut piece.
 * Returns the lengthened pipe, or null when the route needs a new pipe (a turn, a change of size, or a joint).
 */
export function extendRun(d: IsoDocument, nodeId: string, delta: Vec3, route: { specId: string; nps: number; spool: string; line: string; prep: PipeRun["endPrep"] }): PipeRun | null {
  const node = d.nodes.find((n) => n.id === nodeId), edges = node ? connected(d, node.id) : [];
  if (!node || node.kind !== "end" || node.associatedRunId || edges.length !== 1) return null;
  const run = edges[0], index = run.from === node.id ? 0 : 1;
  if (run.connector || run.nipple || run.uncut || run.nps !== route.nps || run.specId !== route.specId || run.spool !== route.spool || run.line !== route.line) return null;
  if (prepAt(run, index) !== route.prep) return null;
  const along = sub(node.position, getNode(d, index === 0 ? run.to : run.from).position);
  if (!parallel(along, delta) || dot(along, delta) <= 0) return null;
  const next = add(node.position, delta);
  // Onto an existing connection the route joins it: that is a new pipe.
  if (d.nodes.some((n) => n.id !== node.id && Math.hypot(...sub(n.position, next)) < 0.001)) return null;
  node.position = next;
  return run;
}

/**
 * Puts a pipe end back to an open end: the fitting there (an elbow left with one pipe, a cap, a flange) goes, and the
 * pipe end takes the pipe's own preparation again.
 */
export function toOpenEnd(d: IsoDocument, nodeId: string): void {
  const node = getNode(d, nodeId), edges = connected(d, nodeId);
  if (node.associatedRunId || edges.length !== 1) throw new Error("Only a pipe end with one pipe can be an open end.");
  node.kind = "end";
  for (const key of ["catalogId", "component", "takeout", "branchTakeout", "portTakeouts", "branchEdgeId", "description", "bendAngle", "bendRadius",
    "flatSide", "portFlanges", "valveSymbol", "valveOperator", "operator", "symbol", "symbolPlane", "weightKg", "areaM2", "unitCost", "laborHours"] as const) delete node[key];
  const run = edges[0];
  delete run[run.from === nodeId ? "fromPrep" : "toPrep"];
}
