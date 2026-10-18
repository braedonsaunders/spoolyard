import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, clone, connected, getNode, newIso, parseIsoJson, resizeRun, runResult, type IsoDocument, type PipeSpec, type Vec3 } from '../src/core/model.ts';
import { COMPONENT_TYPE_BY_CODE } from '../src/core/components.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';
import { copySelection, moveSelection, pastePieces, stretchLeg } from '../src/editor/edit-ops.ts';

const spec = JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')) as PipeSpec;
const row = (id: string) => spec.fittings.find(f => f.id === `${spec.id}/${id}`)!;

/**
 * A 4" line: an open end, a gate valve at 1000, an elbow at 3000 turning north for 2000 to an open end. A ½" sockolet
 * vent rises 150 from the pipe after the valve at 2500; a second one rises from the north leg at 1000 along it.
 */
function line() {
  const doc = newIso(); doc.specs = [clone(spec)];
  const elbow = appendRun(doc, null, [3000, 0, 0], spec.id, 4, 'SP-001', 'L-1');
  const end = appendRun(doc, elbow.id, [0, 2000, 0], spec.id, 4, 'SP-001', 'L-1');
  const valve = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPE_BY_CODE['GATE-FL'], 1 / 3, row('GATE-FL-4'));
  const header = connected(doc, valve.id).find(r => [r.from, r.to].includes(elbow.id))!;
  const vent = (runId: string, fraction: number) => {
    const olet = placeComponentOnPipe(doc, runId, COMPONENT_TYPE_BY_CODE.SOL, fraction, row('SOL-0.5'));
    const cap = appendRun(doc, olet.id, [0, 0, 150], spec.id, 0.5, 'SP-001', 'L-1', 'SW');
    return { olet, cap, pipe: doc.runs.at(-1)! };
  };
  const a = vent(header.id, (2500 - 1000) / 2000);
  const north = doc.runs.find(r => r.to === end.id)!;
  const b = vent(north.id, 0.5);
  return { doc, valve, elbow, end, header, north, a, b };
}
const at = (doc: IsoDocument, id: string) => getNode(doc, id).position.map(v => Math.round(v * 1000) / 1000);
const square = (doc: IsoDocument, runId: string) => {
  const r = doc.runs.find(x => x.id === runId)!, v = getNode(doc, r.to).position.map((x, i) => x - getNode(doc, r.from).position[i]) as Vec3;
  return v.filter(x => Math.abs(x) > 1e-6).length === 1;
};

test('moving an in-line valve leaves an olet on the next pipe, and its branch, where they are', () => {
  const { doc, valve, a } = line();
  const cut = runResult(doc, a.pipe).cut;
  moveSelection(doc, [valve.id], [100, 0, 0]);
  assert.deepEqual(at(doc, valve.id), [1100, 0, 0]);
  assert.deepEqual(at(doc, a.olet.id), [2500, 0, 0], 'the olet keeps its plant position');
  assert.deepEqual(at(doc, a.cap.id), [2500, 0, 150]);
  assert.ok(square(doc, a.pipe.id), 'the vent stays square to the header');
  assert.equal(runResult(doc, a.pipe).cut, cut, 'the vent keeps its cut length');
  parseIsoJson(JSON.stringify(doc));
});

test('a move that would push an olet onto an end weld is refused', () => {
  const { doc, north } = line();
  // Moving the north leg 400 back towards the valve brings the elbow weld (152.4 takeout) past the olet at 2500.
  const before = JSON.stringify(doc);
  assert.throws(() => moveSelection(doc, [north.id], [-400, 0, 0]), /sockolet .*weld at the .*elbow/i);
  // A shorter move that leaves it clear is allowed, and the olet stays put.
  const ok = clone(JSON.parse(before)) as IsoDocument;
  moveSelection(ok, [north.id], [-300, 0, 0]);
  assert.deepEqual(at(ok, ok.nodes.find(n => n.kind === 'olet' && Math.abs(n.position[1]) < 1e-6)!.id), [2500, 0, 0]);
});

test('moving a pipe whole carries its olets and their branches as one piece', () => {
  const { doc, north, b } = line();
  const elbowEnd = north.from, far = north.to;
  moveSelection(doc, [north.id], [200, 0, 0]);
  assert.deepEqual(at(doc, b.olet.id), [3200, 1000, 0]);
  assert.deepEqual(at(doc, b.cap.id), [3200, 1000, 150], 'the branch goes with its olet');
  assert.ok(square(doc, b.pipe.id));
  assert.deepEqual(at(doc, elbowEnd), [3200, 0, 0]);
  assert.deepEqual(at(doc, far), [3200, 2000, 0]);
});

