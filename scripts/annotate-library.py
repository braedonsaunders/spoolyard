#!/usr/bin/env python3
"""Reproducible clean-up of the bundled library specifications (public/library/specs/*.json).

The generator that first built them (scripts/build-piping-library.py) is not in this repository, so this script makes
the later corrections in place. It is idempotent (a second run changes nothing) and keeps the files' compact JSON
format byte for byte apart from its edits.

    python3 -I scripts/annotate-library.py          rewrite the files
    python3 -I scripts/annotate-library.py --check  exit 1 if any file would change

1. Provenance. Every row was labelled "ASME B16 standard dimensions" whatever it held, and rows with no takeout
   carried takeout 0 under that label. Each row is labelled as its library specification's row; a row without a
   takeout says the takeout is missing (the schema keeps `takeout: 0` beside `takeoutMissing: true`).
2. Import mapping. Butterfly body type, API 609 category and valve pattern are written only in the descriptions; they
   are set as the typed fields the dimension lookups read (`bodyType`, `valveCategory`, `valvePattern`).
3. Pipe sizes. Each size's wall is the published ASME B36.10M / B36.19M nominal wall of its schedule (taken from
   src/core/standards.ts through scripts/pipe-dimensions.ts, so there is one table), and its mass per metre is the
   plain-end mass of that OD and wall at the specification's density, pi (D - t) t rho (the B36.10M formula; B36.10M's
   0.0246615 (D - t) t is the same at 7850 kg/m3). Rows had walls back-calculated from weights, weights copied from
   another size or schedule (stainless 14-20" Sch 10S carried Sch 10 weights, 3/4" Sch 160 a 1 1/4" weight), and
   stainless rows carried carbon-steel weights (2 % light at 8000 kg/m3). Masses within 0.5 % are kept. ODs are left as published in millimetres (within 0.5 mm of NPS x 25.4).
4. Material family. A row welded into the line is of its specification's material family (carbon or stainless
   steel, by its pipe's material). The stainless specifications' C-SWG and E-SWG swage rows were copied from a carbon
   steel one (A234 GR. WPB): they take the material of the specification's own swages (C-SWAGE, E-SWAGE), else of its
   wrought reducers. Every other row of the wrong family is reported, not changed: carbon steel supports on stainless
   pipe are usual (welded ones go on a pad of the pipe's material), and the specification decides.
5. Material wording. A row whose material is written "ASTM A234 GR. WPB" in a specification that otherwise writes
   "A234 GR. WPB" (spec A's concentric reducers) is written as the specification's dominant form, and the other way
   round, so one material reads one way on a sheet.
6. Eccentric offsets. An eccentric reducer moves the small pipe's centreline (D - d)/2 off the large end's, D and d
   the outside diameters (the specification's pipe ODs, else ASME B36.10M's). The rows carried (ID - id)/2, the
   offset of the bores of standard-weight pipe (12.17 mm for 4" x 3" instead of 12.7 mm); each is set to (D - d)/2,
   rounded to 0.01 mm. test/piping-library.test.ts checks every row against it within 0.05 mm.
"""
import subprocess
import json
import math
import pathlib
import re
import sys

SPECS = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'library' / 'specs'
OLD = 'ASME B16 standard dimensions'


def relabel(spec_id, row):
    source = row.get('source', '')
    if source.startswith('Library specification'):
        return
    rest = re.sub(r'^;\s*', '', source[len(OLD):]) if source.startswith(OLD) else source
    head = (f'Library specification {spec_id}: no takeout given (missing; enter it, or the built-in standard is used where one exists)'
            if row.get('takeoutMissing') else f'Library specification {spec_id}')
    row['source'] = f'{head}; {rest}' if rest else head


def typed(row):
    text = row.get('description', '').upper()
    code = row.get('component')
    if code == 'BFLY':
        body = 'wafer' if 'WAFER' in text else 'lug' if 'LUG' in text else 'double-flanged' if 'FLANGED' in text else None
        category = re.search(r'CATEGORY\s+([AB])\b', text)
        if body:
            row['bodyType'] = body
        if category:
            row['valveCategory'] = category.group(1)
    elif code == 'PLUG-FL':
        pattern = ('regular' if re.search(r'REGULAR PATTERN|REG PAT', text) else 'short' if 'SHORT PAT' in text
                   else 'venturi' if 'VENTURI' in text else None)
        if pattern:
            row['valvePattern'] = pattern
    elif code == 'BALL-FL':
        pattern = 'long' if 'LONG PAT' in text else 'short' if 'SHORT PAT' in text else None
        if pattern:
            row['valvePattern'] = pattern


STAINLESS = re.compile(r'A403|A182[- ]?F?3\d\d|A312|A351|CF8|CF3|\b30[48]L?\b|\b316L?\b|A240|A479|A213|A269|A358|A774|A778|\bSS\b|STAINLESS', re.I)
CARBON = re.compile(r'A234|\bWPB\b|A105|A106|A216|\bWCB\b|\bA53\b|A350|\bLF2\b|A420|WPL6|A333|A181|A197|MALLEABLE|CARBON|A707|\bCS\b', re.I)
# Rows not welded into the line, whose material need not be the pipe's.
UNWELDED = {'gasket', 'bolt', 'support', 'annotation'}


