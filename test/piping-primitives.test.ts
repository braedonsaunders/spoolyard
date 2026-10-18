import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createDrawing, drawingSvg, LAYER_WEIGHT, type Drawing, type Primitive } from '../src/core/drawing.ts';
import { appendRun, newIso, parseIsoJson } from '../src/core/model.ts';
import { isometricDxf, readIsometricFile } from '../src/core/document.ts';
import { cadStrokeWidth, LINE_SPACING, measureText } from '../src/core/stroke-font.ts';
import { drawPrimitives } from '../src/editor/export.ts';
import { SheetLayer } from '../src/editor/sheet-layer.tsx';

/** A 4x2 RGBA PNG as a data URL. */
const png = (() => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(2 * (1 + 4 * 4), 0x80);
  rows[0] = rows[17] = 0;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + bytes.toString('base64');
})();

const primitives = (): Primitive[] => [
  { type: 'line', a: [10, 20], b: [110, 20], layer: 'PIPE', owner: 'run-1' },
  { type: 'line', a: [10, 30], b: [110, 30], layer: 'DIM', owner: 'run-1' },
  { type: 'line', a: [10, 40], b: [110, 40], layer: 'SYMBOL', weight: 5 },
  { type: 'polyline', points: [[10, 50], [30, 70], [50, 50]], layer: 'SYMBOL', owner: 'valve-1' },
  { type: 'polyline', points: [[60, 50], [100, 50], [110, 70], [70, 70]], closed: true, layer: 'TAG' },
  { type: 'polyline', points: [[120, 50], [140, 60], [120, 70], [125, 60]], fill: true, layer: 'LEADER' },
  { type: 'circle', p: [200, 60], r: 2.5, fill: true, layer: 'WELD', owner: 'weld-1' },
  { type: 'circle', p: [230, 60], r: 8, layer: 'SYMBOL' },
  { type: 'text', p: [20, 120], text: `2'-6 1/2"`, size: 10, layer: 'DIM', owner: 'run-1', role: 'overall' },
  { type: 'text', p: [200, 120], text: '45° H', size: 8, layer: 'DIM', rotation: 30, oblique: 30, anchor: 'middle' },
  { type: 'text', p: [300, 120], text: 'BILL OF MATERIALS', size: 9, layer: 'TITLE', anchor: 'end', rotation: -30, oblique: -30 },
  { type: 'text', p: [20, 200], text: `CONT'D ON\nDWG# ISO-2\n℄ EL +1'-4″`, size: 7, layer: 'TEXT', owner: 'node-9' },
  { type: 'image', p: [400, 700], width: 120, height: 60, href: png, layer: 'TITLE' },
];
const drawing = (lettering: 'cad' | 'sans'): Drawing => ({
  width: 1314, height: 850, area: [50, 115, 994, 630], fit: { centre: [0, 0], scale: 1 }, primitives: primitives(),
  positions: new Map(), project: () => [0, 0], view: 'iso', lettering,
});
const documentWithLogo = () => {
  const doc = newIso();
  appendRun(doc, null, [1000, 0, 0], 'CS40', 2, 'SP-001', 'L-1');
  doc.titleBlock!.logos = [{ name: 'FAB SHOP', dataUrl: png }];
  return doc;
};

/** DXF entities as group-code lists, in file order. */
function entities(dxf: string) {
  const lines = dxf.trimEnd().split('\n');
  assert.equal(lines.length % 2, 0);
  const records: Array<Array<[number, string]>> = [];
  for (let i = 0; i < lines.length; i += 2) {
    assert.match(lines[i], /^\d+$/, `group code at line ${i + 1}`);
    const pair: [number, string] = [Number(lines[i]), lines[i + 1]];
    if (pair[0] === 0) records.push([pair]);
    else records.at(-1)?.push(pair);
  }
  const start = records.findIndex(r => r.some(([c, v]) => c === 2 && v === 'ENTITIES'));
  const end = records.findIndex((r, i) => i > start && r[0][1] === 'ENDSEC');
  return { all: records, entities: records.slice(start + 1, end) };
}
const value = (r: Array<[number, string]>, code: number) => r.find(([c]) => c === code)?.[1];
const values = (r: Array<[number, string]>, code: number) => r.filter(([c]) => c === code).map(([, v]) => v);

