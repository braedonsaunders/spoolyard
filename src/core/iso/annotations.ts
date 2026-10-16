import type { Point } from '../drawing'
import { COMPONENT_TYPE_BY_CODE } from '../components'
import { coordinateText, elevationText, sizeText } from '../format'
import { nodeCode, type FlangedJoint } from '../joints'
import { materialId } from '../material-list'
import { connected, getNode, welds, type PipeNode, type PipeRun } from '../model'
import { measureText, LINE_SPACING } from '../stroke-font'
import { SIZE, emitters, type IsoContext } from './context'
import { overlaps, rectPoly, segmentPoly, textPoly, type Occupant, type Poly } from './placement'
import { add2, dot2, left2, lerp2, planeText, scale2, sub2, unit2, uprightOf } from './plane'
import { acrossOf } from './symbols'
import { sheetLegs } from './dimensions'

interface Candidate { centre: Point; cost: number }
/** Whether a leader from `a` to `b` passes through a shape (its last 3 units excused). */
const overlapsSegment = (shape: Poly, a: Point, b: Point) => {
  const d = sub2(b, a), l = Math.hypot(...d)
  return l > 4 && overlaps(shape, segmentPoly(add2(a, scale2(d, 1.5 / l)), sub2(b, scale2(d, 3 / l)), 0.3))
}
const ANGLES = Array.from({ length: 16 }, (_, i) => i * Math.PI / 8)

