import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, getNode, newIso, parseIsoJson, runResult, socketGapOf, validateIso, welds, type CatalogItem, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { flangedJoints, jointGasket } from '../src/core/joints.ts';
import { sheetMaterials } from '../src/core/material-list.ts';
import { bolting } from '../src/core/standards.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';

// Invented specification data: a flat-faced lap-joint class whose only gasket and bolt rows are written "RF", as
// imported specifications often are. The specification's own rows must still govern its joints.
const inch = (v: number) => v * 25.4;
const close = (actual: number | undefined, expected: number, tol = 0.01) => assert.ok(actual != null && Math.abs(actual - expected) <= tol, `${actual} ≉ ${expected}`);
const type = (code: string) => COMPONENT_TYPES.find(t => t.code === code)!;
const row = (component: string, kind: CatalogItem['kind'], takeout: number, bomDescription: string, extra: Partial<CatalogItem> = {}): CatalogItem =>
  ({ id: `X9/${component}-2`, component, kind, nps: 2, takeout, description: component, bomDescription, source: 'invented', ...extra });
function flatLapSpec(over: Partial<PipeSpec> = {}): PipeSpec {
  return {
    id: 'X9', name: 'X9', material: 'Invented alloy', schedule: '10S', rating: '150#', rootGap: 0, density: 8000,
    pipeCostM: 0, pipeLaborHoursM: 0, weldHoursPerDiameterInch: 0,
    parameters: { 'Default Flange': 'FLG-FFLJ', 'Welded/Flanged General Parameters.Flange Face': 'FF' },
    sizes: [{ nps: 2, od: 60.3, wall: 2.77, kgM: 4, bomDescription: 'PIPE, INVENTED, SCH 10S' }],
    fittings: [
      row('STUB-END-SHORT', 'flange', inch(2.5), 'STUB END, INVENTED', { thickness: 2.77 }),
      row('FLG-FFLJ', 'flange', 0, 'FLANGE LJ, INVENTED, FF'),
      row('FLG-RFWN', 'flange', inch(2.5), 'FLANGE WN, INVENTED, RF'),
      row('GASK-RF', 'gasket', inch(1 / 32), 'GASKET, INVENTED SHEET, 1/16" THK', { thickness: inch(1 / 16) }),
      row('BOLT-RF', 'bolt', 0, 'STUD BOLT, INVENTED', { boltCount: 4, boltDiameter: inch(5 / 8), boltLength: inch(3.5) }),
      row('BFLY-LUG', 'valve', 21.5, 'BUTTERFLY VALVE, INVENTED, LUG', { faceToFace: 43 })
    ],
    ...over
  };
}
/** Three pipes in line, with a flange pair at each of the two inner points. */
function pairs(spec: PipeSpec, codes: [string, string]): IsoDocument {
  const doc = newIso(); doc.units = 'imperial'; doc.specs = [spec];
  const a = appendRun(doc, null, [inch(20), 0, 0], spec.id, 2, 'S', 'L');
  const b = appendRun(doc, a.id, [inch(20), 0, 0], spec.id, 2, 'S', 'L');
  appendRun(doc, b.id, [inch(20), 0, 0], spec.id, 2, 'S', 'L');
  applyComponent(doc, a, codes[0], spec.fittings.find(f => f.component === codes[0]));
  applyComponent(doc, b, codes[1], spec.fittings.find(f => f.component === codes[1]));
  return doc;
}

