import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendRun, bom, clone, getNode, newIso, parseIsoJson, runResult, type PipeSpec } from '../src/core/model.ts';
import { exportPcf, exportPcfPackage, importPcf } from '../src/core/pcf.ts';
import { COMPONENT_TYPES } from '../src/core/components.ts';
import { placeComponentOnPipe } from '../src/core/component-position.ts';
import { flangedJoints } from '../src/core/joints.ts';
import { decodeText } from '../src/core/text-encoding.ts';

// Hand-written PCFs in the shapes other plant-design programs write. All data is invented.

/** Older ISOGEN syntax: inch bores and coordinates, ERECTION-ITEM, a material list keyed by ITEM-CODE. */
const IMPERIAL_PCF = `ISOGEN-FILES ISOGEN.FLS
UNITS-BORE INCH
UNITS-CO-ORDS INCH
UNITS-BOLT-DIA INCH
UNITS-BOLT-LENGTH INCH
UNITS-WEIGHT LBS
PIPELINE-REFERENCE 3"-P-1001-A1
    PROJECT-IDENTIFIER DEMO-PLANT
    REVISION B
    PIPING-SPEC A1
END-CONNECTION-EQUIPMENT
    CO-ORDS 0.0000 0.0000 0.0000 3.0000
    CONNECTION-REFERENCE P-101 N1
MESSAGE-SQUARE
    CO-ORDS 10.0000 0.0000 0.0000
    TEXT SEE NOTE 1
FLANGE
    END-POINT 0.0000 0.0000 0.0000 3.0000 FL
    END-POINT 3.5000 0.0000 0.0000 3.0000 BW
    SKEY FLWN
    ITEM-CODE FLG-WN-3-150
    FABRICATION-ITEM
PIPE
    END-POINT 3.5000 0.0000 0.0000 3.0000 BW
    END-POINT 40.0000 0.0000 0.0000 3.0000 BW
    ITEM-CODE PIPE-3-STD
    FABRICATION-ITEM
OLET
    CENTRE-POINT 20.0000 0.0000 0.0000 3.0000
    BRANCH1-POINT 20.0000 0.0000 3.0000 1.0000 SW
    SKEY SKSW
    ITEM-CODE SOL-3X1
SUPPORT
    CO-ORDS 30.0000 0.0000 0.0000 3.0000
    SKEY ANCH
WELD
    CO-ORDS 40.0000 0.0000 0.0000 3.0000
    SKEY WS
    ERECTION-ITEM
ELBOW
    END-POINT 40.0000 0.0000 0.0000 3.0000 BW
    CENTRE-POINT 44.5000 0.0000 0.0000 3.0000
    END-POINT 44.5000 4.5000 0.0000 3.0000 BW
    SKEY ELBW
    ANGLE 9000
    ITEM-CODE ELL-90LR-3
    WEIGHT 7.5
PIPE
    END-POINT 44.5 4.5 0 3 BW
    END-POINT 44.5 60 0 3 BW
TEE
    END-POINT 44.5 60 0 3 BW
    CENTRE-POINT 44.5 63.375 0 3
    END-POINT 44.5 66.75 0 3 BW
    BRANCH1-POINT 47.875 63.375 0 3 BW
    SKEY TEBW
    ITEM-CODE TEE-3
PIPE
    END-POINT 44.5 66.75 0 3 BW
    END-POINT 44.5 100 0 3 BW
FLANGE
    END-POINT 44.5 100 0 3 BW
    END-POINT 44.5 103.5 0 3 FL
    SKEY FLWN
    ITEM-CODE FLG-WN-3-150
GASKET
    END-POINT 44.5 103.5 0 3 FL
    END-POINT 44.5 103.625 0 3 FL
    ITEM-CODE GSK-3-150
BOLT
    CO-ORDS 44.5 103.5625 0 3
    BOLT-DIA 0.625
    BOLT-LENGTH 3.75
    BOLT-QUANTITY 4
    BOLT-ITEM-CODE STUD-5/8
VALVE
    END-POINT 44.5 103.625 0 3 FL
    END-POINT 44.5 114.625 0 3 FL
    SKEY VTFL
    ITEM-CODE GATE-3-150
    ERECTION-ITEM
END-POSITION-OPEN
    CO-ORDS 44.5 114.625 0 3
PIPE
    END-POINT 47.875 63.375 0 3 BW
    END-POINT 70 63.375 0 3 BW
REDUCER-ECCENTRIC
    END-POINT 70 63.375 0 3 BW
    END-POINT 75 63.375 0 2 BW
    SKEY REBW
    FLAT-DIRECTION DOWN
PIPE
    END-POINT 75 63.375 0 2 BW
    END-POINT 100 63.375 0 2 BW
CAP
    END-POINT 100 63.375 0 2 BW
    SKEY KABW
ISO-SPLIT-POINT
    CO-ORDS 60 63.375 0
PIPE
    END-POINT 20 0 3 1 PL
    END-POINT 20 0 12 1 PL
MATERIALS
ITEM-CODE FLG-WN-3-150
    DESCRIPTION FLANGE, WN, 150# RF, A105
ITEM-CODE ELL-90LR-3
    DESCRIPTION 90 DEG LR ELBOW, BW, A234 WPB
ITEM-CODE GATE-3-150
    DESCRIPTION GATE VALVE, 150# RF, FLANGED
ITEM-CODE SOL-3X1
    DESCRIPTION SOCKOLET 3 x 1, 3000#
`;

