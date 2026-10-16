import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, distance, getNode, newIso, welds } from '../src/core/model.ts';

test('welds are numbered in sequence along each spool, not in the order the pipes were drawn', () => {
  const doc = newIso();
  // Drawn from the middle out: east, then north from its end, then down from the start.
  const corner = appendRun(doc, null, [2000, 0, 0], 'CS40', 4, 'SP-1', 'L-1');
  const start = getNode(doc, doc.runs[0].from);
  const far = appendRun(doc, corner.id, [0, 1500, 0], 'CS40', 4, 'SP-1', 'L-1');
  const low = appendRun(doc, start.id, [0, 0, -1000], 'CS40', 4, 'SP-1', 'L-1');
  // A second spool continues from the open north end.
  appendRun(doc, far.id, [0, 1000, 0], 'CS40', 4, 'SP-2', 'L-1');
  const list = welds(doc);
  assert.deepEqual(list.map(w => w.tag), ['W1', 'W2', 'W3', 'W4', 'W5']);
  // From the open end of SP-1 to the other end: each weld is further along than the last.
  const path = [far.position, corner.position, start.position, low.position];
  const along = (p: [number, number, number]) => {
    let best = Infinity, total = 0, at = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], l = distance(a, b), t = Math.max(0, Math.min(1, [0, 1, 2].reduce((s, k) => s + (p[k] - a[k]) * (b[k] - a[k]), 0) / (l * l)));
      const d = distance(p, [0, 1, 2].map(k => a[k] + (b[k] - a[k]) * t) as [number, number, number]);
      if (d < best) { best = d; at = total + t * l; }
      total += l;
    }
    return at;
  };
  const order = list.map(w => along(w.position));
  assert.deepEqual(order, [...order].sort((a, b) => b - a));
  // The walk starts at SP-1's open end, so the butt weld to SP-2 at the far end is numbered last.
  assert.equal(list.at(-1)!.nodeId, far.id);
});
