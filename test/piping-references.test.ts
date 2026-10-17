import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, bom, clone, getNode, newIso, parseIsoJson, runResult, validateIso, welds, pruneSheetAnchors } from '../src/core/model.ts';
import { drawingReference } from '../src/core/references.ts';
import { sheetMaterials } from '../src/core/material-list.ts';
import { createDrawing } from '../src/core/drawing.ts';

const documents = () => {
  const host = newIso(); host.drawing = 'ISO-TEST-A'; host.coordinates = { origin: [0, 0, 0] };
  const end = appendRun(host, null, [1000, 0, 0], 'CS40', 2, 'S1', 'L');
  end.continuation = { text: "CONT'D ON TEST-B", coordinates: true };
  const source = newIso(); source.drawing = 'ISO-TEST-B'; source.coordinates = { origin: [1000, 0, 0] };
  const elbow = appendRun(source, null, [150, 0, 0], 'CS40', 2, 'S2', 'L');
  appendRun(source, elbow.id, [0, 0, 1000], 'CS40', 2, 'S2', 'L');
  return { host, end, source, elbow };
};

test('an adjacent drawing is thin reference geometry without fabrication quantities or extra sheets', () => {
  const {host, end, source} = documents();
  const before = clone(host), rows = sheetMaterials(host, 'S1');
  const reference = drawingReference(host, end.id, source);
  host.references = [reference];
  assert.equal(reference.nodes.find(n => n.id === reference.anchorNodeId)!.position[0], 1000);
  assert.deepEqual(sheetMaterials(host, 'S1'), rows);
  assert.deepEqual(bom(host), bom(before));
  assert.deepEqual(welds(host), welds(before));
  assert.equal(runResult(host, host.runs[0]).cut, runResult(before, before.runs[0]).cut);
  assert.deepEqual(validateIso(host), validateIso(before));
  const drawn = createDrawing(host, 'S1');
  const context = drawn.primitives.filter(p => reference.nodes.some(n => n.id === p.owner));
  assert.ok(context.length > 0);
  assert.ok(context.some(p=>p.type==='circle'&&p.layer==='WELD'&&p.fill),'adjacent welded fittings retain their drafting weld dots');
  assert.ok(context.filter(p => p.type !== 'text' && p.type !== 'image').every(p => (p.weight ?? 0.6) <= 0.6));
  assert.ok(!drawn.primitives.some(p => p.type === 'text' && /SHEET 1 OF 2/.test(p.text)));
  assert.deepEqual(parseIsoJson(JSON.stringify(host)).references, JSON.parse(JSON.stringify(host.references)));
  assert.deepEqual(host.nodes, before.nodes, 'rendering does not mutate the model');
});

test('a dimension may extend past a continuation to the next drawing fitting', () => {
  const {host, end, source, elbow} = documents();
  const reference = drawingReference(host, end.id, source);
  reference.dimensionTo = reference.nodes.find(n => n.id.endsWith(elbow.id))!.id;
  host.references = [reference];
  const texts = createDrawing(host, 'S1').primitives.flatMap(p => p.type === 'text' && p.layer === 'DIM' ? [p.text] : []);
  assert.ok(texts.includes('1000') && texts.includes('1150'), texts.join(' '));
  end.position = [2000, 0, 0];
  const moved = createDrawing(host, 'S1').primitives.flatMap(p => p.type === 'text' && p.layer === 'DIM' ? [p.text] : []);
  assert.ok(moved.includes('2150'), 'the reference follows its continuation when the pipe is resized');
});

test('invalid reference geometry and missing attachment points are rejected on reopen', () => {
  const {host, end, source} = documents(); host.references = [drawingReference(host, end.id, source)];
  host.references[0].atNodeId = 'missing';
  assert.throws(() => parseIsoJson(JSON.stringify(host)), /adjacent/i);
  host.references[0].atNodeId = end.id; host.references[0].runs[0].from = 'missing';
  assert.throws(() => parseIsoJson(JSON.stringify(host)), /Missing/);
});

test('reference symbols use the adjacent specification without changing the host catalogue', () => {
  const {host, end, source} = documents();
  const valve = getNode(source, source.runs[0].to);
  applyComponent(source, valve, 'BFLY-LUG');
  host.references = [drawingReference(host, end.id, source)];
  const reference = host.references[0];
  assert.ok(createDrawing(host, 'S1').primitives.some(p => p.type === 'polyline' && p.closed && p.points.length === 20 && p.owner?.endsWith(valve.id)));
});

test('a limited reference continues beyond its last component and ends with drafting breaks', () => {
  const {host, end, source, elbow} = documents();
  const far = source.nodes.at(-1)!;
  applyComponent(source, far, 'FLG-RFWN');
  const reference = drawingReference(host, end.id, source);
  host.references = [reference];
  reference.components = 1;
  let drawing = createDrawing(host, 'S1');
  assert.ok(drawing.primitives.some(p => p.type === 'polyline' && p.points.length === 13 && p.owner?.endsWith(elbow.id)),
    'a cut beyond the selected elbow shows that the neighbouring pipe continues');
  const quantities=sheetMaterials(host,'S1');
  reference.termination='plain';
  const plain=createDrawing(host,'S1');
  assert.ok(!plain.primitives.some(p=>p.type==='polyline'&&p.points.length===13&&reference.nodes.some(n=>n.id===p.owner)));
  assert.deepEqual(sheetMaterials(host,'S1'),quantities);
  assert.equal(parseIsoJson(JSON.stringify(host)).references![0].termination,'plain');
  const invalid=clone(host);(invalid.references![0] as any).termination='invalid';
  assert.throws(()=>parseIsoJson(JSON.stringify(invalid)),/adjacent/i);
  reference.termination='break';
  reference.components = 3;
  drawing = createDrawing(host, 'S1');
  const terminal = drawing.primitives.filter(p => p.owner?.endsWith(far.id));
  assert.ok(terminal.some(p => p.type === 'polyline' && p.points.length === 13));
  assert.ok(!terminal.some(p => p.type === 'polyline' && p.closed), 'the distant terminal flange is beyond the context cut');
});


