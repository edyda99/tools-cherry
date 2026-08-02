// charitable-deduction-wizard.js — the card-by-card flow on
// /charitable-deduction-calculator/.
//
// Estimates the three 2026 OBBBA charitable changes, all PERMANENT (no 2028
// sunset): the §170(p) non-itemizer deduction ($1,000 single / $2,000 married
// filing jointly, CASH ONLY), the §170(b)(1)(I) 0.5%-of-AGI floor for itemizers,
// and the §68 "2/37 rule" that leaves a deducted dollar worth about 35¢ in the
// 37% bracket. All logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// #charForm and is still served by charitable-deduction-calculator.js, so
// nothing here reads or writes an id the embed also ships except through its own
// page's DOM.
//
// Everything about "how a card flow behaves" — stepping, dots, focus, the 350 ms
// flag debounce, the polite status line, the example label, Start over, data-js
// last — lives in wizard-core.js. What is left here is only what makes this the
// charitable calculator: five questions, one call into the shared OBBBA engine,
// and the answer written out as a story.
//
// THE MATH is one engine call. charitableComparison() runs BOTH worlds (take the
// flat standard deduction plus the §170(p) bonus, or list your deductions after
// the 0.5% floor and the §68 haircut), picks the winner, and returns the federal
// tax saved BY THE GIFT as a counterfactual — tax with the gift removed minus tax
// with it — so it is right across a bracket boundary rather than a flat marginal-
// rate guess.
//
// THE ONE THING NOT TO BREAK. question-flow.js used to gate #nonCash and #other
// behind yes/no questions, and answering No PARKED the field at a neutral value
// rather than merely hiding it, because #other ships pre-filled at 20000 and a
// hidden 20000 still flipped the itemize-vs-standard verdict. Those questions are
// cards now, so the neutral answers live in the markup and in the chips: #nonCash
// ships at 0 (what No parked it at) and the "Nothing else" chip on the #other card
// writes a real 0. Nothing in this file hides a field instead of zeroing it.
//
// THIS ESTIMATE DOES NOT MODEL the 60%/30%/20%-of-AGI ceilings on very large
// gifts (the page's standing note says so), so when a visitor's cash giving goes
// past the 60% cash ceiling the flag below says the answer is likely too high
// rather than quietly overstating it.
import { charitableComparison } from '/assets/obbba-deduction.js';
import { mountWizard, moneyOf, radioOf, usd, pct } from '/assets/wizard-core.js';

const OBBBA = window.__OBBBA__;
const FED = window.__FED__;

// data-step on each card. RESULT is the last card and is never skipped.
const GIFT = 0, GOODS = 1, INCOME = 2, FILING = 3, OTHER = 4, RESULT = 5;

const FILING_WORDS = {
  single: 'on my own',
  married: 'married, filing together',
  head_of_household: 'head of household'
};

// ---- Reading the cards ------------------------------------------------------
function read() {
  return {
    cashGift: moneyOf('cashGift'),
    nonCash: moneyOf('nonCash'),
    agi: moneyOf('agi'),
    filing: radioOf('filing', 'single'),
    other: moneyOf('other')
  };
}

const compute = (s) => charitableComparison({
  filingStatus: s.filing,
  agi: s.agi,
  cashGift: s.cashGift,
  otherCharitable: s.nonCash,
  otherItemized: s.other,
  params: OBBBA.charitable,
  fed: FED
});

// Read lazily and defensively rather than at module top: a missing data blob must
// not throw before mountWizard's boot handler exists to put the load banner up.
function cashCeilingRate() {
  const p = OBBBA && OBBBA.charitable;
  const v = p && p.cashCeilingAgiPct;
  return typeof v === 'number' && v > 0 ? v : 0.6;
}

