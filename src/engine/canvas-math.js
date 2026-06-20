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
 * Resolve the target output size for a resize, honoring a locked aspect ratio.
 * `mode` is 'pixels' or 'percent'. In percent mode, `value` (e.g. 50) scales
 * the source. In pixels mode, `w`/`h` are the requested dimensions; when
 * `lock` is true the missing/edited side is derived from the source ratio.
 *
 * @returns {{width:number, height:number}} positive integer dimensions
 */
export function resizeDimensions(srcW, srcH, opts = {}) {
  const { mode = 'pixels', w, h, percent = 100, lock = true, edited } = opts;
  const round = (n) => Math.max(1, Math.round(n));
  if (srcW <= 0 || srcH <= 0) return { width: 1, height: 1 };
  if (mode === 'percent') {
    const f = (Number(percent) || 0) / 100;
    return { width: round(srcW * f), height: round(srcH * f) };
  }
  const ratio = srcW / srcH;
  let width = Number(w) > 0 ? Number(w) : srcW;
  let height = Number(h) > 0 ? Number(h) : srcH;
  if (lock) {
    // Derive the non-edited side from the side the user last changed.
    if (edited === 'height') width = height * ratio;
    else height = width / ratio; // default: width drives
  }
  return { width: round(width), height: round(height) };
}

/**
 * Lay out one image on a PDF page: resolves orientation, then fits the image
 * inside the printable area (page minus equal margins) preserving aspect ratio,
 * and centers it. All numbers are in the PDF unit (points). Pure — no canvas.
 *
 * @param {number} imgW source image width (px)
 * @param {number} imgH source image height (px)
 * @param {number} pageW page width in points (portrait orientation)
 * @param {number} pageH page height in points (portrait orientation)
 * @param {object} opts { orientation: 'auto'|'portrait'|'landscape', margin: points }
 * @returns {{pageW, pageH, orientation, x, y, w, h}} placement in points
 */
export function pdfPagePlacement(imgW, imgH, pageW, pageH, opts = {}) {
  const orientationOpt = opts.orientation || 'auto';
  const margin = Math.max(0, Number(opts.margin) || 0);
  const portW = Math.min(pageW, pageH);
  const portH = Math.max(pageW, pageH);

  let orientation = orientationOpt;
  if (orientationOpt === 'auto') {
    orientation = imgW > imgH ? 'landscape' : 'portrait';
  }
  const pW = orientation === 'landscape' ? portH : portW;
  const pH = orientation === 'landscape' ? portW : portH;

  // Printable box, clamped so over-large margins never invert the area.
  const boxW = Math.max(1, pW - 2 * margin);
  const boxH = Math.max(1, pH - 2 * margin);
  const s = containScale(imgW, imgH, boxW, boxH);
  const w = Math.max(1, imgW * s);
  const h = Math.max(1, imgH * s);
  const x = (pW - w) / 2;
  const y = (pH - h) / 2;
  return { pageW: pW, pageH: pH, orientation, x, y, w, h };
}

/**
 * Compute the tight bounding box of the non-transparent pixels in an RGBA
 * buffer, so a drawn/typed signature can be exported with the surrounding
 * whitespace trimmed (keeping transparency). Pure — works on a plain Uint8
 * (Clamped)Array, so it is unit-testable without a real canvas.
 *
 * @param {Uint8ClampedArray|Uint8Array|number[]} data RGBA pixels, length w*h*4
 * @param {number} width  pixel width of the buffer
 * @param {number} height pixel height of the buffer
 * @param {number} [alphaThreshold=0] a pixel counts as "ink" when its alpha is
 *        strictly greater than this (0 = any non-fully-transparent pixel)
 * @returns {{found:boolean, left:number, top:number, right:number, bottom:number, width:number, height:number}}
 *          `found` is false when the buffer is fully transparent. When found,
 *          left/top are inclusive and width/height span the inked region.
 */
export function alphaBounds(data, width, height, alphaThreshold = 0) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return { found: false, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  return { found: true, left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Format a byte count as a short human-readable string (e.g. "1.2 MB").
 * Used to show output file sizes in the image tools.
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = n / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`;
}

/**
 * Parse a user-entered target size in kilobytes into a positive byte count.
 * Accepts numbers or numeric strings; returns 0 for empty/invalid/<=0 input so
 * callers can show a friendly "enter a size" message instead of compressing.
 */
export function kbToBytes(kb) {
  const n = Number(kb);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1024);
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
