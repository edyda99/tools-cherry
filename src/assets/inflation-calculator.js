// inflation-calculator.js — US inflation calculator (BLS CPI-U), live results.
// Pure math via the shared inflation engine. No deps, nothing uploaded.
// The CPI table is embedded into the page as window.__CPI_US__ by build.js.
import {
  inflationValue,
  totalPercentChange,
  annualizedRate
} from '/assets/inflation.js';

const $ = (id) => document.getElementById(id);

const CPI = (typeof window !== 'undefined' && window.__CPI_US__) || { data: {} };
const CPI_DATA = CPI.data || {};

function money(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
}

function pct(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
}

const isBlank = (id) => $(id).value.trim() === '';

// Build the year <option>s from the available CPI data range (ascending).
function fillYears() {
  const years = Object.keys(CPI_DATA)
    .map(Number)
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b);
  if (!years.length) return { min: null, max: null };

  const min = years[0];
  const max = years[years.length - 1];
  const opts = years.map((y) => `<option value="${y}">${y}</option>`).join('');
  $('fromYear').innerHTML = opts;
  $('toYear').innerHTML = opts;

  // Sensible defaults: a generation ago -> latest year.
  const defaultFrom = Math.max(min, max - 25);
  $('fromYear').value = String(defaultFrom);
  $('toYear').value = String(max);
  return { min, max };
}

function calc() {
  const big = $('resultBig');
  const sub = $('resultSub');
  const line1 = $('line1');
  const line2 = $('line2');
  const line3 = $('line3');

  // default: hide detail lines, show placeholder
  line1.hidden = true;
  line2.hidden = true;
  line3.hidden = true;
  big.textContent = '—';
  sub.textContent = '';

  if (isBlank('amount')) return;

  const amount = parseFloat($('amount').value);
  const yFrom = parseInt($('fromYear').value, 10);
  const yTo = parseInt($('toYear').value, 10);
  const cpiFrom = CPI_DATA[String(yFrom)];
  const cpiTo = CPI_DATA[String(yTo)];

  if (!Number.isFinite(amount) || cpiFrom == null || cpiTo == null) {
    sub.textContent = 'Enter an amount and pick two years.';
    return;
  }

  const value = inflationValue(amount, cpiFrom, cpiTo);
  if (!Number.isFinite(value)) return;

  big.textContent = money(value);
  sub.textContent = `${money(amount)} in ${yFrom} has the same buying power as ${money(value)} in ${yTo}`;

  const change = totalPercentChange(cpiFrom, cpiTo);
  const rate = annualizedRate(cpiFrom, cpiTo, yTo - yFrom);

  line1.hidden = false;
  line1.querySelector('.lbl').textContent = `Total price change ${yFrom}→${yTo}`;
  line1.querySelector('.v').textContent =
    (change > 0 ? '+' : '') + pct(change);

  line2.hidden = false;
  line2.querySelector('.lbl').textContent = 'Average inflation per year';
  line2.querySelector('.v').textContent =
    yFrom === yTo ? '—' : (rate > 0 ? '+' : '') + pct(rate);

  line3.hidden = false;
  line3.querySelector('.lbl').textContent = 'Cumulative multiplier';
  line3.querySelector('.v').textContent =
    (cpiTo / cpiFrom).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '×';
}

function init() {
  const range = fillYears();
  if (range.min != null) {
    const note = $('rangeNote');
    if (note) note.textContent = `${range.min}–${range.max}`;
  }
  $('fromYear').addEventListener('change', calc);
  $('toYear').addEventListener('change', calc);
  $('amount').addEventListener('input', calc);
  $('swap').addEventListener('click', () => {
    const a = $('fromYear').value;
    $('fromYear').value = $('toYear').value;
    $('toYear').value = a;
    calc();
  });
  calc();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
