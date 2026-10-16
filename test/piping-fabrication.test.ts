import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { appendRun, applyComponent, attachComponent, bom, clone, getNode, insertComponent, newIso, parseIsoJson, runResult, validateIso, welds, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { nodeItem } from '../src/core/joints.ts';
import { cutSchedule } from '../src/core/schedules.ts';
import { sheetMaterials } from '../src/core/material-list.ts';
import { standardRow } from '../src/core/standards.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';

const dir = new URL('../public/library/specs/', import.meta.url);
const library = (slug: string) => JSON.parse(readFileSync(new URL(slug + '.json', dir), 'utf8')) as PipeSpec;
const specA = library('a');
const inch = (v: number) => v * 25.4;
const row = (doc: IsoDocument, code: string, nps: number) => doc.specs[0].fittings.find(f => f.component === code && f.nps === nps)!;
const close = (actual: number, expected: number, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('library specifications leave a 1/16" root gap at butt welds and a 1/16" gap at the bottom of each socket', () => {
  for (const file of readdirSync(dir)) {
    const spec = library(file.replace('.json', ''));
    assert.equal(spec.rootGap, 1.6, file);
    assert.equal(spec.socketGap, 1.6, file);
  }
});

test('library specifications describe what to buy: valve ends, trim and standard; ringed spiral-wound gaskets; plain studs', () => {
  for (const file of readdirSync(dir)) {
    const spec = library(file.replace('.json', ''));
    for (const f of spec.fittings) {
      assert.notEqual(f.material, 'A105 GR. II', `${file} ${f.id}`);
      if (/^(GATE|GLOBE|CHECK|BALL|PLUG)-(FL|SW|SC)$/.test(f.component ?? ''))
        assert.match(f.description, /(API|BS|ASME|MSS) [\w.-]+$/, `${file} ${f.id}`);
      if (f.component === 'GASK-RF' && /SPIRAL/.test(f.description))
        assert.match(`${f.description}, ${f.material}`, /4\.5 MM, ASME B16\.20, WITH INNER AND CENTRING RINGS.*GRAPHITE/, `${file} ${f.id}`);
      if (f.component === 'GASK-FF') assert.doesNotMatch(f.description, /SPIRAL/, `${file} ${f.id}`);
      if (f.kind === 'bolt') assert.equal(f.schedule, undefined, `${file} ${f.id}`);
      if (f.material?.includes('B8')) assert.match(f.material, /A194 GR\. 8/, `${file} ${f.id}`);
    }
    for (const s of spec.sizes) assert.match(s.description!, /^PIPE, (SMLS|EFW), (BE|PE|TE), ASME B36\.(10|19)M$/, file);
  }
  const doc = newIso(); doc.specs = [clone(specA)];
  assert.equal(row(doc, 'GATE-FL', 6).description, 'GATE VALVE, FLANGED RF, OS&Y, BB, TRIM 8, API 600');
  assert.equal(row(doc, 'GATE-FL', 6).material, 'A216 WCB');
});

test('socket-weld pipe stops short of each socket bottom by the specification gap', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  const a = appendRun(doc, null, [inch(24), 0, 0], 'A', 1, 'SP', 'L', 'SW');
  const b = appendRun(doc, a.id, [0, inch(24), 0], 'A', 1, 'SP', 'L', 'SW');
  appendRun(doc, b.id, [inch(24), 0, 0], 'A', 1, 'SP', 'L', 'SW');
  const elbow = row(doc, 'SW-90ELL', 1);
  const middle = doc.runs[1], result = runResult(doc, middle);
  assert.deepEqual(result.gaps, [1.6, 1.6]);
  close(result.cut, inch(24) - 2 * elbow.takeout - 3.2);
  // A specification that does not set the gap bottoms the pipe, as the issued sheets do.
  delete doc.specs[0].socketGap;
  assert.deepEqual(runResult(doc, middle).gaps, [0, 0]);
  close(runResult(doc, middle).cut, inch(24) - 2 * elbow.takeout);
});

test('a socket-weld flange takes the socket gap; butt welds keep the root gap and a zero gap stays zero', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  const end = appendRun(doc, null, [500, 0, 0], 'A', 1, 'SP', 'L', 'SW');
  applyComponent(doc, end, 'FLG-RFSW', row(doc, 'FLG-RFSW', 1));
  assert.equal(runResult(doc, doc.runs[0]).gaps[1], 1.6);
  const bw = newIso(); bw.specs = [clone(specA)];
  const elbow = appendRun(bw, null, [1000, 0, 0], 'A', 4, 'SP', 'L');
  appendRun(bw, elbow.id, [0, 1000, 0], 'A', 4, 'SP', 'L');
  applyComponent(bw, elbow, 'W-LR90EL', row(bw, 'W-LR90EL', 4));
  assert.deepEqual(runResult(bw, bw.runs[0]).gaps, [0, 1.6]);
  bw.specs[0].rootGap = 0;
  assert.deepEqual(runResult(bw, bw.runs[0]).gaps, [0, 0]);
});

