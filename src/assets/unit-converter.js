// unit-converter.js — general-purpose unit converter, live.
// Pure math via the shared units module. No deps, nothing uploaded.
import { UNITS, LABELS, convert } from '/assets/units.js';

const $ = (id) => document.getElementById(id);

// Format a number for display: thousands separators, sensible decimals, no
// trailing-zero noise. Returns '' for non-finite input so the UI shows a dash.
function fmt(n, maxFrac = 6) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac });
}

const isBlank = (id) => $(id).value.trim() === '';

// Fill the from/to unit dropdowns for the current category.
function populateUnits(category, preferFrom, preferTo) {
  const units = UNITS[category] || [];
  const from = $('fromUnit');
  const to = $('toUnit');
  from.innerHTML = '';
  to.innerHTML = '';
  units.forEach((u) => {
    const o1 = document.createElement('option');
    o1.value = u;
    o1.textContent = LABELS[u];
    from.appendChild(o1);
    const o2 = document.createElement('option');
    o2.value = u;
    o2.textContent = LABELS[u];
    to.appendChild(o2);
  });
  from.value = preferFrom && units.includes(preferFrom) ? preferFrom : units[0];
  to.value = preferTo && units.includes(preferTo) ? preferTo : units[1] || units[0];
}

function showCategory(category) {
  populateUnits(category);
  convertNow();
}

function convertNow() {
  const category = $('category').value;
  const big = $('resultBig');
  const sub = $('resultSub');
  big.textContent = '—';
  sub.textContent = '';

  if (isBlank('amount')) return;
  const amount = parseFloat($('amount').value);
  if (!Number.isFinite(amount)) return;
  const fromU = $('fromUnit').value;
  const toU = $('toUnit').value;
  const r = convert(category, fromU, toU, amount);
  if (!Number.isFinite(r)) return;
  big.textContent = fmt(r);
  sub.textContent = `${fmt(amount)} ${LABELS[fromU]} = ${fmt(r)} ${LABELS[toU]}`;
}

function swapUnits() {
  const from = $('fromUnit');
  const to = $('toUnit');
  const tmp = from.value;
  from.value = to.value;
  to.value = tmp;
  convertNow();
}

function init() {
  showCategory($('category').value);
  $('category').addEventListener('change', () => showCategory($('category').value));
  ['amount', 'fromUnit', 'toUnit'].forEach((id) => {
    const el = $(id);
    if (el) {
      el.addEventListener('input', convertNow);
      el.addEventListener('change', convertNow);
    }
  });
  $('swapBtn').addEventListener('click', swapUnits);
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
