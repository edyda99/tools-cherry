// photo-maker.js — passport/ID photo maker on the shared CanvasEditor.
// Spec presets sized to official dimensions; head-position guide; 4x6 print sheet.
import { CanvasEditor } from '/assets/canvas-editor.js';
import { qualityForTargetBytes } from '/assets/canvas-math.js';

const $ = (id) => document.getElementById(id);
const DATA = window.__PHOTO_SPECS__ || { specs: [], printSheet: {} };
const MAX_DISPLAY_H = 360;
// US DS-160 / DV-Lottery online photo uploads cap the JPEG at 240 KB
// (square, 600×600–1200×1200 px). Source: travel.state.gov / DS-160 portal.
// Wrong (too-large) file size is one of the most common online-upload rejections.
const ONLINE_JPG_MAX_KB = 240;

let editor, current, hasImg = false, sheetSpec, previewing = false;

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
  if (!img) { hint.style.display = 'none'; return null; }
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
    return { ok, msg };
  } catch (e) {
    hint.style.display = 'none'; // tainted canvas / decode issue — skip silently
    return null;
  }
}

// Aggregate the individual signals into one pass/fail checklist, matching the
// "validator" panel competitors (PhotoGov, PhotoAiD) show. Each row is HONEST
// about what we can actually verify client-side without a face model:
//  - Resolution: the uploaded image must have enough pixels to fill the spec at
//    its print resolution without upscaling (pass/warn — measured from img dims).
//  - Background: reuses checkBackground's corner-sample verdict (pass/warn).
//  - Head position: we CANNOT detect a face, so this is a manual reminder (info),
//    never an auto-pass — the user lines the crown/chin up with the guide.
//  - Output size: format + the US online-upload note (info).
// No spec data is added or changed; everything is derived from the upload + spec.
const STATE = { pass: 'ok', warn: 'warn', info: 'info' };
function updateChecklist(spec, bg) {
  const panel = $('checklist');
  const list = $('checkItems');
  const img = editor && editor.img;
  if (!img || !spec) { panel.style.display = 'none'; return; }

  const items = [];

  // Resolution: does the source have enough pixels for the spec at print size?
  const srcW = img.naturalWidth || img.width, srcH = img.naturalHeight || img.height;
  const enough = srcW >= spec.widthPx && srcH >= spec.heightPx;
  items.push(enough
    ? { state: STATE.pass, text: `Resolution: source is ${srcW}×${srcH}px — enough for a sharp ${spec.widthPx}×${spec.heightPx}px print.` }
    : { state: STATE.warn, text: `Resolution: source is ${srcW}×${srcH}px, smaller than the ${spec.widthPx}×${spec.heightPx}px needed — the print may look soft. Use a higher-resolution photo if you can.` });

  // Background: reuse the corner-sample verdict.
  if (bg) {
    items.push({ state: bg.ok ? STATE.pass : STATE.warn, text: 'Background: ' + bg.msg });
  }

  // Head position — manual, no face detection.
  items.push({ state: STATE.info, text: `Head position: line the crown up with the top dashed line and the chin inside the shaded band (head height ${spec.headMinMm}–${spec.headMaxMm} mm). Adjust with zoom and drag.` });

  // Output / file format.
  const jpg = $('format').value === 'jpg';
  items.push({ state: STATE.info, text: jpg
    ? 'Output: JPG. For US DS-160 visa / DV-Lottery online uploads, tick "Fit for US online upload" to stay under 240 KB. Printed photos don\'t need this.'
    : 'Output: PNG (lossless) — best for printing. For US online uploads, switch to JPG and tick the fit option.' });

  const icon = (s) => s === STATE.pass ? '✓' : s === STATE.warn ? '!' : 'ℹ';
  const color = (s) => s === STATE.pass ? 'var(--accent, #2ea043)' : s === STATE.warn ? '#c9510c' : 'var(--muted, #768390)';
  list.innerHTML = items.map((it) =>
    `<li style="display:flex;gap:8px;padding:3px 0">` +
    `<span aria-hidden="true" style="flex:0 0 auto;font-weight:700;color:${color(it.state)}">${icon(it.state)}</span>` +
    `<span>${esc(it.text)}</span></li>`).join('');
  panel.style.display = '';
}

// Minimal HTML-escape for text injected via innerHTML.
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Sync the rotate slider + readout to the editor's current rotation.
function syncRotate() {
  const deg = editor ? editor.rotation : 0;
  $('rotate').value = String(deg);
  $('rotateInfo').textContent = deg === 0
    ? '0°. Tilt the slider so the eyes sit level.'
    : `${deg > 0 ? '+' : ''}${deg}° rotation applied.`;
}

