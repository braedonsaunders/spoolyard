/**
 * Single-stroke CAD lettering: Hershey Roman Simplex, the outlines AutoCAD ships as ROMANS (romans.shx).
 * Glyph data by Dr. A. V. Hershey (U.S. National Bureau of Standards), in the format created by James Hurt
 * (Cognition, Inc.); see public/fonts/LICENSE. Proportions are measured from production isometric sheets:
 * glyphs at 0.8 width (AutoCAD width factor 0.8), slightly open tracking and a wide word space.
 */
import { paperPt, type PaperSize } from './paper'

export type StrokePoint = [number, number]
export type Stroke = StrokePoint[]
export type TextAnchor = 'start' | 'middle' | 'end'
export interface StrokeTextOptions {
  /** Baseline point at the anchor, in page units with y pointing down. */
  at: [number, number]
  /** Cap height in page units. */
  size: number
  /** Degrees counter-clockwise as seen on the page. */
  rotation?: number
  /** Slant in degrees, applied before rotation; positive leans right like the AutoCAD oblique angle. */
  oblique?: number
  anchor?: TextAnchor
  /** Width factor relative to the standard lettering (1 = production sheet proportions). */
  width?: number
}

/** AutoCAD width factor of a ROMANS text style that reproduces this lettering. */
export const ROMANS_WIDTH_FACTOR = 0.8
/** Baseline-to-baseline distance of stacked lines, in cap heights. */
export const LINE_SPACING = 1.9
/** The thin CAD pen for lettering and symbols: 0.48 pt (0.17 mm) on the printed paper. */
export const CAD_PEN_PT = 0.48
/** The thin CAD pen in sheet units for a paper size. */
export const cadStrokeWidth = (paper?: PaperSize) => paperPt(CAD_PEN_PT, paper)

/**
 * Hershey Roman Simplex (rowmans.jhf), ASCII 32–126. Each entry starts with the left and right bearing; then
 * coordinate pairs follow and ' R' lifts the pen. Values are character codes minus 'R'; y grows downward, the cap
 * line is y = -12 and the baseline y = 9.
 */
