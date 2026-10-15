import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bolting, flange, gasketThickness, pipeWall, ratingClass, standardRow, type StandardRow } from '../src/core/standards.ts';

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
  { key: /^a\/BALL-FL\/(takeout|faceToFace)$/, nps: [8, 10, 12], reason: 'spec A uses the B16.10 long pattern at NPS 8-12 while spec B uses the short pattern; BALL-FL is the short (gate-length) pattern wherever B16.10 lists one, BALL-FL-LONG gives the long pattern' },
  { key: /\/W-R?CRS\/(takeout|branchTakeout)$/, nps: [6], reason: 'library NPS 6 cross C = 5-7/8 in; B16.9 crosses share the tee C = 5-5/8 in' },
  { key: /^[bc]\/W-CRS\/branchTakeout$/, nps: [18], reason: 'library branch C 13 in contradicts its own run C 13-1/2 in; B16.9 straight cross C = 13-1/2 in' },
  { key: /^[abc]\/SW-45ELL\/takeout$/, nps: [1.5], reason: 'B16.11 Class 3000 45° elbow NPS 1-1/2 is 21 mm to the socket bottom; the library row derives 18.25 from an inconsistent socket depth' },
  { key: /^[abc]\/SW-45ELL\/socketDepth$/, reason: 'library 45° socket depths are shallower than its own 90° elbows and tees of the same size; one forged socket depth is used for every fitting' },
  { key: /^d1\/SW-(90ELL|45ELL|TEE|CRS|RTEE|RCRS)\/(takeout|branchTakeout|socketDepth)$/, reason: 'spec D1 Class 6000 rows reuse the Class 3000 centre-to-socket-bottom and back-calculate deeper sockets; B16.11 Class 6000 dimensions are one size larger' },
  { key: /\/SC-45ELL\/takeout$/, reason: 'library threaded 45° elbows carry the B16.11 Class 2000 centre-to-end; Class 3000 and 6000 are larger' },
  { key: /\/SC-R?CRS\/(takeout|branchTakeout)$/, reason: 'library threaded crosses are shorter than its own tees; B16.11 crosses share the tee centre-to-end' },
  { key: /\/[FH]-CPLGSC\/(takeout|faceToFace)$/, reason: 'library threaded couplings reuse the socket-weld coupling length; B16.11 threaded coupling length W (48 mm at NPS 1/2) gives a longer effective takeout' },
  { key: /^d1\/CHECK-FL\/(takeout|faceToFace)$/, reason: 'spec D1 lists manufacturer check-valve lengths (its duplicate rows disagree with each other); B16.10 Class 900 check valves take the gate length' }
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
