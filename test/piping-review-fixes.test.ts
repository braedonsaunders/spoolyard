import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRun, applyComponent, clone, getNode, insertComponent, newIso, removeComponent, runResult, welds, type IsoDocument
} from '../src/core/model.ts';
import { draftLength, formatLength, coordinateText } from '../src/core/format.ts';
import { budget } from './perf-budget';

// Invented data throughout.
const inch = (v: number) => v * 25.4;
function line(units: IsoDocument['units'] = 'imperial') {
  const doc = newIso(); doc.units = units;
  const a = appendRun(doc, null, [inch(120), 0, 0], 'CS40', 2, 'S1', 'L1');
  appendRun(doc, a.id, [0, inch(120), 0], 'CS40', 2, 'S1', 'L1');
  return doc;
}

test('a component inserted into a field-fit pipe leaves the field-fit end where it was', () => {
  const doc = line(), pipe = doc.runs[0];
  pipe.toFieldFit = true;
  const before = runResult(doc, pipe).makeup;
  assert.deepEqual(before, [0, 76.2]);
  const valve = insertComponent(doc, pipe.id, 'valve', 0.5);
  applyComponent(doc, valve, 'GATE-FL');
  const [first, second] = [doc.runs.find(r => r.to === valve.id)!, doc.runs.find(r => r.from === valve.id)!];
  // The makeup stays at the elbow end only: no extra pipe and no field-fit weld at the valve.
  assert.deepEqual(runResult(doc, first).makeup, [0, 0]);
  assert.deepEqual(runResult(doc, second).makeup, [0, 76.2]);
  assert.equal(welds(doc).filter(w => w.fieldFit).length, 1);
  assert.ok(!welds(doc).some(w => w.nodeId === valve.id && w.fieldFit));
});

test('removing an in-line component keeps each outer end field-fit as it was', () => {
  for (const [atElbow, atValve] of [[true, false], [false, true]]) {
    const doc = line(), pipe = doc.runs[0];
    const valve = insertComponent(doc, pipe.id, 'valve', 0.5);
    // Field-fit at the elbow on the pipe beyond the valve, or at the valve itself (which goes with the valve).
    if (atElbow) doc.runs.find(r => r.from === valve.id)!.toFieldFit = true;
    if (atValve) doc.runs.find(r => r.to === valve.id)!.toFieldFit = true;
    removeComponent(doc, valve.id);
    const merged = doc.runs[0];
    assert.equal(getNode(doc, merged.to).kind, 'elbow90');
    assert.deepEqual(runResult(doc, merged).makeup, [0, atElbow ? 76.2 : 0]);
  }
});

test('a negative length that rounds to nothing is written without a sign', () => {
  assert.equal(draftLength(-0.3, 'imperial'), '0"');
  assert.equal(formatLength(-0.3, 'imperial'), '0″');
  assert.equal(draftLength(-0.3, 'mm'), '0');
  assert.equal(draftLength(-25.4, 'imperial'), '-1"');
  const doc = newIso(); doc.units = 'imperial';
  assert.deepEqual(coordinateText(doc, [-0.2, 0.2, -0.2]), ['E 0"', 'N 0"', 'EL +0"']);
});

test('the welds of a 300-pipe job are found in linear time and kept for an unchanged document', () => {
  const doc = newIso();
  let at = appendRun(doc, null, [1500, 0, 0], 'CS40', 4, 'S0', 'L-1');
  for (let i = 0; doc.runs.length < 300; i++) {
    const spool = `S${Math.floor(doc.runs.length / 30)}`, tee = at;
    at = appendRun(doc, tee.id, [1200, 0, 0], 'CS40', 4, spool, 'L-1');
    const up = appendRun(doc, tee.id, [0, 0, 900], 'CS40', 2, spool, 'L-1');
    appendRun(doc, up.id, [0, 800, 0], 'CS40', 2, spool, 'L-1');
  }
  const copy = clone(doc);
  let t = performance.now();
  const all = welds(copy);
  const fresh = performance.now() - t;
  assert.ok(all.length > 400);
  // About 3 ms on a 2024 laptop; the scanning version took about 20 ms.
  assert.ok(fresh < budget(60), `${fresh.toFixed(1)} ms`);
  t = performance.now();
  for (let i = 0; i < 10; i++) assert.deepEqual(welds(copy), all);
  assert.ok((performance.now() - t) / 10 < budget(30));
  // The result handed out is the caller's own: changing it does not change the next answer.
  welds(copy)[0].tag = 'XX';
  assert.equal(welds(copy)[0].tag, all[0].tag);
  // A document changed in place is read as it is now.
  copy.weldPrefix = 'FW';
  assert.ok(welds(copy).every(w => w.tag.startsWith('FW')));
  copy.runs[0].toField = true;
  assert.equal(welds(copy).find(w => w.runId === copy.runs[0].id)!.field, true);
});

