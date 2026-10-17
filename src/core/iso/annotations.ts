import type { Point } from '../drawing'
import { COMPONENT_TYPE_BY_CODE } from '../components'
import { coordinateText, draftLength, elevationText, sizeText } from '../format'
import { continuationPoint, nodeCode, type FlangedJoint } from '../joints'
import { materialId } from '../material-list'
import { connected, getNode, welds, type PipeNode, type PipeRun } from '../model'
import { measureText, strokeText, LINE_SPACING } from '../stroke-font'
import { SIZE, emitters, type IsoContext } from './context'
import { overlaps, rectPoly, segmentPoly, textPoly, type Occupant, type Poly } from './placement'
import { add2, dot2, frame, left2, lerp2, planeText, scale2, sub2, unit2, uprightOf } from './plane'
import { acrossOf, equipmentCentre, equipmentCode, equipmentEnd, insulation, insulationLimit, wallPenetration, weldPoint } from './symbols'
import { sheetLegs } from './dimensions'

interface Candidate { centre: Point; cost: number }
/** Whether a leader from `a` to `b` passes through a shape (its last 3 units excused). */
const overlapsSegment = (shape: Poly, a: Point, b: Point) => {
  const d = sub2(b, a), l = Math.hypot(...d)
  return l > 4 && overlaps(shape, segmentPoly(add2(a, scale2(d, 1.5 / l)), sub2(b, scale2(d, 3 / l)), 0.3))
}
/** Symbols that letter their own label: insulation, its limit, equipment and instrument bubbles. */
const labelledSymbol = (code: string, text?: string) => insulation(code, text) || insulationLimit(code, text) || equipmentCode(code) || /^ISA/.test(code)
const ANGLES = Array.from({ length: 16 }, (_, i) => i * Math.PI / 8)

