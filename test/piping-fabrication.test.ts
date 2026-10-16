import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { appendRun, applyComponent, attachComponent, clone, newIso, runResult, validateIso, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { standardRow } from '../src/core/standards.ts';

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
  const plug = appendRun(doc, valve.id, [0, 0, 100], 'A', 0.75, 'SP', 'L', 'THD');
  applyComponent(doc, valve, 'GATE-SC', row(doc, 'GATE-SC', 0.75));
  applyComponent(doc, plug, 'PLUG', row(doc, 'PLUG', 0.75));
  assert.deepEqual(validateIso(doc), []);
});
