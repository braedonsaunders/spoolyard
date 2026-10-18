import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Drawing, Point } from '../src/core/drawing';
import { appendRun, connected, getNode, insertComponent, newIso, type IsoDocument } from '../src/core/model';
import { EditHistory, serialise } from '../src/editor/history';
import { boxMode, clickSelect, normaliseBox, pickInBox, segmentTouchesBox, type Selectable } from '../src/editor/selection';
import { resolveSnap, snapPoints } from '../src/editor/snaps';
import { completeCommand, dominantAxis, inputDelta, parseCommand, parsePointInput } from '../src/editor/command-line';
import { fitView, screenScale, toScreen, toSheet, viewBox, zoomAbout, type Frame } from '../src/editor/viewport';
import { copySelection, eraseSelection, moveSelection, nextSpool, pastePieces } from '../src/editor/edit-ops';
import { paperUnits } from '../src/editor/paper';

test('undo history coalesces keyed edits inside the pause, and keeps what was selected', () => {
  const h = new EditHistory<string, string[]>(100, 1000);
  h.record('a', ['x'], 'nudge', 0);
  h.record('b', ['x'], 'nudge', 500);
  h.record('c', ['x'], 'nudge', 1400);
  assert.equal(h.undoCount, 1, 'three nudges within the pause are one step');
  h.record('d', ['y'], 'nudge', 3000);
  assert.equal(h.undoCount, 2, 'a nudge after the pause is its own step');
  h.record('e', [], undefined, 3100);
  h.record('f', [], undefined, 3150);
  assert.equal(h.undoCount, 4, 'unkeyed edits never coalesce');
  const back = h.step(false, 'g', ['z'])!;
  assert.equal(back.doc, 'f');
  assert.equal(h.redoCount, 1);
  const forward = h.step(true, back.doc, back.selection)!;
  assert.equal(forward.doc, 'g');
  assert.deepEqual(forward.selection, ['z'], 'redo puts back the selection the edit was made with');
  h.record('h', [], 'k', 4000);
  h.seal();
  h.record('i', [], 'k', 4100);
  assert.equal(h.undoCount, 6, 'a sealed entry does not absorb the next edit');
  h.record('j', [], undefined, 5000);
  assert.equal(h.redoCount, 0, 'a new edit clears redo');
});

test('history keeps a bounded number of steps and serialises a document once', () => {
  const h = new EditHistory<number, null>(3);
  for (let i = 0; i < 5; i++) h.record(i, null);
  assert.equal(h.undoCount, 3);
  assert.equal(h.step(false, 5, null)!.doc, 4);
  const doc = { a: 1 };
  assert.equal(serialise(doc), serialise(doc));
});

const square: Selectable[] = [
  { id: 'inside', segments: [[[10, 10], [20, 10]]], points: [] },
  { id: 'across', segments: [[[15, 15], [60, 15]]], points: [] },
  { id: 'outside', segments: [[[80, 80], [90, 90]]], points: [] },
  { id: 'point', segments: [], points: [[25, 25]] },
];
test('window selects what is wholly inside; crossing selects what it touches', () => {
  const box = normaliseBox([5, 5], [30, 30]);
  assert.deepEqual(pickInBox(square, box, 'window').sort(), ['inside', 'point']);
  assert.deepEqual(pickInBox(square, box, 'crossing').sort(), ['across', 'inside', 'point']);
  assert.equal(boxMode([0, 0], [10, 10]), 'window');
  assert.equal(boxMode([10, 0], [0, 10]), 'crossing');
  assert.ok(segmentTouchesBox([0, 50], [100, 50], [40, 40, 60, 60]), 'a segment passing through touches');
  assert.ok(!segmentTouchesBox([0, 0], [10, 0], [40, 40, 60, 60]));
});

test('clicks replace, toggle, add and remove the selection with the newest pick last', () => {
  assert.deepEqual(clickSelect(['a', 'b'], ['c'], 'replace'), ['c']);
  assert.deepEqual(clickSelect(['a', 'b'], ['c'], 'toggle'), ['a', 'b', 'c']);
  assert.deepEqual(clickSelect(['a', 'b', 'c'], ['b'], 'toggle'), ['a', 'c']);
  assert.deepEqual(clickSelect(['a'], ['b', 'c'], 'add'), ['a', 'b', 'c']);
  assert.deepEqual(clickSelect(['a', 'b', 'c'], ['a', 'c'], 'remove'), ['b']);
  assert.deepEqual(clickSelect(['a', 'b'], ['a'], 'add'), ['b', 'a'], 'adding a selected object makes it primary');
});

