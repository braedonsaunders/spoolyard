import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawing, type Primitive } from '../src/core/drawing.ts';
import { appendRun, clone, newIso, parseIsoJson, runResult, type IsoDocument, type PipeNode, type Vec3 } from '../src/core/model.ts';
import { layoutDirection, layoutSheet, tangles, viewProject } from '../src/core/iso/layout.ts';

type Point = [number, number];
const angleOffVertical = (p: Point) => Math.abs(Math.atan2(p[0], Math.abs(p[1]))) * 180 / Math.PI;
const draw = (doc: IsoDocument) => createDrawing(doc, doc.runs[0].spool);

test('an explicit hidden elevation overrides an automatic riser callout and survives reopening', () => {
  const doc = newIso(); doc.coordinates = { origin: [0, 0, 0] };
  doc.style!.elevations = true;
  const elbow = appendRun(doc, null, [0, 0, 1000], 'CS40', 2, 'SP-1', 'L');
  appendRun(doc, elbow.id, [1000, 0, 0], 'CS40', 2, 'SP-1', 'L');
  const key = `elevation:${elbow.id}`;
  const hasLabel = (d: IsoDocument) => draw(d).primitives.some(p => p.type === 'text' && p.label?.key === key);
  assert.ok(hasLabel(doc));
  const positions = doc.nodes.map(n => n.position);
  elbow.elevationCallout = false;
  assert.equal(hasLabel(parseIsoJson(JSON.stringify(doc))), false);
  assert.deepEqual(doc.nodes.map(n => n.position), positions);
  elbow.elevationCallout = true;
  assert.ok(hasLabel(doc));
});

test('paper positions arrange a schematic without changing model geometry, cuts or model-space views', () => {
  const doc = newIso(), end = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP-1', 'L');
  const before = clone(doc), start = doc.runs[0].from, cut = runResult(doc, doc.runs[0]).cut;
  doc.sheets = { 'SP-1': { nodePositions: { [start]: [200, 300], [end.id]: [600, 300] } } };
  const drawing = createDrawing(doc);
  assert.deepEqual(drawing.positions.get(start), [200, 300]);
  assert.deepEqual(drawing.positions.get(end.id), [600, 300]);
  assert.deepEqual(drawing.project([500, 0, 0]), [400, 300]);
  assert.deepEqual(doc.nodes, before.nodes);
  assert.equal(runResult(doc, doc.runs[0]).cut, cut);
  assert.deepEqual(createDrawing(doc, '', 'iso', undefined, {model: true}).positions,
    createDrawing(before, '', 'iso', undefined, {model: true}).positions);
  assert.deepEqual(createDrawing(parseIsoJson(JSON.stringify(doc))).positions, drawing.positions);
});
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
  doc.sheetFormat='production'; // Keep the viewport that makes this routing fixture cross before untangling.
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

