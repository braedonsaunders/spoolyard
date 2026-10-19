import { createDrawing } from '../src/core/drawing';
import { appendRun, newIso } from '../src/core/model';

/**
 * Timing budgets scaled to the machine running them. A fixed reference job (a small sheet drawn a few times) is timed
 * at each check, so a slow runner, or load from other work at that moment, stretches the budget by how much slower than
 * the reference machine (about 3 ms a drawing) it runs. A guard then fails only when the work itself has grown.
 */
export function budget(ms: number): number {
  {
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
    runs.sort((a, b) => a - b);
    return ms * Math.max(1, runs[2] / 3);
  }
}

/**
 * A timing guard that tolerates a burst of load from other work: the measurement is taken up to three times and
 * passes if any attempt is within its budget, judged against the machine as it was at that attempt.
 */
export function withinBudget(measure: () => number, ms: number): { ok: boolean; best: number; limit: number } {
  let best = Infinity, limit = 0
  for (let i = 0; i < 3; i++) {
    const took = measure(), allowed = budget(ms)
    if (took < best) { best = took; limit = allowed }
    if (took < allowed) return { ok: true, best: took, limit: allowed }
  }
  return { ok: false, best, limit }
}
