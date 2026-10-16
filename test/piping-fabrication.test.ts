import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { appendRun, applyComponent, clone, newIso, runResult, type IsoDocument, type PipeSpec } from '../src/core/model.ts';

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
