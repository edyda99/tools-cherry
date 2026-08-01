// car-loan-interest-wizard.js — the card-by-card flow on
// /car-loan-interest-calculator/.
//
// Estimates the OBBBA car-loan interest deduction (IRC §163(h)(4), added by
// §70203): up to $10,000 of interest a year on a new, US-assembled,
// personal-use vehicle loan for tax years 2025–2028, with the
// $100,000/$200,000 MAGI phase-out ($200 per $1,000 over, applied after the
// $10,000 cap) and the federal tax it saves. All logic client-side; nothing
// uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its
// single-column form and its #carForm id and is still served by
// car-loan-interest-calculator.js; the two must stay independent, so nothing
// here reads or writes an id the embed also ships except through its own page's
// DOM.
//
// A CONVERSION ONTO wizard-core.js. Everything about "how a card flow behaves"
// — stepping, dots, focus, the 350 ms flag debounce, the polite status line, the
// example label, Start over, data-js last — lives in the core. What is left here
// is only what makes this the car-loan calculator: six questions, two calls into
// the shared OBBBA engine, and the answer written out as a story.
//
// THE MATH is two engine calls, both unchanged. carLoanFirstYearInterest()
// amortizes the loan and returns the interest inside the first twelve payments
// (interest is front-loaded, so year one is the biggest deduction there will
// ever be). estimateCarLoan() then caps that at the statutory $10,000, applies
// the phase-out to the CAPPED figure in the order the statute writes it, and
// returns the exact federal tax saved as (tax without the deduction) − (tax with
// it), so it is right across a bracket boundary rather than a flat
// marginal-rate guess.
//
// THE BRANCH. The four eligibility conditions are what actually decide this
// deduction: fail any one and the answer is $0 whatever the rate, the term, the
// income and the filing status say. So the gate card sits second, and when a box
// is unchecked the four later cards leave the path on that keystroke and the
// flow runs loan → gate → answer. The answer then shows NO story rows at all,
// because every figure they would quote would be one of ours that the visitor
// was never shown — just the $0 and the condition that failed, by name.
import { carLoanFirstYearInterest, estimateCarLoan } from '/assets/obbba-deduction.js';
import { mountWizard, $, moneyOf, numOf, radioOf, selectOf, usd, count } from '/assets/wizard-core.js';

const OBBBA = window.__OBBBA__;
const FED = window.__FED__;
const CAR = (OBBBA && OBBBA.carLoan) || {};

// data-step on each card. RESULT is the last card and is never skipped.
const AMOUNT = 0, ELIG = 1, APR = 2, TERM = 3, MAGI = 4, FILING = 5, RESULT = 6;

const FILING_WORDS = {
  single: 'single',
  married: 'married, filing together',
  married_separate: 'married, filing separately',
  head_of_household: 'head of household'
};

// The four boxes, each with the plain reason unchecking it kills the deduction.
// Written as the second half of "No deduction on this loan: …", so each one
// starts with what the visitor just told us rather than with the statute.
const ELIG_BOXES = [
  ['e-new', 'you said the car is not new. A used car, or buying your leased car at the end of the lease, does not qualify — the law needs a car whose first owner is you.'],
  ['e-usa', 'you said the car was not put together in the United States. Final assembly has to be in the US; where the brand comes from makes no difference.'],
  ['e-origin', 'you said the loan was not taken out in 2025 or later. Only a loan signed after December 31, 2024, secured by the car itself, qualifies — a 2024 loan you are still paying interest on does not.'],
  ['e-personal', 'you said the car is not for your own use, or that it is a lease. Business and commercial vehicles are excluded, and so is every kind of lease.']
];

// Null-guarded like the core's own readers: a missing box degrades to its
// shipped state (checked) rather than throwing and taking the calculator down.
const checkedOf = (id) => { const el = $(id); return el ? el.checked : true; };

// The raw text of a field, so an EMPTY rate can be told apart from a typed 0.
// numOf() answers 0 to both, and they are opposite problems: an empty box needs
// "fill this in", a typed 0 is a real 0% finance deal with a real (and good)
// reason for a $0 answer. Naming the wrong one of those is exactly the failure
// the zero case is supposed to avoid.
const rawOf = (id) => { const el = $(id); return el && el.value != null ? String(el.value).trim() : ''; };

