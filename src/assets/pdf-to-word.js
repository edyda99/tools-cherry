// PDF -> Word (.docx) converter.
//
// Two engines, one button. The default is the SERVER conversion (/api/pdf-to-word,
// an abuse-gated Cloudflare Function in front of a Lambda): it reads scanned pages
// and holds complicated layouts together. The in-browser engine (vendored pdf.js +
// docx, nothing uploaded) is the secondary choice for people who would rather the
// file never left the device, and it is also the automatic fallback whenever the
// server cannot take the file: daily allowance used up, file too large or too long,
// too many pictures, human check blocked, or the conversion itself failing.
//
// Whichever way the fallback is reached, the page shows exactly ONE banner saying
// why, then hands over a working, if basic, Word file rather than a dead end.

const MAX_BYTES = 50 * 1024 * 1024;        // browser engine ceiling; the work runs on the device
const SERVER_MAX_BYTES = 25 * 1024 * 1024; // matches R2_MAX_BYTES in functions/api/pdf-to-word.js
const SERVER_MAX_PAGES = 50;               // matches MAX_PAGES in backend/pdf-to-word/lambda_function.py
const DROP_PROMPT = 'Click to choose a PDF, or drop it here';
const FILE_INFO_IDLE =
  'Up to 25 MB and 50 pages · uploaded over an encrypted connection, converted, then deleted straight away.';
const BROWSER_MODE_INFO =
  'Browser mode: nothing is uploaded. Best on PDFs that hold real text, scans come out empty.';

const $ = (id) => document.getElementById(id);
const fileInput = $('file');
const drop = $('drop');
const dropText = $('dropText');
const fileInfo = $('fileInfo');
const status = $('status');
const banner = $('banner');
const convertBtn = $('convert');
const clearBtn = $('clear');
const download = $('download');
const alt = $('alt');

const ALT_DEFAULT_HTML =
  'Prefer that the file never leaves your device? ' +
  '<button type="button" id="localLink" style="background:none;border:0;padding:0;font:inherit;color:var(--accent);text-decoration:underline;cursor:pointer">Convert in your browser instead</button> (basic)';
const ALT_AFTER_BROWSER_HTML =
  'Want better layout and scanned-page support? Press "Convert on server instead".';

let selected = null;
let lastUrl = null;
let busy = false;
// Filled in from the gate's x-ptw-* response headers; null until the first answer.
let quotaLeft = null;

// pdf.js runs its parser in a Web Worker, vendored alongside this script.
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.js';
}

// --- small UI helpers --------------------------------------------------------

function setStatus(msg, kind) {
  status.textContent = msg || '';
  status.className = 'muted-small' + (kind ? ' ' + kind : '');
}

// One banner, ever. It explains why the browser engine ran instead of the server;
// a second explanation stacked under the first is how the old page lost people.
function setBanner(msg) {
  if (!banner) return;
  banner.textContent = msg || '';
  banner.hidden = !msg;
}

function setFileInfo(msg) {
  if (!fileInfo) return;
  fileInfo.textContent = msg || '';
  fileInfo.hidden = !msg;
}

function setPrimary(label, disabled) {
  convertBtn.textContent = label;
  convertBtn.disabled = !!disabled;
}

// The secondary line is a link most of the time, and a sentence pointing back at
// the server once the browser engine has produced the result on screen.
function setAlt(afterBrowser) {
  if (!alt) return;
  alt.innerHTML = afterBrowser ? ALT_AFTER_BROWSER_HTML : ALT_DEFAULT_HTML;
  const l = $('localLink');
  if (l) l.addEventListener('click', onLocalLink);
}

function quotaSentence() {
  if (quotaLeft === null) return '';
  return quotaLeft === 1
    ? ' 1 server conversion left today.'
    : ` ${quotaLeft} server conversions left today.`;
}

function resetDownload() {
  if (lastUrl) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = null;
  }
  download.hidden = true;
  download.style.display = 'none';
}

// `sourceName` is the file the conversion actually started from, captured at the
// start of the run: `selected` can have moved on to another file by the time a
// long conversion finishes, and naming A's result after B is a quiet lie.
function offerDownload(blob, basic, sourceName) {
  resetDownload();
  lastUrl = URL.createObjectURL(blob);
  const outName = (sourceName || selected.name).replace(/\.pdf$/i, '') + '.docx';
  download.href = lastUrl;
  download.download = outName;
  download.hidden = false;
  download.style.display = '';
  download.textContent = basic ? `Download ${outName} (basic)` : `Download ${outName}`;
}

// --- file selection ----------------------------------------------------------

