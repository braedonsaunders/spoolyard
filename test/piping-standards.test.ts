import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bolting, flange, gasketThickness, pipeWall, ratingClass, standardRow, stubEnd, type StandardRow } from '../src/core/standards.ts';
import { COMPONENT_TYPE_BY_CODE } from '../src/core/components.ts';

const dir = new URL('../public/library/specs/', import.meta.url);
const load = (slug: string) => JSON.parse(readFileSync(new URL(slug + '.json', dir), 'utf8'));
const inch = (mm: number | undefined) => mm == null ? undefined : Math.round(mm / 25.4 * 16) / 16;
const near = (actual: number | undefined, expected: number, tol = 0.02) => assert.ok(actual != null && Math.abs(actual - expected) <= tol, `${actual} ≉ ${expected}`);
const FIELDS = ['takeout', 'branchTakeout', 'faceToFace', 'flangeThickness', 'lengthThroughHub', 'thickness', 'boltCount', 'boltDiameter', 'boltLength', 'socketDepth', 'threadEngagement'] as const;

/**
 * Deliberate disagreements with the carbon-steel library specs, each with the reason the standard value is kept.
 * Keys match `${spec}/${component}/${field}`; `nps` limits the exception to those sizes (all sizes when omitted).
 */
const DELIBERATE: Array<{ key: RegExp; nps?: number[]; reason: string }> = [
  { key: /^[ab]\/BALL-FL\/(takeout|faceToFace)$/, nps: [6, 10, 12], reason: 'specs A (NPS 6) and B (NPS 10-12) use the short pattern where the other library specs use the long one; BALL-FL is the B16.10 long pattern, BALL-FL-SHORT gives the short (gate-length) pattern' },
  { key: /\/W-R?CRS\/(takeout|branchTakeout)$/, nps: [6], reason: 'library NPS 6 cross C = 5-7/8 in; B16.9 crosses share the tee C = 5-5/8 in' },
  { key: /^[bc]\/W-CRS\/branchTakeout$/, nps: [18], reason: 'library branch C 13 in contradicts its own run C 13-1/2 in; B16.9 straight cross C = 13-1/2 in' },
  { key: /^[abc]\/SW-45ELL\/takeout$/, nps: [1.5], reason: 'B16.11 Class 3000 45° elbow NPS 1-1/2 is 21 mm to the socket bottom; the library row derives 18.25 from an inconsistent socket depth' },
  { key: /^[abc]\/SW-45ELL\/socketDepth$/, reason: 'library 45° socket depths are shallower than its own 90° elbows and tees of the same size; one forged socket depth is used for every fitting' },
  { key: /^d1\/SW-(90ELL|45ELL|TEE|CRS|RTEE|RCRS)\/(takeout|branchTakeout|socketDepth)$/, reason: 'spec D1 Class 6000 rows reuse the Class 3000 centre-to-socket-bottom and back-calculate deeper sockets; B16.11 Class 6000 dimensions are one size larger' },
  { key: /\/SC-45ELL\/takeout$/, reason: 'library threaded 45° elbows carry the B16.11 Class 2000 centre-to-end; Class 3000 and 6000 are larger' },
  { key: /\/SC-R?CRS\/(takeout|branchTakeout)$/, reason: 'library threaded crosses are shorter than its own tees; B16.11 crosses share the tee centre-to-end' },
  { key: /\/[FH]-CPLGSC\/(takeout|faceToFace)$/, reason: 'library threaded couplings reuse the socket-weld coupling length; B16.11 threaded coupling length W (48 mm at NPS 1/2) gives a longer effective takeout' },
  { key: /^d1\/CHECK-FL\/(takeout|faceToFace)$/, reason: 'spec D1 lists manufacturer check-valve lengths (its duplicate rows disagree with each other); B16.10 Class 900 check valves take the gate length' },
  { key: /^d1\/WOL\/takeout$/, nps: [6, 8, 10, 12], reason: 'spec D1 lists standard-weight weldolets on its Schedule 80 branches; an extra-strong weldolet suits a wall heavier than standard' }
];

test('rating classes parse from every spec spelling', () => {
  for (const [text, cls] of [['150#', 150], ['150 LB', 150], ['CL150', 150], ['Class 150', 150], ['150', 150], ['3000#', 3000], ['3000 LB', 3000], ['CLASS 600 RF', 600], ['#300', 300]] as const)
    assert.equal(ratingClass(text), cls, text);
  assert.equal(ratingClass('Project specified'), undefined);
  assert.equal(ratingClass(undefined), undefined);
  assert.equal(ratingClass(900), 900);
});

