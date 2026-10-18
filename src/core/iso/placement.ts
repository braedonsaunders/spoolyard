import type { Point } from '../drawing'
import { measureText, LINE_SPACING } from '../stroke-font'
import { add2, left2, scale2, sub2, unit2 } from './plane'

export type Poly = Point[]
export type Rect = [number, number, number, number]
/** Something drawn (or reserved) on the sheet; `label` marks room reserved for that label, which it may take. */
export interface Occupant {
  poly: Poly; kind: string; owner?: string; box: Rect; label?: string
  /** An axis-aligned rectangle. */
  aligned?: boolean
  /** Its edge axes and its own extent along each, found the first time it is tested. */
  sat?: Projection
}

/** Bounding box of a polygon. */
export const bbox = (poly: Poly): Rect => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0, y0, x1, y1]
}
/** Whether two boxes share interior. */
export const boxesMeet = (a: Rect, b: Rect) => !(b[0] >= a[2] || b[2] <= a[0] || b[1] >= a[3] || b[3] <= a[1])

/**
 * A uniform-grid spatial index of boxed items, so a search for what a shape lands on looks only at what is near it.
 * An item with a (convex) shape is filed under the cells its shape meets, not every cell of its box, so a long
 * diagonal pipe is not found all across the area it spans. Callers only count or sum what is found, so items come
 * back in no particular order.
 */
export class BoxIndex<T extends { box: Rect; poly?: Poly }> {
  readonly items: T[] = []
  private cells = new Map<number, number[]>()
  /** Items too large to bucket usefully; always checked. */
  private large: number[] = []
  private seen = new Uint32Array(64)
  /** Every item's box, four numbers each, in order. */
  private boxes = new Float64Array(256)
  private stamp = 0
  constructor(private size = 32) {}
  private range(box: Rect) {
    const s = this.size, c = (v: number) => Math.max(-32768, Math.min(32767, Math.floor(v / s)))
    return [c(box[0]), c(box[1]), c(box[2]), c(box[3])]
  }
  add(item: T) {
    const i = this.items.push(item) - 1, [x0, y0, x1, y1] = this.range(item.box)
    if (this.boxes.length < 4 * (i + 1)) { const grown = new Float64Array(8 * (i + 1)); grown.set(this.boxes); this.boxes = grown }
    this.boxes.set(item.box, 4 * i)
    if (!(x1 >= x0 && y1 >= y0)) return
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1024) { this.large.push(i); return }
    const s = this.size, shape = item.poly && item.poly.length > 2 && (x1 - x0 + 1) * (y1 - y0 + 1) > 4 ? item.poly : undefined
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (shape && clearOfCell(shape, x * s, y * s, (x + 1) * s, (y + 1) * s)) continue
      const key = (x + 32768) * 65536 + (y + 32768), list = this.cells.get(key)
      if (list) list.push(i)
      else this.cells.set(key, [i])
    }
  }
  /** Items whose boxes meet `box`, and whose shapes may (in no particular order). */
  near(box: Rect): T[] {
    const found: T[] = []
    this.each(box, o => { found.push(o) })
    return found
  }
  /**
   * Visits the items whose boxes meet `box` (in no particular order), without collecting them; a visit that returns
   * true stops the search.
   */
  each(box: Rect, visit: (item: T) => boolean | void): void {
    const items = this.items, n = items.length
    if (this.seen.length < n) { const grown = new Uint32Array(n * 2); grown.set(this.seen); this.seen = grown }
    if (++this.stamp === 0xffffffff) { this.seen.fill(0); this.stamp = 1 }
    const s = this.size, seen = this.seen, stamp = this.stamp, f = this.boxes
    const bx0 = box[0], by0 = box[1], bx1 = box[2], by1 = box[3]
    const x0 = Math.max(-32768, Math.floor(bx0 / s)), y0 = Math.max(-32768, Math.floor(by0 / s))
    const x1 = Math.min(32767, Math.floor(bx1 / s)), y1 = Math.min(32767, Math.floor(by1 / s))
    // A box over more cells than are filled is cheaper to test against every item.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      for (let i = 0, j = 0; i < n; i++, j += 4)
        if (!(bx0 >= f[j + 2] || bx1 <= f[j] || by0 >= f[j + 3] || by1 <= f[j + 1]) && visit(items[i])) return
      return
    }
    const lists = [this.large]
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const list = this.cells.get((x + 32768) * 65536 + (y + 32768))
      if (list) lists.push(list)
    }
    for (const list of lists) for (let k = 0; k < list.length; k++) {
      const i = list[k]
      if (seen[i] === stamp) continue
      seen[i] = stamp
      const j = i * 4
      if (bx0 >= f[j + 2] || bx1 <= f[j] || by0 >= f[j + 3] || by1 <= f[j + 1]) continue
      if (visit(items[i])) return
    }
  }
}

