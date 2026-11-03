import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, connected, getNode, heavyCarbon, newIso, runResult, setAutoFitting, type PipeSpec } from '../src/core/model.ts';
import { capOpenEnd, insertLateral, insertOffset, placeComponentOnPipe, throughOutlet, turnAtOpenEnd } from '../src/core/component-position.ts';
import { COMPONENT_TYPE_BY_CODE } from '../src/core/components.ts';
import { createDrawing } from '../src/core/drawing.ts';
import { flangedJoints } from '../src/core/joints.ts';
import { sheetMaterials } from '../src/core/material-list.ts';
import { specSizeText, tubeSizeText } from '../src/core/format.ts';
import { profileError } from '../src/core/profile.ts';
import { reviewIso } from '../src/core/review.ts';
import { namespaceSpec } from '../src/editor/library.ts';

const T = (code: string) => COMPONENT_TYPE_BY_CODE[code];
const load = (slug: string, id = slug.toUpperCase()) =>
  namespaceSpec(JSON.parse(readFileSync(new URL(`../public/library/specs/${slug}.json`, import.meta.url), 'utf8')) as PipeSpec, id);
/** A line on `spec`: 3000 east to an elbow, then 2000 north to an open end. */
function line(slug = 'a', nps = 4) {
  const doc = newIso(), id = slug.toUpperCase();
  doc.specs = [load(slug, id)];
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  const corner = appendRun(doc, 'o', [3000, 0, 0], id, nps, 'S1', '');
  const end = appendRun(doc, corner.id, [0, 2000, 0], id, nps, 'S1', '');
  setAutoFitting(doc, corner.id);
  return { doc, corner, end };
}
const close = (a: number, b: number, at = '') => assert.ok(Math.abs(a - b) < 1e-6, `${at} ${a} ≠ ${b}`);

test('Weld gaps › Heavy carbon only deducts the root gap on carbon Sch 80 and heavier, not on standard wall or stainless', () => {
  const a = load('a', 'A'), ss = load('ss-a', 'SS-A');
  assert.equal(heavyCarbon(a, { ...a.sizes[0], schedule: 'SCH.80' }), true);
  assert.equal(heavyCarbon(a, { ...a.sizes[0], schedule: 'XS' }), true);
  assert.equal(heavyCarbon(a, { ...a.sizes[0], schedule: 'STD' }), false);
  assert.equal(heavyCarbon(a, { ...a.sizes[0], schedule: 'SCH.40' }), false);
  assert.equal(heavyCarbon(ss, { ...ss.sizes[0], schedule: 'SCH.80S' }), false, 'stainless is fitted tight');
  const { doc } = line('a', 4);
  const deducted = runResult(doc, doc.runs[0]);
  assert.equal(deducted.gaps[1], 1.6);
  doc.profile = { weldGaps: 'heavy-carbon' };
  const std = runResult(doc, doc.runs[0]);
  assert.equal(std.gaps[1], 0, 'a 4" standard-wall carbon line takes no gap');
  close(std.cut, deducted.cut + 1.6 * 2 - (deducted.gaps[0] ? 0 : 1.6), 'the cut grows by the gaps no longer deducted');
  const spec = doc.specs[0], size = spec.sizes.find(s => s.nps === 4)!;
  size.schedule = 'SCH.80';
  assert.equal(runResult(doc, doc.runs[0]).gaps[1], 1.6, 'the same line in Sch 80 keeps its gap');
  assert.equal(profileError({ weldGaps: 'heavy-carbon' }), undefined);
  assert.ok(profileError({ weldGaps: 'sometimes' as 'ignore' }));
});

test('Socket pull-back replaces the specification socket gap in every socket-weld cut', () => {
  const doc = newIso();
  doc.specs = [load('a', 'A')];
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  const corner = appendRun(doc, 'o', [1000, 0, 0], 'A', 1, 'S1', '', 'SW');
  appendRun(doc, corner.id, [0, 1000, 0], 'A', 1, 'S1', '', 'SW');
  setAutoFitting(doc, corner.id);
  const before = runResult(doc, doc.runs[0]);
  assert.equal(before.gaps[1], 1.6);
  doc.profile = { socketPullBack: 3.175 };
  const after = runResult(doc, doc.runs[0]);
  assert.equal(after.gaps[1], 3.175, '1/8" off the socket bottom');
  close(after.cut, before.cut - (3.175 - 1.6));
  assert.equal(profileError({ socketPullBack: 3.175 }), undefined);
  assert.ok(profileError({ socketPullBack: -1 }));
});

