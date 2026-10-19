import type { Kind } from './model'
/**
 * Built-in standard dimensions so no standard piping component needs a manually entered length.
 * Tables are written in inches (snapped to 1/32 in) or millimetres as published; every lookup returns millimetres.
 * `takeout` follows model.ts: elbow/tee centre-to-end, reducer and valve half length, WN length through hub,
 * SO pipe set-back, blind thickness, gasket half thickness, cap height, stub-end length F, socket-weld and
 * threaded fittings the effective takeout (to socket bottom / less thread engagement).
 * B16.5 flange dimensions are measured from the gasket face: Class 150/300 include the 1.6 mm raised face,
 * Class 600 and above add the 6.4 mm raised face to the published thickness and hub length.
 *
 * Provenance: every row's `source` names its standard. Where no ASME/MSS/API table fixes a dimension (olet heights,
 * laterals, forged socket depths, forged caps, unions) the value is manufacturer data and its source says so
 * (`VENDOR`). Where a lookup needed something the caller did not give (a pressure class, a valve pattern, a pipe
 * wall), the row is still returned but `assumed` says what was assumed, so validation can ask for it. Nothing
 * falls back silently.
 */
export type FlangeFace = 'RF' | 'FF'
export type BoltType = 'stud' | 'machine'
export type ValvePattern = 'long' | 'short' | 'regular' | 'venturi'
export type ButterflyBody = 'wafer' | 'lug' | 'double-flanged'
/** API 609 Category A: concentric, resilient seated (Class 125/150). Category B: offset seat (Class 150–600). */
export type ButterflyCategory = 'A' | 'B'
/** A value with where it came from; `assumed` says what was taken for granted to get it. */
export interface Resolved<T> { value: T; source: string; assumed?: string }
/** Manufacturer data used where no ASME, MSS or API table fixes the dimension. */
export const VENDOR = 'manufacturer data (Bonney Forge catalogue; no ASME/MSS table fixes this dimension)'
/**
 * Socket-weld gap: the pipe is withdrawn about 1/16 in (1.6 mm) from the socket bottom before welding
 * (ASME B31.3 Fig. 328.5.2C, ASME B16.11). Use where a specification sets no `socketGap`.
 */
export const SOCKET_WELD_GAP = 1.6
/**
 * Gasket thicknesses (mm). ASME B16.20 spiral-wound gaskets are wound 4.5 mm (0.175 in) thick and compress to the
 * recommended 3.3 mm (0.13 in) when bolted up; the compressed thickness is the one in a joint. ASME B16.21 sheet
 * gaskets are cut 1/16 in or 1/8 in thick.
 */
export const GASKET_THICKNESS = { spiralWoundWinding: 4.5, spiralWoundCompressed: 3.3, sheet116: 1.59, sheet18: 3.18 } as const
/** Options a specification supplies to fix a standard dimension; each is optional and its absence is reported. */
export interface StandardOptions {
  /** ASME B16.11 class (2000, 3000, 6000, 9000) of socket-weld and threaded fittings; else read from `rating`. */
  forgedClass?: number
  /** ASME B16.10 pattern of a flanged ball or plug valve. */
  valvePattern?: ValvePattern
  butterflyBody?: ButterflyBody
  butterflyCategory?: ButterflyCategory
  /** Compressed gasket thickness (mm) the specification names. */
  gasketThickness?: number
  boltType?: BoltType
  /** Weldolet weight (STD or XS) the specification names; else it follows the branch wall. */
  oletSchedule?: string
  /**
   * Slip-on flanges: the pipe end's set-back from the flange face (mm) a catalogue row or the specification states,
   * in place of the default rule (see `slipOnSetBack`); `setBackSource` names where it comes from.
   */
  slipOnSetBack?: number
  setBackSource?: string
  /** Slip-on flanges: a clearance (mm) the specification adds to the default set-back rule. Default 0. */
  slipOnClearance?: number
  /** Lug bolting: engagement in bolt diameters and threads beyond the nut (see `lugBolt`). */
  lugBoltEngagement?: number
  lugBoltProjection?: number
  /** Stated when `rating` itself was assumed by the caller (no class in the specification). */
  ratingAssumed?: string
}
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
  /** Branch outlets: height A from the outlet end to the run pipe's outside, which `takeout` is measured from. */
  height?: number
  takeoutReference?: 'header-outside'
  /** 180° returns: centre-to-centre O and back-to-face K (ASME B16.9). */
  centreToCentre?: number
  backToFace?: number
  /** Valve pattern, butterfly body type and API 609 category the dimensions are for. */
  valvePattern?: ValvePattern
  bodyType?: ButterflyBody
  valveCategory?: ButterflyCategory
  description: string
  source: string
  /**
   * How the takeout is known when it is not a standard table value: 'calculated' by a documented rule (a slip-on
   * set-back), or set by the 'specification' (its design values, a row's set-back). Absent for table values.
   */
  dimensionBasis?: 'specification' | 'calculated'
  /** What was assumed to give this row (a class, a pattern, a wall); absent when every input was given. */
  assumed?: string
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
  kind: 'stud' | 'lug' | 'machine'
  /** Lug bolting as hex-head cap screws (the specification's bolt type is machine bolts): no nut, the head on the flange. */
  capScrews?: boolean
  /**
   * What the length is: 'standard', a published table (ASME B16.5 flange-pair studs and machine bolts); 'calculated',
   * a stated length formula where no table gives one (lap-joint pairs, wafer bodies, lug bodies).
   */
  basis: 'standard' | 'calculated'
  /** The table or the stated length method the length comes from. */
  source: string
  /** Only for data that was missing or ambiguous (a lap thickness, a butterfly category that changes the length). */
  assumed?: string
}
export interface BoltingOptions {
  /** Stub-end lap thickness (mm): lap-joint pairs, and a lap-joint flange bolted to a lug or wafer body. */
  lap?: number
  /** Compressed gasket thickness (mm) at each face. */
  gasket?: number
  /** Valve body face-to-face (mm) for wafer and lug bodies; else the API 609 length of `category`. */
  body?: number
  category?: ButterflyCategory
  /** Lug bolts into a tapped body of unknown length (equipment, a lugged mate off this drawing): no half-body limit. */
  tapped?: boolean
  /** Lug bolts: thread engagement in the tapped body, in bolt diameters (default `LUG_BOLT.engagement`, one). */
  engagement?: number
  /** Lug studs: full threads projecting beyond the nut (default `LUG_BOLT.projectionThreads`, two). */
  projectionThreads?: number
  /** Inch (ASME B1.1 threads, lengths in 1/4 in steps, the default) or metric (ISO 261 threads, 5 mm steps) bolting. */
  system?: 'inch' | 'metric'
  /**
   * Machine bolts instead of stud bolts for flange pairs (B16.5 lists their lengths for Class 150 and 300); into a lug
   * body, hex-head cap screws with no nut instead of lug studs with one nut each.
   */
  type?: BoltType
}
export type BoltMakeup = 'flange-pair' | 'lj-pair' | 'lug-valve-side' | 'wafer-valve'
const r2 = (v: number) => Math.round(v * 100) / 100
/** Published inch value (2-decimal fractions) → millimetres. */
const mm = (inch: number) => r2((Math.round(inch * 32) * 25.4) / 32)
/** Inch value → millimetres to 0.01, rounding half up as B36.10M does (0.375 in = 9.53 mm). */
const mmx = (inch: number) => Math.round(inch * 2540 + 1e-6) / 100
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
  [24, 0.218, 0.25, 0.375, 0.5, 0.688, 0.969, 1.219, 1.812, 2.344, 0],
  // NPS 26–48: standard weight and extra strong only (the other schedules there are not tabulated here).
  ...[26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48].map(n => [n, 0, 0, 0.375, 0.5, 0, 0, 0, 0, 0, 0])
]
const WALL_COLUMNS = ['5S', '10S', 'STD', 'XS', '40', '60', '80', '120', '160', 'XXS']
/** ASME B36.10M schedules listed only for the larger sizes (in): Sch 10, 20, 30, 100, 140. */
const WALL_LARGE: Record<string, number[][]> = {
  10: [[14, 0.25], [16, 0.25], [18, 0.25], [20, 0.25], [22, 0.25], [24, 0.25]],
  20: [[8, 0.25], [10, 0.25], [12, 0.25], [14, 0.312], [16, 0.312], [18, 0.312], [20, 0.375], [22, 0.375], [24, 0.375]],
  30: [[8, 0.277], [10, 0.307], [12, 0.33], [14, 0.375], [16, 0.375], [18, 0.438], [20, 0.5], [22, 0.5], [24, 0.562]],
  100: [[8, 0.594], [10, 0.719], [12, 0.844], [14, 0.938], [16, 1.031], [18, 1.156], [20, 1.281], [22, 1.375], [24, 1.531]],
  140: [[8, 0.812], [10, 1], [12, 1.125], [14, 1.25], [16, 1.438], [18, 1.562], [20, 1.75], [22, 1.875], [24, 2.062]]
}
/** ASME B36.10M outside diameter (in). */
const OD = [[0.125, 0.405], [0.25, 0.54], [0.375, 0.675], [0.5, 0.84], [0.75, 1.05], [1, 1.315], [1.25, 1.66], [1.5, 1.9], [2, 2.375],
  [2.5, 2.875], [3, 3.5], [3.5, 4], [4, 4.5], [5, 5.563], [6, 6.625], [8, 8.625], [10, 10.75], [12, 12.75]]
