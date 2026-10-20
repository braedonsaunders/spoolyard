import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { appendRun, clone, connected, getNode, newIso, parseIsoJson, runResult, setAutoFitting, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { COMPONENT_TYPE_BY_CODE } from '../src/core/components.ts';
import { catalogRow } from '../src/core/joints.ts';
import { placeAtOpenEnd, placeComponentOnPipe, setRunSpec, terminalCapable } from '../src/core/component-position.ts';
import { createDrawing, drawingSheets, type Primitive } from '../src/core/drawing.ts';
import { reviewIso } from '../src/core/review.ts';
import { copySelection, pastePieces, splitSheet } from '../src/editor/edit-ops.ts';
import { namespaceSpec } from '../src/editor/library.ts';
import { librarySpec, specText } from '../src/editor/spec-library.ts';

const dir = new URL('../public/library/specs/', import.meta.url);
const load = (slug: string, id = slug.toUpperCase()) => namespaceSpec(JSON.parse(readFileSync(new URL(slug + '.json', dir), 'utf8')) as PipeSpec, id);
type Text = Extract<Primitive, { type: 'text' }>;
const texts = (doc: IsoDocument, spool = 'S1') => createDrawing(doc, spool).primitives.filter((p): p is Text => p.type === 'text');
const T = (code: string) => COMPONENT_TYPE_BY_CODE[code];

/** A 3" stainless header with three 1 1/4" threaded half-coupling branches, each ending in a ball valve. */
function header(options: { valveAtEnd?: boolean } = {}) {
  const doc = newIso();
  doc.specs = [load('ss-a', 'SS-A'), load('a', 'A')];
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  appendRun(doc, 'o', [2000, 0, 0], 'SS-A', 3, 'S1', '', 'BW');
  const row = doc.specs[0].fittings.find(f => f.component === 'H-CPLGSC' && f.nps === 1.25)!;
  const branches = [0.25, 0.5, 0.75].map(at => {
    const host = doc.runs.find(r => r.nps === 3 && getNode(doc, r.from).position[0] <= 2000 * at && getNode(doc, r.to).position[0] >= 2000 * at)!;
    const olet = placeComponentOnPipe(doc, host.id, T('H-CPLGSC'), (2000 * at - getNode(doc, host.from).position[0]) / (getNode(doc, host.to).position[0] - getNode(doc, host.from).position[0]), row);
    const end = appendRun(doc, olet.id, [0, -400, 0], 'SS-A', 1.25, 'S1', '', 'THD');
    if (options.valveAtEnd) placeAtOpenEnd(doc, doc.runs.at(-1)!.id, 1, T('BALL-SC'));
    else placeComponentOnPipe(doc, doc.runs.at(-1)!.id, T('BALL-SC'), 0.5);
    return { olet, end };
  });
  return { doc, branches };
}

test('a size missing from an otherwise complete series is interpolated between its neighbours, not left without a length', () => {
  const ssa = load('ss-a', 'SS-A');
  const row = catalogRow(ssa, 'BALL-SC', 1.25)!;
  const below = ssa.fittings.find(f => f.component === 'BALL-SC' && f.nps === 1)!, above = ssa.fittings.find(f => f.component === 'BALL-SC' && f.nps === 1.5)!;
  assert.equal(row.takeoutMissing, undefined);
  assert.equal(row.dimensionBasis, 'calculated');
  assert.ok(row.takeout > below.takeout && row.takeout < above.takeout);
  assert.match(row.source, /Interpolated between the specification's 1″ and 1 1\/2″ rows/);
  // Not beyond the ends of the series, and never for a reducing size.
  assert.equal(catalogRow(ssa, 'BALL-SC', 3)?.takeoutMissing ?? true, true);
  const { doc } = header();
  assert.ok(doc.runs.every(r => Number.isFinite(runResult(doc, r).cut)), 'every pipe cuts');
  assert.ok(!reviewIso(doc).some(i => /no standard size and no length/.test(i.message)));
});

test('the default library is the general-service carbon and stainless families, each with a sensible name', () => {
  const index = JSON.parse(readFileSync(new URL('../public/library/index.json', import.meta.url), 'utf8')) as Array<{ slug: string; id: string; name: string; service: string }>;
  assert.deepEqual(index.map(s => s.id), ['A', 'B', 'C', 'SS-A', 'SS-B', 'SS-C', 'SS-D']);
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.json')).sort(), index.map(s => s.slug + '.json').sort());
  for (const s of index) assert.match(s.service, /^General \d+#$/, s.id);
});

test('a pipe moved to another specification takes its outlets and fittings with it', () => {
  const { doc, branches } = header();
  const run = doc.runs.find(r => r.nps === 3 && r.id === branches[0].olet.associatedRunId)!;
  // The header goes to carbon steel A: the half coupling on it takes spec A's row of the same size.
  setRunSpec(doc, run.id, 'A');
  assert.equal(getNode(doc, branches[0].olet.id).catalogId, 'A:H-CPLGSC-1.25');
  setRunSpec(doc, run.id, 'SS-A');
  assert.equal(getNode(doc, branches[0].olet.id).catalogId, 'SS-A:H-CPLGSC-1.25');
  assert.ok(!reviewIso(doc).some(i => /not in the pipe's specification/.test(i.message)));
});

test('sizes are lettered once each and at changes; olets carry only their item number unless every branch is asked for', () => {
  const { doc } = header();
  const sizes = () => texts(doc).map(t => t.text.trim()).filter(t => / NS$/.test(t));
  assert.deepEqual(sizes().filter(t => t === '1 1/4" NS').length, 1, 'the branch size, once');
  assert.ok(!sizes().some(t => /X/.test(t)), 'no header-by-branch size at each olet');
  doc.style = { ...doc.style!, sizeCallouts: 'branches' };
  assert.equal(sizes().filter(t => t === '1 1/4" NS').length, 3, 'every branch');
  assert.ok(sizes().some(t => t === '3"X1 1/4" NS'), 'and each olet');
  assert.equal(parseIsoJson(JSON.stringify(doc)).style!.sizeCallouts, 'branches');
});

test('a valve on an open end closes the line there: its pipe keeps its cut and nothing is drawn beyond it', () => {
  assert.ok(terminalCapable(T('BALL-SC')) && terminalCapable(T('GATE-FL')) && !terminalCapable(T('W-TEE')));
  const doc = newIso();
  doc.specs = [load('a', 'A')];
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  const end = appendRun(doc, 'o', [0, 0, -400], 'A', 1, 'S1', '', 'THD');
  const before = runResult(doc, doc.runs[0]).cut;
  const valve = placeAtOpenEnd(doc, doc.runs[0].id, 1, T('BALL-SC'));
  assert.equal(valve.id, end.id);
  assert.equal(valve.kind, 'valve');
  assert.ok(Math.abs(runResult(doc, doc.runs[0]).cut - before) < 1e-6, 'the pipe is cut as before');
  const outlet = connected(doc, valve.id).find(r => r.connector)!;
  assert.equal(getNode(doc, outlet.to).kind, 'end');
  assert.equal(connected(doc, outlet.to).length, 1);
  assert.ok(!createDrawing(doc, 'S1').primitives.some(p => p.owner === outlet.id && p.layer === 'PIPE'), 'no pipe after the valve');
  assert.ok(!reviewIso(doc).some(i => i.severity === 'error'), reviewIso(doc).map(i => i.message).join('\n'));
  // A flanged valve's open outlet carries no mating flange.
  const flanged = newIso();
  flanged.specs = [load('a', 'A')];
  flanged.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  appendRun(flanged, 'o', [1500, 0, 0], 'A', 4, 'S1', '');
  const gate = placeAtOpenEnd(flanged, flanged.runs[0].id, 1, T('GATE-FL'));
  const out = connected(flanged, gate.id).find(r => r.connector)!;
  assert.equal(gate.portFlanges?.[out.id]?.component, 'NONE');
  assert.throws(() => placeAtOpenEnd(flanged, flanged.runs[0].id, 1, T('BALL-SC')), /already has a fitting/);
});

test('Split sheet continues a line on a new spool, and each sheet letters the break with the other drawing number', () => {
  const doc = newIso();
  doc.specs = [load('a', 'A')];
  doc.drawing = 'ISO-100';
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  const corner = appendRun(doc, 'o', [3000, 0, 0], 'A', 4, 'SP-001', 'L1');
  appendRun(doc, corner.id, [0, 2000, 0], 'A', 4, 'SP-001', 'L1');
  setAutoFitting(doc, corner.id);
  const { spool, nodeId } = splitSheet(doc, { runId: doc.runs[1].id, fraction: 0.5 });
  assert.equal(spool, 'SP-002');
  assert.equal(getNode(doc, nodeId).kind, 'weld');
  assert.deepEqual(doc.runs.map(r => r.spool), ['SP-001', 'SP-001', 'SP-002']);
  const lettered = (s: string) => texts(doc, s).map(t => t.text).join('\n');
  assert.match(lettered('SP-001'), /CONT'D ON\nDWG# ISO-100-2/);
  assert.match(lettered('SP-002'), /CONT'D ON\nDWG# ISO-100-1/);
  doc.style = { ...doc.style!, breakCallouts: false };
  assert.doesNotMatch(lettered('SP-001'), /CONT'D ON/);
  // At a connection between pipes, the side routed on goes to the new sheet.
  const again = splitSheet(doc, { nodeId: corner.id });
  assert.equal(again.spool, 'SP-003');
  assert.equal(doc.runs.find(r => r.from === corner.id)!.spool, 'SP-003');
  assert.throws(() => splitSheet(doc, { nodeId: 'o' }), /pipe on both sides/);
});

test('a branch copied with its olet is pasted onto the header it is put on, in the header\'s spool', () => {
  const { doc, branches } = header();
  const b = branches[0], reached = new Set([b.olet.id]);
  // The olet and the pipes routed from it, as a window round the branch selects them.
  for (let grew = true; grew;) {
    grew = false;
    for (const r of doc.runs) if (r.nps < 3 && reached.has(r.from) && !reached.has(r.to)) { reached.add(r.to); grew = true; }
  }
  const ids = [b.olet.id, ...doc.runs.filter(r => r.nps < 3 && reached.has(r.from)).map(r => r.id)];
  const clip = copySelection(doc, ids)!;
  const before = doc.nodes.filter(n => n.kind === 'olet').length;
  const made = pastePieces(doc, clip, [100, 0, 0]);
  assert.deepEqual(made.spools, ['S1']);
  const olets = doc.nodes.filter(n => n.kind === 'olet');
  assert.equal(olets.length, before + 1);
  const pasted = olets.at(-1)!;
  assert.ok(doc.runs.some(r => r.id === pasted.associatedRunId && r.nps === 3), 'on the header');
  // Pasted off any pipe, the branch starts at an open end on a new spool.
  const away = pastePieces(doc, clip, [0, 0, 5000]);
  assert.notDeepEqual(away.spools, ['S1']);
});

test('a busy drawing beside its material list moves the list to a sheet of its own', () => {
  const { doc } = header();
  // A manifold of a dozen valved branches of three sizes, each turning down: drawn beside its long list it would crowd.
  [100, 250, 400, 650, 800, 1150, 1300, 1650, 1800].forEach((x, i) => {
    const nps = [0.75, 1, 1.25][i % 3];
    const host = doc.runs.find(r => r.nps === 3 && getNode(doc, r.from).position[0] < x && getNode(doc, r.to).position[0] > x)!;
    const a = getNode(doc, host.from).position[0], b = getNode(doc, host.to).position[0];
    const olet = placeComponentOnPipe(doc, host.id, T('H-CPLGSC'), (x - a) / (b - a), doc.specs[0].fittings.find(f => f.component === 'H-CPLGSC' && f.nps === nps));
    const turn = appendRun(doc, olet.id, [0, -400, 0], 'SS-A', nps, 'S1', '', 'THD');
    appendRun(doc, turn.id, [0, 0, -300 - 10 * i], 'SS-A', nps, 'S1', '', 'THD');
    setAutoFitting(doc, turn.id);
    placeComponentOnPipe(doc, doc.runs.at(-1)!.id, T('BALL-SC'), 0.5);
  });
  assert.deepEqual(drawingSheets(doc, 'S1'), ['drawing', 'materials']);
  // A plain spool keeps its list beside it.
  const plain = newIso();
  plain.specs = [load('a', 'A')];
  plain.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  const c = appendRun(plain, 'o', [3000, 0, 0], 'A', 4, 'S1', '');
  appendRun(plain, c.id, [0, 2000, 0], 'A', 4, 'S1', '');
  setAutoFitting(plain, c.id);
  assert.deepEqual(drawingSheets(plain, 'S1'), ['drawing']);
});

test('a specification kept in the library compares by content, whatever order its keys come back in', () => {
  const spec = load('a', 'A');
  const kept = librarySpec(spec);
  assert.equal(kept.fittings[0].id.startsWith('A:'), true);
  const shuffled = JSON.parse(JSON.stringify(kept), (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v);
  assert.equal(specText(shuffled), specText(librarySpec(spec)));
  const edited = clone(spec);
  edited.fittings[0].takeout += 1;
  assert.notEqual(specText(librarySpec(edited)), specText(kept));
});
