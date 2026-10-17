import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, applyComponent, attachComponent, clone, getNode, newIso, parseIsoJson, removeComponent, runResult, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { placeComponentOnPipe, setDimensionAxis, setDimensionReverse } from '../src/core/component-position.ts';
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
  const offset=d.runs.at(-1)!;
  offset.offsetDrawing={setAndRoll:true};
  run(d, b.id, [1500, 0, 0]);
  const texts = dims(d);
  for (const t of ['500', '300', '400', '707', 'SET 500', '53° ROLL']) assert.ok(texts.includes(t), t + ' in ' + texts.join(' '));
});

test('offset legs can be dimensioned with arrows while their values and pipe cuts remain calculated',()=>{
  const d=doc(),a=run(d,null,[1500,0,0]),b=run(d,a.id,[500,300,400]);
  const r=d.runs.at(-1)!;run(d,b.id,[1500,0,0]);
  const before=d.runs.map(r=>runResult(d,r).cut),values=dims(d).sort();
  assert.ok(!values.some(t=>/SET|ROLL/.test(t)));
  r.offsetDrawing={dimensionLegs:true,trueLengthOffset:16};
  assert.deepEqual(dims(d).sort(),values);
  assert.deepEqual(d.runs.map(r=>runResult(d,r).cut),before);
  assert.deepEqual(parseIsoJson(JSON.stringify(d)).runs.find(x=>x.id===r.id)!.offsetDrawing,r.offsetDrawing);
  r.offsetDrawing.trueLengthOffset=5001;
  assert.throws(()=>parseIsoJson(JSON.stringify(d)),/offset drafting/);
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

test('drafted dimensions can replace one straight while other straights remain automatic', () => {
  const d = doc(), elbow = run(d, null, [1000,0,0]), end = run(d, elbow.id, [0,0,500]);
  const support = attachComponent(d, d.runs[1].id, 'support', 0.4);
  support.dimensioned = true;
  d.sheets = {'SP-1': {dimensionScope:'legs',dimensions:[{
    from:{nodeId:elbow.id},to:{nodeId:end.id},axis:[1,0,0],offset:70,
  }]}};
  assert.deepEqual(dims(d).sort(), ['1000','500']);
  assert.deepEqual(dims(parseIsoJson(JSON.stringify(d))), dims(d));
  d.sheets['SP-1'].dimensionScope = 'sheet';
  assert.deepEqual(dims(d), ['500']);
});

test('a drafted offset chain retains its measured triangle and angle', () => {
  const d = doc(), end = run(d, null, [1000,500,0]);
  d.sheets = {'SP-1': {dimensionScope:'legs',dimensions:[{
    from:{nodeId:d.runs[0].from},to:{nodeId:end.id},axis:[0,0,1],offset:70,
  }]}};
  const texts = dims(d);
  assert.equal(texts.filter(t => t === '1118').length, 1);
  assert.ok(texts.includes('1000') && texts.includes('500') && texts.includes('27° H'), texts.join(' '));
});

test('held extension directions move the calculated chain through a tee without changing its branch or cuts', () => {
  const d = doc();d.sheetFormat='production';const tee = run(d, null, [1000,0,0]);
  run(d, tee.id, [1000,0,0]);
  run(d, tee.id, [0,0,500]);
  const before = d.runs.map(r => runResult(d,r).cut);
  setDimensionAxis(d,d.runs[0].id,[0,0,1]);
  assert.deepEqual(d.runs.map(r=>r.dimensionAxis),[[0,0,1],[0,0,1],undefined]);
  const fit = createDrawing(d).fit;
  const longest = () => createDrawing(d,'','iso',fit).primitives.flatMap(p=>p.type==='line'&&p.layer==='DIM'?[p]:[])
    .sort((a,b)=>Math.hypot(b.b[0]-b.a[0],b.b[1]-b.a[1])-Math.hypot(a.b[0]-a.a[0],a.b[1]-a.a[1]))[0];
  const upper = longest();
  setDimensionAxis(d,d.runs[0].id,[0,0,-1]);
  const lower = longest();
  assert.ok(upper.type==='line' && lower.type==='line' && lower.a[1]>upper.a[1]+50);
  assert.deepEqual(d.runs.map(r=>runResult(d,r).cut),before);
  assert.deepEqual(parseIsoJson(JSON.stringify(d)).runs[0].dimensionAxis,[0,0,-1]);
  setDimensionAxis(d,d.runs[0].id);
  assert.ok(d.runs.every(r=>!r.dimensionAxis));
  Object.assign(d.runs[0],{dimensionAxis:[0,0,0]});
  assert.throws(()=>parseIsoJson(JSON.stringify(d)),/dimension direction/);
});

test('a flange pair welded to a fitting dimensions to its face rather than its gasket centre', () => {
  const d=doc();
  for(const f of d.specs[0].fittings.filter(f=>f.kind==='gasket')) Object.assign(f,{thickness:4,takeout:2});
  const elbow=run(d,null,[1000,0,0]), flange=run(d,elbow.id,[0,202,0],true);
  run(d,flange.id,[0,1000,0]);
  applyComponent(d,flange,'FLG-FFLJ');
  const texts=dims(d);
  assert.ok(texts.includes('200') && texts.includes('1002') && !texts.includes('202'),texts.join(' '));
  const r=d.runs[1];
  d.sheets={'SP-1':{dimensions:[{from:{nodeId:elbow.id},to:{nodeId:flange.id,runId:r.id,face:'body'},axis:[0,0,1],offset:50}]}};
  assert.deepEqual(dims(d),['200']);
  d.sheets['SP-1'].dimensions![0].to.face='mate';
  assert.deepEqual(dims(d),['204']);
});

test('dimension lettering reverses independently of its measured points and pipe cuts', () => {
  const d=doc();run(d,null,[0,0,1000]);
  const before=createDrawing(d),cut=runResult(d,d.runs[0]).cut;
  const label=(drawing:ReturnType<typeof createDrawing>)=>drawing.primitives.find(p=>p.type==='text'&&p.layer==='DIM'&&p.text==='1000') as Extract<(typeof drawing.primitives)[number],{type:'text'}>;
  setDimensionReverse(d,d.runs[0].id,true);
  const after=createDrawing(d,'','iso',before.fit);
  assert.equal(Math.abs(label(before).rotation!-label(after).rotation!),180);
  assert.deepEqual(after.primitives.filter(p=>p.layer==='PIPE'),before.primitives.filter(p=>p.layer==='PIPE'));
  assert.equal(runResult(d,d.runs[0]).cut,cut);
  assert.equal(parseIsoJson(JSON.stringify(d)).runs[0].dimensionReverse,true);
  setDimensionReverse(d,d.runs[0].id,false);
  assert.equal(label(createDrawing(d,'','iso',before.fit)).rotation,label(before).rotation);
  d.sheets={'SP-1':{dimensions:[{from:{nodeId:d.runs[0].from},to:{nodeId:d.runs[0].to},axis:[1,0,0],offset:50,reverseText:true}]}};
  assert.equal(parseIsoJson(JSON.stringify(d)).sheets!['SP-1'].dimensions![0].reverseText,true);
  assert.equal(label(createDrawing(d)).rotation,label(after).rotation);
});

test('held dimension-line spacing exposes a draggable paper axis and survives reopening', () => {
  const d=doc();run(d,null,[0,0,1000]);
  const drawing=createDrawing(d),original=drawing.primitives.find(p=>p.type==='text'&&p.label?.dimension) as Extract<(typeof drawing.primitives)[number],{type:'text'}>;
  assert.ok(original.label?.dimension);
  const key=original.label!.key,cut=runResult(d,d.runs[0]).cut;
  d.sheets={'SP-1':{dimensionLayout:{[key]:{axis:[-1,0,0],offset:90,reverseText:true}}}};
  const changed=createDrawing(d,'','iso',drawing.fit).primitives.find(p=>p.type==='text'&&p.label?.key===key) as typeof original;
  assert.equal(changed.text,original.text);
  assert.equal(changed.label!.dimension!.offset,90);
  assert.ok(changed.label!.dimension!.axis[0]<0);
  assert.equal(runResult(d,d.runs[0]).cut,cut);
  assert.deepEqual(parseIsoJson(JSON.stringify(d)).sheets!['SP-1'].dimensionLayout,d.sheets['SP-1'].dimensionLayout);
  d.sheets['SP-1'].dimensionLayout![key].axis=[0,0,0];
  assert.throws(()=>parseIsoJson(JSON.stringify(d)),/sheet information/);
});


test('a drafted fitting-face dimension starts at the drawn weld face, independently of pipe compression', () => {
  const d=doc();d.style={...d.style,layout:'schematic',weldNumbers:false,lettering:'cad'};
  const elbow=run(d,null,[1000,0,0]);applyComponent(d,elbow,'W-LR90EL',row(d,'W-LR90EL'));
  const end=run(d,elbow.id,[0,0,1000]),r=d.runs[1];
  d.sheets={'SP-1':{nodePositions:{[d.runs[0].from]:[150,450],[elbow.id]:[400,450],[end.id]:[400,150]},dimensions:[{
    from:{nodeId:elbow.id,runId:r.id,face:'body'},to:{nodeId:end.id},axis:[1,0,0],offset:60,
  }]}};
  const drawing=createDrawing(d),weld=drawing.primitives.find(p=>p.type==='circle'&&p.layer==='WELD'&&p.owner===elbow.id&&p.p[1]<450);
  assert.ok(weld&&weld.type==='circle');
  assert.ok(drawing.primitives.some(p=>p.type==='line'&&p.layer==='DIM'&&Math.abs(p.a[1]-(weld.p[1]-1.5))<.01&&Math.abs(p.a[0]-(weld.p[0]+3*Math.sqrt(3)/2))<.01));
  const actual=1000-row(d,'W-LR90EL').takeout;
  assert.deepEqual(dims(d),[String(Math.round(actual))]);
  assert.deepEqual(dims(parseIsoJson(JSON.stringify(d))),dims(d));
});


test('offset hatch density is editable without changing pipe lengths or material quantities', () => {
  const d=doc(),a=run(d,null,[1000,0,0]),b=run(d,a.id,[500,500,0]);run(d,b.id,[0,1000,0]);
  const offset=d.runs[1],before=JSON.stringify(d.nodes.map(n=>n.position));
  offset.offsetDrawing={hatchCount:12,hatchSpacing:4,hatchStart:8,hatchGap:2};
  const hatches=createDrawing(d).primitives.filter(p=>p.layer==='HATCH');
  assert.ok(hatches.length>=10);
  offset.offsetDrawing.hatchCount=0;
  assert.equal(createDrawing(d).primitives.filter(p=>p.layer==='HATCH').length,0);
  assert.equal(JSON.stringify(d.nodes.map(n=>n.position)),before);
});


test('sliding dimension lettering along its line does not add a spurious leader in an oblique plane', () => {
  const d=doc();run(d,null,[0,0,2000]);
  const initial=createDrawing(d,'SP-1');d.sheets={'SP-1':{nodePositions:Object.fromEntries(initial.positions)}};
  const first=createDrawing(d,'SP-1'),label=first.primitives.find(p=>p.type==='text'&&p.label?.dimension) as Extract<(typeof first.primitives)[number],{type:'text'}>;
  const dimensionLine=first.primitives.find(p=>p.type==='line'&&p.layer==='DIM'&&Math.abs(p.a[0]-p.b[0])<.001&&Math.abs(p.a[1]-p.b[1])>100) as Extract<(typeof first.primitives)[number],{type:'line'}>;
  assert.ok(dimensionLine);const mid=[(dimensionLine.a[0]+dimensionLine.b[0])/2,(dimensionLine.a[1]+dimensionLine.b[1])/2];
  const hasLeader=(drawing:typeof first)=>drawing.primitives.some(p=>p.type==='line'&&p.layer==='LEADER'&&Math.abs(p.a[0]-mid[0])<.01);
  d.sheets!['SP-1'].labelPositions={[label.label!.key]:[label.p[0],label.p[1]+100]};
  assert.equal(hasLeader(createDrawing(d,'SP-1','iso',first.fit)),false);
  d.sheets['SP-1'].labelPositions![label.label!.key][0]+=100;
  const far=createDrawing(d,'SP-1','iso',first.fit);
  assert.equal(hasLeader(far),true);
});


test('individual dimensions choose feet and inches or inches without overriding their measured length', () => {
  const d=doc('imperial');run(d,null,[18*25.4,0,0]);
  const drawing=createDrawing(d),text=drawing.primitives.find(p=>p.type==='text'&&p.label?.dimension) as Extract<(typeof drawing.primitives)[number],{type:'text'}>;
  assert.equal(text.text,'18"');const key=text.label!.key,cut=runResult(d,d.runs[0]).cut;
  d.sheets={'SP-1':{dimensionLayout:{[key]:{format:'feet'}}}};
  const value=()=>createDrawing(d).primitives.find(p=>p.type==='text'&&p.label?.key===key) as typeof text;
  assert.equal(value().text,`1'-6"`);assert.equal(runResult(d,d.runs[0]).cut,cut);
  d.sheets['SP-1'].dimensionLayout![key].format='inches';assert.equal(value().text,'18"');
  assert.equal(parseIsoJson(JSON.stringify(d)).sheets!['SP-1'].dimensionLayout![key].format,'inches');
  d.runs.forEach(r=>{getNode(d,r.to).position=[12*25.4,0,0]});
  d.sheets['SP-1'].dimensionLayout![key].format='feet-short';assert.equal(value().text,"1'");
  d.dimensionMode='cut';assert.equal(value().text,"CUT 1'");d.dimensionMode='overall';
  (d.sheets['SP-1'].dimensionLayout![key] as any).format='invalid';assert.throws(()=>parseIsoJson(JSON.stringify(d)),/sheet information/);
});

test('triangle leg lettering can be omitted while its measured angle and travel remain', () => {
  const d=doc(),a=run(d,null,[1500,0,0]),b=run(d,a.id,[400,300,0]),r=d.runs.at(-1)!;run(d,b.id,[1500,0,0]);
  const cuts=d.runs.map(r=>runResult(d,r).cut),before=dims(d);
  assert.ok(before.includes('300')&&before.includes('400'));
  r.offsetDrawing={showLegValues:false};const after=dims(d);
  assert.ok(!after.includes('300')&&!after.includes('400'));assert.ok(after.some(t=>t.includes('°')));
  assert.deepEqual(d.runs.map(r=>runResult(d,r).cut),cuts);
  assert.equal(parseIsoJson(JSON.stringify(d)).runs.find(q=>q.id===r.id)!.offsetDrawing!.showLegValues,false);
});

test('rolling construction hatches can choose their plane and corner around a held paper plan point', () => {
  const d=doc(),a=run(d,null,[1000,0,0]),b=run(d,a.id,[400,300,500]),r=d.runs.at(-1)!;run(d,b.id,[1000,0,0]);
  const cuts=d.runs.map(r=>runResult(d,r).cut),hatches=()=>createDrawing(d).primitives.filter(p=>p.layer==='HATCH');
  const both=hatches();r.offsetDrawing={hatchPlane:'H',hatchFrom:'end',planPoint:[320,360]};
  const held=createDrawing(d),one=hatches();assert.ok(one.length>0&&one.length<both.length);
  assert.ok(held.primitives.some(p=>p.type==='line'&&p.layer==='DIM'&&[p.a,p.b].some(v=>v[0]===320&&v[1]===360)));
  assert.deepEqual(d.runs.map(r=>runResult(d,r).cut),cuts);
  assert.deepEqual(parseIsoJson(JSON.stringify(d)).runs.find(q=>q.id===r.id)!.offsetDrawing,r.offsetDrawing);
  r.offsetDrawing.hatchFrom='start';assert.notDeepEqual(hatches(),one);
  r.offsetDrawing.planPoint=[NaN,0];assert.throws(()=>parseIsoJson(JSON.stringify(d)),/offset drafting/);
});

test('roundoff between equal rolling-offset legs does not flip the construction axes', () => {
  const d=doc(),a=run(d,null,[1000,0,0]),b=run(d,a.id,[400,400,500]);run(d,b.id,[1000,0,0]);
  const hatches=()=>createDrawing(d).primitives.filter(p=>p.layer==='HATCH').flatMap(p=>p.type==='line'?[...p.a,...p.b]:[]);
  const before=hatches();b.position[1]+=1e-10;const after=hatches();assert.equal(after.length,before.length);
  after.forEach((n,i)=>assert.ok(Math.abs(n-before[i])<.001));
});

test('offset construction can omit its redundant travel dimension while retaining its measured legs',()=>{
 const d=doc();run(d,null,[300,400,0]);const r=d.runs[0],cuts=d.runs.map(r=>runResult(d,r).cut);
 assert.ok(dims(d).includes('500'));r.offsetDrawing={showTrueLength:false};const values=dims(d);
 assert.ok(!values.includes('500'));assert.ok(values.includes('300')&&values.includes('400')&&values.some(t=>t.includes('°')));
 assert.deepEqual(d.runs.map(r=>runResult(d,r).cut),cuts);assert.equal(parseIsoJson(JSON.stringify(d)).runs[0].offsetDrawing!.showTrueLength,false);
});

test('choosing the opposite angular corner measures its complement without changing the construction',()=>{
 const d=doc();run(d,null,[300,500,0]);const r=d.runs[0],cuts=d.runs.map(r=>runResult(d,r).cut);
 const first=dims(d).find(t=>t.endsWith('° H'))!;r.offsetDrawing={angleFromH:'end',angleArrows:true,angleRadiusH:48,angleOutwardH:true,rightAngleSize:12};
 const second=dims(d).find(t=>t.endsWith('° H'))!;
 assert.equal(parseFloat(first)+parseFloat(second),90);
 const p=createDrawing(d).primitives;assert.ok(p.some(q=>q.type==='polyline'&&q.layer==='DIM'&&q.fill));
 assert.deepEqual(d.runs.map(r=>runResult(d,r).cut),cuts);
 assert.deepEqual(parseIsoJson(JSON.stringify(d)).runs[0].offsetDrawing,r.offsetDrawing);
 r.offsetDrawing.angleRadiusH=-1;assert.throws(()=>parseIsoJson(JSON.stringify(d)),/offset drafting/);
});
