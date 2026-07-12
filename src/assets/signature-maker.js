// signature-maker.js — make a quick signature image (draw or type) and download
// it as a trimmed, transparent-background PNG. Pure client-side, no deps.
// Reuses the export pattern from the image tools: render to an offscreen canvas,
// compute the inked bounding box (alphaBounds), then toBlob() + anchor download.
import { alphaBounds } from '/assets/canvas-math.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

const canvas = $('pad');
const ctx = canvas.getContext('2d');

// Logical (CSS) drawing size. The backing store is scaled by devicePixelRatio
// so strokes stay crisp on high-DPI screens. All drawing uses CSS-px coords;
// the ctx transform maps them to device pixels.
let cssW = 0, cssH = 0, dpr = 1;
let drawing = false;
let lastX = 0, lastY = 0;
let lastMidX = 0, lastMidY = 0; // previous midpoint, for continuous curve smoothing
let inked = false; // true once anything has been drawn or typed

let mode = 'draw'; // 'draw' | 'type'

const fonts = {
  cursive: '"Snell Roundhand", "Apple Chancery", "Segoe Script", "Brush Script MT", cursive',
  formal: '"Edwardian Script ITC", "Palace Script MT", "Snell Roundhand", cursive',
  casual: '"Bradley Hand", "Comic Sans MS", "Segoe Print", cursive',
  serif: 'Georgia, "Times New Roman", serif'
};

function setupCanvas() {
  const rect = canvas.getBoundingClientRect();
  cssW = rect.width;
  cssH = rect.height;
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px, render at device res
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  redraw();
}

// Preserve the picture across resizes/DPR changes by snapshotting and re-blitting.
let snapshot = null;
function redraw() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  if (mode === 'type') { renderTyped(); return; }
  if (snapshot) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(snapshot, 0, 0);
    ctx.restore();
  }
}

function saveSnapshot() {
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  off.getContext('2d').drawImage(canvas, 0, 0);
  snapshot = off;
}