test('the field-fit note follows the drawing units and profile, and is left off with no makeup', async () => {
  const { fieldFitNote } = await import('../src/core/format.ts');
  const doc = line();
  assert.equal(fieldFitNote(doc), '+3" FIT-UP');
  doc.fieldFitMakeup = inch(30);
  assert.equal(fieldFitNote(doc), `+2'-6" FIT-UP`);
  doc.profile = { feetFrom: { dimensions: 36 } };
  assert.equal(fieldFitNote(doc), '+30" FIT-UP');
  doc.fieldFitMakeup = 0;
  assert.equal(fieldFitNote(doc), undefined);
  const metric = line('mm');
  assert.equal(fieldFitNote(metric), '+100 FIT-UP');
  // On the sheet, a field-fit weld with no makeup is lettered FFW alone.
  const { createDrawing } = await import('../src/core/drawing.ts');
  doc.runs[0].toFieldFit = true;
  const flag = () => createDrawing(doc, 'S1').primitives.filter(p => p.type === 'text' && p.label?.key.startsWith('field-weld:'));
  assert.deepEqual(flag().map(p => p.type === 'text' && p.text), ['FFW']);
  doc.fieldFitMakeup = inch(4);
  assert.deepEqual(flag().map(p => p.type === 'text' && p.text), ['FFW\n+4" FIT-UP']);
});

test('lug-bolt lengths are a stated convention, surfaced as an assumption with every assumption it rests on', async () => {
  const { bolting, LUG_CONVENTION } = await import('../src/core/standards.ts');
  for (const opts of [{}, { body: 50 }, { tapped: true }]) {
    const lug = bolting(2, '150#', 'RF', 'lug-valve-side', opts)!;
    assert.match(lug.source, /convention/);
    assert.doesNotMatch(lug.source, /^ASME/);
    assert.ok(lug.assumed?.includes(LUG_CONVENTION), JSON.stringify(opts));
  }
  // The category of the API 609 body the length rests on is still said alongside.
  assert.match(bolting(2, '150#', 'RF', 'lug-valve-side')!.assumed!, /Category A/);
  // A pair stud is the B16.5 table, and assumes nothing.
  assert.equal(bolting(2, '150#', 'RF', 'flange-pair')!.assumed, undefined);
  // A flange bolted to a lug mate off the drawing says both what body it assumed and that the length is a convention.
  const { flangedJoints } = await import('../src/core/joints.ts');
  const doc = line();
  const end = getNode(doc, doc.runs[0].from);
  applyComponent(doc, end, 'FLG-RFWN');
  end.jointSupply = { gasket: true, bolts: true, mate: 'lug' };
  const joint = flangedJoints(doc).find(j => j.nodeId === end.id)!;
  assert.equal(joint.bolts!.kind, 'lug');
  assert.ok(joint.assumed.some(a => /API 609 lug butterfly body/.test(a)));
  assert.ok(joint.assumed.some(a => /Category A/.test(a)));
  assert.ok(joint.assumed.includes(LUG_CONVENTION));
  // Each assumption is listed whole, never split into fragments at its own punctuation.
  assert.ok(joint.assumed.every(a => /assumed|convention|because/.test(a)), JSON.stringify(joint.assumed));
});

test('names every object answers to are no template bindings, built-in templates or design fields', async () => {
  const { DEFAULT_TEMPLATE, validateSheetTemplate, BUILTIN_TEMPLATES } = await import('../src/core/sheet-template.ts');
  const { parseIsoJson } = await import('../src/core/model.ts');
  const { validSpecDesign } = await import('../src/core/spec-design.ts');
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const t = clone(DEFAULT_TEMPLATE);
    t.layouts[0].items.push({ type: 'text', at: [10, 10], text: `X {${name}}`, size: 2.5 });
    assert.throws(() => validateSheetTemplate(t), /unknown binding/, name);
    assert.equal(BUILTIN_TEMPLATES[name], undefined, name);
    const doc = line();
    assert.throws(() => parseIsoJson(JSON.stringify({ ...doc, sheetFormat: 'production', sheetTemplate: name })), /Unknown sheet template/, name);
    assert.equal(validSpecDesign(JSON.parse(`{"${name}": 1}`)), false, name);
  }
  assert.doesNotThrow(() => validateSheetTemplate(DEFAULT_TEMPLATE));
});

