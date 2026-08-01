// employer-student-loan-repayment-wizard.js — the card-by-card flow on
// /employer-student-loan-repayment-calculator/.
//
// Works out what an employer's IRC §127 educational-assistance benefit is worth
// when it goes on the employee's student loans: the federal income tax and the
// FICA the employee never pays, the matching FICA the employer never pays, and
// the ways the shared $5,250 cap, the Social Security wage base and a
// non-conforming state cut into it. All logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// #s127Form and is still served by employer-student-loan-repayment-calculator.js;
// the two must stay independent, so nothing here reads or writes an id the embed
// also ships except through its own page's DOM.
//
// WHAT MAKES THIS PAGE DIFFERENT FROM THE OTHER CONVERSIONS. It had the most
// gates in the family: three stacked yes/no questions, each hiding one to two
// more fields. They became ONE card (data-step 2) carrying three checkboxes, and
// each checkbox decides whether its follow-up cards are on the visitor's path.
// Tick nothing and the flow is three questions and the answer, which is shorter
// than the old page's two fields plus a fieldset of gates. Tick all three and it
// is eight questions, which is what that visitor's situation actually costs.
//
// AND THE PARKING RULE THAT CAME WITH THEM. question-flow.js, which used to run
// this page, did not merely hide a No-answered field: it parked that field at a
// neutral value so an unanswered question could never feed the engine.
// wizard-core.js does no such thing — a card off the path is still in the DOM
// with its value intact. So read() below gates every optional value on its own
// checkbox and hands the engine 0 / 'single' while the box is unticked. That is
// the whole reason an off-path default cannot leak into the answer, and it is
// why #wages can now ship 130,000 rather than the old 60,000: the field is dead
// until "I will earn more than about $120,000 this year" is ticked, and 130,000
// is the only starting figure that does not contradict the sentence the visitor
// just agreed with.
//
// THE MATH is one engine call. computeSection127() applies the shared $5,250 cap
// (tuition-type assistance first, loan repayment into whatever room is left),
// the wage-base and Additional-Medicare straddles, and the state conformity
// leg. Every dollar figure and rate comes from src/data/section-127-2026.json
// through window.__SECTION127__ — nothing statutory is hard-coded here.
import { computeSection127 } from '/assets/section-127.js';
import { mountWizard, $, moneyOf, numOf, radioOf, selectOf, usd, count } from '/assets/wizard-core.js';

const PARAMS = window.__SECTION127__ || {};

// data-step on each card. RESULT is the last card and is never skipped.
const BENEFIT = 0, RATE = 1, EXTRAS = 2, TUITION = 3, PAY = 4, FILING = 5,
      STATERATE = 6, STATECONFORM = 7, RESULT = 8;

const FILING_WORDS = {
  single: 'filing on my own',
  marriedJoint: 'married, one return',
  marriedSeparate: 'married, separate returns'
};

// The two numbers the guards below quote back. Both are the page's own figures,
// not new ones: $120,000 is the threshold the checkbox itself names, and 13.3%
// is the top California rate the state helper and the California section quote.
const HIGH_PAY_MARK = 120000;
const TOP_STATE_RATE = 13.3;

const checked = (id) => { const el = $(id); return !!(el && el.checked); };
// usd() clamps at zero, which is right for every figure on this page except a
// total that a punitive state rate has pushed negative. Composed from the shared
// formatter rather than re-derived so the thousands separator stays one decision.
const signedUsd = (n) => (n < 0 ? '−' + usd(-n) : usd(n));
const asPct = (n) => count(n) + '%';

// ---- Reading the cards ------------------------------------------------------
// Every optional value is gated on its own checkbox. See the parking-rule note
// in the header: without this, the shipped 130,000 in #wages would silently
// reach the engine for a visitor who never said they were a high earner.
function read() {
  const hasTuition = checked('hasTuition');
  const hasHighPay = checked('hasHighPay');
  const hasStateTax = checked('hasStateTax');
  return {
    benefit: moneyOf('loanRepaymentBenefit'),
    fedRate: parseFloat(selectOf('marginalFedRate')) || 0,
    hasTuition,
    hasHighPay,
    hasStateTax,
    tuition: hasTuition ? moneyOf('tuitionAssistanceUsed') : 0,
    wages: hasHighPay ? moneyOf('wages') : 0,
    filing: hasHighPay ? radioOf('filingStatus', 'single') : 'single',
    stateRate: hasStateTax ? numOf('stateMarginalRate') : 0,
    stateConforms: radioOf('stateConforms', 'yes') !== 'no'
  };
}

