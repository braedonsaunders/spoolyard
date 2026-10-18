/**
 * Piping Component File (PCF, the ISOGEN interchange format) import and export.
 *
 * Export writes a spec-clean PCF: header units, one PIPELINE-REFERENCE block per pipeline (with its NOMINAL-CLASS,
 * and the drawing number, title and weld gaps in the user attributes of PCF_ATTRIBUTE), components with ISOGEN
 * component identifiers and symbol keys (SKEY), plant coordinates, standard end-connection tokens, ITEM-CODEs from the
 * specification catalogue, weights, END-CONNECTION-PIPELINE / END-POSITION-OPEN|CLOSED records at continuations, and
 * a MATERIALS section. Spoolyard's own drafting model is not embedded: the `.piping` file is the native format, and
 * `exportPcfPackage` returns it as a sidecar. Every component carries a UCI (unique component identifier) so a PCF
 * read back with its sidecar restores the drawing exactly where the PCF geometry is unchanged. Read alone, Spoolyard's
 * PCF gives back the same pipe, cuts, welds, components (by SKEY, ITEM-CODE, geometry and DESCRIPTION) and material
 * list; what it cannot carry is the drafting (sheets, labels, dimensions), the specification's name and catalogue
 * beyond the rows used, and a flanged component's mating flanges as part of it (they come back as parts of their own).
 *
 * Import maps the ISOGEN component types (valves, olets, couplings, unions, crosses, instruments, misc components…),
 * skips annotation-only records with a warning, and imports unknown in-line parts as generic components rather than
 * dropping them. PCFs written by earlier Spoolyard versions (ATTRIBUTE95–99 records) are still read.
 */
import {
  type EndPrep,
  type FlatSide,
  type IsoDocument,
  type Kind,
  type Vec3,
  type PipeNode,
  type PipeRun,
  type CatalogItem,
  type PipeSpec,
  clone,
  flatSideOf,
  isEccentric,
  isReturnBody,
  newIso,
  id,
  distance,
  add,
  sub,
  mul,
  getNode,
  withIndex,
  parseIsoJson,
  pipePrepAt,
  plantCoordinate,
  portPoint,
  returnPartner,
  prepAt,
  pruneSheetAnchors,
  takeout,
  fitting,
  runResult
} from './model'
import { flangedAllowance, flangedJoints, jointGasket, nodeCode, nodeItem, specFace } from './joints'
import { COMPONENT_TYPE_BY_CODE, COMPONENT_TYPES, type ComponentType } from './components'
import { dnOf, npsOfDn } from './format'
import { measureMember, pipeEnd, pipeText, sheetMaterials } from './material-list'
import { pipeOd, pipeWall, standardRow } from './standards'
import { profileOf } from './profile'

/** Largest PCF accepted, in characters: generous for a plant-area PCF (a few MB), bounded so a stray file can't stall the app. */
export const PCF_MAX_CHARS = 8_000_000
/** End points closer than this (mm) are one connection on import, unless the caller chooses another tolerance. */
export const PCF_DEFAULT_TOLERANCE = 0.5

// ---------------------------------------------------------------------------------------------------------------
// End connections, units and bores
// ---------------------------------------------------------------------------------------------------------------

/** ISOGEN end-connection tokens, written after the bore of each END-POINT / BRANCH-POINT. */
const END_TOKEN: Record<EndPrep, string> = { BW: 'BW', SW: 'SW', THD: 'SC', FL: 'FL', PLAIN: 'PL' }
/** End-connection tokens read, including the variants other writers use. */
const END_PREP: Record<string, EndPrep> = {
  BW: 'BW', BV: 'BW', BE: 'BW', SW: 'SW', SC: 'THD', SCRD: 'THD', THD: 'THD', TH: 'THD', SCR: 'THD', FL: 'FL', FLG: 'FL',
  PL: 'PLAIN', PE: 'PLAIN', PLAIN: 'PLAIN', CP: 'PLAIN'
}
/** Coordinate units read: millimetres per unit. */
const COORD_UNITS: Record<string, number> = { MM: 1, 'MM-HUNDREDTHS': 0.01, INCH: 25.4, INCHES: 25.4, 'INCH-SIXTEENTH': 25.4 / 16, 'INCH-SIXTEENTHS': 25.4 / 16 }
/** Bore units read: NPS inches per unit, or `dn` for metric nominal bores. */
/** The number a bore field starts with, in plain or scientific notation (`150`, `1.5E+02`); any letters after it are the end connection. */
const BORE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i
/** A measured elbow deflection within this (degrees) of 45°, 90° or 180° is that standard elbow; coordinates are rounded. */
const ANGLE_SNAP = 0.5
const BORE_UNITS: Record<string, number | 'dn'> = { MM: 'dn', INCH: 1, INCHES: 1, 'INCH-SIXTEENTH': 1 / 16, 'INCH-SIXTEENTHS': 1 / 16 }

// ---------------------------------------------------------------------------------------------------------------
// Component types and symbol keys
// ---------------------------------------------------------------------------------------------------------------

/**
 * The ISOGEN component a Spoolyard part is written as. `skey` is a two-letter symbol-key prefix completed with the
 * end-connection token (VT + FL = VTFL, flanged gate valve), or `fullSkey` a complete key. Symbol keys follow the
 * ISOGEN Symbol Key (SKEY) Definitions; parts without a standard key are written without one, and ISOGEN draws its
 * default symbol for the component type.
 */
interface PcfComponent { type: string; skey?: string; fullSkey?: string }
/** Component codes to ISOGEN types, first match wins. */
const CODE_RULES: Array<[RegExp, PcfComponent]> = [
  [/^PIPEBEND$/, { type: 'BEND', skey: 'BE' }],
  [/180R$/, { type: 'ELBOW', skey: 'EU' }],
  [/^REDELL$/, { type: 'ELBOW', skey: 'ER' }],
  [/(90|45)EL+$|ELL$/, { type: 'ELBOW', skey: 'EL' }],
  [/R?CRS$/, { type: 'CROSS', skey: 'CR' }],
  [/R?LAT$/, { type: 'TEE', skey: 'TY' }],
  [/R?TEE$/, { type: 'TEE', skey: 'TE' }],
  [/^E-(RED|SWAGE|SWG)$/, { type: 'REDUCER-ECCENTRIC', skey: 'RE' }],
  [/^C-(RED|SWAGE|SWG)$|^R-CPLG/, { type: 'REDUCER-CONCENTRIC', skey: 'RC' }],
  [/^TR-PIECE$/, { type: 'MISC-COMPONENT' }],
  [/^PLUG$/, { type: 'MISC-COMPONENT', fullSkey: 'PL' }],
  [/-CAP$/, { type: 'CAP', skey: 'KA' }],
  [/^F-CPLG/, { type: 'COUPLING', skey: 'CO' }],
  [/^UNION-/, { type: 'UNION', skey: 'UN' }],
  [/^NIPPLE$/, { type: 'PIPE-FIXED', skey: 'FP' }],
  [/^H-CPLG/, { type: 'OLET', skey: 'HC' }],
  [/^WOL$/, { type: 'OLET', fullSkey: 'WTBW' }],
  [/^SOL$/, { type: 'OLET', fullSkey: 'SKSW' }],
  [/^TOL$/, { type: 'OLET', fullSkey: 'THSC' }],
  [/-EOL$/, { type: 'ELBOLET', skey: 'CE' }],
  [/^REPAD$/, { type: 'REINFORCEMENT-PAD', fullSkey: 'RPAD' }],
  [/^FLG-.*BL$/, { type: 'FLANGE-BLIND', fullSkey: 'FLBL' }],
  [/^STUB-END|^FLG-..LJ$/, { type: 'LAPJOINT-STUBEND', fullSkey: 'FLSE' }],
  [/^ORFC.*WN$/, { type: 'FLANGE', fullSkey: 'FOWN' }],
  [/^ORFC.*SO$/, { type: 'FLANGE', fullSkey: 'FOSO' }],
  [/^(FLG-..|ORFC..)SC$/, { type: 'FLANGE', fullSkey: 'FLSC' }],
  [/^FLG-..SO$/, { type: 'FLANGE', fullSkey: 'FLSO' }],
  [/^FLG-..SW$/, { type: 'FLANGE', fullSkey: 'FLSW' }],
  [/^FLG-/, { type: 'FLANGE', fullSkey: 'FLWN' }],
  [/^RF-SBLND$/, { type: 'MISC-COMPONENT', fullSkey: 'SB' }],
  [/^GASK/, { type: 'GASKET' }],
  [/^BOLT/, { type: 'BOLT' }],
  [/^GATE-/, { type: 'VALVE', skey: 'VT' }],
  [/^GLOBE-/, { type: 'VALVE', skey: 'VG' }],
  [/^BALL-/, { type: 'VALVE', skey: 'VB' }],
  [/^CHECK-/, { type: 'VALVE', skey: 'VC' }],
  [/^PLUG-/, { type: 'VALVE', skey: 'VP' }],
  [/^NEEDL-/, { type: 'VALVE', skey: 'VN' }],
  [/^BFLY/, { type: 'VALVE', skey: 'VY' }],
  [/^THERMAL$/, { type: 'VALVE', skey: 'VR' }],
  [/^REGULATOR/, { type: 'VALVE', skey: 'VX' }],
  [/^ROTR-/, { type: 'VALVE', skey: 'VV' }],
  [/^ANGL-/, { type: 'VALVE-ANGLE', skey: 'AV' }],
  [/^PSV-/, { type: 'VALVE-ANGLE', skey: 'AR' }],
  [/^3WAY-/, { type: 'VALVE-3WAY', skey: 'V3' }],
  [/^4WAY-/, { type: 'VALVE-4WAY', skey: 'V4' }],
  [/^HOSE-/, { type: 'MISC-COMPONENT', skey: 'FX' }],
  [/^(CAMLOCK|CHICAGO)-ADPT$/, { type: 'MISC-COMPONENT', skey: 'CH' }],
  [/^PULS-DAMP$/, { type: 'MISC-COMPONENT' }],
  [/^FLOWMETER/, { type: 'INSTRUMENT', skey: 'II' }],
  [/^ANCHOR$/, { type: 'SUPPORT', fullSkey: 'ANCH' }],
  [/^(GUIDE|BASEGUID)$/, { type: 'SUPPORT', fullSkey: 'GUID' }],
  [/^(HANGER|HNGR-SYM)$/, { type: 'SUPPORT', fullSkey: 'HANG' }],
  [/^(SPRGHNGR|SPRING)$/, { type: 'SUPPORT', fullSkey: 'SPRG' }],
  // A welded shoe is welded to the pipe: its key keeps it (and its attachment weld) when the PCF is read alone.
  [/^SHOE$/, { type: 'SUPPORT', fullSkey: 'SHOE' }]
]
/** A part with no component code is written by its kind. */
const KIND_COMPONENT: Partial<Record<Kind, PcfComponent>> = {
  elbow90: { type: 'ELBOW', skey: 'EL' }, elbow45: { type: 'ELBOW', skey: 'EL' }, tee: { type: 'TEE', skey: 'TE' },
  flange: { type: 'FLANGE' }, valve: { type: 'VALVE', skey: 'VV' }, reducer: { type: 'REDUCER-CONCENTRIC', skey: 'RC' },
  cap: { type: 'CAP', skey: 'KA' }, support: { type: 'SUPPORT' }, olet: { type: 'OLET' }, gasket: { type: 'GASKET' },
  bolt: { type: 'BOLT' }, weld: { type: 'WELD' }
}
function pcfComponent(code: string | undefined, kind: Kind): PcfComponent | undefined {
  const type = code ? COMPONENT_TYPE_BY_CODE[code] : undefined
  if (code && type && type.kind !== 'annotation' && type.kind !== 'pipe')
    for (const [pattern, component] of CODE_RULES) if (pattern.test(code)) return component
  return KIND_COMPONENT[kind]
}
const skeyOf = (c: PcfComponent, end?: EndPrep) => c.fullSkey ?? (c.skey && end ? c.skey + END_TOKEN[end] : undefined)
/** PCF types whose records carry a CENTRE-POINT. */
const CENTRED = new Set(['ELBOW', 'BEND', 'TEE', 'CROSS', 'OLET', 'ELBOLET', 'VALVE-ANGLE', 'VALVE-3WAY', 'VALVE-4WAY', 'TEE-SET-ON'])
/** PCF types positioned by CO-ORDS alone. */
const POINT_ONLY = new Set(['SUPPORT', 'BOLT', 'REINFORCEMENT-PAD', 'WELD'])

