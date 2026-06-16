// circle-crop.js — circle image cropper built on the shared CanvasEditor.
import { CanvasEditor } from '/assets/canvas-editor.js';

const $ = (id) => document.getElementById(id);

const editor = new CanvasEditor($('editor'), { shape: 'circle', background: null });
let hasImg = false;

function setLoaded(name) {
  hasImg = true;
  $('download').disabled = false;
  $('dropText').textContent = name ? `Loaded: ${name} — drag to reposition, scroll to zoom` : 'Image loaded';
  $('status').textContent = 'Drag to reposition · scroll or use the slider to zoom';
}

function syncRotation() {
  $('rotate').value = String(editor.rotation);
  $('rotateVal').textContent = String(editor.rotation);
}

async function handleFile(file) {
  try {
    await editor.loadFile(file);
    $('zoom').value = '1';
    syncRotation();
    setLoaded(file.name);
  } catch (e) {
    $('status').textContent = 'Could not load that file — please choose a valid image.';
  }
}

function download() {
  if (!hasImg) return;
  const size = parseInt($('outSize').value, 10) || 512;
  const fmt = $('format').value === 'jpeg' ? 'jpeg' : 'png';
  // JPG has no alpha: flatten the transparent corners onto an opaque backdrop
  // (the user's chosen background color if filling, else white).
  const flatten = fmt === 'jpeg'
    ? ($('bgOn').checked ? $('bgColor').value : '#ffffff')
    : null;
  const opts = fmt === 'jpeg'
    ? { type: 'image/jpeg', quality: 0.92, width: size, height: size, flatten }
    : { type: 'image/png', width: size, height: size };
  editor.toBlob(opts).then((blob) => {
    if (!blob) return;
    const ext = fmt === 'jpeg' ? 'jpg' : 'png';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `circle-crop.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('status').textContent = `Downloaded ${size}×${size} ${ext.toUpperCase()}.`;
  });
}

function syncFormat() {
  const jpg = $('format').value === 'jpeg';
  $('download').textContent = jpg ? 'Download JPG' : 'Download PNG';
  $('jpgNote').hidden = !jpg;
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
  $('outSize').addEventListener('change', () => {});
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
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
