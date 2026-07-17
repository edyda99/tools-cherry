// double-time-pay-calculator.js — double time & overtime pay, live results.
// Pure math via the shared double-time-pay engine. No deps, nothing uploaded.
import { calculatePay, effectiveHourlyRate } from '/assets/double-time-pay.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
const $ = (id) => document.getElementById(id);

function money(n, max = 2) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: max });
}
function fmtHours(n) {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Read a numeric field. Blank/whitespace -> 0 (the worker logged none of these
// hours); anything non-numeric or negative also -> 0 so we never render NaN.
function val(id) {
  const raw = $(id).value.trim();
  if (raw === '') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The hourly rate is a money field (comma-grouped, e.g. "1,250"): read it
// comma-safe via moneyValue so a grouped value doesn't truncate at the comma.
// Blank/zero/negative -> 0, matching val()'s "logged none" semantics.
function moneyVal(id) {
  const el = $(id);
  if (el.value.trim() === '') return 0;
  const n = moneyValue(el);
  return n > 0 ? n : 0;
}

function show(lineId, value) {
  const line = $(lineId);
  if (!line) return;
  line.hidden = false;
  const v = line.querySelector('.val');
  if (v) v.textContent = value;
}

function reset() {
  $('grossBig').textContent = '—';
  $('grossSub').textContent = '';
  ['regularLine', 'overtimeLine', 'doubleLine', 'totalHoursLine', 'effectiveLine', 'summaryBox'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = true;
  });
}

function calc() {
  reset();

  const rate = moneyVal('rate');
  const regularHours = val('regularHours');
  const overtimeHours = val('overtimeHours');
  const doubleHours = val('doubleHours');

  // Nothing to compute until there's a rate and at least one hour somewhere.
  const anyHours = regularHours + overtimeHours + doubleHours;
  if (!(rate > 0)) {
    $('grossSub').textContent = 'Enter your hourly rate to start.';
    return;
  }
  if (!(anyHours > 0)) {
    $('grossSub').textContent = 'Enter your regular, overtime, or double-time hours.';
    return;
  }

  const r = calculatePay({ rate, regularHours, overtimeHours, doubleHours });

  $('grossBig').textContent = money(r.gross);
  $('grossSub').textContent = `Gross pay for ${fmtHours(r.totalHours)} hour${r.totalHours === 1 ? '' : 's'} at ${money(r.rate)}/hr`;

  // Regular tier (always shown so the breakdown reads top-to-bottom).
  $('regularDesc').textContent = `${fmtHours(r.regularHours)} hr × ${money(r.rate)}`;
  show('regularLine', money(r.regularPay));

  // Overtime tier — only when OT hours were logged.
  if (overtimeHours > 0) {
    $('overtimeDesc').textContent = `${fmtHours(r.overtimeHours)} hr × ${money(r.rate)} × 1.5`;
    show('overtimeLine', money(r.overtimePay));
  }

  // Double-time tier — only when DT hours were logged.
  if (doubleHours > 0) {
    $('doubleDesc').textContent = `${fmtHours(r.doubleHours)} hr × ${money(r.rate)} × 2`;
    show('doubleLine', money(r.doublePay));
  }

  show('totalHoursLine', `${fmtHours(r.totalHours)} hr`);
  $('totalHoursLine').classList.add('total');

  const eff = effectiveHourlyRate({ rate, regularHours, overtimeHours, doubleHours });
  if (Number.isFinite(eff)) {
    show('effectiveLine', `${money(eff)}/hr`);
  }

  // Plain-language summary of the breakdown.
  const parts = [`${money(r.regularPay)} regular`];
  if (overtimeHours > 0) parts.push(`${money(r.overtimePay)} overtime (1.5×)`);
  if (doubleHours > 0) parts.push(`${money(r.doublePay)} double time (2×)`);
  const joined = parts.length > 1
    ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
    : parts[0];
  $('summaryText').textContent =
    `Working ${fmtHours(r.totalHours)} hour${r.totalHours === 1 ? '' : 's'} at ${money(r.rate)} an hour, ` +
    `your gross pay is ${money(r.gross)} — ${joined}.`;
  $('summaryBox').hidden = false;
}

function init() {
  initMoneyInputs();
  document.querySelectorAll('#dtForm input').forEach((el) =>
    el.addEventListener('input', calc)
  );
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
