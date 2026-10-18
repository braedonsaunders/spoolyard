import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, attachComponent, getNode, newIso, parseIsoJson, type IsoDocument } from '../src/core/model.ts';
import { createDrawing, type Primitive } from '../src/core/drawing.ts';
import { cadStrokeWidth, measureText, strokeText } from '../src/core/stroke-font.ts';
import { discValve, insulationWords, operatorDirection } from '../src/core/iso/symbols.ts';
import { draftingSizes, nodeBore } from '../src/core/iso/context.ts';
import { discGeometry, flangedGeometry, reducerGeometry } from '../src/core/iso/valve-conventions.ts';

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
    applyComponent(doc, mid, 'CHECK-SC'); mid.valveSymbol = 'triangle';
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

test('a held flow arrow moves along its pipe and stays clear of an inline fitting', () => {
  const doc = sheet();
  appendRun(doc, null, [inch(60), 0, 0], 'CS40', 2, 'S1', 'L1');
  const run = doc.runs[0];
  run.flow = 'forward';
  const station = (fraction: number) => {
    run.flowPosition = fraction;
    const d = createDrawing(doc, 'S1'), a = d.positions.get(run.from)!, b = d.positions.get(run.to)!;
    const arrow = symbols(owned(d.primitives, run.id)).find(p => p.fill)!;
    const tip = arrow.points[0], span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { fraction: ((tip[0] - a[0]) * (b[0] - a[0]) + (tip[1] - a[1]) * (b[1] - a[1])) / span ** 2, tip, d };
  };
  assert.ok(station(0.75).fraction - station(0.25).fraction > 0.45);
  const fitting = attachComponent(doc, run.id, 'olet', 0.5);
  applyComponent(doc, fitting, 'SOL');
  const held = station(0.5), at = held.d.positions.get(fitting.id)!;
  assert.ok(Math.hypot(held.tip[0] - at[0], held.tip[1] - at[1]) > 6, 'arrow clears the fitting opening');
  assert.equal(parseIsoJson(JSON.stringify(doc)).runs[0].flowPosition, 0.5);
  run.flowPosition = 1.1;
  assert.throws(() => parseIsoJson(JSON.stringify(doc)), /flow arrow position/);
});

test('equipment outlines and labels honor held paper positions without moving plant geometry', () => {
  const doc = sheet();
  appendRun(doc, null, [inch(48), 0, 0], 'CS40', 2, 'S1', 'L1');
  const equipment = attachComponent(doc, doc.runs[0].id, 'annotation', 1);
  applyComponent(doc, equipment, 'EQUIP');
  equipment.equipmentShape = 'pump';
  equipment.tag = 'P-DEMO';
  const plant = [...equipment.position];
  doc.sheets = { S1: { nodePositions: { [equipment.id]: [500, 400] }, labelPositions: { [`equipment:${equipment.id}`]: [500, 360] } } };
  const first = owned(draw(doc), equipment.id);
  const label = texts(first).find(t => t.text === 'P-DEMO')!;
  assert.deepEqual(label.label?.at, [500, 360]);
  assert.ok(first.some(p => p.type === 'line' && Math.abs(p.a[0] - 500) < 26 && Math.abs(p.a[1] - 400) < 26));
  equipment.equipmentShape = 'vessel';
  assert.notDeepEqual(owned(draw(doc), equipment.id).filter(p => p.type === 'line'), first.filter(p => p.type === 'line'));
  assert.deepEqual(equipment.position, plant);
  assert.equal(parseIsoJson(JSON.stringify(doc)).nodes.find(n => n.id === equipment.id)!.equipmentShape, 'vessel');
});

test('a butterfly symbol is the drafter\'s choice, never read from its description; older drawings are migrated once', () => {
  const doc = sheet(), { mid } = straight(doc);
  applyComponent(doc, mid, 'BFLY-LUG');
  mid.description = 'ACTUATED BUTTERFLY VALVE';
  assert.equal(discValve(doc, mid), true);
  const legacy = JSON.parse(JSON.stringify(doc)); delete legacy.draftingRules;
  const migrated = parseIsoJson(JSON.stringify(legacy)).nodes.find(n => n.id === mid.id)!;
  assert.deepEqual([migrated.valveSymbol, migrated.valveOperator], ['bowtie', 'actuator']);
  delete mid.description;
  const before = JSON.stringify(doc.runs);
  mid.valveSymbol = 'disc';
  assert.equal(discValve(doc, mid), true);
  // Its disc stands open between the faces, an outline on the pipe's centreline.
  assert.ok(symbols(owned(draw(doc), mid.id)).some(p => p.closed && !p.fill && p.points.length === 24));
  assert.equal(parseIsoJson(JSON.stringify(doc)).nodes.find(n => n.id === mid.id)!.valveSymbol, 'disc');
  mid.valveSymbol = 'bowtie';
  assert.equal(discValve(doc, mid), false);
  const withOperator=owned(draw(doc),mid.id).filter(p=>p.layer==='SYMBOL');
  mid.valveOperator='none';
  const withoutOperator=owned(draw(doc),mid.id).filter(p=>p.layer==='SYMBOL');
  assert.ok(withoutOperator.length<withOperator.length);
  assert.equal(parseIsoJson(JSON.stringify(doc)).nodes.find(n=>n.id===mid.id)!.valveOperator,'none');
  const invalid=JSON.parse(JSON.stringify(doc));invalid.nodes.find((n:{id:string})=>n.id===mid.id).valveOperator='invalid';
  assert.throws(()=>parseIsoJson(JSON.stringify(invalid)));
  assert.equal(JSON.stringify(doc.runs), before);
});

