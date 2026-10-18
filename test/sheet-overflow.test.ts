import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDrawing, drawingSheets, drawingSvg, type Drawing, type Primitive } from '../src/core/drawing';
import { packageSheets, packageDxf } from '../src/core/document';
import { appendRun, applyComponent, attachComponent, clone, insertComponent, newIso, parseIsoJson, type IsoDocument } from '../src/core/model';
import { forgetEarlierDrawings } from '../src/core/iso/render';
import { letteringShapes } from '../src/core/iso/declutter';
import { bbox, BoxIndex, overlaps, type Poly } from '../src/core/iso/placement';
import { countSearch, leanSearch, LEAN_AFTER } from '../src/core/iso/context';
import { budget } from './perf-budget';

type Text = Extract<Primitive, { type: 'text' }>;

/**
 * An invented spool: a header with a branch off every tee (a riser with a flanged valve, a level run, a drop or a
 * rolling offset), olets and supports along it, tagged valves. Larger ones crowd a tabloid sheet past clearing.
 */
function job(target: number, spool = (_: number) => 'S0'): IsoDocument {
  const doc = newIso();
  doc.style = { layout: 'schematic', weldNumbers: true, lettering: 'cad' };
  let at = appendRun(doc, null, [1500, 0, 0], 'CS40', 4, spool(0), 'L-1');
  for (let i = 0; doc.runs.length < target; i++) {
    const s = spool(doc.runs.length), tee = at;
    at = appendRun(doc, tee.id, [1200 + (i % 3) * 300, 0, 0], 'CS40', 4, s, 'L-1');
    const header = doc.runs.at(-1)!;
    const up = appendRun(doc, tee.id, [0, 0, 900 + (i % 4) * 200], 'CS40', 2, s, 'L-1');
    const over = appendRun(doc, up.id, [0, (i % 2 ? 1 : -1) * (800 + (i % 5) * 150), 0], 'CS40', 2, s, 'L-1');
    const valve = insertComponent(doc, doc.runs.at(-1)!.id, 'valve', 0.4);
    applyComponent(doc, valve, i % 2 ? 'GATE-FL' : 'BALL-FL');
    valve.tag = `HV-${100 + i}`;
    if (i % 3 === 0) applyComponent(doc, insertComponent(doc, doc.runs.find(r => r.to === up.id)!.id, 'flange', 0.5), 'FLG-RFWN');
    appendRun(doc, over.id, i % 3 ? [0, 0, -600] : [400, 400, 0], 'CS40', 2, s, 'L-1');
    if (i % 4 === 1) attachComponent(doc, header.id, 'support', 0.5).tag = `PS-${i}`;
    if (i % 5 === 2) applyComponent(doc, attachComponent(doc, header.id, 'olet', 0.3), 'WOL');
  }
  return doc;
}
const sample = () => parseIsoJson(readFileSync(new URL('../public/samples/cooling-water-return.piping', import.meta.url), 'utf8'));
const texts = (d: Drawing) => d.primitives.filter((p): p is Text => p.type === 'text');
const has = (d: Drawing, pattern: RegExp) => texts(d).some(t => pattern.test(t.text));
/** Pairs of lines of lettering on a sheet that overlap by more than a hair (lettering that only touches is fine). */
function overprints(d: Drawing): Array<[string, string]> {
  const index = new BoxIndex<{ poly: Poly; box: [number, number, number, number]; i: number; text: string }>();
  const shrink = (poly: Poly): Poly => { const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]); return poly.map(p => { const v = [p[0] - c[0], p[1] - c[1]], l = Math.hypot(v[0], v[1]) || 1; return [p[0] - v[0] / l * 0.25, p[1] - v[1] / l * 0.25] as [number, number] }) };
  texts(d).forEach((t, i) => { for (const s of letteringShapes(t)) { const poly = shrink(s); index.add({ poly, box: bbox(poly), i, text: t.text }) } });
  const found: Array<[string, string]> = [];
  for (const a of index.items) for (const b of index.near(a.box)) if (b.i > a.i && overlaps(a.poly, b.poly)) found.push([a.text, b.text]);
  return found;
}
const ink = (d: Drawing) => JSON.stringify([d.primitives, d.labels, d.fit, [...d.positions], d.notices ?? null, d.sheet ?? null]);

