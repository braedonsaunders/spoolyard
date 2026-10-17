import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, applyComponent, bom, clone, getNode, insertComponent, newIso, parseIsoJson, runResult, validateIso, welds, type PipeSpec } from '../src/core/model.ts';
import { continuationPoint, flangedJoints } from '../src/core/joints.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';
import { createDrawing } from '../src/core/drawing.ts';
import { sheetMaterials } from '../src/core/material-list.ts';

const specA = JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')) as PipeSpec;
const straight = (length = 2000) => {
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [length, 0, 0], 'A', 2, 'SP-1', 'L-1');
  return doc;
};
const type = (code: string) => COMPONENT_TYPES.find(t => t.code === code)!;

test('an issued joint callout can reference existing material items without purchasing them twice', () => {
  const doc=straight(), run=doc.runs[0];
  const a=placeComponentOnPipe(doc,run.id,type('FLG-RFWN'),0), b=placeComponentOnPipe(doc,run.id,type('FLG-RFWN'),1);
  a.jointSupply={bolts:false,gasket:false};
  const before=sheetMaterials(doc,'SP-1'), bolts=before.find(r=>r.category==='bolt')!, gasket=before.find(r=>r.category==='gasket')!;
  const joint=flangedJoints(doc,'SP-1').find(j=>j.nodeId===a.id)!;
  doc.sheets={'SP-1':{jointItems:{[joint.id]:{bolts:bolts.key,gasket:gasket.key}}}};
  assert.deepEqual(sheetMaterials(doc,'SP-1'),before);
  assert.ok(createDrawing(doc,'SP-1').primitives.some(p=>p.type==='text' && p.owner===a.id && p.text.includes(`B${bolts.id} G${gasket.id}`)));
  assert.deepEqual(parseIsoJson(JSON.stringify(doc)).sheets,doc.sheets);
  doc.sheets['SP-1'].jointItems![joint.id].bolts='missing';
  assert.ok(!createDrawing(doc,'SP-1').primitives.some(p=>p.type==='text' && p.owner===a.id && /B\d/.test(p.text)));
});

test('a continuation coordinate can use either flange face without changing cuts or dimension points', () => {
  const doc = straight(), run = doc.runs[0];
  const end = placeComponentOnPipe(doc, run.id, type('FLG-RFWN'), 1);
  end.continuation = { text: "CONT'D ON NEXT", coordinateFace: 'mate' };
  const cut = runResult(doc, run).cut;
  assert.deepEqual(continuationPoint(doc, end), [2003.17, 0, 0]);
  assert.deepEqual(end.position, [2000, 0, 0]);
  assert.equal(runResult(doc, run).cut, cut);
  // When the dimension is already to the mate, do not add the gasket a second time.
  end.jointSupply = { gasket: true, bolts: true, measuredTo: 'mate' };
  assert.deepEqual(continuationPoint(doc, end), end.position);
  end.continuation.coordinateFace = 'flange';
  assert.deepEqual(continuationPoint(doc, end), [1996.83, 0, 0]);
  const restored = parseIsoJson(JSON.stringify(doc));
  assert.deepEqual(continuationPoint(restored, getNode(restored, end.id)), [1996.83, 0, 0]);
  (end.continuation as any).coordinateFace = 'centre';
  assert.throws(() => parseIsoJson(JSON.stringify(doc)), /Invalid/);
});

test('separately modelled flanges bolt together without phantom pipe or welds between their faces', () => {
  const doc = straight(); doc.specs[0].rootGap = 0;
  const f1 = getNode(doc, doc.runs[0].to);
  const f2 = appendRun(doc, f1.id, [3.17, 0, 0], 'A', 2, 'SP-1', 'L-1');
  const link = doc.runs.at(-1)!; link.connector = true;
  appendRun(doc, f2.id, [1000, 0, 0], 'A', 2, 'SP-1', 'L-1');
  for (const node of [f1, f2]) applyComponent(doc, node, 'FLG-RFWN', doc.specs[0].fittings.find(f => f.component === 'FLG-RFWN' && f.nps === 2)!);
  assert.equal(welds(doc).length, 2, 'only the two pipe-to-flange welds');
  assert.ok(welds(doc).every(w => w.runId !== link.id));
  assert.ok(!createDrawing(doc).primitives.some(p => p.layer === 'PIPE' && p.owner === link.id));
});

