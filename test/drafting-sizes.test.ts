import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, getNode, newIso, parseIsoJson, type IsoDocument, type Vec3 } from '../src/core/model.ts';
import { createDrawing, type Primitive } from '../src/core/drawing.ts';
import { COMPONENT_TYPES, componentDrafting } from '../src/core/components.ts';
import { boreClass, draftingSizes } from '../src/core/iso/context.ts';
import { offsetExtension } from '../src/core/iso/dimensions.ts';
import { drafting } from '../src/core/iso/valve-conventions.ts';
import { unitsPerMm } from '../src/core/paper.ts';

type Text = Extract<Primitive, { type: 'text' }>;
type Poly = Extract<Primitive, { type: 'polyline' }>;
const inch = (v: number) => v * 25.4;
const texts = (p: Primitive[]) => p.filter((q): q is Text => q.type === 'text');
const owned = (p: Primitive[], owner: string) => p.filter(q => q.owner === owner);
const sheet = () => { const doc = newIso(); doc.units = 'imperial'; return doc; };
const straight = (doc: IsoDocument, nps = 2) => {
  const mid = appendRun(doc, null, [inch(24), 0, 0], 'CS40', nps, 'S1', 'L1');
  const end = appendRun(doc, mid.id, [inch(24), 0, 0], 'CS40', nps, 'S1', 'L1');
  return { mid, end };
};

test('every built-in component type states its drawn symbol; unknown codes draw the generic symbol of their kind', () => {
  for (const t of COMPONENT_TYPES) assert.ok(t.symbol, t.code);
  assert.equal(componentDrafting('BALL-SC', 'valve').defaultOperator, 'lever');
  assert.equal(componentDrafting('UNION-SC', 'valve').dimensionThrough, true);
  assert.equal(componentDrafting('SPRGHNGR', 'support').supportLabel, 'SPRING HANGER');
  assert.equal(componentDrafting('HOUSE-STD-77', 'valve').symbol, 'valve');
  assert.equal(componentDrafting('HOUSE-STD-77', 'support').symbol, 'support');
  assert.equal(componentDrafting('HOUSE-STD-77', 'cap').symbol, 'cap');
});

test('a custom-coded specification row draws the symbol of the type it names, whatever its code', () => {
  const doc = sheet(), { mid } = straight(doc);
  doc.specs[0].fittings.push({ id: 'HOUSE-QT', kind: 'valve', nps: 2, description: 'House quarter-turn valve', takeout: 60, source: 'test', component: 'HOUSE-QT-2', symbol: 'ball' });
  mid.kind = 'valve'; mid.catalogId = 'HOUSE-QT';
  const ball = (d: IsoDocument) => owned(createDrawing(d, 'S1').primitives, mid.id).filter((p): p is Poly => p.type === 'polyline' && p.closed === true && p.points.length === 32);
  assert.equal(drafting(doc, mid).symbol, 'ball');
  assert.equal(ball(doc).length, 1, 'drawn as a ball valve');
  assert.equal(drafting(doc, mid).defaultOperator, 'lever');
  delete doc.specs[0].fittings.at(-1)!.symbol;
  assert.equal(ball(doc).length, 0, 'without a symbol, a custom valve is a plain valve body');
  assert.equal(parseIsoJson(JSON.stringify({ ...doc, specs: [{ ...doc.specs[0], fittings: [{ ...doc.specs[0].fittings.at(-1)!, symbol: 'ball' }] }] })).specs[0].fittings[0].symbol, 'ball');
  const bad = JSON.parse(JSON.stringify(doc)); bad.nodes.find((n: { id: string }) => n.id === mid.id).symbol = 'teapot';
  assert.throws(() => parseIsoJson(JSON.stringify(bad)));
});

test('lettering is sized in paper millimetres and every drafting size follows it, on every paper', () => {
  for (const paper of ['letter', 'tabloid', 'a3', 'a4'] as const) {
    const s = draftingSizes({ paper, style: { textHeight: 3 } });
    assert.ok(Math.abs(s.text - 3 * unitsPerMm(paper)) < 1e-9);
    assert.ok(Math.abs(s.text / s.mm - 3) < 1e-9, 'the same printed height on every paper');
    // Symbols, arrowheads and tiers stay in proportion to the lettering.
    const base = draftingSizes({ paper, style: { textHeight: 1.5 } });
    for (const key of ['arrow', 'weld', 'fieldWeld', 'flangeThickness', 'tier', 'tierStep', 'stub'] as const)
      assert.ok(Math.abs(s[key] / base[key] - 2) < 1e-9, key);
  }
  assert.equal(draftingSizes({}).text, 2.5 * unitsPerMm('tabloid'), 'ISO 3098 minimum by default');
  // The drawn dimension lettering is the drawing's printed height on its paper.
  const doc = sheet(); doc.paper = 'a4'; doc.style = { ...doc.style!, textHeight: 3.5 };
  appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'S1', 'L1');
  const dims = texts(createDrawing(doc, 'S1').primitives).filter(t => t.layer === 'DIM');
  assert.ok(dims.length && dims.every(t => Math.abs(t.size - 3.5 * unitsPerMm('a4')) < 1e-9));
  assert.throws(() => parseIsoJson(JSON.stringify({ ...doc, style: { ...doc.style, textHeight: 40 } })));
});