/**
 * Whether a convex polygon is clearly apart from a grid cell (by more than rounding): some edge of the polygon has the
 * whole cell beyond it. The cell's own axes are not tested; it is taken from the polygon's box.
 */
function clearOfCell(poly: Poly, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[i + 1 === n ? 0 : i + 1], ax = q[1] - p[1], ay = p[0] - q[0], l = Math.hypot(ax, ay)
    if (l === 0) continue
    let lo = Infinity, hi = -Infinity
    for (const v of poly) { const d = v[0] * ax + v[1] * ay; if (d < lo) lo = d; if (d > hi) hi = d }
    const c = [x0 * ax + y0 * ay, x1 * ax + y0 * ay, x1 * ax + y1 * ay, x0 * ax + y1 * ay]
    const gap = 1e-6 * l
    if (Math.min(...c) > hi + gap || Math.max(...c) < lo - gap) return true
  }
  return false
}

/**
 * Separating-axis overlap test for convex polygons (a 2-point polygon is a segment). Shapes that only touch do not
 * overlap. Axes are left unnormalised: the separation test is the same at any positive scale.
 */
export function overlaps(a: Poly, b: Poly): boolean {
  return !separates(a, a, b, axesOf(a)) && !separates(b, a, b, axesOf(b))
}
/**
 * How many of a polygon's edges give distinct separating axes: two for a parallelogram (rectangles, thickened
 * segments, lettering boxes), whose opposite edges are parallel, else one per edge.
 */
function axesOf(poly: Poly): number {
  if (poly.length !== 4) return poly.length
  const [p, q, r, s] = poly
  return q[0] - p[0] === r[0] - s[0] && q[1] - p[1] === r[1] - s[1] ? 2 : 4
}
/** Whether a polygon is a rectangle with its edges along the page axes. */
function aligned(poly: Poly): boolean {
  if (poly.length !== 4) return false
  for (let i = 0; i < 4; i++) { const p = poly[i], q = poly[(i + 1) % 4]; if (p[0] !== q[0] && p[1] !== q[1]) return false }
  return true
}
/**
 * A convex polygon's distinct edge normals (unnormalised) with its own extent along each, so testing it against many
 * shapes projects only the other shape.
 */
