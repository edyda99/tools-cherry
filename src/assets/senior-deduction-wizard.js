// senior-deduction-wizard.js — the card-by-card flow on /senior-deduction-calculator/.
// Estimates the OBBBA "senior bonus" deduction (IRC §151(d)(5)(C)): $6,000 for
// each person 65 or older, tax years 2025–2028, with the 6% MAGI phase-out, and
// the federal income tax it saves. All logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// form (#seniorForm) and is still served by senior-deduction-calculator.js,
// because a third party sizes that iframe once and a flow whose height changes
// per card would clip inside it. The two must stay independent, so nothing here
// reads or writes an id the embed also ships except through its own page's DOM.
//
// CONVERTED ONTO wizard-core.js. Everything about "how a card flow behaves" —
// stepping, dots, focus, the polite status line, the example label, Start over,
// data-js last — lives in the core. What is left here is only what makes this
// the senior calculator: five questions (one of which is only asked of a joint
// return), one call into the shared OBBBA engine, and the answer written out as
// a story.
//
// THE MATH is one engine call. estimateSenior() counts the qualifying people,
// applies the per-PERSON phase-out (6 cents per dollar of income over the
// threshold, applied to each person's $6,000 rather than to the couple's total),
// and returns the exact federal tax saved as (tax without the deduction) − (tax
// with it), so it is right across a bracket boundary rather than a flat
// marginal-rate guess.
import { estimateSenior } from '/assets/obbba-deduction.js';
import { mountWizard, moneyOf, radioOf, selectOf, usd } from '/assets/wizard-core.js';

const OBBBA = window.__OBBBA__;
const FED = window.__FED__;

// The statutory figures, read from the SAME data the engine is handed rather
// than typed in again here, so a parameter change lands in the sentences and in
// the math together. Fallbacks are the 2025–2028 statute, and exist only so a
// missing window global degrades to the right words instead of "$NaN".
const SENIOR = (OBBBA && OBBBA.senior) || {};
const PER_PERSON = SENIOR.amountPerPerson || 6000;
const RATE = SENIOR.phaseoutRate || 0.06;
const CENTS = Math.round(RATE * 100);
// Income at which one person's whole $6,000 is gone: the threshold plus
// $6,000 / 6% = $100,000. $175,000 single, $250,000 joint, exactly as the prose
// below the calculator says.
const zeroAt = (threshold) => threshold + PER_PERSON / RATE;

// data-step on each card. RESULT is the last card and is never skipped.
const AGE = 0, FILING = 1, SPOUSE = 2, INCOME = 3, YEAR = 4, RESULT = 5;

const FILING_WORDS = {
  single: 'on my own',
  married: 'married, one return',
  married_separate: 'married, separate returns',
  head_of_household: 'head of household',
  qss: 'surviving spouse'
};

// ---- Reading the cards ------------------------------------------------------
// The two 65+ answers are yes/no radio groups rather than the checkboxes this
// page used to ship (see the template comment for why), so they are read as a
// value and turned into the boolean the engine wants here.
function read() {
  return {
    age65: radioOf('age65', 'yes') === 'yes',
    filing: radioOf('filing', 'single'),
    // Left as answered even when the spouse card is off the path: the engine
    // only counts a spouse on a joint return, so a visitor who answers "yes"
    // and then changes how they file cannot leak a second $6,000.
    spouseAge65: radioOf('spouseAge65', 'no') === 'yes',
    magi: moneyOf('magi'),
    year: parseInt(selectOf('year'), 10) || SENIOR.firstYear || 2025
  };
}

const compute = (s) => estimateSenior({
  year: s.year, filingStatus: s.filing, age65: s.age65,
  spouseAge65: s.spouseAge65, magi: s.magi, federal: OBBBA, fed: FED
});

// ---- No cross-check is possible here, and that is deliberate ----------------
// A guard belongs where two answers can contradict each other (tips larger than
// the whole year's pay; overtime alone larger than the year). These five cannot:
// the year select only offers the four years the deduction exists for, age and
// spouse-age are yes/no, filing status is a closed list, and there is only ONE
// money figure on the page, so it has nothing to be impossible against. The
// combinations that produce nothing — filing separately, nobody 65, income past
// the phase-out — are the law working as written, not a typo, so they are
// explained in the answer's plain box rather than flagged as a mistake.