// ---- Reading the cards ------------------------------------------------------
function read() {
  const failed = ELIG_BOXES.filter(([id]) => !checkedOf(id));
  return {
    amount: moneyOf('amount'),
    apr: numOf('apr'),          // a percentage as typed: 6.5, not 0.065
    aprRaw: rawOf('apr'),
    term: numOf('term'),        // months
    termRaw: rawOf('term'),
    magi: moneyOf('magi'),
    filing: radioOf('filing', 'single'),
    year: Number(selectOf('year')) || CAR.firstYear || 2025,
    failed,
    eligible: failed.length === 0
  };
}

// The amortization, on its own so the payment-vs-income guard can quote the
// monthly payment without a second definition of how it is worked out. The core
// hands a flag's text() the state and nothing else, so the guard has to be able
// to reach this from the state alone.
const loanOf = (s) => carLoanFirstYearInterest({ amount: s.amount, apr: s.apr / 100, termMonths: s.term });

function compute(s) {
  const fyi = loanOf(s);
  const r = estimateCarLoan({
    year: s.year, filingStatus: s.filing, magi: s.magi,
    interest: fyi.firstYearInterest, eligible: s.eligible, federal: OBBBA, fed: FED
  });
  return Object.assign({}, r, { monthlyPayment: fyi.monthlyPayment, months: fyi.months });
}

// ---- Guards -----------------------------------------------------------------
// Never blocking: the answer still computes underneath every one of these, the
// doubt just travels with it. Each names both numbers, the likely cause, and
// what to do about it. They travel to BOTH places — the card that asks for the
// second of the two numbers, which is where the visitor is standing when the
// contradiction can first exist, and again above the answer, because a visitor
// who reaches the answer by pressing Next may never come back to the card.

// A rate is the one field on this page with no plausible zero-to-infinity range:
// car loans run a few percent to the high teens, so 65 is a typo for 6.5 and
// 0.065 is the decimal somebody meant to type as a percentage. Both render the
// same number the same way the field does.
function aprWarning(s) {
  if (s.apr <= 0) return '';
  if (s.apr > 30) {
    // The suggestion is only offered when moving the point one place actually
    // lands somewhere a car loan could be; 1,200% is a typo of something, but
    // not of 120%, and guessing at it would be worse than not guessing.
    const tenth = s.apr / 10;
    const guess = tenth >= 1 && tenth <= 30
      ? `If your rate is ${count(tenth)}%, type ${count(tenth)} rather than ${count(s.apr)}.`
      : `Type it the way your loan agreement writes it: 6.5 for six and a half percent.`;
    return `Check this number: ${count(s.apr)}% a year is far above what any car loan charges — ` +
      `new-car rates run from about 3% to 15%. ${guess}`;
  }
  if (s.apr < 0.5) {
    // Deliberately does not quote the number back. The field holds things like
    // 0.065, and every shared formatter rounds to two places, so quoting it
    // would print "0.07%" over a box reading 0.065 and argue with the visitor
    // about a number they can see.
    return `Check this number: a rate under half a percent is almost free money, and no car loan is. ` +
      `Type the rate as a percentage — 6.5 for six and a half percent, not 0.065.`;
  }
  return '';
}

// A loan with money borrowed and no length is the impossible pair: there is no
// schedule for it to charge interest on. The long-term half is a plausibility
// check rather than an impossibility, and says so ("did you mean years?").
function termWarning(s) {
  if (s.amount <= 0) return '';
  if (s.term <= 0) {
    return `Check these numbers: you entered ${usd(s.amount)} borrowed but no number of months to pay it back, ` +
      `and a loan has to run for some length of time before it charges any interest at all. Most car loans run 36 to 84 months.`;
  }
  if (s.term > 120) {
    return `Check this number: ${count(s.term)} months is more than ten years, longer than any ordinary car loan — ` +
      `they usually run 36 to 84 months. Did you mean ${count(s.term)} payments, or ${count(s.term)} years?`;
  }
  return '';
}

// The one true cross-check these answers allow: a year of payments cannot cost
// more than the whole year's income. The income card is the second of that pair,
// so this is where the contradiction first exists.
// The monthly figure is rounded ONCE and the yearly one is derived from it, for
// the same reason the story rows are: this sentence invites the reader to
// multiply, so $783 a month has to be the $9,396 a year it says, not the $9,392
// an independently rounded total would print.
function incomeWarning(s) {
  if (s.magi <= 0) return '';
  const monthly = Math.round(loanOf(s).monthlyPayment);
  const yearly = monthly * 12;
  if (yearly <= 0 || yearly <= s.magi) return '';
  return `Check these numbers: this loan works out at about ${usd(monthly)} a month, ${usd(yearly)} over a year, ` +
    `which is more than the ${usd(s.magi)} you entered as your income for the whole year. One of the two needs another look.`;
}

