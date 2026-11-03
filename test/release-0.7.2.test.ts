import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, getNode, newIso, parseIsoJson, runResult, setAutoFitting, type PipeSpec } from '../src/core/model.ts';
import { insertOffset45 } from '../src/core/component-position.ts';
import { pickOrthoPoint, routingDirections } from '../src/core/grid.ts';
import { createDrawing, type Drawing, type Point } from '../src/core/drawing.ts';
import { sheetMaterials } from '../src/core/material-list.ts';
import { splitSheet } from '../src/editor/edit-ops.ts';
import { parsePointInput } from '../src/editor/command-line.ts';
import { snapPoints } from '../src/editor/snaps.ts';
import { namespaceSpec } from '../src/editor/library.ts';

const load = (slug: string, id = slug.toUpperCase()) =>
  namespaceSpec(JSON.parse(readFileSync(new URL(`../public/library/specs/${slug}.json`, import.meta.url), 'utf8')) as PipeSpec, id);
/** A 4" line on spec A: 3000 east to an elbow, then 2000 north to an open end. */
function line() {
  const doc = newIso();
  doc.specs = [load('a', 'A')];
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  const corner = appendRun(doc, 'o', [3000, 0, 0], 'A', 4, 'S1', '');
  const end = appendRun(doc, corner.id, [0, 2000, 0], 'A', 4, 'S1', '');
  setAutoFitting(doc, corner.id);
  return { doc, corner, end };
}

test('a 45° offset rolls two 45° elbows into a straight; the line beyond moves across and keeps its run', () => {
  const { doc, corner, end } = line();
  const [first, second] = insertOffset45(doc, doc.runs[0].id, 0.3, [0, 0, 1], 600);
  assert.deepEqual([first.kind, second.kind], ['elbow45', 'elbow45']);
  assert.deepEqual(first.position, [900, 0, 0]);
  assert.deepEqual(second.position, [1500, 0, 600]);
  assert.deepEqual(getNode(doc, corner.id).position, [3000, 0, 600], 'the corner moves up by the offset');
  assert.deepEqual(getNode(doc, end.id).position, [3000, 2000, 600]);
  assert.equal(sheetMaterials(doc, 'S1').find(r => /ELBOW 45/.test(r.description))?.qtyText, '2');
  assert.ok(doc.runs.every(r => runResult(doc, r).cut > 0));
  assert.throws(() => insertOffset45(doc, doc.runs.find(r => r.to === end.id)!.id, 0.5, [0, 1, 0], 300), /square to it/);
  assert.throws(() => insertOffset45(doc, doc.runs.find(r => r.to === end.id)!.id, 0.9, [1, 0, 0], 600), /too short/);
});

test('with 45° picking on, a pick may go between two axes, stepping whole blocks along each', () => {
  assert.equal(routingDirections(false).length, 6);
  assert.equal(routingDirections(true).length, 18);
  assert.ok(routingDirections(true, 'xz').slice(0, 8).every(v => v[1] === 0), 'an E–Up elevation puts east and up first');
  const project = (p: [number, number, number]): Point => [p[0], -p[1]];
  const drawing = { project } as unknown as Drawing;
  const settings = { visible: true, snap: true, spacing: 100, plane: 'xy' as const, ortho: true };
  assert.deepEqual(pickOrthoPoint(drawing, [310, -290], [0, 0, 0], settings), [300, 0, 0], 'Ortho alone keeps to an axis');
  assert.deepEqual(pickOrthoPoint(drawing, [310, -290], [0, 0, 0], { ...settings, polar45: true }), [300, 300, 0]);
  const ne = parsePointInput("NE 1000", 'mm');
  assert.equal(ne.kind, 'direction');
  if (ne.kind === 'direction') assert.ok(Math.abs(ne.direction[0] - Math.SQRT1_2) < 1e-9 && Math.abs(ne.direction[1] - Math.SQRT1_2) < 1e-9);
});

test('measure snaps to where each pipe meets its fittings', () => {
  const { doc } = line();
  const faces = snapPoints(doc, createDrawing(doc, 'S1')).filter(s => s.kind === 'face');
  // The first pipe's end at the elbow is the elbow's takeout (6") and root gap back from the corner.
  const r = runResult(doc, doc.runs[0]);
  assert.ok(faces.some(f => Math.abs(f.model[0] - (3000 - r.takeouts[1] - r.gaps[1])) < 0.01 && f.model[1] === 0));
});

test('a shop that takes up its weld gaps cuts to the takeouts alone', () => {
  const { doc } = line();
  const before = runResult(doc, doc.runs[1]);
  doc.profile = { weldGaps: 'ignore' };
  const after = runResult(doc, doc.runs[1]);
  assert.ok(Math.abs(after.cut - (before.cut + before.gaps[0] + before.gaps[1])) < 1e-9);
  assert.deepEqual(after.gaps, [0, 0]);
  assert.equal(parseIsoJson(JSON.stringify(doc)).profile?.weldGaps, 'ignore');
});

test('one automatic CONT\'D ON note can be left off at its break', () => {
  const { doc } = line();
  doc.drawing = 'ISO-1';
  const { nodeId } = splitSheet(doc, { runId: doc.runs[1].id, fraction: 0.5 });
  const notes = () => createDrawing(doc, 'S1').primitives.filter(p => p.type === 'text' && /CONT'D ON/.test(p.text)).length;
  assert.equal(notes(), 1);
  getNode(doc, nodeId).hideBreakCallout = true;
  assert.equal(notes(), 0);
  assert.equal(parseIsoJson(JSON.stringify(doc)).nodes.find(n => n.id === nodeId)?.hideBreakCallout, true);
});

test('a pipe prepared for another joint than its fitting is reported', async () => {
  const { reviewIso } = await import('../src/core/review.ts');
  const { doc, corner } = line();
  doc.runs[1].fromPrep = 'SW';
  assert.ok(reviewIso(doc).some(i => /butt-weld ends, but a pipe into it is prepared socket-weld/.test(i.message)));
  void corner;
});
