import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawSheet, imageAspect, wrapText, type SheetRect, type SheetRow } from '../src/core/iso/sheet.ts';
import { sheetWidth, type Primitive } from '../src/core/drawing.ts';
import { appendRun, newIso, type IsoDocument } from '../src/core/model.ts';
import { measureText } from '../src/core/stroke-font.ts';

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return 'data:image/png;base64,' + Buffer.from(b).toString('base64');
};
const jpeg = (w: number, h: number) => {
  const b = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0]);
  return 'data:image/jpeg;base64,' + Buffer.from(b).toString('base64');
};
const document = (paper: IsoDocument['paper'] = 'tabloid') => {
  const d = newIso();
  d.paper = paper; d.units = 'imperial'; d.drawing = 'ISO-77';
  appendRun(d, null, [1000, 0, 0], 'CS40', 2, 'S1', '');
  d.notes = 'ALL DIMENSIONS SHALL BE VERIFIED BY THE FABRICATOR BEFORE CUTTING ANY PIPE AND BEFORE ANY WELDING STARTS ON THE SPOOL.\nHYDROTEST AFTER ASSEMBLY.';
  d.titleBlock = {
    ...d.titleBlock!, referenceDrawings: ['P-001 Rev.B', 'P-002'], designedBy: 'A.B.', date: '26-01-02', checkedBy: 'C.D.', projectLeader: 'E.F.',
    disciplineLeader: 'G.H.', approvedBy: 'I.J.', pipeSpec: 'CS150', designCode: 'ASME B31.3', product: 'W', projectNumber: 'PRJ-100',
    conditions: { design: ['150', '200'], operating: ['100', '120'], test: ['225', ''] },
    revisions: [
      { rev: 'A', date: '26-01-01', description: 'ISSUED FOR REVIEW', designedBy: 'A.B.', checkedBy: 'C.D.', disciplineLead: '', projectLeader: '', approvedBy: '' },
      { rev: 'B', date: '26-01-02', description: 'ISSUED FOR CONSTRUCTION', designedBy: 'A.B.', checkedBy: 'C.D.', disciplineLead: 'G.H.', projectLeader: 'E.F.', approvedBy: 'I.J.' }
    ]
  };
  return d;
};
const row = (id: number, description = 'ELL 90 LR, ASTM A234 WPB, SCH 40', nd = '2"', qtyText = '1'): SheetRow => ({ id, qtyText, nd, description });
const rows = (n: number) => Array.from({ length: n }, (_, i) =>
  row(i + 1, i % 2 ? `PIPE, SMLS, ASTM A106 GR.B, SCH 40, ASME B36.10, BE - CUT TO ${i}'-1 5/8"` : 'FLANGE WN, ASTM A105, 150 LB, RF, SCH 40'));
const frame = (d = document(), r = rows(7), view?: 'iso' | 'plan' | 'front' | 'side') =>
  drawSheet({ doc: d, spool: 'S1', width: sheetWidth(d), height: 850, rows: r, view });
const texts = (p: Primitive[], layer?: string) =>
  p.filter((q): q is Extract<Primitive, { type: 'text' }> => q.type === 'text' && (!layer || q.layer === layer));
