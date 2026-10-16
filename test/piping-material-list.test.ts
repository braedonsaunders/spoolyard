import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, getNode, newIso, takeout, welds, type PipeSpec } from '../src/core/model.ts';
import { sheetMaterials } from '../src/core/material-list.ts';
import { boltSizeText, coordinateText, draftLength, purchaseLength, sizeText } from '../src/core/format.ts';

const inch = (v: number) => v * 25.4;
/** An invented 150# stainless lap-joint specification with verbatim BOM text, as a client spec provides it. */
function lapJointSpec(): PipeSpec {
  const row = (component: string, kind: any, takeout: number, bomDescription: string, extra = {}) =>
    ({ id: `S1:${component}-2`, component, kind, nps: 2, takeout, description: component, source: 'test', bomDescription, ...extra });
  return {
    id: 'S1', name: 'S1', material: 'Stainless', schedule: '10S', rating: '150#', rootGap: 0, density: 8000, pipeCostM: 0, pipeLaborHoursM: 0, weldHoursPerDiameterInch: 0,
    parameters: { 'Default Flange': 'FLG-RFLJ' },
    sizes: [{ nps: 2, od: 60.3, wall: 2.77, kgM: 4.1, bomDescription: 'PIPE, WELDED, ASTM A312 TP316L, SCH 10S, ASME B36.19, BE' }],
    fittings: [
      row('W-LR90EL', 'elbow90', inch(3), 'ELBOW 90 LR, ASTM A403 WP316L, SCH 10S, ASME B16.9, BE'),
      row('STUB-END-SHORT', 'flange', inch(2.5), 'STUB END, MSS SP-43 TYPE A, ASTM A403 WP316L, SCH 10S'),
      row('FLG-RFLJ', 'flange', 0, 'FLANGE LJ, ASTM A182 F316L, ASME B16.5, CL150, FF'),
      row('GASK-RF', 'gasket', inch(1 / 32), 'GASKET, PTFE, 1/16" THK, ASME B16.21, CL150, FF', { thickness: inch(1 / 16) }),
      row('BOLT-RF', 'bolt', 0, 'STUD BOLT, ASTM A193 B8M CL2 C/W 2 HEX NUTS, CL150', { boltCount: 4, boltDiameter: inch(5 / 8), boltLength: inch(3.25) })
    ]
  };
}

test('a lap-joint sheet lists cut pieces, stub ends, flanges, bolts and gaskets like an issued drawing', () => {
  const doc = newIso(); doc.units = 'imperial'; doc.specs = [lapJointSpec()];
  const elbow = appendRun(doc, null, [inch(19.125), 0, 0], 'S1', 2, 'S-1', '10');
  const top = appendRun(doc, elbow.id, [0, 0, inch(30.5)], 'S1', 2, 'S-1', '10');
  const bottom = getNode(doc, doc.runs[0].from);
  applyComponent(doc, bottom, 'FLG-RFLJ', doc.specs[0].fittings[2]);
  applyComponent(doc, top, 'FLG-RFLJ', doc.specs[0].fittings[2]);
  // The top joint's gasket and bolts are listed on the next sheet, which also receives this sheet's mating flange.
  top.jointSupply = { gasket: false, bolts: false }; top.quantity = 2;
  const rows = sheetMaterials(doc, 'S-1').map(r => [r.id, r.qtyText, r.nd, r.description]);
  assert.deepEqual(rows, [
    [1, `1'-2"`, '2"', `PIPE, WELDED, ASTM A312 TP316L, SCH 10S, ASME B36.19, BE - CUT TO 1'-1 5/8"`],
    // An exact whole-inch cut is ordered at that length; the issued sheets only order more when the true cut is over.
    [2, `2'-1"`, '2"', `PIPE, WELDED, ASTM A312 TP316L, SCH 10S, ASME B36.19, BE - CUT TO 2'-1"`],
    [3, '1', '2"', 'ELBOW 90 LR, ASTM A403 WP316L, SCH 10S, ASME B16.9, BE'],
    [4, '2', '2"', 'STUB END, MSS SP-43 TYPE A, ASTM A403 WP316L, SCH 10S'],
    [5, '3', '2"', 'FLANGE LJ, ASTM A182 F316L, ASME B16.5, CL150, FF'],
    [6, '4', `5/8"X3 1/4"`, 'STUD BOLT, ASTM A193 B8M CL2 C/W 2 HEX NUTS, CL150'],
    [7, '1', '2"', 'GASKET, PTFE, 1/16" THK, ASME B16.21, CL150, FF']
  ]);
});