const ROMAN_SIMPLEX = [
  'JZ', 'MWRFRT RRYQZR[SZRY', 'JZNFNM RVFVM', 'H]SBLb RYBRb RLOZO RKUYU',
  'H\\PBP_ RTBT_ RYIWGTFPFMGKIKKLMMNOOUQWRXSYUYXWZT[P[MZKX',
  'F^[FI[ RNFPHPJOLMMKMIKIIJGLFNFPGSHVHYG[F RWTUUTWTYV[X[ZZ[X[VYTWT',
  'E_\\O\\N[MZMYNXPVUTXRZP[L[JZIYHWHUISJRQNRMSKSIRGPFNGMIMKNNPQUXWZY[[[\\Z\\Y', 'MWRHQGRFSGSIRKQL',
  'KYVBTDRGPKOPOTPYR]T`Vb', 'KYNBPDRGTKUPUTTYR]P`Nb', 'JZRFRR RMIWO RWIMO', 'E_RIR[ RIR[R',
  'MWSZR[QZRYSZS\\R^Q_', 'E_IR[R', 'MWRYQZR[SZRY', 'G][BIb', 'H\\QFNGLJKOKRLWNZQ[S[VZXWYRYOXJVGSFQF',
  'H\\NJPISFS[', 'H\\LKLJMHNGPFTFVGWHXJXLWNUQK[Y[', 'H\\MFXFRNUNWOXPYSYUXXVZS[P[MZLYKW', 'H\\UFKTZT RUFU[',
  'H\\WFMFLOMNPMSMVNXPYSYUXXVZS[P[MZLYKW', 'H\\XIWGTFRFOGMJLOLTMXOZR[S[VZXXYUYTXQVOSNRNOOMQLT',
  'H\\YFO[ RKFYF', 'H\\PFMGLILKMMONSOVPXRYTYWXYWZT[P[MZLYKWKTLRNPQOUNWMXKXIWGTFPF',
  'H\\XMWPURRSQSNRLPKMKLLINGQFRFUGWIXMXRWWUZR[P[MZLX', 'MWRMQNROSNRM RRYQZR[SZRY',
  'MWRMQNROSNRM RSZR[QZRYSZS\\R^Q_', 'F^ZIJRZ[', 'E_IO[O RIU[U', 'F^JIZRJ[',
  'I[LKLJMHNGPFTFVGWHXJXLWNVORQRT RRYQZR[SZRY',
  'E`WNVLTKQKOLNMMPMSNUPVSVUUVS RQKOMNPNSOUPV RWKVSVUXVZV\\T]Q]O\\L[JYHWGTFQFNGLHJJILHOHRIUJWLYNZQ[T[WZYYZX RXKWSWUXV',
  'I[RFJ[ RRFZ[ RMTWT', 'G\\KFK[ RKFTFWGXHYJYLXNWOTP RKPTPWQXRYTYWXYWZT[K[',
  'H]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZV', 'G\\KFK[ RKFRFUGWIXKYNYSXVWXUZR[K[', 'H[LFL[ RLFYF RLPTP RL[Y[',
  'HZLFL[ RLFYF RLPTP', 'H]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZVZS RUSZS', 'G]KFK[ RYFY[ RKPYP', 'NVRFR[',
  'JZVFVVUYTZR[P[NZMYLVLT', 'G\\KFK[ RYFKT RPOY[', 'HYLFL[ RL[X[', 'F^JFJ[ RJFR[ RZFR[ RZFZ[',
  'G]KFK[ RKFY[ RYFY[', 'G]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF', 'G\\KFK[ RKFTFWGXHYJYMXOWPTQKQ',
  'G]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF RSWY]', 'G\\KFK[ RKFTFWGXHYJYLXNWOTPKP RRPY[',
  'H\\YIWGTFPFMGKIKKLMMNOOUQWRXSYUYXWZT[P[MZKX', 'JZRFR[ RKFYF', 'G]KFKULXNZQ[S[VZXXYUYF', 'I[JFR[ RZFR[',
  'F^HFM[ RRFM[ RRFW[ R\\FW[', 'H\\KFY[ RYFK[', 'I[JFRPR[ RZFRP', 'H\\YFK[ RKFYF RK[Y[',
  'KYOBOb RPBPb ROBVB RObVb', 'KYKFY^', 'KYTBTb RUBUb RNBUB RNbUb', 'JZPLRITL RMORJWO RRJR[', 'JZJ]Z]',
  'MWSFRGQIQKRLSKRJ', 'I\\XMX[ RXPVNTMQMONMPLSLUMXOZQ[T[VZXX', 'H[LFL[ RLPNNPMSMUNWPXSXUWXUZS[P[NZLX',
  'I[XPVNTMQMONMPLSLUMXOZQ[T[VZXX', 'I\\XFX[ RXPVNTMQMONMPLSLUMXOZQ[T[VZXX',
  'I[LSXSXQWOVNTMQMONMPLSLUMXOZQ[T[VZXX', 'MYWFUFSGRJR[ ROMVM',
  'I\\XMX]W`VaTbQbOa RXPVNTMQMONMPLSLUMXOZQ[T[VZXX', 'I\\MFM[ RMQPNRMUMWNXQX[', 'NVQFRGSFREQF RRMR[',
  'MWRFSGTFSERF RSMS^RaPbNb', 'IZMFM[ RWMMW RQSX[', 'NVRFR[', 'CaGMG[ RGQJNLMOMQNRQR[ RRQUNWMZM\\N]Q][',
  'I\\MMM[ RMQPNRMUMWNXQX[', 'I\\QMONMPLSLUMXOZQ[T[VZXXYUYSXPVNTMQM', 'H[LMLb RLPNNPMSMUNWPXSXUWXUZS[P[NZLX',
  'I\\XMXb RXPVNTMQMONMPLSLUMXOZQ[T[VZXX', 'KXOMO[ ROSPPRNTMWM', 'J[XPWNTMQMNNMPNRPSUTWUXWXXWZT[Q[NZMX',
  'MYRFRWSZU[W[ ROMVM', 'I\\MMMWNZP[S[UZXW RXMX[', 'JZLMR[ RXMR[', 'G]JMN[ RRMN[ RRMV[ RZMV[', 'J[MMX[ RXMM[',
  'JZLMR[ RXMR[P_NaLbKb', 'J[XMM[ RMMXM RM[X[',
  'KYTBRCQDPFPHQJRKSMSOQQ RRCQEQGRISJTLTNSPORSTTVTXSZR[Q]Q_Ra RQSSUSWRYQZP\\P^Q`RaTb', 'NVRBRb',
  'KYPBRCSDTFTHSJRKQMQOSQ RRCSESGRIQJPLPNQPURQTPVPXQZR[S]S_Ra RSSQUQWRYSZT\\T^S`RaPb',
  'F^IUISJPLONOPPTSVTXTZS[Q RISJQLPNPPQTTVUXUZT[Q[O'
]

