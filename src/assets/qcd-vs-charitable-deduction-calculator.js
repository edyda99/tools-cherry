// qcd-vs-charitable-deduction-calculator.js — Qualified Charitable Distribution
// (QCD, IRC §408(d)(8)) vs. "take the IRA distribution and deduct it" compare.
// Reuses qcd-comparison.js, which itself reuses the shipped charitableComparison
// engine for the whole take-and-deduct side. All logic client-side.
//
// IMPORTANT (per the sourced spec): never overclaim a federal-tax win. At/below
// the §170(p) $1,000 (single) / $2,000 (MFJ) cap, the two paths TIE on federal
// income tax — QCD only wins via a lower AGI in that band. The copy below is
// written to reflect that exactly, never "QCD always saves you more tax."
import { qcdComparison } from '/assets/qcd-comparison.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;
const QCD = OBBBA.qcd;
const CHARITABLE = OBBBA.charitable;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');

// Comma-safe: money fields carry live thousands separators, so read them
// through moneyValue (strips separators) rather than a raw parseFloat, which
// would silently truncate "28,000" to 28.
function num(id) {
  const el = $(id);
  if (!el) return 0;
  return moneyValue(el);
}

// The take-and-deduct path, rendered as plain derivation rows (reused both as
// one side of the full comparison and, alone, when a QCD isn't
// available/advisable for the current inputs).
function colB(r, { standalone = false, winB = false } = {}) {
  const verdictLine = r.resB.itemize
    ? `Itemizes (beats the ${usd(r.resB.standardDeduction)} standard deduction)`
    : `Takes the standard deduction${r.resB.nonItemizerDed > 0 ? ` (+${usd(r.resB.nonItemizerDed)} §170(p) bonus)` : ''}`;
  return (
    `<p><strong>Take the distribution, then deduct it${winB ? ' — wins' : ''}${standalone ? ' (your only option here)' : ''}</strong></p>` +
    `<div class="line"><span>AGI</span><span class="num">${usd(r.agiB)}</span></div>` +
    `<div class="line"><span>Verdict</span><span class="num">${verdictLine}</span></div>` +
    `<div class="line"><span>Charitable deduction claimed</span><span class="num">${usd(r.resB.charitableDeductible)}</span></div>` +
    `<div class="line big"><span>Federal income tax</span><span class="num">${usd(r.taxB)}</span></div>`
  );
}