test('a 45° or 90° elbow turns an open pipe end, its outlet left open; routing on straight carries on from the elbow', () => {
  for (const angle of [45, 90] as const) {
    const { doc, end } = line();
    const last = connected(doc, end.id)[0];
    const elbow = turnAtOpenEnd(doc, last.id, 1, [0, 0, 1], angle);
    assert.equal(elbow.id, end.id);
    assert.equal(elbow.kind, angle === 45 ? 'elbow45' : 'elbow90');
    assert.deepEqual(elbow.position, [3000, 2000, 0], 'the pipe keeps its length to the elbow centre');
    const stub = connected(doc, elbow.id).find(r => r.connector)!;
    const outlet = getNode(doc, stub.to), dir = outlet.position.map((v, i) => v - elbow.position[i]);
    const reach = Math.hypot(...dir);
    assert.ok(reach > 0, 'the outlet sits at the elbow port');
    if (angle === 90) assert.deepEqual(dir.map(v => Math.round(v / reach * 1e6) / 1e6), [0, 0, 1]);
    else assert.deepEqual(dir.map(v => Math.round(v / reach * 1e6) / 1e6), [0, 0.707107, 0.707107]);
    assert.ok(runResult(doc, last).cut > 0);
    assert.ok(!reviewIso(doc).some(i => i.severity === 'error'), reviewIso(doc).map(i => i.message).join('\n'));
    assert.equal(sheetMaterials(doc, 'S1').filter(r => r.category === 'pipe').length, 2, 'no pipe beyond the elbow');
    // Routing on from the open outlet in the outlet's direction starts the pipe at the elbow: one pipe, one weld.
    const on = throughOutlet(doc, outlet.id, dir.map(v => v / reach * 1000) as [number, number, number])!;
    assert.equal(on.from, elbow.id);
    close(Math.hypot(...on.delta), 1000 + reach);
    assert.ok(!doc.nodes.some(n => n.id === outlet.id) && !doc.runs.includes(stub), 'the open outlet is gone');
  }
  const { doc, end } = line();
  const last = connected(doc, end.id)[0];
  assert.throws(() => turnAtOpenEnd(doc, last.id, 1, [0, 1, 0], 45), /square to it/);
  turnAtOpenEnd(doc, last.id, 1, [1, 0, 0], 90);
  assert.throws(() => turnAtOpenEnd(doc, last.id, 1, [0, 0, 1], 90), /already has a fitting/);
});

test('routing off an open outlet in another direction keeps the outlet', () => {
  const { doc, end } = line();
  turnAtOpenEnd(doc, connected(doc, end.id)[0].id, 1, [0, 0, 1], 90);
  const outlet = connected(doc, end.id).find(r => r.connector)!.to;
  assert.equal(throughOutlet(doc, outlet, [1000, 0, 0]), undefined);
  assert.equal(throughOutlet(doc, end.id, [0, 0, 1000]), undefined, 'only an open outlet is routed through');
});

test('a 45° lateral goes into a pipe with its branch leaning forward and left open', () => {
  const { doc } = line();
  const run = doc.runs[0];
  const lateral = insertLateral(doc, run.id, 0.4, [0, 1, 0]);
  assert.equal(lateral.kind, 'tee');
  assert.match(lateral.catalogId ?? '', /LAT/);
  const branch = connected(doc, lateral.id).find(r => r.id === lateral.branchEdgeId)!;
  assert.ok(branch.connector, 'the branch is an open outlet');
  const outlet = getNode(doc, branch.to), d = outlet.position.map((v, i) => v - lateral.position[i]);
  assert.ok(d[0] > 0 && Math.abs(d[0] - d[1]) < 1e-6 && d[2] === 0, `branch leans east and north at 45°: ${d}`);
  assert.ok(doc.runs.filter(r => !r.connector).every(r => runResult(doc, r).cut > 0));
  assert.throws(() => insertLateral(doc, doc.runs[0].id, 0.5, [1, 0, 0]), /square to it/);
});

test('rolling offsets move the line across two directions at once, through 45s or 90s', () => {
  const { doc, corner, end } = line();
  // 300 up and 400 south: a 500 roll through 45s needs 500 of run along the pipe.
  const [first, second] = insertOffset(doc, doc.runs[0].id, 0.3, [0, -400, 300], 45);
  assert.deepEqual([first.kind, second.kind], ['elbow45', 'elbow45']);
  assert.deepEqual(first.position, [900, 0, 0]);
  assert.deepEqual(second.position, [1400, -400, 300]);
  assert.deepEqual(getNode(doc, corner.id).position, [3000, -400, 300]);
  assert.deepEqual(getNode(doc, end.id).position, [3000, 1600, 300]);
  // Through 90s the line steps straight across.
  const square = line();
  const [a, b] = insertOffset(square.doc, square.doc.runs[0].id, 0.5, [0, 0, 600], 90);
  assert.deepEqual([a.kind, b.kind], ['elbow90', 'elbow90']);
  assert.deepEqual(b.position, [1500, 0, 600]);
  assert.ok(square.doc.runs.every(r => r.connector || runResult(square.doc, r).cut > 0));
});

