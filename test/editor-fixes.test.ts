import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, connected, getNode, newIso, runResult, validateIso } from '../src/core/model.ts';
import { createDrawing } from '../src/core/drawing.ts';
import { eraseSelection, extendRun, parseBendRadius, toOpenEnd } from '../src/editor/edit-ops.ts';
import { COMMON_NPS, routingSizes } from '../src/editor/library.ts';
import { inkExtents } from '../src/editor/viewport.ts';

test('a bend radius is taken as a multiple of the outside diameter (5D) or as a length', () => {
  assert.equal(parseBendRadius('5D', 'mm', 60.3), 5 * 60.3);
  assert.equal(parseBendRadius('1.5 d', 'mm', 100), 150);
  assert.equal(parseBendRadius('600', 'mm', 60.3), 600);
  assert.equal(parseBendRadius('24"', 'imperial', 60.3), 24 * 25.4);
  assert.throws(() => parseBendRadius('5D', 'mm', undefined), /outside diameter is not known/);
  assert.throws(() => parseBendRadius('0D', 'mm', 60.3), /greater than zero/);
  assert.throws(() => parseBendRadius('0', 'mm', 60.3), /greater than zero/);
});

test('routing straight on from an open end lengthens the pipe instead of welding on another', () => {
  const doc = newIso(), spec = doc.specs[0].id;
  const end = appendRun(doc, null, [1219.2, 0, 0], spec, 2, 'SP-001', 'L-1');
  const route = { specId: spec, nps: 2, spool: 'SP-001', line: 'L-1', prep: 'BW' as const };
  const run = extendRun(doc, end.id, [914.4, 0, 0], route);
  assert.ok(run, 'N 4\' then N 3\' is one pipe');
  assert.equal(doc.runs.length, 1);
  assert.equal(doc.nodes.length, 2, 'no joint is added');
  assert.ok(Math.abs(runResult(doc, run).overall - 2133.6) < 1e-6);
  // A turn, another size, or another line is a new pipe.
  assert.equal(extendRun(doc, end.id, [0, 500, 0], route), null);
  assert.equal(extendRun(doc, end.id, [500, 0, 0], { ...route, nps: 3 }), null);
  assert.equal(extendRun(doc, end.id, [500, 0, 0], { ...route, line: 'L-2' }), null);
  assert.equal(extendRun(doc, end.id, [-500, 0, 0], route), null, 'back along the pipe is not an extension');
  // From a fitting (an elbow), never.
  const corner = appendRun(doc, end.id, [0, 1000, 0], spec, 2, 'SP-001', 'L-1');
  assert.equal(getNode(doc, end.id).kind, 'elbow90');
  assert.equal(extendRun(doc, end.id, [0, 500, 0], route), null);
  assert.ok(extendRun(doc, corner.id, [0, 500, 0], route));
});

test('an elbow left on a pipe end goes back to an open end; erasing an open end says to erase its pipe', () => {
  const doc = newIso(), spec = doc.specs[0].id;
  const end = appendRun(doc, null, [1000, 0, 0], spec, 2, 'SP-001', 'L-1');
  const node = getNode(doc, end.id);
  applyComponent(doc, node, 'W-LR90EL');
  assert.equal(node.kind, 'elbow90');
  toOpenEnd(doc, node.id);
  assert.equal(node.kind, 'end');
  assert.equal(node.component, undefined);
  // A cap on the end erased leaves the open end; the open end itself goes only with its pipe.
  applyComponent(doc, node, 'W-CAP');
  assert.deepEqual(eraseSelection(doc, [node.id]), []);
  assert.equal(getNode(doc, node.id).kind, 'end');
  assert.match(eraseSelection(doc, [node.id])[0], /goes with its pipe/);
  assert.equal(connected(doc, node.id).length, 1);
  assert.ok(!validateIso(doc).some((i) => /needs/.test(i)));
});

test('a specification without a size table is routed at the sizes its pipes use', () => {
  const doc = newIso(), spec = { ...doc.specs[0], id: 'PCF', sizes: [] };
  doc.specs.push(spec);
  assert.deepEqual(routingSizes(doc, spec), { sizes: COMMON_NPS, listed: false });
  appendRun(doc, null, [1000, 0, 0], 'PCF', 4, 'S', '');
  appendRun(doc, null, [1000, 0, 0], 'PCF', 1, 'S', '');
  assert.deepEqual(routingSizes(doc, spec), { sizes: [1, 4], listed: false });
  assert.equal(routingSizes(doc, doc.specs[0]).listed, true);
});

test('zoom extents covers the dimensions and labels, not just the pipe', () => {
  const doc = newIso(), spec = doc.specs[0].id;
  const a = appendRun(doc, null, [3000, 0, 0], spec, 2, 'S', '');
  appendRun(doc, a.id, [0, 2000, 0], spec, 2, 'S', '');
  const drawing = createDrawing(doc, '', 'iso');
  const box = inkExtents(drawing)!;
  const pipe = inkExtents({ ...drawing, labels: [], primitives: drawing.primitives.filter((p) => p.layer === 'PIPE') })!;
  assert.ok(box[0] <= pipe[0] && box[1] <= pipe[1] && box[2] >= pipe[2] && box[3] >= pipe[3]);
  assert.ok(box[3] - box[1] > pipe[3] - pipe[1] || box[2] - box[0] > pipe[2] - pipe[0], 'dimensions reach beyond the pipe');
  // The title block and material list are not piping.
  assert.ok(box[3] < drawing.height * 0.9);
});

test('a pipe whose line is hidden under its fittings can still be picked near its centreline', async () => {
  const { pipeAtPoint } = await import('../src/editor/pipe-hit.ts');
  const doc = newIso(), spec = doc.specs[0].id;
  appendRun(doc, null, [3000, 0, 0], spec, 2, 'S', '');
  const drawing = createDrawing(doc, '', 'iso'), run = doc.runs[0];
  const a = drawing.positions.get(run.from)!, b = drawing.positions.get(run.to)!, mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const covered = { ...drawing, primitives: drawing.primitives.filter((p) => !(p.layer === 'PIPE' && p.owner === run.id)) };
  assert.equal(pipeAtPoint(doc, covered, mid, (p) => p)?.runId, run.id);
  // A pipe with no ink at all on the sheet (another spool's) is not picked.
  const elsewhere = { ...drawing, primitives: drawing.primitives.filter((p) => p.owner !== run.id) };
  assert.equal(pipeAtPoint(doc, elsewhere, mid, (p) => p), null);
});
