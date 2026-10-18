import test from 'node:test';
import assert from 'node:assert/strict';
import { convexHull, cycleIndex, insideHull, pickCandidates, pipeInkAt, bodyHulls } from '../src/editor/pick.ts';
import { fitClearOf, fitView, screenScale, toScreen, type Box, type Frame } from '../src/editor/viewport.ts';
import type { Point, Primitive } from '../src/core/drawing.ts';

test('a component body is its symbol outline, not its tag, leaders or weld dots', () => {
  const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]];
  const hull = convexHull(square);
  assert.equal(hull.length, 4, 'the inner point is not on the hull');
  assert.ok(insideHull(hull, [5, 5]));
  assert.ok(!insideHull(hull, [12, 5]));
  assert.ok(insideHull(hull, [11, 5], 1.5), 'within the pad of the outline');
  const primitives: Primitive[] = [
    { type: 'polyline', points: [[0, 0], [10, 0], [10, 10]], layer: 'SYMBOL', owner: 'red' },
    { type: 'circle', p: [20, 5], r: 2, layer: 'WELD', owner: 'red' },
    { type: 'line', a: [10, 10], b: [60, 60], layer: 'LEADER', owner: 'red' },
    { type: 'polyline', points: [[60, 60], [70, 60], [70, 70]], layer: 'TAG', owner: 'red' },
    { type: 'line', a: [10, 5], b: [30, 5], layer: 'PIPE', owner: 'pipe' },
  ];
  const bodies = bodyHulls(primitives, new Set(['red']));
  assert.ok(insideHull(bodies.get('red')!, [8, 3]));
  assert.ok(!insideHull(bodies.get('red')!, [20, 5], 0.5), 'the weld dot at the pipe is not the body');
  assert.ok(!insideHull(bodies.get('red')!, [40, 40], 0.5), 'nor its leader');
  assert.ok(!bodies.has('pipe'));
  assert.deepEqual(pipeInkAt(primitives, ['pipe'], [20, 6], 2), ['pipe']);
  assert.deepEqual(pipeInkAt(primitives, ['pipe'], [20, 9], 2), []);
});

test('a short pipe between two fittings is picked between their bodies, and Tab reaches the rest', () => {
  // The pointer is on the pipe, inside both fittings' pick circles but on neither body.
  const between = pickCandidates({ pipes: ['pipe'], nodes: [{ id: 'reducer', body: false }, { id: 'bend', body: false }] });
  assert.deepEqual(between, ['pipe', 'reducer', 'bend']);
  // On a fitting's body the fitting comes first; on a weld's point the weld does.
  assert.deepEqual(pickCandidates({ pipes: ['pipe'], nodes: [{ id: 'reducer', body: 'body' }] }), ['reducer', 'pipe']);
  assert.deepEqual(pickCandidates({ pipes: ['pipe'], inked: ['pipe'], nodes: [{ id: 'weld', body: 'core' }] }), ['weld', 'pipe']);
  // A pipe's own line, where it runs into a socket, is the pipe's.
  assert.deepEqual(pickCandidates({ pipes: ['pipe'], inked: ['pipe'], nodes: [{ id: 'cap', body: 'body' }] }), ['pipe', 'cap']);
  assert.deepEqual(pickCandidates({ pipes: [], nodes: [] }), []);
  assert.equal(cycleIndex(0, 3), 1);
  assert.equal(cycleIndex(2, 3), 0);
  assert.equal(cycleIndex(0, 3, true), 2);
});

test('fitting clear of floating toolbars uses the room beside a corner toolbar', () => {
  const frame: Frame = { width: 850, height: 550, fill: false, pad: 0.1 };
  const screen = { width: 940, height: 470 }, sheet: Box = [0, 0, 850, 550], margin = 0.02;
  // A full-width bar along the top, a small zoom bar in the bottom-left corner.
  const covers: Box[] = [[0, 0, 940, 48], [0, 418, 190, 470]];
  const view = fitClearOf(frame, screen, sheet, covers, margin);
  const at = (p: Point) => toScreen(frame, view, { ...screen, left: 0, top: 0 }, p);
  const [x0, y0] = at([0, 0]), [x1, y1] = at([850, 550]);
  for (const c of covers) assert.ok(x1 <= c[0] || x0 >= c[2] || y1 <= c[1] || y0 >= c[3], `clear of ${c}`);
  assert.ok(x0 >= screen.width * margin - 1e-6 && x1 <= screen.width * (1 - margin) + 1e-6 && y1 <= screen.height * (1 - margin) + 1e-6);
  // Larger than treating the corner bar as a full-width band.
  const banded = fitView(frame, screen, [0, -48 / screenScale(frame, view, screen), 850, 550 + 52 / screenScale(frame, view, screen)], margin);
  assert.ok(view.zoom > banded.zoom, `${view.zoom} > ${banded.zoom}`);
  // With nothing floating over the surface it is the plain fit.
  assert.deepEqual(fitClearOf(frame, screen, sheet, [], margin), fitView(frame, screen, sheet, margin));
});
