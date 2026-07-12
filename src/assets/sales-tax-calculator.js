// sales-tax-calculator.js — add or remove sales tax, live results.
// Pure math via the shared sales-tax module. No deps, nothing uploaded.
import { addTax, removeTax } from '/assets/sales-tax.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

function money(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtRate(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

// A value is "blank" if the field is empty/whitespace — we stay quiet rather
// than render NaN while the user is mid-typing.
const isBlank = (id) => $(id).value.trim() === '';

const MODES = ['add', 'remove'];

function showMode(mode) {
  MODES.forEach((m) => {
    const g = document.querySelector(`[data-group="${m}"]`);
    if (g) g.hidden = m !== mode;
  });
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
  );
  calc();
}

function currentMode() {
  const pressed = document.querySelector('.unit-toggle button[aria-pressed="true"]');
  return pressed ? pressed.dataset.mode : 'add';
}

function calc() {
  const mode = currentMode();
  const big = $('resultBig');
  const sub = $('resultSub');
  const line1 = $('line1');
  const line2 = $('line2');
  const line1v = $('line1v');
  const line2v = $('line2v');

  line1.hidden = true;
  line2.hidden = true;
  big.textContent = '—';
  sub.textContent = '';

  if (mode === 'add') {
    if (isBlank('addPrice') || isBlank('addRate')) return;
    const r = addTax($('addPrice').value, $('addRate').value);
    if (!Number.isFinite(r.total)) return;
    big.textContent = money(r.total);
    sub.textContent = `Total with ${fmtRate(parseFloat($('addRate').value))}% sales tax`;
    line1.hidden = false;
    line2.hidden = false;
    line1v.previousElementSibling.textContent = 'Pre-tax price';
    line1v.textContent = money(r.price);
    line2v.previousElementSibling.textContent = 'Sales tax';
    line2v.textContent = money(r.tax);
  } else if (mode === 'remove') {
    if (isBlank('remTotal') || isBlank('remRate')) return;
    const r = removeTax($('remTotal').value, $('remRate').value);
    if (!Number.isFinite(r.price)) {
      sub.textContent = 'Enter a valid tax rate.';
      return;
    }
    big.textContent = money(r.price);
    sub.textContent = `Pre-tax price after removing ${fmtRate(parseFloat($('remRate').value))}% sales tax`;
    line1.hidden = false;
    line2.hidden = false;
    line1v.previousElementSibling.textContent = 'Sales tax included';
    line1v.textContent = money(r.tax);
    line2v.previousElementSibling.textContent = 'Total (with tax)';
    line2v.textContent = money(r.total);
  }
}

function init() {
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.addEventListener('click', () => showMode(b.dataset.mode))
  );
  document.querySelectorAll('#taxForm input').forEach((el) =>
    el.addEventListener('input', calc)
  );
  showMode('add');
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
