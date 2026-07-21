// split-pdf.js — extract a page range or split every page into its own file,
// entirely in the browser. Uses the vendored pdf-lib (window.PDFLib). No
// network: the file is read and rebuilt locally, nothing is uploaded.
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

let selectedFile = null;
let sourceDoc = null; // last-loaded PDFDocument (kept so we don't re-read the file per action)
let pageCount = 0;
let baseName = 'document';

function setStatus(msg, isError) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = 'muted-small' + (isError ? ' error' : '');
}

function isPdf(file) {
  return file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
}

function classifyError(err) {
  const msg = ((err && err.message) || '').toLowerCase();
  if (msg.includes('encrypt')) return 'This PDF is password-protected — remove the password first, then try again.';
  return 'That does not look like a valid PDF — it may be corrupt or a different file type.';
}

function resetTool() {
  selectedFile = null;
  sourceDoc = null;
  pageCount = 0;
  $('splitBtn').disabled = true;
  $('pageInfo').textContent = '';
  $('range').value = '';
}

function updateModeUI() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const rangeField = $('rangeField');
  rangeField.style.display = mode === 'range' ? '' : 'none';
  $('splitBtn').textContent = mode === 'range' ? 'Extract pages' : 'Split every page';
}

async function pickFile(file) {
  resetTool();
  if (!file) { setStatus('Choose a PDF to begin.'); return; }
  if (!isPdf(file)) {
    setStatus('That is not a PDF — please choose a .pdf file.', true);
    return;
  }
  if (file.size > MAX_BYTES) {
    setStatus(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 50 MB.`, true);
    return;
  }
  if (!window.PDFLib || !window.PDFLib.PDFDocument) {
    setStatus('PDF library failed to load — please refresh and try again.', true);
    return;
  }
  setStatus('Reading your PDF…');
  try {
    const buf = await file.arrayBuffer();
    const doc = await window.PDFLib.PDFDocument.load(buf, { ignoreEncryption: false });
    sourceDoc = doc;
    selectedFile = file;
    pageCount = doc.getPageCount();
    baseName = (file.name || 'document.pdf').replace(/\.pdf$/i, '');
    $('dropText').textContent = file.name;
    $('pageInfo').textContent = `${pageCount} page${pageCount === 1 ? '' : 's'} detected.`;
    $('splitBtn').disabled = false;
    setStatus(`Ready: ${file.name} (${pageCount} page${pageCount === 1 ? '' : 's'}).`);
  } catch (err) {
    setStatus(classifyError(err), true);
  }
}

// Parses '1-3,5,8-10' into a 1-based, order-preserved list of page numbers.
// Returns { pages } on success or { error } on a validation failure.
function parseRange(input, maxPage) {
  const trimmed = (input || '').trim();
  if (!trimmed) return { error: 'Please enter a page range, e.g. 1-3,5,8-10.' };
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { error: 'Please enter a page range, e.g. 1-3,5,8-10.' };

  const pages = [];
  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    const singleMatch = part.match(/^(\d+)$/);
    if (rangeMatch) {
      let a = parseInt(rangeMatch[1], 10);
      let b = parseInt(rangeMatch[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let p = a; p <= b; p++) pages.push(p);
    } else if (singleMatch) {
      pages.push(parseInt(singleMatch[1], 10));
    } else {
      return { error: `"${part}" isn't a valid page or range — please use a format like 1-3,5,8-10.` };
    }
  }
  for (const p of pages) {
    if (p < 1 || p > maxPage) {
      return { error: `Page ${p} is out of range — this PDF has ${maxPage} page${maxPage === 1 ? '' : 's'}.` };
    }
  }
  return { pages };
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractRange() {
  const { PDFDocument } = window.PDFLib;
  const result = parseRange($('range').value, pageCount);
  if (result.error) {
    setStatus(result.error, true);
    return;
  }
  setStatus('Extracting pages…');
  const indices = result.pages.map((p) => p - 1);
  const outDoc = await PDFDocument.create();
  const copiedPages = await outDoc.copyPages(sourceDoc, indices);
  copiedPages.forEach((page) => outDoc.addPage(page));
  const bytes = await outDoc.save();
  downloadBytes(bytes, `${baseName}-pages.pdf`);
  setStatus(`Done — downloaded a ${indices.length}-page PDF (${baseName}-pages.pdf).`);
}

async function splitAllPages() {
  const { PDFDocument } = window.PDFLib;
  const indices = sourceDoc.getPageIndices();
  setStatus(`Splitting… your browser will download ${indices.length} file(s), one per page.`);
  for (let i = 0; i < indices.length; i++) {
    setStatus(`Downloading page ${i + 1} of ${indices.length}…`);
    const outDoc = await PDFDocument.create();
    const [copiedPage] = await outDoc.copyPages(sourceDoc, [indices[i]]);
    outDoc.addPage(copiedPage);
    const bytes = await outDoc.save();
    downloadBytes(bytes, `${baseName}-page-${i + 1}.pdf`);
    // Small pause between downloads so the browser's download manager (and
    // the user) can keep up — triggering dozens of downloads in one tick can
    // cause a browser to silently drop some.
    await sleep(200);
  }
  setStatus(`Done — downloaded ${indices.length} separate page file(s).`);
}

async function runSplit() {
  if (!selectedFile || !sourceDoc) return;
  if (!window.PDFLib || !window.PDFLib.PDFDocument) {
    setStatus('PDF library failed to load — please refresh and try again.', true);
    return;
  }
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const btn = $('splitBtn');
  btn.disabled = true;
  try {
    if (mode === 'range') await extractRange();
    else await splitAllPages();
  } catch (err) {
    setStatus(classifyError(err), true);
  } finally {
    btn.disabled = !(selectedFile && sourceDoc);
  }
}

function init() {
  $('file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) pickFile(f);
    e.target.value = ''; // allow re-selecting the same file
  });

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); })
  );
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) pickFile(f);
  });

  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', updateModeUI));
  $('splitBtn').addEventListener('click', runSplit);

  updateModeUI();
  setStatus('Choose a PDF to begin.');
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
