import type { Kind } from './model'

/**
 * Original Spoolyard piping symbols in a local frame: x runs along the pipe through the
 * component centre, y is perpendicular (negative = "up" on the sheet). Roughly ±16 units.
 * The same strokes draw the catalogue glyphs, the editor sheet and every export.
 */
export type SymbolStroke =
  | { l: [number, number, number, number] }
  | { c: [number, number, number]; fill?: boolean }
  | { t: string; at: [number, number]; size?: number }

const L = (x1: number, y1: number, x2: number, y2: number): SymbolStroke => ({ l: [x1, y1, x2, y2] })
const C = (x: number, y: number, r: number, fill = false): SymbolStroke => ({ c: [x, y, r], fill })
const T = (t: string, x: number, y: number, size = 9): SymbolStroke => ({ t, at: [x, y], size })
const poly = (...p: number[]): SymbolStroke[] => {
  const out: SymbolStroke[] = []
  for (let i = 0; i + 3 < p.length; i += 2) out.push(L(p[i], p[i + 1], p[i + 2], p[i + 3]))
  return out
}
const box = (x: number, y: number, w: number, h: number) => poly(x, y, x + w, y, x + w, y + h, x, y + h, x, y)

const bowtie = () => [...poly(-12, -8, 12, 8, 12, -8, -12, 8, -12, -8)]
const endMarks = (code: string) =>
  /-SW$|SW-|-SC$|SC-/.test(code)
    ? [L(-15, -5, -15, 5), L(15, -5, 15, 5)]
    : /-FL$|BFLY/.test(code)
      ? [L(-14, -10, -14, 10), L(14, -10, 14, 10)]
      : []

function valve(code: string): SymbolStroke[] {
  const ends = endMarks(code)
  if (/^GLOBE/.test(code)) return [...bowtie(), C(0, 0, 3.5, true), L(0, 0, 0, -18), L(-7, -18, 7, -18), ...ends]
  if (/^BALL/.test(code)) return [...bowtie(), C(0, 0, 5), L(0, -5, 0, -18), L(-7, -18, 7, -18), ...ends]
  if (/^CHECK/.test(code)) return [...bowtie(), L(-12, 8, 12, -8), L(0, -12, 0, -4), L(-3, -8, 0, -4), ...ends]
  if (/^PLUG-/.test(code)) return [...bowtie(), ...box(-3, -3, 6, 6), L(0, -3, 0, -18), ...ends]
  if (/^NEEDL/.test(code)) return [...bowtie(), ...poly(-4, -18, 4, -18, 0, -8, -4, -18), ...ends]
  if (/^ANGL/.test(code)) return [...poly(-12, -8, 0, 0, -12, 8, -12, -8), ...poly(0, 0, -8, 12, 8, 12, 0, 0), L(0, 0, 10, -14), ...ends]
  if (/^3WAY/.test(code)) return [...bowtie(), ...poly(0, 0, -8, 14, 8, 14, 0, 0), L(0, 0, 0, -18), ...ends]
  if (/^BFLY/.test(code)) return [L(-6, -11, -6, 11), L(6, -11, 6, 11), L(-6, 9, 6, -9), C(0, 0, 2, true), L(0, -11, 0, -18), ...ends]
  if (/^CONTROL|^CV/.test(code)) return [...bowtie(), L(0, 0, 0, -12), ...poly(-8, -12, 8, -12), { c: [0, -18, 6] }]
  return [...bowtie(), L(0, 0, 0, -18), L(-8, -18, 8, -18), ...ends] // gate
}