/** A drawing that projects plant x, y to the sheet one to one. */
const flat = (doc: IsoDocument): Drawing => {
  const project = (p: [number, number, number]): Point => [p[0], p[1]];
  return { width: 1000, height: 850, area: [0, 0, 1000, 850], fit: { centre: [0, 0], scale: 1 }, primitives: [],
    positions: new Map(doc.nodes.map((n) => [n.id, project(n.position)])), project, view: 'iso' };
};
test('object snaps prefer endpoints, then midpoints, then the nearest point on a pipe', () => {
  const doc = newIso();
  const a = appendRun(doc, null, [100, 0, 0], 'CS40', 2, 'S', '');
  const start = doc.runs[0].from;
  const drawing = flat(doc), points = snapPoints(doc, drawing);
  const all = { endpoint: true, midpoint: true, centre: true, nearest: true };
  assert.equal(resolveSnap(points, doc, drawing, [98, 3], 10, all)?.id, a.id);
  assert.equal(resolveSnap(points, doc, drawing, [98, 3], 10, all)?.kind, 'endpoint');
  const mid = resolveSnap(points, doc, drawing, [52, 2], 10, all)!;
  assert.equal(mid.kind, 'midpoint');
  assert.deepEqual(mid.model, [50, 0, 0]);
  const near = resolveSnap(points, doc, drawing, [30, 4], 10, all)!;
  assert.equal(near.kind, 'nearest');
  assert.ok(Math.abs(near.model[0] - 30) < 1e-9 && near.fraction! > 0.29 && near.fraction! < 0.31);
  assert.equal(resolveSnap(points, doc, drawing, [30, 4], 10, { ...all, nearest: false }), null);
  assert.equal(resolveSnap(points, doc, drawing, [2, 2], 10, all, new Set([start]))?.kind, 'nearest', 'an excluded connection is not snapped to');
  const valve = insertComponent(doc, doc.runs[0].id, 'valve', 0.25);
  const withValve = flat(doc);
  assert.equal(resolveSnap(snapPoints(doc, withValve), doc, withValve, [26, 0], 10, all)?.kind, 'centre');
  assert.equal(resolveSnap(snapPoints(doc, withValve), doc, withValve, [26, 0], 10, all)?.id, valve.id);
});

test('typed points: lengths, directions and relative offsets', () => {
  assert.deepEqual(parsePointInput('@0,1500,300', 'mm'), { kind: 'delta', delta: [0, 1500, 300] });
  assert.deepEqual(parsePointInput('@-200,0', 'mm'), { kind: 'delta', delta: [-200, 0, 0] });
  assert.deepEqual(parsePointInput('N 1500', 'mm'), { kind: 'direction', direction: [0, 1, 0], length: 1500 });
  assert.deepEqual(parsePointInput('2400 up', 'mm'), { kind: 'direction', direction: [0, 0, 1], length: 2400 });
  assert.deepEqual(parsePointInput('E1200', 'mm'), { kind: 'direction', direction: [1, 0, 0], length: 1200 });
  const imperial = parsePointInput("10'", 'imperial');
  assert.equal(imperial.kind, 'length');
  assert.ok(imperial.kind === 'length' && Math.abs(imperial.length - 3048) < 1e-6);
  const down = parsePointInput("d 2' 6\"", 'imperial');
  assert.ok(down.kind === 'direction' && Math.abs(down.length - 762) < 1e-6 && down.direction[2] === -1);
  assert.throws(() => parsePointInput('0,1500,0', 'mm'), /@/);
  assert.throws(() => parsePointInput('@0,0,0', 'mm'), /zero/);
  assert.throws(() => parsePointInput('', 'mm'));
  assert.deepEqual(inputDelta({ kind: 'length', length: 10 }, [0, -1, 0]), [0, -10, 0]);
  assert.throws(() => inputDelta({ kind: 'length', length: 10 }, null), /direction/);
  assert.deepEqual(dominantAxis([3, -40, 2]), [0, -1, 0]);
  assert.equal(dominantAxis([0, 0, 0]), null);
});

test('commands are found by name and alias', () => {
  assert.equal(parseCommand('pipe')?.id, 'pipe');
  assert.equal(parseCommand(' co ')?.id, 'copy');
  assert.equal(parseCommand('z  e')?.id, 'zoom-extents');
  assert.equal(parseCommand('di')?.id, 'measure');
  assert.equal(parseCommand('frobnicate'), undefined);
  assert.ok(completeCommand('zo').every((c) => c.id.startsWith('zoom')));
});

