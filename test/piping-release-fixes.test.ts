import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRun, applyComponent, connected, defaultSpec, getNode, newIso, parseIsoJson, runResult, setFieldFit, takeout, welds,
  type IsoDocument, type PipeNode, type PipeSpec
} from '../src/core/model.ts';
import { exportPcf, exportPcfPackage, importPcf } from '../src/core/pcf.ts';
import { lugBoltText, packageSpools, sheetMaterials, withPipeEnds } from '../src/core/material-list.ts';
import { cutCsv, cutSchedule, cutText, weldCsv, weldSchedule } from '../src/core/schedules.ts';
import { fabricationWarnings } from '../src/core/review.ts';
import { bolting } from '../src/core/standards.ts';
import { flangedJoints } from '../src/core/joints.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';
import { COMPONENT_TYPE_BY_CODE } from '../src/core/components.ts';

// Invented data throughout: a Class 150 carbon-steel specification built from the default one.
const close = (actual: number, expected: number, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
function spec150(): PipeSpec {
  const spec = defaultSpec();
  spec.rating = '150#';
  spec.parameters = { 'Welded/Flanged General Parameters.Flange Face': 'RF' };
  return spec;
}
function drawing(): IsoDocument {
  const doc = newIso(); doc.units = 'mm'; doc.specs = [spec150()];
  return doc;
}
const header = (doc: IsoDocument) => doc.runs.find(r => r.nps === 4 && !r.connector)!;
/**
 * A 4" header from an equipment flange to an elbow, a weldolet on it with a 2" branch to an open end, and a 2"
 * sockolet... on the branch with a 1" socket-weld branch; the far end of the header leg is field fit.
 */
function job(rootGap = 1.6) {
  const doc = drawing();
  doc.specs[0].rootGap = rootGap;
  const elbow = appendRun(doc, null, [3000, 0, 0], 'CS40', 4, 'S1', 'L1');
  const start = getNode(doc, doc.runs[0].from);
  applyComponent(doc, start, 'FLG-RFWN');
  const end = appendRun(doc, elbow.id, [0, 1500, 0], 'CS40', 4, 'S1', 'L1');
  setFieldFit(doc, connected(doc, end.id)[0].id, 'to', true);
  const olet = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPE_BY_CODE.WOL, 0.5) as PipeNode;
  appendRun(doc, olet.id, [0, 0, 800], 'CS40', 2, 'S1', 'L1');
  return { doc, olet, start, end };
}
const cuts = (doc: IsoDocument) => cutSchedule(doc).map(c => Math.round(c.cut * 10) / 10).sort((a, b) => a - b);
const bomText = (doc: IsoDocument) => packageSpools(doc).flatMap(s => sheetMaterials(doc, s).map(r => `${r.qtyText}|${r.nd}|${r.description}`)).sort();

test('an outlet keeps its header-outside takeout when its branch pipe is marked as the branch', () => {
  const { doc, olet } = job();
  const branch = connected(doc, olet.id)[0], before = takeout(doc, olet, branch.id)!;
  // MSS SP-97: header OD/2 + root gap + the outlet's height A.
  close(before, 114.3 / 2 + 1.6 + (takeout(doc, { ...olet, associatedRunId: undefined }, branch.id) ?? NaN));
  olet.branchEdgeId = branch.id;
  close(takeout(doc, olet, branch.id)!, before, 1e-9);
});

test('a PCF read back with its sidecar gives the same cuts, BOM, welds and open ends; read alone, the same cuts when there is no root gap', () => {
  for (const gap of [1.6, 0]) {
    const { doc } = job(gap);
    const { pcf, sidecar } = exportPcfPackage(doc);
    const back = importPcf(pcf, { sidecar }).doc;
    assert.deepEqual(cuts(back), cuts(doc));
    assert.deepEqual(bomText(back), bomText(doc));
    assert.deepEqual(welds(back).map(w => `${w.type}${w.field ? 'F' : ''}${w.fieldFit ? 'FF' : ''}`).sort(), welds(doc).map(w => `${w.type}${w.field ? 'F' : ''}${w.fieldFit ? 'FF' : ''}`).sort());
    // The field-fit open end comes back an open end, not a weld node.
    assert.deepEqual(back.nodes.map(n => n.kind).sort(), doc.nodes.map(n => n.kind).sort());
    if (gap === 0) {
      const alone = importPcf(pcf).doc;
      assert.deepEqual(cuts(alone), cuts(doc));
      assert.ok(alone.nodes.some(n => n.kind === 'end' && connected(alone, n.id).some(r => r.toFieldFit || r.fromFieldFit)));
    }
  }
});

