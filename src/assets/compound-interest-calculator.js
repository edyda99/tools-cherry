// compound-interest-calculator.js — compound interest / savings growth, live results.
// Pure math via the shared compound-interest engine. No deps, nothing uploaded.
import { project } from '/assets/compound-interest.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

function money(n, max = 2) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: max
  });
}

function fmt(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Required field: blank/whitespace -> NaN ("not set yet").
function val(id) {
  const raw = $(id).value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}
// Optional field: blank -> 0, negatives ignored.
function optVal(id) {
  const raw = $(id).value.trim();
  if (raw === '') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function reset() {
  $('fvBig').textContent = '—';
  $('fvSub').textContent = '';
  ['principalLine', 'contribLine', 'interestLine', 'summaryBox', 'scheduleWrap'].forEach((id) => {
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

function buildSchedule(schedule) {
  const tbody = $('scheduleBody');
  let rows = '';
  for (const row of schedule) {
    rows += `<tr><td>${row.year}</td><td>${money(row.contributions)}</td>` +
      `<td>${money(row.interest)}</td><td>${money(row.balanceEnd)}</td></tr>`;
  }
  tbody.innerHTML = rows;
}

// Keep the deposit field's label cadence in sync with the frequency control,
// so the dropdown's dual effect (deposit cadence AND compounding) is visible at the field.
function syncDepositLabel() {
  const lbl = $('contribLabel');
  if (!lbl) return;
  const perYear = parseInt($('frequency').value, 10) || 12;
  lbl.textContent = perYear === 12 ? 'Regular deposit ($ per month)' : 'Regular deposit ($ per year)';
}

function calc() {
  reset();
  syncDepositLabel();

  const principal = optVal('principal');
  const contribution = optVal('contribution');
  const ratePct = val('rate');
  const years = val('years');
  // How often the deposit is made AND interest is compounded: 12 = monthly, 1 = yearly.
  const perYear = parseInt($('frequency').value, 10) || 12;
  const atStart = $('timing').value === 'start';

  if (!Number.isFinite(ratePct) || ratePct < 0) {
    $('fvSub').textContent = 'Enter an interest rate to start.';
    return;
  }
  if (!Number.isFinite(years) || years <= 0) {
    $('fvSub').textContent = 'Enter the number of years to start.';
    return;
  }
  if (principal <= 0 && contribution <= 0) {
    $('fvSub').textContent = 'Enter a starting amount or a regular deposit.';
    return;
  }

  const r = project(principal, contribution, ratePct, years, perYear, { atStart });
  if (!Number.isFinite(r.futureValue)) return;

  $('fvBig').textContent = money(r.futureValue);
  $('fvSub').textContent = `Balance after ${fmt(years)} year${years === 1 ? '' : 's'}`;

  show('principalLine', 'Starting amount', money(r.totalPrincipal));
  show('contribLine', 'Total deposits added', money(r.totalContributions));
  show('interestLine', 'Total interest earned', money(r.totalInterest));
  $('interestLine').classList.add('total');

  const freqWord = perYear === 12 ? 'monthly' : 'yearly';
  const depositPart = contribution > 0
    ? ` plus ${money(contribution)} ${freqWord}`
    : '';
  $('summaryText').textContent =
    `Starting with ${money(r.totalPrincipal)}${depositPart} at ${fmt(ratePct)}% a year, ` +
    `compounded ${freqWord}, your balance grows to about ${money(r.futureValue)} after ` +
    `${fmt(years)} year${years === 1 ? '' : 's'}. Of that, ${money(r.totalContributions)} came ` +
    `from your deposits and ${money(r.totalInterest)} is interest earned on top.`;
  $('summaryBox').hidden = false;

  buildSchedule(r.schedule);
  $('scheduleWrap').hidden = false;
}

function init() {
  document.querySelectorAll('#compoundForm input, #compoundForm select').forEach((el) =>
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
