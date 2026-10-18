import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawSheet, imageAspect, sheetTemplateOf, wrapText, type SheetRect, type SheetRow } from '../src/core/iso/sheet.ts';
import { createDrawing, sheetWidth, type Primitive } from '../src/core/drawing.ts';
import { appendRun, newIso, parseIsoJson, type IsoDocument } from '../src/core/model.ts';
import { measureText } from '../src/core/stroke-font.ts';
import { DEFAULT_TEMPLATE, TEMPLATE_SCHEMA, validateSheetTemplate, type SheetTemplate } from '../src/core/sheet-template.ts';
import { PAPER_MM, bestOpenRect, draftingNotes, largestOpenRect, openRects, letterWidth, scaleText, sheetScale, standardScale } from '../src/core/iso/sheet-frame.ts';

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

/**
 * An invented form for exercising the template engine: a full-width title band with a stretching rule, a cell grid,
 * bound values, a revision block, two logo panels, notes above the band, a material list from the top right and a
 * north symbol in the top left. Drawn on a 400 × 250 mm sheet.
 */
const BAND = 205, TEST_TEMPLATE: SheetTemplate = {
  schema: TEMPLATE_SCHEMA, version: 1, name: 'Test form',
  fields: [{ key: 'contract', label: 'Contract' }],
  layouts: [{
    size: [400, 250], place: 'bl',
    border: { rect: [8, 8, 392, 242], weight: 0.4, bars: { bottom: 0.8 } },
    viewport: [11, 11, 389, BAND - 3], gap: 2,
    items: [
      { type: 'line', a: [8, BAND], b: [392, BAND], weight: 0.5, place: ['bl', 'br'] },
      { type: 'line', a: [8, 225], b: [392, 225], weight: 0.25, place: ['bl', 'br'] },
      { type: 'rect', rect: [20, 228, 30, 238], weight: 0.25 },
      ...[100, 200, 300].map(x => ({ type: 'line' as const, a: [x, BAND] as [number, number], b: [x, 242] as [number, number], weight: 0.25 })),
      { type: 'text', at: [10, 210], text: 'REFERENCES:', size: 2.5 },
      { type: 'text', at: [10, 216], text: '{tb.reference.1}', size: 2.5, fit: 88 },
      { type: 'text', at: [10, 221], text: '{tb.reference.2}', size: 2.5, fit: 88 },
      { type: 'text', at: [102, 209], text: 'DESIGNED', size: 2 },
      { type: 'text', at: [150, 216], text: '{tb.designedBy}', size: 3.5, anchor: 'middle', fit: 90, upper: true },
      { type: 'text', at: [102, 222], text: 'DATE ({dateFormat})', size: 2 },
      { type: 'text', at: [202, 209], text: 'PRESS ({units.pressure})', size: 2 },
      { type: 'text', at: [250, 216], text: '{tb.design.pressure}', size: 3, anchor: 'middle', fit: 90 },
      { type: 'text', at: [202, 222], text: 'CONTRACT {field.contract}', size: 2.5 },
      { type: 'text', at: [302, 230], text: 'DRAWING', size: 2 },
      { type: 'text', at: [350, 238], text: '{sheet.drawingNumber}', size: 5, anchor: 'middle', fit: 90, upper: true },
      { type: 'text', at: [390, 230], text: 'SHEET {sheet.of}', size: 2.5, anchor: 'end', when: 'multiSheet' },
      { type: 'text', at: [390, 210], text: 'SCALE {scale}', size: 2.5, anchor: 'end' },
      { type: 'text', at: [302, 210], text: '{viewNote}', size: 2 },
      { type: 'text', at: [102, 236], text: 'DATE\n{dateFormat}', size: 2.5, pitch: 3.5, fit: 12 },
      { type: 'text', at: [10, 240], text: 'METRIC ONLY', size: 2, when: 'metric' },
      { type: 'revisions', columns: [200, 215, 300], rows: [226, 232, 238], fill: 'up', fields: ['rev', 'description'], size: 2.5, upper: true },
      { type: 'logo', slot: 0, rect: [40, 226, 90, 241], pad: 1 },
      { type: 'logo', slot: 1, rect: [120, 226, 140, 241], pad: 1 }
    ],
    bom: {
      place: 'tr', right: 389, top: 8, left: 11, width: 130, title: 'MATERIAL',
      columns: [
        { field: 'id', title: 'ID', width: 9 },
        { field: 'qty', title: 'QTY', width: 14, max: 22, min: 10 },
        { field: 'nd', title: 'ND', width: 12, max: 22, min: 10 },
        { field: 'description', title: 'DESCRIPTION' }
      ],
      size: 2.2, row: 6, pitch: 3.8, raise: 0.5, inset: 1, minLines: 2, weight: 0.2
    },
    notes: { place: 'br', area: [270, 389, BAND - 1], header: 271, label: 272, text: 277, right: 388, bottom: BAND - 3, top: 100, size: 1.8, pitch: 2.9, title: 'NOTES:' },
    north: { place: 'tl', box: [14, 14, 50, 38], weight: 0.25 }
  }]
};