test('identical cuts share one row with a kerf allowance in the purchased length', () => {
  const doc = newIso(); doc.units = 'imperial'; doc.specs = [lapJointSpec()];
  let at = appendRun(doc, null, [inch(8.5), 0, 0], 'S1', 2, 'S', '');
  for (const delta of [[0, inch(8.5), 0], [inch(8.5), 0, 0]] as Array<[number, number, number]>) at = appendRun(doc, at.id, delta, 'S1', 2, 'S', '');
  const pipe = sheetMaterials(doc, 'S').filter(r => r.category === 'pipe');
  // Ends: open end to elbow 8 1/2 - 3 = 5 1/2; elbow to elbow 8 1/2 - 6 = 2 1/2.
  assert.deepEqual(pipe.map(r => [r.qtyText, r.description.replace(/^.* - /, '')]), [
    [`1'`, `CUT TO 5 1/2" (TOTAL OF 2 PIECES)`],
    [`3"`, `CUT TO 2 1/2"`]
  ]);
});

test('drafting formats match the issued sheets', () => {
  assert.equal(draftLength(inch(30.5), 'imperial'), `2'-6 1/2"`);
  assert.equal(draftLength(inch(19.125), 'imperial', 24), `19 1/8"`);
  assert.equal(draftLength(inch(19.125), 'imperial'), `1'-7 1/8"`);
  assert.equal(draftLength(inch(24 + 3 / 16), 'imperial'), `2'-0 3/16"`);
  assert.equal(draftLength(inch(36), 'imperial'), `3'-0"`);
  assert.equal(draftLength(inch(3 / 16), 'imperial'), `3/16"`);
  assert.equal(draftLength(1234.4, 'mm'), '1234');
  assert.equal(purchaseLength(inch(13.625), 'imperial'), `1'-2"`);
  assert.equal(purchaseLength(inch(23.8), 'imperial'), `2'`);
  assert.equal(purchaseLength(inch(3), 'imperial'), `3"`);
  assert.equal(purchaseLength(inch(28), 'imperial'), `2'-4"`);
  assert.equal(purchaseLength(inch(28.01), 'imperial'), `2'-5"`);
  assert.equal(purchaseLength(inch(240), 'imperial'), `20'`);
  assert.equal(purchaseLength(1201, 'mm'), '1210');
  assert.equal(sizeText(3, 2), `3"X2"`);
  assert.equal(sizeText(0.5), `1/2"`);
  assert.equal(sizeText(1.5, 0.25), `1 1/2"X1/4"`);
  assert.equal(boltSizeText(inch(5 / 8), inch(3.25)), `5/8"X3 1/4"`);
  const doc = newIso(); doc.units = 'imperial'; doc.coordinates = { origin: [inch(583.375), inch(-1156.25), inch(1259.5625)] };
  assert.deepEqual(coordinateText(doc, [0, 0, 0]), [`E 48'-7 3/8"`, `S 96'-4 1/4"`, `EL +104'-11 9/16"`]);
  // Whole feet are written without inches.
  assert.deepEqual(coordinateText(doc, [inch(-7.375), inch(4.25), 0]), [`E 48'`, `S 96'`, `EL +104'-11 9/16"`]);
});

test('break joints list only what this drawing supplies, and lug mates take lug bolts', () => {
  const build = () => {
    const doc = newIso(); doc.units = 'imperial'; doc.specs = [lapJointSpec()];
    const elbow = appendRun(doc, null, [inch(20), 0, 0], 'S1', 2, 'S-1', '10');
    const end = appendRun(doc, elbow.id, [0, inch(20), 0], 'S1', 2, 'S-1', '10');
    applyComponent(doc, end, 'FLG-RFLJ', doc.specs[0].fittings[2]);
    return { doc, end };
  };
  const rows = (doc: ReturnType<typeof newIso>) => sheetMaterials(doc, 'S-1').filter(r => r.category !== 'pipe').map(r => [r.qtyText, r.nd, r.description.split(',')[0]]);
  // Flange, gasket and bolts on the next drawing: only the stub end welded to this pipe is listed.
  let { doc, end } = build();
  end.jointSupply = { flange: false, gasket: false, bolts: false };
  assert.deepEqual(rows(doc), [['1', '2"', 'ELBOW 90 LR'], ['1', '2"', 'STUB END']]);
  // The flange bolts to a lug valve on the next drawing: lug bolts sized for one flange, here.
  ({ doc, end } = build());
  end.jointSupply = { gasket: true, bolts: true, mate: 'lug' };
  const bolts = sheetMaterials(doc, 'S-1').find(r => r.category === 'bolt')!;
  assert.equal(bolts.nd, `5/8"X2 3/4"`);
  assert.match(bolts.description, /LUG BOLT/);
  assert.equal(bolts.qtyText, '4');
});

test('stud and lug bolt rows follow the joints along the route, independent of bolt length', () => {
  const doc = newIso(); doc.specs = [lapJointSpec()];
  const end = appendRun(doc, null, [inch(30), 0, 0], 'S1', 2, 'S', '');
  const start = getNode(doc, doc.runs[0].from);
  for (const node of [start, end]) applyComponent(doc, node, 'FLG-RFLJ', doc.specs[0].fittings[2]);
  end.jointSupply = { gasket: true, bolts: true, mate: 'lug' };
  const bolts = () => sheetMaterials(doc, 'S').filter(r => r.category === 'bolt');
  assert.deepEqual(bolts().map(r => r.nd), [`5/8"X3 1/4"`, `5/8"X2 3/4"`]);
  // Reversing which end has the lug mate reverses the order, even though the bolt lengths are unchanged.
  start.jointSupply = end.jointSupply; end.jointSupply = undefined;
  assert.deepEqual(bolts().map(r => r.nd), [`5/8"X2 3/4"`, `5/8"X3 1/4"`]);
});

