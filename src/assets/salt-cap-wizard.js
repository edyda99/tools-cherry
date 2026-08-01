// salt-cap-wizard.js — the card-by-card flow on /salt-cap-calculator/.
// Estimates the OBBBA state-and-local-tax deduction cap (IRC §164(b)(6) as
// amended by §70120): $40,000 for 2025 / $40,400 for 2026, reduced by 30% of
// income over $500,000 / $505,000 but never below $10,000, all halved for
// married filing separately — plus the itemize-vs-standard verdict and the
// federal tax saved against the old $10,000 cap. All logic client-side;
// nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// form (#saltForm, #torpedo) and is still served by salt-cap-calculator.js; the
// two must stay independent, so nothing here reads or writes an id the embed
// also ships except through its own page's DOM.
//
// Everything about "how a card flow behaves" — stepping, dots, focus, the 350 ms
// flag debounce, the polite status line, the example label, Start over, data-js
// last — lives in wizard-core.js. What is left here is only what makes this the
// SALT calculator: six questions, one call into the shared OBBBA engine, and the
// answer written out as a story.
//
// THE MATH is one engine call. saltComparison() works out the year's cap for the
// filing status, applies the 30% phase-down and the floor, compares the itemized
// total against the standard deduction, and returns the federal tax saved as
// (tax under the old $10,000 cap) − (tax under the new one) through the exact
// bracket-diff machinery, so it is right across a bracket line rather than a
// flat marginal-rate guess.
import { saltComparison } from '/assets/obbba-deduction.js';
import { mountWizard, moneyOf, radioOf, usd, pct } from '/assets/wizard-core.js';

const OBBBA = window.__OBBBA__;
const FED = window.__FED__;

// data-step on each card. RESULT is the last card and is never skipped.
const YEAR = 0, INCOME_TAX = 1, PROP_TAX = 2, MAGI = 3, FILING = 4, OTHER = 5, RESULT = 6;

const FILING_WORDS = {
  single: 'on my own',
  married: 'married, one return',
  married_separate: 'married, separate returns',
  head_of_household: 'head of household'
};

// ---- Reading the cards ------------------------------------------------------
// `paid` is derived here rather than in three render branches: the two money
// boxes added together are what the law calls SALT, and every sentence below
// quotes that single figure.
function read() {
  const incomeTax = moneyOf('incomeTax');
  const propTax = moneyOf('propTax');
  return {
    year: parseInt(radioOf('year', '2025'), 10) || 2025,
    filing: radioOf('filing', 'single'),
    magi: moneyOf('magi'),
    incomeTax,
    propTax,
    paid: incomeTax + propTax,
    other: moneyOf('other')
  };
}

const compute = (s) => saltComparison({
  year: s.year, filingStatus: s.filing, magi: s.magi,
  saltPaid: s.paid, otherItemized: s.other,
  params: OBBBA.salt, fed: FED
});

// ---- The one cross-check these six answers allow ----------------------------
// Only the INCOME-tax box against the income, never the SALT total. A property
// tax bill larger than the year's income is unusual but perfectly possible — a
// retired owner of an expensive house is the ordinary case — and flagging that
// would tell the truth to nobody. State and local INCOME tax above the income it
// was charged on is not a large number, it is an impossible one: no state taxes
// income at more than about 13%. The realistic mistake it catches is the income
// typed into the first money box.
//
// Never blocking: the answer still computes underneath, the doubt just travels
// with it, and it travels to BOTH places — the card that asks for the second of
// the two numbers, and the answer, because a visitor who reaches the answer by
// pressing Next may never come back to the card.
function incomeWarning(s) {
  if (s.magi <= 0 || s.incomeTax <= 0) return '';
  if (s.incomeTax <= s.magi) return '';
  return `Check these numbers: the ${usd(s.incomeTax)} you entered as state and local income tax is more than the ` +
    `${usd(s.magi)} you entered as everything you made that year, and no state taxes income at more than about 13%. ` +
    `One of the two needs another look.`;
}

