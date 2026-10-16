import type { GridSettings } from './grid'
import { COMPONENT_TYPES } from './components'
import { boltedDirect, breakOwner, defaultCode, flangedAllowance, flangedJoints, isFlangePair, matingFlange, pairFlangesOn, spansSpools, nippleEnds, nippleLength, nippleText, nodeItem, pipeEndPrep } from './joints'
import { boltSizeText } from './format'
import { flange, pipeOd } from './standards'
import { routeOrder } from './material-list'
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
  /** Gap (mm) the pipe is withdrawn from the socket bottom before socket welding (ASME B31.3 Fig. 328.5.2C); 0 if unset. */
  socketGap?: number
  /** Shortest pipe piece (mm) the shop will cut; 50 mm if unset. */
  minPipeLength?: number
  /** Least clear distance (mm) between the welds at a pipe piece's ends; 50 mm if unset. */
  minWeldSpacing?: number
  density: number
  pipeCostM: number
  weldHoursPerDiameterInch: number
  pipeLaborHoursM: number
  service?: string
  revision?: string
  /** Free-form specification parameters, e.g. flange face, bolt type, small-bore start size. */
  parameters?: Record<string, string>
  /** Pipe nipples by size: catalogued length (mm), schedule and material. */
  nipples?: NippleRow[]
  branchChart?: Array<{ run: number; branch: number; code: string }>
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
  /** Deflection of a measured/custom bend; standard elbows use their catalogue angle. */
  bendAngle?: number
  /** Centreline radius of a pipe bend: its takeout is the radius times the tangent of half the deflection. */
  bendRadius?: number
  /** Open-end callout, e.g. "CONT'D ON\nDWG# ISO-201-2", optionally followed by plant coordinates. */
  continuation?: { text: string; coordinates?: boolean }
  elevationCallout?: boolean
  tiePoint?: { id: string; label?: string }
  /** Valve operator orientation, e.g. "OPERATOR SOUTH"; the valve tag is `tag`. */
  operator?: string
  /** Sheet label for supports and annotations, e.g. "U-BOLT", "HANGER", "CLOSED". */
  calloutText?: string
  /** Dimension this support's location along its pipe. */
  dimensioned?: boolean
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
export type FlatSide = 'top' | 'bottom' | 'north' | 'south' | 'east' | 'west'
const FLAT_DIRECTION: Record<FlatSide, Vec3> = { top: [0, 0, 1], bottom: [0, 0, -1], north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0] }
/** Eccentric reducers and swages have a flat side. */
export const isEccentric = (code?: string) => !!code && /^E-(RED|SWAGE|SWG)$/.test(code)
/** Bill-of-materials suffix for an eccentric reducer's flat side: FOT, FOB or FLAT NORTH. */
export const flatSideText = (n: PipeNode) =>
  !n.flatSide ? '' : n.flatSide === 'top' ? 'FOT' : n.flatSide === 'bottom' ? 'FOB' : `FLAT ${n.flatSide.toUpperCase()}`
