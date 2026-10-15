import type { Point } from '../drawing'
import { COMPONENT_TYPE_BY_CODE } from '../components'
import { isBlind, isLapJoint, nodeCode } from '../joints'
import { connected, getNode, welds, type PipeNode, type PipeRun, type Vec3 } from '../model'
import { symbolStrokes } from '../symbols'
import { SIZE, emitters, type IsoContext } from './context'
import { add2, crossAxis, dot2, frame, left2, len2, scale2, sub2, unit2 } from './plane'

const flangedPort = (code?: string) => !!code && COMPONENT_TYPE_BY_CODE[code]?.endPrep === 'FL'
const OPERATORS: Record<string, Vec3> = { UP: [0, 0, 1], DOWN: [0, 0, -1], NORTH: [0, 1, 0], SOUTH: [0, -1, 0], EAST: [1, 0, 0], WEST: [-1, 0, 0] }

/** Page direction across a pipe in its isometric plane, never parallel to the pipe on the page. */
export function acrossOf(ctx: IsoContext, along: Point, dir3: Vec3): Point {
  const across = ctx.axis(crossAxis(dir3))
  if (len2(across) < 0.2 || Math.abs(dot2(unit2(across), along)) > 0.97) return left2(along)
  // Strokes are drawn upward from the pipe on the page.
  return across[1] > 0 ? scale2(across, -1) : across
}
/** Half-length of each component's symbol along its pipe; pipes stop there. */
export function symbolExtent(ctx: IsoContext, node: PipeNode): number {
  const code = nodeCode(ctx.doc, node) ?? ''
  if (node.associatedRunId) return 0
  if (node.kind === 'valve') {
    if (/UNION|CPLG/.test(code)) return 5
    return SIZE.valve * (/^BFLY/.test(code) ? 0.45 : 1) + (flangedPort(code) ? 2 + SIZE.flangeThickness : 0)
  }
  if (node.kind === 'reducer') return 9
  if (node.kind === 'flange' && isBlind(code)) return 2 + SIZE.flangeThickness * 2
  return 0
}

