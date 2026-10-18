import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNode, type PipeNode } from '../src/core/model.ts';
import { exportPcf, importPcf } from '../src/core/pcf.ts';

// Hand-written PCFs with invented data.
const head = (bore = 'MM') => `UNITS-BORE ${bore}\nUNITS-CO-ORDS MM\nPIPELINE-REFERENCE L1\n    PIPING-SPEC A1\n`;
const pipe = (a: string, b: string, bore = '100') => `PIPE\n    END-POINT ${a} ${bore} BW\n    END-POINT ${b} ${bore} BW\n`;
const elbow = (a: string, c: string, b: string, extra = '', bore = '100') =>
  `ELBOW\n    END-POINT ${a} ${bore} BW\n    CENTRE-POINT ${c} ${bore}\n    END-POINT ${b} ${bore} BW\n${extra}`;
const bends = (text: string) => importPcf(text).doc.nodes.filter(n => n.kind === 'elbow90' || n.kind === 'elbow45');

test('an elbow without ANGLE whose rounded end points make about 45° or 90° is that standard elbow', () => {
  const at45 = bends(head() + pipe('0 0 0', '1000 0 0') + elbow('1000 0 0', '1063.5 0 0', '1108.4 44.8 0') + pipe('1108.4 44.8 0', '1800 736 0'));
  assert.deepEqual(at45.map(n => [n.kind, n.bendAngle]), [['elbow45', undefined]]);
  const at90 = bends(head() + pipe('0 0 0', '1000 0 0') + elbow('1000 0 0', '1152.4 0 0', '1152.5 152.3 0') + pipe('1152.5 152.3 0', '1152.5 900 0'));
  assert.deepEqual(at90.map(n => [n.kind, n.bendAngle]), [['elbow90', undefined]]);
  // A real off-angle bend keeps its measured angle.
  const odd = bends(head() + pipe('0 0 0', '1000 0 0') + elbow('1000 0 0', '1100 0 0', '1186.6 50 0') + pipe('1186.6 50 0', '1966 500 0'));
  assert.ok(Math.abs(odd[0].bendAngle! - 30) < 0.05, String(odd[0].bendAngle));
});

test('a 180° return written without ANGLE is a return, not a 0° bend', () => {
  const text = head() + pipe('0 0 0', '1000 0 0') + elbow('1000 0 0', '1000 152.4 0', '1000 304.8 0', '    SKEY EUBW\n') + pipe('1000 304.8 0', '0 304.8 0');
  const nodes = importPcf(text).doc.nodes.filter(n => n.kind === 'elbow90');
  assert.ok(!nodes.some(n => n.bendAngle === 0), JSON.stringify(nodes.map(n => n.bendAngle)));
  assert.deepEqual(nodes.map(n => n.component), ['LR180R', 'LR180R']);
});

test('ANGLE in hundredths of a degree is read as such, as Spoolyard itself writes it', () => {
  // A 2.5° bend: Spoolyard writes ANGLE 250.
  const a = [1000, 0, 0], u = [Math.cos(2.5 * Math.PI / 180), Math.sin(2.5 * Math.PI / 180), 0];
  const end = a.map((v, i) => (v + 300 * u[i]).toFixed(3)).join(' '), far = a.map((v, i) => (v + 2000 * u[i]).toFixed(3)).join(' ');
  const text = head() + pipe('0 0 0', '700 0 0') +
    `BEND\n    END-POINT 700 0 0 100 BW\n    CENTRE-POINT 1000 0 0 100\n    END-POINT ${end} 100 BW\n    ANGLE 250\n    BEND-RADIUS 6876\n` + pipe(end, far);
  const bend = importPcf(text).doc.nodes.find(n => n.component === 'PIPEBEND')!;
  assert.ok(Math.abs(bend.bendAngle! - 2.5) < 1e-6, String(bend.bendAngle));
  // Without end points to compare, a whole number above 180 can only be hundredths.
  assert.equal(bends(head() + pipe('0 0 0', '1000 0 0') + elbow('1000 0 0', '1152.4 0 0', '1152.4 152.4 0', '    ANGLE 9000\n') + pipe('1152.4 152.4 0', '1152.4 900 0'))[0].bendAngle, undefined);
});

