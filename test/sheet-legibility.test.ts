import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDrawing, type Drawing, type Point, type Primitive } from '../src/core/drawing';
import { appendRun, applyComponent, getNode, insertComponent, newIso, parseIsoJson, setFlatSide, type IsoDocument, type Vec3 } from '../src/core/model';
import { sheetMaterials } from '../src/core/material-list';
import { namespaceSpec } from '../src/editor/library';
import { embedOnLattice, latticeDirections, onPaperLattice, paperLattice } from '../src/core/iso/lattice';
import { draftingSizes } from '../src/core/iso/context';
import { letterWidth } from '../src/core/iso/sheet-frame';

type Text = Extract<Primitive, { type: 'text' }>;
const IN = 25.4;
const sub = (a: Point, b: Point): Point => [b[0] - a[0], b[1] - a[1]];
const len = (v: Point) => Math.hypot(...v);
const cross = (u: Point, v: Point) => (u[0] * v[1] - u[1] * v[0]) / (len(u) * len(v));
const LEAN = Math.sin(10 * Math.PI / 180);

/** An imperial drawing on library specification A, its runs given in inches. */
function specA() {
  const doc = newIso();
  doc.units = 'imperial';
  doc.specs = [namespaceSpec(JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')), 'A')];
  const run = (from: string | null, d: number[], nps = 4) => appendRun(doc, from, d.map(v => v * IN) as Vec3, doc.specs[0].id, nps, 'SP-1', 'L-1');
  return { doc, run };
}
/** A straight leg's plant run is along one axis. */
const straight = (doc: IsoDocument, from: string, to: string) => {
  const a = getNode(doc, from).position, b = getNode(doc, to).position;
  return a.filter((v, i) => Math.abs(v - b[i]) > 0.5).length === 1;
};
/** Every joint on the lattice, every straight along a lattice line, and no two distinct pipe ends on one point. */
function onPaper(doc: IsoDocument, d: Drawing) {
  const lattice = d.lattice!, lines = latticeDirections(lattice);
  assert.ok(lattice, 'drafted on the lattice');
  const ends = new Map<string, Point>();
  for (const r of doc.runs) for (const id of [r.from, r.to]) ends.set(id, d.positions.get(id)!);
  for (const r of doc.runs) {
    const v = sub(d.positions.get(r.from)!, d.positions.get(r.to)!);
    if (len(v) < 1e-9) continue;
    if (straight(doc, r.from, r.to)) assert.ok(lines.some(l => Math.abs(cross(v, l)) < 1e-9), 'a straight runs along a lattice line');
  }
  // Turns, branches and ends; parts in line on a straight sit between them.
  const turns = [...ends.keys()].filter(id => {
    const edges = doc.runs.filter(r => r.from === id || r.to === id), here = getNode(doc, id).position
    if (edges.length !== 2) return true
    const [u, v] = edges.map(r => getNode(doc, r.from === id ? r.to : r.from).position.map((x, k) => x - here[k]))
    return u.reduce((sum, x, k) => sum + x * v[k], 0) / (Math.hypot(...u) * Math.hypot(...v)) > -0.9999
  });
  for (const id of turns) assert.ok(onPaperLattice(ends.get(id)!, lattice), `${getNode(doc, id).kind} on a lattice point`);
  const ids = [...ends.keys()];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = getNode(doc, ids[i]).position, b = getNode(doc, ids[j]).position;
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 7) continue;
    assert.ok(len(sub(ends.get(ids[i])!, ends.get(ids[j])!)) > 1e-6, `${getNode(doc, ids[i]).kind} and ${getNode(doc, ids[j]).kind} drawn on one point`);
  }
}
const drawn = (d: Drawing, r: { from: string; to: string }) => len(sub(d.positions.get(r.from)!, d.positions.get(r.to)!));

test('a three-axis rolling offset is drawn in proportion, small or large, leaning clear of the lattice lines', () => {
  for (const roll of [[6, 6, 6], [24, 12, 36], [120, 60, 90], [24, 43.2666, 36]]) {
    const { doc, run } = specA();
    let at = run(null, [120, 0, 0]);
    at = run(at.id, [0, 78, 0]);
    const offset = run(at.id, roll);
    at = run(offset.id, [0, 48, 0]);
    run(at.id, [48, 0, 0]);
    const d = createDrawing(doc, 'SP-1'), cell = d.lattice!.cell;
    onPaper(doc, d);
    assert.ok(!d.notices?.some(n => n.kind === 'crowded' || n.kind.startsWith('lattice-')), `${roll}: ${d.notices?.map(n => n.kind)}`);
    const rolled = doc.runs.find(r => r.to === offset.id)!, legs = doc.runs.filter(r => r !== rolled);
    const longest = Math.max(...legs.map(r => drawn(d, r)));
    // Never pushed out to many cells to clear the lattice lines, nor the other legs squeezed to a cell for it.
    assert.ok(drawn(d, rolled) <= 2 * longest, `${roll}: roll ${drawn(d, rolled).toFixed(0)} against ${longest.toFixed(0)}`);
    for (const r of legs) assert.ok(drawn(d, r) >= 2 * cell - 1e-6, `${roll}: a leg drawn ${drawn(d, r).toFixed(1)}`);
    const v = sub(d.positions.get(rolled.from)!, d.positions.get(rolled.to)!);
    for (const l of latticeDirections(d.lattice!)) assert.ok(Math.abs(cross(v, l)) >= LEAN - 1e-9, `${roll}: leans off every lattice line`);
  }
});