// ---- The answer -------------------------------------------------------------
// Plain-words reason when the higher cap is worth nothing. It names the reason
// that is actually true for these numbers, in this order: nothing entered yet
// beats every other explanation, and "you would take the standard deduction"
// beats a cap explanation, because a filer who never itemizes is not affected by
// any cap at all.
function zeroBenefitNote(s, r) {
  if (s.paid <= 0) {
    return 'Enter what you paid in state and local tax to see what the higher limit is worth to you.';
  }
  if (r.itemize === false) {
    // The verdict flag directly above has already named both totals and said the
    // standard deduction wins. Repeating it here printed the same sentence twice
    // on the one answer that most visitors get. This says the thing the verdict
    // cannot: how much would have to change before any of it mattered.
    return `So the higher limit is worth nothing to you, and roughly nine in ten filers are in exactly this position. ` +
      `It would only start to matter once the state and local tax you are allowed to deduct, plus your other ` +
      `write-offs, came to more than ${usd(r.standardDeduction)}.`;
  }
  if (r.floorReached) {
    return `Your income has pushed the limit all the way back down to ${usd(r.floor)}, which is the same limit the old ` +
      `law gave you, so raising it is worth nothing this year.`;
  }
  if (s.paid <= r.oldCap) {
    return `You paid ${usd(s.paid)} in state and local tax, and the old ${usd(r.oldCap)} limit already covered all of ` +
      `it, so raising the limit changes nothing for you.`;
  }
  return `With these numbers your deduction comes out the same as it would have under the old ${usd(r.oldCap)} limit.`;
}

// The phase-down and the cap, always with BOTH numbers. The moment either binds,
// "what you paid" and "what you can deduct" stop being the same figure, and a
// sentence naming only one of them is how a screen ends up reading "$40,000, the
// tax you paid" over $48,000 of tax paid.
//
// Asked of the DEDUCTION (paid above the allowed cap), never of "did any tax come
// back": the cap can be phased all the way down to the $10,000 floor, produce a
// $0 saving, and still leave a row claiming the whole amount was deducted.
function capFlag(s, r, paidR, dedR, counts) {
  const capBinds = s.paid > 0 && s.paid > r.effectiveCap;
  const lostR = paidR - dedR;

  // Amber only when this actually costs the visitor something. Over a return
  // that will take the standard deduction the cap is a footnote to the rows
  // above, not a warning — the warning there is the verdict, and stacking two
  // amber boxes makes neither of them the one to read.
  const cls = counts ? 'otw-flag' : 'otw-note';

  if (!capBinds) {
    // Nothing entered yet is not "the trim costs you nothing", it is a page with
    // no numbers on it. The plain box says so once; saying it twice, in amber,
    // names a problem the visitor does not have.
    if (!r.phasedDown || s.paid <= 0) return '';
    return `<p class="${cls}">Your income is over the ${usd(r.threshold)} line, so your limit is trimmed to ` +
      `${usd(r.effectiveCap)} — but you paid ${usd(paidR)}, which is under it, so the trim costs you nothing this year.</p>`;
  }

  // "is deductible" is only true of a return that itemises. Over a visitor the
  // line above has just told to take the standard deduction it flatly
  // contradicts the answer, so the same figure is quoted as what the limit WOULD
  // allow instead.
  const head = counts
    ? `Heads up: ${usd(dedR)} of the ${usd(paidR)} you paid is deductible`
    : `Heads up: the limit would let you deduct ${usd(dedR)} of the ${usd(paidR)} you paid`;
  if (r.floorReached) {
    const past = r.floorMagi ? ` Past ${usd(r.floorMagi)} of income you are back at the old limit for good.` : '';
    return `<p class="${cls}">${head}. Your income is ${usd(r.excess)} over the ${usd(r.threshold)} line, which would ` +
      `take 30% of that (${usd(r.reduction)}) off the ${usd(r.baseCap)} limit — but the limit never drops below ` +
      `${usd(r.floor)}, and that is where yours is.${past} The other ${usd(lostR)} is not deductible.</p>`;
  }
  if (r.phasedDown) {
    return `<p class="${cls}">${head}. Your income is ${usd(r.excess)} over the ${usd(r.threshold)} line, so 30% of ` +
      `that (${usd(r.reduction)}) comes off the ${usd(r.baseCap)} limit, leaving ${usd(r.effectiveCap)}. The other ` +
      `${usd(lostR)} is not deductible.</p>`;
  }
  return `<p class="${cls}">${head}. The limit for ${r.year} is ${usd(r.effectiveCap)}, and it is a ceiling on what ` +
    `you may deduct, not a grant — the other ${usd(lostR)} is not deductible.</p>`;
}

