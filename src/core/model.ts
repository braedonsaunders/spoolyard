import type { GridSettings } from './grid'
import { COMPONENT_TYPES, COMPONENT_TYPE_BY_CODE, SYMBOL_FAMILIES, type SymbolFamily } from './components'
import { unitsPerMm } from './paper'
import { boltedConnector, boltedDirect, breakOwner, stubInFlange, defaultCode, flangedAllowance, flangedJoints, matingFlange, spansSpools, nippleEnds, nippleLength, nippleText, nodeItem, pipeEndPrep, specRating } from './joints'
import { formatLength } from './format'
import { flange, GASKET_THICKNESS, pipeOd, SOCKET_WELD_GAP, type ButterflyBody, type ButterflyCategory, type ValvePattern } from './standards'
import { validCatalogDesign, validSpecDesign, type SpecDesign } from './spec-design'
import { materialErrors, materialTakeoff, routeOrder } from './material-list'
import { profileError, profileOf, type FabricationProfile } from './profile'
import { BUILTIN_TEMPLATES, validateSheetTemplate, type SheetTemplate } from './sheet-template'
export { allowanceText, formatAllowance, formatLength, lengthInputValue, parseLength } from './format'
/** Spoolyard piping semantics (file schema id "bidwright-piping" is kept for compatibility). Coordinates and fabrication lengths are millimetres. */
export type Vec3 = [number, number, number]
export type Kind =
  | 'end'
  | 'elbow90'
  | 'elbow45'
  | 'tee'
  | 'flange'
  | 'valve'
  | 'reducer'
  | 'cap'
  | 'support'
  | 'weld'
  | 'olet'
  | 'gasket'
  | 'bolt'
  /** Drawing-only symbol attached to a pipe (flow arrow, insulation, instrument tag…); never fabricated. */
  | 'annotation'
export interface CatalogItem {
  id: string
  kind: Kind
  nps: number
  smallerNps?: number
  description: string
  takeout: number
  branchTakeout?: number
  weightKg?: number
  areaM2?: number
  unitCost?: number
  laborHours?: number
  source: string
  /** Specification row detail; `component` is the component-type code (see components.ts). */
  component?: string
  rating?: string
  schedule?: string
  shopField?: 'S' | 'F'
  partCode?: string
  material?: string
  manufacturer?: string
  takeoutMissing?: boolean
  /** Drawn symbol family when it differs from the component type's (a custom code drawn as a ball valve). */
  symbol?: SymbolFamily
  /**
   * The takeout already runs to the pipe end, net of the socket depth or thread make-up (an "effective" takeout), so
   * no socket depth or thread engagement is needed to cut the pipe.
   */
  takeoutToPipeEnd?: boolean
  /** Bolt rows: inch (ASME B18.2, the default) or metric (ISO) bolting; sets how the bolt size is written. */
  boltSystem?: 'inch' | 'metric'
  /** Verbatim drawing BOM text; otherwise composed from description, material, schedule and rating. */
  bomDescription?: string
  /** A lateral's run end on the side its branch leans toward. */
  longSideTakeout?: number
  centreToEnd?: number
  socketDepth?: number
  threadEngagement?: number
  /** Branch outlet height A, outlet end to the run pipe's outside. */
  height?: number
  /** Where a branch outlet's takeout is measured from: the run pipe's outside (MSS SP-97) or its centreline (default). */
  takeoutReference?: 'header-outside' | 'header-centre'
  faceToFace?: number
  flangeThickness?: number
  lengthThroughHub?: number
  thickness?: number
  boltCount?: number
  boltDiameter?: number
  boltLength?: number
  /** 180° returns: centre-to-centre O and back-to-face K (ASME B16.9). */
  centreToCentre?: number
  backToFace?: number
  /** Valves: the ASME B16.10 pattern, butterfly body type and API 609 category the dimensions are for. */
  valvePattern?: ValvePattern
  bodyType?: ButterflyBody
  valveCategory?: ButterflyCategory
  /** Bolt rows: stud bolts (the default), machine bolts, or lug bolts into a tapped body. */
  boltKind?: 'stud' | 'machine' | 'lug'
  /** What a built-in standard dimension had to assume (no class, pattern or wall given); validation lists it. */
  assumed?: string
}
export interface PipeSize {
  nps: number
  od: number
  wall: number
  kgM: number
  schedule?: string
  description?: string
  material?: string
  shopField?: 'S' | 'F'
  /** Verbatim drawing BOM text for this pipe size. */
  bomDescription?: string
}
export interface PipeSpec {
  id: string
  name: string
  material: string
  schedule: string
  rating: string
  sizes: PipeSize[]
  fittings: CatalogItem[]
  rootGap: number
  /**
   * Gap (mm) the pipe is withdrawn from the socket bottom before socket welding (ASME B31.3 Fig. 328.5.2C: approximately
   * 1/16″ before welding). 1.6 mm (`DEFAULT_SOCKET_GAP`) if unset, which review flags; set 0 to bottom the pipe.
   */
  socketGap?: number
  /** Shortest pipe piece (mm) the shop will cut; 50 mm if unset. */
  minPipeLength?: number
  /**
   * Least clear distance (mm) between the welds at a pipe piece's ends. Below 50 mm is an error; if unset, review also
   * warns below the pipe's outside diameter (the common "1 D or 50 mm, whichever is greater" spacing).
   */
  minWeldSpacing?: number
  /** Stock length (mm) this specification's pipe is bought in; the project profile's if unset. */
  stockLength?: number
  density: number
  pipeCostM: number
  weldHoursPerDiameterInch: number
  pipeLaborHoursM: number
  service?: string
  revision?: string
  /** Free-form specification parameters, e.g. flange face, bolt type, small-bore start size. */
  parameters?: Record<string, string>
  /** Typed design parameters (class, face, bolting, gasket, patterns); read before `parameters` (see spec-design.ts). */
  design?: SpecDesign
  /** Pipe nipples by size: catalogued length (mm), schedule and material. */
  nipples?: NippleRow[]
  /**
   * The branch table: the connection for each run and branch size. `code` is a branch type (`TEE`, `RTEE`, `WOL`,
   * `SOL`, `TOL`, `STUB-IN`, a component code) or a key of `branchCodes`, the table's own legend (e.g. 3 → Weldolet).
   */
  branchChart?: Array<{ run: number; branch: number; code: string }>
  branchCodes?: Record<string, string>
}
export interface NippleRow {
  nps: number
  length: number
  id?: string
  schedule?: string
  material?: string
  description?: string
  /** Verbatim drawing BOM text. */
  bomDescription?: string
}
export interface PipeNode {
  id: string
  position: Vec3
  kind: Kind
  catalogId?: string
  description?: string
  takeout?: number
  branchTakeout?: number
  portTakeouts?: Record<string, number>
  branchEdgeId?: string
  weightKg?: number
  areaM2?: number
  unitCost?: number
  laborHours?: number
  heat?: string
  field?: boolean
  tag?: string
  associatedRunId?: string
  quantity?: number
  endPrep?: EndPrep
  /** Schematic-only displacement, independent of the physical coordinates. */
  labelOffset?: [number, number]
  /** Component-type code chosen from the catalogue; drives the drawn symbol. */
  component?: string
  /** Equipment context at a pipe end: vessel on a skid or pump end view. */
  equipmentShape?: 'vessel' | 'pump'
  /** Deflection of a measured/custom bend; standard elbows use their catalogue angle. */
  bendAngle?: number
  /** Centreline radius of a pipe bend: its takeout is the radius times the tangent of half the deflection. */
  bendRadius?: number
  /** Open-end callout, e.g. "CONT'D ON\nDWG# ISO-201-2", optionally followed by plant coordinates. */
  continuation?: { text: string; coordinates?: boolean; coordinateFace?: 'flange' | 'mate'; paperPath?: Array<[number,number]>; endMarker?: 'tube' | 'break' | 'plain'; leaderAt?:'node'|'end'
    /**
     * What is beyond the end: the line continues (on another drawing or existing pipe; default) and is drawn on to a
     * break, or the end is left open or closed off, with nothing drawn beyond it.
     */
    termination?: ContinuationTermination }
  elevationCallout?: boolean
  tiePoint?: { id: string; label?: string }
  /** Valve operator orientation, e.g. "OPERATOR SOUTH"; the valve tag is `tag`. */
  operator?: string
  showSize?: boolean
  sizeLabelFormat?: 'standard' | 'compact'
  calloutOrder?: 'item-first' | 'tag-first' | 'item-tag-first'
  /** Existing supports may be referenced by an arrowed note without drawing a new support symbol. */
  supportSymbol?: 'standard' | 'callout'
  valveSymbol?: 'disc' | 'bowtie' | 'swing' | 'triangle'
  /** Drawn symbol family when it differs from the component's (e.g. a ground mark drawn as a wall penetration). */
  symbol?: SymbolFamily
  /** Drawing plane of the fitting body; independent of its measured ports. */
  symbolPlane?: 'plan' | 'vertical' | 'alternate'
  /** Drafted flexible hose centreline on paper; catalogue length and plant ports remain measured. */
  hosePath?: Array<[number,number]>
  /** Symbol shown on the valve stem; independent of its catalogue description and orientation callout. */
  valveOperator?: 'none' | 'lever' | 'actuator' | 'handwheel' | 'box'
  /** Sheet label for supports and annotations, e.g. "U-BOLT", "HANGER", "CLOSED". */
  calloutText?: string
  calloutPlane?: 'sheet' | 'pipe'
  /** Dimension this support's location along its pipe. */
  dimensioned?: boolean
  /** Which dimension chain locates this branch work point when component-face tiers are shown. */
  dimensionChain?: 'both' | 'body' | 'mate'
  /** The located point is approximate (a wall penetration): its dimension reads "(±)". */
  approximate?: boolean
  /** List this support as material in the bill of materials; by default a support from a specification row is listed. */
  inBom?: boolean
  /** Mating flange makeup per flanged port, keyed by pipe id. */
  portFlanges?: Record<string, PortFlange>
  /**
   * What a flanged joint at a pipe end (equipment, an existing flange or a break to another drawing) supplies on this
   * drawing: the flange itself (a lap-joint end keeps its stub end), the gasket and the bolting; whether the mate is a
   * flange (studs through both) or a lugged or tapped body such as a lug valve (lug bolts into it); and whether the end
   * point is this flange's own face (the default) or the face it bolts to, with the gasket this drawing supplies inside
   * the dimension. A joint or flanged component spanning a spool break is listed on `spool`'s sheet (by default the
   * sheet of its first pipe); each sheet lists the flanges welded to its own pipes.
   */
  jointSupply?: { gasket: boolean; bolts: boolean; flange?: boolean; mate?: 'flange' | 'lug'; measuredTo?: 'mate' | 'flange'; spool?: string }
  /** The side an eccentric reducer's flat faces: top (FOT) or bottom (FOB) on a level line, a compass side on a riser. */
  flatSide?: FlatSide
}
export type ContinuationTermination = 'continues' | 'open' | 'closed'
export type FlatSide = 'top' | 'bottom' | 'north' | 'south' | 'east' | 'west'
const FLAT_DIRECTION: Record<FlatSide, Vec3> = { top: [0, 0, 1], bottom: [0, 0, -1], north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0] }
/** Eccentric reducers and swages have a flat side. */
export const isEccentric = (code?: string) => !!code && /^E-(RED|SWAGE|SWG)$/.test(code)
/** Bill-of-materials suffix for an eccentric reducer's flat side: FOT, FOB or FLAT NORTH. */
export const flatSideText = (n: PipeNode) =>
  !n.flatSide ? '' : n.flatSide === 'top' ? 'FOT' : n.flatSide === 'bottom' ? 'FOB' : `FLAT ${n.flatSide.toUpperCase()}`
