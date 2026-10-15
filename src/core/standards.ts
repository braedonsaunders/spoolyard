import type { Kind } from './model'
/**
 * Built-in standard dimensions so no standard piping component needs a manually entered length.
 * Tables are written in inches (snapped to 1/32 in) or millimetres as published; every lookup returns millimetres.
 * `takeout` follows model.ts: elbow/tee centre-to-end, reducer and valve half length, WN length through hub,
 * SO pipe set-back, blind thickness, gasket half thickness, cap height, stub-end length F, socket-weld and
 * threaded fittings the effective takeout (to socket bottom / less thread engagement).
 * B16.5 flange dimensions are measured from the gasket face: Class 150/300 include the 1.6 mm raised face,
 * Class 600 and above add the 6.4 mm raised face to the published thickness and hub length.
 */
export interface StandardRow {
  kind: Kind
  nps: number
  smallerNps?: number
  takeout: number
  branchTakeout?: number
  faceToFace?: number
  flangeThickness?: number
  lengthThroughHub?: number
  thickness?: number
  boltCount?: number
  boltDiameter?: number
  boltLength?: number
  socketDepth?: number
  threadEngagement?: number
  description: string
  source: string
}
export interface FlangeData {
  rating: number
  nps: number
  od: number
  /** Flange thickness at the gasket face (raised face included). */
  thickness: number
  raisedFace: number
  /** Weld-neck length through hub Y, raised face included. */
  wnLength: number
  /** Slip-on / socket-weld / threaded hub length Y, raised face included; absent where B16.5 has no slip-on. */
  soLength?: number
  ljLength: number
  /** Lap-joint flanges have no raised face. */
  ljThickness: number
  boltCircle: number
  boltCount: number
  boltDiameter: number
  /** Stud length for an RF (and full-thickness FF) flange pair. */
  studLength: number
  machineBoltLength?: number
  /** B16.5 socket depth D where a socket-weld flange exists. */
  socketDepth?: number
  threaded: boolean
}
export interface Bolting {
  count: number
  diameter: number
  length: number
  kind: 'stud' | 'lug'
}
export type BoltMakeup = 'flange-pair' | 'lj-pair' | 'lug-valve-side' | 'wafer-valve'
const r2 = (v: number) => Math.round(v * 100) / 100
/** Published inch value (2-decimal fractions) → millimetres. */
const mm = (inch: number) => r2((Math.round(inch * 32) * 25.4) / 32)
const mmx = (inch: number) => r2(inch * 25.4)
const quarter = (v: number) => Math.round(v * 4 + 1e-9) / 4
const upQuarter = (v: number) => Math.ceil(v * 4 - 1e-9) / 4
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6
const at = <T extends number[]>(rows: T[] | undefined, nps: number) => rows?.find(r => same(r[0], nps))
const NPS = [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]
const isNps = (v: number) => NPS.some(n => same(n, v))
const CLASSES = [125, 150, 250, 300, 400, 600, 800, 900, 1500, 2000, 2500, 3000, 6000, 9000]
/** Pressure class from spec text: '150#', '150 LB', 'CL150', 'Class 150', '150', '3000#', '3000 LB'. */
export function ratingClass(text: string | number | undefined): number | undefined {
  if (typeof text === 'number') return CLASSES.includes(text) ? text : undefined
  for (const m of (text ?? '').matchAll(/\d+/g)) if (CLASSES.includes(Number(m[0]))) return Number(m[0])
  return undefined
}
// ---- ASME B36.10M / B36.19M nominal wall (in): [nps, 5S, 10S, STD/40S, XS/80S, 40, 60, 80, 120, 160, XXS]; 0 = not listed.
const WALL = [
  [0.125, 0.035, 0.049, 0.068, 0.095, 0.068, 0, 0.095, 0, 0, 0],
  [0.25, 0.049, 0.065, 0.088, 0.119, 0.088, 0, 0.119, 0, 0, 0],
  [0.375, 0.049, 0.065, 0.091, 0.126, 0.091, 0, 0.126, 0, 0, 0],
  [0.5, 0.065, 0.083, 0.109, 0.147, 0.109, 0, 0.147, 0, 0.188, 0.294],
  [0.75, 0.065, 0.083, 0.113, 0.154, 0.113, 0, 0.154, 0, 0.219, 0.308],
  [1, 0.065, 0.109, 0.133, 0.179, 0.133, 0, 0.179, 0, 0.25, 0.358],
  [1.25, 0.065, 0.109, 0.14, 0.191, 0.14, 0, 0.191, 0, 0.25, 0.382],
  [1.5, 0.065, 0.109, 0.145, 0.2, 0.145, 0, 0.2, 0, 0.281, 0.4],
  [2, 0.065, 0.109, 0.154, 0.218, 0.154, 0, 0.218, 0, 0.344, 0.436],
  [2.5, 0.083, 0.12, 0.203, 0.276, 0.203, 0, 0.276, 0, 0.375, 0.552],
  [3, 0.083, 0.12, 0.216, 0.3, 0.216, 0, 0.3, 0, 0.438, 0.6],
  [3.5, 0.083, 0.12, 0.226, 0.318, 0.226, 0, 0.318, 0, 0, 0.636],
  [4, 0.083, 0.12, 0.237, 0.337, 0.237, 0, 0.337, 0.438, 0.531, 0.674],
  [5, 0.109, 0.134, 0.258, 0.375, 0.258, 0, 0.375, 0.5, 0.625, 0.75],
  [6, 0.109, 0.134, 0.28, 0.432, 0.28, 0, 0.432, 0.562, 0.719, 0.864],
  [8, 0.109, 0.148, 0.322, 0.5, 0.322, 0.406, 0.5, 0.719, 0.906, 0.875],
  [10, 0.134, 0.165, 0.365, 0.5, 0.365, 0.5, 0.594, 0.844, 1.125, 1],
  [12, 0.156, 0.18, 0.375, 0.5, 0.406, 0.562, 0.688, 1, 1.312, 1],
  [14, 0.156, 0.188, 0.375, 0.5, 0.438, 0.594, 0.75, 1.094, 1.406, 0],
  [16, 0.165, 0.188, 0.375, 0.5, 0.5, 0.656, 0.844, 1.219, 1.594, 0],
  [18, 0.165, 0.188, 0.375, 0.5, 0.562, 0.75, 0.938, 1.375, 1.781, 0],
  [20, 0.188, 0.218, 0.375, 0.5, 0.594, 0.812, 1.031, 1.5, 1.969, 0],
  [22, 0.188, 0.218, 0.375, 0.5, 0, 0.875, 1.125, 1.625, 2.125, 0],
  [24, 0.218, 0.25, 0.375, 0.5, 0.688, 0.969, 1.219, 1.812, 2.344, 0]
]
const WALL_COLUMNS = ['5S', '10S', 'STD', 'XS', '40', '60', '80', '120', '160', 'XXS']
/** Nominal pipe wall (mm) for a schedule ('STD', 'XS', 'XXS', '5S', '10S', '40S', '80S', '40', 'SCH.80', 'SCH 160'…); undefined if unknown. */
export function pipeWall(nps: number, schedule = 'STD'): number | undefined {
  const s = schedule.toUpperCase().replace(/^SCH(EDULE)?\.?\s*/, '').replace(/\.$/, '').trim()
  const i = WALL_COLUMNS.indexOf(s === '40S' ? 'STD' : s === '80S' ? 'XS' : s) + 1, r = at(WALL, nps)
  return i && r?.[i] ? mmx(r[i]) : undefined
}
// ---- ASME B16.5 (inches). [nps, O, C, Y weld neck, Y slip-on/SW/THD (0 = none), Y lapped, bolt circle, bolts, bolt dia, stud length, machine bolt]
// Class 150/300 C and Y include the 0.06 in raised face; Class 600+ exclude the 0.25 in raised face (added in flange()).
// Thicknesses are the traditional (B16.5-1996) values used by flange makers and the library specs.
const B165: Record<number, number[][]> = {
  150: [
    [0.5, 3.5, 0.44, 1.88, 0.62, 0.62, 2.38, 4, 0.5, 2.25, 1.75],
    [0.75, 3.88, 0.5, 2.06, 0.62, 0.62, 2.75, 4, 0.5, 2.5, 2],
    [1, 4.25, 0.56, 2.19, 0.69, 0.69, 3.12, 4, 0.5, 2.5, 2],
    [1.25, 4.62, 0.62, 2.25, 0.81, 0.81, 3.5, 4, 0.5, 2.75, 2.25],
    [1.5, 5, 0.69, 2.44, 0.88, 0.88, 3.88, 4, 0.5, 2.75, 2.25],
    [2, 6, 0.75, 2.5, 1, 1, 4.75, 4, 0.62, 3.25, 2.75],
    [2.5, 7, 0.88, 2.75, 1.12, 1.12, 5.5, 4, 0.62, 3.5, 3],
    [3, 7.5, 0.94, 2.75, 1.19, 1.19, 6, 4, 0.62, 3.5, 3],
    [3.5, 8.5, 0.94, 2.81, 1.25, 1.25, 7, 8, 0.62, 3.5, 3],
    [4, 9, 0.94, 3, 1.31, 1.31, 7.5, 8, 0.62, 3.5, 3],
    [5, 10, 0.94, 3.5, 1.44, 1.44, 8.5, 8, 0.75, 3.75, 3.25],
    [6, 11, 1, 3.5, 1.56, 1.56, 9.5, 8, 0.75, 4, 3.25],
    [8, 13.5, 1.12, 4, 1.75, 1.75, 11.75, 8, 0.75, 4.25, 3.5],
    [10, 16, 1.19, 4, 1.94, 1.94, 14.25, 12, 0.88, 4.5, 3.75],
    [12, 19, 1.25, 4.5, 2.19, 2.19, 17, 12, 0.88, 4.75, 4],
    [14, 21, 1.38, 5, 2.25, 3.12, 18.75, 12, 1, 5.25, 4.25],
    [16, 23.5, 1.44, 5, 2.5, 3.44, 21.25, 16, 1, 5.25, 4.5],
    [18, 25, 1.56, 5.5, 2.69, 3.81, 22.75, 16, 1.12, 5.75, 4.75],
    [20, 27.5, 1.69, 5.69, 2.88, 4.06, 25, 20, 1.12, 6.25, 5.25],
    [22, 29.5, 1.81, 5.88, 3.12, 4.25, 27.25, 20, 1.25, 6.75, 5.75],
    [24, 32, 1.88, 6, 3.25, 4.38, 29.5, 20, 1.25, 6.75, 5.75]
  ],
  300: [
    [0.5, 3.75, 0.56, 2.06, 0.88, 0.88, 2.62, 4, 0.5, 2.5, 2.25],
    [0.75, 4.62, 0.62, 2.25, 1, 1, 3.25, 4, 0.62, 3, 2.5],
    [1, 4.88, 0.69, 2.44, 1.06, 1.06, 3.5, 4, 0.62, 3, 2.5],
    [1.25, 5.25, 0.75, 2.56, 1.06, 1.06, 3.88, 4, 0.62, 3.25, 2.75],
    [1.5, 6.12, 0.81, 2.69, 1.19, 1.19, 4.5, 4, 0.75, 3.5, 3],
    [2, 6.5, 0.88, 2.75, 1.31, 1.31, 5, 8, 0.62, 3.5, 2.75],
    [2.5, 7.5, 1, 3, 1.5, 1.5, 5.88, 8, 0.75, 4, 3.25],
    [3, 8.25, 1.12, 3.12, 1.69, 1.69, 6.62, 8, 0.75, 4.25, 3.5],
    [3.5, 9, 1.19, 3.19, 1.75, 1.75, 7.25, 8, 0.75, 4.25, 3.5],
    [4, 10, 1.25, 3.38, 1.88, 1.88, 7.88, 8, 0.75, 4.5, 3.75],
    [5, 11, 1.38, 3.88, 2, 2, 9.25, 8, 0.75, 4.75, 4],
    [6, 12.5, 1.44, 3.88, 2.06, 2.06, 10.62, 12, 0.75, 4.75, 4],
    [8, 15, 1.62, 4.38, 2.44, 2.44, 13, 12, 0.88, 5.5, 4.5],
    [10, 17.5, 1.88, 4.62, 2.62, 3.75, 15.25, 16, 1, 6.25, 5],
    [12, 20.5, 2, 5.12, 2.88, 4, 17.75, 16, 1.12, 6.75, 5.5],
    [14, 23, 2.12, 5.62, 3, 4.38, 20.25, 20, 1.12, 7, 5.75],
    [16, 25.5, 2.25, 5.75, 3.25, 4.75, 22.5, 20, 1.25, 7.5, 6.25],
    [18, 28, 2.38, 6.25, 3.5, 5.12, 24.75, 24, 1.25, 7.75, 6.5],
    [20, 30.5, 2.5, 6.38, 3.75, 5.5, 27, 24, 1.25, 8, 6.75],
    [22, 33, 2.62, 6.5, 4, 5.75, 29.25, 24, 1.5, 8.75, 7.25],
    [24, 36, 2.75, 6.62, 4.19, 6, 32, 24, 1.5, 9, 7.5]
  ],
  600: [
    [0.5, 3.75, 0.56, 2.06, 0.88, 0.88, 2.62, 4, 0.5, 3, 0],
    [0.75, 4.62, 0.62, 2.25, 1, 1, 3.25, 4, 0.62, 3.5, 0],
    [1, 4.88, 0.69, 2.44, 1.06, 1.06, 3.5, 4, 0.62, 3.5, 0],
    [1.25, 5.25, 0.81, 2.62, 1.12, 1.12, 3.88, 4, 0.62, 3.75, 0],
    [1.5, 6.12, 0.88, 2.75, 1.25, 1.25, 4.5, 4, 0.75, 4.25, 0],
    [2, 6.5, 1, 2.88, 1.44, 1.44, 5, 8, 0.62, 4.25, 0],
    [2.5, 7.5, 1.12, 3.12, 1.62, 1.62, 5.88, 8, 0.75, 4.75, 0],
    [3, 8.25, 1.25, 3.25, 1.81, 1.81, 6.62, 8, 0.75, 5, 0],
    [3.5, 9, 1.38, 3.38, 1.94, 1.94, 7.25, 8, 0.88, 5.5, 0],
    [4, 10.75, 1.5, 4, 2.12, 2.12, 8.5, 8, 0.88, 5.75, 0],
    [5, 13, 1.75, 4.5, 2.38, 2.38, 10.5, 8, 1, 6.5, 0],
    [6, 14, 1.88, 4.62, 2.62, 2.62, 11.5, 12, 1, 6.75, 0],
    [8, 16.5, 2.19, 5.25, 3, 3, 13.75, 12, 1.12, 7.5, 0],
    [10, 20, 2.5, 6, 3.38, 4.38, 17, 16, 1.25, 8.5, 0],
    [12, 22, 2.62, 6.12, 3.62, 4.62, 19.25, 20, 1.25, 8.75, 0],
    [14, 23.75, 2.75, 6.5, 3.69, 5, 20.75, 20, 1.38, 9.25, 0],
    [16, 27, 3, 7, 4.19, 5.5, 23.75, 20, 1.5, 10, 0],
    [18, 29.25, 3.25, 7.25, 4.62, 6, 25.75, 20, 1.62, 10.75, 0],
    [20, 32, 3.5, 7.5, 5, 6.5, 28.5, 24, 1.62, 11.25, 0],
    [22, 34.25, 3.75, 7.75, 5.25, 6.88, 30.62, 24, 1.75, 12, 0],
    [24, 37, 4, 8, 5.5, 7.25, 33, 24, 1.88, 13, 0]
  ],
  900: [
    [0.5, 4.75, 0.88, 2.38, 1.25, 1.25, 3.25, 4, 0.75, 4.25, 0],
    [0.75, 5.12, 1, 2.75, 1.38, 1.38, 3.5, 4, 0.75, 4.5, 0],
    [1, 5.88, 1.12, 2.88, 1.62, 1.62, 4, 4, 0.88, 5, 0],
    [1.25, 6.25, 1.12, 2.88, 1.62, 1.62, 4.38, 4, 0.88, 5, 0],
    [1.5, 7, 1.25, 3.25, 1.75, 1.75, 4.88, 4, 1, 5.5, 0],
    [2, 8.5, 1.5, 4, 2.25, 2.25, 6.5, 8, 0.88, 5.75, 0],
    [2.5, 9.62, 1.62, 4.12, 2.5, 2.5, 7.5, 8, 1, 6.25, 0],
    [3, 9.5, 1.5, 4, 2.12, 2.12, 7.5, 8, 0.88, 5.75, 0],
    [4, 11.5, 1.75, 4.5, 2.75, 2.75, 9.25, 8, 1.12, 6.75, 0],
    [5, 13.75, 2, 5, 3.12, 3.12, 11, 8, 1.25, 7.5, 0],
    [6, 15, 2.19, 5.5, 3.38, 3.38, 12.5, 12, 1.12, 7.5, 0],
    [8, 18.5, 2.5, 6.38, 4, 4.5, 15.5, 12, 1.38, 8.75, 0],
    [10, 21.5, 2.75, 7.25, 4.25, 5, 18.5, 16, 1.38, 9.25, 0],
    [12, 24, 3.12, 7.88, 4.62, 5.62, 21, 20, 1.38, 10, 0],
    [14, 25.25, 3.38, 8.38, 5.12, 6.12, 22, 20, 1.5, 10.75, 0],
    [16, 27.75, 3.5, 8.5, 5.25, 6.5, 24.25, 20, 1.62, 11.25, 0],
    [18, 31, 4, 9, 6, 7.5, 27, 20, 1.88, 12.75, 0],
    [20, 33.75, 4.25, 9.75, 6.25, 8.25, 29.5, 20, 2, 13.75, 0],
    [24, 41, 5.5, 11.5, 8, 10.5, 35.5, 20, 2.5, 17.25, 0]
  ],
  1500: [
    [0.5, 4.75, 0.88, 2.38, 1.25, 1.25, 3.25, 4, 0.75, 4.25, 0],
    [0.75, 5.12, 1, 2.75, 1.38, 1.38, 3.5, 4, 0.75, 4.5, 0],
    [1, 5.88, 1.12, 2.88, 1.62, 1.62, 4, 4, 0.88, 5, 0],
    [1.25, 6.25, 1.12, 2.88, 1.62, 1.62, 4.38, 4, 0.88, 5, 0],
    [1.5, 7, 1.25, 3.25, 1.75, 1.75, 4.88, 4, 1, 5.5, 0],
    [2, 8.5, 1.5, 4, 2.25, 2.25, 6.5, 8, 0.88, 5.75, 0],
    [2.5, 9.62, 1.62, 4.12, 2.5, 2.5, 7.5, 8, 1, 6.25, 0],
    [3, 10.5, 1.88, 4.62, 0, 2.88, 8, 8, 1.12, 7, 0],
    [4, 12.25, 2.12, 4.88, 0, 3.56, 9.5, 8, 1.25, 7.75, 0],
    [5, 14.75, 2.88, 6.12, 0, 4.12, 11.5, 8, 1.5, 9.75, 0],
    [6, 15.5, 3.25, 6.75, 0, 4.69, 12.5, 12, 1.38, 10.25, 0],
    [8, 19, 3.62, 8.38, 0, 5.62, 15.5, 12, 1.62, 11.5, 0],
    [10, 23, 4.25, 10, 0, 7, 19, 12, 1.88, 13.25, 0],
    [12, 26.5, 4.88, 11.12, 0, 8.62, 22.5, 16, 2, 14.75, 0],
    [14, 29.5, 5.25, 11.75, 0, 9.5, 25, 16, 2.25, 16, 0],
    [16, 32.5, 5.75, 12.25, 0, 10.25, 27.75, 16, 2.5, 17.5, 0],
    [18, 36, 6.38, 12.88, 0, 10.88, 30.5, 16, 2.75, 19.5, 0],
    [20, 38.75, 7, 14, 0, 11.5, 32.75, 16, 3, 21.25, 0],
    [24, 46, 8, 16, 0, 13, 39, 16, 3.5, 24.25, 0]
  ]
}
/** B16.5 socket-weld flange socket depth D (in). */
const SW_FLANGE_DEPTH = [[0.5, 0.38], [0.75, 0.44], [1, 0.5], [1.25, 0.56], [1.5, 0.62], [2, 0.69], [2.5, 0.75], [3, 0.81]]
/** NPT make-up (hand-tight plus wrench) thread engagement (in), the shop chart used by the library specs. */
const ENGAGE = [
  [0.125, 0.25], [0.25, 0.375], [0.375, 0.375], [0.5, 0.5], [0.75, 0.5625], [1, 0.6875], [1.25, 0.6875],
  [1.5, 0.6875], [2, 0.75], [2.5, 0.9375], [3, 1], [3.5, 1.0625], [4, 1.125], [5, 1.25], [6, 1.3125],
  [8, 1.4375], [10, 1.625], [12, 1.75], [14, 1.9375], [16, 2.1875], [18, 2.375], [20, 2.5], [22, 2.625], [24, 2.75]
]
const engagement = (nps: number) => at(ENGAGE, nps)?.[1]
const FLANGE_CLASSES = [150, 300, 600, 900, 1500]
/** Flange class for a rating; a rating without a class ('', 'Project specified') means Class 150, an unsupported class (400, 2500) none. */
const flangeClass = (rating: string | number | undefined) => {
  const c = ratingClass(rating) ?? (typeof rating === 'number' ? undefined : 150)
  return c && FLANGE_CLASSES.includes(c) ? c : undefined
}
const B165_SOURCE = 'ASME B16.5 (traditional thicknesses; dimensions from the gasket face, raised face included)'
/** ASME B16.5 flange dimensions (mm) for Class 150–1500, NPS 1/2–24. */
export function flange(nps: number, rating?: string | number): FlangeData | undefined {
  const cls = flangeClass(rating), r = cls ? at(B165[cls], nps) : undefined
  if (!cls || !r) return undefined
  const [, o, c, ywn, yso, ylj, bc, count, d, stud, mb] = r, low = cls <= 300, rf = low ? 1 / 16 : 1 / 4, add = low ? 0 : rf
  const small = nps <= (cls <= 600 ? 3 : 2.5)
  return {
    rating: cls,
    nps,
    od: mm(o),
    thickness: mm(c + add),
    raisedFace: mm(rf),
    wnLength: mm(ywn + add),
    soLength: yso ? mm(yso + add) : undefined,
    ljLength: mm(ylj),
    ljThickness: mm(low ? c - rf : c),
    boltCircle: mm(bc),
    boltCount: count,
    boltDiameter: mm(d),
    studLength: mm(stud),
    machineBoltLength: mb ? mm(mb) : undefined,
    socketDepth: small ? (v => (v ? mm(v) : undefined))(at(SW_FLANGE_DEPTH, nps)?.[1]) : undefined,
    threaded: cls <= 600 || nps <= 2.5
  }
}
// ---- API 609 butterfly valve face-to-face (mm): Category A (concentric) Class 150 lug & wafer; Class 300 Category B (double offset).
const BFLY: Record<number, number[][]> = {
  150: [[1.5, 33], [2, 43], [2.5, 46], [3, 46], [4, 52], [5, 56], [6, 56], [8, 60], [10, 68], [12, 78], [14, 78], [16, 102], [18, 114], [20, 127], [24, 154]],
  300: [[3, 48], [4, 54], [6, 59], [8, 73], [10, 83], [12, 92], [14, 117], [16, 133], [18, 149], [20, 159], [24, 181]]
}
const butterfly = (nps: number, cls: number) => at(BFLY[cls], nps)?.[1]
/**
 * Bolting for one flanged joint. Lengths follow the B16.5 method (2 × (flange + 0.12 in tolerance + heavy nut) + gasket
 * + 0.06 in), the RF pair lengths are the published B16.5 table.
 * - 'lj-pair': two lap-joint flanges and two stub-end laps (default STD wall laps, 1/8 in gasket; pass the actual lap
 *   wall and gasket thickness in mm), rounded to the nearest 1/4 in like B16.5.
 * - 'lug-valve-side': lug bolts for ONE side of a lug butterfly valve: the B16.5 pair computation less 1/2 in, capped at
 *   one flange, gasket and nut plus half the lug body and 1/4 in projection, rounded up to 1/4 in. Reproduces the
 *   production reference (Class 150: NPS 2 = 2-3/4 in, NPS 3 = 3-1/4 in).
 * - 'wafer-valve': through studs spanning both flanges, gaskets and the valve body, rounded up to 1/4 in.
 */
