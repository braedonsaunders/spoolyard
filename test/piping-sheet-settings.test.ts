import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { appendRun, newIso, parseIsoJson, sheetInfoOf, titleBlockOf, type IsoDocument } from '../src/core/model.ts';
import { imageAspect } from '../src/core/iso/sheet.ts';
import {
  BLANK_LOGO,
  LOGO_MAX_BYTES,
  MAX_REVISIONS,
  SheetSettings,
  addRevision,
  checkLogo,
  dataUrlBytes,
  defaultSheetInfo,
  fitLongSide,
  logoSlots,
  logoType,
  needsRaster,
  nextRevision,
  originFromPoint,
  parsePlant,
  removeReference,
  removeRevision,
  setCondition,
  setLogo,
  setOrigin,
  setReference,
  setRevisionField,
  setSheetInfo,
  setTitleField,
  sheetSpools,
  svgPixelSize,
  titleBlockDraft,
  withTitleBlock,
  yymmdd
} from '../src/editor/sheet-settings.tsx';

const valid = (d: IsoDocument) => parseIsoJson(JSON.stringify(d));
const png = (bytes: number) => 'data:image/png;base64,' + Buffer.alloc(bytes, 7).toString('base64');
const legacy = () => {
  const d = newIso();
  delete d.titleBlock;
  delete d.style;
  Object.assign(d, { drawnBy: 'A.B.', checkedBy: 'C.D.', project: 'PRJ-9', revision: 'B' });
  return d;
};
const twoSpools = () => {
  const d = newIso();
  d.drawing = 'ISO-7';
  const end = appendRun(d, null, [1000, 0, 0], d.specs[0].id, 2, 'SP-001', 'L-1');
  appendRun(d, end.id, [0, 1000, 0], d.specs[0].id, 2, 'SP-002', 'L-1');
  return d;
};

test('a legacy drawing gets a title block carrying its header values, and the pipe spec stays live', () => {
  const d = legacy();
  appendRun(d, null, [1000, 0, 0], d.specs[0].id, 2, 'SP-001', 'L-1');
  setTitleField(d, 'approvedBy', 'E.F.');
  const tb = d.titleBlock!;
  assert.equal(tb.designedBy, 'A.B.');
  assert.equal(tb.checkedBy, 'C.D.');
  assert.equal(tb.projectNumber, 'PRJ-9');
  assert.equal(tb.approvedBy, 'E.F.');
  assert.deepEqual(tb.revisions.map(r => r.rev), ['B']);
  assert.equal(tb.pipeSpec, '');
  assert.equal(titleBlockOf(d).pipeSpec, d.runs[0].specId);
  valid(d);
});

test('withTitleBlock keeps an existing title block and the draft matches what it would create', () => {
  const d = newIso();
  const own = d.titleBlock!;
  assert.equal(withTitleBlock(d), own);
  const l = legacy();
  const draft = titleBlockDraft(l);
  assert.equal(l.titleBlock, undefined);
  assert.deepEqual(withTitleBlock(l), draft);
});

test('title block edits are trimmed and limited to what the validator accepts', () => {
  const d = newIso();
  setTitleField(d, 'designCode', '  ASME B31.3 ');
  assert.equal(d.titleBlock!.designCode, 'ASME B31.3');
  assert.throws(() => setTitleField(d, 'product', 'x'.repeat(201)), /200 characters/);
  setCondition(d, 'test', 0, '285');
  setCondition(d, 'test', 1, '100');
  assert.deepEqual(d.titleBlock!.conditions.test, ['285', '100']);
  assert.throws(() => setCondition(d, 'design', 0, 'x'.repeat(41)), /40 characters/);
  valid(d);
});

test('reference drawings add, edit and remove up to five lines', () => {
  const d = newIso();
  for (let i = 0; i < 5; i++) setReference(d, d.titleBlock!.referenceDrawings.length, `REF-${i}`);
  assert.throws(() => setReference(d, 5, 'REF-5'), /5 reference drawings/);
  setReference(d, 1, 'REF-1 Rev.C');
  removeReference(d, 0);
  assert.deepEqual(d.titleBlock!.referenceDrawings, ['REF-1 Rev.C', 'REF-2', 'REF-3', 'REF-4']);
  valid(d);
});

