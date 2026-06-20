// PDF -> Word (.docx) converter — runs entirely in the browser.
// Uses the vendored pdf.js (window.pdfjsLib) to read the PDF's text layer and the
// vendored docx library (window.docx) to build an editable .docx. No server, no
// upload: the file never leaves the device. Works best on text-based PDFs; scanned
// (image-only) PDFs have no text layer to extract, so there is nothing to convert.

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — generous; conversion runs on your own device

const $ = (id) => document.getElementById(id);
const fileInput = $('file');
const drop = $('drop');
const dropText = $('dropText');
const status = $('status');
const convertBtn = $('convert');
const clearBtn = $('clear');
const download = $('download');
const serverFallback = $('serverFallback');
const serverConvertBtn = $('serverConvert');
const serverStatus = $('serverStatus');
const serverDownload = $('serverDownload');

let selected = null;
let lastUrl = null;
let serverLastUrl = null;
let tsToken = null;
let tsWidgetId = null;
let pendingServerSubmit = false;

// pdf.js runs its parser in a Web Worker, vendored alongside this script.
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.js';
}

function setStatus(msg, kind) {
  status.textContent = msg;
  status.className = 'muted-small' + (kind ? ' ' + kind : '');
}

function resetDownload() {
  if (lastUrl) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = null;
  }
  download.hidden = true;
  download.style.display = 'none';
}

function pickFile(file) {
  resetDownload();
  resetServerDownload();
  setServerStatus('');
  if (serverFallback) serverFallback.hidden = true;
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    selected = null;
    convertBtn.disabled = true;
    setStatus('That is not a PDF. Please choose a .pdf file.', 'error');
    return;
  }
  if (file.size > MAX_BYTES) {
    selected = null;
    convertBtn.disabled = true;
    setStatus(`That PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 50 MB.`, 'error');
    return;
  }
  selected = file;
  convertBtn.disabled = false;
  dropText.textContent = file.name;
  setStatus(`Ready: ${file.name} (${(file.size / 1024).toFixed(0)} KB). Click "Convert to Word".`);
  if (serverFallback) serverFallback.hidden = false;
}

fileInput.addEventListener('change', () => pickFile(fileInput.files[0]));

