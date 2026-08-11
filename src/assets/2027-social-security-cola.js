// 2027-social-security-cola.js — the benefit calculator on /2027-social-security-cola/.
//
// This runs at ANY cost-of-living percentage the visitor types, which is the
// point: the official 2027 figure does not exist until SSA announces it in
// October 2026, so a page that could only work once the figure existed would
// have nothing to show for the two months when people are actually searching
// for it. The percentage field is pre-filled from window.__COLA__.prefill —
// which build.js sets to a published third-party estimate, clearly labelled as
// somebody else's number — and the visitor overwrites it.
import { applyCola } from '/assets/projections-2027.js';
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';

const $ = (id) => document.getElementById(id);
const CFG = (typeof window !== 'undefined' && window.__COLA__) || {};

// Cents only when there are cents: "$2,000" reads as money, "$2,000.00" reads as
// a spreadsheet, and the monthly increase genuinely can carry cents.
const usd = (n) => (Number.isFinite(n)
  ? n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
  })
  : '—');
const usd0 = (n) => (Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  : '—');

function num(id) {
  const el = $(id);
  if (!el) return NaN;
  const raw = String(el.value || '').replace(/[$,%\s]/g, '').trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}

function setLine(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function calc() {
  const benefit = num('benefit');
  const pct = num('colaPct');
  const out = $('colaOut');
  const status = $('colaStatus');

  if (!Number.isFinite(benefit) || benefit <= 0 || !Number.isFinite(pct)) {
    setLine('newMonthly', '—');
    setLine('monthlyUp', '—');
    setLine('annualUp', '—');
    setLine('newAnnual', '—');
    if (out) out.dataset.state = 'empty';
    setLine('colaSummary', 'Enter your current monthly benefit and a percentage to see what it would become.');
    if (status) status.textContent = '';
    return;
  }

  const r = applyCola(benefit, pct);
  if (!Number.isFinite(r.newMonthly)) return;

  if (out) out.dataset.state = 'ready';
  setLine('newMonthly', usd0(r.newMonthly));
  setLine('monthlyUp', usd(r.monthlyIncrease));
  setLine('annualUp', usd(r.annualIncrease));
  setLine('newAnnual', usd0(r.newAnnual));

  const summary =
    `A ${pct}% cost-of-living increase would take a ${usd(benefit)} monthly benefit to ` +
    `${usd0(r.newMonthly)} a month — ${usd(r.monthlyIncrease)} more each month, ` +
    `${usd(r.annualIncrease)} more over a year. Social Security rounds each adjusted benefit ` +
    'down to the whole dollar, which is why the figure above is not an exact percentage of what you typed. ' +
    'Your Medicare Part B premium, if it is deducted from your payment, comes out of this and is set separately.';
  setLine('colaSummary', summary);
  if (status) status.textContent = `New monthly benefit ${usd0(r.newMonthly)}.`;
}

// The estimate chips: one tap loads a published third-party figure into the
// percentage field. Each chip carries the publisher's name because the number
// is theirs, not ours.
function wireChips() {
  document.querySelectorAll('[data-cola-pct]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = $('colaPct');
      if (!el) return;
      el.value = btn.dataset.colaPct;
      calc();
      el.focus();
    });
  });
}

function init() {
  const pctEl = $('colaPct');
  if (pctEl && !pctEl.value && CFG.prefill != null) pctEl.value = String(CFG.prefill);
  ['benefit', 'colaPct'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', calc);
  });
  wireChips();
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
