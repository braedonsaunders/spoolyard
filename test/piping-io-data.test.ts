import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { appendRun, applyComponent, newIso, parseIsoJson, type PipeSpec } from '../src/core/model.ts';
import { reviewIso, THREAD_GENDER } from '../src/core/review.ts';
import { pipeOd } from '../src/core/standards.ts';

// Invented drawings, and the bundled (public) library specifications and sample drawing.

test('a male part screwed onto a male-threaded pipe end, or two female parts screwed together, is reported', () => {
  const threaded = (code: string) => {
    const doc = newIso(), end = appendRun(doc, null, [500, 0, 0], doc.specs[0].id, 1, 'SP-1', 'L-1', 'THD');
    applyComponent(doc, end, code);
    return reviewIso(doc).map(i => i.message).filter(m => /threaded/.test(m) && /male/.test(m));
  };
  assert.equal(THREAD_GENDER.PLUG, 'male');
  assert.equal(THREAD_GENDER['SC-CAP'], 'female');
  assert.equal(THREAD_GENDER['F-CPLGSC'], 'female');
  assert.equal(threaded('PLUG').length, 1);
  assert.match(threaded('PLUG')[0], /plug.*male-threaded, as is the threaded pipe end/i);
  assert.deepEqual(threaded('SC-CAP'), []);
  // Two female fittings screwed straight together, with no nipple between them.
  const doc = newIso(), elbow = appendRun(doc, null, [500, 0, 0], doc.specs[0].id, 1, 'SP-1', 'L-1', 'THD');
  const cap = appendRun(doc, elbow.id, [0, 0.001, 0], doc.specs[0].id, 1, 'SP-1', 'L-1', 'THD');
  doc.runs[1].connector = true;
  applyComponent(doc, elbow, 'SC-90ELL');
  applyComponent(doc, cap, 'SC-CAP');
  const female = reviewIso(doc).map(i => i.message).filter(m => /both female-threaded/.test(m));
  assert.equal(female.length, 1);
  assert.match(female[0], /nipple is needed/);
});

const library = new URL('../public/library/specs/', import.meta.url);
const specs = readdirSync(library).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(f, library), 'utf8')) as PipeSpec);

test('every library eccentric reducer is offset (D − d)/2, its two outside diameters apart, within 0.05 mm', () => {
  let rows = 0;
  for (const spec of specs) {
    const od = (nps: number) => spec.sizes.find(z => z.nps === nps)?.od ?? pipeOd(nps)!;
    for (const row of spec.fittings as Array<PipeSpec['fittings'][number] & { eccentricOffset?: number }>) {
      if (row.eccentricOffset == null) continue;
      rows++;
      const want = (od(row.nps) - od(row.smallerNps!)) / 2;
      assert.ok(Math.abs(row.eccentricOffset - want) <= 0.05, `${row.id}: ${row.eccentricOffset} mm, not (D − d)/2 = ${want.toFixed(2)} mm`);
    }
  }
  assert.ok(rows > 1000, `${rows} rows checked`);
  const ssa = specs.find(s => s.id === 'SS-A')!.fittings.find(f => f.id === 'SS-A/E-RED-4x3') as { eccentricOffset?: number };
  assert.equal(ssa.eccentricOffset, 12.7);
});

test('a material is written one way within a library specification (ASTM prefix as the specification mostly writes it)', () => {
  for (const spec of specs) {
    const materials = new Set([...spec.fittings, ...spec.sizes].map(r => r.material).filter((m): m is string => !!m));
    for (const m of materials) assert.ok(!(m.startsWith('ASTM ') && materials.has(m.slice(5))), `${spec.id}: both "${m}" and "${m.slice(5)}"`);
  }
  const a = specs.find(s => s.id === 'A')!;
  assert.deepEqual([...new Set(a.fittings.filter(f => f.component === 'C-RED').map(f => f.material))], ['A234 GR. WPB']);
});

test('the bundled sample opens clean: its valves are weighed (with the published source) and its labour is rated', () => {
  const doc = parseIsoJson(readFileSync(new URL('../public/samples/cooling-water-return.piping', import.meta.url), 'utf8'));
  assert.deepEqual(reviewIso(doc), []);
  const spec = doc.specs[0];
  for (const id of ['A/GATE-FL-4', 'A/CHECK-FL-4']) {
    const row = spec.fittings.find(f => f.id === id)!;
    assert.equal(row.weightKg, 50);
    assert.match(row.source, /Crane Figure 1?47/);
  }
  assert.ok(spec.weldHoursPerDiameterInch > 0 && spec.pipeLaborHoursM > 0);
  assert.match(spec.parameters!['Labour.Weld Hours Per Diameter-Inch'], /sample estimating rate/);
});
