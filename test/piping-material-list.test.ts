import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, getNode, newIso, type PipeSpec } from '../src/core/model.ts';
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
    [2, `2'-2"`, '2"', `PIPE, WELDED, ASTM A312 TP316L, SCH 10S, ASME B36.19, BE - CUT TO 2'-1"`],
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
  assert.equal(purchaseLength(1201, 'mm'), '1210');
  assert.equal(sizeText(3, 2), `3"X2"`);
  assert.equal(sizeText(0.5), `1/2"`);
  assert.equal(sizeText(1.5, 0.25), `1 1/2"X1/4"`);
  assert.equal(boltSizeText(inch(5 / 8), inch(3.25)), `5/8"X3 1/4"`);
  const doc = newIso(); doc.units = 'imperial'; doc.coordinates = { origin: [inch(662.625), inch(-1582.25), inch(1209.1875)] };
  assert.deepEqual(coordinateText(doc, [0, 0, 0]), [`E 55'-2 5/8"`, `S 131'-10 1/4"`, `EL +100'-9 3/16"`]);
});