// Above the answer. Suppressed entirely when the visitor has told us the car
// does not qualify: those three cards are off the path, the figures behind them
// are still ours, and "check these numbers" over a $0 that has nothing to do
// with the numbers is noise pointed at the wrong thing.
function warningsFor(s) {
  if (!s.eligible) return [];
  return [aprWarning(s), termWarning(s), incomeWarning(s)].filter(Boolean);
}

// ---- The answer -------------------------------------------------------------
const limitWord = (r) => (r.phasedOut ? 'the income phase-out' : `the ${usd(r.statutoryCap)} yearly limit`);

// The zero case carries the REASON, and the right one: "fill in your loan" over
// a filled-in form names the wrong problem, and so does a cap note over a car
// that never qualified in the first place. Checked in the order the visitor
// would hit them.
function zeroNote(s, r) {
  if (!r.eligible) {
    const reasons = s.failed.map(([, why]) => why);
    if (reasons.length === 1) return `No deduction on this loan: ${reasons[0]}`;
    return `No deduction on this loan. All four conditions have to be true at once, and these are not:` +
      `<ul style="margin:6px 0 0 18px">${reasons.map((w) => `<li>${w}</li>`).join('')}</ul>`;
  }
  if (!r.inWindow) {
    return `This deduction only exists for the ${CAR.firstYear} to ${CAR.lastYear} tax years, so there is nothing to claim for ${s.year}.`;
  }
  if (s.amount <= 0 || s.term <= 0) {
    return `Fill in what you borrowed and how many months you have to pay it back, and we will work out the interest and what it saves you.`;
  }
  if (!s.aprRaw) {
    return `Fill in the interest rate from your loan agreement and we will work out what the deduction is worth to you.`;
  }
  if (s.apr <= 0) {
    return `A 0% loan charges no interest, so there is nothing here to deduct — and that is the better deal of the two. ` +
      `This deduction is only ever worth a share of interest you actually paid.`;
  }
  if (r.fullyPhasedOut) {
    return `Your ${usd(s.magi)} income is ${usd(r.excess)} over the ${usd(r.threshold)} line, which takes ${usd(r.reduction)} off the deduction. ` +
      `That is more than the ${usd(r.cappedInterest)} of interest you could otherwise have deducted, so nothing is left of it this year.`;
  }
  if (r.deduction > 0) {
    return `You have ${usd(r.deduction)} of deductible interest, but on ${usd(s.magi)} of income you already owe no federal income tax before it, ` +
      `so there is nothing left for the deduction to save.`;
  }
  return `With these numbers there is no federal tax to save this year.`;
}

