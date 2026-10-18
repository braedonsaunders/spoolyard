import { unitsPerMm, type PaperSize } from './paper'

/**
 * Pen widths of the printed outputs in paper millimetres. A drawing's weights (`Drawing.weights`, `layerWeights`) and
 * a primitive's own `weight` are stroke widths in sheet units of the drawing's own paper (sheets are 850 units tall
 * whatever the paper), so a weight is the printed pen of that width on that paper.
 */
export const penMm = (weight: number, paper?: PaperSize) => weight / unitsPerMm(paper)
/** AutoCAD's standard lineweights, in 1/100 mm. */
export const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211] as const
/** The nearest standard lineweight (1/100 mm) to a pen width in millimetres. */
export const lineweight = (mm: number) =>
  LINEWEIGHTS.reduce<number>((best, v) => (Math.abs(v - mm * 100) < Math.abs(best - mm * 100) ? v : best), 0)
