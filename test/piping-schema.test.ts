import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { appendRun, newIso, parseIsoJson, plantCoordinate, sheetInfoOf, styleOf, titleBlockOf, type IsoDocument } from '../src/core/model.ts';

const sheet = () => {
  const d = newIso(); d.drawing = 'ISO-77'; d.revision = 'B'; d.drawnBy = 'AB'; d.checkedBy = 'CD'; d.project = 'P-100';
  const a = appendRun(d, null, [1000, 0, 0], 'CS40', 2, 'S1', '');
  appendRun(d, a.id, [0, 800, 0], 'CS40', 2, 'S2', '');
  return d;
};
test('production sheet fields round trip through the file format', () => {
  const d = sheet();
  d.titleBlock = { ...titleBlockOf(d), referenceDrawings: ['P-001 Rev.E'], date: '26-03-09', conditions: { design: ['150', '200'], operating: ['', ''], test: ['225', ''] },
    revisions: [{ rev: 'A', date: '26-03-09', description: 'ISSUED FOR CONSTRUCTION', designedBy: 'A.K.', checkedBy: 'B.L.', disciplineLead: 'C.N.', projectLeader: 'C.N.', approvedBy: 'D.P.' }],
    logos: [{ name: 'logo.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }], dateFormat: 'YY/MM/DD' };
  d.sheets = { S1: { drawingNumber: 'ISO-201-1' } };
  d.style = { layout: 'schematic', weldNumbers: false, lettering: 'cad' };
  d.coordinates = { origin: [16900, -40000, 30700] };
  d.sheetNotes = [{ id: 'n1', spool: 'S1', text: '*--FIELD ROUTE TO SUIT', at: [500, 80] }];
  const end = d.nodes[0];
  end.continuation = { text: "CONT'D ON\nDWG# ISO-201-2", coordinates: true };
  end.elevationCallout = true; end.tiePoint = { id: '3-2B', label: 'EXIST. FLANGE' }; end.operator = 'OPERATOR SOUTH';
  end.calloutText = 'U-BOLT'; end.jointSupply = { gasket: true, bolts: false }; end.portFlanges = { [d.runs[0].id]: { component: 'FLG-RFLJ', gasket: true } };
  assert.deepEqual(parseIsoJson(JSON.stringify(d)), d);
  assert.equal(sheetInfoOf(d, 'S1').drawingNumber, 'ISO-201-1');
  assert.equal(sheetInfoOf(d, 'S2').drawingNumber, 'ISO-77-2');
  assert.equal(sheetInfoOf(d, 'S2').revision, 'A');
  assert.deepEqual(plantCoordinate(d, [100, 200, 300]), [17000, -39800, 31000]);
});
test('older drawings fill the title block from their header and keep the original style', () => {
  const d = sheet(); delete d.titleBlock; delete d.style;
  const block = titleBlockOf(d);
  assert.equal(block.designedBy, 'AB'); assert.equal(block.checkedBy, 'CD'); assert.equal(block.projectNumber, 'P-100');
  assert.equal(block.revisions[0].rev, 'B'); assert.equal(block.pipeSpec, 'CS40');
  assert.deepEqual(styleOf(d), { layout: 'scale', weldNumbers: true, lettering: 'sans' });
  assert.equal(sheetInfoOf(d, '').drawingNumber, 'ISO-77');
  assert.deepEqual(styleOf(newIso()), { layout: 'schematic', weldNumbers: false, lettering: 'cad' });
});
test('malformed production sheet fields are rejected', () => {
  const bad = (edit: (d: IsoDocument) => void, message: RegExp) => {
    const d = sheet(); d.titleBlock = titleBlockOf(d); edit(d);
    assert.throws(() => parseIsoJson(JSON.stringify(d)), message);
  };
  bad(d => { d.titleBlock!.logos = [{ name: 'x', dataUrl: 'javascript:alert(1)' }]; }, /title block/);
  bad(d => { d.titleBlock!.logos = [{ name: 'x', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }]; }, /title block/);
  bad(d => { d.titleBlock!.referenceDrawings = ['a', 'b', 'c', 'd', 'e', 'f']; }, /title block/);
  bad(d => { (d.titleBlock!.conditions as any).design = ['1']; }, /title block/);
  bad(d => { d.style = { layout: 'tiny', weldNumbers: false, lettering: 'cad' } as any; }, /style/);
  bad(d => { d.coordinates = { origin: [0, Infinity, 0] } as any; }, /coordinates/);
  bad(d => { d.sheets = { S1: { drawingNumber: 7 as any } }; }, /sheet information/);
  bad(d => { d.sheetNotes = [{ id: '', spool: 'S1', text: 'x', at: [0, 0] }]; }, /sheet note/);
  bad(d => { d.nodes[0].continuation = { text: 5 as any }; }, /callout/);
  bad(d => { d.nodes[0].portFlanges = { x: { component: 'FLG', gasket: 'yes' as any } }; }, /callout/);
});
test('the bundled sample and every library specification still open', () => {
  const sample = readFileSync(new URL('../public/samples/cooling-water-return.piping', import.meta.url), 'utf8');
  assert.ok(parseIsoJson(sample).runs.length > 0);
  for (const file of readdirSync(new URL('../public/library/specs/', import.meta.url))) {
    const spec = JSON.parse(readFileSync(new URL('../public/library/specs/' + file, import.meta.url), 'utf8'));
    delete spec.branchCodes; delete spec.unsizedItems;
    const d = newIso(); d.specs = [spec];
    assert.equal(parseIsoJson(JSON.stringify(d)).specs[0].fittings.length, spec.fittings.length, file);
  }
});
