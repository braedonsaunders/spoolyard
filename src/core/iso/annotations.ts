import type { Point } from '../drawing'
import { COMPONENT_TYPE_BY_CODE } from '../components'
import { coordinateText, draftLength, elevationText, fieldFitNote, sizeFor } from '../format'
import { profileOf } from '../profile'
import { continuationPoint, nodeCode, type FlangedJoint } from '../joints'
import { findMaterialRow, materialId } from '../material-list'
import { connected, getNode, type PipeNode, type PipeRun, type Weld } from '../model'
import { measureText, strokeText, LINE_SPACING } from '../stroke-font'
import { CLEAR_COST, countSearch, emitters, keepSearchHint, labelGroup, labelRecord, leanSearch, searched, searchHint, sizeOf, weldsOf, type IsoContext, type RunGeometry } from './context'
import { bbox, overlaps, rectPoly, segmentPoly, textPoly, type Occupant, type Poly, type Rect } from './placement'
import { add2, dot2, frame, left2, lerp2, planeText, scale2, sub2, unit2, uprightOf } from './plane'
import { SELF_LETTERED, acrossOf, asSymbol, equipmentCentre, equipmentEnd, nozzleNeck, planeOr, weldPoint } from './symbols'
import { drafting, symbolOf } from './valve-conventions'
import { readable, sheetLegs } from './dimensions'

interface Candidate { centre: Point; cost: number; clear?: boolean }
/** Whether a leader from `a` to `b` passes through a shape (its last 3 units excused). */
const overlapsSegment = (shape: Poly, a: Point, b: Point) => {
  const d = sub2(b, a), l = Math.hypot(...d)
  return l > 4 && overlaps(shape, segmentPoly(add2(a, scale2(d, 1.5 / l)), sub2(b, scale2(d, 3 / l)), 0.3))
}
/** Directions a label is tried in around its item: every 22.5°, or every 15° when it is placed again. */
const ANGLES: Point[] = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)])
const FINE: Point[] = Array.from({ length: 24 }, (_, i) => [Math.cos(i * Math.PI / 12), Math.sin(i * Math.PI / 12)])
/** On a sheet crowded past clearing (`leanSearch`): every 45°, on the nearest rings. */
const LEAN: Point[] = ANGLES.filter((_, i) => i % 2 === 0)
const LEAN_RINGS = 2
/** Slack on a pruned search's bound, far below any cost step, so a candidate that ties the best is still weighed. */
const PRUNE = 1e-6
/** Whether two boxes meet, edges included. */
const meets = (a: Rect, b: Rect) => !(b[0] > a[2] || b[2] < a[0] || b[1] > a[3] || b[3] < a[1])
/**
 * What a label's own box pays to lie on a thin line (a dimension or another label's leader), and inside a symbol's
 * body: more than a leader crossing one, so balloons stand clear of dimensions rather than on them.
 */
const LABEL_WEIGHTS = { line: 12 }
const BODY_COST = 100

