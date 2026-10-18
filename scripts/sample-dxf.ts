/**
 * Write sample DXF sheets (and, with --dwg, convert them with the bundled LibreDWG writer) for checking the CAD
 * output outside the browser: `pnpm exec tsx scripts/sample-dxf.ts /tmp/sample.dxf [--dwg]`.
 * The drawing is invented: a pipe, an elbow, a flanged gate valve and a boxed note.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { appendRun, insertComponent, newIso } from '../src/core/model.ts'
import { isometricDxf } from '../src/core/document.ts'

const out = process.argv[2] ?? 'sample.dxf'
const doc = newIso()
const elbow = appendRun(doc, null, [2000, 0, 0], 'CS40', 2, 'SP-1', 'L-100')
appendRun(doc, elbow.id, [0, 1500, 0], 'CS40', 2, 'SP-1', 'L-100')
insertComponent(doc, doc.runs[1].id, 'valve')
doc.sheetNotes = [{ id: 'note-1', spool: 'SP-1', text: 'FIELD VERIFY TIE-IN {EL. 100}', at: [300, 300], box: { at: [290, 285], width: 220, height: 24 }, color: '#ff0000' }]
const dxf = isometricDxf(doc)
writeFileSync(out, dxf)
console.log(`wrote ${out}`)
if (process.argv.includes('--dwg')) {
  const { writerCompatibleDxf } = await import('../public/dwg-export/dxf-compat.js')
  const createWriter = (await import('../public/dwg-export/dwg-export.js')).default as (o: object) => Promise<any>
  const errors: string[] = []
  const writer = await createWriter({ wasmBinary: readFileSync(new URL('../public/dwg-export/dwg-export.wasm', import.meta.url)), print: () => {}, printErr: (m: string) => errors.push(m) })
  writer.FS.writeFile('/input.dxf', new TextEncoder().encode(writerCompatibleDxf(dxf)))
  const status = writer.ccall('bw_convert', 'number', [], [])
  if (status !== 0) throw new Error(`LibreDWG could not convert the DXF (code ${status}): ${errors.filter(e => /ERROR/.test(e)).slice(0, 5).join(' ')}`)
  writeFileSync(out.replace(/\.dxf$/i, '') + '.dwg', writer.FS.readFile('/output.dwg'))
  console.log('wrote DWG')
}