function pickFile(file) {
  // Choosing a file while the human check is still open means "use this one instead".
  // The pending submit has to be cancelled here or its callback would fire against the
  // file that just arrived and upload a document nobody pressed Convert for.
  if (pendingServerSubmit) {
    pendingServerSubmit = false;
    clearTsSolveTimer();
    tsToken = null;
    busy = false;
    clearBtn.disabled = false;
  }
  resetDownload();
  setBanner('');
  setAlt(false);
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    selected = null;
    setPrimary('Convert to Word', true);
    // Leaving the rejected name in the box while the message says it is not a PDF
    // reads as though the file was accepted anyway.
    dropText.textContent = DROP_PROMPT;
    setFileInfo(FILE_INFO_IDLE);
    setStatus('That is not a PDF. Please choose a .pdf file.', 'error');
    return;
  }
  if (file.size > MAX_BYTES) {
    selected = null;
    setPrimary('Convert to Word', true);
    dropText.textContent = DROP_PROMPT;
    setFileInfo(FILE_INFO_IDLE);
    setStatus(`That PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB, and the limit is 50 MB.`, 'error');
    return;
  }
  selected = file;
  setPrimary('Convert to Word', false);
  dropText.textContent = file.name;
  setFileInfo(quotaLeft === null ? FILE_INFO_IDLE : ('Ready.' + quotaSentence()).trim());
  setStatus(`Ready: ${file.name} (${(file.size / 1024).toFixed(0)} KB). Click "Convert to Word".`);
  // Start the human check now rather than on the click, so pressing Convert is one
  // wait instead of two. It costs nothing if the visitor never presses it.
  warmTurnstile();
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
  fileInput.value = '';
  busy = false;
  dropText.textContent = DROP_PROMPT;
  resetDownload();
  setBanner('');
  setAlt(false);
  setFileInfo(FILE_INFO_IDLE);
  setPrimary('Convert to Word', true);
  // Clearing mid-verification must not leave the button disabled forever.
  clearTsSolveTimer();
  pendingServerSubmit = false;
  tsToken = null;
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

// --- pre-flight: is this PDF worth sending to the server? --------------------
// The server engine rebuilds every embedded image, so its cost tracks image count,
// not file size or page count. It ignores tiny chips (a 19-page report held 1,004 of
// them against 40 real pictures). Those chips are NOT Word shading, which Word exports
// as a vector fill: they are rasterised lines of body text, left behind by a sanitizer
// pipeline, and the server OCRs them back into real text. See the corrected note in
// backend/pdf-to-word/lambda_function.py. Either way they are not pictures, so count
// the way the server counts: intrinsic pixel size, skipping
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
  // by size. The others are counted whole; they never appear in stencil swarms.
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
// now lands on the browser engine plus one banner, so nobody is left holding nothing.
const TS_SCRIPT_TIMEOUT_MS = 12000; // challenges.cloudflare.com/api.js never answers
const TS_SOLVE_TIMEOUT_MS = 25000;  // widget rendered but no token and no error
const SERVER_TIMEOUT_MS = 190000;   // gate gives up on the converter at 178s; outlast it

// A daily conversion is charged the moment the upload reaches the converter, and it
// is not given back when the conversion then fails. Anything refused before that
// point (too large, wrong file type, allowance already used) costs nothing, so this
// note belongs only on failures that happened after the work had already started.
// The gate says which is which in its x-ptw-charged header.
const SLOT_SPENT = ' This attempt still used one of today’s server conversions.';

const TS_BLOCKED_MSG =
  'The human check could not load (an ad blocker, VPN or office network usually blocks it), so we ' +
  'converted in your browser instead. Turn the blocker off and press Convert again for the full ' +
  'server result.';
const TS_UNSUPPORTED_MSG =
  'This browser cannot run the human check the server conversion needs, so we converted in your ' +
  'browser instead.';
const BASIC_NOTE =
  ' The browser conversion keeps the text and paragraphs but may lose some layout, and cannot read ' +
  'scanned pages.';

let tsToken = null;
let tsWidgetId = null;
let pendingServerSubmit = false;
let tsSolveTimer = null;
let serverTicker = null;
let tsWarmed = false;
// Set when the warm-up already proved the check cannot load. Cleared as soon as it
// is used, so pressing Convert again is a genuine retry rather than a cached refusal.
let tsBlockedMsg = null;

