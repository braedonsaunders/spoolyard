import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDocument, decodePDFRawStream, type PDFRawStream } from 'pdf-lib';
import { appendRun, applyComponent, attachComponent, connected, newIso, takeout, type CatalogItem, type IsoDocument } from '../src/core/model.ts';
import { exportPcf, importPcf } from '../src/core/pcf.ts';

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

test('PCF olets sit on the header centreline at its bore, with the outlet clear of the header', () => {
  const doc = newIso();
  appendRun(doc, null, [2000, 0, 0], 'CS40', 6, 'SP-1', 'L-1');
  const header = doc.runs[0];
  // An olet row measured from the header outside, as library specifications give it.
  const row = { id: 'CS40:SOL-1', component: 'SOL', kind: 'olet', nps: 1, takeout: 27, branchTakeout: 27, socketDepth: 12.7,
    takeoutReference: 'header-outside', description: 'SOCKOLET', source: 'test' } as CatalogItem;
  doc.specs[0].fittings.push(row);
  const olet = attachComponent(doc, header.id, 'olet', 0.5);
  applyComponent(doc, olet, 'SOL', row);
  appendRun(doc, olet.id, [0, 0, 300], 'CS40', 1, 'SP-1', 'L-1', 'SW');
  const pcf = exportPcf(doc), reach = 168.3 / 2 + 27;
  const block = pcf.split(/\n(?=\S)/).find(b => b.startsWith('OLET'))!;
  assert.match(block, /\n {4}CENTRE-POINT 1000\.0000 0\.0000 0\.0000 6 /);
  assert.match(block, new RegExp(`\\n {4}BRANCH1-POINT 1000\\.0000 0\\.0000 ${reach.toFixed(4).replace('.', '\\.')} 1 SW`));
  assert.doesNotMatch(block, /END-POINT/);
  // The branch pipe starts at the outlet.
  assert.ok(pcf.includes(`END-POINT 1000.0000 0.0000 ${reach.toFixed(4)} 1 SW`));
  const back = importPcf(pcf).doc, restored = back.nodes.find(n => n.kind === 'olet')!;
  const branch = connected(back, restored.id);
  assert.equal(branch.length, 1);
  assert.equal(restored.branchEdgeId, branch[0].id);
  assert.equal(back.runs.find(r => r.id === restored.associatedRunId)!.nps, 6);
  assert.ok(Math.abs(takeout(back, restored, branch[0].id)! - reach) < 1e-6);
  // A takeout the drafter entered is from the header centreline already.
  olet.takeout = 120;
  assert.match(exportPcf(doc), /BRANCH1-POINT 1000\.0000 0\.0000 120\.0000 1 SW/);
});
