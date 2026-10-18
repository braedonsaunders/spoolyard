import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, insertComponent, newIso, type IsoDocument } from '../src/core/model.ts';
import { createDrawing, type Drawing, type Primitive } from '../src/core/drawing.ts';
import { isometricDxf, packageDxf, packageSheets, readIsometric, readIsometricFile } from '../src/core/document.ts';

type Pair = [number, string];
/** Group-code pairs split into records at each group 0, checking the file is well formed pair by pair. */
function parse(dxf: string): Pair[][] {
  const lines = dxf.trimEnd().split('\n');
  assert.equal(lines.length % 2, 0, 'group codes and values pair up');
  const records: Pair[][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    assert.match(lines[i], /^-?\d+$/, `group code at line ${i + 1}`);
    const pair: Pair = [Number(lines[i]), lines[i + 1]];
    if (pair[0] === 0) records.push([pair]);
    else records.at(-1)!.push(pair);
  }
  return records;
}
const value = (r: Pair[], code: number) => r.find(([c]) => c === code)?.[1];
const values = (r: Pair[], code: number) => r.filter(([c]) => c === code).map(([, v]) => v);
const section = (records: Pair[][], name: string) => {
  const start = records.findIndex(r => r[0][1] === 'SECTION' && value(r, 2) === name);
  assert.ok(start >= 0, `${name} section`);
  return records.slice(start + 1, records.findIndex((r, i) => i > start && r[0][1] === 'ENDSEC'));
};
const drawingOf = (primitives: Primitive[]): Drawing => ({
  width: 1314, height: 850, area: [50, 115, 994, 630], fit: { centre: [0, 0], scale: 1 }, primitives,
  positions: new Map(), project: () => [0, 0], view: 'iso', lettering: 'cad',
});
function sample(): IsoDocument {
  const doc = newIso();
  const elbow = appendRun(doc, null, [1500, 0, 0], 'CS40', 2, 'SP-1', 'L-1');
  appendRun(doc, elbow.id, [0, 1500, 0], 'CS40', 2, 'SP-1', 'L-1');
  insertComponent(doc, doc.runs[1].id, 'valve');
  return doc;
}

