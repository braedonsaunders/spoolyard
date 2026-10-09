import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, bom, clone, getNode, newIso, runResult, validateIso, type PipeSpec } from '../src/core/model.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { moveComponentAlongPipe, placeComponentOnPipe } from '../src/core/component-position.ts';
import { createDrawing } from '../src/core/drawing.ts';
import { defaultGrid, GRID_ORIGIN, gridLines, type GridPlane } from '../src/core/grid.ts';

const spec = JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')) as PipeSpec;
function fixture() {
  const doc = newIso(); doc.specs = [clone(spec)];
  appendRun(doc, null, [10000, 0, 0], spec.id, 2, 'SP-001', '', 'FL');
  return doc;
}

test('sliding a fitting leaves the graph paper and outer connections unchanged on every plane', () => {
  const doc = fixture();
  const ends = [doc.runs[0].from, doc.runs[0].to];
  const node = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPES.find(t => t.code === 'BALL-FL')!, .317);
  for (const model of [false, true]) for (const plane of ['xy', 'xz', 'yz'] as GridPlane[]) {
    const before = createDrawing(doc, '', 'iso', undefined, { model });
    const settings = { ...defaultGrid(), plane };
    const background = gridLines(before, GRID_ORIGIN, settings);
    moveComponentAlongPipe(doc, node.id, 6437);
    const after = createDrawing(doc, '', 'iso', undefined, { model });
    assert.deepEqual(after.fit, before.fit);
    assert.deepEqual(gridLines(after, GRID_ORIGIN, settings), background);
    for (const id of ends) assert.deepEqual(after.positions.get(id), before.positions.get(id));
    assert.ok(Math.abs(getNode(doc, node.id).position[0] - 6437) < 1e-8);
    assert.deepEqual(getNode(doc, node.id).position.slice(1), [0, 0]);
    moveComponentAlongPipe(doc, node.id, 3170);
  }
});

test('unknown catalogue dimensions explain pending BOM cuts and resolve with a measured takeout', () => {
  const doc = fixture();
  const node = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPES.find(t => t.code === 'BFLY')!, .317);
  assert.ok(!Number.isFinite(bom(doc).find(r => r.unit === 'm')!.qty));
  assert.match(validateIso(doc).join('\n'), /Butterfly valve.*Pipe cut length is pending/);
  const text = createDrawing(doc).primitives.filter(p => p.type === 'text').map(p => p.text).join('\n');
  assert.match(text, /TBD\*/); assert.match(text, /Pipe cut lengths need review/); assert.doesNotMatch(text, /MISSING m/);
  node.takeout = 60;
  assert.ok(Math.abs(bom(doc).find(r => r.unit === 'm')!.qty - 9.88) < 1e-9);
  assert.ok(doc.runs.every(r => Number.isFinite(runResult(doc, r).cut)));
  assert.ok(!validateIso(doc).some(s => /takeouts/.test(s)));
  assert.ok(!createDrawing(doc).primitives.some(p => p.type === 'text' && p.text === 'TBD*'));
});
