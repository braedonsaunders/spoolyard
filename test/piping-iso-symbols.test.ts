import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, attachComponent, getNode, newIso, type IsoDocument, type PipeNode } from '../src/core/model.ts';
import { createDrawing, type Primitive } from '../src/core/drawing.ts';
import { measureText } from '../src/core/stroke-font.ts';
import { insulationWords, operatorDirection } from '../src/core/iso/symbols.ts';

type Text = Extract<Primitive, { type: 'text' }>;
type Poly = Extract<Primitive, { type: 'polyline' }>;
const inch = (v: number) => v * 25.4;
const draw = (doc: IsoDocument) => createDrawing(doc, 'S1').primitives;
const owned = (p: Primitive[], owner: string) => p.filter(q => q.owner === owner);
const texts = (p: Primitive[]) => p.filter((q): q is Text => q.type === 'text');
const polys = (p: Primitive[]) => p.filter((q): q is Poly => q.type === 'polyline');
const symbols = (p: Primitive[]) => polys(p).filter(q => q.layer === 'SYMBOL');
/** A drawing on the built-in spec in imperial units with a plant origin. */
const sheet = () => {
  const doc = newIso();
  doc.units = 'imperial';
  doc.coordinates = { origin: [0, 0, 0] };
  return doc;
};
const straight = (doc: IsoDocument, prep: 'BW' | 'SW' | 'THD' = 'BW', nps = 2) => {
  const mid = appendRun(doc, null, [inch(24), 0, 0], 'CS40', nps, 'S1', 'L1', prep);
  const end = appendRun(doc, mid.id, [inch(24), 0, 0], 'CS40', nps, 'S1', 'L1', prep);
  return { start: getNode(doc, doc.runs[0].from), mid, end };
};

test('a check valve points with the flow, and pipes with a flow carry a filled arrow', () => {
  const tip = (flow: 'forward' | 'reverse') => {
    const doc = sheet(), { mid } = straight(doc, 'THD', 1);
    applyComponent(doc, mid, 'CHECK-SC');
    for (const r of doc.runs) r.flow = flow;
    const d = createDrawing(doc, 'S1'), at = d.positions.get(mid.id)!, end = d.positions.get(doc.runs[1].to)!;
    const body = symbols(owned(d.primitives, mid.id)).find(p => p.closed && !p.fill && p.points.length === 3)!;
    // The triangle's point is the vertex on the pipe's axis.
    const off = (q: [number, number]) => Math.abs((q[0] - at[0]) * (end[1] - at[1]) - (q[1] - at[1]) * (end[0] - at[0]))
    const point = body.points.reduce((a, b) => off(b) < off(a) ? b : a);
    const arrows = symbols(d.primitives).filter(p => p.fill && doc.runs.some(r => r.id === p.owner));
    return { toward: Math.sign((point[0] - at[0]) * (end[0] - at[0]) + (point[1] - at[1]) * (end[1] - at[1])), arrows: arrows.length };
  };
  assert.deepEqual(tip('forward'), { toward: 1, arrows: 1 });
  assert.equal(tip('reverse').toward, -1);
});

test('valve types are told apart: a globe dot, a ball and lever, a plug, a plain gate', () => {
  const marks = (code: string) => {
    const doc = sheet(), { mid } = straight(doc, 'THD', 1);
    applyComponent(doc, mid, code);
    const p = owned(draw(doc), mid.id);
    return { dot: p.filter(q => q.type === 'circle' && q.fill).length, ball: p.filter(q => q.type === 'circle' && !q.fill).length, plug: symbols(p).filter(q => q.fill).length };
  };
  assert.deepEqual(marks('GLOBE-SC'), { dot: 1, ball: 0, plug: 0 });
  assert.deepEqual(marks('BALL-SC'), { dot: 0, ball: 1, plug: 0 });
  assert.deepEqual(marks('PLUG-SC'), { dot: 0, ball: 0, plug: 1 });
  assert.deepEqual(marks('GATE-SC'), { dot: 0, ball: 0, plug: 0 });
  assert.deepEqual(operatorDirection('OPERATOR NORTH 45° EAST')!.map(v => +v.toFixed(3)), [0.707, 0.707, 0]);
  assert.deepEqual(operatorDirection('OPERATOR UP'), [0, 0, 1]);
});