// The 45.5% band. Same warning the page has always shown, same .torpedo-warn
// styling, moved inside #out so it sits with the answer it belongs to instead of
// below the whole calculator. Shown only when the cap is actually binding: inside
// the band with SALT below the cap, the next dollar earned costs nothing.
//
// ALSO GATED ON ITEMISING, which the old panel was not, and that was wrong. The
// torpedo is the next dollar of income stripping 30 cents off a deduction you
// are USING; a visitor whose standard deduction already beats their itemised
// total is not using it, so nothing is stripped and their marginal rate is the
// ordinary one. married_separate in 2026 at $300,000 with $48,000 of SALT is the
// live case: the cap phases to $5,950, the itemised total lands $150 under the
// standard deduction, and the old panel still announced a 45.5% rate. The
// /embed/ build keeps the ungated behaviour, because its script is untouched.
function torpedoWarning(r) {
  if (!r.torpedoZone || !r.capBinding || r.itemize === false) return '';
  return `<div class="torpedo-warn"><strong>SALT torpedo zone.</strong> Your income sits in the band where the limit ` +
    `shrinks (${usd(r.threshold)}–${usd(r.floorMagi)} for ${r.year}). Each extra $1 you earn also removes $0.30 of ` +
    `deduction, so your taxable income rises by $1.30 per $1 — an effective marginal rate of about <strong>45.5%</strong> ` +
    `in the 35% bracket (1.3 × 35%) or <strong>48.1%</strong> in the 37% bracket. If you can shift income out of this ` +
    `band (bonus timing, Roth conversions, capital gains), each dollar moved avoids the surcharge.</div>`;
}

function derivation(r, itemizedR) {
  if (r.standardDeduction == null || r.deductionBenefit == null || r.deductionBenefit <= 0 || r.taxSaved == null) return '';
  const blend = (r.straddledBracketRates && r.straddledBracketRates.length > 1)
    ? ` That rate blends two brackets (here ${pct(r.straddledBracketRates[0])} and ` +
      `${pct(r.straddledBracketRates[r.straddledBracketRates.length - 1])}) because the deduction crosses a bracket ` +
      `line, so it can legitimately sit between them.`
    : '';
  return `<details class="otw-help" id="saltMath"><summary>How the saving was worked out</summary>` +
    `<p>Under the new limit your best deduction is ${usd(r.bestNew)}, the larger of your ${usd(itemizedR)} itemized ` +
    `total and the ${usd(r.standardDeduction)} standard deduction. Under the old ${usd(r.oldCap)} limit it would have ` +
    `been ${usd(r.bestOld)}. That is ${usd(r.deductionBenefit)} more deducted, worth ${usd(r.taxSaved)} at an effective ` +
    `federal rate of ${pct(r.marginalRate)} on this deduction.${blend}</p></details>`;
}

