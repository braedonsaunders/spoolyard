import type { Point } from '../drawing'
import type { PipeRun } from '../model'

/** A component held this close to its pipe (paper units) was meant to sit on it. */
const NEAR = 4

/**
 * Paper positions held by hand (or registered from an issued sheet) are rarely exactly isometric: a fraction of a
 * degree off, which shows against the isometric grid and in every leg's lettering. Rebuild them along the drawing's
 * own pipe directions: each straight pipe keeps the direction the layout gives it and takes the length its held ends
 * ask for, so the sheet keeps the drafter's proportions while every pipe runs true to the isometric axes. A component
 * held on a pipe (an olet, say) is put back on it before the branch it starts is measured from it.
 *
 * `automatic` is the layout's own positions (true directions), `desired` the positions asked for (held, else
 * automatic), `straight` tells straight pipes from rolling offsets, and `hosts` the pipe
 * each held in-line component sits on. `folded` lists held ends that would fold their pipe back on itself: they are
 * drawn at the layout's length instead, and the drawing reports them.
 */
export function squarePaper(runs: PipeRun[], automatic: Map<string, Point>, desired: Map<string, Point>, straight: (run: PipeRun) => boolean,
  held: Set<string>, hosts: Map<string, PipeRun> = new Map()): { positions: Map<string, Point>; folded: string[] } {
  const out = new Map(desired), folded: string[] = []
  const usable = runs.filter(r => automatic.has(r.from) && automatic.has(r.to) && desired.has(r.from) && desired.has(r.to))
  if (!held.size || !usable.length) return { positions: out, folded }
  const next = new Map<string, PipeRun[]>()
  for (const r of usable) for (const id of [r.from, r.to]) next.set(id, [...(next.get(id) ?? []), r])
  const hosted = (id: string) => { const h = hosts.get(id); return h && out.has(h.from) && out.has(h.to) ? h : undefined }
  const placed = new Set<string>(), queue: string[] = []
  const place = (id: string, at?: Point) => { if (at) out.set(id, at); placed.add(id); queue.push(id) }
  /** Puts held components on pipes whose ends are now both placed. */
  const settle = () => {
    for (const [id, host] of hosts) {
      if (placed.has(id) || !out.has(id) || !placed.has(host.from) || !placed.has(host.to)) continue
      const from = out.get(host.from)!, to = out.get(host.to)!, at = out.get(id)!, d: Point = [to[0] - from[0], to[1] - from[1]]
      const squared = d[0] * d[0] + d[1] * d[1], t = squared ? ((at[0] - from[0]) * d[0] + (at[1] - from[1]) * d[1]) / squared : -1
      const on: Point = [from[0] + d[0] * t, from[1] + d[1] * t]
      place(id, t >= 0 && t <= 1 && Math.hypot(at[0] - on[0], at[1] - on[1]) < NEAR ? on : undefined)
    }
  }
  // Start from the held end with most pipes, so the rest of the sheet is measured outward from a fixed point.
  const roots = [...next.keys()].sort((a, b) => (+!!hosted(a) - +!!hosted(b)) || (+held.has(b) - +held.has(a)) || (next.get(b)!.length - next.get(a)!.length))
  for (const root of roots) {
    if (placed.has(root) || (hosted(root) && roots.some(r => !placed.has(r) && !hosted(r)))) continue
    place(root)
    while (queue.length) {
      const u = queue.shift()!
      for (const r of next.get(u) ?? []) {
        const v = r.from === u ? r.to : r.from
        // A component on a pipe is placed from that pipe, not from the branch it starts.
        if (placed.has(v) || hosted(v)) continue
        const at = out.get(u)!, ua = automatic.get(u)!, va = automatic.get(v)!
        const d: Point = [va[0] - ua[0], va[1] - ua[1]], length = Math.hypot(...d)
        const want = desired.get(v)!, dir: Point = length > 1e-9 ? [d[0] / length, d[1] / length] : [0, 0]
        const w: Point = [want[0] - at[0], want[1] - at[1]], along = w[0] * dir[0] + w[1] * dir[1]
        // A straight pipe is always drawn along its axis; where it is held only sets its length. One held on the wrong
        // side, which would fold it back on itself, keeps the layout's length.
        if (straight(r) && length > 1e-9) {
          if (!(along > 1e-6) && held.has(v)) folded.push(v)
          const l = along > 1e-6 ? along : length
          place(v, [at[0] + dir[0] * l, at[1] + dir[1] * l])
        } else place(v, held.has(v) ? undefined : [at[0] + d[0], at[1] + d[1]])
      }
      if (!queue.length) settle()
    }
  }
  return { positions: out, folded }
}
