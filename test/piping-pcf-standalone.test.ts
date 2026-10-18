import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { appendRun, applyComponent, attachComponent, clone, newIso, parseIsoJson, welds, type IsoDocument, type PipeSpec } from '../src/core/model.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';
import { continuationReference, continuationText, exportPcf, exportPcfPackage, importPcf } from '../src/core/pcf.ts';
import { packageSpools, sheetMaterials } from '../src/core/material-list.ts';
import { reviewIso } from '../src/core/review.ts';
import { drawingPackage, readIsometricFiles } from '../src/core/document.ts';
import { crc32, unzip, zip } from '../src/core/zip.ts';

// All data is invented: a drawing built on the bundled library specification A, and hand-written PCFs.

const specA = JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')) as PipeSpec;
const type = (code: string) => COMPONENT_TYPES.find(t => t.code === code)!;
const row = (code: string, nps: number) => specA.fittings.find(f => f.component === code && f.nps === nps);

/** A 4" line: elbow, flanged gate valve, reducing tee with a blinded 2" branch, a welded shoe, continued on another drawing. */
function job(): IsoDocument {
  const doc = newIso(); doc.specs = [clone(specA)]; doc.units = 'imperial'; doc.title = 'TEST LINE 100'; doc.drawing = 'ISO-T-100';
  const corner = appendRun(doc, null, [3000, 0, 0], 'A', 4, 'SP-1', '4"-T-100');
  const tee = appendRun(doc, corner.id, [0, 3000, 0], 'A', 4, 'SP-1', '4"-T-100');
  const last = appendRun(doc, tee.id, [0, 3000, 0], 'A', 4, 'SP-1', '4"-T-100');
  const branch = appendRun(doc, tee.id, [0, 0, 1000], 'A', 2, 'SP-1', '4"-T-100');
  placeComponentOnPipe(doc, doc.runs[1].id, type('GATE-FL'), 0.5, row('GATE-FL', 4));
  const shoe = attachComponent(doc, doc.runs[0].id, 'support', 0.3);
  applyComponent(doc, shoe, 'SHOE');
  applyComponent(doc, branch, 'FLG-RFBL', row('FLG-RFBL', 2));
  last.continuation = { text: "CONT'D ON\nDWG# ISO-T-101" };
  return parseIsoJson(JSON.stringify(doc));
}
const bomRows = (doc: IsoDocument) => packageSpools(doc).flatMap(s => sheetMaterials(doc, s).map(r => `${r.qtyText}|${r.nd}|${r.description}`)).sort();
const codes = (doc: IsoDocument) => doc.nodes.filter(n => !['gasket', 'bolt', 'end', 'weld'].includes(n.kind) && !(n.kind === 'flange' && n.component === 'FLG-RFWN'))
  .map(n => n.component ?? n.kind).sort();
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => [k, canon((v as Record<string, unknown>)[k])])) : v;

test("Spoolyard's own PCF read without its sidecar has no false errors, the same welds, BOM, components and callouts", () => {
  const doc = job(), back = importPcf(exportPcf(doc)), alone = back.doc;
  // The specification is rebuilt from the PCF: its sizes (no "not in specification" errors), class and root gap.
  assert.deepEqual(reviewIso(alone).filter(i => i.severity === 'error'), []);
  assert.deepEqual(back.warnings, []);
  const spec = alone.specs.find(s => s.id === 'A')!;
  assert.deepEqual(spec.sizes.map(z => [z.nps, z.schedule]), [[2, 'STD'], [4, 'STD']]);
  assert.equal(spec.rating, specA.rating);
  assert.equal(spec.rootGap, specA.rootGap);
  assert.equal(welds(alone).length, welds(doc).length);
  assert.deepEqual(bomRows(alone), bomRows(doc));
  // Elbow, tee, valve, blind and shoe come back as the components they are (the mating flanges are parts of their own).
  assert.deepEqual(codes(alone), codes(doc));
  // Item codes that already name their specification are not namespaced again.
  assert.ok(alone.nodes.every(n => !n.catalogId?.startsWith('A:A')), alone.nodes.map(n => n.catalogId).join());
  // Title, drawing number (the line stays the pipeline reference) and the continuation callout.
  assert.equal(alone.title, 'TEST LINE 100');
  assert.equal(alone.drawing, 'ISO-T-100');
  assert.deepEqual(alone.runs.map(r => r.line).filter((l, i, all) => all.indexOf(l) === i), ['4"-T-100']);
  assert.equal(alone.nodes.find(n => n.continuation)?.continuation?.text, "CONT'D ON\nDWG# ISO-T-101");
});