function renderResult({ state: s, result: r }) {
  const warning = incomeWarning(s);
  const warnBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  const saved = r.taxSaved || 0;
  const benefits = saved > 0;
  const head =
    `<p class="otw-kick">When you file your taxes for ${r.year}</p>` +
    `<p class="otw-big${benefits ? '' : ' otw-zero'}">${usd(saved)}</p>`;

  // ---- Rounded once ---------------------------------------------------------
  // The labels invite the reader to add the lower rows up to the top one, so
  // they have to add up: the "not deductible" row is DERIVED by subtraction from
  // the two rounded figures above it rather than rounded on its own, which is the
  // only way $48,000 = $47,999.50 + $0.50 cannot print as $48,000 = $48,000 + $1.
  // The itemized total is likewise the sum of the two ALREADY-ROUNDED figures the
  // sentence names, not a separately rounded r.itemizedTotal.
  const paidR = Math.round(s.paid);
  const dedR = Math.round(r.allowedSalt);
  const lostR = paidR - dedR;
  const otherR = Math.round(s.other);
  const itemizedR = dedR + otherR;
  // Does anything on this page reach the visitor's return at all? Null (a year
  // whose standard deduction we do not carry) is not a No, so only an explicit
  // false switches the wording to the conditional.
  const counts = r.itemize !== false;

  // ---- The gate --------------------------------------------------------------
  // Whether you itemize at all decides whether the story above touches your
  // return, so it is the first thing said after the rows and before the cap
  // detail. It sits AFTER the rows rather than before them for a layout reason
  // that is not negotiable: .otw-lead carries margin 0 because it is written to
  // be the one paragraph directly under .otw-big, and two of them in a row run
  // together into a single block of text. Only one .otw-lead per answer.
  //
  // Amber when the standard deduction wins, because then the whole page is moot
  // for this visitor and that is the single most useful thing we can tell them;
  // muted when it does not, where it is a confirmation rather than a warning.
  let verdict = '';
  if (s.paid > 0 && r.standardDeduction != null) {
    const ded = counts
      ? `Your ${usd(dedR)} of deductible state and local tax`
      : `The ${usd(dedR)} the limit would let you deduct`;
    const total = otherR > 0
      ? `${ded} plus ${usd(otherR)} of other write-offs comes to ${usd(itemizedR)}`
      : `${ded}, with no other write-offs to add to it, comes to ${usd(itemizedR)}`;
    verdict = counts
      ? `<p class="otw-note">${total}, which beats the ${usd(r.standardDeduction)} standard deduction — so you would ` +
        `itemize, and it counts.</p>`
      : `<p class="otw-flag">This does not change your return. ${total}, and the ${usd(r.standardDeduction)} standard ` +
        `deduction you can take without listing anything is bigger — so you would take the standard deduction instead.</p>`;
  }

  // ---- The story ------------------------------------------------------------
  // Suppressed entirely when there is nothing paid: a lead sentence with no rows
  // under it prints the same thought twice, once here and once in the plain box.
  let lead = '';
  let rows = '';
  if (s.paid > 0) {
    // When the visitor would take the standard deduction, the middle row is what
    // the limit WOULD allow, not what comes off their return. Saying "the
    // government skips tax on this" over a return that never itemises is the one
    // sentence on this page that would be flatly untrue.
    const capBinds = s.paid > r.effectiveCap;
    const dedLabel = capBinds
      ? `Deductible under your ${usd(r.effectiveCap)} limit`
      : 'Deductible in full, you paid less than the limit';
    lead = `<p class="otw-lead">Here is what happens to the ${usd(paidR)} of state and local tax you paid:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>The state and local tax you paid</span><span class="otw-amt">${usd(paidR)}</span></li>` +
      `<li><span>${counts ? dedLabel : 'What the limit would allow, if you itemized'}` +
        `${counts && dedR > 0 ? ' — the government skips tax on this' : ''}</span>` +
        `<span class="otw-amt${counts && dedR > 0 ? ' otw-free' : ''}">${usd(dedR)}</span></li>` +
      (lostR > 0
        ? `<li><span>The rest, above the ${usd(r.effectiveCap)} limit — not deductible</span>` +
          `<span class="otw-amt otw-taxed">${usd(lostR)}</span></li>`
        : '') +
      // Not part of the split above, so it carries the heavier rule that stops a
      // reader adding it in: the first rows are the tax you paid, this one is
      // what raising the limit on it is worth.
      `<li class="otw-after"><span>Federal tax you don't pay because the limit went up</span>` +
        `<span class="otw-amt${benefits ? ' otw-free' : ''}">${usd(saved)}</span></li>` +
      `</ul>`;
  }

  // The three sentences a reader needs and would not otherwise get: when the
  // money arrives, that the payroll taxes are untouched, and that neither the
  // paycheck nor the tax bill this is a deduction FOR gets any smaller.
  const plain = benefits
    ? `<div class="otw-plain">Deducting ${usd(r.deductionBenefit)} more than the old ${usd(r.oldCap)} limit allowed is ` +
      `worth about ${usd(saved)} to you, and it arrives as a bigger refund, or a smaller bill, when you file. It does ` +
      `not touch Social Security and Medicare, which still come out of your pay as usual, your paycheck during the year ` +
      `does not change, and it does not make the state or property tax bill itself any smaller.</div>`
    : `<div class="otw-plain">${zeroBenefitNote(s, r)}</div>`;

  return warnBox + head + lead + rows + verdict + capFlag(s, r, paidR, dedR, counts) +
    torpedoWarning(r) + derivation(r, itemizedR) + plain;
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'saltWizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: YEAR, radios: 'year' },
    { step: INCOME_TAX, fields: ['incomeTax'] },
    { step: PROP_TAX, fields: ['propTax'] },
    {
      step: MAGI,
      fields: ['magi'],
      // On the income card rather than the state-income-tax card: it is the
      // second of the two numbers, so it is the one being typed when the
      // contradiction can first exist.
      flags: [{ id: 'otwIncomeFlag', text: incomeWarning }]
    },
    { step: FILING, radios: 'filing' },
    // Last of the questions because Skip always jumps to the answer, and this is
    // the only card a visitor may genuinely have nothing to say to. Skip CLEARS
    // the box: it ships pre-filled at $10,000 and the itemize-vs-standard verdict
    // reads it on every render, so a skip that merely moved on would keep
    // answering the question with our figure.
    { step: OTHER, fields: ['other'], skipClears: ['other'] },
    { step: RESULT, result: true }
  ],

  // The page loads with four money figures nobody typed, so the answer stays
  // labelled an example until each is the visitor's own. Clearing the label on
  // the first edit presented an answer still made of our invented numbers as
  // theirs, and $28,000 of state income tax on $300,000 of pay is ordinary enough
  // to be somebody's real return.
  //
  // "Other write-offs" drops off the list once it reads zero as well as once it
  // is touched: Skip and the "Nothing else" chip both leave it at zero, and a
  // zero is a real answer to that question, not a figure of ours still standing
  // in for one. The year and the filing status are not listed at all: both are
  // closed choices with a real default and neither invents a figure.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('incomeTax')) missing.push('your state and local income tax');
    if (!touched.has('propTax')) missing.push('your property tax');
    if (!touched.has('magi')) missing.push('your income');
    if (!touched.has('other') && s.other > 0) missing.push('your other write-offs');
    return missing;
  },

  chips: (s, r) => [
    { step: YEAR, label: `tax year ${s.year}` },
    { step: INCOME_TAX, label: `${usd(s.incomeTax)} income tax` },
    { step: PROP_TAX, label: `${usd(s.propTax)} property tax` },
    { step: MAGI, label: `${usd(s.magi)}/yr` },
    { step: FILING, label: FILING_WORDS[s.filing] || s.filing },
    { step: OTHER, label: s.other > 0 ? `${usd(s.other)} other write-offs` : 'no other write-offs' }
  ],

  announce: (s, r) => {
    const capSpoken = s.paid > 0
      ? ` You can deduct ${usd(r.allowedSalt)} of the ${usd(s.paid)} you paid.`
      : '';
    const gate = r.itemize === false
      ? ' Your standard deduction is bigger than everything you could list, so this does not change your return.'
      : '';
    return `Federal tax saved by the higher state and local tax limit: ${usd(r.taxSaved || 0)}.${capSpoken}${gate}` +
      (incomeWarning(s) ? ' Check your numbers, there is a warning above the answer.' : '');
  }
});
