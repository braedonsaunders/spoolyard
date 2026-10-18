import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawing, type Point } from '../src/core/drawing';
import { appendRun, clone, insertComponent, newIso, type IsoDocument } from '../src/core/model';
import { nearestLatticePoint, paperCell, paperLines } from '../src/core/iso/lattice';
import { materialGridMask } from '../src/editor/editing-grid';

const sheet = () => {
  const doc = newIso();
  doc.style = { layout: 'schematic', weldNumbers: false, lettering: 'cad' };
  const a = appendRun(doc, null, [1830, 0, 0], 'CS40', 2, 'S1', 'DEMO');
  const b = appendRun(doc, a.id, [0, 1270, 0], 'CS40', 2, 'S1', 'DEMO');
  appendRun(doc, b.id, [0, 0, 760], 'CS40', 2, 'S1', 'DEMO');
  appendRun(doc, a.id, [0, 0, -410], 'CS40', 2, 'S1', 'DEMO');
  insertComponent(doc, doc.runs[0].id, 'valve', 0.4);
  return doc;
};
const onLattice = (p: Point, cell: number) => { const q = nearestLatticePoint(p, cell); return Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6; };
/** Ends of pipe where the leg turns, branches or stops. */
const joints = (doc: IsoDocument) => doc.nodes.filter(n => {
  const edges = doc.runs.filter(r => r.from === n.id || r.to === n.id);
  if (edges.length !== 2) return !n.associatedRunId;
  const d = edges.map(r => { const o = doc.nodes.find(x => x.id === (r.from === n.id ? r.to : r.from))!; return o.position.map((v, i) => Math.sign(Math.round(v - n.position[i]))).join(); });
  return d[0] !== d.map(s => s.split(',').map(v => -Number(v)).join())[1];
});

test('not to scale, every change of direction, branch and end of pipe is on the isometric paper lattice', () => {
  const doc = sheet(), drawing = createDrawing(doc, 'S1'), cell = paperCell(doc);
  for (const n of joints(doc)) assert.ok(onLattice(drawing.positions.get(n.id)!, cell), `${n.kind} is on the lattice`);
  for (const r of doc.runs) {
    const a = drawing.positions.get(r.from)!, b = drawing.positions.get(r.to)!;
    const angle = ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) % 60 + 60) % 60;
    assert.ok(Math.min(angle % 30, 30 - angle % 30) < 1e-6, 'each pipe runs along a lattice direction');
  }
  const { lines } = paperLines({ kind: 'iso', cell }, drawing.area);
  assert.ok(lines.length > 0);
  const mask = materialGridMask(drawing)!;
  assert.ok(mask[2] > mask[0] && mask[3] > mask[1]);
});

test('the lattice belongs to the paper, not to plant coordinates', () => {
  const doc = sheet(), moved = clone(doc);
  for (const n of moved.nodes) n.position = [n.position[0] + 123456.7, n.position[1] - 98765.4, n.position[2] + 4321.1];
  assert.deepEqual([...createDrawing(moved, 'S1').positions], [...createDrawing(doc, 'S1').positions]);
});

test('a held paper position is drafted onto the lattice too, and a finer paper cell keeps finer proportions', () => {
  const doc = sheet(), free = createDrawing(doc, 'S1'), end = doc.runs[1].to, p = free.positions.get(end)!;
  doc.sheets = { S1: { nodePositions: { [end]: [p[0] + 7.3, p[1] - 2.1] } } };
  const held = createDrawing(doc, 'S1');
  assert.ok(onLattice(held.positions.get(end)!, paperCell(doc)));
  const fine = { ...doc, style: { ...doc.style!, paperGrid: 0.1 } };
  assert.ok(paperCell(fine) < paperCell(doc));
  for (const n of joints(fine)) assert.ok(onLattice(createDrawing(fine, 'S1').positions.get(n.id)!, paperCell(fine)));
});
