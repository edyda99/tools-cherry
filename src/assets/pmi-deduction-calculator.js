// pmi-deduction-calculator.js — estimates the OBBBA-revived mortgage insurance
// premium deduction (IRC §163(h)(3)(E), permanently un-terminated by OBBBA
// §70108): the qualifying premium (recurring + VA/USDA-upfront-in-full +
// amortized-FHA/PMI-upfront-slice), the AGI phaseout (fully eliminated above
// $109,000 / $54,500 MFS — a PERCENTAGE-of-premium haircut, not a dollar-cap
// reduction), the pre-2007-contract gate, and the itemize-vs-standard verdict
// (itemizers only — no non-itemizer alternative). All logic client-side.
//
// IMPORTANT (per the sourced spec): this deduction requires itemizing — unlike
// the OBBBA charitable §170(p) deduction, there is no non-itemizer version. The
// copy INFORMS non-itemizers clearly (deduction allowed on paper, benefit $0,
// plus the dollar gap to itemizing) rather than implying a benefit that isn't
// there.
import { mipComparison } from '/assets/obbba-deduction.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const usd2 = (n) => '$' + Math.max(0, n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

// Comma-safe: money fields carry live thousands separators, so read them
// through moneyValue (strips separators) rather than a raw parseFloat, which
// would silently truncate "28,000" to 28.
function num(id) {
  return moneyValue($(id));
}

const VA_USDA_TYPES = new Set(['va', 'usda']);

// Show/hide the closing-month + term fields: only relevant when a lump-sum
// premium is amortized (monthly-only PMI or FHA/VA/USDA all can carry an
// upfront amount; the amortization branch itself only matters when NOT
// VA/USDA, so the term/month fields stay visible for every type but the hint
// text changes based on whether amortization actually applies).
function updateUpfrontHint() {
  const type = $('miType').value;
  const exempt = VA_USDA_TYPES.has(type);
  const hint = $('upfrontHint');
  $('termField').style.display = exempt ? 'none' : '';
  const monthField = $('closingMonth').closest('.field');
  if (monthField) monthField.style.display = exempt ? 'none' : '';
  hint.textContent = exempt
    ? 'VA and USDA fees are fully deductible the year paid — no spreading, so the closing month and loan term don\'t matter here.'
    : 'FHA UFMIP or single-premium PMI: enter the lump sum and closing month — it\'s amortized over the shorter of your loan term or 84 months. A VA or USDA fee entered here is deducted in full, no spreading.';
}

// The phaseout arithmetic, in words.
function phaseoutNote(r) {
  if (r.fullyPhasedOut) {
    return `<div class="obbba-note ineligible-flag">Fully phased out: your AGI is over the $${r.threshold.toLocaleString('en-US')} threshold by enough (${r.steps} steps of 10%) to eliminate the entire deduction. That happens above ${usd(r.threshold === 50000 ? 54500 : 109000)} AGI.</div>`;
  }
  if (r.phasedOut) {
    return `<div class="obbba-note phaseout-flag">Phased out by ${r.steps * 10}%: your AGI is over the $${r.threshold.toLocaleString('en-US')} threshold, cutting ${r.steps * 10}% off your qualifying premium (10% for each $${r.stepSize.toLocaleString('en-US')}, or fraction, over the threshold).</div>`;
  }
  return `<div class="obbba-note">Your AGI is at or under the $${r.threshold.toLocaleString('en-US')} threshold, so none of your premium phases out.</div>`;
}

