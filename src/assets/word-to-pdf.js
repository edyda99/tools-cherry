// Word (.docx) -> PDF converter — runs entirely in the browser.
// Uses the vendored mammoth.js (window.mammoth) to read the .docx's semantic
// structure (headings, paragraphs, lists, tables, embedded images) and the
// vendored jsPDF (window.jspdf.jsPDF) to lay that content onto real, selectable
// PDF text. No server, no upload: the file never leaves the device.
//
// Fidelity note (kept honest on the page too): mammoth converts *structure*, not
// exact visual appearance — it deliberately drops theme fonts, multi-column
// geometry, and precise margins. We rebuild text/headings/lists/images and place
// them with jsPDF's core fonts, so tables become plain text rows and inline
// bold/italic is not carried mid-paragraph. Latin-script text renders best;
// jsPDF's built-in fonts can't draw most non-Latin alphabets.

const MAX_BYTES = 30 * 1024 * 1024; // 30 MB — generous; conversion runs on your own device

const $ = (id) => document.getElementById(id);
const fileInput = $('file');
const drop = $('drop');
const dropText = $('dropText');
const status = $('status');
const convertBtn = $('convert');
const clearBtn = $('clear');
const download = $('download');
const pageSizeSel = $('pageSize');

let selected = null;
let lastUrl = null;

// Page sizes in PostScript points (1/72 inch), portrait.
const PAGE_SIZES = {
  letter: { w: 612, h: 792, format: 'letter' },
  a4: { w: 595.28, h: 841.89, format: 'a4' },
};

const MARGIN = 64; // ~0.9in page margin
const BODY_PT = 11;
const HEADING_PT = { 1: 22, 2: 17, 3: 14, 4: 12, 5: 11, 6: 11 };

// Vertical cursor (top of the next line), in points from the page top. Reset at
// the start of every conversion — only one conversion runs at a time.
let cursorY = MARGIN;

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
  if (!file) return;
  const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || /\.docx$/i.test(file.name);
  const isOldDoc = /\.doc$/i.test(file.name) && !/\.docx$/i.test(file.name);
  if (isOldDoc) {
    selected = null;
    convertBtn.disabled = true;
    setStatus('That is an old-style .doc file. Save it as .docx in Word (File → Save As → Word Document) and try again.', 'error');
    return;
  }
  if (!isDocx) {
    selected = null;
    convertBtn.disabled = true;
    setStatus('That is not a Word document. Please choose a .docx file.', 'error');
    return;
  }
  if (file.size > MAX_BYTES) {
    selected = null;
    convertBtn.disabled = true;
    setStatus(`That document is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 30 MB.`, 'error');
    return;
  }
  selected = file;
  convertBtn.disabled = false;
  dropText.textContent = file.name;
  setStatus(`Ready: ${file.name} (${(file.size / 1024).toFixed(0)} KB). Click "Convert to PDF".`);
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
  dropText.textContent = 'Click to choose a Word .docx, or drop it here';
  resetDownload();
  setStatus('Choose a Word document to begin.');
});

// --- layout primitives -------------------------------------------------------

// Move to a fresh page if the next `needed` points won't fit under the margin.
function newPageIfNeeded(doc, size, needed) {
  if (cursorY + needed > size.h - MARGIN) {
    doc.addPage();
    cursorY = MARGIN;
    return true;
  }
  return false;
}

// Draw a wrapped run of text. jsPDF places text on its baseline, so we offset the
// baseline by ~one font size below the current line top.
function drawText(doc, size, text, opts) {
  const o = opts || {};
  const pt = o.pt || BODY_PT;
  const bold = !!o.bold;
  const gapAfter = o.gapAfter == null ? 6 : o.gapAfter;
  if (!text) { cursorY += pt * 0.6; return; }
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(pt);
  const lineH = pt * 1.35;
  const width = size.w - MARGIN * 2;
  const lines = doc.splitTextToSize(text, width);
  for (let i = 0; i < lines.length; i++) {
    newPageIfNeeded(doc, size, lineH);
    doc.text(lines[i], MARGIN, cursorY + pt);
    cursorY += lineH;
  }
  cursorY += gapAfter;
}

