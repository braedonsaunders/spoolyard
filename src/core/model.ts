import type { GridSettings } from './grid'
import { COMPONENT_TYPES } from './components'
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
  density: number
  pipeCostM: number
  weldHoursPerDiameterInch: number
  pipeLaborHoursM: number
  service?: string
  revision?: string
  /** Free-form specification parameters, e.g. flange face, bolt type, small-bore start size. */
  parameters?: Record<string, string>
  branchChart?: Array<{ run: number; branch: number; code: string }>
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
    dimensionMode: 'both',
    specs: [defaultSpec()],
    nodes: [],
    runs: [],
    weldStart: 1,
    weldPrefix: 'W'
  }
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
  const item = fitting(doc, node)
  if (node.branchEdgeId === runId)
    return node.branchTakeout ?? (item?.takeoutMissing ? undefined : item?.branchTakeout)
  // A specification row without a known dimension must be measured, never read as zero.
  return node.takeout ?? (item?.takeoutMissing ? undefined : item?.takeout)
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
  const gaps: [number, number] = [a, b].map((n, i) =>
    !run.connector && prepAt(run, i) === 'BW' &&
    n.kind !== 'end' &&
    n.kind !== 'support' &&
    n.kind !== 'annotation' &&
    n.kind !== 'gasket' &&
    n.kind !== 'bolt'
      ? (run.rootGap ?? spec.rootGap) / (n.kind === 'weld' ? 2 : 1)
      : 0
  ) as [number, number]
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
  if (!['end', 'weld', 'elbow90', 'elbow45', 'tee'].includes(node.kind)) return
  const vectors = edges.map(r => sub(getNode(doc, r.from === nodeId ? r.to : r.from).position, node.position))
  const cosine = (i: number, j: number) => vectors[i].reduce((sum, v, k) => sum + v * vectors[j][k], 0) / (length(vectors[i]) * length(vectors[j]))
  const changeKind = (kind: Kind) => {
    if (node.kind === kind) return
    node.kind = kind
    for (const key of ['catalogId', 'component', 'takeout', 'branchTakeout', 'portTakeouts', 'branchEdgeId', 'description', 'bendAngle'] as const) delete node[key]
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
    if (item?.component) node.component = item.component
    else delete node.component
  }
  if (edges.length <= 1) {
    changeKind('end')
  } else if (edges.length === 2) {
    const angle = Math.acos(Math.max(-1, Math.min(1, cosine(0, 1)))) * 180 / Math.PI
    if (Math.abs(angle - 180) < 0.1) {
      changeKind('weld')
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
    const branchIndex = vectors.findIndex((_, i) => {
      const main = [0, 1, 2].filter(j => j !== i)
      return cosine(main[0], main[1]) < -0.999999
    })
    const branch = edges[branchIndex]
    node.branchEdgeId = branch?.id
    if (!branch) { delete node.catalogId; return }
    const header = edges.find(r => r !== branch)!
    const branchAngle = Math.acos(Math.max(-1, Math.min(1, Math.abs(cosine(branchIndex, edges.indexOf(header)))))) * 180 / Math.PI
    const prefix = prepAtNode(header, nodeId) === 'SW' ? 'SW' : prepAtNode(header, nodeId) === 'THD' ? 'SC' : 'W'
    const lateral = Math.abs(branchAngle - 45) < 0.1
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
  node.description = row ? undefined : type.label
  delete node.takeout
  delete node.branchTakeout
  delete node.portTakeouts
  delete node.bendAngle
  const edges = connected(doc, node.id)
  for (const [index, run] of edges.entries()) {
    const prep = node.kind === 'flange' && index > 0 ? 'FL' : type.endPrep
    if (prep) run[run.from === node.id ? 'fromPrep' : 'toPrep'] = prep
    // Flange nodes locate the mating face: its length is consumed on the pipe side only.
    if (node.kind === 'flange' && index > 0) {
      node.portTakeouts ??= {}
      node.portTakeouts[run.id] = 0
    }
  }
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
export function welds(doc: IsoDocument): Weld[] {
  let seq = doc.weldStart
  const out: Weld[] = []
  for (const r of doc.runs) {
    for (const [index, key] of [r.from, r.to].entries()) {
      const n = getNode(doc, key)
      if (
        n.kind === 'end' ||
        n.kind === 'support' ||
        n.kind === 'annotation' ||
        n.kind === 'gasket' ||
        n.kind === 'bolt' ||
        prepAt(r, index) === 'PLAIN' ||
        prepAt(r, index) === 'FL' ||
        prepAt(r, index) === 'THD'
      )
        continue
      // A zero-length butt joint represented as a WELD node gets one weld, not two.
      if (n.kind === 'weld' && out.some(w => w.nodeId === n.id)) continue
      const t = takeout(doc, n, r.id) ?? 0
      const other = getNode(doc, index === 0 ? r.to : r.from)
      const vector = sub(other.position, n.position)
      const position =
        n.kind === 'weld'
          ? n.position
          : add(
              n.position,
              mul(
                vector,
                (t + (r.connector ? 0 : runResult(doc, r).gaps[index] / 2)) /
                  (length(vector) || 1)
              )
            )
      if (
        r.connector &&
        out.some(w => distance(w.position, position) < 0.001 && w.nps === r.nps)
      )
        continue
      const jointEnds = n.kind === 'weld' ? connected(doc, n.id).map(edge => ({
        tag: edge.from === n.id ? edge.fromTag : edge.toTag,
        field: edge.from === n.id ? edge.fromField : edge.toField
      })) : []
      const tag =
        (index === 0 ? r.fromTag : r.toTag) ??
        jointEnds.find(end => end.tag)?.tag ??
        (n.kind === 'weld' ? n.tag : undefined)
      out.push({
        tag: tag ?? `${doc.weldPrefix}${weldNumber(seq++, doc.weldNumbering)}`,
        runId: r.id,
        nodeId: n.id,
        nps: r.nps,
        field: jointEnds.some(end => end.field) || ((index === 0 ? r.fromField : r.toField) ?? !!n.field),
        prep: prepAt(r, index),
        position
      })
    }
  }
  return out
}
export function validateIso(doc: IsoDocument): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const n of doc.nodes) {
    if (seen.has(n.id)) issues.push('Duplicate connection ID.')
    seen.add(n.id)
    if (n.position.some(v => !Number.isFinite(v)))
      issues.push('Invalid connection coordinate.')
  }
  for (const r of doc.runs) {
    try {
      const result = runResult(doc, r),
        spec = getSpec(doc, r.specId)
      if (!spec.sizes.some(s => s.nps === r.nps))
        issues.push(`${r.spool}: NPS ${r.nps} is missing from ${spec.name}.`)
      if (!Number.isFinite(result.cut))
        issues.push(
          `${r.spool}: Enter fitting takeouts for ${getNode(doc, r.from).kind}/${getNode(doc, r.to).kind}.`
        )
      else if (!r.connector && result.cut <= 0)
        issues.push(
          `${r.spool}: Pipe cut length is ${formatLength(result.cut, doc.units)}; check measurements and takeouts.`
        )
      if (!r.spool.trim()) issues.push('Every pipe needs a spool number.')
    } catch (e) {
      issues.push(String(e))
    }
  }
  for (const n of doc.nodes) {
    const degree = connected(doc, n.id).length
    const item = fitting(doc, n)
    const component = COMPONENT_TYPES.find(t => t.code === (n.component ?? item?.component))
    const ports = component?.ports ?? (n.kind === 'tee' ? 3 : ['valve', 'reducer', 'elbow90', 'elbow45', 'weld'].includes(n.kind) ? 2 : n.kind === 'cap' ? 1 : undefined)
    if (n.catalogId && !item) issues.push('A selected catalogue fitting is missing from the specification.')
    if (ports && degree !== ports && !(n.kind === 'flange' && degree === 1) && !n.associatedRunId)
      issues.push(`${component?.label ?? n.kind} needs ${ports} connected pipe${ports === 1 ? '' : 's'}.`)
    if (n.kind === 'end' && degree > 1)
      issues.push('An open end cannot join multiple pipes; select a fitting.')
    if (
      (n.kind === 'valve' ||
        n.kind === 'reducer' ||
        n.kind.startsWith('elbow')) &&
      degree !== (ports ?? 2)
    )
      issues.push(`${n.kind} needs two connected pipes.`)
    if (n.kind === 'tee' && degree === 3 && !n.branchEdgeId)
      issues.push('Select the branch pipe for each tee.')
    const edges = connected(doc, n.id)
    if (item && !/effective|engagement|insertion/i.test(item.source) && edges.some(r => ['SW', 'THD'].includes(prepAtNode(r, n.id)) && n.takeout == null && n.portTakeouts?.[r.id] == null))
      issues.push(`${item.description}: enter an effective takeout including socket or thread engagement.`)
    if (item && edges.length) {
      const sizes = [...new Set(edges.map(r => r.nps))].sort((a, b) => b - a)
      const expected = [...new Set([item.nps, item.smallerNps ?? item.nps])].sort((a, b) => b - a)
      if (sizes.length !== expected.length || sizes.some((size, i) => size !== expected[i]))
        issues.push(`${item.description}: fitting sizes do not match the connected pipes.`)
      if (edges.some(r => !getSpec(doc, r.specId).fittings.some(f => f.id === item.id)))
        issues.push(`${item.description}: fitting is outside the connected pipe specification.`)
    } else if (['elbow90', 'elbow45', 'weld'].includes(n.kind) && new Set(edges.map(r => r.nps)).size > 1)
      issues.push(`${n.kind}: different pipe sizes require a reducing fitting.`)
    if (n.kind === 'weld' && degree === 2) {
      const tags = edges.map(r => r.from === n.id ? r.fromTag : r.toTag).filter(Boolean)
      if (new Set(tags).size > 1) issues.push('A shared weld has conflicting tags on its two pipe ends.')
      if (prepAtNode(edges[0], n.id) !== prepAtNode(edges[1], n.id))
        issues.push('A shared weld has conflicting end preparations.')
      if ((edges[0].rootGap ?? getSpec(doc, edges[0].specId).rootGap) !== (edges[1].rootGap ?? getSpec(doc, edges[1].specId).rootGap))
        issues.push('A shared weld has conflicting root gaps.')
    }
    const angleBetween = (a: PipeRun, b: PipeRun) => {
      const vector = (r: PipeRun) =>
        sub(getNode(doc, r.from === n.id ? r.to : r.from).position, n.position)
      const u = vector(a),
        v = vector(b),
        denominator = length(u) * length(v)
      return denominator
        ? (Math.acos(
            Math.max(
              -1,
              Math.min(
                1,
                u.reduce((sum, value, i) => sum + value * v[i], 0) / denominator
              )
            )
          ) *
            180) /
            Math.PI
        : NaN
    }
    if ((n.kind === 'elbow90' || n.kind === 'elbow45') && degree === 2) {
      const bend = 180 - angleBetween(edges[0], edges[1]),
        expected = n.bendAngle ?? (n.kind === 'elbow90' ? 90 : 45)
      if (!Number.isFinite(bend) || Math.abs(bend - expected) > 1)
        issues.push(
          `${n.kind}: connected directions must form a ${expected} degree bend.`
        )
    }
    if (
      ['valve', 'reducer', 'weld', 'flange', 'gasket'].includes(n.kind) &&
      degree === 2 &&
      Math.abs(angleBetween(edges[0], edges[1]) - 180) > 1
    )
      issues.push(`${n.kind}: the two pipe connections must be in line.`)
    if (n.kind === 'tee' && degree === 3 && n.branchEdgeId) {
      const main = edges.filter(r => r.id !== n.branchEdgeId),
        branch = edges.find(r => r.id === n.branchEdgeId)
      const expected = /LAT$/.test(component?.code ?? '') ? 45 : 90
      if (
        !branch || main.length !== 2 ||
        Math.abs(angleBetween(main[0], main[1]) - 180) > 1 ||
        Math.abs(Math.min(angleBetween(main[0], branch), angleBetween(main[1], branch)) - expected) > 1
      )
        issues.push(
          `Tee: main pipes must be in line and the branch at ${expected} degrees.`
        )
      if (branch && item && (branch.nps !== (item.smallerNps ?? item.nps) || main.some(r => r.nps !== item.nps)))
        issues.push('Tee: header and branch sizes do not match the fitting ports.')
    }
    if (n.kind === 'tee' && degree === 4) {
      const opposite = edges.slice(1).find(r => Math.abs(angleBetween(edges[0], r) - 180) < 1)
      const other = edges.filter(r => r !== edges[0] && r !== opposite)
      if (!opposite || other.length !== 2 || Math.abs(angleBetween(other[0], other[1]) - 180) > 1 || Math.abs(angleBetween(edges[0], other[0]) - 90) > 1)
        issues.push('Cross: connections must form two perpendicular straight headers.')
    }
    if (
      n.kind === 'reducer' &&
      degree === 2 &&
      connected(doc, n.id)[0].nps === connected(doc, n.id)[1].nps
    )
      issues.push('Reducer connections must use different pipe sizes.')
  }
  const tags = welds(doc).map(w => w.tag)
  if (new Set(tags).size !== tags.length)
    issues.push('Weld tags must be unique.')
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
    addRow(
      {
        description: `Pipe · ${size?.material || s.material} · Sch ${size?.schedule || s.schedule}`,
        spec: s.id,
        nps: r.nps,
        qty: metres,
        unit: 'm',
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
      JSON.stringify([size?.od, size?.wall, size?.kgM]),
      r.id
    )
  }
  for (const n of doc.nodes.filter(
    n => n.kind !== 'end' && n.kind !== 'weld' && n.kind !== 'annotation'
  )) {
    const edge =
      connected(doc, n.id)[0] ?? doc.runs.find(r => r.id === n.associatedRunId)
    if (!edge) continue
    const s = getSpec(doc, edge.specId),
      f = fitting(doc, n),
      qty = n.quantity ?? 1
    const kg = n.weightKg ?? f?.weightKg,
      area = n.areaM2 ?? f?.areaM2
    addRow(
      {
        description: n.description ?? f?.description ?? n.kind,
        spec: s.id,
        nps: f?.nps ?? Math.max(...connected(doc, n.id).map(r => r.nps), edge.nps),
        qty,
        unit: 'ea',
        weightKg: kg == null ? null : kg * qty,
        areaM2: area == null ? null : area * qty,
        cost: (n.unitCost ?? f?.unitCost ?? 0) * qty,
        hours: (n.laborHours ?? f?.laborHours ?? 0) * qty,
        heat: n.heat ?? '',
        spool: edge.spool,
        line: edge.line
      },
      JSON.stringify([
        n.catalogId ?? '',
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
  if (units === 'mm') return String(round(mm, 3))
  return formatLength(mm, units)
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
        'bendAngle'
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
  }
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
          !Object.entries(s.parameters).every(([k, v]) => isString(k, 200) && isString(v))))
    )
      throw new Error('Invalid pipe specification parameters.')
    const sizes = new Set<number>()
    for (const z of s.sizes) {
      if (
        ![z.nps, z.od, z.wall, z.kgM].every(positive) ||
        z.wall * 2 >= z.od ||
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
        ['component', 'rating', 'schedule', 'partCode', 'material', 'manufacturer'].some(
          k => f[k as keyof CatalogItem] != null && !isString(f[k as keyof CatalogItem])
        ) ||
        (f.shopField != null && !['S', 'F'].includes(f.shopField)) ||
        !optionalNumbers(f, [
          'branchTakeout',
          'weightKg',
          'areaM2',
          'unitCost',
          'laborHours'
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
    for (const key of ['connector', 'fromField', 'toField'])
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
export function bomCsv(
  doc: IsoDocument,
  group: 'spool' | 'line' | 'global' = 'spool'
): string {
  return csv([
    [
      'Item',
      'Description',
      'Spec',
      'NPS',
      'Quantity',
      'Unit',
      'Weight kg',
      'Surface m2',
      'Cost',
      'Labor hours',
      'Heat',
      'Spool',
      'Line'
    ],
    ...bom(doc, group).map(r => [
      r.item,
      r.description,
      r.spec,
      r.nps,
      Number.isFinite(r.qty) ? round(r.qty, 3) : 'MISSING',
      r.unit,
      r.weightKg == null ? 'MISSING' : round(r.weightKg),
      r.areaM2 == null ? 'MISSING' : round(r.areaM2, 3),
      round(r.cost),
      round(r.hours),
      r.heat,
      r.spool,
      r.line
    ])
  ])
}
export function cutCsv(doc: IsoDocument): string {
  const length = (mm: number) =>
    doc.units === 'mm' ? round(mm) : formatLength(mm, doc.units)
  const suffix = doc.units === 'mm' ? ' mm' : ''
  return csv([
    [
      'Pipe',
      'Spool',
      'Line',
      'NPS',
      'Spec',
      'Overall' + suffix,
      'Start takeout' + suffix,
      'End takeout' + suffix,
      'Start gap' + suffix,
      'End gap' + suffix,
      'Cut' + suffix,
      'Heat',
      'Start preparation',
      'End preparation'
    ],
    ...doc.runs
      .filter(r => !r.connector)
      .map(r => {
        const c = runResult(doc, r)
        return [
          r.id,
          r.spool,
          r.line,
          r.nps,
          r.specId,
          length(c.overall),
          ...c.takeouts.map(v => Number.isFinite(v) ? length(v) : 'MISSING'),
          ...c.gaps.map(length),
          Number.isFinite(c.cut) && c.cut > 0 ? length(c.cut) : 'MISSING',
          r.heat,
          prepAt(r, 0),
          prepAt(r, 1)
        ]
      })
  ])
}
export function weldCsv(doc: IsoDocument): string {
  return csv([
    [
      'Weld',
      'Spool',
      'Line',
      'NPS',
      'Location',
      'End preparation',
      'Diameter inches'
    ],
    ...welds(doc).map(w => {
      const r = doc.runs.find(r => r.id === w.runId)!
      return [
        w.tag,
        r.spool,
        r.line,
        w.nps,
        w.field ? 'Field' : 'Shop',
        w.prep,
        w.nps
      ]
    })
  ])
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
