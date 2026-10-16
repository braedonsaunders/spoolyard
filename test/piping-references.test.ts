import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, bom, clone, getNode, newIso, parseIsoJson, runResult, validateIso, welds } from '../src/core/model.ts';
import { drawingReference } from '../src/core/references.ts';
import { sheetMaterials } from '../src/core/material-list.ts';
import { createDrawing } from '../src/core/drawing.ts';

const documents = () => {
  const host = newIso(); host.drawing = 'ISO-TEST-A'; host.coordinates = { origin: [0, 0, 0] };
  const end = appendRun(host, null, [1000, 0, 0], 'CS40', 2, 'S1', 'L');
  end.continuation = { text: "CONT'D ON TEST-B", coordinates: true };
  const source = newIso(); source.drawing = 'ISO-TEST-B'; source.coordinates = { origin: [1000, 0, 0] };
  const elbow = appendRun(source, null, [150, 0, 0], 'CS40', 2, 'S2', 'L');
  appendRun(source, elbow.id, [0, 0, 1000], 'CS40', 2, 'S2', 'L');
  return { host, end, source, elbow };
};

test('an adjacent drawing is thin reference geometry without fabrication quantities or extra sheets', () => {
  const {host, end, source} = documents();
  const before = clone(host), rows = sheetMaterials(host, 'S1');
  const reference = drawingReference(host, end.id, source);
  host.references = [reference];
  assert.equal(reference.nodes.find(n => n.id === reference.anchorNodeId)!.position[0], 1000);
  assert.deepEqual(sheetMaterials(host, 'S1'), rows);
  assert.deepEqual(bom(host), bom(before));
  assert.deepEqual(welds(host), welds(before));
  assert.equal(runResult(host, host.runs[0]).cut, runResult(before, before.runs[0]).cut);
  assert.deepEqual(validateIso(host), validateIso(before));
  const drawn = createDrawing(host, 'S1');
  const context = drawn.primitives.filter(p => reference.nodes.some(n => n.id === p.owner));
  assert.ok(context.length > 0);
  assert.ok(context.filter(p => p.type !== 'text' && p.type !== 'image').every(p => (p.weight ?? 0.6) <= 0.6));
  assert.ok(!drawn.primitives.some(p => p.type === 'text' && /SHEET 1 OF 2/.test(p.text)));
  assert.deepEqual(parseIsoJson(JSON.stringify(host)).references, JSON.parse(JSON.stringify(host.references)));
  assert.deepEqual(host.nodes, before.nodes, 'rendering does not mutate the model');
});

test('a dimension may extend past a continuation to the next drawing fitting', () => {
  const {host, end, source, elbow} = documents();
  const reference = drawingReference(host, end.id, source);
  reference.dimensionTo = reference.nodes.find(n => n.id.endsWith(elbow.id))!.id;
  host.references = [reference];
  const texts = createDrawing(host, 'S1').primitives.flatMap(p => p.type === 'text' && p.layer === 'DIM' ? [p.text] : []);
  assert.ok(texts.includes('1000') && texts.includes('1150'), texts.join(' '));
  end.position = [2000, 0, 0];
  const moved = createDrawing(host, 'S1').primitives.flatMap(p => p.type === 'text' && p.layer === 'DIM' ? [p.text] : []);
  assert.ok(moved.includes('2150'), 'the reference follows its continuation when the pipe is resized');
});

test('invalid reference geometry and missing attachment points are rejected on reopen', () => {
  const {host, end, source} = documents(); host.references = [drawingReference(host, end.id, source)];
  host.references[0].atNodeId = 'missing';
  assert.throws(() => parseIsoJson(JSON.stringify(host)), /adjacent/i);
  host.references[0].atNodeId = end.id; host.references[0].runs[0].from = 'missing';
  assert.throws(() => parseIsoJson(JSON.stringify(host)), /Missing/);
});

test('reference symbols use the adjacent specification without changing the host catalogue', () => {
  const {host, end, source} = documents();
  const valve = getNode(source, source.runs[0].to);
  applyComponent(source, valve, 'BFLY-LUG');
  host.references = [drawingReference(host, end.id, source)];
  const reference = host.references[0];
  assert.ok(createDrawing(host, 'S1').primitives.some(p => p.type === 'circle' && p.owner?.endsWith(valve.id)));
});