export function drawAnnotations(ctx: IsoContext) {
  const { line, poly, arrow, text } = emitters(ctx)
  const T = SIZE.text
  /** A label may touch its own item's linework, never its other labels. */
  const own = (owner?: string) => (o: Occupant) => !!owner && o.owner === owner && o.kind !== 'text' && o.kind !== 'tag'
  /** Best free spot for a w×h block whose leader runs to `target`. */
  function spot(target: Point, w: number, h: number, owner?: string, radii = [24, 34, 46, 62, 82, 110], prefer?: Point): Candidate {
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
  function leader(from: Point, to: Point, owner?: string, head = true) {
    line(from, to, 'LEADER', owner)
    if (head) arrow(to, sub2(to, from), 'LEADER', owner)
  }
  const boxEdge = (centre: Point, w: number, h: number, toward: Point): Point => {
    const d = sub2(toward, centre), sx = Math.abs(d[0]) / (w / 2 || 1), sy = Math.abs(d[1]) / (h / 2 || 1), s = Math.max(sx, sy) || 1
    return add2(centre, scale2(d, 1 / s))
  }
  /** A boxed BOM number with a leader to the item. */
  function tag(target: Point, id: number | string, owner: string, prefer?: Point) {
    // Tag boxes hug their number, as drafted.
    const w = measureText(String(id), T) + 4.5, h = T + 4
    const { centre } = spot(target, w, h, owner, undefined, prefer)
    poly(rectPoly(centre[0] - w / 2, centre[1] - h / 2, centre[0] + w / 2, centre[1] + h / 2), 'TAG', owner, { closed: true })
    ctx.place.add(rectPoly(centre[0] - w / 2, centre[1] - h / 2, centre[0] + w / 2, centre[1] + h / 2), 'tag', owner)
    text([centre[0], centre[1] + T / 2], String(id), T, 'TAG', owner, { anchor: 'middle' })
    leader(boxEdge(centre, w, h, target), target, owner)
  }
  /** Multi-line callout text placed clear of everything, with a leader to the item. */
  function callout(target: Point, lines: string[], owner: string, options: { head?: boolean; prefer?: Point; boxed?: number } = {}) {
    const width = Math.max(...lines.map(l => measureText(l, T))), height = T + (lines.length - 1) * T * LINE_SPACING
    // Blocks keep a clear line from other lettering, so neighbouring callouts never read as one.
    const { centre } = spot(target, width + 8, height + 4 + T, owner, [30, 44, 60, 80, 105, 140], options.prefer)
    const left = centre[0] - width / 2, top = centre[1] - height / 2
    text([left, top + T], lines.join('\n'), T, 'TEXT', owner)
    // The leader leaves the end of the first or last line nearest the item without crossing the text.
    const firstY = top + T / 2, lastY = top + height - T / 2
    const ends: Point[] = [[left - 2, firstY], [left + measureText(lines[0], T) + 2, firstY], [left - 2, lastY], [left + measureText(lines.at(-1)!, T) + 2, lastY]]
    const block = rectPoly(left - 1, top - 1, left + width + 1, top + height + 1)
    const clear = ends.filter(e => !overlapsSegment(block, e, target))
    const from = (clear.length ? clear : ends).reduce((a, b) => Math.hypot(...sub2(a, target)) <= Math.hypot(...sub2(b, target)) ? a : b)
    leader(from, target, owner, options.head !== false)
    return { left, top, width, height }
  }

  // Pipe pieces: a box beside the pipe in its isometric plane, joined by a short line.
  for (const leg of sheetLegs(ctx)) {
    const vertical = Math.abs(leg.dir3[2]) > 0.7
    for (const run of leg.runs) {
      const id = materialId(ctx.materials, run.id), g = ctx.geometry.get(run.id)
      if (!id || !g) continue
      // On a riser the tag stands upright beside the pipe; elsewhere it lies in the pipe's isometric plane.
      const across = vertical ? left2(g.dir) : acrossOf(ctx, g.dir, g.dir3)
      const label = String(id), w = measureText(label, T) + 4.5, h = T + 4
      let best: { cost: number; box: Poly; at: Point; foot: Point } | null = null
      for (const t of [0.5, 0.38, 0.62, 0.26, 0.74])
        for (const side of [1, -1])
          for (const gap of [9, 14, 20]) {
            const foot = lerp2(g.a, g.b, t), out = scale2(across, side * (gap + h / 2 + 1))
            const at = add2(foot, out), u: Point = vertical ? [1, 0] : g.dir, v: Point = vertical ? [0, 1] : scale2(across, side)
            const box: Poly = [add2(at, add2(scale2(u, -w / 2), scale2(v, -h / 2))), add2(at, add2(scale2(u, w / 2), scale2(v, -h / 2))),
              add2(at, add2(scale2(u, w / 2), scale2(v, h / 2))), add2(at, add2(scale2(u, -w / 2), scale2(v, h / 2)))]
            const cost = ctx.place.cost(box) * 2 + ctx.place.cost(segmentPoly(foot, add2(foot, scale2(v, gap)), 0.5), own(run.id)) + Math.abs(t - 0.5) * 6 + gap * 0.2
            if (!best || cost < best.cost) best = { cost, box, at, foot }
          }
      if (!best) continue
      poly(best.box, 'TAG', run.id, { closed: true })
      ctx.place.add(best.box, 'tag', run.id)
      const upright: Point = across[1] < 0 ? across : scale2(across, -1)
      const { rotation, oblique } = vertical ? { rotation: 0, oblique: 0 } : planeText(g.dir, upright)
      const baseline = vertical ? add2(best.at, [0, T / 2]) : add2(best.at, scale2(upright, -T / 2))
      text(baseline, label, T, 'TAG', run.id, { rotation, oblique, anchor: 'middle' })
      const edge = sub2(best.at, scale2(unit2(sub2(best.at, best.foot)), vertical ? w / 2 : h / 2))
      line(best.foot, edge, 'LEADER', run.id)
      ctx.place.addSegment(best.foot, edge, 'tag', run.id, 1.5)
    }
  }
  // Fittings, valves and stub ends: a box with an arrowed leader.
  for (const node of ctx.nodes) {
    const at = ctx.pos.get(node.id)
    if (!at || ['end', 'weld', 'annotation', 'support', 'gasket', 'bolt'].includes(node.kind)) continue
    const code = nodeCode(ctx.doc, node) ?? ''
    if (node.kind === 'flange' && !/^STUB-END/.test(code)) continue
    const id = materialId(ctx.materials, node.id)
    if (!id) continue
    if (node.kind === 'valve' && (node.operator || node.tag)) {
      const lines = [String(id), ...(node.operator ? [node.operator.toUpperCase()] : []), ...(node.tag ? [node.tag.toUpperCase()] : [])]
      const block = callout(at, lines, node.id)
      const w = measureText(String(id), T) + 4.5
      poly(rectPoly(block.left - 2.2, block.top - 2, block.left - 2.2 + w, block.top + T + 2), 'TAG', node.id, { closed: true })
      continue
    }
    tag(at, id, node.id)
  }
  // Flanged joints: "F12 B13 G14" with the bolt number boxed, naming only the parts this drawing supplies. A joint whose
  // gasket and bolts are on another drawing tags its flange alone; the second flange of a pair gets its own tag.
  for (const joint of ctx.joints) {
    const target = jointPoint(joint)
    if (!target) continue
    const flangeMember = joint.flanges.some(x => x.implicit) ? joint.id + '#flange' : joint.flangeNodeId ?? joint.nodeId
    const f = joint.supplied.flange && joint.flanges.length ? materialId(ctx.materials, flangeMember) : undefined
    const b = joint.bolts && joint.supplied.bolts ? materialId(ctx.materials, joint.id + '#bolts') : undefined
    const gsk = joint.gasket && joint.supplied.gasket ? materialId(ctx.materials, joint.id + '#gasket') : undefined
    const parts = [f && `F${f}`, b && `B${b}`, gsk && `G${gsk}`].filter(Boolean) as string[]
    if (b || gsk) {
      const label = parts.join(' '), width = measureText(label, T)
      const { centre } = spot(target, width + 6, T + 6, joint.nodeId, [34, 48, 66, 90, 120])
      const left = centre[0] - width / 2, base = centre[1] + T / 2
      text([left, base], label, T, 'TEXT', joint.nodeId)
      if (b) {
        // The bolt item is boxed, letter and number, as on the issued sheets.
        const before = measureText(parts.slice(0, parts.indexOf(`B${b}`)).join(' ') + (f ? ' ' : ''), T)
        const bw = measureText(`B${b}`, T)
        poly(rectPoly(left + before - 1.5, base - T - 2, left + before + bw + 1.5, base + 2), 'TAG', joint.nodeId, { closed: true, occupy: false })
      }
      const from: Point = [target[0] > centre[0] ? left + width + 2 : left - 2, base - T / 2]
      leader(from, target, joint.nodeId, false)
    } else if (f) tag(target, `F${f}`, joint.nodeId)
    if (f && joint.kind === 'flange-pair') {
      const node = getNode(ctx.doc, joint.nodeId), run = ctx.runs.find(r => r.id === joint.runIds[1]), g = run && ctx.geometry.get(run.id)
      if (g) tag(add2(target, scale2(run!.from === node.id ? g.dir : scale2(g.dir, -1), 4)), `F${f}`, joint.nodeId)
    }
    const stub = joint.stubEnds.length ? materialId(ctx.materials, joint.id + '#stub') : undefined
    if (stub) {
      const node = getNode(ctx.doc, joint.nodeId)
      for (const run of joint.stubRunIds.map(id => ctx.runs.find(r => r.id === id)).filter(Boolean) as PipeRun[]) {
        const g = ctx.geometry.get(run.id)
        if (!g) continue
        const out = run.from === node.id ? g.dir : scale2(g.dir, -1)
        tag(add2(target, scale2(out, 5)), stub, joint.nodeId)
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
  // Nominal size labels at the first pipe of each size and at every size change.
  const sized = new Set<string>()
  for (const leg of sheetLegs(ctx)) {
    const run = leg.runs[0], key = `${run.line}|${run.nps}`
    // A branch off an olet is sized by the olet's own callout.
    if (sized.has(key) || leg.nodes.some(id => getNode(ctx.doc, id).associatedRunId)) continue
    sized.add(key)
    const g = ctx.geometry.get(run.id)!
    callout(lerp2(g.a, g.b, 0.2), [`${sizeText(run.nps)} NS`], run.id, { head: false })
  }
  for (const node of ctx.nodes) {
    const sizes = [...new Set(connected(ctx.doc, node.id).filter(r => ctx.geometry.has(r.id)).map(r => r.nps))]
    if (sizes.length < 2 || node.kind === 'tee' && !node.branchEdgeId) continue
    const at = ctx.pos.get(node.id)
    if (at) callout(at, [`${sizeText(Math.max(...sizes), Math.min(...sizes))} NS`], node.id, { head: false })
  }
  // Olets: the header by branch size and the fitting type.
  for (const node of ctx.nodes) {
    const at = ctx.pos.get(node.id), nd = node.kind === 'olet' ? ctx.materials.find(r => r.memberIds.includes(node.id))?.nd : undefined
    if (!at || !nd) continue
    const code = nodeCode(ctx.doc, node) ?? ''
    callout(at, [`${nd} NS`, ...(/^(SOL|WOL|TOL)$/.test(code) ? [code] : [])], node.id, { head: false })
  }
  // Line numbers written along the longest pipe of each line.
  const lines = new Map<string, PipeRun>()
  for (const g of ctx.geometry.values())
    if (g.run.line && !g.run.connector && (!lines.has(g.run.line) || g.length > ctx.geometry.get(lines.get(g.run.line)!.id)!.length)) lines.set(g.run.line, g.run)
  for (const run of lines.values()) {
    const g = ctx.geometry.get(run.id)!, across = Math.abs(g.dir3[2]) > 0.7 ? left2(g.dir) : acrossOf(ctx, g.dir, g.dir3)
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
    text(best.at, run.line, T, 'TEXT', run.id, { rotation, oblique, anchor: 'middle' })
  }
  // Callouts the drafter adds on points: continuation, elevation, tie points, supports.
  for (const node of ctx.nodes) {
    const at = ctx.pos.get(node.id)
    if (!at) continue
    if (node.continuation) {
      const lines = node.continuation.text.split('\n').map(s => s.trim().toUpperCase()).filter(Boolean)
      const point = node.position
      if (node.continuation.coordinates !== false) lines.push(...coordinateText(ctx.doc, point))
      callout(at, lines, node.id)
    }
    if (node.elevationCallout) callout(at, [elevationText(ctx.doc, node.position)], node.id)
    if (node.tiePoint) tiePoint(at, node)
    if (node.kind === 'support') {
      const code = nodeCode(ctx.doc, node) ?? ''
      const label = (node.calloutText ?? (/U-?BOLT/.test(code) ? 'U-BOLT' : /HANG|HNGR/.test(code) ? 'HANGER' : /SHOE/.test(code) ? 'SHOE' :
        /GUIDE/.test(code) ? 'GUIDE' : /ANCHOR/.test(code) ? 'ANCHOR' : COMPONENT_TYPE_BY_CODE[code]?.label ?? 'SUPPORT')).toUpperCase()
      const width = measureText(label, T), height = T + (label.split('\n').length - 1) * T * LINE_SPACING
      const { centre } = spot(at, width + 4, height + 4, node.id, [12, 18, 26, 36])
      text([centre[0] - width / 2, centre[1] - height / 2 + T], label, T, 'TEXT', node.id)
    } else if (node.calloutText) callout(at, node.calloutText.toUpperCase().split('\n'), node.id)
  }
  function tiePoint(target: Point, node: PipeNode) {
    const r = 15, label = node.tiePoint!.label?.toUpperCase()
    const { centre } = spot(target, Math.max(r * 2.3, label ? measureText(label, T) + 4 : 0), r * 2 + (label ? T * 2 : 0), node.id, [40, 56, 76, 100])
    const c: Point = [centre[0], centre[1] - (label ? T : 0)]
    const hex = Array.from({ length: 6 }, (_, i) => add2(c, [Math.cos(i * Math.PI / 3) * r * 1.15, Math.sin(i * Math.PI / 3) * r])) as Point[]
    poly(hex, 'TAG', node.id, { closed: true })
    ctx.place.add(hex, 'tag', node.id)
    text([c[0], c[1] - 2], 'TP', T, 'TAG', node.id, { anchor: 'middle' })
    text([c[0], c[1] + T + 2], node.tiePoint!.id.toUpperCase(), T, 'TAG', node.id, { anchor: 'middle' })
    if (label) text([c[0], c[1] + r + T + 5], label, T, 'TEXT', node.id, { anchor: 'middle' })
    const toward = unit2(sub2(target, c))
    line(add2(c, scale2(toward, r)), target, 'LEADER', node.id)
  }
  // Free notes placed by the drafter on this sheet.
  for (const note of ctx.doc.sheetNotes ?? [])
    if (note.spool === ctx.spool || !ctx.spool) text(note.at, note.text.toUpperCase(), T, 'TEXT', note.id)
  if (ctx.style.weldNumbers)
    for (const w of welds(ctx.doc)) {
      if (!ctx.geometry.has(w.runId)) continue
      const p = ctx.project(w.position), width = measureText(w.tag, T * 0.9)
      const { centre } = spot(p, width + 3, T + 3, w.nodeId, [8, 12, 16, 22])
      text([centre[0] - width / 2, centre[1] + T * 0.45], w.tag, T * 0.9, 'WELD', w.nodeId)
    }
}
