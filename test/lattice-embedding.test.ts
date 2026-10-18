import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawing, type Drawing, type Point } from '../src/core/drawing';
import { appendRun, attachComponent, insertComponent, newIso, parseIsoJson, type IsoDocument, type Vec3 } from '../src/core/model';
import { latticeDirections, nearestPaperPoint, onPaperLattice, paperCell, paperLines } from '../src/core/iso/lattice';
import { northOnPage, projectionNorth, viewDirection, viewProject } from '../src/core/iso/layout';
import { gridAnchor } from '../src/core/grid';

const schematic = () => {
  const doc = newIso();
  doc.style = { layout: 'schematic', weldNumbers: false, lettering: 'cad' };
  return doc;
};
const run = (doc: IsoDocument, from: string | null, d: Vec3, spool = 'S1') => appendRun(doc, from, d, 'CS40', 2, spool, 'L-1');
const sub = (a: Point, b: Point): Point => [b[0] - a[0], b[1] - a[1]];
const cross = (u: Point, v: Point) => u[0] * v[1] - u[1] * v[0];
const unit = (v: Point): Point => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l]; };
const straight = (doc: IsoDocument, from: string, to: string) => {
  const a = doc.nodes.find(n => n.id === from)!.position, b = doc.nodes.find(n => n.id === to)!.position;
  return a.filter((v, i) => Math.abs(v - b[i]) > 0.01).length === 1;
};
/** Nodes where a leg turns, branches, ends or leaves its header. */
const joints = (doc: IsoDocument, spool?: string) => doc.nodes.filter(n => {
  const edges = doc.runs.filter(r => (!spool || r.spool === spool) && (r.from === n.id || r.to === n.id));
  if (!edges.length) return false;
  if (n.associatedRunId || edges.length !== 2) return true;
  const away = edges.map(r => { const o = doc.nodes.find(x => x.id === (r.from === n.id ? r.to : r.from))!; return o.position.map((v, i) => v - n.position[i]); });
  const dot = away[0].reduce((s, v, i) => s + v * away[1][i], 0) / (Math.hypot(...away[0]) * Math.hypot(...away[1]));
  return dot > -0.999999;
});
/** Every joint on the drawing's lattice, every straight pipe along a lattice line, and no two pipes on one another. */
function onPaper(doc: IsoDocument, d: Drawing, spool?: string) {
  const lattice = d.lattice!;
  assert.ok(lattice, 'drafted on a lattice');
  for (const n of joints(doc, spool)) assert.ok(onPaperLattice(d.positions.get(n.id)!, lattice), `${n.kind} on the lattice`);
  const lines = latticeDirections(lattice), segments: Array<{ id: string; a: Point; b: Point }> = [];
  for (const r of doc.runs.filter(r => !spool || r.spool === spool)) {
    const a = d.positions.get(r.from)!, b = d.positions.get(r.to)!, v = sub(a, b);
    if (Math.hypot(...v) < 1e-9) continue;
    if (straight(doc, r.from, r.to)) assert.ok(lines.some(l => Math.abs(cross(unit(v), l)) < 1e-9), 'a straight pipe runs along a lattice line');
    segments.push({ id: r.id, a, b });
  }
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const s = segments[i], t = segments[j], u = unit(sub(s.a, s.b)), v = unit(sub(t.a, t.b));
    if (Math.abs(cross(u, v)) > 1e-9 || Math.abs(cross(u, sub(s.a, t.a))) > 1e-6) continue;
    const along = (p: Point) => (p[0] - s.a[0]) * u[0] + (p[1] - s.a[1]) * u[1], l = Math.hypot(...sub(s.a, s.b));
    const lo = Math.max(0, Math.min(along(t.a), along(t.b))), hi = Math.min(l, Math.max(along(t.a), along(t.b)));
    assert.ok(hi - lo < 1e-6, 'two pipes lie on one another');
  }
}

