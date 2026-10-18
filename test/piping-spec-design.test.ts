import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { appendRun, applyComponent, attachComponent, newIso, parseIsoJson, runResult, type CatalogItem, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { catalogRow, dimensionIssues, flangedJoints, jointGasket, specFlangeClass } from '../src/core/joints.ts';
import {
  LUG_CONVENTION, SOCKET_WELD_GAP, bolting, flange, forgedClassForWall, pipeOd, pipeWall, returnBend, standardRow, stubEnd
} from '../src/core/standards.ts';
import { designValue, specDesign, validSpecDesign } from '../src/core/spec-design.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';

// Invented specification data: no client or library rows.
const inch = (v: number) => v * 25.4;
const close = (actual: number | undefined, expected: number, tol = 0.01) => assert.ok(actual != null && Math.abs(actual - expected) <= tol, `${actual} ≉ ${expected}`);
const type = (code: string) => COMPONENT_TYPES.find(t => t.code === code)!;
function testSpec(over: Partial<PipeSpec> = {}): PipeSpec {
  return {
    id: 'T1', name: 'Test 1', material: 'Carbon steel', schedule: 'STD', rating: '150#', rootGap: 1.6, socketGap: 1.6, density: 7850,
    pipeCostM: 0, pipeLaborHoursM: 0, weldHoursPerDiameterInch: 0,
    sizes: [
      { nps: 0.75, od: 26.7, wall: 3.91, kgM: 2.2, schedule: 'XS' },
      { nps: 2, od: 60.3, wall: 3.91, kgM: 5.44, schedule: 'STD' },
      { nps: 6, od: 168.3, wall: 7.11, kgM: 28.26, schedule: 'STD' }
    ],
    fittings: [], ...over
  };
}
const row = (component: string, kind: CatalogItem['kind'], nps: number, extra: Partial<CatalogItem> = {}): CatalogItem =>
  ({ id: `T1/${component}-${nps}${extra.id ?? ''}`, component, kind, nps, takeout: 0, description: component, source: 'invented', ...extra });
const docWith = (spec: PipeSpec, nps = 2, length = 2000): IsoDocument => {
  const doc = newIso(); doc.specs = [spec];
  appendRun(doc, null, [length, 0, 0], spec.id, nps, 'SP-1', 'L-1');
  return doc;
};

test('half couplings are measured from the header outside, so their branch cut takes off the header radius', () => {
  const sw = standardRow('H-CPLGSW', 0.75, '3000#')!, thd = standardRow('H-CPLGSC', 0.75, '3000#')!;
  assert.equal(sw.takeoutReference, 'header-outside');
  assert.equal(thd.takeoutReference, 'header-outside');
  close(sw.height, sw.takeout + sw.socketDepth!);
  close(thd.height, thd.takeout + thd.threadEngagement!);
  // A 6" header with a 3/4" socket-weld half coupling and no specification row for it.
  const doc = docWith(testSpec({ design: { forgedClass: 3000 } }), 6);
  const coupling = attachComponent(doc, doc.runs[0].id, 'olet', 0.5);
  applyComponent(doc, coupling, 'H-CPLGSW');
  appendRun(doc, coupling.id, [0, 0, 300], 'T1', 0.75, 'SP-1', 'L-1', 'SW');
  close(runResult(doc, doc.runs[1]).cut, 300 - 168.3 / 2 - 1.6 - sw.takeout - SOCKET_WELD_GAP);
});

test('the pressure class is the row\'s own, else the specification\'s; with none it is assumed and reported', () => {
  const wn150 = flange(2, 150)!.wnLength, wn300 = flange(2, 300)!.wnLength;
  // A 300# specification's 150# row without a takeout takes the 150# standard, not the specification's class.
  const s300 = testSpec({ rating: '300#', fittings: [row('FLG-RFWN', 'flange', 2, { rating: '150#', takeoutMissing: true })] });
  close(catalogRow(s300, 'FLG-RFWN', 2)!.takeout, wn150);
  close(catalogRow(testSpec({ rating: '300#' }), 'FLG-RFWN', 2)!.takeout, wn300);
  // No class anywhere: Class 150 dimensions, flagged.
  const open = testSpec({ rating: 'Project specified' });
  const assumed = catalogRow(open, 'FLG-RFWN', 2)!;
  close(assumed.takeout, wn150);
  assert.match(assumed.assumed!, /Class 150 flange dimensions are assumed/);
  assert.equal(specFlangeClass(open).value, 150);
  // Butt-weld fittings do not depend on the class, so they carry no class assumption.
  assert.equal(catalogRow(open, 'W-LR90EL', 2)!.assumed, undefined);
  // The typed design field, then the imported ANSI Rating parameter, name the class.
  assert.equal(catalogRow(testSpec({ rating: 'Project specified', design: { flangeClass: 300 } }), 'FLG-RFWN', 2)!.takeout, wn300);
  const legacy = testSpec({ rating: 'Project specified', parameters: { 'Welded/Flanged General Parameters.ANSI Rating': '300' } });
  assert.equal(catalogRow(legacy, 'FLG-RFWN', 2)!.assumed, undefined);
  assert.equal(specFlangeClass({ ...legacy, design: { flangeClass: 600 } }).value, 600, 'the typed field wins over the imported parameter');
  // A class the tables do not cover gives no dimensions rather than another class's.
  assert.equal(catalogRow(testSpec({ rating: '2500#' }), 'FLG-RFWN', 2), undefined);
});

test('an unspecified class is listed once per specification with the items it applies to', () => {
  const doc = docWith(testSpec({ rating: 'Project specified', design: { flangeFace: 'RF', gasketThickness: 3.2 } }));
  placeComponentOnPipe(doc, doc.runs[0].id, type('GATE-FL'), 0.3);
  placeComponentOnPipe(doc, doc.runs[1].id, type('GLOBE-FL'), 0.6);
  const issues = dimensionIssues(doc), cls = issues.filter(i => /pressure class/.test(i));
  assert.equal(cls.length, 1);
  assert.match(cls[0], /^Specification T1: Class 150 flange dimensions are assumed/);
  assert.match(cls[0], /GATE-FL 2"/);
  assert.match(cls[0], /GLOBE-FL 2"/);
  doc.specs[0].design!.flangeClass = 150;
  assert.deepEqual(dimensionIssues(doc), []);
});

test('ambiguous ball and plug valve patterns are flagged; a named pattern is used', () => {
  const ball = standardRow('BALL-FL', 6, 150)!;
  close(ball.faceToFace, inch(15.5));
  assert.equal(ball.valvePattern, 'long');
  assert.match(ball.assumed!, /long pattern is assumed/);
  close(standardRow('BALL-FL', 6, 150, undefined, undefined, { valvePattern: 'short' })!.faceToFace, inch(10.5));
  assert.equal(standardRow('BALL-FL', 6, 150, undefined, undefined, { valvePattern: 'short' })!.assumed, undefined);
  assert.equal(standardRow('BALL-FL', 2, 150)!.assumed, undefined, 'both patterns are 7 in at NPS 2');
  assert.match(standardRow('PLUG-FL', 6, 150)!.assumed!, /regular pattern/);
  assert.equal(standardRow('PLUG-FL', 6, 150, undefined, undefined, { valvePattern: 'venturi' }), undefined, 'B16.10 gives no venturi length');
  // The specification's pattern for its ball valves, and a row's own pattern over it.
  const spec = testSpec({ design: { ballValvePattern: 'short' } });
  spec.sizes.push({ nps: 8, od: 219.1, wall: 8.18, kgM: 42.55, schedule: 'STD' });
  close(catalogRow(spec, 'BALL-FL', 6)!.faceToFace, inch(10.5));
  spec.fittings.push(row('BALL-FL', 'valve', 8, { takeoutMissing: true, valvePattern: 'long', description: 'BALL VALVE, FULL PORT' }));
  close(catalogRow(spec, 'BALL-FL', 8)!.faceToFace, inch(18));
  assert.equal(catalogRow(spec, 'BALL-FL', 8)!.description, 'BALL VALVE, FULL PORT');
});

test('butterfly valves: API 609 category by class, separate wafer, lug and double-flanged bodies, bolting by body', () => {
  const a = standardRow('BFLY-LUG', 6, 150)!, b = standardRow('BFLY-LUG', 6, 150, undefined, undefined, { butterflyCategory: 'B' })!;
  assert.equal(a.faceToFace, 56);
  assert.match(a.assumed!, /Category A/);
  assert.equal(b.faceToFace, 57);
  assert.equal(b.assumed, undefined);
  assert.equal(standardRow('BFLY-WAFER', 6, 300)!.faceToFace, 59);
  assert.equal(standardRow('BFLY-WAFER', 6, 300)!.assumed, undefined, 'Class 300 bodies are Category B only');
  assert.equal(standardRow('BFLY-WAFER', 6, 300, undefined, undefined, { butterflyCategory: 'A' }), undefined);
  assert.equal(standardRow('BFLY', 6, 150, undefined, undefined, { butterflyBody: 'double-flanged' }), undefined, 'no tabulated double-flanged length');
  assert.match(standardRow('BFLY', 6, 150)!.assumed!, /lug-body butterfly valve is assumed/);
  assert.equal(standardRow('BFLY', 6, 150, undefined, undefined, { butterflyBody: 'wafer' })!.bodyType, 'wafer');

  const joints = (body: CatalogItem['bodyType']) => {
    const spec = testSpec({
      design: { flangeFace: 'RF', gasketThickness: 3.2 },
      fittings: [row('BFLY', 'valve', 6, { takeout: 30, faceToFace: 60, bodyType: body, valveCategory: 'B', description: 'BUTTERFLY VALVE' })]
    });
    const doc = docWith(spec, 6);
    placeComponentOnPipe(doc, doc.runs[0].id, type('BFLY'), 0.5);
    return flangedJoints(doc).map(j => j.bolts);
  };
  const pair = bolting(6, 150, 'RF', 'flange-pair')!;
  // Double-flanged: a stud set through each mating flange, as for any flanged valve.
  assert.deepEqual(joints('double-flanged').map(b => [b?.kind, b?.length]), [['stud', pair.length], ['stud', pair.length]]);
  // Wafer: one set of through studs sized over the valve's own 60 mm body.
  const wafer = joints('wafer');
  assert.equal(wafer.filter(Boolean).length, 1);
  assert.equal(wafer[0]!.length, bolting(6, 150, 'RF', 'wafer-valve', { body: 60, gasket: 3.2 })!.length);
  // Lug: lug bolts from each side, into the valve's own body.
  assert.deepEqual(joints('lug').map(b => [b?.kind, b?.length]), Array(2).fill(['lug', bolting(6, 150, 'RF', 'lug-valve-side', { body: 60, gasket: 3.2 })!.length]));
});

test('lug bolts into a tapped body engage one diameter; a lap-joint flange adds its stub-end lap to the grip', () => {
  const up = (v: number) => Math.ceil(v * 4 - 1e-9) / 4;
  const tapped = bolting(2, 150, 'RF', 'lug-valve-side', { tapped: true })!;
  close(tapped.length, inch(up(0.75 + 0.12 + 0.625 + 0.12 + 0.625 + 0.06)));
  assert.match(tapped.source, /tapped body/);
  assert.equal(tapped.assumed, LUG_CONVENTION, 'no standard gives lug-bolt lengths: the convention is said');
  const lap = bolting(4, 150, 'RF', 'lug-valve-side', { tapped: true, lap: inch(0.5) })!;
  close(lap.length, inch(up(0.94 - 1 / 16 + 0.5 + 0.12 + 0.625 + 0.12 + 0.625 + 0.06)));
});

test('bolt rows are matched by face, class and makeup, and their count, diameter and length are taken together', () => {
  const bolts = (fittings: CatalogItem[], parameters?: Record<string, string>) => {
    const doc = docWith(testSpec({ design: { flangeFace: 'RF', gasketThickness: 3.2 }, fittings, parameters }));
    placeComponentOnPipe(doc, doc.runs[0].id, type('GATE-FL'), 0.5);
    return flangedJoints(doc)[0].bolts!;
  };
  const ff = row('BOLT-FF', 'bolt', 2, { boltCount: 8, boltDiameter: 10, boltLength: 50 });
  const other = row('BOLT-RF', 'bolt', 2, { id: '-300', rating: '300#', boltCount: 8, boltDiameter: 15.88, boltLength: 88.9 });
  const good = row('BOLT-RF', 'bolt', 2, { id: '-ok', boltCount: 4, boltDiameter: 15.88, boltLength: 85 });
  const picked = bolts([ff, other, good]);
  assert.deepEqual([picked.count, picked.diameter, picked.length, picked.item?.id], [4, 15.88, 85, good.id]);
  // A row without its length is not mixed with the standard's: the whole standard set is used, and said.
  const partial = bolts([row('BOLT-RF', 'bolt', 2, { boltCount: 8, boltDiameter: 19.05 })]), std = bolting(2, 150, 'RF', 'flange-pair')!;
  assert.deepEqual([partial.count, partial.diameter, partial.length], [std.count, std.diameter, std.length]);
  assert.match(partial.assumed!, /lacks a count, diameter or length/);
  // Machine bolts by the imported Bolt Type: the B16.5 machine-bolt length.
  const machine = bolts([], { 'Welded/Flanged General Parameters.Bolt Type': 'MACHINE' });
  assert.equal(machine.kind, 'machine');
  close(machine.length, inch(2.75));
});

test('gasket thickness has one source: the row, else the specification parameter, else the standard (flagged)', () => {
  const none = jointGasket(testSpec(), 2, 'RF');
  assert.equal(none.thickness, 3.3);
  assert.match(none.assumed!, /spiral-wound/);
  // The imported CADWorx Gasket Thickness (inches) is honoured.
  const param = jointGasket(testSpec({ parameters: { 'Welded/Flanged General Parameters.Gasket Thickness': '0.125' } }), 2, 'RF');
  assert.deepEqual([param.thickness, param.assumed], [3.18, undefined]);
  assert.equal(jointGasket(testSpec({ design: { gasketThickness: 1.5 } }), 2, 'RF').thickness, 1.5);
  // A row's own thickness wins; a row for the other face is never used for this one.
  const spec = testSpec({ design: { gasketThickness: 1.5 }, fittings: [row('GASK-FF', 'gasket', 2, { thickness: 6 }), row('GASK-RF', 'gasket', 6, { thickness: 2 })] });
  assert.equal(jointGasket(spec, 2, 'RF').thickness, 1.5);
  assert.equal(jointGasket(spec, 6, 'RF').thickness, 2);
  assert.equal(jointGasket(spec, 2, 'FF').thickness, 6);
});

test('pipe walls come from the B36.10M schedules, and a missing wall is assumed out loud, never silently', () => {
  assert.equal(pipeWall(10, 'SCH 20'), 6.35);
  assert.equal(pipeWall(8, '30'), 7.04);
  assert.equal(pipeWall(24, 'SCH.10'), 6.35);
  assert.equal(pipeWall(2, 'SCH 20'), undefined);
  const so = standardRow('FLG-RFSO', 2, 150, undefined, 'SCH 20')!;
  close(so.takeout, pipeWall(2, 'STD')! + 1.59);
  assert.match(so.assumed!, /STD wall because schedule SCH 20/);
  // B31.3 limits the set-back to the lesser of the wall and 1/4 in; the 1/16 in shop clearance is added and stated.
  close(standardRow('FLG-RFSO', 8, 150, undefined, 'XS')!.takeout, 6.35 + 1.59);
  assert.match(standardRow('FLG-RFSO', 8, 150, undefined, 'XS')!.source, /1\/4 in/);
  // Caps: length E up to the XS wall, E1 above it.
  close(standardRow('W-CAP', 4, undefined, undefined, 'XS')!.takeout, inch(2.5));
  close(standardRow('W-CAP', 4, undefined, undefined, 'XXS')!.takeout, inch(3));
  assert.match(standardRow('W-CAP', 4)!.assumed!, /no pipe schedule/);
  assert.match(stubEnd(2, false, 'SCH 30')!.assumed!, /STD wall/);
  // A weldolet follows its branch wall; heavier than XS there is no catalogued weldolet.
  assert.match(standardRow('WOL', 2, undefined, undefined, 'XS')!.description, /XS/);
  assert.equal(standardRow('WOL', 2, undefined, undefined, 'XXS'), undefined);
  assert.match(standardRow('WOL', 2, undefined, undefined, 'STD', { oletSchedule: 'XS' })!.description, /XS/);
});

test('forged classes are given or follow ASME B16.11 Table 2, never the flange class', () => {
  assert.equal(forgedClassForWall(1, 'XS', false), 3000);
  assert.equal(forgedClassForWall(1, 'SCH 160', false), 6000);
  assert.equal(forgedClassForWall(1, 'XXS', false), 9000);
  assert.equal(forgedClassForWall(1, 'XS', true), 2000);
  assert.equal(forgedClassForWall(1, 'STD', true), 2000);
  assert.equal(forgedClassForWall(1, 'SCH 20', true), undefined);
  assert.equal(standardRow('SW-90ELL', 1, 600), undefined, 'a flange class is not a forged class');
  assert.equal(standardRow('SW-90ELL', 1, undefined, undefined, undefined, { forgedClass: 2000 }), undefined, 'no Class 2000 socket-weld fittings');
  assert.match(standardRow('SC-CAP', 1, '2000#')!.assumed!, /Class 3000 caps/);
  const spec = testSpec({ parameters: { 'Screwed/Socket Weld General Parameters.Pipe Rating': '6000#' } });
  assert.equal(catalogRow(spec, 'SW-90ELL', 0.75)!.description, 'ELBOW 90 SW 6000#');
  assert.equal(catalogRow(spec, 'SW-90ELL', 0.75)!.assumed, undefined);
});

test('every built-in socket-weld item uses one socket depth, so derived takeouts agree', () => {
  for (const nps of [0.5, 0.75, 1, 1.5, 2]) {
    const depth = standardRow('SW-90ELL', nps, '3000#')!.socketDepth;
    for (const code of ['SW-TEE', 'SOL', 'UNION-SW', 'H-CPLGSW', 'F-CPLGSW']) assert.equal(standardRow(code, nps, '3000#')?.socketDepth, depth, `${code} ${nps}`);
    const sol = standardRow('SOL', nps, '3000#')!;
    close(sol.takeout, sol.height! - depth!);
    assert.match(sol.source, /manufacturer data/);
  }
});

test('180° returns give B16.9 centre-to-centre O and back-to-face K', () => {
  for (const nps of [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24])
    for (const r of ['LR', 'SR'] as const) {
      const ret = returnBend(nps, r);
      if (!ret) { assert.ok(r === 'SR' && nps < 1, `${r} ${nps}`); continue; }
      // K is O/2 plus half the pipe OD, as published to 1/16 in.
      assert.ok(Math.abs(ret.backToFace - (ret.centreToCentre / 2 + pipeOd(nps)! / 2)) <= 1.6, `${r} NPS ${nps}: K ${ret.backToFace}`);
      if (r === 'LR') close(ret.radius, standardRow('W-LR90EL', nps)!.takeout, 0.02);
    }
  const lr = standardRow('LR180R', 4)!;
  assert.deepEqual([lr.centreToCentre, lr.backToFace, lr.takeout], [304.8, 209.55, 152.4]);
});

test('reducers keep to the B16.9 size range; reducing laterals and manufacturer data say what they are', () => {
  assert.equal(standardRow('C-RED', 4, undefined, 1), undefined, 'B16.9 reduces NPS 4 to 1-1/2 at most');
  assert.ok(standardRow('C-RED', 4, undefined, 1.5));
  assert.equal(standardRow('REDELL', 4, undefined, 1.5), undefined);
  assert.ok(standardRow('REDELL', 4, undefined, 2));
  assert.match(standardRow('W-RLAT', 4, undefined, 2)!.assumed!, /straight lateral of its run size/);
  assert.match(standardRow('W-LAT', 4)!.source, /manufacturer data/);
  assert.equal(SOCKET_WELD_GAP, 1.6);
});

test('typed specification design fields are validated and win over the imported parameters', () => {
  assert.ok(validSpecDesign(undefined));
  assert.ok(validSpecDesign({ flangeClass: 300, butterflyBody: 'double-flanged', gasketThickness: 3.2 }));
  assert.ok(!validSpecDesign({ flangeClass: 175 }));
  assert.ok(!validSpecDesign({ bodyStyle: 'lug' }));
  assert.ok(!validSpecDesign([]));
  const spec = testSpec({
    design: { stubEndSchedule: 'XS' },
    parameters: { 'Welded/Flanged General Parameters.Lap Joint Flange Weight': 'STD', 'Welded/Flanged General Parameters.WOL/EOL Weight': 'XS', 'Welded/Flanged General Parameters.Plug Valve Type': 'ALL' }
  });
  assert.deepEqual(designValue(spec, 'stubEndSchedule'), { value: 'XS', source: 'specification T1 stubEndSchedule' });
  assert.equal(designValue(spec, 'oletSchedule').value, 'XS');
  assert.equal(designValue(spec, 'plugValvePattern').value, undefined, 'ALL names no pattern');
  assert.deepEqual(specDesign(spec), { stubEndSchedule: 'XS', oletSchedule: 'XS' });
  // The stub-end weight sets the lap wall of standard stub ends.
  assert.equal(catalogRow(spec, 'STUB-END', 2)!.thickness, pipeWall(2, 'XS'));
  const doc = newIso(); doc.specs = [{ ...testSpec(), design: { flangeClass: 3 } as never }];
  assert.throws(() => parseIsoJson(JSON.stringify(doc)), /Invalid pipe specification parameters/);
  doc.specs[0].design = { flangeClass: 300 };
  assert.equal(parseIsoJson(JSON.stringify(doc)).specs[0].design!.flangeClass, 300);
});

test('library rows say where they come from, and rows without a takeout say it is missing', () => {
  const dir = new URL('../public/library/specs/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const spec = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as PipeSpec;
    for (const f of spec.fittings) {
      assert.ok(f.source.startsWith(`Library specification ${spec.id}`), `${file} ${f.id}: ${f.source}`);
      if (f.takeoutMissing) assert.match(f.source, /no takeout given/, `${file} ${f.id}`);
      if (f.component === 'BFLY') assert.ok(f.bodyType, `${file} ${f.id} body type`);
    }
  }
});

test('library pipe sizes have their published B36.10M/B36.19M wall and the mass that wall gives at the spec density', () => {
  assert.equal(pipeWall(12, 'STD'), 9.53, 'published millimetres round half up');
  assert.equal(pipeWall(36, 'STD'), 9.53);
  assert.equal(pipeOd(42), 1066.8);
  assert.equal(pipeWall(22, 'SCH.10S'), 5.54);
  const dir = new URL('../public/library/specs/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const spec = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as PipeSpec;
    for (const size of spec.sizes) {
      const at = `${file} NPS ${size.nps} ${size.schedule}`;
      assert.equal(size.wall, pipeWall(size.nps, size.schedule ?? spec.schedule), at);
      assert.ok(Math.abs(size.od - pipeOd(size.nps)!) <= 0.5, at);
      const mass = Math.PI * (size.od - size.wall) * size.wall * spec.density / 1e6;
      assert.ok(Math.abs(size.kgM - mass) <= 0.005 * mass + 1e-9, `${at}: ${size.kgM} kg/m vs ${mass.toFixed(3)}`);
    }
  }
});

test('nipple text follows the drawing\'s units and size notation', async () => {
  const { nippleText } = await import('../src/core/joints.ts');
  const spec = testSpec({ nipples: [{ nps: 0.75, length: inch(3), schedule: 'XS', material: 'A106 GR. B' }] });
  assert.equal(nippleText(spec, 0.75, inch(3), 'TBE', { units: 'imperial' }), 'NIPPLE, 3/4" X 3" LG, XS, A106 GR. B, TBE');
  assert.equal(nippleText(spec, 0.75, inch(3), 'TBE', { units: 'mm' }), 'NIPPLE, 3/4" X 76 MM LG, XS, A106 GR. B, TBE');
  assert.match(nippleText(spec, 0.75, inch(3), 'TBE', { units: 'mm', profile: { sizeNotation: 'DN' } as never }), /^NIPPLE, DN20 X 76 MM LG/);
});
