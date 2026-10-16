import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawing, type Primitive } from '../src/core/drawing.ts';
import { appendRun, newIso, type IsoDocument, type PipeNode, type Vec3 } from '../src/core/model.ts';
import { layoutDirection, layoutSheet, tangles, viewProject } from '../src/core/iso/layout.ts';

type Point = [number, number];
const angleOffVertical = (p: Point) => Math.abs(Math.atan2(p[0], Math.abs(p[1]))) * 180 / Math.PI;
const draw = (doc: IsoDocument) => createDrawing(doc, doc.runs[0].spool);
const nodesOf = (doc: IsoDocument) => doc.nodes.filter(n => doc.runs.some(r => r.from === n.id || r.to === n.id || r.id === n.associatedRunId));
const direct = (doc: IsoDocument, from: string, d: Vec3, nps = 1) => {
  const node = appendRun(doc, from, d, 'CS40', nps, 'SP-1', 'L-1');
  doc.runs.at(-1)!.connector = true;
  return node;
};

test('not to scale, a level pipe at 45° in plan leans off the vertical and its offset triangle closes on it', () => {
  for (const north of [0, 90]) {
    // Level directions along the iso axes keep their projection; the plan diagonals that would project vertical lean
    // 15° clockwise, the same way whichever end they are drawn from.
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1], north ? [1, 1, 0] : [1, -1, 0]] as Vec3[]) {
      const a = layoutDirection(axis, 'iso', north), b = viewProject(axis, 'iso', north);
      assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, `${axis} keeps its direction`);
    }
    const ne = layoutDirection(north ? [1, -1, 0] : [1, 1, 0], 'iso', north), sw = layoutDirection(north ? [-1, 1, 0] : [-1, -1, 0], 'iso', north);
    assert.ok(Math.abs(angleOffVertical(ne) - 15) < 1e-6);
    assert.ok(Math.abs(ne[0] + sw[0]) < 1e-9 && Math.abs(ne[1] + sw[1]) < 1e-9, 'one line, either way');
  }
  assert.ok(angleOffVertical(layoutDirection([1, 0.9, 0], 'iso')) > 15, 'near-diagonals lean further, on their own side');
  assert.deepEqual(layoutDirection([1, 1, 0], 'plan'), viewProject([1, 1, 0], 'plan'));

  const doc = newIso();
  const top = appendRun(doc, null, [0, 0, 2400], 'CS40', 3, 'SP-1', 'L-1');
  const low = appendRun(doc, top.id, [-450, -450, 0], 'CS40', 3, 'SP-1', 'L-1');
  appendRun(doc, low.id, [1200, 0, 0], 'CS40', 3, 'SP-1', 'L-1');
  const d = draw(doc), start = d.positions.get(top.id)!, end = d.positions.get(low.id)!;
  const riser = [d.positions.get(doc.runs[0].from)!, start];
  assert.ok(angleOffVertical([end[0] - start[0], end[1] - start[1]]) > 14, 'the offset is not drawn as a riser');
  assert.ok(Math.abs(riser[0][0] - riser[1][0]) < 1e-6, 'the riser stays vertical');
  // The triangle's legs run along the west and south iso axes and meet where the drawn pipe splits along them.
  const west = viewProject([-1, 0, 0], 'iso'), south = viewProject([0, -1, 0], 'iso'), v: Point = [end[0] - start[0], end[1] - start[1]];
  const det = west[0] * south[1] - west[1] * south[0];
  const corners: Point[] = [(v[0] * south[1] - v[1] * south[0]) / det, (west[0] * v[1] - west[1] * v[0]) / det]
    .flatMap((k, i) => [[start[0] + (i ? south : west)[0] * k, start[1] + (i ? south : west)[1] * k] as Point]);
  const dims = d.primitives.filter((p): p is Extract<Primitive, { type: 'line' }> => p.type === 'line' && p.layer === 'DIM' && p.owner === doc.runs[1].id);
  assert.ok(corners.some(c => dims.some(l => [l.a, l.b].some(q => Math.hypot(q[0] - c[0], q[1] - c[1]) < 0.5))), 'a triangle leg ends at the split');
});

