// car-loan-interest-calculator.js — estimates the OBBBA car-loan interest
// deduction (IRC §163(h)(4), added by §70203): up to $10,000 of interest a
// year on a new, US-assembled, personal-use vehicle loan for tax years
// 2025–2028, with the $100,000/$200,000 MAGI phase-out ($200 per $1,000 over,
// applied after the $10,000 cap) and the federal tax saved. All logic
// client-side.
import { carLoanFirstYearInterest, estimateCarLoan } from '/assets/obbba-deduction.js';
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

// Which eligibility box, if unchecked, disqualifies — with a plain reason.
const ELIG = [
  ['e-new', 'Used vehicles and lease-end buyouts don’t qualify — the deduction requires a <strong>new</strong> vehicle whose original use begins with you.'],
  ['e-usa', 'The vehicle’s <strong>final assembly must be in the United States</strong>. Check the plant code in your VIN (NHTSA decoder) or the “Final Assembly Point” on the window sticker.'],
  ['e-origin', 'Only loans <strong>taken out after December 31, 2024</strong> qualify. A loan signed in 2024 or earlier doesn’t count, even if you’re still paying interest.'],
  ['e-personal', 'The vehicle must be for <strong>personal use and financed with a loan, not a lease</strong>. Business/commercial vehicles and any lease financing are excluded.']
];

// Phase-out arithmetic in words for the deduction line.
function phaseoutNote(r) {
  if (r.fullyPhasedOut) {
    return `<div class="obbba-note phaseout-flag">Your income is ${usd(r.excess)} over the ${usd(r.threshold)} threshold. That removes $200 for each $1,000 over &mdash; ${usd(r.reduction)} in all &mdash; which wipes out the whole ${usd(r.cappedInterest)} of deductible interest, so the deduction is $0.</div>`;
  }
  if (r.phasedOut) {
    return `<div class="obbba-note phaseout-flag">Your income is ${usd(r.excess)} over the ${usd(r.threshold)} threshold. The deduction drops by $200 for each $1,000 over (${usd(r.reduction)} in all), leaving ${usd(r.deduction)}.</div>`;
  }
  return `<div class="obbba-note">Your income is under the ${usd(r.threshold)} threshold, so there’s no phase-out &mdash; you deduct the full ${usd(r.cappedInterest)}.</div>`;
}

function render() {
  const year = parseInt($('year').value, 10);
  const filing = $('filing').value;
  const magi = num('magi');
  const amount = num('amount');
  const apr = num('apr') / 100; // percent -> decimal
  const term = num('term');

  const fyi = carLoanFirstYearInterest({ amount, apr, termMonths: term });
  const interest = fyi.firstYearInterest;

  // First failed eligibility box (if any).
  const failed = ELIG.filter(([id]) => !$(id).checked);
  const eligible = failed.length === 0;

  const r = estimateCarLoan({ year, filingStatus: filing, magi, interest, eligible, federal: OBBBA, fed: FED });

  // Estimated first-year interest, with one line of arithmetic.
  const interestBlock =
    `<div class="line"><span>Estimated first-year interest</span><span class="num">${usd2(interest)}</span></div>` +
    (amount > 0 && term > 0 && apr > 0
      ? `<div class="obbba-note">On a ${usd(amount)} loan at ${(apr * 100).toFixed(2)}% over ${term} months, the monthly payment is about ${usd2(fyi.monthlyPayment)} and ${fyi.months} payments in the first year include ${usd2(interest)} of interest.</div>`
      : `<div class="obbba-note">Enter a loan amount, APR, and term to estimate the first-year interest.</div>`);

  let deductionBlock, statValue, statSub, isZero, headlineCaveat;
  if (!eligible) {
    const reasons = failed.map(([, why]) => `<li>${why}</li>`).join('');
    deductionBlock =
      `<div class="line big"><span>Allowed deduction</span><span class="num">$0</span></div>` +
      `<div class="obbba-note ineligible-flag">Not eligible &mdash; the interest on this loan can’t be deducted:<ul style="margin:6px 0 0 18px">${reasons}</ul></div>` +
      `<div class="line big"><span>Estimated federal tax saving</span><span class="num">$0</span></div>`;
    statValue = '$0';
    statSub = 'Not eligible: ' + failed.map(([, why]) => why).join(' ');
    isZero = true;
    headlineCaveat = '';
  } else {
    const capNote = interest > r.statutoryCap
      ? `<div class="obbba-note">You paid ${usd2(interest)} in interest, but the deduction is capped at ${usd(r.statutoryCap)} &mdash; the rest isn’t deductible.</div>`
      : '';
    const savingNote = r.deduction > 0
      ? `<div class="obbba-note">A deduction lowers taxable income, not your tax bill dollar-for-dollar: ${usd(r.deduction)} deducted, worth ${usd(r.taxSaved)} at the effective federal rate on this deduction (${pct(r.marginalRate)}).</div>`
      : `<div class="obbba-note ineligible-flag">After the income phase-out, nothing is left to deduct this year.</div>`;
    deductionBlock =
      `<div class="line big"><span>Allowed deduction</span><span class="num">${usd(r.deduction)}</span></div>` +
      capNote +
      phaseoutNote(r) +
      `<div class="line big"><span>Estimated federal tax saving</span><span class="num">${usd(r.taxSaved)}</span></div>` +
      savingNote;

    if (r.taxSaved > 0) {
      statValue = usd(r.taxSaved);
      statSub = `Your ${usd(r.deduction)} allowed deduction${interest > r.statutoryCap ? ` (capped at ${usd(r.statutoryCap)})` : ''} lowers your taxable income, not your tax bill dollar-for-dollar.`;
      isZero = false;
      headlineCaveat = (r.phasedOut && !r.fullyPhasedOut)
        ? `<div class="obbba-note phaseout-flag">Heads up: your income is over the ${usd(r.threshold)} threshold, so the phase-out trims your deduction to ${usd(r.deduction)} (see the breakdown for the math).</div>`
        : '';
    } else {
      statValue = '$0';
      statSub = r.fullyPhasedOut
        ? `Your income is ${usd(r.excess)} over the ${usd(r.threshold)} threshold — that fully phases out the deduction, so this saves you $0.`
        : 'Enter a loan amount, APR, and term to see your deductible interest and tax saving.';
      isZero = true;
      headlineCaveat = '';
    }
  }

  // ---- Answer-first summary (stat card) --------------------------------
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Federal tax saved by the car-loan interest deduction</p>` +
      `<p class="stat-value${isZero ? ' is-zero' : ''}">${statValue}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      interestBlock +
      deductionBlock +
    `</details>`;

  const out = $('out');
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  const takeaway = `<div class="takeaway">In plain terms: when it applies, this is a deduction you claim at tax time — a bigger refund or a smaller IRS bill — not a cut to your monthly car payment.</div>`;

  out.innerHTML = statCard + headlineCaveat + derivation + takeaway;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;
}

function init() {
  initMoneyInputs();
  ['year', 'filing', 'magi', 'amount', 'apr', 'term', 'e-new', 'e-usa', 'e-origin', 'e-personal'].forEach((id) => {
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
