// photo-maker.js — passport/ID photo maker on the shared CanvasEditor.
// Spec presets sized to official dimensions; head-position guide; 4x6 print sheet.
import { CanvasEditor } from '/assets/canvas-editor.js';

const $ = (id) => document.getElementById(id);
const DATA = window.__PHOTO_SPECS__ || { specs: [], printSheet: {} };
const MAX_DISPLAY_H = 360;

let editor, current, hasImg = false, sheetSpec;

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

// Head-position guide sized from the spec's chin-to-crown range.
// Draws the allowed head-height BAND (crown range at top, chin range at bottom)
// plus an averaged oval, so the user can size the head to land inside the band.
function drawGuide(spec) {
  const svg = $('guide');
  const W = spec.widthPx, H = spec.heightPx;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const cx = W / 2;
  const topMargin = H * 0.08;                            // crown of a max-height head sits here
  // px positions of the chin for the smallest and largest allowed head heights
  const chinMin = topMargin + (spec.headMinMm / spec.heightMm) * H; // smallest head -> highest chin
  const chinMax = topMargin + (spec.headMaxMm / spec.heightMm) * H; // largest head -> lowest chin
  const headMidMm = (spec.headMinMm + spec.headMaxMm) / 2;
  const ovalH = (headMidMm / spec.heightMm) * H;
  const ovalW = ovalH * 0.74;                            // typical head width:height
  const cy = topMargin + ovalH / 2;
  const c = '#2ea043';
  const label = (y, txt, anchor) =>
    `<text x="${anchor === 'top' ? W - 8 : W - 8}" y="${y}" text-anchor="end" ` +
    `font-family="system-ui,sans-serif" font-size="${Math.round(H * 0.035)}" ` +
    `fill="${c}" opacity="0.9" dominant-baseline="${anchor === 'top' ? 'hanging' : 'auto'}">${txt}</text>`;
  svg.innerHTML =
    // shaded allowed band for the chin line
    `<rect x="0" y="${chinMin}" width="${W}" height="${chinMax - chinMin}" fill="${c}" opacity="0.10"/>` +
    // crown line (top of head)
    `<line x1="0" y1="${topMargin}" x2="${W}" y2="${topMargin}" stroke="${c}" stroke-width="2" stroke-dasharray="8 6" opacity="0.8"/>` +
    // chin band edges
    `<line x1="0" y1="${chinMin}" x2="${W}" y2="${chinMin}" stroke="${c}" stroke-width="2" stroke-dasharray="8 6" opacity="0.8"/>` +
    `<line x1="0" y1="${chinMax}" x2="${W}" y2="${chinMax}" stroke="${c}" stroke-width="2" stroke-dasharray="8 6" opacity="0.8"/>` +
    // averaged head oval
    `<ellipse cx="${cx}" cy="${cy}" rx="${ovalW / 2}" ry="${ovalH / 2}" ` +
    `fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="10 8" opacity="0.85"/>` +
    // vertical centre line
    `<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="${c}" stroke-width="1" opacity="0.35"/>` +
    label(topMargin + 4, 'crown', 'top') +
    label((chinMin + chinMax) / 2 + 4, 'chin', 'bottom');
}

