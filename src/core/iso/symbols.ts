import type { Point } from '../drawing'
import { COMPONENT_TYPE_BY_CODE } from '../components'
import { boltedConnector, isBlind, isFlangePair, isLapJoint, nodeCode, nodeItem } from '../joints'
import { connected, getNode, pipePrepAt, takeout, welds, type IsoDocument, type PipeNode, type PipeRun, type Vec3, type Weld } from '../model'
import { measureText } from '../stroke-font'
import { symbolStrokes } from '../symbols'
import { SIZE, emitters, type IsoContext, type RunGeometry } from './context'
import { sheetLegs } from './dimensions'
import { add2, crossAxis, dot2, frame, isAxial, left2, len2, planeText, scale2, sub2, unit2, uprightOf } from './plane'

const flangedPort = (code?: string) => !!code && COMPONENT_TYPE_BY_CODE[code]?.endPrep === 'FL'
const OPERATORS: Record<string, Vec3> = { UP: [0, 0, 1], DOWN: [0, 0, -1], NORTH: [0, 1, 0], SOUTH: [0, -1, 0], EAST: [1, 0, 0], WEST: [-1, 0, 0] }

/** Page direction across a pipe in its isometric plane, never parallel to the pipe on the page. */
export function acrossOf(ctx: IsoContext, along: Point, dir3: Vec3): Point {
  // A skewed pipe in plan is crossed in the horizontal plane, square to the pipe.
  const flat = Math.abs(dir3[2]) < 0.05 && !isAxial(dir3)
  const across = flat ? ctx.axis([-dir3[1], dir3[0], 0]) : ctx.axis(crossAxis(dir3))
  if (len2(across) < 0.2 || Math.abs(dot2(unit2(across), along)) > 0.97) return left2(along)
  // Strokes are drawn upward from the pipe on the page.
  return across[1] > 0 ? scale2(across, -1) : across
}
/** Page direction across a pipe in the horizontal plane (along a horizontal axis for a riser), as boxes lie on plan. */
function flatAcrossOf(ctx: IsoContext, along: Point, dir3: Vec3): Point {
  const a = Math.abs(dir3[2]) < 0.7 ? ctx.axis([-dir3[1], dir3[0], 0]) : ctx.axis([1, 0, 0])
  return len2(a) < 0.2 || Math.abs(dot2(unit2(a), along)) > 0.97 ? acrossOf(ctx, along, dir3) : unit2(a)
}
/** Model direction of a valve operator such as "OPERATOR NORTH" or "OPERATOR NORTH 45° EAST". */
export function operatorDirection(operator?: string): Vec3 | undefined {
  const text = operator?.toUpperCase() ?? ''
  const axis = (word: string) => OPERATORS[word]
  const words = text.match(/\b(UP|DOWN|NORTH|SOUTH|EAST|WEST)\b/g) ?? []
  const first = words[0] && axis(words[0])
  if (!first) return undefined
  const turn = text.match(/(\d+(?:\.\d+)?)\s*°?\s*(UP|DOWN|NORTH|SOUTH|EAST|WEST)\b/)
  const toward = turn && words.length > 1 ? axis(turn[2]) : undefined
  if (!toward || dot2([first[0], first[1] + first[2] * 7], [toward[0], toward[1] + toward[2] * 7]) !== 0) return first
  const a = Number(turn![1]) * Math.PI / 180
  return [0, 1, 2].map(i => first[i] * Math.cos(a) + toward[i] * Math.sin(a)) as Vec3
}
/** A butterfly valve without an actuator is drawn as its disc on a stem; an actuated one as a bow-tie and dome. */
export function discValve(doc: IsoDocument, node: PipeNode, code = nodeCode(doc, node) ?? ''): boolean {
  if (!/^BFLY/.test(code)) return false
  const item = nodeItem(doc, node)
  return !/ACTUAT/i.test(`${node.description ?? ''} ${item?.bomDescription ?? ''} ${item?.description ?? ''}`)
}
/** Annotation drawn as the insulation limit marker, "INSUL. ← → NONE". */
export const insulationLimit = (code: string, text = '') => /^INS-LIM/.test(code) || ((/^INS/.test(code) || !code) && /INSUL.*NONE|NONE.*INSUL/i.test(text))
/** Annotation drawn as a wall penetration. */
export const wallPenetration = (code: string, text = '') => /^WALL/.test(code) || (/^GRND/.test(code) && /WALL/i.test(text))
/** Annotation drawn as an insulated length of pipe. */
export const insulation = (code: string, text = '') => /^INST?$/.test(code) && !insulationLimit(code, text)
export const equipmentCode = (code: string) => /^(NOZZLE|EQUIP)$/.test(code)
const flowArrow = (code: string) => /^AR$|ARRW$/.test(code)
const oletBody = (code: string) => /^(SOL|TOL|WOL)$|EOL$/.test(code)

