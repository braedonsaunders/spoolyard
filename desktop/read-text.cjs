// Text of an opened file from its bytes, by the same rules as src/core/text-encoding.ts: a byte-order mark decides,
// then UTF-16 without one (recognised by its NUL bytes), else valid UTF-8 is UTF-8, else Windows-1252 (the code page
// Windows CAD programs write PCF and older DXF in). test/text-encoding.test.ts keeps the two in step.
const UTF16_SAMPLE_BYTES = 4096;

/** UTF-16 without a byte-order mark: one side of the byte pairs mostly NUL (≥ 40%), the other almost never (≤ 10%). */
function utf16WithoutBom(bytes) {
  const pairs = Math.floor(Math.min(bytes.length, UTF16_SAMPLE_BYTES) / 2);
  if (!pairs) return null;
  let even = 0, odd = 0;
  for (let i = 0; i < pairs; i++) {
    if (bytes[2 * i] === 0) even++;
    if (bytes[2 * i + 1] === 0) odd++;
  }
  if (odd >= pairs * 0.4 && even <= pairs * 0.1) return "utf-16le";
  if (even >= pairs * 0.4 && odd <= pairs * 0.1) return "utf-16be";
  return null;
}

function decodeText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const utf16 = utf16WithoutBom(bytes);
  if (utf16) return new TextDecoder(utf16).decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
module.exports = { decodeText };
