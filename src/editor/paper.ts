import type { Point } from "../core/drawing";
import type { IsoDocument } from "../core/model";
import { PAPER_MM, SHEET_UNITS_HIGH } from "../core/paper";

/**
 * The printed sheet. Drawings are laid out in sheet units, 850 to the paper's height; the editor shows positions on
 * paper as a drafter measures them, in millimetres or inches from the sheet's lower-left corner, Y up, as AutoCAD's
 * paper space does.
 */
export type Paper = NonNullable<IsoDocument["paper"]>;
export const PAPERS: Array<{ value: Paper; label: string }> = [
  { value: "tabloid", label: "Tabloid (ANSI B) · 17 × 11 in" },
  { value: "letter", label: "Letter (ANSI A) · 11 × 8.5 in" },
  { value: "a3", label: "A3 · 420 × 297 mm" },
  { value: "a4", label: "A4 · 297 × 210 mm" },
];
const MM_PER_IN = 25.4;

export interface PaperUnits {
  /** Unit shown: millimetres on metric drawings, inches on imperial ones. */
  unit: "mm" | "in";
  /** Paper length (in `unit`) of a sheet-unit length. */
  length: (sheet: number) => number;
  /** Sheet-unit length of a paper length in `unit`. */
  sheet: (paper: number) => number;
  /** Paper point (from the lower-left corner, Y up) of a sheet point. */
  point: (p: Point) => Point;
  /** Sheet point of a paper point. */
  fromPoint: (p: Point) => Point;
  /** A paper length as typed and shown: 1 decimal in mm, 3 in inches. */
  text: (paper: number) => string;
  decimals: number;
}

/** Millimetres of paper per sheet unit. */
export const paperMmPerUnit = (paper: Paper | undefined) => PAPER_MM[paper ?? "tabloid"].height / SHEET_UNITS_HIGH;

export function paperUnits(doc: Pick<IsoDocument, "paper" | "units">): PaperUnits {
  const unit = doc.units === "mm" ? "mm" : "in";
  const k = paperMmPerUnit(doc.paper) / (unit === "mm" ? 1 : MM_PER_IN);
  const decimals = unit === "mm" ? 1 : 3;
  const round = (v: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;
  return {
    unit,
    decimals,
    length: (s) => s * k,
    sheet: (p) => p / k,
    point: ([x, y]) => [x * k, (SHEET_UNITS_HIGH - y) * k],
    fromPoint: ([x, y]) => [x / k, SHEET_UNITS_HIGH - y / k],
    text: (p) => String(round(p)),
  };
}