test('DXF is a complete AutoCAD R2000 file: sections, tables, owners and handles', () => {
  const doc = sample(), records = parse(isometricDxf(doc));
  // Sections in order, then EOF.
  assert.deepEqual(records.filter(r => r[0][1] === 'SECTION').map(r => value(r, 2)), ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);
  assert.equal(records.at(-1)![0][1], 'EOF');
  const header = records.find(r => r[0][1] === 'SECTION' && value(r, 2) === 'HEADER')!, variable = (name: string, code: number) => {
    const i = header.findIndex(([c, v]) => c === 9 && v === name);
    assert.ok(i >= 0, name);
    return header.slice(i + 1).find(([c]) => c === code)?.[1];
  };
  assert.equal(variable('$ACADVER', 1), 'AC1015');
  assert.equal(variable('$INSUNITS', 70), '4');
  assert.equal(variable('$DWGCODEPAGE', 3), 'ANSI_1252');
  // Tables in AutoCAD's order, with the records every R2000 drawing needs.
  const tables = section(records, 'TABLES');
  assert.deepEqual(tables.filter(r => r[0][1] === 'TABLE').map(r => value(r, 2)), ['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD']);
  const names = (type: string) => tables.filter(r => r[0][1] === type).map(r => value(r, 2));
  assert.deepEqual(names('VPORT'), ['*ACTIVE']);
  assert.deepEqual(names('LTYPE').slice(0, 3), ['ByBlock', 'ByLayer', 'Continuous']);
  assert.equal(names('LAYER')[0], '0');
  assert.ok(names('LAYER').slice(1).every(n => n!.startsWith('ISO-')));
  assert.deepEqual(names('APPID'), ['ACAD']);
  assert.deepEqual(names('DIMSTYLE'), ['Standard']);
  // Model and paper space, then one definition per drawn symbol geometry (valve, welds, title block, material list).
  assert.deepEqual(names('BLOCK_RECORD').slice(0, 2), ['*Model_Space', '*Paper_Space']);
  const symbols = names('BLOCK_RECORD').slice(2);
  assert.ok(['TITLEBLOCK', 'BOM', 'WELD'].every(n => symbols.includes(n)), symbols.join());
  assert.equal(new Set(symbols).size, symbols.length);
  for (const t of tables.filter(r => r[0][1] === 'TABLE'))
    assert.equal(Number(value(t, 70)), tables.filter(r => r[0][1] === value(t, 2)).length, `${value(t, 2)} count`);
  const blocks = section(records, 'BLOCKS');
  assert.deepEqual(blocks.slice(0, 4).map(r => [r[0][1], value(r, 2) ?? '']), [['BLOCK', '*Model_Space'], ['ENDBLK', ''], ['BLOCK', '*Paper_Space'], ['ENDBLK', '']]);
  assert.deepEqual(blocks.filter(r => r[0][1] === 'BLOCK').map(r => value(r, 2)).slice(2), symbols);
  // Unique handles below $HANDSEED; every owner and pointer refers to an object that exists.
  const handles = records.filter(r => r[0][1] !== 'SECTION').map(r => value(r, r[0][1] === 'DIMSTYLE' ? 105 : 5)).filter((h): h is string => !!h);
  assert.equal(new Set(handles).size, handles.length);
  const seed = parseInt(variable('$HANDSEED', 5)!, 16);
  assert.ok(handles.every(h => /^[0-9A-F]+$/.test(h) && parseInt(h, 16) < seed));
  const known = new Set(handles);
  for (const r of records) for (const [c, v] of r) if ([330, 340, 350, 360, 390].includes(c) && v !== '0') assert.ok(known.has(v), `${r[0][1]} ${c} ${v}`);
  // Entities belong to model space; attributes and their SEQEND to the insert they follow.
  const model = value(tables.find(r => r[0][1] === 'BLOCK_RECORD' && value(r, 2) === '*Model_Space')!, 5);
  const entities = section(records, 'ENTITIES');
  assert.ok(entities.length > 20);
  let insert = '';
  for (const e of entities) {
    if (e[0][1] === 'ATTRIB' || e[0][1] === 'SEQEND') assert.equal(values(e, 330).at(-1), insert);
    else assert.equal(values(e, 330).at(-1), model);
    if (e[0][1] === 'INSERT') insert = value(e, 5)!;
  }
  // Block contents belong to their own block record.
  for (const name of symbols) {
    const record = value(tables.find(r => r[0][1] === 'BLOCK_RECORD' && value(r, 2) === name)!, 5);
    const begin = blocks.findIndex(r => r[0][1] === 'BLOCK' && value(r, 2) === name);
    for (let i = begin; blocks[i][0][1] !== 'ENDBLK'; i++) assert.equal(values(blocks[i], 330).at(-1), record, `${name} ${blocks[i][0][1]}`);
  }
  // The root dictionary holds groups, layouts, plot styles and the stored model.
  const objects = section(records, 'OBJECTS'), root = objects[0];
  assert.equal(value(root, 330), '0');
  assert.deepEqual(values(root, 3), ['ACAD_GROUP', 'ACAD_LAYOUT', 'ACAD_PLOTSTYLENAME', 'ACAD_WIPEOUT_VARS', 'SPOOLYARD']);
  assert.deepEqual(objects.filter(r => r[0][1] === 'LAYOUT').map(r => values(r, 1).at(-1)), ['Model', 'Layout1']);
  // Each drawn item is a group, and its entities know it.
  const groups = objects.filter(r => r[0][1] === 'GROUP');
  assert.ok(groups.length >= 3);
  for (const g of groups)
    for (const member of values(g, 340)) {
      const e = entities.find(x => value(x, 5) === member)!;
      assert.deepEqual(e.slice(2, 5), [[102, '{ACAD_REACTORS'], [330, value(g, 5)!], [102, '}']]);
    }
  assert.deepEqual(readIsometric(isometricDxf(doc)), doc);
});