/** Newer syntax with Windows line endings: metric DN bores, CATEGORY ERECTION, ends a fraction of a millimetre apart. */
const METRIC_PCF = [
  'ISOGEN-FILES ISOGEN.FLS', 'UNITS-BORE MM', 'UNITS-CO-ORDS MM', 'UNITS-WEIGHT KGS',
  'PIPELINE-REFERENCE 750-CW-001', '    PIPING-SPEC B2',
  'PIPE', '    END-POINT 0 0 0 750 BW', '    END-POINT 2000 0 0 750 BW',
  'BEND', '    END-POINT 2000.3 0 0 750 BW', '    CENTRE-POINT 3125 0 0 750', '    END-POINT 3125 1125 0 750 BW',
  '    BEND-RADIUS 1125', '    ANGLE 90.0', '    SKEY BEBW',
  'PIPE', '    END-POINT 3125 1125.2 0 750 BW', '    END-POINT 3125 3000 0 750 FL',
  'INSTRUMENT', '    END-POINT 3125 3000 0 750 FL', '    END-POINT 3125 3400 0 750 FL', '    SKEY IIFL',
  '    ITEM-DESCRIPTION FLOW ELEMENT FE-101', '    CATEGORY ERECTION',
  'PIPE', '    END-POINT 3125 3400 0 750 FL', '    END-POINT 3125 5000 0 750 BW',
  'FROBNICATOR', '    END-POINT 3125 5000 0 750 BW', '    END-POINT 3125 5300 0 750 BW',
  'PIPE', '    END-POINT 3125 5300 0 750 BW', '    END-POINT 3125 6000 0 750 BW',
  'TEXT', '    CO-ORDS 0 0 0', '    TEXT-STRING TIE-IN BY OTHERS',
  'PIPELINE-REFERENCE 25-IA-200', '    PIPING-SPEC A1',
  'PIPE', '    END-POINT 0 0 1000 25 SC', '    END-POINT 500 0 1000 25 SC',
  'COUPLING', '    END-POINT 500 0 1000 25 SC', '    END-POINT 550 0 1000 25 SC', '    SKEY COSC',
  'PIPE', '    END-POINT 550 0 1000 25 SC', '    END-POINT 1000 0 1000 25 SC',
  'UNION', '    END-POINT 1000 0 1000 25 SC', '    END-POINT 1040 0 1000 25 SC', '    SKEY UNSC', '    CATEGORY ERECTION',
  'PIPE', '    END-POINT 1040 0 1000 25 SC', '    END-POINT 1500 0 1000 25 SC',
  'VALVE-ANGLE', '    END-POINT 1500 0 1000 25 SC', '    CENTRE-POINT 1530 0 1000 25', '    END-POINT 1530 0 1030 25 SC', '    SKEY AVSC',
  'PIPE', '    END-POINT 1530 0 1030 25 SC', '    END-POINT 1530 0 1500 25 SC',
  'MISC-COMPONENT', '    END-POINT 1530 0 1500 25 SC', '    END-POINT 1530 0 1560 25 SC', '    SKEY FXSC', '    ITEM-DESCRIPTION HOSE, 1" x 60 MM',
  'PIPE', '    END-POINT 1530 0 1560 25 SC', '    END-POINT 1530 0 2000 25 PL',
  ''
].join('\r\n');

