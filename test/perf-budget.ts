import { createDrawing } from '../src/core/drawing';
import { appendRun, newIso } from '../src/core/model';

/**
 * Timing budgets scaled to the machine running them. A fixed reference job (a small sheet drawn a few times) is
 * timed once, and budgets stretch by how much slower than the reference machine (about 3 ms on the reference machine) it runs, so a
 * shared CI runner fails a guard only when the work itself has grown, not because the runner is slow.
 */
let factor: number | undefined;
export function budget(ms: number): number {
  if (factor == null) {
    const doc = newIso();
    let at = appendRun(doc, null, [1500, 0, 0], 'CS40', 4, 'S1', 'L');
    for (let i = 0; i < 6; i++) at = appendRun(doc, at.id, i % 2 ? [0, 900, 0] : [0, 0, 600], 'CS40', 4, 'S1', 'L');
    createDrawing(doc, 'S1');
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const copy = structuredClone(doc);
      copy.title = `Reference ${i}`;
      const t = performance.now();
      createDrawing(copy, 'S1');
      runs.push(performance.now() - t);
    }
    factor = Math.max(1, Math.min(...runs) / 3);
  }
  return ms * factor;
}
