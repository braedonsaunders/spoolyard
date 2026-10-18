import type { Linetype, Point, Primitive, SymbolRef } from '../drawing'
import { COMPONENT_TYPE_BY_CODE, type SymbolFamily } from '../components'
import { boltedConnector, flangedJoints, isFlangePair, nodeCode } from '../joints'
import { connected, deflection, distance, getNode, isFormedBend, pipePrepAt, takeout, type IsoDocument, type PipeNode, type PipeRun, type Vec3, type Weld } from '../model'
import { measureText } from '../stroke-font'
import { symbolStrokes } from '../symbols'
import { boreClass, emitters, faceOnPaper, fittingTakeoutOnPaper, nodeBore, sizeOf, weldsOf, type DraftingSizes, type IsoContext, type RunGeometry } from './context'
import { readable, sheetLegs } from './dimensions'
import { referenceDocument } from '../references'
import { camlockGeometry, discGeometry, discValve, drafting, flangedGeometry, reducerGeometry, swingCheck, symbolOf, triangleCheck, valveBodyHalfWidth, valveBodyOnSheet, valveOperatorOf } from './valve-conventions'
export { discValve } from './valve-conventions'
import { add2, crossAxis, dot2, frame, isAxial, left2, len2, lerp2, pageAngle, planeText, scale2, sub2, unit2, unit3, uprightOf } from './plane'

const flangedPort = (code?: string) => !!code && COMPONENT_TYPE_BY_CODE[code]?.endPrep === 'FL'
/** A butterfly disc drawn open between its faces: its half-thickness of the body's half-length, its half-height of the flanges'. */
const DISC_ALONG = 0.45, DISC_ACROSS = 0.8
/** Plant direction of an eccentric reducer's flat side. */
const FLAT_SIDE: Record<NonNullable<PipeNode['flatSide']>, Vec3> = { top: [0, 0, 1], bottom: [0, 0, -1], north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0] }
const OPERATORS: Record<string, Vec3> = { UP: [0, 0, 1], DOWN: [0, 0, -1], NORTH: [0, 1, 0], SOUTH: [0, -1, 0], EAST: [1, 0, 0], WEST: [-1, 0, 0] }

/** Page direction across a pipe in its isometric plane, never parallel to the pipe on the page. */
export function acrossOf(ctx: IsoContext, along: Point, dir3: Vec3): Point {
  // A skewed pipe in plan is crossed in the horizontal plane, square to the pipe.
  const flat = Math.abs(dir3[2]) < 0.05 && !isAxial(dir3)
  const across = flat ? ctx.axis([-dir3[1], dir3[0], 0]) : ctx.axis(crossAxis(dir3))
  if (len2(across) < 0.2 || Math.abs(dot2(unit2(across), along)) > 0.97) return left2(along)
  // Strokes are drawn upward from the pipe on the page.
  const factor=flat?Math.max(len2(ctx.direction(unit3(dir3))),len2(ctx.direction(unit3([-dir3[1],dir3[0],0])))):1
  return scale2(across, (across[1] > 0 ? -1 : 1)*factor)
}
/**
 * A chosen page direction across a pipe (a symbol or lettering plane), unless the view sees that plane edge-on (a
 * vertical plane on a plan, a plan on an elevation): then the pipe's own isometric plane.
 */
