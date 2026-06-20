// image-converter.js — convert an image between PNG, JPG, and WebP, in the browser.
// Reuses the shared canvas engine (preview scaling + byte formatting). No deps.
import { containScale, formatBytes } from '/assets/canvas-math.js';

const $ = (id) => document.getElementById(id);

let img = null;       // loaded HTMLImageElement
let srcName = 'image'; // original file name (without extension)

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

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

// Show/hide the quality slider (PNG is lossless, so it has no quality knob).
function syncQualityVisibility() {
  $('qualityField').hidden = $('format').value === 'image/png';
}

function refreshStatus() {
  if (!img) return;
  $('status').textContent = `Loaded ${img.width}×${img.height}px. Pick a format, then download.`;
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
  const type = $('format').value;
  const quality = parseInt($('quality').value, 10) / 100;
  const off = document.createElement('canvas');
  off.width = img.width; off.height = img.height;
  const ctx = off.getContext('2d');
  // JPEG has no transparency — paint white so transparent PNGs don't go black.
  if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, off.width, off.height); }
  ctx.drawImage(img, 0, 0);
  off.toBlob((blob) => {
    if (!blob) { $('status').textContent = 'Sorry — your browser could not export that format.'; return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ext = EXT[type] || 'png';
    a.href = url;
    a.download = `${srcName}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('status').textContent = `Downloaded ${ext.toUpperCase()} — ${formatBytes(blob.size)}.`;
  }, type, quality);
}

// --- wiring -----------------------------------------------------------------
function init() {
  $('file').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });
  $('format').addEventListener('change', syncQualityVisibility);
  $('quality').addEventListener('input', () => { $('qualityVal').textContent = $('quality').value; });
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

  syncQualityVisibility();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
