// PDF -> Word (.docx) converter, runs entirely in the browser.
// Uses the vendored pdf.js (window.pdfjsLib) to read the PDF's text layer and the
// vendored docx library (window.docx) to build an editable .docx. No server, no
// upload: the file never leaves the device. Works best on text-based PDFs; a scanned
// (image-only) PDF has no text layer here, which is exactly what the optional server
// conversion is for: it runs OCR and can read the text out of the picture.

const MAX_BYTES = 50 * 1024 * 1024;        // 50 MB, generous: conversion runs on your own device
const SERVER_MAX_BYTES = 25 * 1024 * 1024; // matches R2_MAX_BYTES in functions/api/pdf-to-word.js
const SERVER_MAX_PAGES = 50;               // matches MAX_PAGES in backend/pdf-to-word/lambda_function.py
const DROP_PROMPT = 'Click to choose a PDF, or drop it here';

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
let serverTooBig = false;
let lastUrl = null;
let serverLastUrl = null;
let tsToken = null;
let tsWidgetId = null;
let pendingServerSubmit = false;
let serverTicker = null;

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

// The server block asks the visitor whether the result is good enough, so it must
// not appear until there is a result to look at. Hidden on every new file, shown
// once the browser converter has finished or failed.
function hideServerOption() {
  if (serverFallback) serverFallback.hidden = true;
}

function showServerOption() {
  if (!serverFallback) return;
  serverFallback.hidden = false;
  if (serverTooBig && selected) {
    if (serverConvertBtn) serverConvertBtn.disabled = true;
    setServerStatus(
      `This file is ${(selected.size / 1024 / 1024).toFixed(1)} MB and the server conversion only accepts ` +
      'files up to 25 MB, so it cannot take this one. Splitting the PDF into smaller parts first would let ' +
      'each part through.',
      'error'
    );
  }
}

function pickFile(file) {
  resetDownload();
  resetServerDownload();
  setServerStatus('');
  hideServerOption();
  serverTooBig = false;
  if (serverConvertBtn) serverConvertBtn.disabled = false;
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    selected = null;
    convertBtn.disabled = true;
    // Leaving the rejected name in the box while the message says it is not a PDF
    // reads as though the file was accepted anyway.
    dropText.textContent = DROP_PROMPT;
    setStatus('That is not a PDF. Please choose a .pdf file.', 'error');
    return;
  }
  if (file.size > MAX_BYTES) {
    selected = null;
    convertBtn.disabled = true;
    dropText.textContent = DROP_PROMPT;
    setStatus(`That PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB, and the limit is 50 MB.`, 'error');
    return;
  }
  selected = file;
  // Knowing now that the server would refuse this file means we never upload 25 MB+
  // over a phone connection only to be turned away, and never spend a daily slot on it.
  serverTooBig = file.size > SERVER_MAX_BYTES;
  convertBtn.disabled = false;
  dropText.textContent = file.name;
  setStatus(`Ready: ${file.name} (${(file.size / 1024).toFixed(0)} KB). Click "Convert to Word".`);
}

fileInput.addEventListener('change', () => pickFile(fileInput.files[0]));