test('a material list that would crowd its drawing moves to a sheet of its own, numbered with the title block', () => {
  const doc = job(18);
  assert.deepEqual(drawingSheets(doc, 'S0'), ['drawing', 'materials']);
  const drawing = createDrawing(doc, 'S0'), list = createDrawing(doc, 'S0', 'iso', undefined, { sheet: 'materials' });
  // The drawing sheet notes where its list is; the list sheet carries the whole list and no model.
  assert.ok(has(drawing, /^MATERIAL LIST CONTINUED ON SHEET 2$/));
  assert.ok(!drawing.primitives.some(p => p.layer === 'BOM' && p.type === 'text' && p.field?.startsWith('bom.')));
  assert.ok(has(drawing, /SHEET 1 OF 2$/) && has(list, /SHEET 2 OF 2$/));
  assert.deepEqual(drawing.sheet, { kind: 'drawing', index: 0, count: 2, number: 1, of: 2 });
  assert.deepEqual(list.sheet, { kind: 'materials', index: 1, count: 2, number: 2, of: 2 });
  const rows = new Set(texts(list).flatMap(t => /^bom\.(\d+)\.id$/.exec(t.field ?? '')?.[1] ?? []));
  assert.ok(rows.size > 10, 'every row of the list is on its sheet');
  assert.ok(!list.primitives.some(p => p.layer === 'PIPE') && !list.labels?.length && list.positions.size === 0);
  // Kept on the drawing sheet, the same drawing is drawn at half the size.
  doc.style = { ...doc.style!, materialList: 'onSheet' };
  assert.deepEqual(drawingSheets(doc, 'S0'), ['drawing']);
  const crowded = createDrawing(doc, 'S0');
  assert.ok(drawing.fit.scale > crowded.fit.scale * 1.5, `${drawing.fit.scale} against ${crowded.fit.scale}`);
  assert.ok(!has(crowded, /CONTINUED ON SHEET/) && !has(crowded, /SHEET \d+ OF/));
  // 'separate' gives every list its own sheet; a sheet that is not crowded keeps its list by default.
  const plain = sample();
  assert.deepEqual(drawingSheets(plain), ['drawing']);
  plain.style = { ...plain.style!, materialList: 'separate' };
  assert.deepEqual(drawingSheets(plain), ['drawing', 'materials']);
  assert.throws(() => parseIsoJson(JSON.stringify({ ...plain, style: { ...plain.style, materialList: 'sometimes' } })), /style/);
});

test('packages issue the material sheet after its drawing, and template sheets number the whole set', () => {
  // Two spools; the first crowded with its list, the second not.
  const doc = job(26, n => n < 20 ? 'A' : 'B');
  assert.deepEqual(drawingSheets(doc, 'A'), ['drawing', 'materials']);
  assert.deepEqual(drawingSheets(doc, 'B'), ['drawing']);
  assert.deepEqual(packageSheets(doc), [{ spool: 'A', view: 'iso' }, { spool: 'A', view: 'iso', sheet: 'materials' }, { spool: 'B', view: 'iso' }]);
  assert.deepEqual(packageDxf(doc).map(f => f.name), ['ISO-001-A.dxf', 'ISO-001-A-materials.dxf', 'ISO-001-B.dxf']);
  doc.sheetFormat = 'production';
  doc.style = { ...doc.style!, materialList: 'separate' };
  const sheetOf = (d: Drawing) => texts(d).find(t => t.field === 'sheet.of')?.text;
  assert.equal(sheetOf(createDrawing(doc, 'A')), '1 OF 4');
  assert.equal(sheetOf(createDrawing(doc, 'A', 'iso', undefined, { sheet: 'materials' })), '2 OF 4');
  assert.equal(sheetOf(createDrawing(doc, 'B')), '3 OF 4');
  const listB = createDrawing(doc, 'B', 'iso', undefined, { sheet: 'materials' });
  assert.equal(sheetOf(listB), '4 OF 4');
  assert.ok(has(createDrawing(doc, 'B'), /^MATERIAL LIST CONTINUED ON SHEET 4$/));
  assert.ok(texts(listB).some(t => t.field === 'bom.1.description'));
  assert.ok(drawingSvg(listB).includes('<svg'));
  // One sheet a spool, numbered by spool as before, while no list has a sheet of its own.
  doc.style = { ...doc.style!, materialList: 'onSheet' };
  assert.equal(sheetOf(createDrawing(doc, 'B')), '2 OF 2');
});

