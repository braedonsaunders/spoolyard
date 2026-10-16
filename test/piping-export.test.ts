import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDocument, decodePDFRawStream, type PDFRawStream } from 'pdf-lib';
import { appendRun, newIso, type IsoDocument } from '../src/core/model.ts';

// The exporter loads its font beside the page, as in the browser.
Object.assign(globalThis, { document: { baseURI: new URL('../public/', import.meta.url).toString() } });
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const href = String(url instanceof Request ? url.url : url);
  return href.startsWith('file:') ? new Response(readFileSync(new URL(href))) : nativeFetch(url, init);
}) as typeof fetch;
const { exportPdf } = await import('../src/editor/export.ts');

/** The drawing operators of each page of a package. */
async function pages(doc: IsoDocument): Promise<string[]> {
  const pdf = await PDFDocument.load(new Uint8Array(await (await exportPdf(doc)).arrayBuffer()));
  return pdf.getPages().map(page => {
    const contents = page.node.Contents()!;
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
    return streams.map(s => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
  });
}

test('issued sheets never print the drafting grid, in either layout', async () => {
  const doc = newIso();
  const corner = appendRun(doc, null, [2000, 0, 0], 'CS40', 4, 'SP-1', 'L-1');
  appendRun(doc, corner.id, [0, 1500, 0], 'CS40', 4, 'SP-1', 'L-1');
  doc.grid = { visible: true, snap: true, spacing: 100, plane: 'xy' };
  for (const layout of ['scale', 'schematic'] as const) {
    doc.style = { layout, weldNumbers: true, lettering: 'cad' };
    const [sheet] = await pages(doc);
    // Linework and lettering are black on white; the grid was drawn in blue.
    const colours = [...sheet.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (RG|rg)/g)].map(m => m.slice(1, 4).map(Number));
    assert.ok(colours.length, layout);
    for (const [r, g, b] of colours) assert.ok(r === g && g === b, `${layout}: ${r} ${g} ${b}`);
  }
});