function clearTsSolveTimer() {
  if (tsSolveTimer !== null) {
    clearTimeout(tsSolveTimer);
    tsSolveTimer = null;
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

// A widget failure that arrives while nobody is waiting (the warm-up) is remembered,
// not shown: the visitor has not asked for anything yet.
function tsFailure(msg) {
  clearTsSolveTimer();
  tsToken = null;
  if (window.turnstile && tsWidgetId !== null) {
    try { window.turnstile.reset(tsWidgetId); } catch (_) {}
  }
  if (pendingServerSubmit) {
    pendingServerSubmit = false;
    fallbackToBrowser(msg || TS_BLOCKED_MSG, true);
  } else {
    tsBlockedMsg = msg || TS_BLOCKED_MSG;
  }
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
        tsBlockedMsg = null;
        if (pendingServerSubmit) doServerConvert();
      },
      'error-callback': () => { tsFailure(); },
      'timeout-callback': () => { tsFailure(); },
      'unsupported-callback': () => { tsFailure(TS_UNSUPPORTED_MSG); },
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

// Called the moment a file is chosen. Failures here are silent on purpose.
function warmTurnstile() {
  if (tsWarmed) return;
  tsWarmed = true;
  ensureTurnstile().catch((e) => { tsBlockedMsg = (e && e.message) || TS_BLOCKED_MSG; });
}

// --- the browser engine, as a choice and as the fallback ---------------------

// Runs the local converter. `reason` is null when the visitor asked for it, or the
// one-line explanation when the server could not take the file.
async function convertInBrowser(reason, retryLabel) {
  if (!selected || busy) return;
  const source = selected; // the run owns this file even if the box moves on
  busy = true;
  convertBtn.disabled = true;
  clearBtn.disabled = true;
  resetDownload();
  setStatus('Reading your PDF…');

  try {
    if (!window.pdfjsLib || !window.docx) {
      throw new Error('Converter libraries failed to load. Please refresh and try again.');
    }
    const buf = await source.arrayBuffer();
    const { blob, empty, sparse } = await pdfToDocxBlob(buf, (p, n) => setStatus(`Converting… page ${p} of ${n}`));

    if (empty) {
      // The banner above already says why the server did not run, so an auto-fallback
      // only states the fact. A deliberate browser conversion gets pointed at the server.
      setStatus(
        'This PDF is a picture of a page rather than text, so the browser converter found nothing to ' +
        'pull out.' +
        (retryLabel ? ' Press "' + retryLabel + '" to let the server read the text out of the picture.' : ''),
        'error'
      );
      return;
    }

    offerDownload(blob, true, source.name);
    if (sparse) {
      // an honest warning beats a confidently empty document
      setStatus(
        'Heads up: most of this PDF’s text is stored as pictures, which the browser converter cannot ' +
        'read, so the Word file is missing most of the content. The server conversion reads text out ' +
        'of pictures and does far better here.',
        'error'
      );
    } else {
      setStatus(
        reason ? 'Basic conversion done in your browser.' : 'Done in your browser. Your Word file is ready.',
        reason ? undefined : 'success'
      );
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
    busy = false;
    clearBtn.disabled = false;
  }
}

// The server said no. Explain once, then convert locally so the visitor still gets
// a file. `retryable` decides whether pressing Convert again could ever help.
async function fallbackToBrowser(reason, retryable) {
  // convertInBrowser refuses to start while another conversion is in flight, and the
  // server attempt that just failed is still holding that flag.
  busy = false;
  setBanner(reason + BASIC_NOTE);
  setFileInfo('');
  setAlt(false);
  await convertInBrowser(reason, null);
  setPrimary('Convert to Word', !retryable);
}

// Chosen deliberately: no banner, and the primary button becomes the way back.
async function onLocalLink() {
  if (busy) return;
  if (!selected) { setStatus('Choose a PDF first.'); return; }
  setBanner('');
  setFileInfo(BROWSER_MODE_INFO);
  setAlt(true);
  await convertInBrowser(null, 'Convert on server instead');
  setPrimary('Convert on server instead', false);
}

// --- the server engine, the default -----------------------------------------

async function doServerConvert() {
  clearTsSolveTimer();
  pendingServerSubmit = false;
  if (!selected || !tsToken) {
    setPrimary('Convert to Word', false);
    clearBtn.disabled = false;
    busy = false;
    return;
  }
  const source = selected; // the run owns this file even if the box moves on
  resetDownload();
  // A heavy PDF can hold the converter for minutes, so count the wait out loud: a
  // status line frozen on the same three words for two minutes reads as a hang.
  setStatus('Uploading and converting on our server… usually 10 to 40 seconds.', 'busy');
  const startedAt = Date.now();
  serverTicker = setInterval(() => {
    const s = Math.round((Date.now() - startedAt) / 1000);
    if (s >= 10) setStatus(`Converting on our server… ${s}s (big or image-heavy PDFs take longer)`, 'busy');
  }, 1000);
  try {
    const res = await fetch('/api/pdf-to-word', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'cf-turnstile-token': tsToken },
      body: source,
      // The gate gives up on the converter at 178s; stop waiting a little after that
      // rather than spinning forever if the response itself never arrives.
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    });
    readQuotaHeaders(res);
    if (serverTicker !== null) { clearInterval(serverTicker); serverTicker = null; }

    if (!res.ok) {
      // The gate answers with {error}. Anything else means it died before it could,
      // so say what that actually means instead of a shrug.
      let msg = 'The server conversion could not finish this PDF.';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
      // x-ptw-charged, not the status code, is the truth about whether a slot went:
      // a quota refusal costs nothing, an AWS throttle after the upload costs one.
      if (res.headers.get('x-ptw-charged') === '1') msg += SLOT_SPENT;
      if (res.status === 415) {
        // The browser engine would make nothing of it either.
        setStatus(msg, 'error');
        setPrimary('Convert to Word', false);
        return;
      }
      // 429 quota and 413 too-large are permanent for today / for this file; the
      // rest (403, 5xx, 502/504) are worth another press.
      const retryable = !(res.status === 429 || res.status === 413);
      await fallbackToBrowser(msg, retryable);
      return;
    }

    const blob = await res.blob();
    if (!blob.size) {
      await fallbackToBrowser('The server sent back an empty file.' + SLOT_SPENT, true);
      return;
    }
    offerDownload(blob, false, source.name);
    setStatus(('Done. Your Word file is ready.' + quotaSentence()).trim(), 'success');
    setFileInfo('');
    setPrimary('Convert to Word', true);
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    await fallbackToBrowser(
      timedOut
        ? 'The server conversion took too long on this PDF and gave up.' + SLOT_SPENT
        : 'We could not reach the server conversion, so check your connection if you want to try it again.',
      true
    );
  } finally {
    if (serverTicker !== null) { clearInterval(serverTicker); serverTicker = null; }
    busy = false;
    clearBtn.disabled = false;
    if (window.turnstile && tsWidgetId !== null) {
      try { window.turnstile.reset(tsWidgetId); } catch (_) {}
    }
    tsToken = null;
  }
}

// The gate reports the allowance on every answer, computed from counters it had to
// read anyway, so the page can say what is left without asking a second time.
function readQuotaHeaders(res) {
  const left = res.headers.get('x-ptw-remaining');
  if (left !== null && /^\d+$/.test(left)) quotaLeft = parseInt(left, 10);
}

// Everything that must be true before a byte is uploaded. Each refusal here costs
// nothing, and each one hands the file to the browser engine instead.
async function startServerConvert() {
  if (!selected || busy) return;
  busy = true;
  convertBtn.disabled = true;
  clearBtn.disabled = true;
  setBanner('');
  setAlt(false);

  if (selected.size > SERVER_MAX_BYTES) {
    await fallbackToBrowser(
      `This file is ${(selected.size / 1024 / 1024).toFixed(1)} MB. The server accepts up to 25 MB, so we ` +
      'converted it in your browser instead. Splitting or compressing the PDF first would let it through.',
      false
    );
    return;
  }

  setStatus('Checking this PDF…', 'busy');
  try {
    const { images, pages } = await preflightPdf(selected, MAX_SERVER_IMAGES);
    if (pages > SERVER_MAX_PAGES) {
      await fallbackToBrowser(
        `This PDF has ${pages} pages and the server takes at most ${SERVER_MAX_PAGES} at a time, so we ` +
        'converted it in your browser instead. We checked here on your device, so this cost you nothing. ' +
        'Splitting it into shorter PDFs would let each part through.',
        false
      );
      return;
    }
    if (images > MAX_SERVER_IMAGES) {
      await fallbackToBrowser(
        `This PDF holds over ${MAX_SERVER_IMAGES} pictures. The server rebuilds every one of them and ` +
        'would run out of time, so we converted it in your browser instead rather than spend one of ' +
        'your daily conversions on it.',
        false
      );
      return;
    }
  } catch (_) {
    // Counting is an optimisation, not a gate: if it fails, let the server try.
  }

  // The warm-up already proved the check cannot load. Use that once, then forget it,
  // so the next press is a real retry rather than a cached refusal.
  if (tsBlockedMsg) {
    const msg = tsBlockedMsg;
    tsBlockedMsg = null;
    await fallbackToBrowser(msg, true);
    return;
  }

  if (tsToken) { doServerConvert(); return; }

  pendingServerSubmit = true;
  setStatus('Verifying you’re human…');
  // Backstop for the silent case: widget rendered, no token, no error callback.
  clearTsSolveTimer();
  tsSolveTimer = setTimeout(() => {
    if (pendingServerSubmit && !tsToken) tsFailure();
  }, TS_SOLVE_TIMEOUT_MS);
  try {
    await ensureTurnstile();
  } catch (e) {
    pendingServerSubmit = false;
    clearTsSolveTimer();
    await fallbackToBrowser((e && e.message) || TS_BLOCKED_MSG, true);
    return;
  }
  if (tsToken) doServerConvert();
  // otherwise the Turnstile callback auto-submits once solved
}

convertBtn.addEventListener('click', () => {
  if (!selected) return;
  startServerConvert();
});

setAlt(false);
setFileInfo(FILE_INFO_IDLE);
