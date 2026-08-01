// pmi-deduction-wizard.js — the card-by-card flow on /pmi-deduction-calculator/.
// Estimates the OBBBA-revived mortgage insurance premium deduction
// (IRC §163(h)(3)(E), permanently un-terminated by OBBBA §70108): the qualifying
// premium, the AGI phaseout that ends it above $109,000 ($54,500 MFS), the
// pre-2007-contract gate, the itemize-vs-standard verdict, and the federal tax
// it saves. All logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// #mipForm and is still served by pmi-deduction-calculator.js; the two must stay
// independent, so nothing here reads or writes an id except through its own
// page's DOM, and the two forms deliberately carry different ids.
//
// A CONVERSION ONTO wizard-core.js. Everything about "how a card flow behaves" —
// stepping, dots, focus, the 350 ms flag debounce, the polite status line, the
// example label, Start over, data-js last — lives in the core. What is left here
// is only what makes this the mortgage insurance calculator: seven questions of
// which two are conditional, one call into the shared OBBBA engine, and the
// answer written out as a story.
//
// THE MATH is one engine call. mipComparison() builds the qualifying premium
// (recurring + a VA/USDA fee in full + the 2026 slice of an amortized lump sum),
// applies the percentage-of-premium AGI haircut, compares itemizing against the
// standard deduction, and returns the federal tax saved as an exact bracket
// difference rather than a flat marginal-rate guess.
import { mipComparison } from '/assets/obbba-deduction.js';
import { mountWizard, $, moneyOf, radioOf, usd, usdRate } from '/assets/wizard-core.js';

const OBBBA = window.__OBBBA__;
const FED = window.__FED__;

// data-step on each card. RESULT is the last card and is never skipped.
const PREMIUM = 0, UPFRONT = 1, TYPE = 2, SPREAD = 3, FILING = 4, AGI = 5, OTHER = 6, RESULT = 7;

// §163(h)(4)(F): a VA funding fee or an RHS/USDA guarantee fee is deductible in
// full in the year paid, so neither the closing month nor the loan term changes
// anything for them. Mirrors MIP_VA_USDA_TYPES in the engine; kept here as the
// PATH predicate only, never as a second copy of the arithmetic.
const VA_USDA = new Set(['va', 'usda']);