['dragenter', 'dragover'].forEach((e) =>
  drop.addEventListener(e, (ev) => {
    ev.preventDefault();
    drop.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((e) =>
  drop.addEventListener(e, (ev) => {
    ev.preventDefault();
    drop.classList.remove('dragover');
  })
);
drop.addEventListener('drop', (ev) => {
  const f = ev.dataTransfer && ev.dataTransfer.files[0];
  if (f) pickFile(f);
});

clearBtn.addEventListener('click', () => {
  selected = null;
  fileInput.value = '';
  convertBtn.disabled = true;
  dropText.textContent = 'Click to choose a PDF, or drop it here';
  resetDownload();
  resetServerDownload();
  setServerStatus('');
  if (serverFallback) serverFallback.hidden = true;
  setStatus('Choose a PDF to begin.');
});

// --- text reconstruction -----------------------------------------------------

// Group a page's text fragments into visual lines (top -> bottom, left -> right).
// pdf.js gives positioned fragments, not logical lines, so we cluster by baseline.
function buildLines(items) {
  const recs = items
    .map((it) => ({
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      h: it.height || Math.hypot(it.transform[2], it.transform[3]) || 12,
      s: it.str || '',
    }))
    .filter((r) => r.s.length > 0);
  if (!recs.length) return [];

  // Top-to-bottom (PDF y grows upward, so larger y first), then left-to-right.
  recs.sort((a, b) => (Math.abs(a.y - b.y) > 1 ? b.y - a.y : a.x - b.x));

  const lines = [];
  let cur = null;
  for (const r of recs) {
    const tol = Math.max(2, r.h * 0.5);
    if (cur && Math.abs(cur.y - r.y) <= tol) {
      cur.parts.push(r);
      cur.fontSize = Math.max(cur.fontSize, r.h);
    } else {
      cur = { y: r.y, fontSize: r.h, parts: [r] };
      lines.push(cur);
    }
  }
  for (const ln of lines) {
    ln.parts.sort((a, b) => a.x - b.x);
    ln.text = joinLine(ln.parts);
  }
  return lines.filter((ln) => ln.text.trim().length > 0);
}

// Concatenate one line's fragments, inserting a space where there is a real gap.
function joinLine(parts) {
  let out = '';
  let prevEnd = null;
  for (const p of parts) {
    if (prevEnd !== null) {
      const gap = p.x - prevEnd;
      if (gap > Math.max(1, p.h * 0.25) && !/\s$/.test(out) && !/^\s/.test(p.s)) out += ' ';
    }
    out += p.s;
    prevEnd = p.x + p.w;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

function median(nums) {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Merge lines into paragraphs using vertical gaps; treat clearly larger text as
// a heading and keep it on its own paragraph.
function buildParagraphs(lines, bodySize) {
  const paras = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const isHeading = ln.fontSize >= bodySize * 1.4 && ln.text.length <= 120;
    const prev = lines[i - 1];
    const bigGap = prev && prev.y - ln.y > bodySize * 1.8;

    if (!cur || isHeading || bigGap || cur.isHeading) {
      cur = { text: ln.text, fontSize: ln.fontSize, isHeading };
      paras.push(cur);
    } else {
      cur.text += ' ' + ln.text;
      cur.fontSize = Math.max(cur.fontSize, ln.fontSize);
    }
  }
  return paras;
}

// Convert the whole PDF to a .docx Blob. Returns { blob:null, empty:true } when
// the PDF has no extractable text (e.g. a scan).
async function pdfToDocxBlob(arrayBuffer, onPage) {
  const D = window.docx;
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const children = [];
  let anyText = false;

  for (let p = 1; p <= pdf.numPages; p++) {
    if (onPage) onPage(p, pdf.numPages);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = buildLines(content.items);

    if (lines.length) {
      anyText = true;
      const bodySize = median(lines.map((l) => l.fontSize)) || 12;
      for (const para of buildParagraphs(lines, bodySize)) {
        const pts = Math.min(Math.max(para.fontSize, 8), 36);
        children.push(
          new D.Paragraph({
            heading: para.isHeading ? D.HeadingLevel.HEADING_2 : undefined,
            spacing: { after: 120 },
            children: [new D.TextRun({ text: para.text, bold: para.isHeading || undefined, size: Math.round(pts * 2) })],
          })
        );
      }
    }
    if (p < pdf.numPages) children.push(new D.Paragraph({ children: [new D.PageBreak()] }));
    if (typeof page.cleanup === 'function') page.cleanup();
  }

  if (!anyText) return { blob: null, empty: true };
  const doc = new D.Document({ sections: [{ properties: {}, children }] });
  return { blob: await D.Packer.toBlob(doc), empty: false };
}

convertBtn.addEventListener('click', async () => {
  if (!selected) return;
  convertBtn.disabled = true;
  clearBtn.disabled = true;
  resetDownload();
  setStatus('Reading your PDF…');

  try {
    if (!window.pdfjsLib || !window.docx) {
      throw new Error('Converter libraries failed to load — please refresh and try again.');
    }
    const buf = await selected.arrayBuffer();
    const { blob, empty } = await pdfToDocxBlob(buf, (p, n) => setStatus(`Converting… page ${p} of ${n}`));

    if (empty) {
      setStatus(
        'No selectable text found — this looks like a scanned (image-only) PDF, so there is no text to convert. Use a PDF that contains real text.',
        'error'
      );
      return;
    }

    lastUrl = URL.createObjectURL(blob);
    const outName = selected.name.replace(/\.pdf$/i, '') + '.docx';
    download.href = lastUrl;
    download.download = outName;
    download.hidden = false;
    download.style.display = '';
    download.textContent = `Download ${outName}`;
    setStatus('Done — your Word document is ready.', 'success');
  } catch (err) {
    let msg = err && err.message;
    if (err && err.name === 'PasswordException') {
      msg = 'This PDF is password-protected. Remove the password and try again.';
    } else if (err && err.name === 'InvalidPDFException') {
      msg = 'That file does not look like a valid PDF. Please choose another file.';
    }
    setStatus(msg || 'Something went wrong converting that file. Please try again.', 'error');
  } finally {
    convertBtn.disabled = !selected;
    clearBtn.disabled = false;
  }
});

// --- optional high-fidelity server conversion (2/day, gated at the edge) ------
// The default path above is 100% local. We only touch the network — including
// loading Turnstile — when the user explicitly opts into the server conversion.

function setServerStatus(msg, kind) {
  if (!serverStatus) return;
  serverStatus.textContent = msg || '';
  serverStatus.className = 'muted-small' + (kind ? ' ' + kind : '');
}

function resetServerDownload() {
  if (serverLastUrl) {
    URL.revokeObjectURL(serverLastUrl);
    serverLastUrl = null;
  }
  if (serverDownload) {
    serverDownload.hidden = true;
    serverDownload.style.display = 'none';
  }
}

function loadTurnstile() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the verification widget. Please try again.'));
    document.head.appendChild(s);
  });
}

async function ensureTurnstile() {
  await loadTurnstile();
  if (tsWidgetId === null && window.turnstile) {
    const c = document.getElementById('ts-container');
    tsWidgetId = window.turnstile.render(c, {
      sitekey: c.getAttribute('data-sitekey'),
      callback: (token) => {
        tsToken = token;
        if (pendingServerSubmit) doServerConvert();
      },
      'error-callback': () => { tsToken = null; },
      'expired-callback': () => { tsToken = null; },
    });
  }
}

async function doServerConvert() {
  pendingServerSubmit = false;
  if (!selected || !tsToken) return;
  serverConvertBtn.disabled = true;
  resetServerDownload();
  setServerStatus('Converting on the server…');
  try {
    const res = await fetch('/api/pdf-to-word', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'cf-turnstile-token': tsToken },
      body: selected,
    });
    if (!res.ok) {
      let msg = 'The server conversion didn’t work. Please try again, or use the in-browser converter above.';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
      setServerStatus(msg, 'error');
      return;
    }
    const blob = await res.blob();
    if (!blob.size) { setServerStatus('The server returned an empty file. Please try again.', 'error'); return; }
    serverLastUrl = URL.createObjectURL(blob);
    const outName = selected.name.replace(/\.pdf$/i, '') + '.docx';
    serverDownload.href = serverLastUrl;
    serverDownload.download = outName;
    serverDownload.hidden = false;
    serverDownload.style.display = '';
    serverDownload.textContent = `Download ${outName}`;
    setServerStatus('Done — your high-fidelity Word document is ready.', 'success');
  } catch (_) {
    setServerStatus('Couldn’t reach the server converter. Please check your connection and try again.', 'error');
  } finally {
    serverConvertBtn.disabled = false;
    if (window.turnstile && tsWidgetId !== null) {
      try { window.turnstile.reset(tsWidgetId); } catch (_) {}
    }
    tsToken = null;
  }
}

if (serverConvertBtn) {
  serverConvertBtn.addEventListener('click', async () => {
    if (!selected) { setServerStatus('Choose a PDF first.'); return; }
    pendingServerSubmit = true;
    setServerStatus('Verifying you’re human…');
    try {
      await ensureTurnstile();
    } catch (e) {
      pendingServerSubmit = false;
      setServerStatus(e.message || 'Could not start verification. Please try again.', 'error');
      return;
    }
    if (tsToken) doServerConvert();
    // otherwise the Turnstile callback will auto-submit once solved
  });
}
