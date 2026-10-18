import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decodeText } from '../src/core/text-encoding.ts';

const desktop = createRequire(import.meta.url)('../desktop/read-text.cjs') as { decodeText(bytes: Uint8Array): string };

/** UTF-16 bytes of `text`, without a byte-order mark. */
function utf16(text: string, endian: 'le' | 'be'): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    bytes[2 * i + (endian === 'le' ? 0 : 1)] = unit & 0xff;
    bytes[2 * i + (endian === 'le' ? 1 : 0)] = unit >> 8;
  }
  return bytes;
}

// Invented PCF fragment, with a degree sign and an accented letter outside ASCII.
const PCF = 'ISOGEN-FILES ISOGEN.FLS\r\nUNITS-BORE MM\r\nPIPE\r\n    END-POINT 0 0 0 50\r\n    DESCRIPTION Coude 90° acier traité\r\n';

test('UTF-16 without a byte-order mark is recognised by its NUL bytes, little- and big-endian', () => {
  assert.deepEqual(decodeText(utf16(PCF, 'le')), { text: PCF, encoding: 'utf-16le' });
  assert.deepEqual(decodeText(utf16(PCF, 'be')), { text: PCF, encoding: 'utf-16be' });
  assert.deepEqual(decodeText(utf16('A', 'le')), { text: 'A', encoding: 'utf-16le' });
  // Mostly non-Latin text still carries NULs on one side wherever it is ASCII.
  const mixed = 'PIPELINE-REFERENCE 管線-100\r\nUNITS-BORE MM\r\n';
  assert.equal(decodeText(utf16(mixed, 'le')).text, mixed);
});

test('UTF-8 and Windows-1252 text are not mistaken for UTF-16', () => {
  assert.equal(decodeText(new TextEncoder().encode(PCF)).encoding, 'utf-8');
  assert.equal(decodeText(new Uint8Array([0x44, 0x45, 0x53, 0x43, 0x20, 0xb0, 0x20, 0x4e, 0xc9])).encoding, 'windows-1252');
  assert.equal(decodeText(new Uint8Array([])).text, '');
  assert.equal(decodeText(new Uint8Array([0x41])).text, 'A');
});

test('the desktop app decodes opened files exactly as the web app does', () => {
  const samples = [
    utf16(PCF, 'le'), utf16(PCF, 'be'), new TextEncoder().encode(PCF),
    new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), new Uint8Array([0xff, 0xfe, 0x41, 0x00]), new Uint8Array([0xfe, 0xff, 0x00, 0x41]),
    new Uint8Array([0x44, 0x45, 0x53, 0x43, 0x20, 0xb0, 0x20, 0x4e, 0xc9]), new Uint8Array([]), new Uint8Array([0x41]),
  ];
  for (const bytes of samples) assert.equal(desktop.decodeText(bytes), decodeText(bytes).text);
});