test('a material table narrower than its fixed columns is refused, not printed a letter a line', async () => {
  const { DEFAULT_TEMPLATE, validateSheetTemplate } = await import('../src/core/sheet-template.ts');
  const t = clone(DEFAULT_TEMPLATE);
  t.layouts[0].bom!.width = 30;
  assert.throws(() => validateSheetTemplate(t), /description/);
});

test('an imported specification parameter is held to the limits a typed design value is', async () => {
  const { designValue } = await import('../src/core/spec-design.ts');
  const spec = newIso().specs[0];
  spec.design = {};
  spec.parameters = { 'Welded/Flanged General Parameters.Gasket Thickness': '3' };
  // 3 in is no gasket: the value is not used, so the standard gasket (and its stated assumption) stands.
  assert.equal(designValue(spec, 'gasketThickness').value, undefined);
  spec.parameters = { 'Welded/Flanged General Parameters.Gasket Thickness': '0.125' };
  assert.equal(designValue(spec, 'gasketThickness').value, 3.18);
});

test('sliding an olet along its header takes its branch with it', async () => {
  const { moveComponentAlongPipe } = await import('../src/core/component-position.ts');
  const { connected, validateIso } = await import('../src/core/model.ts');
  const doc = newIso();
  doc.specs[0].branchChart = [{ run: 4, branch: 2, code: 'WOL' }];
  const joint = appendRun(doc, null, [4000, 0, 0], 'CS40', 4, 'S', 'L');
  appendRun(doc, joint.id, [4000, 0, 0], 'CS40', 4, 'S', 'L');
  const top = appendRun(doc, joint.id, [0, 0, 600], 'CS40', 2, 'S', 'L');
  appendRun(doc, top.id, [0, 900, 0], 'CS40', 2, 'S', 'L');
  assert.equal(joint.kind, 'olet');
  const before = validateIso(doc);
  moveComponentAlongPipe(doc, joint.id, 6000);
  const branch = connected(doc, joint.id)[0], far = getNode(doc, branch.from === joint.id ? branch.to : branch.from);
  assert.deepEqual(joint.position, [6000, 0, 0]);
  assert.deepEqual(far.position, [6000, 0, 600]);
  assert.deepEqual(getNode(doc, doc.runs.at(-1)!.to).position, [6000, 900, 600]);
  assert.deepEqual(validateIso(doc), before);
});

test('snapping a fitting face to the placement step never refuses a position that was valid', async () => {
  const { moveComponentAlongPipe, snapNearFace, placeComponentOnPipe, componentTrack } = await import('../src/core/component-position.ts');
  const { COMPONENT_TYPE_BY_CODE } = await import('../src/core/components.ts');
  const doc = line('mm');
  const valve = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPE_BY_CODE['GATE-FL'], 0.5);
  const track = componentTrack(doc, valve.id)!;
  // Step the valve towards the elbow until the next step would leave no pipe; every valid place must snap or stay.
  let tried = 0;
  for (let d = track.max - 0.05; d > track.max - 400 && tried < 400; d -= 0.7) {
    try { moveComponentAlongPipe(doc, valve.id, d) } catch { continue }
    tried++;
    assert.doesNotThrow(() => snapNearFace(doc, valve.id), `at ${d.toFixed(2)}`);
  }
  assert.ok(tried > 10);
});