test('DXF extents and units follow the drawing; imperial sheets are in inches', () => {
  const doc = sample();
  doc.units = 'imperial';
  const records = parse(isometricDxf(doc)), header = records.find(r => r[0][1] === 'SECTION' && value(r, 2) === 'HEADER')!;
  const at = (name: string) => header.slice(header.findIndex(([c, v]) => c === 9 && v === name) + 1);
  assert.equal(at('$INSUNITS').find(([c]) => c === 70)![1], '1');
  const [x0, y0] = [10, 20].map(c => Number(at('$EXTMIN').find(([k]) => k === c)![1]));
  const [x1, y1] = [10, 20].map(c => Number(at('$EXTMAX').find(([k]) => k === c)![1]));
  assert.ok(x0 >= 0 && y0 >= 0 && x1 <= 17 && y1 <= 11 && x1 > x0 && y1 > y0);
  // Linetypes and layer pens from a pen table, with a company's layer prefix.
  const custom = parse(isometricDxf(doc, createDrawing(doc), { layerPrefix: 'P-', layers: { DIM: { color: 3, linetype: 'DASHED', lineweight: 0.13 } } }));
  const tables = section(custom, 'TABLES'), dim = tables.find(r => r[0][1] === 'LAYER' && value(r, 2) === 'P-DIM')!;
  assert.deepEqual([value(dim, 62), value(dim, 6), value(dim, 370)], ['3', 'DASHED', '13']);
  const dashed = tables.find(r => r[0][1] === 'LTYPE' && value(r, 2) === 'DASHED')!;
  assert.deepEqual(values(dashed, 49), ['0.5', '-0.25']);
});

test('DXF white masks are WIPEOUTs, long lines are MTEXT, and colours have an R2000 colour index', () => {
  const doc = newIso();
  appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  const long = 'FIELD VERIFY ' + 'ALL TIE-IN ELEVATIONS '.repeat(15);
  const records = parse(isometricDxf(doc, drawingOf([
    { type: 'line', a: [100, 100], b: [400, 100], layer: 'PIPE' },
    { type: 'circle', p: [250, 100], r: 8, layer: 'WELD' },
    { type: 'polyline', points: [[300, 300], [500, 300], [500, 340], [300, 340]], closed: true, fill: true, color: '#ffffff', weight: 0.001, layer: 'MARKUP', owner: 'n' },
    { type: 'polyline', points: [[300, 300], [500, 300], [500, 340], [300, 340]], closed: true, color: '#ff0000', layer: 'MARKUP', owner: 'n' },
    { type: 'text', p: [20, 500], text: long, size: 7, layer: 'NOTES' },
  ])));
  const entities = section(records, 'ENTITIES'), types = entities.map(e => e[0][1]);
  assert.deepEqual(types, ['LINE', 'WIPEOUT', 'CIRCLE', 'WIPEOUT', 'LWPOLYLINE', 'MTEXT']);
  // The note box mask is not printed as a white (ACI 7, black on paper) fill.
  assert.ok(!entities.some(e => e[0][1] === 'HATCH'));
  const box = entities.find(e => e[0][1] === 'LWPOLYLINE')!;
  assert.deepEqual([value(box, 62), value(box, 420)], ['1', String(0xff0000)]);
  const mtext = entities.find(e => e[0][1] === 'MTEXT')!;
  assert.ok([...values(mtext, 3), value(mtext, 1)!].every(v => v.length <= 250));
  assert.equal([...values(mtext, 3), value(mtext, 1)].join('').replace(/^\\W0\.8;/, ''), long);
  const classes = section(records, 'CLASSES').map(r => value(r, 1));
  assert.ok(classes.includes('WIPEOUT') && classes.includes('WIPEOUTVARIABLES'));
});