function flange(code: string): SymbolStroke[] {
  if (/BL$/.test(code)) return [L(-2, -12, -2, 12), L(2, -12, 2, 12), L(-2, -12, 2, -12), L(-2, 12, 2, 12), L(-2, 0, 2, 0)]
  if (/WN$/.test(code)) return [L(0, -12, 0, 12), L(4, -12, 4, 12), ...poly(4, -6, 12, -3), ...poly(4, 6, 12, 3)]
  if (/SO$/.test(code)) return [L(0, -12, 0, 12), L(4, -12, 4, 12), L(-4, -6, -4, 6)]
  if (/LJ|LAP/.test(code)) return [L(0, -12, 0, 12), L(4, -12, 4, 12), L(-3, -9, -3, 9)]
  if (/SW$/.test(code)) return [L(0, -12, 0, 12), L(4, -12, 4, 12), L(10, -5, 10, 5)]
  if (/SC$/.test(code)) return [L(0, -12, 0, 12), L(4, -12, 4, 12), ...poly(6, -5, 9, -3, 6, -1, 9, 1, 6, 3)]
  if (/^ORFC|ORIFICE/.test(code)) return [L(-3, -12, -3, 12), L(3, -12, 3, 12), L(0, -15, 0, 15), T('O', -3, -16, 8)]
  return [L(-2, -12, -2, 12), L(2, -12, 2, 12)]
}

function reducer(code: string): SymbolStroke[] {
  const long = /SWAGE|SWG/.test(code) ? 4 : 0
  if (/^E-/.test(code)) return poly(-12 - long, -10, 12 + long, -10, 12 + long, 4, -12 - long, 10, -12 - long, -10)
  return poly(-12 - long, -10, 12 + long, -5, 12 + long, 5, -12 - long, 10, -12 - long, -10)
}

function support(code: string): SymbolStroke[] {
  if (/SHOE/.test(code)) return [...box(-10, 4, 20, 6), L(-14, 13, 14, 13)]
  if (/GUIDE|BASEGUID/.test(code)) return [L(-12, 13, 12, 13), ...poly(-9, 13, -9, 2, -6, 2), ...poly(9, 13, 9, 2, 6, 2)]
  if (/ANCHOR/.test(code)) return [...box(-8, -8, 16, 16), L(-8, -8, 8, 8), L(-8, 8, 8, -8)]
  if (/SPRG|SPRING/.test(code)) return [L(0, -6, 0, -10), ...poly(0, -10, -5, -12, 5, -15, -5, -18, 5, -21, 0, -23), L(-8, -26, 8, -26)]
  if (/HANG|HNGR/.test(code)) return [L(0, -6, 0, -24), L(-8, -24, 8, -24), ...poly(-6, -6, 0, -2, 6, -6)]
  if (/U-?BOLT|^U-B/.test(code)) return [...poly(-7, -9, -7, 4), ...poly(7, -9, 7, 4), ...poly(-7, 4, -4, 8, 4, 8, 7, 4), L(-12, 10, 12, 10)]
  if (/TRUN/.test(code)) return [L(-5, 4, -5, 16), L(5, 4, 5, 16), L(-8, 16, 8, 16)]
  if (/DUMY|DUMMY/.test(code)) return [L(-5, 6, -5, 18), L(5, 6, 5, 18), L(-5, 18, 5, 18)]
  if (/REPAD/.test(code)) return [L(-12, -5, 12, -5), L(-12, 5, 12, 5), L(-12, -5, -12, 5), L(12, -5, 12, 5)]
  if (/BASE/.test(code)) return [L(0, 6, 0, 16), L(-10, 16, 10, 16), ...poly(-10, 16, -7, 19), ...poly(0, 16, 3, 19), ...poly(10, 16, 13, 19)]
  return [L(-9, 6, 9, 6), L(-9, 6, 0, 18), L(9, 6, 0, 18), L(-14, 18, 14, 18)]
}