test('revisions follow on from the latest and keep the header revision in step', () => {
  assert.equal(nextRevision([], '0'), '0');
  assert.equal(nextRevision([], ''), 'A');
  const row = (rev: string) => ({ rev, date: '', description: '', designedBy: '', checkedBy: '', disciplineLead: '', projectLeader: '', approvedBy: '' });
  assert.equal(nextRevision([row('A')]), 'B');
  assert.equal(nextRevision([row('3')]), '4');
  assert.equal(nextRevision([row('Z')]), '');
  assert.equal(nextRevision([row('IFC')]), '');

  const d = newIso();
  setTitleField(d, 'designedBy', 'A.B.');
  addRevision(d, '26-01-02');
  assert.deepEqual(d.titleBlock!.revisions[0], { ...row('0'), date: '26-01-02', designedBy: 'A.B.' });
  setRevisionField(d, 0, 'rev', 'A');
  addRevision(d, '26-02-03');
  assert.equal(d.titleBlock!.revisions[1].rev, 'B');
  assert.equal(d.revision, 'B');
  assert.equal(sheetInfoOf(d, '').revision, 'B');
  removeRevision(d, 1);
  assert.equal(d.revision, 'A');
  while (d.titleBlock!.revisions.length < MAX_REVISIONS) addRevision(d);
  assert.throws(() => addRevision(d), /last 6 revisions/);
  assert.throws(() => setRevisionField(d, 9, 'rev', 'Q'), /no longer exists/);
  valid(d);
});

test('per-sheet values default to the computed sheet identity and empty values are removed', () => {
  const d = twoSpools();
  assert.deepEqual(sheetSpools(d), ['SP-001', 'SP-002']);
  assert.equal(defaultSheetInfo(d, 'SP-002').drawingNumber, 'ISO-7-2');
  setSheetInfo(d, 'SP-002', 'drawingNumber', ' ISO-201-1 ');
  setSheetInfo(d, 'SP-002', 'lineNumber', 'L-201');
  assert.deepEqual(d.sheets, { 'SP-002': { drawingNumber: 'ISO-201-1', lineNumber: 'L-201' } });
  assert.equal(sheetInfoOf(d, 'SP-002').drawingNumber, 'ISO-201-1');
  assert.equal(defaultSheetInfo(d, 'SP-002').drawingNumber, 'ISO-7-2');
  valid(d);
  setSheetInfo(d, 'SP-002', 'drawingNumber', '');
  setSheetInfo(d, 'SP-002', 'lineNumber', '');
  assert.equal(d.sheets, undefined);
  assert.throws(() => setSheetInfo(d, 'SP-001', 'revision', 'x'.repeat(121)), /120 characters/);
});

test('logo slots keep the client logo in the second panel', () => {
  const d = newIso();
  const tb = withTitleBlock(d);
  const company = { name: 'company.png', dataUrl: png(30) }, client = { name: 'client.png', dataUrl: png(40) };
  setLogo(tb, 1, client);
  assert.deepEqual(tb.logos, [{ name: '', dataUrl: BLANK_LOGO }, client]);
  assert.deepEqual(logoSlots(tb), [undefined, client]);
  valid(d);
  setLogo(tb, 0, company);
  assert.deepEqual(tb.logos, [company, client]);
  setLogo(tb, 0, undefined);
  assert.deepEqual(logoSlots(tb), [undefined, client]);
  setLogo(tb, 1, undefined);
  assert.deepEqual(tb.logos, []);
  setLogo(tb, 0, company);
  assert.deepEqual(tb.logos, [company]);
  assert.throws(() => setLogo(tb, 1, { name: 'x.gif', dataUrl: 'data:image/gif;base64,R0lG' }), /PNG or JPEG/);
  assert.equal(imageAspect(BLANK_LOGO), 1);
});

test('logo data URLs are checked against the 1.5 MB limit', () => {
  assert.equal(dataUrlBytes(png(1)), 1);
  assert.equal(dataUrlBytes(png(2)), 2);
  assert.equal(dataUrlBytes(png(3)), 3);
  assert.equal(dataUrlBytes(png(1000)), 1000);
  checkLogo(png(LOGO_MAX_BYTES));
  assert.throws(() => checkLogo(png(LOGO_MAX_BYTES + 1)), /limited to 1.5 MB/);
  assert.throws(() => checkLogo('data:image/svg+xml;base64,PHN2Zz4='), /PNG or JPEG/);
  const d = newIso();
  setLogo(withTitleBlock(d), 0, { name: 'big.png', dataUrl: png(LOGO_MAX_BYTES) });
  valid(d);
});

