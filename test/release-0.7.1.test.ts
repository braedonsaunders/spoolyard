import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, connected, getNode, newIso, runResult, setAutoFitting, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { COMPONENT_TYPE_BY_CODE } from '../src/core/components.ts';
import { capOpenEnd, closeCouple, placeAtOpenEnd, placeComponentOnPipe, sizePipesToRow } from '../src/core/component-position.ts';
import { createDrawing } from '../src/core/drawing.ts';
import { scheduleRanges } from '../src/core/format.ts';
import { sheetMaterials } from '../src/core/material-list.ts';
import { setSpanLength, stretchLeg } from '../src/editor/edit-ops.ts';
import { namespaceSpec } from '../src/editor/library.ts';
import { isStaleBuild } from '../src/app/update-reload.ts';

const load = (slug: string, id = slug.toUpperCase()) =>
  namespaceSpec(JSON.parse(readFileSync(new URL(`../public/library/specs/${slug}.json`, import.meta.url), 'utf8')) as PipeSpec, id);
const T = (code: string) => COMPONENT_TYPE_BY_CODE[code];
/** A 4" line on spec A: 1500 east to an elbow, then 1000 north to an open end. */
function line(prep: 'BW' | 'THD' = 'BW', nps = 4) {
  const doc = newIso();
  doc.specs = [load('a', 'A')];
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  const corner = appendRun(doc, 'o', [1500, 0, 0], 'A', nps, 'S1', '', prep);
  const end = appendRun(doc, corner.id, [0, 1000, 0], 'A', nps, 'S1', '', prep);
  setAutoFitting(doc, corner.id);
  return { doc, corner, end };
}
const length = (doc: IsoDocument, runId: string) => {
  const r = doc.runs.find(x => x.id === runId)!, a = getNode(doc, r.from).position, b = getNode(doc, r.to).position;
  return Math.hypot(...a.map((v, i) => b[i] - v));
};

test('choosing a reducer row of other sizes resizes the line beyond it', () => {
  const { doc, end } = line();
  const reducer = placeComponentOnPipe(doc, doc.runs[0].id, T('C-RED'), 0.5, doc.specs[0].fittings.find(f => f.component === 'C-RED' && f.nps === 4 && f.smallerNps === 3));
  const beyond = () => connected(doc, end.id)[0].nps;
  assert.equal(beyond(), 3);
  reducer.catalogId = doc.specs[0].fittings.find(f => f.component === 'C-RED' && f.nps === 4 && f.smallerNps === 2)!.id;
  sizePipesToRow(doc, reducer.id);
  assert.equal(beyond(), 2, 'the small side and the line beyond it are 2"');
  assert.deepEqual(connected(doc, reducer.id).map(r => r.nps).sort(), [2, 4]);
});

test('a plug closes a valve\'s open outlet, where there is no pipe to click', () => {
  const { doc, end } = line('THD', 1);
  const valve = placeAtOpenEnd(doc, connected(doc, end.id)[0].id, 1, T('BALL-SC'));
  const outlet = connected(doc, valve.id).find(r => r.connector)!, open = getNode(doc, outlet.to);
  const plug = capOpenEnd(doc, open.id, T('PLUG'));
  assert.equal(plug.kind, 'cap');
  assert.equal(plug.component, 'PLUG');
  assert.ok(sheetMaterials(doc, 'S1').some(r => /PLUG/i.test(r.description)), 'the plug is bought');
  assert.throws(() => capOpenEnd(doc, valve.id, T('PLUG')), /already has a fitting/);
});

test('fittings weld straight together: by command, and by dragging one up against the other', () => {
  // A command: the elbow-to-end pipe becomes the two fittings' makeup, with no pipe piece.
  const a = line();
  const cap = placeComponentOnPipe(a.doc, connected(a.doc, a.end.id)[0].id, T('W-CAP'), 1);
  const between = connected(a.doc, cap.id)[0];
  const makeup = runResult(a.doc, between).overall - runResult(a.doc, between).cut;
  closeCouple(a.doc, between.id);
  assert.ok(between.connector);
  assert.ok(Math.abs(length(a.doc, between.id) - makeup) < 0.01);
  assert.equal(sheetMaterials(a.doc, 'S1').filter(r => /^PIPE/.test(r.description)).length, 1, 'only the first pipe is cut');
  // A drag past the makeup stops at it and welds the fittings together; dragged apart again, it is pipe.
  const b = line();
  const north = connected(b.doc, b.end.id)[0];
  placeComponentOnPipe(b.doc, north.id, T('W-CAP'), 1);
  const elbowToCap = connected(b.doc, b.end.id)[0], fit = runResult(b.doc, elbowToCap), m = fit.overall - fit.cut;
  stretchLeg(b.doc, elbowToCap.id, b.end.id, [0, -990, 0]);
  assert.ok(elbowToCap.connector && Math.abs(length(b.doc, elbowToCap.id) - m) < 0.01);
  stretchLeg(b.doc, elbowToCap.id, b.end.id, [0, 300, 0]);
  assert.ok(!elbowToCap.connector);
});

test('a dimension typed in place moves the second point along its straight', () => {
  const { doc, corner, end } = line();
  const valve = placeComponentOnPipe(doc, doc.runs[0].id, T('GATE-FL'), 0.4);
  const at = () => getNode(doc, valve.id).position[0];
  // Valve centre at 600 from the open end: set to 700.
  setSpanLength(doc, 'o', valve.id, at(), 700);
  assert.ok(Math.abs(at() - 700) < 0.01);
  // The corner to the open end, 1000: set to 1200 stretches the pipe.
  setSpanLength(doc, corner.id, end.id, 1000, 1200);
  assert.ok(Math.abs(getNode(doc, end.id).position[1] - 1200) < 0.01);
  // Every dimension between two connections carries what it measures, so it can be edited in place.
  const spans = createDrawing(doc, 'S1').primitives.filter(p => p.type === 'text' && (p.span || p.role));
  assert.ok(spans.length >= 3);
});

test('a specification\'s schedules are told by size range; a stale build is recognised', () => {
  assert.equal(scheduleRanges(load('ss-a', 'SS-A')), 'SCH 80S 1/2"–2" · SCH 10S 2 1/2"–24"');
  assert.equal(scheduleRanges({ schedule: 'STD.', sizes: [{ nps: 2, schedule: 'STD.' }, { nps: 4, schedule: 'STD.' }] }), 'STD');
  assert.ok(isStaleBuild(new TypeError('Failed to fetch dynamically imported module: https://x/assets/export-abc.js')));
  assert.ok(!isStaleBuild(new Error('Enter a positive length.')));
});
