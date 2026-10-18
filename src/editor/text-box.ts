import type { Point, Primitive } from "../core/drawing";
import { LINE_SPACING, measureText } from "../core/stroke-font";

export type TextPrimitive = Extract<Primitive, { type: "text" }>;

/**
 * The box a line of sheet lettering occupies before any rotation: measured with the ROMANS stroke font the CAD sheets
 * are lettered in. Sans lettering is set to the same advance in the editor, so it measures the same.
 */
export function textBox(p: TextPrimitive): { left: number; top: number; width: number; height: number } {
  const width = measureText(p.text, p.size, p.width), rows = p.text.split(/\r?\n/).length;
  const left = p.p[0] - width * (p.anchor === "middle" ? 0.5 : p.anchor === "end" ? 1 : 0);
  return { left, top: p.p[1] - p.size, width, height: p.size * (1 + (rows - 1) * LINE_SPACING) };
}
/** The corners of a text's box on the sheet, rotated with it about its anchor. */
export function textCorners(p: TextPrimitive, pad = 0): Point[] {
  const b = textBox(p), angle = (-(p.rotation ?? 0) * Math.PI) / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const corners: Point[] = [[b.left - pad, b.top - pad], [b.left + b.width + pad, b.top - pad], [b.left + b.width + pad, b.top + b.height + pad], [b.left - pad, b.top + b.height + pad]];
  return corners.map(([x, y]) => {
    const dx = x - p.p[0], dy = y - p.p[1];
    return [p.p[0] + dx * cos - dy * sin, p.p[1] + dx * sin + dy * cos];
  });
}