test('a specification gasket written for the other face is still its gasket, ahead of an assumed standard one', () => {
  const spec = flatLapSpec();
  const ff = jointGasket(spec, 2, 'FF');
  assert.deepEqual([ff.item?.id, ff.thickness, ff.assumed], ['X9/GASK-RF-2', inch(1 / 16), undefined]);
  // A row for the joint's own face, and then the specification's stated thickness, still come first.
  assert.equal(jointGasket(flatLapSpec({ design: { gasketThickness: 2 } }), 2, 'FF').thickness, 2);
  const both = flatLapSpec({ fittings: [...spec.fittings, row('GASK-FF', 'gasket', 1.5, 'GASKET, INVENTED FULL FACE', { thickness: 3 })] });
  assert.equal(jointGasket(both, 2, 'FF').thickness, 3);
  assert.equal(jointGasket(both, 2, 'RF').thickness, inch(1 / 16));
  // A raised-face specification's spiral-wound row never serves a flat-faced joint (a flat-faced nozzle on its line):
  // that joint takes the standard full-face sheet gasket, and says so.
  const rf = flatLapSpec({ parameters: { 'Welded/Flanged General Parameters.Flange Face': 'RF' },
    fittings: [row('GASK-RF', 'gasket', 1.65, 'GASKET, INVENTED SPIRAL WOUND', { thickness: 3.3 }), row('BOLT-RF', 'bolt', 0, 'STUD BOLT, INVENTED', { boltCount: 4, boltDiameter: inch(5 / 8), boltLength: inch(3.5) })] });
  const flat = jointGasket(rf, 2, 'FF');
  assert.deepEqual([flat.item?.component, flat.thickness], ['GASK-FF', 3.18]);
  assert.match(flat.item!.description, /FULL FACE/);
  // The cut takes half the specification's 1/16" gasket at a pair, not half an assumed 1/8" one.
  const doc = pairs(spec, ['FLG-FFLJ', 'FLG-FFLJ']);
  close(runResult(doc, doc.runs[1]).cut, inch(20) - 2 * (inch(2.5) + inch(1 / 32)));
  const gaskets = sheetMaterials(doc, 'S').filter(r => r.category === 'gasket');
  assert.deepEqual(gaskets.map(r => [r.qtyText, r.description]), [['2', 'GASKET, INVENTED SHEET, 1/16" THK']]);
});

test('one specification gasket used at RF and FF joints is one bill-of-materials row', () => {
  const doc = pairs(flatLapSpec(), ['FLG-RFWN', 'FLG-FFLJ']);
  assert.deepEqual(flangedJoints(doc).map(j => j.face).sort(), ['FF', 'RF']);
  const gaskets = sheetMaterials(doc, 'S').filter(r => r.category === 'gasket');
  assert.deepEqual(gaskets.map(r => [r.qtyText, r.description]), [['2', 'GASKET, INVENTED SHEET, 1/16" THK']]);
});

test('specification bolt rows written for the other face still size the joint, ahead of the standard set', () => {
  const doc = pairs(flatLapSpec(), ['FLG-FFLJ', 'FLG-FFLJ']);
  const bolts = flangedJoints(doc).map(j => j.bolts!);
  assert.deepEqual(bolts.map(b => [b.count, b.diameter, b.length, b.item?.id]), Array(2).fill([4, inch(5 / 8), inch(3.5), 'X9/BOLT-RF-2']));
  const rows = sheetMaterials(doc, 'S').filter(r => r.category === 'bolt');
  assert.deepEqual(rows.map(r => [r.qtyText, r.nd, r.description]), [['8', '5/8"X3 1/2"', 'STUD BOLT, INVENTED']]);
});