test('a branch moved along its header slides its olet; out along itself it stretches; across, it is refused', () => {
  const { doc, a } = line();
  moveSelection(doc, [a.pipe.id], [100, 0, 0]);
  assert.deepEqual(at(doc, a.olet.id), [2600, 0, 0]);
  assert.deepEqual(at(doc, a.cap.id), [2600, 0, 150]);
  moveSelection(doc, [a.pipe.id], [0, 0, 100]);
  assert.deepEqual(at(doc, a.olet.id), [2600, 0, 0], 'the olet stays on its header');
  assert.equal(Math.round(runResult(doc, a.pipe).overall), 250);
  assert.throws(() => moveSelection(doc, [a.pipe.id], [0, 100, 0]), /only slide along its pipe/);
});

test('stretching a leg keeps olets on it in place and carries those beyond with their branches', () => {
  const { doc, elbow, header, a, b } = line();
  stretchLeg(doc, header.id, elbow.id, [500, 0, 0]);
  assert.deepEqual(at(doc, a.olet.id), [2500, 0, 0]);
  assert.deepEqual(at(doc, a.cap.id), [2500, 0, 150]);
  assert.deepEqual(at(doc, b.olet.id), [3500, 1000, 0]);
  assert.deepEqual(at(doc, b.cap.id), [3500, 1000, 150]);
  assert.ok(square(doc, b.pipe.id));
  // Shortening it past the olet is refused.
  assert.throws(() => stretchLeg(doc, header.id, elbow.id, [-1000, 0, 0]), /sockolet/);
});

test('a typed length upstream carries olets downstream with their branches', () => {
  const { doc, a, b } = line();
  const first = doc.runs.find(r => r.to === doc.nodes.find(n => n.kind === 'valve')!.id)!;
  resizeRun(doc, first.id, 1100);
  assert.deepEqual(at(doc, a.olet.id), [2600, 0, 0]);
  assert.deepEqual(at(doc, a.cap.id), [2600, 0, 150]);
  assert.deepEqual(at(doc, b.cap.id), [3100, 1000, 150]);
  assert.ok(square(doc, a.pipe.id) && square(doc, b.pipe.id));
});

test('copying a branch without its header pastes it from an open end', () => {
  const { doc, a } = line();
  const clip = copySelection(doc, [a.pipe.id])!;
  const made = pastePieces(doc, clip, [0, 5000, 0]);
  const pasted = doc.runs.find(r => r.id === made.ids[0])!;
  assert.equal(getNode(doc, pasted.from).kind, 'end');
  assert.equal(getNode(doc, pasted.from).associatedRunId, undefined);
  parseIsoJson(JSON.stringify(doc));
  // Copying the header with its olets brings the olets; their branches come when selected too.
  const both = copySelection(doc, [a.pipe.id, ...doc.runs.filter(r => r.nps === 4).map(r => r.id)])!;
  pastePieces(doc, both, [0, -5000, 0]);
  parseIsoJson(JSON.stringify(doc));
});

test('an olet takes the row for the branch routed from it, and a standard olet is not reported as a missing row', async () => {
  const { fitOletToBranch, oletBranchSize } = await import('../src/editor/edit-ops.ts');
  const { validateIso } = await import('../src/core/model.ts');
  const doc = newIso(); doc.specs = [clone(spec)];
  appendRun(doc, null, [3000, 0, 0], spec.id, 4, 'SP-001', 'L-1');
  const olet = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPE_BY_CODE.SOL, 0.5, row('SOL-0.5'));
  appendRun(doc, olet.id, [0, 0, 300], spec.id, 1, 'SP-001', 'L-1', 'SW');
  assert.ok(fitOletToBranch(doc, olet.id));
  assert.equal(olet.catalogId, `${spec.id}/SOL-1`);
  assert.equal(oletBranchSize(doc, olet), 1);
  assert.ok(!validateIso(doc).some(i => /sockolet/i.test(i)), validateIso(doc).join('\n'));
  assert.equal(fitOletToBranch(doc, olet.id), false, 'already fitted');
  // A specification without weldolet rows places the standard part; routed at another size it follows the branch.
  const bare = clone(spec); bare.fittings = bare.fittings.filter(f => f.component !== 'WOL');
  const other = newIso(); other.specs = [bare];
  appendRun(other, null, [3000, 0, 0], bare.id, 6, 'SP-001', 'L-1');
  const wol = placeComponentOnPipe(other, other.runs[0].id, COMPONENT_TYPE_BY_CODE.WOL, 0.5);
  assert.match(wol.catalogId ?? '', /^std:WOL:/);
  assert.ok(!validateIso(other).some(i => /no longer exists/.test(i)));
  appendRun(other, wol.id, [0, 0, 300], bare.id, 2, 'SP-001', 'L-1');
  fitOletToBranch(other, wol.id);
  assert.equal(wol.catalogId, undefined);
  assert.ok(!validateIso(other).some(i => /weldolet|no longer exists/i.test(i)), validateIso(other).join('\n'));
});