const TYPE_WORDS = {
  monthly_pmi: 'ordinary loan (PMI)',
  fha: 'FHA loan',
  va: 'VA loan',
  usda: 'USDA loan'
};
const FILING_WORDS = {
  single: 'single',
  married: 'married, filing together',
  married_separate: 'married, filing separately',
  head_of_household: 'head of household'
};
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ---- Reading the cards ------------------------------------------------------
// Null-guarded the way the core's own readers are: a missing element must
// degrade to the value the page ships with, never throw, because a throw after
// boot is not caught by anything.
const intOf = (id, fallback) => {
  const el = $(id);
  const v = el ? parseInt(el.value, 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const checkedOf = (id, fallback) => {
  const el = $(id);
  return el ? el.checked : fallback;
};

function read() {
  return {
    recurring: moneyOf('recurring'),
    upfront: moneyOf('upfront'),
    miType: radioOf('miType', 'monthly_pmi'),
    closingMonth: intOf('closingMonth', 6),
    termMonths: intOf('termMonths', 360),
    filing: radioOf('filing', 'single'),
    agi: moneyOf('agi'),
    other: moneyOf('other'),
    contract2007: checkedOf('contract2007', true)
  };
}

const compute = (s) => mipComparison({
  filingStatus: s.filing,
  agi: s.agi,
  mortgageInsuranceType: s.miType,
  recurringPremiums: s.recurring,
  upfrontPremium: s.upfront,
  closingMonth: s.closingMonth,
  termMonths: s.termMonths,
  contractIssuedAfter2006: s.contract2007,
  otherItemized: s.other,
  params: OBBBA.mip,
  fed: FED
});

// The income at which the deduction is gone entirely, DERIVED rather than typed
// as a literal: the haircut is 10% per step and a step is any part of $1,000
// ($500 MFS) over the threshold, so the tenth and last step lands the moment AGI
// passes threshold + 9 steps. $109,000 single/joint/HoH, $54,500 MFS — which is
// this page's whole headline, and hardcoding it here would let the two drift.
const cliffOf = (r) => r.threshold + 9 * r.stepSize;

// ---- The one cross-check these answers allow --------------------------------
// Mortgage insurance is a charge on a home loan and the AGI card asks for the
// whole year's income, so premiums larger than the income are not a big number,
// they are an impossible one — almost always a lump sum typed into the monthly
// box or an income typed in thousands. Never blocking: the answer still computes
// underneath, the doubt just travels with it, and it travels to BOTH places, the
// card that asks for the second of the two numbers and the answer, because a
// visitor who reaches the answer by pressing Next may never come back.
function premiumWarning(s) {
  const paid = s.recurring + s.upfront;
  if (paid <= 0 || s.agi <= 0) return '';
  if (paid > s.agi) {
    return `Check these numbers: the ${usd(paid)} you entered as mortgage insurance is more than the ${usd(s.agi)} ` +
      `you entered as your income for the whole year. One of the two needs another look.`;
  }
  if (paid > s.agi / 3) {
    return `Check these numbers: the ${usd(paid)} you entered as mortgage insurance is more than a third of the ` +
      `${usd(s.agi)} you entered as your income for the whole year. That is an unusual pair, so one of the two is ` +
      `worth another look.`;
  }
  return '';
}

// ---- The answer -------------------------------------------------------------
// Why the headline is $0, in the visitor's own numbers. Ordered by which rule
// bites FIRST, because more than one can be true at once and only the first one
// is the reason: a pre-2007 policy zeroes the premium before the phaseout is
// even reached, so "fill in your premiums" over a filled-in form would name the
// wrong problem.
function zeroReason(s, r) {
  if (!s.contract2007) {
    return `Your policy started before 2007, and only mortgage insurance taken out after December 31, 2006 counts. ` +
      `That rule was never repealed, so this is $0 whatever your income and whatever you paid.`;
  }
  if (r.qualifyingPremium <= 0) {
    return 'Fill in what you paid for mortgage insurance in 2026 to see what it saves you.';
  }
  if (r.fullyPhasedOut) {
    return `Your ${usd(s.agi)} income is above ${usd(cliffOf(r))}, the point where this deduction disappears ` +
      `completely, so none of your ${usd(r.qualifyingPremium)} of mortgage insurance can be deducted.`;
  }
  if (!r.itemize) {
    return `Your ${usd(r.deduction)} of mortgage insurance qualifies, but it saves you nothing this year. Your ` +
      `write-offs come to ${usd(r.itemizedTotal)} all together and the flat standard deduction you can take ` +
      `instead is ${usd(r.standardDeduction)}, so you would take the flat amount. You would need ` +
      `${usd(r.needMoreToItemize)} more in write-offs before any of this is worth something.`;
  }
  return 'With these numbers your mortgage insurance produces no extra federal tax saving.';
}

// Where the qualifying premium came from, in sentences rather than a second set
// of rows: the story list below already invites the reader to add its rows up to
// its own top row, and a second sum in the same panel is how a reader ends up
// adding a build-up into a split. Kept in usdRate (cents) because the whole
// point of this panel is that the 84-month split does not land on round dollars.
function buildupFold(r) {
  if (r.upfront <= 0 || r.qualifyingPremium <= 0) return '';
  const paidMonthly = r.recurring > 0
    ? `You paid ${usdRate(r.recurring)} month by month during 2026, plus `
    : 'You paid ';
  const body = r.exemptFromAmortization
    ? `${paidMonthly}${usd(r.vaUsdaUpfront)} in one go at closing. A VA funding fee and a USDA guarantee fee are ` +
      `treated better than an FHA upfront premium: they count in full in the year you pay them, with no spreading ` +
      `at all. Together that is ${usdRate(r.qualifyingPremium)} for 2026.`
    : `${paidMonthly}${usd(r.upfront)} in one go at closing. That lump sum is not deducted all at once. It is split ` +
      `evenly over ${r.amortization.amortMonths} months, the shorter of your loan term and the 84 months the law ` +
      `allows, which is ${usdRate(r.amortization.monthlySlice)} a month. ${r.amortization.monthsIn2026} of those ` +
      `months fall in 2026, so ${usdRate(r.prepaidSlice)} of it counts on this year's return and the rest carries ` +
      `into later years. If you refinance or pay the loan off before the spreading ends, whatever is left is lost. ` +
      `Together that is ${usdRate(r.qualifyingPremium)} for 2026.`;
  return `<details class="otw-help" id="pmiSplit"><summary>Where that ${usd(r.qualifyingPremium)} comes from</summary>` +
    `<p>${body}</p></details>`;
}

function renderResult({ state: s, result: r }) {
  const warning = premiumWarning(s);
  const warnBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  const benefits = r.taxSaved > 0;
  const head =
    `<p class="otw-kick">When you file your 2026 taxes</p>` +
    `<p class="otw-big${benefits ? '' : ' otw-zero'}">${usd(r.taxSaved)}</p>`;

  // ---- The story ------------------------------------------------------------
  // ROUNDED ONCE. The labels invite the reader to add the two lower rows up to
  // the top one, so they have to add up: the "lost to the income limit" row is
  // DERIVED by subtraction from the two rounded figures above it rather than
  // rounded on its own, which is the only way $2,110.42 = $1,899.38 + $211.04
  // cannot print as $2,110 = $1,899 + $211.
  let lead = '';
  let rows = '';
  if (r.qualifyingPremium > 0) {
    const premR = Math.round(r.qualifyingPremium);
    const dedR = Math.round(r.deduction);
    const lostR = premR - dedR;
    const benefitR = Math.round(r.deductionBenefit);
    // Whether this amount ever reaches a tax return at all. Asked of the
    // ITEMIZE verdict, not of the phaseout: a premium can survive the income
    // limit in full and still be worth nothing, because someone who takes the
    // flat standard deduction never puts a Schedule A in the envelope. Colouring
    // this row as money-the-government-skips-tax-on regardless left a $0 headline
    // sitting over a green row claiming the whole premium came off the income.
    const onScheduleA = r.itemize && dedR > 0;
    lead = `<p class="otw-lead">Here is what happens to the ${usd(premR)} of mortgage insurance that counts for 2026:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>Mortgage insurance that counts for 2026</span><span class="otw-amt">${usd(premR)}</span></li>` +
      `<li><span>Allowed after the income limit${onScheduleA ? ' — this goes on your Schedule A' : ''}</span>` +
        `<span class="otw-amt${onScheduleA ? ' otw-free' : ''}">${usd(dedR)}</span></li>` +
      (lostR > 0
        ? `<li><span>The rest, lost to the income limit</span><span class="otw-amt otw-taxed">${usd(lostR)}</span></li>`
        : '') +
      // Not part of the split above, so both of these carry the heavier rule that
      // stops a reader adding them in. The first is the deduction restated after
      // the flat standard deduction has taken its share, the second is what
      // skipping tax on it is actually worth.
      (dedR > 0 && benefitR !== dedR
        ? `<li class="otw-after"><span>What it really adds on top of the ${usd(r.standardDeduction)} flat standard deduction</span>` +
          `<span class="otw-amt${benefitR > 0 ? ' otw-free' : ''}">${usd(benefitR)}</span></li>`
        : '') +
      `<li class="otw-after"><span>Federal tax you don't pay because of it</span>` +
        `<span class="otw-amt${benefits ? ' otw-free' : ''}">${usd(r.taxSaved)}</span></li>` +
      `</ul>`;
  }

  // ---- The limits, each named with BOTH numbers ------------------------------
  // The premium you paid and the amount you can deduct stop being the same
  // number the moment either limit bites, and a sentence naming only one of them
  // is how a screen ends up reading "$1,899, the mortgage insurance you paid"
  // over $2,110 of premiums. Both limits are decided from the DEDUCTION, never
  // from "did any tax come back": a premium can be cut all the way to nothing and
  // still show a $0 headline over a row claiming the whole amount was allowed.
  // The fully-phased-out case is left to the plain box below, which explains the
  // $0 rather than announcing a haircut that took everything.
  let flags = '';
  if (r.qualifyingPremium > 0 && r.phasedOut && !r.fullyPhasedOut) {
    flags += `<p class="otw-flag">Heads up: ${usd(r.deduction)} of your ${usd(r.qualifyingPremium)} in mortgage ` +
      `insurance is deductible. Your ${usd(s.agi)} income is ${usd(r.excess)} over the ${usd(r.threshold)} line where ` +
      `this deduction starts shrinking, and it loses a tenth of itself for every ${usd(r.stepSize)} over that line, ` +
      `so ${r.steps * 10}% of it is gone. It disappears completely above ${usd(cliffOf(r))}.</p>`;
  }
  if (r.itemize && r.deduction > 0 && Math.round(r.deductionBenefit) < Math.round(r.deduction)) {
    flags += `<p class="otw-flag">Heads up: your ${usd(r.deduction)} of mortgage insurance only adds ` +
      `${usd(r.deductionBenefit)} to what you can actually write off. Your other write-offs come to ` +
      `${usd(r.otherItemized)}, just under the ${usd(r.standardDeduction)} flat amount you could have taken ` +
      `instead, so part of your mortgage insurance is spent getting you past that line rather than saving you tax.</p>`;
  }

  // The three sentences a reader of a filing-time deduction needs and rarely
  // gets: when the money arrives, that this is income tax only, and that the
  // paycheck during the year does not change. They ride beside the good news
  // rather than behind a tap. The Social Security and Medicare sentence is worded
  // for what this tool actually is — mortgage insurance is an expense, not income,
  // so "FICA is still owed on it" would be nonsense; what IS true, and is the same
  // warning, is that this deduction does not touch either of them.
  // The saving is deliberately NOT quoted as "writing off $X gives you $Y" here.
  // Where the flat standard deduction eats part of the premium those two are not
  // the same story: $1,800 of deduction that only adds $700 of write-off saves
  // $154, and a reader who multiplies $1,800 by their rate gets $396 and thinks
  // the tool is wrong. The rows and the flag above already name both figures.
  const plain = benefits
    ? `<div class="otw-plain">This puts about ${usd(r.taxSaved)} back in your pocket, as a bigger refund (or a ` +
      `smaller bill) when you file your 2026 return. It lowers your federal income tax only: the Social Security ` +
      `and Medicare taken out of your pay are untouched by it, and your paycheck during the year does not change.</div>`
    : `<div class="otw-plain">${zeroReason(s, r)}</div>`;

  return warnBox + head + lead + rows + buildupFold(r) + flags + plain;
}

// ---- The flow ---------------------------------------------------------------
// The pre-2007 checkbox is the one control the core's Start over cannot restore
// on its own: it snapshots input.value, and a checkbox carries its answer in
// .checked. Snapshotted here from what the page shipped rather than hardcoded to
// true, so the template stays the single source of that default.
let contractShipped = true;

mountWizard({
  stage: 'pmiWizard',
  read,
  compute,
  renderResult,

  cards: [
    // contract2007 rides on this card rather than one of its own: it lives in a
    // collapsed .otw-esc escape because almost every policy still running started
    // after 2006, so it is a rare correction, not a question worth asking
    // everybody. Listing it in fields is what binds its change listener.
    { step: PREMIUM, fields: ['recurring', 'contract2007'] },
    { step: UPFRONT, fields: ['upfront'] },
    // Both conditional on there being a lump sum at all. With no lump sum the
    // engine never reads the loan type (mipQualifyingPremium branches on it only
    // inside `if (upfront > 0)`), so asking would be asking for nothing; and a
    // VA/USDA fee is deductible in full in the year paid, so the month and the
    // term change nothing for it either. Someone paying month by month answers
    // five questions, not seven.
    { step: TYPE, radios: 'miType', when: (s) => s.upfront > 0 },
    {
      step: SPREAD,
      fields: ['closingMonth', 'termMonths'],
      when: (s) => s.upfront > 0 && !VA_USDA.has(s.miType)
    },
    { step: FILING, radios: 'filing' },
    {
      step: AGI,
      fields: ['agi'],
      // On the income card rather than the premium card: it is the second of the
      // two numbers, so it is the one being typed when the contradiction can
      // first exist.
      flags: [{ id: 'otwAgiFlag', text: premiumWarning }]
    },
    // Skip means "I have no other write-offs", and it has to ZERO the box rather
    // than leave it: the field ships prefilled at 20,000, and skipping past our
    // invented figure would answer the question that decides the whole result
    // with a number the visitor never gave. Skip also jumps to the answer, which
    // is why it is on the last question card and nowhere earlier.
    { step: OTHER, fields: ['other'], skipClears: ['other'] },
    { step: RESULT, result: true }
  ],

  // The page loads with numbers nobody typed, so the answer stays labelled an
  // example until every figure it is built from is the visitor's own. Clearing it
  // on the first edit to any one field presented an answer still made of our
  // invented numbers as theirs, and $1,800 of premiums against $95,000 of income
  // is ordinary enough to be somebody's real year. Other write-offs are listed
  // because that box ships at 20,000 and it is the single figure that decides
  // whether the answer is a number or a zero. Filing status, loan type and the
  // pre-2007 tick each have a real default that is true for most visitors and
  // none of them invents a figure. The closing month is ours, but only once a
  // lump sum makes it matter.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('recurring')) missing.push('your mortgage insurance');
    if (!touched.has('agi')) missing.push('your income');
    if (!touched.has('other')) missing.push('your other write-offs');
    if (s.upfront > 0 && !VA_USDA.has(s.miType) && !touched.has('closingMonth')) {
      missing.push('the month you closed');
    }
    return missing;
  },

  // Only the cards this visitor actually walked: a chip for the loan type on a
  // flow with no lump sum points at a card that is not on the path, and tapping
  // it would hand the visitor forward to a different question than the one the
  // chip named.
  chips: (s) => {
    const list = [];
    if (!s.contract2007) {
      list.push({ step: PREMIUM, field: 'contract2007', label: 'policy from before 2007' });
    }
    list.push({ step: PREMIUM, label: `${usd(s.recurring)} in premiums` });
    list.push({ step: UPFRONT, label: s.upfront > 0 ? `${usd(s.upfront)} at closing` : 'nothing at closing' });
    if (s.upfront > 0) list.push({ step: TYPE, label: TYPE_WORDS[s.miType] || s.miType });
    if (s.upfront > 0 && !VA_USDA.has(s.miType)) {
      list.push({ step: SPREAD, label: `closed in ${MONTHS[s.closingMonth] || '?'}` });
    }
    list.push({ step: FILING, label: FILING_WORDS[s.filing] || s.filing });
    list.push({ step: AGI, label: `${usd(s.agi)}/yr` });
    list.push({ step: OTHER, label: s.other > 0 ? `${usd(s.other)} in other write-offs` : 'no other write-offs' });
    return list;
  },

  announce: (s, r) => {
    // The pre-2007 gate is the one $0 whose reason is not audible from the
    // figures: every number on the card is zero and nothing says why, so it is
    // spoken outright rather than left to the panel a screen-reader user has
    // just been told the total of.
    const gateSpoken = !s.contract2007 ? ' Your policy started before 2007, so none of it qualifies.' : '';
    const limitSpoken = r.qualifyingPremium > 0 && r.deduction < r.qualifyingPremium
      ? ` Your ${usd(r.qualifyingPremium)} of mortgage insurance is cut to ${usd(r.deduction)} by the income limit.`
      : '';
    const itemiseSpoken = !r.itemize && r.deduction > 0
      ? ` The ${usd(r.standardDeduction)} standard deduction beats your ${usd(r.itemizedTotal)} of write-offs, so it saves nothing this year.`
      : '';
    return `Federal tax saved by your mortgage insurance deduction: ${usd(r.taxSaved)}.${gateSpoken}${limitSpoken}${itemiseSpoken}` +
      (premiumWarning(s) ? ' Check your numbers, there is a warning above the answer.' : '');
  },

  onBeforeSnapshot: () => {
    const el = $('contract2007');
    contractShipped = el ? el.checked : true;
  },
  onReset: () => {
    const el = $('contract2007');
    if (el) el.checked = contractShipped;
  }
});
