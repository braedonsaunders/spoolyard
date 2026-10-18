import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, attachComponent, getNode, insertComponent, newIso, type IsoDocument } from '../src/core/model.ts';
import { createDrawing, drawingSheets, drawingSvg, type Drawing, type Primitive } from '../src/core/drawing.ts';
import { nodeItem } from '../src/core/joints.ts';
import { letteringShapes } from '../src/core/iso/declutter.ts';
import { overlaps, segmentPoly } from '../src/core/iso/placement.ts';
import { reducerGeometry, valveOperatorOf, operatorNamed } from '../src/core/iso/valve-conventions.ts';
import { templateSheet } from '../src/core/iso/template-sheet.ts';
import { DEFAULT_TEMPLATE } from '../src/core/sheet-template.ts';

type Text = Extract<Primitive, { type: 'text' }>;
const texts = (d: Drawing) => d.primitives.filter((p): p is Text => p.type === 'text');
/** Line pieces of a drawing's pipe and symbol linework, with their owners. */
const linework = (d: Drawing, layers = ['PIPE', 'SYMBOL']) => d.primitives.flatMap(p =>
  !layers.includes(p.layer) ? [] : p.type === 'line' ? [{ a: p.a, b: p.b, owner: p.owner }]
    : p.type === 'polyline' ? p.points.slice(1).map((q, i) => ({ a: p.points[i], b: q, owner: p.owner })) : []);

/** An invented header with a screwed drain and a socket-weld vent off olets, each with its own line number. */
function ventAndDrain(): IsoDocument {
  const doc = newIso();
  doc.style = { layout: 'schematic', weldNumbers: false, lettering: 'cad' };
  const a = appendRun(doc, null, [1500, 0, 0], 'CS40', 4, 'S1', '100-P-9001-X');
  const b = appendRun(doc, a.id, [0, 2000, 0], 'CS40', 4, 'S1', '100-P-9001-X');
  appendRun(doc, b.id, [800, 0, 0], 'CS40', 4, 'S1', '100-P-9001-X');
  const header = doc.runs[0];
  const tol = attachComponent(doc, header.id, 'olet', 0.35);
  applyComponent(doc, tol, 'TOL');
  const drain = appendRun(doc, tol.id, [0, 0, -350], 'CS40', 0.5, 'S1', '15-D-9002-X', 'THD');
  applyComponent(doc, insertComponent(doc, doc.runs.find(r => r.to === drain.id)!.id, 'valve', 0.6), 'GATE-SC');
  applyComponent(doc, drain, 'SC-CAP');
  const sol = attachComponent(doc, header.id, 'olet', 0.7);
  applyComponent(doc, sol, 'SOL');
  const vent = appendRun(doc, sol.id, [0, 0, 450], 'CS40', 0.5, 'S1', '15-V-9003-X', 'SW');
  applyComponent(doc, insertComponent(doc, doc.runs.find(r => r.to === vent.id)!.id, 'valve', 0.5), 'GATE-SW');
  applyComponent(doc, vent, 'SW-CAP');
  return doc;
}

test('a drawing whose material list has a sheet of its own is fitted to the whole frame, centred, clear of its heading', () => {
  const doc = ventAndDrain();
  doc.style = { layout: 'schematic', weldNumbers: false, lettering: 'cad', materialList: 'separate' };
  assert.deepEqual(drawingSheets(doc, 'S1'), ['drawing', 'materials']);
  const d = createDrawing(doc, 'S1', 'iso', undefined, { sheet: 'drawing' });
  const [x0, , x1] = d.area, nodes = [...d.positions.values()];
  const middle = (Math.min(...nodes.map(p => p[0])) + Math.max(...nodes.map(p => p[0]))) / 2;
  // Centred on the frame (to within a lattice step), not in the strip beside the heading.
  assert.ok(Math.abs(middle - (x0 + x1) / 2) <= (d.lattice?.cell ?? 0) + 1, `${middle} in ${x0}..${x1}`);
  // The heading and the note where the list would be keep their room: no pipe or symbol runs into them.
  const heading = texts(d).filter(t => t.field === 'doc.title' || t.field === 'materials.continued').flatMap(t => letteringShapes(t, 2));
  for (const s of linework(d)) for (const h of heading) assert.ok(!overlaps(segmentPoly(s.a, s.b, 0.5), h));
});

