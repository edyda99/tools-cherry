// rule-of-72-calculator.js — Rule of 72 doubling time, live results.
// Pure math via the shared rule-of-72 engine. No deps, nothing uploaded.
import { fromRate, fromYears } from '/assets/rule-of-72.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

function fmt(n, dp = 2) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: dp });
}
function pct(n, dp = 2) {
  if (!Number.isFinite(n)) return '';
  return fmt(n, dp) + '%';
}
function years(n, dp = 1) {
  if (!Number.isFinite(n)) return '';
  const v = fmt(n, dp);
  return `${v} year${n === 1 ? '' : 's'}`;
}

// Required field: blank/whitespace -> NaN ("not set yet").
function val(id) {
  const el = $(id);
  if (!el) return NaN;
  const raw = el.value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}

// The user picks ONE mode via the toggle, so only the active mode's single input
// is read — never both at once.
function activeMode() {
  const checked = document.querySelector('input[name="r72Mode"]:checked');
  return checked ? checked.value : 'rate';
}

function syncMode() {
  const rateMode = activeMode() === 'rate';
  $('rateMode').hidden = !rateMode;
  $('yearsMode').hidden = rateMode;
}

function reset(message) {
  $('r72Big').textContent = '—';
  $('r72Sub').textContent = message || '';
  ['r72Line', 'r70Line', 'r693Line', 'exactLine', 'summaryBox'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = true;
  });
}

function show(lineId, label, value) {
  const line = $(lineId);
  if (!line) return;
  line.hidden = false;
  const lbl = line.querySelector('.lbl');
  const v = line.querySelector('.val');
  if (lbl) lbl.textContent = label;
  if (v) v.textContent = value;
}

function calcRate() {
  const rate = val('rate');
  if (!Number.isFinite(rate) || rate <= 0) {
    reset('Enter an annual interest rate above 0% to start.');
    return;
  }

  const r = fromRate(rate);
  if (!Number.isFinite(r.years72)) {
    reset('Enter an annual interest rate above 0% to start.');
    return;
  }

  $('r72Big').textContent = years(r.years72);
  $('r72Sub').textContent = `to double your money at ${pct(rate)} per year (Rule of 72)`;

  show('r72Line', 'Rule of 72 (72 ÷ rate)', years(r.years72));
  show('r70Line', 'Rule of 70 (70 ÷ rate)', years(r.years70));
  show('r693Line', 'Rule of 69.3 (69.3 ÷ rate)', years(r.years693));
  show('exactLine', 'Exact (continuous compounding math)', years(r.exactYears, 2));
  $('exactLine').classList.add('total');

  $('summaryText').textContent =
    `At ${pct(rate)} per year, your money doubles in about ${years(r.years72)} ` +
    `using the Rule of 72. The Rule of 70 gives ${years(r.years70)} and the Rule of 69.3 ` +
    `gives ${years(r.years693)}. The exact figure, accounting for compounding, is ` +
    `${years(r.exactYears, 2)}.`;
  $('summaryBox').hidden = false;
}

function calcYears() {
  const t = val('years');
  if (!Number.isFinite(t) || t <= 0) {
    reset('Enter a timeframe in years above 0 to start.');
    return;
  }

  const r = fromYears(t);
  if (!Number.isFinite(r.rate72)) {
    reset('Enter a timeframe in years above 0 to start.');
    return;
  }

  $('r72Big').textContent = pct(r.rate72);
  $('r72Sub').textContent = `annual return needed to double in ${years(t)} (Rule of 72)`;

  show('r72Line', 'Rule of 72 (72 ÷ years)', pct(r.rate72));
  show('r70Line', 'Rule of 70 (70 ÷ years)', pct(r.rate70));
  show('r693Line', 'Rule of 69.3 (69.3 ÷ years)', pct(r.rate693));
  show('exactLine', 'Exact (true compounding math)', pct(r.exactRate));
  $('exactLine').classList.add('total');

  $('summaryText').textContent =
    `To double your money in ${years(t)}, you need about ${pct(r.rate72)} per year ` +
    `using the Rule of 72. The Rule of 70 gives ${pct(r.rate70)} and the Rule of 69.3 ` +
    `gives ${pct(r.rate693)}. The exact rate needed, accounting for compounding, is ` +
    `${pct(r.exactRate)}.`;
  $('summaryBox').hidden = false;
}

function calc() {
  if (activeMode() === 'rate') calcRate();
  else calcYears();
}

function init() {
  document.querySelectorAll('#r72Form input[type="number"]').forEach((el) =>
    el.addEventListener('input', calc)
  );
  document.querySelectorAll('input[name="r72Mode"]').forEach((el) =>
    el.addEventListener('change', () => { syncMode(); calc(); })
  );
  syncMode();
  calc();
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
