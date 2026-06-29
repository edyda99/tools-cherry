// biweekly-mortgage-calculator.js — compare a standard monthly mortgage against a
// biweekly schedule (26 half-payments a year = 13 monthly payments), showing the
// interest saved and the time shaved off payoff. Reuses the shared amortization
// engine for the monthly baseline. No deps, nothing uploaded.
import { amortize, monthlyPayment } from '/assets/amortization.js';

const $ = (id) => document.getElementById(id);

function money(n, max = 2) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: max });
}
function fmt(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function val(id) {
  const raw = $(id).value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}
function optVal(id) {
  const raw = $(id).value.trim();
  if (raw === '') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
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
  $('savedBig').textContent = '—';
  $('savedSub').textContent = '';
  ['biwklyLine', 'monthlyInterestLine', 'biwklyInterestLine', 'payoffLine', 'summaryBox']
    .forEach((id) => { const el = $(id); if (el) el.hidden = true; });
}

// Simulate paying `payment` every two weeks against `principal` at `annualRatePct`.
// Interest accrues per fortnight at annualRate/26. Returns { fortnights, totalInterest }.
function biweeklyPayoff(principal, annualRatePct, payment) {
  const i = annualRatePct / 100 / 26; // per-fortnight rate
  let balance = principal;
  let totalInterest = 0;
  let n = 0;
  const maxN = 26 * 60; // 60-year safety cap
  while (balance > 0 && n < maxN) {
    n++;
    const interest = balance * i;
    let principalPaid = payment - interest;
    if (principalPaid <= 0) return { fortnights: Infinity, totalInterest: Infinity };
    if (principalPaid >= balance) principalPaid = balance;
    balance -= principalPaid;
    totalInterest += interest;
  }
  return { fortnights: n, totalInterest };
}

function monthsToYM(totalMonths) {
  const yrs = Math.floor(totalMonths / 12);
  const mos = Math.round(totalMonths - yrs * 12);
  return { yrs, mos };
}

function calc() {
  reset();

  const price = val('price');
  const down = optVal('down');
  const ratePct = val('rate');
  const years = val('years');

  if (!Number.isFinite(price) || price <= 0) {
    $('savedSub').textContent = 'Enter a home price to start.';
    return;
  }
  if (!Number.isFinite(ratePct) || ratePct < 0) return;
  if (!Number.isFinite(years) || years <= 0) return;

  const loan = price - down;
  if (loan <= 0) {
    $('savedSub').textContent = 'Your down payment covers the full price — no loan needed.';
    return;
  }

  const termMonths = Math.round(years * 12);
  const pay = monthlyPayment(loan, ratePct, termMonths);
  if (!Number.isFinite(pay)) return;

  const monthly = amortize(loan, ratePct, termMonths, { schedule: false });
  const biweeklyPayment = pay / 2; // half the monthly payment, paid every 2 weeks
  const bw = biweeklyPayoff(loan, ratePct, biweeklyPayment);

  if (!Number.isFinite(bw.totalInterest)) {
    $('savedSub').textContent = 'These numbers do not produce a valid payoff — check the inputs.';
    return;
  }

  const interestSaved = monthly.totalInterest - bw.totalInterest;
  // Biweekly payoff time, in months (26 fortnights/yr -> months = fortnights/26*12).
  const bwMonths = bw.fortnights / 26 * 12;
  const monthsSaved = termMonths - bwMonths;
  const saved = monthsToYM(monthsSaved);

  $('savedBig').textContent = money(Math.max(0, interestSaved));
  $('savedSub').textContent = 'Interest saved by paying biweekly';

  show('biwklyLine', 'Biweekly payment (every 2 weeks)', money(biweeklyPayment));
  show('monthlyInterestLine', 'Total interest — standard monthly', money(monthly.totalInterest));
  show('biwklyInterestLine', 'Total interest — biweekly', money(bw.totalInterest));
  const timeStr = saved.yrs > 0
    ? `${saved.yrs} year${saved.yrs === 1 ? '' : 's'}${saved.mos > 0 ? ` ${saved.mos} month${saved.mos === 1 ? '' : 's'}` : ''}`
    : `${Math.max(0, saved.mos)} month${saved.mos === 1 ? '' : 's'}`;
  show('payoffLine', 'Time shaved off payoff', timeStr);
  $('payoffLine').classList.add('total');

  $('summaryText').textContent =
    `On a ${money(loan)} loan at ${fmt(ratePct)}% over ${fmt(years)} years, the standard monthly payment is ` +
    `${money(pay)}. Paying half that — ${money(biweeklyPayment)} — every two weeks adds up to one extra ` +
    `monthly payment a year, so you'd pay the loan off about ${timeStr} sooner and save roughly ` +
    `${money(Math.max(0, interestSaved))} in interest.`;
  $('summaryBox').hidden = false;
}

function init() {
  document.querySelectorAll('#biweeklyForm input').forEach((el) =>
    el.addEventListener('input', calc)
  );
  calc();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