export function bolting(nps: number, rating: string | number | undefined, face: 'RF' | 'FF', makeup: BoltMakeup, opts: { lap?: number; gasket?: number } = {}): Bolting | undefined {
  const cls = flangeClass(rating), r = cls ? at(B165[cls], nps) : undefined
  if (!cls || !r) return undefined
  const [, c, , , , , count, d, stud] = r.slice(1), low = cls <= 300
  if (face === 'FF' && !low && makeup !== 'lj-pair') return undefined
  const diameter = mm(d), t = nps <= 18 ? 0.12 : 0.19, n = 0.06, g = 0.12, tf = c + (low ? 0 : 0.25)
  if (makeup === 'flange-pair') return { count, diameter, length: mm(stud), kind: 'stud' }
  if (makeup === 'lj-pair') {
    const lap = (opts.lap ?? pipeWall(nps, 'STD') ?? 0) / 25.4, gasket = opts.gasket != null ? opts.gasket / 25.4 : g
    return { count, diameter, length: mm(quarter(2 * ((low ? c - 1 / 16 : c) + t + d) + 2 * lap + gasket + n)), kind: 'stud' }
  }
  const body = butterfly(nps, cls)
  if (body == null) return undefined
  const f = body / 25.4
  if (makeup === 'wafer-valve') return { count, diameter, length: mm(upQuarter(2 * (tf + t + d) + 2 * g + f + n)), kind: 'stud' }
  const side = Math.min(2 * (tf + t + d) + g + n - 0.5, tf + t + g + f / 2 + d + n + 0.25)
  return { count, diameter, length: mm(upQuarter(side)), kind: 'lug' }
}
// ---- ASME B16.9 butt-weld fittings (in): [nps, LR 90 A, SR 90 A, LR 45 B, tee C, cap E, reducer H, stub end long F, stub end MSS SP-43 short F, lap OD G]
const BW = [
  [0.5, 1.5, 0, 0.62, 1, 1, 1.5, 3, 2, 1.38],
  [0.75, 1.12, 0, 0.44, 1.12, 1, 1.5, 3, 2, 1.69],
  [1, 1.5, 1, 0.88, 1.5, 1.5, 2, 4, 2, 2],
  [1.25, 1.88, 1.25, 1, 1.88, 1.5, 2, 4, 2, 2.5],
  [1.5, 2.25, 1.5, 1.12, 2.25, 1.5, 2.5, 4, 2, 2.88],
  [2, 3, 2, 1.38, 2.5, 1.5, 3, 6, 2.5, 3.62],
  [2.5, 3.75, 2.5, 1.75, 3, 1.5, 3.5, 6, 2.5, 4.12],
  [3, 4.5, 3, 2, 3.38, 2, 3.5, 6, 2.5, 5],
  [3.5, 5.25, 3.5, 2.25, 3.75, 2.5, 4, 6, 3, 5.5],
  [4, 6, 4, 2.5, 4.12, 2.5, 4, 6, 3, 6.19],
  [5, 7.5, 5, 3.12, 4.88, 3, 5, 8, 3, 7.31],
  [6, 9, 6, 3.75, 5.62, 3.5, 5.5, 8, 3.5, 8.5],
  [8, 12, 8, 5, 7, 4, 6, 8, 4, 10.62],
  [10, 15, 10, 6.25, 8.5, 5, 7, 10, 5, 12.75],
  [12, 18, 12, 7.5, 10, 6, 8, 10, 6, 15],
  [14, 21, 14, 8.75, 11, 6.5, 13, 12, 6, 16.25],
  [16, 24, 16, 10, 12, 7, 14, 12, 6, 18.5],
  [18, 27, 18, 11.25, 13.5, 8, 15, 12, 6, 21],
  [20, 30, 20, 12.5, 15, 9, 20, 12, 6, 23],
  [22, 33, 22, 13.5, 16.5, 10, 20, 12, 6, 25.25],
  [24, 36, 24, 15, 17, 10.5, 20, 12, 6, 27.25]
]
/** Smallest outlet of B16.9 reducers / reducing elbows (extended to the manufacturer pairs carried by the library specs). */
const REDUCER_MIN = [
  [0.5, 0.25], [0.75, 0.375], [1, 0.5], [1.25, 0.5], [1.5, 0.5], [2, 0.75], [2.5, 1], [3, 1], [3.5, 1.25], [4, 1],
  [5, 1.5], [6, 2], [8, 3], [10, 3], [12, 4], [14, 6], [16, 6], [18, 8], [20, 8], [22, 10], [24, 10]
]
/** B16.9 reducing-outlet tee/cross centre-to-end of outlet M (in), keyed by run size: [outlet, M]. */
const TEE_M: Record<string, number[][]> = {
  0.5: [[0.375, 1], [0.25, 1]],
  0.75: [[0.5, 1.12], [0.375, 1.12]],
  1: [[0.75, 1.5], [0.5, 1.5]],
  1.25: [[1, 1.88], [0.75, 1.88], [0.5, 1.88]],
  1.5: [[1.25, 2.25], [1, 2.25], [0.75, 2.25], [0.5, 2.25]],
  2: [[1.5, 2.38], [1.25, 2.25], [1, 2], [0.75, 1.75]],
  2.5: [[2, 2.75], [1.5, 2.62], [1.25, 2.5], [1, 2.25]],
  3: [[2.5, 3.25], [2, 3], [1.5, 2.88], [1.25, 2.75], [1, 2.62]],
  3.5: [[3, 3.62], [2.5, 3.5], [2, 3.25], [1.5, 3.12]],
  4: [[3.5, 4], [3, 3.88], [2.5, 3.75], [2, 3.5], [1.5, 3.38]],
  5: [[4, 4.62], [3.5, 4.5], [3, 4.38], [2.5, 4.25], [2, 4.12]],
  6: [[5, 5.38], [4, 5.12], [3.5, 5], [3, 4.88], [2.5, 4.75]],
  8: [[6, 6.62], [5, 6.38], [4, 6.12], [3.5, 6], [3, 6]],
  10: [[8, 8], [6, 7.62], [5, 7.5], [4, 7.25]],
  12: [[10, 9.5], [8, 9], [6, 8.62], [5, 8.5]],
  14: [[12, 10.62], [10, 10.12], [8, 9.75], [6, 9.38]],
  16: [[14, 12], [12, 11.62], [10, 11.12], [8, 10.75], [6, 10.38]],
  18: [[16, 13], [14, 13], [12, 12.62], [10, 12.12], [8, 11.75]],
  20: [[18, 14.5], [16, 14], [14, 14], [12, 13.62], [10, 13.12], [8, 12.75]],
  22: [[20, 16], [18, 15.5], [16, 15], [14, 15], [12, 14.62], [10, 14.12]],
  24: [[22, 17], [20, 17], [18, 16.5], [16, 16], [14, 16], [12, 15.62], [10, 15.12]]
}
/** 45° laterals as catalogued (Bonney Forge, matching the library specs): [nps, short-side C-E, long-side and branch C-E] (in). */
const LATERAL = [[1, 2.5, 6.5], [1.25, 2.75, 7], [1.5, 3, 8], [2, 4, 8.5], [2.5, 4.5, 10], [3, 5, 11], [3.5, 5.5, 12], [4, 6, 13], [5, 7, 14.5], [6, 8, 16.5], [8, 10, 20], [10, 12, 23], [12, 13, 27], [14, 14, 30], [16, 16, 33], [18, 17, 36]]
/** MSS SP-95 swage nipple length (in). */
const SWAGE = [[0.25, 2], [0.375, 2.5], [0.5, 2.75], [0.75, 3], [1, 3.5], [1.25, 4], [1.5, 4.5], [2, 6.5], [2.5, 7], [3, 8], [4, 9], [5, 11], [6, 12]]
// ---- ASME B16.10 face-to-face (RF) / end-to-end (BW) (in). Class 600+ RF lengths include the raised faces.
// [nps, gate, globe, swing check, ball long, ball short, plug short, plug regular, gate BW, globe BW]; 0 = not listed.
const one = (rows: number[][]) => rows.map(([n, v]) => [n, v, v, v, v, v, v, v, v, v])
const B1610: Record<number, number[][]> = {
  150: [
    [0.5, 4.25, 4.25, 4.25, 4.25, 4.25, 0, 0, 0, 0],
    [0.75, 4.62, 4.62, 4.62, 4.62, 4.62, 0, 0, 0, 0],
    [1, 5, 5, 5, 5, 5, 0, 0, 0, 0],
    [1.25, 5.5, 5.5, 5.5, 5.5, 5.5, 0, 0, 0, 0],
    [1.5, 6.5, 6.5, 6.5, 6.5, 6.5, 0, 0, 0, 0],
    [2, 7, 8, 8, 7, 7, 7, 0, 8.5, 8],
    [2.5, 7.5, 8.5, 8.5, 7.5, 7.5, 7.5, 0, 9.5, 8.5],
    [3, 8, 9.5, 9.5, 8, 8, 8, 0, 11.12, 9.5],
    [4, 9, 11.5, 11.5, 9, 9, 9, 0, 12, 11.5],
    [5, 10, 14, 13, 0, 0, 10, 0, 15, 14],
    [6, 10.5, 16, 14, 15.5, 10.5, 10.5, 15.5, 15.88, 16],
    [8, 11.5, 19.5, 19.5, 18, 11.5, 11.5, 18, 16.5, 19.5],
    [10, 13, 24.5, 24.5, 21, 13, 13, 21, 18, 24.5],
    [12, 14, 27.5, 27.5, 24, 14, 14, 24, 19.75, 27.5],
    [14, 15, 31, 31, 27, 0, 0, 27, 22.5, 31],
    [16, 16, 36, 34, 30, 0, 0, 30, 24, 36],
    [18, 17, 0, 38.5, 34, 0, 0, 0, 26, 0],
    [20, 18, 0, 38.5, 36, 0, 0, 0, 28, 0],
    [22, 0, 0, 0, 40, 0, 0, 0, 0, 0],
    [24, 20, 0, 51, 42, 0, 0, 0, 32, 0]
  ],
  300: [
    [0.5, 5.5, 6, 6, 5.5, 5.5, 0, 0, 0, 0],
    [0.75, 6, 7, 7, 6, 6, 0, 0, 0, 0],
    [1, 6.5, 8, 8, 6.5, 6.5, 0, 0, 0, 0],
    [1.25, 7, 8.5, 8.5, 7, 7, 0, 0, 0, 0],
    [1.5, 7.5, 9, 9, 7.5, 7.5, 0, 0, 0, 0],
    [2, 8.5, 10.5, 10.5, 8.5, 8.5, 8.5, 0, 8.5, 10.5],
    [2.5, 9.5, 11.5, 11.5, 9.5, 9.5, 9.5, 0, 9.5, 11.5],
    [3, 11.12, 12.5, 12.5, 11.12, 11.12, 11.12, 0, 11.12, 12.5],
    [4, 12, 14, 14, 12, 12, 12, 0, 12, 14],
    [5, 15, 15.75, 15.75, 0, 0, 15, 0, 15, 15.75],
    [6, 15.88, 17.5, 17.5, 15.88, 15.88, 15.88, 16.75, 15.88, 17.5],
    [8, 16.5, 22, 21, 16.5, 16.5, 16.5, 19.75, 16.5, 22],
    [10, 18, 24.5, 24.5, 22.38, 18, 18, 23.5, 18, 24.5],
    [12, 19.75, 28, 28, 25.5, 19.75, 19.75, 28, 19.75, 28],
    [14, 30, 0, 33, 30, 0, 0, 0, 30, 0],
    [16, 33, 0, 34, 33, 0, 0, 31.5, 33, 0],
    [18, 36, 0, 38.5, 36, 0, 0, 0, 36, 0],
    [20, 39, 0, 40, 39, 0, 0, 0, 39, 0],
    [22, 43, 0, 0, 43, 0, 0, 0, 43, 0],
    [24, 45, 0, 53, 45, 0, 0, 0, 45, 0]
  ],
  600: one([[0.5, 6.5], [0.75, 7.5], [1, 8.5], [1.25, 9], [1.5, 9.5], [2, 11.5], [2.5, 13], [3, 14], [4, 17], [5, 20], [6, 22], [8, 26], [10, 31], [12, 33], [14, 35], [16, 39], [18, 43], [20, 47], [22, 51], [24, 55]]),
  900: one([[0.5, 8.5], [0.75, 9], [1, 10], [1.25, 11], [1.5, 12], [2, 14.5], [2.5, 16.5], [3, 15], [4, 18], [5, 22], [6, 24], [8, 29], [10, 33], [12, 38], [14, 40.5], [16, 44.5], [18, 48], [20, 52], [24, 61]]),
  1500: one([[0.5, 8.5], [0.75, 9], [1, 10], [1.25, 11], [1.5, 12], [2, 14.5], [2.5, 16.5], [3, 18.5], [4, 21.5], [5, 26.5], [6, 27.75], [8, 32.75], [10, 39], [12, 44.5], [14, 49.5], [16, 54.5], [18, 60.5], [20, 65.5], [24, 76.5]])
}
at(B1610[600], 24)![3] = 55.5 // Class 600 NPS 24 swing check, as in the library specs.
const VALVE: Record<string, [number[], string]> = {
  'GATE-FL': [[1], 'GATE VALVE, FLANGED'],
  'GLOBE-FL': [[2], 'GLOBE VALVE, FLANGED'],
  'CHECK-FL': [[3], 'SWING CHECK VALVE, FLANGED'],
  'BALL-FL': [[4, 5], 'BALL VALVE, FLANGED'],
  'BALL-FL-LONG': [[4], 'BALL VALVE, FLANGED, LONG PATTERN'],
  'BALL-FL-SHORT': [[5], 'BALL VALVE, FLANGED, SHORT PATTERN'],
  'PLUG-FL': [[7, 6], 'PLUG VALVE, FLANGED'],
  'PLUG-FL-SHORT': [[6], 'PLUG VALVE, FLANGED, SHORT PATTERN'],
  'PLUG-FL-REGULAR': [[7], 'PLUG VALVE, FLANGED, REGULAR PATTERN'],
  'GATE-BW': [[8], 'GATE VALVE, BUTT-WELD'],
  'GLOBE-BW': [[9], 'GLOBE VALVE, BUTT-WELD']
}
// ---- ASME B16.11 forged fittings.
/** Socket-weld centre to socket bottom (in): [nps, 90/tee 3000, 90/tee 6000, 45 3000, 45 6000]. */
const SW = [
  [0.125, 0.44, 0.44, 0.31, 0.31], [0.25, 0.44, 0.53, 0.31, 0.31], [0.375, 0.53, 0.62, 0.31, 0.44],
  [0.5, 0.62, 0.75, 0.44, 0.5], [0.75, 0.75, 0.88, 0.5, 0.56], [1, 0.88, 1.06, 0.56, 0.69],
  [1.25, 1.06, 1.25, 0.69, 0.81], [1.5, 1.25, 1.5, 0.81, 1], [2, 1.5, 1.62, 1, 1.12],
  [2.5, 1.62, 0, 1.12, 0], [3, 2.25, 0, 1.25, 0], [4, 2.62, 0, 1.62, 0]
]
/** B16.11 minimum socket depth J (in). */
const minSocket = (nps: number) => mm(nps <= 0.5 ? 0.375 : nps <= 1.5 ? 0.5 : nps <= 3 ? 0.625 : 0.75)
/** Socket depth of forged fittings as made (Bonney Forge, as in the library specs; deeper than the B16.11 minimum J). */
const FORGED_SOCKET = [[0.125, 0.375], [0.25, 0.375], [0.375, 0.4375], [0.5, 0.5], [0.75, 0.5625], [1, 0.625], [1.25, 0.6875], [1.5, 0.75], [2, 0.875], [2.5, 0.875], [3, 1], [4, 1.125]]
const socketDepth = (nps: number) => (v => (v ? mm(v) : minSocket(nps)))(at(FORGED_SOCKET, nps)?.[1])
/** B16.11 socket-weld coupling laying length E between socket bottoms (in). */
const swCouplingGap = (nps: number) => mm(nps <= 0.375 ? 0.25 : nps <= 0.75 ? 0.375 : nps <= 1.5 ? 0.5 : 0.75)
/** Threaded centre-to-end (mm): [nps, 90/tee 2000, 3000, 6000, 45 2000, 3000, 6000]. */
const THD = [
  [0.125, 21, 21, 25, 17, 17, 19], [0.25, 21, 25, 28, 17, 19, 22], [0.375, 25, 28, 33, 19, 22, 25],
  [0.5, 28, 33, 38, 22, 25, 28], [0.75, 33, 38, 44, 25, 28, 33], [1, 38, 44, 51, 28, 33, 35],
  [1.25, 44, 51, 60, 33, 35, 43], [1.5, 51, 60, 64, 35, 43, 44], [2, 60, 64, 83, 43, 44, 52],
  [2.5, 76, 83, 95, 52, 52, 64], [3, 86, 95, 106, 64, 64, 79], [4, 106, 114, 114, 79, 79, 79]
]
/** Threaded coupling length W (mm), Class 3000 and 6000. */
const THD_COUPLING = [[0.125, 32], [0.25, 35], [0.375, 38], [0.5, 48], [0.75, 51], [1, 60], [1.25, 67], [1.5, 79], [2, 86], [2.5, 92], [3, 108], [4, 121]]
/** MSS SP-83 union laying length (in) as catalogued: [nps, 3000, 6000]. */
const UNION = [[0.375, 2, 0], [0.5, 2.125, 2.875], [0.75, 2.3125, 3.375], [1, 2.5, 3.625], [1.25, 2.8125, 3.875], [1.5, 3.125, 4.1875], [2, 3.5, 4.625]]
/** Cap end beyond the pipe end (in), manufacturer lengths (B16.11 fixes only the minimum end wall): [nps, SW 3000, SW 6000, THD 3000, THD 6000]. */
const CAP = [[0.5, 0.375, 0.5, 0.375, 0.5], [0.75, 0.4375, 0.5, 0.4375, 0.5], [1, 0.4375, 0.625, 0.375, 0.5625], [1.25, 0.5, 0.625, 0.5, 0.625], [1.5, 0.5, 0.625, 0.5625, 0.6875], [2, 0.625, 0.75, 0.75, 0.875], [2.5, 0.625, 0, 0.5625, 0], [3, 0.75, 0, 0.75, 0], [4, 0.75, 0, 0.75, 0]]
/** B16.11 square-head plug thread length (in). */
const PLUG = [[0.125, 0.38], [0.25, 0.44], [0.375, 0.5], [0.5, 0.56], [0.75, 0.62], [1, 0.75], [1.25, 0.81], [1.5, 0.81], [2, 0.88], [2.5, 1.06], [3, 1.12], [4, 1.25]]
/** Forged-fitting class for a rating: 2000 (threaded only), 3000 or 6000; flange classes map 150–600 → 3000, 900+ → 6000. */
const forgedClass = (cls: number | undefined, threaded: boolean) =>
  cls === 2000 ? (threaded ? 2000 : 3000) : cls === 3000 || cls === 6000 ? cls : cls === 9000 ? undefined : cls && cls >= 900 ? 6000 : 3000
