// compress-pdf.js — shrink a PDF's file size by rendering every page to a
// JPEG image and rebuilding it as a new PDF, entirely in the browser. Uses
// the vendored pdf.js (window.pdfjsLib) to render each page onto an offscreen
// canvas, and the vendored jsPDF (window.jspdf) to reassemble the JPEGs into
// a new PDF. No network: the file is read, rendered, and rebuilt locally.
//
// This always rasterizes every page — any real, selectable text becomes part
// of a flat image and is no longer selectable or searchable. That trade-off
// is disclosed up front in the UI (a warning before compressing text-heavy
// PDFs) and in the page copy, not just buried here.

import { formatBytes } from '/assets/canvas-math.js';
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// Compression levels: DPI drives render resolution (viewport scale = DPI/72,
// since pdf.js viewport scale 1.0 = 72 DPI = 1 PDF point per pixel), quality
// drives the JPEG encoder. These exact numbers are quoted in the page's FAQ
// copy too — keep them in sync if changed.
const LEVELS = {
  smaller: { dpi: 100, quality: 0.5, label: 'Smaller file' },
  balanced: { dpi: 120, quality: 0.65, label: 'Balanced' },
  higher: { dpi: 150, quality: 0.8, label: 'Higher quality' },
};

// Cheap text-detection heuristic: sample only the first (up to) 3 pages
// rather than walking a whole 200-page document just to decide whether to
// show a warning banner.
const TEXT_SAMPLE_PAGES = 3;
const TEXT_WARNING_AVG_CHARS = 100; // avg chars/page across the sample

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.js';
}

let selectedFile = null;
let pdfDoc = null; // last-loaded pdf.js PDFDocumentProxy
let pageCount = 0;
let baseName = 'document';
let originalBytes = 0;
let lastBlob = null;
let lastUrl = null;

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = 'muted-small' + (kind ? ' ' + kind : '');
}

function isPdf(file) {
  return file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
}

function classifyError(err) {
  if (err && err.name === 'PasswordException') {
    return 'This PDF is password-protected — remove the password first, then try again.';
  }
  return 'That does not look like a valid PDF — it may be corrupt or a different file type.';
}

function resetDownload() {
  if (lastUrl) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = null;
  }
  lastBlob = null;
  const dl = $('download');
  dl.hidden = true;
  dl.style.display = 'none';
}

function resetTool() {
  selectedFile = null;
  pdfDoc = null;
  pageCount = 0;
  originalBytes = 0;
  resetDownload();
  $('compressBtn').disabled = true;
  $('pageInfo').textContent = '';
  $('textWarning').hidden = true;
}

// Sums selectable-text character counts across the first few pages. A high
// average means this PDF carries real text that compressing will destroy.
async function detectTextHeavy(pdf) {
  const sampleCount = Math.min(TEXT_SAMPLE_PAGES, pdf.numPages);
  let totalChars = 0;
  for (let p = 1; p <= sampleCount; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) totalChars += (item.str || '').length;
    if (typeof page.cleanup === 'function') page.cleanup();
  }
  return sampleCount > 0 && totalChars / sampleCount > TEXT_WARNING_AVG_CHARS;
}

async function pickFile(file) {
  resetTool();
  if (!file) {
    setStatus('Choose a PDF to begin.');
    return;
  }
  if (!isPdf(file)) {
    setStatus('That is not a PDF — please choose a .pdf file.', 'error');
    return;
  }
  if (file.size > MAX_BYTES) {
    setStatus(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 50 MB.`, 'error');
    return;
  }
  if (!window.pdfjsLib) {
    setStatus('PDF library failed to load — please refresh and try again.', 'error');
    return;
  }
  setStatus('Reading your PDF…');
  try {
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    pdfDoc = pdf;
    selectedFile = file;
    pageCount = pdf.numPages;
    originalBytes = file.size;
    baseName = (file.name || 'document.pdf').replace(/\.pdf$/i, '');
    $('dropText').textContent = file.name;
    $('pageInfo').textContent = `${pageCount} page${pageCount === 1 ? '' : 's'} · ${formatBytes(file.size)}.`;
    $('compressBtn').disabled = false;
    setStatus(`Ready: ${file.name} (${pageCount} page${pageCount === 1 ? '' : 's'}, ${formatBytes(file.size)}).`);

    const textHeavy = await detectTextHeavy(pdf);
    $('textWarning').hidden = !textHeavy;
  } catch (err) {
    setStatus(classifyError(err), 'error');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  lastUrl = url;
  lastBlob = blob;
  const dl = $('download');
  dl.href = url;
  dl.download = filename;
  dl.hidden = false;
  dl.style.display = '';
  dl.textContent = `Download ${filename}`;
}

function selectedLevel() {
  const checked = document.querySelector('input[name="level"]:checked');
  const key = checked ? checked.value : 'balanced';
  return LEVELS[key] || LEVELS.balanced;
}

async function runCompress() {
  if (!selectedFile || !pdfDoc) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    setStatus('PDF library failed to load — please refresh and try again.', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const level = selectedLevel();
  const scale = level.dpi / 72; // pdf.js viewport scale 1.0 = 72 DPI

  const btn = $('compressBtn');
  btn.disabled = true;
  resetDownload();
  setStatus(`Compressing… page 1 of ${pageCount}`);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let doc = null;

  try {
    for (let p = 1; p <= pageCount; p++) {
      setStatus(`Compressing… page ${p} of ${pageCount}`);
      const page = await pdfDoc.getPage(p);
      const renderViewport = page.getViewport({ scale });
      const ptViewport = page.getViewport({ scale: 1 }); // page size in PDF points

      canvas.width = Math.max(1, Math.round(renderViewport.width));
      canvas.height = Math.max(1, Math.round(renderViewport.height));
      ctx.fillStyle = '#ffffff'; // flatten transparency to white before JPEG encode
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

      const dataUrl = canvas.toDataURL('image/jpeg', level.quality);
      const ptW = ptViewport.width;
      const ptH = ptViewport.height;
      const orientation = ptW > ptH ? 'landscape' : 'portrait';

      if (!doc) {
        doc = new jsPDF({ unit: 'pt', format: [ptW, ptH], orientation });
      } else {
        doc.addPage([ptW, ptH], orientation);
      }
      doc.addImage(dataUrl, 'JPEG', 0, 0, ptW, ptH);

      if (typeof page.cleanup === 'function') page.cleanup();
    }

    const blob = doc.output('blob');
    const filename = `${baseName}-compressed.pdf`;
    downloadBlob(blob, filename);

    if (blob.size < originalBytes) {
      const savedPct = Math.round((1 - blob.size / originalBytes) * 100);
      setStatus(
        `Done — ${formatBytes(originalBytes)} → ${formatBytes(blob.size)} (${savedPct}% smaller). Click the download link above.`,
        'success'
      );
    } else {
      setStatus(
        `Done, but this file was already efficient — the result (${formatBytes(blob.size)}) is not smaller than the original (${formatBytes(originalBytes)}). You can still download it below, or try the "Smaller file" level instead.`
      );
    }
  } catch (err) {
    setStatus(classifyError(err), 'error');
  } finally {
    btn.disabled = !(selectedFile && pdfDoc);
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

  $('compressBtn').addEventListener('click', runCompress);

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
