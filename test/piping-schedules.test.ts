import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, applyComponent, attachComponent, distance, getNode, newIso, welds } from '../src/core/model.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';
import { COMPONENT_TYPE_BY_CODE } from '../src/core/components.ts';
import { flangedJoints, matingFlange } from '../src/core/joints.ts';
import { draftLength } from '../src/core/format.ts';
import { sheetMaterials } from '../src/core/material-list.ts';
import {
  allowanceText, cutCsv, cutSchedule, lengthText, materialCsv, overallText, materialSchedule, pipeEnd, scheduleText, weldCsv, weldRow, weldSchedule
} from '../src/core/schedules.ts';

test('welds are numbered in sequence along each spool, not in the order the pipes were drawn', () => {
  const doc = newIso();
  // Drawn from the middle out: east, then north from its end, then down from the start.
  const corner = appendRun(doc, null, [2000, 0, 0], 'CS40', 4, 'SP-1', 'L-1');
  const start = getNode(doc, doc.runs[0].from);
  const far = appendRun(doc, corner.id, [0, 1500, 0], 'CS40', 4, 'SP-1', 'L-1');
  const low = appendRun(doc, start.id, [0, 0, -1000], 'CS40', 4, 'SP-1', 'L-1');
  // A second spool continues from the open north end.
  appendRun(doc, far.id, [0, 1000, 0], 'CS40', 4, 'SP-2', 'L-1');
  const list = welds(doc);
  assert.deepEqual(list.map(w => w.tag), ['W1', 'W2', 'W3', 'W4', 'W5']);
  // From the open end of SP-1 to the other end: each weld is further along than the last.
  const path = [far.position, corner.position, start.position, low.position];
  const along = (p: [number, number, number]) => {
    let best = Infinity, total = 0, at = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], l = distance(a, b), t = Math.max(0, Math.min(1, [0, 1, 2].reduce((s, k) => s + (p[k] - a[k]) * (b[k] - a[k]), 0) / (l * l)));
      const d = distance(p, [0, 1, 2].map(k => a[k] + (b[k] - a[k]) * t) as [number, number, number]);
      if (d < best) { best = d; at = total + t * l; }
      total += l;
    }
    return at;
  };
  const order = list.map(w => along(w.position));
  assert.deepEqual(order, [...order].sort((a, b) => b - a));
  // The walk starts at SP-1's open end, so the butt weld to SP-2 at the far end is numbered last.
  assert.equal(list.at(-1)!.nodeId, far.id);
});

test('the cut list, material schedule and CSVs carry the sheet bill of materials numbers', () => {
  const doc = newIso();
  // Drawn out of order, with a flanged valve splitting one pipe into two equal pieces, and a second spool.
  const corner = appendRun(doc, null, [2000, 0, 0], 'CS40', 4, 'SP-1', 'L-1');
  const start = getNode(doc, doc.runs[0].from);
  const far = appendRun(doc, corner.id, [0, 1500, 0], 'CS40', 4, 'SP-1', 'L-1');
  appendRun(doc, start.id, [0, 0, -1000], 'CS40', 4, 'SP-1', 'L-1');
  placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPE_BY_CODE['GATE-FL'], 0.5);
  appendRun(doc, far.id, [0, 800, 0], 'CS40', 4, 'SP-2', 'L-1');
  const cuts = cutSchedule(doc);
  assert.deepEqual(cuts.map(c => [c.spool, c.item, c.piece, c.pieces]), [
    ['SP-1', 1, 1, 1], ['SP-1', 2, 1, 2], ['SP-1', 2, 2, 2], ['SP-1', 3, 1, 1], ['SP-2', 1, 1, 1]
  ]);
  for (const c of cuts) {
    const row = sheetMaterials(doc, c.spool).find(r => r.id === c.item)!;
    // Each piece is the pipe its sheet tags with that number, cut to the length the sheet gives.
    assert.equal(row.memberIds[c.piece - 1], c.run.id);
    assert.ok(row.description.includes('CUT TO ' + draftLength(c.cut, 'mm')), row.description);
  }
  const schedule = materialSchedule(doc);
  for (const spool of ['SP-1', 'SP-2'])
    assert.deepEqual(schedule.filter(r => r.spool === spool).map(r => [r.id, r.qtyText, r.nd, r.description]),
      sheetMaterials(doc, spool).map(r => [r.id, r.qtyText, r.nd, r.description]));
  const cutLines = cutCsv(doc).split('\r\n');
  assert.match(cutLines[0], /"Item","Piece".*"Overall \(mm\)".*"Cut \(mm\)","Start end","End end"/);
  assert.match(cutLines[2], /^"ISO-001-1","SP-1","2","1 of 2","4""",/);
  const materialLines = materialCsv(doc).split('\r\n');
  assert.equal(materialLines.length, 1 + schedule.length);
  assert.ok(materialLines.some(l => l.startsWith('"ISO-001-2","SP-2","1",')));
});

