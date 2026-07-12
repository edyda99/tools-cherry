// percentage-calculator.js — multi-mode percentage calculator, live results.
// Pure math via the shared percentage-math module. No deps, nothing uploaded.
import {
  percentOf,
  whatPercent,
  percentChange,
  discount
} from '/assets/percentage-math.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

// Format a number for display: thousands separators, up to 2 decimals, no
// trailing-zero noise. Returns '' for non-finite input so the UI shows a dash.
function fmt(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function money(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
}

// A value is "blank" if the field is empty/whitespace — we stay quiet rather
// than render NaN while the user is mid-typing.
const isBlank = (id) => $(id).value.trim() === '';

const MODES = ['of', 'is', 'change', 'discount'];

function showMode(mode) {
  MODES.forEach((m) => {
    const g = document.querySelector(`[data-group="${m}"]`);
    if (g) g.hidden = m !== mode;
  });
  calc();
}

function calc() {
  const mode = $('mode').value;
  const big = $('resultBig');
  const sub = $('resultSub');
  const line1 = $('line1');
  const line2 = $('line2');
  const line1v = $('line1v');
  const line2v = $('line2v');

  // default: hide the detail lines, show a placeholder
  line1.hidden = true;
  line2.hidden = true;
  big.textContent = '—';
  sub.textContent = '';

  if (mode === 'of') {
    if (isBlank('ofPercent') || isBlank('ofValue')) return;
    const r = percentOf($('ofPercent').value, $('ofValue').value);
    if (!Number.isFinite(r)) return;
    big.textContent = fmt(r);
    sub.textContent = `${fmt(parseFloat($('ofPercent').value))}% of ${fmt(parseFloat($('ofValue').value))}`;
  } else if (mode === 'is') {
    if (isBlank('isPart') || isBlank('isWhole')) return;
    const r = whatPercent($('isPart').value, $('isWhole').value);
    if (!Number.isFinite(r)) {
      sub.textContent = 'Enter a total greater than zero.';
      return;
    }
    big.textContent = fmt(r) + '%';
    sub.textContent = `${fmt(parseFloat($('isPart').value))} out of ${fmt(parseFloat($('isWhole').value))}`;
  } else if (mode === 'change') {
    if (isBlank('chFrom') || isBlank('chTo')) return;
    const r = percentChange($('chFrom').value, $('chTo').value);
    if (!Number.isFinite(r)) {
      sub.textContent = 'Enter a starting value greater than zero.';
      return;
    }
    const dir = r > 0 ? 'increase' : r < 0 ? 'decrease' : 'no change';
    big.textContent = (r > 0 ? '+' : '') + fmt(r) + '%';
    sub.textContent = `${dir} from ${fmt(parseFloat($('chFrom').value))} to ${fmt(parseFloat($('chTo').value))}`;
    const diff = parseFloat($('chTo').value) - parseFloat($('chFrom').value);
    line1.hidden = false;
    line1v.previousElementSibling.textContent = 'Difference';
    line1v.textContent = (diff > 0 ? '+' : '') + fmt(diff);
  } else if (mode === 'discount') {
    if (isBlank('dcPrice') || isBlank('dcOff')) return;
    const { final, saved } = discount($('dcPrice').value, $('dcOff').value);
    if (!Number.isFinite(final)) return;
    big.textContent = money(final);
    sub.textContent = `Final price after ${fmt(parseFloat($('dcOff').value))}% off`;
    line1.hidden = false;
    line2.hidden = false;
    line1v.previousElementSibling.textContent = 'Original price';
    line1v.textContent = money(parseFloat($('dcPrice').value));
    line2v.previousElementSibling.textContent = 'You save';
    line2v.textContent = money(saved);
  }
}

function init() {
  $('mode').addEventListener('change', () => showMode($('mode').value));
  // live update on any input within the calculator form
  document.querySelectorAll('#pctForm input').forEach((el) =>
    el.addEventListener('input', calc)
  );
  showMode($('mode').value);
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