test('a branch outlet measured from the header outside adds the header radius and the root gap under it', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [2000, 0, 0], 'A', 6, 'SP', 'L');
  const sol = attachComponent(doc, doc.runs[0].id, 'olet', 0.5);
  applyComponent(doc, sol, 'SOL', row(doc, 'SOL', 0.75));
  appendRun(doc, sol.id, [0, 0, inch(9)], 'A', 0.75, 'SP', 'L', 'SW');
  const branch = doc.runs[1], result = runResult(doc, branch);
  // 6" OD 6.625: 9 - 3.3125 - 1/16 root gap - (1 1/16 height - 1/2 socket) - 1/16 socket gap = 5".
  close(result.cut, inch(9) - 168.3 / 2 - 1.6 - (26.99 - 12.7) - 1.6);
  assert.deepEqual(validateIso(doc), []);
  // Without a specification row the MSS SP-97 height is used, from the header outside.
  delete sol.catalogId;
  doc.specs[0].fittings = doc.specs[0].fittings.filter(f => f.component !== 'SOL');
  close(runResult(doc, branch).cut, result.cut);
  // A row whose takeout is from the header centreline, as a client specification may give it, is used as it is.
  doc.specs[0].fittings.push({ id: 'A:SOL-6x0.75', component: 'SOL', kind: 'olet', nps: 6, smallerNps: 0.75, takeout: 110, socketDepth: 12.7, description: 'SOCKOLET', source: 'test' });
  sol.catalogId = 'A:SOL-6x0.75';
  close(runResult(doc, branch).cut, inch(9) - 110 - 1.6);
});

test('slip-on flanges take two fillet welds; olets and welded supports take their own welds', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  const elbow = appendRun(doc, null, [1500, 0, 0], 'A', 3, 'SP', 'L');
  const end = appendRun(doc, elbow.id, [0, 1000, 0], 'A', 3, 'SP', 'L');
  applyComponent(doc, getNode(doc, doc.runs[0].from), 'FLG-RFSO', row(doc, 'FLG-RFSO', 3));
  const olet = attachComponent(doc, doc.runs[1].id, 'olet', 0.5);
  applyComponent(doc, olet, 'SOL', row(doc, 'SOL', 0.75));
  appendRun(doc, olet.id, [0, 0, 300], 'A', 0.75, 'SP', 'L', 'SW');
  const shoe = attachComponent(doc, doc.runs[0].id, 'support', 0.5);
  applyComponent(doc, shoe, 'SHOE', row(doc, 'SHOE', 3));
  const hanger = attachComponent(doc, doc.runs[1].id, 'support', 0.2);
  applyComponent(doc, hanger, 'HANGER', row(doc, 'HANGER', 3));
  const all = welds(doc);
  // Numbered as a fitter meets them along the spool: attachments between the welds at the ends of their pipe.
  assert.deepEqual(all.map(w => w.type).sort(), ['AT', 'BR', 'BW', 'BW', 'SO', 'SO', 'SW']);
  // The bore weld sits at the set-back pipe end, the hub weld at the back of the hub.
  const [bore, hub] = all.filter(w => w.type === 'SO');
  close(bore.position[0], row(doc, 'FLG-RFSO', 3).takeout);
  close(hub.position[0], row(doc, 'FLG-RFSO', 3).lengthThroughHub!);
  // The branch weld is on the header's outside, under the outlet.
  const branch = all.find(w => w.type === 'BR')!;
  assert.equal(branch.nps, 0.75);
  close(branch.position[2], 88.9 / 2);
  assert.equal(new Set(all.map(w => w.tag)).size, all.length);
  // A flanged valve between slip-on mates is four fillet welds.
  const valve = newIso(); valve.specs = [clone(specA)];
  valve.specs[0].parameters = { ...valve.specs[0].parameters, 'Default Flange': 'FLG-RFSO' };
  appendRun(valve, null, [2000, 0, 0], 'A', 3, 'SP', 'L');
  placeComponentOnPipe(valve, valve.runs[0].id, COMPONENT_TYPES.find(t => t.code === 'GATE-FL')!, 0.5);
  assert.deepEqual(welds(valve).map(w => w.type), ['SO', 'SO', 'SO', 'SO']);
});

