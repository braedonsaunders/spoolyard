import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, applyComponent, attachComponent, clone, getNode, newIso, parseIsoJson, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';
import { createDrawing } from '../src/core/drawing.ts';

const specA = JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')) as PipeSpec;
const doc = (units: IsoDocument['units'] = 'mm') => {
  const d = newIso(); d.specs = [clone(specA)]; d.units = units;
  return d;
};
const run = (d: IsoDocument, from: string | null, delta: [number, number, number], connector = false) => {
  const node = appendRun(d, from, delta, 'A', 2, 'SP-1', 'L-1');
  if (connector) d.runs.at(-1)!.connector = true;
  return node;
};
const row = (d: IsoDocument, code: string) => d.specs[0].fittings.find(f => f.component === code && f.nps === 2)!;
const type = (code: string) => COMPONENT_TYPES.find(t => t.code === code)!;
/** Dimension lettering on the sheet. */
const dims = (d: IsoDocument) => createDrawing(d).primitives.flatMap(p => p.type === 'text' && p.layer === 'DIM' ? [p.text] : []);
const sixteenths = (text: string) => {
  const m = /^(?:(\d+)'-)?(\d+)?(?: ?(\d+)\/(\d+))?"$/.exec(text)!;
  return (Number(m[1] ?? 0) * 12 + Number(m[2] ?? 0)) * 16 + (m[3] ? Number(m[3]) * 16 / Number(m[4]) : 0);
};

test('a chain of dimensions adds up to its overall, in millimetres and in sixteenths', () => {
  // A valve in the middle of a run: each piece rounded on its own would make 2001.
  const metric = doc();
  run(metric, null, [2000, 0, 0]);
  placeComponentOnPipe(metric, metric.runs[0].id, type('GATE-FL'), 0.5);
  const values = dims(metric).map(Number);
  assert.ok(values.includes(2000));
  assert.equal(values.filter(v => v !== 2000).reduce((a, b) => a + b, 0), 2000);
  // Olets every 10.03": three pieces of 10" would not make the 30 1/16" overall.
  const imperial = doc('imperial'), inch = 25.4;
  run(imperial, null, [30.09 * inch, 0, 0]);
  for (const f of [1 / 3, 2 / 3]) applyComponent(imperial, attachComponent(imperial, imperial.runs[0].id, 'olet', f), 'WOL', row(imperial, 'WOL'));
  const texts = dims(imperial), overall = texts.map(sixteenths).reduce((a, b) => Math.max(a, b));
  assert.equal(overall, 481);
  assert.equal(texts.map(sixteenths).filter(v => v !== overall).reduce((a, b) => a + b, 0), overall);
});

test('a gasket at the end of a leg is dimensioned and the overall takes it in', () => {
  const d = doc();
  const flange = run(d, null, [1000, 0, 0]);
  applyComponent(d, flange, 'FLG-RFWN', row(d, 'FLG-RFWN'));
  run(d, flange.id, [3, 0, 0], true);
  assert.deepEqual(dims(d).sort(), ['1000', '1003', '3']);
});

test('a drawing that ends at a valve face leaves the gasket to the next drawing', () => {
  const d = doc();
  const valve = run(d, null, [1000, 0, 0]);
  applyComponent(d, valve, 'GATE-FL', row(d, 'GATE-FL'));
  const half = row(d, 'GATE-FL').takeout;
  run(d, valve.id, [half, 0, 0], true);
  valve.portFlanges = { [d.runs[1].id]: { component: 'NONE', gasket: false, bolts: false } };
  const values = dims(d).map(Number);
  assert.equal(Math.max(...values), Math.round(1000 + half));
  assert.ok(!values.includes(3));
});

test('fittings welded straight together are dimensioned from the work point to the far joint', () => {
  const d = doc();
  const elbow = run(d, null, [1000, 0, 0]);
  const reducer = run(d, elbow.id, [0, 0, -150], true);
  run(d, reducer.id, [0, 0, -600]);
  applyComponent(d, reducer, 'C-RED', d.specs[0].fittings.find(f => f.component === 'C-RED' && f.nps === 2)!);
  const small = 150 + (getNode(d, reducer.id).takeout ?? row(d, 'C-RED').takeout);
  const texts = dims(d);
  assert.ok(texts.includes(String(Math.round(small))), texts.join(' '));
  assert.ok(!texts.includes('150'));
});

test('supports are located by default, chained support to support from a fitting across a joint', () => {
  const d = doc();
  const elbow = run(d, null, [0, 1000, 0]);
  const pair = run(d, elbow.id, [3000, 0, 0]);
  run(d, pair.id, [3000, 0, 0]);
  applyComponent(d, pair, 'FLG-RFWN', row(d, 'FLG-RFWN'));
  attachComponent(d, d.runs[1].id, 'support', 500 / 3000);
  const second = attachComponent(d, d.runs[2].id, 'support', 1000 / 3000);
  assert.ok(dims(d).includes('500') && dims(d).includes('3500'));
  second.dimensioned = false;
  assert.ok(dims(d).includes('500') && !dims(d).includes('3500'));
});

test('an approximate location is dimensioned from the nearest fitting and marked (±)', () => {
  const d = doc();
  const elbow = run(d, null, [0, 1000, 0]);
  run(d, elbow.id, [3000, 0, 0]);
  const wall = attachComponent(d, d.runs[1].id, 'annotation', 0.3);
  Object.assign(wall, { calloutText: 'WALL', dimensioned: true, approximate: true });
  assert.ok(dims(d).includes('900(±)'));
});

test('a capped vent off an olet takes no dimensions; a screwed leg that turns does', () => {
  const d = doc();
  run(d, null, [1000, 0, 0]);
  const olet = attachComponent(d, d.runs[0].id, 'olet', 0.4);
  applyComponent(d, olet, 'WOL', row(d, 'WOL'));
  const cap = run(d, olet.id, [0, 0, 100], true);
  cap.kind = 'cap';
  // The olet is located on the pipe and its stub is not dimensioned.
  assert.deepEqual(dims(d).sort(), ['1000', '400']);
  const turned = doc();
  run(turned, null, [1000, 0, 0]);
  const branch = attachComponent(turned, turned.runs[0].id, 'olet', 0.4);
  const elbow = run(turned, branch.id, [0, 0, 100], true);
  run(turned, elbow.id, [200, 0, 0], true).kind = 'cap';
  assert.ok(['100', '200', '400', '600'].every(t => dims(turned).includes(t)), dims(turned).join(' '));
});

test("a screwed branch is measured from the pipe's centreline, and a tee's capped branch is not dimensioned", () => {
  const d = doc();
  run(d, null, [1000, 0, 0]);
  const olet = attachComponent(d, d.runs[0].id, 'olet', 0.4);
  // A nipple screwed into the olet, standing off the pipe, and an elbow beyond it.
  const nipple = attachComponent(d, d.runs[0].id, 'valve', 0.4);
  Object.assign(nipple, { component: 'NIPPLE', position: [400, 0, 60] });
  run(d, run(d, nipple.id, [0, 0, 40], true).id, [200, 0, 0], true);
  assert.ok(olet && dims(d).includes('100') && !dims(d).includes('40'), dims(d).join(' '));
  const capped = doc();
  const tee = run(capped, null, [1000, 0, 0]);
  run(capped, tee.id, [1000, 0, 0]);
  run(capped, run(capped, tee.id, [0, 0, 80], true).id, [0, 0, 60], true).kind = 'cap';
  assert.ok(!dims(capped).some(t => ['80', '140'].includes(t)), dims(capped).join(' '));
});

test("a tee's own short skewed branch is dimensioned by its length alone", () => {
  const d = doc();
  const tee = run(d, null, [1000, 0, 0]);
  run(d, tee.id, [1000, 0, 0]);
  run(d, tee.id, [45, -45, 0], true);
  assert.ok(!dims(d).some(t => /°/.test(t)));
  assert.ok(dims(d).includes('64'));
});

test('an overall runs across tees only between two open ends', () => {
  const open = doc();
  const tee = run(open, null, [1000, 0, 0]);
  run(open, tee.id, [1000, 0, 0]);
  run(open, tee.id, [0, 1000, 0]);
  assert.ok(dims(open).includes('2000'));
  const elbowed = doc();
  const elbow = run(elbowed, null, [0, 1000, 0]);
  const t = run(elbowed, elbow.id, [1000, 0, 0]);
  run(elbowed, t.id, [1000, 0, 0]);
  run(elbowed, t.id, [0, -1000, 0]);
  assert.ok(!dims(elbowed).includes('2000'));
});

test('an approximate location is saved as a yes or no', () => {
  const d = doc();
  run(d, null, [1000, 0, 0]);
  const wall = attachComponent(d, d.runs[0].id, 'annotation', 0.5);
  wall.approximate = true;
  assert.equal(parseIsoJson(JSON.stringify(d)).nodes.find(n => n.id === wall.id)!.approximate, true);
  Object.assign(wall, { approximate: 'about' });
  assert.throws(() => parseIsoJson(JSON.stringify(d)));
});