function annotation(code: string): SymbolStroke[] {
  if (/^ORIFICE/.test(code)) return [L(-3, -12, -3, 12), L(3, -12, 3, 12), L(-3, -12, -3, -18), L(3, -12, 3, -18), ...(/2$/.test(code) ? [L(3, 12, 3, 18)] : [L(-3, 12, -3, 18)])]
  if (/GASKTK/.test(code)) return [L(0, -12, 0, 12), L(-4, -12, 4, -12)]
  if (/^SB$|SPEC.?BREAK/.test(code)) return [L(0, -14, 0, 14), ...poly(0, -14, 10, -11, 0, -8), T('SB', 3, 12, 7)]
  if (/^SP$/.test(code)) return [...poly(-9, 0, -5, -8, 5, -8, 9, 0, 5, 8, -5, 8, -9, 0), T('SP', -6, 3, 7)]
  if (/^PL$|^PL-/.test(code)) return [...box(-11, -6, 22, 12), T('PL', -6, 3, 7)]
  if (/NORTH/.test(code)) return [L(0, 12, 0, -12), ...poly(-5, -5, 0, -12, 5, -5), T('N', -3, -15, 9)]
  if (/ARR|ARRW/.test(code)) return [L(-14, 0, 12, 0), ...poly(5, -5, 13, 0, 5, 5, 5, -5)]
  if (/WELD|WLD|^FW$/.test(code)) return /DOT/.test(code) ? [C(0, 0, 3, true)] : [C(0, 0, 8), T('1', -3, 3, 9)]
  if (/^BAL|MTO/.test(code)) return [C(0, 0, 9), T('#', -3, 3, 9)]
  if (/REVTRI/.test(code)) return [...poly(0, -10, 10, 8, -10, 8, 0, -10), T('1', -3, 5, 8)]
  if (/REDFLAG/.test(code)) return [L(-8, 12, -8, -12), ...poly(-8, -12, 10, -6, -8, 0)]
  if (/INS/.test(code) && !/INST/.test(code)) return [L(-14, -8, 14, -8), L(-14, 8, 14, 8), ...[-10, -2, 6].map(x => L(x, -8, x + 4, 8))]
  if (/INST/.test(code)) return [L(0, 0, 0, -8), C(0, -16, 8), L(-8, -16, 8, -16)]
  if (/^CL/.test(code)) return [T('℄', -5, 5, 14)]
  if (/SLP/.test(code)) return [L(-14, 4, 14, -4), ...poly(-14, 4, 14, 4, 14, -4), T('SLOPE', -12, 14, 7)]
  if (/^PIP-END|BREAK|^SB\d/.test(code)) return [...poly(-2, -12, 2, -4, -2, 4, 2, 12)]
  if (/GRND|GRDE/.test(code)) return [L(0, -10, 0, 2), L(-10, 2, 10, 2), L(-6, 6, 6, 6), L(-2, 10, 2, 10)]
  if (/COL/.test(code)) return [C(0, 0, 9), L(0, -16, 0, 16), L(-16, 0, 16, 0)]
  if (/^N\d|NOZ/.test(code)) return [...box(-8, -6, 16, 12), T('N', -3, 3, 8)]
  if (/^MK|^SP-/.test(code)) return [...poly(-10, 8, 0, -8, 10, 8), T('A', -3, 6, 8)]
  if (/THD/.test(code)) return [...poly(-6, -6, -3, -3, -6, 0, -3, 3, -6, 6)]
  return [C(0, 0, 8), T('?', -3, 3, 9)]
}

