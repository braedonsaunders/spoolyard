import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawing } from '../src/core/drawing';
import { appendRun, attachComponent, insertComponent, newIso } from '../src/core/model';

/**
 * A synthetic 300-pipe job over ten spool sheets: a header with a branch off every tee (riser, level run with a valve,
 * then a drop or a rolling offset) and supports along it. Thresholds are generous; they catch a layout that has gone
 * quadratic, not a slow machine.
 */
function job(target = 300, perSheet = 30) {
  const doc = newIso();
  doc.style = { layout: 'schematic', weldNumbers: true, lettering: 'cad' };
  let at = appendRun(doc, null, [1500, 0, 0], 'CS40', 4, 'S0', 'L-1');
  for (let i = 0; doc.runs.length < target; i++) {
    const spool = `S${Math.floor(doc.runs.length / perSheet)}`, tee = at;
    at = appendRun(doc, tee.id, [1200 + (i % 3) * 300, 0, 0], 'CS40', 4, spool, 'L-1');
    const up = appendRun(doc, tee.id, [0, 0, 900 + (i % 4) * 200], 'CS40', 2, spool, 'L-1');
    const over = appendRun(doc, up.id, [0, (i % 2 ? 1 : -1) * (800 + (i % 5) * 150), 0], 'CS40', 2, spool, 'L-1');
    insertComponent(doc, doc.runs.at(-1)!.id, 'valve', 0.4);
    appendRun(doc, over.id, i % 3 ? [0, 0, -600] : [400, 400, 0], 'CS40', 2, spool, 'L-1');
    if (i % 4 === 1) attachComponent(doc, doc.runs.find(r => r.to === at.id)!.id, 'support', 0.5);
  }
  return doc;
}

test('a 300-pipe job draws every sheet promptly', () => {
  const doc = job(), spools = [...new Set(doc.runs.map(r => r.spool))];
  assert.ok(doc.runs.length >= 300 && spools.length >= 10);
  createDrawing(doc, spools[0]);
  const times: number[] = [];
  for (const spool of spools) {
    const t = performance.now(), d = createDrawing(doc, spool);
    times.push(performance.now() - t);
    assert.ok(d.lattice && d.positions.size > 0);
  }
  const total = times.reduce((a, b) => a + b, 0);
  // About 75 ms a sheet (a fifth of it the whole job's weld numbering) on a 2024 laptop.
  assert.ok(total < 4000, `all sheets in ${total.toFixed(0)} ms`);
  assert.ok(Math.max(...times) < 600, `slowest sheet ${Math.max(...times).toFixed(0)} ms`);
});

test('a sheet of thirty pipes redraws at interactive speed', () => {
  const doc = job(30, 100);
  createDrawing(doc, 'S0');
  const t = performance.now();
  for (let i = 0; i < 5; i++) createDrawing(doc, 'S0');
  const ms = (performance.now() - t) / 5;
  // About 30 ms on a 2024 laptop.
  assert.ok(ms < 250, `${ms.toFixed(0)} ms a redraw`);
});

test('three hundred pipes on one sheet, crowded past legibility, still draw in seconds', () => {
  const doc = job(300, 1000);
  const t = performance.now(), d = createDrawing(doc, 'S0'), ms = performance.now() - t;
  assert.ok(d.notices?.some(n => n.kind === 'crowded'), 'reported crowded');
  // About 2 s on a 2024 laptop; a sheet this crowded is drawn once rather than decluttered.
  assert.ok(ms < 10000, `${ms.toFixed(0)} ms`);
});

test('a sheet of a dozen pipes, the size of an issued spool, draws in well under a second', () => {
  const doc = job(12, 12);
  createDrawing(doc, 'S0');
  const t = performance.now();
  createDrawing(doc, 'S0');
  const ms = performance.now() - t;
  assert.ok(ms < 250, `${ms.toFixed(0)} ms`);
});
