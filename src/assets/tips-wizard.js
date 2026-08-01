// tips-wizard.js — the card-by-card flow on /tips-tax-calculator/.
// Estimates the OBBBA "no tax on tips" (IRC §224) federal deduction and the tax
// it saves. All logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// form and is still served by tips-tax-calculator.js; the two must stay
// independent, so nothing here reads or writes an id the embed also ships except
// through its own page's DOM.
//
// FIRST CONVERSION ONTO wizard-core.js. Everything about "how a card flow
// behaves" — stepping, dots, focus, the 350 ms flag debounce, the polite status
// line, the example label, Start over, data-js last — lives in the core. What is
// left here is only what makes this the tips calculator: four questions, one call
// into the shared OBBBA engine, and the answer written out as a story.
//
// THE MATH is one engine call. estimate() caps the tips at the statutory $25,000,
// applies the MAGI phase-out, and returns the exact federal tax saved as
// (tax without the deduction) − (tax with it), so it is right across a bracket
// boundary rather than a flat marginal-rate guess.
import { estimate } from '/assets/obbba-deduction.js';
import { mountWizard, $, moneyOf, radioOf, selectOf, usd } from '/assets/wizard-core.js';

const OBBBA = window.__OBBBA__;
const FED = window.__FED__;
const STATES = window.__STATES__ || {};

// data-step on each card. RESULT is the last card and is never skipped.
const TIPS = 0, INCOME = 1, FILING = 2, STATE = 3, RESULT = 4;
const FILING_WORDS = { single: 'single', married: 'married, filing together', head_of_household: 'head of household' };

// ---- Reading the cards ------------------------------------------------------
function read() {
  return {
    tips: moneyOf('tips'),
    income: moneyOf('income'),
    filing: radioOf('filing', 'single'),
    state: selectOf('state')
  };
}

const compute = (s) => estimate({
  kind: 'tips', eligibleAmount: s.tips, grossAnnual: s.income,
  filingStatus: s.filing, federal: OBBBA, fed: FED
});

// ---- The one cross-check these four answers allow --------------------------
// The total is defined on its own card as "the whole year, tips included", so
// tips above it is not a large number, it is an impossible one. Never blocking:
// the answer still computes underneath, the doubt just travels with it, and it
// travels to BOTH places — the card that asks for the second of the two numbers
// and the answer, because a visitor who reaches the answer by pressing Next may
// never come back to the card.
function incomeWarning(s) {
  if (s.income <= 0 || s.tips <= 0) return '';
  if (s.tips <= s.income) return '';
  return `Check these numbers: the ${usd(s.tips)} you entered as tips is more than the ${usd(s.income)} you entered ` +
    `as your pay for the whole year, and that total is meant to include your tips. One of the two needs another look.`;
}

// ---- State conformity -------------------------------------------------------
function fillStates() {
  const sel = $('state');
  if (!sel) return;
  Object.keys(STATES)
    .filter((k) => k !== '_note' && STATES[k] && STATES[k].name)
    .map((slug) => ({ slug, name: STATES[slug].name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ slug, name }) => {
      const o = document.createElement('option');
      o.value = slug; o.textContent = name;
      sel.appendChild(o);
    });
}

const VERDICT = {
  yes: 'deductible on your state return too',
  no: 'still taxed by your state',
  unclear: 'not yet confirmed by the state',
  partial: 'a smaller capped state break',
  'n/a': '—'
};

// The core opens this helper the first time each state renders, because the
// visitor asked the question out loud on the card before it. Returning null
// hides it, which is what an unanswered state card should look like.
function stateParts(slug) {
  const e = STATES[slug];
  if (!e) return null;
  if (!e.hasWageTax) {
    return {
      summary: `What about my state? ${e.name} doesn't tax wages, so nothing to do`,
      body: `<strong>${e.name}:</strong> no state income tax on wages, so the federal saving above is the whole story.`
    };
  }
  const y25 = e.tips.y2025, y26 = e.tips.y2026;
  return {
    summary: `What about my state? ${e.name}`,
    body: `<strong>Tips deduction in ${e.name}:</strong> ` +
      `2025 — ${VERDICT[y25] || y25}; 2026–2028 — ${VERDICT[y26] || y26}.` +
      `<div class="otw-note">${e.note}</div>`
  };
}

// ---- The answer -------------------------------------------------------------
function zeroBenefitNote(r) {
  if (r.eligibleAmount <= 0) return 'Enter your tips to see your federal tax saving.';
  if (r.fullyPhasedOut) {
    return 'Your income is high enough that the deduction is fully phased out, so there is nothing to deduct this year.';
  }
  return 'With these numbers there is no federal tax to save this year.';
}