test('a socket-weld pipe catalogued with threaded ends is listed with the ends it is cut to, as the cut list gives them', () => {
  assert.equal(withPipeEnds('PIPE, SMLS, TE, ASME B36.10M', ['PE', 'PE']), 'PIPE, SMLS, PE, ASME B36.10M');
  assert.equal(withPipeEnds('PIPE, SMLS, PE, ASME B36.10M', ['TE', 'TE']), 'PIPE, SMLS, TE, ASME B36.10M');
  assert.equal(withPipeEnds('PIPE, SMLS, TE, ASME B36.10M', ['BE', 'PE']), 'PIPE, SMLS, BE/PE, ASME B36.10M');
  // Bevelled or plain is the finish the specification buys: it is not second-guessed.
  assert.equal(withPipeEnds('PIPE, SMLS, PE, ASME B36.19M', ['BE', 'BE']), 'PIPE, SMLS, PE, ASME B36.19M');
  assert.equal(withPipeEnds('PIPE, SMLS, ASME B36.10M', ['PE', 'PE']), 'PIPE, SMLS, ASME B36.10M');
  const doc = drawing();
  doc.specs[0].sizes.find(s => s.nps === 1)!.description = 'PIPE, SMLS, TE, ASME B36.10M';
  appendRun(doc, null, [500, 0, 0], 'CS40', 1, 'S1', 'L1', 'SW');
  const row = sheetMaterials(doc, 'S1').find(r => r.category === 'pipe')!;
  const cut = cutSchedule(doc)[0];
  assert.deepEqual(cut.ends, ['PE', 'PE']);
  assert.match(row.description, /^PIPE, SMLS, PE, ASME B36\.10M/);
  assert.match(exportPcf(doc), /DESCRIPTION PIPE, SMLS, PE, ASME B36\.10M/);
});

test('lug bolts into a tapped lug take one nut each, or none as cap screws, and are sized to match', () => {
  assert.equal(lugBoltText('STUD BOLTS C/W 2 HEAVY HEX NUTS, A193 B7 / A194 2H', 1), 'LUG BOLTS C/W 1 HEAVY HEX NUT, A193 B7 / A194 2H');
  assert.equal(lugBoltText('STUD BOLTS C/W 2 HEAVY HEX NUTS, A193 B7 / A194 2H', 0), 'HEX HEAD CAP SCREWS, A193 B7');
  assert.equal(lugBoltText('LUG BOLTS, A193 B7', 1), 'LUG BOLTS, A193 B7');
  const stud = bolting(4, 150, 'RF', 'lug-valve-side', { body: 54 })!, screw = bolting(4, 150, 'RF', 'lug-valve-side', { body: 54, type: 'machine' })!;
  assert.equal(stud.capScrews, undefined);
  assert.equal(screw.capScrews, true);
  // The cap screw is the stud less its nut (one diameter) and point projection, to the quarter inch.
  assert.ok(screw.length < stud.length && stud.length - screw.length <= (0.625 + 0.06) * 25.4 + 6.35 + 0.01);
  const doc = drawing();
  const at = appendRun(doc, null, [2000, 0, 0], 'CS40', 4, 'S1', 'L1');
  appendRun(doc, at.id, [2000, 0, 0], 'CS40', 4, 'S1', 'L1');
  applyComponent(doc, at, 'BFLY-LUG');
  const ports = flangedJoints(doc).filter(j => j.kind === 'component-port');
  assert.ok(ports.length === 2 && ports.every(j => j.bolts?.kind === 'lug' && j.bolts.nuts === 1));
  const lug = sheetMaterials(doc, 'S1').find(r => r.category === 'bolt')!;
  assert.match(lug.description, /^LUG BOLT.* C\/W 1 .*NUT\b/);
  assert.doesNotMatch(lug.description, /2 .*NUTS/);
  doc.specs[0].design = { ...doc.specs[0].design, boltType: 'machine' };
  const screws = flangedJoints(doc).filter(j => j.kind === 'component-port');
  assert.ok(screws.every(j => j.bolts?.nuts === 0 && j.bolts.length < ports[0].bolts!.length));
  assert.match(sheetMaterials(doc, 'S1').find(r => r.category === 'bolt')!.description, /CAP SCREWS/);
});

test('a branch outlet or welded support too close to another weld on its pipe is reported', () => {
  const near = (gap: number) => {
    const doc = drawing();
    const elbow = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S1', 'L1');
    appendRun(doc, elbow.id, [0, 1000, 0], 'CS40', 4, 'S1', 'L1');
    const r = doc.runs[0], result = runResult(doc, r), weldAt = result.overall - result.takeouts[1] - result.gaps[1];
    // A 1" sockolet whose branch-pipe outside stands `gap` clear of the elbow's butt weld.
    const olet = placeComponentOnPipe(doc, r.id, COMPONENT_TYPE_BY_CODE.SOL, (weldAt - 33.4 / 2 - gap) / result.overall) as PipeNode;
    appendRun(doc, olet.id, [0, 0, 300], 'CS40', 1, 'S1', 'L1', 'SW');
    return fabricationWarnings(doc).join('\n');
  };
  assert.match(near(25), /branch weld of the sockolet is 25 mm from the weld at the 90° long-radius elbow, butt-weld, closer than one pipe diameter \(114\.3 mm\)/);
  assert.match(near(-5), /branch weld of the sockolet overlaps the weld at the 90° long-radius elbow/);
  assert.doesNotMatch(near(200), /branch weld/);
});

