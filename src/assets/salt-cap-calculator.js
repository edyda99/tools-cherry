// salt-cap-calculator.js — estimates the OBBBA SALT deduction cap (IRC
// §164(b)(6) as amended by §70120): $40,000 cap (2025) / $40,400 (2026),
// 30% phase-down above $500,000 / $505,000 MAGI, $10,000 floor (all halved
// for married filing separately), plus the itemize-vs-standard verdict and
// the federal tax saved vs the old $10,000 cap. All logic client-side.
import { saltComparison } from '/assets/obbba-deduction.js';

const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

function num(id) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : 0;
}

// The phase-down arithmetic, in words, for the cap line.
function capNote(r) {
  if (r.floorReached) {
    return `<div class="obbba-note phaseout-flag">Your income is ${usd(r.excess)} over the ${usd(r.threshold)} threshold — 30% of that (${usd(r.reduction)}) would come off the ${usd(r.baseCap)} cap, but the cap never drops below the ${usd(r.floor)} floor. Past ${usd(r.floorMagi)} of income you're back at the old-law cap.</div>`;
  }
  if (r.phasedDown) {
    return `<div class="obbba-note phaseout-flag">Your income is ${usd(r.excess)} over the ${usd(r.threshold)} threshold — 30% of that (${usd(r.reduction)}) comes off the ${usd(r.baseCap)} cap, leaving ${usd(r.effectiveCap)}.</div>`;
  }
  return `<div class="obbba-note">Your income is under the ${usd(r.threshold)} threshold, so you get the full ${usd(r.baseCap)} cap.</div>`;
}

// Plain-words reason when the cap raise saves $0.
function zeroBenefitNote(r, paid) {
  if (r.itemize === false) {
    return `Your standard deduction (${usd(r.standardDeduction)}) beats itemizing (${usd(r.itemizedTotal)}) — you'd take the standard deduction, so the higher SALT cap saves you $0.`;
  }
  if (r.floorReached) {
    return `Your income has phased the cap all the way back to the ${usd(r.floor)} floor — the same cap as the old law, so the raise saves you $0 this year.`;
  }
  if (paid <= r.oldCap) {
    return `You paid ${usd(paid)} in SALT — the old ${usd(r.oldCap)} cap already let you deduct all of it, so the raise changes nothing for you.`;
  }
  return 'With these inputs your bottom-line deduction is the same as under the old cap.';
}

function render() {
  const year = parseInt($('year').value, 10);
  const filing = $('filing').value;
  const magi = num('magi');
  const paid = num('incomeTax') + num('propTax');
  const other = num('other');

  const r = saltComparison({
    year, filingStatus: filing, magi,
    saltPaid: paid, otherItemized: other,
    params: OBBBA.salt, fed: FED
  });

  const capBindingNote = paid > r.effectiveCap
    ? `<div class="obbba-note">Capped: you paid ${usd(paid)} in SALT but can deduct ${usd(r.effectiveCap)}. The other ${usd(paid - r.effectiveCap)} is not deductible.</div>`
    : `<div class="obbba-note">You paid less than the cap, so you deduct the full ${usd(r.allowedSalt)} you paid.</div>`;

  const verdict = r.itemize
    ? `<div class="line"><span>Itemized total vs standard deduction</span><span class="num">${usd(r.itemizedTotal)} vs ${usd(r.standardDeduction)}</span></div>` +
      `<div class="obbba-note">Itemizing wins: your ${usd(r.allowedSalt)} SALT deduction plus ${usd(other)} of other deductions beats the ${usd(r.standardDeduction)} standard deduction.</div>`
    : `<div class="line"><span>Itemized total vs standard deduction</span><span class="num">${usd(r.itemizedTotal)} vs ${usd(r.standardDeduction)}</span></div>` +
      `<div class="obbba-note ineligible-flag">Your standard deduction wins — you wouldn't itemize, so the SALT cap doesn't affect your return.</div>`;

  const savings = r.deductionBenefit > 0
    ? `<div class="line big"><span>Federal tax saved vs the old $10,000 cap</span><span class="num">${usd(r.taxSaved)}</span></div>` +
      `<div class="obbba-note">Best deduction ${usd(r.bestNew)} under the new cap vs ${usd(r.bestOld)} under the old ${usd(r.oldCap)} cap — ${usd(r.deductionBenefit)} more deducted, worth ${usd(r.taxSaved)} at your marginal federal rate (${pct(r.marginalRate)}).</div>`
    : `<div class="line big"><span>Federal tax saved vs the old $10,000 cap</span><span class="num">$0</span></div>` +
      `<div class="obbba-note ineligible-flag">${zeroBenefitNote(r, paid)}</div>`;

  $('out').innerHTML =
    `<div class="line"><span>State &amp; local tax you paid (SALT)</span><span class="num">${usd(paid)}</span></div>` +
    `<div class="line"><span>Your SALT cap for ${year}</span><span class="num">${usd(r.effectiveCap)}</span></div>` +
    capNote(r) +
    `<div class="line big"><span>Allowed SALT deduction</span><span class="num">${usd(r.allowedSalt)}</span></div>` +
    capBindingNote +
    verdict +
    savings +
    `<div class="takeaway">In plain terms: this only helps if itemizing beats your standard deduction — when it does, it lowers the federal tax you settle at filing, not your paycheck or your property-tax bill.</div>`;

  // SALT torpedo warning: income inside the phase-down band AND the cap is
  // actually binding (each extra $1 of income then adds ~$1.30 of taxable income).
  const t = $('torpedo');
  if (r.torpedoZone && r.capBinding) {
    t.hidden = false;
    t.innerHTML = `<strong>SALT torpedo zone.</strong> Your income sits in the phase-down band (${usd(r.threshold)}–${usd(r.floorMagi)} for ${year}). Each extra $1 you earn also removes $0.30 of SALT deduction, so taxable income rises by $1.30 per $1 — an effective marginal rate of about <strong>45.5%</strong> in the 35% bracket (1.3 × 35%) or <strong>48.1%</strong> in the 37% bracket. If you can shift income out of this band (bonus timing, Roth conversions, capital gains), each dollar moved avoids the surcharge.`;
  } else {
    t.hidden = true;
    t.innerHTML = '';
  }
}

function init() {
  ['year', 'filing', 'magi', 'incomeTax', 'propTax', 'other'].forEach((id) => {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