const B169 = 'ASME B16.9'
const row = (kind: Kind, nps: number, takeout: number, description: string, source: string, extra: Partial<StandardRow> = {}): StandardRow =>
  ({ kind, nps, takeout: r2(takeout), description, source, ...extra })
const reducing = (nps: number, small: number | undefined) => {
  const min = at(REDUCER_MIN, nps)?.[1]
  return small != null && min != null && isNps(small) && small < nps - 1e-6 && small >= min - 1e-6
}
const FLANGE_NAMES: Record<string, string> = { WN: 'WELD NECK', SO: 'SLIP-ON', SW: 'SOCKET-WELD', SC: 'THREADED', BL: 'BLIND', LJ: 'LAP-JOINT' }
/**
 * Standard dimensions (mm) for a component code at a size and class; undefined where the standard does not define the size.
 * `schedule` (optional) selects the pipe wall for slip-on set-back and stub-end lap thickness (default STD; 10S for MSS SP-43 stub ends).
 * A rating without a pressure class ('Project specified') is read as Class 150 for flanged items and Class 3000 for forged fittings.
 * Lap-joint flanges (FLG-RFLJ / FLG-FFLJ) have takeout 0: the stub end carries the length to the lap face.
 */
export function standardRow(code: string, nps: number, rating?: string | number, smallerNps?: number, schedule?: string): StandardRow | undefined {
  const c = code.toUpperCase(), cls = ratingClass(rating), b = at(BW, nps)
  const small = smallerNps != null && !same(smallerNps, nps) ? smallerNps : undefined
  const sized = small != null ? { smallerNps: small } : {}
  const flg = /^FLG-(RF|FF)(WN|SO|SW|SC|BL|LJ)$/.exec(c)
  if (flg) {
    const f = flange(nps, rating)
    if (!f || (flg[1] === 'FF' && f.rating > 300)) return undefined
    const type = flg[2], name = `FLANGE ${flg[1]} ${FLANGE_NAMES[type]}, CLASS ${f.rating}`
    const base = { flangeThickness: f.thickness, boltCount: f.boltCount, boltDiameter: f.boltDiameter, boltLength: f.studLength }
    if (type === 'WN') return row('flange', nps, f.wnLength, name, `${B165_SOURCE}; takeout = length through hub Y`, { ...base, lengthThroughHub: f.wnLength })
    if (type === 'BL') return row('flange', nps, f.thickness, name, `${B165_SOURCE}; blind flange: takeout = thickness`, { ...base, thickness: f.thickness })
    if (type === 'LJ')
      return row('flange', nps, 0, name, 'ASME B16.5 lapped flange (no raised face); takeout 0 because the stub end carries the length to the lap face', {
        ...base, flangeThickness: f.ljThickness, lengthThroughHub: f.ljLength, boltLength: bolting(nps, f.rating, 'FF', 'lj-pair')?.length
      })
    if (!f.soLength) return undefined
    if (type === 'SO') {
      const wall = pipeWall(nps, schedule ?? 'STD') ?? pipeWall(nps)
      return wall == null ? undefined : row('flange', nps, wall, name, `${B165_SOURCE}; slip-on: pipe end set back from the face by one pipe wall`, { ...base, lengthThroughHub: f.soLength })
    }
    if (type === 'SW')
      return f.socketDepth == null ? undefined : row('flange', nps, f.soLength - f.socketDepth, name, `${B165_SOURCE}; socket-weld: effective takeout = hub length less socket depth D`, { ...base, lengthThroughHub: f.soLength, socketDepth: f.socketDepth })
    const e = engagement(nps)
    return !f.threaded || e == null ? undefined : row('flange', nps, f.soLength - mm(e), name, `${B165_SOURCE}; threaded: effective takeout = hub length less NPT make-up engagement`, { ...base, lengthThroughHub: f.soLength, threadEngagement: mm(e) })
  }
  if (VALVE[c]) {
    const vc = flangeClass(rating), v = vc ? at(B1610[vc], nps) : undefined
    const len = v && VALVE[c][0].map(i => v[i]).find(x => x > 0)
    if (!len) return undefined
    const f2f = mm(len)
    return row('valve', nps, f2f / 2, `${VALVE[c][1]}, CLASS ${vc}`, `ASME B16.10 Class ${vc} ${/-BW$/.test(c) ? 'end-to-end' : 'face-to-face'}; takeout = half length`, { faceToFace: f2f })
  }
  if (c === 'BFLY' || c === 'BFLY-LUG' || c === 'BFLY-WAFER') {
    const fc = flangeClass(rating), body = fc ? butterfly(nps, fc) : undefined
    if (!fc || body == null) return undefined
    const wafer = c === 'BFLY-WAFER', bolts = bolting(nps, fc, 'RF', wafer ? 'wafer-valve' : 'lug-valve-side')
    return row('valve', nps, body / 2, `BUTTERFLY VALVE, ${wafer ? 'WAFER' : 'LUG'}, CLASS ${fc}`, `API 609 Category ${fc === 150 ? 'A' : 'B'} face-to-face; takeout = half length${wafer ? '; bolting = through studs' : '; bolting = lug bolts per side'}`, {
      faceToFace: body, boltCount: bolts?.count, boltDiameter: bolts?.diameter, boltLength: bolts?.length
    })
  }
  if (c === 'GASK-RF' || c === 'GASK-FF') {
    const fc = flangeClass(rating)
    if (!fc || !at(B165[fc], nps) || (c === 'GASK-FF' && fc > 300)) return undefined
    const t = c === 'GASK-RF' ? 3.3 : mm(1 / 8)
    return row('gasket', nps, t / 2, c === 'GASK-RF' ? `GASKET, SPIRAL WOUND, CLASS ${fc}` : `GASKET, FULL FACE 1/8 IN, CLASS ${fc}`,
      c === 'GASK-RF' ? 'ASME B16.20 spiral-wound, 3.3 mm compressed; takeout = half thickness' : 'ASME B16.21 non-metallic 1/8 in (1/16 in via gasketThickness); takeout = half thickness', { thickness: t })
  }
  if (c === 'BOLT-RF' || c === 'BOLT-FF') {
    const bolt = bolting(nps, rating, c === 'BOLT-FF' ? 'FF' : 'RF', 'flange-pair')
    return bolt && row('bolt', nps, 0, `STUD BOLT C/W 2 HEAVY HEX NUTS, CLASS ${flangeClass(rating)}`, 'ASME B16.5 stud bolts for one flange pair', { boltCount: bolt.count, boltDiameter: bolt.diameter, boltLength: bolt.length })
  }
  if (b) {
    const [, lr, sr, lr45, tee, cap, red] = b
    switch (c) {
      case 'W-LR90EL': return row('elbow90', nps, mm(lr), 'ELBOW 90 LR BW', `${B169} long radius; takeout = centre-to-end A`)
      case 'W-SR90EL': return sr ? row('elbow90', nps, mm(sr), 'ELBOW 90 SR BW', `${B169} short radius; takeout = centre-to-end A`) : undefined
      case 'W-3D90EL': return nps >= 0.75 ? row('elbow90', nps, mmx(3 * nps), 'ELBOW 90 3D BW', `${B169} 3D elbow (R = 3 x NPS); takeout = centre-to-end`) : undefined
      case 'W-45ELL': return row('elbow45', nps, mm(lr45), 'ELBOW 45 LR BW', `${B169} long radius; takeout = centre-to-end B`)
      case 'W-3D45ELL': return nps >= 0.75 ? row('elbow45', nps, mm(1.25 * nps), 'ELBOW 45 3D BW', `${B169} 3D 45° elbow B (R tan 22.5° rounded, 1.25 x NPS)`) : undefined
      case 'LR180R': return row('elbow90', nps, mm(lr), `RETURN 180 LR BW, CENTRE-TO-CENTRE ${mm(2 * lr)} MM`, `${B169} long-radius return; takeout = bend radius (model as two 90° halves)`)
      case 'SR180R': return sr ? row('elbow90', nps, mm(sr), `RETURN 180 SR BW, CENTRE-TO-CENTRE ${mm(2 * sr)} MM`, `${B169} short-radius return; takeout = bend radius (model as two 90° halves)`) : undefined
      case 'REDELL': return reducing(nps, small) ? row('elbow90', nps, mm(lr), 'ELBOW 90 LR REDUCING BW', `${B169} reducing elbow; centre-to-end = large-end LR elbow`, sized) : undefined
      case 'W-TEE':
      case 'W-CRS': return row('tee', nps, mm(tee), c === 'W-TEE' ? 'TEE BW' : 'CROSS BW', `${B169}; takeout = run and branch centre-to-end C`, { branchTakeout: mm(tee) })
      case 'W-RTEE':
      case 'W-RCRS': {
        const m = small == null ? tee : at(TEE_M[nps], small)?.[1]
        return m ? row('tee', nps, mm(tee), c === 'W-RTEE' ? 'REDUCING TEE BW' : 'REDUCING CROSS BW', `${B169} reducing outlet; takeout = run C, branch = outlet M`, { ...sized, branchTakeout: mm(m) }) : undefined
      }
      case 'W-LAT':
      case 'W-RLAT': {
        const l = at(LATERAL, nps)
        if (!l || (c === 'W-RLAT' && (small == null || small > nps))) return undefined
        return row('tee', nps, mm(l[1]), c === 'W-LAT' ? 'LATERAL 45 BW' : 'REDUCING LATERAL 45 BW', '45° lateral as catalogued (Bonney Forge); takeout = short-side C-E, branch and long side keyed by run size', { ...sized, branchTakeout: mm(l[2]) })
      }
      case 'C-RED':
      case 'E-RED': return reducing(nps, small) ? row('reducer', nps, mm(red) / 2, c === 'C-RED' ? 'REDUCER CONC BW' : 'REDUCER ECC BW', `${B169} reducer length H; takeout = H/2 from the centre node`, { ...sized, faceToFace: mm(red) }) : undefined
      case 'W-CAP': return row('cap', nps, mm(cap), 'CAP BW', `${B169} cap height E; node at the outer end, takeout = E`)
      case 'STUB-END':
      case 'STUB-END-SHORT': {
        const st = stubEnd(nps, c === 'STUB-END-SHORT', schedule)!
        return row('flange', nps, st.length, `STUB END, ${st.short ? 'MSS SP-43 SHORT' : 'B16.9 LONG'} PATTERN, LAP OD ${st.lapOd} MM`,
          `${st.short ? 'MSS SP-43 short pattern (type A)' : 'ASME B16.9 long pattern'} length F; takeout = F from the lap face; lap thickness = ${schedule ?? (st.short ? 'Sch 10S' : 'STD')} pipe wall`, { thickness: st.lapThickness })
      }
    }
  }
  if (/^[CE]-SW(AGE|G)$/.test(c)) {
    const l = at(SWAGE, nps)?.[1]
    return l && small != null && small < nps && isNps(small) ? row('reducer', nps, mm(l) / 2, c.startsWith('C') ? 'SWAGE CONC' : 'SWAGE ECC', 'MSS SP-95 swage length; takeout = half length', { ...sized, faceToFace: mm(l) }) : undefined
  }
  const sw = c.startsWith('SW-') || /SW$/.test(c), thd = c.startsWith('SC-') || /SC$/.test(c) || c === 'PLUG'
  if (!sw && !thd) return undefined
  const fc = forgedClass(cls, thd)
  if (!fc) return undefined
  const label = `${fc}#`, j = socketDepth(nps), e = engagement(nps), eng = e == null ? undefined : mm(e)
  const swSource = `ASME B16.11 Class ${fc} socket-weld; effective takeout = centre to socket bottom (pipe bottomed)`
  const thdSource = `ASME B16.11 Class ${fc} threaded; effective takeout = centre-to-end less NPT make-up engagement`
  const s = at(SW, nps), t = at(THD, nps), col = fc === 6000 ? 2 : 1
  const runSw = s?.[col] ? mm(s[col]) : undefined, run45 = s?.[col + 2] ? mm(s[col + 2]) : undefined
  const tc = fc === 2000 ? 1 : fc === 3000 ? 2 : 3, runThd = t?.[tc], thd45 = t?.[tc + 3]
  switch (c) {
    case 'SW-90ELL': return runSw ? row('elbow90', nps, runSw, `ELBOW 90 SW ${label}`, swSource, { socketDepth: j }) : undefined
    case 'SW-45ELL': return run45 ? row('elbow45', nps, run45, `ELBOW 45 SW ${label}`, swSource, { socketDepth: j }) : undefined
    case 'SW-TEE':
    case 'SW-CRS': return runSw ? row('tee', nps, runSw, `${c === 'SW-TEE' ? 'TEE' : 'CROSS'} SW ${label}`, swSource, { branchTakeout: runSw, socketDepth: j }) : undefined
    case 'SW-RTEE':
    case 'SW-RCRS':
      return runSw && small != null && small < nps && isNps(small)
        ? row('tee', nps, runSw, `REDUCING ${c === 'SW-RTEE' ? 'TEE' : 'CROSS'} SW ${label}`, `${swSource}; reducing outlet bored in the run-size body: branch = A + socket depth(run) - socket depth(outlet)`, { ...sized, branchTakeout: r2(runSw + j - socketDepth(small)), socketDepth: j })
        : undefined
    case 'SC-90ELL': return runThd && eng ? row('elbow90', nps, runThd - eng, `ELBOW 90 THD ${label}`, thdSource, { threadEngagement: eng }) : undefined
    case 'SC-45ELL': return thd45 && eng ? row('elbow45', nps, thd45 - eng, `ELBOW 45 THD ${label}`, thdSource, { threadEngagement: eng }) : undefined
    case 'SC-TEE':
    case 'SC-CRS': return runThd && eng ? row('tee', nps, runThd - eng, `${c === 'SC-TEE' ? 'TEE' : 'CROSS'} THD ${label}`, thdSource, { branchTakeout: r2(runThd - eng), threadEngagement: eng }) : undefined
    case 'SC-RTEE':
    case 'SC-RCRS': {
      const be = small != null && small < nps ? engagement(small) : undefined
      return runThd && eng && be != null ? row('tee', nps, runThd - eng, `REDUCING ${c === 'SC-RTEE' ? 'TEE' : 'CROSS'} THD ${label}`, `${thdSource}; reducing outlet in the run-size body`, { ...sized, branchTakeout: r2(runThd - mm(be)), threadEngagement: eng }) : undefined
    }
    case 'SW-CAP':
    case 'SC-CAP': {
      const k = at(CAP, nps)?.[(c === 'SW-CAP' ? 1 : 3) + (fc === 6000 ? 1 : 0)]
      return k ? row('cap', nps, mm(k), `CAP ${c === 'SW-CAP' ? 'SW' : 'THD'} ${fc === 2000 ? '3000#' : label}`, `ASME B16.11 Class ${fc === 6000 ? 6000 : 3000} cap; takeout = cap end beyond the pipe end (manufacturer length, Bonney Forge)`, c === 'SW-CAP' ? { socketDepth: j } : { threadEngagement: eng }) : undefined
    }
    case 'PLUG': {
      const p = at(PLUG, nps)?.[1]
      return p ? row('cap', nps, mm(p), 'PLUG, SQUARE HEAD, THD', 'ASME B16.11 square-head plug; takeout = thread length A (thread engagement)', { threadEngagement: mm(p) }) : undefined
    }
    case 'F-CPLGSW':
    case 'H-CPLGSW':
      return s && (fc === 3000 || s[2])
        ? row(c === 'F-CPLGSW' ? 'valve' : 'olet', nps, swCouplingGap(nps) / 2, `${c === 'F-CPLGSW' ? 'FULL' : 'HALF'} COUPLING SW ${label}`, `${swSource}; coupling: takeout = half the laying length E between socket bottoms${c === 'H-CPLGSW' ? ', measured from the header outside' : ''}`, { socketDepth: j })
        : undefined
    case 'F-CPLGSC':
    case 'H-CPLGSC': {
      const w = at(THD_COUPLING, nps)?.[1]
      return w && eng && fc !== 2000 ? row(c === 'F-CPLGSC' ? 'valve' : 'olet', nps, w / 2 - eng, `${c === 'F-CPLGSC' ? 'FULL' : 'HALF'} COUPLING THD ${label}`, `${thdSource}; coupling length W${c === 'H-CPLGSC' ? ' (half coupling W/2, from the header outside)' : ''}`, c === 'F-CPLGSC' ? { faceToFace: w, threadEngagement: eng } : { threadEngagement: eng }) : undefined
    }
    case 'UNION-SW':
    case 'UNION-SC': {
      const u = at(UNION, nps)?.[fc === 6000 ? 2 : 1]
      if (!u) return undefined
      const l = mm(u), end = c === 'UNION-SW' ? minSocket(nps) : eng
      return end == null ? undefined : row('valve', nps, (l - 2 * end) / 2, `UNION ${c === 'UNION-SW' ? 'SW' : 'THD'} ${fc === 2000 ? '3000#' : label}`, `MSS SP-83 Class ${fc === 6000 ? 6000 : 3000} union, laying length as catalogued; effective takeout = half the length less ${c === 'UNION-SW' ? 'B16.11 socket depth J' : 'thread engagement'}`, c === 'UNION-SW' ? { faceToFace: l, socketDepth: end } : { faceToFace: l, threadEngagement: end })
    }
  }
  return undefined
}
/** Stub end (mm): length F (B16.9 long or MSS SP-43 short pattern), lap OD G and lap thickness (pipe wall, Sch 10S for MSS SP-43 / STD for B16.9 unless `schedule`). */
export function stubEnd(nps: number, short: boolean, schedule?: string): { length: number; lapOd: number; lapThickness: number; short: boolean } | undefined {
  const b = at(BW, nps)
  const lapThickness = pipeWall(nps, schedule ?? (short ? '10S' : 'STD')) ?? pipeWall(nps, short ? '10S' : 'STD')
  return b && lapThickness != null ? { length: mm(short ? b[8] : b[7]), lapOd: mm(b[9]), lapThickness, short } : undefined
}
/** Gasket thickness (mm): ASME B16.20 spiral-wound (compressed) or ASME B16.21 non-metallic sheet. */
export function gasketThickness(type: 'spiral-wound' | 'sheet-1/16' | 'sheet-1/8'): number {
  return type === 'spiral-wound' ? 3.3 : type === 'sheet-1/16' ? mm(1 / 16) : mm(1 / 8)
}