const compute = (s) => computeSection127({
  loanRepaymentBenefit: s.benefit,
  tuitionAssistanceUsed: s.tuition,
  marginalFedRate: s.fedRate,
  wages: s.wages,
  filingStatus: s.filing,
  stateMarginalRate: s.stateRate / 100,
  stateConforms: s.stateConforms,
  params: PARAMS
});

// ---- The two cross-checks these answers allow -------------------------------
// Neither blocks. The answer still computes underneath and the doubt travels
// with it, to BOTH places: the card that asks for the second of the two numbers
// (where the visitor is standing when the contradiction first exists) and the
// answer, because a visitor who presses Next may never come back to the card.

// The visitor has just agreed with a sentence that names $120,000, then typed a
// figure that cannot be it. Which of the two is wrong is genuinely unknowable
// from here, so the flag names both and offers the two ways out.
function payWarning(s) {
  if (!s.hasHighPay || s.wages <= 0) return '';
  const total = s.wages + s.benefit;
  if (total >= HIGH_PAY_MARK) return '';
  return `Check these numbers: you ticked "I will earn more than about ${usd(HIGH_PAY_MARK)} this year", but ` +
    `${usd(s.wages)} of pay plus ${usd(s.benefit)} of loan help comes to ${usd(total)}. Either the pay figure needs ` +
    `another look, or you can go back and untick that box — under about ${usd(HIGH_PAY_MARK)} it changes nothing.`;
}

// A state rate above every state's top rate is almost always the federal rate
// typed into the wrong box, and it is the one entry here that can push the whole
// answer negative, so it says which box it wants.
function stateRateWarning(s) {
  if (!s.hasStateTax || s.stateRate <= TOP_STATE_RATE) return '';
  return `Check this number: ${asPct(s.stateRate)} is higher than any state's top income-tax rate — California's ` +
    `${asPct(TOP_STATE_RATE)} is the highest there is. If you typed your federal rate by mistake, that one belongs in ` +
    `the tax-bracket question instead.`;
}

const warningsFor = (s) => [payWarning(s), stateRateWarning(s)].filter(Boolean);

// ---- The answer -------------------------------------------------------------
// Names the reason, not a generic nothing-to-see line: "fill in your benefit"
// over a filled-in form names the wrong problem.
function zeroReason(s, r) {
  if (s.benefit <= 0) {
    return 'Enter what your employer is putting toward your student loans to see what it saves you.';
  }
  if (r.excludedLoan <= 0 && s.tuition > 0) {
    return `Your employer's tuition help has already used ${usd(r.excludedTuition)} of the ${usd(r.cap)} allowed for ` +
      `the year, so there is no room left for tax-free loan repayment. The ${usd(s.benefit)} it puts toward the loan ` +
      `still reaches you, it is just paid as ordinary taxable pay.`;
  }
  if (r.empTotalSaved < 0) {
    return `With these numbers the state income tax you still owe on the benefit is more than the federal tax you ` +
      `skip, so it costs you ${usd(-r.empTotalSaved)} rather than saving you anything. Check the state rate above.`;
  }
  return 'With these numbers there is nothing to save this year.';
}