function renderResult({ state: s, result: r }) {
  const warning = incomeWarning(s);
  const warnBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  const benefits = r.taxSaved > 0;
  const head =
    `<p class="otw-kick">When you file your taxes next year</p>` +
    `<p class="otw-big${benefits ? '' : ' otw-zero'}">${usd(r.taxSaved)}</p>`;

  // Does a limit bite? Asked of the DEDUCTION, never of "did any tax come back":
  // tips can be capped all the way down to nothing (income past the phase-out)
  // and still produce taxSaved = 0, and gating this on the saving left that
  // screen showing a $0 headline above a row claiming the whole amount came off
  // the taxable income.
  const capBinds = r.eligibleAmount > 0 && r.eligibleAmount > r.allowedCap;
  const limitWord = r.phasedOut ? 'the income phase-out' : `the ${usd(r.statutoryCap)} yearly limit`;

  // ---- The story ------------------------------------------------------------
  // ROUNDED ONCE. The labels invite the reader to add the lower rows up to the
  // top one, so they have to add up: the "still taxed" row is DERIVED by
  // subtraction from the two rounded figures above it rather than rounded on its
  // own, which is the only way $18,000 = $17,999.50 + $0.50 cannot print as
  // $18,000 = $18,000 + $1.
  let lead = '';
  let rows = '';
  if (r.eligibleAmount > 0) {
    const tipsR = Math.round(r.eligibleAmount);
    const dedR = Math.round(r.deduction);
    const taxedR = tipsR - dedR;
    lead = `<p class="otw-lead">Here is what happens to your ${usd(tipsR)} in tips:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>The tips you were paid</span><span class="otw-amt">${usd(tipsR)}</span></li>` +
      `<li><span>Taken off the income you are taxed on${dedR > 0 ? ' — the government skips tax on this' : ''}</span>` +
        `<span class="otw-amt${dedR > 0 ? ' otw-free' : ''}">${usd(dedR)}</span></li>` +
      (taxedR > 0
        ? `<li><span>The rest, above ${limitWord} — taxed as usual</span><span class="otw-amt otw-taxed">${usd(taxedR)}</span></li>`
        : '') +
      // Not part of the split above, so it carries the heavier rule that stops a
      // reader adding it in: the first rows are the tips themselves, this one is
      // what skipping tax on them is worth.
      `<li class="otw-after"><span>Federal tax you don't pay because of it</span>` +
        `<span class="otw-amt${benefits ? ' otw-free' : ''}">${usd(r.taxSaved)}</span></li>` +
      `</ul>`;
  }

  // ---- The limit, named with BOTH numbers ------------------------------------
  // The tips and the deductible amount stop being the same number the moment the
  // cap or the phase-out binds, and a sentence naming only one of them is how a
  // screen ends up reading "$25,000, the tips you were paid" over $31,000 of
  // tips. Every sentence here names both. The fully-phased-out case is left to
  // the plain box below, which explains the $0 rather than announcing a cap that
  // dropped to nothing.
  let capFlag = '';
  if (capBinds && !r.fullyPhasedOut) {
    capFlag = `<p class="otw-flag">Heads up: ${usd(r.deduction)} of your ${usd(r.eligibleAmount)} in tips is deductible. ` +
      (r.phasedOut
        ? `Your income is above the phase-out threshold, so your cap drops to ${usd(r.allowedCap)}`
        : `This deduction stops at ${usd(r.statutoryCap)} a year, and it is one limit per return, never doubled for a couple`) +
      `, and the rest of your tips are taxed as usual.</p>`;
  } else if (benefits && r.phasedOut && !r.fullyPhasedOut) {
    capFlag = `<p class="otw-flag">Heads up: your income is above the phase-out threshold, so your deductible cap is ` +
      `lowered to ${usd(r.allowedCap)}.</p>`;
  }

  // The three sentences the benchmark readers needed and did not get: when the
  // money arrives, that FICA is untouched, and that the paycheck does not change.
  // They ride beside the good news rather than behind a tap, because with them
  // hidden both personas said they would have left believing tips were tax-free
  // outright.
  const plain = benefits
    ? `<div class="otw-plain">Skipping federal tax on ${usd(r.deduction)} of tips puts about ${usd(r.taxSaved)} back in ` +
      `your pocket, as a bigger refund (or a smaller bill) when you file. Social Security and Medicare are still owed ` +
      `on all of your tips, and your paycheck during the year does not change.</div>`
    : `<div class="otw-plain">${zeroBenefitNote(r)}</div>`;

  return warnBox + head + lead + rows + capFlag + plain;
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'tipsWizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: TIPS, fields: ['tips'] },
    {
      step: INCOME,
      fields: ['income'],
      // On the income card rather than the tips card: it is the second of the two
      // numbers, so it is the one being typed when the contradiction first exists.
      flags: [{ id: 'otwIncomeFlag', text: incomeWarning }]
    },
    { step: FILING, radios: 'filing' },
    { step: STATE, fields: ['state'], skipClears: ['state'] },
    { step: RESULT, result: true }
  ],

  stateNote: { box: 'otwStateNote', select: 'state', render: stateParts },

  // The page loads with numbers nobody typed, so the answer stays labelled an
  // example until BOTH figures it is built from are the visitor's own. Clearing
  // it on the first edit presented an answer still made of our invented income as
  // theirs, and $45,000 a year with $18,000 in tips is ordinary enough to be
  // somebody's real pay. Filing status and state are not listed: both have a real
  // default that is true for most visitors, and neither invents a figure.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('tips')) missing.push('your tips');
    if (!touched.has('income')) missing.push('your yearly pay');
    return missing;
  },

  chips: (s, r) => [
    { step: TIPS, label: `${usd(s.tips)} in tips` },
    { step: INCOME, label: `${usd(s.income)}/yr` },
    { step: FILING, label: FILING_WORDS[s.filing] || s.filing },
    { step: STATE, label: s.state && STATES[s.state] ? STATES[s.state].name : 'no state' }
  ],

  announce: (s, r) => {
    const capSpoken = r.eligibleAmount > 0 && r.eligibleAmount > r.allowedCap
      ? ` Your ${usd(r.eligibleAmount)} in tips is limited to ${usd(r.deduction)} deductible ${r.phasedOut ? 'by the income phase-out' : 'by the yearly cap'}.`
      : '';
    return `Federal tax saved on your tips: ${usd(r.taxSaved)}.${capSpoken}` +
      (incomeWarning(s) ? ' Check your numbers, there is a warning above the answer.' : '');
  },

  // Before the snapshot so Start over restores the empty option this page ships
  // with, not whichever state was chosen since.
  onBeforeSnapshot: fillStates
});
