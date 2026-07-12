// ss-wage-base-calculator.js — Social Security wage-base max-out date
// calculator. Projects the exact paycheck a W-2 employee's 6.2% Social
// Security withholding stops for the year, plus a secondary excess-FICA
// (multiple employers) check. All logic runs client-side; nothing uploaded.
import { projectMaxOut, excessFica } from '/assets/ss-maxout-engine.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const PARAMS = window.__SSMAXOUT_PARAMS__ || {};
// Fixed to 2026 (spec's own gate: 2027 wage base isn't published until ~Oct
// 2026; a forward pay-date projection has no meaningful use for a closed past
// year like 2025, so no year selector is offered — see build notes).
const TAX_YEAR = 2026;
const MAX_SS = PARAMS[TAX_YEAR] ? PARAMS[TAX_YEAR].wageBase * PARAMS[TAX_YEAR].ssRate : 0;

const usd2 = (n) => '$' + Math.max(0, n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function num(id) {
  const el = $(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : 0;
}

function fmtDateLong(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function updateRaiseVisibility() {
  const on = $('hasRaise').checked;
  const el = $('raiseFields');
  if (el) el.style.display = on ? '' : 'none';
}

function updateEmployerVisibility() {
  const n = parseInt($('numEmployers').value, 10) || 1;
  const f2 = $('employer2Field');
  const f3 = $('employer3Field');
  if (f2) f2.style.display = n >= 2 ? '' : 'none';
  if (f3) f3.style.display = n >= 3 ? '' : 'none';
}

function render() {
  updateRaiseVisibility();

  const ytdWages = num('ytdWages');
  const payFrequency = $('payFrequency').value;
  const nextPayDate = $('nextPayDate').value;
  const perPeriodWages = num('perPeriodWages');
  const hasRaise = $('hasRaise').checked;
  const payRaise = hasRaise
    ? { effectiveOnPeriod: Math.max(1, Math.round(num('raisePeriod')) || 1), newPerPeriodSSWages: num('raiseAmount') }
    : undefined;

  if (!nextPayDate) {
    $('out').innerHTML = `<div class="obbba-note warn-flag">Enter the date of your next paycheck to see a projection.</div>`;
    return;
  }

  const r = projectMaxOut({
    taxYear: TAX_YEAR,
    ytdSSWages: ytdWages,
    payFrequency,
    nextPayDate,
    perPeriodSSWages: perPeriodWages,
    payRaise,
    params: PARAMS
  });

  if (r.error) {
    $('out').innerHTML = `<div class="obbba-note warn-flag">${(r.notes && r.notes[0]) || 'Enter a valid amount to see a projection.'}</div>`;
    return;
  }

  let badgeText, badgeClass;
  const lines = [];

  if (r.alreadyMaxed) {
    badgeText = 'Already maxed out — $0 SS withheld now';
    badgeClass = 'ok-flag';
  } else if (r.willNotMaxOutThisYear) {
    badgeText = `Won't reach the cap in ${TAX_YEAR}`;
    badgeClass = 'info-flag';
  } else if (r.rolledIntoNextYear) {
    badgeText = `Maxes out on your last paycheck of ${TAX_YEAR} — no visible bump`;
    badgeClass = 'info-flag';
    lines.push(['Last paycheck with any SS withheld', fmtDateLong(r.capReachedDate)]);
    lines.push(['SS tax withheld that paycheck', usd2(r.ssOnCrossing)]);
  } else {
    badgeText = `Paycheck jumps on ${fmtDateLong(r.firstZeroSSDate)}`;
    badgeClass = 'warn-flag';
    lines.push(['Last paycheck with any SS withheld', fmtDateLong(r.capReachedDate)]);
    lines.push(['SS tax withheld that paycheck', usd2(r.ssOnCrossing)]);
    lines.push(['Take-home increase starting the next check', '+' + usd2(r.bumpAmount)]);
  }

  lines.push([`Total SS tax withheld in ${TAX_YEAR} (this employer)`, usd2(r.totalSSForYear)]);

  const lineHtml = lines.map(([label, val]) => `<div class="line"><span>${label}</span><span class="num">${val}</span></div>`).join('');
  const noteHtml = (r.notes || []).map((n) => `<div class="takeaway">${n}</div>`).join('');

  $('out').innerHTML =
    `<div class="line big"><span>Verdict</span><span class="num ${badgeClass}">${badgeText}</span></div>` +
    lineHtml +
    noteHtml;
}

function renderFica() {
  updateEmployerVisibility();

  const n = parseInt($('numEmployers').value, 10) || 1;
  const withheld = [num('employer1')];
  if (n >= 2) withheld.push(num('employer2'));
  if (n >= 3) withheld.push(num('employer3'));

  const r = excessFica({ ssWithheldByEmployer: withheld, numEmployers: n, maxSS: MAX_SS });

  if (r.excess <= 0) {
    $('ficaOut').innerHTML = `<div class="obbba-note ok-flag">No excess Social Security detected — total withheld (${usd2(r.totalSSWithheld)}) is at or under the ${TAX_YEAR} maximum of ${usd2(MAX_SS)}.</div>`;
    return;
  }

  const badgeClass = r.claimableOn1040 ? 'warn-flag' : 'info-flag';
  const badgeText = r.claimableOn1040
    ? `Claim ${usd2(r.excess)} on Schedule 3`
    : `${usd2(r.excess)} excess — not a 1040 credit`;

  $('ficaOut').innerHTML =
    `<div class="line big"><span>Verdict</span><span class="num ${badgeClass}">${badgeText}</span></div>` +
    `<div class="line"><span>Total SS tax withheld (all employers)</span><span class="num">${usd2(r.totalSSWithheld)}</span></div>` +
    `<div class="line"><span>${TAX_YEAR} maximum (one employer)</span><span class="num">${usd2(MAX_SS)}</span></div>` +
    `<div class="line"><span>Excess</span><span class="num">${usd2(r.excess)}</span></div>` +
    `<div class="takeaway">${r.remedy}</div>`;
}

function renderAll() {
  render();
  renderFica();
}

function init() {
  ['ytdWages', 'asOfDate', 'payFrequency', 'nextPayDate', 'perPeriodWages', 'hasRaise', 'raisePeriod', 'raiseAmount'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  ['numEmployers', 'employer1', 'employer2', 'employer3'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', renderFica);
    el.addEventListener('change', renderFica);
  });
  renderAll();
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