/** ISOGEN component types read, and the kind of part each becomes. */
const IMPORT_KIND: Record<string, Kind> = {
  ELBOW: 'elbow90', BEND: 'elbow90', 'ELBOW-REDUCING': 'elbow90', 'ELBOW-TEED': 'tee', 'BEND-TEED': 'tee',
  TEE: 'tee', CROSS: 'tee', 'Y-PIECE-FITTING': 'tee', 'TEE-SET-ON': 'olet', 'TEE-STUB': 'olet', 'CROSS-SET-ON': 'olet',
  OLET: 'olet', ELBOLET: 'olet', WELDOLET: 'olet', SOCKOLET: 'olet', THREDOLET: 'olet', SWEEPOLET: 'olet', LATROLET: 'olet',
  NIPOLET: 'olet', 'REINFORCEMENT-PAD': 'olet', 'INSTRUMENT-TEE': 'tee',
  FLANGE: 'flange', 'FLANGE-BLIND': 'flange', 'FLANGE-REDUCING-CONCENTRIC': 'flange', 'FLANGE-REDUCING-ECCENTRIC': 'flange',
  'LAPJOINT-STUBEND': 'flange', 'LAPJOINT-RINGLOOSE': 'flange', 'LAPJOINT-RING': 'flange',
  VALVE: 'valve', 'VALVE-ANGLE': 'valve', 'VALVE-3WAY': 'valve', 'VALVE-4WAY': 'valve', 'VALVE-MULTIWAY': 'valve',
  INSTRUMENT: 'valve', 'INSTRUMENT-ANGLE': 'valve', 'INSTRUMENT-3WAY': 'valve', 'INSTRUMENT-4WAY': 'valve',
  'INSTRUMENT-DIAL': 'valve', 'INSTRUMENT-OFFSET': 'valve', 'INSTRUMENT-RETURN': 'valve',
  FILTER: 'valve', 'FILTER-ANGLE': 'valve', 'FILTER-OFFSET': 'valve', 'FILTER-RETURN': 'valve', 'FILTER-OFFLINE': 'valve',
  TRAP: 'valve', 'TRAP-ANGLE': 'valve', 'TRAP-OFFSET': 'valve', 'TRAP-RETURN': 'valve',
  'MISC-COMPONENT': 'valve', 'MISC-COMPONENT-ANGLE': 'valve', 'MISC-COMPONENT-OFFSET': 'valve', 'MISC-COMPONENT-RETURN': 'valve',
  'MULTI-PORT-COMPONENT': 'valve', 'SAFETY-DISC': 'valve', COUPLING: 'valve', UNION: 'valve', ADAPTER: 'valve',
  CONNECTOR: 'valve', 'PIPE-FIXED': 'valve',
  'REDUCER-CONCENTRIC': 'reducer', 'REDUCER-ECCENTRIC': 'reducer', 'REDUCER-CONCENTRIC-TEED': 'reducer',
  'REDUCER-ECCENTRIC-TEED': 'reducer', CAP: 'cap', PLUG: 'cap',
  SUPPORT: 'support', CLAMP: 'support', WELD: 'weld', GASKET: 'gasket', BOLT: 'bolt', NUT: 'bolt'
}
/** Olet types named by their shape: the component they are. */
const OLET_CODE: Record<string, string | ((end?: EndPrep) => string)> = {
  WELDOLET: 'WOL', SOCKOLET: 'SOL', THREDOLET: 'TOL', ELBOLET: end => end === 'SW' ? 'SW-EOL' : end === 'THD' ? 'SC-EOL' : 'W-EOL'
}
/** Pipe records: plain pipe, and the fixed-length pipe blocks some writers use for pipe. */
const PIPE_TYPES = new Set(['PIPE', 'PIPE-BLOCK-FIXED', 'PIPE-BLOCK-VARIABLE'])
/** Records that only mark the ends of a pipeline: their connection data is not part of the piping. */
const CONNECTION_RECORD = /^(END-CONNECTION|END-POSITION|START-CO-ORDS|CONNECTION-REFERENCE)/
/** Drawing-annotation records (messages, text, split points, symbols): not piping, skipped with a warning. */
const ANNOTATION_RECORD = /^(MESSAGE-|TEXT|ISO-SPLIT-POINT|LOCATION-POINT|FLOW-ARROW|INSULATION-|FLOOR-|WALL|SPINDLE|DIMENSION|SYMBOL|INFORMATION|NOTE|COMPONENT-INFORMATION|SUPPORT-LINK|PIPELINE-SPLIT)/

/**
 * Symbol keys that name exactly one Spoolyard component, so an imported part gets the right symbol. Parts with
 * flanged ends are not resolved: a foreign PCF lists their mating flanges, gaskets and bolts as records of their own,
 * and a flanged component code would supply them a second time.
 */
const SKEY_CODE: Map<string, string> = (() => {
  const found = new Map<string, string[]>()
  for (const t of COMPONENT_TYPES as ComponentType[]) {
    if (t.kind === 'annotation' || t.kind === 'pipe' || t.endPrep === 'FL' || t.kind === 'flange' || t.kind === 'gasket' || t.kind === 'bolt') continue
    if (['elbows', 'tees'].includes(t.category)) continue
    const c = pcfComponent(t.code, t.kind as Kind), skey = c && skeyOf(c, t.endPrep)
    if (!c || !skey) continue
    const key = `${c.type}|${skey}`
    found.set(key, [...(found.get(key) ?? []), t.code])
  }
  return new Map([...found].filter(([, codes]) => codes.length === 1).map(([key, codes]) => [key, codes[0]]))
})()

/** What a PCF record says of the part it is, for finding the Spoolyard component (see `componentFromPcf`). */
interface PcfEvidence {
  type: string
  kind: Kind
  skey?: string
  /** End connections of its run ends (not its branches). */
  preps: EndPrep[]
  /** Its bores, largest first; a reducing part's differ. */
  bores: number[]
  itemCode?: string
  description?: string
  rating?: string
  /** Measured centre-to-end of its run ends, and of its branch ends (mm). */
  takeouts: number[]
  branchTakeouts: number[]
}
/** Words that name no particular component among those of one PCF type. */
const GENERIC_WORDS = new Set(['PIPE', 'FITTING', 'BUTT', 'WELD', 'BW', 'ASME', 'ASTM', 'A234', 'WPB', 'GR', 'STD', 'SCH', 'CL', 'CLASS', 'THE', 'AND', 'WITH', 'CS', 'SS'])
const evidenceWords = (text: string) => new Set(text.toUpperCase()
  .replace(/LONG[\s-]*RADIUS/g, ' LR ').replace(/SHORT[\s-]*RADIUS/g, ' SR ').replace(/\bREDUCING\b|\bREDUCER\b/g, ' RED ')
  .split(/[^A-Z0-9]+/).filter(w => w.length >= 2 && !GENERIC_WORDS.has(w)))
/** Whether an item code names a component code as one of its parts ("A:W-LR90EL-4" names W-LR90EL, not W-SR90EL). */
const namesCode = (itemCode: string, code: string) => {
  const at = itemCode.toUpperCase().indexOf(code.toUpperCase())
  if (at < 0) return false
  const before = itemCode[at - 1], after = itemCode.slice(at + code.length)
  return (before == null || /[:/\s_]/.test(before)) && (after === '' || /^(-[\d.x×X]|[:/\s_])/.test(after))
}
/**
 * The Spoolyard component a PCF part is, where its record says enough: the components of its ISOGEN type and kind
 * with its end connections and symbol key, narrowed by the component code its ITEM-CODE names (Spoolyard writes its
 * rows' ids, "A:W-LR90EL-4"), then by the standard dimensions its geometry matches (a long- or short-radius elbow),
 * then by the words of its DESCRIPTION. Undefined when the record leaves more than one.
 */
export function componentFromPcf(e: PcfEvidence): string | undefined {
  const reducing = e.bores.length > 1 && e.bores.some(b => Math.abs(b - e.bores[0]) > 1e-6)
  let pool = (COMPONENT_TYPES as ComponentType[]).filter(t => t.kind === e.kind && t.category !== 'annotation' && t.category !== 'pipe' &&
    pcfComponent(t.code, t.kind as Kind)?.type === e.type && (!t.endPrep || !e.preps.length || e.preps.includes(t.endPrep)))
  const narrow = (keep: (t: ComponentType) => boolean, always = false) => {
    const kept = pool.filter(keep)
    if (kept.length || always) pool = kept
  }
  // ISOGEN's VV is any valve: it names no particular one.
  if (e.skey && !/^VV/.test(e.skey)) narrow(t => skeyOf(pcfComponent(t.code, t.kind as Kind)!, t.endPrep ?? e.preps[0]) === e.skey)
  if (pool.some(t => t.reducing != null)) narrow(t => !!t.reducing === reducing)
  if (pool.length <= 1) return pool[0]?.code
  if (e.itemCode) {
    narrow(t => namesCode(e.itemCode!, t.code))
    if (pool.length === 1) return pool[0].code
  }
  // Standard dimensions the measured geometry matches, within 1.5 mm or 2 %.
  const close = (a: number | undefined, b: number) => a != null && Math.abs(a - b) <= Math.max(1.5, 0.02 * b)
  if (e.takeouts.length) {
    narrow(t => {
      const row = standardRow(t.code, e.bores[0], e.rating, reducing ? e.bores[e.bores.length - 1] : undefined)
      return !!row && !row.takeoutReference && e.takeouts.every(m => close(row.takeout, m)) &&
        e.branchTakeouts.every(m => close(row.branchTakeout ?? row.takeout, m))
    })
    if (pool.length === 1) return pool[0].code
  }
  if (e.description) {
    const words = evidenceWords(e.description)
    const scored = pool.map(t => ({ t, score: [...evidenceWords(`${t.label} ${t.code}`)].filter(w => words.has(w)).length }))
    const best = Math.max(...scored.map(x => x.score))
    if (best > 0) {
      const top = scored.filter(x => x.score === best)
      if (top.length === 1) return top[0].t.code
    }
  }
  return undefined
}

/** Material texts of stainless and of carbon steel (ASTM grades and names), for an imported specification's density. */
const STAINLESS_TEXT = /A312|A358|A403|A182[- ]?F?3\d\d|\b30[48]L?\b|\b316L?\b|STAINLESS/i
const CARBON_TEXT = /A106|A53\b|A234|\bWPB\b|A105|A333|CARBON/i
/** The pipe schedule a material text names (`STD`, `XS`, `SCH 40`, `SCH 10S`…), if it names one. */
export function scheduleOf(text: string | undefined): string | undefined {
  const m = text?.toUpperCase().match(/\bSCH(?:EDULE)?\.?\s*(\d+S?)\b|\b(XXS|XS|STD)\b/)
  return m ? (m[1] ? `SCH ${m[1]}` : m[2]) : undefined
}
/** Flange symbol keys and the flange each is (its face is the specification's). */
const FLANGE_SKEY: Record<string, string> = { FLWN: 'WN', FLSO: 'SO', FLSW: 'SW', FLSC: 'SC', FLSE: 'LJ', FLLJ: 'LJ', FOWN: 'WN', FOSO: 'SO' }
/** Eccentric reducer flat side and the ISOGEN FLAT-DIRECTION it is written as. */
const FLAT_DIRECTION: Record<FlatSide, string> = { top: 'UP', bottom: 'DOWN', north: 'NORTH', south: 'SOUTH', east: 'EAST', west: 'WEST' }
const FLAT_SIDE = Object.fromEntries(Object.entries(FLAT_DIRECTION).map(([side, word]) => [word, side as FlatSide])) as Record<string, FlatSide>

/**
 * PCF user attributes (the pipeline ATTRIBUTE0–99 a project's ISOGEN configuration maps onto its drawing frame) that
 * carry what the PCF keywords have no field for. Intergraph reserves ATTRIBUTE1–10 and projects number theirs from the
 * low twenties, so Spoolyard writes in the nineties (its releases before 0.6 used ATTRIBUTE95–99, still read). The
 * drawing number and title are written as they are, to be lettered; the weld gaps name themselves (`ROOT-GAP 1.6 MM`)
 * and are read only in that form, so another program's ATTRIBUTE92 is never taken for one.
 */
export const PCF_ATTRIBUTE = { drawing: 'ATTRIBUTE90', title: 'ATTRIBUTE91', rootGap: 'ATTRIBUTE92', socketGap: 'ATTRIBUTE93' } as const
const GAP_ATTRIBUTE = { rootGap: /^ROOT-GAP\s+(\d+(?:\.\d+)?)\s*MM$/i, socketGap: /^SOCKET-GAP\s+(\d+(?:\.\d+)?)\s*MM$/i }

/**
 * The PIPELINE-REFERENCE an END-CONNECTION-PIPELINE gives for a continuation callout: ISOGEN letters it after its own
 * "CONT. ON", so the callout's leading CONT'D ON is left off, and lines are joined (a PCF value is one line).
 */