export function drawAnnotations(ctx: IsoContext) {
  const { line, poly, arrow, text } = emitters(ctx)
  const size = sizeOf(ctx), T = size.text
  /** Search radii and distances given in lettering heights. */
  const heights = (...k: number[]) => k.map(x => x * T)
  const familyOf = (node: PipeNode) => symbolOf(ctx.doc, node)
  /** A nominal size callout in the drawing's notation: `3" NS`, or `DN80`. */
  const notation = profileOf(ctx.doc).sizeNotation
  const nominal = (size: string, compact = false) => notation === 'DN' ? size : compact ? size.replace('X', 'x') + 'NS' : size + ' NS'
  const handle = (key: string, at: Point) => ({ key, at: [...at] as Point, spool: ctx.spool })
  // Room for the labels already known to land clear, so the labels drawn before them keep off it.
  for (const r of ctx.reserved ?? []) ctx.place.reserve(r.poly, r.key)
  /** A label may touch its own item's linework, never its other labels. */
  const own = (owner?: string) => (o: Occupant) => !!owner && o.owner === owner && o.kind !== 'text' && o.kind !== 'tag'
  /**
   * The drawn bodies of symbols (a valve's bow-tie, a reducer's block, a flange's plate): the sheet's room only
   * holds their outlines, so a label set down inside one would cost nothing. Each costs a label as a symbol does.
   */
  const bodies = ctx.out.flatMap(p => p.type === 'polyline' && p.closed && p.layer === 'SYMBOL' && p.points.length >= 3 ? [{ poly: p.points, box: bbox(p.points) }] : [])
  const inBodies = (box: Poly) => {
    const [x0, y0, x1, y1] = bbox(box)
    let cost = 0
    for (const b of bodies) if (b.box[0] < x1 && b.box[2] > x0 && b.box[1] < y1 && b.box[3] > y0 && overlaps(box, b.poly)) cost += BODY_COST
    return cost
  }
  /** The symbol bodies a search's candidates could land in (in `region`): what it finds depends on them too. */
  const bodiesIn = (region: Rect) => bodies.filter(b => meets(b.box, region)).map(b => b.poly)
  /** Best free spot for a w×h block whose leader runs to `target`. */
  function spot(target: Point, w: number, h: number, owner?: string, radii = heights(3.6, 5.2, 7, 9.4, 12.4, 16.7), prefer?: Point, key?: string): Candidate {
    const held = key && ctx.labelPositions?.[key]
    if (held) return { centre: [...held], cost: 0 }
    // Found again where it was unless what is beside it changed; a result covers its block and leader.
    const found = searched(ctx, key, Math.max(w, h) + T,
      ({ centre: c }) => [Math.min(target[0], c[0] - w / 2), Math.min(target[1], c[1] - h / 2), Math.max(target[0], c[0] + w / 2), Math.max(target[1], c[1] + h / 2)],
      () => search(target, w, h, owner, radii, prefer, key))
    countSearch(ctx, found.clear !== false)
    return found
  }
  function search(target: Point, w: number, h: number, owner: string | undefined, radii: number[], prefer: Point | undefined, key: string | undefined): Candidate {
    // A label that overprinted on the first attempt looks further out, at finer angles.
    // On a sheet crowded past clearing, only the nearest spots are weighed.
    const lean = leanSearch(ctx), retry = !lean && !!key && !!ctx.retry?.has(key)
    if (retry) radii = [...radii, ...[1.35, 1.8, 2.4, 3.2].map(k => radii.at(-1)! * k)]
    if (lean) radii = radii.slice(0, LEAN_RINGS)
    const angles = lean ? LEAN : retry ? FINE : ANGLES, count = radii.length * angles.length, mode = `${retry}${lean ? '|lean' : ''}`
    let best: (Candidate & { index: number; clear: boolean }) | null = null
    const excuse = own(owner)
    const { place } = ctx
    /**
     * Weighs the candidate at a radius and direction. The best is the cheapest, the first in order (radius, then
     * direction) among equals, so candidates may be weighed in any order: the spot this label took last time is
     * weighed first, which bounds the rest the most.
     */
    const weigh = (index: number) => {
      const r = radii[Math.floor(index / angles.length)], u = angles[index % angles.length]
      const distance = r / T * 2
      const bonus = prefer ? dot2(u, prefer) * 3 : 0, floor = distance - bonus
      // No candidate whose least cost is over the best can be the best.
      if (best && floor > best.cost + PRUNE) return
      const reach = Math.abs(u[0]) * w / 2 + Math.abs(u[1]) * h / 2
      const centre = add2(target, scale2(u, r + reach))
      const box = rectPoly(centre[0] - w / 2, centre[1] - h / 2, centre[0] + w / 2, centre[1] + h / 2)
      // Each cost is only counted as far as it could still make this the best candidate.
      let boxCost = place.cost(box, undefined, LABEL_WEIGHTS, best ? (best.cost + PRUNE - floor) / 2 : Infinity)
      if (best && boxCost * 2 + floor > best.cost + PRUNE) return
      boxCost += inBodies(box)
      if (best && boxCost * 2 + floor > best.cost + PRUNE) return
      const edge = add2(centre, scale2(u, -reach))
      const leader = segmentPoly(add2(target, scale2(u, 0.45 * T)), edge, 0.6)
      const leaderCost = place.cost(leader, excuse, undefined, best ? (best.cost + PRUNE - floor - boxCost * 2) / 0.6 : Infinity)
      let cost = boxCost * 2 + leaderCost * 0.6 + distance
      if (prefer) cost -= bonus
      if (!best || cost < best.cost || (cost === best.cost && index < best.index)) best = { centre, cost, index, clear: boxCost < CLEAR_COST }
    }
    const found = () => {
      if (key != null) keepSearchHint(`${key}|${mode}`, best!.index)
      return { ...best!, centre: [...best!.centre] as Point }
    }
    const weighAll = () => {
      const hint = key != null ? searchHint(`${key}|${mode}`) : undefined, first = hint != null && hint < count ? hint : -1
      if (first >= 0) weigh(first)
      for (let index = 0; index < count; index++) if (index !== first) weigh(index)
      return found()
    }
    if (key == null) return weighAll()
    // What each candidate's block and leader could meet (as boxes a unit larger), and all of them.
    const reaches = (index: number): Rect[] => {
      const r = radii[Math.floor(index / angles.length)], u = angles[index % angles.length]
      const reach = Math.abs(u[0]) * w / 2 + Math.abs(u[1]) * h / 2, c = add2(target, scale2(u, r + reach))
      const a = add2(target, scale2(u, 0.45 * T)), e = sub2(c, scale2(u, reach))
      return [[c[0] - w / 2 - 1, c[1] - h / 2 - 1, c[0] + w / 2 + 1, c[1] + h / 2 + 1],
        [Math.min(a[0], e[0]) - 1, Math.min(a[1], e[1]) - 1, Math.max(a[0], e[0]) + 1, Math.max(a[1], e[1]) + 1]]
    }
    const candidates = Array.from({ length: count }, (_, i) => reaches(i))
    const region: Rect = [Infinity, Infinity, -Infinity, -Infinity]
    for (const boxes of candidates) for (const b of boxes) { region[0] = Math.min(region[0], b[0]); region[1] = Math.min(region[1], b[1]); region[2] = Math.max(region[2], b[2]); region[3] = Math.max(region[3], b[3]) }
    const value = ctx.place.recall(`spot:${key}`, JSON.stringify([target, w, h, owner ?? null, radii, prefer ?? null, mode, T, ctx.place.labels, bodiesIn(region)]), region, weighAll,
      // Only the candidates something changed beside are weighed again against the spot found: the others cost what
      // they did, which lost to it then and still does. A change beside that spot itself searches again.
      (old, changed) => {
        const touched = (i: number) => candidates[i].some(b => changed.some(c => meets(b, c)))
        if (touched(old.index)) return undefined
        best = old
        for (let index = 0; index < count; index++) if (index !== old.index && touched(index)) weigh(index)
        return found()
      }, v => ({ ...v, centre: [...v.centre] as Point }))
    return { centre: value.centre, cost: value.cost, clear: value.clear }
  }
  /** Leader from a label to its item, ending in a filled arrowhead (or plain). */
  function leader(from: Point, to: Point, owner?: string, head = true, key?: string, landing = false) {
    const bend = key && ctx.labelPositions?.[`leader:${key}`] || (landing ? [from[0]+(to[0]>from[0]?1.8*T:-1.8*T),from[1]] as Point : undefined)
    const record = key ? ctx.labels?.get(key) : undefined
    if (record) record.leader = { from: [...from], ...(bend ? { bend: [...bend] as Point } : {}), to: [...to], held: !!ctx.labelPositions?.[`leader:${key}`] }
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
    return { w: Math.max(T * 0.78, right - left + (value.length>1?0.41:0.23)*T), h: T * (value.length>1?1.17:1.41), shift: (left + right) / 2 }
  }
  /** Bill of materials numbers called out on the sheet so far, each item at least once. */
  const ballooned = new Set<string>()
  const balloon = (id: number | string | undefined) => { if (id != null) ballooned.add(String(id).replace(/^[FBG]/, '')) }
  function tag(target: Point, id: number | string, owner: string, prefer?: Point, key = `item:${owner}`) {
    balloon(id)
    labelGroup(ctx, key, owner, () => tagIn(target, id, owner, prefer, key))
  }
  function tagIn(target: Point, id: number | string, owner: string, prefer: Point | undefined, key: string) {
    // Tag boxes hug their number, as drafted.
    const { w, h, shift } = numberBox(String(id))
    const { centre } = spot(target, w, h, owner, undefined, prefer, key)
    poly(rectPoly(centre[0] - w / 2, centre[1] - h / 2, centre[0] + w / 2, centre[1] + h / 2), 'TAG', owner, { closed: true })
    ctx.place.add(rectPoly(centre[0] - w / 2, centre[1] - h / 2, centre[0] + w / 2, centre[1] + h / 2), 'tag', owner)
    text([centre[0] - shift, centre[1] + T / 2], String(id), T, 'TAG', owner, { anchor: 'middle', label: handle(key, centre) })
    leader(boxEdge(centre, w, h, ctx.labelPositions?.[`leader:${key}`] ?? target), target, owner, true, key)
  }
  /** Multi-line callout text placed clear of everything, with a leader to the item. */
  function callout(target: Point, lines: string[], owner: string, options: CalloutOptions = {}) {
    const key = options.key ?? `callout:${owner}`
    return labelGroup(ctx, key, owner, () => calloutIn(target, lines, owner, options, key))
  }
  /** Lines named in `pieces` can each be moved on their own, out of the block, under `<key>#<name>`. */
  interface CalloutOptions { head?: boolean; prefer?: Point; boxed?: number; key?: string; omitLine?: number; noLeader?: boolean; pieces?: Array<string | undefined> }
  function calloutIn(target: Point, lines: string[], owner: string, options: CalloutOptions, key: string) {
    const width = Math.max(...lines.map(l => measureText(l, T))), height = T + (lines.length - 1) * T * LINE_SPACING
    // Blocks keep a clear line from other lettering, so neighbouring callouts never read as one.
    const { centre } = spot(target, width + 1.2 * T, height + 1.6 * T, owner, heights(4.5, 6.7, 9.1, 12.1, 15.9, 21.2), options.prefer, key)
    const left = centre[0] - width / 2, top = centre[1] - height / 2
    const piece = (i: number) => options.pieces?.[i] ? `${key}#${options.pieces[i]}` : undefined
    const moved = (i: number) => { const k = piece(i); return k ? ctx.labelPositions?.[k] : undefined }
    text([left, top + T], lines.map((line,i)=>i===options.omitLine||moved(i)?'':line).join('\n'), T, 'TEXT', owner, { label: handle(key, centre) })
    lines.forEach((value, i) => {
      const k = piece(i)
      if (!k) return
      const w = measureText(value, T), held = moved(i)
      if (held) {
        labelGroup(ctx, k, owner, () => text([held[0] - w / 2, held[1] + T / 2], value, T, 'TEXT', owner, { label: handle(k, held) }))
        return
      }
      // A line still in its block is picked and moved on its own, drawn by the block.
      const record = labelRecord(ctx, k, owner), y = top + T + i * T * LINE_SPACING
      if (!record) return
      record.parent = key
      record.at = [left + w / 2, y - T / 2]
      record.points.push(...textPoly([left, y], value, T, 0, 0, 'start', 1))
      record.ink.push({ type: 'text', p: [left, y], text: value, size: T, layer: 'TEXT', owner })
    })
    // The leader leaves the end of the first or last line nearest the item without crossing the text.
    const bend = ctx.labelPositions?.[`leader:${key}`], toward = bend ?? target
    const ends: Point[] = lines.flatMap((value,i)=> {
      if (moved(i) && lines.some((_, j) => !moved(j))) return []
      const y=top+T/2+i*T*LINE_SPACING
      return [[left-0.3*T,y],[left+measureText(value,T)+0.3*T,y]] as Point[]
    })
    const pad = 0.15 * T, block = rectPoly(left - pad, top - pad, left + width + pad, top + height + pad)
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
      balloon(id)
      if(run.nipple){tag(lerp2(g.a,g.b,.5),id,run.id,undefined,`pipe-tag:${run.id}`);continue}
      // Pipe tags have a wider rectangular box than fitting tags; their lettering is normal to the pipe.
      const across = left2(g.dir), label=String(id), {shift}=numberBox(label)
      const w=Math.max(1.71*T,measureText(label,T)+0.92*T),h=1.24*T
      const key = `pipe-tag:${run.id}`, lean = leanSearch(ctx), retry = !lean && !!ctx.retry?.has(key)
      labelGroup(ctx, key, run.id, () => {
      const stations = lean ? [0.5, 0.38, 0.62] : retry ? [0.5, 0.38, 0.62, 0.26, 0.74, 0.15, 0.85] : [0.5, 0.38, 0.62, 0.26, 0.74]
      const gaps = lean ? heights(1.36) : retry ? heights(1.36, 2.12, 3.03, 4.24, 5.76) : heights(1.36, 2.12, 3.03)
      type Spot = { cost: number; box: Poly; at: Point; foot: Point; index: number; clear?: boolean }
      // Every candidate, in the order weighed: along the pipe from its middle, each side, nearest first.
      const spots: Array<[number, number, number]> = []
      for (const t of stations) for (const side of [1, -1]) for (const gap of gaps) spots.push([t, side, gap])
      const excuse = own(run.id), { place } = ctx
      let top: Spot | null = null
      /** Weighs a candidate; the best is the cheapest, the first in order among equals. */
      const weigh = (index: number) => {
        const [t, side, gap] = spots[index]
        // Costs are counted only as far as they could still make this the best spot.
        const floor = Math.abs(t - 0.5) * 6 + gap / T * 1.32
        if (top && floor > top.cost + PRUNE) return
        const foot = lerp2(g.a, g.b, t), out = scale2(across, side * (gap + h / 2 + 0.15 * T))
        const at = add2(foot, out), u = g.dir, v = scale2(across, side)
        const box: Poly = [add2(at, add2(scale2(u, -w / 2), scale2(v, -h / 2))), add2(at, add2(scale2(u, w / 2), scale2(v, -h / 2))),
          add2(at, add2(scale2(u, w / 2), scale2(v, h / 2))), add2(at, add2(scale2(u, -w / 2), scale2(v, h / 2)))]
        let boxCost = place.cost(box, undefined, LABEL_WEIGHTS, top ? (top.cost + PRUNE - floor) / 2 : Infinity)
        if (top && boxCost * 2 + floor > top.cost + PRUNE) return
        boxCost += inBodies(box)
        if (top && boxCost * 2 + floor > top.cost + PRUNE) return
        const stem = place.cost(segmentPoly(foot, add2(foot, scale2(v, gap)), 0.5), excuse, undefined, top ? top.cost + PRUNE - floor - boxCost * 2 : Infinity)
        const cost = boxCost * 2 + stem + Math.abs(t - 0.5) * 6 + gap / T * 1.32
        if (!top || cost < top.cost || (cost === top.cost && index < top.index)) top = { cost, box, at, foot, index, clear: boxCost < CLEAR_COST }
      }
      // What each candidate's tag box and stem could meet (as boxes a unit larger), and all of them.
      const reaches = spots.map(([t, side, gap]): Rect => {
        const foot = lerp2(g.a, g.b, t), at = add2(foot, scale2(across, side * (gap + h / 2 + 0.15 * T)))
        const m = Math.abs(g.dir[0]) * w / 2 + Math.abs(across[0]) * h / 2 + 1, n = Math.abs(g.dir[1]) * w / 2 + Math.abs(across[1]) * h / 2 + 1
        return [Math.min(at[0] - m, foot[0] - 1), Math.min(at[1] - n, foot[1] - 1), Math.max(at[0] + m, foot[0] + 1), Math.max(at[1] + n, foot[1] + 1)]
      })
      const region: Rect = [Infinity, Infinity, -Infinity, -Infinity]
      for (const b of reaches) { region[0] = Math.min(region[0], b[0]); region[1] = Math.min(region[1], b[1]); region[2] = Math.max(region[2], b[2]); region[3] = Math.max(region[3], b[3]) }
      const copy = (v: Spot | null) => v && { ...v, box: v.box.map(p => [...p] as Point), at: [...v.at] as Point, foot: [...v.foot] as Point }
      const found = searched(ctx, key, w + T, (b: { box: Poly; foot: Point } | null) => b ? bbox([...b.box, b.foot]) : [0, 0, 0, 0], () => ctx.place.recall(`pipe-tag:${key}`,
        JSON.stringify([g.a, g.b, g.dir, w, h, retry, lean, T, run.id, ctx.place.labels, bodiesIn(region)]), region, () => {
          for (let index = 0; index < spots.length; index++) weigh(index)
          return copy(top)
        },
        // Only the candidates something changed beside are weighed again against the spot found (see `search`).
        (old, changed) => {
          if (!old || changed.some(c => meets(reaches[old.index], c))) return undefined
          top = old
          for (let index = 0; index < spots.length; index++) if (index !== old.index && changed.some(c => meets(reaches[index], c))) weigh(index)
          return copy(top)
        }, copy))
      countSearch(ctx, !!found && found.clear !== false)
      if (!found) return
      const best = { ...found }
      const held = ctx.labelPositions?.[key]
      if (held) {
        const delta = sub2(held, best.at)
        best.box = best.box.map(p => add2(p, delta)); best.at = [...held]
        const t = Math.max(0, Math.min(1, dot2(sub2(held, g.a), g.dir) / (g.length || 1)))
        best.foot = lerp2(g.a, g.b, t)
      }
      poly(best.box, 'TAG', run.id, { closed: true })
      ctx.place.add(best.box, 'tag', run.id)
      // The number's baseline is half a letter below the box centre, whichever way its uprights turned out.
      const turn = readable(planeText(g.dir, across))
      const baseline = scale2(g.dir, turn.flipped ? -1 : 1)
      text(add2(add2(best.at, scale2(uprightOf(turn), -T / 2)), scale2(baseline, -shift)), label, T, 'TAG', run.id, { rotation: turn.rotation, oblique: turn.oblique, anchor: 'middle', label: handle(key, best.at) })
      const edge = sub2(best.at, scale2(unit2(sub2(best.at, best.foot)), h / 2))
      line(best.foot, edge, 'LEADER', run.id)
      ctx.place.addSegment(best.foot, edge, 'tag', run.id, 1.5)
      })
    }
  }
  /** A callout whose first line is a boxed BOM number: valves with their operator and tag, fittings with their size. */
  /** `names` names each line, so it can be moved out of the block on its own: a valve's operator, tag and size. */
  function itemBlock(target: Point, id: number | undefined, lines: string[], owner: string, head = true, key = `item:${owner}`, below = false, names: string[] = []) {
    balloon(id)
    labelGroup(ctx, key, owner, () => {
    const number = id ? [String(id)] : [],numberKey=`item-number:${key}`,held=ctx.labelPositions?.[numberKey]
    const pieces = below ? [...names, ...number.map(() => undefined)] : [...number.map(() => undefined), ...names]
    const block = callout(target, below ? [...lines, ...number] : [...number, ...lines], owner, { head, key,omitLine:id?(below?lines.length:0):undefined,noLeader:!!held, pieces })
    if (!id) return
    const { w, h, shift } = numberBox(String(id))
    const y = block.top + (below ? lines.length * T * LINE_SPACING : 0)
    const centre:Point = held ?? [block.left + measureText(String(id), T) / 2 + shift,y+T/2]
    labelGroup(ctx, numberKey, owner, () => {
      poly(rectPoly(centre[0] - w / 2, centre[1] - h / 2, centre[0] + w / 2, centre[1] + h / 2), 'TAG', owner, { closed: true })
      text([centre[0]-shift,centre[1]+T/2],String(id),T,'TAG',owner,{anchor:'middle',label:handle(numberKey,centre)})
    })
    if(held)leader(boxEdge(centre,w,h,ctx.labelPositions?.[`leader:${key}`]??target),target,owner,head,key)
    })
  }
  /** Names for the lines of a callout, so each can be held on its own: `size`, `size-2`, ... */
  const lineNames = (role: string, lines: string[]) => lines.map((_, i) => i ? `${role}-${i + 1}` : role)
  // Fittings, valves and stub ends: a box with an arrowed leader. Where the size changes at the item, its size label
  // stands under its number in one block; an olet adds its type.
  const sizeLabelled = new Set<string>()
  for (const node of ctx.nodes) {
    const path=node.hosePath ?? node.continuation?.paperPath,at = path?.[Math.floor(path.length/2)] ?? ctx.pos.get(node.id)
    if (!at || ['end', 'weld', 'annotation', 'support', 'gasket', 'bolt'].includes(node.kind)) continue
    const code = nodeCode(ctx.doc, node) ?? ''
    if (node.kind === 'flange' && familyOf(node) !== 'stub-end') continue
    const id = materialId(ctx.materials, node.id), size = sizeLabel(node, code), byOthers = !!COMPONENT_TYPE_BY_CODE[code]?.byOthers
    if (size.length) sizeLabelled.add(node.id)
    // An in-line instrument by others carries its tag in a bubble.
    if (byOthers && node.tag) bubble(at, node.tag, node.id, true)
    if (!id && !size.length) continue
    if (node.kind === 'valve' && (node.operator || node.tag) && !byOthers) {
      const operator = node.operator ? [node.operator.toUpperCase()] : [], tag = node.tag ? [node.tag.toUpperCase()] : []
      const below = node.calloutOrder === 'tag-first'
      const tagFirst = below || node.calloutOrder === 'item-tag-first'
      const names = [...(tagFirst ? [...lineNames('tag', tag), ...lineNames('operator', operator)] : [...lineNames('operator', operator), ...lineNames('tag', tag)]), ...lineNames('size', size)]
      itemBlock(at, id, [...(tagFirst ? [...tag, ...operator] : [...operator, ...tag]), ...size], node.id, true, `item:${node.id}`, below, names)
    }
    else if (size.length) itemBlock(at, id, size, node.id, !!id, undefined, false, id ? lineNames('size', size) : [])
    else if (id) tag(at, id, node.id)
  }
  /** The size callout at an item where the size changes: inlet first on an angle body, else the large end first. */
  function sizeLabel(node: PipeNode, code: string): string[] {
    if(node.showSize===false)return []
    if (node.kind === 'olet') {
      const nd = ctx.materials.find(r => r.memberIds.includes(node.id))?.nd, abbreviation = drafting(ctx.doc, node).abbreviation
      return nd ? [nominal(nd), ...(abbreviation ? [abbreviation] : [])] : []
    }
    const edges = connected(ctx.doc, node.id).filter(r => ctx.geometry.has(r.id)), sizes = [...new Set(edges.map(r => r.nps))]
    if (sizes.length < 2 || node.kind === 'tee' && !node.branchEdgeId) return []
    const outlet = COMPONENT_TYPE_BY_CODE[code]?.angle ? edges.find(r => r.id === node.branchEdgeId) : undefined
    const inlet = outlet && edges.find(r => r !== outlet)
    const value=inlet ? sizeFor(ctx.doc, inlet.nps, outlet!.nps) : sizeFor(ctx.doc, Math.max(...sizes), Math.min(...sizes))
    return [nominal(value, node.sizeLabelFormat==='compact')]
  }
  // Flanged joints name the parts this drawing supplies, unless the drafter explicitly references another BOM item:
  // a balloon for each item, or (style `jointCallout: 'combined'`) one line of prefixed items with the bolting boxed
  // and the second flange of a pair tagged on its own.
  const combined = ctx.style.jointCallout === 'combined'
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
      findMaterialRow(ctx.materials, held?.[part], category)?.id ?? automatic
    const f = item('flange','flange',joint.supplied.flange && joint.flanges.length ? materialId(ctx.materials, flangeMember) : undefined)
    const b = item('bolts','bolt',joint.bolts && joint.supplied.bolts ? materialId(ctx.materials, joint.id + '#bolts') : undefined)
    const gsk = item('gasket','gasket',joint.gasket && joint.supplied.gasket ? materialId(ctx.materials, joint.id + '#gasket') : undefined)
    const parts = [f && `F${f}`, b && `B${b}`, gsk && `G${gsk}`].filter(Boolean) as string[]
    if (combined && (b || gsk)) for (const id of [f, b, gsk]) balloon(id)
    if (!combined) {
      // One balloon per item: the flange keeps the joint's own label, the bolting and gasket their own.
      const items: Array<[number | undefined, string]> = [[f, `joint:${joint.id}`], [b, `joint:${joint.id}:bolts`], [gsk, `joint:${joint.id}:gasket`]]
      for (const [id, key] of items) if (id) tag(target, id, joint.nodeId, undefined, key)
    }
    else if (b || gsk) labelGroup(ctx, `joint:${joint.id}`, joint.nodeId, () => {
      const label = parts.join(' '), width = measureText(label, T)
      const { centre } = spot(target, width + 0.9 * T, 1.9 * T, joint.nodeId, heights(5.2, 7.3, 10, 13.6, 18.2), undefined, `joint:${joint.id}`)
      const left = centre[0] - width / 2, base = centre[1] + T / 2
      text([left, base], label, T, 'TEXT', joint.nodeId, { label: handle(`joint:${joint.id}`, centre) })
      if (b) {
        // The bolt item is boxed, letter and number.
        const before = measureText(parts.slice(0, parts.indexOf(`B${b}`)).join(' ') + (f ? ' ' : ''), T)
        const bw = measureText(`B${b}`, T), { w, h, shift } = numberBox(`B${b}`), cx = left + before + bw / 2 + shift
        poly(rectPoly(cx - w / 2, base - T / 2 - h / 2, cx + w / 2, base - T / 2 + h / 2), 'TAG', joint.nodeId, { closed: true, occupy: false })
      }
      const bend = ctx.labelPositions?.[`leader:joint:${joint.id}`]
      const from: Point = [(bend ?? target)[0] > centre[0] ? left + width + 0.3 * T : left - 0.3 * T, base - T / 2]
      leader(from, target, joint.nodeId, false, `joint:${joint.id}`)
    })
    else if (f) tag(target, `F${f}`, joint.nodeId, undefined, `joint:${joint.id}`)
    if (combined && f && joint.kind === 'flange-pair') {
      const node = getNode(ctx.doc, joint.nodeId), run = ctx.runs.find(r => r.id === joint.runIds[1]), g = run && ctx.geometry.get(run.id)
      if (g) tag(add2(target, scale2(run!.from === node.id ? g.dir : scale2(g.dir, -1), 0.6 * T)), `F${f}`, joint.nodeId, undefined, `joint:${joint.id}:other`)
    }
    const stub = joint.stubEnds.length ? materialId(ctx.materials, joint.id + '#stub') : undefined
    if (stub) {
      const node = getNode(ctx.doc, joint.nodeId)
      for (const run of joint.stubRunIds.map(id => ctx.runs.find(r => r.id === id)).filter(Boolean) as PipeRun[]) {
        const g = ctx.geometry.get(run.id)
        if (!g) continue
        const out = run.from === node.id ? g.dir : scale2(g.dir, -1)
        const at = add2(target, scale2(out, 0.76 * T)), key = `${run.line}|${run.nps}`
        if (stubSizeJoints.get(key) === joint.id && !stubSizes.has(key)) {
          itemBlock(at, stub, [nominal(sizeFor(ctx.doc, run.nps))], joint.nodeId, true, `stub:${joint.id}:${run.id}`)
          stubSizes.add(key)
        } else tag(at, stub, joint.nodeId, undefined, `stub:${joint.id}:${run.id}`)
      }
    }
  }
  // Every item of the bill of materials is called out on its sheet at least once: one no callout above names (a blind
  // flange closing a branch, whose joint is called out by its mating flange) is ballooned at the first of its parts
  // drawn on the sheet.
  for (const row of ctx.materials) {
    if (ballooned.has(String(row.id))) continue
    for (const member of row.memberIds) {
      const [first, part] = member.split('#'), joint = part ? ctx.joints.find(j => j.id === first) : undefined
      const g = ctx.geometry.get(member)
      const target = joint ? jointPoint(joint) : ctx.pos.get(member) ?? (g ? lerp2(g.a, g.b, 0.5) : undefined)
      if (!target) continue
      tag(target, row.id, joint?.nodeId ?? member, undefined, `item:${member}:${row.id}`)
      break
    }
  }
  function jointPoint(joint: FlangedJoint): Point | undefined {
    const at = ctx.pos.get(joint.nodeId)
    if (!at) return
    if (joint.kind !== 'component-port') return at
    const run = ctx.runs.find(r => r.id === joint.runIds[0]), g = run && ctx.geometry.get(run.id)
    if (!g || !run) return at
    const out = run.from === joint.nodeId ? g.dir : scale2(g.dir, -1)
    return add2(at, scale2(out, Math.max(0, (ctx.extent.get(joint.nodeId) ?? 0) - size.flangeThickness / 2)))
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
      callout(lerp2(g.a, g.b, changed && !near ? 0.75 : 0.2), [nominal(sizeFor(ctx.doc, run.nps))], g.run.id, { head: false, key: `size:${g.run.id}` })
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
    // A plane the view sees edge-on (a vertical plane on a plan) letters in the pipe's own plane instead.
    const across = planeOr(ctx, run.lineNumberPlane === 'alternate' ? ctx.axis(Math.abs(g.dir3[2])>.7?[0,1,0]:[0,0,1]) : run.lineNumberPlane === 'normal' ? left2(g.dir) : run.lineNumberPlane === 'plan' && Math.abs(g.dir3[2])<0.7
      ? ctx.axis([-g.dir3[1],g.dir3[0],0])
      : run.lineNumberPlane === 'vertical' && Math.abs(g.dir3[2])<0.7 ? ctx.axis([0,0,1]) : acrossOf(ctx,g.dir,g.dir3), g.dir, g.dir3)
    const key = lines.get(run.line)===run ? `line:${run.line}` : `line:${run.line}:${run.id}`, lean = leanSearch(ctx), retry = !lean && !!ctx.retry?.has(key)
    labelGroup(ctx, key, run.id, () => {
    type Spot = { cost: number; at: Point; up: Point; clear: boolean; g: RunGeometry; t: number }
    /** The cheapest spot along a pipe of the line: lettered on either side of it, at each share of its length and height. */
    const along = (g: RunGeometry, shares: number[], lifts: number[], best: Spot | null = null) => {
      for (const t of shares)
        for (const side of [1, -1])
          for (const lift of lifts) {
            // The lettering stands clear of the pipe on this side, whichever way its uprights face.
            const up = scale2(acrossFor(g), side), turn = readable(planeText(g.dir, up)), facing = dot2(uprightOf(turn), up) >= 0
            const at = add2(lerp2(g.a, g.b, t), scale2(up, (facing ? 0.53 * T : 1.53 * T) + lift))
            const shape = textPoly(at, run.line, T, turn.rotation, turn.oblique, 'middle', 1)
            const own = ctx.place.cost(shape), cost = own + Math.abs(t - 0.6) * 4 + lift / T * 6.6
            if (!best || cost < best.cost) best = { cost, at, up, clear: own < CLEAR_COST, g, t }
          }
      return best
    }
    const acrossFor = (h: RunGeometry) => h === g ? across : planeOr(ctx, acrossOf(ctx, h.dir, h.dir3), h.dir, h.dir3)
    let best = along(g, lean ? [0.6, 0.4, 0.75] : [0.6, 0.4, 0.75, 0.25, 0.5, 0.85, 0.15], retry ? heights(0, 0.9, 2.1) : [0])
    // Placed again because it lettered over a symbol, pipe or lettering beside its pipe: it is looked for further along
    // and off its pipe, and on the line's other pipes, before it is called out on a leader to its pipe in clear paper.
    const held = ctx.labelPositions?.[key]
    if (retry && !held && best && !best.clear) {
      const others = [...ctx.geometry.values()].filter(h => h !== g && h.run.line === run.line && !h.run.connector && h.run.showLineNumber !== false && h.length > 0)
        .sort((m, n) => n.length - m.length)
      for (const h of [g, ...others]) best = along(h, [0.6, 0.4, 0.75, 0.25, 0.5, 0.85, 0.15, 0.33, 0.67], heights(0, 0.9, 2.1, 3.2), best)
    }
    countSearch(ctx, !!best?.clear)
    if (!best) return
    if (retry && !held && !best.clear) {
      calloutIn(lerp2(best.g.a, best.g.b, best.t), [run.line], run.id, { head: false }, key)
      return
    }
    const { rotation, oblique } = readable(planeText(best.g.dir, best.up))
    const at = held ?? best.at
    text(at, run.line, T, 'TEXT', run.id, { rotation, oblique, anchor: 'middle', label: handle(key, at) })
    })
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
      // The drafter's own caption, else the support type's.
      const code = nodeCode(ctx.doc, node) ?? ''
      const label = (node.calloutText ?? drafting(ctx.doc, node).supportLabel ?? COMPONENT_TYPE_BY_CODE[code]?.label ?? 'SUPPORT').toUpperCase()
      // A label of several lines is placed as the block it is, so no line lands on other lettering.
      const rows = label.split('\n'), width = Math.max(...rows.map(l => measureText(l, T))), height = T + (rows.length - 1) * T * LINE_SPACING
      if (label.trim()) labelGroup(ctx, `support:${node.id}`, node.id, () => {
        if(node.supportSymbol==='callout'){
          callout(at,rows,node.id,{key:`support:${node.id}`})
          return
        }
        const g = node.associatedRunId && ctx.geometry.get(node.associatedRunId)
        if (node.calloutPlane === 'pipe' && g) {
          const turn = readable(planeText(g.dir, acrossOf(ctx, g.dir, g.dir3)))
          const ink = strokeText(label, {at:[0,0],size:T,rotation:turn.rotation,oblique:turn.oblique,anchor:'middle'}).flat()
          const xs=ink.map(p=>p[0]),ys=ink.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys)
          const {centre}=spot(at,x1-x0+0.6*T,y1-y0+0.6*T,node.id,heights(1.8,2.7,3.9,5.5,7.6),undefined,`support:${node.id}`)
          text([centre[0]-(x0+x1)/2,centre[1]-(y0+y1)/2],label,T,'TEXT',node.id,{rotation:turn.rotation,oblique:turn.oblique,anchor:'middle',label:handle(`support:${node.id}`,centre)})
        } else {
          const { centre } = spot(at, width + 0.6 * T, height + 0.6 * T, node.id, heights(1.8, 2.7, 3.9, 5.5, 7.6), undefined, `support:${node.id}`)
          text([centre[0] - width / 2, centre[1] - height / 2 + T], label, T, 'TEXT', node.id, { label: handle(`support:${node.id}`, centre) })
        }
      })
      if (label.trim() && node.supportSymbol === 'callout') continue
    } else if (node.kind === 'annotation' && familyOf(node) === 'wall')
      callout(at, (node.calloutText || 'WALL').toUpperCase().split('\n'), node.id, { head: false })
    else if (node.calloutText && !(node.kind === 'annotation' && SELF_LETTERED.has(familyOf(node))))
      callout(at, node.calloutText.toUpperCase().split('\n'), node.id)
    else if (node.bendRadius && node.bendRadius > 0) callout(at, [`BEND RADIUS ${draftLength(node.bendRadius, ctx.doc.units)}`], node.id)
    if (node.kind !== 'annotation') continue
    const family = familyOf(node)
    if (family === 'instrument' && (node.tag || node.calloutText)) bubble(at, (node.tag || node.calloutText)!, node.id, false, instrumentOut(node))
    if (family === 'nozzle' || family === 'equipment') equipmentLabel(node)
  }
  /** With elevations on, a fitting where a riser meets a level pipe gets its centreline elevation, given a plant origin. */
  function levelChange(node: PipeNode): boolean {
    if (!ctx.style.elevations || !ctx.doc.coordinates || node.continuation || ['end', 'annotation', 'support'].includes(node.kind)) return false
    const dirs = connected(ctx.doc, node.id).map(r => ctx.geometry.get(r.id)?.dir3).filter(Boolean) as Array<[number, number, number]>
    return dirs.some(d => Math.abs(d[2]) > 0.7) && dirs.some(d => Math.abs(d[2]) < 0.05)
  }
  /** An ISA instrument circle lettered with its tag, joined to its point: in line beyond an open end, else beside. */
  function bubble(target: Point, tagText: string, owner: string, arrowed: boolean, inLine?: Point) {
    labelGroup(ctx, `bubble:${owner}`, owner, () => bubbleIn(target, tagText, owner, arrowed, inLine))
  }
  function bubbleIn(target: Point, tagText: string, owner: string, arrowed: boolean, inLine?: Point) {
    const node=ctx.nodes.find(n=>n.id===owner),geometry=node?.associatedRunId ? ctx.geometry.get(node.associatedRunId) : undefined
    const inPlane=node?.calloutPlane==='pipe'&&inLine&&geometry
    // An in-line instrument's bubble is drawn at its standard diameter; a tag bubble grows to fit its tag.
    const label = tagText.toUpperCase(), r = arrowed ? 2.85 * T : Math.max(inPlane ? 2.5 * T : 1.5 * T, measureText(label, T) / 2 + 0.6 * T)
    const key = `bubble:${owner}`
    const centre = ctx.labelPositions?.[key] ?? (inLine ? add2(target, scale2(inLine, 2.4 * T + r)) : spot(target, r * 2, r * 2, owner, heights(4.5, 6.4, 8.5, 11.2, 14.5), undefined, key).centre)
    const ringFrame=inPlane?frame(centre,inLine,acrossOf(ctx,inLine,geometry.dir3)):frame(centre,[1,0],[0,1])
    const ring = Array.from({ length: 36 }, (_, i) => ringFrame(Math.cos(i * Math.PI / 18) * r, Math.sin(i * Math.PI / 18) * r))
    // The bubble is one instrument symbol, at its radius, lettered with its tag as a field.
    asSymbol(ctx.out, 'INSTRUMENT', centre, 0, () => {
      poly(ring, 'TAG', owner, { closed: true })
      ctx.place.add(ring, 'tag', owner)
      text([centre[0], centre[1] + T / 2], label, T, 'TAG', owner, { anchor: 'middle', label: handle(key, centre) })
      const lettering = ctx.out.at(-1)
      if (lettering?.type === 'text') lettering.field = 'tag'
    }, r)
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
    const outline = familyOf(node) === 'equipment', neck = nozzleNeck(ctx, at.end)
    const target = outline ? equipmentCentre(ctx,node,from,at.out) : add2(from,scale2(at.out,neck)), equipment = (node.tag ?? '').toUpperCase()
    if (outline && equipment) {
      const g = ctx.geometry.get(node.associatedRunId ?? ''), across = acrossOf(ctx, at.out, g?.dir3 ?? [1, 0, 0])
      const turn = node.equipmentShape==='vessel' ? readable(planeText(ctx.axis([1,0,0]),ctx.axis([0,0,1]))) : readable(planeText(across, at.out))
      const key=`equipment:${node.id}`,p=ctx.labelPositions?.[key] ?? add2(target, scale2(uprightOf(turn), -T / 2))
      labelGroup(ctx, key, node.id, () => text(p, equipment, T, 'TEXT', node.id,
        { rotation: turn.rotation, oblique: turn.oblique, anchor: 'middle',label:handle(key,p) }))
      return
    }
    const nozzle = outline ? '' : (node.calloutText ?? '').split('\n')[0].toUpperCase()
    const box = 0.9 * T, w = Math.max(measureText(nozzle, T), measureText(equipment, T) + box), h = (nozzle ? T * LINE_SPACING : 0) + T + box
    if (!nozzle && !equipment) return
    const { centre } = spot(target, w + 0.6 * T, h + 0.6 * T, node.id, outline ? heights(3.9, 5.2, 6.7) : heights(1.5, 2.4, 3.6, 5.2))
    let y = centre[1] - h / 2
    if (nozzle) { text([centre[0], y + T], nozzle, T, 'TEXT', node.id, { anchor: 'middle' }); y += T * LINE_SPACING }
    if (!equipment) return
    text([centre[0], y + T + box / 2], equipment, T, 'TEXT', node.id, { anchor: 'middle' })
    if (!outline) poly(rectPoly(centre[0] - w / 2, y, centre[0] + w / 2, y + T + box), 'TAG', node.id, { closed: true })
  }
  function tiePoint(target: Point, node: PipeNode) {
    labelGroup(ctx, `tie:${node.id}`, node.id, () => tieIn(target, node))
  }
  function tieIn(target: Point, node: PipeNode) {
    // The hexagon is sized so its widest line fits between its sloping sides.
    const id = node.tiePoint!.id.toUpperCase(), label = node.tiePoint!.label?.toUpperCase()
    const r = Math.max(2.27 * T, (Math.max(measureText('TP', T), measureText(id, T)) / 2 + 1.14 * T) / 1.15)
    const { centre } = spot(target, Math.max(r * 2.3, label ? measureText(label, T) + 0.6 * T : 0), r * 2 + (label ? T * 2 : 0), node.id, heights(6.1, 8.5, 11.5, 15.2), undefined, `tie:${node.id}`)
    // The label goes under the hexagon unless the leader would cross it there.
    const labelAt = (under: boolean): { c: Point; box: Poly } => {
      const c: Point = [centre[0], centre[1] + (label ? under ? -T : T : 0)], w = measureText(label ?? '', T) / 2 + 0.15 * T, y = under ? c[1] + r + 0.76 * T : c[1] - r - 1.76 * T
      return { c, box: rectPoly(c[0] - w, y - 0.15 * T, c[0] + w, y + 1.15 * T) }
    }
    const crosses = (o: { c: Point; box: Poly }) => overlapsSegment(o.box, o.c, target)
    const below = !label || !crosses(labelAt(true)) || crosses(labelAt(false)), { c } = labelAt(below)
    const hex = Array.from({ length: 6 }, (_, i) => add2(c, [Math.cos(i * Math.PI / 3) * r * 1.15, Math.sin(i * Math.PI / 3) * r])) as Point[]
    poly(hex, 'TAG', node.id, { closed: true })
    ctx.place.add(hex, 'tag', node.id)
    text([c[0], c[1] - 0.3 * T], 'TP', T, 'TAG', node.id, { anchor: 'middle', label: handle(`tie:${node.id}`, centre) })
    text([c[0], c[1] + 1.3 * T], id, T, 'TAG', node.id, { anchor: 'middle' })
    if (label) text([c[0], below ? c[1] + r + 1.76 * T : c[1] - r - 0.76 * T], label, T, 'TEXT', node.id, { anchor: 'middle' })
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
        if(note.arrow){const tip=note.leader[0],u=unit2(sub2(note.leader[1],tip)),v=left2(u),base=add2(tip,scale2(u,size.arrow*1.4)),half=size.arrowWidth*2.3;ctx.out.push({type:'polyline',points:[add2(base,scale2(v,half)),tip,add2(base,scale2(v,-half))],layer:'MARKUP',owner:note.id,color:note.color})}
      }
      ctx.out.push({type:'text',p:note.at,text:note.text.toUpperCase(),size:note.size??T,layer:'TEXT',owner:note.id,rotation:note.rotation,oblique:note.oblique,lettering:note.lettering,color:note.textColor})
    }
  // Field welds are flagged FW (field-fit welds FFW with their makeup); with weld numbers on, each weld's number sits
  // in a balloon on a leader to its weld. Each is a label of its own, held and moved like any other.
  for (const w of weldsOf(ctx, ctx.doc)) {
    const p = ctx.geometry.has(w.runId) ? weldPoint(ctx, w) : undefined
    if (!p) continue
    const id = `${w.nodeId}:${w.runId}`
    if (w.field) fieldFlag(p, w.nodeId, `field-weld:${id}`, w)
    if (!ctx.style.weldNumbers) continue
    labelGroup(ctx, `weld-number:${id}`, w.nodeId, () => weldBalloon(p, w, `weld-number:${id}`))
  }
  // A butt-welded end marked as field welded where it continues on another drawing is flagged too.
  for (const node of ctx.nodes) {
    const run = node.kind === 'end' && node.continuation ? connected(ctx.doc, node.id)[0] : undefined, at = ctx.pos.get(node.id)
    if (run && at && ctx.geometry.has(run.id) && (run.from === node.id ? run.fromField : run.toField)) fieldFlag(at, node.id, `field-weld:${node.id}`)
  }
  function weldBalloon(p: Point, w: Weld, key: string) {
    const lettering = T * 0.85, r = Math.max(lettering * 0.85, measureText(w.tag, lettering) / 2 + 0.33 * T)
    const { centre } = spot(p, r * 2, r * 2, w.nodeId, heights(1.8, 2.6, 3.5, 4.5), undefined, key)
    const ring = Array.from({ length: 24 }, (_, i) => add2(centre, [Math.cos(i * Math.PI / 12) * r, Math.sin(i * Math.PI / 12) * r])) as Point[]
    poly(ring, 'WELD', w.nodeId, { closed: true, weight: size.thin })
    ctx.place.add(rectPoly(centre[0] - r, centre[1] - r, centre[0] + r, centre[1] + r), 'tag', w.nodeId)
    text([centre[0], centre[1] + lettering / 2], w.tag, lettering, 'WELD', w.nodeId, { anchor: 'middle', label: handle(key, centre) })
    const bend = ctx.labelPositions?.[`leader:${key}`]
    leader(add2(centre, scale2(unit2(sub2(bend ?? p, centre)), r)), p, w.nodeId, false, key)
  }
  /** FW beside a field weld; a field-fit weld reads FFW with the extra pipe left for fit-up, unless lettered FW. */
  function fieldFlag(p: Point, owner: string, key: string, w?: Weld) {
    labelGroup(ctx, key, owner, () => {
      const fit = !!w?.fieldFit && ctx.style.fieldFitMark !== 'FW'
      const note = fit ? fieldFitNote(ctx.doc) : undefined, lines = fit ? ['FFW', ...(note ? [note] : [])] : ['FW']
      const width = Math.max(...lines.map(l => measureText(l, T))), height = T + (lines.length - 1) * T * LINE_SPACING
      const { centre } = spot(p, width + 0.6 * T, height + 0.6 * T, owner, heights(1.8, 2.6, 3.5), undefined, key)
      text([centre[0] - width / 2, centre[1] - height / 2 + T], lines.join('\n'), T, 'WELD', owner, { label: handle(key, centre) })
      leader(boxEdge(centre, width + 0.45 * T, height + 0.45 * T, ctx.labelPositions?.[`leader:${key}`] ?? p), p, owner, false, key)
    })
  }
}