// ---- The answer -------------------------------------------------------------
// Every zero has a REASON, and it has to be the right one: "add your income"
// over a filled-in form names the wrong problem, and so does "you don't
// qualify" over a return where somebody does but owes no tax anyway.
function zeroReason(s, r) {
  if (r.notes.includes('mfs_denied')) {
    return `Married couples have to send in one return together to claim this. Filing separately gets $0, whatever your age or income.`;
  }
  if (r.notes.includes('not_in_effect')) {
    return `This deduction only exists for the ${SENIOR.firstYear || 2025} to ${SENIOR.lastYear || 2028} tax years, so there is nothing to claim on a ${s.year} return.`;
  }
  if (r.notes.includes('not_65')) {
    return `Nobody on this return is 65 or older by December 31, ${s.year}. The deduction starts with the year you turn 65 — it is worth coming back then.`;
  }
  if (r.fullyPhasedOut) {
    return `Your ${usd(s.magi)} is ${usd(r.excess)} over the ${usd(r.threshold)} line, and at ${CENTS} cents lost per dollar the whole ` +
      `${usd(r.deductionBeforePhaseout)} is gone by ${usd(zeroAt(r.threshold))}.`;
  }
  if (s.magi <= 0) {
    return `Add your yearly income to see what your ${usd(r.deduction)} deduction saves you.`;
  }
  if (r.deduction > 0) {
    return `You do qualify for a ${usd(r.deduction)} deduction, but on ${usd(s.magi)} of income there is no federal income tax left for it to save.`;
  }
  return 'With these answers there is no federal tax to save this year.';
}

