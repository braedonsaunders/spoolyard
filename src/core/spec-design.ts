import type { PipeSpec } from './model'
import { ratingClass, type BoltType, type ButterflyBody, type ButterflyCategory, type FlangeFace, type ValvePattern } from './standards'

/**
 * Typed design parameters of a piping specification: what fixes a standard dimension when the specification has no
 * row for an item. Lengths are millimetres. Every field is optional; an absent field is never filled in silently, the
 * resolvers below say what was assumed instead.
 */
export interface SpecDesign {
  /** ASME B16.5 flange pressure class (150, 300, 600, 900, 1500). */
  flangeClass?: number
  flangeFace?: FlangeFace
  /** ASME B16.11 forged-fitting class for socket-weld and threaded fittings (2000, 3000, 6000, 9000). */
  forgedClass?: number
  boltType?: BoltType
  /** Compressed gasket thickness at a flanged joint (mm). */
  gasketThickness?: number
  /** ASME B16.10 pattern of flanged ball valves. */
  ballValvePattern?: Extract<ValvePattern, 'long' | 'short'>
  /** ASME B16.10 pattern of flanged plug valves. */
  plugValvePattern?: Extract<ValvePattern, 'short' | 'regular' | 'venturi'>
  butterflyBody?: ButterflyBody
  /** API 609 category of butterfly valves: A (concentric) or B (offset seat). */
  butterflyCategory?: ButterflyCategory
  /** Wall of stub-end laps (pipe schedule: STD, XS, 10S…). */
  stubEndSchedule?: string
  /** Weight of weldolets (STD or XS). */
  oletSchedule?: string
  /** Component code of the flange a flanged port mates with. */
  defaultFlange?: string
  /** Catalogued nipple length (mm) where the specification has no nipple row. */
  nippleLength?: number
  /**
   * Lug bolting without a specification lug-bolt row: thread engagement in the tapped lug, in bolt diameters
   * (default 1, limited to half the body each side; see standards.ts `lugBolt`).
   */
  lugBoltEngagement?: number
  /** Lug studs without a specification row: full threads standing beyond the nut (default 2; cap screws have none). */
  lugBoltProjection?: number
  /**
   * Pipe set-back (mm) inside slip-on flanges whose catalogue row states none. Default: the lesser of the pipe wall and
   * 1/4 in, the face-side fillet weld size of ASME B31.3 Fig. 328.5.2B (see standards.ts `slipOnSetBack`).
   */
  slipOnSetBack?: number
  /** Clearance (mm) added to the default slip-on set-back. Default 0. */
  slipOnClearance?: number
}
export type SpecDesignField = keyof SpecDesign

const inchesOrMm = (v: string): number | undefined => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(mm|in|"|inch(?:es)?)?\s*$/i.exec(v)
  if (!m) return undefined
  const n = Number(m[1])
  // Bare numbers are inches, as imperial CADWorx specifications write them (nipple length 3.0, gasket 0.125).
  return n > 0 ? (/mm/i.test(m[2] ?? '') ? n : Math.round(n * 25.4 * 100) / 100) : undefined
}
const word = <T extends string>(map: Record<string, T>) => (v: string): T | undefined => {
  const k = v.trim().toUpperCase()
  return Object.entries(map).find(([prefix]) => k.startsWith(prefix))?.[1]
}
const schedule = (v: string) => v.trim() ? v.trim().toUpperCase() : undefined

/**
 * Import mapping: the free-form parameter names other systems export (CADWorx "Group.Name" keys, and Spoolyard's own
 * older "Default Flange"), each to the typed field it sets. Values that mean "any" (ALL) map to nothing. CADWorx's
 * "Socket Weld Gap Table" and "Weld Gap Table" are indexes into its own gap tables, not lengths, so they map to
 * nothing: the specification's `socketGap` and `rootGap` hold the gaps.
 */
export const LEGACY_PARAMETERS: ReadonlyArray<{ key: string; field: SpecDesignField; parse: (v: string) => SpecDesign[SpecDesignField] }> = [
  { key: 'Welded/Flanged General Parameters.ANSI Rating', field: 'flangeClass', parse: v => ratingClass(v) },
  { key: 'Welded/Flanged General Parameters.Flange Face', field: 'flangeFace', parse: word<FlangeFace>({ FF: 'FF', RF: 'RF' }) },
  { key: 'Screwed/Socket Weld General Parameters.Pipe Rating', field: 'forgedClass', parse: v => ratingClass(v) },
  { key: 'Welded/Flanged General Parameters.Bolt Type', field: 'boltType', parse: word<BoltType>({ STUD: 'stud', MACH: 'machine', BOLT: 'machine' }) },
  { key: 'Welded/Flanged General Parameters.Gasket Thickness', field: 'gasketThickness', parse: inchesOrMm },
  { key: 'Welded/Flanged General Parameters.Plug Valve Type', field: 'plugValvePattern', parse: word({ REG: 'regular', SHORT: 'short', VENT: 'venturi' } as const) },
  { key: 'Welded/Flanged General Parameters.Lap Joint Flange Weight', field: 'stubEndSchedule', parse: schedule },
  { key: 'Welded/Flanged General Parameters.WOL/EOL Weight', field: 'oletSchedule', parse: schedule },
  { key: 'Default Flange', field: 'defaultFlange', parse: v => v.trim() || undefined },
  { key: 'Screwed/Socket Weld General Parameters.Pipe Nipple Length', field: 'nippleLength', parse: inchesOrMm }
]

