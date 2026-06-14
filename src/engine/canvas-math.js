// canvas-math.js — pure geometry/encode helpers for the image tools.
// No DOM/canvas dependency → unit-testable in Node. The CanvasEditor composes these.

/** Scale so the image fully COVERS the box (may overflow). */
export function coverScale(imgW, imgH, boxW, boxH) {
  if (imgW <= 0 || imgH <= 0) return 1;
  return Math.max(boxW / imgW, boxH / imgH);
}

/** Scale so the image fully FITS inside the box (may letterbox). */
export function containScale(imgW, imgH, boxW, boxH) {
  if (imgW <= 0 || imgH <= 0) return 1;
  return Math.min(boxW / imgW, boxH / imgH);
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Resolution-independent placement of the image inside a crop box.
 * Transform is stored as { zoom (>=1, relative to cover), panNX/panNY in [0,1] }
 * so the SAME transform renders identically at preview size and export size.
 *
 * @returns {{scaleAbs, dw, dh, offX, offY, slackX, slackY}}
 */
export function placement(imgW, imgH, boxW, boxH, zoom, panNX, panNY) {
  const cover = coverScale(imgW, imgH, boxW, boxH);
  const scaleAbs = cover * Math.max(1, zoom || 1);
  const dw = imgW * scaleAbs;
  const dh = imgH * scaleAbs;
  const slackX = Math.max(0, dw - boxW);
  const slackY = Math.max(0, dh - boxH);
  const offX = -clamp(panNX, 0, 1) * slackX;
  const offY = -clamp(panNY, 0, 1) * slackY;
  return { scaleAbs, dw, dh, offX, offY, slackX, slackY };
}

/**
 * Binary-search an encoder quality (0..1) to hit a target byte size.
 * `measure(q)` returns (or resolves to) the encoded byte length at quality q.
 * Returns the highest quality whose size <= targetBytes (or the lowest tried).
 */
export async function qualityForTargetBytes(measure, targetBytes, opts = {}) {
  const steps = opts.steps || 7;
  let lo = opts.min ?? 0.1;
  let hi = opts.max ?? 0.95;
  let best = lo;
  let bestSize = await measure(lo);
  // if even the floor is too big, return it (caller may also downscale)
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    const size = await measure(mid);
    if (size <= targetBytes) { best = mid; bestSize = size; lo = mid; }
    else { hi = mid; }
  }
  return { quality: best, size: bestSize };
}
