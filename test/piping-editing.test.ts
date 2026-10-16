import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, attachComponent, clone, connected, getNode, newIso, parseIsoJson, validateIso, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { COMPONENT_TYPE_BY_CODE } from '../src/core/components.ts';
import {
  canRouteFrom, componentFaces, componentTrack, continueFlow, legPosition, placeComponentOnPipe, reduceAtJoint, routeError,
  setLineFlow, sizeChoices, snapAlongLeg
} from '../src/core/component-position.ts';

const spec = JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')) as PipeSpec;
const type = (code: string) => COMPONENT_TYPE_BY_CODE[code];
const row = (id: string) => spec.fittings.find(f => f.id === id)!;
const straight = (nps: number, length = 10000) => {
  const doc = newIso(); doc.specs = [clone(spec)];
  appendRun(doc, null, [length, 0, 0], spec.id, nps, 'SP-001', 'L-10');
  return doc;
};
const issues = (doc: IsoDocument) => validateIso(doc).filter(i => !/root gap|no socket depth/.test(i));

test('an olet sits on its header at a distance and its branch is routed from it', () => {
  const doc = straight(6), header = doc.runs[0];
  const olet = placeComponentOnPipe(doc, header.id, type('SOL'), 0.4, row(`${spec.id}/SOL-0.75`));
  assert.equal(olet.kind, 'olet');
  assert.equal(olet.associatedRunId, header.id);
  assert.deepEqual(olet.position, [4000, 0, 0]);
  assert.equal(olet.catalogId, `${spec.id}/SOL-0.75`);
  assert.equal(doc.runs.length, 1, 'the header is not cut');
  assert.ok(canRouteFrom(doc, olet.id));
  assert.match(routeError(doc, olet.id, [500, 0, 0])!, /across/);
  assert.equal(routeError(doc, olet.id, [0, 0, 300]), undefined);
  appendRun(doc, olet.id, [0, 0, 300], spec.id, 0.75, 'SP-001', 'L-10', 'SW');
  assert.equal(componentTrack(doc, olet.id)!.distance, 4000);
  assert.ok(!canRouteFrom(doc, olet.id), 'the branch is taken');
  assert.deepEqual(issues(doc).filter(i => /sockolet/i.test(i)), []);
  parseIsoJson(JSON.stringify(doc));
});

test('olets offer branch sizes smaller than their header and refuse larger ones', () => {
  assert.deepEqual(sizeChoices(spec, type('SOL'), 2).map(c => c.to), [0.5, 0.75, 1, 1.25, 1.5]);
  assert.deepEqual(sizeChoices(spec, type('SOL'), 1).map(c => c.to), [0.5, 0.75]);
  const doc = straight(2);
  assert.throws(() => placeComponentOnPipe(doc, doc.runs[0].id, type('WOL'), 0.5, row(`${spec.id}/WOL-3`)), /too large/);
  assert.throws(() => placeComponentOnPipe(doc, doc.runs[0].id, type('WOL'), 0, row(`${spec.id}/WOL-1`)), /between the pipe ends/);
  assert.equal(doc.nodes.length, 2);
  // Without a chosen size the smallest branch the specification lists is used.
  const olet = placeComponentOnPipe(doc, doc.runs[0].id, type('WOL'), 0.5);
  assert.equal(olet.catalogId, `${spec.id}/WOL-1`);
});

test('a tee placed on a pipe splits it and takes its branch when routed', () => {
  const doc = straight(4), tee = placeComponentOnPipe(doc, doc.runs[0].id, type('W-RTEE'), 0.5, row(`${spec.id}/W-RTEE-4x2`));
  assert.equal(tee.kind, 'tee');
  assert.equal(connected(doc, tee.id).length, 2);
  assert.ok(canRouteFrom(doc, tee.id));
  assert.match(routeError(doc, tee.id, [1000, 0, 0])!, /already runs/);
  appendRun(doc, tee.id, [0, 1000, 0], spec.id, 2, 'SP-001', 'L-10');
  assert.equal(tee.catalogId, `${spec.id}/W-RTEE-4x2`);
  assert.equal(tee.branchEdgeId, connected(doc, tee.id).find(r => r.nps === 2)!.id);
  assert.deepEqual(issues(doc), []);
  assert.deepEqual(sizeChoices(spec, type('W-TEE'), 4).map(c => c.to), [4]);
  assert.equal(sizeChoices(spec, type('W-RTEE'), 4)[0].to, 3.5);
});