test('a bore in scientific notation is read whole', () => {
  const { doc } = importPcf(head() + pipe('0 0 0', '1000 0 0', '1.5E+02'));
  assert.equal(doc.runs[0].nps, 6);
});

test('a pipe shorter than the matching tolerance is left out with a warning, not a failed import', () => {
  const { doc, warnings } = importPcf(head() + pipe('0 0 0', '1000 0 0') + pipe('1000 0 0', '1000.3 0 0') + pipe('1000.3 0 0', '2000 0 0'));
  assert.ok(doc.runs.length >= 2);
  assert.ok(doc.runs.every(r => r.from !== r.to));
  assert.ok(warnings.some(w => /too short|shorter/i.test(w)), warnings.join('\n'));
});

test('a tee is exported under its header, whatever order its pipes were read in', () => {
  const text = `UNITS-BORE MM\nUNITS-CO-ORDS MM\nPIPELINE-REFERENCE L2-BRANCH\n    PIPING-SPEC B1\n` + pipe('500 100 0', '500 800 0', '50') +
    `PIPELINE-REFERENCE L1-HEADER\n    PIPING-SPEC A1\n` + pipe('0 0 0', '400 0 0') +
    `TEE\n    END-POINT 400 0 0 100 BW\n    END-POINT 600 0 0 100 BW\n    CENTRE-POINT 500 0 0 100\n    BRANCH1-POINT 500 100 0 50 BW\n` + pipe('600 0 0', '1500 0 0');
  const { doc } = importPcf(text);
  // The tee's branch pipe first among its pipes.
  const tee = doc.nodes.find(n => n.kind === 'tee')!, branch = doc.runs.find(r => r.id === tee.branchEdgeId)!;
  doc.runs = [branch, ...doc.runs.filter(r => r !== branch)];
  const out = exportPcf(doc);
  const teeText = out.slice(out.indexOf('\nTEE'));
  const owner = out.slice(0, out.indexOf('\nTEE')).split('\n').filter(l => l.startsWith('PIPELINE-REFERENCE')).at(-1);
  assert.equal(owner, 'PIPELINE-REFERENCE L1-HEADER');
  assert.match(teeText, /CENTRE-POINT [^\n]* 100(\.0+)?\n/);
});

test('the drawing revision is the first pipeline’s, not the last one read', () => {
  const text = `UNITS-BORE MM\nUNITS-CO-ORDS MM\nPIPELINE-REFERENCE L1\n    REVISION 3\n` + pipe('0 0 0', '1000 0 0') +
    `PIPELINE-REFERENCE L2\n    REVISION 0\n` + pipe('1000 0 1000', '2000 0 1000');
  assert.equal(importPcf(text).doc.revision, '3');
});

test('supports are placed on their pipes promptly in a large PCF', () => {
  let text = head(), x = 0;
  for (let i = 0; i < 1500; i++) { text += pipe(`${x} 0 0`, `${x + 1000} 0 0`); x += 1000; }
  for (let i = 0; i < 300; i++) text += `SUPPORT\n    CO-ORDS ${i * 5000 + 500} 0 0 100\n    SKEY 01HG\n`;
  const t = performance.now(), { doc } = importPcf(text), ms = performance.now() - t;
  const supports = doc.nodes.filter((n: PipeNode) => n.kind === 'support');
  assert.equal(supports.length, 300);
  assert.ok(supports.every(s => { const r = doc.runs.find(r => r.id === s.associatedRunId)!; return getNode(doc, r.from).position[0] <= s.position[0] && s.position[0] <= getNode(doc, r.to).position[0]; }));
  assert.ok(ms < 4000, `${ms.toFixed(0)} ms`);
});
