import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, insertComponent, newIso, type IsoDocument } from '../src/core/model.ts';
import { isometricDxf } from '../src/core/document.ts';

// The DWG writer's own files, as the worker loads them (plain JavaScript beside the WebAssembly).
const asset = (name: string) => new URL(`../public/dwg-export/${name}`, import.meta.url);
const { writerCompatibleDxf } = (await import(asset('dxf-compat.js').href)) as { writerCompatibleDxf: (dxf: string) => string };

type Pair = [number, string];
function parse(dxf: string): Pair[][] {
  const lines = dxf.replace(/\n$/, '').split('\n'), records: Pair[][] = [];
  assert.equal(lines.length % 2, 0, 'group codes and values pair up');
  for (let i = 0; i < lines.length; i += 2) {
    const pair: Pair = [Number(lines[i]), lines[i + 1]];
    if (pair[0] === 0) records.push([pair]);
    else records.at(-1)!.push(pair);
  }
  return records;
}
const isHandle = (c: number) => c === 5 || c === 105 || (c >= 320 && c <= 369) || (c >= 390 && c <= 399) || c === 480 || c === 481 || c === 1005;
const headerSeed = (records: Pair[][]) => {
  const header = records.find(r => r[0][1] === 'SECTION' && r[1]?.[1] === 'HEADER')!;
  const i = header.findIndex(([c, v]) => c === 9 && v === '$HANDSEED');
  return header[i + 1];
};
const handlesOf = (records: Pair[][]) => {
  const seed = headerSeed(records);
  return records.flatMap(r => r.filter(p => (p[0] === 5 || p[0] === 105) && p !== seed).map(([, v]) => v));
};
const seedsOf = (records: Pair[][]) =>
  records.filter(r => r[0][1] === 'HATCH').flatMap(r => r.slice(r.findIndex(([c]) => c === 98) + 1).filter(([c]) => c === 10).map(([, v]) => Number(v)));

/** An invented drawing: two pipes, an elbow and a flanged valve (welds draw filled dots: HATCHes in a block). */
function sample(): IsoDocument {
  const doc = newIso();
  const elbow = appendRun(doc, null, [1500, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
  appendRun(doc, elbow.id, [0, 1500, 0], 'CS40', 2, 'SP-1', 'L-1');
  insertComponent(doc, doc.runs[1].id, 'valve');
  return doc;
}
/** The stored piping model padded to the size of a large drawing's (about 800 kB of text in its XRECORD). */
function withLargeModel(dxf: string): string {
  const lines = dxf.split('\n'), at = lines.findIndex((l, i) => l === 'XRECORD' && lines[i - 1] === '0');
  const start = lines.findIndex((l, i) => i > at && l === '1' && i % 2 === 0);
  const padding = Array.from({ length: 3400 }, (_, i) => ['1', `%22pad%22%3A${i}`.padEnd(240, 'Q')]).flat();
  return [...lines.slice(0, start), ...padding, ...lines.slice(start)].join('\n');
}

test('the DXF given to the DWG writer keeps every handle unique and every reference resolved', () => {
  const raw = isometricDxf(sample()), compat = writerCompatibleDxf(raw), records = parse(compat.replaceAll('\0', ''));
  const handles = handlesOf(records);
  assert.equal(new Set(handles).size, handles.length, 'one object per handle');
  // The writer adds the R2000 VX table at handle B and reuses model space at 1F.
  assert.ok(!handles.includes('B'), 'handle B is left for the VX table');
  const model = records.find(r => r[0][1] === 'BLOCK_RECORD' && r.some(([c, v]) => c === 2 && v === '*Model_Space'))!;
  assert.equal(model.find(([c]) => c === 5)![1], '1F');
  const known = new Set(handles), max = Math.max(...handles.map(h => parseInt(h, 16)));
  for (const r of records)
    for (const pair of r) if (isHandle(pair[0]) && pair !== headerSeed(records) && pair[1] !== '0') assert.ok(known.has(pair[1]), `${r[0][1]} ${pair[0]} ${pair[1]}`);
  assert.equal(parseInt(headerSeed(records)[1], 16), max + 1, '$HANDSEED is the next free handle');
  // The entities, blocks and stored model are those of the DXF; only handles move.
  const types = (rs: Pair[][]) => rs.map(r => r[0][1]).join();
  assert.equal(types(records), types(parse(raw)));
  const text = (rs: Pair[][]) => rs.flatMap(r => r.filter(([c]) => c === 1 || c === 3).map(([, v]) => v)).join('\n');
  assert.equal(text(records), text(parse(raw)));
});

test('HATCH seed points survive the writer: a seed at X = 0 moves off zero, inside its boundary', () => {
  const raw = parse(isometricDxf(sample())), compat = parse(writerCompatibleDxf(isometricDxf(sample())).replaceAll('\0', ''));
  assert.ok(seedsOf(raw).includes(0), 'the weld dot is filled about its own centre');
  const seeds = seedsOf(compat);
  assert.equal(seeds.length, seedsOf(raw).length);
  assert.ok(seeds.every(x => x !== 0 && Number.isFinite(x)));
  seeds.forEach((x, i) => assert.ok(Math.abs(x - seedsOf(raw)[i]) <= 1e-6));
});

test('text values end in a NUL for the writer, and only text values', () => {
  const lines = writerCompatibleDxf(isometricDxf(sample())).split('\n');
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]), text = [1, 3, 4, 6, 7, 8, 1000].includes(code) || (code >= 300 && code <= 309);
    assert.equal(lines[i + 1].endsWith('\0'), text, `group ${code} at line ${i + 2}`);
    assert.ok(!lines[i + 1].slice(0, -1).includes('\0'));
    assert.match(lines[i], /^-?\d+$/);
  }
});

test('the LibreDWG writer converts a drawing with a large stored model quickly and without warnings', async () => {
  const createWriter = (await import(asset('dwg-export.js').href)).default as (o: object) => Promise<{
    FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array }; ccall(n: string, r: string, a: [], v: []): number;
  }>;
  const messages: string[] = [];
  const writer = await createWriter({ wasmBinary: readFileSync(asset('dwg-export.wasm')), print: () => {}, printErr: (m: string) => { if (String(m).trim()) messages.push(String(m)); } });
  const dxf = withLargeModel(isometricDxf(sample()));
  assert.ok(dxf.length > 800_000);
  writer.FS.writeFile('/input.dxf', new TextEncoder().encode(writerCompatibleDxf(dxf)));
  const start = performance.now(), status = writer.ccall('bw_convert', 'number', [], []), ms = performance.now() - start;
  assert.equal(status, 0, messages.join('\n'));
  assert.deepEqual(messages, []);
  const dwg = writer.FS.readFile('/output.dwg');
  assert.equal(new TextDecoder().decode(dwg.subarray(0, 6)), 'AC1015');
  // Without the NUL-ended text this took over 20 s; it is well under a second.
  assert.ok(ms < 5000, `${Math.round(ms)} ms`);
});
