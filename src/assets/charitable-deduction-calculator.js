// charitable-deduction-calculator.js — estimates the three OBBBA charitable
// changes (all PERMANENT, effective for tax years beginning after 2025-12-31):
// the §170(p) non-itemizer deduction ($1,000 single / $2,000 MFJ, cash only),
// the §170(b)(1)(I) 0.5%-of-AGI floor for itemizers, and the §68 "2/37 rule"
// 35¢-per-dollar cap in the 37% bracket. Reuses the SALT tool's itemize-vs-
// standard machinery via charitableComparison. All logic client-side.
//
// IMPORTANT (per the sourced spec): the §170(p) non-itemizer deduction is taken
// via §63(b)(4) AFTER AGI is computed — it lowers your FEDERAL INCOME TAX but
// does NOT reduce your AGI (no IRMAA / ACA / Social-Security-taxability effect).
// The copy says "you don't have to itemize to get it" (true) and never claims it
// "lowers your AGI" (false).
import { charitableComparison } from '/assets/obbba-deduction.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

// Comma-safe: money fields carry live thousands separators, so read them
// through moneyValue (strips separators) rather than a raw parseFloat, which
// would silently truncate "28,000" to 28.
function num(id) {
  return moneyValue($(id));
}

// The floor arithmetic in words, for the itemizer branch.
function floorNote(r) {
  if (r.totalCharitableGift <= 0) return '';
  if (r.charDeductible === 0) {
    return `<div class="obbba-note phaseout-flag">New 2026 floor: the first 0.5% of your AGI (${usd(r.floor)}) in giving isn't deductible on Schedule A. Your ${usd(r.totalCharitableGift)} gift is at or below that floor, so <strong>none of it</strong> counts as an itemized deduction this year.</div>`;
  }
  if (r.floorLost > 0) {
    return `<div class="obbba-note phaseout-flag">New 2026 floor: the first 0.5% of your AGI (${usd(r.floor)}) in giving isn't deductible. Only the ${usd(r.charDeductible)} above that floor counts on Schedule A.</div>`;
  }
  return '';
}