const specA = JSON.parse(readFileSync(new URL('../public/library/specs/a.json', import.meta.url), 'utf8')) as PipeSpec;
const type = (code: string) => COMPONENT_TYPES.find(t => t.code === code)!;
/** A flanged gate valve between two pipes, a tee branch and a field elbow, on the library specification. */
function sample() {
  const doc = newIso(); doc.specs = [clone(specA)]; doc.project = 'DEMO'; doc.revision = 'C';
  const elbow = appendRun(doc, null, [2000, 0, 0], 'A', 2, 'SP-1', 'L-1');
  appendRun(doc, elbow.id, [0, 2000, 0], 'A', 2, 'SP-1', 'L-1');
  placeComponentOnPipe(doc, doc.runs[1].id, type('GATE-FL'), 0.5);
  elbow.field = true;
  doc.runs[0].toTag = 'W-7';
  const second = appendRun(doc, null, [0, 0, 1500], 'A', 2, 'SP-2', 'L-2'), riser = doc.runs.find(r => r.to === second.id)!;
  // Clear of the first pipe's open end: coincident ends are one connection in a PCF.
  for (const id of [riser.from, riser.to]) getNode(doc, id).position[2] += 500;
  doc.coordinates = { origin: [100000, 200000, 3000] };
  return doc;
}
const block = (pcf: string, type: string) => pcf.split(/\n(?=\S)/).filter(b => b.split('\n')[0] === type);

test('PCF export is spec-clean: units, one header per pipeline, symbol keys, plant coordinates and no embedded data', () => {
  const doc = sample(), pcf = exportPcf(doc), lines = pcf.trimEnd().split('\n');
  assert.ok(lines.every(l => l.length <= 200), 'no long lines');
  // No embedded drawing data: the user attributes carry the drawing number and title as they are lettered, and the
  // specification's weld gaps in a form that names itself.
  assert.ok(!/ATTRIBUTE9[4-9]|BIDWRIGHT|SPOOLYARD-/.test(pcf));
  assert.ok(lines.includes(`    ATTRIBUTE90 ${doc.drawing}`) && lines.includes(`    ATTRIBUTE92 ROOT-GAP ${doc.specs[0].rootGap} MM`));
  // Bores in the drawing's size notation (NPS, the default, on this metric drawing), coordinates in its units.
  for (const header of ['UNITS-BORE INCH', 'UNITS-CO-ORDS MM', 'UNITS-BOLT-DIA MM', 'UNITS-BOLT-LENGTH MM', 'UNITS-WEIGHT KGS'])
    assert.ok(lines.includes(header), header);
  assert.match(exportPcf({ ...doc, profile: { ...doc.profile, sizeNotation: 'DN' } }), /^UNITS-BORE MM$/m);
  // Each pipeline once, with its project and revision.
  assert.deepEqual(lines.filter(l => l.startsWith('PIPELINE-REFERENCE')), ['PIPELINE-REFERENCE L-1', 'PIPELINE-REFERENCE L-2']);
  assert.equal(lines.filter(l => l === '    REVISION C').length, 2);
  assert.equal(lines.filter(l => l === '    PROJECT-IDENTIFIER DEMO').length, 2);
  // A flanged valve's ports are flanged; its symbol key says gate valve, flanged.
  const valve = block(pcf, 'VALVE')[0];
  assert.match(valve, /SKEY VTFL/);
  assert.equal(valve.match(/END-POINT .* 2 FL$/gm)?.length, 2);
  // The field elbow, with its ISOGEN erection category; the shop weld tag on its own WELD.
  assert.match(block(pcf, 'ELBOW')[0], /\n {4}CATEGORY ERECTION/);
  assert.match(block(pcf, 'ELBOW')[0], /\n {4}ANGLE 9000/);
  assert.ok(block(pcf, 'WELD').some(b => /WELD-IDENTIFIER W-7/.test(b) && /SKEY WW/.test(b)));
  // Plant coordinates: the model origin is added.
  assert.match(pcf, /END-POINT 100000\.0000 200000\.0000 3000\.0000 2 BW/);
  // No empty heat numbers, no invented item codes; catalogue part codes are the item codes.
  assert.ok(!/HEAT-NUMBER\s*$/m.test(pcf));
  assert.ok(!/ITEM-CODE BW-\d/.test(pcf));
  const partCodes = new Set(doc.specs[0].fittings.map(f => f.partCode).filter(Boolean));
  const codes = [...pcf.matchAll(/^ {4}ITEM-CODE (.+)$/gm)].map(m => m[1]);
  assert.ok(codes.length && codes.every(c => partCodes.has(c) || doc.specs[0].fittings.some(f => f.id === c)), codes.join());
  // Every material identifier refers to an entry of the MATERIALS section.
  const ids = new Set([...pcf.matchAll(/^MATERIAL-IDENTIFIER (\d+)$/gm)].map(m => m[1]));
  for (const m of pcf.matchAll(/^ {4}MATERIAL-IDENTIFIER (\d+)$/gm)) assert.ok(ids.has(m[1]));
  // Imperial drawings write inch bores and coordinates.
  doc.units = 'imperial';
  const imperial = exportPcf(doc);
  assert.match(imperial, /^UNITS-BORE INCH$/m);
  assert.match(imperial, /^UNITS-CO-ORDS INCH$/m);
  assert.match(imperial, /^UNITS-WEIGHT LBS$/m);
  assert.match(imperial, /END-POINT 3937\.0079 7874\.0157 118\.1102 2 BW/);
});