test('socket-weld and threaded pipe drawn straight on is joined by a coupling, never by a phantom weld', () => {
  for (const [prep, code] of [['SW', 'F-CPLGSW'], ['THD', 'F-CPLGSC']] as const) {
    const doc = newIso(); doc.specs = [clone(specA)];
    const joint = appendRun(doc, null, [300, 0, 0], 'A', 1, 'SP', 'L', prep);
    appendRun(doc, joint.id, [300, 0, 0], 'A', 1, 'SP', 'L', prep);
    assert.equal(joint.component, code);
    assert.equal(joint.catalogId, row(doc, code, 1).id);
    assert.ok(bom(doc).some(r => r.description === row(doc, code, 1).description));
    assert.equal(welds(doc).length, prep === 'SW' ? 2 : 0);
    assert.deepEqual(validateIso(doc), []);
    // A drawing that still joins them with a bare weld is flagged and lists no weld there.
    Object.assign(joint, { kind: 'weld' }); delete joint.component; delete joint.catalogId;
    assert.match(validateIso(doc).join(), new RegExp(`two ${prep === 'SW' ? 'socket-weld' : 'threaded'} pipes meet end to end`));
    assert.equal(welds(doc).length, 0);
  }
  // Butt-weld pipe drawn straight on is one butt weld, as before.
  const bw = newIso(); bw.specs = [clone(specA)];
  const weld = appendRun(bw, null, [300, 0, 0], 'A', 4, 'SP', 'L');
  appendRun(bw, weld.id, [300, 0, 0], 'A', 4, 'SP', 'L');
  assert.equal(weld.kind, 'weld');
});

test('an eccentric reducer carries its flat side into the BOM, and a missing or impossible flat side is reported', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [1000, 0, 0], 'A', 4, 'SP', 'L');
  const reducer = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPES.find(t => t.code === 'E-RED')!, 0.5, row(doc, 'E-RED', 4));
  assert.match(validateIso(doc).join(), /has no flat side/);
  reducer.flatSide = 'top';
  assert.deepEqual(validateIso(doc), []);
  assert.match(sheetMaterials(doc, 'SP').find(r => r.category === 'reducer')!.description, /, FOT$/);
  reducer.flatSide = 'bottom';
  assert.match(bom(doc).find(r => /ECC/.test(r.description))!.description, /, FOB$/);
  reducer.flatSide = 'east';
  assert.match(validateIso(doc).join(), /cannot have its flat on the east/);
  reducer.flatSide = 'north';
  assert.deepEqual(validateIso(doc), []);
  assert.match(sheetMaterials(doc, 'SP').find(r => r.category === 'reducer')!.description, /, FLAT NORTH$/);
  applyComponent(doc, reducer, 'C-RED', row(doc, 'C-RED', 4));
  assert.match(validateIso(doc).join(), /only an eccentric reducer has one/);
  assert.throws(() => parseIsoJson(JSON.stringify({ ...doc, nodes: doc.nodes.map(n => n.id === reducer.id ? { ...n, flatSide: 'up' } : n) })), /callout/);
});