/** Drafting symbols and the ROMANS forms that differ from the Hershey originals, in the same encoding. */
const EXTRA: Record<string, string> = {
  // ROMANS draws foot and inch marks as raised commas straddling the cap line.
  "'": 'MWRCQBRASBSDRFQG',
  '"': 'JZNCMBNAOBODNFMG RVCUBVAWBWDVFUG',
  '℄': 'HbZHYFWDUCQCODMFLHKKKPLSMUOWQXUXWWYUZS RRKR` RR`^`',
  '±': 'E_RGRW RIO[O RI[[[',
  '×': 'G]LLXX RXLLX',
  // A middle dot: the full stop's dot raised to half the cap height.
  '·': 'MWROQPRQSPRO',
  '�': 'JZMFM[W[WFMF'
}
const ALIASES: Record<string, string> = {
  '′': "'", '’': "'", '‘': "'", '″': '"', '“': '"', '”': '"', '–': '-', '—': '-', '−': '-', '\u00a0': ' ', '\t': ' ',
  '•': '·', '½': '1/2', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'
}

const CAP = 21
const BASELINE = 9
// Measured from production sheets, in Hershey units: extra advance per character, and the word space (16 in Hershey).
const TRACKING = 0.6
const SPACE = 21.5

interface Glyph { advance: number; strokes: Stroke[] }

const decode = (code: string): Glyph => {
  const left = code.charCodeAt(0) - 82
  const strokes: Stroke[] = []
  let stroke: Stroke = []
  for (let i = 2; i < code.length; i += 2) {
    if (code[i] === ' ' && code[i + 1] === 'R') {
      if (stroke.length) strokes.push(stroke)
      stroke = []
    } else stroke.push([code.charCodeAt(i) - 82 - left + TRACKING / 2, code.charCodeAt(i + 1) - 82 - BASELINE])
  }
  if (stroke.length) strokes.push(stroke)
  return { advance: code.charCodeAt(1) - code.charCodeAt(0) + TRACKING, strokes }
}

const ring = (cx: number, cy: number, r: number, n = 12): Stroke =>
  Array.from({ length: n + 1 }, (_, i): StrokePoint =>
    [cx + r * Math.cos((i / n) * 2 * Math.PI), cy - r * Math.sin((i / n) * 2 * Math.PI)])

const glyphs = new Map<string, Glyph>([
  [' ', { advance: SPACE, strokes: [] }],
  ['°', { advance: 9 + TRACKING, strokes: [ring(4.5 + TRACKING / 2, -21, 2.5)] }]
])

const glyph = (ch: string): Glyph => {
  let g = glyphs.get(ch)
  if (!g) {
    const code = ch.charCodeAt(0)
    g = decode(EXTRA[ch] ?? (ch.length === 1 && code >= 32 && code <= 126 ? ROMAN_SIMPLEX[code - 32] : EXTRA['�']))
    glyphs.set(ch, g)
  }
  return g
}

const lines = (text: string): Glyph[][] =>
  text.replace(/\r\n?/g, '\n').split('\n').map(line =>
    [...line].flatMap(ch => [...(ALIASES[ch] ?? ch)]).filter(ch => ch >= ' ').map(glyph))

const advance = (line: Glyph[]) => line.reduce((sum, g) => sum + g.advance, 0)

/** Advance width of the widest line for cap height `size`, in the same units as `size`. */
export function measureText(text: string, size: number, width = 1): number {
  let widest = advances.get(text)
  if (widest == null) {
    if (advances.size >= ADVANCES_KEPT) advances.clear()
    advances.set(text, widest = Math.max(0, ...lines(text).map(advance)))
  }
  return widest * (size / CAP) * ROMANS_WIDTH_FACTOR * width
}
/** The widest line's advance of each text measured (glyph units), so a sheet's lettering is measured once. */
const advances = new Map<string, number>()
const ADVANCES_KEPT = 20000

/** Polylines of the lettering in page coordinates (y down). Lines after a newline stack below the first. */
export function strokeText(text: string, options: StrokeTextOptions): Stroke[] {
  const { at, size, rotation = 0, oblique = 0, anchor = 'start', width = 1 } = options
  const ky = size / CAP, kx = ky * ROMANS_WIDTH_FACTOR * width
  const slant = Math.tan((oblique * Math.PI) / 180)
  const angle = (rotation * Math.PI) / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  const out: Stroke[] = []
  lines(text).forEach((line, row) => {
    const total = advance(line)
    let x = anchor === 'middle' ? -total / 2 : anchor === 'end' ? -total : 0
    const dy = row * LINE_SPACING * CAP
    for (const g of line) {
      for (const stroke of g.strokes)
        out.push(stroke.map(([gx, gy]): StrokePoint => {
          const v = (gy + dy) * ky, u = (x + gx) * kx - v * slant
          return [at[0] + u * cos + v * sin, at[1] - u * sin + v * cos]
        }))
      x += g.advance
    }
  })
  return out
}

const num = (v: number) => String(Math.round(v * 1000) / 1000 || 0)

/** SVG path data (M/L commands) for `strokeText`. */
export function strokeTextPath(text: string, options: StrokeTextOptions): string {
  return strokeText(text, options)
    .map(stroke => stroke.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join(''))
    .join('')
}