test('PCF header and end records are the standard keywords: NOMINAL-CLASS, user attributes, END-CONNECTION-PIPELINE', () => {
  const doc = job();
  const start = doc.nodes.find(n => n.kind === 'end' && !n.continuation)!;
  start.continuation = { text: 'OPEN END', termination: 'open' };
  const pcf = exportPcf(doc);
  assert.match(pcf, /^ {4}NOMINAL-CLASS 150#$/m);
  assert.match(pcf, /^ {4}ATTRIBUTE90 ISO-T-100$/m);
  assert.match(pcf, /^ {4}ATTRIBUTE91 TEST LINE 100$/m);
  assert.match(pcf, /^ {4}ATTRIBUTE92 ROOT-GAP 1\.6 MM$/m);
  assert.match(pcf, /^END-CONNECTION-PIPELINE\n {4}CO-ORDS [-\d. ]+\n {4}PIPELINE-REFERENCE DWG# ISO-T-101$/m);
  assert.match(pcf, /^END-POSITION-OPEN\n {4}CO-ORDS /m);
  assert.deepEqual(importPcf(pcf).doc.nodes.filter(n => n.continuation).map(n => n.continuation!.termination).sort(), ['continues', 'open']);
  // Another program's ATTRIBUTE92 is not read as a root gap; only the form Spoolyard writes is.
  const foreign = importPcf(pcf.replace(/ATTRIBUTE92 ROOT-GAP 1\.6 MM/, 'ATTRIBUTE92 PAINT SYSTEM 3'));
  assert.equal(foreign.doc.specs.find(s => s.id === 'A')!.rootGap, 0);
  assert.match(foreign.warnings.join(' '), /root gap starts at 0 mm/);
  // Callout text and pipeline reference: CONT'D ON is ISOGEN's own "CONT. ON", other callouts are kept whole.
  assert.equal(continuationReference("CONT'D ON\nDWG# X-1"), 'DWG# X-1');
  assert.equal(continuationText('DWG# X-1'), "CONT'D ON\nDWG# X-1");
  assert.equal(continuationText(continuationReference("CONT'D FROM\nDWG# X-2")), "CONT'D FROM\nDWG# X-2");
  assert.equal(continuationText(continuationReference('CONNECT TO P-101')), 'CONNECT TO P-101');
});

test('bolt diameters and lengths are written to the 1/16" (or 0.1 mm) bolts are made in', () => {
  const doc = job(), pcf = exportPcf(doc);
  const dias = [...pcf.matchAll(/^ {4}BOLT-DIA (.+)$/gm)].map(m => m[1]);
  assert.ok(dias.length && dias.every(d => d === '0.625'), dias.join());
  assert.ok([...pcf.matchAll(/^ {4}BOLT-LENGTH (.+)$/gm)].every(m => Number.isInteger(Number(m[1]) * 16)));
  doc.units = 'mm';
  assert.ok([...exportPcf(doc).matchAll(/^ {4}BOLT-DIA (.+)$/gm)].every(m => m[1] === '15.9'));
});

/** A ZIP with deflated entries, as an operating system's "compress" writes one. */
function deflatedZip(files: Array<{ name: string; content: string }>): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const data = new TextEncoder().encode(f.content), packed = deflateRawSync(data), name = new TextEncoder().encode(f.name);
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 8, true); lv.setUint32(14, crc32(data), true);
    lv.setUint32(18, packed.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); local.set(name, 30);
    const c = new Uint8Array(46 + name.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(16, crc32(data), true); cv.setUint32(20, packed.length, true);
    cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); c.set(name, 46);
    parts.push(local, packed); central.push(c); offset += local.length + packed.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) { out.set(p, at); at += p.length; }
  return out;
}

