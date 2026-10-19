import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, applyComponent, attachComponent, clone, newIso, parseIsoJson, styleOf, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';
import { createDrawing } from '../src/core/drawing.ts';
import { cutSchedule } from '../src/core/schedules.ts';

// The cut schedule measures each pipe piece between the stations the sheet dimensions (src/core/stations.ts), so
// every piece's overall is a dimension of the sheet's chain. Each span is rounded on its own here, so the sheet letters
// exactly the rounded overall of the piece it spans.
const specA = JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')) as PipeSpec;
const doc = () => {
  const d = newIso(); d.specs = [clone(specA)]; d.units = 'mm';
  d.style = { ...styleOf(d), dimensionRounding: 'individual' };
  return d;
};
const run = (d: IsoDocument, from: string | null, delta: [number, number, number], { connector = false, nps = 2 } = {}) => {
  const node = appendRun(d, from, delta, 'A', nps, 'SP-1', 'L-1');
  if (connector) d.runs.at(-1)!.connector = true;
  return node;
};
const row = (d: IsoDocument, code: string, nps = 2, small?: number) =>
  d.specs[0].fittings.find(f => f.component === code && f.nps === nps && (small == null || f.smallerNps === small))!;
const type = (code: string) => COMPONENT_TYPES.find(t => t.code === code)!;
const dims = (d: IsoDocument) => createDrawing(d).primitives.flatMap(p => p.type === 'text' && p.layer === 'DIM' ? [p.text] : []);
/** Every pipe piece's overall in the cut schedule is lettered on the sheet. */
function agrees(d: IsoDocument) {
  const texts = dims(d), rows = cutSchedule(d);
  assert.ok(rows.length > 1);
  for (const r of rows) assert.ok(texts.includes(String(Math.round(r.overall))), `piece ${r.item}: overall ${r.overall} not among ${texts.join(' ')}`);
  return rows;
}
/** A flange pair welded straight onto an elbow, with pipe on its other side. */
function pairOnElbow(d: IsoDocument, at: string, code: string) {
  const flange = run(d, at, [0, 141.29, 0], { connector: true });
  applyComponent(d, flange, code, row(d, code));
  return run(d, flange.id, [0, 1000, 0]);
}

test('flanged valves and a flange pair on an elbow: the cut schedule measures between the sheet\'s stations', () => {
  const d = doc();
  const corner = run(d, null, [3000, 0, 0]);
  placeComponentOnPipe(d, d.runs[0].id, type('GATE-FL'), 0.3);
  placeComponentOnPipe(d, d.runs.find(r => r.to === corner.id)!.id, type('CHECK-FL'), 0.5);
  pairOnElbow(d, corner.id, 'FLG-RFWN');
  const rows = agrees(d);
  // The pair's gasket is in the pipe's span, measured from the face on the elbow's side, not from the gasket centre.
  const last = rows.at(-1)!;
  assert.equal(Math.round(last.overall * 100) / 100, Math.round((1000 + 1.59) * 100) / 100);
  // Gaskets dimensioned in the pipe spans instead: the cuts are the same, the pipe spans take the valves' gaskets.
  const cuts = rows.map(r => r.cut), overall = rows.map(r => r.overall);
  d.style = { ...d.style!, gasketSpan: 'pipe' };
  const moved = agrees(d);
  assert.deepEqual(moved.map(r => r.cut), cuts);
  assert.ok(moved.some((r, i) => r.overall > overall[i] + 3), 'a pipe beside a valve takes in its gasket');
});

test('a reducer welded onto an elbow is dimensioned from the elbow, and its small end measures the pipe', () => {
  const d = doc();
  const corner = run(d, null, [1500, 0, 0], { nps: 3 });
  const reducer = run(d, corner.id, [0, 114.3 + 88.9, 0], { connector: true, nps: 3 });
  applyComponent(d, reducer, 'C-RED', row(d, 'C-RED', 3, 2));
  run(d, reducer.id, [0, 1200, 0]);
  const rows = agrees(d);
  assert.equal(rows.length, 2);
});

