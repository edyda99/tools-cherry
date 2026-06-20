// test-color.js — unit tests for the pure color conversion module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { parseHex, rgbToHex, rgbToHsl, hslToRgb } from '../src/engine/color.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('parseHex handles 6-digit, 3-digit, with/without hash', () => {
  assert.deepEqual(parseHex('#1e90ff'), { r: 30, g: 144, b: 255 });
  assert.deepEqual(parseHex('1e90ff'), { r: 30, g: 144, b: 255 });
  assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex('#000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(parseHex('  #ABC  '), { r: 170, g: 187, b: 204 });
});

t('parseHex rejects malformed input', () => {
  assert.throws(() => parseHex(''));
  assert.throws(() => parseHex('#12'));
  assert.throws(() => parseHex('#12345'));
  assert.throws(() => parseHex('#gggggg'));
  assert.throws(() => parseHex(123));
});

t('rgbToHex formats and clamps', () => {
  assert.equal(rgbToHex(30, 144, 255), '#1e90ff');
  assert.equal(rgbToHex(0, 0, 0), '#000000');
  assert.equal(rgbToHex(255, 255, 255), '#ffffff');
  assert.equal(rgbToHex(300, -5, 128), '#ff0080'); // clamped
});

t('rgbToHsl known values', () => {
  assert.deepEqual(rgbToHsl(0, 0, 0), { h: 0, s: 0, l: 0 });
  assert.deepEqual(rgbToHsl(255, 255, 255), { h: 0, s: 0, l: 100 });
  assert.deepEqual(rgbToHsl(255, 0, 0), { h: 0, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl(0, 255, 0), { h: 120, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl(0, 0, 255), { h: 240, s: 100, l: 50 });
});

t('hslToRgb known values', () => {
  assert.deepEqual(hslToRgb(0, 0, 0), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hslToRgb(0, 0, 100), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hslToRgb(0, 100, 50), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hslToRgb(120, 100, 50), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hslToRgb(240, 100, 50), { r: 0, g: 0, b: 255 });
});

t('hslToRgb wraps hue and clamps s/l', () => {
  assert.deepEqual(hslToRgb(360, 100, 50), hslToRgb(0, 100, 50));
  assert.deepEqual(hslToRgb(-120, 100, 50), hslToRgb(240, 100, 50));
});

t('RGB -> HSL -> RGB round-trips for a sample of colors', () => {
  const samples = [
    [30, 144, 255], [128, 64, 200], [10, 200, 90],
    [200, 200, 50], [17, 17, 17], [240, 130, 60]
  ];
  for (const [r, g, b] of samples) {
    const { h, s, l } = rgbToHsl(r, g, b);
    const back = hslToRgb(h, s, l);
    // Allow small rounding drift from the round-trip through integer HSL.
    assert.ok(Math.abs(back.r - r) <= 3, `r drift for ${r},${g},${b}`);
    assert.ok(Math.abs(back.g - g) <= 3, `g drift for ${r},${g},${b}`);
    assert.ok(Math.abs(back.b - b) <= 3, `b drift for ${r},${g},${b}`);
  }
});

console.log(`\n${pass} passing`);