/** Pipe outside diameter (mm, ASME B36.10M); NPS 14 to 48 equal their size in inches. */
export function pipeOd(nps: number): number | undefined {
  return nps >= 14 && at(WALL, nps) ? mmx(nps) : (v => v == null ? undefined : mmx(v))(at(OD, nps)?.[1])
}
/** Nominal pipe wall (mm) for a schedule ('STD', 'XS', 'XXS', '5S', '10S', '40S', '80S', '10'…'160', 'SCH.80', 'SCH 160'…); undefined if not listed. */
export function pipeWall(nps: number, schedule = 'STD'): number | undefined {
  const s = schedule.toUpperCase().replace(/^SCH(EDULE)?\.?\s*/, '').replace(/\.$/, '').trim()
  const large = at(WALL_LARGE[s], nps)?.[1]
  if (large) return mmx(large)
  const i = WALL_COLUMNS.indexOf(s === '40S' ? 'STD' : s === '80S' ? 'XS' : s) + 1, r = at(WALL, nps)
  return i && r?.[i] ? mmx(r[i]) : undefined
}
/**
 * The wall of `schedule`, or of `fallback` with the assumption stated when the schedule is missing or not listed
 * at this size. `what` names the dimension the wall is for.
 */
function wallFor(nps: number, schedule: string | undefined, fallback: string, what: string): { wall?: number; assumed?: string } {
  const own = schedule ? pipeWall(nps, schedule) : undefined
  if (own != null) return { wall: own }
  const wall = pipeWall(nps, fallback)
  return {
    wall,
    assumed: wall == null ? undefined : schedule
      ? `${what} uses the ${fallback} wall because schedule ${schedule} has no ASME B36.10M/B36.19M wall at this size`
      : `${what} uses the ${fallback} wall because no pipe schedule was given`
  }
}
// ---- ASME B16.5 (inches). [nps, O, C, Y weld neck, Y slip-on/SW/THD (0 = none), Y lapped, bolt circle, bolts, bolt dia, stud length, machine bolt]
// Class 150/300 C and Y include the 0.06 in raised face; Class 600+ exclude the 0.25 in raised face (added in flange()).
// Thicknesses are the traditional ASME B16.5-1996 values still used by flange makers (later editions round some up).
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
/**
 * NPT make-up thread engagement (in, hand-tight plus wrench), the common pipe-fitter thread-engagement chart. It is
 * approximate: ASME B1.20.1 fixes the gauge lengths L1 and L3, not a made-up length. A specification row's
 * `threadEngagement` overrides it.
 */
const ENGAGE = [
  [0.125, 0.25], [0.25, 0.375], [0.375, 0.375], [0.5, 0.5], [0.75, 0.5625], [1, 0.6875], [1.25, 0.6875],
  [1.5, 0.6875], [2, 0.75], [2.5, 0.9375], [3, 1], [3.5, 1.0625], [4, 1.125], [5, 1.25], [6, 1.3125],
  [8, 1.4375], [10, 1.625], [12, 1.75], [14, 1.9375], [16, 2.1875], [18, 2.375], [20, 2.5], [22, 2.625], [24, 2.75]
]
const engagement = (nps: number) => at(ENGAGE, nps)?.[1]
const FLANGE_CLASSES = [150, 300, 600, 900, 1500]
/**
 * B16.5 flange class for a rating; undefined for a rating without a class ('', 'Project specified') and for a class
 * these tables do not cover (400, 2500). Callers that must go on without a class assume one and say so.
 */
