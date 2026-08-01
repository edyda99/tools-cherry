// w4-overtime-tips-withholding-wizard.js — the card-by-card flow on
// /w4-overtime-tips-withholding-calculator/.
//
// Turns the OBBBA no-tax-on-tips (IRC §224) and no-tax-on-overtime (IRC §225)
// deductions into a 2026 Form W-4 Step 4(b) adjustment: what to write on the
// Deductions Worksheet (line 1a tips, line 1b overtime premium), the annual
// federal WITHHOLDING reduction, and the extra take-home per paycheck. All logic
// client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// form, its own #w4Form and its otmode radios, and is still served by
// w4-overtime-tips-withholding-calculator.js; the two must stay independent, so
// nothing here reads or writes an id the embed also ships except through its own
// page's DOM.
//
// WHAT THIS TOOL IS NOT. Every other tool in this family answers "what does this
// deduction save me when I file". This one answers the other half — "how do I
// get that money into my paychecks now" — so the plain-terms box must NOT say
// the usual "your paycheck during the year does not change". Here the paycheck
// changing IS the answer. What it must say instead is that the tax bill does not
// shrink (this is the same money, arriving earlier), that FICA is untouched, and
// that doing nothing simply means waiting for the refund.
//
// THE MATH is one engine call. estimateW4Adjustment() caps the tips at $25,000
// and the overtime premium at $12,500 ($25,000 filing jointly), applies the MAGI
// phase-out to each separately, sums them into the Step 4(b) figure, and derives
// the annual withholding reduction from ONE combined exact-bracket difference
// (not two separate calls, which mis-handles a bracket boundary the combined
// deduction spans).
//
// THREE PATHS, and the one that bites. The first card asks which kind of extra
// pay the visitor gets. A path that is OFF must feed the engine ZERO, not merely
// stop showing its card: the cards stay in the DOM (that is the no-JS contract)
// and #tips still holds our $6,000 example, so an "overtime only" visitor would
// otherwise be quoted a tips deduction they never asked for. read() zeroes it.
import { estimateW4Adjustment, overtimePremium } from '/assets/obbba-deduction.js';
import { mountWizard, moneyOf, numOf, radioOf, usd, usdRate, count } from '/assets/wizard-core.js';

const OBBBA = window.__OBBBA__;
const FED = window.__FED__;

// data-step on each card. RESULT is the last card and is never skipped.
const PAID = 0, TIPS = 1, OTRATE = 2, OTHOURS = 3, INCOME = 4, FILING = 5, FREQ = 6, RESULT = 7;

const PAID_WORDS = { tips: 'tips only', overtime: 'overtime only', both: 'tips and overtime' };
const FILING_WORDS = { single: 'single', married: 'married, filing together', head_of_household: 'head of household' };
const FREQ_WORDS = { weekly: 'paid weekly', biweekly: 'paid every two weeks', semimonthly: 'paid twice a month', monthly: 'paid monthly' };

// ---- Reading the cards ------------------------------------------------------
// Both amounts are zeroed on the paths that are off. See the header note: the
// off-path card is still in the document holding our example figure, and the
// engine cannot tell the difference between "not asked" and "answered $6,000".
function read() {
  const paid = radioOf('paid', 'both');
  return {
    paid,
    tips: paid === 'overtime' ? 0 : moneyOf('tips'),
    rate: moneyOf('otrate'),
    hours: numOf('othours'),
    typedPremium: paid === 'tips' ? 0 : moneyOf('otpremium'),
    income: moneyOf('income'),
    filing: radioOf('filing', 'single'),
    freq: radioOf('freq', 'weekly'),
    months: numOf('months')
  };
}

// The overtime PREMIUM (the deductible "half"), from whichever route the
// visitor took. A figure typed into the escape on the rate card outranks rate ×
// hours entirely, which is exactly why the hours card leaves the path when it
// is filled in: nothing after it would use the hours.
function premiumOf(s) {
  if (s.paid === 'tips') return 0;
  if (s.typedPremium > 0) return s.typedPremium;
  return overtimePremium(s.rate, s.hours);
}

const compute = (s) => estimateW4Adjustment({
  income: s.income,
  filingStatus: s.filing,
  tips: s.tips,
  overtimePremium: premiumOf(s),
  payFrequency: s.freq,
  monthsRemaining: s.months,
  federal: OBBBA,
  fed: FED
});

