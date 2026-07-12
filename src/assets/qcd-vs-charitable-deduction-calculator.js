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

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;
const QCD = OBBBA.qcd;
const CHARITABLE = OBBBA.charitable;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');

function num(id) {
  const el = $(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : 0;
}

// The take-and-deduct column — used both as one side of the full comparison
// and, alone, when a QCD isn't available/advisable for the current inputs.
function colB(r, { standalone = false, winB = false } = {}) {
  const verdictLine = r.resB.itemize
    ? `Itemizes (beats the ${usd(r.resB.standardDeduction)} standard deduction)`
    : `Takes the standard deduction${r.resB.nonItemizerDed > 0 ? ` (+${usd(r.resB.nonItemizerDed)} §170(p) bonus)` : ''}`;
  return (
    `<div class="dc-col ${winB ? 'dc-win' : ''}">` +
    `<div class="dc-col-head">Take the distribution, then deduct it${winB ? ' <span class="dc-badge">Wins</span>' : ''}${standalone ? ' (your only option here)' : ''}</div>` +
    `<div class="line"><span>AGI</span><span class="num">${usd(r.agiB)}</span></div>` +
    `<div class="line"><span>Verdict</span><span class="num">${verdictLine}</span></div>` +
    `<div class="line"><span>Charitable deduction claimed</span><span class="num">${usd(r.resB.charitableDeductible)}</span></div>` +
    `<div class="line big"><span>Federal income tax</span><span class="num">${usd(r.taxB)}</span></div>` +
    `</div>`
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
    $('out').innerHTML =
      `<div class="dc-rec rec-info">` +
      `<div class="dc-rec-tag">Heads up</div>` +
      `<div class="dc-rec-head">A QCD isn't available here</div>` +
      `<div class="dc-rec-sub">${reason}</div>` +
      `</div>` +
      `<div class="dc-cols" style="grid-template-columns:1fr">${colB(r, { standalone: true })}</div>` +
      (donation > 0
        ? `<div class="takeaway">This is what taking the ${usd(donation)} distribution and claiming a charitable deduction looks like — it still lowers your federal income tax (via itemizing or the §170(p) non-itemizer deduction), just without the QCD's AGI exclusion.</div>`
        : `<div class="obbba-note">Enter a donation amount to see the numbers.</div>`);
    return;
  }

  // --- Normal comparison: Path A (QCD) vs Path B (take-and-deduct) -----------
  const tie = r.qcdSavesFederalTax < 0.5;

  let recLabel, recSub;
  if (donation <= 0) {
    recLabel = 'Enter a donation amount';
    recSub = 'Type in how much you want to give to see the comparison.';
  } else if (tie) {
    recLabel = 'Same federal income tax — QCD wins on AGI';
    recSub = `Your ${usd(donation)} gift is at or below the $1,000/$2,000 §170(p) cap, so taking the distribution and deducting it removes the same dollars from taxable income as the QCD excludes — federal income tax comes out identical either way. The QCD still keeps your AGI ${usd(r.agiKeptLowerBy)} lower, which can matter for Medicare IRMAA and Social Security taxability, just not for this year's tax bill.`;
  } else {
    recLabel = `The QCD saves you about ${usd(r.qcdSavesFederalTax)} in federal income tax`;
    recSub = `And it keeps your AGI ${usd(r.agiKeptLowerBy)} lower than taking the distribution and deducting the gift.`;
  }

  const banner =
    `<div class="dc-rec ${tie ? 'rec-info' : 'rec-qcd'}">` +
    `<div class="dc-rec-tag">Result</div>` +
    `<div class="dc-rec-head">${recLabel}</div>` +
    `<div class="dc-rec-sub">${recSub}</div>` +
    `</div>`;

  const overLimitNote = r.notes.includes('over_annual_limit')
    ? `<div class="obbba-note phaseout-flag">Only ${usd(r.qcdLimit)} can be a QCD this year (the 2026 limit). The remaining ${usd(r.overLimit)} of your ${usd(donation)} gift was taken as a taxable IRA distribution instead — deducted on Schedule A if it beats the floor.</div>`
    : '';
  const offsetNote = r.notes.includes('post70_offset_applied')
    ? `<div class="obbba-note phaseout-flag">Your excludable QCD is reduced by ${usd(post70DeductibleContribs)} because you're still deducting IRA contributions after age 70½ (a narrow anti-abuse rule) — that portion is taken as a taxable distribution instead.</div>`
    : '';

  const colA =
    `<div class="dc-col ${tie ? '' : 'dc-win'}">` +
    `<div class="dc-col-head">QCD (direct to charity)${tie ? ' <span class="dc-badge dc-badge-tie">Ties on tax</span>' : ' <span class="dc-badge">Wins</span>'}</div>` +
    `<div class="line"><span>Excluded from income (QCD)</span><span class="num">${usd(r.qcdAmount)}</span></div>` +
    `<div class="line"><span>AGI</span><span class="num">${usd(r.agiA)}</span></div>` +
    (r.overLimit > 0
      ? `<div class="line"><span>Taxable remainder (over the limit)</span><span class="num">${usd(r.overLimit)}</span></div>`
      : '') +
    `<div class="line big"><span>Federal income tax</span><span class="num">${usd(r.taxA)}</span></div>` +
    `<div class="obbba-note">The QCD gift itself is never deductible — it was never income, so there's nothing to write off. No withholding either: the full ${usd(r.qcdAmount)} reaches the charity.</div>` +
    `</div>`;

  const rmdLine = (r.isRmdAge && rmdAmount > 0)
    ? `<div class="line"><span>This QCD satisfies</span><span class="num">${usd(r.rmdSatisfiedByQcd)} of ${usd(rmdAmount)} RMD</span></div>` +
      `<div class="obbba-note">Make the QCD <strong>before</strong> any other withdrawal this year — the first dollars out are what count toward your RMD, so an earlier taxable withdrawal would eat the RMD first and turn the QCD into "extra."</div>`
    : '';

  $('out').innerHTML =
    banner +
    `<div class="dc-cols">${colA}${colB(r)}</div>` +
    overLimitNote +
    offsetNote +
    rmdLine +
    `<div class="dc-breakeven">A lower AGI isn't just this year's tax bill — it can also matter for Medicare Part B/D <strong>IRMAA</strong> surcharges, how much of your <strong>Social Security</strong> benefit is taxed, and the 3.8% <strong>NIIT</strong> threshold. None of those respond to an itemized deduction (taken after AGI), only to actually keeping the dollars out of AGI in the first place — which is exactly what a QCD does.</div>` +
    `<div class="takeaway">In plain terms: the QCD path never gives up more federal tax than deducting the gift would — at worst (a small gift under the §170(p) cap) it ties, and above that it wins outright, plus it always keeps your AGI lower.</div>`;
}

function init() {
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
