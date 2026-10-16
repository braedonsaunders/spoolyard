import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, getNode, newIso, parseIsoJson, validateIso, type CatalogItem, type IsoDocument } from '../src/core/model.ts';
import { sheetMaterials } from '../src/core/material-list.ts';
import { COMPONENT_TYPE_BY_CODE } from '../src/core/components.ts';

const inch = (v: number) => v * 25.4;
const row = (component: string, kind: CatalogItem['kind'], nps: number, takeout: number, bomDescription: string, extra: Partial<CatalogItem> = {}): CatalogItem =>
  ({ id: `CS40/${component}-${nps}${extra.smallerNps ? 'x' + extra.smallerNps : ''}`, component, kind, nps, takeout, description: component, source: 'test', bomDescription, ...extra });
/** A drawing on the built-in spec with its own rows added, routed in imperial units. */
const sheet = (...rows: CatalogItem[]) => {
  const doc = newIso();
  doc.units = 'imperial';
  doc.specs[0].fittings.push(...rows);
  return doc;
};
const issues = (doc: IsoDocument) => validateIso(doc).join('\n');

test('a relief valve sits at a turn, is sized inlet by outlet and lists after the valves', () => {
  const psv = row('PSV-SC', 'valve', 1, inch(3), 'RELIEF VALVE, ANGLE BODY, THDF', { smallerNps: 1.5, branchTakeout: inch(3.5), threadEngagement: inch(0.6) });
  const gate = row('GATE-SC', 'valve', 1, inch(2), 'GATE VALVE, THDF', { threadEngagement: inch(0.6) });
  const doc = sheet(psv, gate);
  const valve = appendRun(doc, null, [0, 0, inch(12)], 'CS40', 1, 'S1', 'L1', 'THD');
  const relief = appendRun(doc, valve.id, [0, 0, inch(12)], 'CS40', 1, 'S1', 'L1', 'THD');
  appendRun(doc, relief.id, [inch(10), 0, 0], 'CS40', 1.5, 'S1', 'L1', 'THD');
  applyComponent(doc, valve, 'GATE-SC', gate);
  applyComponent(doc, relief, 'PSV-SC', psv);
  const outlet = doc.runs[2];
  relief.branchEdgeId = outlet.id;
  assert.equal(COMPONENT_TYPE_BY_CODE['PSV-SC'].angle, true);
  assert.doesNotMatch(issues(doc), /relief valve/i);
  // The outlet is its branch, so the outlet pipe is cut from the centre-to-outlet length.
  const rows = sheetMaterials(doc, 'S1');
  assert.deepEqual(rows.slice(-2).map(r => [r.nd, r.description]), [['1"', 'GATE VALVE, THDF'], ['1"X1 1/2"', 'RELIEF VALVE, ANGLE BODY, THDF']]);
  // Drawn in line, an angle body is reported.
  getNode(doc, outlet.to).position = [0, 0, inch(34)];
  assert.match(issues(doc), /angle body/);
});

test('an angle body without a row is sized from its pipes, inlet first', () => {
  const doc = sheet(row('PSV-SC', 'valve', 1, inch(3), 'PSV, THDF', { branchTakeout: inch(3), threadEngagement: inch(0.6) }));
  const relief = appendRun(doc, null, [0, 0, inch(12)], 'CS40', 1, 'S1', 'L1', 'THD');
  appendRun(doc, relief.id, [inch(10), 0, 0], 'CS40', 1.5, 'S1', 'L1', 'THD');
  relief.kind = 'valve'; relief.component = 'PSV-SC'; relief.branchEdgeId = doc.runs[1].id;
  assert.equal(sheetMaterials(doc, 'S1').find(r => r.category === 'other')!.nd, '1"X1 1/2"');
});

test('a one-port flanged vessel passes review and an in-line instrument by others lists only its joints', () => {
  const doc = sheet(
    row('PULS-DAMP', 'valve', 3, 0, 'PULSATION DAMPENER, 150 LB, RF'),
    row('FLOWMETER-FL', 'valve', 3, inch(5), 'MAGNETIC FLOWMETER'));
  const meter = appendRun(doc, null, [inch(30), 0, 0], 'CS40', 3, 'S1', 'L1', 'BW');
  const dampener = appendRun(doc, meter.id, [inch(30), 0, 0], 'CS40', 3, 'S1', 'L1', 'BW');
  applyComponent(doc, meter, 'FLOWMETER-FL', doc.specs[0].fittings.at(-1));
  applyComponent(doc, dampener, 'PULS-DAMP', doc.specs[0].fittings.at(-2));
  assert.doesNotMatch(issues(doc), /dampener|flowmeter/i);
  const rows = sheetMaterials(doc, 'S1');
  assert.equal(rows.some(r => /FLOWMETER/.test(r.description)), false);
  assert.ok(rows.some(r => r.category === 'gasket' && r.qty === 3));
  assert.equal(rows.at(-1)!.description, 'PULSATION DAMPENER, 150 LB, RF');
});