export function drawPipes(ctx: IsoContext) {
  const { line, poly, circle } = emitters(ctx)
  for (const node of ctx.nodes) ctx.extent.set(node.id, symbolExtent(ctx, node))
  const toward = (node: PipeNode, run: PipeRun): Point => {
    const g = ctx.geometry.get(run.id)!
    return run.from === node.id ? g.dir : scale2(g.dir, -1)
  }
  for (const g of ctx.geometry.values()) {
    if (g.run.connector) { line(g.a, g.b, 'SYMBOL', g.run.id, 0.8); continue }
    const ea = ctx.extent.get(g.run.from) ?? 0, eb = ctx.extent.get(g.run.to) ?? 0
    if (g.length <= ea + eb) continue
    line(add2(g.a, scale2(g.dir, ea)), sub2(g.b, scale2(g.dir, eb)), 'PIPE', g.run.id)
  }
  // Weld dots sit just off the fitting they join, clear of its symbol, whatever the sheet scale.
  for (const w of welds(ctx.doc)) {
    const g = ctx.geometry.get(w.runId)
    if (!g || g.run.connector) continue
    const node = getNode(ctx.doc, w.nodeId), at = ctx.pos.get(node.id)
    if (!at) continue
    let p: Point
    if (node.kind === 'weld') p = at
    else {
      const out = toward(node, g.run), projected = len2(sub2(ctx.project(w.position), at))
      p = add2(at, scale2(out, (ctx.extent.get(node.id) ?? 0) + Math.min(14, Math.max(7, projected))))
    }
    circle(p, w.field ? SIZE.weld * 1.4 : SIZE.weld, 'WELD', w.nodeId, !w.field)
  }
  for (const node of ctx.nodes) drawSymbol(ctx, node)
  function flangePair(at: Point, along: Point, across: Point, owner: string, sides: Array<1 | -1>, gap = 1.2) {
    const f = frame(at, along, across), F = SIZE.flange, t = SIZE.flangeThickness
    for (const s of sides)
      poly([f(s * gap, -F), f(s * (gap + t), -F), f(s * (gap + t), F), f(s * gap, F)], 'SYMBOL', owner, { closed: true })
  }
  function drawSymbol(ctx: IsoContext, node: PipeNode) {
    const at = ctx.pos.get(node.id)
    if (!at) return
    const code = nodeCode(ctx.doc, node) ?? ''
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
      case 'end':
        if (node.continuation) {
          // Break line where the pipe continues on another drawing.
          const back = scale2(along, -1), fb = frame(at, back, across), pts: Point[] = []
          for (let i = 0; i <= 12; i++) { const y = -9 + i * 1.5; pts.push(fb(-3 * Math.sin(y / 9 * Math.PI) - 2, y)) }
          poly(pts, 'SYMBOL', owner)
        }
        return
      case 'valve': return valve(node, code, at, along, across)
      case 'flange': {
        if (isBlind(code)) {
          flangePair(at, along, across, owner, [1])
          const fb = frame(at, along, across), F = SIZE.flange, t = SIZE.flangeThickness
          poly([fb(-1.2, -F), fb(-1.2 - t * 1.4, -F), fb(-1.2 - t * 1.4, F), fb(-1.2, F)], 'SYMBOL', owner, { closed: true, fill: true })
          return
        }
        const pipes = edges.filter(r => !r.connector)
        if (pipes.length === 2) flangePair(at, along, across, owner, [-1, 1])
        else flangePair(at, along, across, owner, [1], 0)
        // Lap-joint flanges show the stub-end lap at the face.
        if (isLapJoint(code)) for (const s of pipes.length === 2 ? [-1, 1] : [1]) line(f(s * 0.4, -SIZE.flange * 0.55), f(s * 0.4, SIZE.flange * 0.55), 'SYMBOL', owner, 1.2)
        return
      }
      case 'reducer': {
        const big = edges.reduce((a, b) => a.nps >= b.nps ? a : b, edges[0])
        const dir = big ? scale2(toward(node, big), -1) : along, fr = frame(at, dir, acrossOf(ctx, dir, g.dir3))
        const h = 9, w1 = 7, w2 = 4
        const eccentric = /^E-/.test(code)
        poly(eccentric ? [fr(-h, -w1), fr(h, -w1), fr(h, w1 - 2 * w2), fr(-h, w1)] : [fr(-h, -w1), fr(h, -w2), fr(h, w2), fr(-h, w1)], 'SYMBOL', owner, { closed: true })
        return
      }
      case 'cap': {
        const out = scale2(along, -1), fc = frame(at, out, across), w = 6
        poly([fc(0, -w), fc(3.5, -w * 0.75), fc(5.5, 0), fc(3.5, w * 0.75), fc(0, w)], 'SYMBOL', owner, { closed: true })
        return
      }
      case 'support': return support(node, code, at, along, across)
      default: {
        // Everything else uses its catalogue symbol, laid into the isometric plane.
        for (const stroke of symbolStrokes(code, node.kind)) {
          if ('l' in stroke) line(glyph(stroke.l[0] * 0.8, stroke.l[1] * 0.8), glyph(stroke.l[2] * 0.8, stroke.l[3] * 0.8), 'SYMBOL', owner)
          else if ('c' in stroke) circle(glyph(stroke.c[0] * 0.8, stroke.c[1] * 0.8), stroke.c[2] * 0.8, 'SYMBOL', owner, !!stroke.fill)
        }
      }
    }
  }
  function valve(node: PipeNode, code: string, at: Point, along: Point, across: Point) {
    const owner = node.id, f = frame(at, along, across)
    if (/UNION|CPLG/.test(code)) {
      for (const x of [-4, 4]) line(f(x, -6), f(x, 6), 'SYMBOL', owner)
      if (/UNION/.test(code)) for (const x of [-1.5, 1.5]) line(f(x, -4.5), f(x, 4.5), 'SYMBOL', owner)
      return
    }
    const butterfly = /^BFLY/.test(code), h = butterfly ? SIZE.valve * 0.45 : SIZE.valve, w = SIZE.valveWidth
    if (butterfly) {
      poly([f(-h, -w), f(h, -w), f(h, w), f(-h, w)], 'SYMBOL', owner, { closed: true })
      circle(at, 2.2, 'SYMBOL', owner, true)
    } else poly([f(-h, -w), f(h, w), f(h, -w), f(-h, w)], 'SYMBOL', owner, { closed: true })
    if (flangedPort(code)) {
      const F = SIZE.flange, t = SIZE.flangeThickness
      for (const s of [-1, 1]) poly([f(s * (h + 1.6), -F), f(s * (h + 1.6 + t), -F), f(s * (h + 1.6 + t), F), f(s * (h + 1.6), F)], 'SYMBOL', owner, { closed: true })
    }
    // Operator on its stem: handwheel for gate/globe, lever for ball/plug, actuator dome for butterfly valves.
    const stemDir = node.operator && Object.entries(OPERATORS).find(([k]) => node.operator!.toUpperCase().includes(k))?.[1]
    const stem = stemDir ? unit2(ctx.axis(stemDir)) : across
    const top = add2(at, scale2(stem, w + 9)), side = Math.abs(dot2(stem, along)) > 0.9 ? left2(stem) : along
    if (/^CHECK/.test(code)) { line(f(-h * 0.6, w * 0.6), f(h * 0.6, -w * 0.6), 'SYMBOL', owner); return }
    line(at, top, 'SYMBOL', owner)
    const ft = frame(top, side, stem)
    if (butterfly) poly([ft(-6, 0), ft(-5, 3), ft(-2.5, 5), ft(0, 5.6), ft(2.5, 5), ft(5, 3), ft(6, 0), ft(-6, 0)], 'SYMBOL', owner, { closed: true })
    else if (/^BALL|^PLUG/.test(code)) line(top, add2(top, scale2(side, 12)), 'SYMBOL', owner)
    else line(ft(-7, 0), ft(7, 0), 'SYMBOL', owner)
  }
  function support(node: PipeNode, code: string, at: Point, along: Point, across: Point) {
    const owner = node.id, f = frame(at, along, across)
    // A hanger rod comes down onto a filled triangle on the pipe; a U-bolt straddles it.
    if (/HANG|HNGR|SPRG|SPRING/.test(code)) {
      poly([add2(at, scale2(across, 1.5)), f(-3.5, 10), f(3.5, 10)], 'SYMBOL', owner, { closed: true, fill: true })
      line(f(0, 10), f(0, 24), 'SYMBOL', owner)
      return
    }
    if (/U-?BOLT/.test(code)) {
      poly([f(-4, 7), f(-4, -2), f(0, -5), f(4, -2), f(4, 7)], 'SYMBOL', owner)
      return
    }
    const glyph = frame(at, along, scale2(across, -1))
    for (const stroke of symbolStrokes(code, 'support'))
      if ('l' in stroke) line(glyph(stroke.l[0] * 0.7, stroke.l[1] * 0.7), glyph(stroke.l[2] * 0.7, stroke.l[3] * 0.7), 'SYMBOL', owner)
  }
}