const DISC = 5.5
/** The sockolet, threadolet and weldolet body: half-width across the header at heights up the branch. */
const OLET: Array<[number, number]> = [[0, 5.8], [9.7, 11], [19.5, 5.6]]
const NIPPLE = 2.2
const PSV = { h: 13.5, w: 7 }
const INSUL = { half: 7.5, min: 28 }
/** Half-length of each component's symbol along its pipe; pipes stop there. */
export function symbolExtent(ctx: IsoContext, node: PipeNode): number {
  const code = nodeCode(ctx.doc, node) ?? ''
  if (node.kind === 'olet') return oletBody(code) ? OLET[2][0] : /CPLG/.test(code) ? 10 : 0
  if (node.associatedRunId) return 0
  const flanges = flangedPort(code) ? SIZE.valveGap + SIZE.flangeThickness + 0.4 : 0
  if (node.kind === 'valve') {
    if (/NIPPLE/.test(code)) {
      // A nipple is a short length of pipe drawn as its outline between the fittings it joins.
      const spans = connected(ctx.doc, node.id).map(r => ctx.geometry.get(r.id)?.length ?? 0)
      return Math.max(3, Math.min(9, 0.45 * Math.min(...spans)))
    }
    if (/UNION/.test(code)) return 6
    if (/CPLG/.test(code)) return 7
    if (/^CAMLOCK/.test(code)) return 8
    if (/^CHICAGO/.test(code)) return 6
    if (/REGUL/.test(code)) return 11
    if (/^PULS/.test(code)) return 0
    if (/^PSV/.test(code)) return PSV.h + flanges
    if (/^FLOWMETER/.test(code)) return 10 + flanges
    return (discValve(ctx.doc, node, code) ? DISC : SIZE.valve) + flanges
  }
  if (node.kind === 'reducer') return /CPLG/.test(code) ? 7 : 9
  if (node.kind === 'flange' && isBlind(code)) return 2 + SIZE.flangeThickness * 2
  return 0
}

/** Where a weld is drawn: just off the fitting it joins, clear of its symbol, whatever the sheet scale. */
// A branch outlet is welded to its header where it stands; a pad or welded support where it sits on the pipe.
export const weldPoint = (ctx: IsoContext, w: Weld) => ['BR', 'RP', 'AT'].includes(w.type)
  ? ctx.pos.get(w.nodeId) : jointPoint(ctx, getNode(ctx.doc, w.nodeId), w.runId, w.position)
/** Where a pipe end joins its fitting on the page, for the fitting's joint at model point `position`. */
function jointPoint(ctx: IsoContext, node: PipeNode, runId: string, position: Vec3): Point | undefined {
  const g = ctx.geometry.get(runId), at = ctx.pos.get(node.id)
  if (!g || !at) return
  const out = g.run.from === node.id ? g.dir : scale2(g.dir, -1)
  if (node.kind === 'weld') return at
  // Fittings joined straight together meet where their takeouts do, along the drawn joint.
  if (g.run.connector) return ctx.project(position)
  // An olet's socket or weld end is the top of its body.
  if (node.kind === 'olet') return add2(at, scale2(out, ctx.extent.get(node.id) ?? 0))
  const projected = len2(sub2(ctx.project(position), at))
  return add2(at, scale2(out, (ctx.extent.get(node.id) ?? 0) + Math.min(14, Math.max(7, projected))))
}
/** Page direction of flow along a run, if its flow is set. */
export function flowDirection(g: RunGeometry): Point | undefined {
  return g.run.flow === 'forward' ? g.dir : g.run.flow === 'reverse' ? scale2(g.dir, -1) : undefined
}
/** The pipe end an equipment nozzle or outline annotation stands at, and the page direction out of the pipe. */
export function equipmentEnd(ctx: IsoContext, node: PipeNode): { end: PipeNode; out: Point } | undefined {
  const g = node.associatedRunId ? ctx.geometry.get(node.associatedRunId) : undefined
  if (!g) return
  const [a, b] = [getNode(ctx.doc, g.run.from), getNode(ctx.doc, g.run.to)]
  const d = (n: PipeNode) => Math.hypot(...n.position.map((v, i) => v - node.position[i]))
  return d(a) <= d(b) ? { end: a, out: scale2(g.dir, -1) } : { end: b, out: g.dir }
}