test('hoses and camlock adaptors list after the stub ends, Chicago adapters with the nipples and camlock caps with the caps', () => {
  const doc = sheet(
    row('CAMLOCK-ADPT', 'valve', 1, inch(1), 'CAMLOCK ADAPTOR, MPT X GROOVE', { threadEngagement: inch(0.6) }),
    row('CAMLOCK-CAP', 'cap', 1, inch(0.5), 'CAMLOCK CAP', { threadEngagement: inch(0.6) }),
    row('CHICAGO-ADPT', 'valve', 1, inch(1), 'CHICAGO ADAPTER, MPT', { threadEngagement: inch(0.6) }),
    row('HOSE-SC', 'valve', 1, inch(12), 'HOSE, 24" LG, THDM ENDS', { threadEngagement: inch(0.6) }),
    row('SC-TEE', 'tee', 1, inch(1.5), 'TEE, THDF', { branchTakeout: inch(1.5), threadEngagement: inch(0.6) }));
  const tee = appendRun(doc, null, [inch(10), 0, 0], 'CS40', 1, 'S1', 'L1', 'THD');
  const hose = appendRun(doc, tee.id, [inch(30), 0, 0], 'CS40', 1, 'S1', 'L1', 'THD');
  const chicago = appendRun(doc, hose.id, [inch(30), 0, 0], 'CS40', 1, 'S1', 'L1', 'THD');
  appendRun(doc, chicago.id, [inch(10), 0, 0], 'CS40', 1, 'S1', 'L1', 'THD');
  const adaptor = appendRun(doc, tee.id, [0, inch(10), 0], 'CS40', 1, 'S1', 'L1', 'THD');
  const cap = appendRun(doc, adaptor.id, [0, inch(10), 0], 'CS40', 1, 'S1', 'L1', 'THD');
  const [adpt, capRow, chic, hoseRow, teeRow] = doc.specs[0].fittings.slice(-5);
  applyComponent(doc, tee, 'SC-TEE', teeRow); tee.branchEdgeId = doc.runs[4].id;
  applyComponent(doc, hose, 'HOSE-SC', hoseRow);
  applyComponent(doc, chicago, 'CHICAGO-ADPT', chic);
  applyComponent(doc, adaptor, 'CAMLOCK-ADPT', adpt);
  applyComponent(doc, cap, 'CAMLOCK-CAP', capRow);
  const order = sheetMaterials(doc, 'S1').filter(r => r.category !== 'pipe').map(r => r.description);
  // Within the group, in the order they come along the line.
  assert.deepEqual(order, ['CAMLOCK CAP', 'CHICAGO ADAPTER, MPT', 'HOSE, 24" LG, THDM ENDS', 'CAMLOCK ADAPTOR, MPT X GROOVE', 'TEE, THDF']);
});

test('a check valve asks for the flow direction, which a drawing file keeps', () => {
  const check = row('CHECK-SC', 'valve', 1, inch(2), 'CHECK VALVE, THDF', { threadEngagement: inch(0.6) });
  const doc = sheet(check);
  const valve = appendRun(doc, null, [inch(12), 0, 0], 'CS40', 1, 'S1', 'L1', 'THD');
  appendRun(doc, valve.id, [inch(12), 0, 0], 'CS40', 1, 'S1', 'L1', 'THD');
  applyComponent(doc, valve, 'CHECK-SC', check);
  assert.match(issues(doc), /no flow direction/);
  doc.runs[1].flow = 'forward';
  assert.doesNotMatch(issues(doc), /flow direction/);
  assert.equal(parseIsoJson(JSON.stringify(doc)).runs[1].flow, 'forward');
  const bad = JSON.parse(JSON.stringify(doc)); bad.runs[0].flow = 'up';
  assert.throws(() => parseIsoJson(JSON.stringify(bad)), /flow direction/);
});