// ----- Draw mode ------------------------------------------------------------
function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function strokeStart(e) {
  if (mode !== 'draw') return;
  drawing = true;
  const p = pos(e);
  lastX = p.x; lastY = p.y;
  lastMidX = p.x; lastMidY = p.y;
  ctx.strokeStyle = $('penColor').value;
  ctx.lineWidth = parseFloat($('penSize').value);
  // dot for a single tap
  ctx.beginPath();
  ctx.arc(lastX, lastY, ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = $('penColor').value;
  ctx.fill();
  inked = true;
  updateButtons();
}

// Draw one continuous quadratic segment: previous midpoint -> current midpoint,
// using the real sampled point as the control. Chaining midpoints keeps the
// path unbroken, so there are no gaps even between widely-spaced fast points.
function drawSegmentTo(p) {
  const midX = (lastX + p.x) / 2;
  const midY = (lastY + p.y) / 2;
  ctx.beginPath();
  ctx.moveTo(lastMidX, lastMidY);
  ctx.quadraticCurveTo(lastX, lastY, midX, midY);
  ctx.stroke();
  lastMidX = midX; lastMidY = midY;
  lastX = p.x; lastY = p.y;
}

function strokeMove(e) {
  if (!drawing) return;
  ctx.strokeStyle = $('penColor').value;
  ctx.lineWidth = parseFloat($('penSize').value);
  // Fast movement fires fewer pointermove events than the pointer actually
  // sampled; getCoalescedEvents() replays the in-between points so the stroke
  // stays continuous instead of dashed.
  const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
  if (coalesced && coalesced.length) {
    for (const ce of coalesced) drawSegmentTo(pos(ce));
  } else {
    drawSegmentTo(pos(e));
  }
}

function strokeEnd() {
  if (!drawing) return;
  drawing = false;
  // The curve so far stops at the last midpoint; connect it to the final point
  // so the tail of the stroke isn't truncated.
  ctx.beginPath();
  ctx.moveTo(lastMidX, lastMidY);
  ctx.lineTo(lastX, lastY);
  ctx.stroke();
  saveSnapshot();
}

// ----- Type mode ------------------------------------------------------------
function renderTyped() {
  const text = $('typedName').value.trim();
  if (!text) { inked = false; updateButtons(); return; }
  const size = parseInt($('typeSize').value, 10) || 64;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = $('typeColor').value;
  ctx.font = `${size}px ${fonts[$('typeFont').value] || fonts.cursive}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cssW / 2, cssH / 2);
  ctx.restore();
  inked = true;
  updateButtons();
}

// ----- Clear ----------------------------------------------------------------
function clearPad() {
  snapshot = null;
  inked = false;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  if (mode === 'type') renderTyped();
  updateButtons();
  $('status').textContent = 'Cleared.';
}

// ----- Background -----------------------------------------------------------
// Returns the chosen background color, or null for a transparent background.
// The backing store stays transparent (so alphaBounds can find the ink); the
// color is only shown on-screen and baked into the exported PNG.
function bgValue() {
  const choice = $('bgChoice').value;
  if (choice === 'transparent') return null;
  if (choice === 'custom') return $('bgColor').value;
  return choice;
}

function applyBg() {
  $('bgCustomField').hidden = $('bgChoice').value !== 'custom';
  canvas.style.background = bgValue() || 'transparent';
}

// ----- Download trimmed PNG (transparent, or with chosen background) ---------
function download() {
  if (!inked) return;
  // Read the full backing store, find the inked bounding box, then copy just
  // that region (with a little padding) onto a fresh transparent canvas.
  const full = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const b = alphaBounds(full.data, canvas.width, canvas.height, 0);
  if (!b.found) { $('status').textContent = 'Nothing to download yet.'; return; }

  const pad = Math.round(8 * dpr);
  const sx = Math.max(0, b.left - pad);
  const sy = Math.max(0, b.top - pad);
  const sw = Math.min(canvas.width - sx, b.width + pad * 2);
  const sh = Math.min(canvas.height - sy, b.height + pad * 2);

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const octx = out.getContext('2d');
  // Fill the chosen background first (if any), then the ink on top. No fill =
  // transparent PNG, as before.
  const bg = bgValue();
  if (bg) { octx.fillStyle = bg; octx.fillRect(0, 0, sw, sh); }
  octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  out.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'signature.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('status').textContent = `Downloaded a ${sw}×${sh}px ${bg ? 'PNG' : 'transparent PNG'}.`;
  }, 'image/png');
}

// ----- Mode switching -------------------------------------------------------
function setMode(next) {
  mode = next;
  $('modeDraw').setAttribute('aria-pressed', String(mode === 'draw'));
  $('modeType').setAttribute('aria-pressed', String(mode === 'type'));
  $('drawControls').hidden = mode !== 'draw';
  $('typeControls').hidden = mode !== 'type';
  // Switching modes starts a fresh canvas so the two modes don't mix.
  clearPad();
  canvas.style.cursor = mode === 'draw' ? 'crosshair' : 'default';
  $('status').textContent = mode === 'draw'
    ? 'Draw your signature with your mouse, finger, or stylus.'
    : 'Type your name and pick a style.';
}

function updateButtons() {
  $('download').disabled = !inked;
  $('clear').disabled = !inked;
}

function init() {
  setupCanvas();
  setMode('draw');

  // Draw mode: pointer events cover mouse / touch / stylus.
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'draw') return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    strokeStart(e);
  });
  canvas.addEventListener('pointermove', (e) => { if (mode === 'draw') strokeMove(e); });
  canvas.addEventListener('pointerup', strokeEnd);
  canvas.addEventListener('pointercancel', strokeEnd);

  // Type mode: live re-render on any input change.
  ['typedName', 'typeFont', 'typeColor', 'typeSize'].forEach((id) =>
    $(id).addEventListener('input', () => { if (mode === 'type') redraw(); })
  );

  $('modeDraw').addEventListener('click', () => setMode('draw'));
  $('modeType').addEventListener('click', () => setMode('type'));
  $('clear').addEventListener('click', clearPad);
  $('download').addEventListener('click', download);

  // Background choice: applies on screen and in the exported PNG, in both modes.
  $('bgChoice').addEventListener('change', applyBg);
  $('bgColor').addEventListener('input', applyBg);
  applyBg();

  // Re-fit the backing store if the canvas box changes size (orientation, etc.).
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const r = canvas.getBoundingClientRect();
      if (Math.round(r.width) === Math.round(cssW)) return; // width unchanged
      setupCanvas();
      if (mode === 'type') redraw();
    }, 150);
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
