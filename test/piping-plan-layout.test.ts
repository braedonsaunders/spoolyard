import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, insertComponent, newIso } from '../src/core/model.ts';
import { createDrawing } from '../src/core/drawing.ts';
import { openFor } from '../src/core/iso/render.ts';

test('a wide, flat picture takes the open rectangle it is drawn largest in with room for its annotations', () => {
  // Invented sheet: a tall area beside the material list, and a wide strip under it only a little taller than the
  // annotations' room.
  const free: Array<[number, number, number, number]> = [[40, 115, 900, 630], [40, 500, 1270, 630]];
  // A level pipe 900 long on plan: no height at all.
  assert.deepEqual(openFor(free, [0, 0, 900, 0], 85), [40, 115, 900, 630]);
  // A squat picture still prefers the strip when the strip holds it larger.
  assert.deepEqual(openFor([[40, 115, 400, 630], [40, 300, 1270, 630]], [0, 0, 900, 60], 40), [40, 300, 1270, 630]);
  // With no rectangle roomy enough for the margin, the one holding picture and margin largest.
  assert.deepEqual(openFor([[0, 0, 100, 100], [0, 0, 300, 50]], [0, 0, 10, 10], 60), [0, 0, 100, 100]);
});

test('a long level line on plan is centred in the open paper, not dropped into the strip under the material list', () => {
  const doc = newIso();
  doc.units = 'imperial';
  // Invented line: a long level run east in pieces of different sizes with valves between, enough rows to fill the
  // material list down to a strip under it shorter than the annotations need.
  let at = appendRun(doc, null, [1500, 0, 0], 'CS40', 3, 'SP-9', 'L-9');
  for (const [i, nps] of [4, 6, 2, 8, 3, 4, 6, 2, 8].entries()) {
    at = appendRun(doc, at.id, [2500 + i * 100, 0, 0], 'CS40', nps, 'SP-9', 'L-9');
    if (i % 4 === 1) insertComponent(doc, doc.runs.at(-1)!.id, 'valve');
  }
  const plan = createDrawing(doc, 'SP-9', 'plan');
  const ys = [...plan.positions.values()].map(p => p[1]), mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const [, top, , bottom] = plan.area;
  // The pipe sits in the middle third of the drawing area's height, its lettering inside the drawing area.
  assert.ok(mid > top + (bottom - top) / 3 && mid < bottom - (bottom - top) / 3, `pipe at y ${mid.toFixed(0)} in ${top}-${bottom}`);
  const lettering = plan.primitives.filter(p => p.type === 'text' && (p.layer === 'DIM' || p.layer === 'TAG'));
  assert.ok(lettering.length && lettering.every(p => p.type === 'text' && p.p[1] > top && p.p[1] < bottom));
});

test('lettering in a plane the view sees edge-on stays upright rather than sheared flat', () => {
  const doc = newIso();
  // Invented offset: a pipe rolling north and up, seen on plan, front and side, with its line number lettered in
  // the vertical plane.
  const first = appendRun(doc, null, [2000, 0, 0], 'CS40', 2, 'SP', 'L-7');
  appendRun(doc, first.id, [600, 800, 500], 'CS40', 2, 'SP', 'L-7');
  for (const r of doc.runs) r.lineNumberPlane = 'vertical';
  for (const view of ['iso', 'plan', 'front', 'side'] as const)
    for (const p of createDrawing(doc, 'SP', view).primitives)
      if (p.type === 'text') assert.ok(Math.abs(p.oblique ?? 0) <= 80, `${view} ${p.text} oblique ${p.oblique}`);
});