test('lap-joint flanges: a valve\'s lap-joint mates and a lap-joint pair on an elbow measure as the sheet does', () => {
  const d = doc();
  d.specs[0].parameters = { ...d.specs[0].parameters, 'Default Flange': 'FLG-RFLJ' };
  const corner = run(d, null, [2000, 0, 0]);
  placeComponentOnPipe(d, d.runs[0].id, type('GATE-FL'), 0.5);
  const flange = run(d, corner.id, [0, 141.29, 0], { connector: true });
  applyComponent(d, flange, 'FLG-RFLJ');
  run(d, flange.id, [0, 900, 0]);
  agrees(d);
});

test('an olet branch is measured from the header centreline at the olet, as the sheet dimensions it', () => {
  const d = doc();
  run(d, null, [1000, 0, 0]);
  const olet = attachComponent(d, d.runs[0].id, 'olet', 0.4);
  applyComponent(d, olet, 'WOL', row(d, 'WOL'));
  const elbow = run(d, olet.id, [0, 0, 600]);
  run(d, elbow.id, [700, 0, 0]);
  const rows = agrees(d);
  assert.ok(rows.some(r => Math.round(r.overall) === 600));
});

test('a flange pair on a fitting can take its gasket in the fitting make-up; the cut schedule follows the sheet', () => {
  const d = doc();
  const corner = run(d, null, [3000, 0, 0]);
  const end = pairOnElbow(d, corner.id, 'FLG-RFWN');
  const pipe = d.runs.find(r => r.to === end.id)!;
  const before = agrees(d), texts = dims(d);
  // By default the make-up is the elbow and its flange (141.29 - 1.59 = 139.7) and the gasket is in the pipe's 1002.
  assert.ok(texts.includes('140') && texts.includes('1002'), texts.join(' '));
  d.style = { ...d.style!, fittingGasketSpan: 'fitting' };
  const after = agrees(d), moved = dims(d);
  assert.ok(moved.includes('143') && moved.includes('998'), moved.join(' '));
  assert.equal(Math.round(after.find(r => r.run.id === pipe.id)!.overall), 998);
  assert.deepEqual(after.map(r => r.cut), before.map(r => r.cut));
});

test('on a sheet of drafted dimensions the cut schedule measures from the points the drafter chose', () => {
  const d = doc();
  const corner = run(d, null, [3000, 0, 0]);
  const end = pairOnElbow(d, corner.id, 'FLG-RFWN');
  const pipe = d.runs.find(r => r.to === end.id)!, flange = pipe.from;
  assert.equal(Math.round(cutSchedule(d).find(r => r.run.id === pipe.id)!.overall), 1002, 'by the sheet\'s own rule, from the elbow-side face');
  // The issued sheet dimensions the pipe from the pair's face on the pipe, leaving the gasket in the elbow's make-up.
  d.sheets = { 'SP-1': { dimensions: [{ from: { nodeId: flange, runId: pipe.id, face: 'body' }, to: { nodeId: end.id }, axis: [0, 0, 1], offset: 10 }] } };
  const text = createDrawing(d).primitives.find(p => p.type === 'text' && p.label?.key === 'drafted-dimension:0');
  const row = cutSchedule(d).find(r => r.run.id === pipe.id)!;
  assert.equal(text?.type === 'text' && text.text, '998');
  assert.equal(String(Math.round(row.overall)), '998');
  assert.equal(Math.round((row.overall - row.takeouts[0] - row.takeouts[1] - row.gaps[0] - row.gaps[1]) * 100) / 100, Math.round(row.cut * 100) / 100);
});

test('the gasket span is a validated drawing style', () => {
  const d = doc();
  run(d, null, [1000, 0, 0]);
  assert.doesNotThrow(() => parseIsoJson(JSON.stringify({ ...d, style: { ...d.style, gasketSpan: 'pipe' } })));
  assert.throws(() => parseIsoJson(JSON.stringify({ ...d, style: { ...d.style, gasketSpan: 'valve' } })));
  assert.doesNotThrow(() => parseIsoJson(JSON.stringify({ ...d, style: { ...d.style, fittingGasketSpan: 'fitting' } })));
  assert.throws(() => parseIsoJson(JSON.stringify({ ...d, style: { ...d.style, fittingGasketSpan: 'elbow' } })));
});
