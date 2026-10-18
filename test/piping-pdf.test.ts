import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { layerWeights, type Drawing, type Primitive } from '../src/core/drawing.ts';
import type { PaperSize } from '../src/core/paper.ts';
import { drawPrimitives } from '../src/editor/export.ts';

const sheet = (primitives: Primitive[], paper?: PaperSize): Drawing => ({
  width: 1314, height: 850, area: [0, 0, 1314, 850], fit: { centre: [0, 0], scale: 1 }, primitives,
  positions: new Map(), project: () => [0, 0], view: 'iso', lettering: 'cad', ...(paper ? { weights: layerWeights({ paper }) } : {}),
});
/** The page's content stream operators as text. */
async function content(paper: [number, number], primitives: Primitive[], size?: PaperSize): Promise<string> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(readFileSync(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url)), { subset: true });
  const page = pdf.addPage(paper);
  await drawPrimitives(page, sheet(primitives, size), font, { x: 0, y: paper[1], scale: paper[1] / 850 });
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  const text = bytes.toString('latin1'), streams: string[] = [];
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length, end = text.indexOf('endstream', start);
    const raw = bytes.subarray(start, end);
    try { streams.push(inflateSync(raw).toString('latin1')); } catch { streams.push(raw.toString('latin1')); }
  }
  // The page's own content: the stream that places the sheet (fonts and images are streams too).
  return streams.filter(s => / cm\n/.test(s)).join('\n');
}

test('PDF pens are the same printed width on every paper, with round caps and joins', async () => {
  const line: Primitive = { type: 'line', a: [10, 20], b: [110, 20], layer: 'PIPE' };
  // A drawing's weights are its paper's: PIPE is the default 0.5 mm pen, 1.417 pt on any paper.
  const widthOn = async (paper: [number, number], size: PaperSize) => {
    const ops = await content(paper, [line], size), m = ops.match(/\n([\d.]+) w\n/);
    return Number(m![1]) * paper[1] / 850;
  };
  const tabloid = await widthOn([1224, 792], 'tabloid'), letter = await widthOn([792, 612], 'letter');
  assert.ok(Math.abs(tabloid - 0.5 * 72 / 25.4) < 1e-4, `${tabloid} pt`);
  assert.ok(Math.abs(letter - tabloid) < 1e-4);
  const ops = await content([1224, 792], [line]);
  assert.match(ops, /\b1 J\b/);
  assert.match(ops, /\b1 j\b/);
});

test('PDF CAD lettering is stroked and also an invisible, searchable text layer; arcs are curves', async () => {
  const ops = await content([1224, 792], [
    { type: 'text', p: [20, 120], text: 'GATE VALVE', size: 10, layer: 'TEXT' },
    { type: 'arc', p: [400, 400], r: 50, start: 0, end: 135, layer: 'DIM' },
  ]);
  assert.match(ops, /\b3 Tr\b/);
  assert.match(ops, /\bTj\b/);
  // Two Bézier pieces for 135°.
  assert.equal(ops.match(/ c\n/g)?.length, 2);
});

test('the PDF package: one page per spool and view, schedules on the same paper, bookmarks and metadata', async () => {
  const { appendRun, newIso } = await import('../src/core/model.ts');
  const { exportPdf } = await import('../src/editor/export.ts');
  const font = readFileSync(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url));
  Object.assign(globalThis, { document: { baseURI: 'http://spoolyard.test/' } });
  const fetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(font)) as typeof globalThis.fetch;
  try {
    const doc = newIso();
    doc.paper = 'a3'; doc.drawnBy = 'J. Drafter'; doc.project = 'P-100'; doc.revision = 'B';
    appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
    appendRun(doc, null, [0, 1000, 0], 'CS40', 2, 'SP-2', 'L-1');
    // A pipe without a spool does not add a sheet of everything.
    appendRun(doc, null, [0, 0, 1000], 'CS40', 2, '', 'L-1');
    doc.outputViews = ['iso', 'plan'];
    const pdf = await PDFDocument.load(new Uint8Array(await (await exportPdf(doc)).arrayBuffer()), { updateMetadata: false });
    const pages = pdf.getPages();
    assert.ok(pages.length > 4);
    assert.ok(pages.every(p => Math.abs(p.getWidth() - 1190.55) < 0.01 && Math.abs(p.getHeight() - 841.89) < 0.01));
    assert.equal(pdf.getAuthor(), 'J. Drafter');
    assert.match(pdf.getKeywords()!, /Rev B/);
    assert.match(pdf.getKeywords()!, /P-100/);
    // Bookmarks: four sheets (two spools in two views), then the schedules.
    const titles: string[] = [];
    let item = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict).lookupMaybe(PDFName.of('First'), PDFDict);
    for (; item; item = item.lookupMaybe(PDFName.of('Next'), PDFDict)) titles.push(item.lookup(PDFName.of('Title'), PDFHexString).decodeText());
    assert.deepEqual(titles, ['ISO-001-1 · SP-1 · ISO', 'ISO-001-1 · SP-1 · PLAN', 'ISO-001-2 · SP-2 · ISO', 'ISO-001-2 · SP-2 · PLAN',
      'Material schedule', 'Pipe cut schedule', 'Weld map', 'Data requiring completion']);
  } finally {
    globalThis.fetch = fetch;
  }
});

test('PDF sans lettering is text once: its white halo is drawn as the letters\' outlines, never as a second copy of the text', async () => {
  const ops = await content([1224, 792], [
    { type: 'text', p: [20, 120], text: 'MATERIAL LIST CONTINUED ON SHEET 2', size: 9, layer: 'BOM', lettering: 'sans' },
    { type: 'text', p: [20, 220], text: 'INVENTED NOTE Ø', size: 9, layer: 'TEXT', lettering: 'sans' },
  ]);
  // One text-showing operator per line, the visible one.
  assert.equal(ops.match(/\bTj\b/g)?.length, 2);
  assert.doesNotMatch(ops, /\b1 Tr\b/);
  // The halo: white-stroked glyph outlines (curves) before the lettering.
  assert.match(ops, /\b1 1 1 RG\b/);
  assert.ok((ops.match(/ c\n| v\n| y\n/g)?.length ?? 0) > 10);
});