test('olets list as their own group after every fitting, before the flanges', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [2000, 0, 0], 'A', 2, 'SP', 'L');
  placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPES.find(t => t.code === 'FLG-RFWN')!, 0);
  const tol = attachComponent(doc, doc.runs[0].id, 'olet', 0.5);
  applyComponent(doc, tol, 'TOL', row(doc, 'TOL', 0.75));
  appendRun(doc, tol.id, [0, 0, 300], 'A', 0.75, 'SP', 'L', 'THD');
  placeComponentOnPipe(doc, doc.runs[1].id, COMPONENT_TYPES.find(t => t.code === 'UNION-SC')!, 0.5, row(doc, 'UNION-SC', 0.75));
  const order = sheetMaterials(doc, 'SP').map(r => r.category).filter(c => c !== 'pipe');
  assert.deepEqual(order.slice(0, 3), ['union', 'olet', 'flange']);
});

test('BOM rows can be bought from: olets by header and branch, lap-joint flanges and stub ends with material and wall', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [2000, 0, 0], 'A', 6, 'SP', 'L');
  placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPES.find(t => t.code === 'FLG-RFLJ')!, 0);
  const sol = attachComponent(doc, doc.runs[0].id, 'olet', 0.5);
  applyComponent(doc, sol, 'SOL', row(doc, 'SOL', 0.75));
  appendRun(doc, sol.id, [0, 0, 300], 'A', 0.75, 'SP', 'L', 'SW');
  const rows = sheetMaterials(doc, 'SP');
  assert.equal(rows.find(r => r.category === 'olet')!.nd, '6"X3/4"');
  const lj = rows.find(r => /LAP-JOINT/.test(r.description))!.description;
  assert.doesNotMatch(lj, /\bRF\b/);
  assert.match(lj, /A105/);
  assert.match(rows.find(r => r.category === 'stub')!.description, /^STUB END, LONG PATTERN, ASME B16\.9, BE, .*A234.*, STD\.$/);
});

test('a nipple is a pipe of catalogued length with finished ends, listed by count and never cut', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [2000, 0, 0], 'A', 2, 'SP', 'L');
  const tol = attachComponent(doc, doc.runs[0].id, 'olet', 0.5);
  applyComponent(doc, tol, 'TOL', row(doc, 'TOL', 0.75));
  const valve = appendRun(doc, tol.id, [0, 0, 200], 'A', 0.75, 'SP', 'L', 'THD');
  const plug = appendRun(doc, valve.id, [0, 0, 150], 'A', 0.75, 'SP', 'L', 'THD');
  applyComponent(doc, valve, 'GATE-SC', row(doc, 'GATE-SC', 0.75));
  applyComponent(doc, plug, 'PLUG', row(doc, 'PLUG', 0.75));
  const nipple = doc.runs[1];
  // Placing a nipple on the pipe makes that pipe the nipple and moves the valve to suit its 3" length.
  const at = placeComponentOnPipe(doc, nipple.id, COMPONENT_TYPES.find(t => t.code === 'NIPPLE')!, 0.5);
  assert.equal(at.id, valve.id);
  close(runResult(doc, nipple).cut, inch(3));
  assert.deepEqual(validateIso(doc), []);
  const rows = sheetMaterials(doc, 'SP');
  const listed = rows.find(r => r.category === 'nipple')!;
  assert.deepEqual([listed.qtyText, listed.nd, listed.description], ['1', '3/4"', 'NIPPLE, 3/4" X 3" LG, XS, A106 GR. B, TBE']);
  assert.ok(!rows.some(r => r.category === 'pipe' && r.memberIds.includes(nipple.id)));
  assert.ok(bom(doc).some(r => r.unit === 'ea' && r.description === listed.description));
  assert.ok(!cutSchedule(doc).some(r => r.run.id === nipple.id));
  // A nipple that no longer fits between its fittings is reported.
  valve.position = [valve.position[0], valve.position[1], valve.position[2] + 20];
  assert.match(validateIso(doc).join(), /nipple is 76\.2 mm long, but its fittings leave 96\.2 mm/);
  assert.throws(() => parseIsoJson(JSON.stringify({ ...doc, runs: doc.runs.map(r => r.id === nipple.id ? { ...r, nipple: { length: -1 } } : r) })), /nipple/);
});