test('a PCF read back with its .piping sidecar is the same drawing; without it, the PCF stands alone', () => {
  const doc = sample(), { pcf, sidecar } = exportPcfPackage(doc);
  const { doc: restored, warnings } = importPcf(pcf, { sidecar });
  assert.deepEqual(warnings, []);
  assert.deepEqual(restored, parseIsoJson(JSON.stringify(doc)));
  // Alone, the PCF still gives the same pipe, joints as parts of their own, and its standard data.
  const alone = importPcf(pcf).doc;
  assert.equal(alone.runs.filter(r => !r.connector).length, doc.runs.length);
  assert.equal(alone.nodes.filter(n => n.kind === 'flange').length, 2);
  assert.equal(alone.nodes.find(n => n.kind === 'elbow90')!.field, true);
  assert.deepEqual(alone.nodes.find(n => n.kind === 'elbow90')!.position, [102000, 200000, 3000]);
  // The valve is the gate valve its symbol key names, bolted up with the PCF's own flanges, gaskets and bolts: its
  // ports supply none a second time.
  assert.equal(alone.nodes.find(n => n.kind === 'valve')!.component, 'GATE-FL');
  assert.ok(flangedJoints(alone).filter(j => j.kind === 'component-port').every(j => !j.flanges.some(f => f.implicit) && !j.supplied.gasket && !j.supplied.bolts));
});

test('a PCF edited after export keeps the sidecar drafting and says what differs', () => {
  const doc = sample(), { pcf, sidecar } = exportPcfPackage(doc);
  // Lengthen the SP-2 pipe in the PCF.
  const edited = pcf.replace('END-POINT 100000.0000 200000.0000 5000.0000 2 BW', 'END-POINT 100000.0000 200000.0000 5300.0000 2 BW');
  assert.notEqual(edited, pcf);
  const { doc: restored, warnings } = importPcf(edited, { sidecar });
  assert.match(warnings.join(' '), /not in the \.piping sidecar|differ from the \.piping sidecar/);
  const pipe = restored.runs.find(r => r.spool === 'SP-2')!;
  assert.ok(Math.abs(runResult(restored, pipe).overall - 1800) < 1e-6);
  assert.equal(pipe.line, 'L-2');
});

