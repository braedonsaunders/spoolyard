import { COMPONENT_TYPES } from './components'
import { formatLength, sizeText } from './format'
import { materialWarnings, packageSpools } from './material-list'
import { materialSchedule } from './schedules'
import {
  branchConnection, connected, eccentricMisalignment, fitting, getNode, getSpec, itemName, pipePrepAt, recommendedWeldSpacing, runResult,
  validateIso, weldClearance, welds, weldsAlong, type IsoDocument, type PipeNode
} from './model'
import { dimensionIssues, nodeItem } from './joints'

/** A finding of the fabrication review. Errors stop the cut list; warnings ask the drafter to confirm an assumption. */
export interface Issue { severity: 'error' | 'warning'; message: string }

/**
 * The thread of each threaded component type's ends (ASME B16.11 and the valve standards): plugs and nipples are male;
 * caps, couplings, unions, threaded fittings, outlets, flanges and valves are female. Threaded pipe ends are male. Types
 * whose ends differ or vary by maker (male × female needle valves, relief valves, hoses, adaptors) are not listed.
 */
export const THREAD_GENDER: Readonly<Record<string, 'male' | 'female'>> = {
  PLUG: 'male', NIPPLE: 'male',
  ...Object.fromEntries(['SC-90ELL', 'SC-45ELL', 'SC-TEE', 'SC-RTEE', 'SC-CRS', 'SC-RCRS', 'SC-LAT', 'SC-RLAT', 'R-CPLGSC', 'SC-CAP',
    'F-CPLGSC', 'UNION-SC', 'H-CPLGSC', 'TOL', 'SC-EOL', 'FLG-RFSC', 'FLG-FFSC', 'ORFCRFSC', 'ORFCRJSC', 'GATE-SC', 'GLOBE-SC',
    'BALL-SC', 'CHECK-SC', 'PLUG-SC', 'ANGL-SC', 'NEEDL-SC', '3WAY-SC', '4WAY-SC'].map(code => [code, 'female' as const]))
}
const threadOf = (doc: IsoDocument, n: PipeNode) => THREAD_GENDER[n.component ?? fitting(doc, n)?.component ?? '']

const where = (doc: IsoDocument, n: PipeNode) => {
  const edge = connected(doc, n.id)[0] ?? doc.runs.find(r => r.id === n.associatedRunId)
  return edge?.spool ? edge.spool + ': ' : ''
}
/**
 * Assumptions and drafting choices a checker should see, none of which stops fabrication: pieces longer than stock,
 * cells printed as issued that differ from the model, standard dimensions standing in for missing specification
 * data, unset socket-weld gaps, eccentric reducers drawn without their offset, close welds, branch-table departures and
 * pipe weights that disagree with the pipe's dimensions.
 */
