// aspect-ratio.js — pure, dependency-free aspect-ratio math.
// Shared by the browser tool (aspect-ratio-calculator.js) and the unit tests.
//
// simplifyRatio(w, h)        -> { w, h } reduced to lowest integer terms via GCD.
// ratioString(w, h)          -> "16:9" style string for the simplified ratio.
// solveDimension({...})      -> given a source ratio (rw:rh) and one of the
//                               target's width/height, returns the missing side.
//
// All inputs are treated as positive numbers; the solver preserves the source
// aspect ratio exactly (no rounding bias beyond the requested decimal places).

// Greatest common divisor (Euclid), tolerant of decimals by scaling to integers
// when both inputs are whole numbers; for non-integers we fall back to a
// reasonable rational reduction so "1920x1080" -> 16:9 but "1.5x1" -> 3:2.
export function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

// Reduce w:h to lowest integer terms. Throws on non-positive / non-finite input.
export function simplifyRatio(w, h) {
  if (![w, h].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) {
    throw new RangeError('Enter two positive numbers.');
  }
  // Scale to integers if either side has a fractional part (up to 6 dp), so the
  // GCD reduction is exact for typical decimal entries (e.g. 1.5 : 1 -> 3 : 2).
  const scale = (n) => {
    const s = n.toString();
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  };
  const places = Math.min(6, Math.max(scale(w), scale(h)));
  const factor = Math.pow(10, places);
  const iw = Math.round(w * factor);
  const ih = Math.round(h * factor);
  const g = gcd(iw, ih) || 1;
  return { w: iw / g, h: ih / g };
}

// "16:9" style string for the simplified ratio.
export function ratioString(w, h) {
  const r = simplifyRatio(w, h);
  return `${r.w}:${r.h}`;
}

// Round to a fixed number of decimal places, trimming trailing zeros.
function round(n, places) {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}

// Given a source ratio (rw:rh) and exactly ONE target dimension, return the
// missing side that preserves the ratio. `places` controls output rounding.
//   solveDimension({ rw:16, rh:9, width:1280 })  -> { width:1280, height:720 }
//   solveDimension({ rw:16, rh:9, height:720 })   -> { width:1280, height:720 }
export function solveDimension({ rw, rh, width, height, places = 2 }) {
  if (![rw, rh].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) {
    throw new RangeError('Enter a valid source ratio.');
  }
  const hasW = typeof width === 'number' && Number.isFinite(width) && width > 0;
  const hasH = typeof height === 'number' && Number.isFinite(height) && height > 0;
  if (hasW === hasH) {
    throw new Error('Provide exactly one of width or height.');
  }
  if (hasW) {
    return { width: round(width, places), height: round((width * rh) / rw, places) };
  }
  return { width: round((height * rw) / rh, places), height: round(height, places) };
}
