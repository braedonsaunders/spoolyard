import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, csv, newIso, parseIsoJson, PIPING_FORMAT_VERSION } from '../src/core/model.ts';
import { cutCsv, decimalLength, materialCsv } from '../src/core/schedules.ts';

/** RFC 4180 rows of a CSV this app writes (every cell quoted). */
const rows = (text: string) => text.split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"')));

test('CSV guards formulas without turning negative numbers into text', () => {
  const [cells] = rows(csv([[-12.5, '-12.5', '-3e2', '+4', '=SUM(A1:A9)', '@cmd', '\tcmd', '\rcmd', '-2+3', "-1'-6\"", 'plain', 0]]));
  assert.deepEqual(cells, ['-12.5', '-12.5', '-3e2', '+4', "'=SUM(A1:A9)", "'@cmd", "'\tcmd", "'\rcmd", "'-2+3", "'-1'-6\"", 'plain', '0']);
});

test('cut and material CSVs give lengths as decimal millimetres and inches beside their drafting text', () => {
  const doc = newIso(); doc.units = 'imperial';
  appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
  const cut = rows(cutCsv(doc)), heading = cut[0], row = cut[1];
  for (const name of ['Overall', 'Start takeout', 'End takeout', 'Start gap', 'End gap', 'Cut'])
    assert.ok(heading.includes(`${name} mm`) && heading.includes(`${name} in`), name);
  const at = (name: string) => Number(row[heading.indexOf(name)]);
  assert.equal(at('Overall mm'), 1000);
  assert.equal(at('Overall in'), Number((1000 / 25.4).toFixed(3)));
  assert.equal(at('Cut mm'), 1000);
  assert.deepEqual(decimalLength(NaN), ['', '']);
  const material = rows(materialCsv(doc)), columns = material[0], pipe = material.find(r => r[columns.indexOf('Unit')] === 'ft-in')!;
  const mm = Number(pipe[columns.indexOf('Pipe length mm')]), inches = Number(pipe[columns.indexOf('Pipe length in')]);
  assert.ok(mm >= 1000 && Math.abs(inches * 25.4 - mm) < 0.02);
});

test('.piping files: a newer format is refused clearly, damage is reported, and errors name the part', () => {
  const doc = newIso(); appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  const newer = { ...doc, version: PIPING_FORMAT_VERSION + 1 };
  assert.throws(() => parseIsoJson(JSON.stringify(newer)), /saved by a newer version of Spoolyard \(file format 2/);
  assert.throws(() => parseIsoJson(JSON.stringify(doc).slice(0, 200)), /not valid JSON; it may be truncated or damaged/);
  const bad = structuredClone(doc); (bad.nodes[1] as { valveSymbol?: string }).valveSymbol = 'teapot';
  assert.throws(() => parseIsoJson(JSON.stringify(bad)), new RegExp(`Invalid component callout at nodes\\[1\\] \\(id ${bad.nodes[1].id}\\)`));
  const fitting = structuredClone(doc); fitting.specs[0].fittings[3].takeout = -1;
  assert.throws(() => parseIsoJson(JSON.stringify(fitting)), /at specs\[0\]\.fittings\[3\]/);
});
