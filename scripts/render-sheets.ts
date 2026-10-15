// Render a drawing's PDF package and each page as a 150 dpi PNG, the way the app exports it.
// Usage: pnpm exec tsx scripts/render-sheets.ts <drawing.piping | build.ts> <output dir>
// A .ts input must export build(): IsoDocument.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [input, outDir] = process.argv.slice(2)
if (!input || !outDir) {
  console.error('Usage: pnpm exec tsx scripts/render-sheets.ts <drawing.piping | build.ts> <output dir>')
  process.exit(1)
}
const publicDir = pathToFileURL(resolve(import.meta.dirname, '../public') + '/').toString()
// The exporter loads its font relative to the page; serve public/ from disk.
Object.assign(globalThis, { document: { baseURI: publicDir } })
const nativeFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const href = String(url instanceof Request ? url.url : url)
  if (!href.startsWith('file:')) return nativeFetch(url, init)
  const body = readFileSync(new URL(href))
  return new Response(body, { status: 200 })
}) as typeof fetch

const { exportPdf } = await import('../src/editor/export.ts')
const { parseIsoJson } = await import('../src/core/model.ts')
const doc = input.endsWith('.ts')
  ? (await import(pathToFileURL(resolve(input)).toString())).build()
  : parseIsoJson(readFileSync(input, 'utf8'))
mkdirSync(outDir, { recursive: true })
const name = basename(input).replace(/\.(piping|ts)$/, '')
const pdf = resolve(outDir, name + '.pdf')
writeFileSync(pdf, Buffer.from(await (await exportPdf(doc)).arrayBuffer()))
if (input.endsWith('.ts')) writeFileSync(resolve(outDir, name + '.piping'), JSON.stringify(doc))
execFileSync('pdftoppm', ['-r', '150', '-png', pdf, resolve(outDir, name)])
console.log(pdf)