test('production reference bolting anchors', () => {
  const b = (nps: number, makeup: Parameters<typeof bolting>[3], opts?: Parameters<typeof bolting>[4]) => {
    const r = bolting(nps, '150#', makeup === 'flange-pair' ? 'RF' : 'FF', makeup, opts)!;
    return [r.count, inch(r.diameter), inch(r.length), r.kind];
  };
  assert.deepEqual(b(2, 'flange-pair'), [4, 0.625, 3.25, 'stud']);
  assert.deepEqual(b(3, 'flange-pair'), [4, 0.625, 3.5, 'stud']);
  assert.deepEqual(b(2, 'lj-pair'), [4, 0.625, 3.25, 'stud']);
  // Production set: Sch 10S stub-end laps with 1/16 in PTFE gaskets keep NPS 3 LJ pairs at 3-1/2 in.
  assert.deepEqual(b(3, 'lj-pair', { lap: pipeWall(3, '10S'), gasket: gasketThickness('sheet-1/16') }), [4, 0.625, 3.5, 'stud']);
  assert.deepEqual(b(2, 'lug-valve-side'), [4, 0.625, 2.75, 'lug']);
  assert.deepEqual(b(3, 'lug-valve-side'), [4, 0.625, 3.25, 'lug']);
  assert.equal(bolting(2, '150#', 'RF', 'wafer-valve')!.count, 4);
  assert.ok(bolting(2, '150#', 'RF', 'wafer-valve')!.length > bolting(2, '150#', 'RF', 'flange-pair')!.length);
  assert.equal(bolting(2, '600#', 'FF', 'flange-pair'), undefined);
  assert.equal(bolting(2, '2500#', 'RF', 'flange-pair'), undefined);
  assert.equal(bolting(2, 'Project specified', 'RF', 'flange-pair')!.length, 82.55, 'no class in the spec means Class 150');
});

test('lug bolts are shorter than a flange-pair stud yet engage the lug by at least one diameter; wafer studs span the valve', () => {
  for (const cls of [150, 300]) for (const nps of [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24]) {
    const lug = bolting(nps, cls, 'RF', 'lug-valve-side'), wafer = bolting(nps, cls, 'RF', 'wafer-valve');
    const body = standardRow('BFLY-LUG', nps, cls)?.faceToFace, f = flange(nps, cls)!, pair = bolting(nps, cls, 'RF', 'flange-pair')!;
    if (!body) { assert.equal(lug, undefined); continue; }
    assert.ok(lug && wafer, `${cls}# NPS ${nps}`);
    assert.equal(lug.count, f.boltCount);
    assert.ok(lug.length <= pair.length, `${cls}# NPS ${nps}: lug ${lug.length} vs pair ${pair.length}`);
    assert.ok(lug.length - f.thickness - lug.diameter >= lug.diameter, `${cls}# NPS ${nps}: lug engagement`);
    assert.ok(wafer.length >= 2 * (f.thickness + wafer.diameter) + body, `${cls}# NPS ${nps}: wafer stud`);
  }
});

test('standard rows cover every class and the common codes, and unknown sizes stay undefined', () => {
  for (const cls of ['150#', '300#', '600#', '900#', '1500#']) {
    for (const code of ['FLG-RFWN', 'FLG-RFSO', 'FLG-RFBL', 'FLG-RFLJ', 'GASK-RF', 'BOLT-RF', 'GATE-FL', 'GLOBE-FL', 'CHECK-FL', 'BALL-FL', 'GATE-BW'])
      assert.ok(standardRow(code, 2, cls), `${code} ${cls}`);
    assert.ok(flange(24, cls), cls);
  }
  assert.equal(standardRow('FLG-RFWN', 3.5, '900#'), undefined);
  assert.equal(standardRow('FLG-RFWN', 22, '1500#'), undefined);
  assert.equal(standardRow('W-LR90EL', 7), undefined);
  assert.equal(standardRow('C-RED', 4), undefined, 'a reducer needs its small end');
  assert.equal(standardRow('C-RED', 24, undefined, 2), undefined, 'not a standard reducer pair');
  assert.equal(standardRow('NOT-A-CODE', 2), undefined);
  const lj = standardRow('FLG-RFLJ', 2, '150#')!;
  assert.equal(lj.takeout, 0);
  assert.equal(standardRow('STUB-END', 2)!.takeout, 152.4);
  assert.equal(standardRow('STUB-END-SHORT', 2)!.takeout, 63.5);
  assert.equal(standardRow('GASK-RF', 2, '150#')!.takeout, 1.65);
  assert.equal(standardRow('W-RTEE', 4, undefined, 2)!.branchTakeout, 88.9);
  assert.equal(standardRow('C-RED', 4, undefined, 2)!.faceToFace, 101.6);
  assert.equal(standardRow('C-RED', 4, undefined, 2)!.takeout, 50.8);
  assert.equal(standardRow('GATE-FL', 2, '150#')!.takeout, 88.9);
  assert.equal(standardRow('BFLY', 2, '150#')!.faceToFace, standardRow('BFLY-WAFER', 2, '150#')!.faceToFace);
  // Effective small-bore takeouts: socket bottom, or centre-to-end less thread engagement.
  near(standardRow('SW-90ELL', 1, '150#')!.takeout, 22.22);
  near(standardRow('SC-90ELL', 1, '3000#')!.takeout, 44 - 17.46);
  assert.equal(standardRow('SW-90ELL', 1, '900#')!.description, 'ELBOW 90 SW 6000#');
});