test('reopening a Spoolyard DXF warns when its CAD geometry was edited, not when it was only re-saved', () => {
  const doc = sample(), dxf = isometricDxf(doc);
  assert.deepEqual(readIsometricFile(dxf).warnings, []);
  // A CAD program re-saving the file reorders entities and renumbers nothing we compare.
  const lines = dxf.split('\n'), records = parse(dxf);
  const start = records.findIndex(r => r[0][1] === 'SECTION' && value(r, 2) === 'ENTITIES');
  const end = records.findIndex((r, i) => i > start && r[0][1] === 'ENDSEC');
  const reordered = [...records.slice(0, start + 1), ...records.slice(start + 1, end).reverse(), ...records.slice(end)]
    .flatMap(r => r.flatMap(([c, v]) => [String(c), v])).join('\n') + '\n';
  assert.deepEqual(readIsometricFile(reordered).warnings, []);
  // Moving a line is an edit the stored model does not have.
  const line = lines.findIndex((l, i) => l === 'LINE' && lines[i - 1] === '0');
  const x = lines.findIndex((l, i) => i > line && l === '10' && i % 2 !== line % 2);
  lines[x + 1] = String(Number(lines[x + 1]) + 5);
  const edited = readIsometricFile(lines.join('\n'));
  assert.match(edited.warnings.join(), /CAD geometry was changed after Spoolyard exported this DXF/);
  assert.deepEqual(edited.doc, doc);
});

test('DXFs from earlier releases (MLIGHT_XRECORD / BIDWRIGHT_PIPING_V1) still open', () => {
  const doc = sample(), encoded = encodeURIComponent(JSON.stringify(doc));
  const legacy = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015', '0', 'ENDSEC', '0', 'SECTION', '2', 'OBJECTS',
    '0', 'DICTIONARY', '5', 'C', '330', '0', '100', 'AcDbDictionary', '281', '1', '3', 'MLIGHT_XRECORD', '350', 'D',
    '0', 'DICTIONARY', '5', 'D', '330', 'C', '100', 'AcDbDictionary', '281', '1', '3', 'BIDWRIGHT_PIPING_V1', '350', 'E',
    '0', 'XRECORD', '5', 'E', '330', 'D', '100', 'AcDbXrecord', '280', '1',
    ...encoded.match(/.{1,240}/g)!.flatMap(chunk => ['1', chunk]), '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const { doc: opened, warnings, format } = readIsometricFile(legacy);
  assert.equal(format, 'dxf');
  assert.deepEqual(opened, doc);
  assert.deepEqual(warnings, []);
});

test('DXF packages have one file per spool and output view, as the PDF has pages', () => {
  const doc = sample();
  appendRun(doc, null, [0, 0, 800], 'CS40', 2, 'SP-2', 'L-2');
  doc.outputViews = ['iso', 'plan'];
  assert.deepEqual(packageSheets(doc), [
    { spool: 'SP-1', view: 'iso' }, { spool: 'SP-1', view: 'plan' }, { spool: 'SP-2', view: 'iso' }, { spool: 'SP-2', view: 'plan' },
  ]);
  const files = packageDxf(doc);
  assert.deepEqual(files.map(f => f.name), ['ISO-001-SP-1-iso.dxf', 'ISO-001-SP-1-plan.dxf', 'ISO-001-SP-2-iso.dxf', 'ISO-001-SP-2-plan.dxf']);
  assert.ok(files.every(f => readIsometric(f.content).runs.length === doc.runs.length));
  // A pipe without a spool is reported by validation; it does not add a combined sheet of everything.
  doc.runs[0].spool = '';
  assert.deepEqual(packageSheets(doc).map(s => s.spool), ['SP-1', 'SP-1', 'SP-2', 'SP-2']);
});