async function handleFile(file) {
  try {
    await editor.loadFile(file); // loadFile resets zoom/pan/rotation to defaults
    $('zoom').value = '1';
    syncRotate();
    hasImg = true;
    $('dlPhoto').disabled = false;
    $('dlSheet').disabled = false;
    $('dlSheetPdf').disabled = false;
    $('togglePreview').disabled = false;
    $('sizeHint').style.display = 'none'; // clear any prior download's size readout
    if (previewing) renderSheetPreview();
    $('dropText').textContent = `Loaded: ${file.name}`;
    $('status').textContent =
      `Zoom so the crown touches the top line and the chin sits in the shaded band ` +
      `(head height ${current.headMinMm}–${current.headMaxMm} mm).`;
    updateChecklist(current, checkBackground(current));
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

function fmtKb(bytes) {
  const kb = bytes / 1024;
  return kb >= 100 ? Math.round(kb) + ' KB' : kb.toFixed(1) + ' KB';
}

// Report the downloaded photo's real byte size (measured from the produced blob —
// no fabricated data), flagging against the 240 KB ceiling US online portals
// (DS-160 / DV-Lottery) enforce. `fitted` = we deliberately compressed to fit.
function reportFileSize(blob, ext, fitted) {
  const hint = $('sizeHint');
  const sizeTxt = fmtKb(blob.size);
  if (ext !== 'jpg') {
    hint.textContent = `File size: ${sizeTxt}.`;
    hint.style.color = 'var(--accent, #2ea043)';
  } else if (blob.size <= ONLINE_JPG_MAX_KB * 1024) {
    hint.textContent = `File size: ${sizeTxt} — within the ${ONLINE_JPG_MAX_KB} KB limit for ` +
      `US online uploads (DS-160 / DV-Lottery).` + (fitted ? ' Quality reduced to fit.' : '');
    hint.style.color = 'var(--accent, #2ea043)';
  } else {
    hint.textContent = `Heads up — this JPG is ${sizeTxt}. US online uploads (DS-160 / DV-Lottery) require ` +
      `${ONLINE_JPG_MAX_KB} KB or smaller. Tick "Fit for US online upload" above, ` +
      `or choose a smaller print size. Printed photos and DS-82 renewals have no such limit.`;
    hint.style.color = '#c9510c';
  }
  hint.style.display = '';
}

async function downloadPhoto() {
  if (!hasImg) return;
  const f = outFormat();
  const dims = { width: current.widthPx, height: current.heightPx };
  let blob, fitted = false;
  // For JPG with the online-upload option ticked, binary-search encoder quality
  // (reusing the engine's qualityForTargetBytes) so the file lands under 240 KB.
  if (f.ext === 'jpg' && $('fitOnline').checked) {
    const sizeAt = async (q) => {
      const b = await editor.toBlob({ type: 'image/jpeg', quality: q, ...dims });
      return b ? b.size : Infinity;
    };
    const { quality } = await qualityForTargetBytes(sizeAt, ONLINE_JPG_MAX_KB * 1024, { min: 0.3, max: 0.95 });
    blob = await editor.toBlob({ type: 'image/jpeg', quality, ...dims });
    fitted = true;
  } else {
    blob = await editor.toBlob({ type: f.type, quality: f.quality, ...dims });
  }
  if (blob) {
    triggerDownload(blob, `${current.id}.${f.ext}`);
    $('status').textContent = `Downloaded ${current.widthPx}×${current.heightPx} ${f.ext.toUpperCase()} photo.`;
    reportFileSize(blob, f.ext, fitted);
  }
}

// Grid geometry for tiling `current`-sized photos onto sheet `ps`.
// Max copies that fit edge-to-edge, leftover space spread as even gaps/margins.
function sheetLayout(ps) {
  const cols = Math.max(1, Math.floor(ps.widthPx / current.widthPx));
  const rows = Math.max(1, Math.floor(ps.heightPx / current.heightPx));
  const gapX = (ps.widthPx - cols * current.widthPx) / (cols + 1);
  const gapY = (ps.heightPx - rows * current.heightPx) / (rows + 1);
  return { cols, rows, gapX, gapY, count: cols * rows };
}

// Paint the tiled sheet (white bg, photos, cut guides) into `ctx` at full sheet px.
function tileSheet(ctx, ps, bmp) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, ps.widthPx, ps.heightPx);
  const { cols, rows, gapX, gapY } = sheetLayout(ps);
  ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = gapX * (c + 1) + c * current.widthPx;
      const y = gapY * (r + 1) + r * current.heightPx;
      ctx.drawImage(bmp, x, y, current.widthPx, current.heightPx);
      ctx.strokeRect(x + 0.5, y + 0.5, current.widthPx, current.heightPx); // cut guide
    }
  }
}

// Live "N copies (cols×rows)" readout under the sheet-size selector — no image needed.
function updateSheetInfo() {
  const ps = sheetSpec || DATA.printSheet;
  if (!ps || !current) return;
  const { cols, rows, count } = sheetLayout(ps);
  $('sheetInfo').textContent = `Fits ${count} photo${count === 1 ? '' : 's'} (${cols}×${rows}) with cut guides.`;
}