function render() {
  const filingStatus = $('filing').value;
  const age = num('age');
  const spouseAlsoQualifies = $('spouseAge65').checked;
  const donation = num('donation');
  const baseAgi = num('agi');
  const otherItemized = num('other');
  const accountType = $('accountType').value;
  const rmdAmount = num('rmd');
  const post70DeductibleContribs = num('offset');

  const r = qcdComparison({
    filingStatus, age, spouseAlsoQualifies, donation, baseAgi, otherItemized,
    accountType, rmdAmount, post70DeductibleContribs,
    year: 2026, qcd: QCD, charitable: CHARITABLE, fed: FED
  });

  // Only show the spouse-65 checkbox when it can matter (MFJ).
  $('spouseWrap').style.display = filingStatus === 'married' ? '' : 'none';

  const out = $('out');
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  // --- Blocked paths: under 70½, or an account type that can't/shouldn't QCD ---
  if (!r.eligible) {
    let reason;
    if (!r.accountEligible) {
      reason = `A QCD can only be made from an IRA — not a <strong>401(k), 403(b), or 457</strong> plan (and not an <em>ongoing</em> SEP or SIMPLE IRA). Roll the funds into a traditional IRA first if you want to use this strategy.`;
    } else if (r.accountSteerAway) {
      reason = `A Roth IRA technically qualifies for a QCD, but it almost never makes sense: qualified Roth withdrawals are <strong>already tax-free</strong>, so there's no taxable income to exclude — the whole point of a QCD. Use a traditional IRA instead.`;
    } else {
      reason = `You must have <strong>attained age 70½</strong> on the distribution date to make a QCD — you're not there yet. (This is separate from the Required Minimum Distribution age of <strong>73</strong>.) Until then, taking the distribution and deducting it is your only option for this gift.`;
    }

    // ---- Answer-first summary (stat card) --------------------------------
    const statCard =
      `<div class="stat-card">` +
        `<p class="stat-kicker">QCD vs. taking the distribution and deducting it</p>` +
        `<p class="stat-value is-zero">QCD not available</p>` +
        `<p class="stat-sub">${reason}</p>` +
      `</div>`;

    const derivation =
      `<details class="derivation"><summary>See how this was calculated</summary>` +
        colB(r, { standalone: true }) +
      `</details>`;

    out.innerHTML =
      statCard +
      derivation +
      (donation > 0
        ? `<div class="takeaway">This is what taking the ${usd(donation)} distribution and claiming a charitable deduction looks like — it still lowers your federal income tax (via itemizing or the §170(p) non-itemizer deduction), just without the QCD's AGI exclusion.</div>`
        : `<div class="obbba-note">Enter a donation amount to see the numbers.</div>`);

    const newDetails1 = out.querySelector('details.derivation');
    if (newDetails1) newDetails1.open = wasOpen;
    return;
  }

  // --- Normal comparison: Path A (QCD) vs Path B (take-and-deduct) -----------
  const tie = r.qcdSavesFederalTax < 0.5;

  // ---- Answer-first summary (stat card) --------------------------------
  let statValue, statSub;
  if (donation <= 0) {
    statValue = 'Enter a donation amount';
    statSub = 'Type in how much you want to give to see the comparison.';
  } else if (tie) {
    statValue = 'Ties on federal tax';
    statSub = `Your ${usd(donation)} gift is at or below the $1,000/$2,000 §170(p) cap, so taking the distribution and deducting it removes the same dollars from taxable income as the QCD excludes — federal income tax comes out identical either way. The QCD still keeps your AGI ${usd(r.agiKeptLowerBy)} lower, which can matter for Medicare IRMAA and Social Security taxability, just not for this year's tax bill.`;
  } else {
    statValue = `QCD wins by ${usd(r.qcdSavesFederalTax)}`;
    statSub = `And it keeps your AGI ${usd(r.agiKeptLowerBy)} lower than taking the distribution and deducting the gift.`;
  }
  const isZero = donation <= 0 || tie;
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">QCD vs. taking the distribution and deducting it</p>` +
      `<p class="stat-value${isZero ? ' is-zero' : ''}">${statValue}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- Paid-vs-alternative comparison bars (decorative, so aria-hidden) --
  const barMax = Math.max(r.taxA, r.taxB, 1);
  const aPct = Math.min(100, (r.taxA / barMax) * 100).toFixed(1);
  const bPct = Math.min(100, (r.taxB / barMax) * 100).toFixed(1);
  const compareBars = donation > 0
    ? `<div class="compare-bars" aria-hidden="true">` +
        `<div class="cb-row"><span>QCD federal tax ${usd(r.taxA)}</span><span class="cb-track"><span class="cb-fill" style="width:${aPct}%"></span></span></div>` +
        `<div class="cb-row"><span>Take &amp; deduct federal tax ${usd(r.taxB)}</span><span class="cb-track"><span class="cb-fill cb-over" style="width:${bPct}%"></span></span></div>` +
      `</div>`
    : '';

  const overLimitNote = r.notes.includes('over_annual_limit')
    ? `<div class="obbba-note phaseout-flag">Only ${usd(r.qcdLimit)} can be a QCD this year (the 2026 limit). The remaining ${usd(r.overLimit)} of your ${usd(donation)} gift was taken as a taxable IRA distribution instead — deducted on Schedule A if it beats the floor.</div>`
    : '';
  const offsetNote = r.notes.includes('post70_offset_applied')
    ? `<div class="obbba-note phaseout-flag">Your excludable QCD is reduced by ${usd(post70DeductibleContribs)} because you're still deducting IRA contributions after age 70½ (a narrow anti-abuse rule) — that portion is taken as a taxable distribution instead.</div>`
    : '';

  // ---- One headline caveat shown OUTSIDE the details ---------------------
  const headlineCaveat = overLimitNote || '';

  const colA =
    `<p><strong>QCD (direct to charity)${tie ? ' — ties on tax' : ' — wins'}</strong></p>` +
    `<div class="line"><span>Excluded from income (QCD)</span><span class="num">${usd(r.qcdAmount)}</span></div>` +
    `<div class="line"><span>AGI</span><span class="num">${usd(r.agiA)}</span></div>` +
    (r.overLimit > 0
      ? `<div class="line"><span>Taxable remainder (over the limit)</span><span class="num">${usd(r.overLimit)}</span></div>`
      : '') +
    `<div class="line big"><span>Federal income tax</span><span class="num">${usd(r.taxA)}</span></div>` +
    `<div class="obbba-note">The QCD gift itself is never deductible — it was never income, so there's nothing to write off. No withholding either: the full ${usd(r.qcdAmount)} reaches the charity.</div>`;

  const rmdLine = (r.isRmdAge && rmdAmount > 0)
    ? `<div class="line"><span>This QCD satisfies</span><span class="num">${usd(r.rmdSatisfiedByQcd)} of ${usd(rmdAmount)} RMD</span></div>` +
      `<div class="obbba-note">Make the QCD <strong>before</strong> any other withdrawal this year — the first dollars out are what count toward your RMD, so an earlier taxable withdrawal would eat the RMD first and turn the QCD into "extra."</div>`
    : '';

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  // (over_annual_limit is already surfaced above as the headline caveat, so
  // it isn't repeated inside the details.)
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      colA +
      colB(r) +
      offsetNote +
      rmdLine +
      `<div class="obbba-note">A lower AGI isn't just this year's tax bill — it can also matter for Medicare Part B/D <strong>IRMAA</strong> surcharges, how much of your <strong>Social Security</strong> benefit is taxed, and the 3.8% <strong>NIIT</strong> threshold. None of those respond to an itemized deduction (taken after AGI), only to actually keeping the dollars out of AGI in the first place — which is exactly what a QCD does.</div>` +
    `</details>`;

  out.innerHTML =
    statCard +
    compareBars +
    headlineCaveat +
    derivation +
    `<div class="takeaway">In plain terms: the QCD path never gives up more federal tax than deducting the gift would — at worst (a small gift under the §170(p) cap) it ties, and above that it wins outright, plus it always keeps your AGI lower.</div>`;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;
}

function init() {
  initMoneyInputs();
  ['filing', 'age', 'spouseAge65', 'donation', 'agi', 'other', 'accountType', 'rmd', 'offset'].forEach((id) => {
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