test('the PCF ZIP export opens as the drawing it was, as does a PCF chosen with its .piping sidecar', async () => {
  const doc = job(), { pcf, sidecar } = exportPcfPackage(doc), bytes = (s: string) => new TextEncoder().encode(s);
  const expected = JSON.stringify(canon(doc));
  // The ZIP the PCF export writes (stored), one an operating system wrote (deflated, with its metadata folder).
  const stored = zip([{ name: 'ISO-T-100.pcf', content: pcf }, { name: 'ISO-T-100.piping', content: sidecar }]);
  const deflated = deflatedZip([{ name: '__MACOSX/._ISO-T-100.pcf', content: 'x' }, { name: 'ISO-T-100.pcf', content: pcf }, { name: 'ISO-T-100.piping', content: sidecar }]);
  assert.deepEqual((await unzip(deflated)).map(f => f.name), ['__MACOSX/._ISO-T-100.pcf', 'ISO-T-100.pcf', 'ISO-T-100.piping']);
  for (const files of [[{ name: 'ISO-T-100-pcf.zip', bytes: stored }], [{ name: 'job.zip', bytes: deflated }],
    [{ name: 'ISO-T-100.piping', bytes: bytes(sidecar) }, { name: 'ISO-T-100.pcf', bytes: bytes(pcf) }]]) {
    const opened = await readIsometricFiles(files);
    assert.equal(opened.format, 'pcf');
    assert.equal(opened.name, 'ISO-T-100.pcf');
    assert.deepEqual(opened.warnings, []);
    assert.equal(JSON.stringify(canon(opened.doc)), expected);
  }
  // A lone file is read as it is; a choice that is not one drawing is refused, saying what to choose.
  assert.equal((await drawingPackage([{ name: 'a.pcf', bytes: bytes(pcf) }])).sidecar, undefined);
  await assert.rejects(drawingPackage([{ name: 'a.pcf', bytes: bytes(pcf) }, { name: 'b.pcf', bytes: bytes(pcf) }]), /one PCF with its \.piping sidecar/);
  // With several sidecars, the one named for the PCF.
  assert.equal((await drawingPackage([{ name: 'b.piping', bytes: bytes('{}') }, { name: 'a.pcf', bytes: bytes(pcf) }, { name: 'a.piping', bytes: bytes(sidecar) }])).sidecar, sidecar);
  await assert.rejects(drawingPackage([{ name: 'a.pcf', bytes: bytes(pcf) }, { name: 'b.piping', bytes: bytes(sidecar) }, { name: 'c.piping', bytes: bytes(sidecar) }]), /Several \.piping files/);
  await assert.rejects(unzip(stored.slice(0, 40)), /Not a ZIP|damaged/);
});

test('identical purchased items reached two ways are one BOM row: gaskets read as parts and one supplied at a joint', () => {
  const pcf = ['UNITS-BORE MM', 'UNITS-CO-ORDS MM', 'PIPELINE-REFERENCE L-1', '    PIPING-SPEC X1',
    'FLANGE', '    END-POINT 0 0 0 100 FL', '    END-POINT 102 0 0 100 BW', '    SKEY FLWN', '    ITEM-CODE FL100',
    'PIPE', '    END-POINT 102 0 0 100 BW', '    END-POINT 1898 0 0 100 BW', '    ITEM-CODE P100',
    'FLANGE', '    END-POINT 1898 0 0 100 BW', '    END-POINT 2000 0 0 100 FL', '    SKEY FLWN', '    ITEM-CODE FL100',
    'GASKET', '    END-POINT 2000 0 0 100 FL', '    END-POINT 2003 0 0 100 FL', '    ITEM-CODE GK100',
    'VALVE', '    END-POINT 2003 0 0 100 FL', '    END-POINT 2232 0 0 100 FL', '    SKEY VVFL', '    ITEM-CODE GV100',
    'GASKET', '    END-POINT 2232 0 0 100 FL', '    END-POINT 2235 0 0 100 FL', '    ITEM-CODE GK100',
    'FLANGE', '    END-POINT 2235 0 0 100 FL', '    END-POINT 2337 0 0 100 BW', '    SKEY FLWN', '    ITEM-CODE FL100',
    'PIPE', '    END-POINT 2337 0 0 100 BW', '    END-POINT 3000 0 0 100 BW', '    ITEM-CODE P100',
    'MATERIALS', 'MATERIAL-IDENTIFIER 1', '    ITEM-CODE GV100', '    DESCRIPTION GATE VALVE CL150 RF', ''].join('\n');
  const { doc } = importPcf(pcf), rows = sheetMaterials(doc).filter(r => r.description === 'GK100');
  // Two gaskets recorded, and the one the open flange's joint is supplied with: one item, three off.
  assert.deepEqual(rows.map(r => r.qtyText), ['3']);
  // The valve the description names, though its symbol key (VV) names no particular valve.
  assert.equal(doc.nodes.find(n => n.kind === 'valve')!.component, 'GATE-FL');
});