def family(text):
    """'stainless' or 'carbon' for a material named in one family only, else None."""
    text = re.sub(r'\bA\s+(?=\d)', 'A', text or '')  # "A 106 Grade B" is A106
    ss, cs = bool(STAINLESS.search(text)), bool(CARBON.search(text))
    return 'stainless' if ss and not cs else 'carbon' if cs and not ss else None


def spec_family(spec):
    families = {family(z.get('material') or spec.get('material')) for z in spec['sizes']} - {None}
    return families.pop() if len(families) == 1 else family(spec.get('material'))


def material_family(spec):
    """Fix the copied carbon-steel swages of a stainless specification; return the other mismatched rows."""
    own = spec_family(spec)
    if own is None:
        return []
    def material_of(codes):
        found = [r['material'] for r in spec['fittings'] if r.get('component') in codes and family(r.get('material')) == own]
        return max(set(found), key=found.count) if found else None
    swage = material_of({'C-SWAGE', 'E-SWAGE'}) or material_of({'C-RED', 'E-RED'})
    flagged = []
    for row in spec['fittings']:
        if family(row.get('material')) in (None, own):
            continue
        if own == 'stainless' and row.get('component') in ('C-SWG', 'E-SWG') and swage:
            row['material'] = swage
        elif row.get('kind') not in UNWELDED:
            flagged.append(row)
    return flagged


def published_walls(specs):
    """Published walls for every (nps, schedule) the specifications use, from the one table in standards.ts."""
    pairs = {(z['nps'], z.get('schedule') or s['schedule']) for s in specs for z in s['sizes']}
    # Outside diameters of both ends of every eccentric reducer (the OD does not depend on the schedule).
    pairs |= {(n, 'STD') for s in specs for r in s['fittings'] if 'eccentricOffset' in r for n in (r['nps'], r.get('smallerNps')) if n}
    pairs = sorted(pairs)
    out = subprocess.run(['pnpm', 'exec', 'tsx', str(SPECS.parent.parent.parent / 'scripts' / 'pipe-dimensions.ts')],
                         input=json.dumps(pairs), capture_output=True, text=True, check=True).stdout
    return {(o['nps'], o['schedule']): o for o in json.loads(out)}


def pipe_size(spec, size, published):
    p = published[(size['nps'], size.get('schedule') or spec['schedule'])]
    if p['wall'] is None or p['od'] is None:
        raise SystemExit(f"{spec['id']} NPS {size['nps']} {size.get('schedule')}: no published wall to check against")
    if abs(size['od'] - p['od']) > 0.5:
        raise SystemExit(f"{spec['id']} NPS {size['nps']}: OD {size['od']} is not the B36.10M {p['od']} mm")
    if abs(size['wall'] - p['wall']) > 0.005:
        size['wall'] = p['wall']
    # Published masses are rounded: a mass within 0.5 % of the plain-end mass is left as it is.
    mass = round(math.pi * (size['od'] - size['wall']) * size['wall'] * spec['density'] / 1e6, 3)
    if abs(size['kgM'] - mass) > 0.005 * mass:
        size['kgM'] = mass


def material_wording(spec):
    """Write a material named with and without its "ASTM " prefix the way the specification mostly writes it."""
    rows = spec['fittings'] + spec['sizes'] + spec.get('nipples', [])
    counts = {}
    for row in rows:
        if row.get('material'):
            counts[row['material']] = counts.get(row['material'], 0) + 1
    for row in rows:
        material = row.get('material')
        if not material:
            continue
        other = material[5:] if material.startswith('ASTM ') else 'ASTM ' + material
        if counts.get(other, 0) > counts[material]:
            row['material'] = other


def eccentric_offsets(spec, published):
    """Set each eccentric reducer's offset to (D - d)/2 from its two outside diameters."""
    def od(nps):
        own = next((z['od'] for z in spec['sizes'] if z['nps'] == nps), None)
        return own if own is not None else published[(nps, 'STD')]['od']
    for row in spec['fittings']:
        if 'eccentricOffset' not in row or not row.get('smallerNps'):
            continue
        large, small = od(row['nps']), od(row['smallerNps'])
        if large is None or small is None:
            raise SystemExit(f"{spec['id']} {row['id']}: no outside diameter to set its eccentric offset from")
        offset = round((large - small) / 2, 2)
        if abs(row['eccentricOffset'] - offset) > 0.005:
            row['eccentricOffset'] = offset


def main():
    check = '--check' in sys.argv
    changed = []
    paths = sorted(SPECS.glob('*.json'))
    published = published_walls([json.loads(p.read_text()) for p in paths])
    for path in paths:
        before = path.read_text()
        spec = json.loads(before)
        for row in spec['fittings'] + spec.get('nipples', []):
            relabel(spec['id'], row)
            typed(row)
        for size in spec['sizes']:
            pipe_size(spec, size, published)
        material_wording(spec)
        eccentric_offsets(spec, published)
        for row in material_family(spec):
            print(f"{spec['id']} {row['id']}: {row.get('material')} is not {spec_family(spec)} steel; check it", file=sys.stderr)
        after = json.dumps(spec, separators=(',', ':'))
        if after != before:
            changed.append(path.name)
            if not check:
                path.write_text(after)
    if check:
        print('\n'.join(f'{name} would change' for name in changed) or 'library specifications are annotated')
        sys.exit(1 if changed else 0)
    print(f'{len(changed)} library specification file(s) rewritten')


if __name__ == '__main__':
    main()