test('lug bolts without a specification row are calculated: flange + gasket + engagement + projection, up to 1/4 in', () => {
  // L = F + G + E + P (standards.ts lugBolt), all in mm, rounded up to 1/4 in (5 mm for metric bolting).
  const inches = (mm: number) => Math.round(mm / 25.4 * 1000) / 1000;
  const len = (...args: Parameters<typeof bolting>) => inches(bolting(...args)!.length);
  // NPS 2 Class 150 lap-joint flange to a 43 mm lug body: F = 17.46 flange (C 0.75 in less the 1/16 in raised face)
  // + 2.77 lap; G = 1.59; E = min(1 x 15.88, 43 / 2) = 15.88; P = 15.88 nut + 2 x 25.4/11 = 4.62.
  // 20.23 + 1.59 + 15.88 + 15.88 + 4.62 = 58.20 mm = 2.29 in -> 2 1/2 in.
  assert.equal(len(2, 150, 'FF', 'lug-valve-side', { body: 43, gasket: inch(1 / 16), lap: 2.77 }), 2.5);
  // Cap screws (machine bolting into the lug) have no nut or projection: 20.23 + 1.59 + 15.88 = 37.70 mm -> 1 1/2 in.
  const screws = bolting(2, 150, 'FF', 'lug-valve-side', { body: 43, gasket: inch(1 / 16), lap: 2.77, type: 'machine' })!;
  assert.deepEqual([inches(screws.length), screws.capScrews, screws.kind], [1.5, true, 'lug']);
  // NPS 3 Class 150, lap 3.05: (22.23 + 3.05) + 1.59 + 15.88 + 15.88 + 4.62 = 63.25 mm = 2.49 in -> 2 1/2 in.
  assert.equal(len(3, 150, 'FF', 'lug-valve-side', { body: 47, gasket: inch(1 / 16), lap: 3.05 }), 2.5);
  // NPS 6 Class 300 weld-neck into a tapped body, 3.3 mm spiral-wound gasket, 3/4-10 UNC:
  // 36.51 + 3.3 + 19.05 + 19.05 + 2 x 2.54 = 82.99 mm = 3.27 in -> 3 1/2 in.
  assert.equal(len(6, 300, 'RF', 'lug-valve-side', { tapped: true, gasket: 3.3 }), 3.5);
  // NPS 4 Class 600 (C 1.5 in + the 1/4 in raised face = 44.45), 7/8-9 UNC: 44.45 + 3.3 + 22.23 + 22.23 + 5.64
  // = 97.85 mm = 3.85 in -> 4 in; as metric bolting (ISO 261 M22 pitch 2.5) 97.21 mm -> 100 mm.
  assert.equal(len(4, 600, 'RF', 'lug-valve-side', { tapped: true, gasket: 3.3 }), 4);
  assert.equal(bolting(4, 600, 'RF', 'lug-valve-side', { tapped: true, gasket: 3.3, system: 'metric' })!.length, 100);
  // The specification's engagement and projection parameters move the rule: 1.5 diameters and 3 threads at NPS 2
  // add 7.94 + 2.31 mm: 68.45 mm = 2.69 in -> 2 3/4 in.
  assert.equal(len(2, 150, 'FF', 'lug-valve-side', { body: 43, gasket: inch(1 / 16), lap: 2.77, engagement: 1.5, projectionThreads: 3 }), 2.75);
  // ...and engagement is never more than half the body: 3 diameters (47.63) are held to 43 / 2 = 21.5 mm.
  assert.match(bolting(2, 150, 'FF', 'lug-valve-side', { body: 43, gasket: inch(1 / 16), lap: 2.77, engagement: 3 })!.source, /engagement 21\.5 \(half the 43 mm body\)/);
  for (const b of [screws, bolting(6, 300, 'RF', 'lug-valve-side', { tapped: true, gasket: 3.3 })!]) {
    assert.equal(b.basis, 'calculated');
    assert.equal(b.assumed, undefined);
  }

  // On a drawing: a lug valve and a lug mate off the drawing take the same calculated length, with no warning.
  const doc = newIso(); doc.units = 'imperial'; doc.specs = [flatLapSpec()];
  appendRun(doc, null, [inch(40), 0, 0], 'X9', 2, 'S', 'L');
  placeComponentOnPipe(doc, doc.runs[0].id, type('BFLY-LUG'), 0.5, doc.specs[0].fittings.find(f => f.component === 'BFLY-LUG'));
  const end = appendRun(doc, null, [0, inch(20), 0], 'X9', 2, 'T', 'L');
  applyComponent(doc, end, 'FLG-FFLJ', doc.specs[0].fittings[1]);
  end.jointSupply = { gasket: true, bolts: true, mate: 'lug' };
  const lugs = () => flangedJoints(doc).filter(j => j.bolts?.kind === 'lug');
  assert.deepEqual(lugs().map(j => [inches(j.bolts!.length), j.bolts!.basis]), Array(3).fill([2.5, 'calculated']));
  assert.ok(lugs().every(j => !j.assumed.length), JSON.stringify(lugs().map(j => j.assumed)));
  // The specification's parameters apply to every lug joint without a row.
  doc.specs[0].design = { lugBoltEngagement: 1.5, lugBoltProjection: 3 };
  assert.deepEqual(lugs().map(j => inches(j.bolts!.length)), Array(3).fill(2.75));
  // Machine bolting makes the lug sides cap screws, with no nut.
  doc.specs[0].design = { boltType: 'machine' };
  assert.deepEqual(lugs().map(j => [inches(j.bolts!.length), j.bolts!.nuts]), Array(3).fill([1.5, 0]));
});