function renderResult({ state: s, result: r }) {
  if (!r || r.error) {
    return '<div class="otw-plain">' + ((r && r.notes && r.notes[0]) || 'Calculator data failed to load.') + '</div>';
  }

  const warnBox = warningsFor(s).map((w) => `<div class="ot-input-warning">${w}</div>`).join('');

  const totalR = Math.round(r.empTotalSaved);
  const benefits = r.excludedLoan > 0 && totalR > 0;
  const head =
    `<p class="otw-kick">Compared with getting the same money as taxable pay</p>` +
    `<p class="otw-big${benefits ? '' : ' otw-zero'}">${signedUsd(totalR)}</p>`;

  // ---- Story one: where the money your employer pays actually goes ----------
  // ROUNDED ONCE. The labels invite the reader to add the lower rows up to the
  // top one, so the taxable row is DERIVED by subtraction from the two rounded
  // figures above it rather than rounded on its own — the only way $5,250 =
  // $2,250 + $3,000 cannot print as $5,250 = $2,250 + $2,999.
  let lead = '';
  let rows = '';
  if (s.benefit > 0) {
    const benefitR = Math.round(s.benefit);
    const freeR = Math.round(r.excludedLoan);
    const taxedR = benefitR - freeR;
    lead = `<p class="otw-lead">Here is what happens to the ${usd(benefitR)} your employer puts toward your loans:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>Paid to your lender, or paid back to you</span><span class="otw-amt">${usd(benefitR)}</span></li>` +
      `<li><span>Tax-free${freeR > 0 ? ' — no income tax, no Social Security, no Medicare' : ''}</span>` +
        `<span class="otw-amt${freeR > 0 ? ' otw-free' : ''}">${usd(freeR)}</span></li>` +
      (taxedR > 0
        ? `<li><span>The rest, over the ${usd(r.cap)} limit${r.excludedTuition > 0 ? ' you share with tuition help' : ''} ` +
          `— paid to you as ordinary taxable pay</span>` +
          `<span class="otw-amt otw-taxed">${usd(taxedR)}</span></li>`
        : '') +
      `</ul>`;
  }

  // ---- The limit, named with BOTH numbers ----------------------------------
  // Decided from the EXCLUSION, never from "did any tax come back": tuition can
  // eat the whole cap and leave excludedLoan at zero while the benefit figure is
  // untouched, and a sentence naming only one of the two is how a screen ends up
  // reading "$5,250 tax-free" over $8,000 of loan help. The zero case is left to
  // the plain box, which explains the $0 rather than announcing a limit that
  // dropped to nothing.
  let capFlag = '';
  if (r.loanExcess > 0 && r.excludedLoan > 0) {
    capFlag = `<p class="otw-flag">Heads up: ${usd(r.excludedLoan)} of the ${usd(s.benefit)} your employer is putting ` +
      `toward your loans is tax-free. ` +
      (r.excludedTuition > 0
        ? `Classes and loans share one ${usd(r.cap)} limit for the year and ${usd(r.excludedTuition)} of it has already ` +
          `gone on your tuition`
        : `This stops at ${usd(r.cap)} a year, and it is one limit per person across every employer, never doubled`) +
      `, so the other ${usd(r.loanExcess)} is paid to you as ordinary taxable pay.</p>`;
  }

  // ---- Story two: what skipping tax on it is worth -------------------------
  // The headline IS this total, so it is not repeated as a row; the rows are the
  // parts it is made of and they must therefore add up to it. The FICA row is
  // DERIVED by subtraction from the already-rounded others for exactly that
  // reason — three independent Math.round()s do not reconcile.
  // Suppressed at a rounded zero rather than at excludedLoan === 0: a $1 benefit
  // is excluded in full and saves 30 cents, and printing "$0 is made up of $0
  // and $0" says nothing the plain box below does not say better.
  let lead2 = '';
  let rows2 = '';
  if (r.excludedLoan > 0 && totalR !== 0) {
    const incomeR = Math.round(r.empIncomeTaxSaved);
    const stateSavR = Math.round(r.empStateSaved);
    const stateCostR = Math.round(r.stateTaxCost);
    const ficaR = totalR - incomeR - stateSavR + stateCostR;
    lead2 = `<p class="otw-lead">That ${signedUsd(totalR)} is made up of:</p>`;
    rows2 =
      `<ul class="otw-story">` +
      `<li><span>Federal income tax you do not pay</span><span class="otw-amt otw-free">${usd(incomeR)}</span></li>` +
      `<li><span>Social Security and Medicare you do not pay</span><span class="otw-amt otw-free">${usd(ficaR)}</span></li>` +
      (stateSavR > 0
        ? `<li><span>State income tax you do not pay, because your state follows the federal rule</span>` +
          `<span class="otw-amt otw-free">${usd(stateSavR)}</span></li>`
        : '') +
      (stateCostR > 0
        ? `<li><span>Less the state income tax you still owe, because your state does not</span>` +
          `<span class="otw-amt otw-taxed">−${usd(stateCostR)}</span></li>`
        : '') +
      `</ul>`;
  }

  // ---- The wage-base straddle, also named with BOTH numbers ----------------
  // The "employee saves 7.65%" headline is simply wrong above the Social
  // Security wage base, and partly wrong for the slice that straddles it.
  let ficaFlag = '';
  if (r.excludedLoan > 0 && PARAMS.ficaWageBase) {
    const fullOasdi = r.excludedLoan * (PARAMS.oasdiRate || 0);
    if (r.aboveWageBase) {
      // 2.35% rather than 1.45% once the 0.9% Additional Medicare surtax is in
      // play, which is the page's own FAQ wording. Quoting the flat 1.45% at a
      // visitor whose pay is past their surtax line understates their saving.
      ficaFlag = `<p class="otw-flag">Your pay is already past the ${usd(PARAMS.ficaWageBase)} Social Security wage ` +
        `base, so the 6.2% Social Security part does not apply here: the payroll tax you save is Medicare only, ` +
        (r.empAddlMedicareSaved > 0 ? '1.45% plus the 0.9% surtax you are into, so 2.35%' : '1.45%') +
        `, not the full 7.65%. Your employer's saving drops the same way, and it never matched the 0.9% anyway.</p>`;
    } else if (fullOasdi - r.empOasdiSaved > 1) {
      ficaFlag = `<p class="otw-flag">Your pay crosses the ${usd(PARAMS.ficaWageBase)} Social Security wage base part ` +
        `way through this benefit, so only ${usd(r.empOasdiSaved)} of the 6.2% Social Security saving applies instead ` +
        `of ${usd(fullOasdi)}. Medicare's 1.45% applies to all of it.</p>`;
    }
  }

  // The employer's side is real money but it is not the visitor's, so it is a
  // sentence rather than a row: a row invites adding it to the column above it.
  const employerNote = r.erFicaSaved > 0
    ? `<p class="otw-note">Your employer saves ${usd(r.erFicaSaved)} as well — it skips its own matching Social ` +
      `Security and Medicare on the ${usd(r.totalExcluded)} it keeps out of your pay, which is the whole of its side ` +
      `of this. That is the difference versus handing you the same money as a bonus.</p>`
    : '';

  // ---- The plain box -------------------------------------------------------
  // This is NOT a filing-time deduction, so it must not carry the "bigger refund
  // when you file, FICA still owed" note the deduction tools carry — here the
  // opposite is true on both counts, and that difference is the single most
  // load-bearing thing on the page.
  const plain = benefits
    ? `<div class="otw-plain">This is not money you get back at tax time. Your employer pays the lender, or pays you ` +
      `back, and the amount never counts as pay in the first place — so no federal income tax and no Social Security ` +
      `or Medicare come out of it, and there is nothing to claim on your tax return. Because it never counts as pay, ` +
      `it also keeps the income on your W-2 lower, which helps anything else worked out from your income.</div>`
    : `<div class="otw-plain">${zeroReason(s, r)}</div>`;

  // The engine's other two notes are dropped on purpose: the California one says
  // in statute language what the conformity card and the "state still owes" row
  // above already say in plain words, and the multiple-employers one cannot fire
  // because this page never sets that flag. The indexing note is kept because it
  // is the only thing on the page that could say the cap on screen is a
  // placeholder, and it starts firing on its own the year the dataset rolls to
  // 2027 without an official figure.
  const pendingNote = r.capPending
    ? (r.notes || []).map((n) => `<p class="otw-note">${n}</p>`).join('')
    : '';

  return warnBox + head + lead + rows + capFlag + lead2 + rows2 + ficaFlag + employerNote + plain + pendingNote;
}