test('reducers reduce or expand, and the line beyond takes the new size', () => {
  const choices = sizeChoices(spec, type('C-RED'), 4);
  assert.equal(choices[0].to, 3.5);
  assert.ok(choices.some(c => c.row.id === `${spec.id}/C-RED-6x4` && c.to === 6));
  // 4" from a nozzle, expanding to 6" before an elbow and the run beyond it.
  const doc = straight(4), first = doc.runs[0];
  const elbow = getNode(doc, first.to);
  appendRun(doc, elbow.id, [0, 3000, 0], spec.id, 4, 'SP-001', 'L-10');
  const valve = placeComponentOnPipe(doc, doc.runs[1].id, type('GATE-FL'), 0.5, row(`${spec.id}/GATE-FL-4`));
  const reducer = placeComponentOnPipe(doc, first.id, type('C-RED'), 0.3, row(`${spec.id}/C-RED-6x4`));
  assert.deepEqual(connected(doc, reducer.id).map(r => r.nps).sort(), [4, 6]);
  assert.equal(doc.runs.find(r => r.to === reducer.id)!.nps, 4);
  assert.ok(doc.runs.filter(r => r.id !== first.id).every(r => r.nps === 6));
  assert.equal(getNode(doc, elbow.id).catalogId, `${spec.id}/W-LR90EL-6`);
  assert.equal(valve.catalogId, `${spec.id}/GATE-FL-6`);
  assert.deepEqual(issues(doc), []);
  const small = straight(3);
  assert.throws(() => placeComponentOnPipe(small, small.runs[0].id, type('C-RED'), 0.5, row(`${spec.id}/C-RED-6x4`)), /does not fit/);
});

test('routing on at another size puts a reducer at the joint, either way', () => {
  for (const [a, b] of [[6, 4], [4, 6]]) {
    const doc = straight(a, 2000), joint = doc.runs[0].to;
    appendRun(doc, joint, [2000, 0, 0], spec.id, b, 'SP-001', 'L-10');
    assert.equal(getNode(doc, joint).kind, 'weld');
    reduceAtJoint(doc, joint);
    assert.equal(getNode(doc, joint).component, 'C-RED');
    assert.equal(getNode(doc, joint).catalogId, `${spec.id}/C-RED-6x4`);
    assert.deepEqual(issues(doc), []);
  }
});

test('only connections with a free end can be routed from', () => {
  const doc = straight(4), run = doc.runs[0];
  const valve = placeComponentOnPipe(doc, run.id, type('GATE-FL'), 0.5);
  const support = attachComponent(doc, run.id, 'support', 0.2);
  assert.ok(!canRouteFrom(doc, valve.id));
  assert.ok(!canRouteFrom(doc, support.id));
  assert.ok(canRouteFrom(doc, run.from));
  const end = doc.runs.find(r => r.from === valve.id)!.to;
  placeComponentOnPipe(doc, doc.runs.find(r => r.from === valve.id)!.id, type('W-CAP'), 1);
  assert.ok(!canRouteFrom(doc, end));
  placeComponentOnPipe(doc, run.id, type('FLG-RFWN'), 0);
  assert.ok(canRouteFrom(doc, run.from), 'a flange at a pipe end bolts to the next pipe');
});

test('click-to-place snaps along the straight to 1 mm or 1/16 in', () => {
  const doc = straight(4, 2000);
  const at = snapAlongLeg(doc, doc.runs[0].id, 996.095 / 2000);
  assert.equal(legPosition(doc, at.runId, at.fraction)!.distance, 996);
  doc.units = 'imperial';
  const inch = snapAlongLeg(doc, doc.runs[0].id, 0.3);
  const sixteenths = legPosition(doc, inch.runId, inch.fraction)!.distance / (25.4 / 16);
  assert.ok(Math.abs(sixteenths - Math.round(sixteenths)) < 1e-9);
  assert.deepEqual(snapAlongLeg(doc, doc.runs[0].id, 1), { runId: doc.runs[0].id, fraction: 1 });
});

