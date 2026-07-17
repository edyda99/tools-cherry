// biweekly-vs-semimonthly.js — compare biweekly (26 checks) vs semimonthly (24
// checks) gross pay for one annual salary, side by side. Live results.
// Pure math via the shared pay-frequency engine. No deps, nothing uploaded.
import { compare } from '/assets/pay-frequency.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
const $ = (id) => document.getElementById(id);

function money(n, max = 2) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: max
  });
}

// Required field: blank/whitespace -> NaN ("not set yet").
function val(id) {
  const raw = $(id).value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}
// Required money field: blank -> NaN, same as val(), but parses through
// moneyValue so a comma-grouped "52,000" doesn't silently truncate to 52 via
// a raw parseFloat.
function moneyVal(id) {
  const el = $(id);
  if (el.value.trim() === '') return NaN;
  return moneyValue(el);
}

function reset() {
  ['bwPerCheck', 'bwMonthly', 'bwAnnual', 'smPerCheck', 'smMonthly', 'smAnnual'].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = '—';
  });
  $('compareSub').textContent = '';
  $('summaryBox').hidden = true;
}

function calc() {
  reset();

  const salary = moneyVal('salary');
  if (!Number.isFinite(salary) || salary <= 0) {
    $('compareSub').textContent = 'Enter your annual salary to compare the two pay schedules.';
    return;
  }

  const r = compare(salary);
  if (!Number.isFinite(r.biweekly.perCheck) || !Number.isFinite(r.semimonthly.perCheck)) return;

  $('compareSub').textContent =
    `On a ${money(r.annualSalary, 0)} salary, biweekly pays 26 checks a year and semimonthly pays 24.`;

  // Biweekly column
  $('bwPerCheck').textContent = money(r.biweekly.perCheck);
  $('bwMonthly').textContent = money(r.biweekly.monthly);
  $('bwAnnual').textContent = money(r.biweekly.annual);

  // Semimonthly column
  $('smPerCheck').textContent = money(r.semimonthly.perCheck);
  $('smMonthly').textContent = money(r.semimonthly.monthly);
  $('smAnnual').textContent = money(r.semimonthly.annual);

  $('summaryText').textContent =
    `Each semimonthly paycheck is ${money(r.semimonthly.perCheck)}, about ` +
    `${money(r.perCheckDifference)} more than each ${money(r.biweekly.perCheck)} biweekly paycheck. ` +
    `But biweekly pays ${r.extraPaychecks} extra checks a year — ` +
    `${r.threePaycheckMonths} months land a third paycheck — so both add up to the same ` +
    `${money(r.annualSalary)} a year.`;
  $('summaryBox').hidden = false;
}

function init() {
  initMoneyInputs();
  document.querySelectorAll('#payForm input').forEach((el) =>
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