export interface PortFlange {
  mate?: 'flange' | 'lug'
  /** Mating flange component code, or 'NONE' when the mate is not supplied. */
  component?: string
  gasket?: boolean
  bolts?: boolean
}
export interface TitleBlockRevision {
  rev: string
  date: string
  description: string
  designedBy: string
  checkedBy: string
  disciplineLead: string
  projectLeader: string
  approvedBy: string
}
export interface TitleBlock {
  referenceDrawings: string[]
  designedBy: string
  date: string
  checkedBy: string
  projectLeader: string
  disciplineLeader: string
  approvedBy: string
  /** [pressure, temperature] as written on the sheet. */
  conditions: { design: [string, string]; operating: [string, string]; test: [string, string] }
  insulationThickness: string
  insulationCladding: string
  tracing: string
  pipeSpec: string
  specRevision: string
  designCode: string
  product: string
  refArea: string
  lineNumber: string
  projectNumber: string
  revisions: TitleBlockRevision[]
  logos: Array<{ name: string; dataUrl: string }>
  /** How the sheet's dates are written, printed in the date labels; YY-MM-DD when unset. */
  dateFormat?: string
  /** Values of the extra fields a title-block template declares (`{field.key}`). */
  custom?: Record<string, string>
}
/** A dimension endpoint follows a work point or a component's face on a connected run. */
export interface DimensionAnchor {
  nodeId: string
  /** Use the selected work point of this linked drawing at nodeId. */
  adjacent?: string
  runId?: string
  face?: 'body' | 'mate'
}
export interface SheetDimension {
  from: DimensionAnchor
  to: DimensionAnchor
  /** Extension direction in plant axes and distance on paper, independent of model length. */
  axis: Vec3
  offset: number
  reverseText?: boolean
  format?:'feet'|'inches'|'feet-short'
}
export interface SheetInfo {
  drawingNumber?: string
  lineNumber?: string
  revision?: string
  /** Item numbers held as issued: material row keys in ID order. New items follow, in the usual order. */
  bomOrder?: string[]
  /** Held material-table row heights on paper, keyed by material row; text always retains enough room. */
  bomRowHeights?: Record<string, number>
  /** Total material-table width on paper; extra room goes to the description column. */
  bomWidth?: number
  /** Item, quantity and size column widths on paper; the description uses the remaining table width. */
  bomColumns?: [number,number,number]
  /** Verbatim cells retained when reproducing an issued drawing; calculated fabrication quantities remain intact. */
  issuedValues?: Record<string, IssuedCells>
  /** Drafter's positions on the isometric paper (sheet units); routing and fabrication coordinates are unchanged. */
  nodePositions?: Record<string, [number, number]>
  /** Held callout and item-label positions on isometric paper. */
  labelPositions?: Record<string, [number, number]>
  /** Lettering choices for an editable label, independent of its measured geometry. */
  labelStyles?: Record<string,{size?:number;rotation?:number;oblique?:number}>
  /** Held dimension-line placement and lettering on paper. */
  dimensionLayout?: Record<string, { axis?: Vec3; offset?: number; reverseText?: boolean; format?:'feet'|'inches'|'feet-short' }>
  /** Issued joint callouts may reference existing BOM items without purchasing those parts again at this joint. */
  jointItems?: Record<string, { flange?: string; bolts?: string; gasket?: string }>
  /** An explicitly drafted set replaces automatic dimensions on this sheet. Lengths still come from the model. */
  dimensions?: SheetDimension[]
  /** Replace only the measured straights, retaining automatic dimensions and offset constructions elsewhere. */
  dimensionScope?: 'sheet' | 'legs'
}
/** Cells held as issued on a material row, with the calculated cells at the time each was entered. */
export interface IssuedCells {
  qtyText?: string
  nd?: string
  description?: string
  /** What the model calculated for each cell when it was overridden; a later difference is reported. */
  calculated?: { qtyText?: string; nd?: string; description?: string }
}
export interface DrawingStyle {
  layout: 'scale' | 'schematic'
  weldNumbers: boolean
  lettering: 'cad' | 'sans'
  /** Centreline elevation at every change of level, not only where the drafter places one. */
  elevations?: boolean
  /** A second dimension chain to component body faces, in addition to mating flange faces. */
  componentFaces?: boolean
  /** Print SCALE: NTS on schematic sheets. Omitted means shown. */
  scaleNote?: boolean
  /**
   * How chained dimensions are rounded. 'chain' (default) rounds the running total so the chain closes on the rounded
   * overall. 'individual' (explicit opt-in, legacy issued sheets) rounds each on its own; the sheet then prints
   * `dimensionRoundingNote`, because such a chain need not add up.
   */
  dimensionRounding?: 'chain' | 'individual'
  northMark?: 'arrow' | 'ticks'
  stackSizeLabels?: boolean
  /** Not to scale: the isometric paper's cell, in inches on the printed sheet (default 1/4"). */
  paperGrid?: number
  /**
   * Not to scale: lengthens pipe drawn across the page by up to this share of its length (0 to 2), so a tall, narrow
   * drawing fills more of the sheet. Default 0: drawn as laid out.
   */
  stretch?: number
  /**
   * Lettering height on the printed paper (mm); every symbol, arrowhead, gap and dimension tier is drawn in proportion
   * to it. Default 2.5 mm (ISO 3098 minimum; about ASME Y14.2's 0.10 in).
   */
  textHeight?: number
  /** Pipe line weight on the printed paper (mm), every size alike. Default 0.5 mm (ISO 128 wide line). */
  pipeWeight?: number
  /**
   * How a flanged joint's parts are called out: a balloon for each item (default), or one combined callout of
   * prefixed items (F, B, G) with the bolting boxed and the second flange of a pair tagged on its own.
   */
  jointCallout?: 'items' | 'combined'
  /** Letter field-fit welds FFW with their makeup (default), or as plain field welds (FW). */
  fieldFitMark?: 'FFW' | 'FW'
  /**
   * Where a spool's material list is printed. 'auto' (default): on its drawing sheet, unless the list takes so much of
   * the sheet that a not-to-scale drawing cannot be laid out at full size beside it, when the list moves to a sheet of
   * its own after the drawing (the drawing sheet notes MATERIAL LIST CONTINUED ON SHEET n). 'onSheet' always keeps it
   * on the drawing sheet; 'separate' always gives it its own sheet.
   */
  materialList?: 'auto' | 'onSheet' | 'separate'
}
/** Plant east, north and elevation (mm) of the model origin. */
export interface PlantCoordinates {
  origin: Vec3
}
export interface SheetNote {
  size?: number
  lettering?: 'cad' | 'sans'
  /** Optional paper-space callout box and leader, independent of plant geometry. */
  box?: { at: [number,number]; width: number; height: number }
  leader?: Array<[number,number]>
  arrow?: boolean
  color?: string
  textColor?: string
  id: string
  spool: string
  text: string
  /** Sheet units. */
  at: [number, number]
  rotation?: number
  oblique?: number
}
export type EndPrep = 'BW' | 'SW' | 'THD' | 'FL' | 'PLAIN'
export interface PipeRun {
  id: string
  from: string
  to: string
  specId: string
  nps: number
  spool: string
  line: string
  heat: string
  connector?: boolean
  fromPrep?: EndPrep
  toPrep?: EndPrep
  fromField?: boolean
  toField?: boolean
  /** A field-fit weld at this end: the pipe is cut long by the drawing's makeup length and trimmed to fit on site. */
  fromFieldFit?: boolean
  toFieldFit?: boolean
  fromTag?: string
  toTag?: string
  rootGap?: number
  endPrep: EndPrep
  /**
   * Listed by length, without a cut: the piece runs on through a drawing break as one length, or is a full random
   * length used as it comes.
   */
  uncut?: boolean
  /** Bill-of-materials text for this pipe when it differs from its size's text in the specification. */
  description?: string
  /**
   * A pipe nipple: bought to the specification's catalogued length (or `length`, mm) with its ends finished, and listed
   * by count rather than cut. Its ends (TBE, POE, PBE…) follow the end preparations.
   */
  nipple?: { length?: number }
  /** Flow direction along the pipe: forward runs from `from` to `to`. */
  flow?: 'forward' | 'reverse'
  /** Held arrow position along this drawn pipe, from 0 at `from` to 1 at `to`. */
  flowPosition?: number
  /** Show a pipe arrow independently of the stored installation flow direction. */
  showFlow?: boolean
  /** Held extension-line direction for this straight's automatic dimension chains, in plant axes. */
  dimensionAxis?: Vec3
  /** Letter the line identifier in the vertical or plan isometric plane. */
  showSize?: boolean
  lineNumberPlane?: 'vertical' | 'plan' | 'normal' | 'alternate'
  /** Explicitly letter this pipe (including repeats), or exclude it from automatic placement. */
  showLineNumber?: boolean
  dimensionReverse?: boolean
  /** Paper drafting choices for this offset; all values and angles still come from its model vector. */
  offsetDrawing?: { angleOutwardH?:boolean; angleOutwardV?:boolean; rightAngleSize?:number; angleFromH?:'start'|'end'; angleFromV?:'start'|'end'; angleArrows?:boolean; showTrueLength?:boolean; angleRadiusH?:number; angleRadiusV?:number; dimensionLegs?: boolean; showLegValues?: boolean; trueLengthOffset?: number; setAndRoll?: boolean; hatchCount?: number; hatchSpacing?: number; hatchStart?: number; hatchGap?: number; hatchFrom?:'start'|'end'; hatchPlane?:'H'|'V'; planPoint?:[number,number]; legPlane?:'construction'|'vertical' }
}
export interface IsoDocument {
  schema: 'bidwright-piping'
  version: 1
  title: string
  drawing: string
  revision: string
  customer: string
  project: string
  drawnBy: string
  checkedBy: string
  notes: string
  units: 'mm' | 'imperial'
  north: number
  dimensionMode: 'overall' | 'cut' | 'both'
  grid?: GridSettings
  paper?: 'letter' | 'tabloid' | 'a3' | 'a4'
  /**
   * 'classic': Spoolyard's own paper. 'production': a title-block template, `sheetTemplate` (a built-in by id, or a
   * copy carried in the drawing), else the built-in default.
   */
  sheetFormat?: 'classic'|'production'
  sheetTemplate?: string | SheetTemplate
  outputViews?: Array<'iso' | 'plan' | 'front' | 'side'>
  specs: PipeSpec[]
  nodes: PipeNode[]
  runs: PipeRun[]
  weldStart: number
  weldPrefix: string
  weldNumbering?: 'numeric' | 'alphabetic'
  /** Extra pipe (mm) left at a field-fit weld for trimming on site; 3" (100 mm on a metric drawing) if unset. */
  fieldFitMakeup?: number
  /** Fabrication and drafting conventions of the project (see profile.ts); documented defaults when unset. */
  profile?: FabricationProfile
  /**
   * Revision of the explicit drafting fields the document was saved with. Documents without it were drafted when
   * terminations, insulation limits and butterfly bodies were read from free text; they are migrated once on load.
   */
  draftingRules?: number
  titleBlock?: TitleBlock
  /** Per-spool sheet identity; a spool is one issued sheet. */
  sheets?: Record<string, SheetInfo>
  style?: DrawingStyle
  coordinates?: PlantCoordinates
  sheetNotes?: SheetNote[]
  /** Adjacent drawings shown thin at continuations, excluded from all fabrication quantities. */
  references?: DrawingReference[]
}
export interface DrawingReference {
  id: string
  atNodeId: string
  name: string
  anchorNodeId: string
  nodes: PipeNode[]
  runs: PipeRun[]
  specs: PipeSpec[]
  /** Number of adjacent fittings to show; zero shows the adjoining pipe cut only. */
  components?: number
  dimensionTo?: string
  /** End the visible adjacent fragment with a drafting break or a plain cut line. */
  termination?: 'break' | 'plain'
  pipeWeight?: boolean
}
export interface RunResult {
  run: PipeRun
  overall: number
  cut: number
  takeouts: [number, number]
  gaps: [number, number]
  /** Extra length left at each field-fit end. */
  makeup: [number, number]
  weightKg: number
  areaM2: number
}
export interface Weld {
  tag: string
  runId: string
  nodeId: string
  nps: number
  field: boolean
  prep: string
  /** Butt, socket, slip-on fillet (bore and hub), branch connection, reinforcing pad or support attachment. */
  type: 'BW' | 'SW' | 'SO' | 'BR' | 'RP' | 'AT'
  /** A field-fit weld: made on site after trimming the pipe left long. */
  fieldFit?: boolean
  position: Vec3
}
export interface BomRow {
  item: number
  description: string
  spec: string
  nps: number
  qty: number
  unit: 'm' | 'ea'
  weightKg: number | null
  areaM2: number | null
  cost: number
  hours: number
  heat: string
  spool: string
  line: string
  materialKey?: string
  memberIds?: string[]
}
export const id = () => crypto.randomUUID()
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2]
]
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2]
]
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
export const length = (a: Vec3) => Math.hypot(...a)
export const distance = (a: Vec3, b: Vec3) => length(sub(a, b))
export const round = (v: number, d = 2) => Number(v.toFixed(d))
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
// Dimensional facts: Wheatland Schedule 40 submittal and Weldbend catalogue, 63rd ed.
const lrWeights = [0.4, 0.55, 0.8, 1.6, 3.2, 4.8, 6.6, 8.9, 15.1, 24.0, 47.8]
const lr45Takeouts = [0.88, 1, 1.12, 1.38, 1.75, 2, 2.25, 2.5, 3.12, 3.75, 5]
const lr45Weights = [
  0.22, 0.33, 0.43, 0.85, 1.7, 2.5, 3.4, 4.5, 7.5, 11.7, 23.3
]
const teeTakeouts = [1.5, 1.88, 2.25, 2.5, 3, 3.38, 3.75, 4.12, 4.88, 5.62, 7]
const teeWeights = [0.75, 1.3, 1.9, 3.2, 5.8, 7.2, 9.5, 12.7, 20.8, 33.1, 56.5]
const capHeight = [1.5, 1.5, 1.5, 1.5, 1.5, 2, 2.5, 2.5, 3, 3.5, 4]
const capWeights = [0.21, 0.33, 0.54, 0.8, 1, 1.7, 2.3, 2.8, 4.6, 6.9, 11.8]
const gateValves = [
  [2, 215.9, 18],
  [2.5, 241.3, 21],
  [3, 282.45, 30],
  [4, 304.8, 44],
  [5, 381, 54],
  [6, 403.35, 76],
  [8, 419.1, 126]
]
const srWeights = [0.3, 0.4, 0.5, 1.0, 2.0, 3.0, 4.3, 6.1, 9.7, 16.7, 32.4]
const rows = [
  [1, 33.4, 3.38, 1.68],
  [1.25, 42.2, 3.56, 2.27],
  [1.5, 48.3, 3.68, 2.72],
  [2, 60.3, 3.91, 3.66],
  [2.5, 73, 5.16, 5.8],
  [3, 88.9, 5.49, 7.58],
  [3.5, 101.6, 5.74, 9.12],
  [4, 114.3, 6.02, 10.8],
  [5, 141.3, 6.55, 14.63],
  [6, 168.3, 7.11, 18.99],
  [8, 219.1, 8.18, 28.58]
]
export function defaultSpec(): PipeSpec {
  return {
    id: 'CS40',
    name: 'Carbon steel · Schedule 40',
    material: 'Carbon steel',
    schedule: '40',
    rating: 'Class 150',
    // A starter specification states its flange design, so new drawings do not rest on assumed classes or gaskets.
    design: { flangeClass: 150, flangeFace: 'RF', gasketThickness: GASKET_THICKNESS.spiralWoundCompressed },
    rootGap: 3,
    socketGap: 1.6,
    density: 7850,
    pipeCostM: 0,
    pipeLaborHoursM: 0,
    weldHoursPerDiameterInch: 0,
    sizes: rows.map(([nps, od, wall, lbFt]) => ({
      nps,
      od,
      wall,
      kgM: (lbFt * 0.45359237) / 0.3048
    })),
    fittings: [
      ...rows.flatMap(([nps, od], i) => [
        {
          id: `LR90-${nps}`,
          kind: 'elbow90' as Kind,
          nps,
          description: '90° long-radius butt-weld elbow',
          takeout: nps * 38.1,
          weightKg: lrWeights[i] * 0.45359237,
          areaM2: (Math.PI * od * ((Math.PI / 2) * nps * 38.1)) / 1e6,
          source:
            'Weldbend, 63rd edition, p26; nominal centre-to-end, approximate manufacturer weight; nominal tube surface.'
        },
        {
          id: `SR90-${nps}`,
          kind: 'elbow90' as Kind,
          nps,
          description: '90° short-radius butt-weld elbow',
          takeout: nps * 25.4,
          weightKg: srWeights[i] * 0.45359237,
          areaM2: (Math.PI * od * ((Math.PI / 2) * nps * 25.4)) / 1e6,
          source:
            'Weldbend, 63rd edition, p29; nominal centre-to-end, approximate manufacturer weight; nominal tube surface.'
        },
        {
          id: `LR45-${nps}`,
          kind: 'elbow45' as Kind,
          nps,
          description: '45° long-radius butt-weld elbow',
          takeout: lr45Takeouts[i] * 25.4,
          weightKg: lr45Weights[i] * 0.45359237,
          source:
            'Weldbend, 63rd edition, p38; centre-to-end in inches; approximate manufacturer weight.'
        },
        {
          id: `TEE-${nps}`,
          kind: 'tee' as Kind,
          nps,
          description: 'Equal butt-weld tee',
          takeout: teeTakeouts[i] * 25.4,
          branchTakeout: teeTakeouts[i] * 25.4,
          weightKg: teeWeights[i] * 0.45359237,
          source:
            'Weldbend, 63rd edition, p49; nominal centre-to-end, approximate manufacturer weight.'
        },
        {
          id: `CAP-${nps}`,
          kind: 'cap' as Kind,
          nps,
          description: 'Butt-weld cap',
          takeout: capHeight[i] * 25.4,
          weightKg: capWeights[i] * 0.45359237,
          source:
            'Weldbend, 63rd edition, p76; node at outer end of cap, takeout is cap height; approximate manufacturer weight.'
        }
      ]),
      ...gateValves.map(([nps, faceToFace, weightKg]) => ({
        id: `GATE150BW-${nps}`,
        kind: 'valve' as Kind,
        nps,
        description: 'Bonney Forge Class 150 butt-weld gate valve',
        takeout: faceToFace / 2,
        weightKg,
        source:
          'Bonney Forge Cast Steel Valves catalogue, Gate Valves Class 150; L1 (BW) end-to-end / 2, WT (BW).'
      }))
    ]
  }
}
export function newIso(): IsoDocument {
  return {
    schema: 'bidwright-piping',
    version: 1,
    title: 'Piping isometric',
    sheetFormat:'classic',
    drawing: 'ISO-001',
    revision: '0',
    customer: '',
    project: '',
    drawnBy: '',
    checkedBy: '',
    notes: '',
    units: 'mm',
    north: 0,
    dimensionMode: 'overall',
    specs: [defaultSpec()],
    nodes: [],
    runs: [],
    weldStart: 1,
    weldPrefix: 'W',
    style: { layout: 'schematic', weldNumbers: false, lettering: 'cad' },
    draftingRules: DRAFTING_RULES,
    titleBlock: { ...emptyTitleBlock(), designCode: 'ASME B31.3' }
  }
}
export function emptyTitleBlock(): TitleBlock {
  return {
    referenceDrawings: [],
    designedBy: '',
    date: '',
    checkedBy: '',
    projectLeader: '',
    disciplineLeader: '',
    approvedBy: '',
    conditions: { design: ['', ''], operating: ['', ''], test: ['', ''] },
    insulationThickness: '',
    insulationCladding: '',
    tracing: '',
    pipeSpec: '',
    specRevision: '',
    designCode: '',
    product: '',
    refArea: '',
    lineNumber: '',
    projectNumber: '',
    revisions: [],
    logos: []
  }
}
/** The title block to print; older drawings fill it from their original header fields. */
export function titleBlockOf(doc: IsoDocument): TitleBlock {
  const block = doc.titleBlock ?? emptyTitleBlock()
  return {
    ...block,
    designedBy: block.designedBy || doc.drawnBy,
    checkedBy: block.checkedBy || doc.checkedBy,
    projectNumber: block.projectNumber || doc.project,
    pipeSpec: block.pipeSpec || [...new Set(doc.runs.map(r => r.specId))].join(', '),
    revisions: block.revisions.length || !doc.revision ? block.revisions : [{
      rev: doc.revision, date: block.date, description: '', designedBy: block.designedBy || doc.drawnBy,
      checkedBy: block.checkedBy || doc.checkedBy, disciplineLead: '', projectLeader: '', approvedBy: ''
    }]
  }
}
export function styleOf(doc: IsoDocument): DrawingStyle {
  return doc.style ?? { layout: 'scale', weldNumbers: true, lettering: 'sans' }
}
/** Drawing number, line and revision printed on one spool's sheet. */
export function sheetInfoOf(doc: IsoDocument, spool: string): Required<Pick<SheetInfo, 'drawingNumber' | 'lineNumber' | 'revision'>> {
  const own = (spool && doc.sheets?.[spool]) || {}
  const spools = [...new Set(doc.runs.map(r => r.spool))]
  return {
    drawingNumber: own.drawingNumber || (spools.length > 1 && spool ? `${doc.drawing}-${spools.indexOf(spool) + 1}` : doc.drawing),
    lineNumber: own.lineNumber ?? (doc.titleBlock?.lineNumber || ''),
    revision: own.revision || doc.titleBlock?.revisions.at(-1)?.rev || doc.revision
  }
}
/** Plant east, north and elevation of a model point. */
export function plantCoordinate(doc: IsoDocument, p: Vec3): Vec3 {
  return add(doc.coordinates?.origin ?? [0, 0, 0], p)
}
/**
 * Lookups by id over one document, built once for a computation that only reads it (`withIndex`): the job's welds,
 * validation, a sheet's materials. Outside such a computation every lookup scans the document, so a document changed
 * in place is always read as it is now.
 */
interface DocIndex {
  doc: IsoDocument
  nodes: Map<string, PipeNode>
  runs: Map<string, PipeRun>
  specs: Map<string, PipeSpec>
  fittings: Map<string, CatalogItem>
  /** Pipes at each node, in document order. */
  edges: Map<string, PipeRun[]>
  /** Nodes attached along each pipe (supports, olets, annotations), in document order. */
  attached: Map<string, PipeNode[]>
}
let scope: DocIndex | undefined
function buildIndex(doc: IsoDocument): DocIndex {
  const first = <T extends { id: string }>(items: T[]) => {
    const map = new Map<string, T>()
    for (const item of items) if (!map.has(item.id)) map.set(item.id, item)
    return map
  }
  const push = <T>(map: Map<string, T[]>, key: string, value: T) => { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]) }
  const edges = new Map<string, PipeRun[]>(), attached = new Map<string, PipeNode[]>()
  for (const r of doc.runs) { push(edges, r.from, r); if (r.to !== r.from) push(edges, r.to, r) }
  for (const n of doc.nodes) if (n.associatedRunId) push(attached, n.associatedRunId, n)
  return { doc, nodes: first(doc.nodes), runs: first(doc.runs), specs: first(doc.specs), fittings: first(doc.specs.flatMap(s => s.fittings)), edges, attached }
}
/**
 * Run `work`, which reads `doc` without changing it, with the document's lookups indexed: each node, pipe and
 * specification row is found by id at once rather than by scanning, making whole-job passes linear.
 */
export function withIndex<T>(doc: IsoDocument, work: () => T): T {
  if (scope?.doc === doc) return work()
  const outer = scope
  scope = buildIndex(doc)
  try { return work() } finally { scope = outer }
}
const indexed = (doc: IsoDocument) => scope?.doc === doc ? scope : undefined
export function getNode(doc: IsoDocument, key: string): PipeNode {
  const node = indexed(doc)?.nodes.get(key) ?? doc.nodes.find(n => n.id === key)
  if (!node) throw new Error(`Missing connection ${key}`)
  return node
}
/** The pipe with this id, if there is one. */
export function runById(doc: IsoDocument, key: string | undefined): PipeRun | undefined {
  if (key == null) return undefined
  const index = indexed(doc)
  return index ? index.runs.get(key) : doc.runs.find(r => r.id === key)
}
/** Nodes attached along a pipe (supports, branch outlets, annotations), in document order. */
export function attachedTo(doc: IsoDocument, runId: string): PipeNode[] {
  const index = indexed(doc)
  return index ? [...(index.attached.get(runId) ?? [])] : doc.nodes.filter(n => n.associatedRunId === runId)
}
export function getSpec(doc: IsoDocument, key: string): PipeSpec {
  const spec = indexed(doc)?.specs.get(key) ?? doc.specs.find(s => s.id === key)
  if (!spec) throw new Error(`Missing pipe specification ${key}`)
  return spec
}
export function fitting(
  doc: IsoDocument,
  node: PipeNode
): CatalogItem | undefined {
  if (node.catalogId == null) return undefined
  const index = indexed(doc)
  if (index) return index.fittings.get(node.catalogId)
  for (const s of doc.specs) for (const f of s.fittings) if (f.id === node.catalogId) return f
  return undefined
}
export function takeout(
  doc: IsoDocument,
  node: PipeNode,
  runId: string
): number | undefined {
  if (['end', 'weld', 'support', 'annotation'].includes(node.kind)) return 0
  if (node.portTakeouts?.[runId] != null) return node.portTakeouts[runId]
  // A specification row without a known dimension falls back to the ASME standard, never to zero.
  const item = nodeItem(doc, node), run = runById(doc, runId)
  // An outlet's own pipes are all branch pipes (its header is the run it sits on), so its takeout keeps its reference
  // whether or not one of them is marked as the branch.
  const own = node.branchEdgeId === runId && node.kind !== 'olet'
    ? node.branchTakeout ?? (item?.takeoutMissing ? undefined : item?.branchTakeout)
    : node.takeout ?? bendTakeout(doc, node) ?? (isFormedBend(doc, node) ? undefined
      : item?.takeoutMissing ? undefined : lateralLongSide(doc, node, runId, item) ?? oletTakeout(doc, node, item) ?? item?.takeout)
  return own == null || !run ? own : own + flangedAllowance(doc, node, run)
}
/**
 * Where each dimension of a node comes from: measured on the node, the specification row, the built-in ASME standard
 * (the specification has no row with a dimension, or its row lacks one), or nowhere. The inspector and sheet show it.
 */