export const flangeClass = (rating: string | number | undefined) => {
  const c = ratingClass(rating)
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
// ---- API 609 butterfly valve face-to-face (mm), lug and wafer bodies.
/** Category A (concentric, resilient seated), Class 125/150 flanges; the ISO 5752 Series 20 lengths. */
const API609_A = [[1.5, 33], [2, 43], [2.5, 46], [3, 46], [4, 52], [5, 56], [6, 56], [8, 60], [10, 68], [12, 78], [14, 78], [16, 102], [18, 114], [20, 127], [24, 154]]
/** Category B (offset seat, high performance) by flange class. */
const API609_B: Record<number, number[][]> = {
  150: [[3, 48], [4, 54], [6, 57], [8, 64], [10, 71], [12, 81], [14, 92], [16, 102], [18, 114], [20, 127], [24, 154]],
  300: [[3, 48], [4, 54], [6, 59], [8, 73], [10, 83], [12, 92], [14, 117], [16, 133], [18, 149], [20, 159], [24, 181]]
}
/**
 * The API 609 category of a lug or wafer butterfly valve at a class: as given, else the only one the class has
 * (Category B above Class 150), else Category A assumed at Class 150.
 */
export function butterflyCategory(cls: number, given?: ButterflyCategory): Resolved<ButterflyCategory> | undefined {
  if (given) return given === 'A' && cls !== 150 ? undefined : { value: given, source: `API 609 Category ${given}` }
  if (cls !== 150) return API609_B[cls] ? { value: 'B', source: `API 609 Category B (the only category for Class ${cls})` } : undefined
  return { value: 'A', source: 'API 609 Category A', assumed: 'API 609 Category A (concentric) butterfly valve assumed because no category was given (Category B bodies are longer)' }
}
/** API 609 lug/wafer face-to-face (mm) for a category and class. */
export const butterflyLength = (nps: number, cls: number, category: ButterflyCategory) =>
  at(category === 'A' ? (cls === 150 ? API609_A : undefined) : API609_B[cls], nps)?.[1]
/**
 * Defaults of the lug-bolt rule (`lugBolt`). A specification sets its own with the `lugBoltEngagement` and
 * `lugBoltProjection` design values.
 */
export const LUG_BOLT = {
  /** Thread engagement in the tapped body, in bolt diameters. */
  engagement: 1,
  /** Full threads a lug stud stands beyond its nut. */
  projectionThreads: 2
} as const
/** B16.5 gasket allowance (in) of its bolt-length method, used where no gasket thickness is given. */
const B165_GASKET = 0.12
/** Threads per inch of inch bolting: UNC coarse to 1 in, and the 8-thread series above it, as ASME B16.5 names (ASME B1.1). */
const UNC = [[0.25, 20], [0.3125, 18], [0.375, 16], [0.4375, 14], [0.5, 13], [0.5625, 12], [0.625, 11], [0.75, 10], [0.875, 9], [1, 8]]
/** ISO 261 coarse thread pitch (mm) by metric bolt diameter. */
const ISO_COARSE = [[6, 1], [8, 1.25], [10, 1.5], [12, 1.75], [14, 2], [16, 2], [20, 2.5], [22, 2.5], [24, 3], [27, 3], [30, 3.5],
  [33, 3.5], [36, 4], [39, 4], [42, 4.5], [45, 4.5], [48, 5], [52, 5], [56, 5.5], [64, 6]]
const nearest = (rows: number[][], v: number) => rows.reduce((a, b) => Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a)
/** Thread pitch (mm) of a bolt of this diameter (mm): ASME B1.1 UNC/8UN for inch bolting, ISO 261 coarse for metric. */
export function threadPitch(diameter: number, system: 'inch' | 'metric' = 'inch'): number {
  if (system === 'metric') return nearest(ISO_COARSE, diameter)[1]
  const d = diameter / 25.4
  return 25.4 / (d > 1 + 1e-6 ? 8 : nearest(UNC, d)[1])
}
export interface LugBoltInput {
  /** Thickness clamped under the nut or head (mm): the flange at its gasket face, with a stub-end lap under a lap-joint flange. */
  flange: number
  /** Compressed gasket thickness (mm). */
  gasket: number
  /** Bolt diameter (mm). */
  diameter: number
  /** Face-to-face of the lugged body (mm), when known: bolts from both sides share each tapped hole. */
  body?: number
  /** Hex-head cap screws: the head bears on the flange, so no nut and no projection. */
  capScrews?: boolean
  /** Engagement in bolt diameters (default `LUG_BOLT.engagement`). */
  engagement?: number
  /** Threads beyond the nut (default `LUG_BOLT.projectionThreads`). */
  projectionThreads?: number
  system?: 'inch' | 'metric'
}
/**
 * One side's lug-bolt length. No ASME or API table gives lug-bolt lengths (API 609 fixes the body, not its bolting),
 * so it is calculated by the rule for bolting into a tapped body, the same build-up as the ASME B16.5 bolt-length
 * method with the second flange replaced by the tapped thread:
 *
 *   L = F + G + E + P, rounded up to 1/4 in (5 mm for metric bolting)
 *   F  the flange thickness at the gasket face (a lap-joint flange plus its stub-end lap)
 *   G  the compressed gasket
 *   E  thread engagement: k bolt diameters, k = 1 by default (one diameter develops a steel stud's strength in a
 *      steel tapped hole; ASME BPVC VIII-1 UG-43(g) asks at least one stud diameter, more in a weaker tapped
 *      material), but no more than half the body face-to-face, since the bolts from each side meet in a
 *      through-tapped lug
 *   P  a stud's projection: one heavy hex nut, taken as one bolt diameter thick as the B16.5 method takes it
 *      (ASME B18.2.2 heavy nuts are d - 1/64 in), and n full threads (ASME B1.1 UNC/8UN or ISO 261 pitch) beyond
 *      it, n = 2 by default, so the stud stands right through its nut as ASME PCC-1 asks; a cap screw has none,
 *      its head bearing on the flange
 *
 * k and n are the specification's `lugBoltEngagement` and `lugBoltProjection`. A specification lug-bolt row, or
 * the valve maker's bolting chart entered as one, always wins over this rule.
 */
export function lugBolt(i: LugBoltInput): { length: number; exact: number; engagement: number; limited: boolean; source: string } {
  const k = i.engagement ?? LUG_BOLT.engagement, threads = i.projectionThreads ?? LUG_BOLT.projectionThreads
  const full = k * i.diameter, half = i.body != null ? i.body / 2 : Infinity
  const engagement = Math.min(full, half), limited = half < full
  const nut = i.capScrews ? 0 : i.diameter, projection = i.capScrews ? 0 : threads * threadPitch(i.diameter, i.system)
  const exact = i.flange + i.gasket + engagement + nut + projection, metric = i.system === 'metric'
  const length = metric ? Math.ceil(exact / 5 - 1e-9) * 5 : mm(upQuarter(exact / 25.4))
  const parts = [`flange ${r2(i.flange)}`, `gasket ${r2(i.gasket)}`,
    `engagement ${r2(engagement)} (${limited ? `half the ${r2(i.body!)} mm body` : `${k} x bolt diameter`})`,
    ...(i.capScrews ? [] : [`nut ${r2(nut)}`, `${threads} threads ${r2(projection)}`])]
  return {
    length, exact: r2(exact), engagement: r2(engagement), limited,
    source: `calculated by the tapped-body rule (no ASME or API table gives lug-bolt lengths): ${parts.join(' + ')} = ${r2(exact)} mm${i.capScrews ? ' (cap screws: no nut)' : ''}, rounded up to ${metric ? '5 mm' : '1/4 in'}`
  }
}
/**
 * Bolting for one flanged joint, inch sizes converted to mm. Flange-pair studs and machine bolts are the published
 * ASME B16.5 table lengths (`basis` 'standard'). The other makeups are calculated (`basis` 'calculated'):
 * - 'lj-pair': two lap-joint flanges and two stub-end laps by the B16.5 bolt-length method: per flange its thickness
 *   C plus the thickness tolerance T (0.12 in to NPS 18, 0.19 in above) and one heavy nut (height = bolt diameter d),
 *   plus the gasket (`gasket`, else the method's 0.12 in allowance), the laps (`lap`, mm) and the point projection
 *   n = 0.06 in; rounded to the nearest 1/4 in as B16.5 rounds its table. Without `lap` the STD wall is assumed and said.
 * - 'wafer-valve': through studs by the same method spanning both flanges, both gaskets and the wafer body, rounded
 *   up to 1/4 in. The body is `body` (the valve's own face-to-face), else the API 609 length of `category`.
 * - 'lug-valve-side': one side of a lug body or tapped mate by `lugBolt`. `body` (else, for a lug valve that is not
 *   `tapped`, the API 609 length of `category`) only limits the engagement; a category assumed is said only when that
 *   limit decides the length. `type` 'machine' gives cap screws.
 */
export function bolting(nps: number, rating: string | number | undefined, face: FlangeFace, makeup: BoltMakeup, opts: BoltingOptions = {}): Bolting | undefined {
  const cls = flangeClass(rating), r = cls ? at(B165[cls], nps) : undefined
  if (!cls || !r) return undefined
  const [, c, , , , , count, d, stud, machine] = r.slice(1), low = cls <= 300
  if (face === 'FF' && !low && makeup !== 'lj-pair') return undefined
  const diameter = mm(d), t = nps <= 18 ? 0.12 : 0.19, n = 0.06, tf = c + (low ? 0 : 0.25)
  const g = opts.gasket != null ? opts.gasket / 25.4 : B165_GASKET, gasketNote = opts.gasket != null ? `${r2(opts.gasket)} mm gaskets` : '0.12 in gasket allowance'
  if (makeup === 'flange-pair') {
    if (opts.type === 'machine')
      return machine ? { count, diameter, length: mm(machine), kind: 'machine', basis: 'standard', source: `ASME B16.5 Class ${cls} machine-bolt length` } : undefined
    return { count, diameter, length: mm(stud), kind: 'stud', basis: 'standard', source: `ASME B16.5 Class ${cls} stud-bolt length` }
  }
  if (makeup === 'lj-pair') {
    const std = pipeWall(nps, 'STD') ?? 0, lap = (opts.lap ?? std) / 25.4
    return {
      count, diameter, length: mm(quarter(2 * ((low ? c - 1 / 16 : c) + t + d) + 2 * lap + g + n)), kind: 'stud', basis: 'calculated',
      source: `calculated by the ASME B16.5 bolt-length method: two lap-joint flanges and nuts, two stub-end laps, ${gasketNote}, rounded to 1/4 in`,
      ...(opts.lap == null || opts.type === 'machine' ? {
        assumed: [opts.lap == null ? 'lap-joint studs assume STD-wall stub-end laps because no lap thickness was given' : '',
          opts.type === 'machine' ? 'stud bolts are sized for lap-joint pairs because B16.5 tabulates machine bolts for weld-neck pairs only' : ''].filter(Boolean).join('; ')
      } : {})
    }
  }
  // A lap-joint flange (no raised face) clamps its stub-end lap: both are in the grip.
  const lapped = opts.lap != null, grip = lapped ? (low ? c - 1 / 16 : c) + opts.lap! / 25.4 : tf
  if (makeup === 'lug-valve-side') {
    const cat = opts.body == null && !opts.tapped ? butterflyCategory(cls, opts.category) : undefined
    const body = opts.body ?? (cat ? butterflyLength(nps, cls, cat.value) : undefined)
    const screws = opts.type === 'machine'
    const lug = lugBolt({
      flange: lapped ? mm(low ? c - 1 / 16 : c) + opts.lap! : mm(tf), gasket: opts.gasket ?? r2(B165_GASKET * 25.4), diameter, body, capScrews: screws,
      engagement: opts.engagement, projectionThreads: opts.projectionThreads, system: opts.system
    })
    return {
      count, diameter, length: lug.length, kind: 'lug', ...(screws ? { capScrews: true } : {}), basis: 'calculated', source: lug.source,
      ...(lug.limited && cat?.assumed ? { assumed: cat.assumed } : {})
    }
  }
  const lapNote = lapped ? ' (lap-joint flanges and stub-end laps)' : ''
  const cat = opts.body == null ? butterflyCategory(cls, opts.category) : undefined
  const body = opts.body ?? (cat ? butterflyLength(nps, cls, cat.value) : undefined)
  if (body == null) return undefined
  const bodyNote = opts.body != null ? `the valve's ${r2(body)} mm body` : `the ${cat!.source} ${body} mm body`
  return {
    count, diameter, length: mm(upQuarter(2 * (grip + t + d) + 2 * g + body / 25.4 + n)), kind: 'stud', basis: 'calculated',
    source: `calculated by the ASME B16.5 bolt-length method through both flanges${lapNote}, ${gasketNote} and ${bodyNote}, rounded up to 1/4 in`,
    ...(cat?.assumed ? { assumed: cat.assumed } : {})
  }
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
/** Smallest small end of ASME B16.9 concentric and eccentric reducers (in). */
const REDUCER_MIN = [
  [0.5, 0.25], [0.75, 0.375], [1, 0.5], [1.25, 0.5], [1.5, 0.5], [2, 0.75], [2.5, 1], [3, 1.25], [3.5, 1.25], [4, 1.5],
  [5, 2], [6, 2.5], [8, 3.5], [10, 4], [12, 5], [14, 6], [16, 6], [18, 8], [20, 8], [22, 10], [24, 10]
]
/** Smallest small end of ASME B16.9 long-radius reducing elbows (in). */
const REDELL_MIN = [
  [2, 1.25], [2.5, 1.25], [3, 1.5], [3.5, 2], [4, 2], [5, 2.5], [6, 3], [8, 4], [10, 5], [12, 6], [14, 8], [16, 10], [18, 10], [20, 10], [24, 12]
]
/** ASME B16.9 180° returns (in): [nps, LR centre-to-centre O, LR back-to-face K, SR O, SR K]; 0 = not made. */
const RETURN = [
  [0.5, 3, 1.88, 0, 0], [0.75, 2.25, 1.69, 0, 0], [1, 3, 2.19, 2, 1.62], [1.25, 3.75, 2.75, 2.5, 2.06], [1.5, 4.5, 3.25, 3, 2.44],
  [2, 6, 4.19, 4, 3.19], [2.5, 7.5, 5.19, 5, 3.94], [3, 9, 6.25, 6, 4.75], [3.5, 10.5, 7.25, 7, 5.5], [4, 12, 8.25, 8, 6.25],
  [5, 15, 10.31, 10, 7.75], [6, 18, 12.31, 12, 9.31], [8, 24, 16.31, 16, 12.31], [10, 30, 20.38, 20, 15.38], [12, 36, 24.38, 24, 18.38],
  [14, 42, 28, 28, 21], [16, 48, 32, 32, 24], [18, 54, 36, 36, 27], [20, 60, 40, 40, 30], [22, 66, 44, 44, 33], [24, 72, 48, 48, 36]
]
/**
 * Centre-to-end (tangent length, mm) of an elbow or bend of centreline radius R (mm) turning θ radians: R·tan(θ/2),
 * the distance along each tangent from the work point, where the centrelines meet, to where the arc starts. A 90°
 * turn takes out R and a 45° R·tan 22.5° (0.414 R). Fittings with a published centre-to-end use the table (ASME B16.9
 * LR, SR and 3D elbows); this gives 3D elbows beyond the table, and formed pipe bends of any radius and angle
 * (model.ts `bendTakeout`).
 */
export const tangentLength = (radius: number, theta: number) => radius * Math.tan(theta / 2)
/** Centreline radius (mm) of a 3D elbow: three times the nominal size, R = 3 x NPS inches. */
export const threeDRadius = (nps: number) => mmx(3 * nps)
/**
 * ASME B16.9 3D elbows (R = 3 x NPS), centre-to-end (in): [nps, 90° A, 45° B], the US customary values B16.9 lists,
 * NPS 3/4 to 48. 3D elbows start at NPS 3/4; B16.9 lists none smaller. Transcribed from the published table (as
 * reproduced by metalspiping.com "ASME B16.9 3D Elbows"); the SI column (FGS Steel, Ferrobend and wermac.org B16.9
 * 3D elbow tables) agrees with every row to the millimetre, but for NPS 30 45°, where some copies print 964 mm, a
 * transposition of the 946 mm that 37.25 in and the geometry both give.
 */
const B169_3D = [
  [0.75, 2.25, 0.94], [1, 3, 1.25], [1.25, 3.75, 1.56], [1.5, 4.5, 1.88], [2, 6, 2.5], [2.5, 7.5, 3.12], [3, 9, 3.75],
  [3.5, 10.5, 4.38], [4, 12, 5], [5, 15, 6.19], [6, 18, 7.44], [8, 24, 9.94], [10, 30, 12.44], [12, 36, 14.88],
  [14, 42, 17.38], [16, 48, 19.88], [18, 54, 22.38], [20, 60, 24.88], [22, 66, 27.31], [24, 72, 29.81], [26, 78, 32.31],
  [28, 84, 34.75], [30, 90, 37.25], [32, 96, 39.75], [36, 108, 44.69], [42, 126, 52.19], [48, 144, 59.69]
]
/** ASME B16.9 3D elbows (mm), SI values, for the sizes whose inch values are not transcribed above: [nps, 90° A, 45° B]. */
const B169_3D_SI = [[34, 2591, 1073], [38, 2896, 1200], [40, 3048, 1264], [44, 3353, 1389], [46, 3505, 1453]]
/**
 * A 3D elbow's centre-to-end (mm) and where it comes from: the ASME B16.9 table, else, for a size B16.9 does not list
 * (above NPS 48), the elbow's geometry by `tangentLength` with R = 3 x NPS (R for a 90°, R tan 22.5° for a 45°).
 * Below NPS 3/4 there are no 3D elbows.
 */
function threeDElbow(nps: number, degrees: 45 | 90): { takeout: number; source: string; calculated?: true } | undefined {
  if (nps < 0.75) return undefined
  const letter = degrees === 90 ? 'A' : 'B', inch = at(B169_3D, nps), si = at(B169_3D_SI, nps)
  if (inch) return { takeout: mm(inch[degrees === 90 ? 1 : 2]), source: `${B169} 3D elbow (R = 3 x NPS); takeout = centre-to-end ${letter}` }
  if (si) return { takeout: si[degrees === 90 ? 1 : 2], source: `${B169} 3D elbow (R = 3 x NPS), SI table; takeout = centre-to-end ${letter}` }
  return {
    takeout: r2(tangentLength(threeDRadius(nps), degrees * Math.PI / 180)), calculated: true,
    source: `3D elbow, R = 3 x NPS; takeout = R tan(${degrees}°/2)${degrees === 90 ? ' = R' : ''}, calculated from the elbow geometry (ASME B16.9 lists 3D elbows to NPS 48)`
  }
}
const threeDRow = (nps: number, degrees: 45 | 90) => {
  const t = threeDElbow(nps, degrees)
  return t && row(degrees === 90 ? 'elbow90' : 'elbow45', nps, t.takeout, `ELBOW ${degrees} 3D BW`, t.source, t.calculated ? { dimensionBasis: 'calculated' } : {})
}
/** ASME B16.9 180° return (mm): centre-to-centre O, back-to-face K and the bend radius (O/2) one 90° half takes out. */
export function returnBend(nps: number, radius: 'LR' | 'SR'): { centreToCentre: number; backToFace: number; radius: number; source: string } | undefined {
  const r = at(RETURN, nps), o = r?.[radius === 'LR' ? 1 : 3], k = r?.[radius === 'LR' ? 2 : 4]
  return o && k ? { centreToCentre: mm(o), backToFace: mm(k), radius: mm(o / 2), source: `ASME B16.9 ${radius === 'LR' ? 'long' : 'short'}-radius 180° return: centre-to-centre O, back-to-face K` } : undefined
}
/** ASME B16.9 cap (in): [nps, limiting wall for length E, E1 for heavier walls]. The limiting wall is the XS wall. */
const CAP_E1 = [
  [0.5, 0.18, 1], [0.75, 0.15, 1], [1, 0.18, 1.5], [1.25, 0.19, 1.5], [1.5, 0.2, 1.5], [2, 0.22, 1.75], [2.5, 0.28, 2], [3, 0.3, 2.5],
  [3.5, 0.32, 3], [4, 0.34, 3], [5, 0.38, 3.5], [6, 0.43, 4], [8, 0.5, 5], [10, 0.5, 6], [12, 0.5, 7], [14, 0.5, 7.5], [16, 0.5, 8],
  [18, 0.5, 9], [20, 0.5, 10], [22, 0.5, 10.5], [24, 0.5, 10.5]
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
/** 45° butt-weld laterals, manufacturer data (no ASME table): [nps, short-side C-E, long-side and branch C-E] (in). */
const LATERAL = [[1, 2.5, 6.5], [1.25, 2.75, 7], [1.5, 3, 8], [2, 4, 8.5], [2.5, 4.5, 10], [3, 5, 11], [3.5, 5.5, 12], [4, 6, 13], [5, 7, 14.5], [6, 8, 16.5], [8, 10, 20], [10, 12, 23], [12, 13, 27], [14, 14, 30], [16, 16, 33], [18, 17, 36]]
/**
 * MSS SP-97 integrally reinforced branch outlets, manufacturer heights (MSS SP-97 fixes the outlet ends, not the
 * height): height A from the outlet end to the run pipe's outside at the branch centreline (in).
 * [nps, weldolet STD, weldolet XS, sockolet/thredolet 3000, 6000]; 0 = not made.
 */
const OLET = [
  [0.5, 0.75, 0.75, 1, 1.25], [0.75, 0.88, 0.88, 1.06, 1.44], [1, 1.06, 1.06, 1.31, 1.56], [1.25, 1.25, 1.25, 1.31, 1.62],
  [1.5, 1.31, 1.31, 1.38, 1.69], [2, 1.5, 1.5, 1.5, 2.06], [2.5, 1.62, 1.62, 1.81, 0], [3, 1.75, 1.75, 2, 0], [3.5, 1.88, 1.88, 2.12, 0],
  [4, 2, 2, 2.25, 0], [5, 2.25, 2.25, 0, 0], [6, 2.38, 3.06, 0, 0], [8, 2.75, 3.88, 0, 0], [10, 3.06, 3.69, 0, 0], [12, 3.38, 4.06, 0, 0],
  [14, 3.5, 3.94, 0, 0], [16, 3.69, 4.19, 0, 0], [18, 3.81, 4.38, 0, 0], [20, 4, 4.69, 0, 0], [24, 4.56, 5.5, 0, 0]
]
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
/**
 * B16.10 column of each valve code. A code with more than one pattern (BALL-FL, PLUG-FL) takes the pattern the row or
 * specification names; where the patterns differ at a size and none is named, the first is assumed and stated.
 */
const VALVE: Record<string, { patterns: Partial<Record<ValvePattern, number>>; column?: number; name: string }> = {
  'GATE-FL': { patterns: {}, column: 1, name: 'GATE VALVE, FLANGED' },
  'GLOBE-FL': { patterns: {}, column: 2, name: 'GLOBE VALVE, FLANGED' },
  'CHECK-FL': { patterns: {}, column: 3, name: 'SWING CHECK VALVE, FLANGED' },
  'BALL-FL': { patterns: { long: 4, short: 5 }, name: 'BALL VALVE, FLANGED' },
  'BALL-FL-LONG': { patterns: { long: 4 }, name: 'BALL VALVE, FLANGED' },
  'BALL-FL-SHORT': { patterns: { short: 5 }, name: 'BALL VALVE, FLANGED' },
  'PLUG-FL': { patterns: { regular: 7, short: 6 }, name: 'PLUG VALVE, FLANGED' },
  'PLUG-FL-SHORT': { patterns: { short: 6 }, name: 'PLUG VALVE, FLANGED' },
  'PLUG-FL-REGULAR': { patterns: { regular: 7 }, name: 'PLUG VALVE, FLANGED' },
  'GATE-BW': { patterns: {}, column: 8, name: 'GATE VALVE, BUTT-WELD' },
  'GLOBE-BW': { patterns: {}, column: 9, name: 'GLOBE VALVE, BUTT-WELD' }
}
// ---- ASME B16.11 forged fittings.
/** Socket-weld centre to socket bottom (in): [nps, 90/tee 3000, 90/tee 6000, 45 3000, 45 6000]. */
const SW = [
  [0.125, 0.44, 0.44, 0.31, 0.31], [0.25, 0.44, 0.53, 0.31, 0.31], [0.375, 0.53, 0.62, 0.31, 0.44],
  [0.5, 0.62, 0.75, 0.44, 0.5], [0.75, 0.75, 0.88, 0.5, 0.56], [1, 0.88, 1.06, 0.56, 0.69],
  [1.25, 1.06, 1.25, 0.69, 0.81], [1.5, 1.25, 1.5, 0.81, 1], [2, 1.5, 1.62, 1, 1.12],
  [2.5, 1.62, 0, 1.12, 0], [3, 2.25, 0, 1.25, 0], [4, 2.62, 0, 1.62, 0]
]
/**
 * Socket depth of forged socket-weld items as made, manufacturer data (B16.11 fixes only a minimum J, which these
 * exceed). One table serves every socket-weld item, so derived takeouts (sockolet, union, reducing outlet) agree.
 */
const FORGED_SOCKET = [[0.125, 0.375], [0.25, 0.375], [0.375, 0.4375], [0.5, 0.5], [0.75, 0.5625], [1, 0.625], [1.25, 0.6875], [1.5, 0.75], [2, 0.875], [2.5, 0.875], [3, 1], [4, 1.125]]
const socketDepth = (nps: number) => (v => (v ? mm(v) : undefined))(at(FORGED_SOCKET, nps)?.[1])
const SOCKET_SOURCE = `socket depth J as made, ${VENDOR}`
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
/** MSS SP-83 union laying length (in), manufacturer data (MSS SP-83 fixes the ends and strength, not the length): [nps, 3000, 6000]. */
const UNION = [[0.375, 2, 0], [0.5, 2.125, 2.875], [0.75, 2.3125, 3.375], [1, 2.5, 3.625], [1.25, 2.8125, 3.875], [1.5, 3.125, 4.1875], [2, 3.5, 4.625]]
/** Cap end beyond the pipe end (in), manufacturer lengths (B16.11 fixes only the minimum end wall): [nps, SW 3000, SW 6000, THD 3000, THD 6000]. */
const CAP = [[0.5, 0.375, 0.5, 0.375, 0.5], [0.75, 0.4375, 0.5, 0.4375, 0.5], [1, 0.4375, 0.625, 0.375, 0.5625], [1.25, 0.5, 0.625, 0.5, 0.625], [1.5, 0.5, 0.625, 0.5625, 0.6875], [2, 0.625, 0.75, 0.75, 0.875], [2.5, 0.625, 0, 0.5625, 0], [3, 0.75, 0, 0.75, 0], [4, 0.75, 0, 0.75, 0]]
/** B16.11 square-head plug thread length (in). */
const PLUG = [[0.125, 0.38], [0.25, 0.44], [0.375, 0.5], [0.5, 0.56], [0.75, 0.62], [1, 0.75], [1.25, 0.81], [1.5, 0.81], [2, 0.88], [2.5, 1.06], [3, 1.12], [4, 1.25]]
const FORGED_CLASSES = [2000, 3000, 6000, 9000]
/** ASME B16.11 Table 2: the pipe wall each class of fitting is rated against, socket-weld and threaded. */
const B1611_WALL: Record<'SW' | 'THD', Array<[number, string]>> = {
  SW: [[3000, 'XS'], [6000, '160'], [9000, 'XXS']],
  THD: [[2000, 'XS'], [3000, '160'], [6000, 'XXS']]
}
/**
 * The lightest ASME B16.11 class whose Table 2 correlated wall is at least the pipe's wall; undefined when the
 * schedule is not listed or the wall is heavier than the heaviest class.
 */
export function forgedClassForWall(nps: number, schedule: string | undefined, threaded: boolean): number | undefined {
  const wall = schedule ? pipeWall(nps, schedule) : undefined
  if (wall == null) return undefined
  return B1611_WALL[threaded ? 'THD' : 'SW'].find(([, s]) => (v => v != null && wall <= v + 0.01)(pipeWall(nps, s)))?.[0]
}
const B169 = 'ASME B16.9'
const row = (kind: Kind, nps: number, takeout: number, description: string, source: string, extra: Partial<StandardRow> = {}): StandardRow =>
  ({ kind, nps, takeout: r2(takeout), description, source, ...extra })
const reducing = (nps: number, small: number | undefined, table = REDUCER_MIN) => {
  const min = at(table, nps)?.[1]
  return small != null && min != null && isNps(small) && small < nps - 1e-6 && small >= min - 1e-6
}
const FLANGE_NAMES: Record<string, string> = { WN: 'WELD NECK', SO: 'SLIP-ON', SW: 'SOCKET-WELD', SC: 'THREADED', BL: 'BLIND', LJ: 'LAP-JOINT' }
/** Butterfly valve codes and the body type each fixes; the generic BFLY takes its body from the row or specification. */
export const BUTTERFLY_BODY: Readonly<Record<string, ButterflyBody | undefined>> = { BFLY: undefined, 'BFLY-LUG': 'lug', 'BFLY-WAFER': 'wafer' }
/** The face-side fillet weld's largest size in ASME B31.3 Fig. 328.5.2B: 6 mm (1/4 in, 6.35 mm, on inch flanges). */
const SO_WELD_MAX = mm(1 / 4)
/**
 * Pipe set-back (mm) inside a slip-on flange where neither the catalogue row nor the specification states one. ASME
 * B31.3 Fig. 328.5.2B sizes a double-welded slip-on flange's face-side (bore) fillet weld at the lesser of the pipe
 * wall T and 6 mm (1/4 in); the pipe end is set back from the face by that weld size so the weld does not stand proud
 * of the face. `clearance` (the specification's `slipOnClearance`, default 0) is added when a shop wants more room.
 */
export const slipOnSetBack = (wall: number, clearance = 0) => r2(Math.min(wall, SO_WELD_MAX) + clearance)
/**
 * Standard dimensions (mm) for a component code at a size and class; undefined where the standard does not define the
 * size or the class is unknown. `rating` is the B16.5 flange class (a rating without one gives no class-dependent
 * row: the caller assumes a class and passes `options.ratingAssumed`). `schedule` is the pipe wall at this size: it
 * fixes the slip-on set-back, stub-end lap, cap length E or E1, weldolet weight and (failing `options.forgedClass`)
 * the forged class by ASME B16.11 Table 2. Whatever had to be assumed is listed in the row's `assumed`.
 * Lap-joint flanges (FLG-RFLJ / FLG-FFLJ) have takeout 0: the stub end carries the length to the lap face.
 */
export function standardRow(code: string, nps: number, rating?: string | number, smallerNps?: number, schedule?: string, options: StandardOptions = {}): StandardRow | undefined {
  const notes: string[] = []
  const r = standard(code.toUpperCase(), nps, rating, smallerNps, schedule, options, notes)
  return r && notes.length ? { ...r, assumed: [...new Set(notes)].join('; ') } : r
}
function standard(c: string, nps: number, rating: string | number | undefined, smallerNps: number | undefined, schedule: string | undefined, o: StandardOptions, notes: string[]): StandardRow | undefined {
  const b = at(BW, nps)
  const small = smallerNps != null && !same(smallerNps, nps) ? smallerNps : undefined
  const sized = small != null ? { smallerNps: small } : {}
  const note = (text: string | undefined) => { if (text) notes.push(text) }
  // A class-dependent row uses the class; when the caller assumed it, that is this row's assumption too.
  const flangeCls = () => {
    const v = flangeClass(rating)
    if (v) note(o.ratingAssumed)
    return v
  }
  const flg = /^FLG-(RF|FF)(WN|SO|SW|SC|BL|LJ)$/.exec(c)
  if (flg) {
    const fc = flangeCls(), f = fc ? flange(nps, fc) : undefined
    if (!f || (flg[1] === 'FF' && f.rating > 300)) return undefined
    // A lap-joint flange is flat: its face is the stub end's lap.
    const type = flg[2], name = type === 'LJ' ? `FLANGE, LAP-JOINT, CLASS ${f.rating}, ASME B16.5` : `FLANGE ${flg[1]} ${FLANGE_NAMES[type]}, CLASS ${f.rating}`
    const base = { flangeThickness: f.thickness, boltCount: f.boltCount, boltDiameter: f.boltDiameter, boltLength: f.studLength }
    if (type === 'WN') return row('flange', nps, f.wnLength, name, `${B165_SOURCE}; takeout = length through hub Y`, { ...base, lengthThroughHub: f.wnLength })
    if (type === 'BL') return row('flange', nps, f.thickness, name, `${B165_SOURCE}; blind flange: takeout = thickness`, { ...base, thickness: f.thickness })
    if (type === 'LJ') {
      const lap = wallFor(nps, schedule, 'STD', 'the lap-joint stud length')
      note(lap.assumed)
      return row('flange', nps, 0, name, 'ASME B16.5 lapped flange (no raised face); takeout 0 because the stub end carries the length to the lap face', {
        ...base, flangeThickness: f.ljThickness, lengthThroughHub: f.ljLength, boltLength: bolting(nps, f.rating, 'FF', 'lj-pair', { lap: lap.wall })?.length
      })
    }
    if (!f.soLength) return undefined
    if (type === 'SO') {
      const hub = { ...base, lengthThroughHub: f.soLength }
      if (o.slipOnSetBack != null)
        return row('flange', nps, o.slipOnSetBack, name, `${B165_SOURCE}; slip-on: pipe end set back ${r2(o.slipOnSetBack)} mm from the face (${o.setBackSource ?? 'specification set-back'})`,
          { ...hub, dimensionBasis: 'specification' })
      const { wall, assumed } = wallFor(nps, schedule, 'STD', 'the slip-on set-back')
      if (wall == null) return undefined
      note(assumed)
      const extra = o.slipOnClearance ?? 0
      return row('flange', nps, slipOnSetBack(wall, extra), name,
        `${B165_SOURCE}; slip-on: pipe end set back by the face-side fillet weld, calculated as the lesser of the pipe wall and 1/4 in (ASME B31.3 Fig. 328.5.2B)${extra ? ` plus the specification's ${r2(extra)} mm clearance` : ''}`,
        { ...hub, dimensionBasis: 'calculated' })
    }
    if (type === 'SW')
      return f.socketDepth == null ? undefined : row('flange', nps, f.soLength - f.socketDepth, name, `${B165_SOURCE}; socket-weld: effective takeout = hub length less socket depth D`, { ...base, lengthThroughHub: f.soLength, socketDepth: f.socketDepth })
    const e = engagement(nps)
    return !f.threaded || e == null ? undefined : row('flange', nps, f.soLength - mm(e), name, `${B165_SOURCE}; threaded: effective takeout = hub length less NPT make-up engagement`, { ...base, lengthThroughHub: f.soLength, threadEngagement: mm(e) })
  }
  const valve = VALVE[c]
  if (valve) {
    const vc = flangeCls(), v = vc ? at(B1610[vc], nps) : undefined
    if (!vc || !v) return undefined
    const names = Object.keys(valve.patterns) as ValvePattern[], length = (p: ValvePattern) => v[valve.patterns[p]!]
    let column = valve.column, pattern: ValvePattern | undefined
    if (names.length) {
      if (o.valvePattern && names.includes(o.valvePattern)) pattern = o.valvePattern
      else if (o.valvePattern && names.length > 1) return undefined // a pattern B16.10 does not give for this valve (a venturi plug)
      else {
        const listed = names.filter(p => length(p) > 0)
        pattern = listed[0] ?? names[0]
        if (listed.length > 1 && new Set(listed.map(length)).size > 1)
          note(`the ASME B16.10 ${pattern} pattern is assumed for a ${valve.name.toLowerCase()} because no valve pattern was given (the patterns differ in length)`)
      }
      column = valve.patterns[pattern]
    }
    const len = column ? v[column] : 0
    if (!len) return undefined
    const f2f = mm(len)
    return row('valve', nps, f2f / 2, `${valve.name}${pattern ? `, ${pattern.toUpperCase()} PATTERN` : ''}, CLASS ${vc}`,
      `ASME B16.10 Class ${vc} ${/-BW$/.test(c) ? 'end-to-end' : 'face-to-face'}${pattern ? `, ${pattern} pattern` : ''}; takeout = half length`,
      { faceToFace: f2f, ...(pattern ? { valvePattern: pattern } : {}) })
  }
  if (c in BUTTERFLY_BODY) {
    const fc = flangeCls()
    if (!fc) return undefined
    let body = BUTTERFLY_BODY[c] ?? o.butterflyBody
    if (!body) {
      body = 'lug'
      note('a lug-body butterfly valve is assumed because no body type (wafer, lug or double-flanged) was given')
    }
    // API 609 tabulates lug and wafer bodies only: a double-flanged body's length comes from its own data sheet.
    if (body === 'double-flanged') return undefined
    const cat = butterflyCategory(fc, o.butterflyCategory), len = cat ? butterflyLength(nps, fc, cat.value) : undefined
    if (!cat || len == null) return undefined
    note(cat.assumed)
    const wafer = body === 'wafer', bolts = bolting(nps, fc, 'RF', wafer ? 'wafer-valve' : 'lug-valve-side', {
      body: len, gasket: o.gasketThickness, ...(wafer ? {} : { type: o.boltType, engagement: o.lugBoltEngagement, projectionThreads: o.lugBoltProjection })
    })
    return row('valve', nps, len / 2, `BUTTERFLY VALVE, ${wafer ? 'WAFER' : 'LUG'} TYPE, API 609 CATEGORY ${cat.value}, CLASS ${fc}`,
      `API 609 Category ${cat.value} ${body}-body face-to-face; takeout = half length; bolting = ${wafer ? 'through studs' : 'lug bolts per side'}`, {
        faceToFace: len, bodyType: body, valveCategory: cat.value, boltCount: bolts?.count, boltDiameter: bolts?.diameter, boltLength: bolts?.length
      })
  }
  if (c === 'GASK-RF' || c === 'GASK-FF') {
    const fc = flangeCls(), rf = c === 'GASK-RF'
    if (!fc || !at(B165[fc], nps) || (!rf && fc > 300)) return undefined
    const given = o.gasketThickness
    if (given)
      return row('gasket', nps, given / 2, `GASKET, ${rf ? 'RAISED FACE' : 'FULL FACE'}, ${r2(given)} MM THK, CLASS ${fc}`, 'specification gasket thickness; takeout = half thickness', { thickness: given })
    const t = rf ? GASKET_THICKNESS.spiralWoundCompressed : GASKET_THICKNESS.sheet18
    note(rf ? 'an ASME B16.20 spiral-wound gasket (3.3 mm compressed) is assumed because the specification names no gasket'
      : 'a 1/8 in ASME B16.21 sheet gasket is assumed because the specification names no gasket')
    return row('gasket', nps, t / 2, rf ? `GASKET, SPIRAL WOUND, CLASS ${fc}` : `GASKET, FULL FACE 1/8 IN, CLASS ${fc}`,
      rf ? 'ASME B16.20 spiral-wound, 4.5 mm winding compressed to 3.3 mm; takeout = half thickness' : 'ASME B16.21 non-metallic sheet 1/8 in; takeout = half thickness', { thickness: t })
  }
  if (c === 'BOLT-RF' || c === 'BOLT-FF') {
    const fc = flangeCls(), bolt = fc ? bolting(nps, fc, c === 'BOLT-FF' ? 'FF' : 'RF', 'flange-pair', { type: o.boltType }) : undefined
    return bolt && row('bolt', nps, 0, bolt.kind === 'machine' ? `MACHINE BOLT C/W HEAVY HEX NUT, CLASS ${fc}` : `STUD BOLT C/W 2 HEAVY HEX NUTS, CLASS ${fc}`,
      `${bolt.source} for one flange pair`, { boltCount: bolt.count, boltDiameter: bolt.diameter, boltLength: bolt.length })
  }
  // 3D elbows have their own table, to NPS 48, beyond the B16.9 fittings table below.
  if (c === 'W-3D90EL' || c === 'W-3D45ELL') return threeDRow(nps, c === 'W-3D90EL' ? 90 : 45)
  if (b) {
    const [, lr, sr, lr45, tee, cap, red] = b
    switch (c) {
      case 'W-LR90EL': return row('elbow90', nps, mm(lr), 'ELBOW 90 LR BW', `${B169} long radius; takeout = centre-to-end A`)
      case 'W-SR90EL': return sr ? row('elbow90', nps, mm(sr), 'ELBOW 90 SR BW', `${B169} short radius; takeout = centre-to-end A`) : undefined
      case 'W-45ELL': return row('elbow45', nps, mm(lr45), 'ELBOW 45 LR BW', `${B169} long radius; takeout = centre-to-end B`)
      case 'LR180R':
      case 'SR180R': {
        const ret = returnBend(nps, c === 'LR180R' ? 'LR' : 'SR')
        return ret && row('elbow90', nps, ret.radius, `RETURN 180 ${c === 'LR180R' ? 'LR' : 'SR'} BW, CENTRE-TO-CENTRE ${ret.centreToCentre} MM`,
          `${ret.source}; takeout = O/2 from the bend centre to each end`, { centreToCentre: ret.centreToCentre, backToFace: ret.backToFace })
      }
      case 'REDELL': return reducing(nps, small, REDELL_MIN) ? row('elbow90', nps, mm(lr), 'ELBOW 90 LR REDUCING BW', `${B169} reducing elbow; centre-to-end = large-end LR elbow`, sized) : undefined
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
        if (c === 'W-RLAT') note('a reducing lateral takes the straight lateral of its run size because no reducing-lateral table is held; confirm the branch length with the maker')
        return row('tee', nps, mm(l[1]), c === 'W-LAT' ? 'LATERAL 45 BW' : 'REDUCING LATERAL 45 BW', `45° lateral, ${VENDOR}; takeout = short-side C-E, branch and long side the long C-E`, { ...sized, branchTakeout: mm(l[2]) })
      }
      case 'C-RED':
      case 'E-RED': return reducing(nps, small) ? row('reducer', nps, mm(red) / 2, c === 'C-RED' ? 'REDUCER CONC BW' : 'REDUCER ECC BW', `${B169} reducer length H; takeout = H/2 from the centre node`, { ...sized, faceToFace: mm(red) }) : undefined
      case 'W-CAP': {
        const limit = at(CAP_E1, nps), wall = schedule ? pipeWall(nps, schedule) : undefined
        if (wall == null) note(schedule ? `the cap length E for walls up to XS is assumed because schedule ${schedule} has no ASME B36.10M wall at this size`
          : 'the cap length E for walls up to XS is assumed because no pipe schedule was given')
        const heavy = wall != null && !!limit && wall > mmx(limit[1]) + 0.01
        return row('cap', nps, mm(heavy ? limit![2] : cap), 'CAP BW', `${B169} cap ${heavy ? 'length E1 (wall heavier than the limiting wall)' : 'length E'}; node at the outer end, takeout = cap length`)
      }
      case 'STUB-END':
      case 'STUB-END-SHORT': {
        const st = stubEnd(nps, c === 'STUB-END-SHORT', schedule)
        if (!st) return undefined
        note(st.assumed)
        return row('flange', nps, st.length, `STUB END, ${st.short ? 'SHORT PATTERN, MSS SP-43 TYPE A' : 'LONG PATTERN, ASME B16.9'}, BE`,
          `${st.short ? 'MSS SP-43 short pattern (type A)' : 'ASME B16.9 long pattern'} length F; takeout = F from the lap face; lap thickness = ${st.schedule} pipe wall`, { thickness: st.lapThickness })
      }
    }
  }
  if (/^[CE]-SW(AGE|G)$/.test(c)) {
    const l = at(SWAGE, nps)?.[1]
    return l && small != null && small < nps && isNps(small) ? row('reducer', nps, mm(l) / 2, c.startsWith('C') ? 'SWAGE CONC' : 'SWAGE ECC', 'MSS SP-95 swage length; takeout = half length', { ...sized, faceToFace: mm(l) }) : undefined
  }
  // ---- Forged (ASME B16.11 / MSS SP-97 / MSS SP-83) items: the class is given, else follows the pipe wall by B16.11 Table 2.
  const forged = (threaded: boolean): number | undefined => {
    const own = ratingClass(rating), given = o.forgedClass ?? (own && FORGED_CLASSES.includes(own) ? own : undefined)
    if (given) return given
    const derived = forgedClassForWall(nps, schedule, threaded)
    note(derived ? `Class ${derived} forged fittings are assumed from the ASME B16.11 Table 2 correlation with the pipe wall because no forged class was given` : undefined)
    return derived
  }
  // Caps, couplings, unions and thredolets are not made in Class 2000: the next class up is used and said.
  const atLeast3000 = (fc: number, what: string) => {
    if (fc !== 2000) return fc
    note(`Class 3000 ${what} are used where Class 2000 is specified because they are not made in Class 2000`)
    return 3000
  }
  if (c === 'WOL' || c === 'SOL' || c === 'TOL') {
    // Measured from the run pipe's outside: the pipe stops at the bevel, the socket bottom or the thread make-up.
    const ol = at(OLET, nps)
    if (c === 'WOL') {
      const named = o.oletSchedule?.toUpperCase().replace(/\.$/, '')
      let weight: 'STD' | 'XS' | undefined = named === 'XS' || named === 'XH' ? 'XS' : named === 'STD' ? 'STD' : undefined
      if (!weight) {
        // A weldolet matches its branch wall: standard weight up to STD, extra-strong up to XS.
        const wall = schedule ? pipeWall(nps, schedule) : undefined, std = pipeWall(nps, 'STD'), xs = pipeWall(nps, 'XS')
        if (wall == null) note('a standard-weight weldolet is assumed because the branch wall is not known')
        weight = wall == null || (std != null && wall <= std + 0.01) ? 'STD' : xs != null && wall <= xs + 0.01 ? 'XS' : undefined
      }
      const a = weight && ol?.[weight === 'XS' ? 2 : 1]
      if (!a) return undefined
      const h = mm(a)
      return row('olet', nps, h, `WELDOLET, ${weight}, MSS SP-97`, `MSS SP-97 weldolet, height A: ${VENDOR}; takeout = A from the run pipe outside`, { height: h, takeoutReference: 'header-outside' })
    }
    const fc0 = forged(c === 'TOL')
    if (!fc0 || fc0 === 9000 || (c === 'SOL' && fc0 === 2000)) return undefined
    const fc = c === 'TOL' ? atLeast3000(fc0, 'thredolets') : fc0, a = ol?.[fc === 6000 ? 4 : 3]
    if (!a) return undefined
    const h = mm(a), j = c === 'SOL' ? socketDepth(nps) : undefined, e = c === 'TOL' ? engagement(nps) : undefined
    if ((c === 'SOL' && j == null) || (c === 'TOL' && e == null)) return undefined
    return row('olet', nps, h - (j ?? 0) - (e == null ? 0 : mm(e)), `${c === 'SOL' ? 'SOCKOLET' : 'THREDOLET'}, CLASS ${fc}, MSS SP-97`,
      `MSS SP-97 ${c === 'SOL' ? 'sockolet' : 'thredolet'}, height A: ${VENDOR}; takeout = A from the run pipe outside${c === 'SOL' ? ` less the socket depth J (${SOCKET_SOURCE})` : ' less NPT make-up engagement'}`,
      { height: h, takeoutReference: 'header-outside', ...(j != null ? { socketDepth: j } : {}), ...(e != null ? { threadEngagement: mm(e) } : {}) })
  }
  const sw = c.startsWith('SW-') || /SW$/.test(c), thd = c.startsWith('SC-') || /SC$/.test(c) || c === 'PLUG'
  if (!sw && !thd) return undefined
  const fc = forged(thd)
  // B16.11 has no Class 2000 socket-weld fittings, and these tables stop at Class 6000.
  if (!fc || fc === 9000 || (sw && fc === 2000)) return undefined
  const label = `${fc}#`, j = sw ? socketDepth(nps) : undefined, e = engagement(nps), eng = e == null ? undefined : mm(e)
  if (sw && j == null) return undefined
  const swSource = `ASME B16.11 Class ${fc} socket-weld; effective takeout = centre to socket bottom (pipe bottomed); ${SOCKET_SOURCE}`
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
    case 'SW-RCRS': {
      const jb = small != null ? socketDepth(small) : undefined
      return runSw && small != null && small < nps && isNps(small) && jb != null
        ? row('tee', nps, runSw, `REDUCING ${c === 'SW-RTEE' ? 'TEE' : 'CROSS'} SW ${label}`, `${swSource}; reducing outlet bored in the run-size body: branch = A + socket depth(run) - socket depth(outlet)`, { ...sized, branchTakeout: r2(runSw + j! - jb), socketDepth: j })
        : undefined
    }
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
      const cc = atLeast3000(fc, 'caps'), k = at(CAP, nps)?.[(c === 'SW-CAP' ? 1 : 3) + (cc === 6000 ? 1 : 0)]
      if (!k || (c === 'SC-CAP' && !eng)) return undefined
      return row('cap', nps, mm(k), `CAP ${c === 'SW-CAP' ? 'SW' : 'THD'} ${cc}#`, `ASME B16.11 Class ${cc} cap; takeout = cap end beyond the pipe end, ${VENDOR}`, c === 'SW-CAP' ? { socketDepth: j } : { threadEngagement: eng })
    }
    case 'PLUG': {
      const p = at(PLUG, nps)?.[1]
      return p ? row('cap', nps, mm(p), 'PLUG, SQUARE HEAD, THD', 'ASME B16.11 square-head plug; takeout = thread length A (thread engagement)', { threadEngagement: mm(p) }) : undefined
    }
    case 'F-CPLGSW':
    case 'H-CPLGSW': {
      if (!s || !(fc === 3000 || s[2])) return undefined
      const gap = swCouplingGap(nps), half = c === 'H-CPLGSW'
      // A half coupling is half a full coupling: its socket bottom stands E/2 off the header, its end E/2 + J.
      return row(half ? 'olet' : 'valve', nps, gap / 2, `${half ? 'HALF' : 'FULL'} COUPLING SW ${label}`,
        `${swSource}; coupling: takeout = half the laying length E between socket bottoms${half ? ', measured from the header outside (half of a full coupling)' : ''}`,
        half ? { socketDepth: j, height: r2(gap / 2 + j!), takeoutReference: 'header-outside' } : { socketDepth: j })
    }
    case 'F-CPLGSC':
    case 'H-CPLGSC': {
      const w = at(THD_COUPLING, nps)?.[1], half = c === 'H-CPLGSC'
      if (!w || !eng) return undefined
      const cc = atLeast3000(fc, 'couplings')
      return row(half ? 'olet' : 'valve', nps, w / 2 - eng, `${half ? 'HALF' : 'FULL'} COUPLING THD ${cc}#`,
        `ASME B16.11 Class ${cc} threaded coupling length W; effective takeout = W/2 less NPT make-up engagement${half ? ', measured from the header outside (half coupling W/2)' : ''}`,
        half ? { threadEngagement: eng, height: r2(w / 2), takeoutReference: 'header-outside' } : { faceToFace: w, threadEngagement: eng })
    }
    case 'UNION-SW':
    case 'UNION-SC': {
      const uc = atLeast3000(fc, 'unions'), u = at(UNION, nps)?.[uc === 6000 ? 2 : 1]
      if (!u) return undefined
      const l = mm(u), end = c === 'UNION-SW' ? j : eng
      return end == null ? undefined : row('valve', nps, (l - 2 * end) / 2, `UNION ${c === 'UNION-SW' ? 'SW' : 'THD'} ${uc}#`,
        `MSS SP-83 Class ${uc} union, laying length: ${VENDOR}; effective takeout = half the length less ${c === 'UNION-SW' ? `the socket depth J (${SOCKET_SOURCE})` : 'thread engagement'}`,
        c === 'UNION-SW' ? { faceToFace: l, socketDepth: end } : { faceToFace: l, threadEngagement: end })
    }
  }
  return undefined
}
/**
 * Stub end (mm): length F (B16.9 long or MSS SP-43 short pattern), lap OD G and lap thickness: the wall of `schedule`,
 * else Sch 10S for MSS SP-43 and STD for B16.9, with that assumption stated.
 */
export function stubEnd(nps: number, short: boolean, schedule?: string): { length: number; lapOd: number; lapThickness: number; short: boolean; schedule: string; assumed?: string } | undefined {
  const b = at(BW, nps), fallback = short ? '10S' : 'STD'
  const { wall, assumed } = wallFor(nps, schedule, fallback, 'the stub-end lap')
  return b && wall != null ? { length: mm(short ? b[8] : b[7]), lapOd: mm(b[9]), lapThickness: wall, short, schedule: assumed ? fallback : schedule!, ...(assumed ? { assumed } : {}) } : undefined
}
/** Gasket thickness (mm): ASME B16.20 spiral-wound (compressed) or ASME B16.21 non-metallic sheet. */
export function gasketThickness(type: 'spiral-wound' | 'sheet-1/16' | 'sheet-1/8'): number {
  return type === 'spiral-wound' ? GASKET_THICKNESS.spiralWoundCompressed : type === 'sheet-1/16' ? GASKET_THICKNESS.sheet116 : GASKET_THICKNESS.sheet18
}
