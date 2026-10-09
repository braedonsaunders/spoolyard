import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  newIso, appendRun, applyComponent, attachComponent, insertComponent,
  setAutoFitting, resizeRun, validateIso, runResult, welds, bom,
  parseLength, formatLength, parseIsoJson, preferredFitting, defaultEndPrep,
} from '../src/core/model.ts';
import { exportPcf, importPcf } from '../src/core/pcf.ts';
import { createDrawing } from '../src/core/drawing.ts';
import { isometricDxf, readIsometric } from '../src/core/document.ts';
import { namespaceSpec } from '../src/editor/library.ts';

const libraryDoc = () => {
  const doc = newIso();
  doc.specs = [namespaceSpec(JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')), 'A')];
  return doc;
};
const teeDoc = () => {
  const doc = newIso();
  const junction = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, junction.id, [1000, 0, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, junction.id, [0, 1000, 0], 'CS40', 2, 'SP', '');
  return { doc, junction };
};

test('signed metric and imperial offsets keep direction and accept common trade notation', () => {
  assert.equal(parseLength('-300', 'mm', true), -300);
  assert.equal(parseLength('−2\'-3 1/2"', 'imperial', true), -698.5);
  assert.ok(Math.abs(parseLength('1-1/2"', 'mm') - 38.1) < 1e-9);
  assert.equal(parseLength('.5', 'mm'), .5);
  assert.equal(parseLength('1/2', 'mm'), .5);
  assert.equal(parseLength('1.2 M', 'mm'), 1200);
  assert.throws(() => parseLength('-100', 'mm'), /positive/);
  assert.throws(() => parseLength('9'.repeat(400), 'mm'), /finite/);
  assert.equal(formatLength(-698.5, 'imperial'), '−2′ 3 1/2″');
});

test('deleting a tee branch removes fitting takeouts and leaves one shared butt weld', () => {
  const { doc, junction } = teeDoc();
  doc.runs.pop();
  doc.nodes = doc.nodes.filter(n => n.id !== doc.nodes.at(-1)!.id);
  setAutoFitting(doc, junction.id);
  assert.equal(junction.kind, 'weld');
  assert.equal(junction.catalogId, undefined);
  assert.equal(welds(doc).length, 1);
  assert.equal(doc.runs.reduce((sum, r) => sum + runResult(doc, r).cut, 0), 1997);
  assert.deepEqual(validateIso(doc), []);
});

test('deleting a tee header leaves an elbow and deleting its last leg leaves an open end', () => {
  const { doc, junction } = teeDoc();
  doc.runs.splice(1, 1);
  setAutoFitting(doc, junction.id);
  assert.equal(junction.kind, 'elbow90');
  assert.equal(junction.catalogId, 'LR90-2');
  assert.equal(runResult(doc, doc.runs[0]).cut, 920.8);
  doc.runs.pop();
  setAutoFitting(doc, junction.id);
  assert.equal(junction.kind, 'end');
  assert.equal(runResult(doc, doc.runs[0]).cut, 1000);
});

test('mixed-size elbows and straight welds cannot pass as ordinary equal fittings', () => {
  const doc = newIso(), bend = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, bend.id, [0, 1000, 0], 'CS40', 4, 'SP', '');
  assert.match(validateIso(doc).join(), /reducing/);
  assert.equal(bend.catalogId, undefined);
  doc.nodes[2].position = [2000, 0, 0];
  setAutoFitting(doc, bend.id);
  assert.match(validateIso(doc).join(), /reducing/);
});

test('chosen short-radius elbows survive route recalculation without changing cut lengths', () => {
  const doc = newIso(), bend = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, bend.id, [0, 1000, 0], 'CS40', 2, 'SP', '');
  bend.catalogId = 'SR90-2';
  setAutoFitting(doc, bend.id);
  assert.equal(bend.catalogId, 'SR90-2');
  assert.equal(runResult(doc, doc.runs[0]).cut, 946.2);
});

test('a measured nonstandard bend is reviewed against its actual deflection', () => {
  const doc = newIso(), bend = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, bend.id, [Math.sqrt(3) * 500, 500, 0], 'CS40', 2, 'SP', '');
  assert.ok(Math.abs(bend.bendAngle! - 30) < 1e-8);
  assert.match(validateIso(doc).join(), /takeouts/);
  bend.takeout = 25;
  assert.deepEqual(validateIso(doc), []);
  assert.ok(Math.abs(importPcf(exportPcf(doc)).doc.nodes.find(n => n.kind === 'elbow90')!.bendAngle! - 30) < 1e-8);
});

test('small-bore equal tees with explicit equal outlet size are selectable', () => {
  const doc = libraryDoc(), spec = doc.specs[0];
  assert.equal(defaultEndPrep(spec, 1), 'THD');
  assert.equal(preferredFitting(spec, 'tee', 1, 'THD', 1)?.component, 'SC-TEE');
});

