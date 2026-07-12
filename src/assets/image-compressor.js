// image-compressor.js — compress a photo to a target file size, in the browser.
// Reuses the shared canvas engine: qualityForTargetBytes picks the encoder
// quality, plus preview scaling / byte formatting / KB parsing. No deps.
import { containScale, formatBytes, qualityForTargetBytes, kbToBytes } from '/assets/canvas-math.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

let img = null;        // loaded HTMLImageElement
let srcName = 'image'; // original file name (without extension)
let lastBlob = null;   // most recent compressed Blob (for download)
let lastExt = 'jpg';   // extension matching lastBlob's type

const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// --- preview: draw the source contained inside the preview canvas ------------
function drawPreview() {
  const cv = $('preview');
  if (!img) { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); return; }
  const box = 320;
  const s = containScale(img.width, img.height, box, box);
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
}

// Encode the source image at a given quality and resolve to its Blob.
function encodeAt(type, quality) {
  const off = document.createElement('canvas');
  off.width = img.width; off.height = img.height;
  const ctx = off.getContext('2d');
  // JPEG/WebP-at-quality flatten transparency — paint white first.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve) => off.toBlob((b) => resolve(b), type, quality));
}

// --- loading ----------------------------------------------------------------
function loadFile(file) {
  if (!file || !/^image\//.test(file.type)) {
    $('status').textContent = 'Could not load that file — please choose a valid image.';
    return;
  }
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.onload = () => {
    URL.revokeObjectURL(url);
    img = im;
    srcName = (file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    lastBlob = null;
    $('compress').disabled = false;
    $('download').hidden = true;
    $('download').disabled = true;
    $('dropText').textContent = `Loaded: ${file.name}`;
    drawPreview();
    $('status').textContent =
      `Loaded ${img.width}×${img.height}px (${formatBytes(file.size)}). Pick a size, then compress.`;
  };
  im.onerror = () => {
    URL.revokeObjectURL(url);
    $('status').textContent = 'Could not load that file — please choose a valid image.';
  };
  im.src = url;
}

// --- compress to the target size --------------------------------------------
async function compress() {
  if (!img) return;
  const target = kbToBytes($('targetKb').value);
  if (!target) {
    $('status').textContent = 'Please enter a target size in KB (a number greater than 0).';
    return;
  }
  const type = $('format').value;
  $('compress').disabled = true;
  $('status').textContent = 'Compressing…';

  // Each measure() encodes once and caches the resulting blob by quality, so we
  // don't re-encode the winning quality just to grab its bytes.
  const cache = new Map();
  const measure = async (q) => {
    const blob = await encodeAt(type, q);
    cache.set(q, blob);
    return blob ? blob.size : Infinity;
  };

  const { quality, size } = await qualityForTargetBytes(measure, target, { min: 0.05, max: 0.95, steps: 8 });
  $('compress').disabled = false;

  const ext = EXT[type] || 'jpg';
  if (size <= target) {
    lastBlob = cache.get(quality);
    lastExt = ext;
    $('download').hidden = false;
    $('download').disabled = false;
    $('status').textContent =
      `Done — ${formatBytes(size)} (under your ${formatBytes(target)} target). Click download to save.`;
  } else {
    // Even at the lowest quality we couldn't get under the target. Offer the
    // smallest version anyway and explain in plain English.
    lastBlob = cache.get(quality);
    lastExt = ext;
    $('download').hidden = false;
    $('download').disabled = false;
    $('status').textContent =
      `This image won't go under ${formatBytes(target)} at full size. The smallest we can make it is ` +
      `${formatBytes(size)}. You can download that, or try a slightly larger target.`;
  }
}

// --- download ---------------------------------------------------------------
function download() {
  if (!lastBlob) return;
  const url = URL.createObjectURL(lastBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${srcName}-compressed.${lastExt}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- wiring -----------------------------------------------------------------
function init() {
  $('file').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });
  $('compress').addEventListener('click', compress);
  $('download').addEventListener('click', download);

  // Quick-size preset buttons fill the KB field.
  document.querySelectorAll('.preset').forEach((btn) =>
    btn.addEventListener('click', () => { $('targetKb').value = btn.dataset.kb; })
  );

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); })
  );
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
}

function __bootInit() {
  try {
    init();
  } catch (err) {
    showCalculatorLoadError(err);
  }
}
if (document.readyState !== 'loading') __bootInit();
else document.addEventListener('DOMContentLoaded', __bootInit);