export function continuationReference(text: string): string {
  return text.replace(/^\s*CONT'?D\s+ON\b\s*/i, '').replace(/\s*[\r\n]+\s*/g, ' ').replace(/\t/g, ' ').trim()
}
/** The continuation callout an END-CONNECTION-PIPELINE's reference is drawn as: CONT'D ON over it, as Spoolyard letters one. */
export function continuationText(reference: string): string {
  const own = reference.trim().match(/^(CONT'?D\s+(?:ON|FROM))\s+(.+)$/i)
  if (own) return `${own[1]}\n${own[2]}`
  return /^(CONNECT|TIE|TO)\b/i.test(reference.trim()) ? reference.trim() : `CONT'D ON\n${reference.trim()}`
}

// ---------------------------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------------------------

export interface PcfExportOptions {
  /**
   * Nominal bore units; default the drawing's size notation: MM (DN) where sizes are listed as DN, else INCH (NPS), on
   * metric drawings too (ISOGEN reads inch bores with millimetre coordinates), so the sizes read back as they were listed.
   */
  boreUnits?: 'MM' | 'INCH'
  /** Coordinate units; default MM on metric drawings, INCH on imperial ones. */
  coordUnits?: 'MM' | 'INCH'
}
/** A component port as the PCF writes it: plant coordinates, bore and end connection. */
interface PcfPort { at: Vec3; nps: number; prep: EndPrep; branch: boolean; runId: string }

/**
 * Where a component's port ends along the pipe's centreline (which meets an eccentric reducer's small end off its
 * node); `face` stops at a flanged component's own face, before its gasket and mate. Model millimetres.
 */
function portAt(doc: IsoDocument, n: PipeNode, r: PipeRun, face = false): Vec3 {
  const other = getNode(doc, r.from === n.id ? r.to : r.from)
  const from = portPoint(doc, n, r.id), to = portPoint(doc, other, r.id)
  const delta = sub(to, from),
    d = distance(from, to),
    t = (takeout(doc, n, r.id) ?? 0) - (face ? flangedAllowance(doc, n, r) : 0)
  return add(from, mul(delta, t / (d || 1)))
}
/**
 * The face of a flange at an open end (equipment, an existing flange, the next drawing): the joint it makes with what
 * lies beyond. The flange's node is its face, or the face it bolts to when the drawing measures to the mate.
 */
function openFlangeFace(doc: IsoDocument, n: PipeNode): { at: Vec3; run: PipeRun; nps: number } | undefined {
  if (n.kind !== 'flange') return undefined
  const code = nodeCode(doc, n)
  if (!code || COMPONENT_TYPE_BY_CODE[code]?.endPrep === 'FL') return undefined
  const edges = doc.runs.filter(r => r.from === n.id || r.to === n.id)
  if (edges.length !== 1 || edges[0].connector) return undefined
  const r = edges[0], toward = sub(portAt(doc, n, r), n.position), span = distance(portAt(doc, n, r), n.position)
  const own = n.jointSupply, spec = doc.specs.find(s => s.id === r.specId)
  const inside = own?.measuredTo === 'mate' && own.gasket !== false && spec ? jointGasket(spec, r.nps, /FF/.test(code) ? 'FF' : /RF/.test(code) ? 'RF' : specFace(spec)).thickness : 0
  return { at: span ? add(n.position, mul(toward, inside / span)) : n.position, run: r, nps: r.nps }
}
/** The ports a component is written with, in model millimetres. */
function componentPorts(doc: IsoDocument, n: PipeNode): PcfPort[] {
  const code = nodeCode(doc, n), own = code ? COMPONENT_TYPE_BY_CODE[code]?.endPrep : undefined
  const header = n.kind === 'olet' ? doc.runs.find(r => r.id === n.associatedRunId) : undefined
  return doc.runs.filter(r => r.from === n.id || r.to === n.id).map(r => {
    const index = r.from === n.id ? 0 : 1
    // A component's ports are its own end connection; a flange's two sides differ (face and weld end), so it takes the pipe's.
    const prep = n.kind !== 'flange' && own ? own : prepAt(r, index)
    return { at: portAt(doc, n, r, own === 'FL'), nps: r.nps, prep, branch: n.branchEdgeId === r.id || !!header, runId: r.id }
  })
}

/** The PCF of a drawing: spec-clean, with Spoolyard's round-trip data left to the `.piping` sidecar. */
export function exportPcf(doc: IsoDocument, options: PcfExportOptions = {}): string {
  return withIndex(doc, () => writePcf(doc, options))
}
function writePcf(doc: IsoDocument, options: PcfExportOptions): string {
  if (doc.runs.some(r => !Number.isFinite(runResult(doc, r).cut) || !r.connector && runResult(doc, r).cut <= 0))
    throw new Error('Enter the missing fitting takeouts and correct non-positive pipe cuts before exporting PCF.')
  const metric = doc.units === 'mm'
  const boreUnits = options.boreUnits ?? (profileOf(doc).sizeNotation === 'DN' ? 'MM' : 'INCH'), coordUnits = options.coordUnits ?? (metric ? 'MM' : 'INCH')
  const perUnit = coordUnits === 'MM' ? 1 : 25.4, weightUnit = metric ? 'KGS' : 'LBS', kg = metric ? 1 : 0.45359237
  const safe = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim()
  const bore = (nps: number) => boreUnits === 'INCH' ? String(Number(nps.toFixed(4))) : String(dnOf(nps) ?? Math.round(nps * 25.4))
  const xyz = (p: Vec3) => plantCoordinate(doc, p).map(v => (v / perUnit).toFixed(4)).join(' ')
  const point = (p: Vec3, nps: number, prep?: EndPrep) => `${xyz(p)} ${bore(nps)}${prep ? ' ' + END_TOKEN[prep] : ''}`
  const length = (mm: number) => Number((mm / perUnit).toFixed(4))
  // Bolting is sized in UNITS-BOLT-DIA / UNITS-BOLT-LENGTH (the coordinate units): inches to the 1/16" bolts are made
  // in (else three decimals), millimetres to 0.1 mm. 15.88 mm is 5/8", not 0.6252".
  const boltSize = (mm: number) => {
    if (coordUnits === 'MM') return Number(mm.toFixed(1))
    const inches = mm / 25.4, sixteenths = Math.round(inches * 16) / 16
    return Math.abs(inches - sixteenths) < 0.002 ? sixteenths : Number(inches.toFixed(3))
  }
  const weighed = (kgs: number | null | undefined) => kgs != null && Number.isFinite(kgs) ? [`    WEIGHT ${Number((kgs / kg).toFixed(3))}`] : []
  const joints = flangedJoints(doc)
  /** Weight of a joint part as the material list weighs it: one flange or gasket, or the joint's set of bolts. */
  const jointWeight = (member: string, qty = 1) => weighed(measureMember(doc, member, qty, joints).weightKg)

  // MATERIALS: one entry per distinct description and item code, numbered in the order the sheets list them.
  const listed = new Map<string, string>()
  for (const row of sheetMaterials(doc)) for (const member of row.memberIds) listed.set(member, row.description)
  const materials: Array<{ code?: string; description: string }> = [], materialIndex = new Map<string, number>()
  const material = (member: string, code: string | undefined, fallback?: string, own = false): string[] => {
    const description = own ? fallback : listed.get(member) ?? fallback
    if (!description) return code ? [`    ITEM-CODE ${safe(code)}`] : []
    const key = JSON.stringify([code ?? '', description])
    let n = materialIndex.get(key)
    if (n == null) {
      materials.push({ code, description })
      materialIndex.set(key, (n = materials.length))
    }
    return [...(code ? [`    ITEM-CODE ${safe(code)}`] : []), `    MATERIAL-IDENTIFIER ${n}`]
  }
  const itemCode = (item?: CatalogItem) => item?.partCode || item?.id || undefined
  // Pipe is described with the ends it is cut to, as the material list and cut list give them.
  const pipeDescription = (r: PipeRun) => pipeText(doc, r, [pipeEnd(doc, r, 0), pipeEnd(doc, r, 1)])

  // Records by pipeline, in the order pipelines first appear.
  const pipelines = new Map<string, string[][]>()
  const record = (line: string, lines: string[]) => {
    const name = safe(line) || safe(doc.drawing) || 'PIPELINE'
    pipelines.set(name, [...(pipelines.get(name) ?? []), lines])
  }
  const category = (field?: boolean) => field ? ['    CATEGORY ERECTION'] : []
  const spoolOf = (spool: string) => safe(spool) ? [`    SPOOL-IDENTIFIER ${safe(spool)}`] : []

  // A flanged component's mating flange, gasket and bolts are their own PCF components. Their UCIs name the joint part.
  for (const joint of joints.filter(j => j.kind === 'component-port' && j.flanges.some(f => f.implicit))) {
    const n = getNode(doc, joint.nodeId), r = doc.runs.find(x => x.id === joint.runIds[0])!, index = r.from === n.id ? 0 : 1
    const faceAt = portAt(doc, n, r, true), pipeEnd = portAt(doc, n, r), dir = sub(pipeEnd, faceAt), span = distance(pipeEnd, faceAt) || 1
    const gasket = joint.gasket?.thickness ?? 0
    const flangeFace = add(faceAt, mul(dir, gasket / span))
    const flange = joint.flanges.find(f => f.implicit)!, rule = pcfComponent(flange.code, 'flange')!
    const common = [`    PIPING-SPEC ${safe(r.specId)}`, ...spoolOf(r.spool)]
    record(r.line, [rule.type, `    END-POINT ${point(flangeFace, r.nps, 'FL')}`, `    END-POINT ${point(pipeEnd, r.nps, pipePrepAt(doc, r, index))}`,
      ...(skeyOf(rule) ? [`    SKEY ${skeyOf(rule)}`] : []), `    UCI ${joint.id}#flange`,
      ...material(joint.id + '#flange', itemCode(flange.item)), ...jointWeight(joint.id + '#flange'), ...common, ...category(n.field)])
    // The gasket is always written: it carries the joint's geometry back on import.
    if (joint.gasket)
      record(r.line, ['GASKET', `    END-POINT ${point(faceAt, r.nps, 'FL')}`, `    END-POINT ${point(flangeFace, r.nps, 'FL')}`, `    UCI ${joint.id}#gasket`,
        ...(joint.supplied.gasket ? [...material(joint.id + '#gasket', itemCode(joint.gasket.item)), ...jointWeight(joint.id + '#gasket')] : []), ...common, ...category(n.field)])
    if (joint.bolts && joint.supplied.bolts) {
      const b = joint.bolts
      record(r.line, ['BOLT', `    CO-ORDS ${point(faceAt, r.nps)}`, `    BOLT-QUANTITY ${b.count}`,
        `    BOLT-DIA ${boltSize(b.diameter)}`, `    BOLT-LENGTH ${boltSize(b.length)}`, `    UCI ${joint.id}#bolts`,
        ...material(joint.id + '#bolts', itemCode(b.item)), ...jointWeight(joint.id + '#bolts', b.count), ...common, ...category(n.field)])
    }
  }

  // The gasket and bolting an open-end flange's joint supplies, at its face. Their UCIs name the flange and its pipe,
  // so a PCF read back with its sidecar rebuilds them from the flange.
  for (const joint of joints.filter(j => j.kind === 'equipment' && (j.supplied.gasket || j.supplied.bolts))) {
    const n = getNode(doc, joint.nodeId), face = openFlangeFace(doc, n)
    if (!face) continue
    const r = face.run, away = sub(face.at, portAt(doc, n, r)), span = distance(face.at, portAt(doc, n, r)) || 1
    const common = [`    PIPING-SPEC ${safe(r.specId)}`, ...spoolOf(r.spool)], uci = `${n.id}:${r.id}`
    if (joint.gasket && joint.supplied.gasket)
      record(r.line, ['GASKET', `    END-POINT ${point(face.at, r.nps, 'FL')}`, `    END-POINT ${point(add(face.at, mul(away, joint.gasket.thickness / span)), r.nps, 'FL')}`,
        `    UCI ${uci}#gasket`, ...material(joint.id + '#gasket', itemCode(joint.gasket.item)), ...jointWeight(joint.id + '#gasket'), ...common, ...category(n.field)])
    if (joint.bolts && joint.supplied.bolts) {
      const b = joint.bolts
      record(r.line, ['BOLT', `    CO-ORDS ${point(face.at, r.nps)}`, `    BOLT-QUANTITY ${b.count}`,
        `    BOLT-DIA ${boltSize(b.diameter)}`, `    BOLT-LENGTH ${boltSize(b.length)}`, `    UCI ${uci}#bolts`,
        ...material(joint.id + '#bolts', itemCode(b.item)), ...jointWeight(joint.id + '#bolts', b.count), ...common, ...category(n.field)])
    }
  }

  for (const n of doc.nodes) {
    if (n.kind === 'end' || n.kind === 'annotation') continue
    const ports = componentPorts(doc, n), edges = doc.runs.filter(r => r.from === n.id || r.to === n.id)
    const header = n.kind === 'olet' ? doc.runs.find(r => r.id === n.associatedRunId) : undefined
    // A fitting is written under its run (header) pipe, never its branch, whatever order the pipes were drawn in.
    const host = header ?? edges.find(r => r.id !== n.branchEdgeId) ?? edges[0] ?? doc.runs.find(r => r.id === n.associatedRunId)
    if (!host) continue
    if (n.kind === 'weld') {
      const fit = edges.some(r => (r.from === n.id ? r.fromFieldFit : r.toFieldFit))
      record(host.line, ['WELD', `    CO-ORDS ${point(n.position, host.nps)}`, `    SKEY ${fit ? 'WF' : n.field ? 'WS' : 'WW'}`, `    UCI ${n.id}`,
        ...(n.tag ? [`    WELD-IDENTIFIER ${safe(n.tag)}`] : []), ...category(n.field), ...spoolOf(host.spool)])
      continue
    }
    const code = nodeCode(doc, n), rule = pcfComponent(code, n.kind)
    if (!rule) continue
    // A 180° return is drawn as two halves joined by its body; it is one ELBOW, written once for the pair.
    const pair = returnPartner(doc, n)
    if (pair) {
      if (doc.nodes.indexOf(pair.partner) < doc.nodes.indexOf(n)) continue
      const outer = [n, pair.partner].flatMap(h => componentPorts(doc, h).filter(p => p.runId !== pair.body.id))
      if (outer.length !== 2) continue
      const end = code ? COMPONENT_TYPE_BY_CODE[code]?.endPrep : undefined
      record(host.line, ['ELBOW', ...outer.map(p => `    END-POINT ${point(p.at, p.nps, p.prep)}`),
        `    CENTRE-POINT ${point(mul(add(outer[0].at, outer[1].at), 0.5), host.nps)}`, `    SKEY ${skeyOf(rule, end ?? outer[0].prep)}`,
        `    UCI ${n.id}+${pair.partner.id}`, ...material(n.id, fitting(doc, n)?.partCode || nodeItem(doc, n)?.partCode || n.catalogId || undefined, n.description?.toUpperCase()),
        '    ANGLE 18000', ...(n.heat?.trim() ? [`    HEAT-NUMBER ${safe(n.heat)}`] : []),
        `    PIPING-SPEC ${safe(host.specId)}`, ...spoolOf(host.spool), ...category(n.field)])
      continue
    }
    const item = nodeItem(doc, n), own = code ? COMPONENT_TYPE_BY_CODE[code]?.endPrep : undefined
    const skey = skeyOf(rule, own ?? ports[0]?.prep ?? 'BW')
    const lines = [rule.type]
    if (POINT_ONLY.has(rule.type)) lines.push(`    CO-ORDS ${point(n.position, host.nps)}`)
    else {
      // A flange at an open end is written face and weld end, as any flange is; its face is where its joint is.
      const face = openFlangeFace(doc, n)
      if (face) lines.push(`    END-POINT ${point(face.at, face.nps, 'FL')}`)
      for (const p of ports.filter(p => !p.branch)) lines.push(`    END-POINT ${point(p.at, p.nps, p.prep)}`)
      if (CENTRED.has(rule.type) || header) lines.push(`    CENTRE-POINT ${point(n.position, host.nps)}`)
      ports.filter(p => p.branch).forEach((p, i) => lines.push(`    BRANCH${i + 1}-POINT ${point(p.at, p.nps, p.prep)}`))
    }
    if (skey) lines.push(`    SKEY ${skey}`)
    lines.push(`    UCI ${n.id}`)
    lines.push(...material(n.id, fitting(doc, n)?.partCode || item?.partCode || n.catalogId || undefined, n.description?.toUpperCase()))
    if (rule.type === 'ELBOW' || rule.type === 'BEND') {
      const angle = n.bendAngle ?? (/180R$/.test(code ?? '') ? 180 : n.kind === 'elbow45' ? 45 : 90)
      lines.push(`    ANGLE ${Math.round(angle * 100)}`)
      if (rule.type === 'BEND' && n.bendRadius) lines.push(`    BEND-RADIUS ${length(n.bendRadius)}`)
    }
    if (rule.type === 'REDUCER-ECCENTRIC' && n.flatSide) lines.push(`    FLAT-DIRECTION ${FLAT_DIRECTION[n.flatSide]}`)
    if (n.kind === 'bolt') {
      lines.push(`    BOLT-QUANTITY ${n.quantity ?? 1}`)
      if (item?.boltDiameter) lines.push(`    BOLT-DIA ${boltSize(item.boltDiameter)}`)
      if (item?.boltLength) lines.push(`    BOLT-LENGTH ${boltSize(item.boltLength)}`)
    }
    // A component's WEIGHT is the whole component's: a BOLT record's, its BOLT-QUANTITY bolts.
    const weight = n.weightKg ?? fitting(doc, n)?.weightKg
    if (weight != null) lines.push(...weighed(n.kind === 'bolt' ? weight * (n.quantity ?? 1) : weight))
    if (n.heat?.trim()) lines.push(`    HEAT-NUMBER ${safe(n.heat)}`)
    lines.push(`    PIPING-SPEC ${safe(host.specId)}`, ...spoolOf(host.spool), ...category(n.field))
    record(host.line, lines)
  }

  for (const r of doc.runs.filter(r => !r.connector && !isReturnBody(doc, r))) {
    const [a, b] = [r.from, r.to].map(k => getNode(doc, k))
    record(r.line, ['PIPE', `    END-POINT ${point(portAt(doc, a, r), r.nps, pipePrepAt(doc, r, 0))}`,
      `    END-POINT ${point(portAt(doc, b, r), r.nps, pipePrepAt(doc, r, 1))}`, `    UCI ${r.id}`,
      // Pipe is described as the material it is cut from, not as one sheet's cut.
      ...material(r.id, undefined, pipeDescription(r), true),
      `    PIPING-SPEC ${safe(r.specId)}`, ...spoolOf(r.spool), ...(r.heat?.trim() ? [`    HEAT-NUMBER ${safe(r.heat)}`] : [])])
  }
  // Where the line goes on beyond the drawing: END-CONNECTION-PIPELINE names it (ISOGEN letters it "CONT. ON"), and an
  // end left open or closed off is END-POSITION-OPEN / -CLOSED.
  for (const n of doc.nodes) {
    if (!n.continuation) continue
    const host = doc.runs.find(r => r.from === n.id || r.to === n.id) ?? doc.runs.find(r => r.id === n.associatedRunId)
    if (!host) continue
    const termination = n.continuation.termination
    if (termination === 'open' || termination === 'closed')
      record(host.line, [termination === 'open' ? 'END-POSITION-OPEN' : 'END-POSITION-CLOSED', `    CO-ORDS ${point(n.position, host.nps)}`])
    else {
      const reference = continuationReference(n.continuation.text)
      if (reference) record(host.line, ['END-CONNECTION-PIPELINE', `    CO-ORDS ${point(n.position, host.nps)}`, `    PIPELINE-REFERENCE ${reference}`])
    }
  }
  // Welds at component ends: a numbered or shop/field weld that has no weld node of its own.
  const weldNodes = new Set(doc.nodes.filter(n => n.kind === 'weld').map(n => xyz(n.position)))
  const seen = new Set<string>()
  for (const r of doc.runs.filter(r => !isReturnBody(doc, r)))
    for (const [i, key] of [r.from, r.to].entries()) {
      const node = getNode(doc, key)
      if (node.kind === 'weld') continue
      const field = i === 0 ? r.fromField : r.toField, tag = i === 0 ? r.fromTag : r.toTag, fit = i === 0 ? r.fromFieldFit : r.toFieldFit
      if (field == null && !tag && !fit) continue
      const at = portAt(doc, node, r), identity = xyz(at)
      if (seen.has(identity) || weldNodes.has(identity)) continue
      seen.add(identity)
      record(r.line, ['WELD', `    CO-ORDS ${point(at, r.nps)}`, `    SKEY ${fit ? 'WF' : field ? 'WS' : 'WW'}`,
        ...(tag ? [`    WELD-IDENTIFIER ${safe(tag)}`] : []), ...category(field), ...spoolOf(r.spool)])
    }

  const out = [
    'ISOGEN-FILES ISOGEN.FLS',
    `UNITS-BORE ${boreUnits}`,
    `UNITS-CO-ORDS ${coordUnits}`,
    `UNITS-BOLT-DIA ${coordUnits}`,
    `UNITS-BOLT-LENGTH ${coordUnits}`,
    `UNITS-WEIGHT ${weightUnit}`
  ]
  const specOf = (line: string) => doc.runs.find(r => (safe(r.line) || safe(doc.drawing) || 'PIPELINE') === line)?.specId
  for (const [line, records] of pipelines) {
    out.push(`PIPELINE-REFERENCE ${line}`)
    if (doc.project.trim()) out.push(`    PROJECT-IDENTIFIER ${safe(doc.project)}`)
    if (doc.revision.trim()) out.push(`    REVISION ${safe(doc.revision)}`)
    const spec = specOf(line), own = doc.specs.find(s => s.id === spec)
    if (spec) out.push(`    PIPING-SPEC ${safe(spec)}`)
    if (own?.rating.trim()) out.push(`    NOMINAL-CLASS ${safe(own.rating)}`)
    // The drawing's number and title, and the specification's weld gaps, in the user attributes (see PCF_ATTRIBUTE).
    if (doc.drawing.trim()) out.push(`    ${PCF_ATTRIBUTE.drawing} ${safe(doc.drawing)}`)
    if (doc.title.trim()) out.push(`    ${PCF_ATTRIBUTE.title} ${safe(doc.title)}`)
    if (own) out.push(`    ${PCF_ATTRIBUTE.rootGap} ROOT-GAP ${Number(own.rootGap.toFixed(3))} MM`)
    if (own?.socketGap != null) out.push(`    ${PCF_ATTRIBUTE.socketGap} SOCKET-GAP ${Number(own.socketGap.toFixed(3))} MM`)
    for (const lines of records) out.push(...lines)
  }
  if (materials.length) {
    out.push('MATERIALS')
    materials.forEach((m, i) => out.push(`MATERIAL-IDENTIFIER ${i + 1}`, ...(m.code ? [`    ITEM-CODE ${safe(m.code)}`] : []), `    DESCRIPTION ${safe(m.description)}`))
  }
  return out.join('\n') + '\n'
}
/**
 * The PCF of a drawing with its `.piping` sidecar: the native drawing, which `importPcf(pcf, { sidecar })` uses to
 * restore everything a PCF does not carry (drafting, catalogue, takeouts, sheets).
 */
export function exportPcfPackage(doc: IsoDocument, options: PcfExportOptions = {}): { pcf: string; sidecar: string } {
  return { pcf: exportPcf(doc, options), sidecar: JSON.stringify(doc) }
}

// ---------------------------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------------------------

export interface PcfImportOptions {
  /** End points within this distance (mm) are one connection. Default 0.5 mm. */
  tolerance?: number
  /** The drawing's `.piping` sidecar (see exportPcfPackage): restores what the PCF does not carry. */
  sidecar?: string | IsoDocument
}
export interface PcfImport {
  doc: IsoDocument
  /** What the import could not carry over exactly; show these to the drafter. */
  warnings: string[]
}
interface PcfRecord {
  type: string
  fields: Map<string, string[]>
  line: string
  spec: string
  /** 1-based line number of the record's first line. */
  at: number
}
interface Port {
  nodeId: string
  takeout: number
  nps: number
  prep: EndPrep
  branch: boolean
  field?: boolean
  fit?: boolean
  tag?: string
}
const first = (r: PcfRecord, k: string) => r.fields.get(k)?.[0]
const has = (r: PcfRecord, k: string) => r.fields.has(k)
/** Spoolyard drawings carried in the attribute records of PCFs written before 0.6 (BIDWRIGHT-/SPOOLYARD-). */
const LEGACY = {
  rootGap: /^BIDWRIGHT-ROOT-GAP\s+(\d+(?:\.\d+)?)/,
  specs: /^BIDWRIGHT-SPECS (.+)$/,
  drawing: /^SPOOLYARD-DRAWING (.+)$/,
  component: /^SPOOLYARD-COMPONENT (.+)$/,
  pipe: /^BIDWRIGHT-PIPE (.+)$/,
  implicit: /^SPOOLYARD-IMPLICIT/
}
/** Node fields recomputed from the PCF geometry, never taken from round-trip data. */
const NODE_GEOMETRY = new Set(['id', 'position', 'portTakeouts', 'branchEdgeId', 'associatedRunId'])

/** PCF import with explicit units, material references, branch ports and direct fitting assemblies. */
export function importPcf(text: string, options: PcfImportOptions = {}): PcfImport {
  if (text.length > PCF_MAX_CHARS) throw new Error(`PCF exceeds the ${PCF_MAX_CHARS / 1e6} MB limit.`)
  const tolerance = options.tolerance ?? PCF_DEFAULT_TOLERANCE
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new Error('The PCF connection tolerance must be a positive length.')
  const warnings: string[] = []
  const headers = new Map<string, string>(),
    /** Each pipeline's own header fields (NOMINAL-CLASS, the weld-gap attributes), by its PIPELINE-REFERENCE. */
    pipelineHeaders = new Map<string, Map<string, string>>(),
    materials = new Map<string, string>(),
    records: PcfRecord[] = []
  let current: PcfRecord | undefined,
    lineRef = 'PCF-001',
    specRef = 'PCF-UNSPECIFIED',
    inMaterials = false,
    materialKey = '',
    materialCode = ''
  text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
    if (!line.trim() || line.trim().startsWith('#')) return
    const match = line.trim().match(/^(\S+)\s*(.*)$/)!
    const key = match[1].toUpperCase(),
      value = match[2].trim()
    if (inMaterials) {
      if (key === 'MATERIAL-IDENTIFIER') {
        materialKey = value
        materialCode = ''
      }
      if (key === 'ITEM-CODE') {
        materialCode = value
        if (!/^\s/.test(line)) materialKey = ''
      }
      if (key === 'DESCRIPTION') {
        if (materialKey) materials.set('#' + materialKey, value)
        if (materialCode) materials.set(materialCode, value)
      }
      return
    }
    if (!/^\s/.test(line)) {
      if (key === 'MATERIALS') {
        inMaterials = true
        current = undefined
        return
      }
      if (key === 'PIPELINE-REFERENCE') {
        lineRef = value
        if (!headers.has(key)) headers.set(key, value)
        current = undefined
        return
      }
      if (key.startsWith('UNITS-') || key === 'ISOGEN-FILES') {
        headers.set(key, value)
        current = undefined
        return
      }
      current = { type: key, fields: new Map(), line: lineRef, spec: specRef, at: index + 1 }
      records.push(current)
    } else if (current) current.fields.set(key, [...(current.fields.get(key) ?? []), value])
    else {
      // Each pipeline's PIPING-SPEC governs its own parts; the drawing's header fields are the first pipeline's.
      if (!headers.has(key)) headers.set(key, value)
      if (key === 'PIPING-SPEC') specRef = value
      const own = pipelineHeaders.get(lineRef) ?? new Map<string, string>()
      if (!own.has(key)) own.set(key, value)
      pipelineHeaders.set(lineRef, own)
    }
  })
  const coordUnit = headers.get('UNITS-CO-ORDS')?.toUpperCase(),
    boreUnit = headers.get('UNITS-BORE')?.toUpperCase()
  if (!coordUnit || COORD_UNITS[coordUnit] == null || !boreUnit || BORE_UNITS[boreUnit] == null)
    throw new Error('PCF needs UNITS-CO-ORDS (MM or INCH) and UNITS-BORE (MM, INCH or INCH-SIXTEENTH) headers.')
  const factor = COORD_UNITS[coordUnit], boreFactor = BORE_UNITS[boreUnit]
  const weightFactor = headers.get('UNITS-WEIGHT')?.toUpperCase().startsWith('LB') ? 0.45359237 : 1
  const boltDiaFactor = COORD_UNITS[headers.get('UNITS-BOLT-DIA')?.toUpperCase() ?? ''] ?? factor,
    boltLengthFactor = COORD_UNITS[headers.get('UNITS-BOLT-LENGTH')?.toUpperCase() ?? ''] ?? factor

  // Round-trip data: the sidecar, else what an earlier Spoolyard wrote into the attribute records.
  const legacy = (r: PcfRecord | undefined, attribute: string, pattern: RegExp, what: string) => {
    const raw = r ? first(r, attribute) : headers.get(attribute)
    const m = raw?.match(pattern)
    if (!m || m[1] == null) return undefined
    try {
      return JSON.parse(decodeURIComponent(m[1]))
    } catch {
      warnings.push(`Ignored unreadable ${what} in ${attribute}${r ? ` (line ${r.at})` : ''}; the PCF geometry was used.`)
      return undefined
    }
  }
  let sidecar: IsoDocument | undefined
  if (options.sidecar != null) {
    try {
      sidecar = parseIsoJson(typeof options.sidecar === 'string' ? options.sidecar : JSON.stringify(options.sidecar))
    } catch (e) {
      throw new Error(`The .piping sidecar could not be read: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const origin = sidecar?.coordinates?.origin ?? [0, 0, 0]

  const doc = newIso()
  doc.drawing = headers.get(PCF_ATTRIBUTE.drawing) || headers.get('PIPELINE-REFERENCE') || 'PCF-001'
  const title = headers.get(PCF_ATTRIBUTE.title)
  if (title) doc.title = title
  doc.units = factor === 1 || factor === 0.01 ? 'mm' : 'imperial'
  doc.revision = headers.get('REVISION') ?? '0'
  doc.project = headers.get('PROJECT-IDENTIFIER') ?? ''
  const gapMatch = headers.get('ATTRIBUTE99')?.match(LEGACY.rootGap)
  const gap = gapMatch ? Number(gapMatch[1]) : 0
  Object.assign(doc.specs[0], {
    rootGap: gap, id: 'PCF-UNSPECIFIED', name: 'PCF · specification required', material: 'Unspecified', schedule: 'Unspecified',
    sizes: [], fittings: []
  })
  const legacySpecs = legacy(undefined, 'ATTRIBUTE98', LEGACY.specs, 'specification catalogue')
  /** Specifications made from the PCF alone (not the sidecar's or an earlier Spoolyard's catalogue). */
  const importedSpecs = new Set<PipeSpec>()
  if (sidecar) doc.specs = clone(sidecar.specs)
  else if (Array.isArray(legacySpecs)) {
    try {
      const trial = newIso()
      trial.specs = legacySpecs
      doc.specs = parseIsoJson(JSON.stringify(trial)).specs
    } catch {
      warnings.push('Ignored an invalid embedded specification catalogue; add the pipe specification before fabrication.')
    }
  }
  // Spoolyard's own PCF states each specification's root gap (PCF_ATTRIBUTE); another program's leaves it to ISOGEN.
  const statedGap = [...pipelineHeaders.values()].some(h => GAP_ATTRIBUTE.rootGap.test(h.get(PCF_ATTRIBUTE.rootGap) ?? ''))
  if (!sidecar && !gapMatch && !statedGap)
    warnings.push('PCF endpoint lengths are used directly; imported root gap starts at 0 mm. Add the actual pipe specification and weights before fabrication.')
  const metadata = sidecar ?? legacy(undefined, 'ATTRIBUTE95', LEGACY.drawing, 'drawing data')
  if (metadata && typeof metadata === 'object') {
    const keys = sidecar
      ? Object.keys(sidecar).filter(k => !['schema', 'version', 'nodes', 'runs', 'specs'].includes(k))
      : ['title', 'drawing', 'revision', 'customer', 'project', 'drawnBy', 'checkedBy', 'notes', 'units', 'north', 'dimensionMode', 'grid', 'paper', 'outputViews', 'weldStart', 'weldPrefix', 'weldNumbering']
    for (const key of keys) if (Object.hasOwn(metadata, key)) Object.assign(doc, { [key]: clone((metadata as Record<string, unknown>)[key]) })
    // The sidecar's drawing settings are its own: a setting it leaves unset stays unset.
    if (sidecar)
      for (const key of Object.keys(doc) as Array<keyof IsoDocument>)
        if (!['schema', 'version', 'nodes', 'runs', 'specs'].includes(key) && !Object.hasOwn(sidecar, key)) delete doc[key]
  }

  // Bores written as DN are listed as DN, unless the drawing's own settings say otherwise.
  if (boreFactor === 'dn' && !doc.profile?.sizeNotation && !sidecar) doc.profile = { ...doc.profile, sizeNotation: 'DN' }

  // The parts written for a flanged component's joint (mating flange, gasket, bolts) are rebuilt from the component.
  // That needs the component's own data: the sidecar, or an earlier Spoolyard's attributes. Otherwise they stay parts.
  const sidecarNodes = new Map((sidecar?.nodes ?? []).map(n => [n.id, n]))
  const sidecarRuns = new Map((sidecar?.runs ?? []).map(r => [r.id, r]))
  const implicit = (r: PcfRecord) => {
    if (r.fields.get('ATTRIBUTE97')?.some(v => LEGACY.implicit.test(v))) return true
    const uci = first(r, 'UCI')?.match(/^(.+?):(.+)#(flange|gasket|bolts)$/)
    return !!uci && sidecarNodes.has(uci[1]) && sidecarRuns.has(uci[2])
  }

  // Coordinates and the points that are one connection (within the tolerance).
  const lineOf = (r: PcfRecord) => `${r.type} at line ${r.at}`
  const point = (value: string, r: PcfRecord): Vec3 => {
    const parts = value.split(/\s+/).slice(0, 3).map(Number)
    if (parts.length !== 3 || !parts.every(Number.isFinite)) throw new Error(`Invalid PCF point "${value}" in ${lineOf(r)}.`)
    return sub(parts.map(n => n * factor) as Vec3, origin)
  }
  const cells = new Map<string, Vec3[]>(), cell = (v: number) => Math.floor(v / tolerance)
  /** The connection a point belongs to: the first point read within the tolerance of it. */
  const canonical = (p: Vec3): Vec3 => {
    const [i, j, k] = p.map(cell)
    for (let a = i - 1; a <= i + 1; a++)
      for (let b = j - 1; b <= j + 1; b++)
        for (let c = k - 1; c <= k + 1; c++)
          for (const q of cells.get(`${a},${b},${c}`) ?? []) if (distance(p, q) <= tolerance) return q
    const key = `${i},${j},${k}`
    cells.set(key, [...(cells.get(key) ?? []), p])
    return p
  }
  const key = (p: Vec3) => canonical(p).map(n => n.toFixed(6)).join(',')
  const bridged = new Map<string, string>()
  for (const flange of records.filter(r => implicit(r) && r.type !== 'GASKET' && r.type !== 'BOLT')) {
    const [face, pipeEnd] = flange.fields.get('END-POINT') ?? []
    if (!face || !pipeEnd) continue
    bridged.set(key(point(face, flange)), pipeEnd)
    const gasket = records.find(r => implicit(r) && r.type === 'GASKET' && r.fields.get('END-POINT')?.[1] != null && key(point(r.fields.get('END-POINT')![1], r)) === key(point(face, flange)))
    const componentFace = gasket?.fields.get('END-POINT')?.[0]
    if (componentFace) bridged.set(key(point(componentFace, gasket!)), pipeEnd)
  }
  for (let i = records.length - 1; i >= 0; i--) if (implicit(records[i])) records.splice(i, 1)
  for (const r of records)
    for (const k of ['END-POINT', 'BRANCH1-POINT', 'BRANCH2-POINT', 'BRANCH3-POINT']) {
      const points = r.fields.get(k)
      if (!points) continue
      r.fields.set(k, points.map(v => {
        const to = bridged.get(key(point(v, r)))
        return to ? [...to.split(/\s+/).slice(0, 3), ...v.split(/\s+/).slice(3)].join(' ') : v
      }))
    }

  // Which records are what.
  const skipped = new Map<string, number>(), generic = new Map<string, number>()
  const count = (map: Map<string, number>, type: string) => map.set(type, (map.get(type) ?? 0) + 1)
  const parts: Array<{ r: PcfRecord; kind: Kind; code?: string }> = []
  /** Where the line continues onto another (END-CONNECTION-PIPELINE) or ends open or closed (END-POSITION-…). */
  const endConnections: PcfRecord[] = []
  const pipes: PcfRecord[] = []
  const endsOf = (r: PcfRecord) => ['END-POINT', 'BRANCH1-POINT', 'BRANCH2-POINT', 'BRANCH3-POINT'].flatMap(k => r.fields.get(k) ?? [])
  /** An end point's connection; an end written without one is butt-welded, an unrecognised one plain. */
  const endPrepOf = (value: string): EndPrep => {
    const token = value.split(/\s+/)[4]?.toUpperCase() || value.split(/\s+/)[3]?.replace(BORE_NUMBER, '').toUpperCase()
    return token ? END_PREP[token] ?? 'PLAIN' : 'BW'
  }
  for (const r of records) {
    if (PIPE_TYPES.has(r.type)) {
      if (r.type !== 'PIPE') count(generic, r.type)
      pipes.push(r)
      continue
    }
    if (CONNECTION_RECORD.test(r.type)) {
      if (/^END-(CONNECTION-PIPELINE|POSITION-OPEN|POSITION-CLOSED)$/.test(r.type)) endConnections.push(r)
      continue
    }
    if (ANNOTATION_RECORD.test(r.type)) {
      count(skipped, r.type)
      continue
    }
    const skey = first(r, 'SKEY')?.toUpperCase()
    let kind = IMPORT_KIND[r.type], code = skey ? SKEY_CODE.get(`${r.type}|${skey}`) : undefined
    const oletCode = OLET_CODE[r.type]
    if (!code && oletCode) code = typeof oletCode === 'string' ? oletCode : oletCode(r.fields.has('BRANCH1-POINT') ? endPrepOf(r.fields.get('BRANCH1-POINT')![0]) : undefined)
    if (!code && r.type === 'REDUCER-ECCENTRIC') code = (r.fields.get('END-POINT') ?? []).some(v => endPrepOf(v) === 'PLAIN') ? 'E-SWAGE' : 'E-RED'
    if (code) kind = (COMPONENT_TYPE_BY_CODE[code]?.kind as Kind) ?? kind
    if (!kind) {
      // An unknown part on the line is kept as a generic in-line component, so nothing silently drops off the BOM.
      const ends = endsOf(r)
      if (!ends.length) {
        count(skipped, r.type)
        continue
      }
      kind = ends.length > 2 ? 'tee' : 'valve'
      count(generic, r.type)
    }
    parts.push({ r, kind, code })
  }
  if (skipped.size)
    warnings.push(`Skipped ${[...skipped.values()].reduce((a, b) => a + b, 0)} annotation or unplaced record(s): ${[...skipped].map(([t, n]) => n > 1 ? `${t} ×${n}` : t).join(', ')}.`)
  if (generic.size)
    warnings.push(`Imported unrecognised component type(s) as generic parts: ${[...generic].map(([t, n]) => n > 1 ? `${t} ×${n}` : t).join(', ')}. Check their symbols, takeouts and material descriptions.`)

  // The placeholder for parts with no PIPING-SPEC is the PCF's own too.
  if (!sidecar && doc.specs[0]?.id === 'PCF-UNSPECIFIED') importedSpecs.add(doc.specs[0])
  /** A weld gap a pipeline's header states in Spoolyard's attribute (see PCF_ATTRIBUTE). */
  const gapOf = (line: string, which: 'rootGap' | 'socketGap') => {
    const m = pipelineHeaders.get(line)?.get(PCF_ATTRIBUTE[which])?.match(GAP_ATTRIBUTE[which])
    return m ? Number(m[1]) : undefined
  }
  const specFor = (name: string, line?: string) => {
    let spec = doc.specs.find(s => s.id === name)
    if (!spec) {
      spec = clone(doc.specs[0])
      Object.assign(spec, { id: name, name: `${name} · imported specification`, fittings: [], sizes: [], material: 'Unspecified', schedule: 'Unspecified', rootGap: gap })
      delete spec.socketGap
      doc.specs.push(spec)
      importedSpecs.add(spec)
      // What the pipeline header says of its specification: its class, and the weld gaps Spoolyard wrote.
      const header = line == null ? undefined : pipelineHeaders.get(line)
      const rating = header?.get('NOMINAL-CLASS')
      if (rating) spec.rating = rating
      const root = line == null ? undefined : gapOf(line, 'rootGap'), socket = line == null ? undefined : gapOf(line, 'socketGap')
      if (root != null) spec.rootGap = root
      if (socket != null) spec.socketGap = socket
    }
    return spec
  }
  const odd = new Set<number>()
  const npsFor = (value: string, r: PcfRecord): number => {
    const raw = value.split(/\s+/)[3]?.match(BORE_NUMBER)?.[0]
    const n = Number(raw)
    if (!raw || !(n > 0) || !Number.isFinite(n)) throw new Error(`An end point of ${lineOf(r)} is missing its nominal bore.`)
    if (boreFactor !== 'dn') return n * boreFactor
    const standard = npsOfDn(n)
    if (standard) return standard
    // ISO 6708: DN is 25 × NPS from DN 100, so a size off the table keeps its DN when written back.
    const nps = Number((n >= 100 ? n / 25 : n / 25.4).toFixed(4))
    if (!odd.has(n)) warnings.push(`Nominal bore DN ${n} is not a standard size; it was read as ${nps}" NPS.`)
    odd.add(n)
    return nps
  }
  const description = (r: PcfRecord) =>
    first(r, 'ITEM-DESCRIPTION') ?? materials.get('#' + (first(r, 'MATERIAL-IDENTIFIER') ?? '')) ?? materials.get(first(r, 'ITEM-CODE') ?? '') ?? undefined
  const erection = (r: PcfRecord) =>
    has(r, 'ERECTION-ITEM') || has(r, 'CATEGORY-ERECTION') || /^ERECTION/i.test(first(r, 'CATEGORY') ?? '')
  const numberField = (r: PcfRecord, field: string, check: (n: number) => boolean): number | undefined => {
    const raw = first(r, field)
    if (raw == null) return undefined
    const n = Number(raw.split(/\s+/)[0])
    if (!Number.isFinite(n) || !check(n)) {
      warnings.push(`Ignored invalid ${field} "${raw}" in ${lineOf(r)}.`)
      return undefined
    }
    return n
  }
  const importedRows = new Map<string, string>()
  const catalogueRow = (spec: PipeSpec, code: string | undefined, node: PipeNode, bores: number[], takeouts: number[], branchAt: number, source: string,
    bolt?: Pick<CatalogItem, 'boltDiameter' | 'boltLength' | 'boltCount'>): string => {
    const nps = Math.max(...bores), small = Math.min(...bores)
    const identity = JSON.stringify([spec.id, code ?? null, node.kind, nps, small, ...(bolt ? [bolt.boltDiameter, bolt.boltLength, bolt.boltCount ?? null, node.description ?? null] : [])])
    const known = importedRows.get(identity)
    if (known) return known
    const name = code ?? node.kind.toUpperCase()
    // An item code that already names its specification (Spoolyard writes its rows' ids, "A:FLG-RFWN-4") is the row's id.
    const base = name.startsWith(`${spec.id}:`) || name.startsWith(`${spec.id}/`) ? name : `${spec.id}:${name}`
    let rowId = base
    for (let n = 2; doc.specs.some(s => s.fittings.some(f => f.id === rowId)); n++) rowId = `${base}:${n}`
    spec.fittings.push({
      id: rowId, kind: node.kind as CatalogItem['kind'], nps, ...(small < nps ? { smallerNps: small } : {}), description: node.description ?? name,
      takeout: takeouts[branchAt === 0 ? 1 : 0] ?? takeouts[0] ?? 0, ...(branchAt > 0 ? { branchTakeout: takeouts[branchAt] } : {}),
      ...(node.weightKg != null ? { weightKg: node.weightKg } : {}), ...(code ? { partCode: code } : {}), ...(node.component ? { component: node.component } : {}),
      ...(bolt ?? {}), source: `Imported from PCF (${source})`
    })
    importedRows.set(identity, rowId)
    return rowId
  }
  const usedIds = new Set<string>()
  const idFor = (r: PcfRecord) => {
    const uci = first(r, 'UCI')?.trim()
    if (uci && uci.length <= 200 && !usedIds.has(uci)) {
      usedIds.add(uci)
      return uci
    }
    const fresh = id()
    usedIds.add(fresh)
    return fresh
  }
  // Ports of the sidecar's components, to tell whether a component's geometry is unchanged.
  // A flanged component's port is read either at its face or, its joint rebuilt, at the pipe end the joint bridged.
  const sidecarPorts = new Map<string, Vec3[][]>()
  if (sidecar)
    for (const n of sidecar.nodes) {
      const face = openFlangeFace(sidecar, n)
      sidecarPorts.set(n.id, [...componentPorts(sidecar, n).map(p => [p.at, portAt(sidecar!, n, sidecar!.runs.find(r => r.id === p.runId)!)]), ...(face ? [[face.at]] : [])])
    }
  const samePorts = (ports: Vec3[][], ends: Vec3[]) =>
    ports.length === ends.length && ends.every(e => ports.some(candidates => candidates.some(q => distance(e, q) <= tolerance)))
  let moved = 0, unmatched = 0
  /** Flanged components read from the PCF alone: their mating flanges, gaskets and bolts are the PCF's own records. */
  const flangedParts = new Set<string>()

  const ports = new Map<string, Port[]>(),
    nodeRecords = new Map<string, PcfRecord>(),
    weldLocations = new Map<string, { field: boolean; tag?: string; fit: boolean }>(),
    restored = new Set<string>(),
    bodies: PipeRun[] = [],
    /** End points of each part as read, for placing eccentric reducers. */
    partEnds = new Map<string, Array<{ at: Vec3; nps: number }>>(),
    /** Each flange's face as read, and the preparation of its other end. */
    flangeFaces = new Map<string, { face: Vec3; prep: EndPrep }>()
  for (const { r, kind: initialKind, code } of parts) {
    const endValues = [...(r.fields.get('END-POINT') ?? []), ...(r.fields.get('BRANCH1-POINT') ?? []), ...(r.fields.get('BRANCH2-POINT') ?? []), ...(r.fields.get('BRANCH3-POINT') ?? [])],
      branchFrom = r.fields.get('END-POINT')?.length ?? 0,
      ends = endValues.map(v => point(v, r)),
      centre = first(r, 'CENTRE-POINT') ?? first(r, 'CO-ORDS')
    if (!centre && !ends.length) throw new Error(`${lineOf(r)} has no location.`)
    let position = centre ? point(centre, r) : mul(ends.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec3), 1 / ends.length)
    // A flange is its face: of its two end points, the flanged one (the other is its weld or screwed end).
    const faceAt = initialKind === 'flange' && !centre && ends.length === 2 && endValues.filter(v => endPrepOf(v) === 'FL').length === 1
      ? endValues.findIndex(v => endPrepOf(v) === 'FL') : -1
    if (faceAt >= 0) position = ends[faceAt]
    if (initialKind === 'weld') {
      const skey = first(r, 'SKEY')?.toUpperCase() ?? ''
      weldLocations.set(key(position), {
        field: erection(r) || /^(WS|WF|WO)/.test(skey) || first(r, 'WELD-TYPE') === 'FIELD',
        fit: /^WF/.test(skey),
        tag: first(r, 'WELD-IDENTIFIER')
      })
      continue
    }
    // A 180° return written for its two halves comes back as them, with its body, where the sidecar has them.
    const halves = sidecar && first(r, 'UCI')?.match(/^([^+]+)\+([^+]+)$/)
    if (halves && sidecarNodes.has(halves[1]) && sidecarNodes.has(halves[2])) {
      const pair = [halves[1], halves[2]].map(k => sidecarNodes.get(k)!)
      const body = sidecar!.runs.find(x => (x.from === pair[0].id && x.to === pair[1].id) || (x.from === pair[1].id && x.to === pair[0].id))
      const outer = body ? pair.map(h => componentPorts(sidecar!, h).find(p => p.runId !== body.id)?.at) : []
      const owner = ends.map(e => outer.findIndex(q => q != null && distance(q, e) <= tolerance))
      if (body && ends.length === 2 && owner.includes(0) && owner.includes(1)) {
        for (const h of pair) {
          const node = clone(h)
          usedIds.add(node.id)
          doc.nodes.push(node)
          nodeRecords.set(node.id, r)
          restored.add(node.id)
        }
        ends.forEach((end, i) => {
          const half = pair[owner[i]], k = key(end), list = ports.get(k) ?? []
          list.push({ nodeId: half.id, takeout: distance(half.position, end), nps: npsFor(endValues[i], r), prep: endPrepOf(endValues[i]), branch: false })
          ports.set(k, list)
        })
        bodies.push(clone(body))
        continue
      }
    }
    let kind: Kind = initialKind
    const node: PipeNode = { id: idFor(r), position, kind, portTakeouts: {} }
    const text = description(r)
    if (text) node.description = text
    if (code) node.component = code
    const heat = first(r, 'HEAT-NUMBER')
    if (heat) node.heat = heat
    if (erection(r)) node.field = true
    const quantity = numberField(r, 'BOLT-QUANTITY', n => n > 0 && Number.isInteger(n))
    if (quantity != null) node.quantity = quantity
    // Elbows and bends: the deflection, as stated or as the end points make it.
    if (r.type === 'ELBOW' || r.type === 'BEND' || r.type === 'ELBOW-REDUCING') {
      const raw = first(r, 'ANGLE'), stated = raw == null ? undefined : Number(raw)
      const legs = centre && ends.length === 2 ? ends.map(e => sub(e, position)) : undefined
      let measured = legs ? 180 - Math.acos(Math.max(-1, Math.min(1, legs[0].reduce((s, v, i) => s + v * legs[1][i], 0) / ((Math.hypot(...legs[0]) * Math.hypot(...legs[1])) || 1)))) * 180 / Math.PI : undefined
      // Legs leaving the centre point in opposite directions are a 180° return (its centre point is midway between its
      // ends): no elbow turns through nothing.
      if (measured != null && measured < ANGLE_SNAP) measured = 180
      // A measured deflection within rounding of a standard elbow is that elbow.
      if (measured != null) measured = [45, 90, 180].find(a => Math.abs(measured! - a) < ANGLE_SNAP) ?? measured
      // ANGLE is written in degrees with a decimal point, or in hundredths of a degree as a whole number (ISOGEN, and
      // Spoolyard's own export): a whole number is read whichever way agrees with the end points, else as hundredths
      // when it is more than any elbow turns.
      const readings = stated == null || !Number.isFinite(stated) || !(stated > 0) ? [] : /\./.test(raw!) ? [stated] : [stated, stated / 100]
      const possible = readings.filter(a => a <= 180 + 1e-9)
      const written = measured != null && possible.length ? possible.reduce((a, b) => Math.abs(b - measured!) < Math.abs(a - measured!) ? b : a) : possible[0]
      // A stated ANGLE governs (a 180° return has no tangent intersection to measure from); else the end points' deflection.
      const angle = written ?? measured
      if (angle != null && Math.abs(angle - 45) < 1e-6) kind = node.kind = 'elbow45'
      else if (angle != null && Math.abs(angle - 90) > 1e-6) node.bendAngle = angle
      const radius = numberField(r, 'BEND-RADIUS', n => n > 0)
      if (r.type === 'BEND') {
        node.component ??= 'PIPEBEND'
        if (radius != null) node.bendRadius = radius * factor
      }
    }
    const flat = first(r, 'FLAT-DIRECTION')?.toUpperCase()
    if (flat && FLAT_SIDE[flat]) node.flatSide = FLAT_SIDE[flat]
    const weight = numberField(r, 'WEIGHT', n => n >= 0)
    // A BOLT record weighs its BOLT-QUANTITY bolts; a bolt part is weighed each.
    if (weight != null) node.weightKg = weight * weightFactor / (initialKind === 'bolt' ? quantity ?? 1 : 1)
    // What an earlier Spoolyard wrote about the component.
    const attributes = legacy(r, 'ATTRIBUTE96', LEGACY.component, 'component data')
    if (attributes && typeof attributes === 'object')
      for (const k of ['kind', 'component', 'catalogId', 'description', 'takeout', 'branchTakeout', 'weightKg', 'areaM2', 'unitCost', 'laborHours', 'heat', 'field', 'tag', 'quantity', 'labelOffset', 'bendAngle'] as const)
        if (Object.hasOwn(attributes, k)) Object.assign(node, { [k]: attributes[k] })
    // The sidecar's component, exactly, where its ports are where the PCF puts them.
    const original = sidecarNodes.get(node.id)
    if (original) {
      const same = ends.length ? samePorts(sidecarPorts.get(node.id) ?? [], ends) : distance(original.position, position) <= tolerance
      // The sidecar's data replaces what the PCF says about the part; the PCF only decides where it is.
      for (const k of Object.keys(node)) if (!NODE_GEOMETRY.has(k)) delete (node as unknown as Record<string, unknown>)[k]
      for (const [k, v] of Object.entries(original)) if (!NODE_GEOMETRY.has(k)) Object.assign(node, { [k]: clone(v) })
      if (same) {
        position = node.position = clone(original.position)
        if (original.portTakeouts) node.portTakeouts = clone(original.portTakeouts)
        else delete node.portTakeouts
        if (original.associatedRunId) node.associatedRunId = original.associatedRunId
        restored.add(node.id)
      } else moved++
    } else if (sidecar) unmatched++
    // The component the PCF part is, where its record says enough (the sidecar's own part keeps the sidecar's).
    // Gaskets and bolting are joint parts, listed by their material text: never flanged components of their own.
    if (!original && !node.component && node.kind !== 'gasket' && node.kind !== 'bolt') {
      const runEnds = endValues.slice(0, branchFrom), point = POINT_ONLY.has(r.type) && centre?.split(/\s+/)[3] ? [centre] : []
      const resolved = componentFromPcf({
        type: r.type, kind: node.kind, skey: first(r, 'SKEY')?.toUpperCase(), preps: runEnds.map(endPrepOf),
        bores: (endValues.length ? endValues : point).map(v => npsFor(v, r)).sort((a, b) => b - a),
        itemCode: first(r, 'ITEM-CODE')?.trim(), description: text, rating: pipelineHeaders.get(r.line)?.get('NOMINAL-CLASS'),
        takeouts: centre && !POINT_ONLY.has(r.type) ? ends.slice(0, branchFrom).map(e => distance(position, e)) : [],
        branchTakeouts: centre && !POINT_ONLY.has(r.type) ? ends.slice(branchFrom).map(e => distance(position, e)) : []
      })
      if (resolved) {
        node.component = resolved
        if (COMPONENT_TYPE_BY_CODE[resolved]?.endPrep === 'FL') flangedParts.add(node.id)
      }
    }
    // The part's ITEM-CODE becomes its row in the imported specification, so it is listed and written back by it.
    const itemCode = first(r, 'ITEM-CODE')?.trim()
    // Bolting as written: its diameter and length (UNITS-BOLT-DIA, UNITS-BOLT-LENGTH; coordinate units if unset).
    const boltDia = initialKind === 'bolt' ? numberField(r, 'BOLT-DIA', n => n > 0) : undefined
    const boltLength = initialKind === 'bolt' ? numberField(r, 'BOLT-LENGTH', n => n > 0) : undefined
    const bolt = boltDia != null && boltLength != null ? { boltDiameter: boltDia * boltDiaFactor, boltLength: boltLength * boltLengthFactor, ...(quantity != null ? { boltCount: quantity } : {}) } : undefined
    // A support or bolt record is placed by its CO-ORDS, whose bore is its size.
    const located = ends.length ? endValues : centre && POINT_ONLY.has(r.type) && centre.split(/\s+/)[3] ? [centre] : []
    if ((itemCode || bolt) && !node.catalogId && located.length) {
      const bores = located.map(v => npsFor(v, r)), branchAt = ends.findIndex((_, i) => i >= branchFrom)
      node.catalogId = catalogueRow(specFor(first(r, 'PIPING-SPEC') ?? r.spec, r.line), itemCode, node, bores, ends.map(e => distance(position, e)), branchAt, lineOf(r), bolt)
    }
    kind = node.kind
    if (faceAt >= 0) flangeFaces.set(node.id, { face: ends[faceAt], prep: endPrepOf(endValues[1 - faceAt]) })
    doc.nodes.push(node)
    nodeRecords.set(node.id, r)
    partEnds.set(node.id, ends.map((at, i) => ({ at, nps: npsFor(endValues[i], r) })))
    if (kind === 'support' || kind === 'bolt' || POINT_ONLY.has(r.type)) continue
    for (const [i, end] of ends.entries()) {
      const k = key(end),
        list = ports.get(k) ?? []
      if (list.some(p => p.nodeId === node.id)) continue
      list.push({
        nodeId: node.id,
        takeout: distance(position, end),
        nps: npsFor(endValues[i], r),
        prep: endPrepOf(endValues[i]),
        branch: i >= branchFrom
      })
      ports.set(k, list)
    }
  }
  const makeRun = (a: Port, b: Port, r: PcfRecord, connector = false, runId?: string): PipeRun => {
    const spec = specFor(first(r, 'PIPING-SPEC') ?? r.spec, r.line)
    let run: PipeRun = {
      id: runId ?? id(),
      from: a.nodeId,
      to: b.nodeId,
      nps: a.nps,
      specId: spec.id,
      spool: first(r, 'SPOOL-IDENTIFIER') ?? 'SP-001',
      line: r.line,
      heat: connector ? '' : first(r, 'HEAT-NUMBER') ?? '',
      endPrep: a.prep,
      fromPrep: a.prep,
      toPrep: b.prep,
      fromField: a.field,
      toField: b.field,
      ...(a.fit && !connector ? { fromFieldFit: true } : {}),
      ...(b.fit && !connector ? { toFieldFit: true } : {}),
      fromTag: a.tag,
      toTag: b.tag,
      connector
    }
    // A pipe's own material text (ITEM-DESCRIPTION, or its MATERIALS entry) is what it is bought as.
    const text = connector ? undefined : description(r)?.trim()
    if (text) run.description = text.slice(0, 300)
    const attributes = connector ? undefined : legacy(r, 'ATTRIBUTE97', LEGACY.pipe, 'pipe data')
    if (attributes && typeof attributes === 'object' && !Array.isArray(attributes))
      for (const k of ['rootGap', 'fromTag', 'toTag', 'fromField', 'toField', 'fromPrep', 'toPrep'] as const)
        if (Object.hasOwn(attributes, k)) Object.assign(run, { [k]: attributes[k] })
    // The sidecar's pipe: by its UCI, or a direct fitting connection by the components it joins.
    const original = sidecar && (connector
      ? sidecar.runs.find(x => x.connector && ((x.from === a.nodeId && x.to === b.nodeId) || (x.from === b.nodeId && x.to === a.nodeId)))
      : sidecarRuns.get(run.id))
    if (original && !doc.runs.some(x => x.id === original.id)) {
      const reversed = original.from === b.nodeId && original.to === a.nodeId
      if ((original.from === a.nodeId && original.to === b.nodeId) || reversed) run = { ...clone(original), nps: run.nps }
      else if (!connector) {
        run = { ...clone(original), id: run.id, from: run.from, to: run.to, nps: run.nps }
        moved++
      }
    }
    doc.runs.push(run)
    for (const p of [a, b]) {
      const n = getNode(doc, p.nodeId)
      if (!restored.has(n.id)) {
        n.portTakeouts ??= {}
        n.portTakeouts[run.id] = p.takeout
      }
      // An outlet's pipes are all branch pipes; one restored from the sidecar is left as it was drawn.
      if (p.branch && (n.kind !== 'olet' || !restored.has(n.id))) n.branchEdgeId = run.id
    }
    return run
  }
  // Direct fitting connections carry topology, but are never fabricated pipe/BOM length.
  for (const [coord, list] of ports) {
    const weld = weldLocations.get(coord)
    if (weld)
      for (const p of list) {
        p.field = weld.field
        p.fit = weld.fit
        p.tag = weld.tag
      }
    for (let i = 1; i < list.length; i++) makeRun(list[i - 1], list[i], nodeRecords.get(list[i].nodeId)!, true)
  }
  const endNode = (value: string, r: PcfRecord): Port => {
    const position = point(value, r),
      list = ports.get(key(position))
    if (list?.length) return list[0]
    let node = doc.nodes.find(n => ['end', 'weld'].includes(n.kind) && distance(n.position, position) <= tolerance)
    if (!node) {
      // An open end or pipe-to-pipe weld of the sidecar keeps its identity (continuation callouts, tie points, sheets).
      const original = sidecar?.nodes.find(n => ['end', 'weld'].includes(n.kind) && distance(n.position, position) <= tolerance && !doc.nodes.some(x => x.id === n.id))
      node = original ? clone(original) : { id: id(), position, kind: 'end' }
      if (original) restored.add(node.id)
      else if (sidecar) unmatched++
      doc.nodes.push(node)
    }
    const weld = weldLocations.get(key(position))
    if (weld) {
      // A field-fit weld at an open end is the end's own (welded on site to what lies beyond); it stays an open end
      // unless a second pipe arrives there.
      if (weld.fit && node.kind === 'end') fitEnds.set(node.id, clone(node))
      node.kind = 'weld'
      node.field = weld.field
      node.tag = weld.tag
    }
    return { nodeId: node.id, takeout: 0, nps: npsFor(value, r), prep: endPrepOf(value), branch: false, field: weld?.field, fit: weld?.fit, tag: weld?.tag }
  }
  /** Open ends read with a field-fit weld on them, as they were before the weld was read. */
  const fitEnds = new Map<string, PipeNode>()
  /** Each pipe's end points as read: its axis, for parts placed along it. */
  const pipeEnds = new Map<string, [Vec3, Vec3]>()
  let tooShort = 0
  for (const r of pipes) {
    const ends = r.fields.get('END-POINT')
    if (ends?.length !== 2) throw new Error(`${lineOf(r)} needs two END-POINTs.`)
    const from = endNode(ends[0], r), to = endNode(ends[1], r)
    // A pipe whose ends are within the matching tolerance of each other has no length to cut: its ends are one point.
    if (from.nodeId === to.nodeId) { tooShort++; continue }
    const run = makeRun(from, to, r, false, idFor(r))
    pipeEnds.set(run.id, [point(ends[0], r), point(ends[1], r)])
  }
  for (const [nodeId, before] of fitEnds) {
    const at = doc.nodes.findIndex(n => n.id === nodeId)
    if (at >= 0 && doc.runs.filter(r => r.from === nodeId || r.to === nodeId).length === 1) doc.nodes[at] = before
  }
  // Continuation callouts at the open ends the end-connection records mark (the sidecar's own ends keep theirs).
  for (const c of endConnections) {
    const raw = first(c, 'CO-ORDS')
    if (!raw) continue
    const at = point(raw, c)
    const open = doc.nodes.filter(n => n.kind !== 'annotation' && !restored.has(n.id) && !n.continuation && distance(n.position, at) <= tolerance &&
      doc.runs.filter(r => r.from === n.id || r.to === n.id).length === 1)
    const node = open.find(n => n.kind === 'end') ?? open[0]
    if (!node) continue
    if (c.type === 'END-POSITION-OPEN') node.continuation = { text: 'OPEN END', termination: 'open' }
    else if (c.type === 'END-POSITION-CLOSED') node.continuation = { text: 'CLOSED', termination: 'closed' }
    else {
      const reference = first(c, 'PIPELINE-REFERENCE')?.trim()
      if (reference) node.continuation = { text: continuationText(reference), termination: 'continues' }
    }
  }
  if (tooShort) warnings.push(`Left out ${tooShort} pipe(s) shorter than the ${tolerance} mm point-matching tolerance; their ends were joined. Check the geometry there.`)
  if (!doc.runs.some(r => !r.connector)) throw new Error('No PCF pipe runs were found.')
  /** Where a pipe attached at `near` comes from: its far end point, else its far node. */
  const farAlong = (run: PipeRun, node: PipeNode, near: Vec3): Vec3 => {
    const ends = pipeEnds.get(run.id)
    if (ends) return distance(ends[0], near) > distance(ends[1], near) ? ends[0] : ends[1]
    return getNode(doc, run.from === node.id ? run.to : run.from).position
  }
  // A 180° return is drawn as its two 90° halves joined by its body (centre-to-centre O, each half O/2 = R): the PCF
  // elbow becomes them, long or short radius by R against the bore (1.5 D or 1 D, ASME B16.9).
  for (const n of [...doc.nodes]) {
    if (restored.has(n.id) || n.kind !== 'elbow90' || !(Math.abs((n.bendAngle ?? 0) - 180) < 0.5)) continue
    const edges = doc.runs.filter(r => r.from === n.id || r.to === n.id), ends = partEnds.get(n.id) ?? []
    if (edges.length !== 2 || ends.length !== 2) continue
    const R = distance(ends[0].at, ends[1].at) / 2, ratio = R / (ends[0].nps * 25.4)
    const code = Math.abs(ratio - 1.5) < 0.15 ? 'LR180R' : Math.abs(ratio - 1) < 0.1 ? 'SR180R' : undefined
    if (!code) {
      warnings.push(`The 180° elbow at ${lineOf(nodeRecords.get(n.id)!)} is not a standard long- or short-radius return; it was kept as one elbow. Check its geometry.`)
      continue
    }
    const corner = (end: Vec3, run: PipeRun) => {
      const from = farAlong(run, n, end), d = distance(end, from)
      return d ? add(end, mul(sub(end, from), R / d)) : end
    }
    // Which pipe leaves which end: the one whose nearer end point (or far part) is closer to it.
    const endOf = (r: PipeRun) => {
      const points = pipeEnds.get(r.id) ?? [getNode(doc, r.from === n.id ? r.to : r.from).position]
      const near = points.reduce((a, b) => (Math.min(...ends.map(e => distance(a, e.at))) <= Math.min(...ends.map(e => distance(b, e.at))) ? a : b))
      return distance(near, ends[0].at) <= distance(near, ends[1].at) ? 0 : 1
    }
    const first = edges.find(r => endOf(r) === 0), second = edges.find(r => endOf(r) === 1)
    if (!first || !second) continue
    const partner: PipeNode = { ...clone(n), id: id(), position: corner(ends[1].at, second), portTakeouts: {} }
    delete n.bendAngle
    delete partner.bendAngle
    n.position = corner(ends[0].at, first)
    n.component = partner.component = code
    if (second.from === n.id) second.from = partner.id
    else second.to = partner.id
    const body: PipeRun = { id: id(), from: n.id, to: partner.id, nps: first.nps, specId: first.specId, spool: first.spool, line: first.line, heat: '', endPrep: 'BW', fromPrep: 'BW', toPrep: 'BW', connector: true }
    n.portTakeouts = { [first.id]: R, [body.id]: R }
    partner.portTakeouts = { [second.id]: R, [body.id]: R }
    doc.nodes.splice(doc.nodes.indexOf(n) + 1, 0, partner)
    doc.runs.push(body)
  }
  for (const body of bodies) if (doc.nodes.some(n => n.id === body.from) && doc.nodes.some(n => n.id === body.to)) doc.runs.push(body)
  // An eccentric reducer sits on its large end's axis; its small end may stand off it, and that offset is its flat side.
  for (const n of doc.nodes) {
    if (restored.has(n.id) || !isEccentric(n.component)) continue
    const edges = doc.runs.filter(r => r.from === n.id || r.to === n.id), ends = partEnds.get(n.id) ?? []
    if (edges.length !== 2 || ends.length !== 2 || ends[0].nps === ends[1].nps) continue
    const [largeEnd, smallEnd] = ends[0].nps > ends[1].nps ? ends : [ends[1], ends[0]]
    const large = edges.find(r => r.nps === largeEnd.nps), small = edges.find(r => r !== large)
    if (!large || !small) continue
    const far = farAlong(large, n, largeEnd.at), axis = sub(largeEnd.at, far), l = distance(largeEnd.at, far)
    if (!l) continue
    const u = mul(axis, 1 / l), v = sub(smallEnd.at, largeEnd.at), along = v[0] * u[0] + v[1] * u[1] + v[2] * u[2]
    if (!(along > 0)) continue
    const offset = sub(v, mul(u, along))
    n.position = add(largeEnd.at, mul(u, along / 2))
    n.portTakeouts = { ...n.portTakeouts, [large.id]: along / 2, [small.id]: along / 2 }
    const side = distance(offset, [0, 0, 0]) > tolerance ? flatSideOf(offset) : undefined
    if (side) n.flatSide = side
  }
  // Supports and bolts belong to the nearest pipe; an olet to the header its centre point lies on.
  const runsById = new Map(doc.runs.map(r => [r.id, r])), nodesById = new Map(doc.nodes.map(n => [n.id, n]))
  const attached = (n: PipeNode) => { const r = n.associatedRunId ? runsById.get(n.associatedRunId) : undefined; return !!r && r.from !== n.id && r.to !== n.id }
  // Each pipe's axis, worked out once for every part placed along it.
  const axes = doc.runs.map(r => { const a = nodesById.get(r.from)!.position, delta = sub(nodesById.get(r.to)!.position, a); return { r, a, delta, norm: delta.reduce((s, v) => s + v * v, 0) } })
  for (const n of doc.nodes.filter(n => (n.kind === 'support' || n.kind === 'bolt' || n.kind === 'olet') && !(restored.has(n.id) && attached(n)) && !(n.kind === 'olet' && attached(n)))) {
    let nearest: PipeRun | undefined,
      best = Infinity
    for (const { r, a, delta, norm } of axes) {
      if (r.from === n.id || r.to === n.id || (n.kind === 'olet' && r.connector)) continue
      const t = Math.max(0, Math.min(1, sub(n.position, a).reduce((s, v, i) => s + v * delta[i], 0) / (norm || 1)))
      const d = distance(n.position, add(a, mul(delta, t)))
      if (d < best) {
        best = d
        nearest = r
      }
    }
    n.associatedRunId = nearest?.id
  }
  // A flanged component read from the PCF alone (a valve, a blind) bolts up to the mating flange, gasket and bolts the
  // PCF lists as records of their own: none is supplied with the component a second time. A port bolted straight to a
  // flange read from the PCF supplies its joint's gasket and bolting as any flanged component does.
  for (const nodeId of flangedParts) {
    const n = doc.nodes.find(x => x.id === nodeId)
    if (!n || restored.has(n.id)) continue
    for (const r of doc.runs.filter(x => x.from === n.id || x.to === n.id)) {
      const other = getNode(doc, r.from === n.id ? r.to : r.from)
      if (r.connector && (other.kind === 'flange' || COMPONENT_TYPE_BY_CODE[other.component ?? '']?.endPrep === 'FL')) continue
      n.portFlanges = { ...n.portFlanges, [r.id]: { component: 'NONE', gasket: false, bolts: false } }
    }
  }
  // Flanges read from the PCF alone: the component their symbol key (or end) names, and the joint at their face. The
  // gasket and bolting recorded there are the joint's own parts; what the PCF does not record is supplied from the
  // specification (else the ASME standard) and said, and a joint of two flanges supplies it once.
  const joints: Vec3[][] = [], claimed = new Set<string>()
  let noBolts = 0, noGasket = 0
  const near = (a: Vec3, points: Vec3[], within = tolerance) => points.some(p => distance(a, p) <= within)
  for (const n of doc.nodes) {
    const faced = flangeFaces.get(n.id)
    if (n.kind !== 'flange' || !faced || restored.has(n.id)) continue
    const r = nodeRecords.get(n.id)!, host = doc.runs.find(x => !x.connector && (x.from === n.id || x.to === n.id))
    const spec = host ? doc.specs.find(x => x.id === host.specId) : undefined
    if (!n.component && !fitting(doc, n)?.component && spec) {
      const shape = FLANGE_SKEY[first(r, 'SKEY')?.toUpperCase() ?? ''] ?? (faced.prep === 'SW' ? 'SW' : faced.prep === 'THD' ? 'SC' : faced.prep === 'PLAIN' ? 'SO' : 'WN')
      const code = shape === 'LJ' ? `FLG-${specFace(spec)}LJ` : `FLG-${specFace(spec)}${shape}`
      if (COMPONENT_TYPE_BY_CODE[code]) n.component = code
    }
    // The joint: the face, and the far side of a gasket recorded on it.
    const points = [faced.face]
    const gaskets = doc.nodes.filter(g => g.kind === 'gasket' && (partEnds.get(g.id) ?? []).some(e => distance(e.at, faced.face) <= tolerance))
    for (const g of gaskets) for (const e of partEnds.get(g.id) ?? []) if (!near(e.at, points)) points.push(e.at)
    if (joints.some(j => points.some(p => near(p, j)))) {
      // The other flange of a joint already supplied.
      n.jointSupply = { gasket: false, bolts: false }
      continue
    }
    joints.push(points)
    const bolts = doc.nodes.filter(b => b.kind === 'bolt' && !claimed.has(b.id) && near(b.position, points, tolerance + 5))
    for (const b of bolts) claimed.add(b.id)
    if (gaskets.length || bolts.length) n.jointSupply = { gasket: !gaskets.length, bolts: !bolts.length }
    if (!bolts.length) noBolts++
    if (!gaskets.length) noGasket++
  }
  if (noBolts)
    warnings.push(`${noBolts} flanged joint(s) have no BOLT record; their bolting is supplied from the specification or the ASME B16.5 standard and is assumed. Check it, or set the joint's bolting as supplied by others.`)
  if (noGasket)
    warnings.push(`${noGasket} flanged joint(s) have no GASKET record; a gasket is supplied from the specification or the standard and is assumed. Check it, or set the joint's gasket as supplied by others.`)

  if (sidecar) {
    // Drawing-only symbols on pipes that came back.
    for (const n of sidecar.nodes)
      if (n.kind === 'annotation' && !doc.nodes.some(x => x.id === n.id) && (!n.associatedRunId || doc.runs.some(r => r.id === n.associatedRunId)))
        doc.nodes.push(clone(n))
    const fabricated = sidecar.nodes.filter(n => n.kind !== 'annotation' && n.kind !== 'end' && !doc.nodes.some(x => x.id === n.id)).length
    if (moved) warnings.push(`${moved} part(s) differ from the .piping sidecar; their PCF geometry was used and their drafting was kept.`)
    if (unmatched) warnings.push(`${unmatched} part(s) in the PCF are not in the .piping sidecar and were imported from the PCF alone.`)
    if (fabricated) warnings.push(`${fabricated} part(s) of the .piping sidecar are not in the PCF and were left out.`)
    // Parts keep their place in the drawing; new ones follow.
    const order = <T extends { id: string }>(list: T[], original: T[]) => {
      const at = new Map(original.map((x, i) => [x.id, i]))
      list.sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity))
    }
    order(doc.nodes, sidecar.nodes)
    order(doc.runs, sidecar.runs)
    // Sheet layout and adjacent drawings only refer to parts that are still there.
    const nodeIds = new Set(doc.nodes.map(n => n.id))
    if (doc.references) doc.references = doc.references.filter(r => nodeIds.has(r.atNodeId))
    pruneSheetAnchors(doc)
  }
  // A specification made from the PCF alone lists the pipe sizes its pipe's material text names a schedule for: the
  // ASME B36.10M outside diameter and the schedule's wall, weighed at the density of the steel the text names. Pipe
  // the PCF says nothing of stays out of the specification, and review asks for it: no weight is assumed.
  for (const spec of importedSpecs) {
    const texts = doc.runs.filter(x => x.specId === spec.id && !x.connector).map(x => x.description ?? '')
    if (texts.some(t => STAINLESS_TEXT.test(t)) && !texts.some(t => CARBON_TEXT.test(t))) spec.density = 8000
    for (const r of doc.runs.filter(x => x.specId === spec.id && !x.connector)) {
      if (spec.sizes.some(z => z.nps === r.nps)) continue
      const od = pipeOd(r.nps), schedule = scheduleOf(r.description), wall = schedule ? pipeWall(r.nps, schedule) : undefined
      if (od == null || wall == null) continue
      spec.sizes.push({ nps: r.nps, od, wall, kgM: Number((Math.PI * (od - wall) * wall * spec.density / 1e6).toFixed(3)), ...(schedule ? { schedule } : {}) })
    }
    spec.sizes.sort((a, b) => a.nps - b.nps)
  }
  for (const n of doc.nodes) {
    if (n.associatedRunId && !doc.runs.some(r => r.id === n.associatedRunId)) delete n.associatedRunId
    if (n.branchEdgeId && !doc.runs.some(r => r.id === n.branchEdgeId && (r.from === n.id || r.to === n.id))) delete n.branchEdgeId
    if (n.portTakeouts) for (const k of Object.keys(n.portTakeouts)) if (!doc.runs.some(r => r.id === k)) delete n.portTakeouts[k]
  }
  try {
    return { doc: parseIsoJson(JSON.stringify(doc)), warnings }
  } catch (e) {
    throw new Error(`The PCF could not be turned into a valid drawing: ${e instanceof Error ? e.message : String(e)}`)
  }
}