export type DimensionSource = 'measured' | 'specification' | 'standard' | 'missing'
export function dimensionSource(doc: IsoDocument, node: PipeNode, runId?: string): DimensionSource {
  if (['end', 'weld', 'support', 'annotation'].includes(node.kind)) return 'measured'
  if (runId ? node.portTakeouts?.[runId] != null || (node.branchEdgeId === runId && node.kind !== 'olet' ? node.branchTakeout : node.takeout) != null
    : node.takeout != null || node.portTakeouts != null) return 'measured'
  if (isFormedBend(doc, node)) return node.bendRadius! > 0 ? 'measured' : 'missing'
  const own = fitting(doc, node), item = nodeItem(doc, node)
  if (!item || (runId && takeout(doc, node, runId) == null)) return 'missing'
  return own && own === item && !own.takeoutMissing ? 'specification' : item.takeoutMissing ? 'missing' : 'standard'
}
/** Header centreline to a branch outlet's end, where its branch pipe starts (the takeout on the branch). */
export function oletReach(doc: IsoDocument, node: PipeNode, branch: PipeRun): number | undefined {
  return takeout(doc, node, branch.id)
}
/**
 * A branch outlet measured from the run pipe's outside (MSS SP-97) sits on its header's centreline: its takeout adds
 * the header radius and the root gap under the outlet. An outlet drawn without its header is measured from its node.
 */
function oletTakeout(doc: IsoDocument, node: PipeNode, item?: CatalogItem): number | undefined {
  if (node.kind !== 'olet' || item?.takeoutReference !== 'header-outside') return undefined
  const header = runById(doc, node.associatedRunId)
  if (!header) return undefined
  const spec = doc.specs.find(s => s.id === header.specId)
  const od = spec?.sizes.find(s => s.nps === header.nps)?.od ?? pipeOd(header.nps)
  return od == null ? undefined : od / 2 + (header.rootGap ?? spec?.rootGap ?? 0) + item.takeout
}
/** A bend formed from the pipe itself (induction or cold bend): part of one pipe piece, with no welds. */
export const FORMED_BEND = 'PIPEBEND'
export const isFormedBend = (doc: IsoDocument, node: PipeNode) => (node.component ?? fitting(doc, node)?.component) === FORMED_BEND
/**
 * A 180° return (ASME B16.9) is drawn as its two 90° halves, each taking the return's radius O/2, joined by the
 * return's body: a straight of the centre-to-centre O between them. It is one fitting: one item, no weld between the
 * halves, no pipe in its body.
 */
export const RETURN_CODES: ReadonlySet<string> = new Set(['LR180R', 'SR180R'])
const returnCode = (doc: IsoDocument, node: PipeNode) => {
  const code = node.component ?? fitting(doc, node)?.component
  return code && RETURN_CODES.has(code) ? code : undefined
}
/** The other half of a 180° return, and the body joining them. */
export function returnPartner(doc: IsoDocument, node: PipeNode): { partner: PipeNode; body: PipeRun } | undefined {
  const code = returnCode(doc, node)
  if (!code) return undefined
  for (const body of connected(doc, node.id)) {
    const partner = getNode(doc, body.from === node.id ? body.to : body.from)
    if (returnCode(doc, partner) === code) return { partner, body }
  }
  return undefined
}
/** The straight inside a 180° return, between its halves: no pipe, no weld. */
export const isReturnBody = (doc: IsoDocument, run: PipeRun) => {
  const a = getNode(doc, run.from), b = getNode(doc, run.to), code = returnCode(doc, a)
  return !!code && code === returnCode(doc, b)
}
/** Deflection (radians) the two pipes at a node make, 0 when straight. */
export function deflection(doc: IsoDocument, node: PipeNode): number | undefined {
  const legs = connected(doc, node.id).map(r => sub(getNode(doc, r.from === node.id ? r.to : r.from).position, node.position))
  if (legs.length !== 2) return undefined
  const [a, b] = legs, cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((length(a) * length(b)) || 1)
  return Math.PI - Math.acos(Math.max(-1, Math.min(1, cos)))
}
/** Tangent length of a pipe bend of known radius: R · tan(θ/2) for the deflection θ the pipes make. */
export function bendTakeout(doc: IsoDocument, node: PipeNode): number | undefined {
  if (!(node.bendRadius! > 0)) return undefined
  const theta = deflection(doc, node)
  return theta == null ? undefined : node.bendRadius! * Math.tan(theta / 2)
}
/** Centreline arc length R · θ of a formed bend: the pipe it takes between its tangent points. */
export function bendArc(doc: IsoDocument, node: PipeNode): number | undefined {
  const theta = deflection(doc, node)
  return node.bendRadius! > 0 && theta != null ? node.bendRadius! * theta : undefined
}
/** A lateral's run is longer on the side its branch leans toward. */
function lateralLongSide(doc: IsoDocument, node: PipeNode, runId: string, item?: CatalogItem): number | undefined {
  if (item?.longSideTakeout == null || !node.branchEdgeId) return undefined
  const away = (id: string) => {
    const r = runById(doc, id)
    return r ? sub(getNode(doc, r.from === node.id ? r.to : r.from).position, node.position) : undefined
  }
  const branch = away(node.branchEdgeId), header = away(runId)
  return branch && header && branch.reduce((sum, v, i) => sum + v * header[i], 0) > 0 ? item.longSideTakeout : undefined
}
/** End preparation of the pipe itself: a flanged port is resolved to its mating flange's weld or thread. */
export function pipePrepAt(doc: IsoDocument, run: PipeRun, index: number): EndPrep {
  return pipeEndPrep(doc, run, index, prepAt(run, index))
}
export function prepAt(run: PipeRun, index: number): EndPrep {
  return (index === 0 ? run.fromPrep : run.toPrep) ?? run.endPrep
}
/** Socket-weld gap of a specification: its own, else 1/16″ (ASME B31.3 Fig. 328.5.2C). */
export const DEFAULT_SOCKET_GAP = SOCKET_WELD_GAP
export const socketGapOf = (spec: PipeSpec) => spec.socketGap ?? DEFAULT_SOCKET_GAP

const outsideDiameter = (doc: IsoDocument, run: PipeRun) =>
  getSpec(doc, run.specId).sizes.find(s => s.nps === run.nps)?.od ?? pipeOd(run.nps)
/** An eccentric reducer's two pipes: the large end and the small end. */
function eccentricEnds(doc: IsoDocument, node: PipeNode): { large: PipeRun; small: PipeRun } | undefined {
  const edges = connected(doc, node.id)
  if (!isEccentric(node.component ?? fitting(doc, node)?.component) || edges.length !== 2 || edges[0].nps === edges[1].nps) return undefined
  const [large, small] = edges[0].nps > edges[1].nps ? edges : [edges[1], edges[0]]
  return { large, small }
}
/**
 * How far an eccentric reducer moves its small pipe's centreline across the axis: (D − d)/2 toward the flat side
 * (flat on top lifts the small pipe so the tops line up). Zero for every other node and pipe.
 */
export function eccentricOffset(doc: IsoDocument, node: PipeNode, runId: string): Vec3 {
  const ends = node.flatSide ? eccentricEnds(doc, node) : undefined
  if (!ends || ends.small.id !== runId) return [0, 0, 0]
  const D = outsideDiameter(doc, ends.large), d = outsideDiameter(doc, ends.small)
  return D == null || d == null ? [0, 0, 0] : mul(FLAT_DIRECTION[node.flatSide!], (D - d) / 2)
}
/**
 * Where a pipe's centreline meets a node: the node itself, or at an eccentric reducer's small end the node offset
 * across the axis when the drawing's geometry carries the offset. An older drawing whose small end is still on the
 * large end's axis is measured as drawn, and review reports it (`eccentricMisalignment`).
 */
export function portPoint(doc: IsoDocument, node: PipeNode, runId: string): Vec3 {
  const want = eccentricOffset(doc, node, runId)
  if (!length(want)) return node.position
  const e = eccentricError(doc, node)
  return e && length(sub(e.want, e.have)) < 0.5 ? add(node.position, want) : node.position
}
/** How far (mm) an eccentric reducer's small end is from the offset its flat side gives; 0 when aligned. */
export function eccentricMisalignment(doc: IsoDocument, node: PipeNode): number {
  const e = node.flatSide ? eccentricError(doc, node) : undefined
  return e ? length(sub(e.want, e.have)) : 0
}
/** The flat side an eccentric reducer's small-end offset shows, for geometry imported with real port points (PCF). */
export function flatSideOf(offset: Vec3): FlatSide | undefined {
  const l = length(offset)
  if (l < 1e-6) return undefined
  return (Object.entries(FLAT_DIRECTION) as Array<[FlatSide, Vec3]>).find(([, d]) => (d[0] * offset[0] + d[1] * offset[1] + d[2] * offset[2]) / l > 0.999)?.[0]
}
/** The small end's centreline as drawn, across the axis from where `eccentricOffset` says it should be. */
function eccentricError(doc: IsoDocument, node: PipeNode): { want: Vec3; have: Vec3; small: PipeRun } | undefined {
  const ends = eccentricEnds(doc, node)
  if (!ends) return undefined
  const far = (r: PipeRun) => getNode(doc, r.from === node.id ? r.to : r.from).position
  const axis = sub(node.position, far(ends.large)), l = length(axis)
  if (!l) return undefined
  const u = mul(axis, 1 / l), v = sub(far(ends.small), node.position), along = v[0] * u[0] + v[1] * u[1] + v[2] * u[2]
  return { want: eccentricOffset(doc, node, ends.small.id), have: sub(v, mul(u, along)), small: ends.small }
}
/** Nodes reached from `from` through `first`, not coming back through `from`. */
function downstream(doc: IsoDocument, from: string, first: PipeRun): Set<string> {
  const start = first.from === from ? first.to : first.from, moving = new Set([start]), queue = [start]
  for (let i = 0; i < queue.length; i++)
    for (const edge of connected(doc, queue[i]).filter(r => r.id !== first.id)) {
      const other = edge.from === queue[i] ? edge.to : edge.from
      if (other === from) throw new Error('The small end of this reducer is in a closed loop. Move its connections individually.')
      if (!moving.has(other)) { moving.add(other); queue.push(other) }
    }
  return moving
}
/**
 * Set (or clear) an eccentric reducer's flat side and move its small-end pipework across by the offset, so the
 * elevations and coordinates beyond it are right. Lengths along the line are unchanged.
 */
export function setFlatSide(doc: IsoDocument, nodeId: string, side?: FlatSide): void {
  const node = getNode(doc, nodeId)
  if (side) node.flatSide = side
  else delete node.flatSide
  alignEccentric(doc, nodeId)
}
/** Move an eccentric reducer's small end across so its centreline is offset by exactly (D − d)/2 to the flat. */
export function alignEccentric(doc: IsoDocument, nodeId: string): void {
  const node = getNode(doc, nodeId), e = eccentricError(doc, node)
  if (!e) return
  const shift = sub(e.want, e.have)
  if (length(shift) < 1e-9) return
  const moving = downstream(doc, nodeId, e.small)
  for (const n of doc.nodes) {
    const host = doc.runs.find(r => r.id === n.associatedRunId)
    if (moving.has(n.id) || host && (host.id === e.small.id || moving.has(host.from) && moving.has(host.to))) n.position = add(n.position, shift)
  }
}
/** Distance along a pipe between its centreline points: across an eccentric reducer, along the reducer's axis. */
function overallOf(doc: IsoDocument, run: PipeRun, a: PipeNode, b: PipeNode): number {
  const straight = distance(a.position, b.position)
  for (const [node, other] of [[a, b], [b, a]] as const) {
    const ends = eccentricEnds(doc, node)
    if (!ends || ends.small.id !== run.id) continue
    const far = getNode(doc, ends.large.from === node.id ? ends.large.to : ends.large.from).position
    const axis = sub(node.position, far), l = length(axis)
    if (l) return Math.abs(sub(other.position, node.position).reduce((s, v, i) => s + v * axis[i], 0)) / l
  }
  return straight
}
export function runResult(doc: IsoDocument, run: PipeRun): RunResult {
  const a = getNode(doc, run.from),
    b = getNode(doc, run.to),
    spec = getSpec(doc, run.specId),
    size = spec.sizes.find(s => s.nps === run.nps)
  const overall = overallOf(doc, run, a, b)
  const ts: [number, number] = [
    takeout(doc, a, run.id) ?? NaN,
    takeout(doc, b, run.id) ?? NaN
  ]
  // A field-fit end is cut long and trimmed on site: it takes the makeup instead of a gap.
  const body = isReturnBody(doc, run)
  const fit = [run.fromFieldFit, run.toFieldFit].map(f => f && !run.connector && !body ? fieldFitMakeup(doc) : 0) as [number, number]
  // Fittings welded face to face (a close-coupled assembly) share one root gap.
  const welded = run.connector && !boltedConnector(doc, run) && !stubInFlange(doc, run) && [a, b].every(n => !['end', 'support', 'annotation', 'gasket', 'bolt'].includes(n.kind))
  const gaps = [a, b].map((n, i) => {
    if (body || fit[i] || ['end', 'support', 'annotation', 'gasket', 'bolt'].includes(n.kind) || isFormedBend(doc, n)) return 0
    const prep = pipePrepAt(doc, run, i)
    // Fittings welded face to face share one root gap; a pipe-to-pipe butt weld splits its root gap; a socket stops
    // the pipe short of its bottom.
    if (run.connector) return welded && prep === 'BW' ? (run.rootGap ?? spec.rootGap) / 2 : 0
    if (prep === 'BW') return (run.rootGap ?? spec.rootGap) / (n.kind === 'weld' ? 2 : 1)
    return prep === 'SW' && n.kind !== 'weld' ? socketGapOf(spec) : 0
  }) as [number, number]
  const cut = overall - ts[0] - ts[1] - gaps[0] - gaps[1] + fit[0] + fit[1]
  return {
    run,
    overall,
    cut,
    takeouts: ts,
    gaps,
    makeup: fit,
    weightKg: size ? (size.kgM * cut) / 1000 : NaN,
    areaM2: size ? (Math.PI * size.od * cut) / 1e6 : NaN
  }
}
/** Extra pipe left at a field-fit weld: the drawing's setting, else 3" (100 mm on a metric drawing). */
export const fieldFitMakeup = (doc: Pick<IsoDocument, 'units' | 'fieldFitMakeup'>) => doc.fieldFitMakeup ?? (doc.units === 'mm' ? 100 : 76.2)
/** Make a pipe end a field-fit weld (cut long by the makeup, trimmed and welded on site), or clear it. */
export function setFieldFit(doc: IsoDocument, runId: string, end: 'from' | 'to', on: boolean): void {
  const run = doc.runs.find(r => r.id === runId)
  if (!run || run.connector) throw new Error('Select a pipe to make a field-fit weld at its end.')
  const key = end === 'from' ? 'fromFieldFit' : 'toFieldFit'
  if (on) run[key] = true
  else delete run[key]
}
/** Set the makeup left at every field-fit weld (mm), or return to the default with undefined. */
export function setFieldFitMakeup(doc: IsoDocument, mm?: number): void {
  if (mm == null) { delete doc.fieldFitMakeup; return }
  if (!(Number.isFinite(mm) && mm >= 0)) throw new Error('Enter a field-fit makeup of zero or more.')
  doc.fieldFitMakeup = mm
}
export function connected(doc: IsoDocument, nodeId: string): PipeRun[] {
  const index = indexed(doc)
  return index ? [...(index.edges.get(nodeId) ?? [])] : doc.runs.filter(r => r.from === nodeId || r.to === nodeId)
}
const prepPrefix: Partial<Record<EndPrep, RegExp>> = { BW: /^W-/, SW: /^SW-/, THD: /^SC-/ }
/**
 * The specification row a routed bend or branch should use: the end preparation's family first
 * (butt-weld, socket-weld, screwed), then the ordinary long-radius / equal pattern, then rows with a known dimension.
 */
export function preferredFitting(
  spec: PipeSpec,
  kind: Kind,
  nps: number,
  prep: EndPrep,
  smallerNps?: number
): CatalogItem | undefined {
  const score = (f: CatalogItem) =>
    (f.component && prepPrefix[prep] && !prepPrefix[prep]!.test(f.component) ? 10 : 0) +
    (/SR|3D|180|BEND|CRS|LAT/i.test(f.component ?? '') ? 5 : 0) +
    (f.takeoutMissing ? 3 : 0)
  return spec.fittings
    .filter(
      f =>
        f.kind === kind &&
        f.nps === nps &&
        (smallerNps == null || smallerNps === nps ? !f.smallerNps || f.smallerNps === nps : f.smallerNps === smallerNps)
    )
    .sort((a, b) => score(a) - score(b))[0]
}
const prepAtNode = (run: PipeRun, nodeId: string) => prepAt(run, run.from === nodeId ? 0 : 1)
/** Default to the fitting family actually available at this size in the selected specification. */
export function defaultEndPrep(spec: PipeSpec, nps: number): EndPrep {
  const elbow = preferredFitting(spec, 'elbow90', nps, 'BW')
  return COMPONENT_TYPES.find(t => t.code === elbow?.component)?.endPrep === 'THD'
    ? 'THD'
    : COMPONENT_TYPES.find(t => t.code === elbow?.component)?.endPrep === 'SW' ? 'SW' : 'BW'
}
/** Branch types a branch table may name, by the names its legends use. */
const BRANCH_NAMES: Record<string, string> = {
  'TEE': 'TEE', 'EQUAL TEE': 'TEE', 'STRAIGHT TEE': 'TEE', 'REDUCING TEE': 'RTEE', 'RTEE': 'RTEE',
  'WELDOLET': 'WOL', 'WOL': 'WOL', 'SOCKOLET': 'SOL', 'SOL': 'SOL', 'THREDOLET': 'TOL', 'THREADOLET': 'TOL', 'TOL': 'TOL',
  'HALF COUPLING': 'H-CPLG', 'STUB-IN': 'STUB-IN', 'STUB IN': 'STUB-IN'
}
/**
 * The connection a specification's branch table gives for a run and branch size: `TEE`, `RTEE`, an olet component
 * code (`WOL`, `SOL`, `TOL`, `H-CPLGSW`…), `STUB-IN`, or undefined when the table has no entry.
 */
