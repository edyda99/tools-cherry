// circle-crop.js — circle image cropper built on the shared CanvasEditor.
import { CanvasEditor } from '/assets/canvas-editor.js';

const $ = (id) => document.getElementById(id);

const editor = new CanvasEditor($('editor'), { shape: 'circle', background: null });
let hasImg = false;

function setLoaded(name) {
  hasImg = true;
  $('download').disabled = false;
  $('dropText').textContent = name ? `Loaded: ${name} — drag or arrow-keys to reposition, scroll to zoom` : 'Image loaded';
  syncPreset();
}

function syncRotation() {
  $('rotate').value = String(editor.rotation);
  $('rotateVal').textContent = String(editor.rotation);
}

function syncFlip() {
  $('flipH').setAttribute('aria-pressed', String(editor.flipH));
  $('flipV').setAttribute('aria-pressed', String(editor.flipV));
  $('flipH').classList.toggle('active', editor.flipH);
  $('flipV').classList.toggle('active', editor.flipV);
}

async function handleFile(file) {
  try {
    await editor.loadFile(file);
    $('zoom').value = '1';
    syncRotation();
    syncFlip();
    setLoaded(file.name);
  } catch (e) {
    $('status').textContent = 'Could not load that file — please choose a valid image.';
  }
}

// Effective output size: a chosen platform preset overrides the custom size select.
function outputSize() {
  const preset = parseInt($('preset').value, 10);
  if (preset) return preset;
  return parseInt($('outSize').value, 10) || 512;
}

function download() {
  if (!hasImg) return;
  const size = outputSize();
  const v = $('format').value;
  const fmt = (v === 'jpeg' || v === 'webp') ? v : 'png';
  // JPG has no alpha: flatten the transparent corners onto an opaque backdrop
  // (the user's chosen background color if filling, else white). PNG and WebP
  // both keep transparency, so no flatten.
  const flatten = fmt === 'jpeg'
    ? ($('bgOn').checked ? $('bgColor').value : '#ffffff')
    : null;
  const type = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
  const opts = fmt === 'png'
    ? { type, width: size, height: size }
    : { type, quality: 0.92, width: size, height: size, flatten };
  editor.toBlob(opts).then((blob) => {
    if (!blob) return;
    const ext = fmt === 'jpeg' ? 'jpg' : fmt;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const shape = $('shape').value;
    const base = shape === 'rect' ? 'square-crop' : shape === 'rounded' ? 'rounded-crop' : 'circle-crop';
    a.href = url; a.download = `${base}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('status').textContent = `Downloaded ${size}×${size} ${ext.toUpperCase()}.`;
  });
}

function syncFormat() {
  const v = $('format').value;
  const label = v === 'jpeg' ? 'Download JPG' : v === 'webp' ? 'Download WebP' : 'Download PNG';
  $('download').textContent = label;
  $('jpgNote').hidden = v !== 'jpeg';
}

// When a platform preset is chosen its size drives the export, so the custom
// size select is locked to show that it's being overridden.
function syncPreset() {
  const sel = $('preset');
  const active = !!parseInt(sel.value, 10);
  $('outSize').disabled = active;
  if (hasImg) {
    const size = outputSize();
    const label = active ? sel.options[sel.selectedIndex].text : `${size}×${size}`;
    $('status').textContent = `Output: ${label} · drag to reposition, scroll to zoom`;
  }
}

// Crop shape: circle (default), square, or rounded square. The corner-roundness
// slider only applies to (and is only shown for) the rounded shape.
function applyShape() {
  const shape = $('shape').value; // 'circle' | 'rect' | 'rounded'
  const rounded = shape === 'rounded';
  $('radiusControls').hidden = !rounded;
  editor.setCornerRadius(rounded ? (parseInt($('radius').value, 10) || 25) / 100 : 0);
  editor.setShape(shape);
}

function applyBackground() {
  editor.setBackground($('bgOn').checked ? $('bgColor').value : null);
}

function applyPadding() {
  const on = $('padOn').checked;
  editor.setPadding(on ? (parseInt($('padAmount').value, 10) || 10) / 100 : 0);
}

function applyBorder() {
  const on = $('borderOn').checked;
  const color = on ? $('borderColor').value : null;
  const width = on ? (parseInt($('borderWidth').value, 10) || 6) / 100 : 0;
  editor.setBorder(color, width);
}

function init() {
  // keep zoom slider in sync if the user scroll-zooms on the canvas
  editor.on('change', () => { $('zoom').value = String(editor.zoom); });

  $('file').addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  $('zoom').addEventListener('input', (e) => editor.setZoom(parseFloat(e.target.value)));
  $('rotate').addEventListener('input', (e) => {
    editor.setRotation(parseInt(e.target.value, 10) || 0);
    $('rotateVal').textContent = String(editor.rotation);
  });
  $('rotateReset').addEventListener('click', () => { editor.setRotation(0); syncRotation(); });
  $('flipH').addEventListener('click', () => { editor.setFlip(!editor.flipH, editor.flipV); syncFlip(); });
  $('flipV').addEventListener('click', () => { editor.setFlip(editor.flipH, !editor.flipV); syncFlip(); });
  $('shape').addEventListener('change', applyShape);
  $('radius').addEventListener('input', applyShape);
  applyShape();
  $('outSize').addEventListener('change', syncPreset);
  $('preset').addEventListener('change', syncPreset);
  syncPreset();
  $('format').addEventListener('change', syncFormat);
  syncFormat();
  $('download').addEventListener('click', download);

  $('bgOn').addEventListener('change', (e) => {
    $('bgControls').hidden = !e.target.checked;
    applyBackground();
  });
  $('bgColor').addEventListener('input', applyBackground);

  $('padOn').addEventListener('change', (e) => {
    $('padControls').hidden = !e.target.checked;
    applyPadding();
  });
  $('padAmount').addEventListener('input', applyPadding);

  $('borderOn').addEventListener('change', (e) => {
    $('borderControls').hidden = !e.target.checked;
    applyBorder();
  });
  $('borderColor').addEventListener('input', applyBorder);
  $('borderWidth').addEventListener('input', applyBorder);

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); })
  );
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  // Arrow-key nudge to fine-tune the crop position (drag + scroll-zoom only,
  // until now). Each press pans the image a few canvas px via the existing
  // panByPixels; Shift takes a larger step. Only acts when an image is loaded
  // and focus isn't in a form control, and preventDefault stops the page from
  // scrolling. The sign matches a drag: ArrowRight reveals more of the right
  // edge (image content shifts left), mirroring pointer-drag panning.
  const NUDGE = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  document.addEventListener('keydown', (e) => {
    if (!hasImg) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const dir = NUDGE[e.key];
    if (!dir) return;
    e.preventDefault();
    const step = e.shiftKey ? 20 : 4;
    editor.panByPixels(dir[0] * step, dir[1] * step);
  });

  // Paste an image straight from the clipboard (Ctrl/Cmd+V) — screenshots or a
  // copied image drop in without saving a file first. Scan the clipboard items
  // for the first image/* entry; ignore pastes that carry no image (e.g. text).
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && /^image\//.test(it.type)) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); handleFile(f); }
        return;
      }
    }
  });
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
