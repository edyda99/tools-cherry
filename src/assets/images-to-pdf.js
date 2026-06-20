// images-to-pdf.js — combine several images into one PDF, in the browser.
// Reuses the vendored jsPDF (loaded globally as window.jspdf) and the pure
// page-placement math from the shared canvas engine. No network: the files
// stay on the device and the PDF is generated locally.
import { pdfPagePlacement } from '/assets/canvas-math.js';

const $ = (id) => document.getElementById(id);

// Page sizes in PostScript points (1/72 inch), portrait orientation.
const PAGE_SIZES = {
  a4: { w: 595.28, h: 841.89, format: 'a4' },
  letter: { w: 612, h: 792, format: 'letter' }
};

// Each item: { id, file, url, name, width, height }
let items = [];
let seq = 0;
const MAX_FILES = 100;
const MAX_BYTES = 30 * 1024 * 1024; // 30 MB per image — keep memory sane

function setStatus(msg) { $('status').textContent = msg || ''; }

function refreshButton() {
  $('makePdf').disabled = items.length === 0;
}

// --- thumbnail list ----------------------------------------------------------
function renderList() {
  const list = $('list');
  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<p class="muted-small">No images added yet. Choose or drop some above.</p>';
    refreshButton();
    return;
  }
  items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'pdf-item';
    const dims = it.width ? `${it.width}×${it.height}` : '…';
    row.innerHTML =
      `<span class="pdf-num">${i + 1}</span>` +
      `<img class="pdf-thumb" alt="Thumbnail of ${escAttr(it.name)}" src="${it.url}">` +
      `<span class="pdf-name" title="${escAttr(it.name)}">${escHtml(it.name)}` +
      `<span class="muted-small"> · ${dims}</span></span>` +
      `<span class="pdf-actions">` +
      `<button type="button" class="mv" data-act="up" title="Move up" aria-label="Move ${escAttr(it.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>` +
      `<button type="button" class="mv" data-act="down" title="Move down" aria-label="Move ${escAttr(it.name)} down" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>` +
      `<button type="button" class="rm" data-act="remove" title="Remove" aria-label="Remove ${escAttr(it.name)}">×</button>` +
      `</span>`;
    row.querySelector('[data-act="up"]').addEventListener('click', () => move(it.id, -1));
    row.querySelector('[data-act="down"]').addEventListener('click', () => move(it.id, 1));
    row.querySelector('[data-act="remove"]').addEventListener('click', () => remove(it.id));
    list.appendChild(row);
  });
  refreshButton();
}

function move(id, delta) {
  const i = items.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  renderList();
}

function remove(id) {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return;
  URL.revokeObjectURL(items[i].url);
  items.splice(i, 1);
  renderList();
  setStatus(items.length ? '' : 'No images added yet.');
}

// --- adding files ------------------------------------------------------------
function addFiles(fileList) {
  const files = [...fileList].filter((f) => f && /^image\//.test(f.type));
  if (files.length === 0) {
    setStatus('Those files are not images — please choose JPG, PNG, or WebP.');
    return;
  }
  let skipped = 0;
  for (const file of files) {
    if (items.length >= MAX_FILES) { skipped++; continue; }
    if (file.size > MAX_BYTES) { skipped++; continue; }
    const id = ++seq;
    const url = URL.createObjectURL(file);
    const it = { id, file, url, name: file.name || 'image', width: 0, height: 0 };
    items.push(it);
    // read intrinsic dimensions for the list + page placement
    const im = new Image();
    im.onload = () => { it.width = im.width; it.height = im.height; renderList(); };
    im.onerror = () => { it.width = 0; it.height = 0; };
    im.src = url;
  }
  renderList();
  if (skipped > 0) {
    setStatus(`Added ${files.length - skipped} image(s). Skipped ${skipped} (too large or over the ${MAX_FILES}-image limit).`);
  } else {
    setStatus(`Added ${files.length} image(s). Reorder them below, then make your PDF.`);
  }
}

// --- load one image element for drawing onto the export canvas ---------------
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('decode failed'));
    im.src = url;
  });
}

// Encode an image element to a JPEG data URL via canvas (keeps the PDF small
// and gives a consistent format jsPDF can always embed).
function toJpegDataUrl(im) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, im.naturalWidth || im.width);
  cv.height = Math.max(1, im.naturalHeight || im.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; // flatten any transparency to white
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(im, 0, 0);
  return cv.toDataURL('image/jpeg', 0.92);
}

// --- build the PDF -----------------------------------------------------------
async function makePdf() {
  if (items.length === 0) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    setStatus('PDF library failed to load — please refresh and try again.');
    return;
  }
  const btn = $('makePdf');
  btn.disabled = true;
  const { jsPDF } = window.jspdf;

  const sizeKey = $('pageSize').value in PAGE_SIZES ? $('pageSize').value : 'a4';
  const size = PAGE_SIZES[sizeKey];
  const orientation = $('orientation').value; // auto | portrait | landscape
  const margin = $('fit').value === 'margin' ? 28 : 0; // ~0.4in margin when fit-to-page

  // jsPDF needs a starting orientation/format; we set each page explicitly below.
  const first = orderForImage(items[0], size, orientation);
  const doc = new jsPDF({
    unit: 'pt',
    format: size.format,
    orientation: first.orientation === 'landscape' ? 'landscape' : 'portrait'
  });

  let added = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    setStatus(`Building PDF… ${i + 1} of ${items.length}`);
    try {
      const im = await loadImage(it.url);
      const w = im.naturalWidth || im.width;
      const h = im.naturalHeight || im.height;
      const p = pdfPagePlacement(w, h, size.w, size.h, { orientation, margin });

      if (added > 0) {
        doc.addPage([p.pageW, p.pageH], p.orientation === 'landscape' ? 'landscape' : 'portrait');
      }
      const data = toJpegDataUrl(im);
      doc.addImage(data, 'JPEG', p.x, p.y, p.w, p.h);
      added++;
    } catch {
      // skip an image that fails to decode rather than aborting the whole PDF
    }
  }

  if (added === 0) {
    setStatus('Sorry — none of those images could be read. Please try different files.');
    btn.disabled = false;
    return;
  }

  doc.save('images.pdf');
  setStatus(`Done — saved a PDF with ${added} page(s).`);
  btn.disabled = false;
}

// Resolve the orientation the first page will use (for jsPDF construction).
function orderForImage(it, size, orientation) {
  return pdfPagePlacement(it.width || 1, it.height || 1, size.w, size.h, { orientation, margin: 0 });
}

// --- escaping helpers --------------------------------------------------------
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}

// --- wiring ------------------------------------------------------------------
function init() {
  $('file').addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) addFiles(e.target.files);
    e.target.value = ''; // allow re-selecting the same file
  });
  $('makePdf').addEventListener('click', makePdf);
  const clearBtn = $('clearAll');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    items.forEach((it) => URL.revokeObjectURL(it.url));
    items = [];
    renderList();
    setStatus('Cleared.');
  });

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); })
  );
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files;
    if (f && f.length) addFiles(f);
  });

  renderList();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