export function planeOr(ctx: IsoContext, wanted: Point, along: Point, dir3: Vec3): Point {
  return len2(wanted) < 0.2 || Math.abs(dot2(unit2(wanted), unit2(along))) > 0.97 ? acrossOf(ctx, along, dir3) : wanted
}
/** Page direction across a pipe in the horizontal plane (along a horizontal axis for a riser), as boxes lie on plan. */
function flatAcrossOf(ctx: IsoContext, along: Point, dir3: Vec3): Point {
  if(Math.abs(dir3[2])<.05&&!isAxial(dir3))return acrossOf(ctx,along,dir3)
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
/** Annotation families that draw a mark of their own along the pipe and letter it themselves. */
export const SELF_LETTERED: ReadonlySet<SymbolFamily> = new Set(['insulation', 'insulation-limit', 'nozzle', 'equipment', 'instrument'])
/** Equipment drawn at a pipe end: a nozzle neck, or the equipment's outline. */
export const equipmentFamily = (family: SymbolFamily) => family === 'nozzle' || family === 'equipment'
/** Whether a pipe end continues beyond its drawing (default) rather than being left open or closed off. */
export const continues = (node: PipeNode) => !!node.continuation && (node.continuation.termination ?? 'continues') === 'continues'

/** The sockolet, threadolet and weldolet body: half-width across the header at heights up the branch (lettering heights). */
const OLET: Array<[number, number]> = [[0, 0.88], [1.47, 1.67], [2.95, 0.85]]
/** A nipple's half-width for each inch of its size class; its threaded length beside a plain end (lettering heights). */
const NIPPLE = { radius: 0.28, thread: 2.35 }
/** An insulation sleeve: half its height, and the shortest it is drawn (lettering heights). */
const INSUL = { half: 1.21, min: 4.76 }
/** Catalogue glyph strokes are drawn at this many lettering heights per glyph unit (supports a little smaller). */
const GLYPH = { scale: 0.121, support: 0.106 }

/** A page direction's angle as a symbol's rotation: degrees counter-clockwise on the page, to a millionth. */
const turnOf = (v: Point) => {
  const a = pageAngle(v)
  return Math.abs(a) < 1e-9 ? 0 : Number(a.toFixed(6))
}
/**
 * The ink `draw` adds to `out` is one symbol instance named `name` at `at`, turned `rotation` degrees (see
 * `Primitive.symbol`). Ink already claimed by an instance drawn inside it keeps its own, and movable lettering stays
 * its own unless it prints a field.
 */
export function asSymbol<T>(out: Primitive[], name: string, at: Point, rotation: number, draw: () => T, scale?: number): T {
  const start = out.length
  try {
    return draw()
  } finally {
    const symbol: SymbolRef = { name, at: [at[0], at[1]], rotation, ...(scale && Math.abs(scale - 1) > 1e-12 ? { scale } : {}) }
    for (let i = start; i < out.length; i++) {
      const p = out[i]
      if (!p.symbol && !(p.type === 'text' && p.label && !p.field)) p.symbol = symbol
    }
  }
}
/** Strokes `draw` adds to `out` are drawn in `linetype`, one stroke with a dash pattern. */
function inLinetype(out: Primitive[], linetype: Linetype, draw: () => void) {
  const start = out.length
  draw()
  for (let i = start; i < out.length; i++) { const p = out[i]; if (p.type !== 'text' && p.type !== 'image') p.linetype = linetype }
}
/** Families named for the valve they are: a GATE family is drawn as a GATE-VALVE. */
const VALVE_FAMILIES: ReadonlySet<string> = new Set(['gate', 'globe', 'ball', 'check', 'butterfly', 'control', 'relief'])
/** A component's symbol name: its drafting family ("GATE-VALVE", "U-BOLT"); a catalogue glyph by its component type. */
export function symbolName(doc: IsoDocument, node: PipeNode): string {
  const family = symbolOf(doc, node) as string, kind = node.kind.replace(/\d+$/, '')
  const name = family === 'glyph' ? `${nodeCode(doc, node) || kind}-${kind}` : VALVE_FAMILIES.has(family) ? `${family}-valve` : family
  return name.toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Half-length of each component's symbol along its pipe; pipes stop there. */
export function symbolExtent(ctx: IsoContext, node: PipeNode): number {
  const s = sizeOf(ctx), T = s.text, code = nodeCode(ctx.doc, node) ?? '', d = drafting(ctx.doc, node)
  const body = (k = 2.73) => (d.body?.length ?? k) * T
  if (node.kind === 'olet') return d.symbol === 'olet' ? OLET[2][0] * T : d.symbol === 'half-coupling' ? 2 * body() : 0
  if (node.associatedRunId) return 0
  const axial=Math.max(...connected(ctx.doc,node.id).map(r=>len2(ctx.direction(ctx.geometry.get(r.id)?.dir3 ?? [1,0,0]))),1e-6)
  const planes = flangedGeometry(ctx.doc, node, undefined, T)
  const flanges = flangedPort(code) ? planes.plate - planes.body + s.thin : 0
  if (node.kind === 'valve') {
    switch (d.symbol) {
      case 'nipple': {
        // A nipple is a short length of pipe drawn as its outline between the fittings it joins.
        const spans = connected(ctx.doc, node.id).map(r => ctx.geometry.get(r.id)?.length ?? 0)
        return Math.max(0.45 * T, Math.min(1.36 * T, 0.45 * Math.min(...spans)))
      }
      case 'union': case 'coupling': case 'regulator': return body() * axial
      case 'quick-coupling': return camlockGeometry(ctx.doc, node, T).halfLength * axial
      case 'dampener': return 0
      case 'relief': return body() * Math.max(1, axial) + flanges
      case 'meter': return (body() + flanges) * axial
    }
    return discValve(ctx.doc, node) ? (discGeometry(ctx.doc, node, undefined, T).plate + s.thin) * axial : (valveBodyOnSheet(ctx, node, T) + flanges) * axial
  }
  if (node.kind === 'reducer') return (d.symbol === 'reducing-coupling' ? body() : reducerGeometry(ctx.doc, node, T).halfLength) * axial
  if (node.kind === 'cap' && d.symbol === 'quick-coupling-cap') return camlockGeometry(ctx.doc, node, T).capRadius * 2
  if (node.kind === 'flange' && d.symbol === 'blind-flange') return 0.3 * T + s.flangeThickness * 2
  return 0
}

/** Where a weld is drawn: just off the fitting it joins and clear of its symbol not to scale; to scale, where it is. */
// A branch outlet is welded to its header where it stands; a pad or welded support where it sits on the pipe.
export const weldPoint = (ctx: IsoContext, w: Weld) => ['BR', 'RP', 'AT'].includes(w.type)
  ? ctx.pos.get(w.nodeId) : jointPoint(ctx, getNode(ctx.doc, w.nodeId), w.runId, w.position)
/** Where a pipe end joins its fitting on the page, for the fitting's joint at model point `position`. */
function jointPoint(ctx: IsoContext, node: PipeNode, runId: string, position: Vec3): Point | undefined {
  const g = ctx.geometry.get(runId), at = ctx.pos.get(node.id), s = sizeOf(ctx), T = s.text
  if (!g || !at) return
  const out = g.run.from === node.id ? g.dir : scale2(g.dir, -1)
  if (node.kind === 'weld') return at
  const from=getNode(ctx.doc,g.run.from),to=getNode(ctx.doc,g.run.to),v=to.position.map((x,i)=>x-from.position[i])
  const squared=v.reduce((s,x)=>s+x*x,0),station=squared?v.reduce((s,x,i)=>s+x*(position[i]-from.position[i]),0)/squared:0
  const projectedPoint=lerp2(g.a,g.b,station)
  const corner=(n:PipeNode)=>/^(elbow|tee)/.test(n.kind)
  if(ctx.schematic&&node.kind==='cap'&&symbolOf(ctx.doc,node)==='quick-coupling-cap')return add2(at,scale2(out,camlockGeometry(ctx.doc,node,T).capRadius*2+s.flangeThickness))
  // The fitting block keeps its drafted size even where the long pipe beside it is compressed.
  if (g.run.connector) {
    if (ctx.schematic && corner(from)!==corner(to)) {
      const n=corner(from)?from:to,t=Math.max(0,Math.min(g.length-s.weld,fittingTakeoutOnPaper(ctx,n,g.run)))
      return corner(from)?add2(g.a,scale2(g.dir,t)):sub2(g.b,scale2(g.dir,t))
    }
    return projectedPoint
  }
  // An olet's socket or weld end is the top of its body.
  if (node.kind === 'olet') return add2(at, scale2(out, ctx.extent.get(node.id) ?? 0))
  // To scale, a weld is where it is: at the fitting's true takeout, projected.
  if (!ctx.schematic) return projectedPoint
  if(corner(node))return add2(at,scale2(out,faceOnPaper(ctx,node,g.run)))
  const joint=ctx.joints.find(j=>j.nodeId===node.id&&j.stubRunIds.includes(runId))
  if(symbolOf(ctx.doc,node)==='lap-joint-flange'||joint?.stubEnds.length)
    return add2(at,scale2(out,(ctx.extent.get(node.id)??0)+boreClass(g.run.nps)*1.09*T))
  const projected = len2(sub2(projectedPoint, at))
  return add2(at, scale2(out, (ctx.extent.get(node.id) ?? 0) + Math.min(2.12 * T, Math.max(1.06 * T, projected))))
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
/** Length of an equipment nozzle's neck beyond its pipe end's flange. */
export function nozzleNeck(ctx: IsoContext, end: PipeNode): number {
  const s = sizeOf(ctx)
  return (end.kind === 'flange' ? s.flangeGap : 0) + s.flangeThickness * 1.6 + 2.4 * s.text
}

/** The equipment casing can be positioned on paper independently of its surveyed pipe-end connection. */
export function equipmentCentre(ctx: IsoContext, node: PipeNode, at: Point, out: Point): Point {
  const held=ctx.paperPositions?.[node.id], T = sizeOf(ctx).text
  if(held)return held
  if(node.equipmentShape==='vessel')return add2(add2(at,scale2(out,8.8*T)),scale2(ctx.axis([0,0,1]),6.5*T))
  const end=equipmentEnd(ctx,node)
  return add2(at,scale2(out,(end ? nozzleNeck(ctx, end.end) : 0) + 1.7 * T))
}

/** What drawing a sheet's pipes knows of the sheet: equipment at pipe ends, and points shared with other spools. */
interface Scene { equipment: Map<string, PipeNode>; shared: Set<string> }

export function drawPipes(ctx: IsoContext) {
  const { line, poly } = emitters(ctx), s = sizeOf(ctx), T = s.text
  const jointsToWeld = weldsOf(ctx, ctx.doc)
  for (const node of ctx.nodes) ctx.extent.set(node.id, symbolExtent(ctx, node))
  const along = (g: RunGeometry, p: Point) => dot2(sub2(p, g.a), g.dir)
  const familyOf = (node: PipeNode) => symbolOf(ctx.doc, node)
  // Equipment drawn at pipe ends, and the stretches of pipe hidden behind olet bodies, insulation and wall sleeves.
  const equipment = new Map<string, PipeNode>()
  const visiblePipe = new Map<string, Array<[number,number]>>()
  const gaps = new Map<string, Array<[number, number]>>()
  const gap = (runId: string, from: number, to: number) => gaps.set(runId, [...gaps.get(runId) ?? [], [from, to]])
  for (const node of ctx.nodes) {
    const at = ctx.pos.get(node.id), g = node.associatedRunId ? ctx.geometry.get(node.associatedRunId) : undefined
    if (!at || !g) continue
    const family = familyOf(node), label = node.calloutText ?? '', t = along(g, at)
    if (node.kind === 'olet' && family === 'olet') gap(g.run.id, t - 1.2 * T, t + 1.2 * T)
    // A wall penetration may be entered as a support so it can be located by a dimension.
    else if (family === 'wall') gap(g.run.id, t - 1.06 * T, t + 1.06 * T)
    else if (node.kind !== 'annotation') continue
    else if (family === 'insulation') { const half = insulationLength(insulationText(ctx.doc, label), T) / 2; gap(g.run.id, t - half, t + half) }
    else if (equipmentFamily(family)) { const e = equipmentEnd(ctx, node); if (e) equipment.set(e.end.id, node) }
  }
  // A formed bend is part of its pipe: the pipe runs to the bend's tangent points and on round its arc, drawn as the
  // projected circular arc (a rational quadratic through the work point, weighted by half the deflection).
  const bendStop = new Map<string, number>()
  for (const node of ctx.nodes) {
    const at = ctx.pos.get(node.id), theta = isFormedBend(ctx.doc, node) ? deflection(ctx.doc, node) : undefined
    const edges = connected(ctx.doc, node.id).filter(r => ctx.geometry.has(r.id))
    if (!at || theta == null || theta < 1e-3 || edges.length !== 2) continue
    const ends = edges.map(run => {
      const g = ctx.geometry.get(run.id)!, far = getNode(ctx.doc, run.from === node.id ? run.to : run.from), t = takeout(ctx.doc, node, run.id) ?? 0
      const reach = Math.min(g.length / 2, ctx.schematic ? faceOnPaper(ctx, node, run) : t / (distance(node.position, far.position) || 1) * g.length)
      bendStop.set(`${node.id}|${run.id}`, reach)
      return add2(at, scale2(toward(ctx, node, run), reach))
    })
    const w = Math.cos(theta / 2), arc = Array.from({ length: 17 }, (_, i): Point => {
      const t = i / 16, a = (1 - t) ** 2, b = 2 * (1 - t) * t * w, c = t * t, d = a + b + c
      return [(a * ends[0][0] + b * at[0] + c * ends[1][0]) / d, (a * ends[0][1] + b * at[1] + c * ends[1][1]) / d]
    })
    poly(arc, 'PIPE', node.id, { weight: s.pipe })
  }
  for (const g of ctx.geometry.values()) {
    if (boltedConnector(ctx.doc, g.run)) continue
    if(g.run.connector && [g.run.from,g.run.to].some(id=>getNode(ctx.doc,id).hosePath?.length))continue
    let ea = Math.max(ctx.extent.get(g.run.from) ?? 0, bendStop.get(`${g.run.from}|${g.run.id}`) ?? 0)
    let eb = Math.max(ctx.extent.get(g.run.to) ?? 0, bendStop.get(`${g.run.to}|${g.run.id}`) ?? 0)
    for (const [index, id] of [g.run.from, g.run.to].entries()) {
      const node = getNode(ctx.doc, id), joint = ctx.joints.find(j => j.nodeId === id && j.stubRunIds.includes(g.run.id))
      // A bought nipple starts at the fitting's joint, beyond its heavy elbow or tee body.
      if(g.run.nipple && ['elbow90','elbow45','tee'].includes(node.kind)){
        const far=getNode(ctx.doc,index===0?g.run.to:g.run.from).position,out=unit3(far.map((v,k)=>v-node.position[k]) as Vec3),take=takeout(ctx.doc,node,g.run.id),t=take!=null&&Number.isFinite(take)?take:0
        const face=jointPoint(ctx,node,g.run.id,node.position.map((v,k)=>v+out[k]*t) as Vec3)
        if(face){
          const station=along(g,face)
          if(index===0)ea=Math.max(ea,station);else eb=Math.max(eb,g.length-station)
          line(ctx.pos.get(id)!,face,'PIPE',id,s.pipe)
        }
      }
      if (node.kind !== 'flange' && !joint?.stubEnds.length) continue
      const weld = jointsToWeld.find(w => w.nodeId === id && w.runId === g.run.id), at = weld && weldPoint(ctx, weld)
      if (!at) continue
      const station = along(g, at), extent = ctx.extent.get(id) ?? 0
      if (index === 0) ea = Math.max(ea, station); else eb = Math.max(eb, g.length - station)
      // The stub end or weld-neck is thin fitting linework, rather than a continuation of the heavy pipe.
      line(add2(ctx.pos.get(id)!, scale2(index === 0 ? g.dir : scale2(g.dir, -1), extent)), at, 'SYMBOL', id, s.thin)
    }
    if (g.length <= ea + eb) continue
    let pieces: Array<[number, number]> = [[ea, g.length - eb]]
    for (const [lo, hi] of gaps.get(g.run.id) ?? [])
      pieces = pieces.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b] as [number, number]] : [[a, lo], [hi, b]].filter(([x, y]) => y - x > 0.5) as Array<[number, number]>)
    visiblePipe.set(g.run.id,pieces)
    for (const [a, b] of pieces) {
      if (g.run.nipple) {
        const f = frame(g.a, g.dir, acrossOf(ctx, g.dir, g.dir3))
        const radius=NIPPLE.radius*T*boreClass(g.run.nps,1),fromThread=pipePrepAt(ctx.doc,g.run,0)==='THD',toThread=pipePrepAt(ctx.doc,g.run,1)==='THD'
        const thread=NIPPLE.thread*T,lo=!fromThread&&toThread?Math.max(a,b-thread):a,hi=fromThread&&!toThread?Math.min(b,a+thread):b
        if(lo>a)line(f(a,0),f(lo,0),'SYMBOL',g.run.id,s.thin)
        if(hi<b)line(f(hi,0),f(b,0),'SYMBOL',g.run.id,s.thin)
        poly([f(lo,-radius),f(hi,-radius),f(hi,radius),f(lo,radius)], 'SYMBOL', g.run.id, { closed: true, weight: s.thin })
      } else if(g.run.connector && (ctx.nodes.some(n=>n.associatedRunId===g.run.id && familyOf(n) === 'instrument') ||
        [g.run.from,g.run.to].some(id=>getNode(ctx.doc,id).kind==='flange') && [g.run.from,g.run.to].some(id=>['end','reducer'].includes(getNode(ctx.doc,id).kind)) ||
        [g.run.from,g.run.to].some(id=>getNode(ctx.doc,id).kind==='cap')&&[g.run.from,g.run.to].some(id=>getNode(ctx.doc,id).kind==='valve'))) {
        line(add2(g.a,scale2(g.dir,a)),add2(g.a,scale2(g.dir,b)),'SYMBOL',g.run.id,s.thin)
      } else line(add2(g.a, scale2(g.dir, a)), add2(g.a, scale2(g.dir, b)), 'PIPE', g.run.id, s.pipe)
    }
  }
  const shared = new Set(ctx.nodes.filter(n => ctx.pos.has(n.id) && connected(ctx.doc, n.id).some(r => !ctx.runs.includes(r))).map(n => n.id))
  const references = (ctx.doc.references ?? []).filter(r => ctx.nodes.some(n => n.id === r.atNodeId))
  for (const r of references) shared.add(r.atNodeId)
  const draw = symbolDrawer(ctx, { equipment, shared })
  // Shop welds are dots; socket welds add the socket mark; field welds are open, crossed circles, flagged FW with the callouts.
  for (const w of jointsToWeld) {
    const p = weldPoint(ctx, w), g = ctx.geometry.get(w.runId), node = getNode(ctx.doc, w.nodeId)
    if (!p || !g) continue
    if (w.prep === 'SW' && node.kind !== 'weld') draw.socket(p, toward(ctx, node, g.run), node, g)
    draw.weld(p, w.field, w.nodeId)
  }
  // Screwed joints are marked by a short tick across the pipe where it enters its fitting.
  const ticks: Point[] = []
  for (const g of ctx.geometry.values())
    for (const [index, id] of [g.run.from, g.run.to].entries()) {
      const node = getNode(ctx.doc, id)
      if(node.hosePath?.length)continue
      // A quick coupling's cap snaps on: there is no screwed joint between them.
      const mate=getNode(ctx.doc,index===0?g.run.to:g.run.from), quick = (n: PipeNode) => familyOf(n) === 'quick-coupling' || familyOf(n) === 'quick-coupling-cap'
      if(familyOf(node)==='quick-coupling-cap'||quick(node)&&familyOf(mate)==='quick-coupling-cap')continue
      if (pipePrepAt(ctx.doc, g.run, index) !== 'THD' || ['end', 'weld', 'support', 'annotation', 'gasket', 'bolt'].includes(node.kind)) continue
      const other = getNode(ctx.doc, index === 0 ? g.run.to : g.run.from).position, span = Math.hypot(...other.map((v, i) => v - node.position[i])) || 1
      const t = takeout(ctx.doc, node, g.run.id) ?? 0, p = jointPoint(ctx, node, g.run.id, node.position.map((v, i) => v + (other[i] - v) * t / span) as Vec3)
      if (!p || ticks.some(q => len2(sub2(p, q)) < 0.38 * T)) continue
      ticks.push(p)
      const out = index === 0 ? g.dir : scale2(g.dir, -1), f = frame(p, out, flatAcrossOf(ctx, out, g.dir3))
      asSymbol(ctx.out, 'THREAD-MARK', p, turnOf(out), () => line(f(0, -0.6 * T), f(0, 0.6 * T), 'SYMBOL', node.id, s.thin))
    }
  // A butt-welded end continuing on another drawing is welded there; only a field weld marked here is drawn.
  for (const node of ctx.nodes) {
    const run = node.kind === 'end' && continues(node) ? connected(ctx.doc, node.id)[0] : undefined
    const at = ctx.pos.get(node.id)
    if (!run || !at || !ctx.geometry.has(run.id)) continue
    const index = run.from === node.id ? 0 : 1
    if (pipePrepAt(ctx.doc, run, index) === 'BW' && (index === 0 ? run.fromField : run.toField)) draw.weld(at, true, node.id)
  }
  // Flow arrows: one on each straight whose pipes carry a flow direction, on its longest piece.
  for (const leg of sheetLegs(ctx)) {
    const flowing = leg.runs.map(r => ctx.geometry.get(r.id)!).filter(g => !g.run.connector && g.run.showFlow!==false && flowDirection(g))
    const g = flowing.find(g=>g.run.flowPosition!=null) ?? flowing.sort((a, b) => b.length - a.length)[0]
    if (!g) continue
    const ea = ctx.extent.get(g.run.from) ?? 0, eb = ctx.extent.get(g.run.to) ?? 0, span = g.length - ea - eb, half = 0.9 * T
    if (span < 3.6 * T) continue
    const best = [0.3, 0.7, 0.2, 0.8, 0.5].map(t => add2(g.a, scale2(g.dir, ea + span * t)))
      .map(p => ({ p, cost: ctx.place.cost([sub2(p, scale2(g.dir, half)), add2(p, scale2(g.dir, half))], o => o.owner === g.run.id) }))
      .sort((a, b) => a.cost - b.cost)[0]
    let at=best.p
    if(g.run.flowPosition!=null){
      const wanted=g.run.flowPosition*g.length
      const spans=visiblePipe.get(g.run.id)?.filter(([a,b])=>b-a>2*half) ?? []
      if(spans.length){
        const station=spans.map(([a,b])=>Math.max(a+half,Math.min(b-half,wanted))).sort((a,b)=>Math.abs(a-wanted)-Math.abs(b-wanted))[0]
        at=add2(g.a,scale2(g.dir,station))
      }
    }
    asSymbol(ctx.out, 'FLOW-ARROW', at, turnOf(flowDirection(g)!), () => draw.arrowhead(at, flowDirection(g)!, g.run.id))
  }
  // Where the line runs on into another spool of this drawing, that spool's next components are drawn beyond the
  // shared point in place of the continuation break.
  for (const node of ctx.nodes) {
    draw.symbol(node)
    const path=node.continuation?.paperPath
    if(path){
      poly(path,'SYMBOL',node.id)
      const tip=path.at(-1)!,out=unit2(sub2(tip,path.at(-2)!)),across=ctx.axis([1,0,0]),f=frame(tip,out,across)
      if(node.continuation?.endMarker==='tube')draw.box(f,0,0.9*T,0.45*T,node.id)
      if(node.continuation?.endMarker==='break')draw.continuation(tip,out,across,node.id,0)
    }
  }
  for (const id of shared) ghosts(ctx, ctx.doc, getNode(ctx.doc, id))
  for (const r of references) {
    const at = ctx.pos.get(r.atNodeId)
    if (!at) continue
    const doc = referenceDocument(ctx.doc, r)
    ghosts(ctx, doc, getNode(doc, r.anchorNodeId), {
      limit: r.components ?? 1, dimensionTo: r.dimensionTo, atNodeId: r.atNodeId, anchorAt: at,
      drawAnchor: getNode(ctx.doc, r.atNodeId).kind !== getNode(doc, r.anchorNodeId).kind, endBreak: r.termination !== 'plain',
      pipeWeight: !!r.pipeWeight, referenceId: r.id
    })
  }
}
/** The page direction from a node along one of its pipes. */
const toward = (ctx: IsoContext, node: PipeNode, run: PipeRun): Point => {
  const g = ctx.geometry.get(run.id)!
  return run.from === node.id ? g.dir : scale2(g.dir, -1)
}

