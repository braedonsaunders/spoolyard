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

test('lug bolts: a drawn lug valve and a lug mate off the drawing take the same API 609 body length', () => {
  // Class 150: 2-3/4 in at NPS 2 and 3-1/4 in at NPS 3, whatever the gasket or lap.
  assert.equal(bolting(2, 150, 'FF', 'lug-valve-side', { body: 43, gasket: inch(1 / 16), lap: 2.77 })!.length, inch(2.75));
  assert.equal(bolting(3, 150, 'FF', 'lug-valve-side', { body: 47, gasket: inch(1 / 16) })!.length, inch(3.25));
  const doc = newIso(); doc.units = 'imperial'; doc.specs = [flatLapSpec()];
  appendRun(doc, null, [inch(40), 0, 0], 'X9', 2, 'S', 'L');
  placeComponentOnPipe(doc, doc.runs[0].id, type('BFLY-LUG'), 0.5, doc.specs[0].fittings.find(f => f.component === 'BFLY-LUG'));
  const valve = flangedJoints(doc).filter(j => j.bolts?.kind === 'lug');
  assert.deepEqual(valve.map(j => j.bolts!.length), [inch(2.75), inch(2.75)]);
  // A flange whose mate is a lug valve (or tapped nozzle) on another drawing: sized for the API 609 body, and said.
  const end = appendRun(doc, null, [0, inch(20), 0], 'X9', 2, 'T', 'L');
  applyComponent(doc, end, 'FLG-FFLJ', doc.specs[0].fittings[1]);
  end.jointSupply = { gasket: true, bolts: true, mate: 'lug' };
  const mate = flangedJoints(doc).find(j => j.nodeId === end.id)!;
  assert.deepEqual([mate.bolts!.kind, mate.bolts!.length], ['lug', inch(2.75)]);
  assert.match(mate.assumed.join(), /API 609 lug butterfly body/);
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
