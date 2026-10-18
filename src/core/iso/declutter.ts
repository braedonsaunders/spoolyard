import type { PaperLabel, Point, Primitive } from '../drawing'
import { LINE_SPACING } from '../stroke-font'
import type { LabelRecord } from './context'
import { bbox, BoxIndex, overlaps, segmentPoly, textPoly, type Placement, type Poly, type Rect } from './placement'

type Text = Extract<Primitive, { type: 'text' }>

/** The lettering of a text, one shape per line that has any, so the blank line under a boxed number covers nothing. */
export function letteringShapes(p: Text, pad = 0): Poly[] {
  const r = (p.rotation ?? 0) * Math.PI / 180, slant = Math.tan((p.oblique ?? 0) * Math.PI / 180)
  return p.text.split('\n').flatMap((line, i) => {
    if (!line.trim()) return []
    // Each line's baseline sits a line spacing below the last, along the text's own down direction.
    const y = -i * p.size * LINE_SPACING, sx = y * slant
    const at: Point = [p.p[0] + sx * Math.cos(r) - y * Math.sin(r), p.p[1] - sx * Math.sin(r) - y * Math.cos(r)]
    return [textPoly(at, line, p.size, p.rotation, p.oblique, p.anchor, pad)]
  })
}

/** Convex hull (monotone chain), counter-clockwise. */
export function hull(points: Point[]): Point[] {
  const pts = [...new Map(points.map(p => [`${p[0].toFixed(3)},${p[1].toFixed(3)}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Point[] = [], upper: Point[] = []
  for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p) }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p) }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

interface Obstacle { poly: Poly; box: Rect; primitive: Primitive }
/**
 * Everything a label's ink may not overprint: other lettering, pipe, and symbol and tag linework. Indexed once for a
 * drawing's ink as it stands (the same array, no longer drawn to), for the tests made of it one after another.
 */
function obstacles(out: Primitive[]): BoxIndex<Obstacle> {
  const known = indexed.get(out)
  if (known && known.count === out.length) return known.index
  const index = obstaclesOf(out)
  indexed.set(out, { count: out.length, index })
  return index
}
const indexed = new WeakMap<Primitive[], { count: number; index: BoxIndex<Obstacle> }>()
function obstaclesOf(out: Primitive[]): BoxIndex<Obstacle> {
  const list = new BoxIndex<Obstacle>()
  const push = (poly: Poly, primitive: Primitive) => list.add({ poly, box: bbox(poly), primitive })
  for (const p of out) {
    if (p.type === 'text') for (const shape of letteringShapes(p)) push(shape, p)
    else if (p.type === 'line') {
      if (p.layer === 'PIPE') push(segmentPoly(p.a, p.b, 0.85), p)
      else if (['SYMBOL', 'TAG', 'WELD'].includes(p.layer)) push(segmentPoly(p.a, p.b, 0.3), p)
    } else if (p.type === 'polyline' && ['SYMBOL', 'TAG', 'WELD'].includes(p.layer))
      for (let i = 0; i + 1 < p.points.length + (p.closed ? 1 : 0); i++) push(segmentPoly(p.points[i], p.points[(i + 1) % p.points.length], 0.3), p)
    else if (p.type === 'circle' && ['SYMBOL', 'TAG', 'WELD'].includes(p.layer))
      push([[p.p[0] - p.r, p.p[1] - p.r], [p.p[0] + p.r, p.p[1] - p.r], [p.p[0] + p.r, p.p[1] + p.r], [p.p[0] - p.r, p.p[1] + p.r]], p)
  }
  return list
}
/** The shapes a label's own ink covers: each line of its lettering, and its boxes, bubbles and hexagons. */
function subjectShapes(record: LabelRecord, pad = 0): Poly[] {
  return record.ink.flatMap(p => p.type === 'text' ? letteringShapes(p, pad)
    : p.type === 'polyline' && p.closed && p.layer === 'TAG' ? [hull(p.points)] : [])
}

/**
 * Labels whose lettering or boxes overprint other lettering, pipe or another item's symbols, or leave the model area:
 * `lettering` where it lands on lettering, a tag or pipe (or off the model area), `linework` where only on symbols.
 * A label is never in conflict with its own ink, the callout it is part of, or its own item's linework.
 */
const hard = (p: Primitive) => p.type === 'text' || p.layer === 'PIPE' || p.layer === 'TAG'
/** The ink a label may touch: its own, its enclosing callouts', and that of the lines drawn with it. */
function familyOf(labels: Map<string, LabelRecord>) {
  const family = new Map<string, Set<Primitive>>()
  return (key: string) => {
    let set = family.get(key)
    if (set) return set
    set = new Set<Primitive>()
    const record = labels.get(key)!
    for (const p of record.ink) set.add(p)
    // Its enclosing callouts and the lines drawn by them share ink with it.
    for (let parent = record.parent && labels.get(record.parent); parent; parent = parent.parent ? labels.get(parent.parent) : undefined)
      for (const p of parent.ink) set.add(p)
    for (const other of labels.values()) if (other.parent === key) for (const p of other.ink) set.add(p)
    family.set(key, set)
    return set
  }
}
/** Whether an obstacle is one a label may overlap: its family's ink, or its own item's linework. */
const excused = (record: LabelRecord, own: Set<Primitive>, o: Obstacle) =>
  own.has(o.primitive) || o.primitive.type !== 'text' && o.primitive.layer !== 'PIPE' && !!record.owner && o.primitive.owner === record.owner

export function overprinting(out: Primitive[], labels: Map<string, LabelRecord>, place: Pick<Placement, 'inside'>, only?: Iterable<string>): Map<string, 'lettering' | 'linework'> {
  const all = obstacles(out), found = new Map<string, 'lettering' | 'linework'>(), inkOf = familyOf(labels)
  // `only` names the labels to test, when the rest are known clear.
  const tested = only ? [...only].flatMap(k => labels.get(k) ?? []) : labels.values()
  for (const record of tested) {
    if (!record.ink.length || (record.parent && !record.held && record.ink.every(p => !out.includes(p)))) continue
    const own = inkOf(record.key), shapes = subjectShapes(record)
    let clash: 'lettering' | 'linework' | undefined
    for (const shape of shapes) {
      if (!place.inside(shape)) { clash = 'lettering'; break }
      for (const o of all.near(bbox(shape))) {
        if (excused(record, own, o) || clash === 'linework' && !hard(o.primitive)) continue
        if (!overlaps(shape, o.poly)) continue
        clash = hard(o.primitive) ? 'lettering' : 'linework'
        if (clash === 'lettering') break
      }
      if (clash === 'lettering') break
    }
    if (clash) found.set(record.key, clash)
  }
  return found
}

/**
 * Where to draw held callouts that overprint: each moved, for this drawing only, by the least offset from where the
 * drafter put it that lands clear, preferring offsets that keep its leader short and off other lettering. Of two held
 * labels that overprint each other, the one drawn first stays and the later one moves; a held label that lands on an
 * automatic label stays, as that label is placed again. Dimension lettering is never moved. Labels with no clear spot
 * near by are left where they are held. Returns the offset for each label moved.
 */
/** Dimension and offset lettering keys, drawn before the callouts. */
const MOVABLE = /^(dimension|drafted-dimension|offset-leg|offset-angle):/
export function displaceHeld(out: Primitive[], labels: Map<string, LabelRecord>, place: Pick<Placement, 'inside'>,
  clashes: Map<string, 'lettering' | 'linework'>, moving: Set<string>): Map<string, Point> {
  const all = obstacles(out), inkOf = familyOf(labels), moves = new Map<string, Point>()
  const rank = new Map([...labels.keys()].map((k, i) => [k, i]))
  const keysOf = new Map<Primitive, string[]>()
  for (const r of labels.values()) for (const p of r.ink) keysOf.set(p, [...(keysOf.get(p) ?? []), r.key])
  // Callouts the drafter placed move, and so does dimension and offset lettering that lands on other lettering, a tag
  // or pipe (it may touch symbol linework, as drafted); automatic callouts are placed again instead.
  const candidates = [...labels.values()].filter(r => clashes.has(r.key) && r.ink.length && (r.annotation ? r.held : MOVABLE.test(r.key) && clashes.get(r.key) === 'lettering'))
  const candidate = new Set(candidates.map(r => r.key))
  const struck = (r: LabelRecord, shapes: Poly[], list: BoxIndex<Obstacle>) => {
    const own = inkOf(r.key), hit: Obstacle[] = []
    for (const shape of shapes) for (const o of list.near(bbox(shape))) if (!excused(r, own, o) && overlaps(shape, o.poly)) hit.push(o)
    return hit
  }
  // A held label gives way to what was drawn before it, never to a label that moves itself.
  const yields = (r: LabelRecord, o: Obstacle) => !(keysOf.get(o.primitive) ?? []).some(k => moving.has(k) || candidate.has(k) && rank.get(k)! > rank.get(r.key)!)
  const movers = candidates.filter(r => {
    const shapes = subjectShapes(r)
    return shapes.some(s => !place.inside(s)) || struck(r, shapes, all).some(o => yields(r, o))
  })
  const going = new Set(movers.map(r => r.key))
  // What stays put: everything but the labels about to move and the automatic labels placed again.
  const fixed = new BoxIndex<Obstacle>()
  for (const o of all.items) if (!(keysOf.get(o.primitive) ?? []).some(k => going.has(k) || moving.has(k))) fixed.add(o)
  // Arrowheads are not lettered over; thin dimension lines and leaders break around lettering, so crossing one is mild.
  const soft = new BoxIndex<Obstacle>()
  for (const p of out) {
    if (p.type === 'polyline' && p.fill && (p.layer === 'DIM' || p.layer === 'LEADER')) { const poly = hull(p.points); fixed.add({ poly, box: bbox(poly), primitive: p }) }
    else if (p.type === 'line' && (p.layer === 'DIM' || p.layer === 'LEADER')) { const poly = segmentPoly(p.a, p.b, 0.5); soft.add({ poly, box: bbox(poly), primitive: p }) }
  }
  const shift = (shape: Poly, d: Point): Poly => shape.map(p => [p[0] + d[0], p[1] + d[1]] as Point)
  for (const r of movers) {
    // Moved lettering keeps a little clear of its neighbours, so it does not read as part of them.
    const shapes = subjectShapes(r, 1.5), leader = r.leader, end = leader && (leader.held && leader.bend ? leader.bend : leader.to)
    const reach = leader && end ? Math.hypot(end[0] - leader.from[0], end[1] - leader.from[1]) : 0
    let best: { d: Point; cost: number } | undefined, found = 0
    const clear = (d: Point) => { const moved = shapes.map(s => shift(s, d)); return !moved.some(s => !place.inside(s)) && !struck(r, moved, fixed).length ? moved : undefined }
    const crossings = (moved: Poly[]) => moved.reduce((n, s) => n + soft.near(bbox(s)).filter(o => o.primitive.owner !== r.owner && overlaps(s, o.poly)).length, 0)
    // A dimension's value first slides along its own line, as drafted, before standing off it.
    const text = r.ink.find((p): p is Extract<Primitive, { type: 'text' }> => p.type === 'text')
    if (r.dimension && text) {
      const a = (text.rotation ?? 0) * Math.PI / 180, along: Point = [Math.cos(a), -Math.sin(a)]
      for (let k = 1; k <= 24 && !best; k++) for (const side of [1, -1]) {
        const d: Point = [along[0] * k * 2.5 * side, along[1] * k * 2.5 * side], moved = clear(d)
        if (moved && (!best || k * 2.5 + crossings(moved) * 6 < best.cost)) best = { d, cost: k * 2.5 + crossings(moved) * 6 }
      }
    }
    const slid = !!best
    for (let ring = 1; !slid && ring <= 48 && !(found && ring > found + 2); ring++) {
      const radius = ring * 2.5, count = Math.min(48, Math.max(8, Math.round(2 * Math.PI * radius / 3)))
      for (let i = 0; i < count; i++) {
        const a = i * 2 * Math.PI / count, d: Point = [Math.cos(a) * radius, Math.sin(a) * radius]
        const moved = shapes.map(s => shift(s, d))
        if (moved.some(s => !place.inside(s)) || struck(r, moved, fixed).length) continue
        let cost = radius
        cost += crossings(moved) * 6
        if (leader && end) {
          const from: Point = [leader.from[0] + d[0], leader.from[1] + d[1]], line = segmentPoly(from, end, 0.3), box = bbox(line)
          cost += (Math.hypot(end[0] - from[0], end[1] - from[1]) - reach) * 0.3
          cost += fixed.near(box).filter(o => (o.primitive.type === 'text' || o.primitive.layer === 'TAG') && !inkOf(r.key).has(o.primitive) && overlaps(line, o.poly)).length * 25
        }
        if (!best || cost < best.cost) best = { d, cost }
        found ||= ring
      }
    }
    if (!best) continue
    moves.set(r.key, best.d)
    // Later labels keep off where this one now goes.
    const marker: Primitive = { type: 'text', p: [0, 0], text: '', size: 0, layer: 'TEXT' }
    for (const s of shapes) { const poly = shift(s, best.d); fixed.add({ poly, box: bbox(poly), primitive: marker }) }
  }
  return moves
}

/** The labels as the editor picks them. */
export function paperLabels(labels: Map<string, LabelRecord>, clashes: Map<string, 'lettering' | 'linework'>): PaperLabel[] {
  const out: PaperLabel[] = []
  for (const r of labels.values()) {
    if (!r.points.length) continue
    const outline = hull(r.points), box = bbox(outline)
    out.push({
      key: r.key, spool: r.spool, ...(r.owner ? { owner: r.owner } : {}),
      at: r.at ? [...r.at] : [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2],
      outline, held: r.held,
      ...(r.parent && !r.held ? { parent: r.parent } : {}),
      ...(r.leader ? { leader: r.leader } : {}),
      ...(r.held && clashes.get(r.key) === 'lettering' ? { overlapping: true } : {}),
      ...(r.displaced ? { displaced: true } : {}),
      ...(r.dimension ? { dimension: r.dimension } : {}),
      ink: r.ink
    })
  }
  return out
}

/**
 * A test of whether a label's lettering or boxes land on other lettering or a tag, or leave the model area: what
 * overprints legibly (`overprinting`'s 'lettering', but for pipe it may touch). Ink in `skip` (labels taken away)
 * is not met. Obstacles are indexed once, for testing label after label.
 */
export function letteringCheck(out: Primitive[], labels: Map<string, LabelRecord>, place: Pick<Placement, 'inside'>) {
  const all = obstacles(out), inkOf = familyOf(labels)
  return (key: string, skip: Set<Primitive>): boolean => {
    const record = labels.get(key)
    if (!record?.ink.length) return false
    const own = inkOf(key), struck = strikable(key)
    for (const shape of subjectShapes(record)) {
      if (!place.inside(shape)) return true
      for (const o of all.near(bbox(shape)))
        if (!skip.has(o.primitive) && !own.has(o.primitive) && (o.primitive.type === 'text' || o.primitive.layer === 'TAG' || struck && o.primitive.layer !== 'PIPE') && !excused(record, own, o) && overlaps(shape, o.poly)) return true
    }
    return false
  }
}
/**
 * Labels whose lettering may not be crossed by another item's symbol linework either, as lettering may not: line
 * numbers and leader callouts (sizes and the drafter's callouts), which read as struck through where a valve or
 * fitting is drawn over them. Dimension and offset values and item balloons may touch symbols, as drafted.
 */
export const strikable = (key: string) => /^(line|callout|size):/.test(key)