/** The symbol drawing of one context: a sheet, or an adjacent drawing shown beyond it. */
function symbolDrawer(ctx: IsoContext, scene: Scene) {
  const { line, poly, circle, text } = emitters(ctx), s: DraftingSizes = sizeOf(ctx), T = s.text
  const codeOf = (node: PipeNode) => nodeCode(ctx.doc, node) ?? ''
  const familyOf = (node: PipeNode) => symbolOf(ctx.doc, node)
  const { equipment, shared } = scene

  function weld(p: Point, field: boolean, owner: string) {
    asSymbol(ctx.out, field ? 'FIELD-WELD' : 'WELD', p, 0, () => {
      if (!field) { circle(p, s.weld, 'WELD', owner, true); return }
      const r = s.fieldWeld, d = r * Math.SQRT1_2
      circle(p, r, 'WELD', owner, false)
      line(add2(p, [-d, -d]), add2(p, [d, d]), 'WELD', owner)
      line(add2(p, [-d, d]), add2(p, [d, -d]), 'WELD', owner)
    })
  }
  /** The socket a pipe end is set into: a bar across the pipe at the joint, its sides running back along the pipe. */
  function socket(p: Point, out: Point, node: PipeNode, g: RunGeometry) {
    let across = Math.abs(g.dir3[2]) < 0.7 ? flatAcrossOf(ctx, out, g.dir3) : undefined
    if (!across) {
      // On a riser the socket lies in the plane of the fitting's other pipe.
      const other = connected(ctx.doc, node.id).map(r => ctx.geometry.get(r.id)).find(o => o && o.run.id !== g.run.id && Math.abs(o.dir3[2]) < 0.7)
      across = other ? other.dir : acrossOf(ctx, out, g.dir3)
    }
    const k = 0.55 * T, f = frame(p, out, unit2(across))
    asSymbol(ctx.out, 'SOCKET', p, turnOf(out), () => poly([f(k, -k), f(0, -k), f(0, k), f(k, k)], 'SYMBOL', node.id, { weight: s.thin }))
  }
  function arrowhead(tip: Point, dir: Point, owner: string, length = s.flowArrow, width = s.flowArrowWidth) {
    const u = unit2(dir), base = sub2(tip, scale2(u, length)), n = scale2(left2(u), width)
    poly([tip, add2(base, n), sub2(base, n)], 'SYMBOL', owner, { closed: true, fill: true })
  }
  /** A flange's half-height across the pipe and its plate's thickness, by the size class of its pipes. */
  function flangeRadius(owner:string){return nodeBore(ctx.doc,getNode(ctx.doc,owner))*0.57*T}
  function flangePlate(owner:string){return Math.max(1,nodeBore(ctx.doc,getNode(ctx.doc,owner))-1)*0.083*T}
  function flangePair(at: Point, along: Point, across: Point, owner: string, sides: Array<1 | -1>, gap = s.flangeGap) {
    const f = frame(at, along, across), F = flangeRadius(owner), t = s.flangeThickness, plate = flangePlate(owner)
    for (const side of sides)
      poly([f(side * (gap+t-plate), -F), f(side * (gap + t), -F), f(side * (gap + t), F), f(side * (gap+t-plate), F)], 'SYMBOL', owner, { closed: true })
  }
  function box(f: (x: number, y: number) => Point, x0: number, x1: number, h: number, owner: string, weight?: number) {
    poly([f(x0, -h), f(x1, -h), f(x1, h), f(x0, h)], 'SYMBOL', owner, { closed: true, ...(weight ? { weight } : {}) })
  }
  function drawSymbol(node: PipeNode) {
    const at = ctx.pos.get(node.id)
    if (!at) return
    const code = codeOf(node), family = familyOf(node)
    const edges = connected(ctx.doc, node.id).filter(r => ctx.geometry.has(r.id))
    const host = edges[0] ?? ctx.runs.find(r => r.id === node.associatedRunId)
    const g = host && ctx.geometry.get(host.id)
    if (!g) return
    const flangeConnector = node.kind==='flange' && edges.length===1 && edges[0].connector && getNode(ctx.doc,edges[0].from===node.id?edges[0].to:edges[0].from).kind==='flange'
    const along = edges[0] ? scale2(toward(ctx, node, edges[0]),flangeConnector?-1:1) : g.dir
    const across = planeOr(ctx, node.symbolPlane==='alternate'&&Math.abs(g.dir3[2])>.7?ctx.axis([0,1,0]):node.symbolPlane==='plan' ? flatAcrossOf(ctx,along,g.dir3)
      : node.symbolPlane==='vertical' && Math.abs(g.dir3[2])<.7 ? ctx.axis([0,0,1]) : acrossOf(ctx, along, g.dir3), along, g.dir3)
    const f = frame(at, along, across)
    // Catalogue glyph strokes use negative y for up the sheet.
    const glyph = frame(at, along, scale2(across, -1))
    const owner = node.id
    // A pipe end draws the equipment fitted to it, or the break of the pipe continuing on another drawing.
    const fitted = node.kind === 'end' ? equipment.get(node.id) : undefined
    const name = node.kind !== 'end' ? symbolName(ctx.doc, node) : fitted ? symbolName(ctx.doc, fitted) : 'PIPE-BREAK'
    asSymbol(ctx.out, name, at, turnOf(along), () => drawKind(node, code, family, at, along, across, g, f, glyph, edges))
  }
  function drawKind(node: PipeNode, code: string, family: SymbolFamily, at: Point, along: Point, across: Point, g: RunGeometry,
    f: (x: number, y: number) => Point, glyph: (x: number, y: number) => Point, edges: PipeRun[]) {
    const owner = node.id
    switch (node.kind) {
      case 'elbow90': case 'elbow45': case 'tee': case 'weld': return
      case 'end': {
        const fitted = equipment.get(node.id)
        if (fitted) equipmentAt(fitted, at, scale2(along, -1), across, 0)
        else if (continues(node) && !node.continuation!.paperPath && !shared.has(node.id)) continuation(at, scale2(along, -1), across, owner, 0)
        return
      }
      case 'valve': return valve(node, code, at, along, across, edges)
      case 'flange': {
        const F = flangeRadius(owner), t = s.flangeThickness
        if (family === 'blind-flange') {
          flangePair(at, along, across, owner, [1])
          poly([f(-s.flangeGap, -F), f(-s.flangeGap - t * 1.4, -F), f(-s.flangeGap - t * 1.4, F), f(-s.flangeGap, F)], 'SYMBOL', owner, { closed: true, fill: true })
          return
        }
        const pair = isFlangePair(ctx.doc, node)
        if (pair) { flangePair(at, along, across, owner, [-1, 1]); hache(f, 0, owner) }
        else {
          flangePair(at, along, across, owner, [1], 0)
          // The flange it bolts to, and the pipe beyond on the next drawing, are drawn thin; equipment is drawn as such.
          const fitted = equipment.get(node.id), out = scale2(along, -1)
          if (fitted || node.continuation || shared.has(node.id)) hache(f, -s.flangeGap / 2, owner)
          if (fitted) equipmentAt(fitted, at, out, across, s.flangeGap)
          else if (node.continuation && !shared.has(node.id)) {
            const fo = frame(at, out, across), plate=flangePlate(owner), x = s.flangeGap + t
            poly([fo(x-plate, -F), fo(x, -F), fo(x, F), fo(x-plate, F)], 'SYMBOL', owner, { closed: true, weight: s.thin })
            if (continues(node)) continuation(at, out, across, owner, x)
          }
        }
        // Lap-joint flanges show the stub-end lap at the face.
        if (family === 'lap-joint-flange' || family === 'stub-end')
          for (const side of pair ? [-1, 1] : [1]) line(f(side * 0.06 * T, -F * 0.55), f(side * 0.06 * T, F * 0.55), 'SYMBOL', owner, s.thin)
        return
      }
      case 'reducer': {
        // A reducing coupling is a coupling: a box on plan, its joints marked as screwed or socketed.
        const d = drafting(ctx.doc, node)
        if (family === 'reducing-coupling') { box(frame(at, along, flatAcrossOf(ctx, along, g.dir3)), -d.body!.length * T, d.body!.length * T, d.body!.width * T, owner); return }
        const big = edges.reduce((a, b) => a.nps >= b.nps ? a : b, edges[0])
        const dir = big ? scale2(toward(ctx, node, big), -1) : along, eccentric = family === 'eccentric-reducer'
        // An eccentric reducer is drawn in the plane of its flat side, the flat side away from `across`.
        const flat = eccentric && node.flatSide ? ctx.axis(FLAT_SIDE[node.flatSide]) : undefined
        const side = flat && len2(flat) > 0.2 && Math.abs(dot2(unit2(flat), unit2(dir))) < 0.97 ? scale2(unit2(flat), -1) : acrossOf(ctx, dir, g.dir3)
        const fr = frame(at, scale2(dir,len2(ctx.direction(g.dir3))), side)
        const {halfLength:h,largeRadius:w1,smallRadius:w2,flatLarge:W,flatSmall:w}=reducerGeometry(ctx.doc,node,T)
        // Its flat side runs straight on from the large end's; the small end stands a small step toward it.
        poly(eccentric ? [fr(-h, -W), fr(h, -W), fr(h, 2 * w - W), fr(-h, W)] : [fr(-h, -w1), fr(h, -w2), fr(h, w2), fr(-h, w1)], 'SYMBOL', owner, { closed: true })
        return
      }
      case 'cap': {
        // Cut-to-suit tubing has an open rectangular end, rather than a cap's closed dish.
        if (family === 'tube-end') { box(f, -0.45 * T, 0.45 * T, 0.45 * T, owner); return }
        if (family === 'quick-coupling-cap') {
          const w=camlockGeometry(ctx.doc,node,T).capRadius
          poly([f(2*w,-w),f(w,-w),f(w,w),f(2*w,w)],'SYMBOL',owner)
          return
        }
        // A screwed or socket cap is drawn as its body round the pipe end; a butt-weld cap as its dish.
        if (family === 'socket-cap') {
          const w = 0.68 * T
          poly([f(w + 0.3 * T, -w), f(0, -w), f(0, w), f(w + 0.3 * T, w)], 'SYMBOL', owner)
          return
        }
        if (family !== 'cap') return catalogue(code, node.kind, glyph, owner)
        const out = scale2(along, -1), fc = frame(at, out, across), w = 0.91 * T
        poly([fc(0, -w), fc(0.53 * T, -w * 0.75), fc(0.83 * T, 0), fc(0.53 * T, w * 0.75), fc(0, w)], 'SYMBOL', owner, { closed: true })
        return
      }
      case 'olet': return olet(node, code, at, along, g)
      case 'support': return family === 'wall' ? wall(owner, at, f) : support(node, code, at, along, across)
      case 'annotation': return annotation(node, code, at, g)
      default: catalogue(code, node.kind, glyph, owner)
    }
  }
  /** Everything else uses its catalogue symbol, laid into the isometric plane. */
  function catalogue(code: string, kind: PipeNode['kind'], glyph: (x: number, y: number) => Point, owner: string, scale = GLYPH.scale * T) {
    for (const stroke of symbolStrokes(code, kind)) {
      if ('l' in stroke) line(glyph(stroke.l[0] * scale, stroke.l[1] * scale), glyph(stroke.l[2] * scale, stroke.l[3] * scale), 'SYMBOL', owner)
      else if ('c' in stroke) circle(glyph(stroke.c[0] * scale, stroke.c[1] * scale), stroke.c[2] * scale, 'SYMBOL', owner, !!stroke.fill)
    }
  }
  /** The pipe continuing on another drawing: a thin length ending in an S-break. */
  function continuation(at: Point, out: Point, across: Point, owner: string, from: number) {
    const fo = frame(at, out, across), reach = from + s.stub, h = 1.2 * T
    line(fo(from + 0.15 * T, 0), fo(reach, 0), 'SYMBOL', owner, s.thin)
    const pts: Point[] = []
    for (let i = 0; i <= 12; i++) { const y = -h + i * h / 6; pts.push(fo(reach + 0.45 * T * Math.sin(y / h * Math.PI), y)) }
    poly(pts, 'SYMBOL', owner, { weight: s.thin })
  }
  /** Equipment flange and nozzle neck beyond a pipe end, with the outline of the equipment where it is drawn. */
  function equipmentAt(node: PipeNode, at: Point, out: Point, across: Point, from: number) {
    const owner=node.id, f = frame(at, out, across), F = flangeRadius(owner), t = s.flangeThickness * 1.6, neck = from + t + 2.4 * T
    poly([f(from, -F * 1.15), f(from + t, -F * 1.15), f(from + t, F * 1.15), f(from, F * 1.15)], 'SYMBOL', owner, { closed: true })
    const outline = familyOf(node) === 'equipment'
    for (const side of [-1, 1]) {
      if (outline) dashed(f(from + t, side * F * 0.5), f(neck, side * F * 0.5), owner)
      else line(f(from + t, side * F * 0.5), f(neck, side * F * 0.5), 'SYMBOL', owner)
    }
    if (!outline) return
    const centre=equipmentCentre(ctx,node,at,out)
    if(node.equipmentShape==='vessel'){
      const east=ctx.axis([1,0,0]),down=ctx.axis([0,0,-1])
      const head=(a:number)=>add2(centre,add2(scale2(east,4.24*T*Math.cos(a)),scale2(down,2.73*T*Math.sin(a))))
      const arc=Array.from({length:25},(_,i)=>head(i/24*Math.PI))
      inLinetype(ctx.out,'dashed',()=>poly(arc,'SYMBOL',owner,{weight:s.thin}))
      for(const end of [arc[0],arc.at(-1)!])dashed(end,add2(end,scale2(down,-3.33*T)),owner)
      // Two legs meet a narrow skid seen along the nozzle's plane.
      const near=1.52*T,far=11.4*T,half=0.3*T
      const skidA=add2(at,scale2(out,near)),skidB=add2(at,scale2(out,far)),skid=frame(at,out,across)
      for(const side of [-1,1])dashed(skid(near,side*half),skid(far,side*half),owner)
      for(const x of [near,far])line(skid(x,-half),skid(x,half),'SYMBOL',owner,s.thin)
      for(const a of [Math.acos(-0.35),Math.acos(0.05)]){
        const top=head(a),v=sub2(skidB,skidA),den=down[0]*v[1]-down[1]*v[0]
        const t=Math.abs(den)>1e-6?((skidA[0]-top[0])*v[1]-(skidA[1]-top[1])*v[0])/den:3.8*T
        if(t>0)dashed(top,add2(top,scale2(down,t)),owner)
      }
      return
    }
    // The outline: a vessel or casing seen in isometric, an ellipse beyond the neck.
    const R = 2.73 * T, pts: Point[] = []
    const casing=frame(centre,out,across)
    for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; pts.push(casing(Math.sin(a) * R * 0.6, Math.cos(a) * R * 1.4)) }
    if (node.equipmentShape === 'pump') for (let i = 0; i < pts.length - 1; i++) line(pts[i], pts[i + 1], 'SYMBOL', owner, s.thin)
    else inLinetype(ctx.out, 'dashed', () => poly(pts, 'SYMBOL', owner, { weight: s.thin }))
  }
  function dashed(a: Point, b: Point, owner: string) {
    if (len2(sub2(b, a)) > 1e-9) inLinetype(ctx.out, 'dashed', () => line(a, b, 'SYMBOL', owner, s.thin))
  }
  function valve(node: PipeNode, code: string, at: Point, along: Point, across: Point, edges: PipeRun[]) {
    const owner = node.id, direction=ctx.geometry.get(edges[0]?.id ?? '')?.dir3 ?? [1,0,0], axial=len2(ctx.direction(direction)), f = frame(at, scale2(along,axial), across), e = ctx.extent.get(node.id) ?? 0
    const flat = frame(at, scale2(along,axial), node.symbolPlane?across:flatAcrossOf(ctx, along, direction))
    const d = drafting(ctx.doc, node), family = d.symbol, body = d.body ? { h: d.body.length * T, w: d.body.width * T } : undefined
    switch (family) {
      case 'nipple': box(frame(at,along,across), -e, e, NIPPLE.radius * T * boreClass(Math.max(...edges.map(r=>r.nps)), 1), owner, s.thin); return
      // Couplings and unions lie flat: a square on plan round a level pipe.
      case 'union': box(flat, -body!.h, body!.h, body!.w, owner); line(flat(-body!.h, 0), flat(body!.h, 0), 'SYMBOL', owner); return
      case 'coupling': case 'regulator': box(flat, -body!.h, body!.h, body!.w, owner); return
      case 'quick-coupling': {
        // Its groove is at the open end, toward the cap or the end of the line.
        const open = edges.find(r => ['cap', 'end'].includes(getNode(ctx.doc, r.from === node.id ? r.to : r.from).kind))
        const fo = open ? frame(at, scale2(toward(ctx, node, open),axial), across) : f,{halfLength:h,radius:w}=camlockGeometry(ctx.doc,node,T)
        box(fo, -h, h, w, owner)
        for (const x of [0.45 * T, 0.7 * T]) line(fo(x, -w), fo(x, w), 'SYMBOL', owner)
        return
      }
      case 'hose': return hose(node, code, at, scale2(along,axial), across)
      case 'dampener': return dampener(node, at, along, across)
      case 'relief': return relief(node, code, at, edges)
      case 'meter': box(f, -body!.h, body!.h, body!.w, owner); if (flangedPort(code)) flanges(f, body!.h, owner); return
    }
    // Every line valve is a bow-tie in its plane, actuated butterfly valves with the actuator's dome. A plain
    // butterfly valve is its disc between the flanges, on a short stem toward its operator. A check valve points with
    // the flow: one triangle from its inlet to its outlet, with an arrow.
    const butterfly = family === 'butterfly', ball = family === 'ball', disc = discValve(ctx.doc, node)
    const h = disc ? discGeometry(ctx.doc,node,undefined,T).body : valveBodyOnSheet(ctx, node, T), w = valveBodyHalfWidth(ctx.doc, node, T)
    const check = family === 'check'
    if (check) {
      const flowing = edges.map(r => ctx.geometry.get(r.id)!).find(g => g && flowDirection(g))
      const out = edges.find(r => r.from === node.id)
      const dir = flowing ? flowDirection(flowing)! : out ? toward(ctx, node, out) : along
      const swing=swingCheck(ctx.doc,node), triangle=triangleCheck(ctx.doc,node)
      const rawCross=node.symbolPlane?across:swing||triangle?flatAcrossOf(ctx,dir,direction):acrossOf(ctx,dir,direction)
      const cross=swing&&rawCross[1]<0?scale2(rawCross,-1):rawCross
      const fc=frame(at,scale2(dir,axial),cross)
      if(swing){
        const points=[fc(-h,w),fc(-h,-w),fc(h,w),fc(h,-w)]
        poly(points,'SYMBOL',owner)
        const tip=points[2],u=unit2(sub2(tip,points[1])),base=sub2(tip,scale2(u,0.83*T)),n=scale2(left2(u),s.flowArrowWidth)
        poly([tip,add2(base,n),sub2(base,n)],'SYMBOL',owner,{closed:true})
      }else{
        poly([fc(-h, -w), fc(h, 0), fc(-h, w)], 'SYMBOL', owner, { closed: true })
        if(!triangle){line(fc(-h * 0.55, 0), fc(h * 0.45, 0), 'SYMBOL', owner, s.thin)
        arrowhead(fc(h * 0.75, 0), dir, owner, 0.76 * T, 0.27 * T)}
      }
    } else if (disc) {
      // The short body between its flange faces carries the pipe's centreline through it, and its disc stands open on
      // the stem across the bore: an outline in the plane of the faces, as tall as the bore and as thick as the body.
      const across = flangeRadius(owner) * DISC_ACROSS
      line(f(-h, 0), f(h, 0), 'SYMBOL', owner)
      poly(Array.from({ length: 24 }, (_, i) => f(h * DISC_ALONG * Math.cos(i * Math.PI / 12), across * Math.sin(i * Math.PI / 12))), 'SYMBOL', owner, { closed: true })
    }
    else if (ball) {
      const radius = 0.73 * T, span = Math.hypot(h, w), x = radius * h / span, y = radius * w / span
      for (const side of [-1, 1]) poly([f(side * x, -side * y), f(side * h, -side * w), f(side * h, side * w), f(side * x, side * y)], 'SYMBOL', owner)
      poly(Array.from({ length: 32 }, (_, i) => f(radius * Math.cos(i * Math.PI / 16), radius * Math.sin(i * Math.PI / 16))), 'SYMBOL', owner, { closed: true })
    } else poly([f(-h, -w), f(h, w), f(h, -w), f(-h, w)], 'SYMBOL', owner, { closed: true })
    if (flangedPort(code)) {
      if(disc){
        const planes=discGeometry(ctx.doc,node,undefined,T),outer=planes.plate,F=flangeRadius(owner)*.98,plate=flangePlate(owner)
        for(const side of [-1,1]){
          line(f(side*h,-F),f(side*h,F),'SYMBOL',owner)
          poly([f(side*(outer-plate),-F),f(side*outer,-F),f(side*outer,F),f(side*(outer-plate),F)],'SYMBOL',owner,{closed:true})
          hache(f,side*planes.mate,owner)
        }
      }else flanges(f,h,owner)
    }
    const operator = valveOperatorOf(ctx.doc, node)
    if (check || operator === 'none') return
    // The valve type at its centre: globe a filled dot, ball a ball, plug its plug.
    const plug = family === 'plug-valve'
    if (family === 'globe') circle(at, 0.36 * T, 'SYMBOL', owner, true)
    if (plug) poly([f(-0.53 * T, 0), f(0, -0.53 * T), f(0.53 * T, 0), f(0, 0.53 * T)], 'SYMBOL', owner, { closed: true, fill: true })
    // Operator on its stem: handwheel for gate/globe, lever for ball/plug, actuator dome for butterfly and control valves.
    const stemDir = operatorDirection(node.operator)
    const stem = stemDir && len2(ctx.axis(stemDir)) > 0.05 ? unit2(ctx.axis(stemDir)) : across
    // A butterfly disc's stem leaves the body past its flanges.
    const reach = disc ? Math.max(2.8 * T, flangeRadius(owner) + 0.6 * T) : butterfly ? 1.74 * T : w + (ball ? 1.67 : 1.36) * T
    const top = add2(at, scale2(stem, reach)), side = Math.abs(dot2(stem, along)) > 0.9 ? left2(stem) : along
    if (disc && operator === 'lever') {
      const tip = top
      line(at, tip, 'SYMBOL', owner)
      line(tip, add2(tip, scale2(side, 1.21 * T)), 'SYMBOL', owner)
      return
    }
    line(ball ? add2(at, scale2(stem, 0.6 * T)) : at, top, 'SYMBOL', owner)
    const ft = frame(top, side, stem), k = (x: number, y: number) => ft(x * T, y * T)
    if(operator==='box')poly([k(-1.21,0),k(1.21,0),k(1.21,2.27),k(-1.21,2.27)],'SYMBOL',owner,{closed:true})
    else if (operator === 'actuator') poly([k(-0.76, 0), k(-0.64, 0.26), k(-0.32, 0.42), k(0, 0.48), k(0.32, 0.42), k(0.64, 0.26), k(0.76, 0), k(-0.76, 0)], 'SYMBOL', owner, { closed: true })
    else if (operator === 'lever') line(top, add2(top, scale2(side, (ball ? 1.21 : 1.52) * T)), 'SYMBOL', owner)
    else line(k(-1.06, 0), k(1.06, 0), 'SYMBOL', owner)
  }
  /** A flanged body's own flanges, a gap off each end. */
  function flanges(f: (x: number, y: number) => Point, h: number, owner: string, respectSupply=false) {
    const node=getNode(ctx.doc,owner),F=flangeRadius(owner),plate=flangePlate(owner),planes=flangedGeometry(ctx.doc,node,h,T),centre=f(0,0),axis=unit2(sub2(f(1,0),centre))
    for (const side of [-1, 1]) {
      const edge=respectSupply?connected(ctx.doc,owner).filter(r=>ctx.geometry.has(r.id)).find(r=>dot2(toward(ctx,node,r),axis)*side>.9):undefined
      if(respectSupply&&edge&&node.portFlanges?.[edge.id]?.component==='NONE')continue
      poly([f(side*(planes.plate-plate),-F),f(side*planes.plate,-F),f(side*planes.plate,F),f(side*(planes.plate-plate),F)],'SYMBOL',owner,{closed:true})
      hache(f,side*planes.mate,owner)
    }
  }
  /** The gasket's hache mark: a broken line across the joint at the gasket, beside the flange faces. */
  function hache(f: (x: number, y: number) => Point, x: number, owner: string) {
    const F = flangeRadius(owner) * 1.15
    for (const [a, b] of [[-F, -F * 0.55], [-F * 0.25, F * 0.25], [F * 0.55, F]]) line(f(x, a), f(x, b), 'SYMBOL', owner, s.thin, false)
  }
  /** A hose: corrugated between flanged ends, or a single wavy line between screwed ends. */
  function hose(node: PipeNode, code: string, at: Point, along: Point, across: Point) {
    if(node.hosePath?.length){poly(node.hosePath,'SYMBOL',node.id);return}
    const d = drafting(ctx.doc, node), f = frame(at, along, across), h = (d.body?.length ?? 2.73) * T, wave = 0.38 * T, owner = node.id
    if (flangedPort(code)) {
      const y0 = (d.body?.width ?? 1.29) * T
      for (const y of [-y0, y0]) poly(Array.from({ length: 9 }, (_, i) => f(-h + i * h / 4, y + Math.sign(y)*(i % 2 ? -wave : wave))), 'SYMBOL', owner)
      for (const side of [-1, 1]) line(f(side * h, -1.67 * T), f(side * h, 1.67 * T), 'SYMBOL', owner)
      flanges(f, h, owner,true)
      return
    }
    poly(Array.from({ length: 33 }, (_, i) => f(-h + i * h / 16, wave * Math.sin(i / 16 * Math.PI * 4))), 'SYMBOL', owner)
  }
  /** A one-port vessel on the pipe end: its flange bolted to the pipe's, a neck and a dome, by its size class. */
  function dampener(node: PipeNode, at: Point, along: Point, across: Point) {
    const out = scale2(along, -1), f = frame(at, out, across), owner = node.id, F = flangeRadius(owner)
    const u = nodeBore(ctx.doc, node) * T, base = 1.85 * u
    box(f, 0.167 * u, 0.45 * u, F, owner)
    const plate=flangePlate(owner)
    poly([f(-0.38 * u,-F),f(-0.38 * u+plate,-F),f(-0.38 * u+plate,F),f(-0.38 * u,F)],'SYMBOL',owner,{closed:true})
    hache(f,-0.09 * u,owner)
    for (const side of [-1, 1]) line(f(0.45 * u, side * F * .5), f(base, side * F * .5), 'SYMBOL', owner)
    const W = 2.02 * u, H = 0.76 * u, pts: Point[] = []
    for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI; pts.push(f(base + Math.sin(a) * H, -Math.cos(a) * W)) }
    poly(pts, 'SYMBOL', owner, { closed: true })
  }
  /** A relief valve: two triangles meeting at its centre, one along the inlet and one along the outlet. */
  function relief(node: PipeNode, code: string, at: Point, edges: PipeRun[]) {
    const owner = node.id, d = drafting(ctx.doc, node), h = (d.body?.length ?? 2.27) * T
    for (const run of edges) {
      const g = ctx.geometry.get(run.id)!, dir = toward(ctx, node, run), f = frame(at, scale2(dir,len2(ctx.direction(g.dir3))), acrossOf(ctx, dir, g.dir3))
      const flat=Math.abs(g.dir3[2])<.05&&!isAxial(g.dir3),w=flat?1.09*T/len2(acrossOf(ctx,dir,g.dir3)):(d.body?.width ?? 1.41)*T
      poly([f(0, 0), f(h, -w), f(h, w)], 'SYMBOL', owner, { closed: true })
      if (flangedPort(code)) { const F=flangeRadius(owner),plate=flangePlate(owner),planes=flangedGeometry(ctx.doc,node,h,T); poly([f(planes.plate-plate,-F),f(planes.plate,-F),f(planes.plate,F),f(planes.plate-plate,F)],'SYMBOL',owner,{closed:true});hache(f,planes.mate,owner) }
    }
  }
  /** Sockolets, threadolets and weldolets are a body on the header; half couplings a short box. */
  function olet(node: PipeNode, code: string, at: Point, branch: Point, g: RunGeometry) {
    const header = node.associatedRunId ? ctx.geometry.get(node.associatedRunId) : undefined
    const owner = node.id, d = drafting(ctx.doc, node)
    const side = header && Math.abs(dot2(header.dir, branch)) < 0.97 ? header.dir : left2(branch), f = frame(at, branch, side)
    if (d.symbol === 'olet') {
      poly([...OLET.map(([x, y]) => f(x * T, y * T)), ...OLET.slice().reverse().map(([x, y]) => f(x * T, -y * T))], 'SYMBOL', owner, { closed: true })
      circle(at, s.weld * 1.2, 'WELD', owner, true)
      return
    }
    if (d.symbol === 'half-coupling') { const h = d.body!.length * T; box(frame(add2(at, scale2(branch, h)), branch, side), -h, h, d.body!.width * T, owner); return }
    catalogue(code, 'olet', frame(at, branch, scale2(acrossOf(ctx, branch, g.dir3), -1)), owner)
  }
  function support(node: PipeNode, code: string, at: Point, along: Point, across: Point) {
    if(node.supportSymbol==='callout')return
    const owner = node.id, f = frame(at, along, across), family = familyOf(node)
    // A hanger is a triangle standing on the pipe, its far half filled; a U-bolt is an X across the pipe.
    if (family === 'hanger') {
      const rise = 1.91 * T, tip=at,top=(x:number)=>add2(add2(at,scale2(across,rise)),scale2(along,x)),half=rise/2,left=top(-half)[0]<=top(half)[0]?-half:half
      poly([tip,top(-half),top(half)],'SYMBOL',owner,{closed:true})
      poly([tip,top(left),top(0)],'SYMBOL',owner,{closed:true,fill:true})
      line(tip,add2(top(0),scale2(across,rise)),'SYMBOL',owner)
      return
    }
    if (family === 'u-bolt') {
      const x = 1.02 * T, y = 0.57 * T
      line(f(-x, -y), f(x, y), 'SYMBOL', owner)
      line(f(-x, y), f(x, -y), 'SYMBOL', owner)
      line(f(0,-1.68 * T),f(0,1.68 * T),'SYMBOL',owner)
      return
    }
    const glyph = frame(at, along, scale2(across, -1)), k = GLYPH.support * T
    for (const stroke of symbolStrokes(code, 'support'))
      if ('l' in stroke) line(glyph(stroke.l[0] * k, stroke.l[1] * k), glyph(stroke.l[2] * k, stroke.l[3] * k), 'SYMBOL', owner)
  }
  function annotation(node: PipeNode, code: string, at: Point, g: RunGeometry) {
    const owner = node.id, label = node.calloutText ?? '', d = drafting(ctx.doc, node), family = d.symbol
    const across = planeOr(ctx, family === 'insulation' && Math.abs(g.dir3[2]) > .7 ? ctx.axis([0,1,0]) : acrossOf(ctx, g.dir, g.dir3), g.dir, g.dir3), f = frame(at, g.dir, across)
    if (family === 'flow-arrow') {
      const k = d.symbolScale ?? 1, dir = flowDirection(g) ?? g.dir
      arrowhead(add2(at, scale2(dir, s.flowArrow / 2 * k)), dir, owner, s.flowArrow * k, s.flowArrowWidth * k)
      return
    }
    if (family === 'insulation-limit') return insulationEnd(node, label, at, g)
    if (family === 'insulation') {
      // A short open cylinder round the pipe, lettered with the insulation thickness in the pipe's plane.
      const thickness = insulationText(ctx.doc, label), L = insulationLength(thickness, T), H = INSUL.half * T, x = L / 2, bulge = 0.27 * T
      for(const side of [-1,1])line(f(-x,side*H),f(x,side*H),'SYMBOL',owner)
      for(const end of [-1,1]){
        poly(Array.from({length:17},(_,i)=>{const t=i/8-1;return f(end*x+end*bulge*Math.sin(Math.PI*t),H*t)}),'SYMBOL',owner)
        poly(Array.from({length:9},(_,i)=>{const t=end*i/8;return f(end*x-end*bulge*Math.sin(Math.PI*t),H*t)}),'SYMBOL',owner)
      }
      if (thickness) {
        const up=across[1]<0?across:scale2(across,-1),turn=readable(planeText(g.dir,up)),key=`insulation:${owner}`,labelAt=ctx.labelPositions?.[key]??add2(at,scale2(up,H))
        text(labelAt,thickness,T*.55,'TEXT',owner,{rotation:turn.rotation,oblique:turn.oblique,anchor:'middle',label:{key,at:labelAt,spool:ctx.spool}})
      }
      return
    }
    if (family === 'wall') return wall(owner, at, f)
    if (SELF_LETTERED.has(family)) return
    catalogue(code, 'annotation', frame(at, g.dir, scale2(across, -1)), owner)
  }
  /** A wall penetration: the wall line across the pipe, broken by the sleeve cloud round it. */
  function wall(owner: string, at: Point, f: (x: number, y: number) => Point) {
    const r = 1.06 * T, pts: Point[] = []
    for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2; pts.push(add2(at, scale2([Math.cos(a), Math.sin(a)], r * (1 + 0.12 * Math.abs(Math.sin(a * 4)))))) }
    poly(pts, 'SYMBOL', owner, { closed: true })
    for (const side of [-1, 1]) line(f(0, side * (r + 0.23 * T)), f(0, side * 3.64 * T), 'SYMBOL', owner, s.thin)
  }
  /** Where insulation stops: a two-way arrow beside the pipe with a tick at the limit, INSUL. one side and NONE the other. */
  function insulationEnd(node: PipeNode, label: string, at: Point, g: RunGeometry) {
    const owner = node.id, across = acrossOf(ctx, g.dir, g.dir3), down = scale2(across, -1)
    const a=getNode(ctx.doc,g.run.from).position,b=getNode(ctx.doc,g.run.to).position,v=b.map((x,i)=>x-a[i]),square=v.reduce((sum,x)=>sum+x*x,0)
    const station=square?v.reduce((sum,x,i)=>sum+x*(node.position[i]-a[i]),0)/square:0,target=lerp2(g.a,g.b,station),moved=len2(sub2(at,target))>0.76*T
    const base = moved?at:add2(at, scale2(down, 2.12 * T)), f = frame(base, g.dir, down), L = 2.58 * T, head = 1.36 * T
    if(moved)line(base,target,'LEADER',owner,s.thin)
    line(f(-L, 0), f(L, 0), 'SYMBOL', owner, s.thin)
    circle(base,s.weld,'SYMBOL',owner,true)
    for (const side of [-1, 1]) poly([f(side * L, 0), f(side * (L - head), -0.27 * T), f(side * (L - head), 0.27 * T)], 'SYMBOL', owner, { closed: true, weight: s.thin })
    // Each word stands beyond the arrow, away from the pipe, on its own side of the limit.
    const [first, second] = insulationWords(label), turn = node.calloutPlane==='sheet'?{rotation:0,oblique:0}:readable(planeText(g.dir, across))
    if(node.calloutPlane!=='pipe')turn.oblique=0
    const facing = dot2(uprightOf(turn), down), clear = 0.38 * T
    for (const [i,[word, side]] of ([[first, -1], [second, 1]] as Array<[string, number]>).entries())
      if (word) {
        const key=`insulation-limit:${owner}:${i}`,point=ctx.labelPositions?.[key]??add2(f(side * L, 0), scale2(down, facing >= 0 ? clear : clear + T / Math.max(0.5, -facing)))
        text(point, word, T, 'TEXT', owner, { rotation: turn.rotation, oblique: turn.oblique, anchor: 'middle',label:{key,at:point,spool:ctx.spool} })
      }
  }
  return { symbol: drawSymbol, weld, socket, arrowhead, box, continuation }
}

