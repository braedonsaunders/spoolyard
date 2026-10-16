import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, applyComponent, attachComponent, clone, getNode, newIso, parseIsoJson, removeComponent, runResult, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
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
  // Issued legacy drawings may retain independently rounded dimensions; this is an explicit style choice.
  imperial.style!.dimensionRounding = 'individual';
  const legacy = dims(imperial).map(sixteenths);
  assert.equal(legacy.filter(v => v !== overall).reduce((a, b) => a + b, 0), 480);
});

test('a gasket at the end of a leg is dimensioned and the overall takes it in', () => {
  const d = doc();
  const flange = run(d, null, [1000, 0, 0]);
  applyComponent(d, flange, 'FLG-RFWN', row(d, 'FLG-RFWN'));
  run(d, flange.id, [3, 0, 0], true);
  assert.deepEqual(dims(d).sort(), ['1000', '1003', '3']);
});

test('a second component-face chain locates the body separately from its mating flange faces', () => {
  const d = doc();
  run(d, null, [4000, 0, 0]);
  const valve = placeComponentOnPipe(d, d.runs[0].id, type('GATE-FL'), 0.5);
  const half = row(d, 'GATE-FL').takeout;
  const before = dims(d);
  assert.ok(before.includes('4000'));
  d.style!.componentFaces = true;
  const values = dims(d).map(Number);
  assert.ok(values.includes(Math.round(2 * half)), values.join(' '));
  assert.ok(values.includes(Math.round(2 * half + 2 * 3.17)), values.join(' '));
  assert.ok(!values.includes(4000), 'the second chain replaces the overall');
  assert.deepEqual(getNode(d, valve.id).position, [2000, 0, 0]);
  const saved = parseIsoJson(JSON.stringify(d));
  assert.equal(saved.style!.componentFaces, true);
  assert.deepEqual(dims(saved), dims(d));
});