['dragenter', 'dragover'].forEach((e) =>
  drop.addEventListener(e, (ev) => {
    ev.preventDefault();
    drop.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach((e) =>
  drop.addEventListener(e, (ev) => {
    ev.preventDefault();
    drop.classList.remove('drag');
  })
);
drop.addEventListener('drop', (ev) => {
  const f = ev.dataTransfer && ev.dataTransfer.files[0];
  if (f) pickFile(f);
});

clearBtn.addEventListener('click', () => {
  selected = null;
  serverTooBig = false;
  fileInput.value = '';
  convertBtn.disabled = true;
  dropText.textContent = DROP_PROMPT;
  resetDownload();
  resetServerDownload();
  setServerStatus('');
  // Clearing mid-verification must not leave the server button disabled forever.
  clearTsSolveTimer();
  pendingServerSubmit = false;
  tsToken = null;
  if (serverConvertBtn) serverConvertBtn.disabled = false;
  hideServerOption();
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
  let charCount = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    if (onPage) onPage(p, pdf.numPages);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) charCount += (it.str || '').length;
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
  // sparse = the text layer holds far less than the pages visibly show — the
  // "text" is drawn as images (stencils/scans) that only the server can read
  return { blob: await D.Packer.toBlob(doc), empty: false, sparse: charCount / pdf.numPages < 120 };
}

convertBtn.addEventListener('click', async () => {
  if (!selected) return;
  convertBtn.disabled = true;
  clearBtn.disabled = true;
  resetDownload();
  setStatus('Reading your PDF…');

  try {
    if (!window.pdfjsLib || !window.docx) {
      throw new Error('Converter libraries failed to load. Please refresh and try again.');
    }
    const buf = await selected.arrayBuffer();
    const { blob, empty, sparse } = await pdfToDocxBlob(buf, (p, n) => setStatus(`Converting… page ${p} of ${n}`));

    if (empty) {
      // A dead end here sends away the exact person the server converter was built
      // for. Name the next step instead: it is on this page, a few lines down.
      setStatus(
        'This PDF is a picture of a page rather than text, so the in-browser converter has nothing to ' +
        'pull out. ' +
        (serverTooBig
          ? 'The server conversion can read text out of a picture, but only for files up to 25 MB.'
          : 'The server conversion just below can read the text out of the picture, and usually does give ' +
            'you an editable document.'),
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
    if (sparse) {
      // an honest warning beats a confidently empty document
      setStatus(
        'Heads up: most of this PDF’s text is stored as pictures, which the in-browser converter ' +
        'cannot read, so the Word file is missing most of the content. The server conversion below ' +
        'reads the text out of pictures and will do far better here.',
        'error'
      );
    } else {
      setStatus('Done, your Word document is ready.', 'success');
    }
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
    // Finished or failed, either way there is now a result to judge, so the second
    // option earns its place on the screen.
    if (selected) showServerOption();
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

// --- pre-flight: is this PDF worth sending to the server? --------------------
// The server engine rebuilds every embedded image, so its cost tracks image count,
// not file size or page count. It ignores Word's shading chips (2x2-pixel fills
// stretched over a cell — a 19-page report held 1,004 of them against 40 real
// pictures), so count the way the server counts: intrinsic pixel size, skipping
// anything too small to be a picture. Only genuinely image-heavy documents are
// turned away, and turning them away here costs a second instead of a long wait,
// a wasted daily slot, and a conversion that was never going to finish.
// Reading a page's operator list costs ~600ms on an image-dense page, so scanning a
// whole document would tax every server conversion with 10+ seconds of "Checking…".
// Only the opening pages are read: a document dense enough to fail is dense from the
// start, and the converter runs the authoritative count itself in well under a second.
const MAX_SERVER_IMAGES = 400;
const PREFLIGHT_PAGES = 3;
const TINY_IMAGE_PX = 64; // matches TINY_IMAGE_PX in backend/pdf-to-word/lambda_function.py

// Returns { images, pages }. The page count is free: the document has to be opened
// to count pictures anyway, and the converter refuses anything over SERVER_MAX_PAGES.
// Catching that here saves a captcha, a full upload and a daily slot.
async function preflightPdf(file, limit) {
  const OPS = window.pdfjsLib.OPS;
  // paintImageXObject carries [id, width, height] — the only op that can be judged
  // by size. The others are counted whole; they never appear in fill-chip swarms.
  const SIZELESS_IMAGE_OPS = new Set([OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const lastPage = Math.min(pdf.numPages, PREFLIGHT_PAGES);
  let n = 0;
  for (let p = 1; p <= lastPage; p++) {
    const page = await pdf.getPage(p);
    const ops = await page.getOperatorList();
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn === OPS.paintImageXObject) {
        const [, w, h] = ops.argsArray[i] || [];
        if (typeof w === 'number' && typeof h === 'number' && w * h <= TINY_IMAGE_PX) continue;
        n++;
      } else if (SIZELESS_IMAGE_OPS.has(fn)) {
        n++;
      }
    }
    if (typeof page.cleanup === 'function') page.cleanup();
    if (n > limit) break; // no need for an exact count once it's hopeless
  }
  return { images: n, pages: pdf.numPages };
}

// Turnstile can fail in ways that never throw at us: the script is blocked by an
// extension, or it loads but its own challenge request can't reach Cloudflare (VPN,
// corporate proxy, captive portal) and the widget just draws its "unable to connect"
// box. Without the timeouts below the status line sat on "Verifying you're human…"
// forever and the button stayed disabled, with no way forward. Every failure path
// now lands on serverVerifyFailed(), which says what happened and points back at the
// in-browser converter — which needs no network at all.
const TS_SCRIPT_TIMEOUT_MS = 12000; // challenges.cloudflare.com/api.js never answers
const TS_SOLVE_TIMEOUT_MS = 25000;  // widget rendered but no token and no error
const SERVER_TIMEOUT_MS = 190000;   // gate gives up on the converter at 178s; outlast it

// One of the two daily conversions is charged the moment the upload reaches the
// converter, and it is not given back when the conversion then fails. Anything
// refused before that point (too large, wrong file type, allowance already used)
// costs nothing, so this note belongs only on failures that happened after the
// work had already started.
const SLOT_SPENT = ' This attempt still used one of today’s two server conversions.';

const TS_BLOCKED_MSG =
  'The human check couldn’t load. An ad blocker, VPN, or restricted network usually blocks it. ' +
  'The in-browser converter above needs none of this and still works.';

let tsSolveTimer = null;

function clearTsSolveTimer() {
  if (tsSolveTimer !== null) {
    clearTimeout(tsSolveTimer);
    tsSolveTimer = null;
  }
}

// Single exit for every verification failure: unstick the UI, drop the stale token,
// and put the widget back in a state where a second click can retry.
function serverVerifyFailed(msg) {
  clearTsSolveTimer();
  pendingServerSubmit = false;
  tsToken = null;
  setServerStatus(msg || TS_BLOCKED_MSG, 'error');
  if (serverConvertBtn) serverConvertBtn.disabled = false;
  if (window.turnstile && tsWidgetId !== null) {
    try { window.turnstile.reset(tsWidgetId); } catch (_) {}
  }
}

function loadTurnstile() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => finish(new Error(TS_BLOCKED_MSG)), TS_SCRIPT_TIMEOUT_MS);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => finish(window.turnstile ? null : new Error(TS_BLOCKED_MSG));
    s.onerror = () => finish(new Error(TS_BLOCKED_MSG));
    document.head.appendChild(s);
  });
}

async function ensureTurnstile() {
  await loadTurnstile();
  if (!window.turnstile) throw new Error(TS_BLOCKED_MSG);
  if (tsWidgetId === null) {
    const c = document.getElementById('ts-container');
    tsWidgetId = window.turnstile.render(c, {
      sitekey: c.getAttribute('data-sitekey'),
      callback: (token) => {
        clearTsSolveTimer();
        tsToken = token;
        if (pendingServerSubmit) doServerConvert();
      },
      'error-callback': () => { serverVerifyFailed(); },
      'timeout-callback': () => { serverVerifyFailed(); },
      'unsupported-callback': () => {
        serverVerifyFailed(
          'This browser can’t run the human check the server conversion requires. The in-browser converter above still works.'
        );
      },
      'expired-callback': () => { tsToken = null; },
    });
  } else {
    // Re-arm a widget that already errored or was consumed by a previous conversion.
    // reset() invalidates any token we are still holding, so drop it and let the
    // fresh solve callback drive the submit.
    tsToken = null;
    try { window.turnstile.reset(tsWidgetId); } catch (_) {}
  }
}

async function doServerConvert() {
  clearTsSolveTimer();
  pendingServerSubmit = false;
  if (!selected || !tsToken) { serverConvertBtn.disabled = false; return; }
  serverConvertBtn.disabled = true;
  resetServerDownload();
  // A heavy PDF can now hold the converter for minutes, so count the wait out loud —
  // a status line frozen on the same three words for two minutes reads as a hang.
  setServerStatus('Converting on the server…', 'busy');
  const startedAt = Date.now();
  serverTicker = setInterval(() => {
    const s = Math.round((Date.now() - startedAt) / 1000);
    if (s >= 10) setServerStatus(`Converting on the server… ${s}s (big or image-heavy PDFs take longer)`, 'busy');
  }, 1000);
  try {
    const res = await fetch('/api/pdf-to-word', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'cf-turnstile-token': tsToken },
      body: selected,
      // The gate gives up on the converter at 178s; stop waiting a little after that
      // rather than spinning forever if the response itself never arrives.
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    });
    if (!res.ok) {
      // The gate answers with {error}. Anything else means it died before it could,
      // so say what that actually means instead of a shrug.
      let msg = 'The server conversion couldn’t finish this PDF, it may be too heavy for it. ' +
        'The in-browser converter above has no time limit.';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
      // 5xx means the file reached the converter and the work began, so the slot is
      // gone. A refusal up front (413/415/429) is answered before any charge.
      setServerStatus(res.status >= 500 ? msg + SLOT_SPENT : msg, 'error');
      return;
    }
    const blob = await res.blob();
    if (!blob.size) { setServerStatus('The server sent back an empty file. Please try again.' + SLOT_SPENT, 'error'); return; }
    serverLastUrl = URL.createObjectURL(blob);
    const outName = selected.name.replace(/\.pdf$/i, '') + '.docx';
    serverDownload.href = serverLastUrl;
    serverDownload.download = outName;
    serverDownload.hidden = false;
    serverDownload.style.display = '';
    serverDownload.textContent = `Download ${outName}`;
    setServerStatus('Done, your Word document from the server is ready.', 'success');
  } catch (e) {
    setServerStatus(
      e && (e.name === 'TimeoutError' || e.name === 'AbortError')
        ? 'The server conversion took too long on this PDF and gave up. The in-browser converter above ' +
          'has no time limit.' + SLOT_SPENT
        : 'Couldn’t reach the server conversion. Please check your connection and try again.',
      'error'
    );
  } finally {
    if (serverTicker !== null) { clearInterval(serverTicker); serverTicker = null; }
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
    serverConvertBtn.disabled = true;

    // Check before spending anything: the daily slot is charged the moment the
    // upload reaches the converter, so a doomed file must never get that far.
    if (selected.size > SERVER_MAX_BYTES) {
      setServerStatus(
        `This file is ${(selected.size / 1024 / 1024).toFixed(1)} MB and the server conversion only ` +
        'accepts files up to 25 MB. Splitting the PDF into smaller parts first would let each part through.',
        'error'
      );
      serverConvertBtn.disabled = false;
      return;
    }

    setServerStatus('Checking this PDF…', 'busy');
    try {
      const { images, pages } = await preflightPdf(selected, MAX_SERVER_IMAGES);
      if (pages > SERVER_MAX_PAGES) {
        setServerStatus(
          `This PDF has ${pages} pages, and the server conversion takes at most ${SERVER_MAX_PAGES} at a ` +
          'time. We checked here on your device, so this cost you nothing. Splitting it into shorter PDFs ' +
          'first would let each part through.',
          'error'
        );
        serverConvertBtn.disabled = false;
        return;
      }
      if (images > MAX_SERVER_IMAGES) {
        setServerStatus(
          `This PDF holds over ${MAX_SERVER_IMAGES} pictures. The server conversion rebuilds every one of ` +
          'them and would run out of time, so it is not worth one of your two daily conversions. The ' +
          'in-browser result above is the best this file can give.',
          'error'
        );
        serverConvertBtn.disabled = false;
        return;
      }
    } catch (_) {
      // Counting is an optimisation, not a gate: if it fails, let the server try.
    }

    pendingServerSubmit = true;
    setServerStatus('Verifying you’re human…');
    // Backstop for the silent case: widget rendered, no token, no error callback.
    clearTsSolveTimer();
    tsSolveTimer = setTimeout(() => {
      if (pendingServerSubmit && !tsToken) serverVerifyFailed();
    }, TS_SOLVE_TIMEOUT_MS);
    try {
      await ensureTurnstile();
    } catch (e) {
      serverVerifyFailed(e && e.message);
      return;
    }
    if (tsToken) doServerConvert();
    // otherwise the Turnstile callback will auto-submit once solved
  });
}
