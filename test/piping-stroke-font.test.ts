import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_SPACING, measureText, strokeText, strokeTextPath, type Stroke } from '../src/core/stroke-font.ts';

const bounds = (strokes: Stroke[]) => {
  const points = strokes.flat();
  return {
    minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
    minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])),
  };
};
const close = (a: number, b: number, message?: string) => assert.ok(Math.abs(a - b) < 1e-9, message ?? `${a} ≈ ${b}`);
const sameShape = (a: Stroke[], b: Stroke[]) => {
  assert.equal(a.length, b.length);
  a.forEach((stroke, i) => stroke.forEach((p, j) => { close(p[0], b[i][j][0]); close(p[1], b[i][j][1]); }));
};
const fallback = strokeText('☃', { at: [0, 0], size: 10 });

test('every printable ASCII character has an advance and its own strokes', () => {
  for (let code = 32; code <= 126; code++) {
    const ch = String.fromCharCode(code);
    assert.ok(measureText(ch, 10) > 0, `advance for ${JSON.stringify(ch)}`);
    const strokes = strokeText(ch, { at: [0, 0], size: 10 });
    if (ch === ' ') { assert.equal(strokes.length, 0); continue; }
    assert.ok(strokes.length > 0 && strokes.every(s => s.length >= 2), `strokes for ${ch}`);
    assert.notDeepEqual(strokes, fallback, `${ch} is a real glyph`);
  }
});

test('size is the cap height on the baseline at the anchor point', () => {
  const box = bounds(strokeText('H', { at: [50, 200], size: 10 }));
  close(box.minY, 190);
  close(box.maxY, 200);
  assert.ok(box.minX > 50 && box.maxX < 50 + measureText('H', 10));
  const descender = bounds(strokeText('g', { at: [0, 0], size: 10 }));
  assert.ok(descender.maxY > 2, 'descenders drop below the baseline');
});

test('widths and strokes scale linearly with size and width factor', () => {
  const text = `2'-6 1/2" F12 B13 G14`;
  close(measureText(text, 21), 3 * measureText(text, 7));
  close(measureText(text, 10, 0.5), measureText(text, 10) / 2);
  close(measureText(text, 10), [...text].reduce((sum, ch) => sum + measureText(ch, 10), 0));
  const small = strokeText(text, { at: [0, 0], size: 7 });
  const large = strokeText(text, { at: [0, 0], size: 14 });
  sameShape(large, small.map(s => s.map(([x, y]): [number, number] => [2 * x, 2 * y])));
  assert.equal(measureText('', 10), 0);
  // Production lettering: about 2/3 of a cap height per character in a dimension string.
  const perChar = measureText(`17'-3 5/8"`, 1) / 10;
  assert.ok(perChar > 0.55 && perChar < 0.8, `advance per character ${perChar}`);
});

test('middle and end anchors shift the text back along the baseline', () => {
  const text = 'BILL OF MATERIALS', size = 8, at: [number, number] = [100, 50];
  const width = measureText(text, size);
  const start = strokeText(text, { at, size });
  sameShape(strokeText(text, { at, size, anchor: 'middle' }), start.map(s => s.map(([x, y]): [number, number] => [x - width / 2, y])));
  sameShape(strokeText(text, { at, size, anchor: 'end' }), start.map(s => s.map(([x, y]): [number, number] => [x - width, y])));
  const rotated = strokeText(text, { at, size, anchor: 'end', rotation: 90 });
  const rotatedStart = strokeText(text, { at, size, rotation: 90 });
  sameShape(rotated, rotatedStart.map(s => s.map(([x, y]): [number, number] => [x, y + width])));
});