test('the view zooms about the pointer and fits a box', () => {
  const frame: Frame = { width: 1100, height: 850, fill: false }, screen = { width: 1100, height: 850, left: 0, top: 0 };
  const view = { zoom: 1, pan: [0, 0] as Point };
  const at: Point = [200, 300];
  const zoomed = zoomAbout(frame, view, at, 2);
  const before = toScreen(frame, view, screen, at), after = toScreen(frame, zoomed, screen, at);
  assert.ok(Math.hypot(before[0] - after[0], before[1] - after[1]) < 1e-9, 'the point under the pointer stays put');
  assert.ok(Math.abs(screenScale(frame, zoomed, screen) - 2) < 1e-9);
  const back = toSheet(frame, zoomed, screen, after[0], after[1]);
  assert.ok(Math.hypot(back[0] - at[0], back[1] - at[1]) < 1e-9);
  const fitted = fitView(frame, screen, [100, 100, 210, 185], 0);
  const [x, y, w, h] = viewBox(frame, fitted, screen);
  assert.ok(x <= 100 + 1e-9 && y <= 100 + 1e-9 && x + w >= 210 - 1e-9 && y + h >= 185 - 1e-9, 'the box is in view');
  assert.ok(Math.abs(w - 110) < 1e-6 || Math.abs(h - 85) < 1e-6, 'and fills it on one side');
});

test('paper positions read in millimetres or inches from the lower-left corner', () => {
  const metric = paperUnits({ paper: 'a3', units: 'mm' }), imperial = paperUnits({ paper: 'tabloid', units: 'imperial' });
  assert.ok(Math.abs(metric.length(850) - 297) < 1e-9);
  assert.ok(Math.abs(imperial.length(850) - 11) < 1e-9);
  assert.deepEqual(metric.point([0, 850]), [0, 0]);
  const p: Point = [123, 456];
  const round = metric.fromPoint(metric.point(p));
  assert.ok(Math.hypot(round[0] - p[0], round[1] - p[1]) < 1e-9);
});

const tee = () => {
  const doc = newIso();
  const a = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP-001', 'L1');
  const b = appendRun(doc, a.id, [1000, 0, 0], 'CS40', 2, 'SP-001', 'L1');
  appendRun(doc, a.id, [0, 1000, 0], 'CS40', 2, 'SP-001', 'L1');
  return { doc, a, b };
};
test('erasing a selection removes its pipes and leaves no orphan connections', () => {
  const { doc } = tee();
  const branch = doc.runs[2];
  assert.deepEqual(eraseSelection(doc, [branch.id]), []);
  assert.equal(doc.runs.length, 2);
  assert.ok(doc.nodes.every((n) => connected(doc, n.id).length), 'no connection is left without a pipe');
  assert.equal(getNode(doc, doc.runs[0].to).kind, 'weld', 'the tee becomes a straight joint again');
  const problems = eraseSelection(doc, [doc.runs[0].to]);
  assert.equal(problems.length, 0, 'a straight joint between like pipes can be erased');
});

test('moving a selection stretches the pipes to fixed connections and refuses to kink a valve', () => {
  const { doc, b } = tee();
  const before = getNode(doc, b.id).position;
  moveSelection(doc, [b.id], [0, 0, 500]);
  assert.deepEqual(getNode(doc, b.id).position, [before[0], before[1], 500]);
  const second = doc.runs[1];
  insertComponent(doc, second.id, 'valve', 0.5);
  const valve = doc.nodes.find((n) => n.kind === 'valve')!;
  assert.throws(() => moveSelection(doc, [valve.id], [0, 300, 0]), /slide along/);
});

test('copy and paste make new pieces on a new spool, offset as asked', () => {
  const { doc } = tee();
  const clip = copySelection(doc, doc.runs.map((r) => r.id))!;
  assert.equal(clip.runs.length, 3);
  const before = doc.runs.length;
  const pasted = pastePieces(doc, clip, [0, 5000, 0]);
  assert.equal(doc.runs.length, before + 3);
  assert.deepEqual(pasted.spools, ['SP-002']);
  const ids = new Set(doc.nodes.map((n) => n.id));
  assert.equal(ids.size, doc.nodes.length, 'every pasted connection has its own id');
  assert.ok(doc.runs.every((r) => ids.has(r.from) && ids.has(r.to)));
  assert.equal(nextSpool(['SP-009', 'X']), 'SP-010');
  assert.equal(copySelection(doc, []), null);
});

