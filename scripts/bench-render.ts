// Edit-to-drawing benchmark: how long a committed edit takes to produce the new sheet, case by case.
// Usage: pnpm exec tsx scripts/bench-render.ts [--runs N] [--case name] [--snapshot out.json] [--write dir]
// Every drawing is invented (synthetic jobs built here, plus the public sample), and ids are seeded, so runs compare.
// --write <dir> saves each case as a .piping file, to open in the editor and time edits in the browser.
// --snapshot writes a hash of every case's primitives, SVG, labels, notices and schedules, to check that a change to the
// drafting code leaves its output byte-identical.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Seeded ids: the same drawing every run.
let seq = 0
const seeded = () => `00000000-0000-4000-8000-${(seq++).toString(16).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`
Object.defineProperty(globalThis.crypto, 'randomUUID', { value: seeded, configurable: true })

const { createDrawing, drawingSvg } = await import('../src/core/drawing.ts')
const model = await import('../src/core/model.ts')
const { appendRun, applyComponent, attachComponent, clone, insertComponent, newIso, parseIsoJson, runResult, validateIso } = model
const { reviewIso } = await import('../src/core/review.ts')
const { cutSchedule, materialSchedule, weldSchedule } = await import('../src/core/schedules.ts')
type IsoDocument = import('../src/core/model.ts').IsoDocument

const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const RUNS = Number(flag('--runs') ?? 7)
const only = flag('--case')
const snapshotFile = flag('--snapshot')
const writeDir = flag('--write')

/**
 * A synthetic spool: a header with a branch off every tee (a riser with a flanged valve, a level run, then a drop or a
 * rolling offset), olets and supports along the header, tagged valves and a flow arrow every few branches.
 */
function job(target: number, perSheet = target): IsoDocument {
  seq = 0
  const doc = newIso()
  doc.style = { layout: 'schematic', weldNumbers: true, lettering: 'cad' }
  const spoolOf = () => `S${Math.floor(doc.runs.length / perSheet)}`
  let at = appendRun(doc, null, [1500, 0, 0], 'CS40', 4, 'S0', 'L-1')
  for (let i = 0; doc.runs.length < target; i++) {
    const spool = spoolOf(), tee = at
    at = appendRun(doc, tee.id, [1200 + (i % 3) * 300, 0, 0], 'CS40', 4, spool, 'L-1')
    const header = doc.runs.at(-1)!
    const up = appendRun(doc, tee.id, [0, 0, 900 + (i % 4) * 200], 'CS40', 2, spool, 'L-1')
    const over = appendRun(doc, up.id, [0, (i % 2 ? 1 : -1) * (800 + (i % 5) * 150), 0], 'CS40', 2, spool, 'L-1')
    const valve = insertComponent(doc, doc.runs.at(-1)!.id, 'valve', 0.4)
    applyComponent(doc, valve, i % 2 ? 'GATE-FL' : 'BALL-FL')
    valve.tag = `HV-${100 + i}`
    if (i % 3 === 0) applyComponent(doc, insertComponent(doc, doc.runs.find(r => r.to === up.id)!.id, 'flange', 0.5), 'FLG-RFWN')
    appendRun(doc, over.id, i % 3 ? [0, 0, -600] : [400, 400, 0], 'CS40', 2, spool, 'L-1')
    if (i % 4 === 1) attachComponent(doc, header.id, 'support', 0.5).tag = `PS-${i}`
    if (i % 5 === 2) applyComponent(doc, attachComponent(doc, header.id, 'olet', 0.3), 'WOL')
    if (i % 6 === 3) applyComponent(doc, attachComponent(doc, header.id, 'annotation', 0.7), 'AR')
  }
  return doc
}
const sample = () => parseIsoJson(readFileSync(resolve(import.meta.dirname, '../public/samples/cooling-water-return.piping'), 'utf8'))

const cases: Array<{ name: string; doc: () => IsoDocument; spool?: string }> = [
  { name: 'sample', doc: sample },
  { name: 'syn-30', doc: () => job(30) },
  { name: 'syn-100', doc: () => job(100) },
  { name: 'syn-300', doc: () => job(300) },
  { name: 'syn-300x10', doc: () => job(300, 30), spool: 'S0' }
].filter(c => !only || c.name === only)

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const time = (work: () => unknown, runs = RUNS) => {
  work()
  const out: number[] = []
  for (let i = 0; i < runs; i++) { const t = performance.now(); work(); out.push(performance.now() - t) }
  return median(out)
}
/** An edit as the editor commits it: a copy of the document, changed, checked by reading it back. */
const commitEdit = (doc: IsoDocument, edit: (d: IsoDocument) => void) => {
  const next = clone(doc)
  edit(next)
  parseIsoJson(JSON.stringify(next))
  return next
}
/** The edit benchmarked: a pipe's heat number changed, which every derived view redraws for. */
const relabel = (k: number) => (d: IsoDocument) => { d.runs[Math.floor(d.runs.length / 2)].heat = `H-${k}` }
const hash = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 16)

