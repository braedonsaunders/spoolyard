import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRun, applyComponent, bom, clone, connected, defaultSpec, dimensionSource, eccentricOffset, flatSideOf, getNode, newIso, oletReach,
  parseIsoJson, portPoint, resizeRun, runResult, setFieldFit, setFlatSide, takeout, validateIso, welds,
  type CatalogItem, type IsoDocument, type PipeSpec
} from '../src/core/model.ts';
import * as model from '../src/core/model.ts';
import { findMaterialRow, holdItemNumbers, materialWarnings, setIssuedCell, sheetMaterials } from '../src/core/material-list.ts';
import { cutSchedule, cutText, labourSummary, materialCsv, materialSchedule, weldSchedule } from '../src/core/schedules.ts';
import * as format from '../src/core/format.ts';
import { allowanceText, boltSizeText, dimensionRoundingNote, dnOf, formatAllowance, npsOfDn, parseLength, purchaseLength, scheduleText, sizeHeader, sizeText } from '../src/core/format.ts';
import { profileError, profileOf } from '../src/core/profile.ts';
import { fabricationWarnings, reviewIso } from '../src/core/review.ts';
import { flangedJoints } from '../src/core/joints.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';
import { COMPONENT_TYPE_BY_CODE } from '../src/core/components.ts';