test('uploads are typed by MIME or extension and oversized or vector art is rasterised', () => {
  assert.equal(logoType('a.png', 'image/png'), 'png');
  assert.equal(logoType('a.JPG', ''), 'jpeg');
  assert.equal(logoType('a.jpeg', 'image/jpg'), 'jpeg');
  assert.equal(logoType('a.svg', ''), 'svg');
  assert.equal(logoType('a.svg', 'image/svg+xml'), 'svg');
  assert.equal(logoType('a.gif', 'image/gif'), undefined);
  assert.equal(logoType('a.png', 'image/webp'), undefined);
  assert.equal(needsRaster('svg', 100, 10, 10), true);
  assert.equal(needsRaster('png', 100, 1200, 300), false);
  assert.equal(needsRaster('png', 100, 1201, 300), true);
  assert.equal(needsRaster('jpeg', LOGO_MAX_BYTES + 1, 800, 600), true);
  assert.deepEqual(fitLongSide(2400, 600), [1200, 300]);
  assert.deepEqual(fitLongSide(300, 600), [300, 600]);
  assert.deepEqual(fitLongSide(100, 50, 1200, true), [1200, 600]);
  assert.deepEqual(fitLongSide(5000, 1), [1200, 1]);
});

test('SVG pixel size comes from width, height and viewBox', () => {
  assert.deepEqual(svgPixelSize('200', '100', null), [200, 100]);
  assert.deepEqual(svgPixelSize('200px', null, '0 0 40 10'), [200, 50]);
  assert.deepEqual(svgPixelSize(null, '1in', '0 0 30 10'), [288, 96]);
  assert.deepEqual(svgPixelSize('100%', '100%', '0,0,64,32'), [64, 32]);
  const [w, h] = svgPixelSize('50.8mm', '25.4mm', null);
  assert.ok(Math.abs(w - 192) < 1e-9 && Math.abs(h - 96) < 1e-9);
  assert.deepEqual(svgPixelSize(null, null, null), [300, 150]);
});

test('plant coordinates parse feet-inches and negatives, and the origin follows a known point', () => {
  const [e, n, el] = parsePlant([`48'-7 3/8"`, '-96\'-4 1/4"', ''], 'imperial');
  assert.ok(Math.abs(e - (48 * 12 + 7.375) * 25.4) < 1e-9);
  assert.ok(Math.abs(n + (96 * 12 + 4.25) * 25.4) < 1e-9);
  assert.equal(el, 0);
  assert.deepEqual(parsePlant(['1200', '-3.5 m', '0'], 'mm'), [1200, -3500, 0]);
  assert.throws(() => parsePlant(['abc'], 'mm'));
  assert.deepEqual(originFromPoint([10000, 20000, 30000], [1000, 2000, 3000]), [9000, 18000, 27000]);
  const d = newIso();
  setOrigin(d, [9000, 18000, 27000]);
  assert.deepEqual(d.coordinates, { origin: [9000, 18000, 27000] });
  valid(d);
  setOrigin(d, [0, 0, 0]);
  assert.equal(d.coordinates, undefined);
});

test('yymmdd writes title block dates', () => {
  assert.equal(yymmdd(new Date(2026, 6, 7)), '26-07-07');
  assert.equal(yymmdd(new Date(2031, 11, 25)), '31-12-25');
});

test('the settings panel renders every section for a multi-sheet drawing', () => {
  const d = twoSpools();
  d.nodes[0].tag = 'TP-1';
  setLogo(withTitleBlock(d), 1, { name: 'client.png', dataUrl: png(30) });
  const html = renderToStaticMarkup(createElement(SheetSettings, {
    doc: d, commit: () => true, onError: () => {}, spool: 'SP-002', selectedNodeId: d.nodes[0].id
  }));
  for (const text of ['Sheet', 'Sheets', 'Title block', 'Revisions', 'Logos', 'Plant coordinates', 'General notes',
    'Centreline lengths', 'Not to scale (production)', 'CAD (ROMANS)', 'Weld numbers on sheet', 'Press. (kPa)',
    'Company logo', 'Client logo', 'Set from selected point', 'Long notes continue above the title block.'])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes('placeholder="ISO-7-2"'));
  assert.match(html, /iso-sheet-card current" aria-current="true"><div class="iso-sheet-card-head"><strong>SP-002/);
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  assert.ok(html.includes('accept="image/png,image/jpeg,image/svg+xml"'));
  const imperial = renderToStaticMarkup(createElement(SheetSettings, {
    doc: { ...legacy(), units: 'imperial' }, commit: () => true, onError: () => {}, spool: 'SP-001'
  }));
  assert.ok(imperial.includes('Press. (psig)') && imperial.includes('Temp. (°F)'));
  assert.ok(imperial.includes('Revision B'));
  assert.ok(!imperial.includes('Set from selected point'));
});
