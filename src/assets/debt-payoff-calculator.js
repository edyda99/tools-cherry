// debt-payoff-calculator.js — credit-card / debt payoff calculator, live results.
// Two modes share the same balance + APR inputs:
//   (1) "by payment"  → months to clear a balance from a fixed monthly payment.
//   (2) "by months"   → the monthly payment needed to clear it in a target time.
// Pure math via the shared amortization engine. No deps, nothing uploaded.
import { monthlyPayment, monthsToPayoff } from '/assets/amortization.js';

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

// Parse a field as a number; blank/whitespace -> NaN (treated as "not set yet").
function val(id) {
  const raw = $(id).value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}

// Turn a count of months into a plain "2 years, 3 months" phrase.
function monthsPhrase(months) {
  if (!Number.isFinite(months)) return '';
  const m = Math.round(months);
  const years = Math.floor(m / 12);
  const rem = m % 12;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (rem) parts.push(`${rem} month${rem === 1 ? '' : 's'}`);
  if (!parts.length) return '0 months';
  return parts.join(', ');
}

// A payoff date `months` from today, shown as "Month Year".
function payoffDate(months) {
  if (!Number.isFinite(months)) return '';
  const d = new Date();
  d.setMonth(d.getMonth() + Math.round(months));
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

let mode = 'payment'; // 'payment' | 'months'

function reset() {
  $('payBig').textContent = '—';
  $('paySub').textContent = '';
  ['monthsLine', 'dateLine', 'reqPayLine', 'totalInterestLine', 'totalPaidLine', 'warnBox', 'summaryBox'].forEach((id) => {
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

function calcByPayment(balance, ratePct) {
  const pay = val('payment');
  if (!Number.isFinite(pay) || pay <= 0) {
    $('paySub').textContent = 'Enter a monthly payment to start.';
    return;
  }

  const r = monthsToPayoff(balance, ratePct, pay);

  // Payment can never cover the interest — the balance only grows.
  if (r.neverPayoff) {
    $('payBig').textContent = 'Never';
    $('paySub').textContent = 'This payment will not clear the balance.';
    $('warnText').textContent =
      `Your ${money(pay)} payment is less than the ${money(r.monthlyInterest)} of interest ` +
      `that builds up each month, so the balance will never go down — it will actually grow. ` +
      `Increase your monthly payment above ${money(r.minPayment)} to start paying it off.`;
    $('warnBox').hidden = false;
    return;
  }
  if (!Number.isFinite(r.months)) return;

  $('payBig').textContent = monthsPhrase(r.months);
  $('paySub').textContent = `to pay off ${money(balance)} at ${fmt(ratePct)}% APR`;

  show('monthsLine', 'Months to pay off', `${r.months}`);
  show('dateLine', 'Payoff date', payoffDate(r.months));
  show('totalInterestLine', 'Total interest', money(r.totalInterest));
  show('totalPaidLine', 'Total paid', money(r.totalPaid));
  $('totalPaidLine').classList.add('total');

  $('summaryText').textContent =
    `Paying ${money(pay)} a month on a ${money(balance)} balance at ${fmt(ratePct)}% APR, ` +
    `you'd be debt-free in about ${monthsPhrase(r.months)} (${r.months} payments), around ${payoffDate(r.months)}. ` +
    `Along the way you'd pay ${money(r.totalInterest)} in interest, for ${money(r.totalPaid)} in total.`;
  $('summaryBox').hidden = false;
}

function calcByMonths(balance, ratePct) {
  const months = val('months');
  if (!Number.isFinite(months) || months <= 0) {
    $('paySub').textContent = 'Enter how many months you want to take.';
    return;
  }

  const termMonths = Math.round(months);
  const pay = monthlyPayment(balance, ratePct, termMonths);
  if (!Number.isFinite(pay)) return;

  const totalPaid = pay * termMonths;
  const totalInterest = totalPaid - balance;

  $('payBig').textContent = money(pay);
  $('paySub').textContent = `per month to clear ${money(balance)} in ${monthsPhrase(termMonths)}`;

  show('reqPayLine', 'Required monthly payment', money(pay));
  show('dateLine', 'Payoff date', payoffDate(termMonths));
  show('totalInterestLine', 'Total interest', money(totalInterest));
  show('totalPaidLine', 'Total paid', money(totalPaid));
  $('totalPaidLine').classList.add('total');

  $('summaryText').textContent =
    `To clear a ${money(balance)} balance at ${fmt(ratePct)}% APR in ${monthsPhrase(termMonths)} ` +
    `(${termMonths} payments), you'd need to pay about ${money(pay)} a month, finishing around ${payoffDate(termMonths)}. ` +
    `That's ${money(totalInterest)} in interest, for ${money(totalPaid)} in total.`;
  $('summaryBox').hidden = false;
}

function calc() {
  reset();

  const balance = val('balance');
  const ratePct = val('rate');

  if (!Number.isFinite(balance) || balance <= 0) {
    $('paySub').textContent = 'Enter your balance to start.';
    return;
  }
  if (!Number.isFinite(ratePct) || ratePct < 0) return;

  if (mode === 'payment') calcByPayment(balance, ratePct);
  else calcByMonths(balance, ratePct);
}

function setMode(next) {
  mode = next;
  const byPayment = mode === 'payment';
  $('modePayment').classList.toggle('active', byPayment);
  $('modePayment').setAttribute('aria-selected', String(byPayment));
  $('modeMonths').classList.toggle('active', !byPayment);
  $('modeMonths').setAttribute('aria-selected', String(!byPayment));
  $('paymentField').hidden = !byPayment;
  $('monthsField').hidden = byPayment;
  calc();
}

function init() {
  document.querySelectorAll('#debtForm input').forEach((el) =>
    el.addEventListener('input', calc)
  );
  $('modePayment').addEventListener('click', () => setMode('payment'));
  $('modeMonths').addEventListener('click', () => setMode('months'));
  setMode('payment');
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
