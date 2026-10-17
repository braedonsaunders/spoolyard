import type { Point } from '../drawing'
import { COMPONENT_TYPE_BY_CODE } from '../components'
import { boltedConnector, flangedJoints, isBlind, isFlangePair, isLapJoint, nodeCode, nodeItem } from '../joints'
import { connected, getNode, pipePrepAt, takeout, welds, type IsoDocument, type PipeNode, type PipeRun, type Vec3, type Weld } from '../model'
import { CAD_STROKE_WIDTH, measureText } from '../stroke-font'
import { symbolStrokes } from '../symbols'
import { SIZE, emitters, fittingTakeoutOnPaper, type IsoContext, type RunGeometry } from './context'
import { sheetLegs } from './dimensions'
import { referenceDocument } from '../references'
import {discGeometry,discValve,reducerGeometry,flangedGeometry,valveBodyHalfLength,camlockGeometry,swingCheck} from './valve-conventions'
export {discValve} from './valve-conventions'
import { add2, crossAxis, dot2, frame, isAxial, left2, len2, lerp2, planeText, scale2, sub2, unit2, unit3, uprightOf } from './plane'

const flangedPort = (code?: string) => !!code && COMPONENT_TYPE_BY_CODE[code]?.endPrep === 'FL'
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
/** Annotation drawn as the insulation limit marker, "INSUL. ← → NONE". */
export const insulationLimit = (code: string, text = '') => /^INS-LIM/.test(code) || ((/^INS/.test(code) || !code) && /INSUL.*NONE|NONE.*INSUL/i.test(text))
/** Annotation drawn as a wall penetration. */
export const wallPenetration = (code: string, text = '') => /^WALL/.test(code) || (/^GRND/.test(code) && /WALL/i.test(text))
/** Annotation drawn as an insulated length of pipe. */
export const insulation = (code: string, text = '') => /^INST?$/.test(code) && !insulationLimit(code, text)
export const equipmentCode = (code: string) => /^(NOZZLE|EQUIP)$/.test(code)
const flowArrow = (code: string) => /^AR$|ARRW$/.test(code)
const oletBody = (code: string) => /^(SOL|TOL|WOL)$|EOL$/.test(code)