// One list item, with a marker and a hanging indent so wrapped lines align under
// the text rather than under the bullet/number.
function drawListItem(doc, size, marker, text, depth) {
  const pt = BODY_PT;
  const lineH = pt * 1.35;
  const baseIndent = 18 + depth * 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(pt);
  const markerW = doc.getTextWidth(marker + ' ');
  const textIndent = baseIndent + markerW;
  const width = Math.max(60, size.w - MARGIN * 2 - textIndent);
  const lines = doc.splitTextToSize(text || '', width);
  if (!lines.length) lines.push('');
  for (let i = 0; i < lines.length; i++) {
    newPageIfNeeded(doc, size, lineH);
    if (i === 0) doc.text(marker, MARGIN + baseIndent, cursorY + pt);
    doc.text(lines[i], MARGIN + textIndent, cursorY + pt);
    cursorY += lineH;
  }
  cursorY += 3;
}

// Load a data-URI image so we can read its intrinsic size and embed it. Data URIs
// resolve synchronously off the local string — no network request is made.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('decode failed'));
    im.src = src;
  });
}

async function drawImage(doc, size, src) {
  if (!src || !/^data:image\//i.test(src)) return; // only inline data URIs (mammoth's default) — never a remote URL
  let im;
  try { im = await loadImage(src); } catch { return; }
  const iw = im.naturalWidth || im.width;
  const ih = im.naturalHeight || im.height;
  if (!iw || !ih) return;
  const maxW = size.w - MARGIN * 2;
  const maxH = size.h - MARGIN * 2;
  let w = iw, h = ih;
  if (w > maxW) { h = h * (maxW / w); w = maxW; }
  if (h > maxH) { w = w * (maxH / h); h = maxH; }
  if (cursorY + h > size.h - MARGIN) { doc.addPage(); cursorY = MARGIN; }
  let fmt;
  if (/^data:image\/png/i.test(src)) fmt = 'PNG';
  else if (/^data:image\/jpe?g/i.test(src)) fmt = 'JPEG';
  else if (/^data:image\/gif/i.test(src)) fmt = 'GIF';
  else if (/^data:image\/webp/i.test(src)) fmt = 'WEBP';
  else if (/^data:image\/bmp/i.test(src)) fmt = 'BMP';
  try {
    doc.addImage(src, fmt || 'PNG', MARGIN, cursorY, w, h);
    cursorY += h + 8;
  } catch {
    // Vector formats Word sometimes embeds (EMF/WMF) can't be rasterised by jsPDF —
    // skip that one image rather than aborting the whole document.
  }
}

function textOf(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

// --- structural walk ---------------------------------------------------------

async function renderNodes(doc, size, nodes) {
  for (const node of Array.from(nodes)) {
    if (node.nodeType !== 1) continue; // elements only
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const lvl = parseInt(tag[1], 10);
      cursorY += 8; // breathing room before a heading
      newPageIfNeeded(doc, size, HEADING_PT[lvl] * 1.35 + 8);
      drawText(doc, size, textOf(node), { pt: HEADING_PT[lvl], bold: true, gapAfter: 6 });
    } else if (tag === 'p') {
      await renderParagraph(doc, size, node);
    } else if (tag === 'ul' || tag === 'ol') {
      await renderList(doc, size, node, tag === 'ol', 0);
    } else if (tag === 'table') {
      renderTable(doc, size, node);
    } else if (tag === 'img') {
      await drawImage(doc, size, node.getAttribute('src'));
    } else if (tag === 'br') {
      cursorY += BODY_PT * 1.35;
    } else {
      // Wrapper elements (div/section/etc.) — recurse when they hold structure,
      // otherwise render their bare text.
      const hasElementChild = Array.from(node.childNodes).some((n) => n.nodeType === 1);
      if (hasElementChild) await renderNodes(doc, size, node.childNodes);
      else { const t = textOf(node); if (t) drawText(doc, size, t, { pt: BODY_PT, gapAfter: 6 }); }
    }
  }
}

async function renderParagraph(doc, size, p) {
  const text = textOf(p);
  if (text) drawText(doc, size, text, { pt: BODY_PT, gapAfter: 6 });
  const imgs = p.querySelectorAll('img');
  for (const im of Array.from(imgs)) await drawImage(doc, size, im.getAttribute('src'));
  if (!text && imgs.length === 0) cursorY += BODY_PT * 0.5; // empty paragraph → small gap
}

async function renderList(doc, size, listEl, ordered, depth) {
  let n = 1;
  for (const li of Array.from(listEl.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    const nested = [];
    let txt = '';
    for (const child of Array.from(li.childNodes)) {
      if (child.nodeType === 1 && /^(ul|ol)$/i.test(child.tagName)) nested.push(child);
      else txt += child.textContent || '';
    }
    txt = txt.replace(/\s+/g, ' ').trim();
    drawListItem(doc, size, ordered ? n + '.' : '•', txt, depth);
    n++;
    for (const sub of nested) {
      await renderList(doc, size, sub, sub.tagName.toLowerCase() === 'ol', depth + 1);
    }
  }
}

// Tables are flattened to one plain-text line per row (cells joined by " | ").
// jsPDF core fonts give no real grid; this keeps the data legible and honest.
function renderTable(doc, size, table) {
  const rows = table.querySelectorAll('tr');
  cursorY += 4;
  Array.from(rows).forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
    const line = cells.join('  |  ');
    const isHeaderRow = tr.querySelector('th') && !tr.querySelector('td');
    drawText(doc, size, line, { pt: BODY_PT, bold: !!isHeaderRow, gapAfter: 2 });
  });
  cursorY += 6;
}