function renderResult({ state: s, result: r }) {
  const warnBox = warningsFor(s).map((w) => `<div class="ot-input-warning">${w}</div>`).join('');

  const benefits = r.taxSaved > 0;
  const head =
    `<p class="otw-kick">When you file your ${s.year} tax return</p>` +
    `<p class="otw-big${benefits ? '' : ' otw-zero'}">${usd(r.taxSaved)}</p>`;

  // ---- The story ------------------------------------------------------------
  // ROUNDED ONCE. The labels invite the reader to add the lower rows up to the
  // top one, so they have to add up: the "still taxed" row is DERIVED by
  // subtraction from the two rounded figures above it rather than rounded on its
  // own, which is the only way $2,394.49 = $2,393.99 + $0.50 cannot print as
  // $2,394 = $2,394 + $1.
  //
  // Nothing is shown at all when the car does not qualify: the interest figure
  // is real, but the rate and the term it was built from are cards this visitor
  // never saw, so quoting it would present our example numbers as theirs.
  let lead = '';
  let rows = '';
  if (r.eligible && r.interest > 0) {
    const intR = Math.round(r.interest);
    const dedR = Math.round(r.deduction);
    const taxedR = intR - dedR;
    lead = `<p class="otw-lead">Here is what happens to the ${usd(intR)} of interest you pay in your loan's first year:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>The interest inside your first twelve payments</span><span class="otw-amt">${usd(intR)}</span></li>` +
      `<li><span>Taken off the income you are taxed on${dedR > 0 ? ' — the government skips tax on this' : ''}</span>` +
        `<span class="otw-amt${dedR > 0 ? ' otw-free' : ''}">${usd(dedR)}</span></li>` +
      (taxedR > 0
        ? `<li><span>The rest, above ${limitWord(r)} — taxed as usual</span><span class="otw-amt otw-taxed">${usd(taxedR)}</span></li>`
        : '') +
      // Not part of the split above, so it carries the heavier rule that stops a
      // reader adding it in: the first rows are the interest itself, this one is
      // what skipping tax on it is worth.
      `<li class="otw-after"><span>Federal tax you don't pay because of it</span>` +
        `<span class="otw-amt${benefits ? ' otw-free' : ''}">${usd(r.taxSaved)}</span></li>` +
      `</ul>`;
  }

  // ---- The limit, named with BOTH numbers ------------------------------------
  // The interest you paid and the amount you may deduct stop being the same
  // number the moment the $10,000 cap or the phase-out binds, and a sentence
  // naming only one of them is how a screen ends up reading "$10,000, the
  // interest you paid" over $12,400 of interest. Decided from the DEDUCTION, not
  // from "did any tax come back": interest can be capped and then phased all the
  // way down to nothing and still show a $0 headline over a row claiming the
  // whole amount came off the taxable income. Both limits can bind at once, and
  // when they do both are named. The fully-phased-out case is left to the plain
  // box below, which explains the $0 rather than announcing a cap that dropped
  // to nothing.
  let capFlag = '';
  const cutByCap = r.eligible && r.interest > r.statutoryCap;
  const cutByPhase = r.eligible && r.reduction > 0 && r.cappedInterest > 0;
  if (r.interest > 0 && (cutByCap || cutByPhase) && !r.fullyPhasedOut) {
    const why = [];
    if (cutByCap) {
      why.push(`this deduction stops at ${usd(r.statutoryCap)} of interest a year, and it is one limit per return, never doubled for a couple filing together`);
    }
    if (cutByPhase) {
      why.push(`your ${usd(s.magi)} income is ${usd(r.excess)} over the ${usd(r.threshold)} line, which takes $200 off for every $1,000 above it, ${usd(r.reduction)} in all`);
    }
    capFlag = `<p class="otw-flag">Heads up: ${usd(r.deduction)} of your ${usd(r.interest)} in first-year interest is deductible, because ` +
      `${why.join(', and ')}. The rest of your interest is taxed as usual.</p>`;
  }

  // The three sentences a reader needs and an "allowed deduction" table never
  // gave them: when the money arrives, that this is income tax only, and that
  // nothing about the loan itself changes. The last one is this tool's own
  // version of the FICA note — the belief to head off here is not "my tips are
  // tax-free", it is "my car payment goes down", which is what the old page's
  // one-line takeaway was written to stop and is why it rides beside the good
  // news rather than behind a tap.
  const payment = r.monthlyPayment > 0 ? ` Your ${usd(r.monthlyPayment)}-a-month car payment does not change either.` : '';
  const plain = benefits
    ? `<div class="otw-plain">Skipping federal tax on ${usd(r.deduction)} of car-loan interest puts about ${usd(r.taxSaved)} back in ` +
      `your pocket, as a bigger refund (or a smaller bill) when you file your ${s.year} return. It lowers federal income tax only: ` +
      `Social Security and Medicare still come out of your pay exactly as before, and your paycheck during the year does not change.${payment}</div>`
    : `<div class="otw-plain">${zeroNote(s, r)}</div>`;

  return warnBox + head + lead + rows + capFlag + plain;
}