test('every standard component code resolves at NPS 2 Class 150 with the catalogue kind', () => {
  const codes: Array<[string, number?]> = [
    ['W-LR90EL'], ['W-SR90EL'], ['W-3D90EL'], ['W-45ELL'], ['W-3D45ELL'], ['LR180R'], ['SR180R'], ['REDELL', 1.5], ['W-TEE'], ['W-RTEE', 1.5],
    ['W-CRS'], ['W-RCRS', 1.5], ['W-LAT'], ['W-RLAT', 1.5], ['C-RED', 1.5], ['E-RED', 1.5], ['C-SWAGE', 1], ['E-SWAGE', 1], ['C-SWG', 1], ['E-SWG', 1], ['W-CAP'],
    ['SW-90ELL'], ['SW-45ELL'], ['SW-TEE'], ['SW-RTEE', 1], ['SW-CRS'], ['SW-RCRS', 1], ['SC-90ELL'], ['SC-45ELL'], ['SC-TEE'], ['SC-RTEE', 1],
    ['SC-CRS'], ['SC-RCRS', 1], ['SW-CAP'], ['SC-CAP'], ['PLUG'], ['UNION-SW'], ['UNION-SC'], ['F-CPLGSW'], ['F-CPLGSC'], ['H-CPLGSW'], ['H-CPLGSC'],
    ['FLG-RFWN'], ['FLG-FFWN'], ['FLG-RFSO'], ['FLG-RFSW'], ['FLG-FFSW'], ['FLG-RFSC'], ['FLG-FFSC'], ['FLG-RFBL'], ['FLG-RFLJ'], ['FLG-FFLJ'],
    ['GASK-RF'], ['GASK-FF'], ['BOLT-RF'], ['GATE-FL'], ['GATE-BW'], ['GLOBE-FL'], ['GLOBE-BW'], ['CHECK-FL'], ['BALL-FL'], ['BALL-FL-LONG'], ['BALL-FL-SHORT'],
    ['PLUG-FL'], ['BFLY'], ['BFLY-LUG'], ['BFLY-WAFER'], ['STUB-END'], ['STUB-END-SHORT']
  ];
  for (const [code, small] of codes) {
    const row = standardRow(code, 2, '150#', small);
    assert.ok(row && Number.isFinite(row.takeout) && row.takeout >= 0 && row.source, code);
    const type = COMPONENT_TYPE_BY_CODE[code];
    if (type) assert.equal(row.kind, type.kind, code);
    if (small) assert.equal(row.smallerNps, small, code);
  }
});

test('B16.5 tables are self-consistent: published stud lengths follow the B16.5 bolt-length method and bolts fit the flange', () => {
  for (const cls of [150, 300, 600, 900, 1500]) for (const nps of [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]) {
    const f = flange(nps, cls);
    if (!f) continue;
    const method = 2 * (f.thickness + 25.4 * (nps <= 18 ? 0.12 : 0.19) + f.boltDiameter) + 25.4 * 0.18;
    assert.ok(Math.abs(method - f.studLength) <= 25.4 * 0.375, `${cls}# NPS ${nps}: stud ${f.studLength} vs method ${method}`);
    assert.ok(f.boltCircle + f.boltDiameter < f.od && f.boltCircle > 0, `${cls}# NPS ${nps}: bolt circle`);
    assert.ok(f.wnLength > f.thickness && (f.soLength ?? Infinity) > f.thickness - f.raisedFace, `${cls}# NPS ${nps}: hub lengths`);
    assert.equal(f.raisedFace, cls <= 300 ? 1.59 : 6.35);
  }
  const f = flange(2, 'CL150')!;
  assert.deepEqual([f.od, f.thickness, f.boltCircle, f.boltCount, f.boltDiameter, f.studLength, f.machineBoltLength, f.wnLength, f.soLength, f.ljThickness, f.socketDepth],
    [152.4, 19.05, 120.65, 4, 15.88, 82.55, 69.85, 63.5, 25.4, 17.46, 17.46]);
  assert.equal(flange(4, 'Class 600')!.wnLength, 107.95, 'Class 600 hub length includes the 1/4 in raised face');
  assert.equal(flange(24, '1500 LB')!.od, 1168.4);
  assert.equal(flange(4, 1500)!.soLength, undefined, 'B16.5 has no Class 1500 slip-on above NPS 2-1/2');
});