test('a flanged valve brings two mating flanges, two gaskets and two stud-bolt sets', () => {
  const doc = straight();
  placeComponentOnPipe(doc, doc.runs[0].id, type('GATE-FL'), 0.5);
  const joints = flangedJoints(doc);
  assert.equal(joints.length, 2);
  for (const joint of joints) {
    assert.equal(joint.kind, 'component-port');
    assert.deepEqual(joint.flanges.map(f => [f.code, f.implicit]), [['FLG-RFWN', true]]);
    assert.equal(joint.gasket!.thickness, 3.17);
    assert.deepEqual([joint.bolts!.kind, joint.bolts!.count, joint.bolts!.diameter, joint.bolts!.length], ['stud', 4, 15.88, 82.55]);
  }
  const rows = bom(doc);
  assert.equal(rows.find(r => /GASKET/.test(r.description))!.qty, 2);
  assert.equal(rows.find(r => /STUD BOLTS/.test(r.description))!.qty, 8);
  assert.match(rows.find(r => /STUD BOLTS/.test(r.description))!.description, /5\/8"X3 1\/4"/);
  assert.equal(rows.find(r => /FLANGE RF WN/.test(r.description))!.qty, 2);
  assert.equal(welds(doc).length, 2);
  assert.deepEqual(validateIso(doc), []);
});

test('a lug butterfly valve is bolted from each side with lug bolts', () => {
  const doc = straight();
  placeComponentOnPipe(doc, doc.runs[0].id, type('BFLY-LUG'), 0.5);
  const bolts = flangedJoints(doc).map(j => j.bolts!);
  assert.deepEqual(bolts.map(b => [b.kind, b.count]), [['lug', 4], ['lug', 4]]);
  assert.ok(bom(doc).some(r => /^LUG BOLTS/.test(r.description) && r.qty === 8));
  assert.ok(doc.runs.every(r => Number.isFinite(runResult(doc, r).cut)));
});

test('a flanged hose may bolt to a tapped equipment body with lug bolts at that port', () => {
  const doc = straight();
  const hose = placeComponentOnPipe(doc, doc.runs[0].id, type('HOSE-FL'), 0.5);
  const port = doc.runs.find(r => r.to === hose.id)!;
  hose.portFlanges = { [port.id]: { component: 'NONE', mate: 'lug' } };
  const joint = flangedJoints(doc).find(j => j.nodeId === hose.id && j.runIds.includes(port.id))!;
  assert.equal(joint.bolts!.kind, 'lug');
  assert.equal(joint.flanges.length, 0);
  const saved = parseIsoJson(JSON.stringify(doc));
  assert.equal(getNode(saved, hose.id).portFlanges![port.id].mate, 'lug');
});

test('a wafer valve takes one set of through studs and two gaskets', () => {
  const doc = straight();
  placeComponentOnPipe(doc, doc.runs[0].id, type('BFLY-WAFER'), 0.5);
  const joints = flangedJoints(doc);
  assert.equal(joints.filter(j => j.gasket).length, 2);
  assert.equal(joints.filter(j => j.bolts).length, 1);
});

test('lap-joint specifications add a stub end at every flange', () => {
  const doc = straight();
  doc.specs[0].parameters = { ...doc.specs[0].parameters, 'Default Flange': 'FLG-RFLJ' };
  placeComponentOnPipe(doc, doc.runs[0].id, type('GATE-FL'), 0.5);
  const joints = flangedJoints(doc);
  assert.ok(joints.every(j => j.flanges[0].code === 'FLG-RFLJ' && j.stubEnds.length === 1));
  assert.ok(doc.runs.every(r => Number.isFinite(runResult(doc, r).cut)));
  assert.equal(bom(doc).filter(r => /STUB/.test(r.description)).reduce((n, r) => n + r.qty, 0), 2);
});

