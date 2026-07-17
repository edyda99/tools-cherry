// senior-deduction-calculator.js — estimates the OBBBA senior bonus deduction
// (IRC §151(d)(5)(C)): $6,000 per person 65+, tax years 2025–2028, with the 6%
// MAGI phase-out. All logic client-side; nothing uploaded.
import { estimateSenior } from '/assets/obbba-deduction.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

// Comma-safe: the income field carries live thousands separators, so read it
// through moneyValue (strips separators) rather than a raw parseFloat, which
// would silently truncate "60,000" to 60.
function num(id) {
  return moneyValue($(id));
}

// Plain-words explanations for the engine's ineligibility notes.
function ineligibleLine(r, year) {
  if (r.notes.includes('mfs_denied')) {
    return 'Married filing separately can’t claim this deduction — the law requires married taxpayers to file a joint return.';
  }
  if (r.notes.includes('not_in_effect')) {
    return `The deduction only exists for tax years 2025 through 2028 — it isn’t available for ${year}.`;
  }
  if (r.notes.includes('not_65')) {
    return `No one on this return is 65 or older by December 31, ${year} — the deduction starts the year you turn 65.`;
  }
  if (r.notes.includes('fully_phased_out')) {
    return `Your income is ${usd(r.excess)} over the ${usd(r.threshold)} threshold — at 6 cents lost per dollar, the deduction is fully phased out (it reaches $0 once income passes ${usd(r.threshold + 100000)}).`;
  }
  return 'You don’t qualify for this deduction with these inputs.';
}

function render() {
  const year = parseInt($('year').value, 10);
  const filing = $('filing').value;
  const age65 = $('age65').checked;
  const spouseAge65 = $('spouseAge65').checked;
  const magi = num('magi');

  // Spouse toggle only applies (and only shows) for married filing jointly.
  $('spouseRow').hidden = filing !== 'married';

  const r = estimateSenior({ year, filingStatus: filing, age65, spouseAge65, magi, federal: OBBBA, fed: FED });

  const out = $('out');
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  if (r.deduction <= 0) {
    const statCard =
      `<div class="stat-card">` +
        `<p class="stat-kicker">Federal tax saved by the senior deduction</p>` +
        `<p class="stat-value is-zero">$0</p>` +
        `<p class="stat-sub">${ineligibleLine(r, year)}</p>` +
      `</div>`;
    const derivation =
      `<details class="derivation"><summary>See how this was calculated</summary>` +
        `<div class="line big"><span>Your senior bonus deduction</span><span class="num">$0</span></div>` +
        `<div class="obbba-note">Reminder: this deduction never changes how much of your Social Security is taxable — those rules are the same as before the 2025 law.</div>` +
      `</details>`;
    out.innerHTML = statCard + derivation;
    const newDetails = out.querySelector('details.derivation');
    if (newDetails) newDetails.open = wasOpen;
    return;
  }

  const phaseLine = r.phasedOut
    ? `<div class="line"><span>Income phase-out</span><span class="num phaseout-flag">−${usd(r.phaseoutReduction)}</span></div>` +
      `<div class="obbba-note phaseout-flag">Your income is ${usd(r.excess)} over the ${usd(r.threshold)} threshold, which trims each person’s $6,000 by 6 cents per dollar — −${usd(r.perPersonReduction)} each, −${usd(r.phaseoutReduction)} total.</div>`
    : '';

  // ---- Answer-first summary (stat card) --------------------------------
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Federal tax saved by the senior deduction</p>` +
      `<p class="stat-value">${usd(r.taxSaved)}</p>` +
      `<p class="stat-sub">Your senior deduction is ${usd(r.deduction)} for ${r.eligibleCount} qualifying ${r.eligibleCount === 1 ? 'person' : 'people'}.</p>` +
    `</div>`;

  // ---- One headline caveat (phase-down) shown OUTSIDE the details -------
  const headlineCaveat = r.phasedOut
    ? `<div class="obbba-note phaseout-flag">Heads up: your income is over the ${usd(r.threshold)} threshold, so the phase-out trims your deduction to ${usd(r.deduction)} (see the breakdown for the math).</div>`
    : '';

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  // Label fix: this row previously mislabeled the taxSaved/deduction ratio
  // as your headline marginal rate; it's really the effective rate the
  // deduction was taxed at (it can straddle a bracket line). Matches SALT's
  // calculator wording.
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      `<div class="line"><span>Qualifying people (65+)</span><span class="num">${r.eligibleCount} × $6,000 = ${usd(r.deductionBeforePhaseout)}</span></div>` +
      phaseLine +
      `<div class="line"><span>Your senior bonus deduction (${year})</span><span class="num">${usd(r.deduction)}</span></div>` +
      `<div class="line big"><span>Estimated federal tax saved</span><span class="num">${usd(r.taxSaved)}</span></div>` +
      `<div class="line"><span>Effective federal rate on this deduction</span><span class="num">${pct(r.marginalRate)}</span></div>` +
      `<div class="obbba-note">Claimed on Schedule 1-A when you file — available whether or not you itemize, on top of the regular and 65+ standard deductions. It does NOT change how much of your Social Security is taxable, your AGI, or Medicare IRMAA.</div>` +
    `</details>`;

  out.innerHTML =
    statCard +
    headlineCaveat +
    derivation +
    `<div class="takeaway">In plain terms: you claim this when you file, so it lands as a bigger refund or a smaller tax bill — it doesn't add anything to your Social Security check or change how that check is taxed.</div>`;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;
}

function init() {
  initMoneyInputs();
  ['year', 'filing', 'age65', 'spouseAge65', 'magi'].forEach((id) => {
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
