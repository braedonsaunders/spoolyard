import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDrawing, drawingSvg, type Drawing } from '../src/core/drawing';
import { forgetEarlierDrawings, reuseEarlierDrawings } from '../src/core/iso/render';
import { appendRun, applyComponent, attachComponent, clone, insertComponent, newIso, parseIsoJson, type IsoDocument } from '../src/core/model';

/**
 * A drawing is a pure function of its document: drawn from nothing, or after any other drawings in any order (whose
 * layouts, label searches and spots it may use to be drawn sooner), it is the same, byte for byte. Every drawing here
 * is invented: synthetic jobs as `scripts/bench-render.ts` builds them, in variants that share spool names, label keys
 * and sheet sizes so what one drawing keeps is offered to the next, and the public sample.
 */
function job(target: number, variant = 0, spool = 'S0'): IsoDocument {
  const doc = newIso();
  doc.style = { layout: 'schematic', weldNumbers: true, lettering: 'cad' };
  let at = appendRun(doc, null, [1500, 0, 0], 'CS40', 4, spool, 'L-1');
  for (let i = 0; doc.runs.length < target; i++) {
    const tee = at;
    at = appendRun(doc, tee.id, [1200 + ((i + variant) % 3) * 300, 0, 0], 'CS40', 4, spool, 'L-1');
    const header = doc.runs.at(-1)!;
    const up = appendRun(doc, tee.id, [0, 0, 900 + ((i + variant) % 4) * 200], 'CS40', 2, spool, 'L-1');
    const over = appendRun(doc, up.id, [0, (i % 2 ? 1 : -1) * (800 + ((i * (variant + 1)) % 5) * 150), 0], 'CS40', 2, spool, 'L-1');
    const valve = insertComponent(doc, doc.runs.at(-1)!.id, 'valve', 0.4);
    applyComponent(doc, valve, i % 2 ? 'GATE-FL' : 'BALL-FL');
    valve.tag = `HV-${100 + i}`;
    if (i % 3 === 0) applyComponent(doc, insertComponent(doc, doc.runs.find(r => r.to === up.id)!.id, 'flange', 0.5), 'FLG-RFWN');
    appendRun(doc, over.id, i % 3 ? [0, 0, -600] : [400, 400, 0], 'CS40', 2, spool, 'L-1');
    if (i % 4 === 1) attachComponent(doc, header.id, 'support', 0.5).tag = `PS-${i}`;
    if (i % 5 === 2) applyComponent(doc, attachComponent(doc, header.id, 'olet', 0.3), 'WOL');
    if (i % 6 === 3) applyComponent(doc, attachComponent(doc, header.id, 'annotation', 0.7), 'AR');
  }
  return doc;
}
const sample = () => parseIsoJson(readFileSync(resolve(import.meta.dirname, '../public/samples/cooling-water-return.piping'), 'utf8'));

/** Everything a drawing gives out: its primitives, labels, fit, positions and notices, and its SVG. */
const ink = (d: Drawing) => JSON.stringify([d.primitives, d.labels, d.fit, [...d.positions], d.notices ?? null, d.sheet ?? null]) + drawingSvg(d);
type Case = { name: string; doc: IsoDocument; spool: string };
const draw = (c: Case) => ink(createDrawing(c.doc, c.spool));

/** A pipe lengthened, which lays the sheet out again. */
const lengthened = (c: Case, k = 0): Case => {
  const doc = clone(c.doc), r = doc.runs[Math.floor(doc.runs.length / 3) + k], end = doc.nodes.find(n => n.id === r.to)!;
  end.position = [end.position[0], end.position[1], end.position[2] + 40 + 30 * k];
  return { ...c, name: `${c.name} lengthened`, doc };
};
/** A label held somewhere else, which places the labels around it again. */
const nudged = (c: Case, k = 0): Case => {
  const doc = clone(c.doc), label = (createDrawing(doc, c.spool).labels ?? []).filter(l => !l.held)[k];
  if (label) ((doc.sheets ??= {})[label.spool] ??= {}).labelPositions = { [label.key]: [label.at[0] + 12, label.at[1] - 7] };
  return { ...c, name: `${c.name} nudged`, doc };
};