/** Bounding box of a primitive in sheet units (text by its advance and cap height). */
const box = (p: Primitive): SheetRect => {
  if (p.type === 'line') return [Math.min(p.a[0], p.b[0]), Math.min(p.a[1], p.b[1]), Math.max(p.a[0], p.b[0]), Math.max(p.a[1], p.b[1])];
  if (p.type === 'polyline') {
    const xs = p.points.map(q => q[0]), ys = p.points.map(q => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  if (p.type === 'circle') return [p.p[0] - p.r, p.p[1] - p.r, p.p[0] + p.r, p.p[1] + p.r];
  if (p.type === 'image') return [p.p[0], p.p[1], p.p[0] + p.width, p.p[1] + p.height];
  const w = measureText(p.text, p.size), x = p.anchor === 'middle' ? p.p[0] - w / 2 : p.anchor === 'end' ? p.p[0] - w : p.p[0];
  return [x, p.p[1] - p.size, x + w, p.p[1]];
};
const overlap = (a: SheetRect, b: SheetRect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const inside = (a: SheetRect, b: SheetRect, e = 1e-6) => a[0] >= b[0] - e && a[1] >= b[1] - e && a[2] <= b[2] + e && a[3] <= b[3] + e;
const kx = 1314 / 2550, ky = 850 / 1650;
const titleTop = 1294.5 * ky;

test('every primitive of the frame lies on the sheet for every paper size', () => {
  for (const paper of ['tabloid', 'letter', 'a3', 'a4'] as const) {
    const d = document(paper);
    d.titleBlock!.logos = [{ name: 'a.png', dataUrl: png(400, 100) }, { name: 'b.png', dataUrl: png(100, 100) }];
    const f = frame(d, rows(40));
    const sheet: SheetRect = [0, 0, sheetWidth(d), 850];
    for (const p of f.primitives) assert.ok(inside(box(p), sheet), `${paper}: ${p.type} ${p.layer} ${'text' in p ? p.text : ''} is on the sheet`);
    for (const p of f.primitives.filter(q => q.layer === 'BORDER')) assert.ok(p.type === 'polyline' && p.weight === 2);
  }
});

test('the tabloid frame sits on the reference grid', () => {
  const f = frame();
  const lines = f.primitives.filter((p): p is Extract<Primitive, { type: 'line' }> => p.type === 'line');
  const horizontal = (layer: string) => [...new Set(lines.filter(l => l.layer === layer && l.a[1] === l.b[1]).map(l => Math.round(l.a[1] / ky * 2) / 2))].sort((a, b) => a - b);
  const vertical = (layer: string) => [...new Set(lines.filter(l => l.layer === layer && l.a[0] === l.b[0]).map(l => Math.round(l.a[0] / kx * 2) / 2))].sort((a, b) => a - b);
  assert.deepEqual(horizontal('TITLE'), [1294.5, 1328.5, 1357.5, 1374.5, 1420.5, 1464.5, 1509, 1516.5, 1553.5, 1557.5]);
  assert.deepEqual(vertical('TITLE'), [588.5, 747.5, 906.5, 1030, 1155.5, 1242, 1520.5, 1617, 1760.5, 1819.5, 1923.5, 2198.5, 2252.5, 2306.5, 2360, 2413.5]);
  assert.deepEqual(vertical('BOM'), [1658, 1748, 1883, 1973, 2466.5]);
  const bom = horizontal('BOM');
  assert.deepEqual(bom.slice(0, 3), [54, 88, 122]);
  const border = f.primitives.find(p => p.layer === 'BORDER');
  assert.ok(border?.type === 'polyline' && border.closed);
  assert.deepEqual(border.points.map(p => [Math.round(p[0] / kx * 2) / 2, Math.round(p[1] / ky * 2) / 2]), [[81.5, 54], [2466.5, 54], [2466.5, 1598], [81.5, 1598]]);
});

test('viewport and exclusions stay inside the border and clear of the title block', () => {
  const f = frame();
  const [x0, y0, x1, y1] = f.viewport;
  assert.ok(x0 > 81.5 * kx && y0 > 54 * ky && x1 < 2466.5 * kx && y1 < titleTop);
  const title = f.primitives.filter(p => p.layer === 'TITLE').map(box);
  assert.ok(title.every(b => b[1] >= titleTop - 1), 'the title block starts at its top line');
  assert.equal(f.exclusions.length, 3, 'north symbol, BOM and notes');
  for (const e of f.exclusions) {
    assert.ok(inside(e, f.viewport), 'exclusion inside the viewport');
    assert.ok(e[3] < titleTop, 'exclusion above the title block');
  }
  for (const layer of ['BOM', 'NOTES'])
    for (const p of f.primitives.filter(q => q.layer === layer && q.type === 'text'))
      assert.ok(f.exclusions.some(e => overlap(box(p), e)), `${layer} text is covered by an exclusion`);
  const north = f.primitives.filter(p => p.layer === 'TEXT');
  assert.ok(north.some(p => p.type === 'polyline' && p.fill), 'filled N');
  assert.equal(north.filter(p => p.type === 'line').length, 4, 'four ticks');
  assert.equal(frame(document(), rows(7), 'front').primitives.filter(p => p.layer === 'TEXT').length, 0, 'no north symbol on an elevation');
});

test('BOM rows grow with wrapped descriptions and centre ID, QTY and ND', () => {
  const long = 'GASKET, SPIRAL WOUND, 304 SS WINDING, GRAPHITE FILLER, CS OUTER RING, 304 SS INNER RING, ASME B16.20, 150 LB, 1/8" THK';
  const f = frame(document(), [row(1), row(2, long), row(3, 'BOLT SET, STUD BOLT, A193 B7 WITH 2 A194 2H NUTS', '5/8"X3 1/4"', '8')]);
  const ys = [...new Set(f.primitives.filter(p => p.layer === 'BOM' && p.type === 'line' && p.a[1] === p.b[1]).map(p => (p as { a: [number, number] }).a[1]))].sort((a, b) => a - b);
  const heights = ys.slice(1).map((y, i) => (y - ys[i]) / ky);
  assert.equal(Math.round(heights[0]), 34, 'title row');
  assert.equal(Math.round(heights[1]), 34, 'header row');
  assert.equal(Math.round(heights[2]), 34, 'single-line row');
  assert.ok(heights[3] > 76, 'three-line description row');
  assert.ok(heights[4] >= 56, 'two-line ND row');
  const desc = texts(f.primitives, 'BOM').filter(t => t.anchor !== 'middle');
  const right = 2466.5 * kx;
  assert.ok(desc.length >= 5 && desc.every(t => t.p[0] + measureText(t.text, t.size) < right), 'descriptions stay in their column');
  assert.deepEqual(texts(f.primitives, 'BOM').filter(t => t.text === '5/8"X3' || t.text === '1/4"').map(t => t.anchor), ['middle', 'middle']);
  assert.ok(texts(f.primitives, 'BOM').every(t => t.text === t.text.toUpperCase()));
});

test('a long BOM continues in another block instead of clipping', () => {
  const many = rows(45);
  const f = frame(document(), many);
  const bom = texts(f.primitives, 'BOM');
  const titles = bom.filter(t => t.text === 'BILL OF MATERIALS');
  assert.ok(titles.length >= 2, 'more than one block');
  assert.equal(bom.filter(t => t.text === 'DESCRIPTION').length, titles.length, 'every block repeats the headings');
  for (const r of many) assert.ok(bom.some(t => t.text === String(r.id) && t.anchor === 'middle'), `row ${r.id} is drawn`);
  const notes = f.primitives.filter(p => p.layer === 'NOTES').map(box);
  const notesBox: SheetRect = [Math.min(...notes.map(b => b[0])), Math.min(...notes.map(b => b[1])), Math.max(...notes.map(b => b[2])), titleTop];
  for (const p of f.primitives.filter(q => q.layer === 'BOM')) {
    assert.ok(!overlap(box(p), notesBox), 'BOM clear of the notes');
    assert.ok(box(p)[3] < titleTop, 'BOM above the title block');
  }
  const bomExclusions = f.exclusions.filter(e => bom.some(t => overlap(box(t), e)));
  assert.equal(bomExclusions.length, titles.length);
  const huge = frame(document(), rows(150));
  assert.equal(new Set(texts(huge.primitives, 'BOM').filter(t => /^\d+$/.test(t.text) && t.anchor === 'middle').map(t => t.text)).size >= 150, true);
  for (const p of huge.primitives) assert.ok(inside(box(p), [0, 0, 1314, 850]));
});

test('notes are numbered with a hanging indent and keep the user numbering', () => {
  const d = document();
  d.notes = 'NOTES:\nFIRST NOTE\n4. NUMBERED BY THE USER AND LONG ENOUGH TO WRAP ONTO A SECOND LINE OF THE NOTES BLOCK WITH A HANGING INDENT FOR SURE\nnext note';
  const notes = texts(frame(d).primitives, 'NOTES');
  assert.equal(notes[0].text, 'NOTES:');
  const labels = notes.filter(t => /^\d+\.$/.test(t.text));
  assert.deepEqual(labels.map(t => t.text), ['1.', '4.', '5.']);
  const body = notes.filter(t => t !== notes[0] && !labels.includes(t));
  assert.ok(body.length >= 4, 'the long note wraps');
  assert.equal(new Set(body.map(t => t.p[0])).size, 1, 'hanging indent');
  assert.ok(labels.every(l => l.p[0] < body[0].p[0]));
  assert.equal(body.at(-1)!.text, 'NEXT NOTE');
  const last = Math.max(...notes.map(t => t.p[1]));
  assert.ok(Math.abs(last - (1294.5 - 11.5) * ky) < 0.01, 'the block ends just above the title block');
  assert.equal(frame({ ...d, notes: '' }).exclusions.length, 2, 'no notes, no notes exclusion');
});

test('title block prints the document, sheet and latest revision values', () => {
  const d = document();
  d.sheets = { S1: { drawingNumber: 'ISO-77-1', lineNumber: 'L-200' } };
  const t = texts(frame(d).primitives, 'TITLE');
  const has = (s: string) => assert.ok(t.some(x => x.text === s), s);
  ['REFERENCE DRAWINGS:', 'P-001 Rev.B', 'P-002', 'DESIGNED BY', 'A.B.', 'DATE (YY-MM-DD)', 'CHECKED BY', 'PROJECT LEADER', 'DISCIPLINE LEADER',
    'APPROVED BY', 'I.J.', 'CONDITION', 'PRESS(PSIG)', 'TEMP(°F)', 'DESIGN', 'OPERATING', 'TEST', '225', 'INSUL. THK.', 'INSUL. CLAD.', 'TRACING',
    'PIPE SPEC:', 'CS150', 'SPEC REV:', 'DESIGN CODE:', 'ASME B31.3', 'REF. AREA', 'PRODUCT:', 'W', 'LINE No.', 'L-200', 'DRAWING No.',
    'ISO-77-1', 'PROJ. No.', 'PRJ-100', 'REV.', 'ISSUED FOR CONSTRUCTION', 'ISSUED FOR REVIEW', 'DESIGNED', 'YY-MM-DD'].forEach(has);
  const latest = t.find(x => x.text === 'ISSUED FOR CONSTRUCTION')!, older = t.find(x => x.text === 'ISSUED FOR REVIEW')!;
  assert.ok(latest.p[1] < older.p[1], 'newest revision above the older one');
  const only = texts(frame({ ...d, titleBlock: { ...d.titleBlock!, revisions: d.titleBlock!.revisions.slice(0, 1) } }).primitives, 'TITLE');
  assert.equal(only.find(x => x.text === 'ISSUED FOR REVIEW')!.p[1], older.p[1], 'a single revision sits just above the headings');
  const rev = t.filter(x => x.text === 'B');
  assert.ok(rev.some(x => x.size > 10), 'large revision letter');
  const metric = texts(frame({ ...d, units: 'mm' }).primitives, 'TITLE').map(x => x.text);
  assert.ok(metric.includes('PRESS(kPa)') && metric.includes('TEMP(°C)') && !metric.includes('PRESS(PSIG)'));
  for (const x of t) {
    const b = box(x);
    assert.ok(b[0] >= 81.5 * kx && b[2] <= 2466.5 * kx, `${x.text} inside the frame`);
  }
});

test('logos become images fitted into their panels at their own proportions', () => {
  const d = document();
  d.titleBlock!.logos = [{ name: 'wide.png', dataUrl: png(344, 109) }, { name: 'square.jpg', dataUrl: jpeg(50, 50) }];
  const images = frame(d).primitives.filter((p): p is Extract<Primitive, { type: 'image' }> => p.type === 'image');
  assert.equal(images.length, 2);
  const [wide, square] = images;
  assert.ok(Math.abs(wide.width / wide.height - 344 / 109) < 1e-9 && Math.abs(square.width / square.height - 1) < 1e-9);
  assert.ok(inside(box(wide), [1242 * kx, 1294.5 * ky, 1617 * kx, 1464.5 * ky]));
  assert.ok(inside(box(square), [1617 * kx, 1294.5 * ky, 1760.5 * kx, 1464.5 * ky]));
  assert.ok(Math.abs(wide.p[0] / kx - 1257) < 1.5 && Math.abs(wide.width / kx - 344) < 2, 'placed like the reference logo');
  assert.equal(wide.href, d.titleBlock!.logos[0].dataUrl);
  assert.equal(frame().primitives.filter(p => p.type === 'image').length, 0, 'empty panels without logos');
});

test('wrapText fits lines and breaks words that are too wide', () => {
  const lines = wrapText('PIPE, SMLS, ASTM A106 GR.B, SCH 40 - CUT TO 12\'-1 7/16" AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 13, 200);
  assert.ok(lines.length > 2 && lines.every(l => measureText(l, 13) <= 200));
  assert.equal(lines.join('').replace(/\s/g, ''), 'PIPE,SMLS,ASTMA106GR.B,SCH40-CUTTO12\'-17/16"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.deepEqual(wrapText('', 13, 100), ['']);
  assert.equal(imageAspect(png(300, 100)), 3);
  assert.equal(imageAspect(jpeg(120, 60)), 2);
  assert.equal(imageAspect('data:image/gif;base64,R0lGOD'), undefined);
});