test('crosses use four connections and laterals accept a 45-degree branch', () => {
  for (const lateral of [false, true]) {
    const doc = libraryDoc(), j = appendRun(doc, null, [1000, 0, 0], 'A', 2, 'SP', '');
    appendRun(doc, j.id, [1000, 0, 0], 'A', 2, 'SP', '');
    appendRun(doc, j.id, lateral ? [500, 500, 0] : [0, 1000, 0], 'A', 2, 'SP', '');
    if (!lateral) appendRun(doc, j.id, [0, -1000, 0], 'A', 2, 'SP', '');
    assert.equal(j.component, lateral ? 'W-LAT' : 'W-CRS');
    j.takeout = 60; j.branchTakeout = 60;
    assert.deepEqual(validateIso(doc), []);
  }
});

test('stale branch references are reported without crashing drawing review', () => {
  const { doc, junction } = teeDoc();
  junction.branchEdgeId = 'gone';
  assert.match(validateIso(doc).join(), /Tee/);
});

test('changing pipe size after routing detects an incompatible retained catalogue row', () => {
  const doc = newIso(), j = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, j.id, [0, 1000, 0], 'CS40', 2, 'SP', '');
  doc.runs.forEach(r => r.nps = 4);
  assert.match(validateIso(doc).join(), /fitting sizes/);
});

test('shared weld tags and field status can be set from either adjoining pipe', () => {
  const doc = newIso(), j = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, j.id, [1000, 0, 0], 'CS40', 2, 'SP', '');
  doc.runs[1].fromTag = 'FW-22'; doc.runs[1].fromField = true;
  assert.equal(welds(doc)[0].tag, 'FW-22');
  assert.equal(welds(doc)[0].field, true);
  doc.runs[0].toTag = 'OTHER';
  assert.match(validateIso(doc).join(), /conflicting tags/);
});

test('flanged valves have no butt-weld root gaps or weld-map entries', () => {
  const doc = libraryDoc(); doc.specs[0].rootGap = 3;
  appendRun(doc, null, [1000, 0, 0], 'A', 2, 'SP', '');
  const valve = insertComponent(doc, doc.runs[0].id, 'valve');
  const row = doc.specs[0].fittings.find(f => f.component === 'GATE-FL' && f.nps === 2)!;
  applyComponent(doc, valve, row.component!, row);
  assert.deepEqual(doc.runs.map(r => runResult(doc, r).gaps), [[0, 0], [0, 0]]);
  assert.equal(welds(doc).length, 0);
  assert.equal(doc.runs.reduce((sum, r) => sum + runResult(doc, r).cut, 0), 822.2);
  assert.equal(parseIsoJson(JSON.stringify(doc)).runs[0].toPrep, 'FL');
});

test('a weld-neck flange consumes one flange length and has one welded port', () => {
  const doc = libraryDoc(); doc.specs[0].rootGap = 3;
  appendRun(doc, null, [1000, 0, 0], 'A', 2, 'SP', '');
  const flange = insertComponent(doc, doc.runs[0].id, 'flange');
  const row = doc.specs[0].fittings.find(f => f.component === 'FLG-RFWN' && f.nps === 2)!;
  applyComponent(doc, flange, row.component!, row);
  assert.equal(doc.runs.reduce((sum, r) => sum + runResult(doc, r).cut, 0), 933.5);
  assert.equal(welds(doc).length, 1);
  const restored = importPcf(exportPcf(doc)).doc;
  assert.equal(restored.runs.reduce((sum, r) => sum + runResult(restored, r).cut, 0), 933.5);
});

test('supports stay with the correct half when a pipe is split', () => {
  const doc = newIso(); appendRun(doc, null, [2000, 0, 0], 'CS40', 2, 'SP', '');
  const left = attachComponent(doc, doc.runs[0].id, 'support', .25);
  const right = attachComponent(doc, doc.runs[0].id, 'support', .75);
  insertComponent(doc, doc.runs[0].id, 'valve');
  assert.equal(left.associatedRunId, doc.runs[0].id);
  assert.equal(right.associatedRunId, doc.runs[1].id);
});

test('resizing a pipe translates the downstream route while retaining bends and branch lengths', () => {
  const { doc, junction } = teeDoc();
  const first = doc.runs[0], support = attachComponent(doc, first.id, 'support', .5);
  const lengths = doc.runs.slice(1).map(r => runResult(doc, r).overall);
  resizeRun(doc, first.id, 1500);
  assert.deepEqual(junction.position, [1500, 0, 0]);
  assert.deepEqual(support.position, [750, 0, 0]);
  assert.deepEqual(doc.runs.slice(1).map(r => runResult(doc, r).overall), lengths);
  assert.deepEqual(validateIso(doc), []);
});

