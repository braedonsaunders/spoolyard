import type { Primitive } from '../drawing'
import { sheetInfoOf } from '../model'
import { measureText } from '../stroke-font'
import type { SheetFrameFn } from './render'

/** Interim sheet frame: border, bill of materials and drawing number, with the model area it leaves open. */
export const basicFrame: SheetFrameFn = ({ doc, spool, width, height, rows }) => {
  const out: Primitive[] = [], u = height / 11
  const line = (a: [number, number], b: [number, number], layer = 'BORDER', weight?: number) => out.push({ type: 'line', a, b, layer, ...(weight ? { weight } : {}) })
  const x0 = 0.55 * u, x1 = width - 0.55 * u, y0 = 0.35 * u, y1 = height - 0.33 * u, tb = height - 2.05 * u
  for (const [a, b] of [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]], [[x0, tb], [x1, tb]]] as Array<[[number, number], [number, number]]>) line(a, b)
  const bx = x1 - 5.4 * u, cols = [bx, bx + 0.6 * u, bx + 1.5 * u, bx + 2.1 * u, x1]
  let y = y0
  const T = 6.4
  out.push({ type: 'text', p: [(bx + x1) / 2, y + 0.16 * u], text: 'BILL OF MATERIALS', size: T * 0.85, layer: 'BOM', anchor: 'middle' })
  y += 0.23 * u
  line([bx, y], [x1, y], 'BOM')
  const header = ['ID', 'QTY', 'ND', 'DESCRIPTION']
  header.forEach((h, i) => out.push({ type: 'text', p: [(cols[i] + cols[i + 1]) / 2, y + 0.16 * u], text: h, size: T * 0.85, layer: 'BOM', anchor: 'middle' }))
  y += 0.23 * u
  line([bx, y], [x1, y], 'BOM')
  for (const row of rows) {
    const words = row.description.split(' '), lines: string[] = []
    for (const w of words) {
      const last = lines.at(-1)
      if (last != null && measureText(last + ' ' + w, T) < cols[4] - cols[3] - 8) lines[lines.length - 1] = last + ' ' + w
      else lines.push(w)
    }
    const h = Math.max(0.3, 0.1 + lines.length * 0.15) * u
    out.push({ type: 'text', p: [(cols[0] + cols[1]) / 2, y + h / 2 + T / 2], text: String(row.id), size: T, layer: 'BOM', anchor: 'middle' })
    out.push({ type: 'text', p: [(cols[1] + cols[2]) / 2, y + h / 2 + T / 2], text: row.qtyText, size: T, layer: 'BOM', anchor: 'middle' })
    out.push({ type: 'text', p: [(cols[2] + cols[3]) / 2, y + h / 2 + T / 2], text: row.nd, size: T, layer: 'BOM', anchor: 'middle' })
    lines.forEach((l, i) => out.push({ type: 'text', p: [cols[3] + 4, y + (h - lines.length * 0.15 * u) / 2 + (i + 1) * 0.15 * u - 2], text: l, size: T, layer: 'BOM' }))
    y += h
    line([bx, y], [x1, y], 'BOM')
  }
  for (const x of cols) line([x, y0 + 0.23 * u], [x, y], 'BOM')
  line([bx, y0], [bx, y0 + 0.23 * u], 'BOM')
  const info = sheetInfoOf(doc, spool)
  out.push({ type: 'text', p: [x1 - 2.5 * u, y1 - 0.3 * u], text: info.drawingNumber, size: 13, layer: 'TITLE', anchor: 'middle' })
  return { primitives: out, viewport: [x0 + 4, y0 + 4, x1 - 4, tb - 4], exclusions: [[bx, y0, x1, y], [x0, y0, x0 + 1.9 * u, y0 + 1.1 * u], [x1 - 5.6 * u, tb - 1.6 * u, x1, tb]] }
}