test('concentric and eccentric reducers taper by the same ratio of their size classes', () => {
  for (const [big, small] of [[4, 3], [3, 2], [4, 2], [4, 1]]) {
    const doc = newIso();
    const a = appendRun(doc, null, [1000, 0, 0], 'CS40', big, 'S1', 'L1');
    appendRun(doc, a.id, [1000, 0, 0], 'CS40', small, 'S1', 'L1');
    applyComponent(doc, a, 'C-RED');
    const g = reducerGeometry(doc, a);
    const concentric = g.smallRadius / g.largeRadius, eccentric = g.flatSmall / g.flatLarge;
    assert.ok(Math.abs(concentric - eccentric) < 1e-9, `${big}x${small}: ${concentric} vs ${eccentric}`);
    assert.ok(concentric >= 0.55 - 1e-9 && concentric <= 0.7 + 1e-9, `${big}x${small}: ${concentric}`);
  }
  // A 3x2 block is drawn two-thirds as high at its small end.
  const doc = newIso(), a = appendRun(doc, null, [1000, 0, 0], 'CS40', 3, 'S1', 'L1');
  appendRun(doc, a.id, [1000, 0, 0], 'CS40', 2, 'S1', 'L1');
  applyComponent(doc, a, 'C-RED');
  const g = reducerGeometry(doc, a);
  assert.ok(Math.abs(g.smallRadius / g.largeRadius - 2 / 3) < 1e-9);
});

test('a lug butterfly valve is its short body on the pipe centreline, its open disc outlined, its operator as its row names it', () => {
  const doc = newIso();
  doc.style = { layout: 'schematic', weldNumbers: false, lettering: 'cad' };
  const a = appendRun(doc, null, [1500, 0, 0], 'CS40', 4, 'S1', 'L1');
  const valve = appendRun(doc, a.id, [600, 0, 0], 'CS40', 4, 'S1', 'L1');
  appendRun(doc, valve.id, [1500, 0, 0], 'CS40', 4, 'S1', 'L1');
  applyComponent(doc, valve, 'BFLY-LUG');
  const item = nodeItem(doc, valve) as { description?: string } | undefined;
  if (item) item.description = 'BUTTERFLY VALVE, LUG TYPE, INVENTED ROW, LEVER';
  assert.ok(item, 'the specification has a lug butterfly row');
  assert.equal(valveOperatorOf(doc, valve), 'lever');
  const d = createDrawing(doc, 'S1'), at = d.positions.get(valve.id)!, own = d.primitives.filter(p => p.owner === valve.id && p.layer === 'SYMBOL');
  // No filled disc floating between the faces.
  assert.ok(!own.some(p => p.type === 'polyline' && p.fill));
  assert.ok(own.some(p => p.type === 'polyline' && p.closed && !p.fill && p.points.length === 24));
  // The body carries the centreline from face to face through the valve.
  const centreline = own.find((p): p is Extract<Primitive, { type: 'line' }> => p.type === 'line' &&
    Math.hypot((p.a[0] + p.b[0]) / 2 - at[0], (p.a[1] + p.b[1]) / 2 - at[1]) < 1e-6 && Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) > 1);
  assert.ok(centreline);
  // Its faces stand across the pipe at the ends of the centreline: a short wafer body, closer than it is tall.
  const lines = own.filter((p): p is Extract<Primitive, { type: 'line' }> => p.type === 'line')
  const mid = (p: Extract<Primitive, { type: 'line' }>) => [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2]
  const faces = [centreline!.a, centreline!.b].map(end => lines.find(p => p !== centreline && Math.hypot(mid(p)[0] - end[0], mid(p)[1] - end[1]) < 1e-6))
  assert.ok(faces[0] && faces[1]);
  const gap = Math.hypot(centreline!.b[0] - centreline!.a[0], centreline!.b[1] - centreline!.a[1]), tall = Math.hypot(faces[0]!.b[0] - faces[0]!.a[0], faces[0]!.b[1] - faces[0]!.a[1])
  assert.ok(gap < tall, `${gap} apart, ${tall} tall`);
  // The drafter's operator wins; a row's named operator is read; a check valve has none.
  valve.valveOperator = 'handwheel';
  assert.equal(valveOperatorOf(doc, valve), 'handwheel');
  assert.equal(operatorNamed('GATE VALVE, GEAR OPERATED'), 'handwheel');
  assert.equal(operatorNamed('BALL VALVE, PNEUMATIC ACTUATOR, FAIL CLOSED'), 'actuator');
  assert.equal(operatorNamed('BALL VALVE, FULL PORT'), undefined);
  applyComponent(doc, valve, 'CHECK-FL');
  delete valve.valveOperator;
  assert.equal(valveOperatorOf(doc, valve), 'none');
});