test('valve types are told apart: a globe dot, a ball and lever, a plug, a plain gate', () => {
  const marks = (code: string) => {
    const doc = sheet(), { mid } = straight(doc, 'THD', 1);
    applyComponent(doc, mid, code);
    const p = owned(draw(doc), mid.id);
    return { dot: p.filter(q => q.type === 'circle' && q.fill).length, ball: symbols(p).filter(q => q.closed && !q.fill && q.points.length === 32).length, plug: symbols(p).filter(q => q.fill).length };
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
  const box = symbols(union).find(q => q.closed && q.points.length === 4)!;
  const centre = (a: [number,number], b: [number,number]) => a.map((v,i)=>(v+b[i])/2);
  const a=centre(box.points[0],box.points[3]),b=centre(box.points[1],box.points[2]);
  assert.ok(union.some(q=>q.type==='line'&&Math.hypot(q.a[0]-a[0],q.a[1]-a[1])<1e-6&&Math.hypot(q.b[0]-b[0],q.b[1]-b[1])<1e-6),'the union centre stroke runs along the pipe between its end faces');
  // A tick across each pipe where it screws into the union.
  assert.equal(union.filter(q => q.type === 'line' && q.weight === cadStrokeWidth('tabloid')).length, 2);
});

test('sockolets are a body on the header; U-bolts a cross and rod; flow arrows and AR filled; open ends get no break', () => {
  const doc = sheet(), { mid, end } = straight(doc, 'BW', 2);
  const olet = attachComponent(doc, doc.runs[0].id, 'olet', 0.5);
  applyComponent(doc, olet, 'SOL');
  appendRun(doc, olet.id, [0, 0, inch(6)], 'CS40', 0.75, 'S1', 'L1', 'SW');
  const ubolt = attachComponent(doc, doc.runs[1].id, 'support', 0.3); ubolt.component = 'U-BOLT';
  const arrow = attachComponent(doc, doc.runs[1].id, 'annotation', 0.7); arrow.component = 'AR';
  end.continuation = { text: 'OPEN END', termination: 'open' };
  const p = draw(doc);
  assert.ok(polys(owned(p, olet.id)).some(q => q.closed && q.points.length === 6));
  assert.equal(owned(p, ubolt.id).filter(q => q.type === 'line').length, 3);
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
  assert.ok(polys(owned(p,ins.id)).some(q=>q.points.length===17));
  const lettering=texts(owned(p,ins.id))[0];assert.ok(lettering.size<draftingSizes(doc).text);
  doc.sheets={S1:{labelPositions:{[`insulation:${ins.id}`]:[300,200]}}};
  assert.deepEqual(texts(owned(draw(doc),ins.id))[0].label?.at,[300,200]);
  assert.deepEqual(texts(owned(p, limit.id)).map(t => t.text), ['INSUL.', 'NONE']);
  assert.deepEqual(texts(owned(p, wall.id)).map(t => t.text), ['WALL']);
  assert.deepEqual(insulationWords('INSUL. <- -> NONE'), ['INSUL.', 'NONE']);
  assert.deepEqual(insulationWords('NONE | INSUL.'), ['NONE', 'INSUL.']);
  const position=[...limit.position];doc.sheets.S1.nodePositions={[limit.id]:[250,150]};
  doc.sheets.S1.labelPositions![`insulation-limit:${limit.id}:0`]=[260,140];
  const moved=owned(draw(doc),limit.id);
  assert.deepEqual(texts(moved).find(t=>t.text==='INSUL.')!.label!.at,[260,140]);
  assert.ok(moved.some(p=>p.layer==='LEADER'));assert.deepEqual(limit.position,position);
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
    for (const p of strokeText(tag.text,{at:tag.p,size:tag.size,rotation:tag.rotation,oblique:tag.oblique,anchor:tag.anchor}).flat()) {
      const crosses=box.points.map((a,i)=>{const b=box.points[(i+1)%box.points.length];return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);});
      assert.ok(crosses.every(v=>v>=-0.01)||crosses.every(v=>v<=0.01),'every ink stroke stays inside the tight box');
    }
    if (delta[2]) assert.equal(Math.abs(tag.rotation ?? 0), 90);
  }
});