test('arcs are CAD ARCs in DXF and SVG arcs, counter-clockwise on the page', async () => {
  const { drawingSvg, arcPath } = await import('../src/core/drawing.ts');
  const doc = newIso();
  appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  const arc: Primitive = { type: 'arc', p: [425, 425], r: 85, start: 0, end: 90, layer: 'DIM' };
  const entities = section(parse(isometricDxf(doc, drawingOf([arc, { ...arc, start: 0, end: 360 }]))), 'ENTITIES');
  assert.deepEqual(entities.map(e => e[0][1]), ['ARC', 'CIRCLE']);
  // Tabloid metric: 279.4 mm over 850 units; the centre is at mid-height.
  const k = 279.4 / 850;
  assert.deepEqual([10, 20, 40, 50, 51].map(c => Number(value(entities[0], c))), [425 * k, 425 * k, 85 * k, 0, 90].map(v => Number(v.toFixed(6))));
  // Quarter turn from +x to straight up the page (sheet y decreases).
  assert.equal(arcPath(arc), 'M510 425A85 85 0 0 0 425 340');
  assert.ok(drawingSvg(drawingOf([arc])).includes('d="M510 425A85 85 0 0 0 425 340"'));
});

test('a package of sheets downloads as one ZIP of the files', async () => {
  const { zip } = await import('../src/core/zip.ts');
  const { crc32 } = await import('node:zlib');
  const files = [{ name: 'ISO-001-SP-1.dxf', content: '0\nEOF\n' }, { name: 'ISO-001-SP-1.dxf', content: 'é' }];
  const bytes = zip(files), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  // Stored entries with their CRC-32 and UTF-8 names; a repeated name is made unique.
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), crc32(Buffer.from(files[0].content)));
  const names = Buffer.from(bytes).toString('utf8');
  assert.ok(names.includes('ISO-001-SP-1.dxf') && names.includes('ISO-001-SP-1-2.dxf'));
});

test('a model-space view is written at true size', () => {
  const doc = newIso();
  appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  const model = createDrawing(doc, '', 'iso', undefined, { model: true });
  const entities = section(parse(isometricDxf(doc, model, { space: 'model' })), 'ENTITIES');
  const pipe = entities.find(e => e[0][1] === 'LINE' && value(e, 8) === 'ISO-PIPE')!;
  const [x0, y0, x1, y1] = [10, 20, 11, 21].map(c => Number(value(pipe, c)));
  // Lengths along the isometric axes are true: the 1000 mm pipe is 1000 mm long in the DXF.
  assert.ok(Math.abs(Math.hypot(x1 - x0, y1 - y0) - 1000) < 1, String(Math.hypot(x1 - x0, y1 - y0)));
});