test('PCFs from other programs import with their components, symbols, item codes and warnings', () => {
  const { doc, warnings } = importPcf(IMPERIAL_PCF);
  assert.equal(doc.units, 'imperial');
  assert.equal(doc.revision, 'B');
  assert.equal(doc.project, 'DEMO-PLANT');
  assert.match(warnings.join(' '), /MESSAGE-SQUARE/);
  assert.match(warnings.join(' '), /ISO-SPLIT-POINT/);
  const pipes = doc.runs.filter(r => !r.connector);
  assert.equal(pipes.length, 6);
  const count = (kind: string) => doc.nodes.filter(n => n.kind === kind).length;
  assert.deepEqual(['flange', 'gasket', 'bolt', 'valve', 'elbow90', 'tee', 'reducer', 'cap', 'olet', 'support'].map(count), [2, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const first = pipes.find(r => getNode(doc, r.from).position[0] < 100)!;
  assert.ok(Math.abs(runResult(doc, first).cut - 36.5 * 25.4) < 1e-6);
  // The site weld at the elbow, the field valve.
  assert.equal(first.toField, true);
  assert.equal(doc.nodes.find(n => n.kind === 'valve')!.field, true);
  // Symbol keys name the component where one Spoolyard component matches.
  const olet = doc.nodes.find(n => n.kind === 'olet')!, reducer = doc.nodes.find(n => n.kind === 'reducer')!;
  assert.equal(olet.component, 'SOL');
  assert.equal(olet.associatedRunId, first.id);
  assert.equal(doc.nodes.find(n => n.kind === 'support')!.associatedRunId, first.id);
  assert.equal(reducer.component, 'E-RED');
  assert.equal(reducer.flatSide, 'bottom');
  assert.equal(doc.nodes.find(n => n.kind === 'cap')!.component, 'W-CAP');
  assert.equal(doc.nodes.find(n => n.kind === 'bolt')!.quantity, 4);
  const elbow = doc.nodes.find(n => n.kind === 'elbow90')!;
  assert.ok(Math.abs(elbow.weightKg! - 7.5 * 0.45359237) < 1e-9);
  assert.equal(elbow.description, '90 DEG LR ELBOW, BW, A234 WPB');
  const tee = doc.nodes.find(n => n.kind === 'tee')!, branch = doc.runs.find(r => r.id === tee.branchEdgeId)!;
  assert.ok(getNode(doc, branch.from === tee.id ? branch.to : branch.from).position[0] > tee.position[0]);
  // Item codes are kept: they become rows of the imported specification and are written back.
  const valve = doc.nodes.find(n => n.kind === 'valve')!;
  assert.equal(doc.specs.flatMap(s => s.fittings).find(f => f.id === valve.catalogId)!.partCode, 'GATE-3-150');
  assert.ok(bom(doc).some(r => r.description.includes('GATE VALVE')));
  const back = exportPcf(doc);
  assert.match(back, /ITEM-CODE GATE-3-150/);
  assert.match(back, /ITEM-CODE FLG-WN-3-150/);
});

test('metric PCFs: DN bores beyond DN 600, CATEGORY ERECTION, screwed ends, and a connection tolerance', () => {
  const { doc, warnings } = importPcf(METRIC_PCF);
  assert.equal(doc.units, 'mm');
  assert.match(warnings.join(' '), /generic parts: FROBNICATOR/);
  assert.match(warnings.join(' '), /TEXT/);
  const bend = doc.nodes.find(n => n.component === 'PIPEBEND')!;
  assert.equal(bend.bendRadius, 1125);
  assert.equal(doc.runs.find(r => r.line === '750-CW-001')!.nps, 30);
  // Ends 0.3 mm apart are one connection at the default 0.5 mm tolerance.
  assert.equal(doc.runs.filter(r => r.from === bend.id || r.to === bend.id).length, 2);
  const tight = importPcf(METRIC_PCF, { tolerance: 0.1 }).doc, tightBend = tight.nodes.find(n => n.component === 'PIPEBEND')!;
  assert.equal(tight.runs.filter(r => r.from === tightBend.id || r.to === tightBend.id).length, 0);
  // Small bore: screwed fittings resolved from their symbol keys.
  const code = (c: string) => doc.nodes.find(n => n.component === c);
  assert.ok(code('F-CPLGSC') && code('ANGL-SC') && code('HOSE-SC'));
  assert.equal(code('UNION-SC')!.field, true);
  assert.equal(doc.nodes.find(n => n.description === 'FLOW ELEMENT FE-101')!.field, true);
  const small = doc.runs.filter(r => r.line === '25-IA-200' && !r.connector);
  assert.ok(small.every(r => r.nps === 1));
  assert.ok(small.slice(0, -1).every(r => r.fromPrep === 'THD' && r.toPrep === 'THD'));
  assert.equal(small.at(-1)!.toPrep, 'PLAIN');
  assert.deepEqual([...new Set(doc.runs.map(r => r.specId))].sort(), ['A1', 'B2']);
});

test('PCF units in sixteenths, and a bore with no standard DN', () => {
  const pcf = (bore: string, unit: string) => `UNITS-BORE ${unit}\nUNITS-CO-ORDS MM\nPIPE\n    END-POINT 0 0 0 ${bore} BW\n    END-POINT 1000 0 0 ${bore} BW\n`;
  assert.equal(importPcf(pcf('32', 'INCH-SIXTEENTH')).doc.runs[0].nps, 2);
  const odd = importPcf(pcf('630', 'MM'));
  assert.match(odd.warnings.join(), /DN 630 is not a standard size/);
  assert.match(exportPcf(odd.doc), /END-POINT 0\.0000 0\.0000 0\.0000 630 BW/);
});

test('PCFs written by earlier Spoolyard releases are still read, and damaged attributes only warn', () => {
  const legacy = (drawing: string) => [
    'UNITS-BORE INCH', 'UNITS-CO-ORDS MM', 'PIPELINE-REFERENCE ISO-9', '    ATTRIBUTE99 BIDWRIGHT-ROOT-GAP 3',
    `    ATTRIBUTE95 SPOOLYARD-DRAWING ${drawing}`,
    'PIPELINE-REFERENCE ISO-9', 'PIPE', '    END-POINT 0 0 0 2 BW', '    END-POINT 1000 0 0 2 BW',
    `    ATTRIBUTE97 BIDWRIGHT-PIPE ${encodeURIComponent(JSON.stringify({ rootGap: 5 }))}`, ''
  ].join('\n');
  const { doc, warnings } = importPcf(legacy(encodeURIComponent(JSON.stringify({ title: 'Legacy line', weldPrefix: 'FW' }))));
  assert.equal(doc.title, 'Legacy line');
  assert.equal(doc.weldPrefix, 'FW');
  assert.equal(doc.runs[0].rootGap, 5);
  assert.equal(doc.specs[0].rootGap, 3);
  assert.deepEqual(warnings, []);
  const damaged = importPcf(legacy('%E0%A4%A'));
  assert.match(damaged.warnings.join(), /Ignored unreadable drawing data in ATTRIBUTE95/);
  assert.equal(damaged.doc.runs.length, 1);
});

test('PCF errors name the record and line they are about', () => {
  assert.throws(() => importPcf('UNITS-CO-ORDS MM\nPIPE\n'), /UNITS-BORE/);
  assert.throws(() => importPcf('UNITS-BORE INCH\nUNITS-CO-ORDS MM\nPIPE\n    END-POINT 0 0 x 2\n    END-POINT 1 0 0 2\n'), /PIPE at line 3/);
  assert.throws(() => importPcf('UNITS-BORE INCH\nUNITS-CO-ORDS MM\nPIPE\n    END-POINT 0 0 0 2\n'), /PIPE at line 3 needs two END-POINTs/);
  assert.throws(() => importPcf('UNITS-BORE INCH\nUNITS-CO-ORDS MM\nPIPE\n    END-POINT 0 0 0 2\n    END-POINT 1 0 0 2\n', { sidecar: '{' }), /sidecar could not be read/);
});

test('imported text files are decoded by their byte-order mark, else as UTF-8, else as Windows-1252', () => {
  const latin = new Uint8Array([0x44, 0x45, 0x53, 0x43, 0x20, 0xb0, 0x20, 0x4e, 0xc9]);
  assert.deepEqual(decodeText(latin), { text: 'DESC ° NÉ', encoding: 'windows-1252' });
  assert.deepEqual(decodeText(new TextEncoder().encode('Ø 50 · é')), { text: 'Ø 50 · é', encoding: 'utf-8' });
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])).text, 'A');
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00])).text, 'A');
});