test('a specification lug-bolt row always wins, matched by makeup, face, class and size', () => {
  const lugRow = row('BOLT-RF', 'bolt', 0, 'LUG BOLT, INVENTED', { id: 'X9/LUG-2', boltKind: 'lug', boltCount: 4, boltDiameter: inch(5 / 8), boltLength: inch(2.75) });
  const doc = newIso(); doc.units = 'imperial'; doc.specs = [flatLapSpec()];
  doc.specs[0].fittings.push(lugRow);
  appendRun(doc, null, [inch(40), 0, 0], 'X9', 2, 'S', 'L');
  placeComponentOnPipe(doc, doc.runs[0].id, type('BFLY-LUG'), 0.5, doc.specs[0].fittings.find(f => f.component === 'BFLY-LUG'));
  const end = appendRun(doc, null, [0, inch(20), 0], 'X9', 2, 'T', 'L');
  applyComponent(doc, end, 'FLG-FFLJ', doc.specs[0].fittings[1]);
  end.jointSupply = { gasket: true, bolts: true, mate: 'lug' };
  const lugs = flangedJoints(doc).filter(j => j.bolts?.kind === 'lug');
  // Drawn lug valve (both sides) and the tapped mate: the row's set, whatever the rule would give.
  assert.deepEqual(lugs.map(j => [j.bolts!.length, j.bolts!.item?.id, j.bolts!.basis, j.bolts!.source]), Array(3).fill([inch(2.75), 'X9/LUG-2', 'specification', 'specification row X9/LUG-2']));
  assert.deepEqual(sheetMaterials(doc, 'S').filter(r => r.category === 'bolt').map(r => [r.qtyText, r.nd, r.description]), [['8', '5/8"X2 3/4"', 'LUG BOLT, INVENTED']]);
  // A lug row is never a flange pair's set, nor the pair stud row a lug side's.
  const pair = pairs(flatLapSpec({ fittings: [...flatLapSpec().fittings, lugRow] }), ['FLG-FFLJ', 'FLG-FFLJ']);
  assert.ok(flangedJoints(pair).every(j => j.bolts!.item?.id === 'X9/BOLT-RF-2' && j.bolts!.length === inch(3.5)));
  // A row for another class does not size this class's joint; the rule does.
  lugRow.rating = '300#';
  assert.ok(flangedJoints(doc).filter(j => j.bolts?.kind === 'lug').every(j => j.bolts!.length === inch(2.5) && j.bolts!.basis === 'calculated'));
  // Machine bolting: a machine-bolt row sizes flange pairs, and a lug row is bought as cap screws (no nut).
  delete lugRow.rating;
  const machine = flatLapSpec({ design: { boltType: 'machine' }, fittings: [...flatLapSpec().fittings, lugRow,
    row('BOLT-RF', 'bolt', 0, 'MACHINE BOLT, INVENTED', { id: 'X9/MB-2', boltKind: 'machine', boltCount: 4, boltDiameter: inch(5 / 8), boltLength: inch(3) })] });
  assert.ok(flangedJoints(pairs(machine, ['FLG-FFLJ', 'FLG-FFLJ'])).every(j => j.bolts!.item?.id === 'X9/MB-2' && j.bolts!.kind === 'machine' && j.bolts!.nuts === 1));
  doc.specs = [machine];
  assert.ok(flangedJoints(doc).filter(j => j.bolts?.kind === 'lug').every(j => j.bolts!.item?.id === 'X9/LUG-2' && j.bolts!.nuts === 0));
});

test('a drawing saved before the socket-weld gap default keeps the gap it was issued with', () => {
  const doc = newIso(); doc.specs = [flatLapSpec()];
  appendRun(doc, null, [1000, 0, 0], 'X9', 2, 'S', 'L');
  // Saved today without a gap: the documented 1/16" default stands (and review asks for it).
  const current = parseIsoJson(JSON.stringify(doc));
  assert.equal(current.specs[0].socketGap, undefined);
  assert.equal(socketGapOf(current.specs[0]), 1.6);
  // Saved by an earlier release (no drafting-rules revision): an unset gap meant the pipe bottomed in its socket.
  const legacy = JSON.parse(JSON.stringify(doc));
  delete legacy.draftingRules;
  const read = parseIsoJson(JSON.stringify(legacy));
  assert.equal(read.specs[0].socketGap, 0);
  // A gap the specification states is kept as it is.
  legacy.specs[0].socketGap = 1.2;
  assert.equal(parseIsoJson(JSON.stringify(legacy)).specs[0].socketGap, 1.2);
});