// --- conversion --------------------------------------------------------------

// Convert the whole .docx to a jsPDF doc. Returns { doc:null, empty:true } when
// the document has no extractable text or images.
async function docxToPdf(arrayBuffer, size, onProgress) {
  if (onProgress) onProgress('Reading your Word document…');
  const result = await window.mammoth.convertToHtml({ arrayBuffer });
  const html = (result && result.value) || '';

  // Parse mammoth's HTML locally — DOMParser builds an inert document that runs no
  // scripts and fetches nothing. All image data is already inline as data URIs.
  const parsed = new DOMParser().parseFromString('<div id="wtp-root">' + html + '</div>', 'text/html');
  const root = parsed.getElementById('wtp-root');
  const hasContent = (root.textContent || '').trim().length > 0 || !!root.querySelector('img');
  if (!hasContent) return { doc: null, empty: true };

  if (onProgress) onProgress('Building your PDF…');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: size.format, orientation: 'portrait' });
  cursorY = MARGIN;
  await renderNodes(doc, size, root.childNodes);
  return { doc, empty: false };
}

convertBtn.addEventListener('click', async () => {
  if (!selected) return;
  convertBtn.disabled = true;
  clearBtn.disabled = true;
  resetDownload();
  setStatus('Reading your Word document…');

  try {
    if (!window.mammoth || !window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('Converter libraries failed to load — please refresh and try again.');
    }
    const sizeKey = pageSizeSel && pageSizeSel.value in PAGE_SIZES ? pageSizeSel.value : 'letter';
    const size = PAGE_SIZES[sizeKey];
    const buf = await selected.arrayBuffer();
    const { doc, empty } = await docxToPdf(buf, size, (m) => setStatus(m));

    if (empty) {
      setStatus('That Word document has no text or images to convert — it looks empty.', 'error');
      return;
    }

    lastUrl = URL.createObjectURL(doc.output('blob'));
    const outName = selected.name.replace(/\.docx$/i, '') + '.pdf';
    download.href = lastUrl;
    download.download = outName;
    download.hidden = false;
    download.style.display = '';
    download.textContent = `Download ${outName}`;
    setStatus('Done — your PDF is ready.', 'success');
  } catch (err) {
    let msg = err && err.message;
    const raw = (msg || '').toLowerCase();
    if (raw.includes('central directory') || raw.includes('zip') || raw.includes('end of data') || raw.includes("can't find") || raw.includes('body element')) {
      msg = 'That file does not look like a valid Word .docx. It may be corrupted or renamed from another format — please choose a real .docx.';
    }
    setStatus(msg || 'Something went wrong converting that file. Please try again.', 'error');
  } finally {
    convertBtn.disabled = !selected;
    clearBtn.disabled = false;
  }
});
