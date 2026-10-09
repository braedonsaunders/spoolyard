import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, newIso } from '../src/core/model.ts';
import { createDrawing, type Point } from '../src/core/drawing.ts';
import { pipeAtPoint } from '../src/editor/pipe-hit.ts';

test('insertion finds pipe ends under connection targets at any zoom', () => {
  const doc = newIso();
  appendRun(doc, null, [2000, 0, 0], 'CS40', 2, 'SP-001', '');
  const drawing = createDrawing(doc, '', 'iso', undefined, { model: true });
  const a = drawing.positions.get(doc.runs[0].from)!;
  const b = drawing.positions.get(doc.runs[0].to)!;
  for (const scale of [0.01, 0.2, 1, 4, 32]) {
    const screen = ([x, y]: Point): Point => [x * scale + 150, y * scale - 80];
    for (const fraction of [0, 0.02, 0.5, 0.98, 1]) {
      const click = screen([a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]);
      assert.equal(pipeAtPoint(doc, drawing, click, screen)?.runId, doc.runs[0].id);
      assert.equal(pipeAtPoint(doc, drawing, [click[0], click[1] + 8], screen)?.runId, doc.runs[0].id);
    }
  }
});

test('insertion ignores empty space, component connectors and hidden spools', () => {
  const doc = newIso();
  const end = appendRun(doc, null, [2000, 0, 0], 'CS40', 2, 'SP-001', '');
  appendRun(doc, end.id, [0, 2000, 0], 'CS40', 2, 'SP-002', '');
  const drawing = createDrawing(doc, 'SP-001', 'iso', undefined, { model: true });
  assert.equal(pipeAtPoint(doc, drawing, drawing.project([2000, 1000, 0]), p => p), null);
  assert.equal(pipeAtPoint(doc, drawing, [-10000, -10000], p => p), null);
  const connectorDrawing = { ...drawing, primitives: [{ type: 'line' as const, a: [0, 0] as Point, b: [100, 0] as Point, layer: 'SYMBOL', owner: 'connector' }] };
  assert.equal(pipeAtPoint(doc, connectorDrawing, [50, 0], p => p), null);
});

test('overlapping pipes use the directly identified run as the tie breaker', () => {
  const doc = newIso();
  appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP-001', '');
  const drawing = createDrawing(doc, '', 'iso', undefined, { model: true });
  const pipe = drawing.primitives.find(p => p.type === 'line' && p.layer === 'PIPE')!;
  const overlapping = { ...drawing, primitives: [pipe, { ...pipe, owner: 'second' }] };
  doc.runs.push({ ...doc.runs[0], id: 'second' });
  assert.equal(pipeAtPoint(doc, overlapping, drawing.project([250, 0, 0]), p => p, 'second')?.runId, 'second');
});

test('the drawn pipe gap under a label is still part of its measured centreline', () => {
  const doc = newIso(); appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP-001', '');
  const drawing = createDrawing(doc, '', 'iso', undefined, { model: true });
  const hit = pipeAtPoint(doc, drawing, drawing.project([500, 0, 0]), p => p);
  assert.equal(hit?.runId, doc.runs[0].id);
  assert.ok(Math.abs(hit!.fraction - 0.5) < 1e-9);
});
