// color.js — pure, dependency-free color conversion between HEX, RGB and HSL.
// Shared by the browser tool (color-converter.js) and the unit tests.
//
// parseHex(s)      -> { r, g, b } from #RGB / #RRGGBB (with or without '#').
// rgbToHex(r,g,b)  -> '#rrggbb' (lowercase). Channels clamped to 0..255.
// rgbToHsl(r,g,b)  -> { h, s, l } with h in 0..360, s and l in 0..100.
// hslToRgb(h,s,l)  -> { r, g, b } integers 0..255.
//
// All channel values are integers; HSL is rounded to whole degrees/percent.

const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));

export function parseHex(s) {
  if (typeof s !== 'string') throw new Error('Enter a hex color.');
  let str = s.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(str)) {
    throw new Error('Hex colors use only 0-9 and a-f.');
  }
  if (str.length === 3) {
    str = str[0] + str[0] + str[1] + str[1] + str[2] + str[2];
  }
  if (str.length !== 6) {
    throw new Error('Enter a 3- or 6-digit hex color, like #1e90ff.');
  }
  return {
    r: parseInt(str.slice(0, 2), 16),
    g: parseInt(str.slice(2, 4), 16),
    b: parseInt(str.slice(4, 6), 16)
  };
}

export function rgbToHex(r, g, b) {
  const hex = (n) => clampByte(n).toString(16).padStart(2, '0');
  return '#' + hex(r) + hex(g) + hex(b);
}

export function rgbToHsl(r, g, b) {
  r = clampByte(r) / 255;
  g = clampByte(g) / 255;
  b = clampByte(b) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h, s, l) {
  h = ((Number(h) % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, Number(s))) / 100;
  l = Math.max(0, Math.min(100, Number(l))) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) { r1 = c; g1 = x; }
  else if (h < 120) { r1 = x; g1 = c; }
  else if (h < 180) { g1 = c; b1 = x; }
  else if (h < 240) { g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }

  return {
    r: clampByte((r1 + m) * 255),
    g: clampByte((g1 + m) * 255),
    b: clampByte((b1 + m) * 255)
  };
}