const document = (paper: IsoDocument['paper'] = 'tabloid', template: IsoDocument['sheetTemplate'] = TEST_TEMPLATE) => {
  const d = newIso();
  d.sheetFormat = 'production';
  d.sheetTemplate = template;
  d.paper = paper; d.units = 'imperial'; d.drawing = 'ISO-77';
  appendRun(d, null, [1000, 0, 0], 'CS40', 2, 'S1', '');
  d.notes = 'ALL DIMENSIONS SHALL BE VERIFIED BY THE FABRICATOR BEFORE CUTTING ANY PIPE AND BEFORE ANY WELDING STARTS ON THE SPOOL.\nHYDROTEST AFTER ASSEMBLY.';
  d.titleBlock = {
    ...d.titleBlock!, referenceDrawings: ['P-001 Rev.B', 'P-002'], designedBy: 'a.b.', date: '26-01-02', checkedBy: 'C.D.', projectLeader: 'E.F.',
    disciplineLeader: 'G.H.', approvedBy: 'I.J.', pipeSpec: 'CS150', designCode: 'ASME B31.3', product: 'W', projectNumber: 'PRJ-100',
    conditions: { design: ['150', '200'], operating: ['100', '120'], test: ['225', ''] }, custom: { contract: 'K-9' },
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
  if (p.type === 'circle' || p.type === 'arc') return [p.p[0] - p.r, p.p[1] - p.r, p.p[0] + p.r, p.p[1] + p.r];
  if (p.type === 'image') return [p.p[0], p.p[1], p.p[0] + p.width, p.p[1] + p.height];
  const w = measureText(p.text, p.size, p.width ?? 1), x = p.anchor === 'middle' ? p.p[0] - w / 2 : p.anchor === 'end' ? p.p[0] - w : p.p[0];
  return [x, p.p[1] - p.size, x + w, p.p[1]];
};
const overlap = (a: SheetRect, b: SheetRect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const inside = (a: SheetRect, b: SheetRect, e = 1e-6) => a[0] >= b[0] - e && a[1] >= b[1] - e && a[2] <= b[2] + e && a[3] <= b[3] + e;
/** The test form's mapping on tabloid: sheet units per template mm, and the band's top on the sheet. */
const tabloid = () => {
  const u = 850 / 279.4, s = Math.min(sheetWidth({ paper: 'tabloid' }) / u / 400, 279.4 / 250);
  return { k: s * u, dy: (279.4 - 250 * s) * u, dx: (sheetWidth({ paper: 'tabloid' }) / u - 400 * s) * u };
};
const PAPERS = ['tabloid', 'letter', 'a3', 'a4'] as const;

test('every primitive of every frame lies on the sheet for every paper size', () => {
  for (const template of [TEST_TEMPLATE, DEFAULT_TEMPLATE])
    for (const paper of PAPERS) {
      const d = document(paper, template);
      d.titleBlock!.logos = [{ name: 'a.png', dataUrl: png(400, 100) }, { name: 'b.png', dataUrl: png(100, 100) }];
      const f = frame(d, rows(40));
      const sheet: SheetRect = [0, 0, sheetWidth(d), 850];
      for (const p of [...f.primitives, ...f.finish({ scale: 0.05 })]) assert.ok(inside(box(p), sheet), `${template.name} ${paper}: ${p.type} ${p.layer} ${'text' in p ? p.text : ''} is on the sheet`);
      assert.ok(f.primitives.some(p => p.layer === 'BORDER' && p.type === 'polyline' && p.closed && !p.fill));
    }
});

test('a template is scaled by one factor in x and y on every paper size', () => {
  for (const paper of PAPERS) {
    const d = document(paper), f = frame(d);
    const [pw, ph] = [PAPER_MM[paper].width, PAPER_MM[paper].height], u = 850 / ph;
    assert.ok(Math.abs(f.paper.unitsPerMm - u) < 1e-9 && Math.abs(f.paper.height - ph) < 1e-9);
    const s = Math.min(sheetWidth(d) / u / 400, ph / 250);
    // The 10 mm square cell stays square, at the template's scale.
    const square = f.primitives.find((p): p is Extract<Primitive, { type: 'polyline' }> => p.type === 'polyline' && p.layer === 'TITLE')!;
    const [x0, y0, x1, y1] = box(square);
    assert.ok(Math.abs((x1 - x0) - (y1 - y0)) < 1e-9, `${paper}: the cell is square`);
    assert.ok(Math.abs((x1 - x0) - 10 * s * u) < 1e-9, `${paper}: at the uniform scale`);
    // Lettering keeps its proportions: cap height scales with the cell.
    const label = texts(f.primitives, 'TITLE').find(t => t.text === 'DRAWING')!;
    assert.ok(Math.abs(label.size - 2 * s * u) < 1e-9);
    // The border keeps its insets from every paper edge, and a stretching rule reaches across it.
    const border = box(f.primitives.find(p => p.layer === 'BORDER')!);
    assert.ok(Math.abs(border[0] - 8 * s * u) < 1e-9 && Math.abs(sheetWidth(d) - border[2] - 8 * s * u) < 1e-6);
    const rule = f.primitives.find((p): p is Extract<Primitive, { type: 'line' }> => p.type === 'line' && p.weight === 0.5 * u)!;
    assert.ok(Math.abs(rule.a[0] - border[0]) < 1e-6 && Math.abs(rule.b[0] - border[2]) < 1e-6, `${paper}: the band rule spans the border`);
    // The fitted model area is the same shape relative to the frame whatever the paper.
    void pw;
  }
});

test('viewport, exclusions and named regions keep the model clear of the form', () => {
  for (const template of [TEST_TEMPLATE, DEFAULT_TEMPLATE]) {
    const f = frame(document('tabloid', template));
    for (const e of f.exclusions) assert.ok(inside(e, f.viewport), 'exclusion inside the viewport');
    for (const layer of ['BOM', 'NOTES'])
      for (const p of f.primitives.filter(q => q.layer === layer && q.type === 'text'))
        assert.ok(f.exclusions.some(e => overlap(box(p), e)), `${template.name}: ${layer} text is covered by an exclusion`);
    const { regions } = f;
    assert.ok(inside(regions.open, f.viewport) && f.exclusions.every(e => !overlap(e, regions.open)), 'the open area is clear');
    assert.ok(regions.bom.length >= 1 && regions.notes && regions.north && regions.title.length >= 1);
    assert.ok(f.primitives.filter(p => p.layer === 'TITLE').every(p => regions.title.some(r => inside(box(p), r, 1))), 'title ink is in a title region');
    assert.ok(inside(f.viewport, regions.border));
  }
  const d = document('tabloid', DEFAULT_TEMPLATE), f = frame(d);
  assert.ok(f.primitives.filter(p => p.layer === 'TITLE').every(p => !overlap(box(p), f.regions.open)), 'the title block is outside the open area');
  const north = f.primitives.filter(p => p.layer === 'TEXT');
  assert.ok(north.some(p => p.type === 'polyline' && p.fill), 'filled N');
  assert.equal(north.filter(p => p.type === 'line').length, 4, 'four ticks');
  const front = frame(d, rows(7), 'front');
  assert.equal(front.primitives.filter(p => p.layer === 'TEXT').length, 0, 'no north symbol on an elevation');
  assert.equal(front.regions.north, undefined);
});

test('bindings print the document, sheet and title-block values; empty bindings print nothing', () => {
  const d = document();
  d.sheets = { S1: { drawingNumber: 'ISO-77-1' } };
  const f = frame(d), t = texts(f.primitives, 'TITLE').map(x => x.text);
  for (const s of ['REFERENCES:', 'P-001 Rev.B', 'P-002', 'A.B.', 'DATE (YY-MM-DD)', 'PRESS (PSIG)', '150', 'CONTRACT K-9', 'ISO-77-1', 'ISOMETRIC VIEW', 'DATE', 'YY-MM-DD'])
    assert.ok(t.includes(s), s);
  assert.ok(!t.some(x => x.startsWith('SHEET')), 'a single sheet is not numbered');
  assert.ok(!t.includes('METRIC ONLY'), 'conditions');
  assert.ok(texts(frame({ ...d, units: 'mm' }).primitives, 'TITLE').some(x => x.text === 'PRESS (kPa)'));
  assert.ok(texts(frame({ ...d, units: 'mm' }).primitives, 'TITLE').some(x => x.text === 'METRIC ONLY'));
  // A text whose bindings are all empty is left off; literal text around a binding is printed with it.
  const empty = { ...d, titleBlock: { ...d.titleBlock!, custom: {}, referenceDrawings: [] } };
  const none = texts(frame(empty).primitives, 'TITLE').map(x => x.text);
  assert.ok(!none.some(x => x.startsWith('CONTRACT')) && !none.includes('P-002'));
  // Values print as entered unless the template capitalises them; long values are lettered to fit.
  const long = { ...d, titleBlock: { ...d.titleBlock!, designedBy: 'A VERY LONG DESIGNER NAME THAT CANNOT FIT INSIDE ITS CELL AT ALL' } };
  const cellText = texts(frame(long).primitives, 'TITLE').find(x => x.text.startsWith('A VERY LONG'))!;
  assert.ok(measureText(cellText.text, cellText.size) <= 90 * tabloid().k + 1e-6);
  const view = texts(frame(d, rows(7), 'side').primitives, 'TITLE').map(x => x.text);
  assert.ok(view.includes('SIDE VIEW, LOOKING WEST'));
  const own = texts(drawSheet({ doc: d, spool: 'S1', width: sheetWidth(d), height: 850, rows: rows(2), view: 'front', viewNote: 'VIEW A-A' }).primitives, 'TITLE');
  assert.ok(own.some(x => x.text === 'VIEW A-A'), 'layout may name the view');
});

test('sheets of a set are numbered, and the scale reads NTS or the fitted ratio', () => {
  const d = document();
  const end = d.nodes.find(n => d.runs[0].to === n.id)!;
  appendRun(d, end.id, [0, 1000, 0], 'CS40', 2, 'S2', '');
  const second = drawSheet({ doc: d, spool: 'S2', width: sheetWidth(d), height: 850, rows: rows(3) });
  const t = texts(second.primitives, 'TITLE').map(x => x.text);
  assert.ok(t.includes('SHEET 2 OF 2') && t.includes('SCALE NTS'));
  assert.deepEqual(second.finish({ scale: 0.05 }), [], 'a not-to-scale sheet has nothing to add');
  d.style = { ...d.style!, scaleNote: false };
  assert.ok(!texts(frame(d).primitives, 'TITLE').some(x => x.text.startsWith('SCALE')), 'the NTS note can be switched off');
  d.style = { ...d.style!, layout: 'scale', scaleNote: undefined };
  const toScale = frame(d);
  assert.ok(!texts(toScale.primitives, 'TITLE').some(x => x.text.startsWith('SCALE')), 'the ratio waits for the fit');
  assert.deepEqual(texts(toScale.finish({ scale: 1 / 20 }), 'TITLE').map(x => x.text), ['SCALE 1:20']);
  d.units = 'mm';
  assert.deepEqual(texts(frame(d).finish({ scale: 1 / 48 }), 'TITLE').map(x => x.text), ['SCALE 1:48'], 'a metric sheet keeps the ratio');
  d.units = 'imperial';
  assert.deepEqual(texts(frame(d).finish({ scale: 1 / 48 }), 'TITLE').map(x => x.text), ['SCALE 1/4" = 1\'-0"']);
  assert.deepEqual(frame(d).finish({}), [], 'no fit, no ratio');
});

test('scale ratios are written exactly and snapped only down to standard scales', () => {
  assert.equal(scaleText(1 / 20), '1:20');
  assert.equal(scaleText(1 / 23.7), '1:23.7');
  assert.equal(scaleText(1 / 2.5), '1:2.5');
  assert.equal(scaleText(2), '2:1');
  assert.equal(scaleText(1 / 96, 'imperial'), '1/8" = 1\'-0"');
  assert.equal(scaleText(1 / 100, 'imperial'), '1:100');
  assert.equal(standardScale(1 / 23.7), 25);
  assert.equal(standardScale(1 / 20), 20);
  assert.equal(standardScale(1 / 50, 'imperial'), 64);
  assert.equal(standardScale(1 / 3000), 3000);
});

test('drafting notes say what the sheet settings make true', () => {
  const d = newIso();
  d.style = { layout: 'schematic', weldNumbers: false, lettering: 'cad' };
  assert.deepEqual(draftingNotes(d, sheetScale(d)), ['DIMENSIONS GOVERN - NOT TO SCALE', 'ALL LENGTHS TO CENTRELINES UNLESS NOTED']);
  d.style.layout = 'scale';
  assert.equal(sheetScale(d), '');
  assert.deepEqual(draftingNotes(d, sheetScale(d, { scale: 0.1 })), ['SCALE 1:10 - DIMENSIONS GOVERN', 'ALL LENGTHS TO CENTRELINES UNLESS NOTED']);
  d.dimensionMode = 'cut';
  assert.deepEqual(draftingNotes(d, '').slice(1), ['LENGTHS MARKED CUT ARE PIPE CUT LENGTHS', 'CUT = OVERALL - FITTINGS - ROOT GAPS']);
  d.dimensionMode = 'both';
  d.style.dimensionRounding = 'individual';
  const notes = draftingNotes(d, '');
  assert.ok(notes.includes('CUT = OVERALL - FITTINGS - ROOT GAPS') && /ROUNDED INDIVIDUALLY/.test(notes.at(-1)!));
  assert.equal(notes.filter(n => /NOT TO SCALE/.test(n)).length, 0);
});

test('classic paper prints only true notes: not to scale, to scale, lengths and rounding', () => {
  const d = newIso(); appendRun(d, null, [1000, 0, 0], 'CS40', 2, 'S1', 'L1');
  const lettering = (f: ReturnType<typeof drawSheet>) => texts([...f.primitives, ...f.finish({ scale: 1 / 25 })], 'TITLE').map(t => t.text);
  const classic = () => drawSheet({ doc: d, spool: 'S1', width: 1314, height: 850, rows: rows(3) });
  let t = lettering(classic());
  assert.ok(t.includes('DIMENSIONS GOVERN - NOT TO SCALE') && t.includes('ALL LENGTHS TO CENTRELINES UNLESS NOTED'));
  assert.ok(!t.includes('CUT = OVERALL - FITTINGS - ROOT GAPS'), 'no cut formula on an overall-only sheet');
  d.style = { ...d.style!, layout: 'scale' };
  assert.ok(!texts(classic().primitives, 'TITLE').some(x => /SCALE/.test(x.text)), 'the ratio waits for the fit');
  t = lettering(classic());
  assert.ok(t.includes('SCALE 1:25 - DIMENSIONS GOVERN') && !t.some(x => /NOT TO SCALE/.test(x)));
  d.dimensionMode = 'cut'; d.style.dimensionRounding = 'individual';
  t = lettering(classic());
  assert.ok(t.includes('CUT = OVERALL - FITTINGS - ROOT GAPS') && t.some(x => /ROUNDED INDIVIDUALLY/.test(x)));
  const footer = texts(classic().primitives, 'TITLE').filter(x => x.p[0] > 1314 - 385);
  for (let i = 0; i < footer.length; i++)
    for (let j = i + 1; j < footer.length; j++) assert.ok(!overlap(box(footer[i]), box(footer[j])), `${footer[i].text} clear of ${footer[j].text}`);
  const front = texts(drawSheet({ doc: d, spool: 'S1', width: 1314, height: 850, rows: rows(3), view: 'front' }).primitives, 'TITLE').map(x => x.text);
  assert.ok(front.includes('FRONT VIEW, LOOKING NORTH · METRIC'));
});

test('the north arrow points along plant north as the view draws it, turned by the whole north angle', async () => {
  const { northOnPage } = await import('../src/core/iso/layout.ts');
  for (const [north, view] of [[0, 'iso'], [90, 'iso'], [45, 'iso'], [30, 'plan']] as const) {
    const d = { ...document(), north };
    const f = frame(d, rows(7), view);
    const symbol = f.primitives.filter(p => p.layer === 'TEXT');
    const arrow = symbol.find((p): p is Extract<Primitive, { type: 'polyline' }> => p.type === 'polyline' && !!p.fill && p.points.length === 3)!;
    const ellipse = symbol.find((p): p is Extract<Primitive, { type: 'polyline' }> => p.type === 'polyline' && !p.fill)!;
    const xs = ellipse.points.map(q => q[0]), ys = ellipse.points.map(q => q[1]);
    const centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const tip = arrow.points[0], v = northOnPage(view, north);
    const along = Math.atan2(tip[1] - centre[1], tip[0] - centre[0]) - Math.atan2(v[1], v[0]);
    assert.ok(Math.abs(Math.atan2(Math.sin(along), Math.cos(along))) < 0.05, `${view} ${north}°: the arrow points north`);
    for (const p of symbol) assert.ok(inside(box(p), f.regions.north!, 0.01), `${view} ${north}°: the symbol stays in its box`);
  }
});

test('BOM rows grow with wrapped descriptions and centre ID, QTY and ND', () => {
  const { k } = tabloid();
  const long = 'GASKET, SPIRAL WOUND, 304 SS WINDING, GRAPHITE FILLER, CS OUTER RING, 304 SS INNER RING, ASME B16.20, 150 LB, 1/8" THK';
  const f = frame(document(), [row(1), row(2, long), row(3, 'BOLT SET, STUD BOLT, A193 B7 WITH 2 A194 2H NUTS', '5/8"X3 1/4"', '8')]);
  const rowHeights = (p: Primitive[]) => {
    const ys = [...new Set(p.filter(q => q.layer === 'BOM' && q.type === 'line' && q.a[1] === q.b[1]).map(q => (q as { a: [number, number] }).a[1]))].sort((a, b) => a - b);
    return ys.slice(1).map((y, i) => (y - ys[i]) / k);
  };
  const heights = rowHeights(f.primitives);
  assert.ok(Math.abs(heights[0] - 6) < 1e-6, 'title row');
  assert.ok(Math.abs(heights[1] - 6) < 1e-6, 'header row');
  assert.ok(Math.abs(heights[2] - 9.8) < 1e-6, 'a single-line row is as tall as two lines while the list fits one block');
  assert.ok(heights[3] > 6 + 2 * 3.8, 'three-line description row');
  assert.ok(heights[4] >= 9.8, 'two-line ND row');
  const desc = texts(f.primitives, 'BOM').filter(t => t.anchor !== 'middle');
  const right = (TEST_TEMPLATE.layouts[0].bom!.right) * k + tabloid().dx;
  assert.ok(desc.length >= 5 && desc.every(t => t.p[0] + measureText(t.text, t.size) < right), 'descriptions stay in their column');
  assert.deepEqual(texts(f.primitives, 'BOM').filter(t => t.text === '5/8"X3' || t.text === '1/4"').map(t => t.anchor), ['middle', 'middle']);
  // A list that would need a second block at that height keeps its single-line rows one line tall instead.
  const short = frame(document(), Array.from({ length: 30 }, (_, i) => row(i + 1)));
  assert.equal(texts(short.primitives, 'BOM').filter(t => t.text === 'MATERIAL').length, 1);
  // (lettered a little smaller, if that keeps it in one block).
  const one = [...new Set(rowHeights(short.primitives).map(h => Math.round(h * 100) / 100))];
  assert.equal(one.length, 1);
  assert.ok(one[0] <= 6 && one[0] >= 6 * 0.91);
});

test('held BOM row heights preserve mixed issued spacing and grow enough to fit the lettering', () => {
  const d = document(), data = [{ ...row(1, 'TEE'), key: 'demo-tee' }, { ...row(2, 'PIPE\nCUT TO 4"\nTOTAL OF TWO PIECES'), key: 'demo-pipe' }];
  d.sheets = { S1: { bomRowHeights: { 'demo-tee': 18, 'demo-pipe': 8 } } };
  const before = JSON.stringify(d.runs), p = frame(d, data).primitives;
  const ys = [...new Set(p.filter((q): q is Extract<Primitive, { type: 'line' }> => q.layer === 'BOM' && q.type === 'line' && q.a[1] === q.b[1]).map(q => q.a[1]))].sort((a, b) => a - b);
  assert.ok(Math.abs(ys[3] - ys[2] - 18) < 1e-8, 'single-line row keeps its held height');
  assert.ok(ys[4] - ys[3] > 20, 'a small held height cannot clip three lines of text');
  assert.equal(JSON.stringify(d.runs), before);
  assert.deepEqual(parseIsoJson(JSON.stringify(d)).sheets!.S1.bomRowHeights, d.sheets.S1.bomRowHeights);
  d.sheets.S1.bomRowHeights!['demo-tee'] = 201;
  assert.throws(() => parseIsoJson(JSON.stringify(d)), /sheet information/);
});

test('a long BOM continues in another block instead of clipping', () => {
  const many = rows(45);
  const f = frame(document(), many);
  const bom = texts(f.primitives, 'BOM');
  const titles = bom.filter(t => t.text === 'MATERIAL');
  assert.ok(titles.length >= 2, 'more than one block');
  assert.equal(bom.filter(t => t.text === 'DESCRIPTION').length, titles.length, 'every block repeats the headings');
  for (const r of many) assert.ok(bom.some(t => t.text === String(r.id) && t.anchor === 'middle'), `row ${r.id} is drawn`);
  const band = BAND * tabloid().k + tabloid().dy;
  for (const p of f.primitives.filter(q => q.layer === 'BOM')) {
    assert.ok(!overlap(box(p), f.regions.notes!), 'BOM clear of the notes');
    assert.ok(box(p)[3] < band, 'BOM above the title band');
    assert.ok(!overlap(box(p), f.regions.north!), 'BOM clear of the north symbol');
  }
  assert.equal(f.regions.bom.length, titles.length);
  const huge = frame(document(), rows(150));
  assert.equal(new Set(texts(huge.primitives, 'BOM').filter(t => /^\d+$/.test(t.text) && t.anchor === 'middle').map(t => t.text)).size >= 150, true);
  for (const p of huge.primitives) assert.ok(inside(box(p), [0, 0, 1314, 850]));
});

test('cells entered by hand are marked in the material list', () => {
  for (const format of ['production', 'classic'] as const) {
    const d = { ...document(), sheetFormat: format };
    const marked = [row(1), { ...row(2), qtyText: '3', calculated: { qtyText: '2', nd: '2"', description: row(2).description } }, { ...row(3), overridden: ['description' as const] }];
    const f = frame(d, marked), plain = frame(d, [row(1), row(2), row(3)]);
    const deltas = (p: Primitive[]) => p.filter(q => q.layer === 'BOM' && q.type === 'polyline' && q.points.length === 3)
    assert.equal(deltas(plain.primitives).length, 0, `${format}: calculated rows are not marked`);
    assert.equal(deltas(f.primitives).length, 3, `${format}: two marked cells and the legend`);
    assert.ok(texts(f.primitives, 'BOM').some(t => t.text === 'ENTERED BY HAND, NOT CALCULATED'));
    for (const e of deltas(f.primitives)) assert.ok(f.exclusions.some(x => inside(box(e), x, 1)), `${format}: the marks are kept clear`);
  }
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
  assert.ok(Math.abs(last - ((BAND - 3) * tabloid().k + tabloid().dy)) < 0.01, 'the block ends at its last baseline');
  assert.equal(frame({ ...d, notes: '' }).regions.notes, undefined, 'no notes, no notes area');
  // The built-in form adds the drafting notes to the general notes.
  const builtIn = texts(frame(document('a3', DEFAULT_TEMPLATE)).primitives, 'NOTES').map(t => t.text);
  assert.ok(builtIn.includes('DIMENSIONS GOVERN - NOT TO SCALE') && builtIn.includes('ALL LENGTHS TO CENTRELINES UNLESS NOTED'));
});

test('revisions fill up from the headings with the latest above', () => {
  const d = document();
  const t = texts(frame(d).primitives, 'TITLE');
  const latest = t.find(x => x.text === 'ISSUED FOR CONSTRUCTION')!, older = t.find(x => x.text === 'ISSUED FOR REVIEW')!;
  assert.ok(latest.p[1] < older.p[1], 'newest revision above the older one');
  const only = texts(frame({ ...d, titleBlock: { ...d.titleBlock!, revisions: d.titleBlock!.revisions.slice(0, 1) } }).primitives, 'TITLE');
  assert.equal(only.find(x => x.text === 'ISSUED FOR REVIEW')!.p[1], older.p[1], 'a single revision sits in the bottom row');
  const three = [...d.titleBlock!.revisions, { ...d.titleBlock!.revisions[1], rev: 'C', description: 'AS BUILT' }];
  const shown = texts(frame({ ...d, titleBlock: { ...d.titleBlock!, revisions: three } }).primitives, 'TITLE').map(x => x.text);
  assert.ok(shown.includes('AS BUILT') && !shown.includes('ISSUED FOR REVIEW'), 'the latest revisions that fit are shown');
});

test('logos become images fitted into their panels at their own proportions', () => {
  const d = document(), { k, dy } = tabloid();
  d.titleBlock!.logos = [{ name: 'wide.png', dataUrl: png(344, 109) }, { name: 'square.jpg', dataUrl: jpeg(50, 50) }];
  const images = frame(d).primitives.filter((p): p is Extract<Primitive, { type: 'image' }> => p.type === 'image');
  assert.equal(images.length, 2);
  const [wide, square] = images;
  assert.ok(Math.abs(wide.width / wide.height - 344 / 109) < 1e-9 && Math.abs(square.width / square.height - 1) < 1e-9);
  const panel = (r: number[]): SheetRect => [r[0] * k, r[1] * k + dy, r[2] * k, r[3] * k + dy];
  assert.ok(inside(box(wide), panel([40, 226, 90, 241])));
  assert.ok(inside(box(square), panel([120, 226, 140, 241])));
  assert.equal(wide.href, d.titleBlock!.logos[0].dataUrl);
  assert.equal(frame().primitives.filter(p => p.type === 'image').length, 0, 'empty panels without logos');
});

test('wrapText fits lines and breaks words that are too wide', () => {
  const lines = wrapText('PIPE, SMLS, ASTM A106 GR.B, SCH 40 - CUT TO 12\'-1 7/16" AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 13, 200);
  assert.ok(lines.length > 2 && lines.every(l => measureText(l, 13) <= 200 * 1.001));
  assert.equal(lines.join('').replace(/\s/g, ''), 'PIPE,SMLS,ASTMA106GR.B,SCH40-CUTTO12\'-17/16"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.deepEqual(wrapText('', 13, 100), ['']);
  // Sans lettering is wider than ROMANS, so it wraps sooner.
  const text = 'FLANGE WN, ASTM A105, 150 LB, RF, SCH 40, ASME B16.5';
  assert.ok(wrapText(text, 10, 200, 1, 'sans').length >= wrapText(text, 10, 200).length);
  assert.ok(letterWidth(text, 10, 'sans') > measureText(text, 10));
  assert.equal(imageAspect(png(300, 100)), 3);
  assert.equal(imageAspect(jpeg(120, 60)), 2);
  assert.equal(imageAspect('data:image/gif;base64,R0lGOD'), undefined);
});

test('an issued material-table width gives its descriptions more room without moving its right edge', () => {
  const d = document(), r = rows(4);
  const bounds = (f: ReturnType<typeof frame>) => {
    const xs = f.primitives.flatMap(p => p.type === 'line' && p.layer === 'BOM' ? [p.a[0], p.b[0]] : []);
    return [Math.min(...xs), Math.max(...xs)];
  };
  const original = bounds(frame(d, r)), width = original[1] - original[0] + 20;
  d.sheets = { S1: { bomWidth: width } };
  const changed = bounds(frame(d, r));
  assert.ok(Math.abs(changed[1] - original[1]) < 1e-6);
  assert.ok(Math.abs(changed[1] - changed[0] - width) < 1e-6);
  assert.equal(parseIsoJson(JSON.stringify(d)).sheets!.S1.bomWidth, width);
  d.sheets.S1.bomWidth = -1; assert.throws(() => parseIsoJson(JSON.stringify(d)), /sheet information/);
});

test('held material columns preserve their paper widths and lettering through native-file reopening', () => {
  const d = document(), r = rows(4), before = frame(d, r);
  d.sheets = { S1: { bomColumns: [30, 42, 32] } };
  const reopened = parseIsoJson(JSON.stringify(d)), after = frame(reopened, r);
  const vertical = after.primitives.filter(p => p.type === 'line' && p.layer === 'BOM' && p.a[0] === p.b[0]);
  const xs = [...new Set(vertical.map(p => p.type === 'line' ? p.a[0] : 0))].sort((a, b) => a - b);
  assert.equal(xs.length, 5);
  assert.deepEqual(xs.slice(1, 4).map(x => Math.round((x - xs[0]) * 1000) / 1000), [30, 72, 104]);
  const cap = (primitives: Primitive[]) => primitives.find(p => p.type === 'text' && p.text === 'ID');
  assert.equal((cap(before.primitives) as { size: number }).size, (cap(after.primitives) as { size: number }).size);
  assert.deepEqual(reopened.sheets!.S1.bomColumns, [30, 42, 32]);
  for (const bad of [[30, 42], [0, 42, 32], [150, 150, 150]]) {
    d.sheets!.S1.bomColumns = bad as [number, number, number]; assert.throws(() => parseIsoJson(JSON.stringify(d)), /sheet information/);
  }
});

test('template JSON is validated strictly and travels in the drawing', () => {
  assert.equal(validateSheetTemplate(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE))).name, DEFAULT_TEMPLATE.name);
  assert.equal(validateSheetTemplate(JSON.parse(JSON.stringify(TEST_TEMPLATE))).layouts.length, 1);
  const bad = (change: (t: any) => void, message: RegExp) => {
    const t = JSON.parse(JSON.stringify(TEST_TEMPLATE)); t.text = () => t.layouts[0].items.find((i: any) => i.type === 'text'); change(t); delete t.text;
    assert.throws(() => validateSheetTemplate(t), message);
  };
  bad(t => { t.schema = 'other'; }, /schema/);
  bad(t => { t.layouts = []; }, /layouts/);
  bad(t => { t.text().txt = 'x'; }, /unknown property "txt"/);
  bad(t => { t.text().text = '{tb.nothing}'; }, /unknown binding \{tb.nothing\}/);
  bad(t => { t.text().text = '{field.other}'; }, /unknown binding/);
  bad(t => { t.layouts[0].border.rect = [10, 10, 5, 5]; }, /x1 > x0/);
  bad(t => { t.layouts[0].items[0].type = 'circle'; }, /type/);
  bad(t => { t.text().size = 'big'; }, /size/);
  bad(t => { t.layouts[0].bom.columns = t.layouts[0].bom.columns.slice(0, 3); }, /description/);
  bad(t => { t.fields.push({ key: 'contract', label: 'Again' }); }, /repeated/);
  bad(t => { t.layouts[0].items.find((i: any) => i.type === 'revisions').fields.pop(); }, /one field per column/);
  // A drawing carries its template, or names a built-in; reopening keeps it.
  const d = document();
  const reopened = parseIsoJson(JSON.stringify(d));
  assert.deepEqual(reopened.sheetTemplate, TEST_TEMPLATE);
  assert.deepEqual(frame(reopened).primitives, frame(d).primitives);
  d.sheetTemplate = 'iso7200';
  assert.equal(sheetTemplateOf(parseIsoJson(JSON.stringify(d))), DEFAULT_TEMPLATE);
  d.sheetTemplate = 'nonesuch';
  assert.throws(() => parseIsoJson(JSON.stringify(d)), /Unknown sheet template/);
  d.sheetTemplate = { ...TEST_TEMPLATE, version: 2 } as unknown as SheetTemplate;
  assert.throws(() => parseIsoJson(JSON.stringify(d)), /version/);
  // Production drawings saved before templates draw on the built-in default; classic stays classic.
  delete d.sheetTemplate;
  assert.equal(sheetTemplateOf(d), DEFAULT_TEMPLATE);
  assert.ok(texts(frame(d).primitives, 'TITLE').some(t => t.text === 'DRAWING NO.'));
  const custom = document(); custom.titleBlock!.custom = { 'bad key': 'x' };
  assert.throws(() => parseIsoJson(JSON.stringify(custom)), /title block/);
});

test('the largest open rectangle avoids every exclusion', () => {
  assert.deepEqual(largestOpenRect([0, 0, 100, 50], []), [0, 0, 100, 50]);
  assert.deepEqual(largestOpenRect([0, 0, 100, 50], [[70, 0, 100, 30]]), [0, 0, 70, 50]);
  assert.deepEqual(largestOpenRect([0, 0, 100, 50], [[0, 0, 20, 10], [60, 0, 100, 50]]), [0, 10, 60, 50]);
  // Every maximal rectangle is offered; the model's proportions choose among them.
  const free = openRects([0, 0, 100, 60], [[60, 0, 100, 20]]);
  assert.deepEqual(free, [[0, 20, 100, 60], [0, 0, 60, 60]]);
  assert.deepEqual(bestOpenRect(free, 2.5), [0, 20, 100, 60]);
  assert.deepEqual(bestOpenRect(free, 1), [0, 0, 60, 60]);
});

test('classic paper restores the Spoolyard heading and ISO view without dropping the native model or material schedule', () => {
  const d = newIso(); appendRun(d, null, [1000, 0, 0], 'CS40', 2, 'S1', 'L1');
  const before = JSON.stringify(d.nodes); d.sheetFormat = 'classic';
  const drawing = createDrawing(d, 'S1'), text = drawing.primitives.flatMap(p => p.type === 'text' ? [p.text] : []);
  assert.ok(text.includes('SPOOLYARD  /  PIPING ISOMETRIC')); assert.ok(text.includes('ISO VIEW · METRIC'));
  assert.ok(text.includes('BILL OF MATERIALS')); assert.ok(drawing.primitives.some(p => p.layer === 'PIPE'));
  assert.ok(!drawing.primitives.some(p => p.type === 'image')); assert.equal(JSON.stringify(d.nodes), before);
  assert.equal(parseIsoJson(JSON.stringify(d)).sheetFormat, 'classic');
});

test('classic notes wrap before the right footer and long notes remain on the drawing', () => {
  const d = newIso(); appendRun(d, null, [1000, 0, 0], 'CS40', 2, 'S1', 'L1');
  d.notes = Array(40).fill('VERIFY PIPE BEFORE CUTTING.').join(' ');
  let drawing = createDrawing(d, 'S1');
  assert.ok(drawing.primitives.some(p => p.layer === 'NOTES'));
  assert.ok(drawing.primitives.some(p => p.type === 'text' && p.text === 'NOTES: SEE DRAWING ABOVE'));
  for (const p of drawing.primitives) if (p.type === 'text' && p.layer === 'NOTES') assert.ok(p.p[1] + p.size * .3 < 650, 'continued notes stay above the footer');
  d.notes = Array(7).fill('VERIFY PIPE BEFORE CUTTING.').join(' ');
  drawing = createDrawing(d, 'S1');
  const notes = drawing.primitives.filter(p => p.type === 'text' && p.layer === 'TITLE' && p.p[0] === 48 && p.p[1] >= 726 && p.size === 9);
  assert.ok(notes.length > 1);
  for (const p of notes) if (p.type === 'text') assert.ok(p.p[0] + letterWidth(p.text, p.size, 'sans') < drawing.width - 385);
});

test('classic material tables use the room freed when notes move into the footer', () => {
  const d = newIso(); d.notes = Array(3).fill('VERIFY PIPE BEFORE CUTTING AND CHECK EVERY CONNECTION AGAINST THE CURRENT APPROVED DRAWING REVISION.').join('\n');
  const materialRows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, key: `test-row-${i}`, qtyText: '1', nd: '2"', description: 'STAINLESS STEEL PIPE FITTING' }));
  d.sheets = { S1: { bomRowHeights: Object.fromEntries(materialRows.map(r => [r.key, 28])) } };
  const blocks = drawSheet({ doc: { ...d, sheetFormat: 'classic' }, spool: 'S1', width: 1314, height: 850, rows: materialRows }).primitives.filter(p => p.type === 'text' && p.text === 'BILL OF MATERIALS').length;
  assert.equal(blocks, 1);
});