const snapshot: Record<string, Record<string, string>> = {}
const rows: Array<Record<string, string | number>> = []
for (const c of cases) {
  const doc = c.doc(), spool = c.spool ?? ''
  if (writeDir) { writeFileSync(resolve(writeDir, c.name + '.piping'), JSON.stringify(doc)); continue }
  const d = createDrawing(doc, spool)
  if (snapshotFile) {
    snapshot[c.name] = {
      primitives: hash(d.primitives), svg: hash(drawingSvg(d)), labels: hash(d.labels), notices: hash(d.notices ?? null),
      fit: hash(d.fit), positions: hash([...d.positions]),
      model: hash(createDrawing(doc, spool, 'iso', undefined, { model: true }).primitives),
      plan: hash(createDrawing(doc, spool, 'plan').primitives),
      validate: hash(validateIso(doc)), review: hash(reviewIso(doc)), materials: hash(materialSchedule(doc)),
      cuts: hash(cutSchedule(doc)), welds: hash(weldSchedule(doc))
    }
  }
  const runs = c.name === 'syn-300' ? Math.min(RUNS, 3) : RUNS
  let k = 0
  const commit = time(() => commitEdit(doc, relabel(k++)), runs)
  const draw = time(() => createDrawing(commitEdit(doc, relabel(k++)), spool), runs)
  // A label nudged: the layout is unchanged, so only the labels around it are placed again.
  const labelKey = d.labels?.find(l => !l.held)
  const nudge = (n: number) => (x: IsoDocument) => {
    if (!labelKey) return
    const sheet = ((x.sheets ??= {})[labelKey.spool] ??= {})
    sheet.labelPositions = { ...sheet.labelPositions, [labelKey.key]: [labelKey.at[0] + (n % 2 ? 6 : -6), labelKey.at[1]] }
  }
  const label = time(() => createDrawing(commitEdit(doc, nudge(k++)), spool), runs)
  // A pipe lengthened: the sheet is laid out again and every label placed anew.
  const lengthen = (n: number) => (x: IsoDocument) => {
    const r = x.runs[Math.floor(x.runs.length / 3)], end = x.nodes.find(node => node.id === r.to)!
    end.position = [end.position[0], end.position[1], end.position[2] + 10 + (n % 7) * 10]
  }
  const move = time(() => createDrawing(commitEdit(doc, lengthen(k++)), spool), runs)
  const derived = {
    validate: time(() => validateIso(commitEdit(doc, relabel(k++))), runs) - commit,
    review: time(() => reviewIso(commitEdit(doc, relabel(k++))), runs) - commit,
    materials: time(() => materialSchedule(commitEdit(doc, relabel(k++))), runs) - commit,
    cuts: time(() => { const n = commitEdit(doc, relabel(k++)); n.runs.filter(r => !r.connector).map(r => runResult(n, r)) }, runs) - commit,
    pieces: time(() => cutSchedule(commitEdit(doc, relabel(k++))), runs) - commit,
    welds: time(() => weldSchedule(commitEdit(doc, relabel(k++))), runs) - commit
  }
  // Everything the editor works out when an edit is committed, in the order it does.
  const all = time(() => {
    const n = commitEdit(doc, relabel(k++))
    createDrawing(n, spool); validateIso(n); materialSchedule(n); n.runs.filter(r => !r.connector).map(r => runResult(n, r))
    cutSchedule(n); weldSchedule(n); reviewIso(n)
  }, runs)
  rows.push({
    case: c.name, pipes: doc.runs.length, nodes: doc.nodes.length, commit: +commit.toFixed(1), draw: +(draw - commit).toFixed(1), label: +(label - commit).toFixed(1), move: +(move - commit).toFixed(1),
    ...Object.fromEntries(Object.entries(derived).map(([key, v]) => [key, +Math.max(0, v).toFixed(1)])), total: +all.toFixed(1)
  })
}
if (writeDir) process.exit(0)
console.table(rows)
if (snapshotFile) { writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2)); console.log('snapshot', snapshotFile) }