// Parse a #rrggbb spec background into RGB.
function hexToRgb(hex) {
  const h = (hex || '#ffffff').replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// Background readiness hint: sample the four corner patches of the UPLOADED image,
// then warn (without altering anything) if the background looks dark, busy/uneven,
// or far from the spec's required white/grey. No AI, no background removal — US/UK/CA
// rules forbid digitally altering the background, so this only advises the user.
function checkBackground(spec) {
  const hint = $('bgHint');
  const img = editor && editor.img;
  if (!img) { hint.style.display = 'none'; return; }
  try {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const s = Math.max(4, Math.round(Math.min(W, H) * 0.08)); // corner patch size
    const cv = document.createElement('canvas');
    cv.width = s; cv.height = s;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const corners = [[0, 0], [W - s, 0], [0, H - s], [W - s, H - s]];
    const avgs = corners.map(([sx, sy]) => {
      ctx.clearRect(0, 0, s, s);
      ctx.drawImage(img, sx, sy, s, s, 0, 0, s, s);
      const d = ctx.getImageData(0, 0, s, s).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      return { r: r / n, g: g / n, b: b / n };
    });
    const mean = avgs.reduce((a, c) => ({ r: a.r + c.r / 4, g: a.g + c.g / 4, b: a.b + c.b / 4 }), { r: 0, g: 0, b: 0 });
    const lum = (0.299 * mean.r + 0.587 * mean.g + 0.114 * mean.b);
    // Spread between corners -> busy/uneven background (shadows, patterns, scenery).
    const spread = Math.max(...avgs.map((c) => Math.abs(c.r - mean.r) + Math.abs(c.g - mean.g) + Math.abs(c.b - mean.b)));
    const want = hexToRgb(spec.background);
    const dist = Math.abs(mean.r - want.r) + Math.abs(mean.g - want.g) + Math.abs(mean.b - want.b);
    const bgName = (spec.background || '').toLowerCase() === '#ffffff' ? 'white' : 'light grey';

    let msg, ok;
    if (spread > 60) {
      ok = false;
      msg = `Background looks busy or uneven (shadows, pattern, or scenery in the corners). ` +
        `${spec.label.split(' — ')[0]} needs a plain, evenly-lit ${bgName} background.`;
    } else if (lum < 110) {
      ok = false;
      msg = `Background looks dark. ${spec.label.split(' — ')[0]} needs a plain ${bgName} background — ` +
        `retake against a brighter ${bgName} wall.`;
    } else if (dist > 150) {
      ok = false;
      msg = `Background colour looks off for a ${bgName} background. Retake against a plain ${bgName} wall for the best chance of acceptance.`;
    } else {
      ok = true;
      msg = `Background looks plain and close to the required ${bgName} — good. ` +
        `(This is a guide only; lighting and shadows are still judged by the issuing authority.)`;
    }
    hint.textContent = (ok ? 'Background check: ' : 'Heads up — ') + msg;
    hint.style.color = ok ? 'var(--accent, #2ea043)' : '#c9510c';
    hint.style.display = '';
  } catch (e) {
    hint.style.display = 'none'; // tainted canvas / decode issue — skip silently
  }
}

async function handleFile(file) {
  try {
    await editor.loadFile(file);
    $('zoom').value = '1';
    hasImg = true;
    $('dlPhoto').disabled = false;
    $('dlSheet').disabled = false;
    $('dropText').textContent = `Loaded: ${file.name}`;
    $('status').textContent =
      `Zoom so the crown touches the top line and the chin sits in the shaded band ` +
      `(head height ${current.headMinMm}–${current.headMaxMm} mm).`;
    checkBackground(current);
  } catch (e) {
    $('status').textContent = 'Could not load that file — please choose a valid image.';
  }
}

// Selected output format -> mime/extension. JPG has no alpha, but the rect
// editor fills the whole frame with the spec background, so the export is opaque.
function outFormat() {
  const jpg = $('format').value === 'jpg';
  return jpg
    ? { type: 'image/jpeg', ext: 'jpg', quality: 0.95 }
    : { type: 'image/png', ext: 'png', quality: 0.92 };
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
  const f = outFormat();
  const blob = await editor.toBlob({ type: f.type, quality: f.quality, width: current.widthPx, height: current.heightPx });
  if (blob) { triggerDownload(blob, `${current.id}.${f.ext}`); $('status').textContent = `Downloaded ${current.widthPx}×${current.heightPx} ${f.ext.toUpperCase()} photo.`; }
}

async function downloadSheet() {
  if (!hasImg) return;
  const ps = sheetSpec || DATA.printSheet;
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
  const f = outFormat();
  const sizeId = ps.id || '4x6';
  const sizeLabel = ps.label || '4×6';
  sheet.toBlob((blob) => {
    if (blob) { triggerDownload(blob, `${current.id}-${sizeId}-sheet.${f.ext}`); $('status').textContent = `Downloaded ${sizeLabel} sheet (${cols * rows} photos).`; }
  }, f.type, f.quality);
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
    if (hasImg) checkBackground(spec); // re-evaluate against the new spec's required background
  });
  applySpec(DATA.specs[0]);

  // Print-sheet size selector (falls back to the legacy single 4×6 sheet).
  const sheetSel = $('sheetSize');
  const sizes = (DATA.printSheet && DATA.printSheet.sizes) || [];
  if (sizes.length) {
    sizes.forEach((sz) => {
      const o = document.createElement('option');
      o.value = sz.id; o.textContent = sz.label;
      sheetSel.appendChild(o);
    });
    sheetSpec = sizes[0];
    sheetSel.addEventListener('change', () => {
      sheetSpec = sizes.find((sz) => sz.id === sheetSel.value) || sizes[0];
    });
  } else {
    sheetSpec = DATA.printSheet;
  }

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