test('not to scale, fittings joined with no pipe stay close and a gasket joint is drawn as one', () => {
  const doc = newIso();
  const header = appendRun(doc, null, [2500, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
  // A screwed drain: nipple, valve, nipple and cap, fitting to fitting.
  const chain: PipeNode[] = [header];
  for (const dz of [-40, -60, -60, -30]) chain.push(direct(doc, chain.at(-1)!.id, [0, 0, dz], 0.5));
  Object.assign(chain[1], { kind: 'valve', component: 'NIPPLE' });
  Object.assign(chain[2], { kind: 'valve', component: 'BALL-SC' });
  Object.assign(chain[3], { kind: 'valve', component: 'NIPPLE' });
  Object.assign(chain[4], { kind: 'cap' });
  // A flange pair split over two nodes a gasket apart.
  const far = appendRun(doc, null, [0, -1500, 0], 'CS40', 2, 'SP-1', 'L-1');
  const mate = direct(doc, far.id, [0, -1.6, 0], 2);
  appendRun(doc, mate.id, [0, -1500, 0], 'CS40', 2, 'SP-1', 'L-1');
  Object.assign(far, { kind: 'flange', component: 'FLG-RFWN' });
  Object.assign(mate, { kind: 'flange', component: 'FLG-RFWN' });
  const d = draw(doc), at = (n: PipeNode) => d.positions.get(n.id)!;
  const pipe = Math.hypot(...(([a, b]) => [b[0] - a[0], b[1] - a[1]])([d.positions.get(doc.runs[0].from)!, at(header)]) as Point);
  const drain = Math.abs(at(chain[4])[1] - at(header)[1]);
  assert.ok(drain < pipe * 0.6, `drain ${drain.toFixed(0)} against pipe ${pipe.toFixed(0)}`);
  assert.ok(Math.hypot(at(far)[0] - at(mate)[0], at(far)[1] - at(mate)[1]) < 6, 'the gasket joint is one joint');
});

test('not to scale, legs that would cross are drawn apart, and the shape is held while routing', () => {
  // A tee cut into a line that, laid out as compressed, would run back across the riser.
  const doc = newIso();
  const base = appendRun(doc, null, [0, 0, 4800], 'CS40', 1, 'SP-1', 'L-1');
  const south = appendRun(doc, base.id, [0, -850, 0], 'CS40', 1, 'SP-1', 'L-1');
  const tee = appendRun(doc, south.id, [-120, 0, 0], 'CS40', 1, 'SP-1', 'L-1');
  appendRun(doc, tee.id, [0, 180, 0], 'CS40', 1, 'SP-1', 'L-1');
  appendRun(doc, tee.id, [0, -1900, 0], 'CS40', 1, 'SP-1', 'L-1');
  const nodes = nodesOf(doc), d = draw(doc);
  const plain = layoutSheet(doc, doc.runs, nodes, 'iso', true, d.fit.base, { stretch: d.fit.stretch });
  assert.ok(tangles(doc, plain).length > 0, 'the plain layout crosses');
  assert.ok(Object.keys(d.fit.legs ?? {}).length > 0);
  assert.equal(tangles(doc, layoutSheet(doc, doc.runs, nodes, 'iso', true, d.fit.base, d.fit)).length, 0);
  // Held, the fit keeps its leg factors, so the sheet does not move while a run is drawn.
  const held = createDrawing(doc, 'SP-1', 'iso', d.fit);
  for (const [id, p] of d.positions) assert.ok(Math.hypot(p[0] - held.positions.get(id)![0], p[1] - held.positions.get(id)![1]) < 1e-6);
});

test('not to scale, a narrow drawing draws its level pipe longer to fill the open area', () => {
  // A tall riser of valves beside one long level run.
  const doc = newIso();
  let at = appendRun(doc, null, [3000, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
  for (let i = 0; i < 6; i++) {
    at = appendRun(doc, at.id, [0, 0, -600], 'CS40', 2, 'SP-1', 'L-1');
    if (i < 5) Object.assign(at, { kind: 'valve', component: 'GATE-FL' });
  }
  const d = draw(doc);
  assert.ok((d.fit.stretch ?? 0) > 0, 'stretched');
  const level = (stretch: number) => {
    const l = layoutSheet(doc, doc.runs, nodesOf(doc), 'iso', true, d.fit.base, { stretch });
    const [a, b] = [l.raw.get(doc.runs[0].from)!, l.raw.get(doc.runs[0].to)!];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  assert.ok(level(d.fit.stretch!) > level(0) * 1.2);
  // A wide drawing is left as it is.
  const flat = newIso();
  let end = appendRun(flat, null, [3000, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
  end = appendRun(flat, end.id, [0, -3000, 0], 'CS40', 2, 'SP-1', 'L-1');
  appendRun(flat, end.id, [3000, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
  assert.equal(draw(flat).fit.stretch ?? 0, 0);
});