// Invented data throughout: a Class 150 carbon-steel specification built from the default one.
const inch = (v: number) => v * 25.4;
const close = (actual: number, expected: number, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
function spec150(): PipeSpec {
  const spec = defaultSpec();
  spec.rating = '150#';
  spec.parameters = { 'Welded/Flanged General Parameters.Flange Face': 'RF' };
  return spec;
}
function drawing(units: IsoDocument['units'] = 'mm'): IsoDocument {
  const doc = newIso(); doc.units = units; doc.specs = [spec150()];
  return doc;
}
const pipeRows = (doc: IsoDocument, spool: string) => sheetMaterials(doc, spool).filter(r => r.category === 'pipe');

test('a long pipe is cut, never assumed uncut by its length; one longer than stock is flagged', () => {
  const doc = drawing();
  appendRun(doc, null, [8000, 0, 0], 'CS40', 4, 'S', 'L');
  const [row] = pipeRows(doc, 'S');
  assert.match(row.description, / - CUT TO 8000$/);
  assert.equal(row.pipe!.uncut, false);
  assert.equal(cutSchedule(doc)[0].uncut, false);
  assert.match(fabricationWarnings(doc).join(), /8000 long, more than the 6000 stock length/);
  // Double random lengths (or a specification's own stock length) clear it.
  doc.profile = { stockLength: 12000 };
  assert.doesNotMatch(fabricationWarnings(doc).join(), /stock length/);
  delete doc.profile; doc.specs[0].stockLength = 9000;
  assert.doesNotMatch(fabricationWarnings(doc).join(), /stock length/);
  // Only a pipe marked uncut is listed without a cut.
  doc.runs[0].uncut = true;
  assert.equal(pipeRows(doc, 'S')[0].description.includes('CUT TO'), false);
  assert.equal(cutText(cutSchedule(doc)[0], doc), 'NOT CUT');
});

test('a cell held as issued records the calculated value, is marked, is reported, and exports stay calculated', () => {
  const doc = drawing();
  appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  const key = sheetMaterials(doc, 'S')[0].key;
  setIssuedCell(doc, 'S', key, 'qtyText', '9 M');
  assert.deepEqual(doc.sheets!.S.issuedValues![key], { qtyText: '9 M', calculated: { qtyText: '1000' } });
  const printed = sheetMaterials(doc, 'S')[0];
  assert.deepEqual([printed.qtyText, printed.overridden, printed.calculated!.qtyText], ['9 M', ['qtyText'], '1000']);
  assert.equal(sheetMaterials(doc, 'S', { issued: false })[0].qtyText, '1000');
  assert.equal(materialSchedule(doc)[0].qtyText, '1000');
  assert.equal(materialSchedule(doc, { issued: true })[0].qtyText, '9 M');
  assert.match(materialCsv(doc), /"1000","mm"/);
  assert.match(fabricationWarnings(doc).join(), /item 1 prints quantity "9 M" as issued, but the model calculates "1000"\./);
  // The model moves on: the report says what was calculated when the issued value was entered.
  resizeRun(doc, doc.runs[0].id, 2000);
  assert.match(fabricationWarnings(doc).join(), /calculates "2000"\. The model has changed since .*"1000" then/);
  assert.deepEqual(parseIsoJson(JSON.stringify(doc)).sheets, doc.sheets);
  setIssuedCell(doc, 'S', key, 'qtyText');
  assert.equal(doc.sheets, undefined);
});

test('a formed pipe bend is part of one piece: tangents plus arc, no welds, listed with its bend operation', () => {
  const doc = drawing();
  const bend = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  appendRun(doc, bend.id, [0, 1000, 0], 'CS40', 4, 'S', 'L');
  applyComponent(doc, bend, 'PIPEBEND');
  assert.match(validateIso(doc).join(), /no bend radius/);
  bend.bendRadius = 300;
  // Each tangent is 1000 - R tan 45° = 700; the arc is R·π/2.
  assert.deepEqual(doc.runs.map(r => runResult(doc, r).cut), [700, 700]);
  const arc = 300 * Math.PI / 2;
  const [pipe, ...rest] = sheetMaterials(doc, 'S');
  assert.equal(pipe.pipe!.pieces.length, 1);
  assert.deepEqual(pipe.memberIds, doc.runs.map(r => r.id));
  close(pipe.cut!, 1400 + arc);
  assert.match(pipe.description, /CUT TO 1871$/);
  assert.deepEqual(rest.map(r => [r.category, r.qtyText, r.description]), [['bend', '1', 'PIPE BEND, 90°, 300 RADIUS']]);
  assert.equal(welds(doc).length, 0);
  assert.deepEqual(validateIso(doc), []);
  const [cut] = cutSchedule(doc);
  assert.deepEqual([cut.bends, cut.runIds.length], [1, 2]);
  close(cut.cut, 1400 + arc);
  close(bom(doc).find(r => r.unit === 'm')!.qty, (1400 + arc) / 1000, 1e-9);
  // A bend allowance from the profile is added for each bend.
  doc.profile = { bendAllowance: 50 };
  close(cutSchedule(doc)[0].cut, 1450 + arc);
});

test('a joint callout naming an existing item stops that joint buying its part, if the item fits the joint', () => {
  const doc = drawing();
  appendRun(doc, null, [3000, 0, 0], 'CS40', 4, 'S', 'L');
  const wn = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPE_BY_CODE['FLG-RFWN'], 0.25);
  const so = placeComponentOnPipe(doc, doc.runs.find(r => r.from === wn.id)!.id, COMPONENT_TYPE_BY_CODE['FLG-RFSO'], 0.5);
  appendRun(doc, null, [0, 5000, 0], 'CS40', 3, 'S', 'L');
  const small = placeComponentOnPipe(doc, doc.runs.at(-1)!.id, COMPONENT_TYPE_BY_CODE['FLG-RFWN'], 0.5);
  void small;
  const rows = () => sheetMaterials(doc, 'S');
  const wnRow = rows().find(r => r.identity.code === 'FLG-RFWN' && r.identity.nps === 4)!;
  assert.equal(rows().find(r => r.identity.code === 'FLG-RFSO')!.qty, 2);
  // The slip-on pair's callout names the weld-neck item: the slip-on flanges are not bought again.
  doc.sheets = { S: { jointItems: { [so.id]: { flange: wnRow.key } } } };
  assert.equal(rows().some(r => r.identity.code === 'FLG-RFSO'), false);
  assert.equal(findMaterialRow(rows(), wnRow.key)!.qty, 2);
  assert.deepEqual(model.validateIso(doc).filter(m => /callout/.test(m)), []);
  // A 3" gasket cannot serve the 4" joint: flagged, and the joint keeps its own gasket.
  const gasket3 = rows().find(r => r.category === 'gasket' && r.identity.nps === 3)!;
  const gaskets4 = () => rows().find(r => r.category === 'gasket' && r.identity.nps === 4)!.qty;
  const before = gaskets4();
  doc.sheets.S.jointItems![so.id].gasket = gasket3.key;
  assert.equal(gaskets4(), before);
  assert.match(validateIso(doc).join(), /gasket callout names item .*which is 3" where the joint is 4"/);
  // A callout naming an item that has gone is flagged too.
  doc.sheets.S.jointItems![so.id] = { bolts: 'gone' };
  assert.match(validateIso(doc).join(), /bolts callout refers to a material item that is no longer on the sheet/);
});

