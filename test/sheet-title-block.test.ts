import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawing, type Drawing } from '../src/core/drawing';
import { sheetFileName } from '../src/core/document';
import { appendRun, defaultSpec, newIso, type IsoDocument } from '../src/core/model';

const texts = (d: Drawing) => d.primitives.flatMap(p => p.type === 'text' ? [{ text: p.text, field: p.field }] : []);
/** What the title block's pipe spec field reads, classic or production. */
const pipeSpec = (d: Drawing) => {
  const all = texts(d), classic = all.find(t => t.field === 'pipeSpecs'), production = all.find(t => t.field === 'tb.pipeSpec');
  return classic?.text ?? production?.text;
};

test("a new sheet's title block names the drawing's pipe specs before any pipe is drawn", () => {
  for (const format of ['classic', 'production'] as const) {
    const doc = newIso();
    doc.sheetFormat = format;
    assert.equal(doc.runs.length, 0);
    assert.match(pipeSpec(createDrawing(doc)) ?? '', /CS40/, `${format}: the one spec`);
    // With several specs and still no pipe, all of them.
    const two: IsoDocument = { ...doc, specs: [...doc.specs, { ...defaultSpec(), id: 'SS10' }] };
    const both = pipeSpec(createDrawing(two)) ?? '';
    assert.ok(both.includes('CS40') && both.includes('SS10'), `${format}: ${both}`);
  }
});

test("a sheet with pipes names only its pipes' specs, as before", () => {
  for (const format of ['classic', 'production'] as const) {
    const doc = newIso();
    doc.sheetFormat = format;
    doc.specs.push({ ...defaultSpec(), id: 'SS10' });
    appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S1', 'L-1');
    const spec = pipeSpec(createDrawing(doc, 'S1')) ?? '';
    assert.ok(spec.includes('CS40') && !spec.includes('SS10'), `${format}: ${spec}`);
  }
});

test('sheet files are named by drawing number, else title, never "undefined"', () => {
  const doc = newIso(), sheet = { spool: '', view: 'iso' as const };
  doc.drawing = 'ISO-7';
  assert.equal(sheetFileName(doc, sheet, 'svg'), 'ISO-7.svg');
  doc.drawing = '';
  doc.title = 'Header A';
  assert.equal(sheetFileName(doc, sheet, 'svg'), 'Header A.svg');
  const unnamed = { ...doc, drawing: undefined, title: undefined } as unknown as IsoDocument;
  assert.equal(sheetFileName(unnamed, { ...sheet, sheet: 'materials' }, 'svg'), 'drawing-materials.svg');
});