function render() {
  const filing = $('filing').value;
  const agi = num('agi');
  const cashGift = num('cashGift');
  const nonCash = num('nonCash');
  const other = num('other');

  const r = charitableComparison({
    filingStatus: filing, agi,
    cashGift, otherCharitable: nonCash, otherItemized: other,
    params: OBBBA.charitable, fed: FED
  });

  // --- Non-itemizer (standard-deduction) branch -----------------------------
  const capBindNote = cashGift > r.nonItemizerCap
    ? `<div class="obbba-note">You gave ${usd(cashGift)} in cash, but the non-itemizer deduction is capped at ${usd(r.nonItemizerCap)} — the rest gives no extra bonus (though it still counts if you itemize).</div>`
    : (cashGift > 0
      ? `<div class="obbba-note">Cash gifts to public charities up to ${usd(r.nonItemizerCap)} qualify — you don't have to itemize to get this. It lowers your federal income tax, but it does <strong>not</strong> lower your AGI.</div>`
      : `<div class="obbba-note">Only <strong>cash</strong> gifts to public charities count toward the non-itemizer deduction — non-cash gifts and gifts to donor-advised funds or private foundations don't.</div>`);

  const stdBlock =
    `<div class="line"><span>If you take the standard deduction (§170(p) bonus)</span><span class="num">${usd(r.nonItemizerDed)}</span></div>` +
    capBindNote;

  // --- Itemize-vs-standard verdict ------------------------------------------
  const verdict = r.itemize
    ? `<div class="line"><span>Itemized total vs standard + bonus</span><span class="num">${usd(r.itemizedAllowed)} vs ${usd(r.stdWorldDeduction)}</span></div>` +
      `<div class="obbba-note">Itemizing wins: your charitable deduction plus ${usd(other)} of other itemized deductions beats the ${usd(r.standardDeduction)} standard deduction, so your gift is claimed on Schedule A (after the 0.5% floor).</div>`
    : `<div class="line"><span>Standard + bonus vs itemizing</span><span class="num">${usd(r.stdWorldDeduction)} vs ${usd(r.itemizedAllowed)}</span></div>` +
      `<div class="obbba-note">Taking the standard deduction wins — so your gift gives you the ${usd(r.nonItemizerDed)} non-itemizer bonus${r.nonItemizerDed === 0 ? ' (which is $0 here — see why below)' : ''}, not a Schedule A deduction.</div>`;

  // --- Deductible amount headline (winning world) ---------------------------
  const deductibleLabel = r.itemize ? 'Deductible charitable amount (itemized, after floor)' : 'Deductible charitable amount (non-itemizer bonus)';
  const deductibleBlock =
    `<div class="line big"><span>${deductibleLabel}</span><span class="num">${usd(r.charitableDeductible)}</span></div>` +
    (r.itemize ? floorNote(r) : '');

  // --- §68 top-bracket 35% cap ---------------------------------------------
  const s68Block = r.topBracketCap
    ? `<div class="obbba-note phaseout-flag">Top-bracket cap: in the 37% bracket, IRC §68's "2/37 rule" trims <strong>every</strong> itemized deduction (charitable, SALT, mortgage interest — not just charity) so a deducted dollar is worth about <strong>35¢, not 37¢</strong>. Your §68 reduction is ${usd(r.s68Cut)}.</div>`
    : '';

  // --- Federal tax saved by the gift ---------------------------------------
  const savings = r.taxSaved > 0
    ? `<div class="line big"><span>Federal income tax this gift saves you</span><span class="num">${usd(r.taxSaved)}</span></div>` +
      `<div class="obbba-note">${usd(r.charitableDeductible)} deducted${r.topBracketCap ? ' (capped at 35% by §68)' : ''}, worth ${usd(r.taxSaved)} at the effective federal rate on this deduction (${pct(r.effectiveRate)}). A deduction lowers taxable income, not your tax bill dollar-for-dollar.</div>`
    : `<div class="line big"><span>Federal income tax this gift saves you</span><span class="num">$0</span></div>` +
      `<div class="obbba-note ineligible-flag">${zeroReason(r, cashGift, nonCash)}</div>`;

  // ---- Answer-first summary (stat card) --------------------------------
  const benefits = r.taxSaved > 0;
  const statValue = benefits ? usd(r.taxSaved) : '$0';
  const statSub = benefits
    ? `Your ${usd(r.charitableDeductible)} deductible gift (of the ${usd(r.totalCharitableGift)} you gave) is claimed ${r.itemize ? 'on Schedule A' : 'as the non-itemizer bonus'}.`
    : zeroReason(r, cashGift, nonCash); // the "why" stays visible, never hidden in details
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Federal tax saved by your donations</p>` +
      `<p class="stat-value${benefits ? '' : ' is-zero'}">${statValue}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- One headline caveat shown OUTSIDE the details ---------------------
  // Zero/ineligible reasons already ride in stat-sub; the remaining gotchas
  // worth surfacing up top are an active 0.5% floor trim or the §68 haircut.
  const headlineCaveat = (benefits && r.itemize && r.floorLost > 0)
    ? `<div class="obbba-note phaseout-flag">Heads up: the 0.5%-of-AGI floor (${usd(r.floor)}) trims your deductible gift to ${usd(r.charDeductible)} (see the breakdown for the math).</div>`
    : (benefits && r.topBracketCap)
      ? `<div class="obbba-note phaseout-flag">Heads up: the top-bracket §68 rule trims your itemized deductions, so a dollar here is worth about 35¢, not 37¢ (see the breakdown).</div>`
      : '';

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      stdBlock +
      verdict +
      deductibleBlock +
      s68Block +
      savings +
    `</details>`;

  // Preserve the user's open/closed choice across re-renders (default closed).
  const out = $('out');
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  out.innerHTML =
    statCard +
    headlineCaveat +
    derivation +
    `<div class="takeaway">In plain terms: this lowers the federal income tax you settle at filing — a bigger refund or smaller bill — not your paycheck. And because it's taken after your AGI, it does <strong>not</strong> reduce your AGI, so it won't change your Medicare IRMAA, ACA subsidy, or how much of your Social Security is taxed.</div>`;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;
}

// Plain-words reason when the gift saves $0 of federal tax.
function zeroReason(r, cashGift, nonCash) {
  if (r.totalCharitableGift <= 0) {
    return 'Enter a donation amount to see your deduction and tax saving.';
  }
  if (!r.itemize && r.nonItemizerDed === 0 && cashGift === 0 && nonCash > 0) {
    return 'Your gift is non-cash (or to a donor-advised fund / private foundation), so it earns no non-itemizer bonus — and your standard deduction beats itemizing, so it produces no Schedule A benefit either.';
  }
  if (!r.itemize && r.nonItemizerDed === 0) {
    return 'Cash to a donor-advised fund or private foundation is excluded from the non-itemizer bonus, and your standard deduction beats itemizing — so this gift saves $0 of federal tax this year.';
  }
  if (r.itemize && r.charDeductible === 0) {
    return `The 0.5%-of-AGI floor (${usd(r.floor)}) is at or above your gift, so none of it is deductible — and you'd itemize on your other deductions regardless. This gift adds $0.`;
  }
  return 'With these inputs your gift produces no additional federal tax saving.';
}

function init() {
  initMoneyInputs();
  ['filing', 'agi', 'cashGift', 'nonCash', 'other'].forEach((id) => {
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