test('resizing a closed loop refuses to distort it', () => {
  const doc = newIso(), a = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', '');
  const b = appendRun(doc, a.id, [0, 1000, 0], 'CS40', 2, 'SP', '');
  const c = appendRun(doc, b.id, [-1000, 0, 0], 'CS40', 2, 'SP', '');
  appendRun(doc, c.id, [0, -1000, 0], 'CS40', 2, 'SP', '');
  const before = JSON.stringify(doc);
  assert.throws(() => resizeRun(doc, doc.runs[0].id, 1500), /closed loop/);
  assert.equal(JSON.stringify(doc), before);
});

test('PCF weld records preserve a shared connection instead of splitting it into coincident nodes', () => {
  const doc = newIso(), j = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  appendRun(doc, j.id, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  j.tag = 'FW-2'; j.field = true;
  const restored = importPcf(exportPcf(doc)).doc;
  assert.equal(restored.nodes.length, 3);
  assert.equal(restored.runs[0].to, restored.runs[1].from);
  assert.equal(welds(restored).length, 1);
  assert.equal(welds(restored)[0].tag, 'FW-2');
});

test('PCF round trip retains the catalogue, measured fabrication values and drawing metadata', () => {
  const doc = newIso(), j = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  appendRun(doc, j.id, [0, 1000, 0], 'CS40', 2, 'SP', 'L');
  j.heat = 'ELBOW-HEAT'; j.unitCost = 12; j.laborHours = .5;
  doc.title = 'Pump tie-in'; doc.customer = 'Customer'; doc.units = 'imperial'; doc.weldNumbering = 'alphabetic';
  const restored = importPcf(exportPcf(doc)).doc;
  const bend = restored.nodes.find(n => n.kind === 'elbow90')!;
  assert.equal(bend.catalogId, j.catalogId);
  assert.equal(bend.heat, j.heat);
  assert.equal(doc.title, restored.title);
  assert.equal(restored.units, 'imperial');
  assert.equal(restored.weldNumbering, 'alphabetic');
  const before = bom(doc).find(r => r.unit === 'ea')!, after = bom(restored).find(r => r.unit === 'ea')!;
  assert.equal(after.weightKg, before.weightKg);
  assert.equal(after.cost, before.cost);
  assert.equal(after.hours, before.hours);
});

test('PCF cannot silently turn a missing fitting dimension into zero', () => {
  const doc = newIso(); appendRun(doc, null, [2000, 0, 0], 'CS40', 2, 'SP', '');
  insertComponent(doc, doc.runs[0].id, 'valve');
  assert.throws(() => exportPcf(doc), /missing fitting takeouts/);
});

test('direct fitting connectors consume no pipe root gap', () => {
  const doc = newIso(); appendRun(doc, null, [200, 0, 0], 'CS40', 2, 'SP', '');
  doc.nodes.forEach(n => { n.kind = 'valve'; n.takeout = 100; });
  doc.runs[0].connector = true;
  assert.deepEqual(runResult(doc, doc.runs[0]).gaps, [0, 0]);
  assert.equal(runResult(doc, doc.runs[0]).cut, 0);
});

test('pipe material schedules use the size-specific schedule and grade', () => {
  const doc = libraryDoc(); appendRun(doc, null, [1000, 0, 0], 'A', 1, 'SP', '');
  assert.match(bom(doc)[0].description, /A106 GR\. B/);
  assert.match(bom(doc)[0].description, /XS/);
});

test('annotation collision adjustments keep dimension labels within the model viewport', () => {
  const doc = newIso();
  let start: string | null = null;
  for (let i = 0; i < 12; i++) start = appendRun(doc, start, [100, 0, 0], 'CS40', 2, 'SP', '').id;
  const drawing = createDrawing(doc);
  for (const p of drawing.primitives)
    if (p.type === 'text' && p.owner && ['DIM', 'TEXT', 'WELD'].includes(p.layer)) {
      assert.ok(p.p[0] >= drawing.area[0]);
      assert.ok(p.p[0] + p.text.length * p.size * .62 <= drawing.area[2] + 1e-8);
      assert.ok(p.p[1] >= 150 && p.p[1] <= 625);
    }
});

test('DXF keeps multiline text and literal braces without breaking group-code pairs', () => {
  const doc = newIso(); doc.customer = 'Client {A}\nProject B';
  const dxf = isometricDxf(doc), lines = dxf.trimEnd().split('\n');
  assert.equal(lines.length % 2, 0);
  for (let i = 0; i < lines.length; i += 2) assert.match(lines[i], /^\d+$/);
  assert.ok(dxf.includes('Client \\{A\\}\\PProject B'));
  assert.deepEqual(readIsometric(dxf), doc);
});

test('PCF files open through the same reader used by the home screen', () => {
  const doc = newIso(); appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  const restored = readIsometric(exportPcf(doc));
  assert.equal(restored.runs.length, 1);
  assert.equal(runResult(restored, restored.runs[0]).cut, 1000);
});