test('a piece exactly its stock length is a full length, listed without a cut; a longer one is cut', () => {
  const doc = newIso(); doc.specs = [flatLapSpec({ stockLength: 6000 })];
  appendRun(doc, null, [6000.5, 0, 0], 'X9', 2, 'S', 'L');
  appendRun(doc, null, [0, 6100, 0], 'X9', 2, 'S', 'L');
  const pipes = sheetMaterials(doc, 'S').filter(r => r.category === 'pipe');
  const [whole, long] = [6000.5, 6100].map(len => pipes.find(r => Math.abs(r.cut! - len) < 0.01)!);
  assert.equal(whole.pipe!.uncut, true);
  assert.doesNotMatch(whole.description, /CUT TO/);
  assert.equal(long.pipe!.uncut, false);
  assert.match(long.description, /CUT TO/);
});

test("a formed bend's own specification text is listed as written", () => {
  const spec = flatLapSpec();
  spec.fittings.push(row('PIPEBEND', 'elbow90', inch(2), 'PIPE BEND, INVENTED PIPE, SCH 10S'));
  const doc = newIso(); doc.specs = [spec];
  const bend = appendRun(doc, null, [1000, 0, 0], 'X9', 2, 'S', 'L');
  appendRun(doc, bend.id, [0, 1000, 0], 'X9', 2, 'S', 'L');
  applyComponent(doc, bend, 'PIPEBEND', spec.fittings.at(-1));
  getNode(doc, bend.id).bendRadius = inch(2);
  const rows = sheetMaterials(doc, 'S').filter(r => r.category === 'bend');
  assert.deepEqual(rows.map(r => [r.qtyText, r.description]), [['1', 'PIPE BEND, INVENTED PIPE, SCH 10S']]);
});

/** Pipe, two in-line items joined by a short link of `prep`, pipe; the link is 10 mm, whatever the items' lengths. */
function linked(spec: PipeSpec, code: string, prep: 'BW' | 'THD') {
  const doc = newIso(); doc.specs = [spec];
  const a = appendRun(doc, null, [300, 0, 0], spec.id, 2, 'S', 'L', prep);
  const b = appendRun(doc, a.id, [10, 0, 0], spec.id, 2, 'S', 'L', prep);
  appendRun(doc, b.id, [300, 0, 0], spec.id, 2, 'S', 'L', prep);
  doc.runs[1].connector = true;
  applyComponent(doc, a, code); applyComponent(doc, b, code);
  return doc;
}

test('only butt-welded faces are checked as welded face to face; screwed items overlap by their engagement', () => {
  const faceToFace = (doc: IsoDocument) => validateIso(doc).filter(m => /welded face to face/.test(m));
  assert.equal(faceToFace(linked(flatLapSpec(), 'UNION-SC', 'THD')).length, 0);
  assert.equal(faceToFace(linked(flatLapSpec(), 'GATE-BW', 'BW')).length, 1);
});

test('a lap-joint flange node on its own stub-end node is no weld and no close-coupled joint', () => {
  const spec = flatLapSpec(), doc = newIso(); doc.specs = [spec];
  const stub = appendRun(doc, null, [500, 0, 0], 'X9', 2, 'S', 'L');
  const flange = appendRun(doc, stub.id, [1.6, 0, 0], 'X9', 2, 'S', 'L');
  appendRun(doc, flange.id, [500, 0, 0], 'X9', 2, 'S', 'L');
  doc.runs[1].connector = true;
  applyComponent(doc, stub, 'STUB-END-SHORT', spec.fittings[0]);
  applyComponent(doc, flange, 'FLG-FFLJ', spec.fittings[1]);
  // Welds: pipe to the drawn stub end, and pipe to the flange's own stub end; none on the link between them.
  assert.equal(welds(doc).filter(w => w.runId === doc.runs[1].id).length, 0);
  assert.equal(welds(doc).filter(w => w.type === 'BW').length, 2);
  assert.equal(validateIso(doc).filter(m => /welded face to face/.test(m)).length, 0);
});