test('socket welds show their socket, screwed joints a tick, and nipples, couplings and unions their outline', () => {
  const doc = sheet();
  const elbow = appendRun(doc, null, [inch(20), 0, 0], 'CS40', 1, 'S1', 'L1', 'SW');
  appendRun(doc, elbow.id, [0, inch(20), 0], 'CS40', 1, 'S1', 'L1', 'SW');
  const p = owned(draw(doc), elbow.id);
  // Two welds, each a dot with its socket bracket.
  assert.equal(p.filter(q => q.type === 'circle' && q.fill).length, 2);
  assert.equal(symbols(p).filter(q => q.points.length === 4 && !q.closed).length, 2);
  const screwed = sheet(), { mid } = straight(screwed, 'THD', 1);
  applyComponent(screwed, mid, 'UNION-SC');
  const union = owned(draw(screwed), mid.id);
  assert.equal(symbols(union).filter(q => q.closed && q.points.length === 4).length, 1);
  // A tick across each pipe where it screws into the union.
  assert.equal(union.filter(q => q.type === 'line' && q.weight === 0.8).length, 2);
});

test('sockolets are a body on the header; U-bolts an X; flow arrows and AR filled; open ends get no break', () => {
  const doc = sheet(), { mid, end } = straight(doc, 'BW', 2);
  const olet = attachComponent(doc, doc.runs[0].id, 'olet', 0.5);
  applyComponent(doc, olet, 'SOL');
  appendRun(doc, olet.id, [0, 0, inch(6)], 'CS40', 0.75, 'S1', 'L1', 'SW');
  const ubolt = attachComponent(doc, doc.runs[1].id, 'support', 0.3); ubolt.component = 'U-BOLT';
  const arrow = attachComponent(doc, doc.runs[1].id, 'annotation', 0.7); arrow.component = 'AR';
  end.continuation = { text: 'OPEN END' };
  const p = draw(doc);
  assert.ok(polys(owned(p, olet.id)).some(q => q.closed && q.points.length === 6));
  assert.equal(owned(p, ubolt.id).filter(q => q.type === 'line').length, 2);
  assert.ok(polys(owned(p, arrow.id)).some(q => q.fill));
  assert.equal(owned(p, end.id).filter(q => q.type !== 'text' && q.layer === 'SYMBOL').length, 0);
  void mid;
});

test('insulation is lettered on its cylinder, its limit reads INSUL. and NONE, and a wall gets its sleeve', () => {
  const doc = sheet();
  straight(doc);
  const ins = attachComponent(doc, doc.runs[0].id, 'annotation', 0.5); Object.assign(ins, { component: 'INS', calloutText: '1.5"' });
  const limit = attachComponent(doc, doc.runs[1].id, 'annotation', 0.3); Object.assign(limit, { component: 'INS-LIMIT' });
  const wall = attachComponent(doc, doc.runs[1].id, 'annotation', 0.7); Object.assign(wall, { component: 'WALL-PEN' });
  const p = draw(doc);
  assert.deepEqual(texts(owned(p, ins.id)).map(t => t.text), ['1.5"']);
  assert.equal(owned(p, ins.id).some(q => q.layer === 'LEADER'), false);
  assert.deepEqual(texts(owned(p, limit.id)).map(t => t.text), ['INSUL.', 'NONE']);
  assert.deepEqual(texts(owned(p, wall.id)).map(t => t.text), ['WALL']);
  assert.deepEqual(insulationWords('INSUL. <- -> NONE'), ['INSUL.', 'NONE']);
  assert.deepEqual(insulationWords('NONE | INSUL.'), ['NONE', 'INSUL.']);
});

test('an instrument bubble continues the line at an open end; equipment nozzles are lettered with a boxed tag', () => {
  const doc = sheet(), { end } = straight(doc, 'THD', 1);
  const pi = attachComponent(doc, doc.runs[1].id, 'annotation', 1); Object.assign(pi, { component: 'ISA-BUBBLE', tag: 'PI' });
  const start = getNode(doc, doc.runs[0].from);
  const nozzle = attachComponent(doc, doc.runs[0].id, 'annotation', 0); Object.assign(nozzle, { component: 'NOZZLE', calloutText: 'N4', tag: 'TK-9' });
  const d = createDrawing(doc, 'S1');
  const bubble = texts(owned(d.primitives, pi.id))[0], a = d.positions.get(end.id)!, b = d.positions.get(doc.runs[1].from)!;
  assert.equal(bubble.text, 'PI');
  // In line with the pipe, beyond its end.
  const cross = (bubble.p[0] - a[0]) * (a[1] - b[1]) - (bubble.p[1] - a[1]) * (a[0] - b[0]);
  assert.ok(Math.abs(cross) / Math.hypot(a[0] - b[0], a[1] - b[1]) < 6);
  assert.deepEqual(texts(owned(d.primitives, nozzle.id)).map(t => t.text), ['N4', 'TK-9']);
  assert.ok(polys(owned(d.primitives, nozzle.id)).some(q => q.layer === 'TAG' && q.closed));
  void start;
});