test('the reported rolling-offset sheet keeps its legs, branch and size change apart on the lattice', () => {
  const { doc, run } = specA();
  let at = run(null, [120, 0, 0]);
  at = run(at.id, [0, 78, 0]);
  const valve = insertComponent(doc, doc.runs.at(-1)!.id, 'valve', 0.52);
  applyComponent(doc, valve, 'GATE-FL');
  at = run(at.id, [24, 43.2666, 36]);
  const tee = run(at.id, [0, 48, 0]);
  const change = run(tee.id, [0, 36, 0]);
  at = run(change.id, [0, 60, 0], 3);
  run(at.id, [48, 0, 0], 3);
  applyComponent(doc, change, 'C-RED');
  const top = run(tee.id, [0, 0, 36], 2);
  applyComponent(doc, top, 'FLG-RFBL');
  const d = createDrawing(doc, 'SP-1'), cell = d.lattice!.cell;
  onPaper(doc, d);
  assert.ok(!d.notices?.some(n => n.kind.startsWith('lattice-')), `${d.notices?.map(n => n.kind)}`);
  const lengths = doc.runs.map(r => drawn(d, r));
  assert.ok(Math.min(...lengths) >= 2 * cell - 1e-6, `legs ${lengths.map(v => v.toFixed(0))}`);
  assert.ok(Math.max(...lengths) <= 4 * Math.min(...lengths), `legs ${lengths.map(v => v.toFixed(0))}`);
});

test('distinct pipe ends the layout would put on one paper point are spread apart', () => {
  // A tee's riser and a turn beyond it seen on one iso point: one cell up, and one cell east then north.
  const doc = newIso();
  const run = (from: string | null, d: Vec3) => appendRun(doc, from, d, 'CS40', 2, 'S1', 'L-1');
  const a = run(null, [1000, 0, 0]), up = run(a.id, [0, 0, 300]), b = run(a.id, [300, 0, 0]), north = run(b.id, [0, 300, 0]);
  const c = 10, k = Math.cos(Math.PI / 6) * c;
  const page = (p: Vec3): Point => [(p[0] - p[1]) * k / 300, -(p[0] + p[1]) * c / 600 - p[2] * c / 300];
  const desired = new Map(doc.nodes.map(n => [n.id, page(n.position)]));
  assert.ok(len(sub(desired.get(up.id)!, desired.get(north.id)!)) < 1e-9, 'laid out on one point');
  const { positions } = embedOnLattice({ runs: doc.runs, nodes: doc.nodes, desired, lattice: paperLattice('iso', c) });
  assert.ok(len(sub(positions.get(up.id)!, positions.get(north.id)!)) >= c - 1e-6, 'a cell apart at least');
});

test('every item of the bill of materials is ballooned on its sheet, a blind flange closing a branch included', () => {
  const { doc, run } = specA();
  const at = run(null, [60, 0, 0]);
  const tee = run(at.id, [60, 0, 0]);
  run(tee.id, [48, 0, 0]);
  const top = run(tee.id, [0, 0, 36], 2);
  applyComponent(doc, top, 'FLG-RFBL');
  const sample = parseIsoJson(readFileSync(new URL('../public/samples/cooling-water-return.piping', import.meta.url), 'utf8'));
  for (const drawing of [doc, sample])
    for (const spool of [...new Set(drawing.runs.map(r => r.spool))]) {
      const d = createDrawing(drawing, spool), numbers = new Set<string>();
      for (const p of d.primitives) if (p.type === 'text' && (p.layer === 'TAG' || p.layer === 'TEXT'))
        for (const word of p.text.split(/\s+/)) { const m = word.match(/^[FBG]?(\d+)$/); if (m) numbers.add(m[1]); }
      const missing = sheetMaterials(drawing, spool).filter(r => !numbers.has(String(r.id))).map(r => `${r.id} ${r.description}`);
      assert.deepEqual(missing, [], `${spool}: every row called out`);
    }
});

