import { fieldFitMakeup, plantCoordinate, type IsoDocument, type Vec3 } from './model'
import { feetThreshold, profileOf } from './profile'

/**
 * Every length, size and schedule the app writes, in one place. Two notations share one rounding core:
 * - drafting (sheets, schedules, CSV): straight quotes, feet-inches to 1/16″ (`2'-3 1/2"`), whole millimetres;
 * - interface (inspector, status bar): primes (`2′ 3 1/2″`) and millimetres to 0.1 mm with the unit.
 */
type Units = IsoDocument['units']
const round = (v: number, d = 2) => Number(v.toFixed(d))
/** Printed for a value the drawing does not know. */
export const UNKNOWN = '—'
function fractionText(numerator: number, denominator: number): string {
  if (!numerator) return ''
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a, g = gcd(numerator, denominator)
  return `${numerator / g}/${denominator / g}`
}
/** A length split into feet, inches and sixteenths, nearest 1/16″. */
function sixteenths(mm: number, inchesBelow: number) {
  const n = Math.round(Math.abs(mm) / 25.4 * 16)
  const feet = n < inchesBelow * 16 ? 0 : Math.floor(n / 192)
  return { feet, inch: Math.floor((n - feet * 192) / 16), fraction: fractionText(n % 16, 16), zero: n === 0 }
}

/**
 * Drafting notation used on issued sheets: straight quotes, feet-inches to 1/16″, whole millimetres. Lengths shorter
 * than `inchesBelow` inches are written in inches only (see `feetThreshold` for a drawing's setting).
 */
export function draftLength(mm: number, units: Units, inchesBelow = 12): string {
  if (!Number.isFinite(mm)) return UNKNOWN
  if (units === 'mm') return String(Math.round(Math.abs(mm)) * Math.sign(mm) || 0)
  // A negative length that rounds to nothing is written as nothing, without a sign.
  const { feet, inch, fraction, zero } = sixteenths(mm, inchesBelow), sign = mm < 0 && !zero ? '-' : ''
  if (feet) return `${sign}${feet}'-${inch}${fraction ? ' ' + fraction : ''}"`
  return `${sign}${inch || !fraction ? inch : ''}${inch && fraction ? ' ' : ''}${fraction}"`
}
/**
 * The note beside a field-fit weld: the extra pipe left for trimming on site, written as the sheet dimensions a length
 * (`+3" FIT-UP`, `+100 FIT-UP` on a metric drawing, feet from the profile's dimension threshold). None when the
 * drawing leaves no makeup.
 */
export function fieldFitNote(doc: Pick<IsoDocument, 'units' | 'profile' | 'fieldFitMakeup'>): string | undefined {
  const mm = fieldFitMakeup(doc)
  return mm > 0 && Number.isFinite(mm) ? `+${dimensionLength(doc, mm)} FIT-UP` : undefined
}
/** A length in a list (cut list, material schedule), feet from the drawing's list threshold. */
export const listLength = (doc: Pick<IsoDocument, 'units' | 'profile'>, mm: number) => draftLength(mm, doc.units, feetThreshold(doc, 'lists'))
/** A length as the sheet dimensions it, feet from the drawing's dimension threshold. */
export const dimensionLength = (doc: Pick<IsoDocument, 'units' | 'profile'>, mm: number) => draftLength(mm, doc.units, feetThreshold(doc, 'dimensions'))

/** Interface notation: millimetres to 0.1 mm, or feet and inches with primes to 1/16″ (`2′ 3 1/2″`, `1/2″`). */
export function formatLength(mm: number, units: Units): string {
  if (!Number.isFinite(mm)) return UNKNOWN
  if (units === 'mm') return `${round(mm, 1)} mm`
  const { feet, inch, fraction, zero } = sixteenths(mm, 12), sign = mm < 0 && !zero ? '−' : ''
  // Under an inch the fraction stands alone: 1/2″, not 0 1/2″.
  const inches = feet || inch || !fraction ? `${inch}${fraction ? ' ' + fraction : ''}` : fraction
  return `${sign}${feet ? feet + '′ ' : ''}${inches}″`
}
/**
 * How finely a length field shows its value. `drafting` is how lengths are measured and cut: feet and inches to
 * 1/16″, or 0.1 mm. `fine` is for catalogue values (outside diameter, wall, root gap, takeout), in decimal inches as
 * the tables give them: to 0.001″, an exact sixteenth exactly (0.0625″); or millimetres to 0.01 mm.
 */