export function drawPipes(ctx: IsoContext) {
  const { line, poly, circle, text } = emitters(ctx)
  for (const node of ctx.nodes) ctx.extent.set(node.id, symbolExtent(ctx, node))
  const toward = (node: PipeNode, run: PipeRun): Point => {
    const g = ctx.geometry.get(run.id)!
    return run.from === node.id ? g.dir : scale2(g.dir, -1)
  }
  const along = (g: RunGeometry, p: Point) => dot2(sub2(p, g.a), g.dir)
  const codeOf = (node: PipeNode) => nodeCode(ctx.doc, node) ?? ''
  // Equipment drawn at pipe ends, and the stretches of pipe hidden behind olet bodies, insulation and wall sleeves.
  const equipment = new Map<string, PipeNode>()
  const gaps = new Map<string, Array<[number, number]>>()
  const gap = (runId: string, from: number, to: number) => gaps.set(runId, [...gaps.get(runId) ?? [], [from, to]])
  for (const node of ctx.nodes) {
    const at = ctx.pos.get(node.id), g = node.associatedRunId ? ctx.geometry.get(node.associatedRunId) : undefined
    if (!at || !g) continue
    const code = codeOf(node), label = node.calloutText ?? '', t = along(g, at)
    if (node.kind === 'olet' && oletBody(code)) gap(g.run.id, t - 8, t + 8)
    // A wall penetration may be entered as a support so it can be located by a dimension.
    else if (node.kind === 'support' && wallPenetration(code, label)) gap(g.run.id, t - 7, t + 7)
    else if (node.kind !== 'annotation') continue
    else if (insulation(code, label)) { const half = insulationLength(insulationText(ctx.doc, label)) / 2; gap(g.run.id, t - half, t + half) }
    else if (wallPenetration(code, label)) gap(g.run.id, t - 7, t + 7)
    else if (equipmentCode(code)) { const e = equipmentEnd(ctx, node); if (e) equipment.set(e.end.id, node) }
  }
  for (const g of ctx.geometry.values()) {
    if (boltedConnector(ctx.doc, g.run)) continue
    const ea = ctx.extent.get(g.run.from) ?? 0, eb = ctx.extent.get(g.run.to) ?? 0
    if (g.length <= ea + eb) continue
    let pieces: Array<[number, number]> = [[ea, g.length - eb]]
    for (const [lo, hi] of gaps.get(g.run.id) ?? [])
      pieces = pieces.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b] as [number, number]] : [[a, lo], [hi, b]].filter(([x, y]) => y - x > 0.5) as Array<[number, number]>)
    for (const [a, b] of pieces) line(add2(g.a, scale2(g.dir, a)), add2(g.a, scale2(g.dir, b)), 'PIPE', g.run.id)
  }
  // Shop welds are dots; socket welds add the socket mark; field welds are open, crossed circles, flagged FW with the callouts.
  for (const w of welds(ctx.doc)) {
    const p = weldPoint(ctx, w), g = ctx.geometry.get(w.runId), node = getNode(ctx.doc, w.nodeId)
    if (!p || !g) continue
    if (w.prep === 'SW' && node.kind !== 'weld') socket(p, toward(node, g.run), node, g)
    weld(p, w.field, w.nodeId)
  }
  // Screwed joints are marked by a short tick across the pipe where it enters its fitting.
  const ticks: Point[] = []
  for (const g of ctx.geometry.values())
    for (const [index, id] of [g.run.from, g.run.to].entries()) {
      const node = getNode(ctx.doc, id)
      if (pipePrepAt(ctx.doc, g.run, index) !== 'THD' || ['end', 'weld', 'support', 'annotation', 'gasket', 'bolt'].includes(node.kind)) continue
      const other = getNode(ctx.doc, index === 0 ? g.run.to : g.run.from).position, span = Math.hypot(...other.map((v, i) => v - node.position[i])) || 1
      const t = takeout(ctx.doc, node, g.run.id) ?? 0, p = jointPoint(ctx, node, g.run.id, node.position.map((v, i) => v + (other[i] - v) * t / span) as Vec3)
      if (!p || ticks.some(q => len2(sub2(p, q)) < 2.5)) continue
      ticks.push(p)
      const out = index === 0 ? g.dir : scale2(g.dir, -1), f = frame(p, out, flatAcrossOf(ctx, out, g.dir3))
      line(f(0, -4), f(0, 4), 'SYMBOL', node.id, 0.8)
    }
  // A butt-welded end continuing on another drawing is welded there; only a field weld marked here is drawn.
  for (const node of ctx.nodes) {
    const run = node.kind === 'end' && node.continuation && !/OPEN END|CLOSED/i.test(node.continuation.text) ? connected(ctx.doc, node.id)[0] : undefined
    const at = ctx.pos.get(node.id)
    if (!run || !at || !ctx.geometry.has(run.id)) continue
    const index = run.from === node.id ? 0 : 1
    if (pipePrepAt(ctx.doc, run, index) === 'BW' && (index === 0 ? run.fromField : run.toField)) weld(at, true, node.id)
  }
  // Flow arrows: one on each straight whose pipes carry a flow direction, on its longest piece.
  for (const leg of sheetLegs(ctx)) {
    const flowing = leg.runs.map(r => ctx.geometry.get(r.id)!).filter(g => !g.run.connector && flowDirection(g))
    const g = flowing.sort((a, b) => b.length - a.length)[0]
    if (!g) continue
    const ea = ctx.extent.get(g.run.from) ?? 0, eb = ctx.extent.get(g.run.to) ?? 0, span = g.length - ea - eb
    if (span < 24) continue
    const best = [0.3, 0.7, 0.2, 0.8, 0.5].map(t => add2(g.a, scale2(g.dir, ea + span * t)))
      .map(p => ({ p, cost: ctx.place.cost([sub2(p, scale2(g.dir, 6)), add2(p, scale2(g.dir, 6))], o => o.owner === g.run.id) }))
      .sort((a, b) => a.cost - b.cost)[0]
    arrowhead(best.p, flowDirection(g)!, g.run.id)
  }
  // Where the line runs on into another spool of this drawing, that spool's next components are drawn beyond the
  // shared point in place of the continuation break.
  const shared = new Set(ctx.nodes.filter(n => ctx.pos.has(n.id) && connected(ctx.doc, n.id).some(r => !ctx.runs.includes(r))).map(n => n.id))
  for (const node of ctx.nodes) drawSymbol(ctx, node)
  for (const id of shared) ghosts(getNode(ctx.doc, id))

  function weld(p: Point, field: boolean, owner: string) {
    if (!field) { circle(p, SIZE.weld, 'WELD', owner, true); return }
    const r = SIZE.weld * 1.6, d = r * Math.SQRT1_2
    circle(p, r, 'WELD', owner, false)
    line(add2(p, [-d, -d]), add2(p, [d, d]), 'WELD', owner)
    line(add2(p, [-d, d]), add2(p, [d, -d]), 'WELD', owner)
  }
  /** The socket a pipe end is set into: a bar across the pipe at the joint, its sides running back along the pipe. */
  function socket(p: Point, out: Point, node: PipeNode, g: RunGeometry) {
    let across = Math.abs(g.dir3[2]) < 0.7 ? flatAcrossOf(ctx, out, g.dir3) : undefined
    if (!across) {
      // On a riser the socket lies in the plane of the fitting's other pipe.
      const other = connected(ctx.doc, node.id).map(r => ctx.geometry.get(r.id)).find(o => o && o.run.id !== g.run.id && Math.abs(o.dir3[2]) < 0.7)
      across = other ? other.dir : acrossOf(ctx, out, g.dir3)
    }
    const s = 3.6, f = frame(p, out, unit2(across))
    poly([f(s, -s), f(0, -s), f(0, s), f(s, s)], 'SYMBOL', node.id, { weight: 0.8 })
  }
  function arrowhead(tip: Point, dir: Point, owner: string, length = 9, width = 2.6) {
    const u = unit2(dir), base = sub2(tip, scale2(u, length)), n = scale2(left2(u), width)
    poly([tip, add2(base, n), sub2(base, n)], 'SYMBOL', owner, { closed: true, fill: true })
  }
  function flangePair(at: Point, along: Point, across: Point, owner: string, sides: Array<1 | -1>, gap = 1.2) {
    const f = frame(at, along, across), F = SIZE.flange, t = SIZE.flangeThickness
    for (const s of sides)
      poly([f(s * gap, -F), f(s * (gap + t), -F), f(s * (gap + t), F), f(s * gap, F)], 'SYMBOL', owner, { closed: true })
  }
  function box(f: (x: number, y: number) => Point, x0: number, x1: number, h: number, owner: string, weight?: number) {
    poly([f(x0, -h), f(x1, -h), f(x1, h), f(x0, h)], 'SYMBOL', owner, { closed: true, ...(weight ? { weight } : {}) })
  }
  function drawSymbol(ctx: IsoContext, node: PipeNode) {
    const at = ctx.pos.get(node.id)
    if (!at) return
    const code = codeOf(node)
    const edges = connected(ctx.doc, node.id).filter(r => ctx.geometry.has(r.id))
    const host = edges[0] ?? ctx.runs.find(r => r.id === node.associatedRunId)
    const g = host && ctx.geometry.get(host.id)
    if (!g) return
    const along = edges[0] ? toward(node, edges[0]) : g.dir
    const across = acrossOf(ctx, along, g.dir3), f = frame(at, along, across)
    // Catalogue glyph strokes use negative y for up the sheet.
    const glyph = frame(at, along, scale2(across, -1))
    const owner = node.id
    switch (node.kind) {
      case 'elbow90': case 'elbow45': case 'tee': case 'weld': return
      case 'end': {
        const fitted = equipment.get(node.id)
        if (fitted) equipmentAt(fitted, at, scale2(along, -1), across, 0)
        else if (node.continuation && !shared.has(node.id) && !/OPEN END|CLOSED/i.test(node.continuation.text)) continuation(at, scale2(along, -1), across, owner, 0)
        return
      }
      case 'valve': return valve(node, code, at, along, across, edges)
      case 'flange': {
        if (isBlind(code)) {
          flangePair(at, along, across, owner, [1])
          const fb = frame(at, along, across), F = SIZE.flange, t = SIZE.flangeThickness
          poly([fb(-1.2, -F), fb(-1.2 - t * 1.4, -F), fb(-1.2 - t * 1.4, F), fb(-1.2, F)], 'SYMBOL', owner, { closed: true, fill: true })
          return
        }
        const pair = isFlangePair(ctx.doc, node)
        if (pair) { flangePair(at, along, across, owner, [-1, 1]); hache(f, 0, owner) }
        else {
          flangePair(at, along, across, owner, [1], 0)
          // The flange it bolts to, and the pipe beyond on the next drawing, are drawn thin; equipment is drawn as such.
          const fitted = equipment.get(node.id), out = scale2(along, -1)
          if (fitted || node.continuation || shared.has(node.id)) hache(f, -0.6, owner)
          if (fitted) equipmentAt(fitted, at, out, across, 1.2)
          else if (node.continuation && !shared.has(node.id)) {
            const fo = frame(at, out, across), F = SIZE.flange, t = SIZE.flangeThickness
            poly([fo(1.2, -F), fo(1.2 + t, -F), fo(1.2 + t, F), fo(1.2, F)], 'SYMBOL', owner, { closed: true, weight: 0.6 })
            if (!/OPEN END|CLOSED/i.test(node.continuation.text)) continuation(at, out, across, owner, 1.2 + t)
          }
        }
        // Lap-joint flanges show the stub-end lap at the face.
        if (isLapJoint(code)) for (const s of pair ? [-1, 1] : [1]) line(f(s * 0.4, -SIZE.flange * 0.55), f(s * 0.4, SIZE.flange * 0.55), 'SYMBOL', owner, 1.2)
        return
      }
      case 'reducer': {
        // A reducing coupling is a coupling: a box on plan, its joints marked as screwed or socketed.
        if (/CPLG/.test(code)) { box(frame(at, along, flatAcrossOf(ctx, along, g.dir3)), -7, 7, 7, owner); return }
        const big = edges.reduce((a, b) => a.nps >= b.nps ? a : b, edges[0])
        const dir = big ? scale2(toward(node, big), -1) : along, fr = frame(at, dir, acrossOf(ctx, dir, g.dir3))
        const h = 9, w1 = 7, w2 = 4
        const eccentric = /^E-/.test(code)
        poly(eccentric ? [fr(-h, -w1), fr(h, -w1), fr(h, w1 - 2 * w2), fr(-h, w1)] : [fr(-h, -w1), fr(h, -w2), fr(h, w2), fr(-h, w1)], 'SYMBOL', owner, { closed: true })
        return
      }
      case 'cap': {
        // A screwed or socket cap is drawn as its body round the pipe end; a butt-weld cap as its dish.
        if (/^SC-|^SW-|^CAMLOCK/.test(code)) {
          const w = /^CAMLOCK/.test(code) ? 5.5 : 4.5
          poly([f(w + 2, -w), f(0, -w), f(0, w), f(w + 2, w)], 'SYMBOL', owner)
          return
        }
        const out = scale2(along, -1), fc = frame(at, out, across), w = 6
        poly([fc(0, -w), fc(3.5, -w * 0.75), fc(5.5, 0), fc(3.5, w * 0.75), fc(0, w)], 'SYMBOL', owner, { closed: true })
        return
      }
      case 'olet': return olet(node, code, at, along, g)
      case 'support': return wallPenetration(code, node.calloutText) ? wall(owner, at, f) : support(node, code, at, along, across)
      case 'annotation': return annotation(node, code, at, g)
      default: catalogue(code, node.kind, glyph, owner)
    }
  }
  /** Everything else uses its catalogue symbol, laid into the isometric plane. */
  function catalogue(code: string, kind: PipeNode['kind'], glyph: (x: number, y: number) => Point, owner: string, scale = 0.8) {
    for (const stroke of symbolStrokes(code, kind)) {
      if ('l' in stroke) line(glyph(stroke.l[0] * scale, stroke.l[1] * scale), glyph(stroke.l[2] * scale, stroke.l[3] * scale), 'SYMBOL', owner)
      else if ('c' in stroke) circle(glyph(stroke.c[0] * scale, stroke.c[1] * scale), stroke.c[2] * scale, 'SYMBOL', owner, !!stroke.fill)
    }
  }
  /** The pipe continuing on another drawing: a thin length ending in an S-break. */
  function continuation(at: Point, out: Point, across: Point, owner: string, from: number) {
    const fo = frame(at, out, across), reach = from + 26
    line(fo(from + 1, 0), fo(reach, 0), 'SYMBOL', owner, 0.6)
    const pts: Point[] = []
    for (let i = 0; i <= 12; i++) { const y = -8 + i * 4 / 3; pts.push(fo(reach + 3 * Math.sin(y / 8 * Math.PI), y)) }
    poly(pts, 'SYMBOL', owner, { weight: 0.6 })
  }
  /** Equipment flange and nozzle neck beyond a pipe end, with the outline of the equipment where it is drawn. */
  function equipmentAt(node: PipeNode, at: Point, out: Point, across: Point, from: number) {
    const f = frame(at, out, across), F = SIZE.flange, t = SIZE.flangeThickness * 1.6, neck = from + t + 16, owner = node.id
    poly([f(from, -F * 1.15), f(from + t, -F * 1.15), f(from + t, F * 1.15), f(from, F * 1.15)], 'SYMBOL', owner, { closed: true })
    for (const s of [-1, 1]) line(f(from + t, s * F * 0.5), f(neck, s * F * 0.5), 'SYMBOL', owner)
    if (codeOf(node) !== 'EQUIP') return
    // The outline: a vessel or casing seen in isometric, an ellipse beyond the neck.
    const R = 18, pts: Point[] = []
    for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; pts.push(f(neck + R * 0.6 + Math.sin(a) * R * 0.6, Math.cos(a) * R * 1.4)) }
    poly(pts, 'SYMBOL', owner, { closed: true })
  }
  function valve(node: PipeNode, code: string, at: Point, along: Point, across: Point, edges: PipeRun[]) {
    const owner = node.id, f = frame(at, along, across), e = ctx.extent.get(node.id) ?? 0
    const flat = frame(at, along, flatAcrossOf(ctx, along, ctx.geometry.get(edges[0]?.id ?? '')?.dir3 ?? [1, 0, 0]))
    if (/NIPPLE/.test(code)) { box(f, -e, e, NIPPLE, owner, 0.8); return }
    // Couplings and unions lie flat: a square on plan round a level pipe.
    if (/UNION/.test(code)) { box(flat, -6, 6, 6, owner); line(flat(0, -6), flat(0, 6), 'SYMBOL', owner); return }
    if (/CPLG/.test(code)) { box(flat, -7, 7, 7, owner); return }
    if (/^CAMLOCK/.test(code)) {
      // Its groove is at the open end, toward the cap or the end of the line.
      const open = edges.find(r => ['cap', 'end'].includes(getNode(ctx.doc, r.from === node.id ? r.to : r.from).kind))
      const fo = open ? frame(at, toward(node, open), across) : f
      box(fo, -8, 8, 4, owner)
      for (const x of [3, 4.6]) line(fo(x, -4), fo(x, 4), 'SYMBOL', owner)
      return
    }
    if (/^CHICAGO/.test(code)) { box(flat, -6, 6, 5, owner); return }
    if (/REGUL/.test(code)) { box(flat, -11, 11, 7.5, owner); return }
    if (/^HOSE/.test(code)) return hose(node, code, at, along, across)
    if (/^PULS/.test(code)) return dampener(node, at, along, across)
    if (/^PSV/.test(code)) return relief(node, code, at, edges)
    if (/^FLOWMETER/.test(code)) {
      box(f, -10, 10, 7, owner)
      if (flangedPort(code)) flanges(f, 10, owner)
      return
    }
    // Every line valve is a bow-tie in its plane, actuated butterfly valves with the actuator's dome. A plain
    // butterfly valve is its disc between the flanges, on a short stem toward its operator. A check valve points with
    // the flow: one triangle from its inlet to its outlet, with an arrow.
    const butterfly = /^BFLY/.test(code), disc = discValve(ctx.doc, node, code), h = disc ? DISC : SIZE.valve, w = SIZE.valveWidth
    const check = /^CHECK/.test(code)
    if (check) {
      const flowing = edges.map(r => ctx.geometry.get(r.id)!).find(g => g && flowDirection(g))
      const out = edges.find(r => r.from === node.id)
      const dir = flowing ? flowDirection(flowing)! : out ? toward(node, out) : along
      const fc = frame(at, dir, acrossOf(ctx, dir, ctx.geometry.get(edges[0]?.id ?? '')?.dir3 ?? [0, 0, 1]))
      poly([fc(-h, -w), fc(h, 0), fc(-h, w)], 'SYMBOL', owner, { closed: true })
      line(fc(-h * 0.55, 0), fc(h * 0.45, 0), 'SYMBOL', owner, 0.8)
      arrowhead(fc(h * 0.75, 0), dir, owner, 5, 1.8)
    } else if (disc) circle(at, DISC * 0.85, 'SYMBOL', owner, true)
    else poly([f(-h, -w), f(h, w), f(h, -w), f(-h, w)], 'SYMBOL', owner, { closed: true })
    if (flangedPort(code)) flanges(f, h, owner)
    if (check) return
    // The valve type at its centre: globe a filled dot, ball a ball, plug its plug.
    const ball = /^BALL/.test(code), plug = /^PLUG/.test(code)
    if (/^GLOBE/.test(code)) circle(at, 2.4, 'SYMBOL', owner, true)
    if (ball) circle(at, 4, 'SYMBOL', owner)
    if (plug) poly([f(-3.5, 0), f(0, -3.5), f(3.5, 0), f(0, 3.5)], 'SYMBOL', owner, { closed: true, fill: true })
    // Operator on its stem: handwheel for gate/globe, lever for ball/plug, actuator dome for butterfly and control valves.
    const stemDir = operatorDirection(node.operator)
    const stem = stemDir && len2(ctx.axis(stemDir)) > 0.05 ? unit2(ctx.axis(stemDir)) : across
    const top = add2(at, scale2(stem, w + 9)), side = Math.abs(dot2(stem, along)) > 0.9 ? left2(stem) : along
    if (disc) { line(add2(at, scale2(stem, DISC)), add2(at, scale2(stem, DISC + 9)), 'SYMBOL', owner); return }
    line(ball ? add2(at, scale2(stem, 4)) : at, top, 'SYMBOL', owner)
    const ft = frame(top, side, stem)
    if (butterfly || /^CONTROL|^CV/.test(code)) poly([ft(-6, 0), ft(-5, 3), ft(-2.5, 5), ft(0, 5.6), ft(2.5, 5), ft(5, 3), ft(6, 0), ft(-6, 0)], 'SYMBOL', owner, { closed: true })
    else if (ball || plug) line(top, add2(top, scale2(side, 10)), 'SYMBOL', owner)
    else line(ft(-7, 0), ft(7, 0), 'SYMBOL', owner)
  }
  /** A flanged body's own flanges, a gap off each end. */
  function flanges(f: (x: number, y: number) => Point, h: number, owner: string) {
    const F = SIZE.flange, t = SIZE.flangeThickness, g = h + SIZE.valveGap
    for (const s of [-1, 1]) {
      poly([f(s * g, -F), f(s * (g + t), -F), f(s * (g + t), F), f(s * g, F)], 'SYMBOL', owner, { closed: true })
      hache(f, s * (g + t + 0.8), owner)
    }
  }
  /** The gasket's hache mark: a broken line across the joint at the gasket, beside the flange faces. */
  function hache(f: (x: number, y: number) => Point, x: number, owner: string) {
    const F = SIZE.flange * 1.15
    for (const [a, b] of [[-F, -F * 0.55], [-F * 0.25, F * 0.25], [F * 0.55, F]]) line(f(x, a), f(x, b), 'SYMBOL', owner, 0.5, false)
  }
  /** Up to three components of the next spool beyond a shared point, thin, with dashed pipe and no tags. */
  function ghosts(start: PipeNode) {
    const placed: string[] = [], walked: PipeRun[] = []
    const queue: Array<[PipeNode, PipeRun]> = connected(ctx.doc, start.id).filter(r => !ctx.runs.includes(r)).map(r => [start, r])
    let count = 0
    while (queue.length && count < 3) {
      const [from, run] = queue.shift()!, far = getNode(ctx.doc, run.from === from.id ? run.to : run.from)
      if (ctx.pos.has(far.id) && !placed.includes(far.id)) continue
      const d = far.position.map((v, i) => v - from.position[i]) as Vec3, l = Math.hypot(...d) || 1, page = unit2(ctx.axis(d))
      if (len2(page) < 0.5) continue
      ctx.pos.set(far.id, add2(ctx.pos.get(from.id)!, scale2(page, run.connector ? 26 : 44)))
      placed.push(far.id); walked.push(run)
      const a = ctx.pos.get(run.from)!, b = ctx.pos.get(run.to)!, ab = sub2(b, a)
      ctx.geometry.set(run.id, { run, a, b, dir: unit2(ab), length: len2(ab), dir3: d.map(v => v / l * (run.from === from.id ? 1 : -1)) as Vec3 })
      // Flanges come with their joint; they do not count as the next components.
      if (!['end', 'weld', 'flange', 'gasket', 'bolt'].includes(far.kind)) count++
      for (const next of connected(ctx.doc, far.id)) if (next !== run && !ctx.runs.includes(next) && !walked.includes(next)) queue.push([far, next])
    }
    for (const id of placed) ctx.extent.set(id, symbolExtent(ctx, getNode(ctx.doc, id)))
    const mark = ctx.out.length
    for (const run of walked) {
      const g = ctx.geometry.get(run.id)!, ea = ctx.extent.get(run.from) ?? 0, eb = ctx.extent.get(run.to) ?? 0
      for (let x = ea; x < g.length - eb; x += 6) line(add2(g.a, scale2(g.dir, x)), add2(g.a, scale2(g.dir, Math.min(x + 3.5, g.length - eb))), 'SYMBOL', start.id, 0.6, false)
    }
    for (const id of placed) { const n = getNode(ctx.doc, id); if (n.kind !== 'end') drawSymbol(ctx, n) }
    for (const p of ctx.out.slice(mark)) if (p.type === 'line' || p.type === 'polyline' || p.type === 'circle') p.weight = Math.min(p.weight ?? 0.6, 0.6)
    for (const id of placed) { ctx.pos.delete(id); ctx.extent.delete(id) }
    for (const run of walked) ctx.geometry.delete(run.id)
  }
  /** A hose: corrugated between flanged ends, or a single wavy line between screwed ends. */
  function hose(node: PipeNode, code: string, at: Point, along: Point, across: Point) {
    const f = frame(at, along, across), h = SIZE.valve, owner = node.id
    if (flangedPort(code)) {
      for (const y of [-5, 5]) poly(Array.from({ length: 13 }, (_, i) => f(-h + i * h / 6, y + (i % 2 ? -2.5 : 2.5))), 'SYMBOL', owner)
      for (const s of [-1, 1]) line(f(s * h, -7.5), f(s * h, 7.5), 'SYMBOL', owner)
      flanges(f, h, owner)
      return
    }
    poly(Array.from({ length: 33 }, (_, i) => f(-h + i * h / 16, 2.5 * Math.sin(i / 16 * Math.PI * 4))), 'SYMBOL', owner)
  }
  /** A one-port vessel on the pipe end: its flange bolted to the pipe's, a neck and a dome. */
  function dampener(node: PipeNode, at: Point, along: Point, across: Point) {
    const out = scale2(along, -1), f = frame(at, out, across), owner = node.id, F = SIZE.flange, t = SIZE.flangeThickness
    flangePair(at, out, across, owner, [-1, 1])
    const base = 1.2 + t + 10
    for (const s of [-1, 1]) line(f(1.2 + t, s * F * 0.45), f(base, s * F * 0.45), 'SYMBOL', owner)
    const W = 16, H = 10, pts: Point[] = []
    for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI; pts.push(f(base + Math.sin(a) * H, -Math.cos(a) * W)) }
    poly(pts, 'SYMBOL', owner, { closed: true })
  }
  /** A relief valve: two triangles meeting at its centre, one along the inlet and one along the outlet. */
  function relief(node: PipeNode, code: string, at: Point, edges: PipeRun[]) {
    const owner = node.id
    for (const run of edges) {
      const g = ctx.geometry.get(run.id)!, dir = toward(node, run), f = frame(at, dir, acrossOf(ctx, dir, g.dir3))
      poly([f(0, 0), f(PSV.h, -PSV.w), f(PSV.h, PSV.w)], 'SYMBOL', owner, { closed: true })
      if (flangedPort(code)) { const F = SIZE.flange, t = SIZE.flangeThickness, x = PSV.h + SIZE.valveGap; poly([f(x, -F), f(x + t, -F), f(x + t, F), f(x, F)], 'SYMBOL', owner, { closed: true }) }
    }
  }
  /** Sockolets, threadolets and weldolets are a body on the header; half couplings a short box. */
  function olet(node: PipeNode, code: string, at: Point, branch: Point, g: RunGeometry) {
    const header = node.associatedRunId ? ctx.geometry.get(node.associatedRunId) : undefined
    const owner = node.id
    const side = header && Math.abs(dot2(header.dir, branch)) < 0.97 ? header.dir : left2(branch), f = frame(at, branch, side)
    if (oletBody(code)) {
      poly([...OLET.map(([x, y]) => f(x, y)), ...OLET.slice().reverse().map(([x, y]) => f(x, -y))], 'SYMBOL', owner, { closed: true })
      circle(at, SIZE.weld * 1.2, 'WELD', owner, true)
      return
    }
    if (/CPLG/.test(code)) { box(frame(add2(at, scale2(branch, 5)), branch, side), -5, 5, 4.5, owner); return }
    catalogue(code, 'olet', frame(at, branch, scale2(acrossOf(ctx, branch, g.dir3), -1)), owner)
  }
  function support(node: PipeNode, code: string, at: Point, along: Point, across: Point) {
    const owner = node.id, f = frame(at, along, across)
    // A hanger is a triangle standing on the pipe, its far half filled; a U-bolt is an X across the pipe.
    if (/HANG|HNGR|SPRG|SPRING/.test(code)) {
      const tip = add2(at, scale2(across, 1.4)), top = (x: number) => add2(add2(at, scale2(across, 12)), scale2(along, x))
      poly([tip, top(-4.5), top(4.5)], 'SYMBOL', owner, { closed: true })
      poly([tip, top(0), top(4.5)], 'SYMBOL', owner, { closed: true, fill: true })
      line(top(0), add2(top(0), scale2(across, 10)), 'SYMBOL', owner)
      return
    }
    if (/U-?BOLT/.test(code)) {
      line(f(-5.5, -3), f(5.5, 3), 'SYMBOL', owner)
      line(f(-5.5, 3), f(5.5, -3), 'SYMBOL', owner)
      return
    }
    const glyph = frame(at, along, scale2(across, -1))
    for (const stroke of symbolStrokes(code, 'support'))
      if ('l' in stroke) line(glyph(stroke.l[0] * 0.7, stroke.l[1] * 0.7), glyph(stroke.l[2] * 0.7, stroke.l[3] * 0.7), 'SYMBOL', owner)
  }
  function annotation(node: PipeNode, code: string, at: Point, g: RunGeometry) {
    const owner = node.id, label = node.calloutText ?? '', across = acrossOf(ctx, g.dir, g.dir3), f = frame(at, g.dir, across)
    if (flowArrow(code)) {
      const size = /^VSM/.test(code) ? 0.7 : /^SM/.test(code) ? 0.85 : /^LG/.test(code) ? 1.3 : 1
      arrowhead(add2(at, scale2(flowDirection(g) ?? g.dir, 4.5 * size)), flowDirection(g) ?? g.dir, owner, 9 * size, 2.6 * size)
      return
    }
    if (insulationLimit(code, label)) return insulationEnd(node, label, at, g)
    if (insulation(code, label)) {
      // A short open cylinder round the pipe, lettered with the insulation thickness in the pipe's plane.
      const thickness = insulationText(ctx.doc, label), L = insulationLength(thickness), H = INSUL.half, c = 2.2, x = L / 2
      poly([f(-x + c, -H), f(x - c, -H), f(x, -H + c), f(x, H - c), f(x - c, H), f(-x + c, H), f(-x, H - c), f(-x, -H + c)], 'SYMBOL', owner, { closed: true })
      // The pipe's cut section shows where it leaves each end.
      for (const s of [-1, 1]) poly(Array.from({ length: 7 }, (_, i) => f(s * (x - 1.8 * Math.sin(i / 6 * Math.PI)), H * 0.6 * i / 6)), 'SYMBOL', owner, { weight: 0.6 })
      if (thickness) {
        const up = across[1] < 0 ? across : scale2(across, -1), turn = planeText(g.dir, up)
        text(add2(at, scale2(up, -SIZE.text * 0.42)), thickness, SIZE.text * 0.85, 'TEXT', owner, { rotation: turn.rotation, oblique: turn.oblique, anchor: 'middle' })
      }
      return
    }
    if (wallPenetration(code, label)) return wall(owner, at, f)
    if (equipmentCode(code) || /^ISA/.test(code)) return
    catalogue(code, 'annotation', frame(at, g.dir, scale2(across, -1)), owner)
  }
  /** A wall penetration: the wall line across the pipe, broken by the sleeve cloud round it. */
  function wall(owner: string, at: Point, f: (x: number, y: number) => Point) {
    const r = 7, pts: Point[] = []
    for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2; pts.push(add2(at, scale2([Math.cos(a), Math.sin(a)], r * (1 + 0.12 * Math.abs(Math.sin(a * 4)))))) }
    poly(pts, 'SYMBOL', owner, { closed: true })
    for (const s of [-1, 1]) line(f(0, s * (r + 1.5)), f(0, s * 24), 'SYMBOL', owner, 0.8)
  }
  /** Where insulation stops: a two-way arrow beside the pipe with a tick at the limit, INSUL. one side and NONE the other. */
  function insulationEnd(node: PipeNode, label: string, at: Point, g: RunGeometry) {
    const owner = node.id, across = acrossOf(ctx, g.dir, g.dir3), down = scale2(across, -1)
    const base = add2(at, scale2(down, 14)), f = frame(base, g.dir, down), L = 26, size = SIZE.text * 0.85
    line(f(-L, 0), f(L, 0), 'SYMBOL', owner, 0.8)
    line(f(0, -4.5), f(0, 4.5), 'SYMBOL', owner, 0.8)
    for (const s of [-1, 1]) poly([f(s * L, 0), f(s * (L - 6), -1.8), f(s * (L - 6), 1.8)], 'SYMBOL', owner, { closed: true, weight: 0.8 })
    // Each word stands beyond the arrow, away from the pipe, on its own side of the limit.
    const [first, second] = insulationWords(label), turn = planeText(g.dir, across), toward = dot2(uprightOf(turn), down)
    for (const [word, s] of [[first, -1], [second, 1]] as Array<[string, number]>)
      if (word) text(add2(f(s * L * 0.5, 0), scale2(down, toward >= 0 ? 2.5 : 2.5 + size / Math.max(0.5, -toward))), word, size, 'TEXT', owner, { rotation: turn.rotation, oblique: turn.oblique, anchor: 'middle' })
  }
}
/** The two words of an insulation limit, insulated side first: "INSUL. | NONE", "INSUL. <- -> NONE". */
export function insulationWords(label: string): [string, string] {
  const parts = label.toUpperCase().split(/\s*(?:<-+\s*-+>|\||\/|←\s*→)\s*/).map(s => s.trim()).filter(Boolean)
  return parts.length >= 2 ? [parts[0], parts[1]] : ['INSUL.', 'NONE']
}
/** The thickness lettered on an insulation symbol: its own label, else the title block's insulation thickness. */
export const insulationText = (doc: IsoDocument, label: string) => (label || doc.titleBlock?.insulationThickness || '').toUpperCase()
const insulationLength = (text: string) => Math.max(INSUL.min, measureText(text, SIZE.text * 0.85) + 10)