test('SAN-A sanitary tube: tube sizes, orbital-weld takeouts with no gap, and a clamp joint listed as two ferrules, a gasket and a clamp', () => {
  const { doc, end } = line('san-a', 1.5);
  const spec = doc.specs[0];
  assert.equal(spec.sizing, 'tube-od');
  assert.equal(tubeSizeText(1.5), '1.5" OD');
  assert.equal(tubeSizeText(2, 1.5), '2"X1.5" OD');
  assert.equal(specSizeText(doc, 'SAN-A', 1.5), '1.5" OD');
  assert.equal(specSizeText(doc, 'A', 1.5), '1 1/2"');
  const r = runResult(doc, doc.runs[0]);
  assert.ok(Math.abs(r.takeouts[1] - 2.937 * 25.4) < 0.01, 'the elbow takes its tangent centre-to-end');
  assert.equal(r.gaps[1], 0, 'orbital butt welds are square, with no root gap');
  // A ferrule at the open end (to equipment) and a clamp joint mid-line.
  capOpenEnd(doc, end.id, T('FERRULE-TC'));
  placeComponentOnPipe(doc, doc.runs[0].id, T('FERRULE-TC'), 0.5);
  const joints = flangedJoints(doc);
  assert.equal(joints.length, 2);
  for (const j of joints) {
    assert.equal(j.face, 'TC');
    assert.equal(j.gasket?.thickness, 0, 'the gasket seats in the ferrule grooves');
    assert.equal(j.bolts?.kind, 'clamp');
    assert.equal(j.bolts?.count, 1);
  }
  const rows = sheetMaterials(doc, 'S1'), qty = (re: RegExp) => rows.filter(m => re.test(m.description)).map(m => m.qtyText);
  assert.deepEqual(qty(/^FERRULE/), ['3']);
  assert.deepEqual(qty(/^GASKET/), ['2']);
  assert.deepEqual(qty(/^CLAMP/), ['2']);
  assert.ok(rows.every(m => m.category === 'pipe' || /OD$/.test(m.nd)), rows.map(m => m.nd).join(', '));
  assert.ok(rows.filter(m => m.category === 'pipe').every(m => /^TUBE, SANITARY/.test(m.description)));
  // Pipe cut at the clamp joint: half the line less the elbow takeout and the ferrule.
  const ferrule = spec.fittings.find(f => f.component === 'FERRULE-TC' && f.nps === 1.5)!;
  assert.ok(doc.runs.some(x => !x.connector && Math.abs(runResult(doc, x).cut - (1500 - ferrule.takeout)) < 1e-6));
  assert.ok(!reviewIso(doc).some(i => /flange pressure class|flange face/.test(i.message)), 'no flange class or face is assumed for a clamp joint');
  const texts = createDrawing(doc, 'S1').primitives.flatMap(p => 'text' in p && typeof p.text === 'string' ? [p.text] : []);
  assert.ok(texts.includes('1.5" OD TUBE'), 'the sheet calls out the tube size');
  assert.ok(!texts.some(t => / NS$/.test(t)));
});

test('a profile kept as the default is applied to new drawings', async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k)
  };
  try {
    const { hasDefaultProfile, newIsoWithDefaultSpec, saveDefaultProfile } = await import('../src/editor/library.ts');
    assert.equal(hasDefaultProfile(), false);
    saveDefaultProfile({ profile: { weldGaps: 'heavy-carbon', socketPullBack: 3.175 }, fieldFitMakeup: 150 });
    assert.equal(hasDefaultProfile(), true);
    const doc = await newIsoWithDefaultSpec('imperial');
    assert.equal(doc.profile?.weldGaps, 'heavy-carbon');
    assert.equal(doc.profile?.socketPullBack, 3.175);
    assert.equal(doc.fieldFitMakeup, 150);
    saveDefaultProfile(null);
    assert.equal(hasDefaultProfile(), false);
    assert.equal((await newIsoWithDefaultSpec('imperial')).profile?.weldGaps, undefined);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
