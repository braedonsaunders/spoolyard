/**
 * Printed paper. Sheets are laid out 850 sheet units tall whatever the paper, so a size drafted in paper millimetres
 * (lettering, symbols, line weights) is converted to sheet units for the chosen paper.
 */
export type PaperSize = 'letter' | 'tabloid' | 'a3' | 'a4'
/** Landscape paper, width by height in millimetres. */
export const PAPER_MM: Record<PaperSize, { width: number; height: number }> = {
  letter: { width: 279.4, height: 215.9 },
  tabloid: { width: 431.8, height: 279.4 },
  a3: { width: 420, height: 297 },
  a4: { width: 297, height: 210 }
}
/** Height of every sheet in sheet units. */
export const SHEET_UNITS_HIGH = 850
/** Sheet units per printed millimetre on the paper. */
export const unitsPerMm = (paper: PaperSize = 'tabloid', sheetHeight = SHEET_UNITS_HIGH) => sheetHeight / PAPER_MM[paper].height
/** A printed length in millimetres as sheet units on the paper. */
export const paperMm = (mm: number, paper?: PaperSize, sheetHeight?: number) => mm * unitsPerMm(paper, sheetHeight)
/** A printed length in points (1/72 in) as sheet units on the paper. */
export const paperPt = (pt: number, paper?: PaperSize, sheetHeight?: number) => paperMm(pt * 25.4 / 72, paper, sheetHeight)