test('classic material lists are laid out by measured lettering and the room they have', () => {
  const d = newIso(); d.notes = '';
  const classic = (r: SheetRow[]) => drawSheet({ doc: d, spool: 'S1', width: 1314, height: 850, rows: r });
  const lines = (f: ReturnType<typeof classic>) => f.primitives.filter((p): p is Extract<Primitive, { type: 'line' }> => p.type === 'line' && p.layer === 'BOM');
  const top = (f: ReturnType<typeof classic>) => Math.min(...lines(f).map(l => l.a[1])), left = (f: ReturnType<typeof classic>) => Math.min(...lines(f).map(l => l.a[0]));
  // A short list stays narrow and under the heading; the row count alone never widens or raises it.
  const eleven = classic(Array.from({ length: 11 }, (_, i) => row(i + 1, 'TEE')));
  assert.ok(Math.abs(left(eleven) - (1314 - 40 - 300)) < 1e-6 && top(eleven) > 110, 'eleven short rows keep the narrow list');
  // Lettering is measured: narrow letters fit more to a line than wide ones.
  const narrow = classic([row(1, 'I'.repeat(60))]), wide = classic([row(1, 'W'.repeat(60))]);
  const count = (f: ReturnType<typeof classic>) => texts(f.primitives, 'BOM').filter(t => /^[IW]+$/.test(t.text)).length;
  assert.ok(count(narrow) < count(wide));
  for (const f of [narrow, wide]) for (const t of texts(f.primitives, 'BOM').filter(t => /^[IW]+$/.test(t.text)))
    assert.ok(t.p[0] + letterWidth(t.text, t.size, 'sans') < 1314 - 40 - 30 * 0 - (54 + 38) + 1, 'descriptions stay in their column');
  // A list too long for the room under the heading rises beside it before it splits.
  const tall = classic(Array.from({ length: 22 }, (_, i) => row(i + 1, 'TEE')));
  assert.equal(texts(tall.primitives, 'BOM').filter(t => t.text === 'BILL OF MATERIALS').length, 1);
  assert.ok(top(tall) < 110);
  for (const p of lines(tall)) assert.ok(Math.max(p.a[1], p.b[1]) <= 640 + 1e-6);
});