test('a flange pair at a break is measured at the face on the pipe, whichever way the leg was drawn', () => {
  // 1000 of pipe from an open end to a flange, the gasket, and a flange welded straight to an elbow 100 on.
  const pipeFirst = doc();
  const f1 = run(pipeFirst, null, [1000, 0, 0]), f2 = run(pipeFirst, f1.id, [3, 0, 0], true);
  run(pipeFirst, run(pipeFirst, f2.id, [100, 0, 0], true).id, [0, 1000, 0]);
  const elbowFirst = doc();
  const elbow = run(elbowFirst, null, [0, -1000, 0]), g2 = run(elbowFirst, elbow.id, [-100, 0, 0], true);
  const g1 = run(elbowFirst, g2.id, [-3, 0, 0], true);
  run(elbowFirst, g1.id, [-1000, 0, 0]);
  for (const [d, nodes] of [[pipeFirst, [f1, f2]], [elbowFirst, [g1, g2]]] as const) {
    for (const n of nodes) applyComponent(d, n, 'FLG-RFWN', row(d, 'FLG-RFWN'));
    const texts = dims(d);
    assert.ok(['1000', '103', '1103'].every(t => texts.includes(t)) && !texts.includes('1003'), texts.join(' '));
  }
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
  // A reducer between two elbows belongs to the elbow it reduces from; its small end is where the smaller line starts.
  const pair = doc();
  const first = appendRun(pair, null, [1000, 0, 0], 'A', 3, 'SP-1', 'L-1');
  const red = appendRun(pair, first.id, [0, 0, -158.75], 'A', 3, 'SP-1', 'L-1');
  const second = appendRun(pair, red.id, [0, 0, -120.65], 'A', 2, 'SP-1', 'L-1');
  appendRun(pair, second.id, [1000, 0, 0], 'A', 2, 'SP-1', 'L-1');
  pair.runs[1].connector = pair.runs[2].connector = true;
  applyComponent(pair, red, 'C-RED', pair.specs[0].fittings.find(f => f.component === 'C-RED' && f.nps === 3 && f.smallerNps === 2)!);
  assert.ok(['203', '76'].every(t => dims(pair).includes(t)) && !dims(pair).includes('159'), dims(pair).join(' '));
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

test('a support is located from the nearer end of its pipe piece, a flange face as well as a fitting', () => {
  const d = doc();
  const elbow = run(d, null, [0, 1000, 0]);
  const end = run(d, elbow.id, [3000, 0, 0]);
  applyComponent(d, end, 'FLG-RFWN', row(d, 'FLG-RFWN'));
  attachComponent(d, d.runs[1].id, 'support', 2600 / 3000);
  assert.ok(dims(d).includes('400') && !dims(d).includes('2600'), dims(d).join(' '));
});

test('an approximate location is dimensioned from the nearest fitting and marked (±)', () => {
  const d = doc();
  const elbow = run(d, null, [0, 1000, 0]);
  run(d, elbow.id, [3000, 0, 0]);
  const wall = attachComponent(d, d.runs[1].id, 'annotation', 0.3);
  Object.assign(wall, { calloutText: 'WALL', dimensioned: true, approximate: true });
  assert.ok(dims(d).includes('900(±)'));
  // From the fitting on its own pipe piece, not a nearer one across a flanged joint.
  const broken = doc();
  const first = run(broken, null, [0, 1000, 0]);
  const pair = run(broken, first.id, [300, 0, 0]);
  run(broken, run(broken, pair.id, [3000, 0, 0]).id, [0, -1000, 0]);
  applyComponent(broken, pair, 'FLG-RFWN', row(broken, 'FLG-RFWN'));
  Object.assign(attachComponent(broken, broken.runs[2].id, 'annotation', 1000 / 3000), { dimensioned: true, approximate: true });
  assert.ok(dims(broken).includes('2000(±)'), dims(broken).join(' '));
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
  // A bought nipple is a pipe piece in the model, but remains part of the closed vent assembly.
  d.runs[1].connector = false; d.runs[1].nipple = {};
  assert.deepEqual(dims(d).sort(), ['1000', '400']);
  const sizeLabels = createDrawing(d).primitives.filter(p => p.type === 'text' && p.text.endsWith(' NS'));
  assert.equal(sizeLabels.length, 1, 'the header has a size label; the capped nipple vent has none');
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
  const end = run(d, tee.id, [45, -45, 0], true);
  assert.ok(!dims(d).some(t => /°/.test(t)));
  assert.ok(dims(d).includes('64'));
  const drawing = createDrawing(d), a = drawing.positions.get(tee.id)!, b = drawing.positions.get(end.id)!;
  assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) < 60, 'the tee port stays a short stub on paper');
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

test('an offset construction is drawn smaller rather than leave the drawing area', () => {
  const d = doc();
  const a = run(d, null, [1000, 0, 0]);
  const b = run(d, a.id, [0, 8000, -8000]);
  run(d, b.id, [1000, 0, 0]);
  placeComponentOnPipe(d, d.runs[1].id, type('GATE-FL'), 0.5);
  const drawing = createDrawing(d), [x0, y0, x1, y1] = drawing.area;
  const lines = drawing.primitives.flatMap(p => p.type === 'line' && ['DIM', 'HATCH'].includes(p.layer) ? [p.a, p.b] : []);
  assert.ok(lines.length && lines.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1));
});

test('a rolling offset between parallel runs gives its set and roll as well as its legs and travel', () => {
  const d = doc();
  const a = run(d, null, [1500, 0, 0]);
  const b = run(d, a.id, [500, 300, 400]);
  run(d, b.id, [1500, 0, 0]);
  const texts = dims(d);
  for (const t of ['500', '300', '400', '707', 'SET 500', '53° ROLL']) assert.ok(texts.includes(t), t + ' in ' + texts.join(' '));
});

test('offset angles are given in whole degrees, but a 22 1/2° offset to the half degree', () => {
  const angle = (deg: number) => {
    const d = doc();
    const a = run(d, null, [1000, 0, 0]);
    const b = run(d, a.id, [1000, 1000 * Math.tan(deg * Math.PI / 180), 0]);
    run(d, b.id, [1000, 0, 0]);
    return dims(d).find(t => /°/.test(t));
  };
  assert.equal(angle(22.5), '22.5° H');
  assert.equal(angle(24.7), '25° H');
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

test('drafted face dimensions follow model edits and preserve fabrication geometry', () => {
  const d = doc();
  run(d, null, [4000, 0, 0]);
  const valve = placeComponentOnPipe(d, d.runs[0].id, type('GATE-FL'), 0.5);
  const edges = d.runs.filter(r => [r.from, r.to].includes(valve.id));
  const before = JSON.stringify(d.runs.map(r => ({ id: r.id, cut: runResult(d, r).cut })));
  d.sheets = { 'SP-1': { dimensions: [{
    from: { nodeId: valve.id, runId: edges[0].id, face: 'body' },
    to: { nodeId: valve.id, runId: edges[1].id, face: 'body' }, axis: [0, 0, 1], offset: 65,
  }] } };
  const half = row(d, 'GATE-FL').takeout;
  assert.deepEqual(dims(d), [String(Math.round(half * 2))]);
  assert.equal(JSON.stringify(d.runs.map(r => ({ id: r.id, cut: runResult(d, r).cut }))), before);
  const reopened = parseIsoJson(JSON.stringify(d));
  assert.deepEqual(dims(reopened), dims(d));
  reopened.sheets!['SP-1'].dimensions![0].from.face = 'mate';
  reopened.sheets!['SP-1'].dimensions![0].to.face = 'mate';
  assert.deepEqual(dims(reopened), [String(Math.round(half * 2 + 6.34))]);
  const bad = clone(d);
  bad.sheets!['SP-1'].dimensions![0].from.nodeId = 'missing';
  assert.throws(() => parseIsoJson(JSON.stringify(bad)), /sheet information/);
  removeComponent(d, valve.id);
  assert.deepEqual(d.sheets!['SP-1'].dimensions, []);
  assert.doesNotThrow(() => parseIsoJson(JSON.stringify(d)));
});

test('drafted end-flange faces resolve either stored coordinate convention', () => {
  const d = doc(), end = run(d, null, [1000, 0, 0]);
  applyComponent(d, end, 'FLG-RFWN', row(d, 'FLG-RFWN'));
  d.sheets = { 'SP-1': { dimensions: [{ from: { nodeId: d.runs[0].from },
    to: { nodeId: end.id, runId: d.runs[0].id, face: 'body' }, axis: [0,0,1], offset: 45 }] } };
  assert.deepEqual(dims(d), ['1000']);
  d.sheets['SP-1'].dimensions![0].to.face = 'mate';
  assert.deepEqual(dims(d), ['1003']);
  end.jointSupply = { measuredTo: 'mate', gasket: true, bolts: true };
  assert.deepEqual(dims(d), ['1000']);
  d.sheets['SP-1'].dimensions![0].to.face = 'body';
  assert.deepEqual(dims(d), ['997']);
  assert.deepEqual(end.position, [1000,0,0]);
});
