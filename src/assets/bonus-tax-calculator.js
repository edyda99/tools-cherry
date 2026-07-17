// bonus-tax-calculator.js — bonus (supplemental-wage) withholding vs. true tax.
// Shows what's withheld from a bonus now (flat 22% federal + state supplemental +
// FICA) beside what it will actually cost at year-end (the bonus at your true
// marginal rate), and the refund/owe gap. All logic runs client-side; nothing is
// uploaded. Works on the hub page (state <select>) and on a fixed state page
// (window.__BONUS_STATE__ set).
import { computeBonus } from '/assets/bonus-tax.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const DATA = window.__BONUS_TAX__ || {};
const taxData = DATA.taxData || { federal: {}, states: {} };
const suppData = DATA.supp || { federal: {}, states: {} };
const FIXED_STATE = window.__BONUS_STATE__ || null;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const usd2 = (n) => '$' + (Math.max(0, n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

// Comma-safe: money fields carry live thousands separators, so read them
// through moneyValue (strips separators) rather than a raw parseFloat, which
// would silently truncate "10,000" to 10.
function num(id) {
  const el = $(id);
  if (!el) return 0;
  const v = moneyValue(el);
  return v > 0 ? v : 0;
}

function currentState() {
  if (FIXED_STATE) return FIXED_STATE;
  const sel = $('state');
  return sel ? sel.value : null;
}

function methodLabel(m) {
  if (m === 'none') return 'no state income tax';
  if (m === 'regular') return 'regular (aggregate) method';
  if (m === 'special') return 'a special state formula';
  return 'a flat state rate';
}

function render() {
  const slug = currentState();
  if (!slug || !suppData.states[slug]) { $('out').innerHTML = ''; return; }
  const supp = suppData.states[slug];
  const stateName = supp.name || slug;

  const bonus = num('bonus');
  const regIncome = num('regIncome');
  const filingStatus = $('filingStatus') ? $('filingStatus').value : 'single';
  const ytdSupp = num('ytdSupp');
  const method = ($('method') && $('method').value === 'aggregate') ? 'aggregate' : 'flat';
  const paymentType = ($('paymentType') && $('paymentType').value === 'other') ? 'other' : 'bonus';

  // Show the CA payment-type row only for California.
  const ptRow = $('paymentTypeRow');
  if (ptRow) ptRow.style.display = (supp.special === 'ca_dual') ? '' : 'none';

  const out = $('out');

  if (bonus <= 0) {
    out.innerHTML =
      `<div class="stat-card">` +
        `<p class="stat-kicker">Take-home from your bonus</p>` +
        `<p class="stat-value is-zero">$0</p>` +
        `<p class="stat-sub">Enter your bonus amount above to see what you'd take home in ${stateName}.</p>` +
      `</div>`;
    return;
  }

  const r = computeBonus(
    { bonus, regIncome, filingStatus, stateSlug: slug, ytdSupp, method, paymentType },
    taxData, suppData
  );

  const w = r.withheld, t = r.trueLiability;

  // ---- One headline caveat (the refund/owe gap), shown OUTSIDE the details.
  // Income-tax only; FICA is a true tax and doesn't true up.
  let headlineCaveat;
  if (Math.abs(r.delta) < 1) {
    headlineCaveat = `<div class="bt-headline even"><strong>${usd(Math.abs(r.delta))}</strong> — your withholding is almost exactly your real income tax on this bonus. Little to refund or owe.</div>`;
  } else if (r.refund) {
    headlineCaveat = `<div class="bt-headline refund">About <strong>${usd(r.delta)}</strong> of this bonus is <strong>over-withheld</strong> income tax — money you can expect back as a refund when you file.</div>`;
  } else {
    headlineCaveat = `<div class="bt-headline owe">Heads up: withholding is about <strong>${usd(-r.delta)}</strong> <strong>short</strong> of the income tax you'll actually owe on this bonus. Set that aside for tax time.</div>`;
  }

  const stateWLine = supp.method === 'none'
    ? `<div class="line"><span>${stateName} state tax</span><span class="num">${usd2(0)} <span class="muted-small">(no state income tax)</span></span></div>`
    : `<div class="line"><span>${stateName} supplemental tax</span><span class="num">${usd2(w.state)}</span></div>`;

  const trueStateLine = supp.method === 'none'
    ? ''
    : `<div class="line"><span>${stateName} income tax</span><span class="num">${usd2(t.state)}</span></div>`;

  // ---- Answer-first summary (stat card) --------------------------------
  // The real bottom-line number: what you actually keep after true tax, not
  // the (possibly misleading) amount that lands right after withholding.
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Take-home from your bonus</p>` +
      `<p class="stat-value">${usd2(t.keep)}</p>` +
      `<p class="stat-sub">${usd2(w.total)} was withheld from this bonus up front in ${stateName} (see below for the refund or amount owed).</p>` +
    `</div>`;

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      `<div class="bt-cols">` +
        `<div class="bt-col">` +
          `<h3>Withheld from your check now</h3>` +
          `<div class="line"><span>Federal (flat 22%${w.federal > bonus * 0.22 + 1 ? ' / 37%' : ''})</span><span class="num">${usd2(w.federal)}</span></div>` +
          stateWLine +
          `<div class="line"><span>FICA (Social Security + Medicare)</span><span class="num">${usd2(w.fica)}</span></div>` +
          `<div class="line big"><span>Total withheld</span><span class="num">${usd2(w.total)}</span></div>` +
          `<div class="line"><span>Take-home now</span><span class="num ok-flag">${usd2(w.keep)}</span></div>` +
          `<div class="obbba-note">That's <strong>${pct1(w.pctOfBonus)}</strong> of your bonus held back — the "where did half my bonus go?" number. Most of the income-tax part is a prepayment, not your final tax.</div>` +
        `</div>` +
        `<div class="bt-col">` +
          `<h3>What it'll actually cost at tax time</h3>` +
          `<div class="line"><span>Federal income tax on the bonus</span><span class="num">${usd2(t.federal)}</span></div>` +
          trueStateLine +
          `<div class="line"><span>FICA (same — a real tax, not a prepayment)</span><span class="num">${usd2(t.fica)}</span></div>` +
          `<div class="line big"><span>True tax on the bonus</span><span class="num">${usd2(t.total)}</span></div>` +
          `<div class="line"><span>What you actually keep</span><span class="num ok-flag">${usd2(t.keep)}</span></div>` +
          `<div class="obbba-note">The bonus is ordinary income taxed at your <strong>marginal rate</strong> once your whole year runs through the brackets — this is the number that sticks.</div>` +
        `</div>` +
      `</div>` +
      `<div class="obbba-note muted-small">${stateName} uses ${methodLabel(supp.method)}${supp.method === 'flat' ? ` (${pct1(supp.rate)})` : ''}${supp.special === 'pct_of_federal' ? ' — 30% of the federal withholding, not of the bonus' : ''}${supp.special === 'wi_banded' ? ' — a graduated rate by annual income' : ''}. FICA (7.65%) is a true tax and is the same in both columns. Estimate only, not tax advice.</div>` +
    `</details>`;

  // Preserve the user's open/closed choice across re-renders (default closed).
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  out.innerHTML = statCard + headlineCaveat + derivation;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;
}

function buildStateSelect() {
  const sel = $('state');
  if (!sel) return;
  const entries = Object.entries(suppData.states)
    .map(([slug, s]) => [slug, s.name || slug])
    .sort((a, b) => a[1].localeCompare(b[1]));
  sel.innerHTML = entries.map(([slug, name]) => `<option value="${slug}">${name}</option>`).join('');
  // Default to a familiar large state.
  if (suppData.states.california) sel.value = 'california';
}

function init() {
  initMoneyInputs();
  buildStateSelect();
  ['bonus', 'state', 'regIncome', 'filingStatus', 'ytdSupp', 'method', 'paymentType'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  render();
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
