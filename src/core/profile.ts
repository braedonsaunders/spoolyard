import type { IsoDocument } from './model'

/**
 * A project's fabrication and drafting conventions. Every field is optional; `profileOf` resolves the documented
 * default for anything a drawing does not set. Defaults are general shop practice, not any one client's sheets.
 */
export interface FabricationProfile {
  /**
   * Stock length pipe is bought in (mm). A piece longer than this needs a field joint or a longer (double random)
   * length, and is flagged. Default single random length: 20 ft (6096 mm) on imperial drawings, 6 m on metric.
   * A specification's own `stockLength` takes precedence for its pipe.
   */
  stockLength?: number
  /** Ordered pipe length is rounded up to this increment (mm); 0 orders the exact length. Default 1" or 10 mm. */
  orderIncrement?: number
  /** Saw kerf allowed between pieces cut from one length (mm). Default 1/8" (3.175 mm) imperial, 3 mm metric. */
  kerf?: number
  /** Extra length added to a pipe piece for each formed bend (grip or springback allowance), mm. Default 0. */
  bendAllowance?: number
  /** Pipe rows give their cut after the description (" - CUT TO …"), or leave the cut to the cut list. Default 'description'. */
  cutNote?: 'description' | 'none'
  /**
   * Lengths shorter than this many inches are written in inches only, longer ones in feet and inches. Dimensions on
   * the sheet and lengths in lists may differ. Default: dimensions 24 (2 ft), lists 12 (1 ft).
   */
  feetFrom?: { dimensions?: number; lists?: number }
  /** Bill-of-materials groups in printed order; groups not named follow in the default order. */
  materialOrder?: string[]
  /** Flange types (component code suffix) in printed order within the flange group. Default SO, WN, LJ, SW, SC, BL. */
  flangeOrder?: string[]
  /** Sizes within a group: smallest first (default) or largest first. */
  sizeOrder?: 'ascending' | 'descending'
  /** One weld-number sequence through the drawing (default), or a fresh sequence on each spool. */
  weldSequence?: 'drawing' | 'spool'
  /** Welds joining two spools are made at erection. Default 'field'; 'shop' when spools are joined in the shop. */
  spoolBreakWelds?: 'field' | 'shop'
  /** Nominal sizes written as NPS inches (default) or DN. */
  sizeNotation?: 'NPS' | 'DN'
  /** Material list in one list (default), or shop material first and field (erection) material after it. */
  materialSections?: 'combined' | 'shop-field'
}
export type ResolvedProfile = Required<Omit<FabricationProfile, 'feetFrom' | 'materialOrder' | 'flangeOrder'>> & {
  feetFrom: { dimensions: number; lists: number }
  materialOrder: string[]
  flangeOrder: string[]
}
/**
 * Bill-of-materials groups in the AutoCAD Plant 3D order: pipe; fittings by type; olets; flanges, bolting, gaskets,
 * valves; specialty items; supports listed as material last.
 */
export const DEFAULT_MATERIAL_ORDER = ['pipe', 'cap', 'nipple', 'bend', 'elbow90', 'elbow45', 'stub', 'hose', 'reducer', 'tee', 'regulator',
  'reducing-coupling', 'union', 'olet', 'flange', 'bolt', 'gasket', 'valve', 'other', 'support']
export const DEFAULT_FLANGE_ORDER = ['SO', 'WN', 'LJ', 'SW', 'SC', 'BL']
const INCH = 25.4
/** Single random length: 20 ft, or 6 m on a metric drawing. */
export const SINGLE_RANDOM = { imperial: 240 * INCH, mm: 6000 }
/** Double random length: 40 ft, or 12 m on a metric drawing. */
export const DOUBLE_RANDOM = { imperial: 480 * INCH, mm: 12000 }

export function profileOf(doc: Pick<IsoDocument, 'units' | 'profile'>): ResolvedProfile {
  const p = doc.profile ?? {}, metric = doc.units === 'mm'
  return {
    stockLength: p.stockLength ?? SINGLE_RANDOM[doc.units],
    orderIncrement: p.orderIncrement ?? (metric ? 10 : INCH),
    kerf: p.kerf ?? (metric ? 3 : INCH / 8),
    bendAllowance: p.bendAllowance ?? 0,
    cutNote: p.cutNote ?? 'description',
    feetFrom: { dimensions: p.feetFrom?.dimensions ?? 24, lists: p.feetFrom?.lists ?? 12 },
    materialOrder: [...new Set([...(p.materialOrder ?? []), ...DEFAULT_MATERIAL_ORDER])],
    flangeOrder: p.flangeOrder ?? DEFAULT_FLANGE_ORDER,
    sizeOrder: p.sizeOrder ?? 'ascending',
    weldSequence: p.weldSequence ?? 'drawing',
    spoolBreakWelds: p.spoolBreakWelds ?? 'field',
    sizeNotation: p.sizeNotation ?? 'NPS',
    materialSections: p.materialSections ?? 'combined'
  }
}
/** Inches below which a dimension or list length is written in inches only. */
export const feetThreshold = (doc: Pick<IsoDocument, 'units' | 'profile'>, use: 'dimensions' | 'lists') => profileOf(doc).feetFrom[use]

/** Why a profile is invalid, or undefined when it is valid. */
export function profileError(p: unknown): string | undefined {
  if (p == null) return undefined
  if (typeof p !== 'object' || Array.isArray(p)) return 'Invalid fabrication profile.'
  const o = p as Record<string, unknown>
  const length = (v: unknown, max: number) => v == null || typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
  const oneOf = (v: unknown, values: string[]) => v == null || typeof v === 'string' && values.includes(v)
  const names = (v: unknown) => v == null || Array.isArray(v) && v.length <= 50 && v.every(s => typeof s === 'string' && s.length <= 40)
  const feet = o.feetFrom as Record<string, unknown> | undefined
  if (!length(o.stockLength, 100000) || (o.stockLength != null && !((o.stockLength as number) > 0))) return 'Enter a positive stock pipe length.'
  if (!length(o.orderIncrement, 1000) || !length(o.kerf, 50) || !length(o.bendAllowance, 5000)) return 'Invalid pipe order allowance.'
  if (!oneOf(o.cutNote, ['description', 'none']) || !oneOf(o.sizeOrder, ['ascending', 'descending']) ||
    !oneOf(o.weldSequence, ['drawing', 'spool']) || !oneOf(o.spoolBreakWelds, ['field', 'shop']) ||
    !oneOf(o.sizeNotation, ['NPS', 'DN']) || !oneOf(o.materialSections, ['combined', 'shop-field'])) return 'Invalid fabrication profile setting.'
  if (feet != null && (typeof feet !== 'object' || Array.isArray(feet) || !length(feet.dimensions, 1e6) || !length(feet.lists, 1e6)))
    return 'Invalid feet-and-inches threshold.'
  if (!names(o.materialOrder) || !names(o.flangeOrder)) return 'Invalid material order.'
  return undefined
}
