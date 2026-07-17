// debt-avalanche-calculator.js — multi-debt avalanche payoff, live results.
// Add your debts (balance, APR, minimum payment) plus an extra monthly amount;
// the avalanche method pays the highest-APR debt first and rolls freed-up
// minimums forward. Pure math via the shared engine. No deps, nothing uploaded.
import { compare, neverPayoffAtMinimum } from '/assets/debt-avalanche.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs } from '/assets/money-input.js';
const $ = (id) => document.getElementById(id);

function money(n, max = 0) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: max
  });
}
function money2(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
function pct(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Parse a value; blank/whitespace -> NaN ("not set yet").
function numOf(raw) {
  const t = String(raw == null ? '' : raw).trim();
  if (t === '') return NaN;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}
// Parse a money value; blank/whitespace -> NaN, same as numOf(), but strips
// thousands separators first (mirrors money-input.js's moneyValue) so a
// comma-grouped "6,000" doesn't silently truncate to 6 via a raw parseFloat.
function moneyOf(raw) {
  const t = String(raw == null ? '' : raw).trim();
  if (t === '') return NaN;
  const n = parseFloat(t.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

// Turn a count of months into a plain "2 years, 3 months" phrase.
function monthsPhrase(months) {
  if (!Number.isFinite(months)) return '';
  const m = Math.round(months);
  if (m <= 0) return '0 months';
  const years = Math.floor(m / 12);
  const rem = m % 12;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (rem) parts.push(`${rem} month${rem === 1 ? '' : 's'}`);
  return parts.join(', ') || '0 months';
}

// A payoff date `months` from the browser's current month, "Month Year".
// The date is computed HERE (not in the pure engine) per the engine contract.
function payoffDate(months) {
  if (!Number.isFinite(months) || months <= 0) return '';
  const d = new Date();
  d.setMonth(d.getMonth() + Math.round(months));
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// --- debt rows ---------------------------------------------------------------
let rowSeq = 0;

function debtRow(name = '', balance = '', apr = '', minPayment = '') {
  const id = `d${rowSeq++}`;
  const row = document.createElement('div');
  row.className = 'debt-row';
  row.dataset.id = id;
  row.innerHTML =
    `<input class="dn" placeholder="Debt name (optional)" aria-label="Debt name" value="${esc(name)}">` +
    `<input class="db" type="text" inputmode="decimal" data-money autocomplete="off" placeholder="0" aria-label="Balance owed in dollars" value="${esc(balance)}">` +
    `<input class="da" type="number" inputmode="decimal" step="any" min="0" placeholder="0" aria-label="Annual interest rate APR percent" value="${esc(apr)}">` +
    `<input class="dm" type="text" inputmode="decimal" data-money autocomplete="off" placeholder="0" aria-label="Minimum monthly payment in dollars" value="${esc(minPayment)}">` +
    `<button type="button" class="rm" title="Remove debt" aria-label="Remove this debt">&times;</button>`;
  row.querySelector('.rm').addEventListener('click', () => { row.remove(); calc(); });
  row.querySelectorAll('input').forEach((el) => el.addEventListener('input', calc));
  initMoneyInputs(row);
  return row;
}

function readDebts() {
  return [...document.querySelectorAll('#debts .debt-row')].map((row) => ({
    id: row.dataset.id,
    name: row.querySelector('.dn').value,
    balance: moneyOf(row.querySelector('.db').value),
    apr: numOf(row.querySelector('.da').value),
    minPayment: moneyOf(row.querySelector('.dm').value)
  }));
}

function nameById(debts, id) {
  const d = debts.find((x) => x.id === id);
  const raw = d && typeof d.name === 'string' ? d.name.trim() : '';
  return raw || (d ? `Debt ${debts.indexOf(d) + 1}` : 'Debt');
}

// --- rendering ---------------------------------------------------------------
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
  $('avBig').textContent = '—';
  $('avSub').textContent = '';
  ['orderLine', 'dateLine', 'totalInterestLine', 'totalPaidLine',
    'interestSavedLine', 'monthsSavedLine', 'summaryBox', 'warnBox',
    'orderWrap', 'scheduleWrap'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = true;
  });
}

function buildOrderTable(orderList, perDebt, debts) {
  const payoffMap = new Map(perDebt.map((p) => [p.id, p.payoffMonth]));
  let rows = '';
  for (const d of orderList) {
    const cleared = payoffMap.get(d.id);
    const when = Number.isFinite(cleared)
      ? `month ${cleared}${payoffDate(cleared) ? ` · ${payoffDate(cleared)}` : ''}`
      : '—';
    rows +=
      `<tr><td>${d.order}</td><td>${esc(nameById(debts, d.id))}</td>` +
      `<td>${pct(d.apr)}</td><td>${money2(d.balance)}</td>` +
      `<td>${money2(d.minPayment)}</td><td>${when}</td></tr>`;
  }
  $('orderBody').innerHTML = rows;
}

function buildSchedule(schedule, orderList, debts) {
  // Column per debt, in avalanche order, plus a remaining-total column.
  const head =
    `<tr><th>Month</th>` +
    orderList.map((d) => `<th>${esc(nameById(debts, d.id))}</th>`).join('') +
    `<th>Paid</th><th>Interest</th><th>Remaining</th></tr>`;
  $('scheduleHead').innerHTML = head;

  const byId = new Map();
  // Limit very long schedules in the DOM (keeps the page light); show first 360.
  const cap = Math.min(schedule.length, 360);
  let rows = '';
  for (let i = 0; i < cap; i++) {
    const m = schedule[i];
    for (const d of m.debts) byId.set(d.id, d);
    const cells = orderList.map((od) => {
      const d = byId.get(od.id);
      return `<td>${d && d.balance > 0 ? money2(d.balance) : (d ? 'Paid off' : '—')}</td>`;
    }).join('');
    rows +=
      `<tr><td>${m.month}</td>${cells}` +
      `<td>${money2(m.totalPaid)}</td><td>${money2(m.totalInterest)}</td><td>${money2(m.remaining)}</td></tr>`;
  }
  if (schedule.length > cap) {
    const span = orderList.length + 4;
    rows += `<tr><td colspan="${span}" style="text-align:center;color:var(--muted)">… ${schedule.length - cap} more months not shown</td></tr>`;
  }
  $('scheduleBody').innerHTML = rows;
}

function renderWarning(debts) {
  const stuck = neverPayoffAtMinimum(debts);
  if (!stuck.length) { $('warnBox').hidden = true; return; }
  const names = stuck.map((d) => esc(nameById(debts, d.id)));
  const list = names.length === 1
    ? names[0]
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  $('warnText').textContent =
    `For ${list}, the minimum payment is smaller than the interest that builds up each month. ` +
    `On the minimum alone ${names.length === 1 ? 'that balance' : 'those balances'} would never go down — ` +
    `the avalanche only clears ${names.length === 1 ? 'it' : 'them'} once the extra payment and freed-up minimums reach ${names.length === 1 ? 'it' : 'them'}. ` +
    `Adding more each month closes the gap faster.`;
  $('warnBox').hidden = false;
}

function calc() {
  reset();

  const debts = readDebts();
  const usable = debts.filter((d) => Number.isFinite(d.balance) && d.balance > 0);

  if (usable.length === 0) {
    $('avSub').textContent = 'Add at least one debt with a balance to start.';
    return;
  }

  const extra = (() => {
    const e = moneyOf($('extra').value);
    return Number.isFinite(e) && e > 0 ? e : 0;
  })();

  const r = compare(debts, extra);
  if (!r.payable) {
    $('avSub').textContent = 'Add at least one debt with a balance to start.';
    return;
  }

  const a = r.avalanche;

  // Headline: months / years to debt-free (or a clear "stalled" message).
  if (a.stalled) {
    $('avBig').textContent = 'Never';
    $('avSub').textContent = 'These minimums and extra can’t clear the debt — add more each month.';
  } else {
    $('avBig').textContent = monthsPhrase(a.months);
    $('avSub').textContent = `to clear ${money(a.startingBalance)} across ${usable.length} debt${usable.length === 1 ? '' : 's'} with the avalanche method`;
  }

  // Result lines.
  const top = a.order[0];
  show('orderLine', 'Pay first (highest APR)', top ? `${nameById(debts, top.id)} — ${pct(top.apr)}` : '—');
  if (!a.stalled) {
    show('dateLine', 'Debt-free date', payoffDate(a.months));
    $('dateLine').hidden = false;
  }
  // When the debt never pays off (stalled), the engine has run to MAX_MONTHS and
  // the compounded interest/total figures are meaningless (and astronomically
  // large). Show an em dash instead of a quadrillion-dollar figure.
  show('totalInterestLine', 'Total interest paid', a.stalled ? '—' : money2(a.totalInterest));
  show('totalPaidLine', 'Total amount paid', a.stalled ? '—' : money2(a.totalPaid));
  $('totalPaidLine').classList.add('total');

  // Savings vs paying minimums only.
  if (r.baselineComparable && (r.interestSaved > 0.5 || r.monthsSaved > 0)) {
    show('interestSavedLine', 'Interest saved vs minimums only', money2(r.interestSaved));
    show('monthsSavedLine', 'Time saved vs minimums only', monthsPhrase(r.monthsSaved));
  }

  // Order table + schedule.
  buildOrderTable(a.order, a.perDebt, debts);
  $('orderWrap').hidden = false;
  buildSchedule(a.schedule, a.order, debts);
  $('scheduleWrap').hidden = false;

  // Plain-language summary.
  const firstName = top ? nameById(debts, top.id) : 'your highest-rate debt';
  if (a.stalled) {
    $('summaryText').textContent =
      `With these minimums${extra ? ` and ${money2(extra)} extra a month` : ''}, the balances aren’t shrinking — ` +
      `the interest outpaces the payments. Increase the extra payment until the debt-free date appears.`;
  } else {
    const savingsBit = (r.baselineComparable && r.interestSaved > 0.5)
      ? ` Compared with paying only the minimums, that saves about ${money2(r.interestSaved)} in interest` +
        (r.monthsSaved > 0 ? ` and ${monthsPhrase(r.monthsSaved)}.` : '.')
      : '';
    $('summaryText').textContent =
      `Putting ${extra ? `${money2(extra)} extra a month plus every minimum` : 'every minimum'} toward ${firstName} first, ` +
      `then rolling each freed-up payment onto the next highest-rate debt, clears all ${usable.length} debt${usable.length === 1 ? '' : 's'} ` +
      `in ${monthsPhrase(a.months)} (around ${payoffDate(a.months)}). You’d pay ${money2(a.totalInterest)} in interest, ${money2(a.totalPaid)} in total.${savingsBit}`;
  }
  $('summaryBox').hidden = false;

  renderWarning(debts);
}

// --- init --------------------------------------------------------------------
function init() {
  const debts = $('debts');
  debts.innerHTML =
    '<div class="debt-head"><span>Name</span><span>Balance ($)</span><span>APR (%)</span><span>Min/mo ($)</span><span></span></div>';
  // Three editable starter rows with realistic example values.
  debts.appendChild(debtRow('Credit card', '6000', '22.9', '150'));
  debts.appendChild(debtRow('Car loan', '12000', '7.5', '280'));
  debts.appendChild(debtRow('Store card', '2500', '26.99', '70'));

  $('addDebt').addEventListener('click', () => { debts.appendChild(debtRow()); calc(); });
  // Binds #extra; the debt rows above are already bound individually by
  // debtRow() (data-moneyBound guards against double-binding).
  initMoneyInputs();
  $('extra').addEventListener('input', calc);
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
