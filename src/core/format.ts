import { plantCoordinate, round, type IsoDocument, type Vec3 } from './model'

/**
 * Drafting notation used on issued sheets: straight quotes, feet-inches to 1/16″, whole millimetres.
 * Sheet dimensions stay in inches below two feet (`21 11/16"`); schedules switch to feet at one foot.
 */
export function draftLength(mm: number, units: IsoDocument['units'], inchesBelow = 12): string {
  if (!Number.isFinite(mm)) return '—'
  if (units === 'mm') return String(Math.round(mm))
  const sign = mm < 0 ? '-' : '', sixteenths = Math.round(Math.abs(mm) / 25.4 * 16)
  const feet = sixteenths < inchesBelow * 16 ? 0 : Math.floor(sixteenths / 192), inch = Math.floor((sixteenths - feet * 192) / 16)
  const fraction = fractionText(sixteenths % 16, 16)
  if (feet) return `${sign}${feet}'-${inch}${fraction ? ' ' + fraction : ''}"`
  return `${sign}${inch || !fraction ? inch : ''}${inch && fraction ? ' ' : ''}${fraction}"`
}
function fractionText(numerator: number, denominator: number): string {
  if (!numerator) return ''
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a, g = gcd(numerator, denominator)
  return `${numerator / g}/${denominator / g}`
}
/**
 * Length to order. Imperial pieces under a foot round up to the whole inch; a foot or more takes the next whole
 * inch above the cut, as the issued sheets order them. Metric rounds up to the next 10 mm.
 */
export function purchaseLength(mm: number, units: IsoDocument['units']): string {
  if (!Number.isFinite(mm) || mm <= 0) return 'TBD'
  if (units === 'mm') return String(Math.ceil(mm / 10 - 1e-9) * 10)
  const exact = mm / 25.4, inches = exact >= 12 - 1e-6 ? Math.floor(exact + 1e-6) + 1 : Math.ceil(exact - 1e-6)
  const feet = Math.floor(inches / 12), rest = inches % 12
  return feet ? rest ? `${feet}'-${rest}"` : `${feet}'` : `${rest}"`
}
/** Plant coordinates of a model point: E/W, N/S and signed elevation. */
export function coordinateText(doc: IsoDocument, p: Vec3): [string, string, string] {
  const [e, n, el] = plantCoordinate(doc, p)
  return [
    `${e < 0 ? 'W' : 'E'} ${draftLength(Math.abs(e), doc.units)}`,
    `${n < 0 ? 'S' : 'N'} ${draftLength(Math.abs(n), doc.units)}`,
    `EL ${el < 0 ? '-' : '+'}${draftLength(Math.abs(el), doc.units)}`
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
export function sizeText(nps: number, smallerNps?: number): string {
  return smallerNps != null && smallerNps !== nps ? `${npsText(nps)}"X${npsText(smallerNps)}"` : `${npsText(nps)}"`
}
/** Bolt diameter by length, e.g. 5/8"X3 1/4". */
export function boltSizeText(diameter: number, length: number, units: IsoDocument['units'] = 'imperial'): string {
  if (units === 'mm') return `M${Math.round(diameter)}X${Math.round(length)}`
  const inch = (mm: number) => {
    const sixteenths = Math.round(mm / 25.4 * 16), whole = Math.floor(sixteenths / 16), fraction = fractionText(sixteenths % 16, 16)
    return `${whole || !fraction ? whole : ''}${whole && fraction ? ' ' : ''}${fraction}"`
  }
  return `${inch(diameter)}X${inch(length)}`
}
export const angleText = (degrees: number, plane: 'H' | 'V') => `${round(degrees, 1)}° ${plane}`