test('the review flags an olet drawn where the branch table calls for a tee', async () => {
  const { fabricationWarnings } = await import('../src/core/review.ts');
  const doc = newIso();
  doc.specs[0].branchChart = [{ run: 4, branch: 2, code: 'WOL' }];
  const joint = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  appendRun(doc, joint.id, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  appendRun(doc, joint.id, [0, 0, 500], 'CS40', 2, 'S', 'L');
  assert.equal(joint.kind, 'olet');
  assert.ok(!fabricationWarnings(doc).some(w => /branches/.test(w)));
  doc.specs[0].branchChart = [{ run: 4, branch: 2, code: 'RTEE' }];
  assert.match(fabricationWarnings(doc).join('\n'), /branches 4"X2" with a reducing tee, but a weldolet/i);
});

test('the socket-gap migration applies once, to drawings saved before drafting rules, and to their adjacent drawings', async () => {
  const { parseIsoJson, socketGapOf } = await import('../src/core/model.ts');
  const doc = line();
  delete doc.specs[0].socketGap;
  doc.references = [{ id: 'R1', atNodeId: doc.runs[0].from, name: 'ADJ', anchorNodeId: doc.runs[0].from, nodes: clone(doc.nodes), runs: clone(doc.runs), specs: clone(doc.specs) }];
  const legacy = JSON.parse(JSON.stringify(doc));
  delete legacy.draftingRules;
  const once = parseIsoJson(JSON.stringify(legacy));
  assert.equal(once.specs[0].socketGap, 0);
  assert.equal(once.references![0].specs[0].socketGap, 0);
  // Saved again, it is a current drawing: reading it again changes nothing, and a gap cleared later means the default.
  const twice = parseIsoJson(JSON.stringify(once));
  assert.deepEqual(twice, once);
  delete twice.specs[0].socketGap;
  const cleared = parseIsoJson(JSON.stringify(twice));
  assert.equal(cleared.specs[0].socketGap, undefined);
  assert.equal(socketGapOf(cleared.specs[0]), 1.6);
  // A current drawing is never migrated.
  assert.equal(parseIsoJson(JSON.stringify(doc)).specs[0].socketGap, undefined);
});

test('a repeated file name in a ZIP is numbered in its own name, not its folder', async () => {
  const { zip } = await import('../src/core/zip.ts');
  // The central directory: each entry's name length at offset 28, extra and comment lengths at 30 and 32, name at 46.
  const names = (bytes: Uint8Array) => {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out: string[] = [];
    for (let at = 0; at + 46 <= bytes.length; at++) {
      if (v.getUint32(at, true) !== 0x02014b50) continue;
      const n = v.getUint16(at + 28, true);
      out.push(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + n)));
      at += 45 + n + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
    }
    return out;
  };
  const listed = names(zip([{ name: 'dir.v1/readme', content: 'a' }, { name: 'dir.v1/readme', content: 'b' }, { name: 'S1.dxf', content: 'c' }, { name: 'S1.dxf', content: 'd' }]));
  assert.deepEqual(listed, ['dir.v1/readme', 'dir.v1/readme-2', 'S1.dxf', 'S1-2.dxf']);
});

test('a socket-weld or threaded line never takes a butt-weld specification row for its elbows and tees', async () => {
  const { validateIso, fitting } = await import('../src/core/model.ts');
  const { sheetMaterials } = await import('../src/core/material-list.ts');
  const { nodeItem } = await import('../src/core/joints.ts');
  for (const prep of ['SW', 'THD'] as const) {
    // The starter specification lists butt-weld elbows and tees only.
    const doc = newIso(); doc.units = 'imperial';
    const elbow = appendRun(doc, null, [inch(20), 0, 0], 'CS40', 1, 'S', 'L', prep);
    appendRun(doc, elbow.id, [0, inch(20), 0], 'CS40', 1, 'S', 'L', prep);
    const code = prep === 'SW' ? 'SW-90ELL' : 'SC-90ELL';
    assert.equal(elbow.component, code);
    assert.equal(fitting(doc, elbow), undefined, 'no butt-weld row');
    const std = nodeItem(doc, elbow)!;
    assert.match(std.source, /B16\.11/);
    assert.ok(std.socketDepth != null || std.threadEngagement != null);
    assert.ok(Math.abs(runResult(doc, doc.runs[0]).takeouts[1] - std.takeout) < 1e-9);
    assert.ok(std.takeout < inch(1.5) - 1, 'shorter than the butt-weld elbow it used to take');
    assert.ok(!sheetMaterials(doc, 'S').some(r => /BUTT-WELD/.test(r.description)), prep);
    assert.ok(!validateIso(doc).some(i => /socket depth or thread length/.test(i)), validateIso(doc).join());
  }
});

test('a butt-welded line never takes a socket-weld specification row for its elbows', async () => {
  const { fitting } = await import('../src/core/model.ts');
  const doc = newIso();
  // A specification whose 1" elbows are socket-weld only.
  doc.specs[0].fittings = doc.specs[0].fittings.filter(f => !(f.nps === 1 && f.kind === 'elbow90'));
  doc.specs[0].fittings.push({ id: 'SW90-1', kind: 'elbow90', nps: 1, component: 'SW-90ELL', description: 'SW 90', takeout: 22.2, socketDepth: 12.7, source: 'test' });
  const elbow = appendRun(doc, null, [500, 0, 0], 'CS40', 1, 'S', 'L', 'BW');
  appendRun(doc, elbow.id, [0, 500, 0], 'CS40', 1, 'S', 'L', 'BW');
  assert.equal(fitting(doc, elbow), undefined);
  assert.equal(elbow.component, 'W-LR90EL');
  // Drawn socket-weld, the socket-weld row is the one used.
  const sw = newIso(); sw.specs = doc.specs;
  const e2 = appendRun(sw, null, [500, 0, 0], 'CS40', 1, 'S', 'L', 'SW');
  appendRun(sw, e2.id, [0, 500, 0], 'CS40', 1, 'S', 'L', 'SW');
  assert.equal(e2.catalogId, 'SW90-1');
});
