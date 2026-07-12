// image-resizer.js — resize a photo by pixels or percentage, in the browser.
// Reuses the pure geometry helpers from the shared canvas engine.
import { resizeDimensions, containScale } from '/assets/canvas-math.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

let img = null;          // loaded HTMLImageElement
let lastEdited = 'width'; // which pixel field the user changed last

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// --- preview: draw the source contained inside the preview canvas ------------
function drawPreview() {
  const cv = $('preview');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!img) return;
  // size the canvas to the image aspect, capped to a sensible preview box
  const box = 320;
  const s = containScale(img.width, img.height, box, box);
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
}

// --- compute the chosen output dimensions from the current inputs -----------
function currentDims() {
  if (!img) return { width: 0, height: 0 };
  const mode = $('mode').value;
  return resizeDimensions(img.width, img.height, {
    mode,
    w: parseInt($('w').value, 10),
    h: parseInt($('h').value, 10),
    percent: parseFloat($('percent').value),
    lock: $('lock').checked,
    edited: lastEdited
  });
}

function refreshStatus() {
  if (!img) return;
  const d = currentDims();
  $('status').textContent =
    `Original ${img.width}×${img.height}px → new size ${d.width}×${d.height}px`;
}

// When aspect is locked, mirror the derived side back into the other field.
function syncLockedFields() {
  if ($('mode').value !== 'pixels' || !$('lock').checked || !img) return;
  const d = currentDims();
  if (lastEdited === 'width') $('h').value = String(d.height);
  else $('w').value = String(d.width);
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
    $('w').value = String(im.width);
    $('h').value = String(im.height);
    lastEdited = 'width';
    $('download').disabled = false;
    $('dropText').textContent = `Loaded: ${file.name}`;
    drawPreview();
    refreshStatus();
  };
  im.onerror = () => {
    URL.revokeObjectURL(url);
    $('status').textContent = 'Could not load that file — please choose a valid image.';
  };
  im.src = url;
}

// --- export + download ------------------------------------------------------
function download() {
  if (!img) return;
  const d = currentDims();
  const type = $('format').value;
  const off = document.createElement('canvas');
  off.width = d.width; off.height = d.height;
  const ctx = off.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // JPEG has no transparency — paint white so transparent PNGs don't go black.
  if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, d.width, d.height); }
  ctx.drawImage(img, 0, 0, d.width, d.height);
  off.toBlob((blob) => {
    if (!blob) { $('status').textContent = 'Sorry — your browser could not export that format.'; return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resized-${d.width}x${d.height}.${EXT[type] || 'png'}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('status').textContent = `Downloaded ${d.width}×${d.height}px image.`;
  }, type, 0.92);
}

// --- wiring -----------------------------------------------------------------
function init() {
  $('file').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });

  $('mode').addEventListener('change', () => {
    const pixels = $('mode').value === 'pixels';
    $('pixelFields').hidden = !pixels;
    $('percentField').hidden = pixels;
    refreshStatus();
  });

  $('w').addEventListener('input', () => { lastEdited = 'width'; syncLockedFields(); refreshStatus(); });
  $('h').addEventListener('input', () => { lastEdited = 'height'; syncLockedFields(); refreshStatus(); });
  $('lock').addEventListener('change', () => { syncLockedFields(); refreshStatus(); });
  $('percent').addEventListener('input', refreshStatus);
  $('download').addEventListener('click', download);

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