// ---- The one cross-check these five answers allow ---------------------------
// Giving and income are relatable, so the impossible-looking combination gets
// said out loud. Never blocking: the answer still computes underneath, the doubt
// just travels with it, and it travels to BOTH places — the card that asks for
// the second of the two numbers and the answer itself, because a visitor who
// reaches the answer by pressing Next may never come back to the card.
//
// Two cases, most severe first. Giving MORE than the whole year's income is the
// impossible-looking one. Cash giving above the 60%-of-AGI ceiling is the one
// where the engine is knowingly optimistic: it does not apply that ceiling, so
// the figure it prints is too high and the visitor has to be told, not left to
// find out at filing.
function giftWarning(s) {
  const gift = s.cashGift + s.nonCash;
  if (s.agi <= 0 || gift <= 0) return '';
  const rate = cashCeilingRate();
  const ceiling = rate * s.agi;
  if (gift > s.agi) {
    return `Check these numbers: the ${usd(gift)} you entered as giving is more than the ${usd(s.agi)} you entered as ` +
      `your income for the whole year. That can happen if you gave out of savings, but there is also a yearly ceiling — ` +
      `cash giving is deductible only up to ${usd(ceiling)} this year, ${pct(rate)} of your income — and this estimate ` +
      `does not apply that ceiling, so the answer below is likely too high.`;
  }
  if (s.cashGift > ceiling) {
    return `Check this number: the ${usd(s.cashGift)} you gave in cash is more than ${usd(ceiling)}, which is ${pct(rate)} ` +
      `of your ${usd(s.agi)} income. Cash giving is deductible only up to that ceiling in one year, with the rest carried ` +
      `into later years, and this estimate does not apply the ceiling, so the answer below is likely too high.`;
  }
  return '';
}

// ---- The answer -------------------------------------------------------------
// The verdict IS the story's opening line: which of the two worlds won decides
// what every row underneath means, so it is said before the rows rather than
// buried in a "see how this was calculated" panel the way the old layout did.
// Both totals, never one. The comparison is NOT against the bare standard
// deduction: the standard-deduction world also carries the new $1,000 / $2,000
// break for donating, so naming r.standardDeduction here would quote a figure
// $1,000 lower than the one the verdict was actually decided against.
function verdictLead(r, giftR) {
  const listed = usd(r.itemizedAllowed);
  const flat = usd(r.stdWorldDeduction);
  return r.itemize
    ? `<p class="otw-lead">Listing your deductions one by one (${listed}) beats taking the flat standard deduction with ` +
      `the break for donating added on (${flat}), so here is what happens to the ${usd(giftR)} you gave:</p>`
    : `<p class="otw-lead">Taking the flat standard deduction with the break for donating added on (${flat}) beats ` +
      `listing your deductions one by one (${listed}), so here is what happens to the ${usd(giftR)} you gave:</p>`;
}

function deductibleLabel(r) {
  return r.itemize
    ? 'Deductible on your list of deductions'
    : 'Counts toward the new break for donating';
}

// Why the leftover is a leftover, in the words of whichever world won.
function restReason(s, r) {
  if (r.itemize) {
    return `the first 0.5% of your income, ${usd(r.floor)}, is not deductible at all`;
  }
  const capBinds = s.cashGift > r.nonItemizerCap;
  const goods = s.nonCash > 0;
  if (capBinds && goods) {
    return `this break stops at ${usd(r.nonItemizerCap)} a year, and gifts of goods never count toward it`;
  }
  if (capBinds) return `this break stops at ${usd(r.nonItemizerCap)} a year`;
  if (goods) return 'gifts of goods never count toward this break, it is cash only';
  return 'it earns nothing extra this year';
}

// Plain-words reason when the giving saves $0 of federal income tax. It names the
// reason that actually applies: "enter your donation" over a filled-in form names
// the wrong problem.
function zeroReason(s, r) {
  if (r.totalCharitableGift <= 0) {
    return 'Put in what you gave to charity and we will work out what is deductible and what it saves you.';
  }
  if (s.agi <= 0) {
    return 'Put in your income for the year and we can work out what your giving saves you.';
  }
  if (r.itemize && r.charDeductible === 0) {
    return `The first 0.5% of your income, ${usd(r.floor)}, is not deductible at all, and your ${usd(r.totalCharitableGift)} ` +
      `of giving is at or below that. You would list your deductions anyway on the rest, so this giving adds nothing.`;
  }
  if (!r.itemize && r.nonItemizerDed === 0) {
    return 'You gave things rather than money. Gifts of goods never count toward the break for people who do not list ' +
      'their deductions, and the flat standard deduction beats listing them for you this year, so this giving saves ' +
      '$0 of federal income tax.';
  }
  return 'With these numbers there is no federal income tax left for the deduction to lower, so your giving saves $0 this year.';
}