export function drawAnnotations(ctx: IsoContext) {
  const { line, poly, arrow, text } = emitters(ctx)
  const T = SIZE.text
  const handle = (key: string, at: Point) => ({ key, at: [...at] as Point, spool: ctx.spool })
  /** A label may touch its own item's linework, never its other labels. */
  const own = (owner?: string) => (o: Occupant) => !!owner && o.owner === owner && o.kind !== 'text' && o.kind !== 'tag'
  /** Best free spot for a w×h block whose leader runs to `target`. */
  function spot(target: Point, w: number, h: number, owner?: string, radii = [24, 34, 46, 62, 82, 110], prefer?: Point, key?: string): Candidate {
    const held = key && ctx.labelPositions?.[key]
    if (held) return { centre: [...held], cost: 0 }
    let best: Candidate | null = null
    for (const r of radii)
      for (const angle of ANGLES) {
        const u: Point = [Math.cos(angle), Math.sin(angle)]
        const reach = Math.abs(u[0]) * w / 2 + Math.abs(u[1]) * h / 2
        const centre = add2(target, scale2(u, r + reach))
        const box = rectPoly(centre[0] - w / 2, centre[1] - h / 2, centre[0] + w / 2, centre[1] + h / 2)
        const edge = add2(centre, scale2(u, -reach))
        const leader = segmentPoly(add2(target, scale2(u, 3)), edge, 0.6)
        let cost = ctx.place.cost(box) * 2 + ctx.place.cost(leader, own(owner)) * 0.6 + r * 0.3
        if (prefer) cost -= dot2(u, prefer) * 3
        if (!best || cost < best.cost) best = { centre, cost }
      }
    return best!
  }
  /** Leader from a label to its item, ending in a filled arrowhead (or plain). */
  function leader(from: Point, to: Point, owner?: string, head = true, key?: string, landing = false) {
    const bend = key && ctx.labelPositions?.[`leader:${key}`] || (landing ? [from[0]+(to[0]>from[0]?12:-12),from[1]] as Point : undefined)
    if (bend) line(from,bend,'LEADER',owner)
    line(bend ?? from, to, 'LEADER', owner)
    if (head) arrow(to, sub2(to, bend ?? from), 'LEADER', owner)
  }
  const boxEdge = (centre: Point, w: number, h: number, toward: Point): Point => {
    const d = sub2(toward, centre), sx = Math.abs(d[0]) / (w / 2 || 1), sy = Math.abs(d[1]) / (h / 2 || 1), s = Math.max(sx, sy) || 1
    return add2(centre, scale2(d, 1 / s))
  }
  /** A boxed BOM number with a leader to the item. */
  function numberBox(value: string) {
    const xs = strokeText(value, { at: [0, 0], size: T, anchor: 'middle' }).flat().map(p => p[0])
    const left = Math.min(...xs), right = Math.max(...xs)
    return { w: Math.max(T * 0.78, right - left + (value.length>1?2.7:1.5)), h: T + (value.length>1?1.1:2.7), shift: (left + right) / 2 }
  }
  function tag(target: Point, id: number | string, owner: string, prefer?: Point, key = `item:${owner}`) {
    // Tag boxes hug their number, as drafted.
    const { w, h, shift } = numberBox(String(id))
    const { centre } = spot(target, w, h, owner, undefined, prefer, key)
    poly(rectPoly(centre[0] - w / 2, centre[1] - h / 2, centre[0] + w / 2, centre[1] + h / 2), 'TAG', owner, { closed: true })
    ctx.place.add(rectPoly(centre[0] - w / 2, centre[1] - h / 2, centre[0] + w / 2, centre[1] + h / 2), 'tag', owner)
    text([centre[0] - shift, centre[1] + T / 2], String(id), T, 'TAG', owner, { anchor: 'middle', label: handle(key, centre) })
    leader(boxEdge(centre, w, h, ctx.labelPositions?.[`leader:${key}`] ?? target), target, owner, true, key)
  }
  /** Multi-line callout text placed clear of everything, with a leader to the item. */
  function callout(target: Point, lines: string[], owner: string, options: { head?: boolean; prefer?: Point; boxed?: number; key?: string; omitLine?:number; noLeader?:boolean } = {}) {
    const key = options.key ?? `callout:${owner}`
    const width = Math.max(...lines.map(l => measureText(l, T))), height = T + (lines.length - 1) * T * LINE_SPACING
    // Blocks keep a clear line from other lettering, so neighbouring callouts never read as one.
    const { centre } = spot(target, width + 8, height + 4 + T, owner, [30, 44, 60, 80, 105, 140], options.prefer, key)
    const left = centre[0] - width / 2, top = centre[1] - height / 2
    text([left, top + T], lines.map((line,i)=>i===options.omitLine?'':line).join('\n'), T, 'TEXT', owner, { label: handle(key, centre) })
    // The leader leaves the end of the first or last line nearest the item without crossing the text.
    const bend = ctx.labelPositions?.[`leader:${key}`], toward = bend ?? target
    const ends: Point[] = lines.flatMap((value,i)=> {
      const y=top+T/2+i*T*LINE_SPACING
      return [[left-2,y],[left+measureText(value,T)+2,y]] as Point[]
    })
    const block = rectPoly(left - 1, top - 1, left + width + 1, top + height + 1)
    const clear = ends.filter(e => !overlapsSegment(block, e, toward))
    const from = (clear.length ? clear : ends).reduce((a, b) => Math.hypot(...sub2(a, toward)) <= Math.hypot(...sub2(b, toward)) ? a : b)
    if(!options.noLeader)leader(from, target, owner, options.head !== false, key, /^(continuation|elevation):/.test(key))
    return { left, top, width, height }
  }

  // Pipe pieces use a rectangular tag rotated with the pipe, joined by a short plain line.
  for (const leg of sheetLegs(ctx)) {
    for (const run of leg.runs) {
      const id = materialId(ctx.materials, run.id), g = ctx.geometry.get(run.id)
      if (!id || !g) continue
      if(run.nipple){tag(lerp2(g.a,g.b,.5),id,run.id,undefined,`pipe-tag:${run.id}`);continue}
      // Pipe tags have a wider rectangular box than fitting tags; their lettering is normal to the pipe.
      const across = left2(g.dir), label=String(id), {shift}=numberBox(label)
      const w=Math.max(11.3,measureText(label,T)+6.1),h=T+1.6
      let best: { cost: number; box: Poly; at: Point; foot: Point } | null = null
      for (const t of [0.5, 0.38, 0.62, 0.26, 0.74])
        for (const side of [1, -1])
          for (const gap of [9, 14, 20]) {
            const foot = lerp2(g.a, g.b, t), out = scale2(across, side * (gap + h / 2 + 1))
            const at = add2(foot, out), u = g.dir, v = scale2(across, side)
            const box: Poly = [add2(at, add2(scale2(u, -w / 2), scale2(v, -h / 2))), add2(at, add2(scale2(u, w / 2), scale2(v, -h / 2))),
              add2(at, add2(scale2(u, w / 2), scale2(v, h / 2))), add2(at, add2(scale2(u, -w / 2), scale2(v, h / 2)))]
            const cost = ctx.place.cost(box) * 2 + ctx.place.cost(segmentPoly(foot, add2(foot, scale2(v, gap)), 0.5), own(run.id)) + Math.abs(t - 0.5) * 6 + gap * 0.2
            if (!best || cost < best.cost) best = { cost, box, at, foot }
          }
      if (!best) continue
      const key = `pipe-tag:${run.id}`, held = ctx.labelPositions?.[key]
      if (held) {
        const delta = sub2(held, best.at)
        best.box = best.box.map(p => add2(p, delta)); best.at = [...held]
        const t = Math.max(0, Math.min(1, dot2(sub2(held, g.a), g.dir) / (g.length || 1)))
        best.foot = lerp2(g.a, g.b, t)
      }
      poly(best.box, 'TAG', run.id, { closed: true })
      ctx.place.add(best.box, 'tag', run.id)
      // The number's baseline is half a letter below the box centre, whichever way its uprights turned out.
      const turn = planeText(g.dir, across)
      const baseline = scale2(g.dir, turn.flipped ? -1 : 1)
      text(add2(add2(best.at, scale2(uprightOf(turn), -T / 2)), scale2(baseline, -shift)), label, T, 'TAG', run.id, { rotation: turn.rotation, oblique: turn.oblique, anchor: 'middle', label: handle(key, best.at) })
      const edge = sub2(best.at, scale2(unit2(sub2(best.at, best.foot)), h / 2))
      line(best.foot, edge, 'LEADER', run.id)
      ctx.place.addSegment(best.foot, edge, 'tag', run.id, 1.5)
    }
  }
  /** A callout whose first line is a boxed BOM number: valves with their operator and tag, fittings with their size. */
  function itemBlock(target: Point, id: number | undefined, lines: string[], owner: string, head = true, key = `item:${owner}`, below = false) {
    const number = id ? [String(id)] : [],numberKey=`item-number:${key}`,held=ctx.labelPositions?.[numberKey]
    const block = callout(target, below ? [...lines, ...number] : [...number, ...lines], owner, { head, key,omitLine:id?(below?lines.length:0):undefined,noLeader:!!held })
    if (!id) return
    const { w, h, shift } = numberBox(String(id))
    const y = block.top + (below ? lines.length * T * LINE_SPACING : 0)
    const centre:Point = held ?? [block.left + measureText(String(id), T) / 2 + shift,y+T/2]
    poly(rectPoly(centre[0] - w / 2, centre[1] - h / 2, centre[0] + w / 2, centre[1] + h / 2), 'TAG', owner, { closed: true })
    text([centre[0]-shift,centre[1]+T/2],String(id),T,'TAG',owner,{anchor:'middle',label:handle(numberKey,centre)})
    if(held)leader(boxEdge(centre,w,h,ctx.labelPositions?.[`leader:${key}`]??target),target,owner,head,key)
  }
  // Fittings, valves and stub ends: a box with an arrowed leader. Where the size changes at the item, its size label
  // stands under its number in one block; an olet adds its type.
  const sizeLabelled = new Set<string>()
  for (const node of ctx.nodes) {
    const path=node.hosePath ?? node.continuation?.paperPath,at = path?.[Math.floor(path.length/2)] ?? ctx.pos.get(node.id)
    if (!at || ['end', 'weld', 'annotation', 'support', 'gasket', 'bolt'].includes(node.kind)) continue
    const code = nodeCode(ctx.doc, node) ?? ''
    if (node.kind === 'flange' && !/^STUB-END/.test(code)) continue
    const id = materialId(ctx.materials, node.id), size = sizeLabel(node, code), byOthers = !!COMPONENT_TYPE_BY_CODE[code]?.byOthers
    if (size.length) sizeLabelled.add(node.id)
    // An in-line instrument by others carries its tag in a bubble.
    if (byOthers && node.tag) bubble(at, node.tag, node.id, true)
    if (!id && !size.length) continue
    if (node.kind === 'valve' && (node.operator || node.tag) && !byOthers) {
      const operator = node.operator ? [node.operator.toUpperCase()] : [], tag = node.tag ? [node.tag.toUpperCase()] : []
      const below = node.calloutOrder === 'tag-first'
      itemBlock(at, id, [...(below || node.calloutOrder === 'item-tag-first' ? [...tag, ...operator] : [...operator, ...tag]), ...size], node.id, true, `item:${node.id}`, below)
    }
    else if (size.length) itemBlock(at, id, size, node.id, !!id)
    else if (id) tag(at, id, node.id)
  }
  /** The size callout at an item where the size changes: inlet first on an angle body, else the large end first. */
  function sizeLabel(node: PipeNode, code: string): string[] {
    if(node.showSize===false)return []
    if (node.kind === 'olet') {
      const nd = ctx.materials.find(r => r.memberIds.includes(node.id))?.nd
      return nd ? [`${nd} NS`, ...(/^(SOL|WOL|TOL)$/.test(code) ? [code] : [])] : []
    }
    const edges = connected(ctx.doc, node.id).filter(r => ctx.geometry.has(r.id)), sizes = [...new Set(edges.map(r => r.nps))]
    if (sizes.length < 2 || node.kind === 'tee' && !node.branchEdgeId) return []
    const outlet = COMPONENT_TYPE_BY_CODE[code]?.angle ? edges.find(r => r.id === node.branchEdgeId) : undefined
    const inlet = outlet && edges.find(r => r !== outlet)
    const value=inlet ? sizeText(inlet.nps, outlet!.nps) : sizeText(Math.max(...sizes), Math.min(...sizes))
    return [node.sizeLabelFormat==='compact'?value.replace('X','x')+'NS':value+' NS']
  }
  // Flanged joints name the parts this drawing supplies, unless the drafter explicitly references another BOM item.
  // The bolt number is boxed; the second flange of a pair gets its own tag.
  const stubSizeJoints = new Map<string, string>(), stubSizes = new Set<string>()
  if (ctx.style.stackSizeLabels) for (const joint of [...ctx.joints].sort((a, b) =>
    Number(getNode(ctx.doc,b.nodeId).showSize===true)-Number(getNode(ctx.doc,a.nodeId).showSize===true)||Number(a.kind === 'component-port') - Number(b.kind === 'component-port'))) {
    if(getNode(ctx.doc,joint.nodeId).showSize===false)continue
    for (const runId of joint.stubRunIds) {
      const run = ctx.runs.find(r => r.id === runId), key = run && `${run.line}|${run.nps}`
      if (key && !stubSizeJoints.has(key)) stubSizeJoints.set(key, joint.id)
    }
  }
  for (const joint of ctx.joints) {
    const target = jointPoint(joint)
    if (!target) continue
    const flangeMember = joint.flanges.some(x => x.implicit) ? joint.id + '#flange' : joint.flangeNodeId ?? joint.nodeId
    const held = ctx.doc.sheets?.[ctx.spool]?.jointItems?.[joint.id]
    const item = (part: 'flange'|'bolts'|'gasket', category: 'flange'|'bolt'|'gasket', automatic?: number) =>
      ctx.materials.find(r=>r.key===held?.[part] && r.category===category)?.id ?? automatic
    const f = item('flange','flange',joint.supplied.flange && joint.flanges.length ? materialId(ctx.materials, flangeMember) : undefined)
    const b = item('bolts','bolt',joint.bolts && joint.supplied.bolts ? materialId(ctx.materials, joint.id + '#bolts') : undefined)
    const gsk = item('gasket','gasket',joint.gasket && joint.supplied.gasket ? materialId(ctx.materials, joint.id + '#gasket') : undefined)
    const parts = [f && `F${f}`, b && `B${b}`, gsk && `G${gsk}`].filter(Boolean) as string[]
    if (b || gsk) {
      const label = parts.join(' '), width = measureText(label, T)
      const { centre } = spot(target, width + 6, T + 6, joint.nodeId, [34, 48, 66, 90, 120], undefined, `joint:${joint.id}`)
      const left = centre[0] - width / 2, base = centre[1] + T / 2
      text([left, base], label, T, 'TEXT', joint.nodeId, { label: handle(`joint:${joint.id}`, centre) })
      if (b) {
        // The bolt item is boxed, letter and number, as on the issued sheets.
        const before = measureText(parts.slice(0, parts.indexOf(`B${b}`)).join(' ') + (f ? ' ' : ''), T)
        const bw = measureText(`B${b}`, T), { w, h, shift } = numberBox(`B${b}`), cx = left + before + bw / 2 + shift
        poly(rectPoly(cx - w / 2, base - T / 2 - h / 2, cx + w / 2, base - T / 2 + h / 2), 'TAG', joint.nodeId, { closed: true, occupy: false })
      }
      const bend = ctx.labelPositions?.[`leader:joint:${joint.id}`]
      const from: Point = [(bend ?? target)[0] > centre[0] ? left + width + 2 : left - 2, base - T / 2]
      leader(from, target, joint.nodeId, false, `joint:${joint.id}`)
    } else if (f) tag(target, `F${f}`, joint.nodeId, undefined, `joint:${joint.id}`)
    if (f && joint.kind === 'flange-pair') {
      const node = getNode(ctx.doc, joint.nodeId), run = ctx.runs.find(r => r.id === joint.runIds[1]), g = run && ctx.geometry.get(run.id)
      if (g) tag(add2(target, scale2(run!.from === node.id ? g.dir : scale2(g.dir, -1), 4)), `F${f}`, joint.nodeId, undefined, `joint:${joint.id}:other`)
    }
    const stub = joint.stubEnds.length ? materialId(ctx.materials, joint.id + '#stub') : undefined
    if (stub) {
      const node = getNode(ctx.doc, joint.nodeId)
      for (const run of joint.stubRunIds.map(id => ctx.runs.find(r => r.id === id)).filter(Boolean) as PipeRun[]) {
        const g = ctx.geometry.get(run.id)
        if (!g) continue
        const out = run.from === node.id ? g.dir : scale2(g.dir, -1)
        const at = add2(target, scale2(out, 5)), key = `${run.line}|${run.nps}`
        if (stubSizeJoints.get(key) === joint.id && !stubSizes.has(key)) {
          itemBlock(at, stub, [`${sizeText(run.nps)} NS`], joint.nodeId, true, `stub:${joint.id}:${run.id}`)
          stubSizes.add(key)
        } else tag(at, stub, joint.nodeId, undefined, `stub:${joint.id}:${run.id}`)
      }
    }
  }
  function jointPoint(joint: FlangedJoint): Point | undefined {
    const at = ctx.pos.get(joint.nodeId)
    if (!at) return
    if (joint.kind !== 'component-port') return at
    const run = ctx.runs.find(r => r.id === joint.runIds[0]), g = run && ctx.geometry.get(run.id)
    if (!g || !run) return at
    const out = run.from === joint.nodeId ? g.dir : scale2(g.dir, -1)
    return add2(at, scale2(out, Math.max(0, (ctx.extent.get(joint.nodeId) ?? 0) - SIZE.flangeThickness / 2)))
  }
  // Nominal size labels: the first pipe of each size, again where the size changes along a straight, and on every
  // branch of another size than its header, off a reducing tee or an olet. A screwed vent or drain made only of its
  // fittings is sized by its olet.
  const sized = new Set<string>(stubSizes)
  for (const leg of sheetLegs(ctx)) {
    const branchAt = (id: string, run: PipeRun) => {
      const n = getNode(ctx.doc, id)
      return n.kind === 'olet' || n.kind === 'tee' && n.branchEdgeId === run.id && connected(ctx.doc, id).some(r => r.id !== run.id && r.nps !== run.nps)
    }
    if (leg.nodes.some(id => getNode(ctx.doc, id).kind === 'olet' || !!getNode(ctx.doc, id).associatedRunId) && leg.runs.every(r => r.connector || r.nipple)) continue
    const branch = branchAt(leg.nodes[0], leg.runs[0]) || branchAt(leg.nodes.at(-1)!, leg.runs.at(-1)!)
    leg.runs.forEach((run, i) => {
      if(run.showSize===false)return
      const changed = i > 0 && run.nps !== leg.runs[i - 1].nps
      if (i > 0 && !changed && run.showSize!==true) return
      const key = `${run.line}|${run.nps}`
      if (sized.has(key) && !changed && !branch && run.showSize!==true) return
      sized.add(key)
      // Labelled on the first pipe of the stretch at this size, past any fittings welded together.
      const stretch = leg.runs.slice(i).filter((_, k, all) => all.slice(0, k + 1).every(x => x.nps === run.nps))
      // A size change with no pipe beyond it, a bushing into an end, is sized by its reducer alone.
      if (changed && stretch.every(r => r.connector)) return
      // A leg's first label sits near its start; after a change, on the first pipe, near the change.
      const g = ctx.geometry.get((changed && stretch.find(r => !r.connector) || run).id)!
      const near = !changed || [g.run.from, g.run.to].indexOf(leg.nodes[leg.runs.indexOf(g.run)]) === 0
      callout(lerp2(g.a, g.b, changed && !near ? 0.75 : 0.2), [`${sizeText(run.nps)} NS`], g.run.id, { head: false, key: `size:${g.run.id}` })
    })
  }
  // Any other size change not called out with its item.
  for (const node of ctx.nodes) {
    const at = ctx.pos.get(node.id)
    if (!at || sizeLabelled.has(node.id) || node.kind === 'olet') continue
    const size = sizeLabel(node, nodeCode(ctx.doc, node) ?? '')
    if (size.length) callout(at, size, node.id, { head: false, key: `size:${node.id}` })
  }
  // Line numbers written along the longest pipe of each line.
  const lines = new Map<string, PipeRun>()
  for (const g of ctx.geometry.values())
    if (g.run.line && !g.run.connector && g.run.showLineNumber!==false) {
      const current=lines.get(g.run.line)
      if(!current || g.run.showLineNumber===true&&current.showLineNumber!==true || current.showLineNumber!==true&&g.run.showLineNumber===current.showLineNumber&&g.length>ctx.geometry.get(current.id)!.length)lines.set(g.run.line,g.run)
    }
  const lineRuns=[...lines.values(),...ctx.runs.filter(r=>r.line&&r.showLineNumber===true&&!r.connector&&lines.get(r.line)!==r)]
  for (const run of lineRuns) {
    const g = ctx.geometry.get(run.id)!
    const across = run.lineNumberPlane === 'alternate' ? ctx.axis(Math.abs(g.dir3[2])>.7?[0,1,0]:[0,0,1]) : run.lineNumberPlane === 'normal' ? left2(g.dir) : run.lineNumberPlane === 'plan' && Math.abs(g.dir3[2])<0.7
      ? ctx.axis([-g.dir3[1],g.dir3[0],0])
      : run.lineNumberPlane === 'vertical' && Math.abs(g.dir3[2])<0.7 ? ctx.axis([0,0,1]) : acrossOf(ctx,g.dir,g.dir3)
    let best: { cost: number; at: Point; up: Point } | null = null
    for (const t of [0.6, 0.4, 0.75, 0.25, 0.5, 0.85, 0.15])
      for (const side of [1, -1]) {
        // The lettering stands clear of the pipe on this side, whichever way its uprights face.
        const up = scale2(across, side), turn = planeText(g.dir, up), facing = dot2(uprightOf(turn), up) >= 0
        const at = add2(lerp2(g.a, g.b, t), scale2(up, facing ? 3.5 : 3.5 + T))
        const shape = textPoly(at, run.line, T, turn.rotation, turn.oblique, 'middle', 1)
        const cost = ctx.place.cost(shape) + Math.abs(t - 0.6) * 4
        if (!best || cost < best.cost) best = { cost, at, up }
      }
    if (!best) continue
    const { rotation, oblique } = planeText(g.dir, best.up)
    const key = lines.get(run.line)===run ? `line:${run.line}` : `line:${run.line}:${run.id}`, at = ctx.labelPositions?.[key] ?? best.at
    text(at, run.line, T, 'TEXT', run.id, { rotation, oblique, anchor: 'middle', label: handle(key, at) })
  }
  // Callouts the drafter adds on points: continuation, elevation, tie points, supports.
  for (const node of ctx.nodes) {
    const at = ctx.pos.get(node.id)
    if (!at) continue
    if (node.continuation) {
      const lines = node.continuation.text.split('\n').map(s => s.trim().toUpperCase()).filter(Boolean)
      const point = continuationPoint(ctx.doc, node)
      // Coordinates are plant data; without a plant origin there are none to give.
      if (node.continuation.coordinates !== false && ctx.doc.coordinates) lines.push(...coordinateText(ctx.doc, point))
      callout(node.continuation.leaderAt==='node'?at:node.continuation.paperPath?.at(-1) ?? at, lines, node.id, { key: `continuation:${node.id}` })
    }
    if (node.elevationCallout ?? levelChange(node)) callout(at, [elevationText(ctx.doc, node.position)], node.id, { key: `elevation:${node.id}` })
    if (node.tiePoint) tiePoint(at, node)
    if (node.kind === 'support') {
      const code = nodeCode(ctx.doc, node) ?? ''
      const label = (node.calloutText ?? (/U-?BOLT/.test(code) ? 'U-BOLT' : /HANG|HNGR/.test(code) ? 'HANGER' : /SHOE/.test(code) ? 'SHOE' :
        /GUIDE/.test(code) ? 'GUIDE' : /ANCHOR/.test(code) ? 'ANCHOR' : COMPONENT_TYPE_BY_CODE[code]?.label ?? 'SUPPORT')).toUpperCase()
      // A label of several lines is placed as the block it is, so no line lands on other lettering.
      const rows = label.split('\n'), width = Math.max(...rows.map(l => measureText(l, T))), height = T + (rows.length - 1) * T * LINE_SPACING
      if (label.trim()) {
        if(node.supportSymbol==='callout'){
          callout(at,rows,node.id,{key:`support:${node.id}`})
          continue
        }
        const g = node.associatedRunId && ctx.geometry.get(node.associatedRunId)
        if (node.calloutPlane === 'pipe' && g) {
          const turn = planeText(g.dir, acrossOf(ctx, g.dir, g.dir3))
          const ink = strokeText(label, {at:[0,0],size:T,rotation:turn.rotation,oblique:turn.oblique,anchor:'middle'}).flat()
          const xs=ink.map(p=>p[0]),ys=ink.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys)
          const {centre}=spot(at,x1-x0+4,y1-y0+4,node.id,[12,18,26,36,50],undefined,`support:${node.id}`)
          text([centre[0]-(x0+x1)/2,centre[1]-(y0+y1)/2],label,T,'TEXT',node.id,{rotation:turn.rotation,oblique:turn.oblique,anchor:'middle',label:handle(`support:${node.id}`,centre)})
        } else {
          const { centre } = spot(at, width + 4, height + 4, node.id, [12, 18, 26, 36, 50], undefined, `support:${node.id}`)
          text([centre[0] - width / 2, centre[1] - height / 2 + T], label, T, 'TEXT', node.id, { label: handle(`support:${node.id}`, centre) })
        }
      }
    } else if (node.kind === 'annotation' && wallPenetration(nodeCode(ctx.doc, node) ?? '', node.calloutText))
      callout(at, (node.calloutText || 'WALL').toUpperCase().split('\n'), node.id, { head: false })
    else if (node.calloutText && !(node.kind === 'annotation' && labelledSymbol(nodeCode(ctx.doc, node) ?? '', node.calloutText)))
      callout(at, node.calloutText.toUpperCase().split('\n'), node.id)
    else if (node.bendRadius && node.bendRadius > 0) callout(at, [`BEND RADIUS ${draftLength(node.bendRadius, ctx.doc.units)}`], node.id)
    if (node.kind !== 'annotation') continue
    const code = nodeCode(ctx.doc, node) ?? ''
    if (/^ISA/.test(code) && (node.tag || node.calloutText)) bubble(at, (node.tag || node.calloutText)!, node.id, false, instrumentOut(node))
    if (equipmentCode(code)) equipmentLabel(node)
  }
  /** With elevations on, a fitting where a riser meets a level pipe gets its centreline elevation, given a plant origin. */
  function levelChange(node: PipeNode): boolean {
    if (!ctx.style.elevations || !ctx.doc.coordinates || node.continuation || ['end', 'annotation', 'support'].includes(node.kind)) return false
    const dirs = connected(ctx.doc, node.id).map(r => ctx.geometry.get(r.id)?.dir3).filter(Boolean) as Array<[number, number, number]>
    return dirs.some(d => Math.abs(d[2]) > 0.7) && dirs.some(d => Math.abs(d[2]) < 0.05)
  }
  /** An ISA instrument circle lettered with its tag, joined to its point: in line beyond an open end, else beside. */
  function bubble(target: Point, tagText: string, owner: string, arrowed: boolean, inLine?: Point) {
    const node=ctx.nodes.find(n=>n.id===owner),geometry=node?.associatedRunId ? ctx.geometry.get(node.associatedRunId) : undefined
    const inPlane=node?.calloutPlane==='pipe'&&inLine&&geometry
    const label = tagText.toUpperCase(), r = arrowed?18.8:Math.max(inPlane?T*2.5:10, measureText(label, T) / 2 + 4)
    const key = `bubble:${owner}`
    const centre = ctx.labelPositions?.[key] ?? (inLine ? add2(target, scale2(inLine, 16 + r)) : spot(target, r * 2, r * 2, owner, [30, 42, 56, 74, 96]).centre)
    const ringFrame=inPlane?frame(centre,inLine,acrossOf(ctx,inLine,geometry.dir3)):frame(centre,[1,0],[0,1])
    const ring = Array.from({ length: 36 }, (_, i) => ringFrame(Math.cos(i * Math.PI / 18) * r, Math.sin(i * Math.PI / 18) * r))
    poly(ring, 'TAG', owner, { closed: true })
    ctx.place.add(ring, 'tag', owner)
    text([centre[0], centre[1] + T / 2], label, T, 'TAG', owner, { anchor: 'middle', label: handle(key, centre) })
    // A tagged inline instrument's leader ends at the casing, rather than crossing into its body.
    let end=target
    if(arrowed){
      const u=unit2(sub2(centre,target)),span=Math.hypot(...sub2(centre,target));let reach=span
      for(const p of ctx.out)if(p.type==='polyline'&&p.owner===owner&&p.layer==='SYMBOL'&&p.closed&&!p.fill)
        for(let i=0;i<p.points.length;i++){
          const a=p.points[i],v=sub2(p.points[(i+1)%p.points.length],a),den=u[0]*v[1]-u[1]*v[0]
          if(Math.abs(den)<1e-9)continue
          const q=sub2(a,target),t=(q[0]*v[1]-q[1]*v[0])/den,s=(q[0]*u[1]-q[1]*u[0])/den
          if(t>0&&t<reach&&s>=0&&s<=1)reach=t
        }
      if(reach<span)end=add2(target,scale2(u,reach))
    }
    leader(add2(centre, scale2(unit2(sub2(end, centre)), r)), end, owner, arrowed,key)
  }
  /** Out of the pipe at an open end the instrument stands on, so its bubble continues the line. */
  function instrumentOut(node: PipeNode): Point | undefined {
    const g = node.associatedRunId ? ctx.geometry.get(node.associatedRunId) : undefined
    if (!g) return
    for (const [id, out] of [[g.run.from, scale2(g.dir, -1)], [g.run.to, g.dir]] as Array<[string, Point]>) {
      const end = getNode(ctx.doc, id)
      if (end.kind === 'end' && connected(ctx.doc, id).length === 1 && Math.hypot(...end.position.map((v, i) => v - node.position[i])) < 1) return out
    }
  }
  /** An equipment nozzle's id over its boxed equipment tag, or an outline's tag, beside the nozzle neck. */
  function equipmentLabel(node: PipeNode) {
    const at = equipmentEnd(ctx, node), from = at && ctx.pos.get(at.end.id)
    if (!at || !from) return
    const outline = nodeCode(ctx.doc, node) === 'EQUIP', neck = (at.end.kind === 'flange' ? 1.2 : 0) + SIZE.flangeThickness * 1.6 + 16
    const target = outline ? equipmentCentre(ctx,node,from,at.out) : add2(from,scale2(at.out,neck)), equipment = (node.tag ?? '').toUpperCase()
    if (outline && equipment) {
      const g = ctx.geometry.get(node.associatedRunId ?? ''), across = acrossOf(ctx, at.out, g?.dir3 ?? [1, 0, 0])
      const turn = node.equipmentShape==='vessel' ? planeText(ctx.axis([1,0,0]),ctx.axis([0,0,1])) : planeText(across, at.out)
      const key=`equipment:${node.id}`,p=ctx.labelPositions?.[key] ?? add2(target, scale2(uprightOf(turn), -T / 2))
      text(p, equipment, T, 'TEXT', node.id,
        { rotation: turn.rotation, oblique: turn.oblique, anchor: 'middle',label:handle(key,p) })
      return
    }
    const nozzle = outline ? '' : (node.calloutText ?? '').split('\n')[0].toUpperCase()
    const w = Math.max(measureText(nozzle, T), measureText(equipment, T) + 6), h = (nozzle ? T * LINE_SPACING : 0) + T + 6
    if (!nozzle && !equipment) return
    const { centre } = spot(target, w + 4, h + 4, node.id, outline ? [26, 34, 44] : [10, 16, 24, 34])
    let y = centre[1] - h / 2
    if (nozzle) { text([centre[0], y + T], nozzle, T, 'TEXT', node.id, { anchor: 'middle' }); y += T * LINE_SPACING }
    if (!equipment) return
    text([centre[0], y + T + 3], equipment, T, 'TEXT', node.id, { anchor: 'middle' })
    if (!outline) poly(rectPoly(centre[0] - w / 2, y, centre[0] + w / 2, y + T + 6), 'TAG', node.id, { closed: true })
  }
  function tiePoint(target: Point, node: PipeNode) {
    // The hexagon is sized so its widest line fits between its sloping sides.
    const id = node.tiePoint!.id.toUpperCase(), label = node.tiePoint!.label?.toUpperCase()
    const r = Math.max(15, (Math.max(measureText('TP', T), measureText(id, T)) / 2 + 7.5) / 1.15)
    const { centre } = spot(target, Math.max(r * 2.3, label ? measureText(label, T) + 4 : 0), r * 2 + (label ? T * 2 : 0), node.id, [40, 56, 76, 100], undefined, `tie:${node.id}`)
    // The label goes under the hexagon unless the leader would cross it there.
    const labelAt = (under: boolean): { c: Point; box: Poly } => {
      const c: Point = [centre[0], centre[1] + (label ? under ? -T : T : 0)], w = measureText(label ?? '', T) / 2 + 1, y = under ? c[1] + r + 5 : c[1] - r - 5 - T
      return { c, box: rectPoly(c[0] - w, y - 1, c[0] + w, y + T + 1) }
    }
    const crosses = (o: { c: Point; box: Poly }) => overlapsSegment(o.box, o.c, target)
    const below = !label || !crosses(labelAt(true)) || crosses(labelAt(false)), { c } = labelAt(below)
    const hex = Array.from({ length: 6 }, (_, i) => add2(c, [Math.cos(i * Math.PI / 3) * r * 1.15, Math.sin(i * Math.PI / 3) * r])) as Point[]
    poly(hex, 'TAG', node.id, { closed: true })
    ctx.place.add(hex, 'tag', node.id)
    text([c[0], c[1] - 2], 'TP', T, 'TAG', node.id, { anchor: 'middle', label: handle(`tie:${node.id}`, centre) })
    text([c[0], c[1] + T + 2], id, T, 'TAG', node.id, { anchor: 'middle' })
    if (label) text([c[0], below ? c[1] + r + T + 5 : c[1] - r - 5], label, T, 'TEXT', node.id, { anchor: 'middle' })
    // The leader leaves the hexagon's outline toward the item.
    const toward = unit2(sub2(ctx.labelPositions?.[`leader:tie:${node.id}`] ?? target, c)), edge = hex.reduce((best, p, i) => {
      const q = hex[(i + 1) % 6], d = sub2(q, p), den = toward[0] * d[1] - toward[1] * d[0]
      if (Math.abs(den) < 1e-9) return best
      const t = ((p[0] - c[0]) * d[1] - (p[1] - c[1]) * d[0]) / den, u = ((p[0] - c[0]) * toward[1] - (p[1] - c[1]) * toward[0]) / den
      return t > 0 && u >= 0 && u <= 1 && t < best ? t : best
    }, r * 1.15)
    leader(add2(c, scale2(toward, edge)), target, node.id, false, `tie:${node.id}`)
  }
  // Free notes placed by the drafter on this sheet.
  for (const note of ctx.doc.sheetNotes ?? [])
    if (note.spool === ctx.spool || !ctx.spool) {
      if(note.box){const {at:[x,y],width:w,height:h}=note.box;const points:Point[]=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];ctx.out.push({type:'polyline',points,closed:true,fill:true,layer:'MARKUP',owner:note.id,color:'#ffffff',weight:.001},{type:'polyline',points,closed:true,layer:'MARKUP',owner:note.id,color:note.color})}
      if(note.leader){
        ctx.out.push({type:'polyline',points:note.leader,layer:'MARKUP',owner:note.id,color:note.color})
        if(note.arrow){const tip=note.leader[0],u=unit2(sub2(note.leader[1],tip)),v=left2(u),base=add2(tip,scale2(u,10));ctx.out.push({type:'polyline',points:[add2(base,scale2(v,3)),tip,add2(base,scale2(v,-3))],layer:'MARKUP',owner:note.id,color:note.color})}
      }
      ctx.out.push({type:'text',p:note.at,text:note.text.toUpperCase(),size:note.size??T,layer:'TEXT',owner:note.id,rotation:note.rotation,oblique:note.oblique,lettering:note.lettering,color:note.textColor})
    }
  // Field welds are flagged FW; with weld numbers on, each weld's number sits in a balloon on a leader to its weld.
  for (const w of welds(ctx.doc)) {
    const p = ctx.geometry.has(w.runId) ? weldPoint(ctx, w) : undefined
    if (!p) continue
    if (w.field) fieldFlag(p, w.nodeId)
    if (!ctx.style.weldNumbers) continue
    const size = T * 0.85, r = Math.max(size * 0.85, measureText(w.tag, size) / 2 + 2.2)
    const { centre } = spot(p, r * 2, r * 2, w.nodeId, [12, 17, 23, 30])
    const ring = Array.from({ length: 24 }, (_, i) => add2(centre, [Math.cos(i * Math.PI / 12) * r, Math.sin(i * Math.PI / 12) * r])) as Point[]
    poly(ring, 'WELD', w.nodeId, { closed: true, weight: 0.6 })
    ctx.place.add(rectPoly(centre[0] - r, centre[1] - r, centre[0] + r, centre[1] + r), 'tag', w.nodeId)
    text([centre[0], centre[1] + size / 2], w.tag, size, 'WELD', w.nodeId, { anchor: 'middle' })
    leader(add2(centre, scale2(unit2(sub2(p, centre)), r)), p, w.nodeId, false)
  }
  // A butt-welded end marked as field welded where it continues on another drawing is flagged too.
  for (const node of ctx.nodes) {
    const run = node.kind === 'end' && node.continuation ? connected(ctx.doc, node.id)[0] : undefined, at = ctx.pos.get(node.id)
    if (run && at && ctx.geometry.has(run.id) && (run.from === node.id ? run.fromField : run.toField)) fieldFlag(at, node.id)
  }
  function fieldFlag(p: Point, owner: string) {
    const width = measureText('FW', T)
    const { centre } = spot(p, width + 4, T + 4, owner, [12, 17, 23])
    text([centre[0] - width / 2, centre[1] + T / 2], 'FW', T, 'WELD', owner)
    leader(boxEdge(centre, width + 3, T + 3, p), p, owner, false)
  }
}
