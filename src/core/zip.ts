/**
 * ZIP archives: writing generated files (stored, not compressed), for exporting a package of sheets as one download,
 * and reading one back (a PCF with its .piping sidecar).
 * Names are UTF-8 (general-purpose flag bit 11); dates are the time of writing.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
export function zip(files: Array<{ name: string; content: string | Uint8Array }>, date = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []
  let offset = 0
  const seen = new Set<string>()
  for (const file of files) {
    let name = file.name
    for (let n = 2; seen.has(name); n++) name = file.name.replace(/(\.[^./]*)?$/, ext => `-${n}${ext}`)
    seen.add(name)
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content, path = encoder.encode(name)
    const crc = crc32(data)
    const local = new Uint8Array(30 + path.length), lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true)
    lv.setUint16(10, time, true); lv.setUint16(12, day, true); lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, path.length, true)
    local.set(path, 30)
    const central = new Uint8Array(46 + path.length), cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true)
    cv.setUint16(12, time, true); cv.setUint16(14, day, true); cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, path.length, true)
    cv.setUint32(42, offset, true)
    central.set(path, 46)
    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }
  const size = centrals.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22), ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true)
  ev.setUint32(12, size, true); ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + size + 22)
  let at = 0
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length }
  return out
}

/** Largest archive read, and the most its entries may expand to: a drawing package is a few MB. */
export const UNZIP_MAX_BYTES = 64 * 1024 * 1024

/**
 * The files of a ZIP archive: stored entries (as `zip` writes them) and deflated ones (as the operating system's
 * "compress" writes them). Read from the central directory, so entries written with a data descriptor are sized
 * correctly. Directories are skipped; a CRC mismatch, an encrypted entry or another compression method is an error.
 */
export async function unzip(bytes: Uint8Array): Promise<Array<{ name: string; content: Uint8Array }>> {
  if (bytes.length > UNZIP_MAX_BYTES) throw new Error(`The ZIP archive exceeds the ${UNZIP_MAX_BYTES / 1024 / 1024} MB limit.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-central-directory record: within the last 64 KB (its comment is at most 65535 bytes).
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--)
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('Not a ZIP archive (no central directory).')
  const count = view.getUint16(end + 10, true), dirOffset = view.getUint32(end + 16, true)
  const utf8 = new TextDecoder('utf-8'), latin = new TextDecoder('windows-1252')
  const files: Array<{ name: string; content: Uint8Array }> = []
  let at = dirOffset, total = 0
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('The ZIP archive is damaged (central directory).')
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true)
    const packed = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength)
    const name = (flags & 0x0800 ? utf8 : latin).decode(rawName)
    at += 46 + nameLength + extra + comment
    if (name.endsWith('/')) continue
    if (flags & 1) throw new Error(`${name} in the ZIP archive is encrypted.`)
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error(`The ZIP archive is damaged (${name}).`)
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    if (start + packed > bytes.length) throw new Error(`The ZIP archive is damaged (${name}).`)
    total += size
    if (total > UNZIP_MAX_BYTES) throw new Error(`The ZIP archive expands past the ${UNZIP_MAX_BYTES / 1024 / 1024} MB limit.`)
    const data = bytes.subarray(start, start + packed)
    let content: Uint8Array
    if (method === 0) content = data.slice()
    else if (method === 8) content = await inflateRaw(data)
    else throw new Error(`${name} in the ZIP archive uses an unsupported compression method (${method}).`)
    if (content.length !== size || crc32(content) !== crc) throw new Error(`${name} in the ZIP archive is damaged (checksum).`)
    files.push({ name, content })
  }
  return files
}
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
/** A ZIP archive's signature (a local file header, or the end record of an empty archive). */
export const isZip = (bytes: Uint8Array) =>
  bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))
