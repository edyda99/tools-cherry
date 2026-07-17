import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
// invoice.js — client-side invoice builder + PDF export (jsPDF, loaded globally).
// No network: inputs stay in the browser, PDF is generated locally.

const $ = (id) => document.getElementById(id);

const CURRENCY = {
  USD: { symbol: '$', locale: 'en-US' },
  EUR: { symbol: '€', locale: 'de-DE' },
  GBP: { symbol: '£', locale: 'en-GB' },
  CAD: { symbol: 'CA$', locale: 'en-CA' },
  AUD: { symbol: 'A$', locale: 'en-AU' },
  SAR: { symbol: 'SAR ', locale: 'en-US' }
};

// --- logo (client-side only: read, downscale, embed; never uploaded) ---------
// The logo is read locally, downscaled via canvas so the embedded PDF stays
// small, and kept in memory + localStorage. It is never uploaded anywhere.
let logo = null; // { dataUrl, w, h } once a logo is chosen

function loadLogo(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => { if ($('logoStatus')) $('logoStatus').textContent = 'Could not read that file.'; };
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => { if ($('logoStatus')) $('logoStatus').textContent = 'That image could not be loaded.'; };
    img.onload = () => {
      const maxDim = 300; // downscale so the embedded PDF stays small
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      logo = { dataUrl: canvas.toDataURL('image/png'), w, h };
      if ($('logoStatus')) $('logoStatus').textContent = 'Logo added — stays in your browser, never uploaded.';
      $('removeLogo').hidden = false;
      render();
      saveProfile();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function clearLogo() {
  logo = null;
  $('logoInput').value = '';
  $('removeLogo').hidden = true;
  if ($('logoStatus')) $('logoStatus').textContent = 'Added to the PDF — stays in your browser, never uploaded.';
  render();
  saveProfile();
}

// --- brand color -------------------------------------------------------------
const DEFAULT_BRAND = '#1a7f37';
function brandHex() {
  const v = ($('brandColor') && $('brandColor').value) || DEFAULT_BRAND;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : DEFAULT_BRAND;
}
function brandRgb() {
  const h = brandHex();
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function curCode() { return $('currency').value || 'USD'; }
function money(n) {
  const c = CURRENCY[curCode()] || CURRENCY.USD;
  return c.symbol + (Number(n) || 0).toLocaleString(c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- saved business profile (localStorage only; never leaves the device) -----
// Persists the parts that are the same on every invoice (business identity +
// currency + logo + brand color) so returning users don't re-type them. This is
// a lightweight identity store; the full per-invoice autosave below restores
// everything else (client, line items, dates...).
const PROFILE_KEY = 'tb_invoice_profile_v1';

function saveProfile() {
  if (restoring) return;
  try {
    const p = {
      bizName: $('bizName').value,
      bizDetails: $('bizDetails').value,
      currency: $('currency').value,
      brandColor: ($('brandColor') && $('brandColor').value) || DEFAULT_BRAND,
      logo: logo ? { dataUrl: logo.dataUrl, w: logo.w, h: logo.h } : null
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    showSaved(true);
  } catch (e) { /* storage full or disabled (private mode) — degrade silently */ }
}

function loadProfile() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { p = null; }
  if (!p) return false;
  if (p.bizName != null) $('bizName').value = p.bizName;
  if (p.bizDetails != null) $('bizDetails').value = p.bizDetails;
  if (p.currency && CURRENCY[p.currency]) $('currency').value = p.currency;
  if (p.brandColor && $('brandColor')) $('brandColor').value = p.brandColor;
  if (p.logo && p.logo.dataUrl) {
    logo = { dataUrl: p.logo.dataUrl, w: p.logo.w || 1, h: p.logo.h || 1 };
    $('removeLogo').hidden = false;
    if ($('logoStatus')) $('logoStatus').textContent = 'Logo restored from this device.';
  }
  showSaved(true);
  return true;
}

function clearProfile() {
  try { localStorage.removeItem(PROFILE_KEY); } catch (e) { /* ignore */ }
  showSaved(false);
}

function showSaved(on) {
  const el = $('profileStatus');
  if (el) el.textContent = on
    ? 'Business details saved on this device for next time.'
    : 'Saved business details cleared.';
  const btn = $('clearProfile');
  if (btn) btn.hidden = !on;
}

// --- line items --------------------------------------------------------------
function attr(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function itemRow(desc = '', qty = '1', rate = '0') {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML =
    `<input class="d" placeholder="Description" aria-label="Line item description" value="${attr(desc)}">` +
    `<input class="q" type="number" min="0" step="any" aria-label="Quantity" value="${attr(qty)}">` +
    `<input class="r" type="text" inputmode="decimal" data-money autocomplete="off" aria-label="Rate" value="${attr(rate)}">` +
    `<input class="a" value="0.00" readonly tabindex="-1" aria-label="Line total">` +
    `<button type="button" class="rm" title="Remove" aria-label="Remove line item">×</button>`;
  // The rate field is created dynamically per row, so bind live thousands
  // separators on this row now rather than waiting for a document-wide init.
  initMoneyInputs(row);
  row.querySelector('.rm').addEventListener('click', () => { row.remove(); render(); });
  row.querySelectorAll('input').forEach((el) => el.addEventListener('input', render));
  return row;
}

function readItems() {
  return [...document.querySelectorAll('#items .item-row')].map((row) => {
    const desc = row.querySelector('.d').value;
    const qty = parseFloat(row.querySelector('.q').value) || 0;
    // Comma-safe: the rate field carries live thousands separators, so read it
    // through moneyValue rather than a raw parseFloat, which would silently
    // truncate "1,500" to 1.
    const rate = moneyValue(row.querySelector('.r'));
    const amount = qty * rate;
    row.querySelector('.a').value = amount.toFixed(2);
    return { desc, qty, rate, amount };
  });
}

function totals(items) {
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const taxVal = parseFloat($('taxRate').value) || 0;
  const taxMode = ($('taxMode') && $('taxMode').value) || 'percent';
  const discVal = parseFloat($('discount').value) || 0;
  const discMode = ($('discountMode') && $('discountMode').value) || 'flat';
  const shipping = ($('shipping') && moneyValue($('shipping'))) || 0;

  // Tax can be a percentage of the subtotal or a flat figure.
  const tax = taxMode === 'percent' ? subtotal * (taxVal / 100) : taxVal;
  // Percent discount is applied to the subtotal (before tax).
  const discount = discMode === 'percent' ? subtotal * (discVal / 100) : discVal;
  // Shipping is added after tax/discount (a flat pass-through charge, untaxed).
  const total = Math.max(0, subtotal + tax - discount + shipping);
  // Amount already paid (e.g. a deposit); balance due is what's still owed.
  const amountPaid = ($('amountPaid') && moneyValue($('amountPaid'))) || 0;
  const balanceDue = total - amountPaid;

  const taxLabel = taxMode === 'percent' ? `Tax (${taxVal}%)` : 'Tax';
  const discountLabel = discMode === 'percent' ? `Discount (${discVal}%)` : 'Discount';
  return { subtotal, tax, taxLabel, discount, discountLabel, shipping, total, amountPaid, balanceDue };
}

// --- payment terms -----------------------------------------------------------
// A preset term auto-fills the due date as invoice date + N days; choosing
// "Custom" (value '') leaves the due date for the user to set by hand.
function termLabel() {
  const sel = $('paymentTerms');
  if (!sel || sel.value === '') return '';
  const opt = sel.options[sel.selectedIndex];
  return opt ? opt.text : '';
}

// Recompute the due date from the active term + invoice date. No-op for Custom.
function applyTerms() {
  const sel = $('paymentTerms');
  if (!sel || sel.value === '') return;
  const days = parseInt(sel.value, 10);
  const base = $('invDate').value;
  if (!Number.isFinite(days) || !base) return;
  const d = new Date(base + 'T00:00:00');
  if (isNaN(d)) return;
  d.setDate(d.getDate() + days);
  $('dueDate').value = d.toISOString().slice(0, 10);
}

function readModel() {
  const items = readItems();
  return {
    docType: ($('docType') && $('docType').value) || 'Invoice',
    biz: { name: $('bizName').value, details: $('bizDetails').value },
    cli: { name: $('cliName').value, details: $('cliDetails').value },
    ship: ($('shipDetails') && $('shipDetails').value.trim()) || '',
    invNo: $('invNo').value,
    po: ($('poNumber') && $('poNumber').value) || '',
    date: $('invDate').value,
    due: $('dueDate').value,
    terms: termLabel(),
    notes: $('notes').value,
    signature: !!($('showSignature') && $('showSignature').checked),
    items,
    t: totals(items)
  };
}

// --- live preview ------------------------------------------------------------
function render() {
  const m = readModel();
  const brand = brandHex();
  const lbl = $('invNoLabel');
  if (lbl) lbl.textContent = m.docType + ' #';
  const rows = m.items
    .map(
      (i) =>
        `<tr><td>${esc(i.desc) || '&nbsp;'}</td><td class="num">${i.qty}</td>` +
        `<td class="num">${money(i.rate)}</td><td class="num">${money(i.amount)}</td></tr>`
    )
    .join('');

  $('preview').innerHTML =
    `<div class="pv-row"><div>` +
    (logo ? `<img class="pv-logo" src="${logo.dataUrl}" alt="Business logo">` : '') +
    `<h3>${esc(m.biz.name) || 'Your Business'}</h3>` +
    `<div class="pv-meta">${esc(m.biz.details)}</div></div>` +
    `<div style="text-align:right"><div style="font-size:22px;font-weight:700;color:${brand}">${esc(m.docType.toUpperCase())}</div>` +
    `<div class="pv-meta">${esc(m.invNo)}</div>` +
    (m.po ? `<div class="pv-meta">PO: ${esc(m.po)}</div>` : '') +
    `</div></div>` +
    `<div class="pv-parties"><div><div class="lbl">Bill to</div><strong>${esc(m.cli.name)}</strong>` +
    `<div class="pv-meta">${esc(m.cli.details)}</div>` +
    (m.ship ? `<div class="lbl" style="margin-top:8px">Ship to</div><div class="pv-meta">${esc(m.ship)}</div>` : '') +
    `</div>` +
    `<div style="text-align:right"><div class="lbl">Date</div>${esc(m.date) || '—'}` +
    `<div class="lbl" style="margin-top:6px">Due</div>${esc(m.due) || '—'}` +
    (m.terms ? `<div class="pv-meta" style="margin-top:2px">${esc(m.terms)}</div>` : '') +
    `</div></div>` +
    `<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<div class="pv-totals">` +
    `<div class="pv-row"><span>Subtotal</span><span>${money(m.t.subtotal)}</span></div>` +
    (m.t.tax ? `<div class="pv-row"><span>${esc(m.t.taxLabel)}</span><span>${money(m.t.tax)}</span></div>` : '') +
    (m.t.discount ? `<div class="pv-row"><span>${esc(m.t.discountLabel)}</span><span>−${money(m.t.discount)}</span></div>` : '') +
    (m.t.shipping ? `<div class="pv-row"><span>Shipping</span><span>${money(m.t.shipping)}</span></div>` : '') +
    `<div class="pv-row grand" style="border-top-color:${brand}"><span>Total</span><span>${money(m.t.total)}</span></div>` +
    (m.t.amountPaid ? `<div class="pv-row"><span>Amount paid</span><span>−${money(m.t.amountPaid)}</span></div>` : '') +
    (m.t.amountPaid
      ? (m.t.balanceDue <= 0
          ? `<div class="pv-row grand" style="border-top-color:${brand};color:${brand}"><span>Balance due</span><span>${money(0)} · PAID</span></div>`
          : `<div class="pv-row grand" style="border-top-color:${brand}"><span>Balance due</span><span>${money(m.t.balanceDue)}</span></div>`)
      : '') +
    `</div>` +
    (m.notes ? `<div class="pv-notes">${esc(m.notes)}</div>` : '');

  saveState();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// --- full per-invoice autosave (localStorage, stays in browser) --------------
// Restores the whole invoice (every field + line items + logo) on return so a
// refresh never loses work. The lighter business-profile store above is kept as
// the identity record behind the "Clear saved business details" button.
const STORE_KEY = 'tb.invoice.v2';
const FIELD_IDS = ['docType', 'bizName', 'bizDetails', 'cliName', 'cliDetails', 'shipDetails', 'invNo', 'poNumber', 'currency',
  'invDate', 'paymentTerms', 'dueDate', 'taxRate', 'taxMode', 'discount', 'discountMode', 'shipping', 'amountPaid', 'brandColor', 'notes'];
let restoring = false;

function saveState() {
  if (restoring) return;
  try {
    const data = { fields: {}, items: [], logo };
    FIELD_IDS.forEach((id) => { if ($(id)) data.fields[id] = $(id).value; });
    data.signature = !!($('showSignature') && $('showSignature').checked);
    data.items = [...document.querySelectorAll('#items .item-row')].map((row) => ({
      desc: row.querySelector('.d').value,
      qty: row.querySelector('.q').value,
      rate: row.querySelector('.r').value
    }));
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) { /* storage unavailable/full — ignore, autosave is best-effort */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearState() {
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
}

// --- PDF export --------------------------------------------------------------
function downloadPdf() {
  const status = $('pdfStatus');
  if (!window.jspdf || !window.jspdf.jsPDF) {
    status.textContent = 'PDF library failed to load — please refresh and try again.';
    return;
  }
  const { jsPDF } = window.jspdf;
  const m = readModel();
  const docTitle = (m.docType || 'Invoice').toUpperCase();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 48; // margin
  let y = M;
  const [br, bg, bb] = brandRgb();

  // Document title pinned to the top-right, in the chosen brand color.
  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(br, bg, bb);
  doc.text(docTitle, W - M, y, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90);
  doc.text(m.invNo || '', W - M, y + 16, { align: 'right' });
  if (m.po) {
    doc.setFontSize(9).setTextColor(120);
    doc.text('PO: ' + m.po, W - M, y + 30, { align: 'right' });
  }

  // optional logo above the business name on the left
  if (logo) {
    const maxW = 140, maxH = 56;
    const r = Math.min(maxW / logo.w, maxH / logo.h);
    const lw = logo.w * r, lh = logo.h * r;
    doc.addImage(logo.dataUrl, 'PNG', M, y, lw, lh);
    y += lh + 12;
  }

  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(20);
  doc.text(m.biz.name || 'Your Business', M, y);
  y += 16;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90);
  doc.text(doc.splitTextToSize(m.biz.details || '', 240), M, y);

  y += Math.max(doc.splitTextToSize(m.biz.details || '', 240).length * 12, 24) + 18;

  // bill to + dates
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(130);
  doc.text('BILL TO', M, y);
  doc.text('DATE', W - M - 120, y);
  doc.text('DUE', W - M, y, { align: 'right' });
  y += 14;
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(30);
  doc.text(m.cli.name || '', M, y);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90);
  doc.text(m.date || '—', W - M - 120, y);
  doc.text(m.due || '—', W - M, y, { align: 'right' });
  if (m.terms) {
    doc.setFontSize(9).setTextColor(130);
    doc.text(m.terms, W - M, y + 12, { align: 'right' });
    doc.setFontSize(10).setTextColor(90);
  }
  y += 12;
  doc.text(doc.splitTextToSize(m.cli.details || '', 240), M, y);
  y += Math.max(doc.splitTextToSize(m.cli.details || '', 240).length * 12, 12) + 18;

  // optional ship-to block, only when the user filled it in
  if (m.ship) {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(130);
    doc.text('SHIP TO', M, y);
    y += 14;
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90);
    const slines = doc.splitTextToSize(m.ship, 240);
    doc.text(slines, M, y);
    y += slines.length * 12 + 18;
  }

  // table header
  const cols = { desc: M, qty: W - M - 230, rate: W - M - 130, amt: W - M };
  doc.setDrawColor(30).setLineWidth(1).line(M, y, W - M, y);
  y += 14;
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(90);
  doc.text('DESCRIPTION', cols.desc, y);
  doc.text('QTY', cols.qty, y, { align: 'right' });
  doc.text('RATE', cols.rate, y, { align: 'right' });
  doc.text('AMOUNT', cols.amt, y, { align: 'right' });
  y += 8;
  doc.setDrawColor(200).setLineWidth(0.5).line(M, y, W - M, y);
  y += 14;

  // rows
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40);
  for (const it of m.items) {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = M; }
    const dlines = doc.splitTextToSize(it.desc || '', cols.qty - M - 16);
    doc.text(dlines, cols.desc, y);
    doc.text(String(it.qty), cols.qty, y, { align: 'right' });
    doc.text(money(it.rate), cols.rate, y, { align: 'right' });
    doc.text(money(it.amount), cols.amt, y, { align: 'right' });
    y += Math.max(dlines.length * 12, 16);
    doc.setDrawColor(235).setLineWidth(0.5).line(M, y - 4, W - M, y - 4);
  }

  // totals
  y += 10;
  const tx = W - M - 150;
  const line = (label, val, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 12 : 10).setTextColor(bold ? 20 : 80);
    doc.text(label, tx, y);
    doc.text(val, W - M, y, { align: 'right' });
    y += bold ? 18 : 15;
  };
  line('Subtotal', money(m.t.subtotal));
  if (m.t.tax) line(m.t.taxLabel, money(m.t.tax));
  if (m.t.discount) line(m.t.discountLabel, '-' + money(m.t.discount));
  if (m.t.shipping) line('Shipping', money(m.t.shipping));
  doc.setDrawColor(br, bg, bb).setLineWidth(1).line(tx, y - 4, W - M, y - 4);
  y += 8;
  line('Total', money(m.t.total), true);
  if (m.t.amountPaid) {
    line('Amount paid', '-' + money(m.t.amountPaid));
    doc.setDrawColor(br, bg, bb).setLineWidth(1).line(tx, y - 4, W - M, y - 4);
    y += 8;
    if (m.t.balanceDue <= 0) {
      doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(br, bg, bb);
      doc.text('Balance due', tx, y);
      doc.text(money(0) + '  PAID', W - M, y, { align: 'right' });
      y += 18;
    } else {
      line('Balance due', money(m.t.balanceDue), true);
    }
  }

  // notes
  if (m.notes) {
    y += 14;
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110);
    const nlines = doc.splitTextToSize(m.notes, W - 2 * M);
    doc.text(nlines, M, y);
    y += nlines.length * 11;
  }

  // optional signature block in the footer: a blank rule to sign by hand plus a
  // shorter date rule beside it, each with a small label underneath.
  if (m.signature) {
    const H = doc.internal.pageSize.getHeight();
    if (y > H - 110) { doc.addPage(); y = M; }
    const ruleY = Math.max(y + 50, H - 72); // sit near the bottom, never over content
    const sigW = 200, dateX = M + sigW + 30, dateW = 110;
    doc.setDrawColor(120).setLineWidth(0.75);
    doc.line(M, ruleY, M + sigW, ruleY);             // signature rule
    doc.line(dateX, ruleY, dateX + dateW, ruleY);    // date rule
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110);
    doc.text('Authorized signature', M, ruleY + 13);
    doc.text('Date', dateX, ruleY + 13);
  }

  const safe = (m.invNo || 'invoice').replace(/[^\w.-]+/g, '-');
  doc.save(`${safe}.pdf`);
  status.textContent = 'PDF downloaded.';
  saveState();
}

// --- init --------------------------------------------------------------------
function isoToday(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const ITEMS_HEAD = '<div class="item-head"><span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span><span></span></div>';

function fillDefaultItems(items) {
  items.appendChild(itemRow('Design services', '10', '75'));
  items.appendChild(itemRow('Hosting (monthly)', '1', '25'));
}

// Apply a saved snapshot to the form. Returns false if nothing usable was found.
function applyState(saved) {
  if (!saved || typeof saved !== 'object') return false;
  restoring = true;
  try {
    FIELD_IDS.forEach((id) => {
      if ($(id) && saved.fields && saved.fields[id] != null) $(id).value = saved.fields[id];
    });
    const items = $('items');
    items.innerHTML = ITEMS_HEAD;
    if (Array.isArray(saved.items) && saved.items.length) {
      saved.items.forEach((it) => items.appendChild(itemRow(it.desc, it.qty, it.rate)));
    } else {
      fillDefaultItems(items);
    }
    if (saved.logo && saved.logo.dataUrl) {
      logo = { dataUrl: saved.logo.dataUrl, w: saved.logo.w || 1, h: saved.logo.h || 1 };
      $('removeLogo').hidden = false;
    }
    if ($('showSignature')) $('showSignature').checked = !!saved.signature;
  } finally {
    restoring = false;
  }
  return true;
}

// Increment the trailing number in an invoice id, preserving any zero-padding
// and prefix/suffix. "INV-001" -> "INV-002", "2026-09" -> "2026-10", "INV7" ->
// "INV8". No trailing digits -> append "-2" so the next id is still distinct.
function nextInvoiceNo(cur) {
  const s = String(cur == null ? '' : cur).trim();
  const m = s.match(/(\d+)(\D*)$/);
  if (!m) return s ? s + '-2' : 'INV-002';
  const digits = m[1];
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  return s.slice(0, m.index) + next + m[2];
}

// Keep the sender/client/branding and start a fresh invoice for the next bill:
// bump the invoice number, clear the line items + amount paid, re-derive the
// due date from the active terms. Mirrors the "duplicate / next invoice"
// workflow competitors ship so recurring clients don't get re-typed each cycle.
function startNextInvoice() {
  $('invNo').value = nextInvoiceNo($('invNo').value);
  if ($('poNumber')) $('poNumber').value = '';
  if ($('amountPaid')) $('amountPaid').value = '0';
  const items = $('items');
  items.innerHTML = ITEMS_HEAD;
  items.appendChild(itemRow());
  $('invDate').value = isoToday(0);
  applyTerms(); // re-derive the due date from the issue date + active term
  render();
  const status = $('pdfStatus');
  if (status) status.textContent = 'Started ' + (($('docType') && $('docType').value) || 'invoice') + ' ' + $('invNo').value + ' — business and client details kept.';
}

function resetForm() {
  clearState();
  clearProfile();
  logo = null;
  if ($('logoInput')) $('logoInput').value = '';
  $('removeLogo').hidden = true;
  if ($('logoStatus')) $('logoStatus').textContent = 'Added to the PDF — stays in your browser, never uploaded.';
  const items = $('items');
  items.innerHTML = ITEMS_HEAD;
  fillDefaultItems(items);
  // restore the shipped defaults for the simple fields
  if ($('docType')) $('docType').value = 'Invoice';
  $('bizName').value = 'Your Business LLC';
  $('bizDetails').value = '123 Main St\nCity, ST 00000\nyou@example.com';
  $('cliName').value = 'Client Co.';
  $('cliDetails').value = '456 Market Ave\nCity, ST 00000';
  if ($('shipDetails')) $('shipDetails').value = '';
  $('invNo').value = 'INV-001';
  if ($('poNumber')) $('poNumber').value = '';
  $('currency').value = 'USD';
  $('taxRate').value = '0';
  if ($('taxMode')) $('taxMode').value = 'percent';
  $('discount').value = '0';
  if ($('discountMode')) $('discountMode').value = 'flat';
  if ($('shipping')) $('shipping').value = '0';
  if ($('amountPaid')) $('amountPaid').value = '0';
  if ($('brandColor')) $('brandColor').value = DEFAULT_BRAND;
  $('notes').value = 'Payment due within 30 days. Thank you for your business.';
  if ($('showSignature')) $('showSignature').checked = false;
  $('invDate').value = isoToday(0);
  if ($('paymentTerms')) $('paymentTerms').value = '30';
  applyTerms(); // due date = invoice date + Net 30
  render();
}

function init() {
  const items = $('items');
  const saved = loadState();
  if (!applyState(saved)) {
    items.innerHTML = ITEMS_HEAD;
    fillDefaultItems(items);
  }
  // Restore the lightweight business profile (identity + logo + brand) so it is
  // present even on a device that has the profile but not a full saved invoice.
  loadProfile();

  // Bind shipping/amountPaid (static money fields) now that any restored
  // values are in place, so a returning visitor's saved figures reformat with
  // live thousands separators on load. Line-item rate fields (dynamic, one
  // per row) are bound individually inside itemRow() as each row is created.
  initMoneyInputs();

  $('addItem').addEventListener('click', () => { items.appendChild(itemRow()); render(); });
  ['docType', 'bizName', 'bizDetails', 'cliName', 'cliDetails', 'shipDetails', 'invNo', 'poNumber', 'currency', 'taxRate', 'taxMode', 'discount', 'discountMode', 'shipping', 'amountPaid', 'brandColor', 'notes']
    .forEach((id) => { if ($(id)) $(id).addEventListener('input', render); });
  ['taxMode', 'discountMode'].forEach((id) => { if ($(id)) $(id).addEventListener('change', render); });
  // persist the business-identity fields on this device for return visits
  ['bizName', 'bizDetails', 'currency', 'brandColor'].forEach((id) => { if ($(id)) $(id).addEventListener('input', saveProfile); });
  // Signature toggle affects only the PDF, but re-render to persist the choice.
  if ($('showSignature')) $('showSignature').addEventListener('change', render);
  // Payment terms: a preset auto-fills the due date from the invoice date.
  if ($('paymentTerms')) $('paymentTerms').addEventListener('change', () => { applyTerms(); render(); });
  $('invDate').addEventListener('input', () => { applyTerms(); render(); });
  // Editing the due date by hand switches terms to "Custom" so it isn't overwritten.
  $('dueDate').addEventListener('input', () => { if ($('paymentTerms')) $('paymentTerms').value = ''; render(); });
  if ($('resetBrand')) $('resetBrand').addEventListener('click', () => { if ($('brandColor')) $('brandColor').value = DEFAULT_BRAND; saveProfile(); render(); });
  $('downloadPdf').addEventListener('click', downloadPdf);
  if ($('nextInvoice')) $('nextInvoice').addEventListener('click', startNextInvoice);
  if ($('clearInvoice')) $('clearInvoice').addEventListener('click', () => {
    if (window.confirm('Clear this invoice and start fresh? Saved data on this device will be removed.')) resetForm();
  });
  if ($('clearProfile')) $('clearProfile').addEventListener('click', clearProfile);
  if ($('logoInput')) $('logoInput').addEventListener('change', (e) => loadLogo(e.target.files[0]));
  $('removeLogo').addEventListener('click', clearLogo);

  // Only seed dates when neither saved nor present (fresh first visit).
  if (!saved && !$('invDate').value) $('invDate').value = isoToday(0);
  if (!saved && !$('dueDate').value) $('dueDate').value = isoToday(30);
  render();
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
