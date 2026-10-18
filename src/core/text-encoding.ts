/**
 * Text of an imported file (.piping, PCF, DXF) from its bytes. A byte-order mark decides (UTF-8, UTF-16 LE/BE);
 * then UTF-16 without one, recognised by its NUL bytes (these files are mostly ASCII, so UTF-16 puts a NUL in every
 * other byte, on the odd side for little-endian and the even side for big-endian); otherwise valid UTF-8 is UTF-8, and
 * anything else is read as Windows-1252, the code page most CAD and plant-design programs on Windows write PCF and
 * pre-2007 DXF files in. (The desktop app reads files with the same rules, in desktop/read-text.cjs.)
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  const utf16 = utf16WithoutBom(bytes)
  if (utf16) return { text: new TextDecoder(utf16).decode(bytes), encoding: utf16 }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

/** How many leading bytes are sampled for UTF-16's NUL pattern. */
const UTF16_SAMPLE_BYTES = 4096

/**
 * UTF-16 without a byte-order mark: in the first few KB, at least 40% of one side's bytes (odd for little-endian,
 * even for big-endian) are NUL and at most 10% of the other side's. Real UTF-8 and Windows-1252 text has no NULs.
 */
function utf16WithoutBom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const pairs = Math.floor(Math.min(bytes.length, UTF16_SAMPLE_BYTES) / 2)
  if (!pairs) return null
  let even = 0, odd = 0
  for (let i = 0; i < pairs; i++) {
    if (bytes[2 * i] === 0) even++
    if (bytes[2 * i + 1] === 0) odd++
  }
  if (odd >= pairs * 0.4 && even <= pairs * 0.1) return 'utf-16le'
  if (even >= pairs * 0.4 && odd <= pairs * 0.1) return 'utf-16be'
  return null
}