export interface DesignValue<T> { value?: T; source?: string }
/** One design field: the typed field, else the first legacy parameter that maps to it. */
export function designValue<K extends SpecDesignField>(spec: PipeSpec, field: K): DesignValue<NonNullable<SpecDesign[K]>> {
  const own = spec.design?.[field]
  if (own != null && own !== '') return { value: own as NonNullable<SpecDesign[K]>, source: `specification ${spec.id} ${field}` }
  for (const p of LEGACY_PARAMETERS) {
    if (p.field !== field) continue
    const raw = spec.parameters?.[p.key]
    const value = raw == null ? undefined : p.parse(raw)
    // An imported value is held to the same limits as a typed one (a gasket "3" read as 3 in is no gasket).
    if (value != null && FIELDS[field](value)) return { value: value as NonNullable<SpecDesign[K]>, source: `specification ${spec.id} parameter "${p.key}"` }
  }
  return {}
}
/** Every design field the specification sets, typed fields first. */
export function specDesign(spec: PipeSpec): SpecDesign {
  const out: SpecDesign = {}
  for (const field of new Set(LEGACY_PARAMETERS.map(p => p.field).concat(Object.keys(spec.design ?? {}) as SpecDesignField[]))) {
    const v = designValue(spec, field).value
    if (v != null) (out as Record<string, unknown>)[field] = v
  }
  return out
}

const FIELDS: Record<SpecDesignField, (v: unknown) => boolean> = {
  flangeClass: v => typeof v === 'number' && [150, 300, 600, 900, 1500, 2500].includes(v),
  flangeFace: v => v === 'RF' || v === 'FF',
  forgedClass: v => typeof v === 'number' && [2000, 3000, 6000, 9000].includes(v),
  boltType: v => v === 'stud' || v === 'machine',
  gasketThickness: v => typeof v === 'number' && v > 0 && v < 50,
  ballValvePattern: v => v === 'long' || v === 'short',
  plugValvePattern: v => v === 'short' || v === 'regular' || v === 'venturi',
  butterflyBody: v => v === 'wafer' || v === 'lug' || v === 'double-flanged',
  butterflyCategory: v => v === 'A' || v === 'B',
  stubEndSchedule: v => typeof v === 'string' && v.length <= 20,
  oletSchedule: v => typeof v === 'string' && v.length <= 20,
  defaultFlange: v => typeof v === 'string' && v.length <= 40,
  nippleLength: v => typeof v === 'number' && v > 0 && v < 10000,
  lugBoltEngagement: v => typeof v === 'number' && v > 0 && v <= 5,
  lugBoltProjection: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 20,
  slipOnSetBack: v => typeof v === 'number' && v >= 0 && v < 100,
  slipOnClearance: v => typeof v === 'number' && v >= 0 && v < 50
}
/** Whether a parsed `design` object is well formed (for document validation). */
export function validSpecDesign(design: unknown): boolean {
  if (design == null) return true
  if (typeof design !== 'object' || Array.isArray(design)) return false
  return Object.entries(design).every(([k, v]) => v == null || (Object.hasOwn(FIELDS, k) && FIELDS[k as SpecDesignField](v)))
}
/** Whether a catalogue row's typed design fields (pattern, body, category, bolt kind, set-back, assumption) are well formed. */
export function validCatalogDesign(f: { valvePattern?: unknown; bodyType?: unknown; valveCategory?: unknown; boltKind?: unknown; setBack?: unknown; assumed?: unknown }): boolean {
  return (f.valvePattern == null || ['long', 'short', 'regular', 'venturi'].includes(f.valvePattern as string)) &&
    (f.setBack == null || FIELDS.slipOnSetBack(f.setBack)) &&
    (f.bodyType == null || FIELDS.butterflyBody(f.bodyType)) &&
    (f.valveCategory == null || FIELDS.butterflyCategory(f.valveCategory)) &&
    (f.boltKind == null || ['stud', 'machine', 'lug'].includes(f.boltKind as string)) &&
    (f.assumed == null || (typeof f.assumed === 'string' && f.assumed.length <= 2000))
}
