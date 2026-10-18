import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { SaveQueue } from '../src/editor/save-queue';
import { lengthInputValue, parseLength, newIso, appendRun, bom, displayBom, formatAllowance, formatLength } from '../src/core/model';
import { editedLength } from '../src/core/format';
import { materialCsv } from '../src/core/schedules';

test('length fields show drafting text and never rewrite a value they only show', () => {
  for (const mm of [1000, 100, 1.5, 0.5, 76.2, 304.8, 838.2, -1000, 123.456789, 438.13, 33.4, 1.6]) {
    for (const units of ['mm', 'imperial'] as const) {
      for (const precision of ['drafting', 'fine'] as const) {
        const shown = lengthInputValue(mm, units, precision);
        // Tabbing through the field commits nothing, however the value was rounded for reading.
        assert.equal(editedLength(shown, mm, units, precision, true), undefined, `${mm} ${units} ${precision}`);
        // The text reads back within its own rounding: 1/32″ for feet-inches, 0.0005″ fine, 0.05 / 0.005 mm.
        const tolerance = units === 'mm' ? (precision === 'fine' ? 0.005 : 0.05) : precision === 'fine' ? 0.0005 * 25.4 + 1e-3 : 25.4 / 32;
        assert.ok(Math.abs(parseLength(shown, units, true) - mm) <= tolerance + 1e-9, `${mm} ${units} ${precision}: ${shown}`);
      }
    }
  }
  assert.equal(lengthInputValue(304.8, 'imperial'), '1′ 0″');
  // QA: raw floats never reach a field.
  assert.equal(lengthInputValue(17.2492126 * 25.4, 'imperial'), '1′ 5 1/4″');
  assert.equal(lengthInputValue(1.31496063 * 25.4, 'imperial', 'fine'), '1.315″');
  assert.equal(lengthInputValue(0.06299213 * 25.4, 'imperial', 'fine'), '0.063″');
  assert.equal(lengthInputValue(25.4 / 16, 'imperial', 'fine'), '0.0625″');
  assert.equal(lengthInputValue(88.9, 'imperial', 'fine'), '3.5″');
  assert.equal(lengthInputValue(10.3, 'imperial', 'fine'), '0.406″');
  assert.equal(lengthInputValue(12.7, 'imperial'), '1/2″');
  assert.equal(lengthInputValue(123.456789, 'mm'), '123.5');
  assert.equal(lengthInputValue(3.378, 'mm', 'fine'), '3.38');
  assert.equal(lengthInputValue(-0.01, 'mm'), '0');
  // Typing a different value commits it; typing the shown value again, or the value held, does not.
  assert.equal(editedLength('1\' 5 1/2"', 17.2492126 * 25.4, 'imperial'), 17.5 * 25.4);
  assert.equal(editedLength('438.13 mm', 438.13, 'imperial'), undefined);
  assert.throws(() => editedLength('abc', 10, 'imperial'));
});

test('interface lengths write a fraction under an inch without a leading zero', () => {
  assert.equal(formatLength(12.7, 'imperial'), '1/2″');
  assert.equal(formatLength(-12.7, 'imperial'), '−1/2″');
  assert.equal(formatLength(0, 'imperial'), '0″');
  assert.equal(formatLength(25.4 * 12.5, 'imperial'), '1′ 0 1/2″');
  assert.equal(formatLength(25.4 * 3.25, 'imperial'), '3 1/4″');
  for (const text of ['1/2″', '−1/2″', '1′ 0 1/2″']) assert.equal(formatLength(parseLength(text, 'imperial', true), 'imperial'), text);
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
  assert.match(materialCsv(doc), /Weight lb/);
  // The material list orders pipe as the sheet does, in feet and inches.
  assert.match(materialCsv(doc), /"10'","ft-in"/);
  assert.equal(bom(doc)[0].qty, 3.048);
  assert.notEqual(formatAllowance(0.5, 'imperial'), '0″');
  assert.equal(formatAllowance(0.5, 'imperial'), '0.02″');
  assert.equal(formatAllowance(1.6, 'imperial'), '0.063″');
  assert.equal(formatAllowance(1.6, 'mm'), '1.6 mm');
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