// ---- The one cross-check these answers allow --------------------------------
// The income card defines itself as "everything you expect to be paid this year,
// tips and overtime included", so extra pay above it is not a large number, it
// is an impossible one. Never blocking: the answer still computes underneath,
// the doubt just travels with it, and it travels to BOTH places — the income
// card (the second of the two numbers, so the one being typed when the
// contradiction first exists) and the answer, because a visitor who reaches the
// answer by pressing Next may never come back to the card.
function incomeWarning(s) {
  if (s.income <= 0) return '';
  const premium = premiumOf(s);
  const extras = s.tips + premium;
  if (extras <= 0 || extras <= s.income) return '';
  let what;
  if (s.tips > 0 && premium > 0) {
    what = `the ${usd(extras)} you entered as tips and overtime premium`;
  } else if (s.tips > 0) {
    what = `the ${usd(s.tips)} you entered as tips`;
  } else {
    what = `the ${usd(premium)} of extra pay your overtime works out to`;
  }
  return `Check these numbers: ${what} is more than the ${usd(s.income)} you entered as your pay for the whole ` +
    `year, and that total is meant to include it. One of the two needs another look.`;
}

// ---- The answer -------------------------------------------------------------
// Why there is nothing to put on the W-4, in the visitor's own terms. "Fill in
// your rate" over a filled-in form names the wrong problem, so each branch names
// the figure that is actually missing on the path they are walking.
function nothingToEnterNote(s, r) {
  const premium = premiumOf(s);
  // The phase-out only explains the $0 if an amount was actually entered for it
  // to phase out. Named per PATH, never "both deductions" to somebody who only
  // told us about tips: the engine phases the overtime side out at the same
  // income whether or not the visitor works any.
  const tipsGone = s.paid !== 'overtime' && s.tips > 0 && r.tips.fullyPhasedOut;
  const otGone = s.paid !== 'tips' && premium > 0 && r.overtime.fullyPhasedOut;
  if (tipsGone || otGone) {
    const which = tipsGone && otGone
      ? 'both deductions are'
      : (tipsGone ? 'the tips deduction is' : 'the overtime deduction is');
    return `Your income is high enough that ${which} fully phased out, so there is nothing to add to your W-4 this year.`;
  }
  const want = [];
  if (s.paid !== 'overtime' && s.tips <= 0) want.push('the tips you expect this year');
  if (s.paid !== 'tips' && premium <= 0) {
    if (s.rate <= 0 && s.hours <= 0) want.push('your hourly rate and your overtime hours');
    else if (s.rate <= 0) want.push('your hourly rate');
    else want.push('your overtime hours');
  }
  if (want.length) {
    const words = want.length === 1 ? want[0] : want.join(' and ');
    return `Enter ${words} to see what to put on your W-4.`;
  }
  return 'With these numbers there is nothing to add to your W-4 this year.';
}