test('pipe-only reference context cuts before its first fitting and never draws that fitting', () => {
  const {host,end,source,elbow}=documents();
  applyComponent(source,elbow,'GATE-FL');
  const reference=drawingReference(host,end.id,source);reference.components=0;host.references=[reference];
  const before=sheetMaterials(host,'S1'),drawing=createDrawing(host,'S1');
  const marks=drawing.primitives.filter(p=>reference.nodes.some(n=>n.id===p.owner));
  assert.ok(marks.some(p=>p.type==='line'));
  assert.ok(marks.some(p=>p.type==='polyline'&&p.points.length===13));
  assert.ok(!marks.some(p=>p.type==='polyline'&&p.closed),'the remote valve is beyond the cut');
  assert.deepEqual(sheetMaterials(host,'S1'),before);
  assert.equal(parseIsoJson(JSON.stringify(host)).references![0].components,0);
});


test('context pipe can use its pipe pen without adding purchased material or weld quantities', () => {
  const {host,end,source}=documents(),reference=drawingReference(host,end.id,source);host.references=[reference];
  const material=sheetMaterials(host,'S1'),count=welds(host).length;
  const weights=()=>createDrawing(host,'S1').primitives.filter(p=>p.type==='line'&&reference.nodes.some(n=>n.id===p.owner)).map(p=>p.type==='line'?p.weight??0:0);
  const fine=weights();reference.pipeWeight=true;const heavy=weights();
  assert.ok(Math.max(...heavy)>Math.max(...fine)*2);
  assert.deepEqual(sheetMaterials(host,'S1'),material);assert.equal(welds(host).length,count);
  assert.equal(parseIsoJson(JSON.stringify(host)).references![0].pipeWeight,true);
});


test('a context fragment can stop at a flanged valve without laying out its unshown pipe', () => {
  const {host,end}=documents(),source=newIso();source.drawing='NEXT-DEMO';source.coordinates={origin:[1000,0,0]};
  const valve=appendRun(source,null,[200,0,0],'CS40',2,'S2','L');appendRun(source,valve.id,[1000,0,0],'CS40',2,'S2','L');applyComponent(source,valve,'GATE-FL');
  const ref=drawingReference(host,end.id,source);ref.components=1;host.references=[ref];
  assert.doesNotThrow(()=>createDrawing(host,'S1'));
  assert.ok(createDrawing(host,'S1').primitives.some(p=>p.type==='polyline'&&p.closed&&p.owner?.endsWith(valve.id)));
});

test('a skewed single span can dimension through its continuation to the adjacent fitting', () => {
  const host=newIso(),a=appendRun(host,null,[1000,0,0],'CS40',2,'S1','L1'),end=appendRun(host,a.id,[-300,300,0],'CS40',2,'S1','L1');
  const source=newIso(),tee=appendRun(source,null,[-100,100,0],'CS40',2,'S2','L1');
  appendRun(source,tee.id,[-200,200,0],'CS40',2,'S2','L1');appendRun(source,tee.id,[0,0,300],'CS40',2,'S2','L1');applyComponent(source,tee,'W-TEE');
  const ref=drawingReference(host,end.id,source,source.nodes[0].id);ref.dimensionTo=ref.nodes.find(n=>n.id.endsWith(tee.id))!.id;host.references=[ref];
  const cuts=host.runs.map(r=>runResult(host,r).cut),labels=createDrawing(host,'S1').primitives.flatMap(p=>p.type==='text'&&p.layer==='DIM'?[p.text]:[]);
  assert.ok(labels.includes('566'),labels.join(' '));assert.ok(!labels.includes('424'),labels.join(' '));
  assert.deepEqual(host.runs.map(r=>runResult(host,r).cut),cuts);
});


test('adjacent line lettering is opt-in and paper anchors survive pruning unrelated geometry', () => {
  const {host,end,source}=documents(),ref=drawingReference(host,end.id,source);host.references=[ref];
  const quantities=sheetMaterials(host,'S1');
  for(const run of ref.runs)run.showLineNumber=true;
  const labels=createDrawing(host,'S1').primitives.filter(p=>p.type==='text'&&p.label?.key.startsWith('reference-line:'));
  assert.equal(labels.length,1);assert.equal(labels[0].type==='text'&&labels[0].text,'L');
  assert.deepEqual(sheetMaterials(host,'S1'),quantities);
  host.sheets={S1:{nodePositions:{[ref.nodes[1].id]:[200,100],deleted:[1,2]}}};pruneSheetAnchors(host);
  assert.deepEqual(host.sheets.S1.nodePositions![ref.nodes[1].id],[200,100]);assert.equal(host.sheets.S1.nodePositions!.deleted,undefined);
  assert.equal(parseIsoJson(JSON.stringify(host)).references![0].runs[0].showLineNumber,true);
});