test('symbols are block definitions in their own frame, one per geometry, each instance an INSERT', () => {
  const doc = newIso();
  appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  // An invented symbol: a bar and a dot, drawn upright at (100, 100), turned a quarter turn at (300, 200) and at
  // twice the size at (500, 300). Welds drawn at two points share one definition.
  const bar = (at: [number, number], turn: number, scale: number): Primitive[] => {
    const u: [number, number] = [Math.cos(turn * Math.PI / 180) * scale, -Math.sin(turn * Math.PI / 180) * scale];
    const symbol = { name: 'Test Valve', at, rotation: turn, ...(scale !== 1 ? { scale } : {}) };
    return [
      { type: 'line', a: [at[0] - 10 * u[0], at[1] - 10 * u[1]], b: [at[0] + 10 * u[0], at[1] + 10 * u[1]], layer: 'SYMBOL', owner: 'v' + at[0], symbol },
      { type: 'circle', p: at, r: 3 * scale, fill: true, layer: 'SYMBOL', owner: 'v' + at[0], symbol },
    ];
  };
  const weld = (at: [number, number]): Primitive => ({ type: 'circle', p: at, r: 2, fill: true, layer: 'WELD', owner: 'w' + at[0], symbol: { name: 'WELD', at, rotation: 0 } });
  const records = parse(isometricDxf(doc, drawingOf([
    ...bar([100, 100], 0, 1), { type: 'line', a: [0, 0], b: [50, 50], layer: 'PIPE' }, ...bar([300, 200], 90, 1), ...bar([500, 300], 0, 2),
    weld([600, 600]), weld([700, 650]),
  ])));
  const k = 279.4 / 850, blocks = section(records, 'BLOCKS'), entities = section(records, 'ENTITIES');
  const defined = blocks.filter(r => r[0][1] === 'BLOCK').map(r => value(r, 2)).slice(2);
  // The turned and the scaled bar are the same geometry in their frames.
  assert.deepEqual(defined, ['TEST-VALVE', 'WELD']);
  const inserts = entities.filter(e => e[0][1] === 'INSERT');
  assert.deepEqual(inserts.map(e => value(e, 2)), ['TEST-VALVE', 'TEST-VALVE', 'TEST-VALVE', 'WELD', 'WELD']);
  // Each insert is where the first ink of its instance was drawn, so drawing order is kept.
  assert.deepEqual(entities.map(e => e[0][1]), ['INSERT', 'LINE', 'INSERT', 'INSERT', 'INSERT', 'INSERT']);
  assert.deepEqual([10, 20].map(c => Number(value(inserts[1], c))), [300 * k, (850 - 200) * k].map(v => Number(v.toFixed(6))));
  assert.equal(value(inserts[1], 50), '90');
  assert.equal(value(inserts[0], 50), undefined);
  // The scaled instance is inserted at its scale.
  assert.deepEqual([41, 42, 43].map(c => value(inserts[2], c)), ['2', '2', '2']);
  // The definition is drawn about the insertion point, upright: the bar along x, the dot at the origin.
  const begin = blocks.findIndex(r => r[0][1] === 'BLOCK' && value(r, 2) === 'TEST-VALVE');
  const line = blocks.slice(begin).find(r => r[0][1] === 'LINE')!, dot = blocks.slice(begin).find(r => r[0][1] === 'CIRCLE')!;
  assert.deepEqual([10, 20, 11, 21].map(c => Number(value(line, c))), [-10 * k, 0, 10 * k, 0].map(v => Number(v.toFixed(6))));
  assert.deepEqual([10, 20, 40].map(c => Number(value(dot, c))), [0, 0, Number((3 * k).toFixed(6))]);
  assert.ok(blocks.slice(begin).some(r => r[0][1] === 'HATCH'), 'the filled dot keeps its fill in the definition');
  // Without blocks, every primitive is written as its own entities.
  const flat = section(parse(isometricDxf(doc, drawingOf([...bar([100, 100], 0, 1), weld([600, 600])]), { blocks: false })), 'ENTITIES');
  assert.deepEqual(flat.map(e => e[0][1]), ['LINE', 'CIRCLE', 'HATCH', 'CIRCLE', 'HATCH']);
});