function renderResult({ state: s, result: r }) {
  const premium = premiumOf(s);
  const warning = incomeWarning(s);
  const warnBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  const showTips = s.paid !== 'overtime';
  const showOt = s.paid !== 'tips';

  // ROUNDED ONCE. The labels invite the reader to add line 1a and line 1b up to
  // the line-15 total, so they have to add up: two independent Math.round()s and
  // a third on the sum do not ($6,000.40 + $3,000.40 renders 6,000 + 3,000 =
  // 9,001). The total is therefore DERIVED from the two already-rounded figures
  // rather than rounded on its own.
  const tipsR = Math.round(r.dTips);
  const otR = Math.round(r.dOt);
  const totalR = tipsR + otR;

  // The headline is a PER-PAYCHECK figure, because that is the promise this page
  // makes and the one number the other two OBBBA calculators cannot give. Cents
  // are kept: a $20.77 raise quoted as "$21" is a number nobody will find on
  // their stub. Mid-year, the headline is the LARGER remaining-checks figure,
  // because that is what the visitor will actually see this year.
  const gains = r.annualReduction > 0;
  const perCheck = r.fullYear ? r.perPaycheck : r.perPaycheckRemaining;
  const kick = r.fullYear
    ? 'In every paycheck, once your employer has the new W-4'
    : `In each of your ${r.remainingPeriods} remaining paychecks this year`;
  const head =
    `<p class="otw-kick">${kick}</p>` +
    `<p class="otw-big${gains ? '' : ' otw-zero'}">${usdRate(perCheck)}</p>`;

  // ---- The story ------------------------------------------------------------
  // The first rows are the two worksheet lines and their total: the numbers the
  // visitor physically writes on the form. The last two are what that total
  // DOES, so they carry .otw-after — a heavier rule that stops a reader adding
  // them into the sum above.
  let lead = '';
  let rows = '';
  if (totalR > 0) {
    const figures = [];
    if (showTips && s.tips > 0) figures.push(`${usd(s.tips)} in tips`);
    if (showOt && premium > 0) figures.push(`${usd(premium)} of overtime premium`);
    if (figures.length) {
      // One figure or two: an overtime-only visitor must not be told what their
      // premium "do" on their W-4.
      const verb = figures.length > 1 ? 'do' : 'does';
      lead = `<p class="otw-lead">Here is what your ${figures.join(' and ')} ${verb} on your 2026 W-4:</p>`;
    }
    const split = r.fullYear
      ? `Split across your ${r.periodsPerYear} paychecks a year`
      : `Split across the ${r.remainingPeriods} paychecks you have left this year`;
    rows =
      `<ul class="otw-story">` +
      (showTips ? `<li><span>Line 1a — the tips you expect</span><span class="otw-amt otw-free">${usd(tipsR)}</span></li>` : '') +
      (showOt ? `<li><span>Line 1b — the extra "half" your overtime pays</span><span class="otw-amt otw-free">${usd(otR)}</span></li>` : '') +
      `<li><span>Line 15 total — copy this figure to Step 4(b) on the form</span><span class="otw-amt otw-free">${usd(totalR)}</span></li>` +
      `<li class="otw-after"><span>Federal tax your employer stops holding back, over the year</span>` +
        `<span class="otw-amt${gains ? ' otw-free' : ''}">${usd(r.annualReduction)}</span></li>` +
      `<li class="otw-after"><span>${split}</span>` +
        `<span class="otw-amt${gains ? ' otw-free' : ''}">${usdRate(perCheck)}</span></li>` +
      `</ul>`;
  }

  // ---- The limits, each named with BOTH numbers ------------------------------
  // The moment a cap or the phase-out binds, "your tips" and "the amount that
  // goes on line 1a" stop being the same number, and a sentence naming only one
  // of them is how a screen ends up reading "$25,000, the tips you expect" over
  // $31,000 of tips. Each sentence here names both. Asked of the DEDUCTION
  // (eligible above the allowed cap), never of "did any tax come back": a figure
  // can be capped all the way to nothing and still show a $0 headline over a row
  // claiming the whole amount was untaxed.
  let capFlags = '';
  const tipsBinds = showTips && s.tips > 0 && s.tips > r.tips.allowedCap;
  const otBinds = showOt && premium > 0 && premium > r.overtime.allowedCap;
  if (tipsBinds && !r.tips.fullyPhasedOut) {
    capFlags += `<p class="otw-flag">Heads up: ${usd(tipsR)} of your ${usd(s.tips)} in tips goes on line 1a. ` +
      (r.tips.phasedOut
        ? `Your income is above the phase-out line, so your tips cap drops to ${usd(r.tips.allowedCap)}`
        : `The tips deduction stops at ${usd(r.tips.statutoryCap)} a year, and it is one limit per return, never doubled for a couple`) +
      `, and your employer keeps withholding on the rest as usual.</p>`;
  }
  if (otBinds && !r.overtime.fullyPhasedOut) {
    capFlags += `<p class="otw-flag">Heads up: ${usd(otR)} of your ${usd(premium)} overtime premium goes on line 1b. ` +
      (r.overtime.phasedOut
        ? `Your income is above the phase-out line, so your overtime cap drops to ${usd(r.overtime.allowedCap)}`
        : `The overtime deduction stops at ${usd(r.overtime.statutoryCap)} a year for how you file`) +
      `, and your employer keeps withholding on the rest as usual.</p>`;
  }

  // The one thing this tool knows that the W-4 itself gets wrong, kept verbatim
  // in substance from the old result panel: the printed worksheet uses a simple
  // income cutoff and would tell a partly-phased-out worker to enter $0, when
  // the real deduction phases out gradually and is still worth something.
  const cliffFlag = (r.anyPhasedOut && totalR > 0)
    ? `<p class="otw-flag">Your income is above the $150,000 ($300,000 filing jointly) line, so these deductions are ` +
      `partly phased out. The printed worksheet uses a simple cutoff that would wrongly tell you to enter $0 — put the ` +
      `${usd(totalR)} figure above straight on Step 4(b) instead. The worksheet is yours to keep; your employer only ` +
      `sees the Step 4(b) number.</p>`
    : '';

  // ---- The plain-terms box ---------------------------------------------------
  // NOT the filing-time FICA paragraph the sibling calculators use, because on
  // this page the paycheck changing is the whole point. What a reader can still
  // get wrong here is thinking they have been given a NEW tax cut, or that this
  // is something they are obliged to do.
  let plain;
  if (totalR <= 0) {
    plain = nothingToEnterNote(s, r);
  } else if (!gains) {
    plain = `Your pay is low enough that your employer is already withholding no federal income tax, so there is ` +
      `nothing here for the W-4 to give back. The ${usd(totalR)} is still the right figure for Step 4(b), and putting ` +
      `it there cannot shrink your paycheck — it just has nothing to reduce.`;
  } else {
    plain = `This is not a new tax break, it is the same one arriving earlier: ${usd(totalR)} on Step 4(b) tells your ` +
      `employer to hold back about ${usd(r.annualReduction)} less federal income tax over the year, so it reaches you ` +
      `as ${usdRate(perCheck)} more per paycheck instead of as a refund next spring. Your tax bill for the year does ` +
      `not change, Social Security and Medicare still come out of every tip and overtime dollar, and doing nothing is ` +
      `fine too — you just wait for the refund.`;
  }

  return warnBox + head + lead + rows + capFlags + cliffFlag + `<div class="otw-plain">${plain}</div>`;
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'w4Wizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: PAID, radios: 'paid' },
    // Each amount card leaves the path when the first card says that kind of pay
    // is not theirs. The engine is fed zero for it as well (see read()); leaving
    // the path is what stops it being ASKED, zeroing is what stops it being
    // COUNTED, and only doing the first would quote our example tips back to an
    // overtime-only visitor.
    { step: TIPS, fields: ['tips'], when: (s) => s.paid !== 'overtime' },
    // #otpremium lives in the collapsed escape on THIS card, so it is declared
    // here: that is what wires its input events, its Start-over restore and its
    // answer chip.
    { step: OTRATE, fields: ['otrate', 'otpremium'], when: (s) => s.paid !== 'tips' },
    { step: OTHOURS, fields: ['othours'], when: (s) => s.paid !== 'tips' && s.typedPremium <= 0 },
    {
      step: INCOME,
      fields: ['income'],
      // On the income card rather than the amount cards: income is the second of
      // the two numbers, so it is the one being typed when the contradiction
      // first exists.
      flags: [{ id: 'otwIncomeFlag', text: incomeWarning }]
    },
    { step: FILING, radios: 'filing' },
    // #months lives in the collapsed escape on the pay-frequency card, which is
    // the card that already asks how the year is cut into paychecks. Blank or 12
    // both mean a full year, so a visitor who never opens it is unaffected.
    { step: FREQ, radios: 'freq', fields: ['months'] },
    { step: RESULT, result: true }
  ],

  // The page loads with numbers nobody typed, so the answer stays labelled an
  // example until every figure it is built from is the visitor's own. Which
  // figures those are depends on the path: a tips-only visitor is never waiting
  // on an hourly rate, and a visitor who typed a premium is not waiting on rate
  // or hours either. Filing status, pay frequency and "which of these do you
  // get" are not listed: each has a real default and none invents a figure.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (s.paid !== 'overtime' && !touched.has('tips')) missing.push('your tips');
    if (s.paid !== 'tips') {
      if (s.typedPremium > 0) {
        if (!touched.has('otpremium')) missing.push('your overtime premium');
      } else {
        if (!touched.has('otrate')) missing.push('your hourly rate');
        if (!touched.has('othours')) missing.push('your overtime hours');
      }
    }
    if (!touched.has('income')) missing.push('your pay for the year');
    return missing;
  },

  // The premium chip and the months chip both name a field inside a collapsed
  // <details>, so they carry `field`: the core opens the helper and lands in the
  // box itself rather than in the question in front of it.
  chips: (s, r) => {
    const items = [{ step: PAID, label: PAID_WORDS[s.paid] || s.paid }];
    if (s.paid !== 'overtime') items.push({ step: TIPS, label: `${usd(s.tips)} in tips` });
    if (s.paid !== 'tips') {
      if (s.typedPremium > 0) {
        items.push({ step: OTRATE, label: `${usd(s.typedPremium)} premium`, field: 'otpremium' });
      } else {
        items.push({ step: OTRATE, label: `${usdRate(s.rate)}/hr normal` });
        items.push({ step: OTHOURS, label: `${count(s.hours)} OT hours` });
      }
    }
    items.push({ step: INCOME, label: `${usd(s.income)}/yr` });
    items.push({ step: FILING, label: FILING_WORDS[s.filing] || s.filing });
    items.push({ step: FREQ, label: FREQ_WORDS[s.freq] || s.freq });
    if (!r.fullYear) items.push({ step: FREQ, label: `${count(s.months)} months left`, field: 'months' });
    return items;
  },

  announce: (s, r) => {
    const perCheck = r.fullYear ? r.perPaycheck : r.perPaycheckRemaining;
    const where = r.fullYear ? 'every paycheck' : `each of your ${r.remainingPeriods} remaining paychecks`;
    const total = Math.round(r.dTips) + Math.round(r.dOt);
    if (total <= 0) return 'Nothing to add to your W-4 with these numbers.';
    return `Put ${usd(total)} on your W-4 Step 4(b). That is about ${usdRate(perCheck)} more in ${where}.` +
      (incomeWarning(s) ? ' Check your numbers, there is a warning above the answer.' : '');
  }
});