export interface PortFlange {
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
}
export interface SheetInfo {
  drawingNumber?: string
  lineNumber?: string
  revision?: string
  /** Item numbers held as issued: material row keys in ID order. New items follow, in the usual order. */
  bomOrder?: string[]
}
export interface DrawingStyle {
  layout: 'scale' | 'schematic'
  weldNumbers: boolean
  lettering: 'cad' | 'sans'
  /** Centreline elevation at every change of level, not only where the drafter places one. */
  elevations?: boolean
}
/** Plant east, north and elevation (mm) of the model origin. */
export interface PlantCoordinates {
  origin: Vec3
}
export interface SheetNote {
  id: string
  spool: string
  text: string
  /** Sheet units. */
  at: [number, number]
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
  outputViews?: Array<'iso' | 'plan' | 'front' | 'side'>
  specs: PipeSpec[]
  nodes: PipeNode[]
  runs: PipeRun[]
  weldStart: number
  weldPrefix: string
  weldNumbering?: 'numeric' | 'alphabetic'
  titleBlock?: TitleBlock
  /** Per-spool sheet identity; a spool is one issued sheet. */
  sheets?: Record<string, SheetInfo>
  style?: DrawingStyle
  coordinates?: PlantCoordinates
  sheetNotes?: SheetNote[]
}
export interface RunResult {
  run: PipeRun
  overall: number
  cut: number
  takeouts: [number, number]
  gaps: [number, number]
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
    rating: 'Project specified',
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
export function sheetInfoOf(doc: IsoDocument, spool: string): Required<Omit<SheetInfo, 'bomOrder'>> {
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
export function getNode(doc: IsoDocument, key: string): PipeNode {
  const node = doc.nodes.find(n => n.id === key)
  if (!node) throw new Error(`Missing connection ${key}`)
  return node
}
export function getSpec(doc: IsoDocument, key: string): PipeSpec {
  const spec = doc.specs.find(s => s.id === key)
  if (!spec) throw new Error(`Missing pipe specification ${key}`)
  return spec
}
export function fitting(
  doc: IsoDocument,
  node: PipeNode
): CatalogItem | undefined {
  return doc.specs.flatMap(s => s.fittings).find(f => f.id === node.catalogId)
}
export function takeout(
  doc: IsoDocument,
  node: PipeNode,
  runId: string
): number | undefined {
  if (['end', 'weld', 'support', 'annotation'].includes(node.kind)) return 0
  if (node.portTakeouts?.[runId] != null) return node.portTakeouts[runId]
  // A specification row without a known dimension falls back to the ASME standard, never to zero.
  const item = nodeItem(doc, node), run = doc.runs.find(r => r.id === runId)
  const own = node.branchEdgeId === runId
    ? node.branchTakeout ?? (item?.takeoutMissing ? undefined : item?.branchTakeout)
    : node.takeout ?? bendTakeout(doc, node) ?? (item?.takeoutMissing ? undefined : lateralLongSide(doc, node, runId, item) ?? oletTakeout(doc, node, item) ?? item?.takeout)
  return own == null || !run ? own : own + flangedAllowance(doc, node, run)
}
/**
 * A branch outlet measured from the run pipe's outside (MSS SP-97) sits on its header's centreline: its takeout adds
 * the header radius and the root gap under the outlet. An outlet drawn without its header is measured from its node.
 */
function oletTakeout(doc: IsoDocument, node: PipeNode, item?: CatalogItem): number | undefined {
  if (node.kind !== 'olet' || item?.takeoutReference !== 'header-outside') return undefined
  const header = doc.runs.find(r => r.id === node.associatedRunId)
  if (!header) return undefined
  const spec = doc.specs.find(s => s.id === header.specId)
  const od = spec?.sizes.find(s => s.nps === header.nps)?.od ?? pipeOd(header.nps)
  return od == null ? undefined : od / 2 + (header.rootGap ?? spec?.rootGap ?? 0) + item.takeout
}
/** Tangent length of a pipe bend of known radius: R · tan(θ/2) for the deflection θ the pipes make. */
export function bendTakeout(doc: IsoDocument, node: PipeNode): number | undefined {
  if (!(node.bendRadius! > 0)) return undefined
  const legs = connected(doc, node.id).map(r => sub(getNode(doc, r.from === node.id ? r.to : r.from).position, node.position))
  if (legs.length !== 2) return undefined
  const [a, b] = legs, cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((length(a) * length(b)) || 1)
  const deflection = Math.PI - Math.acos(Math.max(-1, Math.min(1, cos)))
  return node.bendRadius! * Math.tan(deflection / 2)
}
/** A lateral's run is longer on the side its branch leans toward. */
function lateralLongSide(doc: IsoDocument, node: PipeNode, runId: string, item?: CatalogItem): number | undefined {
  if (item?.longSideTakeout == null || !node.branchEdgeId) return undefined
  const away = (id: string) => {
    const r = doc.runs.find(x => x.id === id)
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
export function runResult(doc: IsoDocument, run: PipeRun): RunResult {
  const a = getNode(doc, run.from),
    b = getNode(doc, run.to),
    spec = getSpec(doc, run.specId),
    size = spec.sizes.find(s => s.nps === run.nps)
  const overall = distance(a.position, b.position)
  const ts: [number, number] = [
    takeout(doc, a, run.id) ?? NaN,
    takeout(doc, b, run.id) ?? NaN
  ]
  const gaps = [a, b].map((n, i) => {
    if (run.connector || ['end', 'support', 'annotation', 'gasket', 'bolt'].includes(n.kind)) return 0
    const prep = pipePrepAt(doc, run, i)
    // A pipe-to-pipe butt weld splits its root gap; a socket stops the pipe short of its bottom.
    if (prep === 'BW') return (run.rootGap ?? spec.rootGap) / (n.kind === 'weld' ? 2 : 1)
    return prep === 'SW' && n.kind !== 'weld' ? spec.socketGap ?? 0 : 0
  }) as [number, number]
  const cut = overall - ts[0] - ts[1] - gaps[0] - gaps[1]
  return {
    run,
    overall,
    cut,
    takeouts: ts,
    gaps,
    weightKg: size ? (size.kgM * cut) / 1000 : NaN,
    areaM2: size ? (Math.PI * size.od * cut) / 1e6 : NaN
  }
}
export function connected(doc: IsoDocument, nodeId: string): PipeRun[] {
  return doc.runs.filter(r => r.from === nodeId || r.to === nodeId)
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
    const item = code
      ? spec.fittings.find(f => f.component === code && f.nps === header.nps && (!smallerNps || f.smallerNps === smallerNps || smallerNps === header.nps && !f.smallerNps))
      : preferredFitting(spec, kind, header.nps, prepAtNode(header, nodeId), smallerNps)
    node.catalogId = item?.id
    // Without a specification row the standard component still carries its ASME dimensions.
    const fallback = item?.component ?? code ??
      defaultCode(kind, prepAtNode(header, nodeId), kind === 'tee' && smallerNps != null && smallerNps !== header.nps ? 'reducing' : '')
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
    choose('tee', header, branch.nps, lateral ? `${prefix}-${branch.nps === header.nps ? 'LAT' : 'RLAT'}` : undefined)
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
  delete next.fromPrep
  delete next.fromField
  delete next.fromTag
  r.to = node.id
  delete r.toPrep
  delete r.toField
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
  for (const node of doc.nodes) {
    const host = doc.runs.find(r => r.id === node.associatedRunId)
    if (moving.has(node.id) || host && host.id !== runId && moving.has(host.from) && moving.has(host.to))
      node.position = add(node.position, offset)
    else if (node.associatedRunId === runId) {
      const fraction = sub(node.position, a.position).reduce((sum, v, i) => sum + v * delta[i], 0) / (old * old)
      node.position = add(node.position, mul(offset, fraction))
    }
  }
}
/** Change the cut length. The centreline grows or shrinks by the same amount, keeping takeouts and root gaps. */
export function resizeRunToCut(doc: IsoDocument, runId: string, cut: number): void {
  const run = doc.runs.find(r => r.id === runId)
  if (!run || run.connector) throw new Error('Select a pipe to change its length.')
  if (!Number.isFinite(cut) || cut <= 0) throw new Error('Enter a positive cut length.')
  const result = runResult(doc, run)
  const extra = result.takeouts[0] + result.takeouts[1] + result.gaps[0] + result.gaps[1]
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
  return run.description?.toUpperCase() ?? nippleText(getSpec(doc, run.specId), run.nps, n.length ?? runResult(doc, run).cut, n.ends)
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
export function welds(doc: IsoDocument): Weld[] {
  let seq = doc.weldStart
  const out: Weld[] = []
  const unit = (from: Vec3, to: Vec3) => mul(sub(to, from), 1 / (length(sub(to, from)) || 1))
  const numbered = (w: Omit<Weld, 'tag'>, tag?: string) => out.push({ ...w, tag: tag ?? `${doc.weldPrefix}${weldNumber(seq++, doc.weldNumbering)}` })
  // Branch outlets, reinforcing pads and welded supports are welded to the pipe they sit on.
  const attached = (r: PipeRun, from: Vec3) => doc.nodes
    .filter(n => n.associatedRunId === r.id && (n.kind === 'olet' || (n.kind === 'support' && WELDED_SUPPORTS.test(n.component ?? fitting(doc, n)?.component ?? ''))))
    .sort((a, b) => distance(a.position, from) - distance(b.position, from))
  // Numbered in sequence along each spool, from an open end, in the order a fitter meets them.
  const met = new Set<string>()
  let last = ''
  for (const r of [...new Set(doc.runs.map(r => r.spool))].flatMap(spool => routeOrder(doc, doc.runs.filter(r => r.spool === spool)))) {
    // A pipe continues the walk from where the last one ended; a new walk starts at an open end.
    const open = (id: string) => getNode(doc, id).kind !== 'weld' && connected(doc, id).filter(x => x.spool === r.spool).length === 1
    const reversed = r.to === last || (r.from !== last && (open(r.to) !== open(r.from) ? open(r.to) : met.has(r.to) && !met.has(r.from)))
    last = reversed ? r.from : r.to
    met.add(r.from).add(r.to)
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
      if (['end', 'support', 'annotation', 'gasket', 'bolt'].includes(n.kind) || prep === 'FL' || prep === 'THD') continue
      const t = takeout(doc, n, r.id) ?? 0
      const other = getNode(doc, index === 0 ? r.to : r.from)
      const field = (index === 0 ? r.fromField : r.toField) ?? !!n.field
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
      if (n.kind === 'weld' && out.some(w => w.nodeId === n.id)) continue
      const vector = sub(other.position, n.position)
      const position =
        n.kind === 'weld'
          ? n.position
          : add(n.position, mul(vector, (t + (r.connector || prep !== 'BW' ? 0 : runResult(doc, r).gaps[index] / 2)) / (length(vector) || 1)))
      if (r.connector && out.some(w => distance(w.position, position) < 0.001 && w.nps === r.nps)) continue
      const jointEnds = n.kind === 'weld' ? connected(doc, n.id).map(edge => ({
        tag: edge.from === n.id ? edge.fromTag : edge.toTag,
        field: edge.from === n.id ? edge.fromField : edge.toField
      })) : []
      const tag =
        (index === 0 ? r.fromTag : r.toTag) ??
        jointEnds.find(end => end.tag)?.tag ??
        (n.kind === 'weld' ? n.tag : undefined)
      numbered({ runId: r.id, nodeId: n.id, nps: r.nps, field: jointEnds.some(end => end.field) || field, prep, type: prep === 'SW' ? 'SW' : 'BW', position }, tag)
    }
  }
  return out
}
/** The slip-on flange a pipe end is set into: a slip-on flange node, or the slip-on mate of a flanged component. */
function slipOn(doc: IsoDocument, n: PipeNode, run: PipeRun): { setBack: number; hub: number } | undefined {
  const own = nodeItem(doc, n), code = n.component ?? own?.component ?? ''
  const port = COMPONENT_TYPES.find(t => t.code === code)?.endPrep === 'FL'
  const mate = port ? matingFlange(doc, n, run) : n.kind === 'flange' ? { code, item: own } : null
  if (!mate || !/SO$/.test(mate.code)) return undefined
  const setBack = mate.item?.takeout ?? 0
  return { setBack, hub: mate.item?.lengthThroughHub ?? flange(run.nps, mate.item?.rating ?? getSpec(doc, run.specId).rating)?.soLength ?? setBack }
}
/**
 * A pipe piece shorter than the shop cuts, or whose end welds come closer than the specification allows: a butt-welded
 * piece by its cut, a socket-welded one by the pipe showing between the sockets.
 */
function shortPiece(doc: IsoDocument, r: PipeRun, result: RunResult): string | undefined {
  const spec = getSpec(doc, r.specId), minPipe = spec.minPipeLength ?? 50, minWelds = spec.minWeldSpacing ?? 50
  const length = (mm: number) => formatLength(mm, doc.units)
  if (result.cut < minPipe - 0.01)
    return `${r.spool}: a ${r.nps}″ pipe is cut to ${length(result.cut)}, shorter than the ${length(minPipe)} shortest piece allowed. Move the fittings apart, or join them without pipe.`
  const ends = [getNode(doc, r.from), getNode(doc, r.to)], preps = [0, 1].map(i => pipePrepAt(doc, r, i))
  if (ends.some(n => ['end', 'support', 'annotation', 'gasket', 'bolt'].includes(n.kind)) || !preps.every(p => p === 'BW' || p === 'SW')) return undefined
  const clear = result.cut - ends.reduce((sum, n, i) => sum + (preps[i] === 'SW' && n.kind !== 'weld' ? (nodeItem(doc, n)?.socketDepth ?? 0) - result.gaps[i] : 0), 0)
  if (clear < minWelds - 0.01)
    return `${r.spool}: the welds at the ends of a ${r.nps}″ pipe are ${length(clear)} apart, closer than the ${length(minWelds)} allowed. Move the fittings apart.`
  return undefined
}
/** A support is material when it says so, or when the specification supplies it as a row (welded shoes, guides). */
export const supportListed = (doc: IsoDocument, n: PipeNode) => n.inBom ?? !!fitting(doc, n)
/** Plain-language name of a node for fabrication checks, e.g. "flanged ball valve HV-101". */
function itemName(doc: IsoDocument, n: PipeNode): string {
  const type = COMPONENT_TYPES.find(t => t.code === (n.component ?? fitting(doc, n)?.component))
  const name = n.bendAngle ? `${round(n.bendAngle)}° bend` : type?.label ?? ({ end: 'pipe end', weld: 'butt weld', elbow90: '90° elbow', elbow45: '45° elbow' } as Record<string, string>)[n.kind] ?? n.kind
  return name.charAt(0).toLowerCase() + name.slice(1) + (n.tag ? ' ' + n.tag : '')
}
export function validateIso(doc: IsoDocument): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  const where = (n: PipeNode) => {
    const edge = connected(doc, n.id)[0] ?? doc.runs.find(r => r.id === n.associatedRunId)
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
      if (!Number.isFinite(result.cut)) {
        for (const node of [getNode(doc, r.from), getNode(doc, r.to)]) {
          if (takeout(doc, node, r.id) != null) continue
          issues.push(`${r.spool}: the ${itemName(doc, node)} (${r.nps}″) has no standard size and no length in the specification, so the pipe cannot be cut to fit. Enter its centre-to-end length.`)
        }
      }
      else if (!r.connector && result.cut <= 0)
        issues.push(
          `${r.spool}: a ${r.nps}″ pipe is ${formatLength(result.cut, doc.units)} after fitting allowances, so the fittings at its ends overlap. Move them apart or lengthen the pipe.`
        )
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
    if (n.catalogId && !item) issues.push(`${at}the ${name} refers to a specification row that no longer exists. Choose the component again.`)
    if (n.kind === 'tee' && degree === 3 && !n.branchEdgeId)
      issues.push(`${at}three pipes meet without a straight run through the junction. A tee needs two pipes in line with the branch square to them (45° for a lateral).`)
    else if (n.kind === 'tee' && degree === 2)
      issues.push(`${at}the ${name} has no branch pipe. Draw the branch from it, or choose a different component.`)
    else if (ports && degree !== ports && !(n.kind === 'flange' && degree === 1) && !n.associatedRunId)
      issues.push(`${at}the ${name} needs ${ports} connected pipe${ports === 1 ? '' : 's'} but has ${degree}.`)
    if (n.kind === 'end' && degree > 1)
      issues.push(`${at}pipes meet at a point with no fitting. Select the point and choose a fitting.`)
    const edges = connected(doc, n.id)
    if (resolved && resolved.socketDepth == null && resolved.threadEngagement == null && !/effective|engagement|insertion/i.test(resolved.source) &&
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
      const vector = (r: PipeRun) =>
        sub(getNode(doc, r.from === n.id ? r.to : r.from).position, n.position)
      const u = vector(a),
        v = vector(b),
        denominator = length(u) * length(v)
      return denominator
        ? Math.acos(Math.max(-1, Math.min(1, u.reduce((sum, value, i) => sum + value * v[i], 0) / denominator))) * 180 / Math.PI
        : NaN
    }
    if ((n.kind === 'elbow90' || n.kind === 'elbow45') && degree === 2) {
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
  const tags = welds(doc).map(w => w.tag)
  if (new Set(tags).size !== tags.length)
    issues.push('Two welds share a weld number. Renumber one of them.')
  return [...new Set(issues)]
}
export function bom(
  doc: IsoDocument,
  group: 'spool' | 'line' | 'global' = 'spool'
): BomRow[] {
  const map = new Map<string, BomRow>()
  function addRow(row: Omit<BomRow, 'item'>, identity = '', memberId = '') {
    const key = JSON.stringify([
      identity,
      row.description,
      row.spec,
      row.nps,
      row.heat,
      group === 'global' ? '' : row.line,
      group === 'spool' ? row.spool : ''
    ])
    const found = map.get(key)
    if (found) {
      found.memberIds?.push(memberId)
      found.qty += row.qty
      found.cost += row.cost
      found.hours += row.hours
      found.weightKg =
        found.weightKg == null || row.weightKg == null
          ? null
          : found.weightKg + row.weightKg
      found.areaM2 =
        found.areaM2 == null || row.areaM2 == null
          ? null
          : found.areaM2 + row.areaM2
    } else
      map.set(key, {
        ...row,
        materialKey: identity,
        memberIds: [memberId],
        item: map.size + 1
      })
  }
  for (const r of doc.runs.filter(r => !r.connector)) {
    const s = getSpec(doc, r.specId),
      size = s.sizes.find(size => size.nps === r.nps),
      v = runResult(doc, r),
      metres = Number.isFinite(v.cut) && v.cut > 0 ? v.cut / 1000 : NaN
    // A nipple is bought by the piece.
    const nipple = r.nipple ? nippleDescription(doc, r) : undefined
    addRow(
      {
        description: nipple ?? `Pipe · ${size?.material || s.material} · Sch ${size?.schedule || s.schedule}`,
        spec: s.id,
        nps: r.nps,
        qty: nipple ? 1 : metres,
        unit: nipple ? 'ea' : 'm',
        weightKg:
          Number.isFinite(metres) && Number.isFinite(v.weightKg)
            ? v.weightKg
            : null,
        areaM2:
          Number.isFinite(metres) && Number.isFinite(v.areaM2)
            ? v.areaM2
            : null,
        cost: Number.isFinite(metres) ? metres * s.pipeCostM : 0,
        hours: Number.isFinite(metres) ? metres * s.pipeLaborHoursM : 0,
        heat: r.heat,
        spool: r.spool,
        line: r.line
      },
      JSON.stringify([size?.od, size?.wall, size?.kgM, ...(nipple ? ['nipple'] : [])]),
      r.id
    )
  }
  for (const n of doc.nodes.filter(
    n => n.kind !== 'end' && n.kind !== 'weld' && n.kind !== 'annotation'
  )) {
    const edges = connected(doc, n.id), edge = edges[0] ?? doc.runs.find(r => r.id === n.associatedRunId)
    if (!edge || (n.kind === 'support' && !supportListed(doc, n))) continue
    const s = getSpec(doc, edge.specId),
      f = nodeItem(doc, n),
      code = n.component ?? f?.component,
      // A flange between two pieces is a bolted pair of flanges.
      pair = isFlangePair(doc, n)
    // A flange the next drawing supplies is not listed here (its stub end is, with the joint).
    if (n.kind === 'flange' && !pair && n.jointSupply?.flange === false && !/^STUB-END/.test(code ?? '')) continue
    const kg = n.weightKg ?? f?.weightKg,
      area = n.areaM2 ?? f?.areaM2
    // At a spool break each spool lists the flange on its own pipe; anything else spanning it, the owning spool.
    const spools = !spansSpools(doc, n) ? [edge.spool] : pair ? [...new Set(edges.map(r => r.spool))] : [breakOwner(doc, n)]
    for (const spool of spools) {
    const at = edges.find(r => r.spool === spool) ?? edge, qty = n.quantity ?? (pair ? pairFlangesOn(doc, n, spools.length > 1 ? spool : '') : 1)
    if (!qty && n.quantity == null) continue
    addRow(
      {
        description: [n.description ?? f?.description ?? COMPONENT_TYPES.find(t => t.code === code)?.label ?? n.kind, flatSideText(n)].filter(Boolean).join(', '),
        spec: s.id,
        nps: f?.nps ?? Math.max(...edges.map(r => r.nps), edge.nps),
        qty,
        unit: 'ea',
        weightKg: kg == null ? null : kg * qty,
        areaM2: area == null ? null : area * qty,
        cost: (n.unitCost ?? f?.unitCost ?? 0) * qty,
        hours: (n.laborHours ?? f?.laborHours ?? 0) * qty,
        heat: n.heat ?? '',
        spool: at.spool,
        line: at.line
      },
      JSON.stringify([
        n.catalogId ?? f?.id ?? '',
        n.takeout ?? f?.takeout,
        n.branchTakeout ?? f?.branchTakeout,
        kg,
        area,
        n.unitCost ?? f?.unitCost,
        n.laborHours ?? f?.laborHours,
        n.portTakeouts
          ? Object.values(n.portTakeouts).sort((a, b) => a - b)
          : null
      ]),
      n.id
    )
    }
  }
  // Flanged joints supply the mating flanges, stub ends, gaskets and bolting that are not drawn as nodes.
  const supplied = (item: CatalogItem | undefined, fallback: string, qty: number, joint: ReturnType<typeof flangedJoints>[number], description?: string, perUnitKg?: number | null, spool = joint.spool) =>
    addRow({
      description: description ?? item?.description ?? fallback,
      spec: joint.specId,
      nps: joint.nps,
      qty,
      unit: 'ea',
      weightKg: perUnitKg != null ? perUnitKg * qty : item?.weightKg != null ? item.weightKg * qty : null,
      areaM2: null,
      cost: (item?.unitCost ?? 0) * qty,
      hours: (item?.laborHours ?? 0) * qty,
      heat: '',
      spool,
      line: joint.line
    }, description
      ? JSON.stringify([item?.id ?? fallback, description])
      // Supplied flanges merge with the same flange drawn as a node.
      : JSON.stringify([item?.id ?? fallback, item?.takeout, item?.branchTakeout, item?.weightKg, item?.areaM2, item?.unitCost, item?.laborHours, null]), joint.id)
  for (const joint of flangedJoints(doc)) {
    for (const flange of joint.flanges.filter(f => f.implicit)) supplied(flange.item, flange.code, 1, joint)
    joint.stubEnds.forEach((stub, i) =>
      supplied(stub, 'STUB END', 1, joint, undefined, undefined, doc.runs.find(r => r.id === joint.stubRunIds[i])?.spool))
    if (joint.gasket && joint.supplied.gasket) supplied(joint.gasket.item, 'GASKET', 1, joint, undefined, undefined, joint.supplySpool)
    if (joint.bolts && joint.supplied.bolts) {
      const b = joint.bolts, row = b.item
      const size = boltSizeText(b.diameter, b.length)
      supplied(row, 'STUD BOLTS', b.count, joint,
        `${b.kind === 'lug' ? 'LUG BOLTS' : row?.description ?? 'STUD BOLTS C/W 2 NUTS'} ${size}`,
        row?.weightKg != null ? row.weightKg / (row.boltCount ?? b.count) : null, joint.supplySpool)
    }
  }
  return [...map.values()]
}
export function formatLength(mm: number, units: IsoDocument['units']): string {
  if (!Number.isFinite(mm)) return '—'
  if (units === 'mm') return `${round(mm, 1)} mm`
  const sign = mm < 0 ? '−' : ''
  const sixteenths = Math.round((Math.abs(mm) / 25.4) * 16),
    feet = Math.floor(sixteenths / 192),
    inch = Math.floor((sixteenths % 192) / 16),
    fraction = sixteenths % 16
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(fraction, 16)
  return `${sign}${feet ? feet + '′ ' : ''}${inch}${fraction ? ' ' + fraction / g + '/' + 16 / g : ''}″`
}
/** Text for a length field. Millimetres stay a plain number; feet and inches use the drawing's notation. */
export function lengthInputValue(mm: number, units: IsoDocument['units']): string {
  if (!Number.isFinite(mm)) return ''
  if (units === 'mm') return String(round(mm, 6))
  const fractional = formatLength(mm, units)
  // Keep familiar fractions when exact; decimal inches retain catalogue and metric precision.
  return Math.abs(parseLength(fractional, units, true) - mm) < 1e-7
    ? fractional
    : `${round(mm / 25.4, 8)} in`
}
/** Small fabrication allowances must never round down to a displayed zero. */
export function formatAllowance(mm: number, units: IsoDocument['units']): string {
  if (!Number.isFinite(mm)) return '—'
  // Nearest 1/16″ reads like a tape measure; only an allowance that would show as zero keeps decimal inches.
  if (units === 'imperial' && Math.round(Math.abs(mm) / 25.4 * 16) > 0) return formatLength(mm, units)
  return lengthInputValue(mm, units) + (units === 'mm' ? ' mm' : '')
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
export function parseLength(value: string, units: IsoDocument['units'], allowNegative = false): number {
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
    rem = rem.replace(/in\s*$/, '').trim()
    if (!ft && !rem) throw new Error('Enter a length.')
    if (rem) {
      const match = rem.match(/^(?:(\d+(?:\.\d+)?|\.\d+)\s*)?(?:(\d+)\/(\d+))?$/)
      if (!match || (!match[1] && !match[2]) || (match[3] && Number(match[3]) === 0))
        throw new Error("Use millimetres or feet/inches, e.g. 2' 3 1/2\".")
      inch = Number(match[1] ?? 0) + (match[2] ? Number(match[2]) / Number(match[3]) : 0)
    }
    result = (feet * 12 + inch) * (ft || /in\s*$/.test(s) || units === 'imperial' ? 25.4 : 1)
  }
  if (!Number.isFinite(result)) throw new Error('Enter a finite length.')
  return negative ? -result : result
}
export function parseIsoJson(raw: string): IsoDocument {
  if (raw.length > 8_000_000)
    throw new Error('Piping file exceeds the 8 MB limit.')
  const d = JSON.parse(raw) as IsoDocument
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
    d.weldStart < 1 ||
    (d.weldNumbering != null &&
      !['numeric', 'alphabetic'].includes(d.weldNumbering))
  )
    throw new Error('Invalid drawing settings.')
  if (
    d.grid != null &&
    (typeof d.grid.visible !== 'boolean' ||
      typeof d.grid.snap !== 'boolean' ||
      !positive(d.grid.spacing) ||
      d.grid.spacing > 1e7 ||
      !['xy', 'xz', 'yz'].includes(d.grid.plane))
  )
    throw new Error('Invalid isometric grid settings.')
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
  for (const n of d.nodes) {
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
        (n.continuation.coordinates != null && typeof n.continuation.coordinates !== 'boolean'))) ||
      (n.elevationCallout != null && typeof n.elevationCallout !== 'boolean') ||
      (n.dimensioned != null && typeof n.dimensioned !== 'boolean') ||
      (n.inBom != null && typeof n.inBom !== 'boolean') ||
      (n.tiePoint != null && (!isPlain(n.tiePoint) || !isString(n.tiePoint.id, 40) ||
        (n.tiePoint.label != null && !isString(n.tiePoint.label, 120)))) ||
      (n.operator != null && !isString(n.operator, 120)) ||
      (n.calloutText != null && !isString(n.calloutText, 300)) ||
      (n.flatSide != null && !Object.keys(FLAT_DIRECTION).includes(n.flatSide)) ||
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
          (f.bolts == null || typeof f.bolts === 'boolean'))))
    )
      throw new Error('Invalid component callout.')
  }
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
      (d.style.elevations != null && typeof d.style.elevations !== 'boolean'))
  )
    throw new Error('Invalid drawing style.')
  if (
    d.sheets != null &&
    (!isPlain(d.sheets) || Object.keys(d.sheets).length > 1000 ||
      !Object.entries(d.sheets).every(([k, s]) => isString(k) && isPlain(s) &&
        ['drawingNumber', 'lineNumber', 'revision'].every(f => s[f as keyof SheetInfo] == null || isString(s[f as keyof SheetInfo], 120)) &&
        (s.bomOrder == null || (Array.isArray(s.bomOrder) && s.bomOrder.length <= 500 && s.bomOrder.every(k => isString(k, 2000))))))
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
        Array.isArray(s.at) && s.at.length === 2 && s.at.every(finite)))
  )
    throw new Error('Invalid sheet note.')
  const specs = new Set<string>(),
    catalogs = new Set<string>()
  for (const s of d.specs) {
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
    for (const z of s.sizes) {
      if (
        ![z.nps, z.od, z.wall, z.kgM].every(positive) ||
        z.wall * 2 >= z.od ||
        (z.bomDescription != null && !isString(z.bomDescription)) ||
        sizes.has(z.nps)
      )
        throw new Error('Invalid or duplicate pipe size.')
      sizes.add(z.nps)
    }
    for (const f of s.fittings) {
      if (
        !isString(f.id) ||
        !f.id ||
        catalogs.has(f.id) ||
        !knownKinds.includes(f.kind) ||
        !positive(f.nps) ||
        (f.smallerNps != null && !positive(f.smallerNps)) ||
        (f.takeoutMissing != null && typeof f.takeoutMissing !== 'boolean') ||
        !nonnegative(f.takeout) ||
        !isString(f.description) ||
        !isString(f.source) ||
        ['component', 'rating', 'schedule', 'partCode', 'material', 'manufacturer', 'bomDescription'].some(
          k => f[k as keyof CatalogItem] != null && !isString(f[k as keyof CatalogItem])
        ) ||
        (f.shopField != null && !['S', 'F'].includes(f.shopField)) ||
        (f.takeoutReference != null && f.takeoutReference !== 'header-outside' && f.takeoutReference !== 'header-centre') ||
        !optionalNumbers(f, [
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
  for (const r of d.runs) {
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
    for (const key of ['connector', 'fromField', 'toField', 'uncut'])
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
  for (const n of d.nodes) {
    if (n.associatedRunId && !runs.has(n.associatedRunId))
      throw new Error('Attachment refers to a missing pipe.')
    if (
      n.branchEdgeId &&
      !connected(d, n.id).some(r => r.id === n.branchEdgeId)
    )
      throw new Error('Tee branch must be a connected pipe.')
  }
  return d
}
export function csv(rows: unknown[][]): string {
  return rows
    .map(row =>
      row
        .map(v => {
          let s = String(v ?? '')
          if (/^[=+@\-]/.test(s)) s = "'" + s
          return '"' + s.replace(/"/g, '""') + '"'
        })
        .join(',')
    )
    .join('\r\n')
}
/** Remove an inline component without losing either outer connection's fabrication data. */
export function removeComponent(doc: IsoDocument, nodeId: string): void {
  const node = getNode(doc, nodeId), edges = connected(doc, nodeId);
  if (node.associatedRunId || edges.length === 0) { doc.nodes = doc.nodes.filter(n => n.id !== nodeId); return; }
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
    fromTag: a[fromIndex === 0 ? 'fromTag' : 'toTag'],
    toTag: b[toIndex === 0 ? 'fromTag' : 'toTag'],
  };
  a.from=farA; a.to=farB; Object.assign(a,outer);
  for (const n of doc.nodes) {
    if (n.associatedRunId === b.id) n.associatedRunId = a.id;
    if (n.portTakeouts?.[b.id] != null) { n.portTakeouts[a.id]=n.portTakeouts[b.id]; delete n.portTakeouts[b.id]; }
    if (n.branchEdgeId === b.id) n.branchEdgeId=a.id;
  }
  doc.runs=doc.runs.filter(r=>r.id!==b.id);
  doc.nodes=doc.nodes.filter(n=>n.id!==nodeId);
}