function render() {
  const filing = $('filing').value;
  const agi = num('agi');
  const miType = $('miType').value;
  const recurring = num('recurring');
  const upfront = num('upfront');
  const closingMonth = parseInt($('closingMonth').value, 10);
  const termMonths = parseInt($('termMonths').value, 10);
  const contract2007 = $('contract2007').checked;
  const other = num('other');

  updateUpfrontHint();

  const r = mipComparison({
    filingStatus: filing, agi,
    mortgageInsuranceType: miType, recurringPremiums: recurring,
    upfrontPremium: upfront, closingMonth, termMonths,
    contractIssuedAfter2006: contract2007,
    otherItemized: other,
    params: OBBBA.mip, fed: FED
  });

  if (!contract2007) {
    const statCard =
      `<div class="stat-card">` +
        `<p class="stat-kicker">Federal tax saved by the PMI deduction</p>` +
        `<p class="stat-value is-zero">$0</p>` +
        `<p class="stat-sub">Not eligible: only mortgage insurance contracts issued after December 31, 2006 qualify for this deduction. A pre-2007 contract gets $0, no matter your income.</p>` +
      `</div>`;
    const derivation =
      `<details class="derivation"><summary>See how this was calculated</summary>` +
        `<div class="line big"><span>Qualifying mortgage insurance premium</span><span class="num">$0</span></div>` +
      `</details>`;
    $('out').innerHTML =
      statCard +
      derivation +
      `<div class="takeaway">This restriction was never repealed — it's still part of the law today, unchanged since 2006.</div>`;
    return;
  }

  // --- Premium build-up ------------------------------------------------------
  const buildupLines = [];
  if (r.recurring > 0) {
    buildupLines.push(`<div class="line"><span>Recurring premiums paid in 2026</span><span class="num">${usd(r.recurring)}</span></div>`);
  }
  if (r.vaUsdaUpfront > 0) {
    buildupLines.push(`<div class="line"><span>VA/USDA upfront fee (fully deductible)</span><span class="num">${usd(r.vaUsdaUpfront)}</span></div>`);
  }
  if (r.amortization) {
    buildupLines.push(
      `<div class="line"><span>2026 slice of amortized upfront premium</span><span class="num">${usd2(r.prepaidSlice)}</span></div>` +
      `<div class="obbba-note">Your ${usd(r.upfront)} upfront premium is spread over ${r.amortization.amortMonths} months (the shorter of your loan term or the statutory 84-month cap) at ${usd2(r.amortization.monthlySlice)}/month. ${r.amortization.monthsIn2026} month(s) fall in 2026, so ${usd2(r.amortization.monthlySlice)} × ${r.amortization.monthsIn2026} = ${usd2(r.prepaidSlice)} is deductible this year. The rest carries into future years — and if you refinance or pay off the loan before the amortization ends, the remaining unamortized balance is <strong>lost</strong>, not deducted at payoff.</div>`
    );
  }

  const buildup = buildupLines.join('') +
    `<div class="line big"><span>Qualifying mortgage insurance premium</span><span class="num">${usd2(r.qualifyingPremium)}</span></div>`;

  // --- AGI phaseout -----------------------------------------------------------
  const phaseoutBlock =
    `<div class="line"><span>Deductible after the AGI phaseout</span><span class="num">${usd2(r.deduction)}</span></div>` +
    phaseoutNote(r);

  // --- Itemize-vs-standard verdict --------------------------------------------
  const verdict = r.itemize
    ? `<div class="line"><span>Itemized total vs standard deduction</span><span class="num">${usd(r.itemizedTotal)} vs ${usd(r.standardDeduction)}</span></div>` +
      `<div class="obbba-note">Itemizing wins: your mortgage insurance deduction plus ${usd(r.otherItemized)} of other itemized deductions beats the ${usd(r.standardDeduction)} standard deduction, so it's claimed on Schedule A.</div>`
    : `<div class="line"><span>Itemized total vs standard deduction</span><span class="num">${usd(r.itemizedTotal)} vs ${usd(r.standardDeduction)}</span></div>` +
      `<div class="obbba-note ineligible-flag">Your standard deduction wins — this deduction is unavailable to non-itemizers, so ${r.deduction > 0 ? `even though ${usd2(r.deduction)} technically qualifies, it` : 'it'} saves you $0 this year. You'd need ${usd(r.needMoreToItemize)} more in itemized deductions before it's worth anything.</div>`;

  // --- Federal tax saved -------------------------------------------------------
  const savings = r.taxSaved > 0
    ? `<div class="line big"><span>Federal income tax this saves you</span><span class="num">${usd(r.taxSaved)}</span></div>` +
      `<div class="obbba-note">${usd(r.deductionBenefit)} of incremental deduction, worth ${usd(r.taxSaved)} at the effective federal rate on this deduction (${pct(r.marginalRate)}). A deduction lowers taxable income, not your tax bill dollar-for-dollar.</div>`
    : `<div class="line big"><span>Federal income tax this saves you</span><span class="num">$0</span></div>` +
      `<div class="obbba-note ineligible-flag">${zeroReason(r)}</div>`;

  // ---- Answer-first summary (stat card) --------------------------------
  const benefits = r.taxSaved > 0;
  const statValue = benefits ? usd(r.taxSaved) : '$0';
  const statSub = benefits
    ? `Your ${usd2(r.deduction)} deductible premium is claimed on Schedule A.`
    : zeroReason(r); // the "why" stays visible, never hidden in details
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Federal tax saved by the PMI deduction</p>` +
      `<p class="stat-value${benefits ? '' : ' is-zero'}">${statValue}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- One headline caveat shown OUTSIDE the details ---------------------
  const headlineCaveat = (benefits && r.phasedOut && !r.fullyPhasedOut)
    ? `<div class="obbba-note phaseout-flag">Heads up: your AGI is over the $${r.threshold.toLocaleString('en-US')} threshold, so the phaseout trims your deduction to ${usd2(r.deduction)} (see the breakdown for the math).</div>`
    : '';

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      buildup +
      phaseoutBlock +
      verdict +
      savings +
    `</details>`;

  const out = $('out');
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  out.innerHTML =
    statCard +
    headlineCaveat +
    derivation +
    `<div class="takeaway">In plain terms: this only helps if itemizing beats your standard deduction, and only up to $109,000 AGI ($54,500 married filing separately). Past that, or if you take the standard deduction, the premiums you paid are real but produce no extra federal tax saving.</div>`;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;
}

function zeroReason(r) {
  if (r.qualifyingPremium <= 0) {
    return 'Enter your mortgage insurance premiums to see your deduction and tax saving.';
  }
  if (r.fullyPhasedOut) {
    return `Your AGI has fully phased out the deduction (above ${r.threshold === 50000 ? '$54,500' : '$109,000'}), so this saves you $0 regardless of itemizing.`;
  }
  if (!r.itemize) {
    return `Your standard deduction (${usd(r.standardDeduction)}) beats itemizing (${usd(r.itemizedTotal)}) — you'd take the standard deduction, so this deduction saves you $0. You'd need ${usd(r.needMoreToItemize)} more in itemized deductions for it to matter.`;
  }
  return 'With these inputs your mortgage insurance premiums produce no additional federal tax saving.';
}

function init() {
  initMoneyInputs();
  ['filing', 'agi', 'miType', 'recurring', 'upfront', 'closingMonth', 'termMonths', 'contract2007', 'other'].forEach((id) => {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  updateUpfrontHint();
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