test('line numbers are not struck through by another item\'s symbols: placed clear along the line, or called out', () => {
  const doc = ventAndDrain(), d = createDrawing(doc, 'S1');
  const lines = texts(d).filter(t => /^1\d+-[PDV]-9\d+-X$/.test(t.text));
  assert.equal(new Set(lines.map(t => t.text)).size, 3);
  const ink = linework(d, ['SYMBOL']);
  for (const t of lines) for (const shape of letteringShapes(t))
    for (const s of ink) assert.ok(!overlaps(segmentPoly(s.a, s.b, 0.3), shape), `${t.text} struck by ${getNode(doc, s.owner!)?.component ?? s.owner}`);
});

test('a title-block material list continued in further blocks reads left to right', () => {
  const doc = newIso();
  doc.sheetFormat = 'production';
  const rows = Array.from({ length: 90 }, (_, i) => ({ id: i + 1, qtyText: '1', nd: '4"', description: `INVENTED ITEM ${i + 1}, PIPE, SMLS, BE` }));
  const sheet = templateSheet({ doc, spool: 'S1', width: 1314, height: 850, rows }, DEFAULT_TEMPLATE);
  const ids = sheet.primitives.filter((p): p is Text => p.type === 'text' && /^bom\.\d+\.id$/.test(p.field ?? '')).map(p => ({ id: Number(p.text), x: p.p[0], y: p.p[1] }));
  assert.equal(ids.length, 90);
  const columns = [...new Set(ids.map(i => Math.round(i.x)))].sort((a, b) => a - b);
  assert.ok(columns.length > 1);
  // Every block's items follow the block to its left, top to bottom.
  const ordered = columns.flatMap(x => ids.filter(i => Math.round(i.x) === x).sort((a, b) => a.y - b.y).map(i => i.id));
  assert.deepEqual(ordered, rows.map(r => r.id));
});

test('an exported SVG sheet has its paper\'s printed size; the editor\'s canvas keeps only its view box', () => {
  for (const [paper, w, h] of [['tabloid', 431.8, 279.4], ['a3', 420, 297], ['letter', 279.4, 215.9]] as const) {
    const doc = ventAndDrain();
    doc.paper = paper;
    const d = createDrawing(doc, 'S1'), svg = drawingSvg(d);
    const m = /^<svg[^>]* width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 (\d+) 850"/.exec(svg);
    assert.ok(m, svg.slice(0, 200));
    assert.ok(Math.abs(Number(m[1]) - w) < 0.2 && Math.abs(Number(m[2]) - h) < 0.01, `${paper}: ${m[1]} x ${m[2]}`);
    assert.doesNotMatch(drawingSvg(d, '', true).slice(0, 200), /width="[\d.]+mm"/);
  }
});