test('rotation 90 runs the text up the page with the letter tops to the left', () => {
  const text = 'HELLO', size = 10, at: [number, number] = [100, 100];
  const width = measureText(text, size);
  const box = bounds(strokeText(text, { at, size, rotation: 90 }));
  close(box.maxX, 100);
  close(box.minX, 90);
  assert.ok(box.maxY < 100 && box.minY > 100 - width && box.minY < 100 - 0.9 * width);
  const flat = strokeText(text, { at, size });
  sameShape(strokeText(text, { at, size, rotation: 90 }),
    flat.map(s => s.map(([x, y]): [number, number] => [at[0] + (y - at[1]), at[1] - (x - at[0])])));
});

test('oblique leans the top of I to the right, before rotation', () => {
  const [stem] = strokeText('I', { at: [0, 0], size: 10, oblique: 30 });
  const [top, bottom] = stem[0][1] < stem[1][1] ? [stem[0], stem[1]] : [stem[1], stem[0]];
  close(top[0] - bottom[0], 10 * Math.tan(Math.PI / 6));
  close(bottom[1] - top[1], 10);
  const [back] = strokeText('I', { at: [0, 0], size: 10, oblique: -30 });
  assert.ok(Math.min(back[0][0], back[1][0]) < 0, 'negative oblique leans left');
  // Isometric lettering: rotated and obliqued by the same iso angle, verticals stay vertical on the page.
  for (const angle of [30, -30]) {
    const [iso] = strokeText('I', { at: [0, 0], size: 10, rotation: angle, oblique: angle });
    close(iso[0][0], iso[1][0], `rotation ${angle} oblique ${angle} keeps I vertical`);
  }
});

test('drafting symbols render with their own strokes', () => {
  const draw = (text: string) => strokeText(text, { at: [0, 0], size: 10 });
  for (const ch of ['°', '℄', '±', '×']) {
    const strokes = draw(ch);
    assert.ok(strokes.length > 0 && measureText(ch, 10) > 0, ch);
    assert.notDeepEqual(strokes, fallback, `${ch} is not the fallback box`);
  }
  const degree = bounds(draw('°'));
  assert.ok(degree.minY < -10 && degree.maxY > -10 && degree.maxY - degree.minY < 4, 'degree is a small circle on the cap line');
  const centreline = bounds(draw('℄'));
  assert.ok(centreline.maxY > 1 && centreline.minY < -10, 'centreline L drops below the baseline under the C');
  sameShape(draw('½'), draw('1/2'));
  sameShape(draw('3 ¾'), draw('3 3/4'));
  sameShape(draw('2′-6″'), draw(`2'-6"`));
  const quote = bounds(draw('"'));
  assert.ok(quote.minY < -10 && quote.maxY < -7, 'inch marks sit at the cap line');
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].length, 5);
  assert.ok(measureText('☃', 10) > 0);
});

test('newlines stack lines below the first baseline and measure the widest line', () => {
  const size = 10;
  const box = bounds(strokeText('CONT\'D ON\nE 55\'-2 5/8"', { at: [0, 0], size }));
  close(box.maxY, LINE_SPACING * size + (bounds(strokeText('E 55\'-2 5/8"', { at: [0, 0], size })).maxY));
  close(measureText('CONT\'D ON\nE 55\'-2 5/8"', size), Math.max(measureText('CONT\'D ON', size), measureText('E 55\'-2 5/8"', size)));
});

test('strokeTextPath writes one M per stroke followed by L segments', () => {
  const options = { at: [10, 20] as [number, number], size: 7, rotation: 30, oblique: 30 };
  const strokes = strokeText(`F12 B13 G14`, options);
  const d = strokeTextPath(`F12 B13 G14`, options);
  assert.equal(d.match(/M/g)?.length, strokes.length);
  assert.equal(d.match(/L/g)?.length, strokes.reduce((sum, s) => sum + s.length - 1, 0));
  assert.match(d, /^M-?\d/);
  const [x, y] = d.slice(1).split('L')[0].split(' ').map(Number);
  assert.ok(Math.abs(x - strokes[0][0][0]) < 1e-3 && Math.abs(y - strokes[0][0][1]) < 1e-3);
  assert.equal(strokeTextPath(' ', options), '');
});