// ---- Start over has to put the checkboxes back ------------------------------
// The core snapshots and restores el.value, which is the right thing for every
// text field, every number field and every select on this page — and does
// nothing at all for a checkbox, whose answer lives in .checked. Without this a
// visitor who unchecked "it's new" and pressed Start over was returned to card
// one with the gate still failing and no way to see why.
const eligDefaults = new Map();
const snapshotElig = () => ELIG_BOXES.forEach(([id]) => { const el = $(id); if (el) eligDefaults.set(id, el.checked); });
const restoreElig = () => eligDefaults.forEach((v, id) => { const el = $(id); if (el) el.checked = v; });

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'carLoanWizard',
  read,
  compute,
  renderResult,

  cards: [
    // The loan amount opens: it is the one figure a buyer knows without looking
    // anything up, and it is the tool's own subject.
    { step: AMOUNT, fields: ['amount'] },
    // The gate. #year rides along here inside a collapsed helper rather than on
    // a card of its own, because every year it offers is inside the 2025–2028
    // window and the cap and thresholds are identical in all four — the select
    // cannot change the answer, so it does not get a question.
    { step: ELIG,
      fields: ['e-new', 'e-usa', 'e-origin', 'e-personal', 'year'],
      // The card's only .otw-in is the year select, and it sits inside a closed
      // <details>, so the core's default focus pick would skip it and land on
      // the heading. Point at the first box instead: it is the question.
      focus: (card) => card.querySelector('.elig input') },
    // Everything after the gate is asked only of a visitor whose loan can
    // actually earn the deduction. Fail the gate and none of these four can
    // change the answer, so none of them is worth a visitor's time.
    { step: APR, fields: ['apr'], when: (s) => s.eligible, flags: [{ id: 'otwAprFlag', text: aprWarning }] },
    { step: TERM, fields: ['term'], when: (s) => s.eligible, flags: [{ id: 'otwTermFlag', text: termWarning }] },
    { step: MAGI, fields: ['magi'], when: (s) => s.eligible, flags: [{ id: 'otwIncomeFlag', text: incomeWarning }] },
    { step: FILING, radios: 'filing', when: (s) => s.eligible },
    { step: RESULT, result: true }
  ],

  // The page loads with numbers nobody typed, so the answer stays labelled an
  // example until every figure it is built from is the visitor's own. Clearing
  // it on the first edit presented an answer still made of our invented rate and
  // term as theirs, and $40,000 at 6.5% over 60 months is ordinary enough to be
  // somebody's real loan. Filing status and the tax year are not listed: both
  // have a real default that is true for most visitors, and neither invents a
  // figure. The eligibility boxes are not listed either — they are a claim about
  // the visitor's own car, not a number we made up.
  //
  // Deliberately path-BLIND: it keeps naming the rate, the term and the income
  // even while the gate has taken those cards off the path. The core removes the
  // note for good the first time this returns an empty list, so a list that
  // shrinks with the path would delete the label on an ineligible answer and
  // never bring it back when the visitor re-checked the box and our $90,000
  // income came back with it.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('amount')) missing.push('your loan amount');
    if (!touched.has('apr')) missing.push('your interest rate');
    if (!touched.has('term')) missing.push('how long the loan runs');
    if (!touched.has('magi')) missing.push('your yearly income');
    return missing;
  },

  // A chip for a card that is off the path would step the visitor nowhere (the
  // core hands an off-path target forward), so the four post-gate chips are only
  // offered when the gate is passed.
  chips: (s) => {
    const list = [
      { step: AMOUNT, label: `${usd(s.amount)} borrowed` },
      { step: ELIG, label: s.eligible ? 'loan qualifies' : `${s.failed.length} of 4 not met` }
    ];
    if (!s.eligible) return list;
    // The raw text, not the parsed number: a chip is a receipt for what the
    // visitor typed, and the shared formatters would quote 0.065 back as 0.07.
    // An empty box says so rather than reading as a real 0% deal.
    return list.concat([
      { step: APR, label: s.aprRaw ? `${s.aprRaw}%` : 'rate not set' },
      { step: TERM, label: s.termRaw ? `${s.termRaw} months` : 'length not set' },
      { step: MAGI, label: `${usd(s.magi)}/yr` },
      { step: FILING, label: FILING_WORDS[s.filing] || s.filing }
    ]);
  },

  announce: (s, r) => {
    if (!r.eligible) {
      return `No car loan interest deduction: this loan fails ${s.failed.length === 1 ? 'one of the four conditions' : s.failed.length + ' of the four conditions'}. The answer names which.`;
    }
    const capSpoken = r.interest > 0 && r.deduction < r.interest && !r.fullyPhasedOut
      ? ` Your ${usd(r.interest)} of first-year interest is limited to ${usd(r.deduction)} deductible${r.phasedOut ? ' by the income phase-out' : ` by the ${usd(r.statutoryCap)} yearly cap`}.`
      : '';
    return `Federal tax saved by the car loan interest deduction: ${usd(r.taxSaved)}.${capSpoken}` +
      (warningsFor(s).length ? ' Check your numbers, there is a warning above the answer.' : '');
  },

  onBeforeSnapshot: snapshotElig,
  onReset: restoreElig
});