/** Strokes for a component type code, falling back to the geometric kind for older drawings. */
export function symbolStrokes(code: string | undefined, kind: Kind | 'pipe' | 'annotation'): SymbolStroke[] {
  const c = (code ?? '').toUpperCase()
  if (kind === 'pipe') return [L(-16, 0, 16, 0)]
  if (kind === 'annotation') return annotation(c)
  // Two-port fittings that route as inline valves still draw as what they are.
  if (/UNION/.test(c)) return [L(-6, -9, -6, 9), L(6, -9, 6, 9), L(-2, -6, -2, 6), L(2, -6, 2, 6)]
  if (/CPLG/.test(c)) return /^H-/.test(c) ? [L(-5, -8, -5, 8), L(5, -8, 5, 8), L(-5, -8, 5, -8)] : [L(-6, -8, -6, 8), L(6, -8, 6, 8)]
  if (/NIPPLE/.test(c)) return [L(-10, -5, 10, -5), L(-10, 5, 10, 5), ...poly(-10, -5, -12, 0, -10, 5), ...poly(10, -5, 12, 0, 10, 5)]
  if (kind === 'valve') return valve(c)
  if (kind === 'flange') return flange(c)
  if (kind === 'reducer') return reducer(c)
  if (kind === 'support') return support(c)
  if (kind === 'gasket') return /RF|FF/.test(c) && /FF/.test(c) ? [L(0, -12, 0, 12), L(1.5, -12, 1.5, 12)] : [L(0, -10, 0, 10), L(1.5, -10, 1.5, 10)]
  if (kind === 'bolt') return [L(-10, -10, -10, 10), L(10, -10, 10, 10), L(-13, -6, 13, -6), L(-13, 6, 13, 6)]
  if (kind === 'olet')
    return [...poly(-8, 0, -5, -6, 5, -6, 8, 0), L(0, -6, 0, -16), T(/SOL/.test(c) ? 'S' : /TOL/.test(c) ? 'T' : /EOL|LOL/.test(c) ? 'E' : 'W', 6, -9, 7)]
  if (kind === 'cap') {
    if (/^PLUG$|PLUG/.test(c)) return [...box(-4, -6, 8, 12), L(-4, 0, 4, 0)]
    if (/CPLG|UNION/.test(c))
      return /UNION/.test(c)
        ? [L(-6, -9, -6, 9), L(6, -9, 6, 9), L(-2, -6, -2, 6), L(2, -6, 2, 6)]
        : /^H-/.test(c)
          ? [L(-5, -8, -5, 8), L(5, -8, 5, 8), L(-5, -8, 5, -8)]
          : [L(-6, -8, -6, 8), L(6, -8, 6, 8)]
    if (/NIPPLE/.test(c)) return [L(-10, -5, 10, -5), L(-10, 5, 10, 5), ...poly(-10, -5, -12, 0, -10, 5), ...poly(10, -5, 12, 0, 10, 5)]
    return [L(-2, -10, -2, 10), ...poly(-2, -10, 6, -7, 9, 0, 6, 7, -2, 10)]
  }
  if (kind === 'tee') {
    if (/CRS/.test(c)) return [L(-16, 0, 16, 0), L(0, -16, 0, 16), C(0, 0, 3, true)]
    if (/LAT/.test(c)) return [L(-16, 0, 16, 0), L(0, 0, 11, -12), C(0, 0, 3, true)]
    return [L(-16, 0, 16, 0), L(0, 0, 0, -16), C(0, 0, 3, true), ...(/RTEE/.test(c) ? [T('R', 4, -8, 7)] : [])]
  }
  if (kind === 'elbow90' || kind === 'elbow45') {
    if (/180|BEND/.test(c)) return [L(-16, 6, 4, 6), L(-16, -6, 4, -6), ...poly(4, -6, 9, -4, 11, 0, 9, 4, 4, 6)]
    const radius = /SR/.test(c) ? 6 : /3D/i.test(c) ? 14 : 10
    if (kind === 'elbow45') return [L(-16, 0, -4, 0), ...poly(-4, 0, 2, -2, 8, -8), C(-4, 0, 2, true), C(8, -8, 2, true)]
    return [L(-16, 0, -radius, 0), ...poly(-radius, 0, -radius * 0.3, -radius * 0.3, 0, -radius), L(0, -radius, 0, -16), C(-radius, 0, 2, true), C(0, -radius, 2, true)]
  }
  if (kind === 'weld') return [C(0, 0, 3, true)]
  return [C(0, 0, 3)]
}