test('no issued sheet overprints its lettering: what cannot be placed clear goes to the margin, or is reported', () => {
  for (const pipes of [30, 60]) {
    const doc = job(pipes);
    doc.style = { ...doc.style!, materialList: 'onSheet' };
    const d = createDrawing(doc, 'S0');
    assert.deepEqual(overprints(d), [], `${pipes} pipes`);
    const kinds = (d.notices ?? []).map(n => n.kind);
    assert.ok(kinds.includes('margin-callouts'), `${pipes} pipes: ${kinds}`);
    // A label moved to the margin keeps a leader to its item, and is marked as drawn away from where it would be.
    const moved = d.labels!.filter(l => l.displaced && l.leader);
    assert.ok(moved.length > 0);
    // (Drawn in pieces where it crosses pipe or lettering.)
    const onLeader = (q: [number, number], { from, to }: { from: [number, number]; to: [number, number] }) => {
      const v = [to[0] - from[0], to[1] - from[1]], l = Math.hypot(v[0], v[1]);
      return Math.abs((q[0] - from[0]) * v[1] - (q[1] - from[1]) * v[0]) / l < 1e-6;
    };
    for (const l of moved) assert.ok(d.primitives.some(p => p.type === 'line' && p.layer === 'LEADER' && onLeader(p.a, l.leader!) && onLeader(p.b, l.leader!)), l.key);
  }
  // A sheet with room is drawn as it always was.
  const plain = createDrawing(sample());
  assert.ok(!(plain.notices ?? []).some(n => n.kind === 'margin-callouts' || n.kind === 'labels-omitted'));
  assert.deepEqual(overprints(plain), []);
});

test('label search on a hopeless sheet is bounded by what searches found, so it is the same however it was reached', () => {
  // The lean search starts only when most searches have found no clear spot, past a count; never by time.
  const effort = { searches: 0, failed: 0 };
  for (let i = 0; i < LEAN_AFTER - 1; i++) countSearch({ effort }, false);
  assert.equal(leanSearch({ effort }), false);
  countSearch({ effort }, false);
  assert.equal(leanSearch({ effort }), true);
  for (let i = 0; i < LEAN_AFTER + 2; i++) countSearch({ effort }, true);
  assert.equal(leanSearch({ effort }), false, 'not while most searches find room');
  // Drawn after other drawings (using what they found) or from nothing, after edits, a crowded sheet is the same.
  const doc = job(100);
  createDrawing(doc, 'S0');
  for (const k of [0, 1]) {
    const next = clone(doc), r = next.runs[Math.floor(next.runs.length / 3)], end = next.nodes.find(n => n.id === r.to)!;
    end.position = [end.position[0], end.position[1], end.position[2] + 10 + k * 20];
    const t = performance.now(), warm = createDrawing(next, 'S0'), ms = performance.now() - t;
    forgetEarlierDrawings();
    const cold = createDrawing(clone(next), 'S0');
    assert.equal(ink(warm), ink(cold), `edit ${k}`);
    assert.equal(ink(createDrawing(next, 'S0')), ink(cold), `edit ${k}, again`);
    assert.deepEqual(overprints(warm), []);
    // Generous: catches a search that stopped being bounded, not a slow machine.
    assert.ok(ms < budget(2000), `${ms.toFixed(0)} ms`);
  }
});