test('field lettering is block attributes: ATTDEFs in the title block, the values as ATTRIBs', () => {
  const doc = newIso();
  appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  const title = { name: 'TITLEBLOCK', at: [0, 850] as [number, number], rotation: 0 };
  const records = parse(isometricDxf(doc, drawingOf([
    { type: 'polyline', points: [[900, 700], [1300, 700], [1300, 840], [900, 840]], closed: true, layer: 'TITLE', symbol: title },
    { type: 'text', p: [910, 720], text: 'DWG NO.', size: 6, layer: 'TITLE', symbol: title },
    { type: 'text', p: [1000, 720], text: 'ACME-ISO-0042', size: 8, layer: 'TITLE', field: 'sheet.drawingNumber', symbol: title },
    { type: 'text', p: [1000, 740], text: 'C', size: 8, layer: 'TITLE', anchor: 'middle', field: 'rev.1.rev', symbol: title },
    { type: 'text', p: [1000, 760], text: 'SECOND', size: 8, layer: 'TITLE', field: 'rev.1.rev', symbol: title },
  ])));
  const blocks = section(records, 'BLOCKS'), entities = section(records, 'ENTITIES');
  const begin = blocks.findIndex(r => r[0][1] === 'BLOCK' && value(r, 2) === 'TITLEBLOCK'), end = blocks.findIndex((r, i) => i > begin && r[0][1] === 'ENDBLK');
  const inside = blocks.slice(begin + 1, end);
  // Flag 2: the definition has attributes. The fixed caption is part of the form; each field an ATTDEF.
  assert.equal(value(blocks[begin], 70), '2');
  assert.deepEqual(inside.map(r => r[0][1]), ['LWPOLYLINE', 'TEXT', 'ATTDEF', 'ATTDEF', 'ATTDEF']);
  const defs = inside.filter(r => r[0][1] === 'ATTDEF');
  assert.deepEqual(defs.map(r => value(r, 2)), ['SHEET_DRAWINGNUMBER', 'REV_1_REV', 'REV_1_REV_2']);
  assert.deepEqual(defs.map(r => value(r, 3)), ['sheet.drawingNumber', 'rev.1.rev', 'rev.1.rev']);
  // The insert carries the values, followed by its SEQEND.
  assert.deepEqual(entities.map(e => e[0][1]), ['INSERT', 'ATTRIB', 'ATTRIB', 'ATTRIB', 'SEQEND']);
  assert.equal(value(entities[0], 66), '1');
  assert.deepEqual(entities.slice(1, 4).map(e => [value(e, 2), value(e, 1)]), [['SHEET_DRAWINGNUMBER', 'ACME-ISO-0042'], ['REV_1_REV', 'C'], ['REV_1_REV_2', 'SECOND']]);
  // An attribute is placed as its TEXT would be, in world coordinates, centred lettering about its alignment point.
  const k = 279.4 / 850, centred = entities[2];
  assert.equal(value(centred, 72), '1');
  assert.deepEqual([11, 21].map(c => Number(value(centred, c))), [1000 * k, (850 - 740) * k].map(v => Number(v.toFixed(6))));
  // Inserted at the sheet's lower-left corner, so the definition's coordinates are the sheet's.
  assert.deepEqual([10, 20].map(c => Number(value(entities[0], c))), [0, 0]);
});