interface Projection { axes: number[]; lo: number[]; hi: number[] }
function projection(poly: Poly): Projection {
  const out: Projection = { axes: [], lo: [], hi: [] }
  for (let i = 0, n = poly.length, k = axesOf(poly); i < k; i++) {
    const p = poly[i], q = poly[i + 1 === n ? 0 : i + 1], ax = q[1] - p[1], ay = p[0] - q[0]
    if (ax === 0 && ay === 0) continue
    let lo = Infinity, hi = -Infinity
    for (const v of poly) { const d = v[0] * ax + v[1] * ay; if (d < lo) lo = d; if (d > hi) hi = d }
    out.axes.push(ax, ay); out.lo.push(lo); out.hi.push(hi)
  }
  return out
}
/** Whether one of a projected polygon's own axes separates it from `other` (as `separates` would find). */
function apart(own: Projection, other: Poly): boolean {
  const { axes, lo, hi } = own, n = other.length
  for (let i = 0; i < lo.length; i++) {
    const ax = axes[2 * i], ay = axes[2 * i + 1]
    let o0 = Infinity, o1 = -Infinity
    for (let k = 0; k < n; k++) { const v = other[k], d = v[0] * ax + v[1] * ay; if (d < o0) o0 = d; if (d > o1) o1 = d }
    if (hi[i] <= o0 || o1 <= lo[i]) return true
  }
  return false
}
/** Whether some edge normal of `edges` (of its first `axes` edges) separates `a` from `b`. */
function separates(edges: Poly, a: Poly, b: Poly, axes = edges.length): boolean {
  for (let i = 0, n = edges.length; i < axes; i++) {
    const p = edges[i], q = edges[i + 1 === n ? 0 : i + 1], ax = q[1] - p[1], ay = p[0] - q[0]
    if (ax === 0 && ay === 0) continue
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    for (const v of a) { const d = v[0] * ax + v[1] * ay; if (d < a0) a0 = d; if (d > a1) a1 = d }
    for (const v of b) { const d = v[0] * ax + v[1] * ay; if (d < b0) b0 = d; if (d > b1) b1 = d }
    if (a1 <= b0 || b1 <= a0) return true
  }
  return false
}
export const rectPoly = (x0: number, y0: number, x1: number, y1: number): Poly => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
/** A segment thickened into a thin rectangle. */
export function segmentPoly(a: Point, b: Point, pad = 1): Poly {
  const u = unit2(sub2(b, a)), n = scale2(left2(u), pad), e = scale2(u, pad)
  return [add2(sub2(a, e), n), add2(add2(b, e), n), sub2(add2(b, e), n), sub2(sub2(a, e), n)]
}
/** The parallelogram covered by a (multi-line) text primitive, padded. */
export function textPoly(at: Point, text: string, size: number, rotation = 0, oblique = 0, anchor: 'start' | 'middle' | 'end' = 'start', pad = 1.5, factor = 1): Poly {
  const lines = text.split('\n'), width = Math.max(...lines.map(l => measureText(l, size, factor)))
  const below = (lines.length - 1) * size * LINE_SPACING
  const x0 = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0
  const r = rotation * Math.PI / 180, slant = Math.tan(oblique * Math.PI / 180)
  const local = (x: number, y: number): Point => {
    // y is up from the baseline here; oblique leans uprights right before the rotation.
    const sx = x + y * slant
    return [at[0] + sx * Math.cos(r) - y * Math.sin(r), at[1] - sx * Math.sin(r) - y * Math.cos(r)]
  }
  return [local(x0 - pad, -below - pad - size * 0.3), local(x0 + width + pad, -below - pad - size * 0.3), local(x0 + width + pad, size + pad), local(x0 - pad, size + pad)]
}

/** What overlapping a kind of occupant costs a label: text collisions are worst, crossing thin lines is mild. */
const kindCost = (kind: string) => kind === 'text' || kind === 'symbol' || kind === 'tag' ? 100 : kind === 'pipe' ? 60 : 3
const NO_WEIGHTS: Partial<Record<string, number>> = {}
/** Grid cell of the placement index, in sheet units. */
const CELL = 32
/** Items over more cells than this are kept apart from the grid and always checked. */
const LARGE_CELLS = 1024
const cellKey = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768)
const cellOf = (v: number) => Math.max(-32768, Math.min(32767, Math.floor(v / CELL)))

/**
 * Everything already drawn in the model area, so each new label goes where it overlaps nothing.
 *
 * Label placement asks this index tens of thousands of times a sheet, so it keeps what each test reads in flat arrays:
 * every occupant's box, kind, its outline's points and (once first needed) its edge axes and its own extent along
 * each. Occupants are filed under the grid cells their outline meets, and a long or slanted shape being tested looks
 * only in the cells it meets, so a diagonal leader is not tested against everything beside it. A shape overlaps an
 * occupant exactly as `overlaps` finds (shapes that only touch do not), and costs are sums of whole numbers, so the
 * order occupants are met in never changes a result.
 */