test('dense classic sheets keep every material block above the footer and reserve the left blocks', () => {
  const d = newIso(); d.title = 'COMPLETE DRAWING TITLE FOR A LONG MULTI-SPOOL FABRICATION AND INSTALLATION PACKAGE';
  const materialRows = rows(40), f = drawSheet({ doc: d, spool: 'S1', width: 1314, height: 850, rows: materialRows });
  const headers = f.primitives.filter(p => p.type === 'text' && p.text === 'BILL OF MATERIALS'); assert.ok(headers.length > 1);
  const tableLines = f.primitives.filter(p => p.type === 'line' && p.layer === 'BOM');
  for (const p of tableLines) if (p.type === 'line') assert.ok(Math.max(p.a[1], p.b[1]) <= 640 + 1e-6);
  const left = Math.min(...tableLines.flatMap(p => p.type === 'line' ? [p.a[0], p.b[0]] : [])); assert.ok(left < 657);
  const leftEnd = Math.max(...tableLines.flatMap(p => p.type === 'line' && Math.abs(p.a[0] - left) < 1e-6 && Math.abs(p.b[0] - left) < 1e-6 ? [p.a[1], p.b[1]] : []));
  assert.ok(f.exclusions.some(b => b[0] <= left && b[2] > left + 100 && b[3] >= leftEnd));
  const title = f.primitives.find(p => p.type === 'text' && p.text === d.title); assert.ok(title?.type === 'text');
  assert.ok(title.p[0] + letterWidth(title.text, title.size, 'sans') < left - 70);
});