test('dashed linework is one stroke in a linetype: LTYPE in the DXF, a dash pattern in SVG', async () => {
  const { drawingSvg, dashArray, LINETYPE_MM, LINETYPE_SCALE } = await import('../src/core/drawing.ts');
  const doc = newIso();
  appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP', 'L');
  const drawing = drawingOf([
    { type: 'line', a: [100, 100], b: [400, 100], layer: 'SYMBOL', linetype: 'dashed' },
    { type: 'polyline', points: [[100, 200], [200, 250], [300, 200]], layer: 'SYMBOL', linetype: 'center' },
    { type: 'line', a: [100, 300], b: [400, 300], layer: 'PIPE' },
  ]);
  const records = parse(isometricDxf(doc, drawing)), tables = section(records, 'TABLES'), entities = section(records, 'ENTITIES');
  const ltypes = tables.filter(r => r[0][1] === 'LTYPE').map(r => value(r, 2));
  assert.deepEqual(ltypes, ['ByBlock', 'ByLayer', 'Continuous', 'DASHED', 'CENTER']);
  const [dashed, centre, pipe] = entities;
  assert.deepEqual([value(dashed, 6), Number(value(dashed, 48))], ['DASHED', Number(LINETYPE_SCALE.toFixed(6))]);
  // A patterned polyline continues its pattern round its vertices (PLINEGEN).
  assert.deepEqual([value(centre, 6), Number(value(centre, 70)) & 128], ['CENTER', 128]);
  assert.equal(value(pipe, 6), undefined);
  // The standard pattern at the linetype scale prints the sheet's dash lengths (mm on a metric sheet).
  const pattern = values(tables.find(r => r[0][1] === 'LTYPE' && value(r, 2) === 'DASHED')!, 49).map(Number);
  assert.ok(pattern.every((v, i) => Math.abs(Math.abs(v) * LINETYPE_SCALE - LINETYPE_MM.dashed[i]) < 1e-6));
  // SVG (and the editor and PDF, which share it) draw the same pattern in sheet units: 850 units over 279.4 mm.
  const k = 850 / 279.4;
  assert.equal(dashArray(drawing.primitives[0]), LINETYPE_MM.dashed.map(v => +(v * k).toFixed(4)).join(' '));
  assert.equal(dashArray(drawing.primitives[2]), undefined);
  const svg = drawingSvg(drawing);
  assert.equal(svg.match(/stroke-dasharray="/g)?.length, 2);
  // Imperial sheets draw the same printed pattern in inches.
  doc.units = 'imperial';
  const imperial = section(parse(isometricDxf(doc, drawing)), 'TABLES').find(r => r[0][1] === 'LTYPE' && value(r, 2) === 'DASHED')!;
  assert.deepEqual(values(imperial, 49), ['0.5', '-0.25']);
});

test('a sheet carries symbol identity and field identity in its primitives', () => {
  const doc = sample(), drawing = createDrawing(doc, 'SP-1');
  const names = new Set(drawing.primitives.flatMap(p => p.symbol ? [p.symbol.name] : []));
  for (const name of ['TITLEBLOCK', 'BOM', 'WELD', 'NORTH-ARROW']) assert.ok(names.has(name), [...names].join());
  // The valve is one instance, at its node, turned with its pipe.
  const valve = doc.nodes.find(n => n.kind === 'valve')!, ink = drawing.primitives.filter(p => p.owner === valve.id && p.symbol && p.symbol.name.endsWith('VALVE'));
  assert.ok(ink.length > 0);
  assert.equal(new Set(ink.map(p => JSON.stringify(p.symbol))).size, 1);
  assert.deepEqual(ink[0].symbol!.at, drawing.positions.get(valve.id));
  // Movable callouts are not part of a symbol.
  assert.ok(!drawing.primitives.some(p => p.type === 'text' && p.label && p.symbol && !p.field));
  // Title-block and material-list lettering names its field.
  const fields = drawing.primitives.flatMap(p => p.type === 'text' && p.field ? [p.field] : []);
  assert.ok(fields.includes('doc.title') && fields.some(f => /^bom\.1\.description/.test(f)), fields.join());
  // A production template binds its fields.
  doc.sheetFormat = 'production';
  const production = createDrawing(doc, 'SP-1').primitives.flatMap(p => p.type === 'text' && p.field ? [p.field] : []);
  assert.ok(production.some(f => f.startsWith('sheet.') || f.startsWith('doc.')), production.join());
  assert.ok(production.some(f => /^bom\.\d+\.(qty|description)/.test(f)), production.join());
});

test('reopening a Spoolyard DXF notices an edited block definition or a moved insert', () => {
  const doc = sample(), dxf = isometricDxf(doc);
  assert.deepEqual(readIsometricFile(dxf).warnings, []);
  const lines = dxf.split('\n');
  const edit = (from: number, type: string) => {
    const copy = [...lines], at = copy.findIndex((l, i) => i > from && l === type && copy[i - 1] === '0');
    const x = copy.findIndex((l, i) => i > at && l === '10' && i % 2 !== at % 2);
    copy[x + 1] = String(Number(copy[x + 1]) + 5);
    return readIsometricFile(copy.join('\n')).warnings.join();
  };
  const blocks = lines.findIndex((l, i) => l === 'BLOCKS' && lines[i - 1] === '2'), weld = lines.findIndex((l, i) => i > blocks && l === 'WELD' && lines[i - 1] === '2');
  assert.match(edit(weld, 'CIRCLE'), /CAD geometry was changed/);
  assert.match(edit(lines.findIndex((l, i) => l === 'ENTITIES' && lines[i - 1] === '2'), 'INSERT'), /CAD geometry was changed/);
});
