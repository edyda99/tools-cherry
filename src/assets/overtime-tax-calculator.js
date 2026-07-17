// overtime-tax-calculator.js — estimates the OBBBA "no tax on overtime" (IRC §225)
// federal deduction and tax saving. All logic client-side; nothing uploaded.
import { estimate, overtimePremium } from '/assets/obbba-deduction.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;
const STATES = window.__STATES__ || {};

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

// Non-money (count) fields still go through a plain parseFloat.
function num(id) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : 0;
}

// Populate the state dropdown from the conformity data (sorted by name).
function fillStates() {
  const sel = $('state');
  Object.keys(STATES)
    .filter((k) => k !== '_note' && STATES[k] && STATES[k].name)
    .map((slug) => ({ slug, name: STATES[slug].name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ slug, name }) => {
      const o = document.createElement('option');
      o.value = slug; o.textContent = name;
      sel.appendChild(o);
    });
}

const VERDICT = {
  yes: 'deductible on your state return too',
  no: 'still taxed by your state',
  unclear: 'not yet confirmed by the state',
  partial: 'a smaller capped state break',
  'n/a': '—'
};

function renderState() {
  const box = $('stateVerdict');
  const slug = $('state').value;
  const e = STATES[slug];
  if (!slug || !e) { box.hidden = true; return; }
  box.hidden = false;
  if (!e.hasWageTax) {
    box.innerHTML = `<strong>${e.name}:</strong> no state income tax — your federal saving is the whole benefit.`;
    return;
  }
  const y25 = e.overtime.y2025, y26 = e.overtime.y2026;
  box.innerHTML =
    `<strong>Overtime deduction in ${e.name}:</strong> ` +
    `2025 — ${VERDICT[y25] || y25}; 2026–2028 — ${VERDICT[y26] || y26}.` +
    `<div class="obbba-note">${e.note}</div>`;
}

// Plain-words reason when there's $0 federal tax saved.
function zeroBenefitNote(r) {
  if (r.eligibleAmount <= 0) {
    return 'Enter your overtime premium above to see your federal tax saving.';
  }
  if (r.fullyPhasedOut) {
    return 'Your income is high enough that the deduction is fully phased out, so there is nothing to deduct this year.';
  }
  return 'With these inputs there is no federal tax to save this year.';
}

function render() {
  const income = moneyValue($('income'));
  const filing = $('filing').value;

  // Estimator: if regular rate + OT hours are given, compute the premium for the user.
  const rate = moneyValue($('regRate')), hours = num('otHours');
  if (rate > 0 && hours > 0) {
    $('premium').value = Math.round(overtimePremium(rate, hours));
  }
  const premium = moneyValue($('premium'));

  const r = estimate({ kind: 'overtime', eligibleAmount: premium, grossAnnual: income, filingStatus: filing, federal: OBBBA, fed: FED });

  const capNote = r.eligibleAmount > r.statutoryCap
    ? ` <span class="obbba-note">(capped at ${usd(r.statutoryCap)})</span>`
    : '';
  const phaseNote = r.phasedOut
    ? `<div class="line"><span>Reduced by income phase-out</span><span class="num phaseout-flag">${r.fullyPhasedOut ? 'fully phased out' : 'yes — cap lowered to ' + usd(r.allowedCap)}</span></div>`
    : '';

  // ---- Answer-first summary (stat card) --------------------------------
  // The headline number the user came for, surfaced above the derivation.
  const benefits = r.taxSaved > 0;
  const statValue = benefits ? usd(r.taxSaved) : '$0';
  const statSub = benefits
    ? `Your deductible overtime premium is ${usd(r.deduction)} of the ${usd(r.eligibleAmount)} you earned.`
    : zeroBenefitNote(r); // the "why" stays visible, never hidden in details
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Federal tax saved on your overtime premium</p>` +
      `<p class="stat-value${benefits ? '' : ' is-zero'}">${statValue}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- Earned vs deductible comparison bars (decorative, so aria-hidden) -
  const barMax = Math.max(r.eligibleAmount, r.deduction, 1);
  const earnedPct = Math.min(100, (r.eligibleAmount / barMax) * 100).toFixed(1);
  const dedPct = Math.min(100, (r.deduction / barMax) * 100).toFixed(1);
  const compareBars = r.eligibleAmount > 0
    ? `<div class="compare-bars" aria-hidden="true">` +
        `<div class="cb-row"><span>Premium earned ${usd(r.eligibleAmount)}</span><span class="cb-track"><span class="cb-fill cb-over" style="width:${earnedPct}%"></span></span></div>` +
        `<div class="cb-row"><span>Deductible ${usd(r.deduction)}</span><span class="cb-track"><span class="cb-fill" style="width:${dedPct}%"></span></span></div>` +
      `</div>`
    : '';

  // ---- One headline caveat (phase-down) shown OUTSIDE the details -------
  const headlineCaveat = (benefits && r.phasedOut && !r.fullyPhasedOut)
    ? `<div class="obbba-note phaseout-flag">Heads up: your income is above the phase-out threshold, so your deductible cap is lowered to ${usd(r.allowedCap)} (see the breakdown for the math).</div>`
    : '';

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  // Label fix: this row previously mislabeled the taxSaved/deduction ratio
  // as your headline marginal rate; it's really the effective rate the
  // deduction was taxed at (it can straddle a bracket line). Matches SALT's
  // calculator wording.
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      `<div class="line"><span>Your overtime premium</span><span class="num">${usd(r.eligibleAmount)}${capNote}</span></div>` +
      phaseNote +
      `<div class="line"><span>Deductible amount</span><span class="num">${usd(r.deduction)}</span></div>` +
      `<div class="line big"><span>Estimated federal tax saved</span><span class="num">${usd(r.taxSaved)}</span></div>` +
      `<div class="line"><span>Effective federal rate on this deduction</span><span class="num">${pct(r.marginalRate)}</span></div>` +
      `<div class="obbba-note">Social Security and Medicare (FICA) still apply to this overtime — the deduction lowers federal income tax only, claimed when you file.</div>` +
    `</details>`;

  // Preserve the user's open/closed choice across re-renders (default closed).
  const out = $('out');
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  out.innerHTML =
    statCard +
    compareBars +
    headlineCaveat +
    derivation +
    `<div class="takeaway">In plain terms: this lands as a bigger refund (or a smaller bill) when you file next year — your weekly paycheck and its withholding don't change now.</div>`;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;

  renderState();
}

function init() {
  initMoneyInputs();
  fillStates();
  ['income', 'premium', 'regRate', 'otHours', 'filing', 'state'].forEach((id) => {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
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