test('a PCF from another program: pipe materials, joints without bolting, bolt sizes and support item codes are kept', () => {
  const pcf = `ISOGEN-FILES ISOGEN.FLS
UNITS-BORE INCH
UNITS-CO-ORDS MM
UNITS-BOLT-DIA INCH
UNITS-BOLT-LENGTH MM
PIPELINE-REFERENCE 4"-X-1
    PIPING-SPEC Z9
FLANGE
    END-POINT 0 0 0 4 FL
    END-POINT 76 0 0 4 BW
    SKEY FLWN
    ITEM-CODE FLG-4
PIPE
    END-POINT 76 0 0 4 BW
    END-POINT 1000 0 0 4 BW
    MATERIAL-IDENTIFIER 7
SUPPORT
    CO-ORDS 500 0 0 4
    SKEY ANCH
    ITEM-CODE SUP-1
FLANGE
    END-POINT 1000 0 0 4 BW
    END-POINT 1076 0 0 4 FL
    SKEY FLWN
    ITEM-CODE FLG-4
GASKET
    END-POINT 1076 0 0 4 FL
    END-POINT 1079 0 0 4 FL
    ITEM-CODE GSK-4
BOLT
    CO-ORDS 1076 0 0 4
    BOLT-QUANTITY 8
    BOLT-DIA 0.625
    BOLT-LENGTH 89
    ITEM-CODE STUD-4
MATERIALS
MATERIAL-IDENTIFIER 7
    DESCRIPTION PIPE, SMLS, BE, A106 GR. B, STD
ITEM-CODE STUD-4
    DESCRIPTION STUD BOLTS C/W 2 NUTS, A193 B7
`;
  const { doc, warnings } = importPcf(pcf);
  const rows = sheetMaterials(doc, packageSpools(doc)[0]);
  assert.match(rows.find(r => r.category === 'pipe')!.description, /^PIPE, SMLS, BE, A106 GR\. B, STD/);
  // The flange is its face, and its weld end is its takeout away.
  const flanges = doc.nodes.filter(n => n.kind === 'flange');
  assert.ok(flanges.some(f => f.position[0] === 0) && flanges.some(f => f.position[0] === 1076));
  // The recorded bolts keep their diameter and length; the joint at the far flange is not supplied twice.
  const bolts = rows.filter(r => r.category === 'bolt');
  assert.ok(bolts.every(r => r.nd === '5/8"X3 1/2"' && /A193 B7/.test(r.description)));
  assert.equal(rows.filter(r => r.category === 'gasket').reduce((s, r) => s + r.qty, 0), 2);
  // The joint at the first flange has no gasket or bolt record: they are supplied (in the PCF's own bolt material) and said.
  assert.equal(bolts.reduce((s, r) => s + r.qty, 0), 16);
  assert.match(warnings.join('\n'), /1 flanged joint\(s\) have no BOLT record/);
  assert.match(warnings.join('\n'), /1 flanged joint\(s\) have no GASKET record/);
  assert.ok(rows.some(r => r.category === 'support'));
});

test('a drawing read back from its own PCF alone keeps its equipment flange at its face, with its gasket and bolting', () => {
  const { doc, start } = job(0);
  const original = bomText(doc);
  const alone = importPcf(exportPcf(doc)).doc;
  const flange = alone.nodes.find(n => n.kind === 'flange' && n.position.every((v, i) => Math.abs(v - start.position[i]) < 0.01));
  assert.ok(flange, 'the flange node is at its face');
  for (const part of ['gasket', 'bolt'] as const) {
    const count = (rows: string[]) => rows.filter(r => part === 'bolt' ? /BOLT/.test(r) : /GASKET/.test(r)).map(r => Number(r.split('|')[0])).reduce((a, b) => a + b, 0);
    assert.equal(count(bomText(alone)), count(original));
  }
  assert.deepEqual(cuts(alone), cuts(doc));
});

test('the cut list shows the field-fit makeup and formed-bend terms its cut includes; the weld map tells field-fit welds from field welds', () => {
  const { doc } = job();
  const fit = cutSchedule(doc).find(c => c.makeup[1] > 0)!;
  close(fit.cut, fit.overall - fit.takeouts[0] - fit.takeouts[1] - fit.gaps[0] - fit.gaps[1] + fit.makeup[1]);
  assert.match(cutText(fit, doc), /\(\+ 100 FIELD-FIT MAKEUP\)$/);
  assert.match(cutCsv(doc).split('\n')[0], /Field-fit makeup mm/);
  const rows = weldSchedule(doc);
  assert.ok(rows.some(r => r.weld.fieldFit));
  assert.match(weldCsv(doc), /FIELD-FIT/);
});

test('specifications without labour rates and items without weights are reported', () => {
  const { doc } = job();
  doc.specs[0].weldHoursPerDiameterInch = 0;
  doc.specs[0].pipeLaborHoursM = 0;
  const text = fabricationWarnings(doc).join('\n');
  assert.match(text, /has no labour rates for weld hours per diameter-inch or pipe hours per metre/);
  doc.specs[0].fittings = doc.specs[0].fittings.map(f => ({ ...f, weightKg: undefined }));
  assert.match(fabricationWarnings(parseIsoJson(JSON.stringify(doc))).join('\n'), /no weight, so the spool's weight totals are incomplete/);
});