test('where two pipes cross on the sheet the one behind is broken, and leaders break where they cross a pipe', () => {
  // Drawn to scale, the west run passes in front of the riser.
  const doc = newIso();
  doc.style = { layout: 'scale', weldNumbers: false, lettering: 'cad' };
  const top = appendRun(doc, null, [0, 0, 3000], 'CS40', 2, 'SP-1', 'L-1');
  const south = appendRun(doc, top.id, [0, -2000, 0], 'CS40', 2, 'SP-1', 'L-1');
  appendRun(doc, south.id, [-3000, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
  const d = draw(doc), lines = (owner: string) =>
    d.primitives.filter((p): p is Extract<Primitive, { type: 'line' }> => p.type === 'line' && p.layer === 'PIPE' && p.owner === owner);
  const riser = lines(doc.runs[0].id), west = lines(doc.runs[2].id);
  assert.equal(riser.length, 2, 'the riser is broken');
  assert.equal(west.length, 1, 'the pipe in front is whole');
  const gap = Math.hypot(riser[1].a[0] - riser[0].b[0], riser[1].a[1] - riser[0].b[1]);
  assert.ok(Math.abs(gap - 850 / 11 * 0.25) < 0.01, `a quarter-inch gap, not ${gap}`);
  // No leader runs through a pipe.
  const segments = (layer: string) => d.primitives.filter((p): p is Extract<Primitive, { type: 'line' }> => p.type === 'line' && p.layer === layer);
  const crosses = (m: { a: Point; b: Point }, n: { a: Point; b: Point }) => {
    const side = (p: Point, q: Point, r: Point) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return side(m.a, m.b, n.a) * side(m.a, m.b, n.b) < 0 && side(n.a, n.b, m.a) * side(n.a, n.b, m.b) < 0;
  };
  assert.ok(segments('LEADER').length > 0);
  for (const l of segments('LEADER')) for (const p of segments('PIPE')) assert.ok(l.owner === p.owner || !crosses(l, p), 'a leader crosses a pipe unbroken');
});

test('the picture keeps off the north symbol, bill of materials and notes', async () => {
  const { intrudes } = await import('../src/core/iso/render.ts');
  const { drawSheet } = await import('../src/core/iso/sheet.ts');
  const { sheetWidth } = await import('../src/core/drawing.ts');
  const { sheetMaterials } = await import('../src/core/material-list.ts');
  const viewport: [number, number, number, number] = [10, 10, 1000, 700], bom: [number, number, number, number] = [800, 10, 1000, 300];
  const line = (a: Point, b: Point): Primitive => ({ type: 'line', a, b, layer: 'DIM' });
  assert.equal(intrudes([line([100, 100], [700, 200])], viewport, [bom]), false);
  assert.equal(intrudes([line([100, 100], [850, 200])], viewport, [bom]), true, 'into the BOM');
  assert.equal(intrudes([line([100, 100], [100, 750])], viewport, [bom]), true, 'off the sheet');
  // Every drawn line of a sheet stays clear of the frame's areas.
  const doc = newIso();
  let at = appendRun(doc, null, [-1500, 1500, 0], 'CS40', 3, 'SP-1', 'L-1');
  at = appendRun(doc, at.id, [900, 900, 0], 'CS40', 3, 'SP-1', 'L-1');
  appendRun(doc, at.id, [0, 0, 1800], 'CS40', 3, 'SP-1', 'L-1');
  const d = draw(doc), frame = drawSheet({ doc, spool: 'SP-1', width: sheetWidth(doc), height: 850, rows: sheetMaterials(doc, 'SP-1') });
  assert.equal(intrudes(d.primitives.filter(p => !['TITLE', 'BOM', 'NOTES', 'BORDER', 'TEXT'].includes(p.layer)), frame.viewport, frame.exclusions), false);
});

test('no lettering overprints other lettering: two-line support labels, rolling offsets and free notes', async () => {
  const { attachComponent } = await import('../src/core/model.ts');
  const { textPoly, overlaps } = await import('../src/core/iso/placement.ts');
  const doc = newIso();
  const a = appendRun(doc, null, [2400, 0, 0], 'CS40', 4, 'SP-1', 'L-1');
  const b = appendRun(doc, a.id, [400, 400, 600], 'CS40', 4, 'SP-1', 'L-1');
  appendRun(doc, b.id, [1500, 0, 0], 'CS40', 4, 'SP-1', 'L-1');
  for (const [i, t] of [0.2, 0.3, 0.4].entries()) {
    const s = attachComponent(doc, doc.runs[0].id, 'support', t);
    Object.assign(s, { component: 'U-BOLT', calloutText: `U-BOLT\nSUP-${i + 1}` });
  }
  doc.nodes[0].continuation = { text: "CONT'D ON\nDWG# X-1", coordinates: true };
  const first = draw(doc).positions.get(doc.nodes[0].id)!;
  doc.sheetNotes = [{ id: 'n1', spool: 'SP-1', text: '* FIELD NOTE BESIDE THE START', at: [first[0] - 40, first[1] - 30] }];
  const texts = draw(doc).primitives.filter((p): p is Extract<Primitive, { type: 'text' }> => p.type === 'text' && !!p.text.trim());
  const boxes = texts.map(t => textPoly(t.p, t.text, t.size, t.rotation, t.oblique, t.anchor, -0.25, t.width ?? 1));
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++)
      assert.ok(!overlaps(boxes[i], boxes[j]), `${JSON.stringify(texts[i].text)} overprints ${JSON.stringify(texts[j].text)}`);
});

test('held paper labels move their boxes and leaders without changing measured fabrication data', () => {
  const doc = newIso(), end = appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP-1', 'L');
  const run = doc.runs[0], start = doc.nodes.find(n => n.id === run.from)!;
  start.continuation = { text: 'CONTINUED ON\nDRAWING X-2', coordinates: false };
  const before = clone(doc), cut = runResult(doc, run).cut;
  const positions: Record<string, Point> = { [`continuation:${start.id}`]: [200,200], [`pipe-tag:${run.id}`]: [350,250], 'dimension:0': [500,300] };
  doc.sheets = { 'SP-1': { labelPositions: positions } };
  const drawing = createDrawing(doc);
  for (const [key, at] of Object.entries(positions)) {
    const text = drawing.primitives.find(p => p.type === 'text' && p.label?.key === key);
    assert.ok(text?.type === 'text', key);
    assert.deepEqual(text.label!.at, at);
    assert.equal(text.label!.spool, 'SP-1');
  }
  assert.deepEqual(doc.nodes, before.nodes);
  assert.equal(runResult(doc, run).cut, cut);
  assert.deepEqual(createDrawing(doc, '', 'iso', undefined, {model:true}).primitives,
    createDrawing(before, '', 'iso', undefined, {model:true}).primitives);
  const restored = parseIsoJson(JSON.stringify(doc));
  assert.deepEqual(createDrawing(restored).primitives, drawing.primitives);
  (restored.sheets!['SP-1'].labelPositions!['dimension:0'] as any)[0] = 'bad';
  assert.throws(() => parseIsoJson(JSON.stringify(restored)), /sheet information/);
  assert.ok(end.id);
});

test('a valve can letter its tag and operator above its boxed item number', async () => {
  const {applyComponent} = await import('../src/core/model.ts');
  const d = newIso(), valve = appendRun(d,null,[1000,0,0],'CS40',2,'SP-1','L');
  appendRun(d,valve.id,[1000,0,0],'CS40',2,'SP-1','L');
  applyComponent(d,valve,'BALL-FL'); valve.tag='HV-TEST';valve.operator='OPERATOR UP';valve.calloutOrder='tag-first';
  const text=createDrawing(d).primitives.find(p=>p.type==='text'&&p.label?.key===`item:${valve.id}`);
  assert.ok(text?.type==='text');
  assert.equal(text.text,'HV-TEST\nOPERATOR UP\n');
  const numberKey=`item-number:item:${valve.id}`,before=JSON.stringify(d.nodes);
  d.sheets={'SP-1':{labelPositions:{[numberKey]:[450,180]}}};
  const number=createDrawing(d).primitives.find(p=>p.type==='text'&&p.label?.key===numberKey);
  assert.ok(number?.type==='text');assert.match(number.text,/^\d+$/);assert.deepEqual(number.label?.at,[450,180]);
  assert.equal(JSON.stringify(d.nodes),before);
  assert.deepEqual(parseIsoJson(JSON.stringify(d)).nodes.find(n=>n.id===valve.id)?.calloutOrder,'tag-first');
  valve.calloutOrder='item-tag-first';
  const reordered=createDrawing(d).primitives.find(p=>p.type==='text'&&p.label?.key===`item:${valve.id}`);
  assert.ok(reordered?.type==='text');assert.equal(reordered.text,'\nHV-TEST\nOPERATOR UP');
  assert.equal(parseIsoJson(JSON.stringify(d)).nodes.find(n=>n.id===valve.id)?.calloutOrder,'item-tag-first');
});

test('explicit line numbers repeat on selected pipes with independent saved positions',()=>{
 const doc=newIso(),corner=appendRun(doc,null,[1000,0,0],'CS40',2,'SP-1','LINE-A');
 appendRun(doc,corner.id,[0,0,1000],'CS40',2,'SP-1','LINE-A');
 const count=(d:IsoDocument)=>createDrawing(d).primitives.filter(p=>p.type==='text'&&p.text==='LINE-A');
 assert.equal(count(doc).length,1);
 doc.runs.forEach(r=>{r.showLineNumber=true});
 const labels=count(doc);assert.equal(labels.length,2);
 const keys=labels.map(p=>p.type==='text'?p.label!.key:'');assert.equal(new Set(keys).size,2);
 doc.sheets={'SP-1':{labelPositions:{[keys[0]]:[200,150],[keys[1]]:[450,200]}}};
 const reopened=count(parseIsoJson(JSON.stringify(doc)));
 assert.deepEqual(reopened.map(p=>p.type==='text'?p.label!.at:[]),[[200,150],[450,200]]);
 doc.runs[1].showLineNumber=false;assert.equal(count(doc).length,1);
});

test('a held leader bend routes the continuation without moving its lettering or fabrication points',()=>{
  const doc=newIso(),end=appendRun(doc,null,[1000,0,0],'CS40',2,'SP-1','L');
  end.continuation={text:'CONTINUED ON\nISO-TEST-B',coordinates:false};
  const key=`continuation:${end.id}`,bend:Point=[500,220];
  doc.sheets={'SP-1':{labelPositions:{[key]:[300,180],[`leader:${key}`]:bend}}};
  const before=clone(doc),drawing=createDrawing(doc);
  assert.ok(drawing.primitives.some(p=>p.type==='line'&&p.layer==='LEADER'&&[p.a,p.b].some(q=>Math.hypot(q[0]-bend[0],q[1]-bend[1])<1e-6)));
  assert.deepEqual(doc.nodes,before.nodes);
  assert.deepEqual(createDrawing(parseIsoJson(JSON.stringify(doc))).primitives,drawing.primitives);
});