/** What each case draws with nothing kept from drawing to drawing at all. */
function reference(cases: Case[]): Map<string, string> {
  reuseEarlierDrawings(false);
  try { return new Map(cases.map(c => [c.name, draw(c)])); } finally { reuseEarlierDrawings(true); }
}
const permutations = <T>(items: T[]): T[][] => items.length <= 1 ? [items] : items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(p => [x, ...p]));

test('a drawing is the same drawn from nothing, after other drawings in any order, and after edits of other drawings', () => {
  // A, B and C share their spool name and sheet, so each is offered what the one before it found; D is drawn on a
  // spool of its own name, and the sample on a sheet of its own size and style.
  const cases: Case[] = [
    { name: 'A', doc: job(12), spool: 'S0' },
    { name: 'B', doc: job(16, 1), spool: 'S0' },
    { name: 'C', doc: job(20, 2), spool: 'S0' },
    { name: 'D', doc: job(16, 1, 'S1'), spool: 'S1' },
    { name: 'sample', doc: sample(), spool: '' }
  ];
  const expected = reference(cases);
  const same = (c: Case, how: string) => assert.equal(draw(c), expected.get(c.name), `${c.name} ${how}`);
  for (const c of cases) { forgetEarlierDrawings(); same(c, 'drawn from nothing'); }
  for (const order of permutations(cases.slice(0, 3))) {
    forgetEarlierDrawings();
    for (const c of [...order, cases[3], cases[4]]) same(c, `drawn after ${order.map(o => o.name).join(', ')}`);
  }
  // Drawn after the others were edited (laid out again, or labels moved) and drawn.
  const [A, B, C, D] = cases;
  for (const [edited, then] of [[lengthened(B), A], [nudged(A, 1), B], [lengthened(C, 1), A], [nudged(B, 2), C], [lengthened(A), D], [nudged(D), B]] as Array<[Case, Case]>) {
    createDrawing(edited.doc, edited.spool);
    same(then, `after ${edited.name}`);
    same(then, `after ${edited.name}, again`);
  }
  // Drawn again and again, every case is still itself.
  for (const c of [...cases].reverse()) same(c, 'drawn last');
});

test('an edited drawing is the same however many drawings, of it or of others, came before it', () => {
  const A: Case = { name: 'A', doc: job(14), spool: 'S0' }, B: Case = { name: 'B', doc: job(14, 3), spool: 'S0' };
  const edits = [lengthened(A), nudged(A), nudged(lengthened(A, 1), 2), lengthened(B), nudged(B, 1)];
  const expected = reference(edits);
  for (const before of [[], [A], [B], [A, B], [B, A, B]]) {
    forgetEarlierDrawings();
    for (const c of before) draw(c);
    for (const e of edits) assert.equal(draw(e), expected.get(e.name), `${e.name} after ${before.map(c => c.name).join(', ') || 'nothing'}`);
  }
});

test('what a drawing hands out cannot change a later drawing', () => {
  const A: Case = { name: 'A', doc: job(12), spool: 'S0' };
  forgetEarlierDrawings();
  const first = createDrawing(A.doc, A.spool), expected = ink(first);
  // Whoever reads a drawing may change what it was given; the next drawing is drawn from what it kept, not from that.
  for (const p of first.positions.values()) { p[0] += 50; p[1] -= 50; }
  first.fit.centre[0] += 10;
  if (first.fit.legs) for (const k of Object.keys(first.fit.legs)) first.fit.legs[k] *= 2;
  for (const p of first.primitives) {
    if (p.type === 'polyline') for (const q of p.points) q[0] += 7;
    else if (p.type === 'line') { p.a[0] += 7; p.b[1] -= 7; }
    else if (p.type === 'text' || p.type === 'circle') p.p[0] += 7;
  }
  for (const l of first.labels ?? []) l.at[0] += 9;
  assert.equal(ink(createDrawing(A.doc, A.spool)), expected);
  assert.equal(ink(createDrawing(clone(A.doc), A.spool)), expected);
});
