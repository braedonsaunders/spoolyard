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