export function branchConnection(spec: PipeSpec, run: number, branch: number): string | undefined {
  const entry = spec.branchChart?.find(e => e.run === run && e.branch === branch)
  if (!entry) return undefined
  const named = (spec.branchCodes?.[entry.code] ?? entry.code).trim().toUpperCase()
  if (COMPONENT_TYPES.some(t => t.code === named)) return /-R?TEE$/.test(named) ? named.replace(/^.*-/, '') : named
  const type = BRANCH_NAMES[named]
  if (type === 'H-CPLG') return spec.fittings.some(f => f.component === 'H-CPLGSC') ? 'H-CPLGSC' : 'H-CPLGSW'
  return type
}
/**
 * Join the two header pipes at a branch point into one pipe the branch outlet sits on. Only plain pipes of one
 * specification, size, spool, line and heat, in line with each other, are joined.
 */
function mergeHeader(doc: IsoDocument, node: PipeNode, a: PipeRun, b: PipeRun): boolean {
  for (const key of ['specId', 'nps', 'spool', 'line', 'heat', 'rootGap', 'connector', 'nipple', 'uncut'] as const)
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false
  if (a.connector) return false
  const farA = a.from === node.id ? a.to : a.from, farB = b.from === node.id ? b.to : b.from
  const fromIndex = a.from === farA ? 0 : 1, toIndex = b.from === farB ? 0 : 1
  Object.assign(a, {
    from: farA, to: farB, fromPrep: prepAt(a, fromIndex), toPrep: prepAt(b, toIndex),
    fromField: a[fromIndex === 0 ? 'fromField' : 'toField'], toField: b[toIndex === 0 ? 'fromField' : 'toField'],
    fromFieldFit: a[fromIndex === 0 ? 'fromFieldFit' : 'toFieldFit'], toFieldFit: b[toIndex === 0 ? 'fromFieldFit' : 'toFieldFit'],
    fromTag: a[fromIndex === 0 ? 'fromTag' : 'toTag'], toTag: b[toIndex === 0 ? 'fromTag' : 'toTag']
  })
  for (const key of ['fromPrep', 'toPrep', 'fromField', 'toField', 'fromFieldFit', 'toFieldFit', 'fromTag', 'toTag'] as const)
    if (a[key] === undefined) delete a[key]
  for (const n of doc.nodes) {
    if (n.associatedRunId === b.id) n.associatedRunId = a.id
    if (n.portTakeouts?.[b.id] != null) { n.portTakeouts[a.id] = n.portTakeouts[b.id]; delete n.portTakeouts[b.id] }
    if (n.branchEdgeId === b.id) n.branchEdgeId = a.id
  }
  doc.runs = doc.runs.filter(r => r.id !== b.id)
  node.associatedRunId = a.id
  for (const info of Object.values(doc.sheets ?? {})) for (const dim of info.dimensions ?? [])
    for (const anchor of [dim.from, dim.to]) if (anchor.runId === b.id) anchor.runId = a.id
  pruneSheetAnchors(doc)
  return true
}
export function setAutoFitting(doc: IsoDocument, nodeId: string): void {
  const node = getNode(doc, nodeId), edges = connected(doc, nodeId)
  if (!['end', 'weld', 'elbow90', 'elbow45', 'tee'].includes(node.kind) && !(node.kind === 'valve' && /^F-CPLGS[WC]$/.test(node.component ?? ''))) return
  const vectors = edges.map(r => sub(getNode(doc, r.from === nodeId ? r.to : r.from).position, node.position))
  const cosine = (i: number, j: number) => vectors[i].reduce((sum, v, k) => sum + v * vectors[j][k], 0) / (length(vectors[i]) * length(vectors[j]))
  const changeKind = (kind: Kind) => {
    if (node.kind === kind) return
    node.kind = kind
    for (const key of ['catalogId', 'component', 'takeout', 'branchTakeout', 'portTakeouts', 'branchEdgeId', 'description', 'bendAngle', 'bendRadius'] as const) delete node[key]
  }
  const choose = (kind: Kind, header: PipeRun, smallerNps?: number, code?: string) => {
    const spec = getSpec(doc, header.specId), existing = fitting(doc, node)
    // Keep a chosen SR elbow or measured dimension when the route still uses the same fitting.
    if (existing && spec.fittings.includes(existing) && existing.kind === kind && existing.nps === header.nps &&
      (smallerNps == null || smallerNps === header.nps ? !existing.smallerNps || existing.smallerNps === header.nps : existing.smallerNps === smallerNps) &&
      (!code || existing.component === code)) return
    const prep = prepAtNode(header, nodeId)
    const preferred = code
      ? spec.fittings.find(f => f.component === code && f.nps === header.nps && (!smallerNps || f.smallerNps === smallerNps || smallerNps === header.nps && !f.smallerNps))
      : preferredFitting(spec, kind, header.nps, prep, smallerNps)
    // A socket-weld or threaded joint takes only a row of its own family: a butt-weld row (or one of unknown family)
    // has neither socket depth nor thread, so the standard socket-weld or threaded fitting is used instead. Likewise a
    // butt-welded joint never takes a socket-weld or threaded row.
    const wrongFamily = (f: CatalogItem) => prep === 'SW' || prep === 'THD' ? !prepPrefix[prep]!.test(f.component ?? '') : prep === 'BW' && /^(SW|SC)-/.test(f.component ?? '')
    const item = !code && preferred && wrongFamily(preferred) ? undefined : preferred
    node.catalogId = item?.id
    // Without a specification row the standard component still carries its ASME dimensions.
    const fallback = item?.component ?? code ??
      defaultCode(kind, prep, kind === 'tee' && smallerNps != null && smallerNps !== header.nps ? 'reducing' : '')
    if (fallback) node.component = fallback
    else delete node.component
  }
  if (edges.length <= 1) {
    changeKind('end')
  } else if (edges.length === 2) {
    const angle = Math.acos(Math.max(-1, Math.min(1, cosine(0, 1)))) * 180 / Math.PI
    if (Math.abs(angle - 180) < 0.1) {
      // Socket-weld and threaded pipe cannot be joined end to end: a straight joint between them is a coupling.
      const prep = edges.map(r => prepAtNode(r, nodeId)).find(p => p === 'SW' || p === 'THD')
      if (prep && edges[0].nps === edges[1].nps) {
        changeKind('valve')
        choose('valve', edges[0], undefined, prep === 'SW' ? 'F-CPLGSW' : 'F-CPLGSC')
      } else changeKind('weld')
      return
    }
    // A bend formed in the pipe takes whatever deflection the pipes make.
    if (isFormedBend(doc, node)) return
    const bend = 180 - angle, kind = Math.abs(bend - 45) < 0.1 ? 'elbow45' : 'elbow90'
    changeKind(kind)
    const header = edges.reduce((a, b) => a.nps >= b.nps ? a : b)
    if (Math.abs(bend - 90) < 0.1 || Math.abs(bend - 45) < 0.1) {
      delete node.bendAngle
      choose(kind, header, Math.min(...edges.map(r => r.nps)))
    } else {
      delete node.catalogId
      delete node.component
      node.bendAngle = bend
      node.description = `${round(bend)}° bend · enter centre-to-end`
    }
  } else if (edges.length === 3) {
    changeKind('tee')
    // The run is the straight pair; the remaining pipe is the branch, whatever order the pipes were drawn in.
    const branchIndex = vectors.findIndex((_, i) => {
      const main = [0, 1, 2].filter(j => j !== i)
      return cosine(main[0], main[1]) < -0.9998
    })
    const branch = edges[branchIndex]
    node.branchEdgeId = branch?.id
    if (!branch) { delete node.catalogId; delete node.component; return }
    const header = edges.find(r => r !== branch)!
    const branchAngle = Math.acos(Math.max(-1, Math.min(1, Math.abs(cosine(branchIndex, edges.indexOf(header)))))) * 180 / Math.PI
    const prefix = prepAtNode(header, nodeId) === 'SW' ? 'SW' : prepAtNode(header, nodeId) === 'THD' ? 'SC' : 'W'
    const lateral = Math.abs(branchAngle - 45) < 1
    if (lateral) return choose('tee', header, branch.nps, `${prefix}-${branch.nps === header.nps ? 'LAT' : 'RLAT'}`)
    // A square branch is the connection the specification's branch table gives for these sizes.
    const chart = branchConnection(getSpec(doc, header.specId), header.nps, branch.nps)
    if (chart === 'TEE' || chart === 'RTEE') return choose('tee', header, branch.nps, `${prefix}-${chart}`)
    if (chart && COMPONENT_TYPES.some(t => t.code === chart && t.kind === 'olet')) {
      const other = edges.find(r => r !== branch && r !== header)!
      if (mergeHeader(doc, node, header, other)) {
        node.kind = 'olet'
        for (const key of ['takeout', 'branchTakeout', 'portTakeouts', 'branchEdgeId', 'description', 'bendAngle', 'bendRadius'] as const) delete node[key]
        const spec = getSpec(doc, header.specId)
        const row = spec.fittings.find(f => f.component === chart && f.nps === header.nps && f.smallerNps === branch.nps) ??
          spec.fittings.find(f => f.component === chart && f.nps === branch.nps && !f.smallerNps)
        node.component = chart
        if (row) node.catalogId = row.id
        else delete node.catalogId
        return
      }
    }
    choose('tee', header, branch.nps)
  } else if (edges.length === 4) {
    changeKind('tee')
    const header = edges.reduce((a, b) => a.nps >= b.nps ? a : b), prep = prepAtNode(header, nodeId)
    const prefix = prep === 'SW' ? 'SW' : prep === 'THD' ? 'SC' : 'W'
    choose('tee', header, Math.min(...edges.map(r => r.nps)), `${prefix}-${edges.every(r => r.nps === header.nps) ? 'CRS' : 'RCRS'}`)
    delete node.branchEdgeId
  }
}
export function appendRun(
  doc: IsoDocument,
  fromId: string | null,
  delta: Vec3,
  specId: string,
  nps: number,
  spool: string,
  line: string,
  endPrep: EndPrep = 'BW'
): PipeNode {
  if (!delta.every(Number.isFinite) || length(delta) <= 0) throw new Error('Enter a positive length.')
  let a = fromId ? getNode(doc, fromId) : undefined
  if (!a) {
    a = { id: id(), position: [0, 0, 0], kind: 'end' }
    doc.nodes.push(a)
  }
  const position = add(a.position, delta),
    existing = doc.nodes.find(n => distance(n.position, position) < 0.001)
  const b = existing ?? { id: id(), position, kind: 'end' as Kind }
  if (
    doc.runs.some(
      r =>
        (r.from === a!.id && r.to === b.id) ||
        (r.to === a!.id && r.from === b.id)
    )
  )
    throw new Error('A pipe already connects these points.')
  if (!existing) doc.nodes.push(b)
  doc.runs.push({
    id: id(),
    from: a.id,
    to: b.id,
    specId,
    nps,
    spool,
    line,
    heat: '',
    endPrep
  })
  setAutoFitting(doc, a.id)
  setAutoFitting(doc, b.id)
  return b
}
/** Inserts an in-line component at a physical fraction; pipe ends remain fixed. */
export function insertComponent(
  doc: IsoDocument,
  runId: string,
  kind: Kind,
  fraction = 0.5
): PipeNode {
  if (!(fraction > 0 && fraction < 1))
    throw new Error('Position must be between the pipe ends.')
  const r = doc.runs.find(r => r.id === runId)
  if (!r) throw new Error('Select a pipe.')
  const node: PipeNode = {
    id: id(),
    position: add(
      getNode(doc, r.from).position,
      mul(
        sub(getNode(doc, r.to).position, getNode(doc, r.from).position),
        fraction
      )
    ),
    kind
  }
  doc.nodes.push(node)
  const previous = r.to,
    next = { ...r, id: id(), from: node.id, to: previous }
  // Each end keeps its own preparation, field flag, field fit and weld number; the new ends at the component have none.
  delete next.fromPrep
  delete next.fromField
  delete next.fromFieldFit
  delete next.fromTag
  r.to = node.id
  delete r.toPrep
  delete r.toField
  delete r.toFieldFit
  delete r.toTag
  // A nipple cut in two is two pipes.
  delete r.nipple
  delete next.nipple
  const oldEnd = getNode(doc, previous)
  if (oldEnd.portTakeouts?.[runId] != null) {
    oldEnd.portTakeouts[next.id] = oldEnd.portTakeouts[runId]
    delete oldEnd.portTakeouts[runId]
  }
  if (oldEnd.branchEdgeId === runId) oldEnd.branchEdgeId = next.id
  doc.runs.push(next)
  const start = getNode(doc, r.from).position, delta = sub(getNode(doc, previous).position, start)
  const norm = delta.reduce((sum, v) => sum + v * v, 0)
  for (const attached of doc.nodes.filter(n => n.associatedRunId === runId))
    if (sub(attached.position, start).reduce((sum, v, i) => sum + v * delta[i], 0) / norm > fraction)
      attached.associatedRunId = next.id
  return node
}
export function attachComponent(
  doc: IsoDocument,
  runId: string,
  kind: Kind,
  fraction = 0.5
): PipeNode {
  const r = doc.runs.find(r => r.id === runId)
  if (!r) throw new Error('Select a pipe.')
  if (!(fraction >= 0 && fraction <= 1))
    throw new Error('Position must be on the pipe.')
  const node: PipeNode = {
    id: id(),
    kind,
    position: add(
      getNode(doc, r.from).position,
      mul(
        sub(getNode(doc, r.to).position, getNode(doc, r.from).position),
        fraction
      )
    ),
    associatedRunId: runId
  }
  doc.nodes.push(node)
  return node
}
/** Apply a catalogue selection with the preparation and port dimensions of that component. */
export function applyComponent(doc: IsoDocument, node: PipeNode, code: string, row?: CatalogItem): void {
  const type = COMPONENT_TYPES.find(t => t.code === code)
  if (!type || type.kind === 'pipe') throw new Error('Choose a fitting or drawing symbol.')
  node.kind = type.kind
  node.component = code
  node.catalogId = row?.id
  delete node.description
  delete node.takeout
  delete node.branchTakeout
  delete node.portTakeouts
  delete node.bendAngle
  // A flange between two pipes is a bolted pair; on a pipe end it mates with equipment. Either way each
  // pipe is prepared for its own flange, and the gasket and mate come from the flanged joint.
  for (const run of connected(doc, node.id))
    if (type.endPrep) run[run.from === node.id ? 'fromPrep' : 'toPrep'] = type.endPrep
}

/** Change an overall length while translating the downstream route, preserving its bends and lengths. */
export function resizeRun(doc: IsoDocument, runId: string, overall: number): void {
  const run = doc.runs.find(r => r.id === runId)
  if (!run || run.connector) throw new Error('Select a pipe to change its length.')
  if (!Number.isFinite(overall) || overall <= 0) throw new Error('Enter a positive length.')
  const a = getNode(doc, run.from), b = getNode(doc, run.to), delta = sub(b.position, a.position), old = length(delta)
  if (!old) throw new Error('A zero-length pipe has no routing direction.')
  const moving = new Set([b.id]), queue = [b.id]
  for (let i = 0; i < queue.length; i++)
    for (const edge of connected(doc, queue[i]).filter(r => r.id !== runId)) {
      const other = edge.from === queue[i] ? edge.to : edge.from
      if (other === a.id) throw new Error('This pipe is in a closed loop. Move its connections individually to change the loop.')
      if (!moving.has(other)) { moving.add(other); queue.push(other) }
    }
  const offset = mul(delta, (overall - old) / old)
  const shift = new Map<string, Vec3>([...moving].map(key => [key, offset]))
  const attached = doc.nodes.filter(n => n.associatedRunId && !moving.has(n.id))
  const same = (u?: Vec3, v?: Vec3) => !!u && !!v && u.every((x, i) => Math.abs(x - v[i]) < 1e-9)
  for (let changed = true; changed;) {
    changed = false
    for (const node of attached) {
      if (shift.has(node.id)) continue
      const host = doc.runs.find(r => r.id === node.associatedRunId)
      if (!host) continue
      const by = host.id === runId
        ? mul(offset, sub(node.position, a.position).reduce((sum, v, i) => sum + v * delta[i], 0) / (old * old))
        : same(shift.get(host.from), shift.get(host.to)) ? shift.get(host.from) : undefined
      if (!by) continue
      shift.set(node.id, by)
      changed = true
      // An olet takes the branch routed from it along, so the branch keeps its length and stays square to the header.
      const queue = [node.id]
      for (let i = 0; i < queue.length; i++)
        for (const edge of connected(doc, queue[i])) {
          const other = edge.from === queue[i] ? edge.to : edge.from
          if (other === a.id || other === host.from || other === host.to) throw new Error('A branch here joins back into its header. Move its connections individually to change the loop.')
          if (!shift.has(other)) { shift.set(other, by); queue.push(other) }
        }
    }
  }
  for (const node of doc.nodes) {
    const by = shift.get(node.id)
    if (by) node.position = add(node.position, by)
  }
}
/** Change the cut length. The centreline grows or shrinks by the same amount, keeping takeouts and root gaps. */
export function resizeRunToCut(doc: IsoDocument, runId: string, cut: number): void {
  const run = doc.runs.find(r => r.id === runId)
  if (!run || run.connector) throw new Error('Select a pipe to change its length.')
  if (!Number.isFinite(cut) || cut <= 0) throw new Error('Enter a positive cut length.')
  const result = runResult(doc, run)
  const extra = result.takeouts[0] + result.takeouts[1] + result.gaps[0] + result.gaps[1] - result.makeup[0] - result.makeup[1]
  if (!Number.isFinite(extra))
    throw new Error('Enter fitting takeouts before editing the cut length.')
  resizeRun(doc, runId, cut + extra)
}
/** A nipple pipe's catalogued length (mm, unknown without a catalogue entry) and its end finish. */
export function nippleOf(doc: IsoDocument, run: PipeRun): { length?: number; ends: string } | undefined {
  if (!run.nipple) return undefined
  return { length: run.nipple.length ?? nippleLength(getSpec(doc, run.specId), run.nps), ends: nippleEnds(pipePrepAt(doc, run, 0), pipePrepAt(doc, run, 1)) }
}
/** BOM text of a nipple pipe; the pipe's own text if it has one. */
export function nippleDescription(doc: IsoDocument, run: PipeRun): string {
  const n = nippleOf(doc, run)!
  return run.description?.toUpperCase() ?? nippleText(getSpec(doc, run.specId), run.nps, n.length ?? runResult(doc, run).cut, n.ends, doc)
}
/**
 * Make a pipe a nipple of its catalogued length (or `length`, mm). Where its fittings' takeouts are known the pipe is
 * resized so the nipple fits, moving the route beyond it.
 */