test('support lettering can follow the pipe plane and retains its drawing choice when reopened', () => {
  const doc=sheet();
  appendRun(doc,null,[inch(48),0,0],'CS40',2,'S1','L1');
  const support=attachComponent(doc,doc.runs[0].id,'support',0.5);
  support.component='U-BOLT';support.calloutText='U-BOLT\n(DEMO-01)';
  assert.equal(texts(owned(draw(doc),support.id))[0].rotation,undefined);
  const before=JSON.stringify(doc.runs);
  support.calloutPlane='pipe';
  const label=texts(owned(draw(doc),support.id))[0];
  assert.ok(Math.abs(Math.abs(label.rotation!)-30)<0.01);
  assert.ok(Math.abs(label.oblique!)>20);
  assert.equal(parseIsoJson(JSON.stringify(doc)).nodes.find(n=>n.id===support.id)!.calloutPlane,'pipe');
  assert.equal(JSON.stringify(doc.runs),before);
});

test('size labels follow a size change along a straight and stand with the item where the size changes', () => {
  const doc = sheet();
  const red = appendRun(doc, null, [inch(30), 0, 0], 'CS40', 3, 'S1', 'L1');
  appendRun(doc, red.id, [inch(30), 0, 0], 'CS40', 2, 'S1', 'L1');
  applyComponent(doc, red, 'C-RED');
  const drawing=createDrawing(doc,'S1'),at=drawing.positions.get(red.id)!,end=drawing.positions.get(doc.runs[1].to)!,u=[end[0]-at[0],end[1]-at[1]],length=Math.hypot(...u);
  const outline=symbols(owned(drawing.primitives,red.id)).find(p=>p.closed&&p.points.length===4)!;
  const stations=outline.points.map(p=>((p[0]-at[0])*u[0]+(p[1]-at[1])*u[1])/length);
  const half=reducerGeometry(doc,red).halfLength;assert.ok(Math.abs((stations[1]+stations[2])/2-half)<.001&&Math.abs((stations[0]+stations[3])/2+half)<.001);
  const all = texts(drawing.primitives).map(t => t.text);
  assert.ok(all.includes('3" NS') && all.includes('2" NS'));
  assert.ok(all.some(t => t.trim()==='3"X2" NS'), 'the reducer size stands below its separately movable number');
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

test('flanged joints carry the gasket hache mark, and the next spool is drawn thin beyond a shared point', () => {
  const doc = sheet(), { mid, end } = straight(doc);
  applyComponent(doc, mid, 'FLG-RFWN');
  // The hache mark is three short lines across the pipe.
  const sheet0 = createDrawing(doc, 'S1');
  // Across a level pipe means upright on the page.
  const hache = owned(sheet0.primitives, mid.id).filter(q => q.type === 'line' && q.layer === 'SYMBOL' && Math.abs(q.b[0] - q.a[0]) < 1e-6);
  assert.equal(hache.length, 3);
  // The line runs on into spool S2 through a gate valve; S1 draws it thin, untagged, with no break.
  const valve = appendRun(doc, end.id, [inch(24), 0, 0], 'CS40', 2, 'S2', 'L1');
  appendRun(doc, valve.id, [inch(24), 0, 0], 'CS40', 2, 'S2', 'L1');
  applyComponent(doc, end, 'FLG-RFWN'); end.continuation = { text: "CONT'D ON\nDWG# X-2" };
  applyComponent(doc, valve, 'GATE-FL');
  const p = draw(doc), ghost = owned(p, valve.id);
  assert.ok(ghost.length > 0 && ghost.every(q => q.type !== 'text' && (q.type === 'line' || q.type === 'polyline' || q.type === 'circle') && (q.weight ?? 1) <= draftingSizes(doc).thin + 1e-9));
  assert.equal(owned(p, end.id).some(q => q.type === 'polyline' && q.points.length === 13), false, 'no S-break where the next spool is drawn');
});

test('centreline elevations at every change of level are a style option, off by default', () => {
  const doc = sheet();
  const elbow = appendRun(doc, null, [inch(30), 0, 0], 'CS40', 2, 'S1', 'L1');
  appendRun(doc, elbow.id, [0, 0, inch(30)], 'CS40', 2, 'S1', 'L1');
  const elevations = () => texts(owned(draw(doc), elbow.id)).filter(t => t.text.startsWith('℄ EL')).length;
  doc.style = { layout: 'schematic', weldNumbers: false, lettering: 'cad' };
  assert.equal(elevations(), 0);
  doc.style.elevations = true;
  assert.equal(elevations(), 1);
  delete doc.coordinates;
  assert.equal(elevations(), 0);
});

test('schematic fitting welds retain their block size when a long pipe is compressed', () => {
  for(const nps of [2,3]){
    const doc=sheet();
    const elbow=appendRun(doc,null,[inch(100),0,0],'CS40',nps,'S1','L1');
    const end=appendRun(doc,elbow.id,[0,0,inch(200)],'CS40',nps,'S1','L1');
    applyComponent(doc,elbow,'W-LR90EL');
    const start=getNode(doc,doc.runs[0].from);
    doc.sheets={S1:{nodePositions:{[start.id]:[200,500],[elbow.id]:[500,400],[end.id]:[500,100]}}};
    const d=createDrawing(doc,'S1'),at=d.positions.get(elbow.id)!;
    const circles=owned(d.primitives,elbow.id).filter((p):p is Extract<Primitive,{type:'circle'}>=>p.type==='circle'&&p.layer==='WELD');
    assert.equal(circles.length,2);
    const size=draftingSizes(doc),block=nodeBore(doc,elbow)*1.14*size.text;
    assert.ok(circles.every(p=>Math.abs(Math.hypot(p.p[0]-at[0],p.p[1]-at[1])-block)<0.01));
    assert.ok(circles.every(p=>p.r===size.weld), 'one shop weld dot size for every bore');
  }
});


test('separate flanges across a gasket face their own pipes and retain thin plates', () => {
  const doc=sheet();
  const a=appendRun(doc,null,[0,0,1000],'CS40',2,'S1','L1');
  const b=appendRun(doc,a.id,[0,0,2],'CS40',2,'S1','L1');
  doc.runs[1].connector=true;
  applyComponent(doc,a,'FLG-RFWN');applyComponent(doc,b,'FLG-RFWN');
  const root=doc.runs[0].from;
  doc.sheets={S1:{nodePositions:{[root]:[300,600],[a.id]:[300,300],[b.id]:[300,290]}}};
  const before=JSON.stringify(doc.runs),d=draw(doc);
  const plates=(node:string)=>symbols(owned(d,node)).filter(p=>p.closed&&p.points.length===4&&!p.fill);
  assert.ok(plates(a.id).length&&plates(b.id).length);
  assert.ok(plates(a.id).every(p=>p.points.every(q=>q[1]>295)), 'first flange faces the lower pipe');
  assert.ok(plates(b.id).every(p=>p.points.every(q=>q[1]<295)), 'mating flange faces away from the gasket');
  for(const plate of [...plates(a.id),...plates(b.id)]){
    const edges=plate.points.map((p,i)=>Math.hypot(p[0]-plate.points[(i+1)%4][0],p[1]-plate.points[(i+1)%4][1]));
    assert.ok(Math.min(...edges)<1,'a flange is a thin plate, rather than a solid block');
  }
  assert.equal(JSON.stringify(doc.runs),before);
});


test('a line identifier on a riser is lettered in its isometric plane', () => {
  const d=sheet();appendRun(d,null,[0,0,1000],'CS40',2,'S1','LINE-DEMO');
  const line=texts(draw(d)).find(p=>p.label?.key==='line:LINE-DEMO')!;
  assert.ok(line);
  assert.ok(Math.abs(Math.abs(line.rotation??0)-90)<.01);
  assert.ok(Math.abs(Math.abs(line.oblique??0)-30)<.01);
  d.runs[0].lineNumberPlane='alternate';
  const other=texts(draw(d)).find(p=>p.label?.key==='line:LINE-DEMO')!;
  assert.ok(Math.abs((line.oblique??0)+(other.oblique??0))<.01);
  assert.notEqual(other.oblique,line.oblique);
  assert.equal(parseIsoJson(JSON.stringify(d)).runs[0].lineNumberPlane,'alternate');
});


test('line-number lettering can use the plan plane without changing the measured route', () => {
  const d=sheet();appendRun(d,null,[0,-1500,0],'CS40',2,'S1','LINE-DEMO');
  const r=d.runs[0],before=JSON.stringify(d.nodes),original=texts(draw(d)).find(p=>p.label?.key==='line:LINE-DEMO')!;
  r.lineNumberPlane='plan';const changed=texts(draw(d)).find(p=>p.label?.key==='line:LINE-DEMO')!;
  assert.equal(changed.rotation,original.rotation);
  assert.ok(Math.abs((changed.oblique??0)-(original.oblique??0))>50);
  assert.equal(JSON.stringify(d.nodes),before);
  assert.equal(parseIsoJson(JSON.stringify(d)).runs[0].lineNumberPlane,'plan');
  r.lineNumberPlane='normal';assert.ok(Math.abs(texts(draw(d)).find(p=>p.label?.key==='line:LINE-DEMO')!.oblique??0)<.01);
  const invalid=JSON.parse(JSON.stringify(d));invalid.runs[0].lineNumberPlane='invalid';
  assert.throws(()=>parseIsoJson(JSON.stringify(invalid)));
});


test('a connector into an instrument is thin fitting linework while purchased pipe stays heavy', () => {
  const d=sheet(),{mid}=straight(d,'THD',1);d.runs[1].connector=true;
  applyComponent(d,mid,'BALL-SC');
  const pi=attachComponent(d,d.runs[1].id,'annotation',1);Object.assign(pi,{component:'ISA-BUBBLE',tag:'PI'});
  const marks=draw(d).filter(p=>p.owner===d.runs[1].id);
  assert.ok(marks.some(p=>p.type==='line'&&p.layer==='SYMBOL'&&p.weight===cadStrokeWidth('tabloid')));
  assert.ok(!marks.some(p=>p.layer==='PIPE'));
  d.runs[1].connector=false;
  assert.ok(draw(d).some(p=>p.owner===d.runs[1].id&&p.layer==='PIPE'));
});


test('an issued instrument bubble may lie in the pipe plane while its tag stays upright', () => {
  const d=sheet();straight(d,'THD',1);const pi=attachComponent(d,d.runs[1].id,'annotation',1);
  Object.assign(pi,{component:'ISA-BUBBLE',tag:'PI',calloutPlane:'pipe'});
  d.sheets={S1:{labelPositions:{[`bubble:${pi.id}`]:[200,300]}}};
  const p=owned(draw(d),pi.id),ring=polys(p).find(p=>p.closed&&p.points.length===36)!;
  const width=Math.max(...ring.points.map(q=>q[0]))-Math.min(...ring.points.map(q=>q[0]));
  const height=Math.max(...ring.points.map(q=>q[1]))-Math.min(...ring.points.map(q=>q[1]));
  assert.ok(Math.abs(width-height)>3);
  const tag=texts(p).find(p=>p.text==='PI')!;assert.equal(tag.rotation,undefined);assert.deepEqual(tag.label?.at,[200,300]);
  assert.equal(parseIsoJson(JSON.stringify(d)).nodes.find(n=>n.id===pi.id)!.calloutPlane,'pipe');
});


test('sloping pipe tags are wider rectangles with lettering normal to their pipe', () => {
  const d=sheet();appendRun(d,null,[1500,0,0],'CS40',2,'S1','LINE-DEMO');
  const run=d.runs[0],p=draw(d),label=texts(p).find(p=>p.label?.key===`pipe-tag:${run.id}`)!;
  const box=polys(p).find(p=>p.layer==='TAG'&&p.owner===run.id&&p.closed)!;
  assert.equal(Math.round(label.oblique??0),0);
  const edges=box.points.map((p,i)=>[box.points[(i+1)%4][0]-p[0],box.points[(i+1)%4][1]-p[1]]);
  assert.ok(Math.abs(edges[0][0]*edges[1][0]+edges[0][1]*edges[1][1])<1e-6);
  const lengths=edges.map(p=>Math.hypot(...p)),T=draftingSizes(d).text;assert.ok(Math.max(...lengths)>1.5*T&&Math.min(...lengths)<1.3*T);
});


test('the drafter can choose the pipe carrying a line identifier without changing its route', () => {
  const d=sheet(),corner=appendRun(d,null,[3000,0,0],'CS40',2,'S1','LINE-DEMO');
  appendRun(d,corner.id,[0,0,500],'CS40',2,'S1','LINE-DEMO');
  const before=JSON.stringify(d.nodes);
  d.runs[1].showLineNumber=true;
  const label=texts(draw(d)).find(p=>p.label?.key==='line:LINE-DEMO')!;
  assert.equal(label.owner,d.runs[1].id);assert.equal(JSON.stringify(d.nodes),before);
  assert.equal(parseIsoJson(JSON.stringify(d)).runs[1].showLineNumber,true);
  for(const r of d.runs)r.showLineNumber=false;
  assert.ok(!texts(draw(d)).some(p=>p.label?.key==='line:LINE-DEMO'));
});


test('disc body planes keep their isometric projection on diagonal level pipes', () => {
  // A level diagonal is drawn foreshortened or stretched by its isometric projection, the body planes with it.
  for (const [nps, direction, axial] of [[3, [1,-1,0], Math.sqrt(1.5)], [2, [1,1,0], Math.SQRT1_2]] as const) {
    const doc=sheet(); doc.style={...doc.style!,layout:'schematic'};
    const step=direction.map(v=>v*inch(24)) as [number,number,number];
    const mid=appendRun(doc,null,step,'CS40',nps,'S1','L1');
    appendRun(doc,mid.id,step,'CS40',nps,'S1','L1');
    applyComponent(doc,mid,'BFLY-LUG'); mid.valveSymbol='disc'; mid.valveOperator='none';
    const halfSpan=discGeometry(doc,mid).body*axial;
    const before=JSON.stringify(doc.runs), drawing=createDrawing(doc,'S1'), centre=drawing.positions.get(mid.id)!;
    const end=drawing.positions.get(doc.runs[1].to)!, dx=end[0]-centre[0],dy=end[1]-centre[1],length=Math.hypot(dx,dy);
    const stations=drawing.primitives.filter(p=>p.type==='line'&&p.owner===mid.id&&p.layer==='SYMBOL')
      .map(p=>{if(p.type!=='line')return 0;return ((p.a[0]+p.b[0]-2*centre[0])*dx+(p.a[1]+p.b[1]-2*centre[1])*dy)/(2*length)});
    for(const sign of [-1,1])assert.ok(stations.some(s=>Math.abs(s-sign*halfSpan)<.001), `body plane at ${sign*halfSpan}`);
    assert.equal(JSON.stringify(doc.runs),before);
  }
});


test('a flexible continuation follows a held paper route without moving its plant endpoint', () => {
  const d=sheet();const end=appendRun(d,null,[1000,0,0],'CS40',2,'S1','L1');
  const before=JSON.stringify(d.nodes.map(n=>n.position)),path:[number,number][]=[[500,350],[525,375],[520,400],[540,425]];
  end.continuation={text:'CONNECT TO TEST EQUIPMENT',coordinates:false,paperPath:path,endMarker:'tube'};
  const drawing=draw(d),route=polys(owned(drawing,end.id)).find(p=>JSON.stringify(p.points)===JSON.stringify(path));
  assert.ok(route);assert.equal(route.layer,'SYMBOL');
  assert.ok(polys(owned(drawing,end.id)).some(p=>p.closed&&p.points.every(q=>q[0]>530&&q[1]>415)));
  assert.deepEqual(parseIsoJson(JSON.stringify(d)).nodes.find(n=>n.id===end.id)!.continuation?.paperPath,path);
  assert.equal(JSON.stringify(d.nodes.map(n=>n.position)),before);
  end.continuation.paperPath=[[0,0],[NaN,0]];assert.throws(()=>parseIsoJson(JSON.stringify(d)),/callout/i);
});


test('an inline instrument bubble keeps its drafting diameter for a long equipment tag', () => {
  const doc=sheet(),{mid}=straight(doc);applyComponent(doc,mid,'FLOWMETER-FL');mid.tag='FLOW-DEMO-1234';
  const ring=polys(owned(draw(doc),mid.id)).find(p=>p.layer==='TAG'&&p.closed&&p.points.length===36)!;
  assert.ok(ring);
  assert.ok(Math.abs(Math.max(...ring.points.map(p=>p[0]))-Math.min(...ring.points.map(p=>p[0]))-5.7*draftingSizes(doc).text)<.001);
  assert.ok(texts(owned(draw(doc),mid.id)).some(p=>p.text===mid.tag));
  const drawing=createDrawing(doc,'S1'),at=drawing.positions.get(mid.id)!,arrow=polys(owned(drawing.primitives,mid.id)).find(p=>p.layer==='LEADER'&&p.fill)!;
  assert.ok(Math.hypot(arrow.points[0][0]-at[0],arrow.points[0][1]-at[1])>5,'the leader meets the casing edge');
});


test('the drafter can choose which flanged fitting carries a shared nominal-size label', () => {
  const doc=sheet(),{mid,end}=straight(doc);appendRun(doc,end.id,[inch(24),0,0],'CS40',2,'S1','L1');
  applyComponent(doc,mid,'FLOWMETER-FL');applyComponent(doc,end,'BFLY-LUG');doc.style!.stackSizeLabels=true;
  for(const n of [mid,end])n.portFlanges=Object.fromEntries(doc.runs.filter(r=>r.from===n.id||r.to===n.id).map(r=>[r.id,{component:'FLG-FFLJ'}]));
  mid.showSize=false;end.showSize=true;
  const labels=texts(draw(doc)).filter(p=>p.text.includes('2" NS')&&p.label?.key.startsWith('stub:'));
  assert.equal(labels.length,1);assert.ok(labels[0].label!.key.includes(end.id));
  assert.equal(parseIsoJson(JSON.stringify(doc)).nodes.find(n=>n.id===mid.id)!.showSize,false);
  const bare=sheet();appendRun(bare,null,[1000,0,0],'CS40',2,'S1','L1');bare.runs[0].showSize=false;
  assert.ok(!texts(draw(bare)).some(p=>p.text.includes('2" NS')));
});


test('a flanged hose shows its corrugations and only the mating plate supplied on this drawing', () => {
  const doc=sheet(),{mid}=straight(doc,'BW',3);applyComponent(doc,mid,'HOSE-FL');
  const first=symbols(owned(draw(doc),mid.id)),plates=first.filter(p=>p.closed&&p.points.length===4);
  assert.equal(plates.length,2);assert.equal(first.filter(p=>!p.closed&&p.points.length===9).length,2);
  mid.portFlanges={[doc.runs[1].id]:{component:'NONE',gasket:true,bolts:true}};
  const route=JSON.stringify(doc.runs),shown=symbols(owned(draw(doc),mid.id));
  assert.equal(shown.filter(p=>p.closed&&p.points.length===4).length,1);assert.equal(JSON.stringify(doc.runs),route);
  const valveDoc=sheet(),{mid:valve}=straight(valveDoc,'BW',3);applyComponent(valveDoc,valve,'BFLY-LUG');valve.valveSymbol='bowtie';
  const d=createDrawing(valveDoc,'S1'),at=d.positions.get(valve.id)!,end=d.positions.get(valveDoc.runs[1].to)!,u=[end[0]-at[0],end[1]-at[1]],len=Math.hypot(...u);
  const centres=symbols(owned(d.primitives,valve.id)).filter(p=>p.closed&&p.points.length===4).map(p=>{const c=p.points.reduce((a,b)=>[a[0]+b[0]/4,a[1]+b[1]/4],[0,0]);return ((c[0]-at[0])*u[0]+(c[1]-at[1])*u[1])/len});
  const T=draftingSizes(valveDoc).text,plate=flangedGeometry(valveDoc,valve).plate-(nodeBore(valveDoc,valve)-1)*0.083*T/2;
  assert.ok(centres.some(x=>Math.abs(Math.abs(x)-plate)<.001));
});


test('a fitting can lie in plan independently of its measured pipe ports', () => {
  const doc=sheet(), {start}=straight(doc);applyComponent(doc,start,'FLG-FFLJ');
  const physical=JSON.stringify(doc.nodes.map(n=>n.position));
  start.symbolPlane='vertical';const vertical=symbols(owned(draw(doc),start.id));
  start.symbolPlane='plan';const plan=symbols(owned(draw(doc),start.id));
  assert.notDeepEqual(plan,vertical);
  assert.ok(plan.some(p=>p.points.some((v,i)=>i&&Math.abs(v[0]-p.points[i-1][0])>1&&Math.abs(v[1]-p.points[i-1][1])>1)));
  assert.equal(JSON.stringify(doc.nodes.map(n=>n.position)),physical);
  assert.equal(parseIsoJson(JSON.stringify(doc)).nodes.find(n=>n.id===start.id)!.symbolPlane,'plan');
  (start as any).symbolPlane='arbitrary';assert.throws(()=>parseIsoJson(JSON.stringify(doc)));
});

test('a purchased hose follows an editable paper centreline without changing its measured ports', () => {
  const doc=sheet(),{mid}=straight(doc,'THD',1);applyComponent(doc,mid,'HOSE-SC');
  for(const run of doc.runs)run.connector=true;
  const before=JSON.stringify({runs:doc.runs,positions:doc.nodes.map(n=>n.position)});
  const path:[number,number][]=[[400,300],[402,310],[398,320],[405,330],[410,340]];
  mid.hosePath=path;
  const d=draw(doc);assert.ok(symbols(owned(d,mid.id)).some(p=>JSON.stringify(p.points)===JSON.stringify(path)));
  assert.ok(!d.some(p=>p.type==='line'&&p.layer==='PIPE'&&doc.runs.some(r=>r.id===p.owner)));
  assert.ok(!d.some(p=>p.type==='text'&&p.layer==='DIM'));
  assert.equal(JSON.stringify({runs:doc.runs,positions:doc.nodes.map(n=>n.position)}),before);
  assert.deepEqual(parseIsoJson(JSON.stringify(doc)).nodes.find(n=>n.id===mid.id)!.hosePath,path);
  mid.hosePath=[[0,0],[Infinity,10]];assert.throws(()=>parseIsoJson(JSON.stringify(doc)));
});

test('a pipe size can be repeated at another connection without changing its model size', () => {
  const doc=sheet(),{end}=straight(doc);appendRun(doc,end.id,[0,0,1000],'CS40',2,'S1','L1');
  const values=()=>texts(draw(doc)).filter(p=>p.label?.key.startsWith('size:')&&p.text==='2" NS');
  const count=values().length,sizes=doc.runs.map(r=>r.nps);doc.runs[2].showSize=true;
  assert.equal(values().length,count+1);assert.deepEqual(doc.runs.map(r=>r.nps),sizes);
  assert.equal(parseIsoJson(JSON.stringify(doc)).runs[2].showSize,true);
});

test('a threaded nipple stops at its elbow threads and leaves heavy fitting bodies at the turn', () => {
  const doc=sheet(),corner=appendRun(doc,null,[500,0,0],'CS40',1,'S1','L1','THD');
  appendRun(doc,corner.id,[0,0,500],'CS40',1,'S1','L1','THD');applyComponent(doc,corner,'SC-90ELL');
  doc.runs.forEach(r=>r.nipple={});const before=JSON.stringify(doc.runs),d=createDrawing(doc,'S1'),at=d.positions.get(corner.id)!;
  const body=d.primitives.filter(p=>p.type==='line'&&p.layer==='PIPE'&&p.owner===corner.id);
  assert.equal(body.length,2);
  for(const p of body)if(p.type==='line'){
    assert.deepEqual(p.a,at);assert.ok(Math.hypot(p.b[0]-p.a[0],p.b[1]-p.a[1])>5);
    assert.equal(p.weight,draftingSizes(doc).pipe);
  }
  assert.equal(JSON.stringify(doc.runs),before);
});

test('a swing check uses an open body and reverses its outlined flow pointer',()=>{
  const doc=sheet(),{mid}=straight(doc,'THD',1);applyComponent(doc,mid,'CHECK-SC');
  mid.valveSymbol='swing';
  const before=JSON.stringify(doc.runs.map(r=>[r.from,r.to,r.nps,r.fromPrep,r.toPrep]));
  const pointer=(flow:'forward'|'reverse')=>{
    doc.runs[0].flow=flow;const d=createDrawing(doc,'S1'),p=symbols(owned(d.primitives,mid.id));
    assert.ok(p.some(q=>!q.closed&&q.points.length===4));
    assert.ok(!p.some(q=>q.fill));
    return p.find(q=>q.closed&&q.points.length===3)!.points[0];
  };
  assert.notDeepEqual(pointer('forward'),pointer('reverse'));
  assert.equal(JSON.stringify(doc.runs.map(r=>[r.from,r.to,r.nps,r.fromPrep,r.toPrep])),before);
  mid.valveSymbol='swing';assert.equal(parseIsoJson(JSON.stringify(doc)).nodes.find(n=>n.id===mid.id)!.valveSymbol,'swing');
});

test('hiding a pipe arrow preserves the check valve installation direction',()=>{
 const doc=sheet(),{mid}=straight(doc,'THD',1);applyComponent(doc,mid,'CHECK-SC');
 doc.runs[0].flow='forward';const first=symbols(owned(draw(doc),mid.id));
 doc.runs[0].showFlow=false;const p=draw(doc);
 assert.deepEqual(symbols(owned(p,mid.id)),first);
 assert.ok(!symbols(p).some(q=>q.fill&&doc.runs.some(r=>r.id===q.owner)));
 assert.equal(parseIsoJson(JSON.stringify(doc)).runs[0].flow,'forward');
 assert.equal(parseIsoJson(JSON.stringify(doc)).runs[0].showFlow,false);
});

test('a box actuator changes the operator symbol without changing the purchased valve or connected pipes',()=>{
 const doc=sheet(),{mid}=straight(doc,'THD',1);applyComponent(doc,mid,'BALL-SC');mid.operator='OPERATOR SOUTH';
 const pipes=JSON.stringify(doc.runs),catalog=mid.catalogId;mid.valveOperator='box';
 const p=symbols(owned(draw(doc),mid.id));assert.ok(p.some(q=>q.closed&&q.points.length===4&&!q.fill));
 assert.equal(JSON.stringify(doc.runs),pipes);assert.equal(mid.catalogId,catalog);
 assert.equal(parseIsoJson(JSON.stringify(doc)).nodes.find(n=>n.id===mid.id)!.valveOperator,'box');
});

test('an existing support can use an arrowed caption without a new support glyph',()=>{
 const doc=sheet(),{mid}=straight(doc),support=attachComponent(doc,doc.runs[0].id,'support',.5);
 support.component='HANGER';support.calloutText='EXISTING HANGER';
 const before=doc.nodes.map(n=>[...n.position]);assert.ok(symbols(owned(draw(doc),support.id)).length>0);
 support.supportSymbol='callout';const output=owned(draw(doc),support.id);
 assert.equal(symbols(output).length,0);
 assert.ok(output.some(p=>p.layer==='LEADER'&&p.type==='polyline'&&p.fill));
 assert.ok(texts(output).some(p=>p.text==='EXISTING HANGER'));
 assert.deepEqual(doc.nodes.map(n=>n.position),before);
 assert.equal(parseIsoJson(JSON.stringify(doc)).nodes.find(n=>n.id===support.id)!.supportSymbol,'callout');
 support.supportSymbol='invalid' as any;assert.throws(()=>parseIsoJson(JSON.stringify(doc)),/component callout/);
 assert.ok(mid.id);
});