function renderResult({ state: s, result: r }) {
  const warning = giftWarning(s);
  const warnBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  const benefits = r.taxSaved > 0;
  const head =
    `<p class="otw-kick">When you file your taxes next year</p>` +
    `<p class="otw-big${benefits ? '' : ' otw-zero'}">${usd(r.taxSaved)}</p>`;

  // ---- The story ------------------------------------------------------------
  // ROUNDED ONCE. The labels invite the reader to add the lower rows up to the
  // top one, so they have to add up: the leftover row is DERIVED by subtraction
  // from the two rounded figures above it rather than rounded on its own. The two
  // worlds split the same total in two different places — the 0.5% floor when
  // listing deductions, the $1,000 / $2,000 cash-only cap when not — so one shape
  // serves both and only the labels change.
  const giftR = Math.round(r.totalCharitableGift);
  const dedR = Math.round(r.charitableDeductible);
  const restR = giftR - dedR;

  let lead = '';
  let rows = '';
  if (giftR > 0) {
    lead = verdictLead(r, giftR);
    rows =
      `<ul class="otw-story">` +
      `<li><span>What you gave to charity</span><span class="otw-amt">${usd(giftR)}</span></li>` +
      // The "skips tax" clause is TRUE only in the standard-deduction world, where
      // §170(p) stacks on top of the flat amount and every deducted dollar really
      // does escape tax. On the itemizing branch the standard deduction was theirs
      // for free, so only the part of the list above it lowers any tax, and the
      // label ("Deductible on your list of deductions") already says all we can
      // honestly say about this row.
      `<li><span>${deductibleLabel(r)}${dedR > 0 && !r.itemize ? ' — the government skips tax on this' : ''}</span>` +
        `<span class="otw-amt${dedR > 0 ? ' otw-free' : ''}">${usd(dedR)}</span></li>` +
      (restR > 0
        ? `<li><span>The rest — ${restReason(s, r)}</span><span class="otw-amt otw-taxed">${usd(restR)}</span></li>`
        : '') +
      // Not part of the split above, so it carries the heavier rule that stops a
      // reader adding it in: the rows above are the giving itself, this one is
      // what deducting part of it is worth.
      `<li class="otw-after"><span>Federal income tax you don't pay because of it</span>` +
        `<span class="otw-amt${benefits ? ' otw-free' : ''}">${usd(r.taxSaved)}</span></li>` +
      `</ul>`;
  }

  // ---- The limits, each naming BOTH numbers -----------------------------------
  // The moment a limit binds, "what you gave" and "what you can deduct" stop being
  // the same number, and a sentence naming only one of them is how a screen ends up
  // reading "$1,000, your donation" over $2,500 of giving. Each of these is decided
  // from the DEDUCTION, never from "did any tax come back": giving can be trimmed
  // all the way to nothing and still show a $0 headline over a row claiming the
  // whole amount was deducted.
  let limits = '';
  if (r.itemize) {
    if (r.floorLost > 0 && r.charDeductible === 0) {
      limits += `<p class="otw-flag">Heads up: none of your ${usd(r.totalCharitableGift)} of giving is deductible. ` +
        `The first 0.5% of your income — ${usd(r.floor)} — is not deductible at all, and your giving is at or below it.</p>`;
    } else if (r.floorLost > 0) {
      limits += `<p class="otw-flag">Heads up: ${usd(r.charDeductible)} of your ${usd(r.totalCharitableGift)} of giving ` +
        `is deductible. The first 0.5% of your income — ${usd(r.floor)} — is not deductible at all, and only the giving ` +
        `above it counts.</p>`;
    }
    if (r.topBracketCap) {
      limits += `<p class="otw-flag">Heads up: you are in the top tax bracket, where a rule trims every deduction you ` +
        `list, not only your giving. It takes ${usd(r.s68Cut)} off your ${usd(r.itemizedTotal)} of listed deductions, so ` +
        `a deducted dollar is worth about 35 cents rather than 37.</p>`;
    }
  } else if (s.cashGift > r.nonItemizerCap) {
    limits += `<p class="otw-flag">Heads up: ${usd(r.nonItemizerDed)} of your ${usd(s.cashGift)} in cash giving counts ` +
      `toward this break. It stops at ${usd(r.nonItemizerCap)} a year, and it is one limit per return, so the rest earns ` +
      `nothing extra unless listing your deductions one by one beats your standard deduction.</p>`;
  }

  // The sentences a reader needs and does not otherwise get: when the money
  // arrives, that the paycheck and FICA are untouched, and — the one this page
  // exists to correct — that "you don't have to itemize" is NOT "it lowers your
  // AGI". They ride beside the good news rather than behind a tap.
  const plain = benefits
    ? `<div class="otw-plain">Skipping federal income tax on ${usd(r.charitableDeductible)} of your giving puts about ` +
      `${usd(r.taxSaved)} back in your pocket, as a bigger refund (or a smaller bill) when you file. Your paycheck during ` +
      `the year does not change, and Social Security and Medicare still come out of it as usual — this break touches ` +
      `federal income tax only. It also does not lower your AGI, so it will not change your Medicare IRMAA, an ACA ` +
      `subsidy, or how much of your Social Security is taxed.</div>`
    : `<div class="otw-plain">${zeroReason(s, r)}</div>`;

  return warnBox + head + lead + rows + limits + plain;
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'charitableWizard',
  read,
  compute,
  renderResult,

  // No when() anywhere: every visitor answers all five. The old page's two yes/no
  // gates asked whether a number applied; the cards ask for the number, and 0 is
  // the answer that means "not me".
  cards: [
    { step: GIFT, fields: ['cashGift'] },
    { step: GOODS, fields: ['nonCash'] },
    {
      step: INCOME,
      fields: ['agi'],
      // On the income card rather than a giving card: it is the second of the two
      // numbers, so it is the one being typed when the contradiction first exists.
      flags: [{ id: 'otwAgiFlag', text: giftWarning }]
    },
    { step: FILING, radios: 'filing' },
    { step: OTHER, fields: ['other'] },
    { step: RESULT, result: true }
  ],

  // The page loads with numbers nobody typed, so the answer stays labelled an
  // example until every figure it is built from is the visitor's own. #other is on
  // this list and has to be: it ships at 20,000, it is the single figure that
  // decides which of the two worlds wins, and $20,000 of state taxes and mortgage
  // interest is ordinary enough to be somebody's real year. Tapping "Nothing else"
  // counts as answering it — the core marks a chip's field touched by hand. Filing
  // status is not listed (a real default that is true for most visitors, and it
  // invents no figure), and neither is #nonCash: its 0 is the neutral "I gave only
  // money", not a figure we made up.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('cashGift')) missing.push('what you gave');
    if (!touched.has('agi')) missing.push('your income');
    if (!touched.has('other')) missing.push('your other write-offs');
    return missing;
  },

  chips: (s, r) => [
    { step: GIFT, label: `${usd(s.cashGift)} in cash` },
    { step: GOODS, label: s.nonCash > 0 ? `${usd(s.nonCash)} in goods` : 'no gifts of goods' },
    { step: INCOME, label: `${usd(s.agi)}/yr` },
    { step: FILING, label: FILING_WORDS[s.filing] || s.filing },
    { step: OTHER, label: s.other > 0 ? `${usd(s.other)} of other write-offs` : 'nothing else to write off' }
  ],

  announce: (s, r) => {
    const world = r.itemize
      ? 'Listing your deductions one by one wins this year, so your giving is claimed on Schedule A after the 0.5% floor.'
      : 'The flat standard deduction wins this year, so your giving counts as the break for people who do not list deductions.';
    return `Federal income tax saved by your giving: ${usd(r.taxSaved)}. ${world}` +
      (giftWarning(s) ? ' Check your numbers, there is a warning above the answer.' : '');
  }
});
