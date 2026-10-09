import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { SaveQueue } from '../src/editor/save-queue';
import { lengthInputValue, parseLength, newIso, appendRun, bom, bomCsv, displayBom, formatAllowance } from '../src/core/model';

test('length edit values retain exact metric measurements in either working unit', () => {
  for (const mm of [1000, 100, 1.5, 0.5, 76.2, 304.8, 838.2, -1000, 123.456789]) {
    for (const units of ['mm', 'imperial'] as const) {
      assert.ok(Math.abs(parseLength(lengthInputValue(mm, units), units, true) - mm) < 1e-6, `${mm} ${units}`);
    }
  }
  assert.equal(lengthInputValue(304.8, 'imperial'), '1′ 0″');
});

test('imperial material schedules use feet and pounds without changing model quantities', () => {
  const doc = newIso();
  appendRun(doc, null, [3048, 0, 0], 'CS40', 2, 'SP-1', '');
  const row = bom(doc)[0];
  const metric = displayBom(row, 'mm'), imperial = displayBom(row, 'imperial');
  assert.equal(metric.quantity, 3.048);
  assert.equal(imperial.quantity, 10);
  assert.equal(imperial.unit, 'ft');
  assert.ok(Math.abs(imperial.weight! * 0.45359237 - metric.weight!) < 1e-9);
  doc.units = 'imperial';
  assert.match(bomCsv(doc), /Weight lb/);
  assert.match(bomCsv(doc), /"10","ft"/);
  assert.equal(bom(doc)[0].qty, 3.048);
  assert.notEqual(formatAllowance(0.5, 'imperial'), '0″');
  assert.ok(Math.abs(parseLength(formatAllowance(0.5, 'imperial'), 'imperial') - 0.5) < 1e-6);
});

test('saving drains edits made during a pending write before resolving', async () => {
  const values: string[] = [];
  let release!: () => void;
  const queue = new SaveQueue(async value => {
    values.push(value);
    if (value === 'first') await new Promise<void>(resolve => { release = resolve; });
  });
  queue.content = 'first';
  const saving = queue.flush();
  await Promise.resolve();
  queue.content = 'latest';
  assert.equal(queue.flush(), saving);
  release();
  await saving;
  assert.deepEqual(values, ['first', 'latest']);
  assert.equal(queue.saved, 'latest');
  assert.equal(queue.dirty, false);
});

test('a failed save stays dirty and retries the latest content', async () => {
  const queue = new SaveQueue(async () => { throw new Error('disk full'); });
  queue.content = 'first';
  await assert.rejects(queue.flush(), /disk full/);
  assert.equal(queue.saved, '');
  assert.equal(queue.dirty, true);
  queue.content = 'latest';
  const writes: string[] = [];
  queue.write = async value => { writes.push(value); };
  await queue.flush();
  assert.deepEqual(writes, ['latest']);
  assert.equal(queue.dirty, false);
});

test('undo during an in-flight save restores the previous persisted content', async () => {
  let release!: () => void;
  const values: string[] = [];
  const queue = new SaveQueue(async value => {
    values.push(value);
    if (value === 'edited') await new Promise<void>(resolve => { release = resolve; });
  });
  queue.saved = 'original';
  queue.content = 'edited';
  const saving = queue.flush();
  await Promise.resolve();
  queue.content = 'original';
  release();
  await saving;
  assert.deepEqual(values, ['edited', 'original']);
  assert.equal(queue.saved, 'original');
});

const { writeDrawing } = createRequire(import.meta.url)('../desktop/write-drawing.cjs') as {
  writeDrawing: (path: string, content: string) => Promise<void>;
};

test('desktop writes commit complete files in order without leaving temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spoolyard-save-'));
  try {
    const target = join(directory, 'drawing.piping');
    await writeDrawing(target, 'original');
    await Promise.all([writeDrawing(target, 'one'.repeat(10000)), writeDrawing(target, 'latest')]);
    assert.equal(await readFile(target, 'utf8'), 'latest');
    assert.deepEqual(await readdir(directory), ['drawing.piping']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