test('SVG draws every primitive kind', () => {
  const cad = drawingSvg(drawing('cad')), sans = drawingSvg(drawing('sans'));
  for (const svg of [cad, sans]) {
    assert.match(svg, /<polyline [^>]*points="10,50 30,70 50,50"[^>]*fill="none"/);
    assert.match(svg, /<polygon [^>]*points="60,50 100,50 110,70 70,70"[^>]*fill="none"/);
    assert.match(svg, /<polygon [^>]*points="120,50 140,60 120,70 125,60"[^>]*fill="currentColor"/);
    assert.match(svg, /<circle [^>]*cx="200"[^>]*fill="currentColor"/);
    assert.match(svg, /<circle [^>]*cx="230"[^>]*fill="white"/);
    assert.match(svg, /<line [^>]*stroke-width="5"/);
    assert.ok(svg.includes(`<image data-owner="" class="title" x="400" y="700" width="120" height="60" href="${png}"`));
  }
  assert.equal((cad.match(/<path [^>]*data-text=/g) ?? []).length, 4);
  assert.ok(!cad.includes('<text '));
  assert.match(sans, /<text [^>]*text-anchor="middle" transform="translate\(200 120\) rotate\(-30\) skewX\(/);
  assert.match(sans, /<text [^>]*text-anchor="end"/);
});

test('the editor layer draws every primitive with its owner, length handle and selection', () => {
  const render = (lettering: 'cad' | 'sans', editing: { runId: string; role: 'overall' | 'cut' } | null = null) =>
    renderToStaticMarkup(createElement('svg', null, createElement(SheetLayer, {
      primitives: primitives(), lettering, background: 'white', selection: new Set(['run-1']), editing, onEditLength: () => {},
    })));
  const sans = render('sans'), cad = render('cad');
  for (const svg of [sans, cad]) {
    assert.match(svg, new RegExp(`<line data-owner="run-1" [^>]*class="iso-primitive iso-layer-pipe selected" stroke-width="${LAYER_WEIGHT.PIPE}"`));
    assert.match(svg, /<line data-owner="run-1" [^>]*stroke="transparent" stroke-width="14"/);
    assert.match(svg, /<line [^>]*class="iso-primitive iso-layer-symbol" stroke-width="5"/);
    assert.match(svg, /<polyline data-owner="valve-1" points="10,50 30,70 50,50" class="iso-primitive iso-layer-symbol"[^>]*fill="none"/);
    assert.match(svg, /<polygon points="60,50 100,50 110,70 70,70" class="iso-primitive iso-layer-tag"/);
    assert.match(svg, /<polygon points="120,50 140,60 120,70 125,60" class="iso-primitive iso-layer-leader iso-fill"/);
    assert.match(svg, /<circle data-owner="weld-1" cx="200" cy="60" r="2.5" class="iso-primitive iso-layer-weld iso-fill"/);
    assert.match(svg, /<image href="data:image\/png;base64,[^"]+" x="400" y="700" width="120" height="60" preserveAspectRatio="xMidYMid meet" class="iso-image iso-layer-title"/);
    assert.match(svg, /<rect data-owner="run-1" data-length="overall" [^>]*class="iso-length-hit"><title>Double-click to edit the centreline length<\/title><\/rect>/);
  }
  // Sans text keeps the SVG text element; positive oblique leans right, as in the stroke font and CAD.
  assert.match(sans, /<text data-owner="run-1" data-length="overall" x="20" y="120" font-size="13.88\d*" class="iso-text iso-layer-dim selected">2&#x27;-6 1\/2&quot;<\/text>/);
  assert.match(sans, /<text x="200" y="120" [^>]*text-anchor="middle" transform="translate\(200 120\) rotate\(-30\) skewX\(-30\) translate\(-200 -120\)"/);
  assert.match(sans, new RegExp(`<tspan x="20">CONT&#x27;D ON</tspan><tspan x="20" dy="${LINE_SPACING * 7}">DWG# ISO-2</tspan>`));
  // CAD lettering is stroked, still carries the length handle, and owned text gets a box to click.
  assert.ok(!cad.includes('<text'));
  assert.match(cad, /<path data-owner="run-1" data-length="overall" data-text="2&#x27;-6 1\/2&quot;" d="M[^"]+" stroke-width="[^"]+" class="iso-cad-text iso-layer-dim selected"/);
  assert.ok(cad.includes(`stroke-width="${cadStrokeWidth('tabloid')}" class="iso-cad-text iso-layer-dim selected"`));
  assert.match(cad, /<path data-owner="node-9" [^>]*stroke-width="[^"]+"/);
  assert.ok(cad.includes(`stroke-width="${cadStrokeWidth('tabloid')}" class="iso-cad-text iso-layer-text"`));
  const box = /<rect data-owner="node-9" x="18" y="191" width="([\d.]+)" height="([\d.]+)" fill="transparent"/.exec(cad);
  assert.ok(box, 'owned CAD text carries a pick box');
  assert.ok(Math.abs(Number(box![1]) - (measureText(`CONT'D ON\nDWG# ISO-2\n℄ EL +1'-4″`, 7) + 4)) < 1e-9);
  assert.ok(Math.abs(Number(box![2]) - (7 + 2 * LINE_SPACING * 7 + 4)) < 1e-9);
  const editing = render('cad', { runId: 'run-1', role: 'overall' });
  assert.match(editing, /<path data-owner="run-1" data-length="overall" [^>]*style="visibility:hidden"/);
  assert.ok(!editing.includes('class="iso-length-hit"'));
});

test('DXF writes polylines, fills, styled text, lineweights and image frames', () => {
  const doc = documentWithLogo();
  // A metric tabloid sheet at 1:1 in millimetres, y up from its lower-left corner.
  const k = 279.4 / 850, X = (x: number) => String(Number((x * k).toFixed(6))), Y = (y: number) => X(850 - y);
  for (const lettering of ['cad', 'sans'] as const) {
    const dxf = isometricDxf(doc, drawing(lettering));
    const { all, entities: list } = entities(dxf);
    assert.equal(dxf.includes('\nAC1015\n'), true);
    // The stored model leaves out raster logos (a DXF cannot carry them) and says so on reopening.
    const reopened = readIsometricFile(dxf);
    assert.deepEqual(reopened.doc, { ...doc, titleBlock: { ...doc.titleBlock!, logos: [] } });
    assert.match(reopened.warnings.join(), /logos are not stored in DXF \(FAB SHOP\)/);
    const modelSpace = value(all.find(r => r[0][1] === 'BLOCK_RECORD' && value(r, 2) === '*Model_Space')!, 5);
    for (const e of list) {
      assert.match(value(e, 5)!, /^[0-9A-F]+$/);
      assert.equal(value(e, 100), 'AcDbEntity');
      assert.equal(values(e, 330).at(-1), modelSpace);
      assert.equal(value(e, 8)!.startsWith('ISO-'), true);
    }
    const style = all.find(r => r[0][1] === 'STYLE' && value(r, 2) === 'ROMANS')!;
    assert.equal(value(style, 3), 'romans.shx');
    assert.equal(value(style, 41), '0.8');
    assert.ok(all.some(r => r[0][1] === 'LAYER' && value(r, 2) === 'ISO-TITLE'));
    const of = (type: string) => list.filter(e => e[0][1] === type);
    // Pens are by layer; only a primitive drawn heavier or lighter than its layer carries its own lineweight.
    const layerWeight = (name: string) => value(all.find(r => r[0][1] === 'LAYER' && value(r, 2) === name)!, 370);
    // The default pipe pen is 0.5 mm; drafting linework the thin 0.17 mm CAD pen, nearest the standard 0.18.
    assert.deepEqual(['ISO-PIPE', 'ISO-DIM', 'ISO-SYMBOL'].map(layerWeight), ['50', '18', '18']);
    assert.deepEqual(of('LINE').map(e => value(e, 370)), [undefined, undefined, '158']);
    const polylines = of('LWPOLYLINE');
    assert.deepEqual(polylines.map(e => [value(e, 8), value(e, 90), value(e, 70)]), [
      ['ISO-SYMBOL', '3', '0'], ['ISO-TAG', '4', '1'], ['ISO-LEADER', '4', '1'], ['ISO-TITLE', '4', '1'],
    ]);
    assert.deepEqual(values(polylines[0], 20), [Y(50), Y(70), Y(50)]);
    const [polygonFill, dot] = of('HATCH');
    assert.equal(value(polygonFill, 2), 'SOLID');
    assert.equal(value(polygonFill, 70), '1');
    assert.equal(value(polygonFill, 92), '3');
    assert.equal(value(polygonFill, 93), '4');
    assert.equal(value(dot, 72), '2');
    assert.equal(value(dot, 40), X(2.5));
    assert.equal(value(of('CIRCLE')[0], 40), X(2.5));
    const texts = of('TEXT');
    const byValue = (v: string) => texts.find(e => value(e, 1) === v)!;
    for (const t of texts) {
      assert.equal(value(t, 7), lettering === 'cad' ? 'ROMANS' : 'STANDARD');
      assert.equal(value(t, 41), lettering === 'cad' ? '0.8' : undefined);
      assert.deepEqual(values(t, 100), ['AcDbEntity', 'AcDbText', 'AcDbText']);
      assert.equal(t.at(-1)![0], 73);
    }
    const dimension = byValue(`2'-6 1/2"`);
    assert.deepEqual([value(dimension, 10), value(dimension, 20), value(dimension, 40), value(dimension, 72)], [X(20), Y(120), X(10), undefined]);
    assert.equal(value(dimension, 370), undefined);
    const iso = byValue('45%%d H');
    assert.deepEqual([value(iso, 50), value(iso, 51), value(iso, 72), value(iso, 11), value(iso, 21)], ['30', '30', '1', X(200), Y(120)]);
    const end = byValue('BILL OF MATERIALS');
    assert.deepEqual([value(end, 50), value(end, 51), value(end, 72), value(end, 11)], ['330', '-30', '2', X(300)]);
    const width = measureText('BILL OF MATERIALS', 9, lettering === 'cad' ? 1 : 1.25);
    assert.ok(Math.abs(Number(value(end, 10)) - (300 - width * Math.cos(Math.PI / 6)) * k) < 1e-5);
    // Lines of a callout stack like the stroke lettering; the centreline symbol and inch mark survive SHX fonts.
    const stacked = ["CONT'D ON", 'DWG# ISO-2', `\\U+2104 EL +1'-4"`].map(byValue);
    stacked.forEach((e, row) => assert.ok(Math.abs(Number(value(e, 20)) - (850 - 200 - row * LINE_SPACING * 7) * k) < 1e-5));
    const name = byValue('FAB SHOP');
    assert.deepEqual([value(name, 8), value(name, 72), value(name, 11)], ['ISO-TITLE', '1', X(460)]);
  }
});

test('DXF sheets are drawn at full paper size in the drawing units', () => {
  const header = (dxf: string, name: string) => {
    const lines = dxf.split('\n'), i = lines.indexOf(name);
    return lines.slice(i + 1, i + 7).filter((_, j) => j % 2).map(Number);
  };
  const doc = documentWithLogo();
  const metric = isometricDxf(doc);
  assert.deepEqual(header(metric, '$INSUNITS').slice(0, 1), [4]);
  assert.deepEqual(header(metric, '$MEASUREMENT').slice(0, 1), [1]);
  // 17 x 11 in tabloid: 1314 x 850 sheet units are 431.9 x 279.4 mm.
  const [w, h] = header(metric, '$LIMMAX');
  assert.ok(Math.abs(w - 431.8) < 0.2 && h === 279.4);
  doc.units = 'imperial';
  const imperial = isometricDxf(doc);
  assert.deepEqual(header(imperial, '$INSUNITS').slice(0, 1), [1]);
  const [wi, hi] = header(imperial, '$LIMMAX');
  assert.ok(Math.abs(wi - 17) < 0.01 && hi === 11);
  // Lettering keeps its printed height, about 2 mm (0.09 in) for most text.
  const { entities: list } = entities(imperial);
  const heights = list.filter(e => e[0][1] === 'TEXT').map(e => Number(value(e, 40)));
  assert.ok(heights.length && heights.every(v => v > 0.04 && v < 0.3), String(heights));
  assert.ok(list.filter(e => e[0][1] === 'LINE').every(e => [10, 11].every(c => Number(value(e, c)) >= 0 && Number(value(e, c)) <= 17)));
});

test('PDF draws every primitive kind for both letterings and embeds images once', async () => {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(readFileSync(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url)), { subset: true });
  for (const lettering of ['cad', 'sans'] as const) {
    const page = pdf.addPage([1224, 792]);
    await drawPrimitives(page, drawing(lettering), font, { x: 0, y: 792, scale: 792 / 850 });
  }
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  // One PNG on both pages: its image and alpha mask, written once.
  assert.equal(bytes.toString('latin1').match(/\/Subtype \/Image/g)?.length, 2);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
});


test('boxed callouts preserve their colour, leader and lettering through save and each drawing output', async () => {
  const doc=newIso();appendRun(doc,null,[1000,0,0],'CS40',2,'S1','L1');
  doc.sheetNotes=[{id:'check-callout',spool:'S1',text:'CHECK',at:[250,400],size:9,lettering:'sans',textColor:'#000000',color:'#ff0000',box:{at:[248,387],width:120,height:18},leader:[[430,300],[380,396],[368,396]],arrow:true}];
  const loaded=parseIsoJson(JSON.stringify(doc)), d=createDrawing(loaded,'S1');
  assert.deepEqual(loaded.sheetNotes,doc.sheetNotes);
  const own=d.primitives.filter(p=>p.owner==='check-callout');
  assert.equal(own.filter(p=>p.color==='#ff0000').length,3);
  assert.ok(own.some(p=>p.type==='text'&&p.lettering==='sans'));
  assert.match(drawingSvg(d),/style="stroke:#ff0000/);
  assert.match(drawingSvg(d),/<text[^>]+>.*CHECK/);
  const react=renderToStaticMarkup(createElement(SheetLayer,{primitives:own,lettering:'cad',background:'white',selection:new Set<string>(),editing:null,onEditLength:()=>{}}));
  assert.match(react,/<text/);assert.match(react,/stroke:#ff0000/);
  const {entities:list}=entities(isometricDxf(loaded,d));
  assert.equal(list.filter(e=>value(e,420)==='16711680').length,3);
  const pdf=await PDFDocument.create(),font=await pdf.embedFont('Helvetica'),page=pdf.addPage([1224,792]);
  await drawPrimitives(page,{...d,primitives:own},font,{x:0,y:792,scale:792/850});
  const bytes=await pdf.save();assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
  loaded.sheetNotes![0].color='red;bad';assert.throws(()=>parseIsoJson(JSON.stringify(loaded)),/sheet note/);
});

test('per-label lettering survives saving and exports as native text without changing model dimensions',()=>{
 const doc=newIso();appendRun(doc,null,[1000,300,0],'CS40',2,'S1','L1');
 const before=JSON.stringify(doc.nodes.map(n=>n.position)),first=createDrawing(doc,'S1');
 const label=first.primitives.find(p=>p.type==='text'&&p.label&&p.layer==='DIM')!;assert.equal(label.type,'text');if(label.type!=='text')return;
 doc.sheets={S1:{labelStyles:{[label.label!.key]:{size:8,rotation:30,oblique:-30}}}};
 const saved=parseIsoJson(JSON.stringify(doc)),drawing=createDrawing(saved,'S1'),styled=drawing.primitives.find(p=>p.type==='text'&&p.label?.key===label.label!.key)!;
 assert.equal(styled.type,'text');if(styled.type!=='text')return;
 assert.equal(styled.size,8);assert.equal(styled.rotation,30);assert.equal(styled.oblique,-30);assert.equal(styled.text,label.text);
 assert.equal(JSON.stringify(saved.nodes.map(n=>n.position)),before);
 assert.ok(isometricDxf(saved,drawing).includes('ROMANS'));
 saved.sheets!.S1.labelStyles![label.label!.key].oblique=90;assert.throws(()=>parseIsoJson(JSON.stringify(saved)),/sheet/i);
});