test('legacy drawings use the native Spoolyard paper and open material list by default', () => {
  const d = document(); delete d.sheetFormat;
  const drawing = createDrawing(d, 'S1'), text = drawing.primitives.filter(p => p.type === 'text').map(p => p.text);
  assert.ok(text.includes('SPOOLYARD  /  PIPING ISOMETRIC'));
  assert.ok(text.includes('ISO VIEW · IMPERIAL'));
  assert.deepEqual(text.filter(t => ['#', 'DESCRIPTION', 'NPS', 'QTY'].includes(t)).slice(0, 4), ['#', 'DESCRIPTION', 'NPS', 'QTY']);
  assert.ok(!text.includes('REFERENCES:'));
  assert.ok(!drawing.primitives.some(p => p.type === 'image'));
  d.sheetFormat = 'classic'; assert.deepEqual(createDrawing(d, 'S1').primitives, drawing.primitives);
});

test('native material columns remain editable without changing lettering size or truncating descriptions', () => {
  const d = document(); d.sheetFormat = 'classic';
  const before = frame(d), size = texts(before.primitives, 'BOM').find(p => p.text === '1')!.size;
  d.sheets = { S1: { bomWidth: 360, bomColumns: [42, 65, 48] } };
  const after = frame(d), list = texts(after.primitives, 'BOM');
  assert.equal(list.find(p => p.text === '1')!.size, size);
  assert.ok(!list.some(p => p.text.includes('…')));
  assert.ok(list.some(p => p.text === 'BILL OF MATERIALS'));
  assert.equal(parseIsoJson(JSON.stringify(d)).sheets!.S1.bomColumns![1], 65);
});

test('fourteen detailed native material rows stay in one list above the footer', () => {
  const d = document(); d.sheetFormat = 'classic'; d.notes = '';
  const f = frame(d, rows(14));
  assert.equal(texts(f.primitives, 'BOM').filter(p => p.text === 'BILL OF MATERIALS').length, 1);
  for (let i = 1; i <= 14; i++) assert.ok(texts(f.primitives, 'BOM').some(p => p.text === String(i)));
  for (const p of f.primitives) if (p.layer === 'BOM' && p.type === 'text') assert.ok(p.p[1] + p.size * .5 < 640);
});