test('a flange on an open end mates with equipment; a flange mid-pipe is a bolted pair', () => {
  const doc = straight();
  const end = placeComponentOnPipe(doc, doc.runs[0].id, type('FLG-RFWN'), 1);
  assert.equal(end.id, doc.runs[0].to);
  assert.deepEqual(getNode(doc, end.id).position, [2000, 0, 0]);
  let joints = flangedJoints(doc);
  assert.equal(joints[0].kind, 'equipment');
  assert.equal(joints[0].flanges.length, 1);
  // The end is the flange face: the pipe stops one weld-neck hub short of it.
  assert.ok(Math.abs(runResult(doc, doc.runs[0]).cut - (2000 - 63.5 - 1.6)) < 1e-9);
  // Measured to the nozzle face instead, the gasket is allowed for too.
  end.jointSupply = { gasket: true, bolts: true, measuredTo: 'mate' };
  assert.ok(Math.abs(runResult(doc, doc.runs[0]).cut - (2000 - 63.5 - 3.17 - 1.6)) < 1e-9);
  end.jointSupply = { gasket: false, bolts: false, measuredTo: 'mate' };
  assert.ok(Math.abs(runResult(doc, doc.runs[0]).cut - (2000 - 63.5 - 1.6)) < 1e-9);
  end.jointSupply = { gasket: false, bolts: false };
  assert.deepEqual(flangedJoints(doc)[0].supplied, { flange: true, gasket: false, bolts: false });
  assert.ok(!bom(doc).some(r => /GASKET|STUD/.test(r.description)));
  const pair = placeComponentOnPipe(doc, doc.runs[0].id, type('FLG-RFWN'), 0.5);
  joints = flangedJoints(doc);
  const middle = joints.find(j => j.nodeId === pair.id)!;
  assert.equal(middle.kind, 'flange-pair');
  assert.equal(middle.flanges.length, 2);
  assert.equal(bom(doc).find(r => /FLANGE RF WN/.test(r.description))!.qty, 3);
});

test('flanges, blinds and caps place on an open pipe end but not on a fitting', () => {
  const doc = straight();
  const elbow = appendRun(doc, doc.runs[0].to, [0, 1000, 0], 'A', 2, 'SP-1', 'L-1');
  void elbow;
  assert.throws(() => placeComponentOnPipe(doc, doc.runs[0].id, type('FLG-RFWN'), 1), /already has a fitting/);
  const cap = placeComponentOnPipe(doc, doc.runs[0].id, type('W-CAP'), 0);
  assert.equal(cap.kind, 'cap');
  assert.throws(() => placeComponentOnPipe(doc, doc.runs[1].id, type('W-CAP'), 0.5), /open pipe end/);
  assert.throws(() => placeComponentOnPipe(doc, doc.runs[1].id, type('GATE-FL'), 1), /between the pipe ends/);
});