export class Placement {
  /** The labels being drawn, innermost last; room reserved for them is theirs to take. */
  labels: string[] = []
  private keepOut: Poly[]
  private occupants: Occupant[] = []
  /** Four numbers per occupant: its box. */
  private boxes = new Float64Array(1024)
  /** Per occupant: its kind's number, whether it is a page-aligned rectangle, and whether it reserves room. */
  private kinds = new Uint16Array(256)
  private square = new Uint8Array(256)
  private reserved = new Uint8Array(256)
  /** Per occupant with at most four points: their coordinates, eight numbers. */
  private points = new Float64Array(2048)
  private counts = new Uint8Array(256)
  /** Per occupant: up to four edge axes with its extent along each (four numbers an axis), once found. */
  private axes = new Float64Array(4096)
  /** Axes found per occupant, plus one; zero until they are found. */
  private axisCounts = new Uint8Array(256)
  private kindIds = new Map<string, number>()
  private kindNames: string[] = []
  /**
   * The grid, in two tiers: occupants that cost a label much to overlap (lettering, symbols, tags, pipe), then the
   * rest (thin lines). A search that only asks whether a spot costs more than a bound meets the costly ones first.
   */
  private tiers = [new Map<number, number[]>(), new Map<number, number[]>()]
  /** Occupants too large to bucket usefully, by tier; always checked. */
  private large: number[][] = [[], []]
  private seen = new Uint32Array(256)
  private stamp = 0
  /** The shape being tested: its points, box, whether it is page-aligned, and its own axes once found. */
  private q = { n: 0, xs: new Float64Array(16), ys: new Float64Array(16), box: [0, 0, 0, 0] as Rect, square: false, axes: 0, sat: new Float64Array(64) }
  constructor(public bounds: Rect, public exclusions: Rect[] = []) { this.keepOut = exclusions.map(e => rectPoly(...e)) }
  /** Every occupant's content (see `contentOf`), in the order filed: what a later drawing compares its own with. */
  private contents: string[] = []
  /** The searches made, for a later drawing to use again (see `recall`). */
  private searches = new Map<string, Recalled>()
  private occurrences = new Map<string, number>()
  /** The drawing before's trail, and how what is filed now differs from what was filed then up to `upTo` of its own. */
  private before?: SearchTrail
  private upTo = 0
  private difference = new Map<string, number>()
  private differing = new Map<string, Rect>()
  /**
   * Compares this placement with an earlier drawing's (`trail()` of its placement): a search asked for again with the
   * same inputs, where nothing that its candidates could meet differs from what that drawing had filed when it searched,
   * finds what it found then, and is not made again.
   */
  follow(before: SearchTrail | undefined) {
    this.before = before && before.setting === this.setting() ? before : undefined
  }
  /** What a later drawing needs to use this placement's searches again. */
  trail(): SearchTrail {
    // A copy as it stands: what is filed or searched later (a margin callout) is not part of what the drawing searched with.
    return { setting: this.setting(), contents: this.contents.slice(), boxes: this.boxes.slice(0, 4 * this.occupants.length), searches: new Map(this.searches) }
  }
  private setting() { return JSON.stringify([this.bounds, this.exclusions]) }
  private differ(content: string, by: number, box: ArrayLike<number>) {
    const n = (this.difference.get(content) ?? 0) + by
    if (n) { this.difference.set(content, n); if (!this.differing.has(content)) this.differing.set(content, [box[0], box[1], box[2], box[3]]) }
    else { this.difference.delete(content); this.differing.delete(content) }
  }
  /**
   * The result of a search named `name` (made once per name and occurrence) whose result depends only on `inputs` and
   * on the occupants whose boxes meet `region`: what the earlier drawing found, when it searched with the same inputs
   * and what it had filed then meets `region` exactly as what is filed now does; otherwise searched now.
   */
  recall<T>(name: string, inputs: string, region: Rect, search: () => T, again?: (old: T, changed: Rect[]) => T | undefined, copy: (value: T) => T = v => v): T {
    const seen = this.occurrences.get(name) ?? 0
    this.occurrences.set(name, seen + 1)
    const id = seen ? `${name}#${seen}` : name, at = this.contents.length
    let value: T | undefined, found = false
    const old = this.before?.searches.get(id)
    if (old && old.inputs === inputs) {
      // Bring the comparison to what the earlier drawing had filed when it searched.
      const { contents, boxes } = this.before!
      for (; this.upTo < old.at; this.upTo++) this.differ(contents[this.upTo], -1, boxes.subarray(4 * this.upTo, 4 * this.upTo + 4))
      for (; this.upTo > old.at; this.upTo--) this.differ(contents[this.upTo - 1], 1, boxes.subarray(4 * this.upTo - 4, 4 * this.upTo))
      if (this.differing.size <= DIFFERING_COMPARED) {
        const changed: Rect[] = []
        for (const b of this.differing.values()) if (!(b[0] > region[2] || b[2] < region[0] || b[1] > region[3] || b[3] < region[1])) changed.push(b)
        // Nothing beside it changed: found where it was. Otherwise the search may weigh again only what changed sees.
        if (!changed.length) { value = copy(old.value as T); found = true }
        else if (again && changed.length <= CHANGED_REWEIGHED) { value = again(copy(old.value as T), changed); found = value !== undefined }
      }
    }
    if (!found) value = search()
    // Kept as a copy, so nothing done with the value returned (it is drawn with) can change what a later drawing finds.
    this.searches.set(id, { at, inputs, value: copy(value as T) })
    return value as T
  }
  /** Everything drawn or reserved so far, in order. */
  get items(): readonly Occupant[] { return this.occupants }
  add(poly: Poly, kind: string, owner?: string) {
    if (poly.length) this.file({ poly, kind, owner, box: bbox(poly), aligned: aligned(poly) })
  }
  /** Keeps room for a label drawn later, so labels drawn before it go elsewhere. */
  reserve(poly: Poly, label: string) {
    if (poly.length) this.file({ poly, kind: 'text', label, box: bbox(poly), aligned: aligned(poly) })
  }
  addSegment(a: Point, b: Point, kind: string, owner?: string, pad = 1) { this.add(segmentPoly(a, b, pad), kind, owner) }
  private kindId(kind: string) {
    let id = this.kindIds.get(kind)
    if (id == null) { this.kindIds.set(kind, id = this.kindNames.length); this.kindNames.push(kind) }
    return id
  }
  private file(o: Occupant) {
    const i = this.occupants.push(o) - 1
    if (i >= this.kinds.length) this.grow(2 * this.kinds.length)
    this.boxes.set(o.box, 4 * i)
    const content = contentOf(o)
    this.contents.push(content)
    if (this.before) this.differ(content, 1, o.box)
    this.kinds[i] = this.kindId(o.kind)
    this.square[i] = o.aligned ? 1 : 0
    this.reserved[i] = o.label ? 1 : 0
    const n = o.poly.length
    if (n <= 4) {
      this.counts[i] = n
      for (let k = 0; k < n; k++) { this.points[8 * i + 2 * k] = o.poly[k][0]; this.points[8 * i + 2 * k + 1] = o.poly[k][1] }
    } else this.counts[i] = 0
    const [x0, y0, x1, y1] = [cellOf(o.box[0]), cellOf(o.box[1]), cellOf(o.box[2]), cellOf(o.box[3])]
    if (!(x1 >= x0 && y1 >= y0)) return
    const tier = kindCost(o.kind) >= 60 ? 0 : 1, cells = this.tiers[tier]
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > LARGE_CELLS) { this.large[tier].push(i); return }
    const shape = o.poly.length > 2 && (x1 - x0 + 1) * (y1 - y0 + 1) > 4 ? o.poly : undefined
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (shape && clearOfCell(shape, x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL)) continue
      const key = cellKey(x, y), list = cells.get(key)
      if (list) list.push(i)
      else cells.set(key, [i])
    }
  }
  private grow(size: number) {
    const more = <T extends Float64Array | Uint8Array | Uint16Array | Uint32Array>(a: T, per: number): T => { const b = new (a.constructor as new (n: number) => T)(size * per); b.set(a); return b }
    this.boxes = more(this.boxes, 4); this.kinds = more(this.kinds, 1); this.square = more(this.square, 1); this.reserved = more(this.reserved, 1)
    this.points = more(this.points, 8); this.counts = more(this.counts, 1); this.axes = more(this.axes, 16); this.axisCounts = more(this.axisCounts, 1)
    this.seen = more(this.seen, 1)
  }
  /** Whether a shape is inside the model area and clear of the title block, BOM and notes. */
  inside(poly: Poly): boolean {
    const [x0, y0, x1, y1] = bbox(poly), [bx0, by0, bx1, by1] = this.bounds
    if (x0 < bx0 || y0 < by0 || x1 > bx1 || y1 > by1) return false
    return !this.exclusions.some((e, i) => boxesMeet([x0, y0, x1, y1], e) && overlaps(poly, this.keepOut[i]))
  }
  /** Takes a shape to test: its points, box and whether it is a page-aligned rectangle. */
  private load(poly: Poly) {
    const q = this.q, n = poly.length
    if (q.xs.length < n) { q.xs = new Float64Array(2 * n); q.ys = new Float64Array(2 * n) }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let k = 0; k < n; k++) {
      const x = poly[k][0], y = poly[k][1]
      q.xs[k] = x; q.ys[k] = y
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
    q.n = n; q.box[0] = x0; q.box[1] = y0; q.box[2] = x1; q.box[3] = y1
    q.square = aligned(poly); q.axes = -1
  }
  /** The tested shape's own distinct edge axes with its extent along each (as `projection` finds them). */
  private queryAxes() {
    const q = this.q
    if (q.axes >= 0) return q.axes
    const { xs, ys, n } = q, k = axesCount(xs, ys, n)
    if (q.sat.length < 4 * k) q.sat = new Float64Array(4 * k)
    let m = 0
    for (let i = 0; i < k; i++) {
      const j = i + 1 === n ? 0 : i + 1, ax = ys[j] - ys[i], ay = xs[i] - xs[j]
      if (ax === 0 && ay === 0) continue
      let lo = Infinity, hi = -Infinity
      for (let v = 0; v < n; v++) { const d = xs[v] * ax + ys[v] * ay; if (d < lo) lo = d; if (d > hi) hi = d }
      q.sat[4 * m] = ax; q.sat[4 * m + 1] = ay; q.sat[4 * m + 2] = lo; q.sat[4 * m + 3] = hi; m++
    }
    return q.axes = m
  }
  /** Finds an occupant's own edge axes with its extent along each, once. */
  private occupantAxes(i: number) {
    const o = this.occupants[i]
    o.sat ??= projection(o.poly)
    const count = o.sat.lo.length
    if (count <= 4) {
      for (let k = 0; k < count; k++) {
        this.axes[16 * i + 4 * k] = o.sat.axes[2 * k]; this.axes[16 * i + 4 * k + 1] = o.sat.axes[2 * k + 1]
        this.axes[16 * i + 4 * k + 2] = o.sat.lo[k]; this.axes[16 * i + 4 * k + 3] = o.sat.hi[k]
      }
    }
    this.axisCounts[i] = count + 1
  }
  /** Whether the shape being tested overlaps occupant `i`, as `overlaps` finds (shapes that only touch do not). */
  private meets(i: number): boolean {
    const q = this.q
    // Boxes that meet are already apart on neither page axis, which is all an axis-aligned rectangle's edges test.
    if (q.square && this.square[i]) return true
    const { xs, ys, n } = q
    if (!q.square) {
      // One of the shape's own axes keeps the occupant apart.
      const axes = this.queryAxes(), sat = q.sat, count = this.counts[i]
      for (let a = 0; a < axes; a++) {
        const ax = sat[4 * a], ay = sat[4 * a + 1], lo = sat[4 * a + 2], hi = sat[4 * a + 3]
        let o0 = Infinity, o1 = -Infinity
        if (count) {
          const p = this.points, base = 8 * i
          for (let k = 0; k < count; k++) { const d = p[base + 2 * k] * ax + p[base + 2 * k + 1] * ay; if (d < o0) o0 = d; if (d > o1) o1 = d }
        } else for (const v of this.occupants[i].poly) { const d = v[0] * ax + v[1] * ay; if (d < o0) o0 = d; if (d > o1) o1 = d }
        if (hi <= o0 || o1 <= lo) return false
      }
    }
    if (this.square[i]) return true
    // One of the occupant's own axes keeps the shape apart.
    if (!this.axisCounts[i]) this.occupantAxes(i)
    const count = this.axisCounts[i] - 1
    if (count > 4) return !apart(this.occupants[i].sat!, polyOf(xs, ys, n))
    const s = this.axes, base = 16 * i
    if (q.square) {
      // A page-aligned rectangle's extent along an axis is at the corners its sides give: the same sums of the same
      // products as projecting each corner (rounding never reorders them), from two of its four corners.
      const [x0, y0, x1, y1] = q.box
      for (let a = 0; a < count; a++) {
        const ax = s[base + 4 * a], ay = s[base + 4 * a + 1], lo = s[base + 4 * a + 2], hi = s[base + 4 * a + 3]
        const o0 = (ax >= 0 ? x0 * ax : x1 * ax) + (ay >= 0 ? y0 * ay : y1 * ay), o1 = (ax >= 0 ? x1 * ax : x0 * ax) + (ay >= 0 ? y1 * ay : y0 * ay)
        if (hi <= o0 || o1 <= lo) return false
      }
      return true
    }
    for (let a = 0; a < count; a++) {
      const ax = s[base + 4 * a], ay = s[base + 4 * a + 1], lo = s[base + 4 * a + 2], hi = s[base + 4 * a + 3]
      let o0 = Infinity, o1 = -Infinity
      for (let k = 0; k < n; k++) { const d = xs[k] * ax + ys[k] * ay; if (d < o0) o0 = d; if (d > o1) o1 = d }
      if (hi <= o0 || o1 <= lo) return false
    }
    return true
  }
  /**
   * Visits the occupants the loaded shape may overlap (their boxes meet its box, and, for a shape over several cells,
   * they are filed in a cell it meets), each once and in no particular order; a visit that returns true stops it.
   */
  private scan(poly: Poly, visit: (i: number) => boolean): void {
    const n = this.occupants.length, q = this.q, f = this.boxes
    if (++this.stamp === 0xffffffff) { this.seen.fill(0); this.stamp = 1 }
    const seen = this.seen, stamp = this.stamp
    const bx0 = q.box[0], by0 = q.box[1], bx1 = q.box[2], by1 = q.box[3]
    const x0 = cellOf(bx0), y0 = cellOf(by0), x1 = cellOf(bx1), y1 = cellOf(by1)
    const span = (x1 - x0 + 1) * (y1 - y0 + 1)
    // A box over more cells than are filled is cheaper to test against every occupant.
    if (span > this.tiers[0].size + this.tiers[1].size) {
      for (let i = 0, j = 0; i < n; i++, j += 4)
        if (!(bx0 >= f[j + 2] || bx1 <= f[j] || by0 >= f[j + 3] || by1 <= f[j + 1]) && visit(i)) return
      return
    }
    const test = (list: number[]) => {
      for (let k = 0; k < list.length; k++) {
        const i = list[k]
        if (seen[i] === stamp) continue
        seen[i] = stamp
        const j = i * 4
        if (bx0 >= f[j + 2] || bx1 <= f[j] || by0 >= f[j + 3] || by1 <= f[j + 1]) continue
        if (visit(i)) return true
      }
      return false
    }
    // A shape over several cells looks only in those its outline meets (an occupant it overlaps shares a point with it,
    // in a cell both meet).
    const shape = poly.length > 1 && span > 4 && !q.square ? poly : undefined
    let open: Uint8Array | undefined
    if (shape) {
      open = new Uint8Array(span)
      for (let x = x0, c = 0; x <= x1; x++) for (let y = y0; y <= y1; y++, c++) open[c] = clearOfCell(shape, x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL) ? 0 : 1
    }
    for (let tier = 0; tier < 2; tier++) {
      const large = this.large[tier], cells = this.tiers[tier]
      if (large.length && test(large)) return
      for (let x = x0, c = 0; x <= x1; x++) for (let y = y0; y <= y1; y++, c++) {
        if (open && !open[c]) continue
        const list = cells.get(cellKey(x, y))
        if (list && test(list)) return
      }
    }
  }
  /** Whether occupant `i` is excused from the loaded shape: room reserved for a label being drawn, or by the filter. */
  private excused(i: number, excuse?: (o: Occupant) => boolean) {
    if (this.reserved[i] && this.labels.includes(this.occupants[i].label!)) return true
    return !!excuse && excuse(this.occupants[i])
  }
  /** Occupants a shape would overlap, ignoring those the filter excuses (e.g. its own item), in the order filed. */
  hits(poly: Poly, excuse?: (o: Occupant) => boolean): Occupant[] {
    const found: number[] = []
    this.load(poly)
    this.scan(poly, i => { if (!this.excused(i, excuse) && this.meets(i)) found.push(i); return false })
    return found.sort((a, b) => a - b).map(i => this.occupants[i])
  }
  free(poly: Poly, excuse?: (o: Occupant) => boolean) {
    if (!this.inside(poly)) return false
    let clear = true
    this.load(poly)
    this.scan(poly, i => { if (!this.excused(i, excuse) && this.meets(i)) clear = false; return !clear })
    return clear
  }
  /**
   * Overlap cost for ranking candidate positions: text collisions are worst, crossing thin lines is mild. Once the cost
   * passes `limit` it is returned as found, more than `limit`: a search that only wants a better candidate stops there.
   */
  cost(poly: Poly, excuse?: (o: Occupant) => boolean, weights: Partial<Record<Occupant['kind'], number>> = NO_WEIGHTS, limit = Infinity): number {
    let cost = this.inside(poly) ? 0 : 1000
    if (cost > limit) return cost
    // What overlapping each kind costs, with the weights asked for.
    const table = this.kindNames.map(kind => weights[kind] ?? kindCost(kind))
    const kinds = this.kinds, reserved = this.reserved
    this.load(poly)
    // Thin dimension and leader lines are broken around text afterwards, so crossing one costs little.
    this.scan(poly, i => {
      if (reserved[i] && this.labels.includes(this.occupants[i].label!)) return false
      if (excuse && excuse(this.occupants[i])) return false
      if (!this.meets(i)) return false
      cost += table[kinds[i]]
      return cost > limit
    })
    return cost
  }
}
/** A search made while placing a drawing's labels, and what it found. */
interface Recalled { at: number; inputs: string; value: unknown }
/** What a drawing's placement leaves for the next drawing on the same sheet to compare itself with. */
export interface SearchTrail { setting: string; contents: string[]; boxes: Float64Array; searches: Map<string, Recalled> }
/** Past this many changed occupants beside a search, it is made again rather than weighed again in part. */
const CHANGED_REWEIGHED = 64
/** Past this many occupants differing from the drawing before, searches are made again rather than compared. */
const DIFFERING_COMPARED = 4000
const bits = new Float64Array(1), words = new Uint16Array(bits.buffer)
/**
 * Everything a placement test reads of an occupant, exactly: its kind, owner, the label it reserves room for and its
 * outline's coordinates to the bit (each number as its four 16-bit words).
 */