export type LengthPrecision = 'drafting' | 'fine'
const decimalText = (v: number, places: number) => String(Number(v.toFixed(places)) || 0)
/**
 * Text for a length field. Millimetres stay a plain number; feet and inches use the drawing's notation. The text is
 * rounded for reading, so a field commits only when what is typed differs from it (see `editedLength`): a value that
 * is merely shown is never rewritten by its rounded text.
 */
export function lengthInputValue(mm: number, units: Units, precision: LengthPrecision = 'drafting'): string {
  if (!Number.isFinite(mm)) return ''
  if (units === 'mm') return decimalText(mm, precision === 'fine' ? 2 : 1)
  if (precision === 'drafting') return formatLength(mm, units)
  // Decimal inches, as catalogues tabulate them: 0.001″, or exactly for a sixteenth (0.0625″, 3.5″).
  const inches = mm / 25.4, exact = Math.abs(inches * 16 - Math.round(inches * 16)) < 1.6e-4
  return `${decimalText(exact ? Math.round(inches * 16) / 16 : inches, exact ? 4 : 3)}″`
}
/**
 * What a length field commits when it loses focus: `undefined` when the typed text is the text it showed, or reads
 * as the value it already holds (so tabbing through a field never moves anything), else the length read from it.
 * Throws the reason when the text is not a length.
 */
export function editedLength(raw: string, mm: number | undefined, units: Units, precision: LengthPrecision = 'drafting', allowNegative = false): number | undefined {
  const text = raw.trim()
  if (mm != null && Number.isFinite(mm) && text === lengthInputValue(mm, units, precision)) return undefined
  const value = parseLength(text, units, allowNegative)
  return mm != null && Math.abs(value - mm) <= 0.001 ? undefined : value
}
/**
 * A takeout, gap or allowance. A small allowance never rounds down to a displayed zero: below 1/32″ it is written in
 * decimal inches. Drafting: tenths of a millimetre, or inches below two feet; interface: as a fine length field shows
 * it (`lengthInputValue(…, 'fine')`).
 */
export function allowanceText(mm: number, units: Units, notation: 'drafting' | 'interface' = 'drafting'): string {
  if (!Number.isFinite(mm)) return UNKNOWN
  // As a fine length field shows it: decimal inches to 0.001″ (an exact sixteenth exactly), or 0.01 mm.
  if (notation === 'interface') return lengthInputValue(mm, units, 'fine') + (units === 'mm' ? ' mm' : '')
  if (units === 'mm') return String(round(mm, 1))
  const zero = sixteenths(mm, 24).zero
  return !mm || !zero ? draftLength(mm, units, 24) : `${round(mm / 25.4, 3)}"`
}
/** Small fabrication allowances in interface notation. */
export const formatAllowance = (mm: number, units: Units) => allowanceText(mm, units, 'interface')

/**
 * Read a length typed by the user. Millimetres (`1200`, `1.2 m`), or feet and inches (`2' 3 1/2"`, `27.5 in`).
 * On a metric drawing a bare number is millimetres; a fraction has no millimetre meaning, so it needs a unit.
 */