export function makeNipple(doc: IsoDocument, runId: string, length?: number): PipeRun {
  const run = doc.runs.find(r => r.id === runId)
  if (!run || run.connector) throw new Error('Select a pipe to make it a nipple.')
  if (length != null && !(length > 0)) throw new Error('Enter a positive nipple length.')
  run.nipple = length != null ? { length } : {}
  const want = nippleOf(doc, run)!.length, result = runResult(doc, run)
  const extra = result.takeouts[0] + result.takeouts[1] + result.gaps[0] + result.gaps[1]
  if (want && Number.isFinite(extra) && Math.abs(result.cut - want) > 0.01) resizeRun(doc, runId, want + extra)
  return run
}
/** Spreadsheet-style letters provide a stable A..Z, AA..AZ weld sequence. */
export function weldNumber(
  value: number,
  mode: IsoDocument['weldNumbering'] = 'numeric'
): string {
  if (mode !== 'alphabetic') return String(value)
  let text = ''
  while (value > 0) {
    value--
    text = String.fromCharCode(65 + (value % 26)) + text
    value = Math.floor(value / 26)
  }
  return text
}
/** Supports welded to the pipe; their attachment welds are listed with the spool's welds. */
export const WELDED_SUPPORTS = /^(SHOE|TRUNION|DUMY-LEG|BASESUPT)$/
/**
 * Every weld of the drawing, numbered. Linear in the size of the job (its lookups are indexed, see `withIndex`), and
 * worked out once per document state: a document read again unchanged returns the welds already found.
 */
export function welds(doc: IsoDocument): Weld[] {
  const signature = weldSignature(doc), known = weldCache.get(doc)
  if (known && known.signature === signature) return known.welds.map(w => ({ ...w, position: [...w.position] as Vec3 }))
  const found = withIndex(doc, () => findWelds(doc))
  weldCache.set(doc, { signature, welds: found.map(w => ({ ...w, position: [...w.position] as Vec3 })) })
  return found
}
const weldCache = new WeakMap<IsoDocument, { signature: string; welds: Weld[] }>()
/** Everything the welds depend on; a document changed in place gives a different signature, and is worked out anew. */
const weldSignature = (doc: IsoDocument) => JSON.stringify([doc.nodes, doc.runs, doc.specs, doc.units, doc.profile ?? null,
  doc.weldStart, doc.weldPrefix, doc.weldNumbering ?? null, doc.fieldFitMakeup ?? null])
function findWelds(doc: IsoDocument): Weld[] {
  const profile = profileOf(doc)
  let seq = doc.weldStart
  const out: Weld[] = [], weldNodes = new Set<string>(), linkWelded = new Set<string>()
  const unit = (from: Vec3, to: Vec3) => mul(sub(to, from), 1 / (length(sub(to, from)) || 1))
  const numbered = (w: Omit<Weld, 'tag'>, tag?: string) => {
    out.push({ ...w, tag: tag ?? `${doc.weldPrefix}${weldNumber(seq++, doc.weldNumbering)}` })
    weldNodes.add(w.nodeId)
    if (w.type !== 'BR' && w.type !== 'AT' && w.type !== 'RP') linkWelded.add(w.runId)
  }
  // Branch outlets, reinforcing pads and welded supports are welded to the pipe they sit on.
  const attached = (r: PipeRun, from: Vec3) => attachedTo(doc, r.id)
    .filter(n => n.kind === 'olet' || (n.kind === 'support' && WELDED_SUPPORTS.test(n.component ?? fitting(doc, n)?.component ?? '')))
    .sort((a, b) => distance(a.position, from) - distance(b.position, from))
  // A weld joining two spools is made at erection, unless the project joins its spools in the shop.
  const spoolBreak = (n: PipeNode, r: PipeRun) => profile.spoolBreakWelds === 'field' && spansSpools(doc, n) &&
    (n.kind === 'weld' || r.spool !== breakOwner(doc, n))
  // Numbered in sequence along each spool, from an open end, in the order a fitter meets them.
  const met = new Set<string>()
  let last = '', spool: string | undefined
  for (const r of [...new Set(doc.runs.map(r => r.spool))].flatMap(spool => routeOrder(doc, doc.runs.filter(r => r.spool === spool)))) {
    // Each spool may start its own sequence.
    if (profile.weldSequence === 'spool' && r.spool !== spool) seq = doc.weldStart
    spool = r.spool
    // A pipe continues the walk from where the last one ended; a new walk starts at an open end.
    const open = (id: string) => getNode(doc, id).kind !== 'weld' && connected(doc, id).filter(x => x.spool === r.spool).length === 1
    const reversed = r.to === last || (r.from !== last && (open(r.to) !== open(r.from) ? open(r.to) : met.has(r.to) && !met.has(r.from)))
    last = reversed ? r.from : r.to
    met.add(r.from).add(r.to)
    if (boltedConnector(doc, r) || stubInFlange(doc, r) || isReturnBody(doc, r)) continue
    for (const [step, index] of (reversed ? [1, 0] : [0, 1]).entries()) {
      // Along the pipe, between its end welds, come the welds of whatever is attached to it.
      if (step === 1)
        for (const n of attached(r, getNode(doc, reversed ? r.to : r.from).position)) {
          if (n.kind === 'support') { numbered({ runId: r.id, nodeId: n.id, nps: r.nps, field: !!n.field, prep: 'AT', type: 'AT', position: n.position }); continue }
          const item = fitting(doc, n), pad = (n.component ?? item?.component) === 'REPAD', branch = connected(doc, n.id)[0]
          const od = getSpec(doc, r.specId).sizes.find(s => s.nps === r.nps)?.od ?? pipeOd(r.nps) ?? 0
          const far = branch && getNode(doc, branch.from === n.id ? branch.to : branch.from).position
          numbered({
            runId: branch?.id ?? r.id, nodeId: n.id, nps: branch?.nps ?? item?.smallerNps ?? item?.nps ?? r.nps, field: !!n.field,
            prep: pad ? 'RP' : 'BR', type: pad ? 'RP' : 'BR', position: far && !pad ? add(n.position, mul(unit(n.position, far), od / 2)) : n.position
          })
        }
      const key = index === 0 ? r.from : r.to
      const n = getNode(doc, key), prep = pipePrepAt(doc, r, index)
      const ownFit = !!(index === 0 ? r.fromFieldFit : r.toFieldFit), ownTag = index === 0 ? r.fromTag : r.toTag
      // A bend formed in the pipe is no joint; neither is a flanged or threaded end.
      if (isFormedBend(doc, n) || prep === 'FL' || prep === 'THD') continue
      if (['end', 'support', 'annotation', 'gasket', 'bolt'].includes(n.kind)) {
        // A field-fit end at an open end is a weld made on site to the pipe or equipment beyond this drawing.
        if (n.kind === 'end' && ownFit && !r.connector && (prep === 'BW' || prep === 'SW'))
          numbered({ runId: r.id, nodeId: n.id, nps: r.nps, field: true, fieldFit: true, prep, type: prep === 'SW' ? 'SW' : 'BW', position: n.position }, ownTag)
        continue
      }
      const t = takeout(doc, n, r.id) ?? 0
      const other = getNode(doc, index === 0 ? r.to : r.from)
      const field = (index === 0 ? r.fromField : r.toField) ?? (n.field ?? spoolBreak(n, r))
      if (prep === 'PLAIN') {
        // A slip-on flange is fillet welded at its bore and at the back of its hub.
        const so = r.connector ? undefined : slipOn(doc, n, r)
        if (!so) continue
        const u = unit(n.position, other.position), end = add(n.position, mul(u, t))
        for (const at of [end, add(end, mul(u, Math.max(0, so.hub - so.setBack)))])
          numbered({ runId: r.id, nodeId: n.id, nps: r.nps, field, prep: 'SO', type: 'SO', position: at })
        continue
      }
      // Two socket-weld pipes cannot be welded to each other; the joint needs a coupling.
      if (n.kind === 'weld' && prep === 'SW') continue
      // A zero-length butt joint represented as a WELD node gets one weld, not two.
      if (n.kind === 'weld' && weldNodes.has(n.id)) continue
      // Two fittings welded face to face are one weld, in their shared root gap.
      if (r.connector && linkWelded.has(r.id)) continue
      const vector = sub(other.position, n.position), gap = runResult(doc, r).gaps[index]
      const position =
        n.kind === 'weld'
          ? n.position
          : add(n.position, mul(vector, (t + (prep !== 'BW' ? 0 : r.connector ? gap : gap / 2)) / (length(vector) || 1)))
      const jointEnds = n.kind === 'weld' ? connected(doc, n.id).map(edge => ({
        tag: edge.from === n.id ? edge.fromTag : edge.toTag,
        field: edge.from === n.id ? edge.fromField : edge.toField,
        fit: edge.from === n.id ? edge.fromFieldFit : edge.toFieldFit
      })) : []
      const fieldFit = ownFit || jointEnds.some(end => end.fit)
      const explicit = jointEnds.map(end => end.field).filter(v => v != null)
      const jointField = explicit.length ? explicit.some(Boolean) : field
      const tag = ownTag ?? jointEnds.find(end => end.tag)?.tag ?? (n.kind === 'weld' ? n.tag : undefined)
      numbered({
        runId: r.id, nodeId: n.id, nps: r.nps, field: fieldFit || (n.kind === 'weld' ? jointField : field), prep, type: prep === 'SW' ? 'SW' : 'BW', position,
        ...(fieldFit ? { fieldFit } : {})
      }, tag)
    }
  }
  return out
}
/** Weld size in diameter-inches: its nominal size (a branch weld, its branch size). */
export const weldDiameterInches = (w: Weld) => w.nps
/** Labour for a weld: diameter-inches times the specification's hours per diameter-inch. */
export function weldHours(doc: IsoDocument, w: Weld): number {
  const run = runById(doc, w.runId)
  return run ? weldDiameterInches(w) * getSpec(doc, run.specId).weldHoursPerDiameterInch : 0
}
/** The slip-on flange a pipe end is set into: a slip-on flange node, or the slip-on mate of a flanged component. */
function slipOn(doc: IsoDocument, n: PipeNode, run: PipeRun): { setBack: number; hub: number } | undefined {
  const own = nodeItem(doc, n), code = n.component ?? own?.component ?? ''
  const port = COMPONENT_TYPES.find(t => t.code === code)?.endPrep === 'FL'
  const mate = port ? matingFlange(doc, n, run) : n.kind === 'flange' ? { code, item: own } : null
  if (!mate || !/SO$/.test(mate.code)) return undefined
  const setBack = mate.item?.takeout ?? 0
  return { setBack, hub: mate.item?.lengthThroughHub ?? flange(run.nps, mate.item?.rating ?? specRating(getSpec(doc, run.specId)))?.soLength ?? setBack }
}
/**
 * A pipe piece shorter than the shop cuts, or whose end welds come closer than the specification allows: a butt-welded
 * piece by its cut, a socket-welded one by the pipe showing between the sockets.
 */
function shortPiece(doc: IsoDocument, r: PipeRun, result: RunResult): string | undefined {
  const spec = getSpec(doc, r.specId), minPipe = spec.minPipeLength ?? 50, minWelds = spec.minWeldSpacing ?? 50
  // Tangents between formed bends belong to one piece; the piece as a whole is checked.
  if ([r.from, r.to].some(id => isFormedBend(doc, getNode(doc, id)))) return undefined
  const length = (mm: number) => formatLength(mm, doc.units)
  if (result.cut < minPipe - 0.01)
    return `${r.spool}: a ${r.nps}″ pipe is cut to ${length(result.cut)}, shorter than the ${length(minPipe)} shortest piece allowed. Move the fittings apart, or join them without pipe.`
  const ends = [getNode(doc, r.from), getNode(doc, r.to)], preps = [0, 1].map(i => pipePrepAt(doc, r, i))
  if (ends.some(n => ['end', 'support', 'annotation', 'gasket', 'bolt'].includes(n.kind) || isFormedBend(doc, n)) || !preps.every(p => p === 'BW' || p === 'SW')) return undefined
  const clear = weldClearance(doc, r, result)
  if (clear < minWelds - 0.01)
    return `${r.spool}: the welds at the ends of a ${r.nps}″ pipe are ${length(clear)} apart, closer than the ${length(minWelds)} allowed. Move the fittings apart.`
  return undefined
}
/** Clear pipe between a piece's end welds: its cut, or for socket welds the pipe showing between the sockets. */
export function weldClearance(doc: IsoDocument, r: PipeRun, result = runResult(doc, r)): number {
  const ends = [getNode(doc, r.from), getNode(doc, r.to)], preps = [0, 1].map(i => pipePrepAt(doc, r, i))
  return result.cut - ends.reduce((sum, n, i) => sum + (preps[i] === 'SW' && n.kind !== 'weld' ? (nodeItem(doc, n)?.socketDepth ?? 0) - result.gaps[i] : 0), 0)
}
/** Recommended least weld spacing without a specification value: the pipe's outside diameter, at least 50 mm. */
export const recommendedWeldSpacing = (doc: IsoDocument, r: PipeRun) => Math.max(50, outsideDiameter(doc, r) ?? 0)
/** A weld on a pipe: where it lies along the pipe from its `from` work point (mm), and what it joins. */
export interface WeldAlong { from: number; to: number; kind: 'end' | 'branch' | 'attachment'; nodeId: string }
/**
 * The welds along one pipe, in order: its end welds (at the pipe end, or a socket's face, as `weldClearance` measures),
 * the branch welds of the outlets on it (across the branch pipe's outside diameter) and the attachment welds of the
 * supports welded to it.
 */