test('a bypass loop closes on the lattice with its valves wherever they sit along each leg', () => {
  const doc = schematic();
  const a = run(doc, null, [400, 0, 0]);
  const b = run(doc, a.id, [3000, 0, 0]);
  run(doc, b.id, [400, 0, 0]);
  insertComponent(doc, doc.runs[1].id, 'valve', 0.3);
  // The bypass: up, along with its own valve further along, and back down onto the header.
  const up = run(doc, a.id, [0, 0, 700]);
  const over = run(doc, up.id, [3000, 0, 0]);
  appendRun(doc, over.id, [0, 0, -700], 'CS40', 2, 'S1', 'L-1');
  insertComponent(doc, doc.runs.find(r => r.from === up.id)!.id, 'valve', 0.75);
  const d = createDrawing(doc, 'S1');
  onPaper(doc, d);
  // The loop's legs are parallel pairs: the header and the bypass on separate lines, risers one apart.
  const p = (id: string) => d.positions.get(id)!;
  assert.ok(Math.abs(cross(unit(sub(p(a.id), p(b.id))), sub(p(a.id), p(up.id)))) > 1, 'header and bypass are distinct lines');
  // Each valve keeps its place along its leg, in proportion.
  const valves = doc.nodes.filter(n => n.kind === 'valve');
  const t = (id: string, from: string, to: string) => Math.hypot(...sub(p(from), p(id))) / Math.hypot(...sub(p(from), p(to)));
  assert.ok(t(valves[0].id, a.id, b.id) < 0.5 && t(valves[1].id, up.id, over.id) > 0.5);
});

