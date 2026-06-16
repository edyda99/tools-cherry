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

// --- logo (optional, stays in browser) --------------------------------------
let logo = null; // { data: dataURL, fmt: 'PNG'|'JPEG', w, h }

function loadLogo(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const fmt = /^data:image\/png/.test(reader.result) ? 'PNG' : 'JPEG';
      logo = { data: reader.result, fmt, w: img.naturalWidth, h: img.naturalHeight };
      $('removeLogo').hidden = false;
      render();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

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

// --- line items --------------------------------------------------------------
function attr(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function itemRow(desc = '', qty = '1', rate = '0') {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML =
    `<input class="d" placeholder="Description" value="${attr(desc)}">` +
    `<input class="q" type="number" min="0" step="any" value="${attr(qty)}">` +
    `<input class="r" type="number" min="0" step="any" value="${attr(rate)}">` +
    `<input class="a" value="0.00" readonly tabindex="-1">` +
    `<button type="button" class="rm" title="Remove">×</button>`;
  row.querySelector('.rm').addEventListener('click', () => { row.remove(); render(); });
  row.querySelectorAll('input').forEach((el) => el.addEventListener('input', render));
  return row;
}

function readItems() {
  return [...document.querySelectorAll('#items .item-row')].map((row) => {
    const desc = row.querySelector('.d').value;
    const qty = parseFloat(row.querySelector('.q').value) || 0;
    const rate = parseFloat(row.querySelector('.r').value) || 0;
    const amount = qty * rate;
    row.querySelector('.a').value = amount.toFixed(2);
    return { desc, qty, rate, amount };
  });
}

function totals(items) {
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const taxRate = parseFloat($('taxRate').value) || 0;
  const discountInput = parseFloat($('discount').value) || 0;
  const discountType = ($('discountType') && $('discountType').value) || 'amount';
  const shipping = ($('shipping') && parseFloat($('shipping').value)) || 0;
  // Percent discount is applied to the subtotal (before tax).
  const discount = discountType === 'percent'
    ? subtotal * (discountInput / 100)
    : discountInput;
  const tax = subtotal * (taxRate / 100);
  // Shipping is added after tax/discount (it's a flat pass-through charge, untaxed).
  const total = Math.max(0, subtotal + tax - discount + shipping);
  // Amount already paid (e.g. a deposit); balance due is what's still owed.
  const amountPaid = ($('amountPaid') && parseFloat($('amountPaid').value)) || 0;
  const balanceDue = total - amountPaid;
  return { subtotal, taxRate, tax, discount, discountType, discountInput, shipping, total, amountPaid, balanceDue };
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
    biz: { name: $('bizName').value, details: $('bizDetails').value },
    cli: { name: $('cliName').value, details: $('cliDetails').value },
    invNo: $('invNo').value,
    po: ($('poNumber') && $('poNumber').value) || '',
    date: $('invDate').value,
    due: $('dueDate').value,
    terms: termLabel(),
    notes: $('notes').value,
    items,
    t: totals(items)
  };
}

// --- live preview ------------------------------------------------------------
function render() {
  const m = readModel();
  const brand = brandHex();
  const rows = m.items
    .map(
      (i) =>
        `<tr><td>${esc(i.desc) || '&nbsp;'}</td><td class="num">${i.qty}</td>` +
        `<td class="num">${money(i.rate)}</td><td class="num">${money(i.amount)}</td></tr>`
    )
    .join('');

  $('preview').innerHTML =
    `<div class="pv-row"><div>` +
    (logo ? `<img src="${logo.data}" alt="Business logo" style="max-height:48px;max-width:160px;margin-bottom:8px;display:block">` : '') +
    `<h3>${esc(m.biz.name) || 'Your Business'}</h3>` +
    `<div class="pv-meta">${esc(m.biz.details)}</div></div>` +
    `<div style="text-align:right"><div style="font-size:22px;font-weight:700;color:${brand}">INVOICE</div>` +
    `<div class="pv-meta">${esc(m.invNo)}</div>` +
    (m.po ? `<div class="pv-meta">PO: ${esc(m.po)}</div>` : '') +
    `</div></div>` +
    `<div class="pv-parties"><div><div class="lbl">Bill to</div><strong>${esc(m.cli.name)}</strong>` +
    `<div class="pv-meta">${esc(m.cli.details)}</div></div>` +
    `<div style="text-align:right"><div class="lbl">Date</div>${esc(m.date) || '—'}` +
    `<div class="lbl" style="margin-top:6px">Due</div>${esc(m.due) || '—'}` +
    (m.terms ? `<div class="pv-meta" style="margin-top:2px">${esc(m.terms)}</div>` : '') +
    `</div></div>` +
    `<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<div class="pv-totals">` +
    `<div class="pv-row"><span>Subtotal</span><span>${money(m.t.subtotal)}</span></div>` +
    (m.t.taxRate ? `<div class="pv-row"><span>Tax (${m.t.taxRate}%)</span><span>${money(m.t.tax)}</span></div>` : '') +
    (m.t.discount ? `<div class="pv-row"><span>Discount${m.t.discountType === 'percent' ? ` (${m.t.discountInput}%)` : ''}</span><span>−${money(m.t.discount)}</span></div>` : '') +
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

// --- autosave (localStorage, stays in browser) -------------------------------
const STORE_KEY = 'tb.invoice.v1';
const FIELD_IDS = ['bizName', 'bizDetails', 'cliName', 'cliDetails', 'invNo', 'poNumber', 'currency',
  'invDate', 'paymentTerms', 'dueDate', 'taxRate', 'discount', 'discountType', 'shipping', 'amountPaid', 'brandColor', 'notes'];
let restoring = false;

function saveState() {
  if (restoring) return;
  try {
    const data = { fields: {}, items: [], logo };
    FIELD_IDS.forEach((id) => { if ($(id)) data.fields[id] = $(id).value; });
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
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 48; // margin
  let y = M;
  const [br, bg, bb] = brandRgb();

  // INVOICE title pinned to the top-right, in the chosen brand color
  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(br, bg, bb);
  doc.text('INVOICE', W - M, y, { align: 'right' });
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
    doc.addImage(logo.data, logo.fmt, M, y, lw, lh);
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
  if (m.t.taxRate) line(`Tax (${m.t.taxRate}%)`, money(m.t.tax));
  if (m.t.discount) line(m.t.discountType === 'percent' ? `Discount (${m.t.discountInput}%)` : 'Discount', '-' + money(m.t.discount));
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
    doc.text(doc.splitTextToSize(m.notes, W - 2 * M), M, y);
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
    if (saved.logo && saved.logo.data) {
      logo = saved.logo;
      $('removeLogo').hidden = false;
    }
  } finally {
    restoring = false;
  }
  return true;
}

function resetForm() {
  clearState();
  logo = null;
  $('logo').value = '';
  $('removeLogo').hidden = true;
  const items = $('items');
  items.innerHTML = ITEMS_HEAD;
  fillDefaultItems(items);
  // restore the shipped defaults for the simple fields
  $('bizName').value = 'Your Business LLC';
  $('bizDetails').value = '123 Main St\nCity, ST 00000\nyou@example.com';
  $('cliName').value = 'Client Co.';
  $('cliDetails').value = '456 Market Ave\nCity, ST 00000';
  $('invNo').value = 'INV-001';
  if ($('poNumber')) $('poNumber').value = '';
  $('currency').value = 'USD';
  $('taxRate').value = '0';
  $('discount').value = '0';
  $('discountType').value = 'amount';
  if ($('shipping')) $('shipping').value = '0';
  if ($('amountPaid')) $('amountPaid').value = '0';
  $('brandColor').value = DEFAULT_BRAND;
  $('notes').value = 'Payment due within 30 days. Thank you for your business.';
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

  $('addItem').addEventListener('click', () => { items.appendChild(itemRow()); render(); });
  ['bizName', 'bizDetails', 'cliName', 'cliDetails', 'invNo', 'poNumber', 'currency', 'taxRate', 'discount', 'discountType', 'shipping', 'amountPaid', 'brandColor', 'notes']
    .forEach((id) => $(id).addEventListener('input', render));
  $('discountType').addEventListener('change', render);
  // Payment terms: a preset auto-fills the due date from the invoice date.
  $('paymentTerms').addEventListener('change', () => { applyTerms(); render(); });
  $('invDate').addEventListener('input', () => { applyTerms(); render(); });
  // Editing the due date by hand switches terms to "Custom" so it isn't overwritten.
  $('dueDate').addEventListener('input', () => { $('paymentTerms').value = ''; render(); });
  $('resetBrand').addEventListener('click', () => { $('brandColor').value = DEFAULT_BRAND; render(); });
  $('downloadPdf').addEventListener('click', downloadPdf);
  $('clearInvoice').addEventListener('click', () => {
    if (window.confirm('Clear this invoice and start fresh? Saved data on this device will be removed.')) resetForm();
  });
  $('logo').addEventListener('change', (e) => loadLogo(e.target.files[0]));
  $('removeLogo').addEventListener('click', () => {
    logo = null;
    $('logo').value = '';
    $('removeLogo').hidden = true;
    render();
  });

  // Only seed dates when neither saved nor present (fresh first visit).
  if (!saved && !$('invDate').value) $('invDate').value = isoToday(0);
  if (!saved && !$('dueDate').value) $('dueDate').value = isoToday(30);
  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