test('valve, fitting and small-bore spot values', () => {
  const ff = (code: string, nps: number, rating?: string, small?: number) => standardRow(code, nps, rating, small)?.faceToFace;
  assert.equal(ff('GATE-FL', 2, '150#'), 177.8);
  assert.equal(ff('GLOBE-FL', 6, '300#'), 444.5);
  assert.equal(ff('CHECK-FL', 6, '150#'), 355.6);
  assert.equal(ff('GATE-FL', 10, '600#'), 787.4);
  assert.equal(ff('GATE-FL', 3, '900#'), 381);
  assert.equal(ff('GATE-FL', 4, '1500#'), 546.1);
  assert.equal(ff('GATE-BW', 2, '150#'), 215.9, 'B16.10 Class 150 welding-end gate valves are longer than the flanged ones');
  assert.equal(ff('BALL-FL', 6, '150#'), 393.7);
  assert.equal(ff('BALL-FL-SHORT', 6, '150#'), 266.7);
  assert.equal(ff('BFLY-WAFER', 2, '150#'), 43);
  assert.equal(standardRow('BFLY', 2, '150#')!.boltLength, bolting(2, '150#', 'RF', 'lug-valve-side')!.length);
  assert.equal(ff('C-RED', 24, undefined, 20), 508);
  assert.equal(standardRow('W-RTEE', 24, undefined, 20)!.branchTakeout, 431.8);
  assert.equal(standardRow('W-3D45ELL', 4)!.takeout, 127);
  assert.equal(standardRow('LR180R', 4)!.takeout, 152.4);
  assert.deepEqual(stubEnd(2, true), { length: 63.5, lapOd: 92.07, lapThickness: 2.77, short: true });
  assert.equal(stubEnd(2, false, 'XS')!.lapThickness, 5.54);
  assert.equal(pipeWall(2, 'SCH.80'), 5.54);
  assert.equal(pipeWall(12, 'SCH 40'), 10.31);
  assert.equal(pipeWall(2, 'STD.'), 3.91);
  assert.equal(pipeWall(2, '40/80'), undefined);
  near(standardRow('SW-90ELL', 0.5, '6000#')!.takeout, 19.05);
  near(standardRow('SC-90ELL', 0.5, '2000#')!.takeout, 28 - 12.7);
  near(standardRow('SW-RTEE', 1.5, '3000#', 0.75)!.branchTakeout!, 36.51);
  near(standardRow('UNION-SW', 0.5, '3000#')!.takeout, 17.46);
  near(standardRow('F-CPLGSW', 0.5, '3000#')!.takeout, 4.76);
  assert.equal(gasketThickness('sheet-1/16'), 1.59);
  assert.equal(standardRow('GASK-FF', 2, '600#'), undefined, 'no full-face flanges above Class 300');
});

test('standards agree with the carbon-steel library specs within 1 mm wherever both define a value', () => {
  const found = new Map<string, string[]>(), unexplained: string[] = [];
  let compared = 0;
  for (const slug of ['a', 'b', 'c', 'd1']) {
    const spec = load(slug);
    for (const f of spec.fittings) {
      if (f.takeoutMissing) continue;
      const schedule = spec.sizes.find((s: { nps: number }) => s.nps === f.nps)?.schedule;
      const std: StandardRow | undefined = standardRow(f.component, f.nps, f.rating ?? spec.rating, f.smallerNps, schedule);
      if (!std) continue;
      for (const field of FIELDS) {
        const a = f[field], b = std[field];
        if (a == null || b == null) continue;
        compared++;
        if (field === 'boltCount' ? a === b : Math.abs(a - b) <= 1) continue;
        const key = `${slug}/${f.component}/${field}`;
        const line = `${key} NPS ${f.nps}${f.smallerNps ? 'x' + f.smallerNps : ''}: library ${a}, standard ${b}`;
        const known = DELIBERATE.find(d => d.key.test(key) && (!d.nps || d.nps.includes(f.nps)));
        if (known) found.set(known.reason, [...found.get(known.reason) ?? [], line]);
        else unexplained.push(line);
      }
    }
  }
  for (const [reason, lines] of found) console.log(`deliberate (${lines.length}): ${reason}\n    e.g. ${lines[0]}`);
  assert.ok(compared > 1500, `compared ${compared} values`);
  assert.deepEqual(unexplained, []);
});