export function fabricationWarnings(doc: IsoDocument): string[] {
  const out: string[] = []
  // A drawing whose pipes do not resolve has errors to fix first; its warnings wait for them.
  try { out.push(...materialWarnings(doc)) } catch { return [] }
  // Built-in standard dimensions that had to assume a class, face, pattern, body, wall or gasket the specification lacks.
  out.push(...dimensionIssues(doc))
  // Socket-weld gaps the specification leaves to the default.
  const socketSpecs = new Set(doc.runs.filter(r => [0, 1].some(i => pipePrepAt(doc, r, i) === 'SW')).map(r => r.specId))
  for (const id of socketSpecs) {
    const spec = getSpec(doc, id)
    if (spec.socketGap == null)
      out.push(`Specification ${spec.name} sets no socket-weld gap; 1/16" (1.6 mm) is allowed at each socket (ASME B31.3 Fig. 328.5.2C). Set the gap in the specification to confirm it.`)
  }
  const assumed = new Set<string>()
  for (const n of doc.nodes) {
    const at = where(doc, n), name = itemName(doc, n)
    const off = eccentricMisalignment(doc, n)
    if (off > 0.5)
      out.push(`${at}the ${name} has its flat on the ${n.flatSide}, which moves the small pipe ${formatLength(off, doc.units)} across, but the pipes beyond it are drawn on the large end's centreline: their elevations and coordinates are out by that much. Set the flat side again to move them.`)
    // A specification row without a takeout: the built-in standard dimension stands in for it.
    const own = fitting(doc, n), item = nodeItem(doc, n)
    if (own?.takeoutMissing && item && item !== own && n.takeout == null && !n.portTakeouts && !assumed.has(own.id)) {
      assumed.add(own.id)
      out.push(`${at}the ${name} (${sizeText(own.nps, own.smallerNps)}) has no dimension in its specification row; the standard ${item.source.split(';')[0]} dimension is assumed. Confirm it against the manufacturer's data or enter the takeout.`)
    }
    const edges = connected(doc, n.id)
    // Threads screwed together are one male and one female: a male part on a (male) threaded pipe end, or two female
    // parts screwed straight together with no nipple, cannot be made up.
    const thread = threadOf(doc, n)
    for (const r of thread ? edges : []) {
      const other = r.connector ? getNode(doc, r.from === n.id ? r.to : r.from) : undefined
      const mate = other ? threadOf(doc, other) : pipePrepAt(doc, r, r.from === n.id ? 0 : 1) === 'THD' ? 'male' : undefined
      if (mate !== thread || (other && doc.nodes.indexOf(other) < doc.nodes.indexOf(n))) continue
      out.push(other
        ? `${at}the ${name} and the ${itemName(doc, other)} are both ${thread}-threaded and are screwed straight together. A ${thread === 'male' ? 'female fitting (a coupling)' : 'nipple'} is needed between them.`
        : `${at}the ${name} is male-threaded, as is the threaded pipe end it is screwed onto. Use a female-threaded part there (a cap or a coupling), or confirm the pipe end.`)
    }
    // A square branch the specification's branch table gives another connection for.
    // A tee's branch is one of its three pipes; an olet's is the one pipe routed from it, its header the pipe it sits on.
    const teeBranch = n.kind === 'tee' && n.branchEdgeId && edges.length === 3
    const oletHeader = n.kind === 'olet' && edges.length === 1 ? doc.runs.find(r => r.id === n.associatedRunId) : undefined
    if (teeBranch || oletHeader) {
      const branch = teeBranch ? edges.find(r => r.id === n.branchEdgeId)! : edges[0], header = oletHeader ?? edges.find(r => r !== branch)!
      const want = branchConnection(getSpec(doc, header.specId), header.nps, branch.nps)
      const code = n.component ?? own?.component ?? ''
      if (want && !/LAT$/.test(code) && !(want === 'TEE' || want === 'RTEE' ? code.endsWith('-' + want) : code === want)) {
        const label = COMPONENT_TYPES.find(t => t.code === want)?.label ?? (want === 'STUB-IN' ? 'stub-in' : want === 'RTEE' ? 'reducing tee' : want === 'TEE' ? 'tee' : want)
        out.push(`${at}specification ${getSpec(doc, header.specId).name} branches ${sizeText(header.nps, branch.nps)} with a ${label.toLowerCase()}, but a ${name} is drawn. Choose the specification's branch connection, or confirm the departure.`)
      }
    }
  }
  // Welds closer than the size-based spacing, where the specification gives none.
  for (const r of doc.runs) {
    const spec = getSpec(doc, r.specId)
    if (r.connector || r.nipple || r.uncut || spec.minWeldSpacing != null) continue
    const ends = [getNode(doc, r.from), getNode(doc, r.to)]
    if (ends.some(n => ['end', 'support', 'annotation', 'gasket', 'bolt'].includes(n.kind)) || ![0, 1].every(i => ['BW', 'SW'].includes(pipePrepAt(doc, r, i)))) continue
    let clear = NaN
    try { clear = weldClearance(doc, r, runResult(doc, r)) } catch { continue }
    const want = recommendedWeldSpacing(doc, r)
    if (Number.isFinite(clear) && clear >= 50 - 0.01 && clear < want - 0.01)
      out.push(`${r.spool}: the welds at the ends of a ${sizeText(r.nps)} pipe are ${formatLength(clear, doc.units)} apart, closer than one pipe diameter (${formatLength(want, doc.units)}). Move the fittings apart, or set the least weld spacing in specification ${spec.name}.`)
  }
  // Branch-outlet and attachment welds against every other weld on their pipe: the specification's least spacing,
  // else the size-based one (the pipe's outside diameter, at least 50 mm).
  for (const r of doc.runs) {
    if (r.connector || r.nipple) continue
    let along: ReturnType<typeof weldsAlong> = []
    try { along = weldsAlong(doc, r) } catch { continue }
    if (!along.some(w => w.kind !== 'end')) continue
    const spec = getSpec(doc, r.specId), want = spec.minWeldSpacing ?? recommendedWeldSpacing(doc, r)
    const label = (w: (typeof along)[number]) => {
      const n = getNode(doc, w.nodeId), name = itemName(doc, n)
      return w.kind === 'branch' ? `branch weld of the ${name}` : w.kind === 'attachment' ? `attachment weld of the ${name}` : `weld at the ${name}`
    }
    for (const [i, x] of along.entries())
      for (const y of along.slice(i + 1)) {
        if (x.kind === 'end' && y.kind === 'end' || x.kind === 'attachment' && y.kind === 'attachment' || x.nodeId === y.nodeId) continue
        const clear = Math.max(x.from, y.from) - Math.min(x.to, y.to)
        if (!Number.isFinite(clear) || clear >= want - 0.01) continue
        const [first, second] = x.kind === 'end' ? [y, x] : [x, y]
        const text = clear <= 0.01 ? `overlaps the ${label(second)}` : `is ${formatLength(clear, doc.units)} from the ${label(second)}`
        out.push(`${r.spool}: on a ${sizeText(r.nps)} pipe the ${label(first)} ${text}, closer than ${spec.minWeldSpacing != null ? `the ${formatLength(want, doc.units)} specification ${spec.name} allows` : `one pipe diameter (${formatLength(want, doc.units)})`}. Move it along the pipe${spec.minWeldSpacing != null ? '' : `, or set the least weld spacing in specification ${spec.name}`}.`)
      }
  }
  // Pipe weight per metre of the sizes drawn, against the steel the outside diameter, wall and density give.
  for (const spec of doc.specs) for (const size of spec.sizes.filter(z => doc.runs.some(r => r.specId === spec.id && r.nps === z.nps))) {
    const expected = Math.PI * (size.od - size.wall) * size.wall * spec.density / 1e6
    if (Math.abs(size.kgM - expected) > 0.05 * expected)
      out.push(`Specification ${spec.name}: ${sizeText(size.nps)} pipe weighs ${size.kgM.toFixed(2)} kg/m, but its ${size.od} mm OD, ${size.wall} mm wall and ${spec.density} kg/m³ density give ${expected.toFixed(2)} kg/m. Check the weight, wall or density.`)
  }
  // Labour the specifications give no rate for: the labour summary counts it as no hours.
  const weldSpecs = new Set<string>()
  try { for (const w of welds(doc)) { const r = doc.runs.find(x => x.id === w.runId); if (r) weldSpecs.add(r.specId) } } catch { /* reported by validation */ }
  for (const spec of doc.specs.filter(s => doc.runs.some(r => r.specId === s.id && !r.connector))) {
    const missing = [
      ...(weldSpecs.has(spec.id) && !(spec.weldHoursPerDiameterInch > 0) ? ['weld hours per diameter-inch'] : []),
      ...(!(spec.pipeLaborHoursM > 0) ? ['pipe hours per metre'] : [])
    ]
    if (missing.length)
      out.push(`Specification ${spec.name} has no labour rates for ${missing.join(' or ')}; the labour summary counts ${missing.length > 1 ? 'them' : 'it'} as 0 hours. Enter the rates in the specification for a labour estimate.`)
  }
  // Items listed without a weight: the weight totals leave them out.
  try {
    const unweighed = materialSchedule(doc).filter(r => r.weightKg == null)
    for (const spool of packageSpools(doc)) {
      const rows = unweighed.filter(r => r.spool === spool)
      if (rows.length)
        out.push(`${spool}: ${rows.length === 1 ? 'item' : 'items'} ${rows.map(r => `${r.id} (${r.text})`).join(', ')} ${rows.length === 1 ? 'has' : 'have'} no weight, so the spool's weight totals are incomplete. Enter the weights in the specification or on the items.`)
    }
  } catch { /* reported by validation */ }
  return [...new Set(out)]
}
/** The whole fabrication review: errors (as `validateIso`) then warnings. */
export function reviewIso(doc: IsoDocument): Issue[] {
  return [
    ...validateIso(doc).map(message => ({ severity: 'error' as const, message })),
    ...fabricationWarnings(doc).map(message => ({ severity: 'warning' as const, message }))
  ]
}
