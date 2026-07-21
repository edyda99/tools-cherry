// merge-pdf.js — combine several PDFs into one, in the browser.
// Uses the vendored pdf-lib (loaded globally as window.PDFLib). No network:
// files stay on the device and the merged PDF is built locally.
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

// Each item: { id, file, name, size, pages, error }
let items = [];
let seq = 0;
const MAX_FILES = 30;
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per PDF

function setStatus(msg) { $('status').textContent = msg || ''; }

function refreshButton() {
  $('mergePdf').disabled = items.length < 2;
}

// --- list ---------------------------------------------------------------
function renderList() {
  const list = $('list');
  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<p class="muted-small">No PDFs added yet. Choose or drop some above.</p>';
    refreshButton();
    return;
  }
  items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'pdf-item';
    let info;
    if (it.error) info = `<span class="muted-small"> · ${escHtml(it.error)}</span>`;
    else if (it.pages != null) info = `<span class="muted-small"> · ${it.pages} page${it.pages === 1 ? '' : 's'}</span>`;
    else info = '<span class="muted-small"> · reading…</span>';
    row.innerHTML =
      `<span class="pdf-num">${i + 1}</span>` +
      `<span class="pdf-thumb" aria-hidden="true" style="display:flex;align-items:center;justify-content:center;font-size:20px;">📄</span>` +
      `<span class="pdf-name" title="${escAttr(it.name)}">${escHtml(it.name)}${info}</span>` +
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
  items.splice(i, 1);
  renderList();
  setStatus(items.length ? '' : 'No PDFs added yet.');
}

// --- adding files ---------------------------------------------------------
function isPdf(file) {
  return file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
}

function addFiles(fileList) {
  const files = [...fileList].filter(isPdf);
  if (files.length === 0) {
    setStatus('Those files are not PDFs — please choose .pdf files.');
    return;
  }
  let skipped = 0;
  const added = [];
  for (const file of files) {
    if (items.length + added.length >= MAX_FILES) { skipped++; continue; }
    if (file.size > MAX_BYTES) { skipped++; continue; }
    const id = ++seq;
    const it = { id, file, name: file.name || 'document.pdf', size: file.size, pages: null, error: null };
    items.push(it);
    added.push(it);
  }
  renderList();
  if (skipped > 0) {
    setStatus(`Added ${added.length} PDF(s). Skipped ${skipped} (too large or over the ${MAX_FILES}-file limit).`);
  } else if (added.length > 0) {
    setStatus(`Added ${added.length} PDF(s). Reorder them below, then merge.`);
  }

  // Read each new file's page count for the list (doesn't block adding).
  for (const it of added) {
    readPageCount(it);
  }
}

async function readPageCount(it) {
  if (!window.PDFLib || !window.PDFLib.PDFDocument) return;
  try {
    const buf = await it.file.arrayBuffer();
    const doc = await window.PDFLib.PDFDocument.load(buf, { ignoreEncryption: false });
    it.pages = doc.getPageCount();
  } catch (err) {
    it.error = classifyError(err);
  }
  renderList();
}

function classifyError(err) {
  const msg = ((err && err.message) || '').toLowerCase();
  if (msg.includes('encrypt')) return 'password-protected — will be skipped';
  return 'not a valid PDF — will be skipped';
}

// --- merge ------------------------------------------------------------------
async function mergePdfs() {
  if (items.length < 2) return;
  if (!window.PDFLib || !window.PDFLib.PDFDocument) {
    setStatus('PDF library failed to load — please refresh and try again.');
    return;
  }
  const btn = $('mergePdf');
  btn.disabled = true;
  $('clearAll').disabled = true;
  const { PDFDocument } = window.PDFLib;

  const mergedPdf = await PDFDocument.create();
  let mergedCount = 0;
  const skipped = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    setStatus(`Merging… file ${i + 1} of ${items.length}`);
    try {
      const buf = await it.file.arrayBuffer();
      const donorDoc = await PDFDocument.load(buf, { ignoreEncryption: false });
      const indices = donorDoc.getPageIndices();
      const copiedPages = await mergedPdf.copyPages(donorDoc, indices);
      copiedPages.forEach((page) => mergedPdf.addPage(page));
      mergedCount++;
    } catch (err) {
      skipped.push({ name: it.name, reason: classifyError(err) });
    }
  }

  if (mergedCount === 0) {
    setStatus('Sorry — none of those PDFs could be read. They may be password-protected or corrupt.');
    btn.disabled = items.length < 2;
    $('clearAll').disabled = false;
    return;
  }

  const mergedBytes = await mergedPdf.save();
  const blob = new Blob([mergedBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'merged.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  const totalPages = mergedPdf.getPageCount();
  let msg = `Done — merged ${mergedCount} file(s) into a ${totalPages}-page PDF.`;
  if (skipped.length > 0) {
    msg += ` Skipped: ${skipped.map((s) => `${s.name} (${s.reason.replace(' — will be skipped', '')})`).join(', ')}.`;
  }
  setStatus(msg);
  btn.disabled = items.length < 2;
  $('clearAll').disabled = false;
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
  $('mergePdf').addEventListener('click', mergePdfs);
  const clearBtn = $('clearAll');
  if (clearBtn) clearBtn.addEventListener('click', () => {
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

function __bootInit() {
  try {
    init();
  } catch (err) {
    showCalculatorLoadError(err);
  }
}
if (document.readyState !== 'loading') __bootInit();
else document.addEventListener('DOMContentLoaded', __bootInit);
