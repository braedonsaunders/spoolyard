import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The production build concatenates stylesheets, so one unclosed rule nests every later file inside it.
test('every stylesheet closes each rule it opens', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : []);
  const sheets = files(join(import.meta.dirname, '../src'));
  assert.ok(sheets.length >= 2);
  for (const file of sheets) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    const open: number[] = [];
    css.split('\n').forEach((line, i) => {
      for (const ch of line) {
        if (ch === '{') open.push(i + 1);
        else if (ch === '}') assert.ok(open.pop() != null, `${file}:${i + 1} closes a rule that was never opened`);
      }
    });
    assert.deepEqual(open, [], `${file}: rule opened at line ${open[0]} is never closed`);
  }
});
