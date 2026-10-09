import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, attachComponent, clone, connected, getNode, newIso, parseIsoJson, type PipeSpec } from '../src/core/model.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { componentTrack, moveComponentAlongPipe, placeComponentOnPipe } from '../src/core/component-position.ts';

const spec = JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')) as PipeSpec;
const offered = COMPONENT_TYPES.filter(t => !['pipe', 'elbow90', 'elbow45', 'tee'].includes(t.kind) &&
  (t.ports === 2 || ['support', 'bolt', 'annotation'].includes(t.kind)));
const fixture = () => {
  const doc = newIso(); doc.specs = [clone(spec)];
  appendRun(doc, null, [10000, 0, 0], spec.id, 2, 'SP-001', 'L-10');
  doc.runs[0].fromTag = 'START'; doc.runs[0].toTag = 'END'; doc.runs[0].heat = 'HEAT-1';
  return doc;
};

test('every offered component places off-centre and slides without moving the pipe ends', () => {
  assert.ok(offered.length > 80);
  for (const type of offered) {
    const doc = fixture(), first = doc.runs[0], from = first.from, to = first.to;
    const row = spec.fittings.find(f => f.component === type.code && f.nps === 2);
    const node = placeComponentOnPipe(doc, first.id, type, 0.27, row);
    assert.equal(node.component, type.code);
    assert.deepEqual(node.position, [2700, 0, 0], type.code);
    moveComponentAlongPipe(doc, node.id, 6100);
    assert.deepEqual(node.position, [6100, 0, 0], type.code);
    assert.deepEqual(getNode(doc, from).position, [0, 0, 0]);
    assert.deepEqual(getNode(doc, to).position, [10000, 0, 0]);
    assert.equal(doc.runs.find(r => r.from === from)!.fromTag, 'START');
    assert.equal(doc.runs.find(r => r.to === to)!.toTag, 'END');
    assert.ok(doc.runs.every(r => r.heat === 'HEAT-1'));
    assert.equal(node.catalogId, row?.id, type.code);
    parseIsoJson(JSON.stringify(doc));
  }
});

test('sliding an inline fitting retains stationary attachments on the correct pipe segment', () => {
  const doc = fixture(), type = COMPONENT_TYPES.find(t => t.code === 'BALL-FL')!;
  const support = attachComponent(doc, doc.runs[0].id, 'support', 0.6);
  const node = placeComponentOnPipe(doc, doc.runs[0].id, type, 0.3);
  const before = [...support.position];
  moveComponentAlongPipe(doc, node.id, 7000);
  assert.deepEqual(support.position, before);
  assert.equal(support.associatedRunId, doc.runs.find(r => r.to === node.id)!.id);
  assert.equal(componentTrack(doc, node.id)!.distance, 7000);
});

test('reducers retain their size transition and catalogue while repositioned', () => {
  const doc = fixture(), type = COMPONENT_TYPES.find(t => t.code === 'C-RED')!;
  const row = spec.fittings.find(f => f.component === type.code && f.nps === 2 && f.smallerNps === 1)!;
  const node = placeComponentOnPipe(doc, doc.runs[0].id, type, 0.2, row);
  moveComponentAlongPipe(doc, node.id, 7500);
  assert.deepEqual(connected(doc, node.id).map(r => r.nps), [2, 1]);
  assert.equal(node.catalogId, row.id);
});

test('invalid positions and fitting collisions leave the existing position intact', () => {
  const doc = fixture(), type = COMPONENT_TYPES.find(t => t.code === 'BALL-FL')!;
  const node = placeComponentOnPipe(doc, doc.runs[0].id, type, 0.3);
  node.takeout = 100;
  for (const distance of [-1, 0, 10, 10000, Infinity, NaN]) {
    assert.throws(() => moveComponentAlongPipe(doc, node.id, distance), /Position|no pipe/);
    assert.deepEqual(node.position, [3000, 0, 0]);
  }
});

test('branch junctions and elbows are not slid as inline fittings', () => {
  const doc = fixture();
  const end = doc.nodes.at(-1)!;
  appendRun(doc, end.id, [0, 1000, 0], spec.id, 2, 'SP-001', 'L-10');
  assert.equal(componentTrack(doc, end.id), null);
  assert.throws(() => moveComponentAlongPipe(doc, end.id, 100), /cannot slide/);
});