test('dragging a turn along its pipe stretches that pipe and carries the rest of the line with it', async () => {
  const { stretchLeg } = await import('../src/editor/edit-ops');
  const doc = newIso();
  const a = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'S', '');
  const b = appendRun(doc, a.id, [0, 1000, 0], 'CS40', 2, 'S', '');
  stretchLeg(doc, doc.runs[0].id, a.id, [500, 0, 0]);
  assert.deepEqual(getNode(doc, a.id).position, [1500, 0, 0]);
  assert.deepEqual(getNode(doc, b.id).position, [1500, 1000, 0], 'the next leg keeps its length and direction');
  assert.throws(() => stretchLeg(doc, doc.runs[0].id, a.id, [-2000, 0, 0]), /close up/);
});

test('an edit after undo is its own step, even under the key of the entry now on top', () => {
  const h = new EditHistory<string, string[]>(100, 1000);
  h.record('a', [], 'nudge:x', 0);
  h.record('b', [], undefined, 100);
  assert.ok(h.step(false, 'c', []), 'undo the unkeyed edit');
  // Back on top is the keyed entry; a nudge right after must not fold into it, or undo would skip a state.
  h.record('b', [], 'nudge:x', 200);
  assert.equal(h.undoCount, 2);
  assert.equal(h.step(false, 'd', [])!.doc, 'b', 'undo returns to the state after the undo, not before the first nudge');
});

test('the selection keeps only what is still in the drawing, sheet callouts included', async () => {
  const { existing } = await import('../src/editor/selection');
  const { doc, a } = tee();
  doc.sheetNotes = [{ id: 'note-1', spool: 'SP-001', text: 'NOTE', at: [10, 10] } as NonNullable<IsoDocument['sheetNotes']>[number]];
  const run = doc.runs[0].id;
  assert.deepEqual(existing(doc, [run, a.id, 'note-1', 'gone']), [run, a.id, 'note-1']);
  assert.deepEqual(existing(doc, []), []);
});

test('erasing a selection takes sheet callouts with it', () => {
  const { doc } = tee();
  doc.sheetNotes = [
    { id: 'note-1', spool: 'SP-001', text: 'ONE', at: [10, 10] },
    { id: 'note-2', spool: 'SP-001', text: 'TWO', at: [20, 20] },
  ] as NonNullable<IsoDocument['sheetNotes']>;
  const runs = doc.runs.length;
  assert.deepEqual(eraseSelection(doc, ['note-1']), []);
  assert.deepEqual(doc.sheetNotes!.map((n) => n.id), ['note-2']);
  assert.equal(doc.runs.length, runs, 'no pipe goes with a callout');
});

test('a negative typed distance goes the other way, with a direction or along the cursor', () => {
  assert.deepEqual(parsePointInput('N -600', 'mm'), { kind: 'direction', direction: [0, -1, 0], length: 600 });
  assert.deepEqual(parsePointInput("-2' 6\" up", 'imperial'), { kind: 'direction', direction: [0, 0, -1], length: 762 });
  const back = parsePointInput('-1500', 'mm');
  assert.deepEqual(back, { kind: 'length', length: -1500 });
  assert.deepEqual(inputDelta(back, [1, 0, 0]), [-1500, 0, 0]);
  assert.throws(() => parsePointInput('N 0', 'mm'), /greater than zero/);
  assert.throws(() => parsePointInput('-0', 'mm'), /greater than zero/);
});

test('a window erase takes the corners of its pipes without asking for the pipes they still join', () => {
  const doc = newIso();
  const a = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP-001', 'L1');
  const b = appendRun(doc, a.id, [0, 1000, 0], 'CS40', 2, 'SP-001', 'L1');
  appendRun(doc, b.id, [0, 0, 1000], 'CS40', 2, 'SP-001', 'L1');
  const first = doc.runs[0];
  assert.deepEqual(eraseSelection(doc, [first.id, first.from, first.to]), []);
  assert.equal(doc.runs.length, 2);
  assert.equal(getNode(doc, a.id).kind, 'end', 'the corner left with one pipe is an open end');
  assert.ok(!doc.nodes.some((n) => n.id === first.from), 'the open end of the erased pipe goes with it');
});
