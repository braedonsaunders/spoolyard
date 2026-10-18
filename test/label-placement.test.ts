import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawing, type Drawing, type PaperLabel, type Point, type Primitive } from '../src/core/drawing.ts';
import { appendRun, applyComponent, newIso, parseIsoJson } from '../src/core/model.ts';
import { overlaps } from '../src/core/iso/placement.ts';
import { hull, letteringShapes, overprinting } from '../src/core/iso/declutter.ts';
import { labelRecord, type LabelRecord } from '../src/core/iso/context.ts';
import { pickLabel } from '../src/editor/label-editing.tsx';

type Text = Extract<Primitive, { type: 'text' }>;
/** A made-up spool: a valve with an operator and tag between two pipes, and a continuation at the open start. */
function spool() {
  const doc = newIso();
  const valve = appendRun(doc, null, [1500, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
  const end = appendRun(doc, valve.id, [1500, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
  applyComponent(doc, valve, 'BALL-FL');
  valve.operator = 'OPERATOR UP'; valve.tag = 'XV-0001';
  const start = doc.nodes.find(n => n.id === doc.runs[0].from)!;
  start.continuation = { text: 'CONT\'D ON\nDWG X-100\nSHEET 2', coordinates: false };
  return { doc, valve, start, end };
}
const label = (d: Drawing, key: string) => d.labels!.find(l => l.key === key)!;
const lettering = (l: PaperLabel) => l.ink.flatMap(p => p.type === 'text' ? letteringShapes(p as Text) : []);
const overprint = (a: PaperLabel, b: PaperLabel) => lettering(a).some(x => lettering(b).some(y => overlaps(x, y)));

test('automatic callouts keep clear of a label the drafter placed, even one drawn after them', () => {
  const { doc, valve, start } = spool();
  const free = createDrawing(doc);
  const item = label(free, `item:${valve.id}`);
  // Hold the continuation right where the valve callout would go on its own.
  doc.sheets = { 'SP-1': { labelPositions: { [`continuation:${start.id}`]: [...item.at] } } };
  const before = JSON.stringify(doc), drawing = createDrawing(doc);
  const continuation = label(drawing, `continuation:${start.id}`), moved = label(drawing, `item:${valve.id}`);
  assert.deepEqual(continuation.at, item.at, 'the held label stays where it was put');
  assert.equal(continuation.held, true);
  assert.equal(moved.held, false);
  assert.ok(!overprint(moved, continuation), 'the valve callout moved off the held note');
  assert.notDeepEqual(moved.at, item.at);
  assert.equal(JSON.stringify(doc), before, 'placement never edits the drawing');
  assert.deepEqual(createDrawing(parseIsoJson(JSON.stringify(doc))).primitives, drawing.primitives);
});

test('a sheet with no overprints is drawn exactly as placed the first time', () => {
  const { doc } = spool();
  const drawing = createDrawing(doc);
  const texts = drawing.primitives.filter((p): p is Text => p.type === 'text' && p.layer !== 'SYMBOL' && p.layer !== 'TITLE' && p.layer !== 'BOM' && p.layer !== 'NOTES');
  const shapes = texts.map(t => letteringShapes(t));
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++)
      assert.ok(!shapes[i].some(a => shapes[j].some(b => overlaps(a, b))), `${JSON.stringify(texts[i].text)} overprints ${JSON.stringify(texts[j].text)}`);
  assert.ok(drawing.labels!.every(l => !l.overlapping));
  assert.deepEqual(createDrawing(doc).primitives, drawing.primitives);
});

test('each line of a valve callout is picked and held on its own, and goes back into the block when reset', () => {
  const { doc, valve } = spool();
  const block = `item:${valve.id}`, operator = `${block}#operator`, tag = `${block}#tag`;
  const free = createDrawing(doc);
  const one = free.primitives.filter((p): p is Text => p.type === 'text' && p.label?.key === block);
  assert.equal(one.length, 1, 'unmoved, the callout is lettered as one block');
  assert.equal(one[0].text, '\nOPERATOR UP\nXV-0001');
  for (const key of [operator, tag, `item-number:${block}`]) assert.equal(label(free, key).parent, block, key);
  // A line still in the block is outlined where the block letters it.
  const line = label(free, operator);
  assert.ok(lettering(label(free, block)).some(s => line.outline.length && overlaps(s, hull(line.outline))));
  const at: Point = [line.at[0] - 60, line.at[1] + 40];
  doc.sheets = { 'SP-1': { labelPositions: { [operator]: at } } };
  const held = createDrawing(doc);
  const moved = held.primitives.find((p): p is Text => p.type === 'text' && p.label?.key === operator)!;
  assert.equal(moved.text, 'OPERATOR UP');
  assert.deepEqual(moved.label!.at, at);
  assert.equal(held.primitives.find((p): p is Text => p.type === 'text' && p.label?.key === block)!.text, '\n\nXV-0001');
  assert.equal(label(held, operator).parent, undefined, 'a moved line stands on its own');
  assert.equal(label(held, tag).parent, block);
  delete doc.sheets['SP-1'].labelPositions![operator];
  assert.deepEqual(createDrawing(doc).primitives, free.primitives);
});

test('of two held labels that overprint, the later is drawn at the nearest clear spot, and the document keeps its held point', () => {
  const { doc, valve, start } = spool();
  const free = createDrawing(doc), at = label(free, `item:${valve.id}`).at, near: Point = [at[0] + 4, at[1] + 2];
  doc.sheets = { 'SP-1': { labelPositions: { [`item:${valve.id}`]: [...at], [`continuation:${start.id}`]: near } } };
  const before = JSON.stringify(doc), drawing = createDrawing(doc);
  const item = label(drawing, `item:${valve.id}`), note = label(drawing, `continuation:${start.id}`);
  assert.deepEqual(item.at, at, 'the label drawn first stays where it is held');
  assert.ok(!item.displaced && !item.overlapping);
  assert.equal(note.held, true);
  assert.equal(note.displaced, true);
  assert.ok(!note.overlapping, 'nothing is left overprinting');
  assert.ok(!overprint(item, note));
  const moved = Math.hypot(note.at[0] - near[0], note.at[1] - near[1]);
  assert.ok(moved > 0 && moved < 80, `moved ${moved}`);
  assert.equal(JSON.stringify(doc), before, 'the held point is not rewritten');
  // Holding it where it is drawn keeps the layout as it is: nothing moves again.
  doc.sheets['SP-1'].labelPositions![`continuation:${start.id}`] = [...note.at];
  const kept = createDrawing(doc);
  assert.deepEqual(label(kept, `continuation:${start.id}`).at, note.at);
  assert.ok(!label(kept, `continuation:${start.id}`).displaced);
  assert.deepEqual(kept.primitives.filter(p => p.type === 'text'), drawing.primitives.filter(p => p.type === 'text'));
});

test('dimension lettering held on the pipe is drawn clear of it with the same value and slant', () => {
  const { doc } = spool();
  const free = createDrawing(doc), dim = label(free, 'dimension:0');
  const text = dim.ink.find((p): p is Text => p.type === 'text')!;
  const run = doc.runs[0], a = free.positions.get(run.from)!, b = free.positions.get(run.to)!, on: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  doc.sheets = { 'SP-1': { labelPositions: { 'dimension:0': on } } };
  const before = JSON.stringify(doc), drawing = createDrawing(doc), moved = label(drawing, 'dimension:0');
  const drawn = moved.ink.find((p): p is Text => p.type === 'text')!;
  assert.equal(moved.displaced, true);
  assert.ok(!moved.overlapping);
  assert.equal(drawn.text, text.text);
  assert.equal(drawn.rotation, text.rotation);
  assert.equal(drawn.oblique, text.oblique);
  const pipe = drawing.primitives.filter(p => p.type === 'line' && p.layer === 'PIPE') as Extract<Primitive, { type: 'line' }>[];
  assert.ok(!letteringShapes(drawn).some(s => pipe.some(l => overlaps(s, [l.a, l.b]))), 'off the pipe');
  assert.equal(JSON.stringify(doc), before);
});

test('labels report their leaders and bends for dragging, and a held bend is used as drawn', () => {
  const { doc, start } = spool();
  const key = `continuation:${start.id}`, free = createDrawing(doc), leader = label(free, key).leader!;
  assert.ok(leader && !leader.held);
  const bend: Point = [leader.to[0] - 30, leader.to[1] - 30];
  doc.sheets = { 'SP-1': { labelPositions: { [`leader:${key}`]: bend } } };
  const drawn = label(createDrawing(doc), key).leader!;
  assert.deepEqual(drawn.bend, bend);
  assert.equal(drawn.held, true);
});

test('overprint detection ignores a label\'s own ink and its own item, and flags lettering on lettering', () => {
  const text = (p: Point, value: string, owner: string): Text => ({ type: 'text', p, text: value, size: 6.6, layer: 'TEXT', owner });
  const a = text([100, 100], 'FIRST NOTE', 'n1'), b = text([110, 102], 'SECOND', 'n2'), c = text([100, 200], 'CLEAR', 'n3');
  const own: Primitive = { type: 'line', a: [90, 98], b: [160, 98], layer: 'SYMBOL', owner: 'n3' };
  const host = { out: [] as Primitive[], place: { labels: [] as string[] } as never, labels: new Map<string, LabelRecord>(), spool: 'S', annotating: true };
  for (const [key, t] of [['k1', a], ['k2', b], ['k3', c]] as const) labelRecord(host, key, t.owner)!.ink.push(t);
  const found = overprinting([a, b, c, own], host.labels, { inside: () => true });
  assert.equal(found.get('k1'), 'lettering');
  assert.equal(found.get('k2'), 'lettering');
  assert.equal(found.has('k3'), false);
  host.labels.delete('k2');
  assert.equal(overprinting([a, c], host.labels, { inside: () => true }).size, 0);
  assert.equal(overprinting([a, c], host.labels, { inside: shape => shape.every(p => p[1] < 150) }).get('k3'), 'lettering', 'off the model area');
});

test('a click picks a whole callout first, then drills into the line under the pointer', () => {
  const at: Point = [0, 0], outline: Point[] = [[0, 0], [1, 0], [1, 1]];
  const block: PaperLabel = { key: 'item:v', spool: 'S', at, outline, held: false, ink: [] };
  const line: PaperLabel = { ...block, key: 'item:v#tag', parent: 'item:v' };
  const index = new Map([[block.key, block], [line.key, line]]);
  const element = { closest: () => ({ getAttribute: () => line.key }) } as unknown as Element;
  assert.equal(pickLabel(index, element, undefined, false, true)?.key, block.key);
  assert.equal(pickLabel(index, element, block.key, false, true)?.key, line.key);
  assert.equal(pickLabel(index, element, undefined, true, true)?.key, line.key, 'Ctrl/⌘ picks the line at once');
});
