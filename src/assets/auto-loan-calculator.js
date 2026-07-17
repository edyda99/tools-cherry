// auto-loan-calculator.js — car loan / auto payment calculator, live results.
// Pure math via the shared amortization engine. No deps, nothing uploaded.
import { amortize, monthsToPayoff } from '/assets/amortization.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
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

// Required field: blank/whitespace -> NaN (treated as "not set yet").
function val(id) {
  const raw = $(id).value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}
// Optional field: blank -> 0, negatives ignored, so extras don't block results.
function optVal(id) {
  const raw = $(id).value.trim();
  if (raw === '') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
// Required money field: blank -> NaN, same as val(), but parses through
// moneyValue so a comma-grouped "35,000" doesn't silently truncate to 35 via
// a raw parseFloat.
function moneyVal(id) {
  const el = $(id);
  if (el.value.trim() === '') return NaN;
  return moneyValue(el);
}
// Optional money field: blank -> 0, negatives ignored, same as optVal(), but
// comma-safe.
function moneyOptVal(id) {
  const el = $(id);
  if (el.value.trim() === '') return 0;
  const n = moneyValue(el);
  return n >= 0 ? n : 0;
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

function reset() {
  $('payBig').textContent = '—';
  $('paySub').textContent = '';
  ['financedLine', 'salesTaxLine', 'totalInterestLine', 'totalPaidLine', 'summaryBox',
   'payoffBox', 'newPayoffLine', 'timeSavedLine', 'newInterestLine', 'interestSavedLine'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = true;
  });
}

function monthsToYM(totalMonths) {
  const yrs = Math.floor(totalMonths / 12);
  const mos = Math.round(totalMonths - yrs * 12);
  if (yrs <= 0) return `${mos} month${mos === 1 ? '' : 's'}`;
  return `${yrs} year${yrs === 1 ? '' : 's'}` + (mos > 0 ? ` ${mos} month${mos === 1 ? '' : 's'}` : '');
}

function calc() {
  reset();

  const price = moneyVal('price');
  const down = moneyOptVal('down');
  const tradeIn = moneyOptVal('tradeIn');
  const taxPct = optVal('taxPct');
  const ratePct = val('rate');
  const months = val('term');

  // Core inputs required for a payment figure.
  if (!Number.isFinite(price) || price <= 0) {
    $('paySub').textContent = 'Enter a vehicle price to start.';
    return;
  }
  if (!Number.isFinite(ratePct) || ratePct < 0) return;
  if (!Number.isFinite(months) || months <= 0) return;

  // Sales tax (US convention): applied to price minus trade-in value.
  const taxableBase = Math.max(0, price - tradeIn);
  const salesTax = taxableBase * taxPct / 100;

  // Amount financed = price - down payment - trade-in + sales tax.
  const financed = price - down - tradeIn + salesTax;

  if (financed <= 0) {
    $('payBig').textContent = money(0);
    $('paySub').textContent = 'Your down payment and trade-in cover the full cost — no loan needed.';
    show('salesTaxLine', 'Sales tax', money(salesTax));
    show('financedLine', 'Amount financed', money(Math.max(0, financed)));
    return;
  }

  const term = Math.round(months);
  const r = amortize(financed, ratePct, term);
  if (!Number.isFinite(r.monthlyPayment)) return;

  // Headline: the monthly payment.
  $('payBig').textContent = money(r.monthlyPayment);
  $('paySub').textContent = 'Monthly payment';

  show('financedLine', 'Amount financed', money(financed));
  if (taxPct > 0) show('salesTaxLine', 'Sales tax', money(salesTax));
  show('totalInterestLine', 'Total interest', money(r.totalInterest));
  show('totalPaidLine', 'Total paid over the loan', money(r.totalPaid));

  // Plain-English summary.
  const taxBit = taxPct > 0
    ? ` That includes ${money(salesTax)} in sales tax (${fmt(taxPct)}% on the price after trade-in).`
    : '';
  $('summaryText').textContent =
    `Financing ${money(financed)} at ${fmt(ratePct)}% over ${term} months, ` +
    `you'd pay about ${money(r.monthlyPayment)} a month.` + taxBit +
    ` By the time the loan is paid off you'll have paid ${money(r.totalInterest)} ` +
    `in interest, for ${money(r.totalPaid)} in total.`;
  $('summaryBox').hidden = false;

  // Extra-payment payoff mode (optional). Pay (monthly payment + extra) until the
  // loan clears, then compare payoff time and total interest to the standard term.
  const extra = moneyOptVal('extra');
  if (extra > 0 && ratePct >= 0) {
    const accelPayment = r.monthlyPayment + extra;
    const payoff = monthsToPayoff(financed, ratePct, accelPayment);
    if (Number.isFinite(payoff.months) && payoff.months > 0 && payoff.months < term) {
      const monthsSaved = term - payoff.months;
      const interestSaved = r.totalInterest - payoff.totalInterest;
      show('newPayoffLine', 'New payoff time', `${payoff.months} month${payoff.months === 1 ? '' : 's'} (${monthsToYM(payoff.months)})`);
      show('timeSavedLine', 'Time shaved off payoff', monthsToYM(monthsSaved));
      show('newInterestLine', 'Total interest with extra payment', money(payoff.totalInterest));
      show('interestSavedLine', 'Interest saved', money(Math.max(0, interestSaved)));
      $('payoffText').textContent =
        `Paying ${money(accelPayment)} a month (${money(r.monthlyPayment)} + ${money(extra)} extra) clears the loan ` +
        `in ${monthsToYM(payoff.months)} instead of ${monthsToYM(term)} — about ${monthsToYM(monthsSaved)} sooner — ` +
        `and saves roughly ${money(Math.max(0, interestSaved))} in interest.`;
      $('payoffBox').hidden = false;
    } else if (Number.isFinite(payoff.months) && payoff.months >= term) {
      $('payoffText').textContent = 'That extra amount is too small to change the payoff meaningfully — try a larger figure.';
      $('payoffBox').hidden = false;
    }
  }
}

function setTerm(months) {
  $('term').value = String(months);
  document.querySelectorAll('.term-preset').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.months) === months);
  });
  calc();
}

function syncPresetHighlight() {
  const cur = Number($('term').value);
  document.querySelectorAll('.term-preset').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.months) === cur);
  });
}

function init() {
  initMoneyInputs();
  document.querySelectorAll('#autoLoanForm input').forEach((el) =>
    el.addEventListener('input', () => { syncPresetHighlight(); calc(); })
  );
  document.querySelectorAll('.term-preset').forEach((b) =>
    b.addEventListener('click', () => setTerm(Number(b.dataset.months)))
  );
  syncPresetHighlight();
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