test('cut overalls run between the sheet dimension points, with the pipe end prep and drafting lengths', () => {
  const doc = newIso();
  appendRun(doc, null, [2000, 0, 0], 'CS40', 4, 'SP-1', 'L-1');
  const valve = placeComponentOnPipe(doc, doc.runs[0].id, COMPONENT_TYPE_BY_CODE['GATE-FL'], 0.5);
  const [first] = cutSchedule(doc), run = first.run;
  const face = flangedJoints(doc).find(j => j.id === `${valve.id}:${run.id}`)!;
  // The sheet dimensions the valve between its mating flange faces, across the gaskets.
  const end = getNode(doc, run.from === valve.id ? run.to : run.from).position;
  assert.ok(Math.abs(first.overall - (distance(end, face.position) - face.gasket!.thickness)) < 1e-9);
  // So the takeout at the valve is the weld-neck flange alone, and the pipe end is bevelled for it.
  const hub = matingFlange(doc, valve, run)!.item!.takeout;
  assert.ok(Math.abs(first.takeouts[run.from === valve.id ? 0 : 1] - hub) < 1e-9);
  assert.ok(Math.abs(first.overall - first.takeouts[0] - first.takeouts[1] - first.gaps[0] - first.gaps[1] - first.cut) < 1e-9);
  assert.deepEqual(first.ends, ['BE', 'BE']);
  // A valve with no weight in the specification is unknown, not zero.
  assert.equal(materialSchedule(doc).find(r => r.memberIds.includes(valve.id))!.weightKg, null);
  // Ends: plain into a socket or slip-on, threaded, bevelled.
  const small = newIso();
  appendRun(small, null, [300, 0, 0], 'CS40', 0.75, 'SP', '', 'SW');
  small.runs[0].toPrep = 'THD';
  assert.deepEqual([pipeEnd(small, small.runs[0], 0), pipeEnd(small, small.runs[0], 1)], ['PE', 'TE']);
  small.runs[0].fromPrep = 'PLAIN';
  assert.equal(pipeEnd(small, small.runs[0], 0), 'PE');
  // Drafting lengths: no leading zero inches, fractions reduced, whole millimetres for lengths.
  assert.equal(allowanceText(25.4 * 9 / 16, 'imperial'), '9/16"');
  assert.equal(allowanceText(0.5, 'imperial'), '0.02"');
  assert.equal(allowanceText(193.67, 'mm'), '193.7');
  assert.equal(lengthText(25.4 * 15.5, 'imperial'), `1'-3 1/2"`);
  assert.equal(lengthText(630.2, 'mm'), '630');
  // Overalls read as the sheet's dimensions do, in inches below two feet.
  assert.equal(overallText(25.4 * 15, 'imperial'), '15"');
  assert.equal(lengthText(NaN, 'mm'), '—');
});

test('the weld map gives each weld its type, size, schedule and the parts it joins', () => {
  const doc = newIso();
  const corner = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'SP-1', 'L-1');
  appendRun(doc, corner.id, [0, 1000, 0], 'CS40', 4, 'SP-1', 'L-1');
  assert.deepEqual(weldSchedule(doc).map(r => [r.weld.tag, r.type, r.size, r.schedule, r.joint]), [
    ['W1', 'BUTT', '4"', 'SCH 40', 'PIPE–ELL'], ['W2', 'BUTT', '4"', 'SCH 40', 'PIPE–ELL']
  ]);
  // The shop fills in WPS, NDE and welder.
  const lines = weldCsv(doc).split('\r\n');
  assert.equal(lines[0], '"Weld","Drawing","Spool","Line","Type","Size","Schedule","Joint","Shop/field","WPS","NDE %","Welder"');
  assert.equal(lines[1], '"W1","ISO-001","SP-1","L-1","BUTT","4""","SCH 40","PIPE–ELL","SHOP","","",""');
  // Socket-welded small bore.
  const small = newIso();
  const bend = appendRun(small, null, [300, 0, 0], 'CS40', 0.75, 'SP', '', 'SW');
  appendRun(small, bend.id, [0, 300, 0], 'CS40', 0.75, 'SP', '', 'SW');
  assert.deepEqual(weldSchedule(small).map(r => [r.type, r.size, r.joint]), [['SOCKET FILLET', '3/4"', 'PIPE–ELL'], ['SOCKET FILLET', '3/4"', 'PIPE–ELL']]);
  // An olet's weld to its header is a branch weld, sized header by outlet.
  const olet = attachComponent(doc, doc.runs[0].id, 'olet', 0.5);
  applyComponent(doc, olet, 'SOL');
  appendRun(doc, olet.id, [0, 0, 300], 'CS40', 0.75, 'SP-1', 'L-1', 'SW');
  const branch = weldRow(doc, { tag: 'W9', runId: doc.runs[0].id, nodeId: olet.id, nps: 4, field: false, prep: 'BW', position: olet.position });
  assert.deepEqual([branch.type, branch.size, branch.joint], ['BRANCH', '4"X3/4"', 'PIPE–SOL']);
  assert.deepEqual(['STD.', 'SCH.10S', '40', 'XS', 'Sch 80'].map(scheduleText), ['STD', 'SCH 10S', 'SCH 40', 'XS', 'SCH 80']);
});