test('the take-off and the sheets are one engine: same items and counts, heat lots kept apart', () => {
  const doc = drawing();
  let at = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  at = appendRun(doc, at.id, [0, 1000, 0], 'CS40', 4, 'S', 'L');
  appendRun(doc, at.id, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  doc.runs[0].heat = 'H1'; doc.runs[2].heat = 'H2';
  const sheet = sheetMaterials(doc, 'S'), takeoff = bom(doc, 'global');
  // The first and last pieces are cut alike: one sheet row of two pieces, two take-off rows (one per heat).
  assert.equal(sheet.filter(r => r.category === 'pipe').length, 2);
  assert.equal(takeoff.filter(r => r.unit === 'm').length, 3);
  const each = (rows: Array<{ qty: number }>) => rows.reduce((s, r) => s + r.qty, 0);
  assert.equal(each(takeoff.filter(r => r.unit === 'ea')), each(sheet.filter(r => r.category !== 'pipe')));
  close(each(takeoff.filter(r => r.unit === 'm')) * 1000, doc.runs.reduce((s, r) => s + runResult(doc, r).cut, 0), 1e-6);
});

test("the branch table chooses the branch connection: a weldolet on a continuous header, or a reducing tee", () => {
  const branchDoc = (code: string, legend?: Record<string, string>) => {
    const doc = drawing();
    doc.specs[0].branchChart = [{ run: 4, branch: 2, code }];
    if (legend) doc.specs[0].branchCodes = legend;
    const joint = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S', 'L');
    appendRun(doc, joint.id, [1000, 0, 0], 'CS40', 4, 'S', 'L');
    appendRun(doc, joint.id, [0, 0, 500], 'CS40', 2, 'S', 'L');
    return { doc, joint };
  };
  const { doc, joint } = branchDoc('3', { 3: 'Weldolet' });
  assert.equal(joint.kind, 'olet');
  assert.equal(joint.component, 'WOL');
  // The header is one pipe again, the weldolet sitting on it; the branch is routed from the outlet.
  assert.equal(doc.runs.length, 2);
  const header = doc.runs.find(r => r.nps === 4)!, branch = doc.runs.find(r => r.nps === 2)!;
  assert.equal(joint.associatedRunId, header.id);
  assert.deepEqual(connected(doc, joint.id).map(r => r.id), [branch.id]);
  close(runResult(doc, header).cut, 2000);
  assert.equal(oletReach(doc, joint, branch), takeout(doc, joint, branch.id));
  assert.ok(welds(doc).some(w => w.type === 'BR'));
  const tee = branchDoc('2', { 2: 'Reducing Tee' });
  assert.deepEqual([tee.joint.kind, tee.joint.component], ['tee', 'W-RTEE']);
  // A drawn tee where the table calls for an olet is a departure to confirm.
  tee.doc.specs[0].branchChart = [{ run: 4, branch: 2, code: 'SOL' }];
  assert.match(fabricationWarnings(tee.doc).join(), /branches 4"X2" with a sockolet, but a reducing tee.* is drawn/);
});

test('an eccentric reducer offsets its small pipe by (D - d)/2 to the flat, and an older drawing without it is reported', () => {
  const doc = drawing();
  const red = appendRun(doc, null, [1000, 0, 0], 'CS40', 6, 'S', 'L');
  const end = appendRun(doc, red.id, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  applyComponent(doc, red, 'E-RED');
  assert.match(validateIso(doc).join(), /no flat side/);
  const small = doc.runs[1], e = (168.3 - 114.3) / 2;
  setFlatSide(doc, red.id, 'top');
  close(end.position[2], e, 1e-9);
  assert.deepEqual(eccentricOffset(doc, red, small.id), [0, 0, e]);
  assert.deepEqual(portPoint(doc, red, small.id), [1000, 0, e]);
  assert.equal(flatSideOf([0, 0, -e]), 'bottom');
  // Lengths are along the line: the offset does not lengthen the small pipe.
  close(runResult(doc, small).overall, 1000, 1e-9);
  assert.doesNotMatch(validateIso(doc).join(), /change of direction|flat/);
  assert.doesNotMatch(fabricationWarnings(doc).join(), /elevations/);
  // Flat on the bottom moves the small side down by the same offset.
  setFlatSide(doc, red.id, 'bottom');
  close(end.position[2], -e, 1e-9);
  // An older drawing with its small end on the large end's centreline is still measured, and flagged.
  end.position = [2000, 0, 0];
  assert.doesNotMatch(validateIso(doc).join(), /change of direction/);
  assert.match(fabricationWarnings(doc).join(), /moves the small pipe 27 mm across.*elevations and coordinates are out by that much/);
});

test('a field-fit open end is a numbered field weld; welds between spools default to field', () => {
  const doc = drawing();
  const elbow = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S1', 'L');
  const joint = appendRun(doc, elbow.id, [0, 1000, 0], 'CS40', 4, 'S1', 'L');
  appendRun(doc, joint.id, [0, 1000, 0], 'CS40', 4, 'S2', 'L');
  setFieldFit(doc, doc.runs[0].id, 'from', true);
  const all = welds(doc), open = all.find(w => w.nodeId === doc.runs[0].from)!;
  assert.deepEqual([open.field, open.fieldFit, open.type], [true, true, 'BW']);
  assert.equal(new Set(all.map(w => w.tag)).size, all.length);
  close(runResult(doc, doc.runs[0]).makeup[0], 100);
  assert.equal(all.find(w => w.nodeId === joint.id)!.field, true);
  assert.equal(all.find(w => w.nodeId === elbow.id)!.field, false);
  doc.profile = { spoolBreakWelds: 'shop' };
  assert.equal(welds(doc).find(w => w.nodeId === joint.id)!.field, false);
  // An explicit choice on the joint wins either way.
  doc.profile = {}; doc.runs[1].toField = false; doc.runs[2].fromField = false;
  assert.equal(welds(doc).find(w => w.nodeId === joint.id)!.field, false);
});

test('a flange pair split at a spool break is weighed once per flange', () => {
  const doc = drawing();
  const row: CatalogItem = { id: 'WN4', component: 'FLG-RFWN', kind: 'flange', nps: 4, rating: '150#', takeout: 76.2, weightKg: 10, description: 'WN FLANGE', source: 'test' };
  doc.specs[0].fittings.push(row);
  appendRun(doc, null, [2000, 0, 0], 'CS40', 4, 'S1', 'L');
  const flange = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPE_BY_CODE['FLG-RFWN'], 0.5, row);
  doc.runs.find(r => r.from === flange.id)!.spool = 'S2';
  const flanges = materialSchedule(doc).filter(r => r.category === 'flange');
  assert.deepEqual(flanges.map(r => [r.spool, r.qty, r.weightKg]), [['S1', 1, 10], ['S2', 1, 10]]);
  assert.equal(bom(doc).filter(r => r.description.startsWith('WN FLANGE')).reduce((s, r) => s + r.weightKg!, 0), 20);
});

test('an unset socket-weld gap is 1/16" and is reported for confirmation', () => {
  const doc = drawing();
  delete doc.specs[0].socketGap;
  const elbow = appendRun(doc, null, [500, 0, 0], 'CS40', 1, 'S', 'L', 'SW');
  appendRun(doc, elbow.id, [0, 500, 0], 'CS40', 1, 'S', 'L', 'SW');
  assert.deepEqual(runResult(doc, doc.runs[0]).gaps, [0, 1.6]);
  assert.match(fabricationWarnings(doc).join(), /sets no socket-weld gap; 1\/16" \(1\.6 mm\)/);
  doc.specs[0].socketGap = 1.6;
  assert.doesNotMatch(fabricationWarnings(doc).join(), /socket-weld gap/);
});

test('the fabrication profile sets ordering, kerf, cut notes, feet, list order and weld sequence', () => {
  assert.equal(purchaseLength(1001, 'mm', 0), '1001');
  assert.equal(purchaseLength(inch(13.2), 'imperial', inch(6)), `1'-6"`);
  const doc = drawing();
  let at = appendRun(doc, null, [700, 0, 0], 'CS40', 4, 'S', 'L');
  at = appendRun(doc, at.id, [0, 1000, 0], 'CS40', 4, 'S', 'L');
  appendRun(doc, at.id, [700, 0, 0], 'CS40', 4, 'S', 'L');
  // Two pieces of 700 - 152.4 - 3 = 544.6, a 3 mm kerf between them on a metric drawing, ordered to 10 mm.
  const pair = () => pipeRows(doc, 'S').find(r => r.pipe!.pieces.length === 2)!;
  close(pair().qty, 2 * 544.6 + 3, 1e-9);
  assert.equal(pair().qtyText, '1100');
  doc.profile = { orderIncrement: 0, kerf: 0 };
  assert.equal(pair().qtyText, String(Math.round(2 * 544.6)));
  doc.profile = { cutNote: 'none' };
  assert.equal(pair().description.includes('CUT TO'), false);
  close(cutSchedule(doc)[0].cut, 544.6, 1e-9);
  // Imperial lengths in lists change to feet from the profile's threshold.
  doc.units = 'imperial'; doc.profile = {};
  assert.match(pair().description, /CUT TO 1'-9 7\/16"/);
  doc.profile = { feetFrom: { lists: 24 } };
  assert.match(pair().description, /CUT TO 21 7\/16"/);
  assert.equal(profileOf(doc).kerf, inch(1 / 8));
  // List order: groups and sizes as the profile gives them.
  doc.profile = { materialOrder: ['elbow90'] };
  assert.equal(sheetMaterials(doc, 'S')[0].category, 'elbow90');
  // One weld sequence per spool.
  doc.runs[2].spool = 'T';
  doc.profile = { weldSequence: 'spool' };
  const tags = welds(doc).map(w => [doc.runs.find(r => r.id === w.runId)!.spool, w.tag]);
  assert.deepEqual(tags.filter(([s]) => s === 'T').map(([, t]) => t)[0], 'W1');
  assert.doesNotMatch(validateIso(doc).join(), /share a weld number/);
  assert.equal(profileError({ kerf: -1 }), 'Invalid pipe order allowance.');
  assert.equal(profileError({ weldSequence: 'line' }), 'Invalid fabrication profile setting.');
  doc.profile = { sizeOrder: 'up' as any };
  assert.throws(() => parseIsoJson(JSON.stringify(doc)), /profile/);
});

test('sizes in NPS or DN everywhere, and bolting in its own system whatever the drawing units', () => {
  assert.deepEqual([sizeText(4, undefined, 'DN'), sizeText(3, 2, 'DN'), sizeText(0.5, undefined, 'DN'), sizeText(3, 2)], ['DN100', 'DN80X50', 'DN15', '3"X2"']);
  assert.deepEqual([dnOf(1.5), dnOf(24), npsOfDn(150), npsOfDn(65)], [40, 600, 6, 2.5]);
  const doc = drawing();
  appendRun(doc, null, [2000, 0, 0], 'CS40', 4, 'S', 'L');
  placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPE_BY_CODE['FLG-RFWN'], 0.5);
  const bolts = () => sheetMaterials(doc, 'S').find(r => r.category === 'bolt')!;
  // ASME B16.5 bolting is inch bolting on a metric drawing too.
  assert.match(bolts().nd, /^\d+\/\d+"X/);
  assert.equal(bolts().bolt!.system, 'inch');
  doc.profile = { sizeNotation: 'DN' };
  assert.equal(sizeHeader(doc), 'DN');
  assert.equal(pipeRows(doc, 'S')[0].nd, 'DN100');
  assert.equal(weldSchedule(doc)[0].size, 'DN100');
  // Metric bolting is written as such only when the bolt data is metric.
  doc.specs[0].fittings.push({ id: 'B4', component: 'BOLT-RF', kind: 'bolt', nps: 4, takeout: 0, boltCount: 8, boltDiameter: 16, boltLength: 90, boltSystem: 'metric', description: 'STUD BOLT', source: 'test' });
  assert.equal(bolts().nd, 'M16X90');
  assert.equal(boltSizeText(inch(5 / 8), inch(3.25)), `5/8"X3 1/4"`);
});

test('a metric drawing needs a unit for a fraction; individual dimension rounding is an explicit, noted choice', () => {
  assert.throws(() => parseLength('3 1/2', 'mm'), /unit/);
  close(parseLength('3 1/2"', 'mm'), 88.9, 1e-9);
  close(parseLength('3 1/2', 'imperial'), 88.9, 1e-9);
  assert.equal(parseLength('35', 'mm'), 35);
  const doc = drawing();
  assert.equal(dimensionRoundingNote(doc), undefined);
  doc.style = { layout: 'scale', weldNumbers: true, lettering: 'cad', dimensionRounding: 'individual' };
  assert.match(dimensionRoundingNote(doc)!, /ROUNDED INDIVIDUALLY/);
});

test('held numbers follow the purchased item, not its wording or measured takeout; older keys still hold', () => {
  const doc = drawing();
  let at = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  const first = at;
  at = appendRun(doc, at.id, [0, 1000, 0], 'CS40', 4, 'S', 'L');
  appendRun(doc, at.id, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  // A measured takeout on one elbow does not make it a different thing to buy.
  first.takeout = 160;
  const elbows = sheetMaterials(doc, 'S').filter(r => r.category === 'elbow90');
  assert.deepEqual(elbows.map(r => r.qty), [2]);
  const key = elbows[0].key;
  first.description = 'ELBOW 90 LR, AS ISSUED';
  const relabelled = sheetMaterials(doc, 'S').filter(r => r.category === 'elbow90');
  assert.equal(relabelled.length, 2);
  assert.ok(relabelled.some(r => r.key === key));
  // Item numbers held under an older key are still honoured.
  delete first.description;
  const rows = sheetMaterials(doc, 'S');
  doc.sheets = { S: { bomOrder: [...rows].reverse().map(r => r.aliases[0]) } };
  assert.deepEqual(sheetMaterials(doc, 'S').map(r => r.key), [...rows].reverse().map(r => r.key));
  holdItemNumbers(doc, 'S');
  assert.deepEqual(doc.sheets.S.bomOrder, [...rows].reverse().map(r => r.key));
});

test('the socket and thread check reads structured fields, not catalogue wording', () => {
  const doc = drawing();
  const row: CatalogItem = { id: 'E1', component: 'SC-90ELL', kind: 'elbow90', nps: 1, takeout: 20, description: 'ELBOW 90 THD', source: 'effective takeout per vendor' };
  doc.specs[0].fittings.push(row);
  const elbow = appendRun(doc, null, [400, 0, 0], 'CS40', 1, 'S', 'L', 'THD');
  appendRun(doc, elbow.id, [0, 400, 0], 'CS40', 1, 'S', 'L', 'THD');
  elbow.catalogId = 'E1'; elbow.component = 'SC-90ELL';
  assert.match(validateIso(doc).join(), /no socket depth or thread length/);
  row.takeoutToPipeEnd = true;
  assert.doesNotMatch(validateIso(doc).join(), /no socket depth or thread length/);
});

test('one formatting module: interface and drafting notations share their rounding', () => {
  assert.equal(model.formatLength, format.formatLength);
  assert.equal(model.parseLength, format.parseLength);
  assert.equal(formatAllowance(0.5, 'imperial'), allowanceText(0.5, 'imperial', 'interface'));
  assert.equal(allowanceText(0.5, 'imperial'), '0.02"');
  assert.equal(format.schedule('10S'), scheduleText('10S'));
  assert.deepEqual(['STD.', 'Sch 80', '40'].map(format.schedule), ['STD', 'SCH 80', 'SCH 40']);
});

test('labour counts weld diameter-inches; field material is kept apart; pipe weights are checked against density', () => {
  const doc = drawing();
  doc.specs[0].weldHoursPerDiameterInch = 0.5;
  const elbow = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  appendRun(doc, elbow.id, [0, 1000, 0], 'CS40', 4, 'S', 'L');
  assert.deepEqual(weldSchedule(doc).map(w => [w.diameterInches, w.hours]), [[4, 2], [4, 2]]);
  const [labour] = labourSummary(doc);
  assert.deepEqual([labour.weldDiameterInches, labour.weldHours, labour.total], [8, 4, 4]);
  // A field-supplied item (S/F flag F) is field material.
  doc.specs[0].fittings.find(f => f.id === 'LR90-4')!.shopField = 'F';
  assert.equal(sheetMaterials(doc, 'S').find(r => r.category === 'elbow90')!.supply, 'field');
  assert.match(materialCsv(doc), /"FIELD"/);
  doc.profile = { materialSections: 'shop-field' };
  assert.equal(sheetMaterials(doc, 'S').at(-1)!.supply, 'field');
  assert.doesNotMatch(fabricationWarnings(doc).join(), /kg\/m/);
  doc.specs[0].sizes.find(s => s.nps === 4)!.kgM = 30;
  assert.match(fabricationWarnings(doc).join(), /4" pipe weighs 30\.00 kg\/m, but its 114\.3 mm OD/);
});

test('welds closer than one diameter are reported where the specification sets no spacing', () => {
  const doc = drawing();
  let at = appendRun(doc, null, [1000, 0, 0], 'CS40', 6, 'S', 'L');
  // 6" LR elbows: 228.6 each; 560 - 457.2 - 2 × 3 root gap leaves 96.8 mm of pipe.
  at = appendRun(doc, at.id, [0, 560, 0], 'CS40', 6, 'S', 'L');
  appendRun(doc, at.id, [1000, 0, 0], 'CS40', 6, 'S', 'L');
  close(runResult(doc, doc.runs[1]).cut, 96.8, 1e-9);
  assert.doesNotMatch(validateIso(doc).join(), /apart/);
  assert.match(fabricationWarnings(doc).join(), /96\.8 mm apart, closer than one pipe diameter \(168\.3 mm\)/);
  doc.specs[0].minWeldSpacing = 50;
  assert.doesNotMatch(fabricationWarnings(doc).join(), /pipe diameter/);
});

test('a specification row without a takeout shows the standard dimension it stands on', () => {
  const doc = drawing();
  const elbowRow = doc.specs[0].fittings.find(f => f.id === 'LR90-4')!;
  Object.assign(elbowRow, { component: 'W-LR90EL', takeoutMissing: true });
  const elbow = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  appendRun(doc, elbow.id, [0, 1000, 0], 'CS40', 4, 'S', 'L');
  elbow.catalogId = 'LR90-4';
  assert.equal(dimensionSource(doc, elbow, doc.runs[0].id), 'standard');
  assert.equal(sheetMaterials(doc, 'S').find(r => r.category === 'elbow90')!.dimensionSource, 'standard');
  assert.match(fabricationWarnings(doc).join(), /has no dimension in its specification row; the standard .* dimension is assumed/);
  assert.ok(reviewIso(doc).every(i => i.severity === 'warning' || !/standard/.test(i.message)));
  elbow.takeout = 152.4;
  assert.equal(dimensionSource(doc, elbow, doc.runs[0].id), 'measured');
  assert.deepEqual(materialWarnings(clone(doc)).filter(m => /standard/.test(m)), []);
});

test('a 180° return drawn as two halves is one fitting: one item, no weld or pipe between the halves', () => {
  const doc = drawing();
  // 4" LR return: centre-to-centre O = 12" (R = 1.5 D), each half takes O/2.
  const a = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  const b = appendRun(doc, a.id, [0, inch(12), 0], 'CS40', 4, 'S', 'L');
  appendRun(doc, b.id, [-1000, 0, 0], 'CS40', 4, 'S', 'L');
  for (const n of [a, b]) applyComponent(doc, n, 'LR180R');
  doc.runs[1].connector = true;
  assert.deepEqual(runResult(doc, doc.runs[1]).gaps, [0, 0]);
  close(runResult(doc, doc.runs[1]).cut, 0, 1e-6);
  const rows = sheetMaterials(doc, 'S'), ret = rows.find(r => r.memberIds.includes(a.id))!;
  assert.deepEqual([ret.qty, ret.memberIds.includes(b.id)], [1, true]);
  assert.equal(rows.filter(r => r.category === 'pipe').reduce((n, r) => n + r.pipe!.pieces.length, 0), 2);
  assert.equal(welds(doc).length, 2);
  assert.deepEqual(validateIso(doc).filter(m => /return/.test(m)), []);
  // Halves pulled apart are reported.
  getNode(doc, doc.runs[2].from).position = [1000, inch(12) + 20, 0];
  getNode(doc, doc.runs[2].to).position = [0, inch(12) + 20, 0];
  assert.match(validateIso(doc).join(), /halves of a 4″ 180° return stand/);
});

test('a new drawing starts on a starter specification that states its flange class, face and gasket', () => {
  const doc = newIso();
  appendRun(doc, null, [2000, 0, 0], 'CS40', 2, 'S', 'L');
  placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPE_BY_CODE['FLG-RFWN'], 0.5);
  assert.deepEqual(validateIso(doc).filter(m => /assumed/.test(m)), []);
  assert.deepEqual(flangedJoints(doc).map(j => [j.rating, j.face, j.gasket?.thickness]), [[150, 'RF', 3.3]]);
});