function contentOf(o: Occupant): string {
  const codes: number[] = []
  for (const p of o.poly) for (const v of p) { bits[0] = v; codes.push(words[0], words[1], words[2], words[3]) }
  return `${o.kind}\u0000${o.owner ?? ''}\u0000${o.label ?? ''}\u0000${String.fromCharCode(...codes)}`
}
/** How many of a polygon's edges give distinct separating axes (as `axesOf` counts them). */
function axesCount(xs: Float64Array, ys: Float64Array, n: number): number {
  if (n !== 4) return n
  return xs[1] - xs[0] === xs[2] - xs[3] && ys[1] - ys[0] === ys[2] - ys[3] ? 2 : 4
}
const polyOf = (xs: Float64Array, ys: Float64Array, n: number): Poly => Array.from({ length: n }, (_, k) => [xs[k], ys[k]] as Point)

/** The parts of segment a–b outside a convex polygon (Cyrus–Beck). */
export function clipOutside(a: Point, b: Point, poly: Poly): Array<[Point, Point]> {
  const d = sub2(b, a)
  let enter = 0, leave = 1
  // Orientation decides which side of each edge is inside.
  let area = 0
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1] }
  const sign = area >= 0 ? 1 : -1
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], e = sub2(q, p)
    const n: Point = [e[1] * sign, -e[0] * sign]
    const num = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1], den = d[0] * n[0] + d[1] * n[1]
    if (Math.abs(den) < 1e-12) { if (num < 0) return [[a, b]]; continue }
    const t = num / den
    if (den < 0) enter = Math.max(enter, t)
    else leave = Math.min(leave, t)
    if (enter >= leave) return [[a, b]]
  }
  const at = (t: number): Point => [a[0] + d[0] * t, a[1] + d[1] * t], out: Array<[Point, Point]> = []
  if (enter > 1e-6) out.push([a, at(enter)])
  if (leave < 1 - 1e-6) out.push([at(leave), b])
  return out
}