test('a 180° return is one PCF elbow, and an eccentric reducer writes its flat side and small-end offset', async () => {
  const { applyComponent, setFlatSide } = await import('../src/core/model.ts');
  const doc = newIso(), inch = (v: number) => v * 25.4;
  const a = appendRun(doc, null, [1000, 0, 0], 'CS40', 4, 'S', 'L');
  const b = appendRun(doc, a.id, [0, inch(12), 0], 'CS40', 4, 'S', 'L');
  const red = appendRun(doc, b.id, [-1000, 0, 0], 'CS40', 4, 'S', 'L');
  for (const n of [a, b]) applyComponent(doc, n, 'LR180R');
  doc.runs[1].connector = true;
  appendRun(doc, red.id, [-1000, 0, 0], 'CS40', 3, 'S', 'L');
  applyComponent(doc, red, 'E-RED');
  setFlatSide(doc, red.id, 'top');
  const { pcf, sidecar } = exportPcfPackage(doc), e = (114.3 - 88.9) / 2;
  const elbows = block(pcf, 'ELBOW');
  assert.equal(elbows.length, 1);
  assert.match(elbows[0], /ANGLE 18000/);
  assert.match(elbows[0], /SKEY EUBW/);
  const reducer = block(pcf, 'REDUCER-ECCENTRIC')[0];
  assert.match(reducer, /FLAT-DIRECTION UP/);
  assert.match(reducer, new RegExp(`END-POINT [-\\d.]+ ${inch(12).toFixed(4)} ${e.toFixed(4)} 3 BW`));
  // With the sidecar: the return's halves and body, exactly.
  assert.deepEqual(importPcf(pcf, { sidecar }).doc, parseIsoJson(JSON.stringify(doc)));
  // Alone: the return's two halves rebuilt from its ends (long radius: R = 1.5 D), and the reducer on its large
  // end's axis with the flat its offset shows.
  const alone = importPcf(pcf).doc, halves = alone.nodes.filter(n => n.kind === 'elbow90');
  assert.deepEqual(halves.map(n => n.component), ['LR180R', 'LR180R']);
  assert.deepEqual(halves.map(n => n.position.map(v => Math.round(v * 1000) / 1000)), [a, b].map(n => n.position.map(v => Math.round(v * 1000) / 1000)));
  assert.equal(alone.runs.filter(r => r.connector).length, 1);
  const back = alone.nodes.find(n => n.kind === 'reducer')!;
  assert.deepEqual([back.component, back.flatSide], ['E-RED', 'top']);
  assert.ok(Math.abs(back.position[2]) < 1e-6);
  const small = (d: typeof doc) => d.runs.find(r => r.nps === 3)!;
  // A PCF pipe runs weld to weld: its length is the cut and the root gaps, which Spoolyard's PCF states in the
  // pipeline header (ATTRIBUTE92 ROOT-GAP), so the cut comes back; a PCF that does not state it is cut to its length.
  const original = runResult(doc, small(doc));
  assert.ok(Math.abs(runResult(alone, small(alone)).cut - original.cut) < 1e-3);
  const unstated = importPcf(pcf.replace(/^ {4}ATTRIBUTE92 .*\n/gm, '')).doc;
  assert.ok(Math.abs(runResult(unstated, small(unstated)).cut - (original.cut + original.gaps[0] + original.gaps[1])) < 1e-3);
});

test('the bundled sample drawing writes a spec-clean PCF that reads back exactly with its sidecar', () => {
  const doc = parseIsoJson(readFileSync(new URL('../public/samples/cooling-water-return.piping', import.meta.url), 'utf8'));
  const { pcf, sidecar } = exportPcfPackage(doc);
  assert.ok(pcf.split('\n').every(l => l.length <= 200));
  const back = importPcf(pcf, { sidecar });
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(back.doc, doc);
  assert.equal(importPcf(pcf).doc.runs.filter(r => !r.connector).length, doc.runs.filter(r => !r.connector).length);
});
