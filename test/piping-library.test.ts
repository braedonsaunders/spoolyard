import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { appendRun, attachComponent, bom, insertComponent, newIso, parseIsoJson, runResult, setAutoFitting } from '../src/core/model.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { symbolStrokes } from '../src/core/symbols.ts';
import { namespaceSpec } from '../src/editor/library.ts';

const dir = new URL('../public/library/specs/', import.meta.url);
const load = (slug: string) => JSON.parse(readFileSync(new URL(slug + '.json', dir), 'utf8'));

test('every library specification embeds in a valid drawing and references known component types', () => {
  const codes = new Set(COMPONENT_TYPES.map(t => t.code));
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.equal(files.length, 7);
  for (const file of files) {
    const doc = newIso();
    doc.specs = [namespaceSpec(load(file.replace('.json', '')), 'X')];
    parseIsoJson(JSON.stringify(doc));
    for (const f of doc.specs[0].fittings) assert.ok(codes.has(f.component ?? ""), f.component);
  }
});

test('every row welded into a library specification\'s line is of its pipe\'s material family', () => {
  // As scripts/annotate-library.py classifies them: a material naming one family only.
  const stainless = /A403|A182[- ]?F?3\d\d|A312|A351|CF8|CF3|\b30[48]L?\b|\b316L?\b|A240|A479|A213|A269|A358|A774|A778|\bSS\b|STAINLESS/i;
  const carbon = /A234|\bWPB\b|A105|A106|A216|\bWCB\b|\bA53\b|A350|\bLF2\b|A420|WPL6|A333|A181|A197|MALLEABLE|CARBON|A707|\bCS\b/i;
  const family = (raw = '') => {
    const text = raw.replace(/\bA\s+(?=\d)/g, 'A'); // "A 106 Grade B" is A106
    return stainless.test(text) === carbon.test(text) ? undefined : stainless.test(text) ? 'stainless' : 'carbon';
  };
  const mismatched: string[] = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const spec = load(file.replace('.json', ''));
    const own = new Set(spec.sizes.map((z: { material?: string }) => family(z.material ?? spec.material)).filter(Boolean));
    assert.equal(own.size, 1, `${spec.id} pipe materials`);
    const [pipe] = own;
    // Gaskets, bolting and supports are not welded into the line (carbon-steel supports on stainless pipe are usual).
    for (const row of spec.fittings.filter((f: { kind: string }) => !['gasket', 'bolt', 'support', 'annotation'].includes(f.kind))) {
      const f = family(row.material);
      if (f && f !== pipe) mismatched.push(`${row.id}: ${row.material}`);
    }
  }
  assert.deepEqual(mismatched, []);
  // The stainless specifications' swages are bought in their own stainless.
  const swage = load('ss-a').fittings.find((f: { component?: string }) => f.component === 'C-SWG');
  assert.equal(swage.material, 'A403-304L');
});

test('spec A elbow takeouts drive cut lengths and unknown dimensions stay missing', () => {
  const doc = newIso();
  doc.specs = [namespaceSpec(load('a'), 'A')];
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  const corner = appendRun(doc, 'o', [1000, 0, 0], 'A', 2, 'SP-1', 'L1');
  appendRun(doc, corner.id, [0, 1000, 0], 'A', 2, 'SP-1', 'L1');
  setAutoFitting(doc, corner.id);
  const elbow = doc.specs[0].fittings.find(f => f.component === 'W-LR90EL' && f.nps === 2)!;
  corner.catalogId = elbow.id;
  assert.equal(elbow.takeout, 76.2);
  assert.equal(runResult(doc, doc.runs[0]).cut, 1000 - 76.2 - doc.specs[0].rootGap);
  const missing = doc.specs[0].fittings.find(f => f.takeoutMissing && f.nps === 2 && f.kind === 'valve');
  if (missing) {
    const valve = insertComponent(doc, doc.runs[0].id, 'valve', 0.5);
    valve.catalogId = missing.id;
    assert.ok(Number.isNaN(runResult(doc, doc.runs[0]).cut));
  }
});

test('annotation symbols draw on the sheet but never reach the bill of materials', () => {
  const doc = newIso();
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  appendRun(doc, 'o', [1000, 0, 0], 'CS40', 2, 'SP-1', 'L1');
  const before = bom(doc).length;
  const arrow = attachComponent(doc, doc.runs[0].id, 'annotation', 0.5);
  arrow.component = 'D-ARR';
  parseIsoJson(JSON.stringify(doc));
  assert.equal(bom(doc).length, before);
  for (const t of COMPONENT_TYPES) assert.ok(symbolStrokes(t.code, t.kind).length > 0, t.code);
});

test('ortho routing follows the iso axis nearest the pointer and the held sheet fit stays put', async () => {
  const { createDrawing } = await import('../src/core/drawing.ts');
  const { pickOrthoPoint, defaultGrid } = await import('../src/core/grid.ts');
  const doc = newIso();
  doc.nodes.push({ id: 'o', kind: 'end', position: [0, 0, 0] });
  appendRun(doc, 'o', [1000, 0, 0], 'CS40', 2, 'SP-1', 'L1');
  const d = createDrawing(doc);
  const at = (p: [number, number, number]) => d.project(p);
  const near = (p: [number, number, number]) => { const q = at(p); return [q[0] + 3, q[1] - 2] as [number, number]; };
  assert.deepEqual(pickOrthoPoint(d, near([1000, 0, 700]), [1000, 0, 0], defaultGrid()), [1000, 0, 700]);
  assert.deepEqual(pickOrthoPoint(d, near([1000, -400, 0]), [1000, 0, 0], defaultGrid()), [1000, -400, 0]);
  const before = d.project([1000, 0, 0]);
  appendRun(doc, doc.nodes[1].id, [0, 0, 700], 'CS40', 2, 'SP-1', 'L1');
  const held = createDrawing(doc, '', 'iso', d.fit);
  assert.deepEqual(held.project([1000, 0, 0]), before);
  assert.notDeepEqual(createDrawing(doc).project([1000, 0, 0]), before);
});

test('NPS 1½ XS and Schedule 80 pipe has its published 5.08 mm wall and consistent mass', () => {
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const spec = load(file.replace('.json', ''));
    const size = spec.sizes.find((s: { nps: number }) => s.nps === 1.5);
    if (!['XS', 'SCH.80', 'SCH.80S'].includes(size.schedule)) continue;
    assert.equal(size.wall, 5.08, file);
    const mass = Math.PI * (size.od - size.wall) * size.wall * spec.density / 1e6;
    assert.ok(Math.abs(size.kgM - mass) < .001, file);
  }
});
