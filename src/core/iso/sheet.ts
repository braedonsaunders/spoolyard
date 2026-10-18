import { classicSheet } from './classic-sheet'
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE, type SheetTemplate } from '../sheet-template'
import type { IsoDocument } from '../model'
import { templateSheet } from './template-sheet'
import type { SheetFrame, SheetFrameInput } from './sheet-frame'

export type { SheetFinish, SheetFrame, SheetFrameFn, SheetFrameInput, SheetNumbering, SheetRect, SheetRegions, SheetRow, SheetView } from './sheet-frame'
export { imageAspect, templateValues, wrapText } from './template-sheet'

/**
 * The template a production sheet is drawn with: the copy the drawing carries, the built-in it names, else the
 * built-in default. Drawings saved before templates were 'production' sheets on the default.
 */
export function sheetTemplateOf(doc: Pick<IsoDocument, 'sheetTemplate'>): SheetTemplate {
  const t = doc.sheetTemplate
  if (t && typeof t === 'object') return t
  return (typeof t === 'string' && BUILTIN_TEMPLATES[t]) || DEFAULT_TEMPLATE
}

/**
 * One spool's sheet frame: Spoolyard's classic paper, or a production sheet drawn from its title-block template,
 * with the model viewport and the areas the model must keep clear of.
 */
export function drawSheet(input: SheetFrameInput): SheetFrame {
  const { doc, spool, width, height, view = 'iso', rows } = input
  if (doc.sheetFormat !== 'production') return classicSheet(doc, spool, width, height, view, rows, input.viewNote, input)
  return templateSheet(input, sheetTemplateOf(doc))
}