function renderResult({ state: s, result: r }) {
  const benefits = r.taxSaved > 0;
  const head =
    `<p class="otw-kick">When you file your ${s.year} tax return</p>` +
    `<p class="otw-big${benefits ? '' : ' otw-zero'}">${usd(r.taxSaved)}</p>`;

  // ---- The story ------------------------------------------------------------
  // ROUNDED ONCE. The labels invite the reader to take the middle row off the
  // top one and land on the third, so those three have to reconcile: the
  // phase-out row is DERIVED by subtraction from the two rounded figures rather
  // than rounded on its own, which is the only way $12,000 − $2,999.50 cannot
  // print as $12,000 − $3,000 = $9,001.
  //
  // Shown whenever anybody qualified, INCLUDING the fully-phased-out case:
  // "$12,000 to start, all $12,000 taken away, $0 left" is the explanation of
  // that zero, not padding around it.
  let lead = '';
  let rows = '';
  if (r.deductionBeforePhaseout > 0) {
    const startR = Math.round(r.deductionBeforePhaseout);
    const dedR = Math.round(r.deduction);
    const cutR = startR - dedR;
    const who = r.eligibleCount === 1 ? 'person' : 'people';
    lead = `<p class="otw-lead">Here is what happens to the ${usd(startR)} you start with:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>${usd(PER_PERSON)} each, for ${r.eligibleCount} ${who} 65 or older</span><span class="otw-amt">${usd(startR)}</span></li>` +
      (cutR > 0
        ? `<li><span>Taken away because your income is over ${usd(r.threshold)}</span><span class="otw-amt otw-taxed">&minus;${usd(cutR)}</span></li>`
        : '') +
      `<li><span>Taken off the income you are taxed on${dedR > 0 ? ' — the government skips tax on this' : ''}</span>` +
        `<span class="otw-amt${dedR > 0 ? ' otw-free' : ''}">${usd(dedR)}</span></li>` +
      // Not part of the subtraction above, so it carries the heavier rule that
      // stops a reader adding it in: the rows above are the deduction itself,
      // this one is what skipping tax on it is worth.
      `<li class="otw-after"><span>Federal tax you don't pay because of it</span>` +
        `<span class="otw-amt${benefits ? ' otw-free' : ''}">${usd(r.taxSaved)}</span></li>` +
      `</ul>`;
  }

  // ---- The limit, named with BOTH numbers -------------------------------------
  // The moment the phase-out bites, "the $6,000 each" and "the amount you can
  // actually deduct" stop being the same number, and a sentence naming only one
  // of them is how a screen ends up reading "$12,000, your senior deduction"
  // over a $9,000 one. Decided from the DEDUCTION (the engine's phasedOut flag
  // is perPersonReduction > 0), never from "did any tax come back": a deduction
  // can be trimmed hard and still save $0 because the income was low, and it can
  // be trimmed to nothing while a $0 headline sits over a row claiming the full
  // amount. The fully-phased-out case is left to the plain box below, which
  // explains the $0 rather than announcing a limit that took everything.
  let capFlag = '';
  if (r.phasedOut && !r.fullyPhasedOut) {
    capFlag = `<p class="otw-flag">Heads up: ${usd(r.deduction)} of the ${usd(r.deductionBeforePhaseout)} you start with survives. ` +
      `Your income is ${usd(r.excess)} over the ${usd(r.threshold)} line, and each person's ${usd(PER_PERSON)} drops by ${CENTS} cents ` +
      `for every dollar over it (&minus;${usd(r.perPersonReduction)} each), reaching $0 at ${usd(zeroAt(r.threshold))}.</p>`;
  }

  // The three sentences the benchmark readers needed and did not get: when the
  // money arrives, that the thing the marketing promised did NOT happen, and
  // that nothing about the year changes. They ride beside the good news rather
  // than behind a tap, because this page's whole reason to exist is that
  // "no tax on Social Security" is not what the law did.
  const plain = benefits
    ? `<div class="otw-plain">Taking ${usd(r.deduction)} off the income you are taxed on puts about ${usd(r.taxSaved)} back in your ` +
      `pocket, as a bigger refund (or a smaller bill) when you file. It does not change your monthly Social Security payment, or how ` +
      `much of that payment is taxed. And if you are still working, Social Security and Medicare still come out of your pay through ` +
      `the year exactly as they do now.</div>`
    : `<div class="otw-plain">${zeroReason(s, r)}</div>`;

  return head + lead + rows + capFlag + plain;
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'seniorWizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: AGE, radios: 'age65' },
    { step: FILING, radios: 'filing' },
    // The one branch on the page, and the same rule the old #spouseRow followed:
    // a spouse's $6,000 only exists on a joint return. Expressed as a card that
    // is simply not asked rather than a row that appears and disappears under
    // the visitor, and the core drops it from the dots and the "Step 2 of 4"
    // label on the keystroke that changes the filing answer.
    { step: SPOUSE, radios: 'spouseAge65', when: (s) => s.filing === 'married' },
    { step: INCOME, fields: ['magi'] },
    { step: YEAR, fields: ['year'] },
    { step: RESULT, result: true }
  ],

  // The page loads with an income nobody typed, so the answer stays labelled an
  // example until that figure is the visitor's own. The other four are not
  // listed: each has a real default that is true for most of the people who come
  // here (65 or older, on their own, spouse not also 65, this year's return) and
  // none of them invents a figure the way $60,000 does.
  exampleMissing: (s, touched) => (touched.has('magi') ? [] : ['your yearly income']),

  chips: (s) => {
    const list = [
      { step: AGE, label: s.age65 ? '65 or older' : 'under 65' },
      { step: FILING, label: FILING_WORDS[s.filing] || s.filing }
    ];
    // Only when it was asked: a chip for a card this visitor never saw would
    // send them to a question that is not on their path.
    if (s.filing === 'married') {
      list.push({ step: SPOUSE, label: s.spouseAge65 ? 'spouse 65 or older' : 'spouse under 65' });
    }
    list.push({ step: INCOME, label: `${usd(s.magi)}/yr` });
    list.push({ step: YEAR, label: `${s.year} return` });
    return list;
  },

  announce: (s, r) => {
    const trimmed = r.phasedOut && !r.fullyPhasedOut
      ? ` The income phase-out trims the ${usd(r.deductionBeforePhaseout)} you start with to ${usd(r.deduction)}.`
      : '';
    return `Federal tax saved by the senior deduction: ${usd(r.taxSaved)}.${trimmed}`;
  }
});
