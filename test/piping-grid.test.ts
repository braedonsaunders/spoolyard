import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newIso } from '../src/core/model.ts';
import { createDrawing, type Drawing } from '../src/core/drawing.ts';
import { defaultGrid, gridLines, type GridPlane } from '../src/core/grid.ts';

test('model-space grid keeps all three isometric directions through the routing origin', () => {
  const drawing = createDrawing(newIso(), '', 'iso', undefined, { model: true });
  const origin = drawing.project([0, 0, 0]);
  const grid = gridLines(drawing, [0, 0, 0], defaultGrid(), 'mm', {
    area: [-500, -100, 1600, 950], minSpacing: 18,
  })!;
  const throughOrigin = grid.lines.filter(({ a, b }) =>
    Math.abs((origin[0] - a[0]) * (b[1] - a[1]) - (origin[1] - a[1]) * (b[0] - a[0])) < 1e-6);
  assert.equal(throughOrigin.length, 3);
  assert.ok(throughOrigin.some(({ a, b }) => Math.abs(a[0] - b[0]) < 1e-6), 'vertical grid lines remain visible');
});

test('panning far from the origin retains a complete grid on every routing plane', () => {
  const drawing = createDrawing(newIso(), '', 'iso', undefined, { model: true });
  const area: Drawing['area'] = [1e6, -2e6, 1e6 + 1600, -2e6 + 850];
  for (const plane of ['xy', 'xz', 'yz'] as GridPlane[]) {
    const grid = gridLines(drawing, [0, 0, 0], { ...defaultGrid(), plane }, 'mm', { area, minSpacing: 18 })!;
    assert.ok(grid.lines.length > 60, `${plane}: grid must cover the distant viewport`);
    for (const line of grid.lines) for (const [x, y] of [line.a, line.b]) {
      assert.ok(x >= area[0] - 1e-6 && x <= area[2] + 1e-6);
      assert.ok(y >= area[1] - 1e-6 && y <= area[3] + 1e-6);
    }
  }
});

test('grid density stays bounded across the model-space zoom range without changing physical spacing', () => {
  const drawing = createDrawing(newIso(), '', 'iso', undefined, { model: true });
  const settings = { ...defaultGrid(), spacing: 304.8 };
  for (const zoom of [0.01, 0.1, 1, 8, 32]) {
    const grid = gridLines(drawing, [0, 0, 0], settings, 'imperial', {
      area: [550 - 800 / zoom, 425 - 425 / zoom, 550 + 800 / zoom, 425 + 425 / zoom],
      minSpacing: 18 / zoom,
    })!;
    assert.ok(grid.lines.length >= 3 && grid.lines.length < 300, `zoom ${zoom}: bounded visible grid`);
    assert.match(grid.caption, /1 block = 1′ 0″/);
    assert.equal(settings.spacing, 304.8);
  }
});

test('issued PDF sheets never carry the graph paper, even drawn to scale', async () => {
  const { appendRun } = await import('../src/core/model.ts');
  const { inflateSync } = await import('node:zlib');
  const { readFileSync } = await import('node:fs');
  Object.assign(globalThis, { document: { baseURI: new URL('../public/', import.meta.url).toString() } });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => new Response(readFileSync(new URL(String(url))))) as typeof fetch;
  try {
    const { exportPdf } = await import('../src/editor/export.ts');
    const doc = newIso();
    doc.style = { layout: 'scale', weldNumbers: false, lettering: 'cad' };
    doc.grid = { ...defaultGrid(), visible: true };
    appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
    const bytes = Buffer.from(await (await exportPdf(doc)).arrayBuffer());
    const content: string[] = [];
    for (let at = bytes.indexOf('stream'); at >= 0; at = bytes.indexOf('stream', at + 6)) {
      const start = at + (bytes[at + 6] === 0x0d ? 8 : 7), end = bytes.indexOf('endstream', start);
      try { content.push(inflateSync(bytes.subarray(start, end)).toString('latin1')); } catch { content.push(bytes.subarray(start, end).toString('latin1')); }
    }
    const page = content.join('\n');
    assert.ok(/ RG\b/.test(page), 'the sheet itself is drawn');
    assert.ok(!/0\.647\d* 0\.784\d* 0\.875\d* RG|0\.776\d* 0\.859\d* 0\.918\d* RG/.test(page), 'no grid lines');
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