test('large-bore symbols are drawn in clamped size classes, not in proportion to the bore', () => {
  assert.deepEqual([0.5, 2, 2.5, 3, 4, 8, 24].map(n => boreClass(n)), [2, 2, 3, 3, 4, 4, 4]);
  const height = (nps: number) => {
    const doc = sheet(), { mid } = straight(doc, nps);
    applyComponent(doc, mid, 'FLG-RFWN');
    const ys = owned(createDrawing(doc, 'S1').primitives, mid.id).flatMap(p => p.type === 'polyline' && p.layer === 'SYMBOL' ? p.points.map(q => q[1]) : []);
    return Math.max(...ys) - Math.min(...ys);
  };
  const [small, medium, large, huge] = [2, 4, 12, 24].map(height);
  assert.ok(medium > small, 'a 4" flange is drawn larger than a 2" one');
  assert.ok(Math.abs(large - medium) < 1e-6 && Math.abs(huge - medium) < 1e-6, 'from 4" up every flange is drawn alike');
  assert.ok(huge < draftingSizes({}).text * 6, 'a 24" flange stays in proportion to the lettering');
});

test('a field-fit weld is lettered FFW with its makeup, or FW by the style', () => {
  const doc = sheet(), { mid } = straight(doc);
  applyComponent(doc, mid, 'W-LR90EL');
  doc.runs[0].toFieldFit = true;
  const flag = () => texts(createDrawing(doc, 'S1').primitives).filter(t => t.layer === 'WELD' && t.label?.key.startsWith('field-weld:'));
  const [ffw] = flag();
  assert.equal(ffw.text, 'FFW\n+3" FIT-UP');
  doc.fieldFitMakeup = inch(6);
  assert.equal(flag()[0].text, 'FFW\n+6" FIT-UP');
  doc.style = { ...doc.style!, fieldFitMark: 'FW' };
  assert.equal(flag()[0].text, 'FW');
  // The flag is a label of its own: held where the drafter puts it.
  doc.sheets = { S1: { labelPositions: { [ffw.label!.key]: [300, 300] } } };
  assert.deepEqual(flag()[0].label?.at, [300, 300]);
});

test('weld-number balloons are movable labels', () => {
  const doc = sheet(), { mid } = straight(doc);
  applyComponent(doc, mid, 'W-LR90EL');
  doc.style = { ...doc.style!, weldNumbers: true };
  const balloons = () => texts(createDrawing(doc, 'S1').primitives).filter(t => t.label?.key.startsWith('weld-number:'));
  const first = balloons();
  assert.ok(first.length >= 2);
  doc.sheets = { S1: { labelPositions: { [first[0].label!.key]: [250, 250] } } };
  assert.deepEqual(balloons().find(t => t.label!.key === first[0].label!.key)!.label!.at, [250, 250]);
});

test('an offset\'s true length is extended along a plant direction in a plane through the pipe', () => {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const det = (a: Vec3, b: Vec3, c: Vec3) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  // A plane offset: square to the pipe, in the offset's plane.
  for (const d of [[300, 400, 0], [0, 300, 500], [200, 0, -700]] as Vec3[]) {
    const e = offsetExtension(d), normal = [0, 1, 2].map(i => d[i] ? 0 : 1) as Vec3;
    assert.ok(Math.abs(dot(e, d)) < 1e-9 && Math.abs(dot(e, normal)) < 1e-9, String(d));
  }
  // A rolling offset: square to the pipe, in the vertical plane containing it.
  const roll: Vec3 = [300, 400, 500], e = offsetExtension(roll);
  assert.ok(Math.abs(dot(e, roll)) < 1e-9);
  assert.ok(Math.abs(det(roll, [0, 0, 1], e)) < 1e-9);
  assert.ok(e[2] > 0.5);
  // Drawn to scale, the rolling offset's true-length extension lines run along that direction on the page.
  const doc = sheet(); doc.style = { layout: 'scale', weldNumbers: false, lettering: 'cad' };
  const a = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'S1', 'L1');
  const b = appendRun(doc, a.id, roll, 'CS40', 2, 'S1', 'L1');
  appendRun(doc, b.id, [1000, 0, 0], 'CS40', 2, 'S1', 'L1');
  const drawing = createDrawing(doc, 'S1'), origin = getNode(doc, a.id).position;
  const p0 = drawing.project(origin), p1 = drawing.project(origin.map((v, i) => v + e[i] * 100) as Vec3);
  const page = [p1[0] - p0[0], p1[1] - p0[1]], l = Math.hypot(...page);
  const along = (q: Extract<Primitive, { type: 'line' }>) => Math.abs((q.b[0] - q.a[0]) * page[0] + (q.b[1] - q.a[1]) * page[1]) / (Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) * l);
  const extensions = drawing.primitives.filter((q): q is Extract<Primitive, { type: 'line' }> => q.type === 'line' && q.layer === 'DIM' && q.owner === doc.runs[1].id && along(q) > 0.9999);
  assert.ok(extensions.length >= 2, 'both extension lines lie along the projected plant direction');
});