export function parseLength(value: string, units: Units, allowNegative = false): number {
  let s = value.trim().toLowerCase().replace(/[′']/g, 'ft').replace(/[″"]/g, 'in').replace(/−/g, '-')
  if (!s) throw new Error('Enter a length.')
  const negative = s.startsWith('-')
  if (negative && !allowNegative) throw new Error('Enter a positive length; use signed measurements for XYZ offsets.')
  s = s.replace(/^[+-]\s*/, '').replace(/ft\s*-\s*/, 'ft ').replace(/(\d)\s*-\s*(?=\d+\/)/g, '$1 ')
  const decimal = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
  let result: number
  const metric = s.match(new RegExp(`^(${decimal})\\s*(mm|cm|m)$`))
  if (metric) result = Number(metric[1]) * ({ mm: 1, cm: 10, m: 1000 }[metric[2]]!)
  else if (new RegExp(`^${decimal}$`).test(s)) result = Number(s) * (units === 'mm' ? 1 : 25.4)
  else {
    let feet = 0, inch = 0, rem = s
    const ft = rem.match(new RegExp(`^(${decimal})\\s*ft\\s*`))
    if (ft) { feet = Number(ft[1]); rem = rem.slice(ft[0].length) }
    const marked = !!ft || /in\s*$/.test(s)
    rem = rem.replace(/in\s*$/, '').trim()
    if (!ft && !rem) throw new Error('Enter a length.')
    if (rem) {
      const match = rem.match(/^(?:(\d+(?:\.\d+)?|\.\d+)\s*)?(?:(\d+)\/(\d+))?$/)
      if (!match || (!match[1] && !match[2]) || (match[3] && Number(match[3]) === 0))
        throw new Error("Use millimetres or feet/inches, e.g. 2' 3 1/2\".")
      inch = Number(match[1] ?? 0) + (match[2] ? Number(match[2]) / Number(match[3]) : 0)
    }
    if (!marked && units === 'mm')
      throw new Error(`On a metric drawing write "${value.trim()}" with its unit: inches as ${value.trim()}", or millimetres as a decimal.`)
    result = (feet * 12 + inch) * 25.4
  }
  if (!Number.isFinite(result)) throw new Error('Enter a finite length.')
  return negative ? -result : result
}

/**
 * Length to order: the pieces' total rounded up to the order increment (`profile.orderIncrement`; whole inch or 10 mm
 * by default; 0 orders the exact length).
 */
export function purchaseLength(mm: number, units: Units, increment = units === 'mm' ? 10 : 25.4): string {
  if (!Number.isFinite(mm) || mm <= 0) return 'TBD'
  const ordered = increment > 0 ? Math.ceil(mm / increment - 1e-6) * increment : mm
  if (units === 'mm') return String(Math.round(ordered))
  if (increment > 0 && Math.abs(increment / 25.4 - Math.round(increment / 25.4)) < 1e-9) {
    const inches = Math.round(ordered / 25.4), feet = Math.floor(inches / 12), rest = inches % 12
    return feet ? rest ? `${feet}'-${rest}"` : `${feet}'` : `${rest}"`
  }
  return draftLength(ordered, units)
}
/** The ordered length (mm) of a pipe total, by the drawing's order increment. */
export function orderedLength(doc: Pick<IsoDocument, 'units' | 'profile'>, mm: number): number {
  const increment = profileOf(doc).orderIncrement
  return !Number.isFinite(mm) || mm <= 0 ? NaN : increment > 0 ? Math.ceil(mm / increment - 1e-6) * increment : mm
}
export const purchaseText = (doc: Pick<IsoDocument, 'units' | 'profile'>, mm: number) => purchaseLength(mm, doc.units, profileOf(doc).orderIncrement)

/** A coordinate length: feet-inches, with whole feet written without inches (`N 45'`). */
const coordinateLength = (mm: number, units: Units) => {
  const text = draftLength(mm, units)
  return /^\d+'-0"$/.test(text) ? text.replace(/-0"$/, '') : text
}
/** Plant coordinates of a model point: E/W, N/S and signed elevation. */
export function coordinateText(doc: IsoDocument, p: Vec3): [string, string, string] {
  // A coordinate that rounds to zero is east, north and plus, whatever side of zero it is on.
  const shown = (v: number) => doc.units === 'mm' ? Math.round(v) : Math.round(v / 25.4 * 16) / 16 * 25.4
  const [e, n, el] = plantCoordinate(doc, p).map(v => shown(v) === 0 ? 0 : v)
  return [
    `${e < 0 ? 'W' : 'E'} ${coordinateLength(Math.abs(e), doc.units)}`,
    `${n < 0 ? 'S' : 'N'} ${coordinateLength(Math.abs(n), doc.units)}`,
    `EL ${el < 0 ? '-' : '+'}${coordinateLength(Math.abs(el), doc.units)}`
  ]
}
export function elevationText(doc: IsoDocument, p: Vec3): string {
  return `℄ ${coordinateText(doc, p)[2]}`
}

/** Nominal size in inches with fractions, e.g. 1 1/2. */
export function npsText(nps: number): string {
  const whole = Math.floor(nps + 1e-9), eighths = Math.round((nps - whole) * 8)
  const fraction = fractionText(eighths, 8)
  return whole ? `${whole}${fraction ? ' ' + fraction : ''}` : fraction || '0'
}
/** ISO 6708 nominal diameter for an NPS: the published equivalents below 4", 25 × NPS from 4". */
const DN_BELOW_4: Record<string, number> = {
  0.125: 6, 0.25: 8, 0.375: 10, 0.5: 15, 0.75: 20, 1: 25, 1.25: 32, 1.5: 40, 2: 50, 2.5: 65, 3: 80, 3.5: 90
}
export function dnOf(nps: number): number | undefined {
  if (nps >= 4) return Math.round(nps * 25)
  return DN_BELOW_4[String(nps)]
}
/** The NPS for a DN, inverse of `dnOf`. */
export function npsOfDn(dn: number): number | undefined {
  const below = Object.entries(DN_BELOW_4).find(([, d]) => d === dn)
  if (below) return Number(below[0])
  return dn >= 100 && dn % 25 === 0 ? dn / 25 : undefined
}
const one = (nps: number, notation: 'NPS' | 'DN') => {
  const dn = notation === 'DN' ? dnOf(nps) : undefined
  return dn != null ? String(dn) : `${npsText(nps)}"`
}
/**
 * Nominal size, header by branch for reducing items: `3"X2"`, or in DN notation `DN80X50`. A size without a DN
 * equivalent stays in inches.
 */
export function sizeText(nps: number, smallerNps?: number, notation: 'NPS' | 'DN' = 'NPS'): string {
  const dn = notation === 'DN' && dnOf(nps) != null && (smallerNps == null || dnOf(smallerNps) != null)
  const reducing = smallerNps != null && smallerNps !== nps
  if (dn) return `DN${one(nps, 'DN')}${reducing ? 'X' + one(smallerNps!, 'DN') : ''}`
  return reducing ? `${npsText(nps)}"X${npsText(smallerNps!)}"` : `${npsText(nps)}"`
}
/** A size in the drawing's notation (`profile.sizeNotation`). */
export const sizeFor = (doc: Pick<IsoDocument, 'units' | 'profile'>, nps: number, smallerNps?: number) =>
  sizeText(nps, smallerNps, profileOf(doc).sizeNotation)
/** Column heading for nominal sizes in the drawing's notation. */
export const sizeHeader = (doc: Pick<IsoDocument, 'units' | 'profile'>) => profileOf(doc).sizeNotation === 'DN' ? 'DN' : 'NPS'

/**
 * Bolt diameter by length. Inch bolting (ASME B16.5, B18.2) is written in inches whatever the drawing's units, e.g.
 * 5/8"X3 1/4"; metric bolting (ISO 4014, EN 1515) as M16X90, only when the bolt data itself is metric.
 */
export function boltSizeText(diameter: number, length: number, system: 'inch' | 'metric' = 'inch'): string {
  if (system === 'metric') return `M${round(diameter, 1)}X${Math.round(length)}`
  const inch = (mm: number) => {
    const n = Math.round(mm / 25.4 * 16), whole = Math.floor(n / 16), fraction = fractionText(n % 16, 16)
    return `${whole || !fraction ? whole : ''}${whole && fraction ? ' ' : ''}${fraction}"`
  }
  return `${inch(diameter)}X${inch(length)}`
}
/** BOM text from its parts, comma separated and upper case. */
export const compose = (...parts: Array<string | undefined>) =>
  parts.map(p => p?.trim()).filter(Boolean).join(', ').toUpperCase()
/** Wall schedule in drafting notation: STD, XS, XXS, SCH 40, SCH 10S. Empty when there is none. */
export function scheduleText(text = ''): string {
  const bare = text.trim().toUpperCase().replace(/\.$/, '').replace(/^SCH(EDULE)?\.?\s*/, '')
  return /^\d+S?$/.test(bare) ? 'SCH ' + bare : bare
}
/** A schedule as BOM text (alias of `scheduleText`). */
export const schedule = (text?: string) => scheduleText(text)
export const angleText = (degrees: number, plane: 'H' | 'V') => `${round(degrees, 1)}° ${plane}`
/**
 * A note the sheet prints when its dimensions are rounded each on its own (the legacy issued-sheet style): a chain of
 * individually rounded dimensions need not add up to the rounded overall.
 */
export const dimensionRoundingNote = (doc: Pick<IsoDocument, 'style'>) =>
  doc.style?.dimensionRounding === 'individual' ? 'DIMENSIONS ARE ROUNDED INDIVIDUALLY AND MAY NOT ADD UP TO THE OVERALL.' : undefined