test('positions report the faces the sheet dimensions, or the centre', () => {
  const doc = straight(4), valve = placeComponentOnPipe(doc, doc.runs[0].id, type('GATE-FL'), 0.5);
  const [near, far] = componentFaces(doc, valve.id)!;
  // Mating flange faces across the gaskets, either side of the valve's face-to-face.
  assert.ok(Math.abs(near - (5000 - 114.3 - 3.18)) < 0.05, String(near));
  assert.ok(Math.abs(far - (5000 + 114.3 + 3.18)) < 0.05, String(far));
  const welded = placeComponentOnPipe(doc, doc.runs.at(-1)!.id, type('GATE-BW'), 0.5);
  assert.equal(componentFaces(doc, welded.id), null);
  const reducer = placeComponentOnPipe(doc, doc.runs[0].id, type('C-RED'), 0.2, row(`${spec.id}/C-RED-4x3`));
  assert.deepEqual(componentFaces(doc, reducer.id)!.map(v => Math.round(v * 100) / 100), [1000 - 50.8, 1000 + 50.8]);
});

test('flow is set along a line through elbows, in-line fittings and the run of a tee, not into its branch', () => {
  const doc = straight(4, 2000), [first] = doc.runs;
  // The second pipe is drawn back toward the elbow, against the first.
  const far = { id: 'far', kind: 'end' as const, position: [2000, 2000, 0] as [number, number, number] };
  doc.nodes.push(far);
  appendRun(doc, far.id, [0, -2000, 0], spec.id, 4, 'SP-001', 'L-10');
  const second = doc.runs[1];
  const tee = placeComponentOnPipe(doc, first.id, type('W-TEE'), 0.5);
  appendRun(doc, tee.id, [0, -1000, 0], spec.id, 4, 'SP-001', 'L-10');
  const [upstream, downstream] = [doc.runs.find(r => r.to === tee.id)!, doc.runs.find(r => r.from === tee.id)!];
  const branch = doc.runs.at(-1)!;
  setLineFlow(doc, downstream.id, 'forward');
  assert.equal(downstream.flow, 'forward');
  assert.equal(second.flow, 'reverse', 'drawn against the flow');
  assert.equal(upstream.flow, 'forward', 'on through the run of the tee');
  assert.equal(branch.flow, undefined, 'the branch is a line of its own');
  setLineFlow(doc, branch.id, 'forward');
  assert.equal(upstream.flow, 'forward');
  setLineFlow(doc, second.id, undefined);
  assert.equal(downstream.flow, undefined);
  assert.equal(upstream.flow, undefined);
  assert.equal(branch.flow, 'forward');
  // A pipe routed on from the end of a line carries its flow.
  setLineFlow(doc, second.id, 'reverse');
  appendRun(doc, far.id, [0, 0, 500], spec.id, 4, 'SP-001', 'L-10');
  continueFlow(doc, doc.runs.at(-1)!.id);
  assert.equal(doc.runs.at(-1)!.flow, 'forward', 'the flow arriving at the end carries on up the riser');
  parseIsoJson(JSON.stringify(doc));
});

test('flow choices name the plant direction a pipe runs', async () => {
  const { directionName } = await import('../src/core/component-position.ts');
  assert.equal(directionName([1000, 0, 0]), 'east');
  assert.equal(directionName([-500, 500, 0]), 'north-west');
  assert.equal(directionName([0, -300, -300]), 'south and down');
  assert.equal(directionName([0, 0, 10]), 'up');
});

test('flow direction and an eccentric flat side are validated when a drawing is read', () => {
  const doc = straight(4), node = placeComponentOnPipe(doc, doc.runs[0].id, type('E-RED'), 0.5, row(`${spec.id}/E-RED-4x3`));
  node.flat = 'top';
  doc.runs[0].flow = 'forward';
  parseIsoJson(JSON.stringify(doc));
  assert.throws(() => parseIsoJson(JSON.stringify({ ...doc, runs: [{ ...doc.runs[0], flow: 'up' }, ...doc.runs.slice(1)] })), /flow/);
  assert.throws(() => parseIsoJson(JSON.stringify({ ...doc, nodes: doc.nodes.map(n => n.id === node.id ? { ...n, flat: 'left' } : n) })), /flat/);
});
