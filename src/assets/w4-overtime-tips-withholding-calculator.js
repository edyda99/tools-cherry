// w4-overtime-tips-withholding-calculator.js — turns the OBBBA no-tax-on-tips
// (IRC §224) and no-tax-on-overtime (IRC §225) deductions into a 2026 Form W-4
// Step 4(b) adjustment: what to enter on the Deductions Worksheet (line 1a
// tips, line 1b overtime premium), the annual federal WITHHOLDING reduction,
// and the extra take-home per paycheck. Step 4(b) DEDUCTIONS (lowers
// withholding), NOT Step 4(c) (extra withholding). All logic client-side.
import { estimateW4Adjustment, overtimePremium } from '/assets/obbba-deduction.js';

const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const usd2 = (n) => '$' + Math.max(0, n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';
const FREQ_LABEL = { weekly: 'weekly', biweekly: 'biweekly', semimonthly: 'semimonthly', monthly: 'monthly' };
const FREQ_CHECK = { weekly: 'paycheck', biweekly: 'biweekly check', semimonthly: 'check', monthly: 'monthly check' };

function num(id) {
  const el = $(id);
  const v = parseFloat(el ? el.value : '');
  return Number.isFinite(v) ? v : 0;
}

function otMode() {
  const el = document.querySelector('input[name="otmode"]:checked');
  return el ? el.value : 'hours';
}

// The overtime PREMIUM (the deductible 0.5x "half") from whichever entry mode.
function premiumInput() {
  if (otMode() === 'premium') return num('otpremium');
  return overtimePremium(num('otrate'), num('othours'));
}

// One phase-out/cliff note per side (spec §1.2): if income is over the
// $150k/$300k line but the deduction is still positive, the W-4 worksheet's
// simple cliff would wrongly say $0 — tell the user to enter the accurate
// gradual figure directly on Step 4(b).
function phaseoutNote(r) {
  if (!r.anyPhasedOut) return '';
  if (r.dTotal <= 0) {
    return `<div class="obbba-note empty-flag">Your income is high enough that the tips/overtime deduction is fully phased out, so there's nothing to add to your W-4 this year.</div>`;
  }
  return `<div class="obbba-note phaseout-flag">Your income is above the $150,000 ($300,000 joint) line, so the deduction is partly phased out. The W-4 worksheet uses a simple cutoff that would wrongly tell you to enter $0 — enter the accurate ${usd(r.dTotal)} figure directly on Step 4(b) instead (the worksheet is "keep for your records"; your employer only sees the Step 4(b) number).</div>`;
}

function render() {
  const filing = $('filing').value;
  const income = num('income');
  const freq = $('freq').value;
  const tips = num('tips');
  const premium = premiumInput();
  const monthsRemaining = num('months');

  const r = estimateW4Adjustment({
    income, filingStatus: filing, tips, overtimePremium: premium,
    payFrequency: freq, monthsRemaining, federal: OBBBA, fed: FED
  });

  // --- Estimated 2026 deduction (worksheet line 1a / 1b breakout) ---
  const capTips = r.tipsCapBound
    ? `<div class="obbba-note">Your $${Math.round(tips).toLocaleString('en-US')} of tips is above this year's ${usd(r.tips.allowedCap)} limit, so only ${usd(r.dTips)} is deductible.</div>` : '';
  const capOt = r.otCapBound
    ? `<div class="obbba-note">Your ${usd(premium)} overtime premium is above this year's ${usd(r.overtime.allowedCap)} limit, so only ${usd(r.dOt)} is deductible.</div>` : '';

  const deductionBlock =
    `<div class="line"><span>Line 1a — Qualified tips</span><span class="num">${usd(r.dTips)}</span></div>` +
    capTips +
    `<div class="line"><span>Line 1b — Qualified overtime (premium only)</span><span class="num">${usd(r.dOt)}</span></div>` +
    capOt +
    `<div class="line big"><span>Total added to Step 4(b) (line 15)</span><span class="num">${usd(r.dTotal)}</span></div>` +
    phaseoutNote(r);

  if (r.dTotal <= 0) {
    const why = r.anyPhasedOut
      ? `After the income phase-out, there's no tips or overtime deduction left to claim this year.`
      : `Enter your expected tips and/or overtime above to see what to put on your W-4.`;
    $('out').innerHTML = deductionBlock +
      `<div class="obbba-note empty-flag">${why}</div>`;
    return;
  }

  // --- What to enter on the W-4 (copy-ready) ---
  const w4box =
    `<div class="w4box">` +
      `<h3>What to enter on your 2026 Form W-4</h3>` +
      `<div class="wline"><span>Step 4(b) Deductions Worksheet, <span class="w4-code">line 1a</span> (Qualified tips)</span><span>${usd(r.dTips)}</span></div>` +
      `<div class="wline"><span>Step 4(b) Deductions Worksheet, <span class="w4-code">line 1b</span> (Qualified overtime)</span><span>${usd(r.dOt)}</span></div>` +
      `<div class="wline total"><span>These add this much to your Step 4(b) total (line 15)</span><span>${usd(r.dTotal)}</span></div>` +
      `<div class="obbba-note">Copy the line-15 total to <strong>Step 4(b)</strong> on the W-4 itself. This is <strong>Step 4(b) — Deductions</strong> (it lowers withholding), <strong>not</strong> Step 4(c) (which adds extra withholding).</div>` +
    `</div>`;

  // --- Withholding reduction + extra take-home ---
  const savingNote =
    `<div class="obbba-note">Step 4(b) is subtracted from your annualized wages before the tax brackets apply, so this is about ${usd(r.dTotal)} &times; your ${pct(r.marginalRate)} marginal federal rate. Withholding is an estimate, not a guarantee.</div>`;

  const perCheckLine =
    `<div class="line big"><span>Extra take-home per ${FREQ_CHECK[freq] || 'paycheck'}</span><span class="num">${usd2(r.perPaycheck)}</span></div>`;

  const prorationNote = !r.fullYear
    ? `<div class="obbba-note phaseout-flag">Filing the new W-4 with about ${monthsRemaining} month${monthsRemaining === 1 ? '' : 's'} left means the full ${usd(r.annualReduction)} is spread over your ${r.remainingPeriods} remaining ${FREQ_LABEL[freq]} checks — roughly <strong>${usd2(r.perPaycheckRemaining)}</strong> extra per remaining check for the rest of 2026, then ${usd2(r.perPaycheck)} once it's a full year.</div>`
    : '';

  const resultBlock =
    `<div class="line big"><span>Annual federal withholding reduction</span><span class="num">${usd(r.annualReduction)}</span></div>` +
    savingNote +
    perCheckLine +
    prorationNote;

  // --- Caveats ---
  const caveats =
    `<div class="obbba-note">Still withheld regardless: Social Security + Medicare (FICA) on every tip and overtime dollar. State withholding is unaffected unless your state conforms (most don't). This is a federal-withholding estimate.</div>`;

  const takeaway = `<div class="takeaway">In plain terms: this doesn't make your tips or overtime tax-free on your paycheck — it stops your employer from over-withholding, so you keep more each payday instead of waiting for a refund.</div>`;

  $('out').innerHTML = deductionBlock + w4box + resultBlock + caveats + takeaway;
}

function syncOtMode() {
  const mode = otMode();
  $('ot-hours').hidden = mode !== 'hours';
  $('ot-premium').hidden = mode !== 'premium';
  render();
}

function init() {
  ['filing', 'income', 'freq', 'tips', 'otrate', 'othours', 'otpremium', 'months'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  document.querySelectorAll('input[name="otmode"]').forEach((el) => {
    el.addEventListener('change', syncOtMode);
  });
  syncOtMode();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