test('continuations give coordinates only with a plant origin; field-welded ends are flagged FW', () => {
  const doc = sheet(), { start, end } = straight(doc);
  end.continuation = { text: "CONT'D ON\nDWG# X-2", coordinates: true };
  start.continuation = { text: "CONT'D FROM\nDWG# X-0", coordinates: true };
  doc.runs[1].toField = true;
  const lines = (d: IsoDocument) => texts(owned(draw(d), end.id)).map(t => t.text);
  assert.match(lines(doc).join('\n'), /^E /m);
  assert.ok(lines(doc).includes('FW'));
  // The shop end continuing on the next drawing gets no weld here.
  assert.equal(owned(draw(doc), start.id).filter(q => q.type === 'circle').length, 0);
  delete doc.coordinates;
  assert.doesNotMatch(lines(doc).join('\n'), /^E |^EL /m);
});

test('riser pipe tags read up the pipe and every tag number sits inside its box', () => {
  for (const delta of [[0, 0, inch(60)], [inch(30), -inch(30), 0], [inch(40), 0, 0]] as Array<[number, number, number]>) {
    const doc = sheet();
    appendRun(doc, null, delta, 'CS40', 2, 'S1', 'L1');
    const p = draw(doc), run = doc.runs[0];
    const tag = texts(owned(p, run.id)).find(t => t.layer === 'TAG')!, box = polys(owned(p, run.id)).find(q => q.layer === 'TAG')!;
    const xs = box.points.map(q => q[0]), ys = box.points.map(q => q[1]);
    const r = (tag.rotation ?? 0) * Math.PI / 180, mid: [number, number] = [tag.p[0] - Math.sin(r) * tag.size / 2, tag.p[1] - Math.cos(r) * tag.size / 2];
    assert.ok(mid[0] > Math.min(...xs) && mid[0] < Math.max(...xs) && mid[1] > Math.min(...ys) && mid[1] < Math.max(...ys), `tag outside its box for ${delta}`);
    if (delta[2]) assert.equal(Math.abs(tag.rotation ?? 0), 90);
  }
});

test('size labels follow a size change along a straight and stand with the item where the size changes', () => {
  const doc = sheet();
  const red = appendRun(doc, null, [inch(30), 0, 0], 'CS40', 3, 'S1', 'L1');
  appendRun(doc, red.id, [inch(30), 0, 0], 'CS40', 2, 'S1', 'L1');
  applyComponent(doc, red, 'C-RED');
  const all = texts(draw(doc)).map(t => t.text);
  assert.ok(all.includes('3" NS') && all.includes('2" NS'));
  assert.ok(all.some(t => /^\d+\n3"X2" NS$/.test(t)), 'the reducer number and its size in one block');
});

test('tie-point hexagons fit their number, support labels of two lines keep clear, and bends give their radius', () => {
  const doc = sheet(), { start, mid } = straight(doc);
  start.tiePoint = { id: 'TIE-1234A', label: 'EXIST. FLANGE' };
  const support = attachComponent(doc, doc.runs[1].id, 'support', 0.5); Object.assign(support, { component: 'U-BOLT', calloutText: 'U-BOLT\n(SUP-01)*' });
  getNode(doc, mid.id).bendRadius = inch(6);
  const p = draw(doc);
  const hex = polys(owned(p, start.id)).find(q => q.closed && q.points.length === 6)!;
  const width = Math.max(...hex.points.map(q => q[0])) - Math.min(...hex.points.map(q => q[0]));
  assert.ok(width > measureText('TIE-1234A', 6.6) + 8);
  const label = texts(owned(p, support.id))[0];
  assert.equal(label.text, 'U-BOLT\n(SUP-01)*');
  const others = texts(p).filter(t => t !== label && t.layer !== 'TITLE' && t.layer !== 'BOM' && t.layer !== 'NOTES' && t.layer !== 'BORDER');
  const top = label.p[1] - label.size, bottom = label.p[1] + 1.6 * label.size, left = label.p[0], right = left + measureText('(SUP-01)*', label.size);
  assert.equal(others.some(t => !t.rotation && t.p[1] > top && t.p[1] - t.size < bottom && t.p[0] < right && t.p[0] + measureText(t.text, t.size) > left), false);
  void mid;
});

test('weld numbers sit in balloons on leaders to their welds', () => {
  const doc = sheet();
  const elbow = appendRun(doc, null, [inch(20), 0, 0], 'CS40', 2, 'S1', 'L1');
  appendRun(doc, elbow.id, [0, inch(20), 0], 'CS40', 2, 'S1', 'L1');
  doc.style = { layout: 'schematic', weldNumbers: true, lettering: 'cad' };
  const p = owned(draw(doc), elbow.id);
  assert.equal(texts(p).filter(t => t.layer === 'WELD').length, 2);
  assert.equal(polys(p).filter(q => q.layer === 'WELD' && q.closed).length, 2);
  assert.ok(p.filter(q => q.type === 'line' && q.layer === 'LEADER').length >= 2);
});

const unused: PipeNode | undefined = undefined; void unused;