export function weldsAlong(doc: IsoDocument, r: PipeRun, result = runResult(doc, r)): WeldAlong[] {
  if (r.connector) return []
  const a = getNode(doc, r.from), b = getNode(doc, r.to), axis = sub(b.position, a.position), span = length(axis)
  if (!span) return []
  const out: WeldAlong[] = []
  for (const [i, n] of [a, b].entries()) {
    const prep = pipePrepAt(doc, r, i)
    if (['end', 'support', 'annotation', 'gasket', 'bolt'].includes(n.kind) || isFormedBend(doc, n) || !(prep === 'BW' || prep === 'SW')) continue
    const socket = prep === 'SW' && n.kind !== 'weld' ? (nodeItem(doc, n)?.socketDepth ?? 0) - result.gaps[i] : 0
    const at = i === 0 ? result.takeouts[0] + result.gaps[0] + socket : result.overall - result.takeouts[1] - result.gaps[1] - socket
    if (Number.isFinite(at)) out.push({ from: at, to: at, kind: 'end', nodeId: n.id })
  }
  for (const n of attachedTo(doc, r.id)) {
    const along = sub(n.position, a.position).reduce((sum, v, k) => sum + v * axis[k], 0) / span
    if (n.kind === 'olet') {
      const branch = connected(doc, n.id)[0], item = fitting(doc, n)
      const od = branch ? outsideDiameter(doc, branch) : pipeOd(item?.smallerNps ?? item?.nps ?? 0)
      const half = (od ?? 0) / 2
      out.push({ from: along - half, to: along + half, kind: 'branch', nodeId: n.id })
    } else if (n.kind === 'support' && WELDED_SUPPORTS.test(n.component ?? fitting(doc, n)?.component ?? ''))
      out.push({ from: along, to: along, kind: 'attachment', nodeId: n.id })
  }
  return out.sort((x, y) => x.from - y.from)
}
/** A support is material when it says so, or when the specification supplies it as a row (welded shoes, guides). */
export const supportListed = (doc: IsoDocument, n: PipeNode) => n.inBom ?? !!fitting(doc, n)
/** Plain-language name of a node for fabrication checks, e.g. "flanged ball valve HV-101". */
export function itemName(doc: IsoDocument, n: PipeNode): string {
  const type = COMPONENT_TYPES.find(t => t.code === (n.component ?? fitting(doc, n)?.component))
  const name = n.bendAngle ? `${round(n.bendAngle)}° bend` : type?.label ?? ({ end: 'pipe end', weld: 'butt weld', elbow90: '90° elbow', elbow45: '45° elbow' } as Record<string, string>)[n.kind] ?? n.kind
  return name.charAt(0).toLowerCase() + name.slice(1) + (n.tag ? ' ' + n.tag : '')
}
/** How far (mm) two fittings welded face to face may stand from one root gap apart: 1/32″. */
export const CLOSE_COUPLED_TOLERANCE = 0.8
export function validateIso(doc: IsoDocument): string[] {
  return withIndex(doc, () => validate(doc))
}
function validate(doc: IsoDocument): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  const where = (n: PipeNode) => {
    const edge = connected(doc, n.id)[0] ?? runById(doc, n.associatedRunId)
    return edge?.spool ? edge.spool + ': ' : ''
  }
  for (const n of doc.nodes) {
    if (seen.has(n.id)) issues.push('Two connection points share one ID. Re-open the file from a saved copy.')
    seen.add(n.id)
    if (n.position.some(v => !Number.isFinite(v)))
      issues.push(`${where(n)}a connection point has no valid position.`)
  }
  for (const r of doc.runs) {
    try {
      const result = runResult(doc, r),
        spec = getSpec(doc, r.specId)
      if (!spec.sizes.some(s => s.nps === r.nps))
        issues.push(`${r.spool}: ${r.nps}″ pipe is not in specification ${spec.name}. Choose a specification with this size.`)
      const ends = [getNode(doc, r.from), getNode(doc, r.to)], bent = ends.some(n => isFormedBend(doc, n))
      if (isReturnBody(doc, r)) {
        if (Number.isFinite(result.cut) && Math.abs(result.cut) > CLOSE_COUPLED_TOLERANCE)
          issues.push(`${r.spool}: the halves of a ${r.nps}″ 180° return stand ${formatLength(result.overall, doc.units)} apart, but the return is ${formatLength(result.overall - result.cut, doc.units)} centre to centre. Move one half onto the other's end.`)
        continue
      }
      if (!Number.isFinite(result.cut)) {
        for (const node of ends) {
          if (takeout(doc, node, r.id) != null) continue
          issues.push(isFormedBend(doc, node)
            ? `${r.spool}: the ${itemName(doc, node)} (${r.nps}″) has no bend radius, so its tangents and the pipe to form it are unknown. Enter its bend radius.`
            : `${r.spool}: the ${itemName(doc, node)} (${r.nps}″) has no standard size and no length in the specification, so the pipe cannot be cut to fit. Enter its centre-to-end length.`)
        }
      }
      else if (!r.connector && (bent ? result.cut < -0.01 : result.cut <= 0))
        issues.push(bent
          ? `${r.spool}: the bends on a ${r.nps}″ pipe overlap by ${formatLength(-result.cut, doc.units)}: their tangents need more straight pipe. Move them apart or reduce a bend radius.`
          : `${r.spool}: a ${r.nps}″ pipe is ${formatLength(result.cut, doc.units)} after fitting allowances, so the fittings at its ends overlap. Move them apart or lengthen the pipe.`
        )
      // Only butt-welded faces are welded face to face: threaded and socket ends overlap by their engagement, and a
      // lap-joint flange sits loose on its stub end.
      else if (r.connector && !boltedConnector(doc, r) && !stubInFlange(doc, r) && [0, 1].every(i => pipePrepAt(doc, r, i) === 'BW') &&
        ends.every(n => !['end', 'support', 'annotation', 'gasket', 'bolt'].includes(n.kind)) && Math.abs(result.cut) > CLOSE_COUPLED_TOLERANCE) {
        const gap = result.gaps[0] + result.gaps[1]
        issues.push(`${r.spool}: the ${itemName(doc, ends[0])} and the ${itemName(doc, ends[1])} are welded face to face, so their faces must stand ${formatLength(gap, doc.units)} apart (the root gap), but they are ${formatLength(gap + result.cut, doc.units)} apart. Move one so the gap is ${formatLength(gap, doc.units)}.`)
      }
      else if (!r.connector && !r.nipple && !r.uncut) {
        const short = shortPiece(doc, r, result)
        if (short) issues.push(short)
      }
      if (boltedDirect(doc, getNode(doc, r.from), r) && Math.abs(result.cut) > 1)
        issues.push(`${r.spool}: the ${itemName(doc, getNode(doc, r.from))} and the ${itemName(doc, getNode(doc, r.to))} are bolted face to face but stand ${formatLength(result.cut, doc.units)} ${result.cut > 0 ? 'apart' : 'into each other'}. Move one onto the other's face.`)
      const nipple = nippleOf(doc, r)
      if (nipple?.length && result.cut > 0 && Math.abs(result.cut - nipple.length) > 0.8)
        issues.push(`${r.spool}: a ${r.nps}″ nipple is ${formatLength(nipple.length, doc.units)} long, but its fittings leave ${formatLength(result.cut, doc.units)} for it. Move them, or set the nipple's length.`)
      if (!r.spool.trim()) issues.push('A pipe has no spool number. Select it and enter one.')
    } catch (e) {
      issues.push(e instanceof Error ? e.message : String(e))
    }
  }
  for (const n of doc.nodes) {
    const degree = connected(doc, n.id).length
    const item = fitting(doc, n), resolved = nodeItem(doc, n)
    const component = COMPONENT_TYPES.find(t => t.code === (n.component ?? item?.component))
    const ports = component?.ports ?? (n.kind === 'tee' ? 3 : ['valve', 'reducer', 'elbow90', 'elbow45', 'weld'].includes(n.kind) ? 2 : n.kind === 'cap' ? 1 : undefined)
    const name = itemName(doc, n), at = where(n)
    // A standard part (std:CODE:SIZE, chosen where the specification has no row) is sized from its pipes, not a row.
    if (n.catalogId && !item && !n.catalogId.startsWith('std:')) issues.push(`${at}the ${name} refers to a specification row that no longer exists. Choose the component again.`)
    if (n.kind === 'tee' && degree === 3 && !n.branchEdgeId)
      issues.push(`${at}three pipes meet without a straight run through the junction. A tee needs two pipes in line with the branch square to them (45° for a lateral).`)
    else if (n.kind === 'tee' && degree === 2)
      issues.push(`${at}the ${name} has no branch pipe. Draw the branch from it, or choose a different component.`)
    else if (ports && degree !== ports && !(n.kind === 'flange' && degree === 1) && !n.associatedRunId)
      issues.push(`${at}the ${name} needs ${ports} connected pipe${ports === 1 ? '' : 's'} but has ${degree}.`)
    if (n.kind === 'end' && degree > 1)
      issues.push(`${at}pipes meet at a point with no fitting. Select the point and choose a fitting.`)
    const edges = connected(doc, n.id)
    if (resolved && resolved.socketDepth == null && resolved.threadEngagement == null && !resolved.takeoutToPipeEnd &&
      edges.some(r => ['SW', 'THD'].includes(prepAtNode(r, n.id)) && n.takeout == null && n.portTakeouts?.[r.id] == null))
      issues.push(`${at}the ${name} has no socket depth or thread length in the specification, so it is not known how far the pipe goes into it. Enter the distance from ${n.kind === 'olet' ? 'the header centre' : 'its centre'} to the pipe end.`)
    if (item && edges.length) {
      // An olet sits on its header; only its branch pipe connects to it.
      const sizes = [...new Set(edges.map(r => r.nps))].sort((a, b) => b - a)
      const expected = n.kind === 'olet' ? [item.smallerNps ?? item.nps] : [...new Set([item.nps, item.smallerNps ?? item.nps])].sort((a, b) => b - a)
      if (sizes.length !== expected.length || sizes.some((size, i) => size !== expected[i]))
        issues.push(`${at}the ${name} is ${expected.join('″ × ')}″ but the pipes are ${sizes.join('″ and ')}″. Choose the matching size.`)
      if (edges.some(r => !getSpec(doc, r.specId).fittings.some(f => f.id === item.id)))
        issues.push(`${at}the ${name} is not in the pipe's specification. Choose it from the pipe's specification.`)
    } else if (['elbow90', 'elbow45', 'weld'].includes(n.kind) && new Set(edges.map(r => r.nps)).size > 1)
      issues.push(`${at}pipes of different sizes are joined without a reducer. Insert a reducer or reducing fitting.`)
    if (n.kind === 'weld' && degree === 2) {
      const tags = edges.map(r => r.from === n.id ? r.fromTag : r.toTag).filter(Boolean)
      if (new Set(tags).size > 1) issues.push(`${at}one butt weld has two different weld numbers. Keep one.`)
      if (prepAtNode(edges[0], n.id) !== prepAtNode(edges[1], n.id))
        issues.push(`${at}the two pipe ends at one butt weld have different end preparations.`)
      else if (['SW', 'THD'].includes(prepAtNode(edges[0], n.id)) && !edges.some(r => r.connector))
        issues.push(`${at}two ${prepAtNode(edges[0], n.id) === 'SW' ? 'socket-weld' : 'threaded'} pipes meet end to end with nothing joining them. Insert a coupling, or draw them as one pipe.`)
      if ((edges[0].rootGap ?? getSpec(doc, edges[0].specId).rootGap) !== (edges[1].rootGap ?? getSpec(doc, edges[1].specId).rootGap))
        issues.push(`${at}the two pipe ends at one butt weld have different root gaps.`)
    }
    const angleBetween = (a: PipeRun, b: PipeRun) => {
      // Across an eccentric reducer the small pipe's centreline is offset to the flat; the pipes are still in line.
      const vector = (r: PipeRun) => sub(portPoint(doc, getNode(doc, r.from === n.id ? r.to : r.from), r.id), portPoint(doc, n, r.id))
      const u = vector(a),
        v = vector(b),
        denominator = length(u) * length(v)
      return denominator
        ? Math.acos(Math.max(-1, Math.min(1, u.reduce((sum, value, i) => sum + value * v[i], 0) / denominator))) * 180 / Math.PI
        : NaN
    }
    const formed = isFormedBend(doc, n)
    if (formed && degree === 2) {
      const bend = 180 - angleBetween(edges[0], edges[1])
      // Its pipes already report the missing radius when it leaves their cuts unknown; said once.
      if (!(n.bendRadius! > 0)) { if (edges.every(r => takeout(doc, n, r.id) != null)) issues.push(`${at}the ${name} has no bend radius. Enter the centreline radius it is formed to.`) }
      else if (!(bend > 0.1 && bend < 179.9)) issues.push(`${at}the ${name} does not change direction. Remove it, or route the pipes at an angle.`)
    } else if ((n.kind === 'elbow90' || n.kind === 'elbow45') && degree === 2) {
      const bend = 180 - angleBetween(edges[0], edges[1]),
        expected = n.bendAngle ?? (n.kind === 'elbow90' ? 90 : 45)
      if (!Number.isFinite(bend) || Math.abs(bend - expected) > 1)
        issues.push(`${at}the ${name} turns ${Number.isFinite(bend) ? round(bend) + '°' : 'an unknown angle'} but is a ${expected}° fitting. Choose a fitting for this angle.`)
    }
    if (component?.angle && degree === 2 && Math.abs(angleBetween(edges[0], edges[1]) - 90) > 1)
      issues.push(`${at}the ${name} is an angle body. Its pipes must leave it square to each other.`)
    else if (
      !component?.angle &&
      ['valve', 'reducer', 'weld', 'flange', 'gasket'].includes(n.kind) &&
      degree === 2 &&
      Math.abs(angleBetween(edges[0], edges[1]) - 180) > 1
    )
      issues.push(`${at}the ${name} sits at a change of direction. In-line components must be on a straight pipe.`)
    if (/^CHECK/.test(component?.code ?? '') && edges.length && !edges.some(r => r.flow))
      issues.push(`${at}the ${name} has no flow direction. Set the flow on its pipes so it is drawn and installed the right way round.`)
    if (n.kind === 'tee' && degree === 3 && n.branchEdgeId) {
      const main = edges.filter(r => r.id !== n.branchEdgeId),
        branch = edges.find(r => r.id === n.branchEdgeId)
      const expected = /LAT$/.test(component?.code ?? '') ? 45 : 90
      if (
        !branch || main.length !== 2 ||
        Math.abs(angleBetween(main[0], main[1]) - 180) > 1 ||
        Math.abs(Math.min(angleBetween(main[0], branch), angleBetween(main[1], branch)) - expected) > 1
      )
        issues.push(`${at}the ${name} branch must leave the run at ${expected}°.`)
      if (branch && item && (branch.nps !== (item.smallerNps ?? item.nps) || main.some(r => r.nps !== item.nps)))
        issues.push(`${at}the ${name} sizes do not match its run and branch pipes. Choose the matching size.`)
    }
    if (n.kind === 'tee' && degree === 4) {
      const opposite = edges.slice(1).find(r => Math.abs(angleBetween(edges[0], r) - 180) < 1)
      const other = edges.filter(r => r !== edges[0] && r !== opposite)
      if (!opposite || other.length !== 2 || Math.abs(angleBetween(other[0], other[1]) - 180) > 1 || Math.abs(angleBetween(edges[0], other[0]) - 90) > 1)
        issues.push(`${at}the cross needs two straight runs crossing square.`)
    }
    if (
      n.kind === 'reducer' &&
      degree === 2 &&
      connected(doc, n.id)[0].nps === connected(doc, n.id)[1].nps
    )
      issues.push(`${at}the ${name} joins two pipes of the same size. Change one pipe size or remove the reducer.`)
    const eccentric = isEccentric(component?.code)
    if (n.flatSide && !eccentric) issues.push(`${at}the ${name} is given a flat side, but only an eccentric reducer has one. Clear it.`)
    else if (eccentric && degree === 2) {
      const axis = sub(getNode(doc, edges[0].from === n.id ? edges[0].to : edges[0].from).position, n.position), l = length(axis) || 1
      if (!n.flatSide) issues.push(`${at}the ${name} has no flat side. Choose flat on top (FOT) or flat on bottom (FOB), or on a riser the side the flat faces.`)
      else if (Math.abs(axis.reduce((s, v, i) => s + v * FLAT_DIRECTION[n.flatSide!][i], 0)) / l > 0.1)
        issues.push(`${at}the ${name} cannot have its flat on the ${n.flatSide}: that is along the pipe. Choose a side across the pipe.`)
    }
  }
  for (const joint of flangedJoints(doc))
    if (joint.boltsUnknown)
      issues.push(`${joint.spool}: no standard bolting for a ${joint.nps}″ class ${joint.rating} flanged joint. Add a bolt row for this size to the specification.`)
  // Weld numbers are unique on the drawing, or on each spool when every spool has its own sequence.
  const perSpool = profileOf(doc).weldSequence === 'spool'
  const tags = welds(doc).map(w => (perSpool ? runById(doc, w.runId)?.spool + '\u0000' : '') + w.tag)
  if (new Set(tags).size !== tags.length)
    issues.push('Two welds share a weld number. Renumber one of them.')
  // Material checks need a drawing whose pipes resolve; the faults above are reported first.
  try { issues.push(...materialErrors(doc)) } catch (e) { issues.push(e instanceof Error ? e.message : String(e)) }
  return [...new Set(issues)]
}
/**
 * The material take-off: the sheets' bills of materials (one engine, `sheetMaterials`) with heat lots kept apart and
 * quantities in model units (pipe in metres of cut pipe, everything else each), grouped by spool, line or drawing.
 * `item` numbers the take-off rows; `materialKey` is the purchased identity, stable across drawings.
 */
export function bom(
  doc: IsoDocument,
  group: 'spool' | 'line' | 'global' = 'spool'
): BomRow[] {
  return materialTakeoff(doc, group)
}
/** Display units only; quantities, mass, area and costing in the model remain SI. */
export function displayBom(row: BomRow, units: IsoDocument['units']) {
  const imperial = units === 'imperial'
  return {
    quantity: row.qty / (imperial && row.unit === 'm' ? 0.3048 : 1),
    unit: imperial && row.unit === 'm' ? 'ft' : row.unit,
    weight: row.weightKg == null ? null : row.weightKg / (imperial ? 0.45359237 : 1),
    area: row.areaM2 == null ? null : row.areaM2 / (imperial ? 0.09290304 : 1),
  }
}
/**
 * Largest .piping file read, in characters. Sized for the model plus its title block: two logos of up to 2.1 MB each
 * as data URLs (the title-block limit) leave about 3.8 MB for the drawing itself, tens of thousands of parts.
 */