test('flanged joints call out one balloon per item by default; the combined callout is a style', () => {
  const doc = sheet(), { mid } = straight(doc);
  applyComponent(doc, mid, 'FLG-RFWN');
  const jointLabels = () => texts(createDrawing(doc, 'S1').primitives).filter(t => t.label?.key.startsWith('joint:')).map(t => t.text);
  const items = jointLabels();
  assert.ok(items.length >= 2 && items.every(t => /^\d+$/.test(t)), items.join());
  doc.style = { ...doc.style!, jointCallout: 'combined' };
  assert.ok(jointLabels().some(t => /^F\d+ B\d+ G\d+$/.test(t)));
});

test('older drawings are migrated once to explicit terminations, symbols and their lettering height', () => {
  const doc = sheet(), { end } = straight(doc);
  end.continuation = { text: 'OPEN END\nBY OTHERS' };
  const legacy = JSON.parse(JSON.stringify(doc));
  delete legacy.draftingRules;
  const migrated = parseIsoJson(JSON.stringify(legacy));
  assert.equal(migrated.nodes.find(n => n.id === end.id)!.continuation!.termination, 'open');
  assert.equal(migrated.style!.jointCallout, 'combined');
  assert.ok(Math.abs(migrated.style!.textHeight! * unitsPerMm('tabloid') - 6.6) < 0.02);
  // Once saved under the current rules, free text no longer decides anything.
  const current = parseIsoJson(JSON.stringify(doc));
  assert.equal(current.nodes.find(n => n.id === end.id)!.continuation!.termination, undefined);
  assert.equal(current.style!.textHeight, undefined);
});

test('a formed pipe bend is drawn round its arc between its tangent points, with no welds', () => {
  for (const layout of ['schematic', 'scale'] as const) {
    const doc = sheet(); doc.style = { ...doc.style!, layout };
    const bend = appendRun(doc, null, [1500, 0, 0], 'CS40', 2, 'S1', 'L1');
    appendRun(doc, bend.id, [0, 1500, 0], 'CS40', 2, 'S1', 'L1');
    applyComponent(doc, bend, 'PIPEBEND'); bend.bendRadius = 5 * inch(2);
    const d = createDrawing(doc, 'S1'), at = d.positions.get(bend.id)!;
    const arc = owned(d.primitives, bend.id).find((p): p is Poly => p.type === 'polyline' && p.layer === 'PIPE');
    assert.ok(arc && arc.points.length > 8, layout);
    assert.ok(!owned(d.primitives, bend.id).some(p => p.layer === 'WELD'), 'a bend is not welded');
    // The straights stop at the tangent points, where the arc starts and ends.
    const pipes = d.primitives.filter(p => p.type === 'line' && p.layer === 'PIPE' && doc.runs.some(r => r.id === p.owner));
    for (const end of [arc!.points[0], arc!.points.at(-1)!]) {
      assert.ok(Math.hypot(end[0] - at[0], end[1] - at[1]) > 1, 'the arc cuts the corner');
      assert.ok(pipes.some(p => p.type === 'line' && [p.a, p.b].some(q => Math.hypot(q[0] - end[0], q[1] - end[1]) < 1e-6)), layout);
    }
  }
});

test('the small end of an eccentric reducer continues its leg: no offset construction for the flat-side offset', async () => {
  const { setFlatSide } = await import('../src/core/model.ts');
  const doc = sheet();
  const red = appendRun(doc, null, [inch(30), 0, 0], 'CS40', 4, 'S1', 'L1');
  appendRun(doc, red.id, [inch(30), 0, 0], 'CS40', 2, 'S1', 'L1');
  applyComponent(doc, red, 'E-RED'); setFlatSide(doc, red.id, 'top');
  const d = createDrawing(doc, 'S1').primitives;
  assert.ok(!d.some(p => p.layer === 'HATCH'), 'no offset hatching');
  assert.ok(texts(d).some(t => t.layer === 'DIM'));
});
