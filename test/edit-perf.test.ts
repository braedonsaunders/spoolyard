import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budget } from './perf-budget';
import { createDrawing, type Drawing } from '../src/core/drawing';
import { forgetEarlierDrawings } from '../src/core/iso/render';
import { appendRun, applyComponent, attachComponent, clone, insertComponent, newIso, type IsoDocument } from '../src/core/model';

/**
 * Redrawing after an edit uses what the drawing before found (its layouts, and the label searches nothing changed
 * beside), so it must draw exactly what a drawing made from nothing draws, only sooner. Thresholds are generous: they
 * catch a cache that stopped working or a redraw that has gone quadratic, not a slow machine.
 */
function job(target: number): IsoDocument {
  const doc = newIso();
  doc.style = { layout: 'schematic', weldNumbers: true, lettering: 'cad' };
  let at = appendRun(doc, null, [1500, 0, 0], 'CS40', 4, 'S0', 'L-1');
  for (let i = 0; doc.runs.length < target; i++) {
    const tee = at;
    at = appendRun(doc, tee.id, [1200 + (i % 3) * 300, 0, 0], 'CS40', 4, 'S0', 'L-1');
    const header = doc.runs.at(-1)!;
    const up = appendRun(doc, tee.id, [0, 0, 900 + (i % 4) * 200], 'CS40', 2, 'S0', 'L-1');
    const over = appendRun(doc, up.id, [0, (i % 2 ? 1 : -1) * (800 + (i % 5) * 150), 0], 'CS40', 2, 'S0', 'L-1');
    const valve = insertComponent(doc, doc.runs.at(-1)!.id, 'valve', 0.4);
    applyComponent(doc, valve, i % 2 ? 'GATE-FL' : 'BALL-FL');
    valve.tag = `HV-${100 + i}`;
    appendRun(doc, over.id, i % 3 ? [0, 0, -600] : [400, 400, 0], 'CS40', 2, 'S0', 'L-1');
    if (i % 4 === 1) attachComponent(doc, header.id, 'support', 0.5).tag = `PS-${i}`;
    if (i % 5 === 2) applyComponent(doc, attachComponent(doc, header.id, 'olet', 0.3), 'WOL');
  }
  return doc;
}
const ink = (d: Drawing) => JSON.stringify([d.primitives, d.labels, d.fit, [...d.positions], d.notices ?? null]);
/** Edits as the editor commits them: on a copy of the document. */
const edits: Array<[string, (d: IsoDocument, drawn: Drawing) => void]> = [
  ['a label moved', (d, drawn) => {
    const label = drawn.labels!.find(l => !l.held && l.key.startsWith('item:'))!;
    ((d.sheets ??= {})[label.spool] ??= {}).labelPositions = { [label.key]: [label.at[0] + 9, label.at[1] - 4] };
  }],
  ['a pipe-tag moved', (d, drawn) => {
    const label = drawn.labels!.find(l => !l.held && l.key.startsWith('pipe-tag:'))!;
    ((d.sheets ??= {})[label.spool] ??= {}).labelPositions = { [label.key]: [label.at[0] - 6, label.at[1] + 6] };
  }],
  ['the title changed', d => { d.title += ' (rev B)'; }],
  ['a heat number changed', d => { d.runs[2].heat = 'H-1042'; }],
  ['a valve retagged', d => { const v = d.nodes.find(n => n.tag?.startsWith('HV-'))!; v.tag = 'HV-9001'; }],
  ['a pipe lengthened', d => { const r = d.runs[4], n = d.nodes.find(n => n.id === r.to)!; n.position = [n.position[0], n.position[1], n.position[2] + 150]; }],
];

test('an edited drawing redrawn from the drawing before is the drawing made from nothing', () => {
  for (const pipes of [12, 30]) {
    const doc = job(pipes), drawn = createDrawing(doc, 'S0');
    for (const [name, edit] of edits) {
      const next = clone(doc);
      edit(next, drawn);
      createDrawing(doc, 'S0');
      const warm = createDrawing(next, 'S0');
      forgetEarlierDrawings();
      const cold = createDrawing(clone(next), 'S0');
      assert.equal(ink(warm), ink(cold), `${pipes} pipes, ${name}`);
      // Drawn again unchanged, a drawing is drawn the same.
      assert.equal(ink(createDrawing(next, 'S0')), ink(cold), `${pipes} pipes, ${name}, again`);
    }
  }
});

test('moving a label on a crowded sheet does not lay it out again', () => {
  const doc = job(60), first = createDrawing(doc, 'S0');
  forgetEarlierDrawings();
  let t = performance.now();
  createDrawing(clone(doc), 'S0');
  const fresh = performance.now() - t;
  const times: number[] = [];
  for (let i = 0; i < 4; i++) {
    const next = clone(doc);
    edits[0][1](next, first);
    next.sheets!.S0.labelPositions = Object.fromEntries(Object.entries(next.sheets!.S0.labelPositions!).map(([k, p]) => [k, [p[0] + i, p[1]]]));
    t = performance.now();
    createDrawing(next, 'S0');
    times.push(performance.now() - t);
  }
  const nudge = Math.min(...times);
  // About 200 ms drawn from nothing and 70 ms a nudge on a 2024 laptop.
  assert.ok(fresh < budget(3000), `drawn from nothing in ${fresh.toFixed(0)} ms`);
  assert.ok(nudge < budget(1000), `a nudge redrawn in ${nudge.toFixed(0)} ms`);
  assert.ok(nudge < fresh * 0.8, `a nudge (${nudge.toFixed(0)} ms) redraws faster than a drawing from nothing (${fresh.toFixed(0)} ms)`);
});

test('a hundred-pipe sheet redraws an edit within the editing budget', () => {
  const doc = job(100);
  createDrawing(doc, 'S0');
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const next = clone(doc);
    next.runs[3].heat = `H-${i}`;
    const t = performance.now();
    createDrawing(next, 'S0');
    times.push(performance.now() - t);
  }
  // About 230 ms on a 2024 laptop: a hundred pipes on one tabloid sheet, crowded past legibility.
  assert.ok(Math.min(...times) < budget(3000), `${Math.min(...times).toFixed(0)} ms`);
});