export const PIPING_MAX_CHARS = 8_000_000
/** The .piping format this release writes. Older formats are migrated on reading; newer ones are refused clearly. */
export const PIPING_FORMAT_VERSION = 1
/** Migrations from each older format to the next: `PIPING_MIGRATIONS[n]` turns format n into n + 1. */
export const PIPING_MIGRATIONS: Record<number, (d: Record<string, unknown>) => void> = {}
/** Bring a stored drawing up to the current format, or say why it cannot be. */
function migratePiping(d: Record<string, unknown>): void {
  if (d?.schema !== 'bidwright-piping' || typeof d.version !== 'number' || !Number.isInteger(d.version)) return
  if (d.version > PIPING_FORMAT_VERSION)
    throw new Error(`This drawing was saved by a newer version of Spoolyard (file format ${d.version}; this version reads up to format ${PIPING_FORMAT_VERSION}). Update Spoolyard to open it.`)
  for (let v = d.version; v < PIPING_FORMAT_VERSION; v++) {
    const step = PIPING_MIGRATIONS[v]
    if (!step) throw new Error(`Spoolyard cannot read file format ${d.version} drawings.`)
    step(d)
    d.version = v + 1
  }
}
/** Read and validate a .piping document; a validation error names the part it is about, e.g. "nodes[12]". */
export function parseIsoJson(raw: string): IsoDocument {
  const where = { at: '' }
  try {
    return readPiping(raw, where)
  } catch (e) {
    if (!where.at || !(e instanceof Error)) throw e
    throw new Error(`${e.message.replace(/\.$/, '')} at ${where.at}.`)
  }
}
function readPiping(raw: string, where: { at: string }): IsoDocument {
  if (raw.length > PIPING_MAX_CHARS)
    throw new Error(`Piping file exceeds the ${PIPING_MAX_CHARS / 1e6} MB limit.`)
  let d: IsoDocument
  try {
    d = JSON.parse(raw) as IsoDocument
  } catch {
    throw new Error('This piping file is not valid JSON; it may be truncated or damaged.')
  }
  migratePiping(d as unknown as Record<string, unknown>)
  const isString = (v: unknown, max = 1000): v is string =>
    typeof v === 'string' && v.length <= max
  const positive = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0
  const nonnegative = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0
  const finite = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e10
  const isPlain = (v: unknown): v is Record<string, any> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  const optionalNumbers = (o: object, keys: string[]) =>
    keys.every(k => {
      const v = (o as Record<string, unknown>)[k]
      return v == null || nonnegative(v)
    })
  const knownKinds = [
    'end',
    'elbow90',
    'elbow45',
    'tee',
    'flange',
    'valve',
    'reducer',
    'cap',
    'support',
    'weld',
    'olet',
    'gasket',
    'bolt',
    'annotation'
  ]
  if (
    d?.schema !== 'bidwright-piping' ||
    d.version !== 1 ||
    !Array.isArray(d.nodes) ||
    !Array.isArray(d.runs) ||
    !Array.isArray(d.specs) ||
    !d.specs.length ||
    d.nodes.length > 10000 ||
    d.runs.length > 10000 ||
    d.specs.length > 100
  )
    throw new Error('Unsupported piping document.')
  for (const k of [
    'title',
    'drawing',
    'revision',
    'customer',
    'project',
    'drawnBy',
    'checkedBy',
    'weldPrefix'
  ])
    if (!isString(d[k as keyof IsoDocument])) throw new Error(`Invalid ${k}.`)
  if (
    !isString(d.notes, 12000) ||
    !['mm', 'imperial'].includes(d.units) ||
    !['overall', 'cut', 'both'].includes(d.dimensionMode) ||
    !finite(d.north) ||
    !Number.isInteger(d.weldStart) ||
    (d.fieldFitMakeup != null && !nonnegative(d.fieldFitMakeup)) ||
    d.weldStart < 1 ||
    (d.weldNumbering != null &&
      !['numeric', 'alphabetic'].includes(d.weldNumbering))
  )
    throw new Error('Invalid drawing settings.')
  const badProfile = profileError(d.profile)
  if (badProfile) throw new Error(badProfile)
  if (
    d.grid != null &&
    (typeof d.grid.visible !== 'boolean' ||
      typeof d.grid.snap !== 'boolean' ||
      !positive(d.grid.spacing) ||
      d.grid.spacing > 1e7 ||
      !['xy', 'xz', 'yz'].includes(d.grid.plane) ||
      (d.grid.origin != null && !(Array.isArray(d.grid.origin) && d.grid.origin.length === 3 && d.grid.origin.every(v => typeof v === 'number' && Number.isFinite(v)))))
  )
    throw new Error('Invalid isometric grid settings.')
  if(d.sheetFormat!=null&&!['classic','production'].includes(d.sheetFormat))throw new Error('Invalid sheet format.')
  if (typeof d.sheetTemplate === 'string') { if (!Object.hasOwn(BUILTIN_TEMPLATES, d.sheetTemplate)) throw new Error('Unknown sheet template.') }
  else if (d.sheetTemplate != null) validateSheetTemplate(d.sheetTemplate)
  if (d.paper != null && !['letter', 'tabloid', 'a3', 'a4'].includes(d.paper))
    throw new Error('Invalid PDF paper size.')
  if (
    d.outputViews != null &&
    (!Array.isArray(d.outputViews) ||
      !d.outputViews.length ||
      d.outputViews.length > 4 ||
      new Set(d.outputViews).size !== d.outputViews.length ||
      !d.outputViews.every(v => ['iso', 'plan', 'front', 'side'].includes(v)))
  )
    throw new Error('Invalid PDF views.')
  const ids = new Set<string>()
  for (const [index, n] of d.nodes.entries()) {
    where.at = `nodes[${index}]${typeof n?.id === 'string' ? ` (id ${n.id.slice(0, 40)})` : ''}`
    if (
      !isString(n.id) ||
      !n.id ||
      ids.has(n.id) ||
      !knownKinds.includes(n.kind) ||
      !Array.isArray(n.position) ||
      n.position.length !== 3 ||
      !n.position.every(finite) ||
      !optionalNumbers(n, [
        'takeout',
        'branchTakeout',
        'weightKg',
        'areaM2',
        'unitCost',
        'laborHours',
        'quantity',
        'bendAngle',
        'bendRadius'
      ])
    )
      throw new Error('Invalid piping connection.')
    ids.add(n.id)
    for (const k of [
      'catalogId',
      'component',
      'description',
      'branchEdgeId',
      'heat',
      'tag',
      'associatedRunId'
    ])
      if (n[k as keyof PipeNode] != null && !isString(n[k as keyof PipeNode]))
        throw new Error('Invalid component attributes.')
    if (n.field != null && typeof n.field !== 'boolean')
      throw new Error('Invalid weld location.')
    if (
      n.labelOffset &&
      (!Array.isArray(n.labelOffset) ||
        n.labelOffset.length !== 2 ||
        !n.labelOffset.every(finite))
    )
      throw new Error('Invalid annotation offset.')
    if (
      n.portTakeouts &&
      (typeof n.portTakeouts !== 'object' ||
        Object.values(n.portTakeouts).some(v => !nonnegative(v)))
    )
      throw new Error('Invalid port takeout.')
    if (
      (n.continuation != null && (!isPlain(n.continuation) || !isString(n.continuation.text, 600) ||
        (n.continuation.paperPath!=null && (!Array.isArray(n.continuation.paperPath) || n.continuation.paperPath.length<2 || n.continuation.paperPath.length>500 || !n.continuation.paperPath.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite)))) ||
        (n.continuation.leaderAt!=null && !['node','end'].includes(n.continuation.leaderAt)) ||
        (n.continuation.endMarker!=null && !['tube','break','plain'].includes(n.continuation.endMarker)) ||
        (n.continuation.termination!=null && !['continues','open','closed'].includes(n.continuation.termination)) ||
        (n.continuation.coordinates != null && typeof n.continuation.coordinates !== 'boolean') ||
        (n.continuation.coordinateFace != null && !['flange', 'mate'].includes(n.continuation.coordinateFace)))) ||
      (n.elevationCallout != null && typeof n.elevationCallout !== 'boolean') ||
      (n.equipmentShape != null && !['vessel','pump'].includes(n.equipmentShape)) ||
      (n.showSize != null && typeof n.showSize!=='boolean') ||
      (n.sizeLabelFormat != null && !['standard','compact'].includes(n.sizeLabelFormat)) ||
      (n.dimensioned != null && typeof n.dimensioned !== 'boolean') ||
      (n.dimensionChain != null && !['both', 'body', 'mate'].includes(n.dimensionChain)) ||
      (n.approximate != null && typeof n.approximate !== 'boolean') ||
      (n.inBom != null && typeof n.inBom !== 'boolean') ||
      (n.tiePoint != null && (!isPlain(n.tiePoint) || !isString(n.tiePoint.id, 40) ||
        (n.tiePoint.label != null && !isString(n.tiePoint.label, 120)))) ||
      (n.operator != null && !isString(n.operator, 120)) ||
      (n.calloutOrder != null && !['item-first', 'tag-first', 'item-tag-first'].includes(n.calloutOrder)) ||
      (n.supportSymbol != null && !['standard','callout'].includes(n.supportSymbol)) ||
      (n.valveSymbol != null && !['disc', 'bowtie', 'swing', 'triangle'].includes(n.valveSymbol)) ||
      (n.symbol != null && !(SYMBOL_FAMILIES as readonly string[]).includes(n.symbol)) ||
      (n.symbolPlane != null && !['plan', 'vertical','alternate'].includes(n.symbolPlane)) ||
      (n.hosePath != null && (!Array.isArray(n.hosePath) || n.hosePath.length<2 || n.hosePath.length>500 || !n.hosePath.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite)))) ||
      (n.valveOperator != null && !['none', 'lever', 'actuator', 'handwheel', 'box'].includes(n.valveOperator)) ||
      (n.calloutPlane != null && !['sheet', 'pipe'].includes(n.calloutPlane)) ||
      (n.calloutText != null && !isString(n.calloutText, 300)) ||
      (n.jointSupply != null && (!isPlain(n.jointSupply) ||
        typeof n.jointSupply.gasket !== 'boolean' || typeof n.jointSupply.bolts !== 'boolean' ||
        (n.jointSupply.flange != null && typeof n.jointSupply.flange !== 'boolean') ||
        (n.jointSupply.mate != null && n.jointSupply.mate !== 'flange' && n.jointSupply.mate !== 'lug') ||
        (n.jointSupply.measuredTo != null && n.jointSupply.measuredTo !== 'mate' && n.jointSupply.measuredTo !== 'flange') ||
        (n.jointSupply.spool != null && !isString(n.jointSupply.spool)))) ||
      (n.portFlanges != null && (!isPlain(n.portFlanges) || Object.keys(n.portFlanges).length > 8 ||
        !Object.values(n.portFlanges).every(f => isPlain(f) &&
          (f.component == null || isString(f.component, 60)) &&
          (f.gasket == null || typeof f.gasket === 'boolean') &&
          (f.mate == null || f.mate === 'flange' || f.mate === 'lug') &&
          (f.bolts == null || typeof f.bolts === 'boolean'))))
    )
      throw new Error('Invalid component callout.')
    if (n.flatSide != null && !Object.keys(FLAT_DIRECTION).includes(n.flatSide)) throw new Error('Invalid eccentric flat side.')
  }
  where.at = ''
  const strings = (v: unknown, count: number, max = 200) =>
    Array.isArray(v) && v.length <= count && v.every(s => isString(s, max))
  const t = d.titleBlock
  if (
    t != null &&
    (!isPlain(t) ||
      !strings(t.referenceDrawings, 5) ||
      !['designedBy', 'date', 'checkedBy', 'projectLeader', 'disciplineLeader', 'approvedBy', 'insulationThickness',
        'insulationCladding', 'tracing', 'pipeSpec', 'specRevision', 'designCode', 'product', 'refArea', 'lineNumber',
        'projectNumber'].every(k => isString(t[k as keyof TitleBlock], 200)) ||
      (t.dateFormat != null && !isString(t.dateFormat, 200)) ||
      (t.custom != null && (!isPlain(t.custom) || Object.keys(t.custom).length > 40 ||
        !Object.entries(t.custom).every(([k, v]) => /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(k) && isString(v, 200)))) ||
      !isPlain(t.conditions) ||
      !(['design', 'operating', 'test'] as const).every(k => Array.isArray(t.conditions[k]) && t.conditions[k].length === 2 && strings(t.conditions[k], 2, 40)) ||
      !Array.isArray(t.revisions) || t.revisions.length > 20 ||
      !t.revisions.every(r => isPlain(r) && ['rev', 'date', 'description', 'designedBy', 'checkedBy', 'disciplineLead',
        'projectLeader', 'approvedBy'].every(k => isString(r[k as keyof TitleBlockRevision], 200))) ||
      !Array.isArray(t.logos) || t.logos.length > 2 ||
      !t.logos.every(l => isPlain(l) && isString(l.name, 200) && isString(l.dataUrl, 2_100_000) &&
        /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(l.dataUrl)))
  )
    throw new Error('Invalid title block.')
  if (
    d.style != null &&
    (!isPlain(d.style) || !['scale', 'schematic'].includes(d.style.layout) ||
      typeof d.style.weldNumbers !== 'boolean' || !['cad', 'sans'].includes(d.style.lettering) ||
      (d.style.elevations != null && typeof d.style.elevations !== 'boolean') ||
      (d.style.componentFaces != null && typeof d.style.componentFaces !== 'boolean') ||
      (d.style.scaleNote != null && typeof d.style.scaleNote !== 'boolean') ||
      (d.style.dimensionRounding != null && !['chain', 'individual'].includes(d.style.dimensionRounding)) ||
      (d.style.stackSizeLabels != null && typeof d.style.stackSizeLabels !== 'boolean') ||
      (d.style.northMark != null && !['arrow', 'ticks'].includes(d.style.northMark)) ||
      (d.style.paperGrid != null && !(typeof d.style.paperGrid === 'number' && d.style.paperGrid >= 0.05 && d.style.paperGrid <= 2)) ||
      (d.style.stretch != null && !(typeof d.style.stretch === 'number' && d.style.stretch >= 0 && d.style.stretch <= 2)) ||
      (d.style.textHeight != null && !(typeof d.style.textHeight === 'number' && d.style.textHeight >= 1 && d.style.textHeight <= 10)) ||
      (d.style.pipeWeight != null && !(typeof d.style.pipeWeight === 'number' && d.style.pipeWeight >= 0.1 && d.style.pipeWeight <= 3)) ||
      (d.style.jointCallout != null && !['items', 'combined'].includes(d.style.jointCallout)) ||
      (d.style.fieldFitMark != null && !['FFW', 'FW'].includes(d.style.fieldFitMark)) ||
      (d.style.materialList != null && !['auto', 'onSheet', 'separate'].includes(d.style.materialList)))
  )
    throw new Error('Invalid drawing style.')
  if (d.draftingRules != null && !(Number.isInteger(d.draftingRules) && d.draftingRules >= 1 && d.draftingRules <= DRAFTING_RULES))
    throw new Error('Unsupported drafting rules.')
  if (
    d.sheets != null &&
    (!isPlain(d.sheets) || Object.keys(d.sheets).length > 1000 ||
      !Object.entries(d.sheets).every(([k, s]) => isString(k) && isPlain(s) &&
        ['drawingNumber', 'lineNumber', 'revision'].every(f => s[f as keyof SheetInfo] == null || isString(s[f as keyof SheetInfo], 120)) &&
        (s.bomOrder == null || (Array.isArray(s.bomOrder) && s.bomOrder.length <= 500 && s.bomOrder.every(k => isString(k, 2000)))) &&
        (s.bomWidth == null || finite(s.bomWidth) && s.bomWidth>=250 && s.bomWidth<=1000) &&
        (s.bomColumns == null || Array.isArray(s.bomColumns) && s.bomColumns.length===3 &&
          s.bomColumns.every(w=>finite(w)&&w>=12&&w<=150) &&
          s.bomColumns.reduce((a,b)=>a+b,0)<=Math.min(300,(s.bomWidth??1000)-40)) &&
        (s.bomRowHeights == null || (isPlain(s.bomRowHeights) && Object.keys(s.bomRowHeights).length <= 500 &&
          Object.entries(s.bomRowHeights).every(([key, height]) => isString(key,2000) && finite(height) && height >= 8 && height <= 200))) &&
        (s.nodePositions == null || (isPlain(s.nodePositions) && Object.keys(s.nodePositions).length <= 5000 &&
          Object.entries(s.nodePositions).every(([key, point]) => isString(key) && Array.isArray(point) && point.length === 2 && point.every(finite)))) &&
        (s.labelPositions == null || (isPlain(s.labelPositions) && Object.keys(s.labelPositions).length <= 5000 &&
          Object.entries(s.labelPositions).every(([key, point]) => isString(key, 2000) && Array.isArray(point) && point.length === 2 && point.every(finite)))) &&
        (s.labelStyles == null || isPlain(s.labelStyles) && Object.keys(s.labelStyles).length<=5000 && Object.entries(s.labelStyles).every(([key,v])=>isString(key,2000)&&isPlain(v)&&(v.size==null||finite(v.size)&&v.size>0&&v.size<=100)&&(v.rotation==null||finite(v.rotation)&&Math.abs(v.rotation)<=360)&&(v.oblique==null||finite(v.oblique)&&Math.abs(v.oblique)<=85))) &&
        (s.dimensionLayout == null || (isPlain(s.dimensionLayout) && Object.keys(s.dimensionLayout).length <= 1000 &&
          Object.entries(s.dimensionLayout).every(([key, layout]) => isString(key,2000) && isPlain(layout) &&
            (layout.axis == null || Array.isArray(layout.axis) && layout.axis.length===3 && layout.axis.every(finite) && Math.hypot(...layout.axis)>1e-8) &&
            (layout.offset == null || finite(layout.offset) && Math.abs(layout.offset)<=5000) &&
            (layout.reverseText == null || typeof layout.reverseText==='boolean') && (layout.format==null || ['feet','inches','feet-short'].includes(layout.format))))) &&
        (s.jointItems == null || (isPlain(s.jointItems) && Object.keys(s.jointItems).length <= 5000 &&
          Object.entries(s.jointItems).every(([key, parts]) => isString(key,2000) && isPlain(parts) &&
            ['flange','bolts','gasket'].every(k => parts[k as keyof typeof parts] == null || isString(parts[k as keyof typeof parts],2000))))) &&
        (s.dimensionScope == null || ['sheet', 'legs'].includes(s.dimensionScope)) &&
        (s.dimensions == null || (Array.isArray(s.dimensions) && s.dimensions.length <= 500 && s.dimensions.every(dim =>
          isPlain(dim) && [dim.from, dim.to].every(a => isPlain(a) && isString(a.nodeId) &&
            (a.adjacent == null || isString(a.adjacent) && a.face==null && a.runId==null && Array.isArray(d.references) && d.references.some(r=>r.id===a.adjacent&&r.atNodeId===a.nodeId&&r.dimensionTo)) &&
            d.nodes.some(n => n.id === a.nodeId) && (a.face == null || ['body', 'mate'].includes(a.face) && a.runId != null) &&
            (a.runId == null || isString(a.runId) && d.runs.some(r => r.id === a.runId && [r.from, r.to].includes(a.nodeId)))) &&
          Array.isArray(dim.axis) && dim.axis.length === 3 && dim.axis.every(finite) && Math.hypot(...dim.axis) > 0 &&
          finite(dim.offset) && Math.abs(dim.offset) <= 5000 && (dim.reverseText == null || typeof dim.reverseText === 'boolean') && (dim.format==null || ['feet','inches','feet-short'].includes(dim.format))))) &&
        (s.issuedValues == null || (isPlain(s.issuedValues) && Object.keys(s.issuedValues).length <= 500 &&
          Object.entries(s.issuedValues).every(([key, value]) => isString(key, 2000) && isPlain(value) &&
            (['qtyText', 'nd', 'description'] as const).every(k => value[k] == null || isString(value[k], k === 'description' ? 2000 : 120)) &&
            (value.calculated == null || isPlain(value.calculated) &&
              (['qtyText', 'nd', 'description'] as const).every(k => value.calculated![k] == null || isString(value.calculated![k], k === 'description' ? 2000 : 120))))))))
  )
    throw new Error('Invalid sheet information.')
  if (
    d.coordinates != null &&
    (!isPlain(d.coordinates) || !Array.isArray(d.coordinates.origin) || d.coordinates.origin.length !== 3 ||
      !d.coordinates.origin.every(finite))
  )
    throw new Error('Invalid plant coordinates.')
  if (
    d.sheetNotes != null &&
    (!Array.isArray(d.sheetNotes) || d.sheetNotes.length > 500 ||
      !d.sheetNotes.every(s => isPlain(s) && isString(s.id) && !!s.id && isString(s.spool) && isString(s.text, 2000) &&
        Array.isArray(s.at) && s.at.length === 2 && s.at.every(finite) &&
        (s.size == null || positive(s.size) && s.size<=200) &&
        (s.lettering==null || ['cad','sans'].includes(s.lettering)) &&
        (['color','textColor'] as const).every(k=>s[k]==null || typeof s[k]==='string' && /^#[0-9a-f]{6}$/i.test(s[k])) &&
        (s.arrow==null || typeof s.arrow==='boolean') &&
        (s.leader==null || Array.isArray(s.leader) && s.leader.length>=2 && s.leader.length<=100 && s.leader.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite))) &&
        (s.box==null || isPlain(s.box) && Array.isArray(s.box.at) && s.box.at.length===2 && s.box.at.every(finite) && positive(s.box.width) && positive(s.box.height)) &&
        (s.rotation == null || finite(s.rotation)) && (s.oblique == null || finite(s.oblique) && Math.abs(s.oblique)<89)))
  )
    throw new Error('Invalid sheet note.')
  const specs = new Set<string>(),
    catalogs = new Set<string>()
  for (const [specIndex, s] of d.specs.entries()) {
    where.at = `specs[${specIndex}]`
    if (
      !isString(s.id) ||
      !s.id ||
      specs.has(s.id) ||
      !Array.isArray(s.sizes) ||
      !Array.isArray(s.fittings) ||
      s.sizes.length > 500 ||
      s.fittings.length > 10000 ||
      !nonnegative(s.rootGap) ||
      [s.socketGap, s.minPipeLength, s.minWeldSpacing].some(v => v != null && !nonnegative(v)) ||
      (s.stockLength != null && !positive(s.stockLength)) ||
      (s.branchCodes != null && (!isPlain(s.branchCodes) || Object.keys(s.branchCodes).length > 100 ||
        !Object.entries(s.branchCodes).every(([k, v]) => isString(k, 40) && isString(v, 120)))) ||
      (s.branchChart != null && (!Array.isArray(s.branchChart) || s.branchChart.length > 10000 ||
        !s.branchChart.every(e => isPlain(e) && positive(e.run) && positive(e.branch) && isString(e.code, 120)))) ||
      !positive(s.density) ||
      ![s.pipeCostM, s.pipeLaborHoursM, s.weldHoursPerDiameterInch].every(
        nonnegative
      )
    )
      throw new Error('Invalid pipe specification.')
    specs.add(s.id)
    for (const k of ['name', 'material', 'schedule', 'rating'])
      if (!isString(s[k as keyof PipeSpec]))
        throw new Error('Invalid pipe specification description.')
    if (
      [s.service, s.revision].some(v => v != null && !isString(v)) ||
      !validSpecDesign(s.design) ||
      (s.parameters != null &&
        (typeof s.parameters !== 'object' ||
          Array.isArray(s.parameters) ||
          Object.keys(s.parameters).length > 500 ||
          !Object.entries(s.parameters).every(([k, v]) => isString(k, 200) && isString(v)))) ||
      (s.nipples != null && (!Array.isArray(s.nipples) || s.nipples.length > 500 ||
        !s.nipples.every(n => isPlain(n) && positive(n.nps) && positive(n.length) &&
          (['id', 'schedule', 'material', 'description', 'bomDescription'] as const).every(k => n[k] == null || isString(n[k])))))
    )
      throw new Error('Invalid pipe specification parameters.')
    const sizes = new Set<number>()
    for (const [index, z] of s.sizes.entries()) {
      where.at = `specs[${specIndex}].sizes[${index}]`
      if (
        ![z.nps, z.od, z.wall, z.kgM].every(positive) ||
        z.wall * 2 >= z.od ||
        (z.bomDescription != null && !isString(z.bomDescription)) ||
        sizes.has(z.nps)
      )
        throw new Error('Invalid or duplicate pipe size.')
      sizes.add(z.nps)
    }
    for (const [index, f] of s.fittings.entries()) {
      where.at = `specs[${specIndex}].fittings[${index}]${typeof f?.id === 'string' ? ` (id ${f.id.slice(0, 40)})` : ''}`
      if (
        !isString(f.id) ||
        !f.id ||
        catalogs.has(f.id) ||
        !knownKinds.includes(f.kind) ||
        !positive(f.nps) ||
        (f.smallerNps != null && !positive(f.smallerNps)) ||
        (f.takeoutMissing != null && typeof f.takeoutMissing !== 'boolean') ||
        (f.takeoutToPipeEnd != null && typeof f.takeoutToPipeEnd !== 'boolean') ||
        (f.boltSystem != null && f.boltSystem !== 'inch' && f.boltSystem !== 'metric') ||
        (f.symbol != null && !(SYMBOL_FAMILIES as readonly string[]).includes(f.symbol)) ||
        !nonnegative(f.takeout) ||
        !isString(f.description) ||
        !isString(f.source) ||
        ['component', 'rating', 'schedule', 'partCode', 'material', 'manufacturer', 'bomDescription'].some(
          k => f[k as keyof CatalogItem] != null && !isString(f[k as keyof CatalogItem])
        ) ||
        (f.shopField != null && !['S', 'F'].includes(f.shopField)) ||
        (f.takeoutReference != null && f.takeoutReference !== 'header-outside' && f.takeoutReference !== 'header-centre') ||
        !validCatalogDesign(f) ||
        !optionalNumbers(f, [
          'centreToCentre',
          'backToFace',
          'height',
          'branchTakeout',
          'weightKg',
          'areaM2',
          'unitCost',
          'laborHours',
          'faceToFace',
          'longSideTakeout',
          'flangeThickness',
          'lengthThroughHub',
          'thickness',
          'boltCount',
          'boltDiameter',
          'boltLength'
        ])
      )
        throw new Error('Invalid catalogue fitting.')
      catalogs.add(f.id)
    }
  }
  const runs = new Set<string>()
  for (const [index, r] of d.runs.entries()) {
    where.at = `runs[${index}]${typeof r?.id === 'string' ? ` (id ${r.id.slice(0, 40)})` : ''}`
    for (const key of ['fromPrep', 'toPrep'])
      if (
        r[key as keyof PipeRun] != null &&
        !['BW', 'SW', 'THD', 'FL', 'PLAIN'].includes(String(r[key as keyof PipeRun]))
      )
        throw new Error('Invalid end preparation.')
    if (r.description != null && !isString(r.description, 300)) throw new Error('Invalid pipe description.')
    if (r.nipple != null && (!isPlain(r.nipple) || (r.nipple.length != null && !positive(r.nipple.length))))
      throw new Error('Invalid pipe nipple.')
    if (r.flow != null && r.flow !== 'forward' && r.flow !== 'reverse') throw new Error('Invalid flow direction.')
    if (r.showFlow != null && typeof r.showFlow !== 'boolean') throw new Error('Invalid flow arrow visibility.')
    if (r.flowPosition != null && (!finite(r.flowPosition) || r.flowPosition<0 || r.flowPosition>1)) throw new Error('Invalid flow arrow position.')
    if(r.showSize!=null && typeof r.showSize!=='boolean')throw Error('Invalid size label placement.')
    if(r.showLineNumber != null && typeof r.showLineNumber!=='boolean')throw new Error('Invalid line number placement.')
    if (r.lineNumberPlane != null && !['vertical', 'plan', 'normal', 'alternate'].includes(r.lineNumberPlane)) throw new Error('Invalid line number lettering plane.')
    if (r.dimensionReverse != null && typeof r.dimensionReverse !== 'boolean') throw new Error('Invalid dimension lettering direction.')
    if (r.dimensionAxis != null && (!Array.isArray(r.dimensionAxis) || r.dimensionAxis.length !== 3 ||
      !r.dimensionAxis.every(finite) || Math.hypot(...r.dimensionAxis) < 1e-8)) throw new Error('Invalid dimension direction.')
    if (r.offsetDrawing != null && (!isPlain(r.offsetDrawing) ||
      (r.offsetDrawing.angleFromH!=null && !['start','end'].includes(r.offsetDrawing.angleFromH)) ||
      (r.offsetDrawing.angleFromV!=null && !['start','end'].includes(r.offsetDrawing.angleFromV)) ||
      (r.offsetDrawing.legPlane!=null && !['construction','vertical'].includes(r.offsetDrawing.legPlane)) ||
      (r.offsetDrawing.hatchFrom!=null && !['start','end'].includes(r.offsetDrawing.hatchFrom)) ||
      (r.offsetDrawing.hatchPlane!=null && !['H','V'].includes(r.offsetDrawing.hatchPlane)) ||
      (r.offsetDrawing.planPoint!=null && (!Array.isArray(r.offsetDrawing.planPoint)||r.offsetDrawing.planPoint.length!==2||!r.offsetDrawing.planPoint.every(finite))) ||
      (r.offsetDrawing.hatchCount != null && (!Number.isInteger(r.offsetDrawing.hatchCount) || r.offsetDrawing.hatchCount<0 || r.offsetDrawing.hatchCount>200)) ||
      ['rightAngleSize','angleRadiusH','angleRadiusV','hatchSpacing','hatchStart','hatchGap'].some(k=>{const v=r.offsetDrawing![k as 'rightAngleSize'|'angleRadiusH'|'angleRadiusV'|'hatchSpacing'|'hatchStart'|'hatchGap'];return v!=null&&(!finite(v)||v<0||v>5000)}) ||
      ['angleOutwardH','angleOutwardV','angleArrows','showTrueLength','dimensionLegs','setAndRoll','showLegValues'].some(k => r.offsetDrawing![k as 'angleOutwardH'|'angleOutwardV'|'angleArrows'|'showTrueLength'|'dimensionLegs'|'setAndRoll'|'showLegValues'] != null && typeof r.offsetDrawing![k as 'angleOutwardH'|'angleOutwardV'|'angleArrows'|'showTrueLength'|'dimensionLegs'|'setAndRoll'|'showLegValues'] !== 'boolean') ||
      (r.offsetDrawing.trueLengthOffset != null && (!finite(r.offsetDrawing.trueLengthOffset) || Math.abs(r.offsetDrawing.trueLengthOffset)>5000))))
      throw new Error('Invalid offset drafting.')
    for (const key of ['connector', 'fromField', 'toField', 'fromFieldFit', 'toFieldFit', 'uncut'])
      if (
        r[key as keyof PipeRun] != null &&
        typeof r[key as keyof PipeRun] !== 'boolean'
      )
        throw new Error('Invalid pipe attributes.')
    if (r.rootGap != null && !nonnegative(r.rootGap))
      throw new Error('Invalid pipe root gap.')
    if ([r.fromTag, r.toTag].some(v => v != null && !isString(v)))
      throw new Error('Invalid weld tag.')
    getNode(d, r.from)
    getNode(d, r.to)
    getSpec(d, r.specId)
    if (
      !isString(r.id) ||
      !r.id ||
      runs.has(r.id) ||
      r.from === r.to ||
      !positive(r.nps) ||
      !isString(r.spool) ||
      !isString(r.line) ||
      !isString(r.heat) ||
      !['BW', 'SW', 'THD', 'FL', 'PLAIN'].includes(r.endPrep)
    )
      throw new Error('Invalid pipe run.')
    runs.add(r.id)
  }
  for (const [index, n] of d.nodes.entries()) {
    where.at = `nodes[${index}]${typeof n?.id === 'string' ? ` (id ${n.id.slice(0, 40)})` : ''}`
    if (n.associatedRunId && !runs.has(n.associatedRunId))
      throw new Error('Attachment refers to a missing pipe.')
    if (
      n.branchEdgeId &&
      !connected(d, n.id).some(r => r.id === n.branchEdgeId)
    )
      throw new Error('Tee branch must be a connected pipe.')
  }
  if (d.references != null) {
    if (!Array.isArray(d.references) || d.references.length > 100) throw new Error('Invalid adjacent drawings.')
    const references = new Set<string>()
    for (const [index, r] of d.references.entries()) {
      where.at = `references[${index}]`
      if (!isPlain(r) || !isString(r.id, 200) || !r.id || references.has(r.id) || !ids.has(r.atNodeId) ||
        !isString(r.name, 200) || !isString(r.anchorNodeId) || !Array.isArray(r.nodes) || r.nodes.length > 100 ||
        !Array.isArray(r.runs) || r.runs.length > 100 || !Array.isArray(r.specs) ||
        (r.components != null && (!Number.isInteger(r.components) || r.components < 0 || r.components > 3)) ||
        (r.dimensionTo != null && !isString(r.dimensionTo)) ||
        (r.pipeWeight!=null && typeof r.pipeWeight!=='boolean') ||
        (r.termination != null && !['break', 'plain'].includes(r.termination))) throw new Error('Invalid adjacent drawing.')
      // Validate each isolated reference using the same graph and catalogue rules as an ordinary document.
      const source = parseIsoJson(JSON.stringify({ ...d, nodes: r.nodes, runs: r.runs, specs: r.specs,
        references: undefined, sheets: undefined, sheetNotes: undefined }))
      if (!source.nodes.some(n => n.id === r.anchorNodeId) || (r.dimensionTo && !source.nodes.some(n => n.id === r.dimensionTo)))
        throw new Error('Adjacent drawing refers to a missing point.')
      references.add(r.id)
    }
  }
  where.at = ''
  migrateDrafting(d)
  return d
}
/** The revision of explicit drafting fields this version writes (see `IsoDocument.draftingRules`). */
export const DRAFTING_RULES = 1
/** Lettering of documents drafted before `textHeight`: 6.6 of the sheet's 850 units, on any paper. */
const LEGACY_TEXT_UNITS = 6.6
/**
 * Derive, once, the explicit drafting fields an older document expressed in free text or by convention, so it keeps
 * its look: end terminations from "OPEN END" / "CLOSED" callouts, insulation limits and wall marks from their
 * callouts, actuated butterfly bodies from their descriptions, the threaded check valve's plain triangle, and the
 * lettering height and combined joint callouts its sheets were drawn with.
 */