interface GhostOptions {
  /** Components to show; zero shows the adjoining pipe cut only. */
  limit?: number
  dimensionTo?: string
  /** The sheet node an adjacent drawing joins at, and where it stands on the page. */
  atNodeId?: string
  anchorAt?: Point
  drawAnchor?: boolean
  endBreak?: boolean
  pipeWeight?: boolean
  referenceId?: string
}
/**
 * Up to three components of the next spool, or of an adjacent drawing, beyond a shared point: thin, with dashed pipe
 * and no tags. They are drawn in a context of their own, so the sheet's own positions and joints are untouched.
 */
function ghosts(parent: IsoContext, doc: IsoDocument, start: PipeNode, options: GhostOptions = {}) {
  const { limit = 3, dimensionTo, atNodeId, drawAnchor = false, endBreak = true, pipeWeight = false, referenceId } = options
  const s = sizeOf(parent), T = s.text
  const ctx: IsoContext = {
    ...parent, doc, size: s, pos: new Map(parent.pos), extent: new Map(parent.extent), geometry: new Map(parent.geometry),
    joints: parent.memo ? parent.memo.joints(doc) : flangedJoints(doc)
  }
  if (options.anchorAt) ctx.pos.set(start.id, options.anchorAt)
  const { line } = emitters(ctx), draw = symbolDrawer(ctx, { equipment: new Map(), shared: new Set() }), text = emitters(ctx).text
  const weight = (_nps: number) => (pipeWeight ? s.pipe : s.thin)
  const placed: string[] = [], walked: PipeRun[] = []
  const queue: Array<[PipeNode, PipeRun]> = connected(doc, start.id).filter(r => !parent.runs.includes(r)).map(r => [start, r])
  let count = 0
  const lineFragments:Array<{run:PipeRun;a:Point;b:Point;dir3:Vec3}>=[]
  while (queue.length && (count < limit || limit === 0 && !walked.length)) {
    const [from, run] = queue.shift()!, far = getNode(doc, run.from === from.id ? run.to : run.from)
    if (ctx.pos.has(far.id) && !placed.includes(far.id)) continue
    const d = far.position.map((v, i) => v - from.position[i]) as Vec3, l = Math.hypot(...d) || 1, page = unit2(ctx.axis(d))
    if (len2(page) < 0.5) continue
    ctx.pos.set(far.id, ctx.paperPositions?.[far.id] ?? add2(ctx.pos.get(from.id)!, scale2(page, run.connector ? s.stub : s.adjacent)))
    placed.push(far.id); walked.push(run)
    const a = ctx.pos.get(run.from)!, b = ctx.pos.get(run.to)!, ab = sub2(b, a)
    ctx.geometry.set(run.id, { run, a, b, dir: unit2(ab), length: len2(ab), dir3: d.map(v => v / l * (run.from === from.id ? 1 : -1)) as Vec3 })
    // Flanges come with their joint; they do not count as the next components.
    if (!['end', 'weld', 'flange', 'gasket', 'bolt'].includes(far.kind)) count++
    for (const next of connected(doc, far.id)) if (next !== run && !parent.runs.includes(next) && !walked.includes(next)) queue.push([far, next])
  }
  for (const id of placed) ctx.extent.set(id, limit === 0 ? 0 : symbolExtent(ctx, getNode(doc, id)))
  if (atNodeId) ctx.extent.set(start.id, symbolExtent(ctx, start))
  const mark = ctx.out.length
  for (const run of walked) {
    const g = ctx.geometry.get(run.id)!, ea = ctx.extent.get(run.from) ?? 0, eb = ctx.extent.get(run.to) ?? 0
    if(g.length<=ea+eb)continue
    lineFragments.push({run,a:add2(g.a,scale2(g.dir,ea)),b:add2(g.b,scale2(g.dir,-eb)),dir3:g.dir3})
    if (atNodeId) line(add2(g.a, scale2(g.dir, ea)), add2(g.b, scale2(g.dir, -eb)), 'SYMBOL', start.id, weight(g.run.nps), false)
    else inLinetype(ctx.out, 'dashed', () => line(add2(g.a, scale2(g.dir, ea)), add2(g.b, scale2(g.dir, -eb)), 'SYMBOL', start.id, weight(g.run.nps), false))
  }
  if (drawAnchor && start.kind !== 'end') draw.symbol(start)
  for(const w of weldsOf(ctx, doc)) {
    const g=ctx.geometry.get(w.runId)
    if(!g||!walked.some(r=>r.id===w.runId)||!ctx.pos.has(w.nodeId)||limit===0&&w.nodeId!==start.id)continue
    const p=weldPoint(ctx,w)
    if(p)draw.weld(p,w.field,w.nodeId)
  }
  for (const id of placed) {
    const n = getNode(doc, id), edges = connected(doc, id), entered = walked.find(r => r.from === id || r.to === id)
    if (!entered) continue
    const g = ctx.geometry.get(entered.id)!, out = entered.to === id ? g.dir : scale2(g.dir, -1)
    // The end of a context fragment is a drafting cut, rather than the distant drawing's actual end fitting.
    if (limit === 0 || atNodeId && edges.length === 1 && ['end', 'flange'].includes(n.kind)) {
      if(endBreak) draw.continuation(ctx.pos.get(id)!, out, acrossOf(ctx, out, g.dir3), n.id, 0)
    } else if (n.kind !== 'end') draw.symbol(n)
    if (atNodeId && limit > 0) for (const next of edges.filter(r => !walked.includes(r) && !parent.runs.includes(r))) {
      const far = getNode(doc, next.from === id ? next.to : next.from)
      const d = far.position.map((v, i) => v - n.position[i]) as Vec3, u = unit2(ctx.axis(d))
      const at = ctx.pos.get(id)!, tip = ctx.paperPositions?.[far.id] ?? add2(at, scale2(u, s.adjacent)), extent = ctx.extent.get(id) ?? 0
      const direction = unit2(sub2(tip, at))
      line(add2(at, scale2(direction, extent)), tip, 'SYMBOL', n.id, weight(next.nps), false)
      lineFragments.push({run:next,a:add2(at,scale2(direction,extent)),b:add2(tip,scale2(direction,endBreak&&far.continuation?.endMarker!=='plain'?s.stub:0)),dir3:unit3(d)})
      if (/^(elbow|tee)/.test(n.kind) && pipePrepAt(doc,next,next.from===id?0:1)!=='THD') {
        const reach=Math.max(0,Math.min(len2(sub2(tip,at))-s.fieldWeld,nodeBore(doc,n)*1.14*T*len2(ctx.direction(unit3(d)))))
        draw.weld(add2(at,scale2(direction,reach)),false,n.id)
      }
      if(endBreak && far.continuation?.endMarker!=='plain') draw.continuation(tip, direction, acrossOf(ctx, direction, unit3(d)), n.id, 0)
    }
  }
  const lineLabels=new Map<string,(typeof lineFragments)[number]>()
  for(const fragment of lineFragments)if(fragment.run.showLineNumber===true&&fragment.run.line){
    const previous=lineLabels.get(fragment.run.line)
    if(!previous||len2(sub2(fragment.b,fragment.a))>len2(sub2(previous.b,previous.a)))lineLabels.set(fragment.run.line,fragment)
  }
  for(const {run,a,b,dir3} of lineLabels.values()){
    const key=`reference-line:${run.id}`,held=ctx.labelPositions?.[key],dir=unit2(sub2(b,a))
    if(!held&&len2(sub2(b,a))<measureText(run.line,T)+0.6*T)continue
    const across=run.lineNumberPlane==='vertical'&&Math.abs(dir3[2])<.7?[0,-1] as Point:acrossOf(ctx,dir,dir3),plane=readable(planeText(dir,across))
    const at=held??add2(lerp2(a,b,.5),scale2(uprightOf(plane),0.3*T))
    text(at,run.line,T,'TEXT',run.id,{rotation:plane.rotation,oblique:plane.oblique,anchor:'middle',label:{key,at,spool:ctx.spool}})
  }
  for (const p of ctx.out.slice(mark)) if (p.type === 'line' || p.type === 'polyline' || p.type === 'circle') p.weight = pipeWeight ? p.weight : Math.min(p.weight ?? s.thin, s.thin)
  if (dimensionTo && atNodeId && placed.includes(dimensionTo)) {
    parent.referenceDimensions ??= []
    parent.referenceDimensions.push({ atNodeId,referenceId, model: getNode(doc, dimensionTo).position, page: ctx.pos.get(dimensionTo)! })
  }
}
/** The two words of an insulation limit, insulated side first: "INSUL. | NONE", "INSUL. <- -> NONE". */
export function insulationWords(label: string): [string, string] {
  const parts = label.toUpperCase().split(/\s*(?:<-+\s*-+>|\||\/|←\s*→)\s*/).map(s => s.trim()).filter(Boolean)
  return parts.length >= 2 ? [parts[0], parts[1]] : ['INSUL.', 'NONE']
}
/** The thickness lettered on an insulation symbol: its own label, else the title block's insulation thickness. */
export const insulationText = (doc: IsoDocument, label: string) => (label || doc.titleBlock?.insulationThickness || '').toUpperCase()
const insulationLength = (text: string, T: number) => Math.max(INSUL.min * T, measureText(text, T * .55) + 1.52 * T)
