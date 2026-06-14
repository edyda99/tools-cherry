// photo-maker.js — passport/ID photo maker on the shared CanvasEditor.
// Spec presets sized to official dimensions; head-position guide; 4x6 print sheet.
import { CanvasEditor } from '/assets/canvas-editor.js';

const $ = (id) => document.getElementById(id);
const DATA = window.__PHOTO_SPECS__ || { specs: [], printSheet: {} };
const MAX_DISPLAY_H = 360;

let editor, current, hasImg = false;

function fmtDims(s) {
  return `${s.widthMm}×${s.heightMm} mm · ${s.widthPx}×${s.heightPx}px @ ${s.dpi} DPI`;
}

function applySpec(spec) {
  current = spec;
  const cv = $('editor');
  cv.width = spec.widthPx;
  cv.height = spec.heightPx;
  // display scaling (preserve aspect, cap height)
  const dispH = Math.min(MAX_DISPLAY_H, spec.heightPx);
  const dispW = Math.round(dispH * spec.widthPx / spec.heightPx);
  cv.style.height = dispH + 'px';
  cv.style.width = dispW + 'px';
  $('editorWrap').style.width = dispW + 'px';
  if (!editor) {
    editor = new CanvasEditor(cv, { shape: 'rect', background: spec.background });
    editor.on('change', () => { $('zoom').value = String(editor.zoom); });
  } else {
    editor.setBackground(spec.background);
  }
  editor.render();
  drawGuide(spec);
  const bgName = spec.background.toLowerCase() === '#ffffff' ? 'white' : 'light grey';
  $('specNote').innerHTML = `${fmtDims(spec)} · ${bgName} background. ` +
    `<a href="${spec.source}" target="_blank" rel="noopener nofollow">official rules</a>. ${spec.note}`;
}

// Oval head-position guide sized from the spec's chin-to-crown range.
function drawGuide(spec) {
  const svg = $('guide');
  svg.setAttribute('viewBox', `0 0 ${spec.widthPx} ${spec.heightPx}`);
  const headMidMm = (spec.headMinMm + spec.headMaxMm) / 2;
  const headFrac = headMidMm / spec.heightMm;          // fraction of photo height
  const ovalH = headFrac * spec.heightPx;
  const ovalW = ovalH * 0.74;                           // typical head width:height
  const cx = spec.widthPx / 2;
  const topMargin = spec.heightPx * 0.08;               // crown near top
  const cy = topMargin + ovalH / 2;
  svg.innerHTML =
    `<ellipse cx="${cx}" cy="${cy}" rx="${ovalW / 2}" ry="${ovalH / 2}" ` +
    `fill="none" stroke="#2ea043" stroke-width="3" stroke-dasharray="10 8" opacity="0.85"/>` +
    `<line x1="${cx}" y1="0" x2="${cx}" y2="${spec.heightPx}" stroke="#2ea043" stroke-width="1" opacity="0.35"/>`;
}

async function handleFile(file) {
  try {
    await editor.loadFile(file);
    $('zoom').value = '1';
    hasImg = true;
    $('dlPhoto').disabled = false;
    $('dlSheet').disabled = false;
    $('dropText').textContent = `Loaded: ${file.name}`;
    $('status').textContent = 'Drag to position the head in the guide · scroll or slide to zoom';
  } catch (e) {
    $('status').textContent = 'Could not load that file — please choose a valid image.';
  }
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadPhoto() {
  if (!hasImg) return;
  const blob = await editor.toBlob({ type: 'image/png', width: current.widthPx, height: current.heightPx });
  if (blob) { triggerDownload(blob, `${current.id}.png`); $('status').textContent = `Downloaded ${current.widthPx}×${current.heightPx} photo.`; }
}

async function downloadSheet() {
  if (!hasImg) return;
  const ps = DATA.printSheet;
  const photo = await editor.toBlob({ type: 'image/png', width: current.widthPx, height: current.heightPx });
  const bmp = await createImageBitmap(photo);

  const sheet = document.createElement('canvas');
  sheet.width = ps.widthPx; sheet.height = ps.heightPx;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, ps.widthPx, ps.heightPx);

  // Max copies that fit edge-to-edge, then spread the leftover space as even gaps/margins.
  const cols = Math.max(1, Math.floor(ps.widthPx / current.widthPx));
  const rows = Math.max(1, Math.floor(ps.heightPx / current.heightPx));
  const gapX = (ps.widthPx - cols * current.widthPx) / (cols + 1);
  const gapY = (ps.heightPx - rows * current.heightPx) / (rows + 1);

  ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = gapX * (c + 1) + c * current.widthPx;
      const y = gapY * (r + 1) + r * current.heightPx;
      ctx.drawImage(bmp, x, y, current.widthPx, current.heightPx);
      ctx.strokeRect(x + 0.5, y + 0.5, current.widthPx, current.heightPx); // cut guide
    }
  }
  sheet.toBlob((blob) => {
    if (blob) { triggerDownload(blob, `${current.id}-4x6-sheet.png`); $('status').textContent = `Downloaded 4×6 sheet (${cols * rows} photos).`; }
  }, 'image/png');
}

function init() {
  const sel = $('spec');
  DATA.specs.forEach((s) => {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.label;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    const spec = DATA.specs.find((s) => s.id === sel.value);
    applySpec(spec);
  });
  applySpec(DATA.specs[0]);

  $('file').addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  $('zoom').addEventListener('input', (e) => editor.setZoom(parseFloat(e.target.value)));
  $('dlPhoto').addEventListener('click', downloadPhoto);
  $('dlSheet').addEventListener('click', downloadSheet);

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