export function migrateDrafting(d: IsoDocument): void {
  if (d.draftingRules != null) return
  const migrate = (nodes: PipeNode[], specs: PipeSpec[]) => {
    const rows = specs.flatMap(s => s.fittings)
    for (const n of nodes) {
      const item = rows.find(f => f.id === n.catalogId), code = n.component ?? item?.component
      const family = n.symbol ?? item?.symbol ?? (code ? COMPONENT_TYPE_BY_CODE[code]?.symbol : undefined)
      if (n.continuation && !n.continuation.termination) {
        const text = n.continuation.text
        if (/OPEN END/i.test(text)) n.continuation.termination = 'open'
        else if (/CLOSED/i.test(text)) n.continuation.termination = 'closed'
      }
      const callout = n.calloutText ?? ''
      if (!n.symbol && n.kind === 'annotation' && (!code || family === 'insulation') && /INSUL.*NONE|NONE.*INSUL/i.test(callout))
        n.symbol = 'insulation-limit'
      if (!n.symbol && code === 'GRND-SYM' && /WALL/i.test(callout)) n.symbol = 'wall'
      if (family === 'butterfly' && !n.valveSymbol &&
        /ACTUAT/i.test(`${n.description ?? ''} ${item?.bomDescription ?? ''} ${item?.description ?? ''}`)) {
        n.valveSymbol = 'bowtie'
        n.valveOperator ??= 'actuator'
      }
      if (family === 'check' && code === 'CHECK-SC' && !n.valveSymbol) n.valveSymbol = 'triangle'
    }
  }
  // Before the 1/16" socket-weld default, a specification without a socket gap bottomed its pipes in their sockets,
  // and the drawing's cut lengths were issued that way: the gap it was drafted with becomes explicit.
  const bottomed = (specs: PipeSpec[]) => { for (const s of specs) if (s.socketGap == null) s.socketGap = 0 }
  migrate(d.nodes, d.specs)
  bottomed(d.specs)
  for (const r of d.references ?? []) { migrate(r.nodes, r.specs); bottomed(r.specs) }
  const style = styleOf(d)
  d.style = {
    ...style,
    textHeight: style.textHeight ?? Math.round(LEGACY_TEXT_UNITS / unitsPerMm(d.paper) * 100) / 100,
    jointCallout: style.jointCallout ?? 'combined'
  }
  d.draftingRules = DRAFTING_RULES
}
/**
 * RFC 4180 CSV. A text cell a spreadsheet would run as a formula (starting =, +, -, @, tab or carriage return, OWASP
 * CSV injection) is prefixed with an apostrophe; numbers, and text that is a plain number such as "-12.5", are left
 * as they are so negative values stay numeric.
 */
export function csv(rows: unknown[][]): string {
  const formula = (s: string) => /^[=+\-@\t\r]/.test(s) && !/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(s)
  return rows
    .map(row =>
      row
        .map(v => {
          let s = String(v ?? '')
          if (typeof v !== 'number' && formula(s)) s = "'" + s
          return '"' + s.replace(/"/g, '""') + '"'
        })
        .join(',')
    )
    .join('\r\n')
}
/** Discard paper anchors when their underlying geometry has been removed. */
export function pruneSheetAnchors(doc: IsoDocument): void {
  const paperNodes=new Set([...doc.nodes,...(doc.references??[]).flatMap(r=>r.nodes)].map(n=>n.id));
  for (const info of Object.values(doc.sheets ?? {})) {
    if (info.nodePositions) for (const key of Object.keys(info.nodePositions))
      if (!paperNodes.has(key)) delete info.nodePositions[key];
    if (info.dimensions) info.dimensions = info.dimensions.filter(dim => [dim.from, dim.to].every(a =>
      doc.nodes.some(n => n.id === a.nodeId) && (!a.adjacent || doc.references?.some(r=>r.id===a.adjacent&&r.atNodeId===a.nodeId&&r.dimensionTo)) && (!a.runId || doc.runs.some(r => r.id === a.runId && [r.from, r.to].includes(a.nodeId)))));
  }
}
/** Remove an inline component without losing either outer connection's fabrication data. */
export function removeComponent(doc: IsoDocument, nodeId: string): void {
  const node = getNode(doc, nodeId), edges = connected(doc, nodeId);
  if (node.associatedRunId || edges.length === 0) {
    doc.nodes = doc.nodes.filter(n => n.id !== nodeId);
    if (doc.references) doc.references = doc.references.filter(r => r.atNodeId !== nodeId);
    pruneSheetAnchors(doc);
    return;
  }
  if (edges.length !== 2) throw new Error('Remove the connected branch pipes before deleting this junction.');
  const [a,b] = edges;
  for (const key of ['specId','nps','spool','line','heat','rootGap','connector'] as const)
    if (a[key] !== b[key]) throw new Error('The adjoining pipes have different fabrication properties. Keep them as separate runs.');
  const farA = a.from === nodeId ? a.to : a.from, farB = b.from === nodeId ? b.to : b.from;
  const va = sub(getNode(doc,farA).position,node.position), vb = sub(getNode(doc,farB).position,node.position);
  if (length(va) === 0 || length(vb) === 0 || va.reduce((v,x,i)=>v+x*vb[i],0)/(length(va)*length(vb)) > -.999999)
    throw new Error('Only straight inline components can be removed without changing the pipe route.');
  const fromIndex = a.from === farA ? 0 : 1, toIndex = b.from === farB ? 0 : 1;
  const outer = {
    fromPrep: prepAt(a,fromIndex), toPrep: prepAt(b,toIndex),
    fromField: a[fromIndex === 0 ? 'fromField' : 'toField'],
    toField: b[toIndex === 0 ? 'fromField' : 'toField'],
    fromFieldFit: a[fromIndex === 0 ? 'fromFieldFit' : 'toFieldFit'],
    toFieldFit: b[toIndex === 0 ? 'fromFieldFit' : 'toFieldFit'],
    fromTag: a[fromIndex === 0 ? 'fromTag' : 'toTag'],
    toTag: b[toIndex === 0 ? 'fromTag' : 'toTag'],
  };
  a.from=farA; a.to=farB; Object.assign(a,outer);
  for (const key of Object.keys(outer) as Array<keyof typeof outer>) if (a[key] === undefined) delete a[key];
  for (const n of doc.nodes) {
    if (n.associatedRunId === b.id) n.associatedRunId = a.id;
    if (n.portTakeouts?.[b.id] != null) { n.portTakeouts[a.id]=n.portTakeouts[b.id]; delete n.portTakeouts[b.id]; }
    if (n.branchEdgeId === b.id) n.branchEdgeId=a.id;
  }
  doc.runs=doc.runs.filter(r=>r.id!==b.id);
  doc.nodes=doc.nodes.filter(n=>n.id!==nodeId);
  if (doc.references) doc.references = doc.references.filter(r => r.atNodeId !== nodeId);
  for (const info of Object.values(doc.sheets ?? {})) for (const dim of info.dimensions ?? [])
    for (const anchor of [dim.from, dim.to]) if (anchor.runId === b.id) anchor.runId = a.id;
  pruneSheetAnchors(doc);
}