// Render a scaled, on-screen preview of the print sheet so the user sees the
// exact tiling + cut guides before downloading. Shown in place of the editor.
async function renderSheetPreview() {
  if (!hasImg) return;
  const ps = sheetSpec || DATA.printSheet;
  const photo = await editor.toBlob({ type: 'image/png', width: current.widthPx, height: current.heightPx });
  const bmp = await createImageBitmap(photo);
  const cv = $('sheetPreview');
  cv.width = ps.widthPx; cv.height = ps.heightPx;
  tileSheet(cv.getContext('2d'), ps, bmp);
  // CSS-scale to a reasonable on-screen height (canvas keeps full-res pixels).
  const dispH = Math.min(MAX_DISPLAY_H, ps.heightPx);
  cv.style.height = dispH + 'px';
  cv.style.width = Math.round(dispH * ps.widthPx / ps.heightPx) + 'px';
}

function setPreview(on) {
  previewing = on && hasImg;
  $('editorWrap').style.display = previewing ? 'none' : '';
  $('sheetPreview').style.display = previewing ? '' : 'none';
  const btn = $('togglePreview');
  btn.textContent = previewing ? 'Back to editor' : 'Preview sheet layout';
  btn.setAttribute('aria-pressed', previewing ? 'true' : 'false');
  if (previewing) renderSheetPreview();
}

async function downloadSheet() {
  if (!hasImg) return;
  const ps = sheetSpec || DATA.printSheet;
  const photo = await editor.toBlob({ type: 'image/png', width: current.widthPx, height: current.heightPx });
  const bmp = await createImageBitmap(photo);

  const sheet = document.createElement('canvas');
  sheet.width = ps.widthPx; sheet.height = ps.heightPx;
  tileSheet(sheet.getContext('2d'), ps, bmp);

  const f = outFormat();
  const sizeId = ps.id || '4x6';
  const sizeLabel = ps.label || '4×6';
  const { count } = sheetLayout(ps);
  sheet.toBlob((blob) => {
    if (blob) { triggerDownload(blob, `${current.id}-${sizeId}-sheet.${f.ext}`); $('status').textContent = `Downloaded ${sizeLabel} sheet (${count} photos).`; }
  }, f.type, f.quality);
}

// Print-ready PDF of the tiled sheet — same geometry as the PNG/JPG sheet, but
// placed at true physical size (px @300DPI -> points) so it prints 1:1 at any lab.
async function downloadSheetPdf() {
  if (!hasImg) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    $('status').textContent = 'PDF library failed to load — please refresh and try again.';
    return;
  }
  const ps = sheetSpec || DATA.printSheet;
  const photo = await editor.toBlob({ type: 'image/png', width: current.widthPx, height: current.heightPx });
  const bmp = await createImageBitmap(photo);

  const sheet = document.createElement('canvas');
  sheet.width = ps.widthPx; sheet.height = ps.heightPx;
  tileSheet(sheet.getContext('2d'), ps, bmp);

  // 300 DPI assumed for all sheet sizes -> physical points = px / 300 * 72.
  const DPI = 300;
  const wPt = ps.widthPx / DPI * 72;
  const hPt = ps.heightPx / DPI * 72;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation: wPt > hPt ? 'landscape' : 'portrait' });
  doc.addImage(sheet.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, wPt, hPt);
  const sizeId = ps.id || '4x6';
  const sizeLabel = ps.label || '4×6';
  const { count } = sheetLayout(ps);
  doc.save(`${current.id}-${sizeId}-sheet.pdf`);
  $('status').textContent = `Downloaded ${sizeLabel} PDF sheet (${count} photos).`;
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
    if (hasImg) updateChecklist(spec, checkBackground(spec)); // re-evaluate against the new spec
    updateSheetInfo();                 // photo dims changed -> copies-per-sheet changed
    if (previewing) renderSheetPreview();
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
      updateSheetInfo();
      if (previewing) renderSheetPreview();
    });
  } else {
    sheetSpec = DATA.printSheet;
  }
  updateSheetInfo();

  // Show the "fit for online upload" option only when JPG is selected.
  const syncFitField = () => { $('fitField').style.display = $('format').value === 'jpg' ? '' : 'none'; };
  $('format').addEventListener('change', () => {
    syncFitField();
    if (hasImg) updateChecklist(current, checkBackground(current)); // refresh the Output row
  });
  syncFitField();

  $('file').addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  $('zoom').addEventListener('input', (e) => { editor.setZoom(parseFloat(e.target.value)); if (previewing) renderSheetPreview(); });
  $('rotate').addEventListener('input', (e) => { editor.setRotation(parseFloat(e.target.value)); syncRotate(); if (previewing) renderSheetPreview(); });
  $('rotateReset').addEventListener('click', () => { editor.setRotation(0); syncRotate(); if (previewing) renderSheetPreview(); });
  $('togglePreview').addEventListener('click', () => setPreview(!previewing));
  $('dlPhoto').addEventListener('click', downloadPhoto);
  $('dlSheet').addEventListener('click', downloadSheet);
  $('dlSheetPdf').addEventListener('click', downloadSheetPdf);

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