test('close parallel legs never merge onto one line, and the drawing does not depend on its identifiers', () => {
  const doc = schematic();
  const a = run(doc, null, [2000, 0, 0]);
  const b = run(doc, a.id, [0, 60, 0]);
  run(doc, b.id, [-2000, 0, 0]);
  const c = run(doc, a.id, [0, 0, 40]);
  run(doc, c.id, [-1500, 0, 0]);
  const d = createDrawing(doc, 'S1');
  onPaper(doc, d);
  const renamed = parseIsoJson(JSON.stringify(doc).replaceAll(/"([0-9a-f]{8})-/g, '"z$1-'));
  assert.deepEqual([...createDrawing(renamed, 'S1').positions.values()], [...d.positions.values()]);
});

test('several spools on one sheet and each on its own are drafted on the lattice', () => {
  const doc = schematic();
  const a = run(doc, null, [1500, 0, 0], 'S1');
  run(doc, a.id, [0, 1200, 0], 'S1');
  const b = run(doc, a.id, [0, 0, 900], 'S2');
  run(doc, b.id, [1000, 0, 0], 'S2');
  // A separate part of the network on the second spool.
  const far = run(doc, null, [0, -800, 0], 'S2');
  run(doc, far.id, [0, 0, -500], 'S2');
  for (const spool of ['S1', 'S2']) onPaper(doc, createDrawing(doc, spool), spool);
  onPaper(doc, createDrawing(doc, ''));
});

test('north turns the drawing in quarter turns only; any other angle turns just the north symbol', () => {
  const doc = schematic();
  const a = run(doc, null, [1500, 0, 0]);
  const b = run(doc, a.id, [0, 1000, 0]);
  run(doc, b.id, [0, 0, 800]);
  const direction = (d: Drawing) => unit(sub(d.positions.get(doc.runs[0].from)!, d.positions.get(a.id)!));
  for (const north of [90, 180, 270]) {
    doc.north = north;
    const d = createDrawing(doc, 'S1');
    onPaper(doc, d);
    const east = unit(viewProject([1, 0, 0], 'iso', north));
    assert.ok(Math.abs(cross(direction(d), east)) < 1e-9 && direction(d)[0] * east[0] + direction(d)[1] * east[1] > 0, `${north}°: east as turned`);
  }
  doc.north = 0;
  const square = createDrawing(doc, 'S1');
  doc.north = 37;
  assert.equal(projectionNorth(37), 0);
  assert.deepEqual([...createDrawing(doc, 'S1').positions], [...square.positions], 'an odd angle leaves the projection square');
  const symbol = unit(northOnPage('iso', 37)), plain = unit(viewProject([0, 1, 0], 'iso', 37));
  assert.ok(Math.abs(cross(symbol, plain)) > 0.1, 'the north symbol turns by the whole angle');
  assert.ok(Math.abs(cross(unit(northOnPage('iso', 90)), unit(viewProject([0, 1, 0], 'iso', 90)))) < 1e-12, 'a quarter turn turns both alike');
  // The sheet's north symbol points to plant north at the whole angle, on the classic sheet and on a template's.
  const along = (a: Point, b: Point, want: Point) => { const u = unit(sub(a, b)); return Math.abs(cross(u, want)) < 1e-9 && u[0] * want[0] + u[1] * want[1] > 0; };
  for (const view of ['iso', 'plan'] as const) {
    const want = unit(northOnPage(view, 37));
    doc.sheetFormat = 'classic';
    const arrow = createDrawing(doc, 'S1', view).primitives.filter(p => p.type === 'line' && p.layer === 'BORDER' && Math.abs(Math.hypot(...sub(p.a, p.b)) - 22) < 1e-6);
    assert.ok(arrow.length === 1 && arrow[0].type === 'line' && along(arrow[0].a, arrow[0].b, want), `${view}: the classic arrow points north`);
    doc.sheetFormat = 'production';
    const ticks = createDrawing(doc, 'S1', view).primitives.filter(p => p.type === 'line' && p.layer === 'TEXT');
    assert.ok(ticks.some(p => p.type === 'line' && along(p.a, p.b, want)), `${view}: the template's north tick points north`);
  }
  doc.sheetFormat = 'classic';
});

test('a plan or elevation not to scale is drafted on square paper, and says which way it looks', () => {
  const doc = schematic();
  const a = run(doc, null, [1500, 0, 0]);
  const b = run(doc, a.id, [0, 1000, 0]);
  const c = run(doc, b.id, [0, 0, 800]);
  run(doc, c.id, [-700, 0, 0]);
  insertComponent(doc, doc.runs[0].id, 'valve', 0.5);
  for (const view of ['plan', 'front', 'side'] as const) {
    const d = createDrawing(doc, 'S1', view);
    assert.equal(d.lattice?.kind, 'square', view);
    for (const n of joints(doc)) assert.ok(onPaperLattice(d.positions.get(n.id)!, d.lattice!), `${view}: ${n.kind} on the square lattice`);
    for (const r of doc.runs) {
      const v = sub(d.positions.get(r.from)!, d.positions.get(r.to)!);
      assert.ok(Math.abs(v[0]) < 1e-9 || Math.abs(v[1]) < 1e-9, `${view}: pipes run across or up the page`);
    }
    const lines = paperLines(d.lattice!, d.area).lines;
    assert.ok(lines.length && lines.every(l => Math.abs(l.a[0] - l.b[0]) < 1e-9 || Math.abs(l.a[1] - l.b[1]) < 1e-9));
  }
  assert.equal(viewDirection('front', 0).note, 'FRONT VIEW LOOKING NORTH');
  assert.equal(viewDirection('front', 90).note, 'FRONT VIEW LOOKING EAST');
  assert.equal(viewDirection('side', 0).note, 'SIDE VIEW LOOKING WEST');
  assert.equal(viewDirection('plan', 180).note, 'PLAN VIEW, SOUTH UP');
  assert.equal(createDrawing(doc, 'S1', 'front').viewNote, 'FRONT VIEW LOOKING NORTH');
});

test('an olet on a short header sits on a lattice point between the header ends, its branch on the lattice', () => {
  const doc = schematic();
  const a = run(doc, null, [1500, 0, 0]);
  const b = run(doc, a.id, [250, 0, 0]);
  run(doc, b.id, [0, 1500, 0]);
  const olet = attachComponent(doc, doc.runs[1].id, 'olet', 0.5);
  run(doc, olet.id, [0, 0, 400]);
  const d = createDrawing(doc, 'S1');
  onPaper(doc, d);
  const p = (id: string) => d.positions.get(id)!, cell = d.lattice!.cell;
  const along = Math.hypot(...sub(p(a.id), p(olet.id))), header = Math.hypot(...sub(p(a.id), p(b.id)));
  assert.ok(Math.abs(cross(unit(sub(p(a.id), p(b.id))), sub(p(a.id), p(olet.id)))) < 1e-6, 'on its header');
  assert.ok(along >= cell - 1e-6 && header - along >= cell - 1e-6, 'clear of both ends by a cell');
});

test('parallel rolling offsets are drawn in one lattice direction, clearly off the lattice lines', () => {
  const doc = schematic();
  const a = run(doc, null, [1200, 0, 0]);
  const b = run(doc, a.id, [450, 450, 0]);
  const c = run(doc, b.id, [1500, 0, 0]);
  const e = run(doc, c.id, [900, 900, 0]);
  run(doc, e.id, [1200, 0, 0]);
  const d = createDrawing(doc, 'S1');
  onPaper(doc, d);
  const first = unit(sub(d.positions.get(a.id)!, d.positions.get(b.id)!)), second = unit(sub(d.positions.get(c.id)!, d.positions.get(e.id)!));
  assert.ok(Math.abs(cross(first, second)) < 1e-9 && first[0] * second[0] + first[1] * second[1] > 0, 'parallel offsets share a direction');
  for (const l of latticeDirections(d.lattice!)) assert.ok(Math.abs(cross(first, l)) > Math.sin(10 * Math.PI / 180) - 1e-9, 'leans off every lattice line');
  for (const id of [a.id, b.id, c.id, e.id]) assert.ok(onPaperLattice(d.positions.get(id)!, d.lattice!));
});

test('a held end that would fold its pipe back is drawn at the layout length and reported', () => {
  const doc = schematic();
  const a = run(doc, null, [1500, 0, 0]);
  run(doc, a.id, [0, 1000, 0]);
  const free = createDrawing(doc, 'S1'), start = doc.runs[0].from, s = free.positions.get(start)!, e = free.positions.get(a.id)!;
  // Held beyond its start, the wrong way along the pipe.
  doc.sheets = { S1: { nodePositions: { [start]: s, [a.id]: [s[0] - (e[0] - s[0]), s[1] - (e[1] - s[1])] } } };
  const d = createDrawing(doc, 'S1');
  assert.ok(d.notices?.some(n => n.kind === 'held-folded' && [start, a.id].includes(n.node!)));
  onPaper(doc, d);
});

test('model points project through an index: nodes where drawn, points on a pipe along it', () => {
  const doc = schematic();
  const a = run(doc, null, [2000, 0, 0]);
  run(doc, a.id, [0, 0, 1000]);
  const d = createDrawing(doc, 'S1'), p = (id: string) => d.positions.get(id)!;
  assert.deepEqual(d.project([2000, 0, 0]), p(a.id));
  const mid = d.project([500, 0.3, 0]), start = p(doc.runs[0].from);
  const t = Math.hypot(...sub(start, mid)) / Math.hypot(...sub(start, p(a.id)));
  assert.ok(Math.abs(t - 0.25) < 1e-9 && Math.abs(cross(unit(sub(start, p(a.id))), sub(start, mid))) < 1e-6, 'a quarter along the drawn pipe');
});

test('the model-space grid is anchored at the drafter origin, else the first connection', () => {
  const doc = schematic();
  assert.deepEqual(gridAnchor(doc), [0, 0, 0]);
  const a = run(doc, null, [1000, 0, 0]);
  doc.nodes.find(n => n.id === doc.runs[0].from)!.position = [5, 6, 7];
  assert.deepEqual(gridAnchor(doc), [5, 6, 7]);
  doc.grid = { visible: true, snap: true, spacing: 100, plane: 'xy', origin: [100, 200, 300] };
  assert.deepEqual(gridAnchor(doc), [100, 200, 300]);
  assert.deepEqual(parseIsoJson(JSON.stringify(doc)).grid?.origin, [100, 200, 300]);
  assert.throws(() => parseIsoJson(JSON.stringify({ ...doc, grid: { ...doc.grid, origin: [1, 2] } })), /grid/);
  assert.ok(a.id);
});

test('a drawing too large for the paper cells is drafted on a subdivision of them, held with its fit', () => {
  const doc = schematic();
  let at = run(doc, null, [500, 0, 0]);
  for (let i = 0; i < 40; i++) {
    const tee = at;
    at = run(doc, tee.id, [600, 0, 0]);
    const up = run(doc, tee.id, [0, 0, 400 + (i % 3) * 100]);
    run(doc, up.id, [0, i % 2 ? 500 : -500, 0]);
  }
  const d = createDrawing(doc, 'S1');
  const cell = d.lattice!.cell, paper = paperCell(doc);
  assert.ok(Math.abs(paper / cell - Math.round(paper / cell)) < 1e-9, 'a whole subdivision of the paper cell');
  onPaper(doc, d);
  const held = createDrawing(doc, 'S1', 'iso', d.fit);
  assert.equal(held.lattice!.cell, cell);
  for (const [id, p] of d.positions) assert.ok(Math.hypot(...sub(p, held.positions.get(id)!)) < 1e-6, 'held fit redraws the same sheet');
  assert.ok(Math.hypot(...nearestPaperPoint([cell * 0.2, 0], d.lattice!)) < 1e-9, 'the lattice starts at the sheet origin');
});