test('a lap stub welded straight to a tee has one weld at the tee face', () => {
  const doc = newIso(); doc.specs = [lapJointSpec()];
  const tee = appendRun(doc, null, [inch(5), 0, 0], 'S1', 2, 'S', '');
  const stub = getNode(doc, doc.runs[0].from);
  doc.runs[0].connector = true;
  applyComponent(doc, stub, 'FLG-RFLJ', doc.specs[0].fittings[2]);
  const row = { ...doc.specs[0].fittings[0], id: 'tee', component: 'W-TEE', kind: 'tee' as const, takeout: inch(2.5), branchTakeout: inch(2.5) };
  doc.specs[0].fittings.push(row);
  applyComponent(doc, tee, 'W-TEE', row);
  stub.jointSupply = { flange: false, gasket: false, bolts: false };
  assert.equal(takeout(doc, stub, doc.runs[0].id), inch(2.5));
  assert.equal(welds(doc).length, 1);
  assert.deepEqual(welds(doc)[0].position, [inch(2.5), 0, 0]);
});

test('a break flange pair welded straight to a fitting is one joint', async () => {
  const { flangedJoints } = await import('../src/core/joints.ts');
  const doc = newIso(); doc.units = 'imperial'; doc.specs = [lapJointSpec()];
  const pair = appendRun(doc, null, [inch(30), 0, 0], 'S1', 2, 'S-1', '10');
  applyComponent(doc, pair, 'FLG-RFLJ', doc.specs[0].fittings[2]);
  // The far stub end is welded straight to the elbow: no pipe between them.
  const elbow = appendRun(doc, pair.id, [inch(2.5 + 3 + 1 / 32), 0, 0], 'S1', 2, 'S-1', '10');
  doc.runs.at(-1)!.connector = true;
  appendRun(doc, elbow.id, [0, inch(20), 0], 'S1', 2, 'S-1', '10');
  const joints = flangedJoints(doc).filter(j => j.nodeId === pair.id);
  assert.equal(joints.length, 1);
  assert.equal(joints[0].kind, 'flange-pair');
  const list = sheetMaterials(doc, 'S-1');
  assert.equal(list.find(r => /^FLANGE LJ/.test(r.description))!.qtyText, '2');
  assert.equal(list.find(r => /^STUB END/.test(r.description))!.qtyText, '2');
  assert.equal(list.find(r => /^GASKET/.test(r.description))!.qtyText, '1');
  assert.equal(list.find(r => /^STUD BOLT/.test(r.description))!.qtyText, '4');
});

test('uncut pieces list by length, pipes can carry their own text, and held item numbers stay put', async () => {
  const { holdItemNumbers } = await import('../src/core/material-list.ts');
  const doc = newIso(); doc.units = 'imperial'; doc.specs = [lapJointSpec()];
  const elbow = appendRun(doc, null, [inch(246), 0, 0], 'S1', 2, 'S-1', '10');
  const end = appendRun(doc, elbow.id, [0, inch(20), 0], 'S1', 2, 'S-1', '10');
  const pipes = () => sheetMaterials(doc, 'S-1').filter(r => r.category === 'pipe').map(r => [r.qtyText, r.description.replace(/^PIPE, WELDED, .* BE/, 'PIPE')]);
  // A full random length is used as it comes: 246 - 3 (elbow) = 243 in, no cut.
  assert.deepEqual(pipes(), [[`20'-3"`, 'PIPE'], [`1'-5"`, 'PIPE - CUT TO 1\'-5"']]);
  // The second piece runs on through the drawing break as one length, in its own wording.
  doc.runs[1].uncut = true; doc.runs[1].description = 'pipe, erw, pe';
  assert.deepEqual(pipes(), [[`20'-3"`, 'PIPE'], [`1'-5"`, 'PIPE, ERW, PE']]);
  // Hold the item numbers, then add a cap: it takes the next number instead of renumbering the elbow.
  holdItemNumbers(doc, 'S-1');
  const before = sheetMaterials(doc, 'S-1').map(r => r.description);
  applyComponent(doc, end, 'W-CAP');
  const after = sheetMaterials(doc, 'S-1').map(r => r.description);
  assert.deepEqual(after.slice(0, before.length), before);
  assert.match(after.at(-1)!, /CAP/);
  holdItemNumbers(doc, 'S-1', false);
  assert.equal(doc.sheets, undefined);
  assert.match(sheetMaterials(doc, 'S-1')[2].description, /CAP/);
});
