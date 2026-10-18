import type { DrawingNotice, Point, Primitive } from '../drawing'
import type { IsoContext, LabelRecord } from './context'
import { letteringCheck, letteringShapes, strikable } from './declutter'
import { bbox, type Rect } from './placement'

/**
 * The last word on overprinting: no issued sheet letters over its own lettering.
 *
 * Labels are placed beside their items first, searched clear of everything (annotations.ts), and held labels that
 * overprint are moved a little (`displaceHeld`). On a sheet too dense for that, the labels still landing on other
 * lettering or a tag (or off the drawing area) are taken out of the picture, the fewest that clear it (callouts the
 * drafter did not place first, then held ones, dimension values last), and set as margin callouts: each drawn whole,
 * at its own size, in the nearest paper clear of all ink (preferring paper outside the drawing, the margin round it)
 * with a leader to its item, the way a drafter lists balloons along the border of a crowded sheet. A label for which
 * no clear paper is left is omitted and reported, never overprinted.
 *
 * The search is bounded by a count of spots weighed, not by time, so the same sheet always comes out the same.
 */
export function marginCallouts(ctx: IsoContext, viewport: Rect, exclusions: Rect[]): { notices: DrawingNotice[]; changed: boolean } {
  const labels = ctx.labels!, T = (ctx.size ?? { text: 10 }).text
  const none = new Set<Primitive>()
  // Only labels the declutter found overprinting lettering, a tag, pipe or the frame can land on lettering; line numbers
  // and callouts struck through by another item's symbol are set clear too.
  const suspects = [...labels.keys()].filter(k => ctx.clashes?.get(k) === 'lettering' || ctx.clashes?.get(k) === 'linework' && strikable(k))
  if (!suspects.length) return { notices: [], changed: false }
  let check = letteringCheck(ctx.out, labels, ctx.place)
  const rank = new Map([...labels.keys()].map((k, i) => [k, i]))
  const rootOf = (key: string) => {
    let r = labels.get(key)
    for (let up = labels.size; up > 0 && r && !r.held && r.parent && labels.has(r.parent); up--) r = labels.get(r.parent)
    return r?.key ?? key
  }
  const members = new Map<string, LabelRecord[]>()
  for (const r of labels.values()) { const k = rootOf(r.key), list = members.get(k); if (list) list.push(r); else members.set(k, [r]) }
  const inkOf = (root: string) => {
    const set = new Set<Primitive>()
    for (const r of members.get(root) ?? []) { for (const p of r.ink) set.add(p); for (const p of r.leaders ?? []) set.add(p) }
    return set
  }
  // Callouts placed automatically give way first, then held ones; dimension values, read where they stand, last.
  const tier = (r: LabelRecord) => DIMENSION.test(r.key) ? 2 : r.held ? 1 : 0
  const order = (keys: string[]) => keys.filter(k => labels.has(k)).sort((a, b) => tier(labels.get(a)!) - tier(labels.get(b)!) || rank.get(b)! - rank.get(a)!)
  // The fewest taken out that leave the rest clear: each, in that order, only while it still overprints.
  const removed = new Set<Primitive>(), taken: string[] = []
  for (const root of order([...new Set(suspects.map(rootOf))]))
    if (check(root, removed)) { taken.push(root); for (const p of inkOf(root)) removed.add(p) }
  if (!taken.length) return { notices: [], changed: false }
  const oldLeaders = new Set(taken.flatMap(root => (members.get(root) ?? []).flatMap(r => r.leaders ?? [])))

  // Paper as cells a letter square, marked where anything is drawn (or the picture must keep off).
  const c = T, [vx0, vy0, vx1, vy1] = viewport, nx = Math.max(1, Math.ceil((vx1 - vx0) / c)), ny = Math.max(1, Math.ceil((vy1 - vy0) / c))
  const blocked = new Uint8Array(nx * ny)
  const cx = (x: number) => Math.floor((x - vx0) / c), cy = (y: number) => Math.floor((y - vy0) / c)
  const mark = (r: Rect) => {
    const x0 = Math.max(0, cx(r[0])), x1 = Math.min(nx - 1, cx(r[2])), y0 = Math.max(0, cy(r[1])), y1 = Math.min(ny - 1, cy(r[3]))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) blocked[y * nx + x] = 1
  }
  const markSegment = (a: Point, b: Point, pad: number) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / (c / 2)))
    for (let i = 0; i <= n; i++) { const x = a[0] + (b[0] - a[0]) * i / n, y = a[1] + (b[1] - a[1]) * i / n; mark([x - pad, y - pad, x + pad, y + pad]) }
  }
  const markInk = (p: Primitive) => {
    if (p.type === 'text') { for (const s of letteringShapes(p, 0.15 * T)) mark(bbox(s)) }
    else if (p.type === 'line') markSegment(p.a, p.b, p.layer === 'PIPE' ? 0.3 * T : 0.1 * T)
    else if (p.type === 'polyline') for (let i = 0; i + 1 < p.points.length + (p.closed ? 1 : 0); i++) markSegment(p.points[i], p.points[(i + 1) % p.points.length], 0.1 * T)
    else if (p.type === 'circle' || p.type === 'arc') mark([p.p[0] - p.r, p.p[1] - p.r, p.p[0] + p.r, p.p[1] + p.r])
    else if (p.type === 'image') mark([p.p[0], p.p[1], p.p[0] + p.width, p.p[1] + p.height])
  }
  for (const e of exclusions) mark(e)
  for (const p of ctx.out) if (!removed.has(p)) markInk(p)
  // Summed counts of marked cells, so whether a box is clear of the drawing is found at once.
  const sums = new Int32Array((nx + 1) * (ny + 1))
  const count = () => {
    for (let y = 0; y < ny; y++) for (let x = 0, row = 0; x < nx; x++) {
      row += blocked[y * nx + x]
      sums[(y + 1) * (nx + 1) + x + 1] = sums[y * (nx + 1) + x + 1] + row
    }
  }
  // Cells taken by callouts set in the margin so far. (Leaders may pass under later ones: thin lines break round
  // lettering.)
  const occupied = new Uint8Array(nx * ny)
  const free = (r: Rect) => {
    if (r[0] < vx0 || r[1] < vy0 || r[2] > vx1 || r[3] > vy1) return false
    const x0 = cx(r[0]), x1 = Math.min(nx - 1, cx(r[2])) + 1, y0 = cy(r[1]), y1 = Math.min(ny - 1, cy(r[3])) + 1, W = nx + 1
    if (sums[y1 * W + x1] - sums[y0 * W + x1] - sums[y1 * W + x0] + sums[y0 * W + x0] !== 0) return false
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (occupied[y * nx + x]) return false
    return true
  }
  count()
  // The picture: its nodes' extent. Paper outside it is margin, preferred to a gap inside.
  const nodes = [...ctx.pos.values()], core: Rect = nodes.length ? bbox(nodes) : [0, 0, 0, 0]
  const inCore = (x: number, y: number) => x > core[0] && x < core[2] && y > core[1] && y < core[3]
  const INSIDE = 12 * T, full: Array<[number, number]> = []
  let work = 0
  const moved: string[] = [], omitted: string[] = []
  const leaderInk: Primitive[] = []
  for (const root of taken) {
    const record = labels.get(root)!, family = members.get(root) ?? [record]
    const points = family.flatMap(r => r.points)
    if (!points.length) { omitted.push(root); continue }
    const box = bbox(points), pad = 0.35 * T, w = box[2] - box[0] + 2 * pad, h = box[3] - box[1] + 2 * pad
    const centre: Point = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
    const stem = record.leaders?.find((p): p is Extract<Primitive, { type: 'line' }> => p.type === 'line')
    const target: Point = record.leader ? [...record.leader.to] : stem ? [...stem.a] : centre
    // Paper is only ever taken, so a box no smaller than one that found no room anywhere is taken to find none either.
    if (full.some(([fw, fh]) => w >= fw - 1e-9 && h >= fh - 1e-9)) { omitted.push(root); continue }
    let best: { at: Point; cost: number } | undefined, exhausted = true
    // Ring by ring out from the item, over the paper only, until no farther spot can cost less than the best found.
    const tx = Math.round((target[0] - vx0) / c), ty = Math.round((target[1] - vy0) / c), reach = Math.max(tx, ty, nx - tx, ny - ty) + 1
    const ox = (target[0] - vx0) / c, oy = (target[1] - vy0) / c
    const visit = (i: number, j: number) => {
      work++
      // A spot whose middle is taken is not clear, found at once.
      const gx = Math.floor(ox + i), gy = Math.floor(oy + j)
      if (gx < 0 || gy < 0 || gx >= nx || gy >= ny || blocked[gy * nx + gx] || occupied[gy * nx + gx]) return
      const at: Point = [target[0] + i * c, target[1] + j * c]
      const cost = Math.hypot(i * c, j * c) + (inCore(at[0], at[1]) ? INSIDE : 0)
      if (best && cost >= best.cost) return
      if (free([at[0] - w / 2, at[1] - h / 2, at[0] + w / 2, at[1] + h / 2])) best = { at, cost }
    }
    for (let ring = 0; ring <= reach; ring++) {
      if (work > MARGIN_WORK) { exhausted = false; break }
      if (best && (ring - 1) * c > best.cost) { exhausted = false; break }
      if (!ring) { visit(0, 0); continue }
      // The ring's sides, clipped to the paper.
      const lo = (o: number) => Math.max(-ring, -o - 1), hi = (o: number, n: number) => Math.min(ring, n - o + 1)
      if (ty - ring >= -1) for (let i = lo(tx); i <= hi(tx, nx); i++) visit(i, -ring)
      if (ty + ring <= ny + 1) for (let i = lo(tx); i <= hi(tx, nx); i++) visit(i, ring)
      if (tx - ring >= -1) for (let j = lo(ty) + (lo(ty) === -ring ? 1 : 0); j <= hi(ty, ny) - (hi(ty, ny) === ring ? 1 : 0); j++) visit(-ring, j)
      if (tx + ring <= nx + 1) for (let j = lo(ty) + (lo(ty) === -ring ? 1 : 0); j <= hi(ty, ny) - (hi(ty, ny) === ring ? 1 : 0); j++) visit(ring, j)
    }
    if (!best && exhausted) full.push([w, h])
    if (!best) { omitted.push(root); continue }
    // The callout, moved whole; its leader leaves its box toward the item.
    const d: Point = [best.at[0] - centre[0], best.at[1] - centre[1]], shift = (p: Point): Point => [p[0] + d[0], p[1] + d[1]]
    for (const p of inkOf(root)) {
      if (p.layer === 'LEADER') continue
      if (p.type === 'text') { p.p = shift(p.p); if (p.label) p.label = { ...p.label, at: shift(p.label.at) } }
      else if (p.type === 'polyline') p.points = p.points.map(shift)
      else if (p.type === 'line') { p.a = shift(p.a); p.b = shift(p.b) }
      else if (p.type === 'circle' || p.type === 'arc' || p.type === 'image') p.p = shift(p.p)
    }
    for (const r of family) { r.points = r.points.map(shift); if (r.at) r.at = shift(r.at); r.displaced = true }
    const rect: Rect = [best.at[0] - w / 2, best.at[1] - h / 2, best.at[0] + w / 2, best.at[1] + h / 2]
    for (let y = Math.max(0, cy(rect[1])); y <= Math.min(ny - 1, cy(rect[3])); y++) for (let x = Math.max(0, cx(rect[0])); x <= Math.min(nx - 1, cx(rect[2])); x++) occupied[y * nx + x] = 1
    const from = edgeToward(rect, target), owner = record.owner
    const line: Primitive = { type: 'line', a: from, b: target, layer: 'LEADER', ...(owner ? { owner } : {}) }
    const l = Math.hypot(target[0] - from[0], target[1] - from[1])
    const ink: Primitive[] = [line]
    if (l > 2 * T) {
      // A filled arrowhead at the item, as every leader of the sheet has.
      const u: Point = [(target[0] - from[0]) / l, (target[1] - from[1]) / l], a = 1.1 * T, b = 0.2 * T, base: Point = [target[0] - u[0] * a, target[1] - u[1] * a]
      ink.push({ type: 'polyline', points: [target, [base[0] + u[1] * b, base[1] - u[0] * b], [base[0] - u[1] * b, base[1] + u[0] * b]], closed: true, fill: true, weight: 0.001, layer: 'LEADER', ...(owner ? { owner } : {}) })
    }
    for (const p of ink) leaderInk.push(p)
    record.leaders = ink
    record.leader = { from, to: target, held: false }
    moved.push(root)
  }
  // Old leaders and omitted labels leave the sheet; the moved callouts' leaders join it.
  const gone = new Set(oldLeaders)
  for (const root of omitted) for (const r of members.get(root) ?? []) for (const p of r.ink) gone.add(p)
  const drop = (root: string) => { for (const r of members.get(root) ?? []) labels.delete(r.key) }
  for (const root of omitted) drop(root)
  ctx.out = [...ctx.out.filter(p => !gone.has(p)), ...leaderInk]
  // Whatever still lands on lettering (a callout set beside another moved one, ink the cells did not hold) is omitted
  // too, so nothing issued overprints.
  for (let pass = 0; pass < 4; pass++) {
    check = letteringCheck(ctx.out, labels, ctx.place)
    // Only the callouts moved can have come to land on lettering: the rest only lost ink beside them.
    const still = order(moved.filter(root => (members.get(root) ?? []).some(r => labels.has(r.key) && check(r.key, none))))
    if (!still.length) break
    const skip = new Set<Primitive>(), out: string[] = []
    for (const root of still) if (check(root, skip)) { out.push(root); for (const p of inkOf(root)) skip.add(p) }
    for (const root of out) { omitted.push(root); if (moved.includes(root)) moved.splice(moved.indexOf(root), 1) }
    ctx.out = ctx.out.filter(p => !skip.has(p))
    for (const root of out) drop(root)
  }
  const notices: DrawingNotice[] = []
  if (moved.length) notices.push({ kind: 'margin-callouts', message: `${moved.length} ${moved.length === 1 ? 'callout' : 'callouts'} with no clear room beside ${moved.length === 1 ? 'its item is' : 'their items are'} drawn in the margin, with a leader to the item.` })
  if (omitted.length) notices.push({ kind: 'labels-omitted', message: `${omitted.length} ${omitted.length === 1 ? 'label' : 'labels'} could not be placed without overprinting other lettering and ${omitted.length === 1 ? 'is' : 'are'} left off this sheet: give the drawing a larger sheet, fewer callouts or a split into more spools.` })
  return { notices, changed: true }
}
/** Dimension and offset values, read along their dimension lines. */
const DIMENSION = /^(dimension|drafted-dimension|offset-leg|offset-angle):/
/** Spots a sheet's margin callouts may weigh in all, past which labels still without room are omitted. */
const MARGIN_WORK = 300_000
/** Where a line from a box's centre toward `p` leaves the box. */
function edgeToward(r: Rect, p: Point): Point {
  const c: Point = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], d = [p[0] - c[0], p[1] - c[1]]
  const s = Math.max(Math.abs(d[0]) / ((r[2] - r[0]) / 2 || 1), Math.abs(d[1]) / ((r[3] - r[1]) / 2 || 1)) || 1
  return [c[0] + d[0] / s, c[1] + d[1] / s]
}
