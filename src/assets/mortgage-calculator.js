// mortgage-calculator.js — mortgage payment calculator, live results.
// Pure math via the shared amortization engine. No deps, nothing uploaded.
import { amortize } from '/assets/amortization.js';

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
// Optional field: blank -> 0, so extras don't block the core result.
function optVal(id) {
  const raw = $(id).value.trim();
  if (raw === '') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function reset() {
  $('payBig').textContent = '—';
  $('paySub').textContent = '';
  ['loanLine', 'totalPaidLine', 'totalInterestLine', 'estTotalLine', 'extrasNote', 'summaryBox', 'scheduleWrap'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = true;
  });
}

function buildSchedule(schedule) {
  const tbody = $('scheduleBody');
  tbody.innerHTML = '';
  // Yearly summary keeps the table lightweight (one row per year, not per month).
  const perYear = 12;
  let rows = '';
  for (let y = 0; y * perYear < schedule.length; y++) {
    const slice = schedule.slice(y * perYear, y * perYear + perYear);
    const interest = slice.reduce((s, m) => s + m.interest, 0);
    const principal = slice.reduce((s, m) => s + m.principal, 0);
    const endBalance = slice[slice.length - 1].balance;
    rows += `<tr><td>${y + 1}</td><td>${money(principal)}</td><td>${money(interest)}</td><td>${money(endBalance)}</td></tr>`;
  }
  tbody.innerHTML = rows;
}

function calc() {
  reset();

  const price = val('price');
  const down = optVal('down');
  const ratePct = val('rate');
  const years = val('years');

  // Core inputs required for a principal+interest figure.
  if (!Number.isFinite(price) || price <= 0) {
    $('paySub').textContent = 'Enter a home price to start.';
    return;
  }
  if (!Number.isFinite(ratePct) || ratePct < 0) return;
  if (!Number.isFinite(years) || years <= 0) return;

  const principal = price - down;
  if (principal <= 0) {
    $('payBig').textContent = money(0);
    $('paySub').textContent = 'Your down payment covers the full price — no loan needed.';
    return;
  }

  const termMonths = Math.round(years * 12);
  const r = amortize(principal, ratePct, termMonths);
  if (!Number.isFinite(r.monthlyPayment)) return;

  // Headline: principal + interest.
  $('payBig').textContent = money(r.monthlyPayment);
  $('paySub').textContent = 'Monthly payment (principal + interest)';

  show('loanLine', 'Loan amount', money(principal));
  show('totalPaidLine', 'Total paid over the loan', money(r.totalPaid));
  show('totalInterestLine', 'Total interest', money(r.totalInterest));

  // Optional extras → an estimated, clearly-labeled total monthly payment.
  const taxPct = optVal('taxPct');
  const insurance = optVal('insurance');
  const monthlyTax = (price * taxPct / 100) / 12;
  const monthlyIns = insurance / 12;
  const hasExtras = taxPct > 0 || insurance > 0;
  if (hasExtras) {
    const estTotal = r.monthlyPayment + monthlyTax + monthlyIns;
    show('estTotalLine', 'Estimated total monthly payment', money(estTotal));
    $('estTotalLine').classList.add('total');
    const parts = [];
    if (taxPct > 0) parts.push(`property tax ${money(monthlyTax)}/mo`);
    if (insurance > 0) parts.push(`insurance ${money(monthlyIns)}/mo`);
    $('extrasNote').textContent = `Estimate includes ${parts.join(' and ')}. This excludes HOA fees and mortgage insurance (PMI).`;
    $('extrasNote').hidden = false;
  } else {
    $('estTotalLine').classList.remove('total');
  }

  // Plain-English amortization summary.
  const payoffYears = termMonths / 12;
  $('summaryText').textContent =
    `Borrowing ${money(principal)} at ${fmt(ratePct)}% over ${fmt(payoffYears)} years, ` +
    `you'd pay about ${money(r.monthlyPayment)} a month in principal and interest. ` +
    `The loan is paid off after ${termMonths} payments, by which point you'll have paid ` +
    `${money(r.totalInterest)} in interest on top of the ${money(principal)} you borrowed — ` +
    `${money(r.totalPaid)} in total.`;
  $('summaryBox').hidden = false;

  buildSchedule(r.schedule);
  $('scheduleWrap').hidden = false;
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

function init() {
  document.querySelectorAll('#mortgageForm input').forEach((el) =>
    el.addEventListener('input', calc)
  );
  calc();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