test('a nipple drawn as an in-line component takes the specification nipple length', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [500, 0, 0], 'A', 0.75, 'SP', 'L', 'THD');
  const node = insertComponent(doc, doc.runs[0].id, 'valve', 0.5);
  Object.assign(node, { component: 'NIPPLE' });
  close(nodeItem(doc, node)!.takeout, inch(1.5));
  assert.match(sheetMaterials(doc, 'SP').find(r => r.category === 'nipple')!.description, /^NIPPLE, 3\/4" X 3" LG, XS, A106 GR\. B, TBE$/);
  assert.deepEqual(validateIso(doc), []);
});

test('a check valve bolted to a gate valve is one joint: one gasket, one bolt set, no pipe or flanges between', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [2000, 0, 0], 'A', 6, 'SP', 'L');
  const type = (code: string) => COMPONENT_TYPES.find(t => t.code === code)!;
  doc.runs[0].flow = 'forward';
  const check = placeComponentOnPipe(doc, doc.runs[0].id, type('CHECK-FL'), 0.3, row(doc, 'CHECK-FL', 6));
  const next = doc.runs.find(r => r.from === check.id)!;
  // Dropped onto the check valve's face, the gate valve bolts to it.
  const gate = placeComponentOnPipe(doc, next.id, type('GATE-FL'), 0.05, row(doc, 'GATE-FL', 6));
  const between = doc.runs.find(r => r.from === check.id)!;
  assert.equal(between.connector, true);
  close(gate.position[0] - check.position[0], row(doc, 'CHECK-FL', 6).takeout + 3.17 + row(doc, 'GATE-FL', 6).takeout);
  const rows = sheetMaterials(doc, 'SP');
  assert.equal(rows.find(r => r.category === 'gasket')!.qty, 3);
  assert.equal(rows.find(r => r.category === 'bolt')!.qty, 24);
  assert.equal(rows.find(r => r.category === 'flange')!.qty, 2);
  assert.equal(rows.filter(r => r.category === 'pipe').length, 2);
  assert.equal(welds(doc).length, 2);
  assert.deepEqual(validateIso(doc), []);
  gate.position = [gate.position[0] + 10, 0, 0];
  assert.match(validateIso(doc).join(), /bolted face to face but stand 10 mm apart/);
});

test('a reducer fits either way round, and one between equal sizes is reported', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [1500, 0, 0], 'A', 4, 'SP', 'L');
  const expander = doc.specs[0].fittings.find(f => f.component === 'C-RED' && f.nps === 6 && f.smallerNps === 4)!;
  const node = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPES.find(t => t.code === 'C-RED')!, 0.5, expander);
  assert.equal(node.catalogId, expander.id);
  assert.deepEqual(doc.runs.map(r => r.nps), [4, 6]);
  assert.equal(sheetMaterials(doc, 'SP').find(r => r.category === 'reducer')!.nd, '6"X4"');
  assert.deepEqual(validateIso(doc), []);
  doc.runs[1].nps = 4;
  assert.match(validateIso(doc).join(), /joins two pipes of the same size/);
});

test('supports the specification supplies are listed last in the BOM; a drawn-only support is not, unless asked', () => {
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [3000, 0, 0], 'A', 6, 'SP', 'L');
  const shoe = attachComponent(doc, doc.runs[0].id, 'support', 0.3);
  applyComponent(doc, shoe, 'SHOE', row(doc, 'SHOE', 6));
  const ubolt = attachComponent(doc, doc.runs[0].id, 'support', 0.7);
  ubolt.component = 'U-BOLT';
  let rows = sheetMaterials(doc, 'SP');
  assert.deepEqual(rows.filter(r => r.category === 'support').map(r => [r.nd, r.description]), [['6"', 'PIPE SHOE WELDED, CS']]);
  assert.equal(rows.at(-1)!.category, 'support');
  assert.ok(bom(doc).some(r => r.description === row(doc, 'SHOE', 6).description));
  assert.ok(!bom(doc).some(r => /U-bolt/i.test(r.description)));
  shoe.inBom = false; ubolt.inBom = true;
  rows = sheetMaterials(doc, 'SP');
  assert.deepEqual(rows.filter(r => r.category === 'support').map(r => r.description), ['U-BOLT, CS']);
});