test('an eccentric reducer is a tapered block, longer than it is high, its flat side straight on the side it names', () => {
  for (const side of ['bottom', 'top'] as const) {
    const { doc, run } = specA();
    const red = run(null, [0, 60, 0]);
    run(red.id, [0, 60, 0], 3);
    applyComponent(doc, red, 'E-RED');
    setFlatSide(doc, red.id, side);
    const d = createDrawing(doc, 'SP-1');
    const block = d.primitives.find((p): p is Extract<Primitive, { type: 'polyline' }> => p.type === 'polyline' && p.owner === red.id && p.layer === 'SYMBOL' && !!p.closed)!;
    assert.ok(block && block.points.length === 4, 'one closed block');
    const [a, b, c, e] = block.points, flat = sub(a, b), large = len(sub(a, e)), small = len(sub(b, c));
    const pipe = sub(d.positions.get(doc.runs[0].from)!, d.positions.get(doc.runs[0].to)!);
    assert.ok(Math.abs(cross(flat, pipe)) < 1e-6, 'the flat side runs with the pipe');
    assert.ok(small <= large * 0.7 + 1e-9 && small > large * 0.5, `tapers: ${small.toFixed(1)} of ${large.toFixed(1)}`);
    // Its dimension's extension lines start clear of its ends, never running on from them as one tall edge.
    for (const [p, q] of [[a, e], [b, c]] as Array<[Point, Point]>)
      for (const l of d.primitives) if (l.type === 'line' && l.layer === 'DIM' && Math.abs(cross(sub(l.a, l.b), sub(p, q))) < 1e-6) {
        const gap = Math.min(...[l.a, l.b].flatMap(x => [p, q].map(y => len(sub(x, y)))));
        const along = Math.abs(cross(sub(p, q), sub(p, l.a))) * len(sub(p, l.a)) < 1e-6;
        if (along) assert.ok(gap >= 0.3 * draftingSizes(doc).text, `an extension line ${gap.toFixed(2)} off the block`);
      }
    assert.ok(len(flat) >= 1.4 * large, `longer than high: ${len(flat).toFixed(1)} by ${large.toFixed(1)}`);
    // Page y grows downward: flat on the bottom is the block's lowest edge, flat on top its highest.
    const mid = (p: Point, q: Point) => (p[1] + q[1]) / 2, other = mid(c, e);
    assert.ok(side === 'bottom' ? mid(a, b) > other : mid(a, b) < other, `flat on the ${side}`);
  }
});

test('a valve body is drawn for its size class and within the pipe beside it', () => {
  // On a short straight between two turns, the valve and its flanges leave most of the pipe either side.
  const { doc, run } = specA();
  let at = run(null, [240, 0, 0]);
  at = run(at.id, [0, 14, 0]);
  const valve = insertComponent(doc, doc.runs.at(-1)!.id, 'valve', 0.5);
  applyComponent(doc, valve, 'GATE-FL');
  run(at.id, [0, 0, 240]);
  const d = createDrawing(doc, 'SP-1'), centre = d.positions.get(valve.id)!;
  const pieces = doc.runs.filter(r => r.from === valve.id || r.to === valve.id).map(r => drawn(d, r));
  const reach = Math.max(...d.primitives.flatMap(p => p.owner === valve.id && p.layer === 'SYMBOL' && p.type === 'polyline' ? p.points.map(q => len(sub(centre, q))) : []));
  assert.ok(reach <= 0.4 * Math.min(...pieces) + draftingSizes(doc).text * 1.6, `valve reaches ${reach.toFixed(1)} of ${pieces.map(v => v.toFixed(0))}`);
});

test('a long size in the bill of materials wraps in its column rather than shrinking below the lettering', () => {
  const { doc, run } = specA();
  const at = run(null, [60, 0, 0]);
  const valve = insertComponent(doc, doc.runs[0].id, 'valve', 0.5);
  applyComponent(doc, valve, 'GATE-FL');
  run(at.id, [0, 60, 0]);
  const d = createDrawing(doc, 'SP-1'), T = draftingSizes(doc).text;
  const cells = d.primitives.filter((p): p is Text => p.type === 'text' && p.layer === 'BOM' && !!(p as Text & { field?: string }).field);
  const field = (p: Text) => (p as Text & { field?: string }).field!;
  const bolts = sheetMaterials(doc, 'SP-1').find(r => r.category === 'bolt')!;
  assert.match(bolts.nd, /X/);
  const row = (id: number, column: string) => cells.filter(p => field(p).startsWith(`bom.${id}.${column}`));
  const listSize = row(bolts.id, 'description')[0].size;
  const nd = row(bolts.id, 'nd'), qty = row(bolts.id, 'qty')[0];
  assert.equal(nd.map(p => p.text).join('').replace(/\s/g, ''), bolts.nd.replace(/\s/g, ''), 'the whole size is printed');
  for (const p of nd) {
    assert.ok(p.size >= Math.min(listSize, T) - 1e-9, `lettered at ${p.size.toFixed(2)}`);
    // Each line stays clear of the quantity beside it.
    const right = p.p[0] + letterWidth(p.text, p.size, 'sans') / 2, left = qty.p[0] - letterWidth(qty.text, qty.size, 'sans') / 2;
    assert.ok(right < left, 'clear of the quantity');
  }
});