test('standard components never ask for a manual length', () => {
  const doc = newIso(); doc.specs[0].fittings = [];
  const a = appendRun(doc, null, [2000, 0, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, a.id, [0, 1500, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, a.id, [1500, 0, 0], 'CS40', 2, 'SP', '');
  assert.equal(a.kind, 'tee');
  assert.equal(a.component, 'W-TEE');
  placeComponentOnPipe(doc, doc.runs[0].id, type('BALL-FL'), 0.5);
  assert.ok(doc.runs.every(r => Number.isFinite(runResult(doc, r).cut)), JSON.stringify(validateIso(doc)));
  assert.deepEqual(validateIso(doc), []);
});

test('three pipes without a straight run explain the problem instead of asking for a branch', () => {
  const doc = newIso();
  const corner = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, corner.id, [0, 1000, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, corner.id, [0, 0, 1000], 'CS40', 2, 'SP', '');
  const issues = validateIso(doc).join('\n');
  assert.match(issues, /without a straight run/);
  assert.doesNotMatch(issues, /Select the branch/);
  void insertComponent;
});

test('the same flange drawn as a node and supplied with a valve is one BOM line', async () => {
  const { sheetMaterials } = await import('../src/core/material-list.ts');
  const doc = straight();
  placeComponentOnPipe(doc, doc.runs[0].id, type('GATE-FL'), 0.5);
  placeComponentOnPipe(doc, doc.runs[0].id, type('FLG-RFWN'), 0);
  assert.equal(bom(doc).filter(r => /FLANGE RF WN/.test(r.description)).length, 1);
  assert.equal(bom(doc).find(r => /FLANGE RF WN/.test(r.description))!.qty, 3);
  const flanges = sheetMaterials(doc, 'SP-1').filter(r => r.category === 'flange');
  assert.deepEqual(flanges.map(r => r.qty), [3]);
});

test('PCF carries a flanged valve with its flanges, gaskets and bolts, and reads back to the same joint', async () => {
  const { exportPcf, importPcf } = await import('../src/core/pcf.ts');
  const doc = straight();
  placeComponentOnPipe(doc, doc.runs[0].id, type('GATE-FL'), 0.5);
  const pcf = exportPcf(doc);
  assert.equal(pcf.match(/^FLANGE$/gm)?.length, 2);
  assert.equal(pcf.match(/^GASKET$/gm)?.length, 2);
  assert.equal(pcf.match(/^BOLT$/gm)?.length, 2);
  const restored = importPcf(pcf).doc;
  assert.equal(restored.nodes.length, doc.nodes.length);
  const cuts = (d: typeof doc) => d.runs.map(r => runResult(d, r).cut).sort((a, b) => a - b);
  cuts(restored).forEach((cut, i) => assert.ok(Math.abs(cut - cuts(doc)[i]) < 1e-6));
  assert.equal(flangedJoints(restored).length, 2);
});

test('a lateral takes its long run dimension on the side its branch leans toward', () => {
  const doc = straight(1000);
  const lateral = doc.nodes.find(n => n.id === doc.runs[0].to)!;
  appendRun(doc, lateral.id, [1000, 0, 0], 'A', 2, 'SP-1', 'L-1');
  appendRun(doc, lateral.id, [700, 700, 0], 'A', 2, 'SP-1', 'L-1');
  assert.equal(lateral.component, 'W-LAT');
  const [before, after] = doc.runs;
  // Spec A 2" lateral: 4" short side, 8 1/2" on the leaning side and the branch.
  assert.equal(runResult(doc, before).takeouts[1], 101.6);
  assert.equal(runResult(doc, after).takeouts[0], 215.9);
  assert.deepEqual(validateIso(doc), []);
});

test('a pipe flanged at one end only loses the flange allowance at that end alone', () => {
  const bend = () => {
    const doc = straight();
    appendRun(doc, doc.runs[0].to, [0, 1000, 0], 'A', 2, 'SP-1', 'L-1');
    return doc;
  };
  const bare = bend(), open = runResult(bare, bare.runs[1]).cut, plain = runResult(bare, bare.runs[0]).cut;
  const cases: Array<[string, number, RegExp[]]> = [
    ['FLG-RFWN', 63.5, [/FLANGE RF WN/]],
    ['FLG-RFLJ', NaN, [/^FLANGE, LAP-JOINT/, /STUB END/]],
    ['FLG-RFSO', NaN, [/SLIP-ON FLANGE RF/]]
  ];
  for (const [code, hub, parts] of cases) {
    const doc = bend(), pipe = doc.runs[1];
    const end = placeComponentOnPipe(doc, pipe.id, type(code), 1);
    assert.equal(end.id, pipe.to, code);
    const cut = runResult(doc, pipe).cut, elbowSide = runResult(doc, doc.runs[0]).cut;
    // Only this pipe's flanged end changes; the plain end is still cut to the elbow.
    assert.ok(cut < open && cut > open - 160, `${code}: ${cut} vs ${open}`);
    if (Number.isFinite(hub)) assert.ok(Math.abs(open - cut - hub - doc.specs[0].rootGap) < 1e-9, code);
    assert.equal(elbowSide, plain, code);
    const rows = bom(doc);
    for (const part of parts) assert.equal(rows.filter(r => part.test(r.description)).reduce((n, r) => n + r.qty, 0), 1, `${code} ${part}`);
    assert.equal(rows.find(r => /GASKET/.test(r.description))!.qty, 1, code);
    assert.equal(rows.find(r => /STUD BOLTS/.test(r.description))!.qty, 4, code);
    // Gasket and bolts supplied with the mating flange on another drawing leave only the flange.
    getNode(doc, end.id).jointSupply = { gasket: false, bolts: false };
    assert.ok(!bom(doc).some(r => /GASKET|STUD/.test(r.description)), code);
    assert.equal(validateIso(doc).length, 0, code);
  }
});


test('measured flanged component bodies put their joint faces at the same distances used for pipe cuts', () => {
  const doc=newIso(),meter=appendRun(doc,null,[1000,0,0],'CS40',2,'S1','L1');
  appendRun(doc,meter.id,[1000,0,0],'CS40',2,'S1','L1');applyComponent(doc,meter,'FLOWMETER-FL');
  meter.takeout=101.6;
  const cuts=doc.runs.map(r=>runResult(doc,r).cut),joints=flangedJoints(doc,'S1').filter(j=>j.nodeId===meter.id);
  assert.equal(joints.length,2);
  assert.deepEqual(joints.map(j=>Math.round((j.position[0]-meter.position[0])*10)/10),[-101.6,101.6]);
  createDrawing(doc,'S1');assert.deepEqual(doc.runs.map(r=>runResult(doc,r).cut),cuts);
  meter.takeout=152.4;
  assert.deepEqual(flangedJoints(doc,'S1').filter(j=>j.nodeId===meter.id).map(j=>Math.round((j.position[0]-meter.position[0])*10)/10),[-152.4,152.4]);
});