// ---- The Next buttons name where they lead ----------------------------------
// The last question on the path says "See my answer", every other one says
// "Next". Which card is last changes with the checkboxes on card 2, so it cannot
// be written into the markup: with all three unticked the last question is card
// 2 itself, with all three ticked it is card 7. The shipped labels are the
// all-three-ticked case, and they are never seen without JavaScript anyway,
// because .otw-nav is display:none until data-js="on".
function labelNav({ wizard }) {
  const path = wizard.path();
  const last = path.length > 1 ? path[path.length - 2] : null;
  const stage = $('s127Wizard');
  if (!stage || last == null) return;
  stage.querySelectorAll('.otw-card').forEach((card) => {
    const next = card.querySelector('.otw-next');
    if (!next) return;
    next.textContent = Number(card.dataset.step) === last ? 'See my answer' : 'Next';
  });
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 's127Wizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: BENEFIT, fields: ['loanRepaymentBenefit'] },
    { step: RATE, fields: ['marginalFedRate'] },
    // The card that replaced three stacked yes/no gates. Its three checkboxes
    // are the when() predicates for every card after it.
    // focus() by hand: this card has no .otw-in and no radio group, so the core's
    // default lands on the heading rather than on anything a visitor can operate.
    {
      step: EXTRAS,
      fields: ['hasTuition', 'hasHighPay', 'hasStateTax'],
      focus: (el) => el.querySelector('input[type="checkbox"]')
    },
    { step: TUITION, fields: ['tuitionAssistanceUsed'], when: (s) => s.hasTuition },
    {
      step: PAY,
      fields: ['wages'],
      when: (s) => s.hasHighPay,
      // On the pay card rather than the checkbox card: the pay figure is the
      // second of the two numbers, so it is the one being typed when the
      // contradiction with the ticked box first exists.
      flags: [{ id: 'otwWagesFlag', text: payWarning }]
    },
    { step: FILING, radios: 'filingStatus', when: (s) => s.hasHighPay },
    {
      step: STATERATE,
      fields: ['stateMarginalRate'],
      when: (s) => s.hasStateTax,
      // Skip here means "leave my state out of it", and clearing the rate also
      // drops the conformity card off the path by itself, so nothing the visitor
      // asked for is lost by jumping to the answer from here.
      skipClears: ['stateMarginalRate'],
      flags: [{ id: 'otwStateRateFlag', text: stateRateWarning }]
    },
    // Only worth asking once there is a rate for the answer to differ on.
    { step: STATECONFORM, radios: 'stateConforms', when: (s) => s.hasStateTax && s.stateRate > 0 },
    { step: RESULT, result: true }
  ],

  // The page loads with numbers nobody typed, so the answer stays labelled an
  // example until every figure it is built from is the visitor's own. It is not
  // cleared on the first edit to any one of them: $5,250 at 22% is the exact
  // headline case this page is about, which makes it the easiest example figure
  // in the family to mistake for your own answer. The checkboxes and the two
  // radio groups are not listed — none of them invents a figure, and each has a
  // default that is true for most visitors.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('loanRepaymentBenefit')) missing.push('what your employer is putting in');
    if (!touched.has('marginalFedRate')) missing.push('your tax bracket');
    if (s.hasHighPay && !touched.has('wages')) missing.push('the rest of your pay');
    return missing;
  },

  chips: (s, r) => {
    const picked = [
      s.hasTuition ? 'tuition too' : '',
      s.hasHighPay ? 'higher pay' : '',
      s.hasStateTax ? 'state tax' : ''
    ].filter(Boolean);
    const items = [
      { step: BENEFIT, label: `${usd(s.benefit)} from your employer` },
      { step: RATE, label: `${asPct(s.fedRate * 100)} bracket` },
      { step: EXTRAS, label: picked.length ? picked.join(' + ') : 'nothing else applies' }
    ];
    // Only cards this visitor is actually walking: a chip pointing at an
    // off-path card would hand off forward and land somewhere else.
    if (s.hasTuition) items.push({ step: TUITION, label: `${usd(s.tuition)} on tuition` });
    if (s.hasHighPay) {
      items.push({ step: PAY, label: `${usd(s.wages)} other pay` });
      items.push({ step: FILING, label: FILING_WORDS[s.filing] || s.filing });
    }
    if (s.hasStateTax) {
      items.push({ step: STATERATE, label: `${asPct(s.stateRate)} state tax` });
      if (s.stateRate > 0) {
        items.push({ step: STATECONFORM, label: s.stateConforms ? 'state leaves it alone' : 'state still taxes it' });
      }
    }
    return items;
  },

  announce: (s, r) => {
    if (!r || r.error) return '';
    const capSpoken = r.loanExcess > 0
      ? ` Only ${usd(r.excludedLoan)} of the ${usd(s.benefit)} fits under the ${usd(r.cap)} limit for the year; the rest is taxed as ordinary pay.`
      : '';
    return `What this benefit saves you: ${signedUsd(Math.round(r.empTotalSaved))}.${capSpoken}` +
      (warningsFor(s).length ? ' Check your numbers, there is a warning above the answer.' : '');
  },

  onRender: labelNav,

  // Start over means start over, and the core restores values, not checked
  // states: a checkbox's value is the string "on" whether it is ticked or not,
  // so unticking these three is this tool's own job. Without it a restart landed
  // on card 1 with the extra cards still on the path.
  onReset: () => {
    ['hasTuition', 'hasHighPay', 'hasStateTax'].forEach((id) => {
      const el = $(id);
      if (el) el.checked = false;
    });
  }
});