const valveLength=valveBodyHalfLength
/** The sockolet, threadolet and weldolet body: half-width across the header at heights up the branch. */
const OLET: Array<[number, number]> = [[0, 5.8], [9.7, 11], [19.5, 5.6]]
const NIPPLE = 1.85
const PSV = { h: 15, w: 9.3 }
const INSUL = { half: 8, min: 31.4 }
/** Half-length of each component's symbol along its pipe; pipes stop there. */
export function symbolExtent(ctx: IsoContext, node: PipeNode): number {
  const code = nodeCode(ctx.doc, node) ?? ''
  if (node.kind === 'olet') return oletBody(code) ? OLET[2][0] : /CPLG/.test(code) ? 10 : 0
  if (node.associatedRunId) return 0
  const axial=Math.max(...connected(ctx.doc,node.id).map(r=>len2(ctx.direction(ctx.geometry.get(r.id)?.dir3 ?? [1,0,0]))),1e-6)
  const flanges = flangedPort(code) ? flangedGeometry(ctx.doc,node).plate-flangedGeometry(ctx.doc,node).body+.4 : 0
  if (node.kind === 'valve') {
    if (/NIPPLE/.test(code)) {
      // A nipple is a short length of pipe drawn as its outline between the fittings it joins.
      const spans = connected(ctx.doc, node.id).map(r => ctx.geometry.get(r.id)?.length ?? 0)
      return Math.max(3, Math.min(9, 0.45 * Math.min(...spans)))
    }
    if (/UNION/.test(code)) return 6*axial
    if (/CPLG/.test(code)) return 7.5*axial
    if (/^CAMLOCK/.test(code)) return camlockGeometry(ctx.doc,node).halfLength*axial
    if (/^CHICAGO/.test(code)) return 7.5*axial
    if (/REGUL/.test(code)) return 11*axial
    if (/^PULS/.test(code)) return 0
    if (/^PSV/.test(code)) return PSV.h * Math.max(1,...connected(ctx.doc,node.id).map(r=>len2(ctx.direction(ctx.geometry.get(r.id)?.dir3 ?? [1,0,0])))) + flanges
    if (/^FLOWMETER/.test(code)) return (15 + flanges)*axial
    return discValve(ctx.doc,node,code)?(discGeometry(ctx.doc,node).plate+.4)*axial:(valveLength(ctx.doc,node,code)+flanges)*axial
  }
  if (node.kind === 'reducer') return (/CPLG/.test(code) ? 7.5 : reducerGeometry(ctx.doc,node).halfLength)*axial
  if(node.kind==='cap'&&/^CAMLOCK/.test(code))return camlockGeometry(ctx.doc,node).capRadius*2
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
  const from=getNode(ctx.doc,g.run.from),to=getNode(ctx.doc,g.run.to),v=to.position.map((x,i)=>x-from.position[i])
  const squared=v.reduce((s,x)=>s+x*x,0),station=squared?v.reduce((s,x,i)=>s+x*(position[i]-from.position[i]),0)/squared:0
  const projectedPoint=lerp2(g.a,g.b,station)
  const corner=(n:PipeNode)=>/^(elbow|tee)/.test(n.kind)
  if(ctx.schematic&&node.kind==='cap'&&/^CAMLOCK/.test(nodeCode(ctx.doc,node)??''))return add2(at,scale2(out,camlockGeometry(ctx.doc,node).capRadius*2+SIZE.flangeThickness))
  const draftedTakeout=(n:PipeNode)=>fittingTakeoutOnPaper(ctx,n,g.run)
  // The fitting block keeps its drafted size even where the long pipe beside it is compressed.
  if (g.run.connector) {
    if (ctx.schematic && corner(from)!==corner(to)) {
      const n=corner(from)?from:to,t=Math.min(g.length-1,draftedTakeout(n))
      return corner(from)?add2(g.a,scale2(g.dir,t)):sub2(g.b,scale2(g.dir,t))
    }
    return projectedPoint
  }
  // An olet's socket or weld end is the top of its body.
  if (node.kind === 'olet') return add2(at, scale2(out, ctx.extent.get(node.id) ?? 0))
  if(ctx.schematic && corner(node))return add2(at,scale2(out,Math.min(draftedTakeout(node),g.length*.45)))
  const joint=ctx.joints.find(j=>j.nodeId===node.id&&j.stubRunIds.includes(runId))
  if(ctx.schematic && (node.kind==='flange'&&isLapJoint(nodeCode(ctx.doc,node))||joint?.stubEnds.length))
    return add2(at,scale2(out,(ctx.extent.get(node.id)??0)+Math.max(2,g.run.nps)*7.2))
  const projected = len2(sub2(projectedPoint, at))
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

/** The equipment casing can be positioned on paper independently of its surveyed pipe-end connection. */
export function equipmentCentre(ctx: IsoContext, node: PipeNode, at: Point, out: Point): Point {
  const held=ctx.paperPositions?.[node.id]
  if(held)return held
  if(node.equipmentShape==='vessel')return add2(add2(at,scale2(out,58)),scale2(ctx.axis([0,0,1]),43))
  const end=equipmentEnd(ctx,node)
  return add2(at,scale2(out,(end?.end.kind==='flange'?1.2:0)+SIZE.flangeThickness*1.6+27))
}

export function drawPipes(ctx: IsoContext) {
  const { line, poly, circle, text } = emitters(ctx)
  const jointsToWeld = welds(ctx.doc)
  for (const node of ctx.nodes) ctx.extent.set(node.id, symbolExtent(ctx, node))
  const toward = (node: PipeNode, run: PipeRun): Point => {
    const g = ctx.geometry.get(run.id)!
    return run.from === node.id ? g.dir : scale2(g.dir, -1)
  }
  const along = (g: RunGeometry, p: Point) => dot2(sub2(p, g.a), g.dir)
  const codeOf = (node: PipeNode) => nodeCode(ctx.doc, node) ?? ''
  // Equipment drawn at pipe ends, and the stretches of pipe hidden behind olet bodies, insulation and wall sleeves.
  const equipment = new Map<string, PipeNode>()
  const visiblePipe = new Map<string, Array<[number,number]>>()
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
    if(g.run.connector && [g.run.from,g.run.to].some(id=>getNode(ctx.doc,id).hosePath?.length))continue
    let ea = ctx.extent.get(g.run.from) ?? 0, eb = ctx.extent.get(g.run.to) ?? 0
    for (const [index, id] of [g.run.from, g.run.to].entries()) {
      const node = getNode(ctx.doc, id), joint = ctx.joints.find(j => j.nodeId === id && j.stubRunIds.includes(g.run.id))
      // A bought nipple starts at the fitting's joint, beyond its heavy elbow or tee body.
      if(g.run.nipple && ['elbow90','elbow45','tee'].includes(node.kind)){
        const far=getNode(ctx.doc,index===0?g.run.to:g.run.from).position,out=unit3(far.map((v,k)=>v-node.position[k]) as Vec3),take=takeout(ctx.doc,node,g.run.id),t=take!=null&&Number.isFinite(take)?take:0
        const face=jointPoint(ctx,node,g.run.id,node.position.map((v,k)=>v+out[k]*t) as Vec3)
        if(face){
          const station=along(g,face)
          if(index===0)ea=Math.max(ea,station);else eb=Math.max(eb,g.length-station)
          line(ctx.pos.get(id)!,face,'PIPE',id,CAD_STROKE_WIDTH*(g.run.nps>=3?4:3))
        }
      }
      if (node.kind !== 'flange' && !joint?.stubEnds.length) continue
      const weld = jointsToWeld.find(w => w.nodeId === id && w.runId === g.run.id), at = weld && weldPoint(ctx, weld)
      if (!at) continue
      const station = along(g, at), extent = ctx.extent.get(id) ?? 0
      if (index === 0) ea = Math.max(ea, station); else eb = Math.max(eb, g.length - station)
      // The stub end or weld-neck is thin fitting linework, rather than a continuation of the heavy pipe.
      line(add2(ctx.pos.get(id)!, scale2(index === 0 ? g.dir : scale2(g.dir, -1), extent)), at, 'SYMBOL', id, CAD_STROKE_WIDTH)
    }
    if (g.length <= ea + eb) continue
    let pieces: Array<[number, number]> = [[ea, g.length - eb]]
    for (const [lo, hi] of gaps.get(g.run.id) ?? [])
      pieces = pieces.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b] as [number, number]] : [[a, lo], [hi, b]].filter(([x, y]) => y - x > 0.5) as Array<[number, number]>)
    visiblePipe.set(g.run.id,pieces)
    for (const [a, b] of pieces) {
      if (g.run.nipple) {
        const f = frame(g.a, g.dir, acrossOf(ctx, g.dir, g.dir3))
        const radius=NIPPLE*Math.max(1,g.run.nps),fromThread=pipePrepAt(ctx.doc,g.run,0)==='THD',toThread=pipePrepAt(ctx.doc,g.run,1)==='THD'
        const lo=!fromThread&&toThread?Math.max(a,b-15.5):a,hi=fromThread&&!toThread?Math.min(b,a+15.5):b
        if(lo>a)line(f(a,0),f(lo,0),'SYMBOL',g.run.id,CAD_STROKE_WIDTH)
        if(hi<b)line(f(hi,0),f(b,0),'SYMBOL',g.run.id,CAD_STROKE_WIDTH)
        poly([f(lo,-radius),f(hi,-radius),f(hi,radius),f(lo,radius)], 'SYMBOL', g.run.id, { closed: true, weight: CAD_STROKE_WIDTH })
      } else if(g.run.connector && (ctx.nodes.some(n=>n.associatedRunId===g.run.id && /^ISA/.test(nodeCode(ctx.doc,n) ?? '')) ||
        [g.run.from,g.run.to].some(id=>getNode(ctx.doc,id).kind==='flange') && [g.run.from,g.run.to].some(id=>['end','reducer'].includes(getNode(ctx.doc,id).kind)) ||
        [g.run.from,g.run.to].some(id=>getNode(ctx.doc,id).kind==='cap')&&[g.run.from,g.run.to].some(id=>getNode(ctx.doc,id).kind==='valve'))) {
        line(add2(g.a,scale2(g.dir,a)),add2(g.a,scale2(g.dir,b)),'SYMBOL',g.run.id,CAD_STROKE_WIDTH)
      } else line(add2(g.a, scale2(g.dir, a)), add2(g.a, scale2(g.dir, b)), 'PIPE', g.run.id, CAD_STROKE_WIDTH * (g.run.nps >= 3 ? 4 : 3))
    }
  }
  // Shop welds are dots; socket welds add the socket mark; field welds are open, crossed circles, flagged FW with the callouts.
  for (const w of jointsToWeld) {
    const p = weldPoint(ctx, w), g = ctx.geometry.get(w.runId), node = getNode(ctx.doc, w.nodeId)
    if (!p || !g) continue
    if (w.prep === 'SW' && node.kind !== 'weld') socket(p, toward(node, g.run), node, g)
    weld(p, w.field, w.nodeId, g.run.nps)
  }
  // Screwed joints are marked by a short tick across the pipe where it enters its fitting.
  const ticks: Point[] = []
  for (const g of ctx.geometry.values())
    for (const [index, id] of [g.run.from, g.run.to].entries()) {
      const node = getNode(ctx.doc, id)
      if(node.hosePath?.length)continue
      const mate=getNode(ctx.doc,index===0?g.run.to:g.run.from)
      if(/^CAMLOCK-CAP/.test(codeOf(node))||/^CAMLOCK/.test(codeOf(node))&&/^CAMLOCK-CAP/.test(codeOf(mate)))continue
      if (pipePrepAt(ctx.doc, g.run, index) !== 'THD' || ['end', 'weld', 'support', 'annotation', 'gasket', 'bolt'].includes(node.kind)) continue
      const other = getNode(ctx.doc, index === 0 ? g.run.to : g.run.from).position, span = Math.hypot(...other.map((v, i) => v - node.position[i])) || 1
      const t = takeout(ctx.doc, node, g.run.id) ?? 0, p = jointPoint(ctx, node, g.run.id, node.position.map((v, i) => v + (other[i] - v) * t / span) as Vec3)
      if (!p || ticks.some(q => len2(sub2(p, q)) < 2.5)) continue
      ticks.push(p)
      const out = index === 0 ? g.dir : scale2(g.dir, -1), f = frame(p, out, flatAcrossOf(ctx, out, g.dir3))
      line(f(0, -4), f(0, 4), 'SYMBOL', node.id, CAD_STROKE_WIDTH)
    }
  // A butt-welded end continuing on another drawing is welded there; only a field weld marked here is drawn.
  for (const node of ctx.nodes) {
    const run = node.kind === 'end' && node.continuation && !/OPEN END|CLOSED/i.test(node.continuation.text) ? connected(ctx.doc, node.id)[0] : undefined
    const at = ctx.pos.get(node.id)
    if (!run || !at || !ctx.geometry.has(run.id)) continue
    const index = run.from === node.id ? 0 : 1
    if (pipePrepAt(ctx.doc, run, index) === 'BW' && (index === 0 ? run.fromField : run.toField)) weld(at, true, node.id, run.nps)
  }
  // Flow arrows: one on each straight whose pipes carry a flow direction, on its longest piece.
  for (const leg of sheetLegs(ctx)) {
    const flowing = leg.runs.map(r => ctx.geometry.get(r.id)!).filter(g => !g.run.connector && g.run.showFlow!==false && flowDirection(g))
    const g = flowing.find(g=>g.run.flowPosition!=null) ?? flowing.sort((a, b) => b.length - a.length)[0]
    if (!g) continue
    const ea = ctx.extent.get(g.run.from) ?? 0, eb = ctx.extent.get(g.run.to) ?? 0, span = g.length - ea - eb
    if (span < 24) continue
    const best = [0.3, 0.7, 0.2, 0.8, 0.5].map(t => add2(g.a, scale2(g.dir, ea + span * t)))
      .map(p => ({ p, cost: ctx.place.cost([sub2(p, scale2(g.dir, 6)), add2(p, scale2(g.dir, 6))], o => o.owner === g.run.id) }))
      .sort((a, b) => a.cost - b.cost)[0]
    let at=best.p
    if(g.run.flowPosition!=null){
      const wanted=g.run.flowPosition*g.length
      const spans=visiblePipe.get(g.run.id)?.filter(([a,b])=>b-a>12) ?? []
      if(spans.length){
        const station=spans.map(([a,b])=>Math.max(a+6,Math.min(b-6,wanted))).sort((a,b)=>Math.abs(a-wanted)-Math.abs(b-wanted))[0]
        at=add2(g.a,scale2(g.dir,station))
      }
    }
    arrowhead(at, flowDirection(g)!, g.run.id)
  }
  // Where the line runs on into another spool of this drawing, that spool's next components are drawn beyond the
  // shared point in place of the continuation break.
  const shared = new Set(ctx.nodes.filter(n => ctx.pos.has(n.id) && connected(ctx.doc, n.id).some(r => !ctx.runs.includes(r))).map(n => n.id))
  const references = (ctx.doc.references ?? []).filter(r => ctx.nodes.some(n => n.id === r.atNodeId))
  for (const r of references) shared.add(r.atNodeId)
  for (const node of ctx.nodes) {
    drawSymbol(ctx, node)
    const path=node.continuation?.paperPath
    if(path){
      poly(path,'SYMBOL',node.id)
      const tip=path.at(-1)!,out=unit2(sub2(tip,path.at(-2)!)),across=ctx.axis([1,0,0]),f=frame(tip,out,across)
      if(node.continuation?.endMarker==='tube')box(f,0,6,3,node.id)
      if(node.continuation?.endMarker==='break')continuation(tip,out,across,node.id,0)
    }
  }
  for (const id of shared) ghosts(getNode(ctx.doc, id))
  for (const r of references) {
    const at = ctx.pos.get(r.atNodeId)
    if (!at) continue
    const ownDoc = ctx.doc
    ctx.doc = referenceDocument(ownDoc, r)
    ctx.pos.set(r.anchorNodeId, at)
    try { ghosts(getNode(ctx.doc, r.anchorNodeId), r.components ?? 1, r.dimensionTo, r.atNodeId,
      getNode(ownDoc, r.atNodeId).kind !== getNode(ctx.doc, r.anchorNodeId).kind, r.termination !== 'plain',r.pipeWeight,r.id) }
    finally { ctx.doc = ownDoc; ctx.pos.delete(r.anchorNodeId); ctx.extent.delete(r.anchorNodeId) }
  }

  function weld(p: Point, field: boolean, owner: string, nps = 3) {
    if (!field) { circle(p, nps>=3?SIZE.weld:1.55, 'WELD', owner, true); return }
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
    poly([f(s, -s), f(0, -s), f(0, s), f(s, s)], 'SYMBOL', node.id, { weight: CAD_STROKE_WIDTH })
  }
  function arrowhead(tip: Point, dir: Point, owner: string, length = 4.5, width = 1.3) {
    const u = unit2(dir), base = sub2(tip, scale2(u, length)), n = scale2(left2(u), width)
    poly([tip, add2(base, n), sub2(base, n)], 'SYMBOL', owner, { closed: true, fill: true })
  }
  function flangeRadius(owner:string){return Math.max(2,...connected(ctx.doc,owner).map(r=>r.nps))*3.75}
  function flangePlate(owner:string){return Math.max(.55,(Math.max(2,...connected(ctx.doc,owner).map(r=>r.nps))-1)*.55)}
  function flangePair(at: Point, along: Point, across: Point, owner: string, sides: Array<1 | -1>, gap = 1.2) {
    const f = frame(at, along, across), F = flangeRadius(owner), t = SIZE.flangeThickness, plate = flangePlate(owner)
    for (const s of sides)
      poly([f(s * (gap+t-plate), -F), f(s * (gap + t), -F), f(s * (gap + t), F), f(s * (gap+t-plate), F)], 'SYMBOL', owner, { closed: true })
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
    const flangeConnector = node.kind==='flange' && edges.length===1 && edges[0].connector && getNode(ctx.doc,edges[0].from===node.id?edges[0].to:edges[0].from).kind==='flange'
    const along = edges[0] ? scale2(toward(node, edges[0]),flangeConnector?-1:1) : g.dir
    const across = node.symbolPlane==='alternate'&&Math.abs(g.dir3[2])>.7?ctx.axis([0,1,0]):node.symbolPlane==='plan' ? flatAcrossOf(ctx,along,g.dir3)
      : node.symbolPlane==='vertical' && Math.abs(g.dir3[2])<.7 ? ctx.axis([0,0,1]) : acrossOf(ctx, along, g.dir3)
    const f = frame(at, along, across)
    // Catalogue glyph strokes use negative y for up the sheet.
    const glyph = frame(at, along, scale2(across, -1))
    const owner = node.id
    switch (node.kind) {
      case 'elbow90': case 'elbow45': case 'tee': case 'weld': return
      case 'end': {
        const fitted = equipment.get(node.id)
        if (fitted) equipmentAt(fitted, at, scale2(along, -1), across, 0)
        else if (node.continuation && !node.continuation.paperPath && !shared.has(node.id) && !/OPEN END|CLOSED/i.test(node.continuation.text)) continuation(at, scale2(along, -1), across, owner, 0)
        return
      }
      case 'valve': return valve(node, code, at, along, across, edges)
      case 'flange': {
        if (isBlind(code)) {
          flangePair(at, along, across, owner, [1])
          const fb = frame(at, along, across), F = flangeRadius(owner), t = SIZE.flangeThickness
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
            const fo = frame(at, out, across), F = flangeRadius(owner), t = SIZE.flangeThickness, plate=flangePlate(owner)
            poly([fo(1.2+t-plate, -F), fo(1.2 + t, -F), fo(1.2 + t, F), fo(1.2+t-plate, F)], 'SYMBOL', owner, { closed: true, weight: CAD_STROKE_WIDTH })
            if (!/OPEN END|CLOSED/i.test(node.continuation.text)) continuation(at, out, across, owner, 1.2 + t)
          }
        }
        // Lap-joint flanges show the stub-end lap at the face.
        if (isLapJoint(code)) for (const s of pair ? [-1, 1] : [1]) line(f(s * 0.4, -flangeRadius(owner) * 0.55), f(s * 0.4, flangeRadius(owner) * 0.55), 'SYMBOL', owner, CAD_STROKE_WIDTH)
        return
      }
      case 'reducer': {
        // A reducing coupling is a coupling: a box on plan, its joints marked as screwed or socketed.
        if (/CPLG/.test(code)) { box(frame(at, along, flatAcrossOf(ctx, along, g.dir3)), -7.5, 7.5, 5.7, owner); return }
        const big = edges.reduce((a, b) => a.nps >= b.nps ? a : b, edges[0])
        const dir = big ? scale2(toward(node, big), -1) : along, fr = frame(at, scale2(dir,len2(ctx.direction(g.dir3))), acrossOf(ctx, dir, g.dir3))
        const {halfLength:h,largeRadius:w1,smallRadius:w2}=reducerGeometry(ctx.doc,node)
        const eccentric = /^E-/.test(code)
        poly(eccentric ? [fr(-h, -w1), fr(h, -w1), fr(h, w1 - 2 * w2), fr(-h, w1)] : [fr(-h, -w1), fr(h, -w2), fr(h, w2), fr(-h, w1)], 'SYMBOL', owner, { closed: true })
        return
      }
      case 'cap': {
        // Cut-to-suit instrument tubing has an open rectangular end, rather than a cap's closed dish.
        if(/^TUBE/.test(code)){box(f,-3,3,3,owner);return}
        if(/^CAMLOCK/.test(code)){
          const w=camlockGeometry(ctx.doc,node).capRadius
          poly([f(2*w,-w),f(w,-w),f(w,w),f(2*w,w)],'SYMBOL',owner)
          return
        }
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
    line(fo(from + 1, 0), fo(reach, 0), 'SYMBOL', owner, CAD_STROKE_WIDTH)
    const pts: Point[] = []
    for (let i = 0; i <= 12; i++) { const y = -8 + i * 4 / 3; pts.push(fo(reach + 3 * Math.sin(y / 8 * Math.PI), y)) }
    poly(pts, 'SYMBOL', owner, { weight: CAD_STROKE_WIDTH })
  }
  /** Equipment flange and nozzle neck beyond a pipe end, with the outline of the equipment where it is drawn. */
  function equipmentAt(node: PipeNode, at: Point, out: Point, across: Point, from: number) {
    const owner=node.id, f = frame(at, out, across), F = flangeRadius(owner), t = SIZE.flangeThickness * 1.6, neck = from + t + 16
    poly([f(from, -F * 1.15), f(from + t, -F * 1.15), f(from + t, F * 1.15), f(from, F * 1.15)], 'SYMBOL', owner, { closed: true })
    const outline = codeOf(node) === 'EQUIP'
    for (const s of [-1, 1]) {
      if (outline) dashed(f(from + t, s * F * 0.5), f(neck, s * F * 0.5), owner)
      else line(f(from + t, s * F * 0.5), f(neck, s * F * 0.5), 'SYMBOL', owner)
    }
    if (codeOf(node) !== 'EQUIP') return
    const centre=equipmentCentre(ctx,node,at,out)
    if(node.equipmentShape==='vessel'){
      const east=ctx.axis([1,0,0]),down=ctx.axis([0,0,-1])
      const head=(a:number)=>add2(centre,add2(scale2(east,28*Math.cos(a)),scale2(down,18*Math.sin(a))))
      const arc=Array.from({length:25},(_,i)=>head(i/24*Math.PI))
      for(let i=0;i<arc.length-1;i+=2)line(arc[i],arc[i+1],'SYMBOL',owner,CAD_STROKE_WIDTH)
      for(const end of [arc[0],arc.at(-1)!])dashed(end,add2(end,scale2(down,-22)),owner)
      // Two legs meet a narrow skid seen along the nozzle's plane.
      const skidA=add2(at,scale2(out,10)),skidB=add2(at,scale2(out,75)),skid=frame(at,out,across)
      for(const side of [-1,1])dashed(skid(10,side*2),skid(75,side*2),owner)
      for(const x of [10,75])line(skid(x,-2),skid(x,2),'SYMBOL',owner,CAD_STROKE_WIDTH)
      for(const a of [Math.acos(-0.35),Math.acos(0.05)]){
        const top=head(a),v=sub2(skidB,skidA),den=down[0]*v[1]-down[1]*v[0]
        const t=Math.abs(den)>1e-6?((skidA[0]-top[0])*v[1]-(skidA[1]-top[1])*v[0])/den:25
        if(t>0)dashed(top,add2(top,scale2(down,t)),owner)
      }
      return
    }
    // The outline: a vessel or casing seen in isometric, an ellipse beyond the neck.
    const R = 18, pts: Point[] = []
    const casing=frame(centre,out,across)
    for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; pts.push(casing(Math.sin(a) * R * 0.6, Math.cos(a) * R * 1.4)) }
    for (let i = 0; i < pts.length - 1; i += node.equipmentShape==='pump'?1:2) line(pts[i], pts[i + 1], 'SYMBOL', owner, CAD_STROKE_WIDTH)
  }
  function dashed(a: Point, b: Point, owner: string) {
    const d = sub2(b, a), span = len2(d), u = unit2(d)
    for (let s = 0; s < span; s += 6) line(add2(a, scale2(u, s)), add2(a, scale2(u, Math.min(span, s + 3.5))), 'SYMBOL', owner, CAD_STROKE_WIDTH)
  }
  function valve(node: PipeNode, code: string, at: Point, along: Point, across: Point, edges: PipeRun[]) {
    const owner = node.id, direction=ctx.geometry.get(edges[0]?.id ?? '')?.dir3 ?? [1,0,0], axial=len2(ctx.direction(direction)), f = frame(at, scale2(along,axial), across), e = ctx.extent.get(node.id) ?? 0
    const flat = frame(at, scale2(along,axial), node.symbolPlane?across:flatAcrossOf(ctx, along, ctx.geometry.get(edges[0]?.id ?? '')?.dir3 ?? [1, 0, 0]))
    if (/NIPPLE/.test(code)) { box(frame(at,along,across), -e, e, NIPPLE*Math.max(1,...edges.map(r=>r.nps)), owner, CAD_STROKE_WIDTH); return }
    // Couplings and unions lie flat: a square on plan round a level pipe.
    if (/UNION/.test(code)) { box(flat, -6, 6, 7.5, owner); line(flat(-6, 0), flat(6, 0), 'SYMBOL', owner); return }
    if (/CPLG/.test(code)) { box(flat, -7.5, 7.5, 9.3, owner); return }
    if (/^CAMLOCK/.test(code)) {
      // Its groove is at the open end, toward the cap or the end of the line.
      const open = edges.find(r => ['cap', 'end'].includes(getNode(ctx.doc, r.from === node.id ? r.to : r.from).kind))
      const fo = open ? frame(at, scale2(toward(node, open),axial), across) : f,{halfLength:h,radius:w}=camlockGeometry(ctx.doc,node)
      box(fo, -h, h, w, owner)
      for (const x of [3, 4.6]) line(fo(x, -w), fo(x, w), 'SYMBOL', owner)
      return
    }
    if (/^CHICAGO/.test(code)) { box(flat, -7.5, 7.5, 9.3, owner); return }
    if (/REGUL/.test(code)) { box(flat, -11, 11, 7.5, owner); return }
    if (/^HOSE/.test(code)) return hose(node, code, at, scale2(along,axial), across)
    if (/^PULS/.test(code)) return dampener(node, at, along, across)
    if (/^PSV/.test(code)) return relief(node, code, at, edges)
    if (/^FLOWMETER/.test(code)) {
      box(f, -15, 15, 7.5, owner)
      if (flangedPort(code)) flanges(f, 15, owner)
      return
    }
    // Every line valve is a bow-tie in its plane, actuated butterfly valves with the actuator's dome. A plain
    // butterfly valve is its disc between the flanges, on a short stem toward its operator. A check valve points with
    // the flow: one triangle from its inlet to its outlet, with an arrow.
    const butterfly = /^BFLY/.test(code), ball = /^BALL/.test(code), disc = discValve(ctx.doc, node, code)
    const h = disc ? discGeometry(ctx.doc,node).body : valveLength(ctx.doc, node, code), w = ball ? 7.5 : butterfly && h > SIZE.valve ? 11 : SIZE.valveWidth
    const check = /^CHECK/.test(code)
    if (check) {
      const flowing = edges.map(r => ctx.geometry.get(r.id)!).find(g => g && flowDirection(g))
      const out = edges.find(r => r.from === node.id)
      const dir = flowing ? flowDirection(flowing)! : out ? toward(node, out) : along
      const swing=swingCheck(node,code)
      const rawCross=node.symbolPlane?across:swing||/^CHECK-SC/.test(code)?flatAcrossOf(ctx,dir,direction):acrossOf(ctx,dir,direction)
      const cross=swing&&rawCross[1]<0?scale2(rawCross,-1):rawCross
      const fc=frame(at,scale2(dir,axial),cross)
      if(swing){
        const width=7.2,points=[fc(-h,width),fc(-h,-width),fc(h,width),fc(h,-width)]
        poly(points,'SYMBOL',owner)
        const tip=points[2],u=unit2(sub2(tip,points[1])),base=sub2(tip,scale2(u,5.5)),n=scale2(left2(u),1.3)
        poly([tip,add2(base,n),sub2(base,n)],'SYMBOL',owner,{closed:true})
      }else{
        const width=/^CHECK-SC/.test(code)?7.2:w
        poly([fc(-h, -width), fc(h, 0), fc(-h, width)], 'SYMBOL', owner, { closed: true })
        if(!/^CHECK-SC/.test(code)){line(fc(-h * 0.55, 0), fc(h * 0.45, 0), 'SYMBOL', owner, CAD_STROKE_WIDTH)
        arrowhead(fc(h * 0.75, 0), dir, owner, 5, 1.8)}
      }
    } else if (disc) {
      // The disc follows the same isometric plane as its flange faces.
      const radius=edges.some(r=>r.nps>=3)?5.4:3.6
      const points = Array.from({ length: 20 }, (_, i) => {
        const a = i * Math.PI / 10
        return f(radius * Math.cos(a), radius * Math.sin(a))
      })
      poly(points, 'SYMBOL', owner, { closed: true, fill: true })
    }
    else if (ball) {
      const radius = 4.8, span = Math.hypot(h, w), x = radius * h / span, y = radius * w / span
      for (const s of [-1, 1]) poly([f(s * x, -s * y), f(s * h, -s * w), f(s * h, s * w), f(s * x, s * y)], 'SYMBOL', owner)
      poly(Array.from({ length: 32 }, (_, i) => f(radius * Math.cos(i * Math.PI / 16), radius * Math.sin(i * Math.PI / 16))), 'SYMBOL', owner, { closed: true })
    } else poly([f(-h, -w), f(h, w), f(h, -w), f(-h, w)], 'SYMBOL', owner, { closed: true })
    if (flangedPort(code)) {
      if(disc){
        const nps=Math.max(2,...edges.map(r=>r.nps)),outer=discGeometry(ctx.doc,node).plate,F=flangeRadius(owner)*.98,plate=flangePlate(owner)
        for(const side of [-1,1]){
          line(f(side*h,-F),f(side*h,F),'SYMBOL',owner)
          poly([f(side*(outer-plate),-F),f(side*outer,-F),f(side*outer,F),f(side*(outer-plate),F)],'SYMBOL',owner,{closed:true})
          hache(f,side*(h+nps*1.85),owner)
        }
      }else flanges(f,h,owner)
    }
    if (check || node.valveOperator === 'none') return
    // The valve type at its centre: globe a filled dot, ball a ball, plug its plug.
    const plug = /^PLUG/.test(code)
    if (/^GLOBE/.test(code)) circle(at, 2.4, 'SYMBOL', owner, true)
    if (plug) poly([f(-3.5, 0), f(0, -3.5), f(3.5, 0), f(0, 3.5)], 'SYMBOL', owner, { closed: true, fill: true })
    // Operator on its stem: handwheel for gate/globe, lever for ball/plug, actuator dome for butterfly and control valves.
    const stemDir = operatorDirection(node.operator)
    const stem = stemDir && len2(ctx.axis(stemDir)) > 0.05 ? unit2(ctx.axis(stemDir)) : across
    const top = add2(at, scale2(stem, butterfly && !disc ? 11.5 : w + (ball ? 11 : 9))), side = Math.abs(dot2(stem, along)) > 0.9 ? left2(stem) : along
    if (disc && (!node.valveOperator || node.valveOperator==='lever')) {
      const tip = add2(at, scale2(stem, 18.5))
      line(at, tip, 'SYMBOL', owner)
      line(tip, add2(tip, scale2(side, 8)), 'SYMBOL', owner)
      return
    }
    line(ball ? add2(at, scale2(stem, 4)) : at, top, 'SYMBOL', owner)
    const ft = frame(top, side, stem)
    const operator = node.valveOperator ?? (butterfly || /^CONTROL|^CV/.test(code) ? 'actuator' : ball || plug ? 'lever' : 'handwheel')
    if(operator==='box')poly([ft(-8,0),ft(8,0),ft(8,15),ft(-8,15)],'SYMBOL',owner,{closed:true})
    else if (operator === 'actuator') poly([ft(-5, 0), ft(-4.2, 1.7), ft(-2.1, 2.8), ft(0, 3.2), ft(2.1, 2.8), ft(4.2, 1.7), ft(5, 0), ft(-5, 0)], 'SYMBOL', owner, { closed: true })
    else if (operator === 'lever') line(top, add2(top, scale2(side, ball ? 8 : 10)), 'SYMBOL', owner)
    else line(ft(-7, 0), ft(7, 0), 'SYMBOL', owner)
  }
  /** A flanged body's own flanges, a gap off each end. */
  function flanges(f: (x: number, y: number) => Point, h: number, owner: string, respectSupply=false) {
    const node=getNode(ctx.doc,owner),F=flangeRadius(owner),plate=flangePlate(owner),planes=flangedGeometry(ctx.doc,node,h),centre=f(0,0),axis=unit2(sub2(f(1,0),centre))
    for (const s of [-1, 1]) {
      const edge=respectSupply?connected(ctx.doc,owner).filter(r=>ctx.geometry.has(r.id)).find(r=>dot2(toward(node,r),axis)*s>.9):undefined
      if(respectSupply&&edge&&node.portFlanges?.[edge.id]?.component==='NONE')continue
      poly([f(s*(planes.plate-plate),-F),f(s*planes.plate,-F),f(s*planes.plate,F),f(s*(planes.plate-plate),F)],'SYMBOL',owner,{closed:true})
      hache(f,s*planes.mate,owner)
    }
  }
  /** The gasket's hache mark: a broken line across the joint at the gasket, beside the flange faces. */
  function hache(f: (x: number, y: number) => Point, x: number, owner: string) {
    const F = flangeRadius(owner) * 1.15
    for (const [a, b] of [[-F, -F * 0.55], [-F * 0.25, F * 0.25], [F * 0.55, F]]) line(f(x, a), f(x, b), 'SYMBOL', owner, 0.5, false)
  }
  /** Up to three components of the next spool beyond a shared point, thin, with dashed pipe and no tags. */
  function ghosts(start: PipeNode, limit = 3, dimensionTo?: string, atNodeId?: string, drawAnchor = false, endBreak = true, pipeWeight = false,referenceId?:string) {
    const placed: string[] = [], walked: PipeRun[] = []
    const queue: Array<[PipeNode, PipeRun]> = connected(ctx.doc, start.id).filter(r => !ctx.runs.includes(r)).map(r => [start, r])
    let count = 0
    const lineFragments:Array<{run:PipeRun;a:Point;b:Point;dir3:Vec3}>=[]
    while (queue.length && (count < limit || limit === 0 && !walked.length)) {
      const [from, run] = queue.shift()!, far = getNode(ctx.doc, run.from === from.id ? run.to : run.from)
      if (ctx.pos.has(far.id) && !placed.includes(far.id)) continue
      const d = far.position.map((v, i) => v - from.position[i]) as Vec3, l = Math.hypot(...d) || 1, page = unit2(ctx.axis(d))
      if (len2(page) < 0.5) continue
      ctx.pos.set(far.id, ctx.paperPositions?.[far.id] ?? add2(ctx.pos.get(from.id)!, scale2(page, run.connector ? 26 : 44)))
      placed.push(far.id); walked.push(run)
      const a = ctx.pos.get(run.from)!, b = ctx.pos.get(run.to)!, ab = sub2(b, a)
      ctx.geometry.set(run.id, { run, a, b, dir: unit2(ab), length: len2(ab), dir3: d.map(v => v / l * (run.from === from.id ? 1 : -1)) as Vec3 })
      // Flanges come with their joint; they do not count as the next components.
      if (!['end', 'weld', 'flange', 'gasket', 'bolt'].includes(far.kind)) count++
      for (const next of connected(ctx.doc, far.id)) if (next !== run && !ctx.runs.includes(next) && !walked.includes(next)) queue.push([far, next])
    }
    for (const id of placed) ctx.extent.set(id, limit === 0 ? 0 : symbolExtent(ctx, getNode(ctx.doc, id)))
    if (atNodeId) ctx.extent.set(start.id, symbolExtent(ctx, start))
    const mark = ctx.out.length
    for (const run of walked) {
      const g = ctx.geometry.get(run.id)!, ea = ctx.extent.get(run.from) ?? 0, eb = ctx.extent.get(run.to) ?? 0
      if(g.length<=ea+eb)continue
      lineFragments.push({run,a:add2(g.a,scale2(g.dir,ea)),b:add2(g.b,scale2(g.dir,-eb)),dir3:g.dir3})
      if (atNodeId) line(add2(g.a, scale2(g.dir, ea)), add2(g.b, scale2(g.dir, -eb)), 'SYMBOL', start.id, pipeWeight?CAD_STROKE_WIDTH*(g.run.nps>=3?4:3):CAD_STROKE_WIDTH, false)
      else for (let x = ea; x < g.length - eb; x += 6) line(add2(g.a, scale2(g.dir, x)), add2(g.a, scale2(g.dir, Math.min(x + 3.5, g.length - eb))), 'SYMBOL', start.id, pipeWeight?CAD_STROKE_WIDTH*(g.run.nps>=3?4:3):CAD_STROKE_WIDTH, false)
    }
    if (drawAnchor && start.kind !== 'end') drawSymbol(ctx, start)
    const ownJoints=ctx.joints
    ctx.joints=flangedJoints(ctx.doc)
    try {
      for(const w of welds(ctx.doc)) {
        const g=ctx.geometry.get(w.runId)
        if(!g||!walked.some(r=>r.id===w.runId)||!ctx.pos.has(w.nodeId)||limit===0&&w.nodeId!==start.id)continue
        const p=weldPoint(ctx,w)
        if(p)weld(p,w.field,w.nodeId,g.run.nps)
      }
    } finally {ctx.joints=ownJoints}
    for (const id of placed) {
      const n = getNode(ctx.doc, id), edges = connected(ctx.doc, id), entered = walked.find(r => r.from === id || r.to === id)
      if (!entered) continue
      const g = ctx.geometry.get(entered.id)!, out = entered.to === id ? g.dir : scale2(g.dir, -1)
      // The end of a context fragment is a drafting cut, rather than the distant drawing's actual end fitting.
      if (limit === 0 || atNodeId && edges.length === 1 && ['end', 'flange'].includes(n.kind)) {
        if(endBreak) continuation(ctx.pos.get(id)!, out, acrossOf(ctx, out, g.dir3), n.id, 0)
      } else if (n.kind !== 'end') drawSymbol(ctx, n)
      if (atNodeId && limit > 0) for (const next of edges.filter(r => !walked.includes(r) && !ctx.runs.includes(r))) {
        const far = getNode(ctx.doc, next.from === id ? next.to : next.from)
        const d = far.position.map((v, i) => v - n.position[i]) as Vec3, u = unit2(ctx.axis(d))
        const at = ctx.pos.get(id)!, tip = ctx.paperPositions?.[far.id] ?? add2(at, scale2(u, 44)), extent = ctx.extent.get(id) ?? 0
        const direction = unit2(sub2(tip, at))
        line(add2(at, scale2(direction, extent)), tip, 'SYMBOL', n.id, pipeWeight?CAD_STROKE_WIDTH*(next.nps>=3?4:3):CAD_STROKE_WIDTH, false)
        lineFragments.push({run:next,a:add2(at,scale2(direction,extent)),b:add2(tip,scale2(direction,endBreak&&far.continuation?.endMarker!=='plain'?26:0)),dir3:unit3(d)})
        if (/^(elbow|tee)/.test(n.kind) && pipePrepAt(ctx.doc,next,next.from===id?0:1)!=='THD') {
          const reach=Math.max(0,Math.min(len2(sub2(tip,at))-3,Math.max(2,...edges.map(r=>r.nps))*7.5*len2(ctx.direction(unit3(d)))))
          weld(add2(at,scale2(direction,reach)),false,n.id,next.nps)
        }
        if(endBreak && far.continuation?.endMarker!=='plain') continuation(tip, direction, acrossOf(ctx, direction, unit3(d)), n.id, 0)
      }
    }
    const lineLabels=new Map<string,(typeof lineFragments)[number]>()
    for(const fragment of lineFragments)if(fragment.run.showLineNumber===true&&fragment.run.line){
      const previous=lineLabels.get(fragment.run.line)
      if(!previous||len2(sub2(fragment.b,fragment.a))>len2(sub2(previous.b,previous.a)))lineLabels.set(fragment.run.line,fragment)
    }
    for(const {run,a,b,dir3} of lineLabels.values()){
      const key=`reference-line:${run.id}`,held=ctx.labelPositions?.[key],dir=unit2(sub2(b,a))
      if(!held&&len2(sub2(b,a))<measureText(run.line,SIZE.text)+4)continue
      const across=run.lineNumberPlane==='vertical'&&Math.abs(dir3[2])<.7?[0,-1] as Point:acrossOf(ctx,dir,dir3),plane=planeText(dir,across)
      const at=held??add2(lerp2(a,b,.5),scale2(uprightOf(plane),2))
      text(at,run.line,SIZE.text,'TEXT',run.id,{rotation:plane.rotation,oblique:plane.oblique,anchor:'middle',label:{key,at,spool:ctx.spool}})
    }
    for (const p of ctx.out.slice(mark)) if (p.type === 'line' || p.type === 'polyline' || p.type === 'circle') p.weight = pipeWeight ? p.weight : Math.min(p.weight ?? CAD_STROKE_WIDTH, CAD_STROKE_WIDTH)
    if (dimensionTo && atNodeId && placed.includes(dimensionTo)) {
      ctx.referenceDimensions ??= []
      ctx.referenceDimensions.push({ atNodeId,referenceId, model: getNode(ctx.doc, dimensionTo).position, page: ctx.pos.get(dimensionTo)! })
    }
    for (const id of placed) { ctx.pos.delete(id); ctx.extent.delete(id) }
    for (const run of walked) ctx.geometry.delete(run.id)
  }
  /** A hose: corrugated between flanged ends, or a single wavy line between screwed ends. */
  function hose(node: PipeNode, code: string, at: Point, along: Point, across: Point) {
    if(node.hosePath?.length){poly(node.hosePath,'SYMBOL',node.id);return}
    const f = frame(at, along, across), h = SIZE.valve, owner = node.id
    if (flangedPort(code)) {
      for (const y of [-8.5, 8.5]) poly(Array.from({ length: 9 }, (_, i) => f(-h + i * h / 4, y + Math.sign(y)*(i % 2 ? -2.5 : 2.5))), 'SYMBOL', owner)
      for (const s of [-1, 1]) line(f(s * h, -11), f(s * h, 11), 'SYMBOL', owner)
      flanges(f, h, owner,true)
      return
    }
    poly(Array.from({ length: 33 }, (_, i) => f(-h + i * h / 16, 2.5 * Math.sin(i / 16 * Math.PI * 4))), 'SYMBOL', owner)
  }
  /** A one-port vessel on the pipe end: its flange bolted to the pipe's, a neck and a dome. */
  function dampener(node: PipeNode, at: Point, along: Point, across: Point) {
    const out = scale2(along, -1), f = frame(at, out, across), owner = node.id, F = flangeRadius(owner), t = SIZE.flangeThickness
    const size=Math.max(2,...connected(ctx.doc,node.id).map(r=>r.nps)),base=size*12.2
    box(f,size*1.1,size*3,F,owner)
    const plate=flangePlate(owner)
    poly([f(-size*2.5,-F),f(-size*2.5+plate,-F),f(-size*2.5+plate,F),f(-size*2.5,F)],'SYMBOL',owner,{closed:true})
    hache(f,-size*.6,owner)
    for (const s of [-1, 1]) line(f(size*3, s * F * .5), f(base, s * F * .5), 'SYMBOL', owner)
    const W = size*40/3, H = size*5, pts: Point[] = []
    for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI; pts.push(f(base + Math.sin(a) * H, -Math.cos(a) * W)) }
    poly(pts, 'SYMBOL', owner, { closed: true })
  }
  /** A relief valve: two triangles meeting at its centre, one along the inlet and one along the outlet. */
  function relief(node: PipeNode, code: string, at: Point, edges: PipeRun[]) {
    const owner = node.id
    for (const run of edges) {
      const g = ctx.geometry.get(run.id)!, dir = toward(node, run), f = frame(at, scale2(dir,len2(ctx.direction(g.dir3))), acrossOf(ctx, dir, g.dir3))
      const flat=Math.abs(g.dir3[2])<.05&&!isAxial(g.dir3),w=flat?7.2/len2(acrossOf(ctx,dir,g.dir3)):PSV.w
      poly([f(0, 0), f(PSV.h, -w), f(PSV.h, w)], 'SYMBOL', owner, { closed: true })
      if (flangedPort(code)) { const F=flangeRadius(owner),plate=flangePlate(owner),planes=flangedGeometry(ctx.doc,node,PSV.h); poly([f(planes.plate-plate,-F),f(planes.plate,-F),f(planes.plate,F),f(planes.plate-plate,F)],'SYMBOL',owner,{closed:true});hache(f,planes.mate,owner) }
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
    if(node.supportSymbol==='callout')return
    const owner = node.id, f = frame(at, along, across)
    // A hanger is a triangle standing on the pipe, its far half filled; a U-bolt is an X across the pipe.
    if (/HANG|HNGR|SPRG|SPRING/.test(code)) {
      const tip=at,top=(x:number)=>add2(add2(at,scale2(across,12.6)),scale2(along,x)),half=6.3,left=top(-half)[0]<=top(half)[0]?-half:half
      poly([tip,top(-half),top(half)],'SYMBOL',owner,{closed:true})
      poly([tip,top(left),top(0)],'SYMBOL',owner,{closed:true,fill:true})
      line(tip,add2(top(0),scale2(across,12.6)),'SYMBOL',owner)
      return
    }
    if (/U-?BOLT/.test(code)) {
      line(f(-6.75, -3.75), f(6.75, 3.75), 'SYMBOL', owner)
      line(f(-6.75, 3.75), f(6.75, -3.75), 'SYMBOL', owner)
      line(f(0,-11.1),f(0,11.1),'SYMBOL',owner)
      return
    }
    const glyph = frame(at, along, scale2(across, -1))
    for (const stroke of symbolStrokes(code, 'support'))
      if ('l' in stroke) line(glyph(stroke.l[0] * 0.7, stroke.l[1] * 0.7), glyph(stroke.l[2] * 0.7, stroke.l[3] * 0.7), 'SYMBOL', owner)
  }
  function annotation(node: PipeNode, code: string, at: Point, g: RunGeometry) {
    const owner = node.id, label = node.calloutText ?? '', across = insulation(code,label)&&Math.abs(g.dir3[2])>.7?ctx.axis([0,1,0]):acrossOf(ctx, g.dir, g.dir3), f = frame(at, g.dir, across)
    if (flowArrow(code)) {
      const size = /^VSM/.test(code) ? 0.7 : /^SM/.test(code) ? 0.85 : /^LG/.test(code) ? 1.3 : 1
      arrowhead(add2(at, scale2(flowDirection(g) ?? g.dir, 2.25 * size)), flowDirection(g) ?? g.dir, owner, 4.5 * size, 1.3 * size)
      return
    }
    if (insulationLimit(code, label)) return insulationEnd(node, label, at, g)
    if (insulation(code, label)) {
      // A short open cylinder round the pipe, lettered with the insulation thickness in the pipe's plane.
      const thickness = insulationText(ctx.doc, label), L = insulationLength(thickness), H = INSUL.half, x = L / 2
      for(const side of [-1,1])line(f(-x,side*H),f(x,side*H),'SYMBOL',owner)
      for(const end of [-1,1]){
        poly(Array.from({length:17},(_,i)=>{const t=i/8-1;return f(end*x+end*1.8*Math.sin(Math.PI*t),H*t)}),'SYMBOL',owner)
        poly(Array.from({length:9},(_,i)=>{const t=end*i/8;return f(end*x-end*1.8*Math.sin(Math.PI*t),H*t)}),'SYMBOL',owner)
      }
      if (thickness) {
        const up=across[1]<0?across:scale2(across,-1),turn=planeText(g.dir,up),key=`insulation:${owner}`,labelAt=ctx.labelPositions?.[key]??add2(at,scale2(up,H))
        text(labelAt,thickness,SIZE.text*.55,'TEXT',owner,{rotation:turn.rotation,oblique:turn.oblique,anchor:'middle',label:{key,at:labelAt,spool:ctx.spool}})
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
    for (const s of [-1, 1]) line(f(0, s * (r + 1.5)), f(0, s * 24), 'SYMBOL', owner, CAD_STROKE_WIDTH)
  }
  /** Where insulation stops: a two-way arrow beside the pipe with a tick at the limit, INSUL. one side and NONE the other. */
  function insulationEnd(node: PipeNode, label: string, at: Point, g: RunGeometry) {
    const owner = node.id, across = acrossOf(ctx, g.dir, g.dir3), down = scale2(across, -1)
    const a=getNode(ctx.doc,g.run.from).position,b=getNode(ctx.doc,g.run.to).position,v=b.map((x,i)=>x-a[i]),square=v.reduce((sum,x)=>sum+x*x,0)
    const station=square?v.reduce((sum,x,i)=>sum+x*(node.position[i]-a[i]),0)/square:0,target=lerp2(g.a,g.b,station),moved=len2(sub2(at,target))>5
    const base = moved?at:add2(at, scale2(down, 14)), f = frame(base, g.dir, down), L = 17, size = SIZE.text
    if(moved)line(base,target,'LEADER',owner,CAD_STROKE_WIDTH)
    line(f(-L, 0), f(L, 0), 'SYMBOL', owner, CAD_STROKE_WIDTH)
    circle(base,SIZE.weld,'SYMBOL',owner,true)
    for (const s of [-1, 1]) poly([f(s * L, 0), f(s * (L - 9), -1.8), f(s * (L - 9), 1.8)], 'SYMBOL', owner, { closed: true, weight: CAD_STROKE_WIDTH })
    // Each word stands beyond the arrow, away from the pipe, on its own side of the limit.
    const [first, second] = insulationWords(label), turn = node.calloutPlane==='sheet'?{rotation:0,oblique:0}:planeText(g.dir, across)
    if(node.calloutPlane!=='pipe')turn.oblique=0
    const toward = dot2(uprightOf(turn), down)
    for (const [i,[word, s]] of ([[first, -1], [second, 1]] as Array<[string, number]>).entries())
      if (word) {
        const key=`insulation-limit:${owner}:${i}`,point=ctx.labelPositions?.[key]??add2(f(s * L, 0), scale2(down, toward >= 0 ? 2.5 : 2.5 + size / Math.max(0.5, -toward)))
        text(point, word, size, 'TEXT', owner, { rotation: turn.rotation, oblique: turn.oblique, anchor: 'middle',label:{key,at:point,spool:ctx.spool} })
      }
  }
}
/** The two words of an insulation limit, insulated side first: "INSUL. | NONE", "INSUL. <- -> NONE". */
export function insulationWords(label: string): [string, string] {
  const parts = label.toUpperCase().split(/\s*(?:<-+\s*-+>|\||\/|←\s*→)\s*/).map(s => s.trim()).filter(Boolean)
  return parts.length >= 2 ? [parts[0], parts[1]] : ['INSUL.', 'NONE']
}
/** The thickness lettered on an insulation symbol: its own label, else the title block's insulation thickness. */
export const insulationText = (doc: IsoDocument, label: string) => (label || doc.titleBlock?.insulationThickness || '').toUpperCase()
const insulationLength = (text: string) => Math.max(INSUL.min, measureText(text, SIZE.text * .55) + 10)
