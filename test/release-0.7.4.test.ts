import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, newIso, parseIsoJson, runPipeSize, runResult, scheduleChoices, setAutoFitting, type PipeSpec } from '../src/core/model.ts';
import { fittingSchedule, sheetMaterials } from '../src/core/material-list.ts';
import { pipeWall } from '../src/core/standards.ts';
import { extendRun } from '../src/editor/edit-ops.ts';
import { namespaceSpec } from '../src/editor/library.ts';

const load = (slug: string, id = slug.toUpperCase()) =>
  namespaceSpec(JSON.parse(readFileSync(new URL(`../public/library/specs/${slug}.json`, import.meta.url), 'utf8')) as PipeSpec, id);
/** A 4" stainless line on SS-A (Sch 10S at 4"): 3000 east to an elbow, then 2000 north to an open end. */
function line() {
  const doc = newIso();
  doc.specs = [load('ss-a', 'SS-A')];
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  const corner = appendRun(doc, 'o', [3000, 0, 0], 'SS-A', 4, 'S1', '');
  const end = appendRun(doc, corner.id, [0, 2000, 0], 'SS-A', 4, 'S1', '');
  setAutoFitting(doc, corner.id);
  return { doc, corner, end };
}

test('a stainless size offers the B36.19M schedules listed at it; carbon the B36.10M ones; tube none', () => {
  const ss = load('ss-a', 'SS-A'), a = load('a', 'A'), san = load('san-a', 'SAN-A');
  assert.deepEqual(scheduleChoices(ss, 4), ['SCH.5S', 'SCH.10S', 'SCH.40S', 'SCH.80S', 'SCH.160', 'XXS']);
  assert.ok(scheduleChoices(ss, 0.5).includes('SCH.40S'));
  assert.deepEqual(scheduleChoices(a, 2), ['STD.', 'SCH.40', 'XS', 'SCH.80', 'SCH.160', 'XXS']);
  assert.ok(scheduleChoices(a, 12).includes('SCH.20'));
  assert.deepEqual(scheduleChoices(san, 1.5), []);
});

test('a pipe routed in Sch 40S is bought, weighed and described in Sch 40S, and so are the butt-weld fittings on it', () => {
  const { doc } = line();
  const spec = doc.specs[0], own = spec.sizes.find(s => s.nps === 4)!;
  assert.equal(own.schedule, 'SCH.10S');
  for (const r of doc.runs) r.schedule = 'SCH.40S';
  const size = runPipeSize(doc, doc.runs[0])!;
  assert.equal(size.wall, pipeWall(4, '40S'));
  assert.equal(size.od, own.od);
  assert.ok(Math.abs(size.kgM - Math.PI * (size.od - size.wall) * size.wall * spec.density / 1e6) < 0.001);
  assert.ok(size.kgM > own.kgM);
  const rows = sheetMaterials(doc, 'S1');
  const pipe = rows.filter(r => r.category === 'pipe'), elbow = rows.find(r => r.category === 'elbow90')!;
  assert.ok(pipe.length && pipe.every(r => /SCH 40S/.test(r.description) && !/10S/.test(r.description)), pipe.map(r => r.description).join(' | '));
  assert.match(elbow.description, /SCH 40S/);
  assert.doesNotMatch(elbow.description, /10S/);
  // The cut does not change: B16.9 elbows have one centre-to-end whatever the wall.
  const before = line().doc;
  assert.equal(runResult(doc, doc.runs[0]).cut, runResult(before, before.runs[0]).cut);
  // Back to the specification's schedule, the rows read as before.
  for (const r of doc.runs) delete r.schedule;
  assert.ok(sheetMaterials(doc, 'S1').find(r => r.category === 'elbow90')!.description.includes('10S'));
  // The schedule is kept with the drawing.
  doc.runs[0].schedule = 'SCH.40S';
  assert.equal(parseIsoJson(JSON.stringify(doc)).runs[0].schedule, 'SCH.40S');
  assert.throws(() => parseIsoJson(JSON.stringify({ ...doc, runs: [{ ...doc.runs[0], schedule: 40 }, ...doc.runs.slice(1)] })), /schedule/);
});

test('a reducer between two schedules gives each end its own pipe schedule', () => {
  const ss = load('ss-a', 'SS-A'), row = ss.fittings.find(f => f.component === 'C-RED' && f.nps === 4 && f.smallerNps === 2)!;
  assert.equal(row.schedule, 'SCH.10S/SCH.80S');
  const big = { id: 'a', from: '', to: '', specId: 'SS-A', nps: 4, spool: 'S1', line: '', heat: '', endPrep: 'BW' as const, schedule: 'SCH.40S' };
  const small = { ...big, id: 'b', nps: 2, schedule: undefined };
  assert.equal(fittingSchedule(row, [big, small]), 'SCH.40S/SCH.80S');
  assert.equal(fittingSchedule(row, [{ ...big, schedule: undefined }, small]), 'SCH.10S/SCH.80S', 'unchanged on specification pipe');
});

test('routing on straight at another schedule starts a new pipe instead of lengthening the last', () => {
  const { doc, end } = line();
  const route = { specId: 'SS-A', nps: 4, spool: 'S1', line: '', prep: 'BW' as const };
  assert.equal(extendRun(doc, end.id, [0, 500, 0], { ...route, schedule: 'SCH.40S' }), null);
  assert.ok(extendRun(doc, end.id, [0, 500, 0], route));
});