test('a slip-on flange sets the pipe back a wall and 1/16" from its face', () => {
  assert.equal(standardRow('FLG-RFSO', 2, '150#', undefined, 'STD')!.takeout, 3.91 + 1.59);
  assert.equal(standardRow('FLG-RFSO', 2, '150#', undefined, '10S')!.takeout, 2.77 + 1.59);
  assert.equal(row(Object.assign(newIso(), { specs: [clone(specA)] }), 'FLG-RFSO', 2).takeout, 3.91 + 1.59);
});

test('standard sockolets, thredolets and plugs need no typed lengths', () => {
  assert.equal(standardRow('SOL', 1, '150#')!.takeout, 20.64);
  assert.equal(standardRow('TOL', 1, '150#')!.takeout, 15.88);
  assert.equal(standardRow('WOL', 2, '150#', undefined, 'STD')!.takeout, 38.1);
  assert.equal(standardRow('WOL', 6, '150#', undefined, 'XS')!.takeout, 77.79);
  const doc = newIso(); doc.specs = [clone(specA)];
  appendRun(doc, null, [2000, 0, 0], 'A', 2, 'SP', 'L');
  const tol = attachComponent(doc, doc.runs[0].id, 'olet', 0.5);
  applyComponent(doc, tol, 'TOL', row(doc, 'TOL', 0.75));
  const valve = appendRun(doc, tol.id, [0, 0, 150], 'A', 0.75, 'SP', 'L', 'THD');
  const plug = appendRun(doc, valve.id, [0, 0, 150], 'A', 0.75, 'SP', 'L', 'THD');
  applyComponent(doc, valve, 'GATE-SC', row(doc, 'GATE-SC', 0.75));
  applyComponent(doc, plug, 'PLUG', row(doc, 'PLUG', 0.75));
  assert.deepEqual(validateIso(doc), []);
});

test('a pipe piece shorter than the shop cuts, or with its welds too close together, is reported', () => {
  // A 20 mm pup between two 4" elbows.
  const doc = newIso(); doc.specs = [clone(specA)];
  const a = appendRun(doc, null, [1000, 0, 0], 'A', 4, 'SP', 'L');
  const b = appendRun(doc, a.id, [0, 0, 2 * 152.4 + 3.2 + 20], 'A', 4, 'SP', 'L');
  appendRun(doc, b.id, [0, 1000, 0], 'A', 4, 'SP', 'L');
  assert.match(validateIso(doc).join(), /a 4″ pipe is cut to 20 mm, shorter than the 50 mm shortest piece allowed/);
  doc.specs[0].minPipeLength = 15;
  assert.match(validateIso(doc).join(), /welds at the ends of a 4″ pipe are 20 mm apart, closer than the 50 mm allowed/);
  doc.specs[0].minWeldSpacing = 20;
  assert.deepEqual(validateIso(doc), []);
  // Socket-weld pipe counts only what shows between the sockets.
  const sw = newIso(); sw.specs = [clone(specA)];
  const e = appendRun(sw, null, [500, 0, 0], 'A', 1, 'SP', 'L', 'SW');
  const f = appendRun(sw, e.id, [0, 0, 2 * 22.22 + 3.2 + 60], 'A', 1, 'SP', 'L', 'SW');
  appendRun(sw, f.id, [0, 500, 0], 'A', 1, 'SP', 'L', 'SW');
  // 60 mm cut less two 5/8" sockets, each with the pipe 1.6 mm short of its bottom.
  assert.match(validateIso(sw).join(), /welds at the ends of a 1″ pipe are 31\.4 mm apart/);
});
