// dependent-care-fsa-vs-credit-wizard.js — the card-by-card flow on
// /dependent-care-fsa-vs-credit-calculator/.
//
// Compares the two 2026 childcare tax breaks under OBBBA §70404: a Dependent
// Care FSA (§129, up to $7,500 / $3,750 on separate returns, pre-tax so it saves
// income tax AND FICA) against the Child & Dependent Care Credit (§21,
// nonrefundable, 50%→20% by income, on up to $3,000 / $6,000 of care costs). All
// logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// #dcForm and is still served by dependent-care-fsa-vs-credit-calculator.js, so
// nothing here reads or writes an id the embed also ships except through its own
// page's DOM.
//
// WHAT IS TOOL-SPECIFIC HERE. Stepping, dots, focus, the 350 ms flag debounce,
// the polite status line, the example label, Start over and data-js-last all live
// in wizard-core.js. What is left is six questions, one call into the shared
// dependent-care engine, and an answer card that has to do something the rest of
// the family does not: show BOTH options, not one.
//
// THE ANSWER IS A CORNER, NEVER A SPLIT. §21(c) cuts the credit's expense cap
// dollar-for-dollar by every dollar excluded through the FSA, so total benefit is
// linear in the FSA amount and the best answer is always an endpoint. The engine
// computes both endpoints exactly; this file's job is to put them side by side
// with the margin between them and say, in plain words, that there is no middle.
//
// ONE ROUNDING, EVERYWHERE. Every figure on the answer card is quoted from the
// integers computed once in summarise(): the FSA total is the SUM of its three
// rounded parts (so the breakdown adds up to the headline), and the margin is
// DERIVED by subtracting the two rounded totals (so a reader who subtracts the
// two compare rows gets the row underneath them). Rounding each of those three
// separately is how $2,374 = $1,800 + $574 prints as $2,375.
import { dependentCareComparison, dcfsaLimit } from '/assets/dependent-care.js';
import { mountWizard, moneyOf, radioOf, usd, pct } from '/assets/wizard-core.js';

const DC = window.__DC__;
const FED = window.__FED__;

// data-step on each card. RESULT is the last card and is never skipped.
const KIDS = 0, EXPENSES = 1, AGI = 2, FILING = 3, HASFSA = 4, FSAMAX = 5, RESULT = 6;

const FILING_WORDS = {
  married: 'joint return',
  single: 'single',
  head_of_household: 'head of household',
  married_separate: 'separate returns'
};

// ---- Reading the cards ------------------------------------------------------
function read() {
  const filing = radioOf('filing', 'married');
  const hasFsa = radioOf('hasFsa', 'yes');
  const planMax = moneyOf('employerFsa');
  return {
    kids: radioOf('kids', '2'),
    expenses: moneyOf('expenses'),
    agi: moneyOf('agi'),
    filing,
    hasFsa,
    planMax,
    // A No ZEROES the amount rather than merely hiding its card. The box ships
    // pre-filled at 7,500 and the card it lives on stays in the document (the
    // no-JS stack is the form), so reading the field regardless of the answer
    // would have computed a full FSA for somebody whose job offers none. This is
    // the same trap the old [data-reveal] wrapper solved by parking the value.
    employerFsa: hasFsa === 'yes' ? planMax : 0
  };
}

const compute = (s) => dependentCareComparison({
  filingStatus: s.filing,
  agi: s.agi,
  numDependents: s.kids === '1' ? 1 : 2,
  careExpenses: s.expenses,
  employerFsaMax: s.employerFsa,
  dc: DC, fed: FED
});

// ---- The two cross-checks these answers allow ------------------------------
// Never blocking: the answer still computes underneath, the doubt just travels
// with it, and it travels to BOTH places — the card that asks for the second of
// the two numbers, and the answer, because a visitor who presses Next may never
// come back to the card.

// The care bill above the household's whole year of income. Not a large number,
// an impossible one: both breaks are capped at what you actually earn (§129(b),
// §21(d)), so the engine silently limits everything to the income figure and the
// answer would otherwise look arbitrarily small with no explanation.
function careWarning(s) {
  if (s.expenses <= 0 || s.agi <= 0) return '';
  if (s.expenses <= s.agi) return '';
  return `Check these numbers: the ${usd(s.expenses)} you entered for care is more than the ${usd(s.agi)} your ` +
    `household makes in a whole year. Both of these breaks stop at what you actually earn, so one of the two needs another look.`;
}

// A plan allowance above what the law permits. The engine clamps it silently, so
// without this the card accepts 10,000 and the answer quietly uses 7,500.
function planWarning(s) {
  if (s.hasFsa !== 'yes' || s.planMax <= 0) return '';
  const cap = dcfsaLimit(s.filing, DC.dcfsa);
  if (s.planMax <= cap) return '';
  const why = s.filing === 'married_separate'
    ? ', because you and your husband or wife each send in your own return'
    : ' (it is halved to $3,750 if you each send in your own return)';
  return `The law stops this at ${usd(cap)} a year${why}, so the ${usd(s.planMax)} you entered is treated as ${usd(cap)}.`;
}

// ---- One rounding, shared by the card and the spoken sentence --------------
function summarise(s, r) {
  const A = r.strategyA, B = r.strategyB;

  const creditTotal = Math.round(A.credit);
  const fsaTax = Math.round(B.fsaIncomeTaxSaved);
  const fsaFica = Math.round(B.fsaFicaSaved);
  const fsaLeft = Math.round(B.credit);
  const fsaTotal = fsaTax + fsaFica + fsaLeft;   // the sum, so the breakdown adds up
  const margin = Math.abs(fsaTotal - creditTotal); // derived, never rounded on its own

  // Nothing to compare until both of the figures the comparison is built from
  // exist. Checked before the winner, because with either at zero BOTH corners
  // are zero and "too close to call" would name the wrong reason.
  const nothing = s.expenses <= 0 || s.agi <= 0;
  // No employer plan is a structural answer, not a close race: the engine sets
  // both corners to the same credit in that case, which would read as a tie.
  // blankPlan is the SAME arithmetic for a different reason — a visitor who
  // answered Yes and then emptied the amount box — and it has to be told apart,
  // because "your job has no plan" over a Yes names the wrong problem.
  const noPlan = !r.hasEmployerPlan;
  const blankPlan = noPlan && s.hasFsa === 'yes';
  const fsaWins = !nothing && !noPlan && fsaTotal > creditTotal;
  const creditWins = !nothing && (noPlan || creditTotal > fsaTotal);
  const tie = !nothing && !noPlan && fsaTotal === creditTotal;

  // A winner is only declared when both sides were actually measured. Naming one
  // while the plan box sits empty announces a race one runner never entered.
  let verdict = 'Neither, yet';
  const decided = !nothing && !blankPlan && (fsaWins || creditWins);
  if (!nothing && !blankPlan) {
    if (fsaWins) verdict = 'The FSA at work';
    else if (creditWins) verdict = 'The tax credit';
    else verdict = 'Too close to call';
  }

  return { A, B, creditTotal, fsaTax, fsaFica, fsaLeft, fsaTotal, margin, nothing, noPlan, blankPlan, fsaWins, creditWins, tie, decided, verdict };
}

function joinWords(list) {
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

function missingReason(s) {
  const missing = [];
  if (s.expenses <= 0) missing.push('what you pay for care in a year');
  if (s.agi <= 0) missing.push('what your household makes in a year');
  return `Fill in ${joinWords(missing)} and the tool will work out which of the two is worth more to you. ` +
    `Neither one is worth anything until both of those figures are on screen.`;
}

// ---- The answer -------------------------------------------------------------
function renderResult({ state: s, result: r }) {
  const v = summarise(s, r);
  const A = v.A, B = v.B;

  const warning = careWarning(s);
  const warnBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  const head =
    `<p class="otw-kick">Your better move for 2026</p>` +
    `<p class="otw-big${v.decided ? '' : ' otw-zero'}">${v.verdict}</p>`;

  // ---- The lead: which corner, by how much, and that there is no middle ----
  let lead = '';
  if (v.nothing) {
    lead = '';
  } else if (v.blankPlan) {
    lead = `<p class="otw-lead">You said your job lets you set money aside, but the amount box is empty, so there is ` +
      `nothing to weigh against the credit yet. Here is what the credit alone does with your ${usd(s.expenses)} care bill:</p>`;
  } else if (v.noPlan) {
    lead = `<p class="otw-lead">Your job has no plan to set money aside in, so the childcare credit is the only one of ` +
      `the two you can use. Here is what it does with your ${usd(s.expenses)} care bill:</p>`;
  } else if (v.tie) {
    lead = `<p class="otw-lead">On your ${usd(s.expenses)} care bill the two land on the same figure to the dollar. ` +
      `Pick either, but you still cannot use both on the same dollars.</p>`;
  } else {
    const winner = v.fsaWins ? `setting ${usd(B.fsa)} aside at work` : 'claiming the credit';
    const loser = v.fsaWins ? 'claiming the credit' : `setting ${usd(B.fsa)} aside at work`;
    lead = `<p class="otw-lead">Here is what your ${usd(s.expenses)} care bill is worth each way. On these numbers ` +
      `${winner} comes out about ${usd(v.margin)} ahead of ${loser}, and it really is one or the other, ` +
      `there is no way to split it.</p>`;
  }

  // ---- BOTH options, then the verdict --------------------------------------
  // The tool's whole product is the pair, so both rows are always here and in a
  // FIXED order (money-aside first, credit second, the order the page's own name
  // uses). Sorting the winner to the top made the two figures swap places on a
  // keystroke, which reads as the numbers jumping rather than as an answer.
  // The last row is DERIVED from the two above it, so a reader who subtracts
  // them lands exactly on it.
  let compare = '';
  if (!v.nothing) {
    let fsaAmount, fsaLabel;
    if (v.blankPlan) {
      fsaAmount = `<span class="otw-amt otw-taxed">not filled in</span>`;
      fsaLabel = 'Set money aside at work, before tax';
    } else if (v.noPlan) {
      fsaAmount = `<span class="otw-amt otw-taxed">not an option</span>`;
      fsaLabel = 'Set money aside at work before tax, if your job offered it';
    } else {
      fsaAmount = `<span class="otw-amt${v.fsaWins ? ' otw-free' : ''}">${usd(v.fsaTotal)}</span>`;
      fsaLabel = `Set ${usd(B.fsa)} aside at work, before tax`;
    }
    compare =
      `<ul class="otw-story">` +
      `<li><span>${fsaLabel}</span>${fsaAmount}</li>` +
      `<li><span>Or skip that and claim the childcare credit</span>` +
        `<span class="otw-amt${v.decided && v.creditWins ? ' otw-free' : ''}">${usd(v.creditTotal)}</span></li>` +
      (v.noPlan || v.tie
        ? ''
        : `<li class="otw-after"><span>${v.fsaWins ? 'Setting money aside' : 'The credit'} is worth this much more</span>` +
          `<span class="otw-amt otw-free">${usd(v.margin)}</span></li>`) +
      `</ul>`;
  }

  // ---- Every limit named with BOTH numbers ---------------------------------
  // The moment any of these binds, "your care bill" and "the amount the break is
  // allowed to work on" stop being the same number, and a sentence naming only
  // one of them is how a screen ends up reading "$6,000, your care costs" over a
  // $18,000 bill. Each of these is decided from the AMOUNTS, never from "did the
  // answer come out at zero": a credit can be capped all the way to nothing and
  // still leave a headline that claims the whole bill was counted.
  const flags = [];
  const plan = planWarning(s);
  if (plan) flags.push(plan);
  if (r.mfsIneligible && !v.nothing) {
    flags.push(`Married filing separately cannot claim the childcare credit at all, the rules ask for one joint ` +
      `return, so the ${usd(v.creditTotal)} above is the rule and not a rounding. The most you can set aside at work ` +
      `is halved too, to ${usd(r.statutoryFsaLimit)} instead of $7,500.`);
  }
  if (!v.nothing && !v.noPlan && !r.mfsIneligible && B.zeroesCredit && B.fsa > 0) {
    flags.push(`The ${usd(B.fsa)} you would set aside at work is at or above the ${usd(r.cap)} of care costs the ` +
      `credit is allowed to count, so choosing it drops the credit to $0. That is exactly why this is one or the other.`);
  }
  if (!v.nothing && A.creditClampedByLiability) {
    flags.push(`The credit comes to ${usd(A.applicablePercent * A.creditableExpenses)} on paper, but it can only ` +
      `cancel federal income tax you actually owe, and on ${usd(s.agi)} that is ${usd(v.creditTotal)}. ` +
      `${usd(v.creditTotal)} is the figure above.`);
  }
  const flagHtml = flags.map((t) => `<p class="otw-flag">Heads up: ${t}</p>`).join('');

  // ---- How each side gets to its number ------------------------------------
  // Folded rather than dropped: the pair and the margin are the answer, this is
  // the working. The core carries its open/closed state across re-renders, so a
  // visitor who opens it does not have it snap shut on the next keystroke.
  let breakdown = '';
  if (!v.nothing) {
    const expR = Math.round(s.expenses);

    // Credit side. Rows 1-3 add up; the last row is the money and gets the
    // heavier rule so nobody adds it into the care bill above it.
    const countedR = Math.round(A.creditableExpenses);
    const ignoredR = expR - countedR;               // derived, so the three rows reconcile
    const creditRows = r.mfsIneligible
      ? `<ul class="otw-story">` +
        `<li class="otw-after"><span>The childcare credit, which separate returns cannot claim at all</span>` +
          `<span class="otw-amt">${usd(v.creditTotal)}</span></li>` +
        `</ul>`
      : `<ul class="otw-story">` +
        `<li><span>Your care bill</span><span class="otw-amt">${usd(expR)}</span></li>` +
        `<li><span>The part the credit is allowed to count, up to ${usd(r.cap)}</span>` +
          `<span class="otw-amt${countedR > 0 ? ' otw-free' : ''}">${usd(countedR)}</span></li>` +
        (ignoredR > 0
          ? `<li><span>The rest, which the credit is not allowed to count</span>` +
            `<span class="otw-amt otw-taxed">${usd(ignoredR)}</span></li>`
          : '') +
        `<li class="otw-after"><span>What the credit is worth, at ${pct(A.applicablePercent)} of the part it counts</span>` +
          `<span class="otw-amt${v.creditTotal > 0 ? ' otw-free' : ''}">${usd(v.creditTotal)}</span></li>` +
        `</ul>`;

    // FSA side, in two lists on purpose: the first splits the care bill (its
    // rows add to the top row), the second splits what skipping the tax is worth
    // (its rows add to the after-row). One list would have invited a reader to
    // add a care bill to a tax saving.
    let fsaRows;
    if (v.blankPlan) {
      fsaRows = `<p class="otw-note">Nothing to work out on this side until you go back and say how much your job ` +
        `lets you set aside. The box on that card is empty, so the tool is treating it as $0.</p>`;
    } else if (v.noPlan) {
      fsaRows = `<p class="otw-note">There is nothing to work out on this side: with no plan at work there is no ` +
        `pre-tax money to set aside, so this corner is worth $0 whatever your income.</p>`;
    } else {
      const asideR = Math.round(B.fsa);
      const paidR = expR - asideR;                  // derived, so the three rows reconcile
      fsaRows =
        `<ul class="otw-story">` +
        `<li><span>Your care bill</span><span class="otw-amt">${usd(expR)}</span></li>` +
        `<li><span>Set aside at work before tax, so no tax is taken on it</span>` +
          `<span class="otw-amt${asideR > 0 ? ' otw-free' : ''}">${usd(asideR)}</span></li>` +
        (paidR > 0
          ? `<li><span>The rest, paid out of pay that was already taxed</span>` +
            `<span class="otw-amt otw-taxed">${usd(paidR)}</span></li>`
          : '') +
        `</ul>` +
        `<ul class="otw-story">` +
        `<li><span>Income tax you do not pay on the money set aside</span>` +
          `<span class="otw-amt${v.fsaTax > 0 ? ' otw-free' : ''}">${usd(v.fsaTax)}</span></li>` +
        `<li><span>Social Security and Medicare you do not pay on it</span>` +
          `<span class="otw-amt${v.fsaFica > 0 ? ' otw-free' : ''}">${usd(v.fsaFica)}</span></li>` +
        `<li><span>Childcare credit left over afterwards</span>` +
          `<span class="otw-amt${v.fsaLeft > 0 ? ' otw-free' : ' otw-taxed'}">${usd(v.fsaLeft)}</span></li>` +
        `<li class="otw-after"><span>What setting money aside is worth</span>` +
          `<span class="otw-amt${v.fsaTotal > 0 ? ' otw-free' : ''}">${usd(v.fsaTotal)}</span></li>` +
        `</ul>`;
    }

    breakdown =
      `<details class="otw-help" id="dcWorking"><summary>How each side gets to its number</summary>` +
      `<p class="otw-lead">Skip the FSA and claim the credit</p>` + creditRows +
      `<p class="otw-lead">Or set aside what you can at work</p>` + fsaRows +
      `</details>`;
  }

  // ---- The plain box -------------------------------------------------------
  // This tool is NOT a filing-time deduction, so it does not get the family's
  // FICA-is-still-owed paragraph: setting money aside at work skips FICA, which
  // is the opposite claim, and it changes the paycheck rather than the refund.
  // What a reader actually needs here is that the two arrive at different times
  // and that choosing one closes the other.
  let plain;
  if (v.nothing) {
    plain = `<div class="otw-plain">${missingReason(s)}</div>`;
  } else if (v.blankPlan) {
    plain = `<div class="otw-plain">Go back to the last question and put in the most your job lets you set aside, ` +
      `and the tool will weigh it against the credit. Most plans allow the full $7,500. If your job has no plan at ` +
      `all, answer No on the question before that one and the credit becomes the whole answer.</div>`;
  } else if (v.noPlan) {
    plain = `<div class="otw-plain">The credit arrives once, when you file your tax return, as a smaller bill or a ` +
      `bigger refund. It cancels federal income tax you owe and nothing else, so it never touches Social Security or ` +
      `Medicare. If your job adds a plan at a later open enrollment, come back and run this again: setting money ` +
      `aside at work can beat the credit, and at higher incomes it usually does.</div>`;
  } else {
    plain = `<div class="otw-plain">The two reach you at different times. Money you set aside at work leaves every ` +
      `paycheck through the year, before income tax and before Social Security and Medicare, so your take-home pay ` +
      `changes from your first pay period. The credit arrives once, when you file your tax return, as a smaller bill ` +
      `or a bigger refund, and it never touches Social Security or Medicare. You choose at open enrollment, and every ` +
      `dollar you set aside is a dollar the credit is no longer allowed to count.</div>`;
  }

  return warnBox + head + lead + compare + flagHtml + breakdown + plain;
}

// ---- The flow ---------------------------------------------------------------
// Six questions in the order a parent can actually answer them: who the care is
// for (which sets the credit's ceiling), what it costs, what the household
// earns, how they file, and only then the two questions about work. Cost before
// income puts the cross-check on the SECOND of that pair, which is where the
// visitor is standing when the contradiction can first exist.
mountWizard({
  stage: 'dcWizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: KIDS, radios: 'kids' },
    { step: EXPENSES, fields: ['expenses'] },
    {
      step: AGI,
      fields: ['agi'],
      // On the income card rather than the care card: it is the second of the
      // two numbers, so it is the one being typed when the contradiction first
      // exists.
      flags: [{ id: 'otwAgiFlag', text: careWarning }]
    },
    { step: FILING, radios: 'filing' },
    { step: HASFSA, radios: 'hasFsa' },
    {
      step: FSAMAX,
      fields: ['employerFsa'],
      // The page's one branch. A visitor whose job offers nothing never sees
      // this question at all, and read() zeroes the amount for them rather than
      // just skipping the card.
      when: (s) => s.hasFsa === 'yes',
      flags: [{ id: 'otwFsaFlag', text: planWarning }]
    },
    { step: RESULT, result: true }
  ],

  // The page loads with numbers nobody typed, so the answer stays labelled an
  // example until BOTH figures the comparison is built from are the visitor's
  // own. $6,000 of daycare on $85,000 of household income is ordinary enough to
  // be somebody's real year. The other four are not listed: the family size, the
  // filing status and the yes/no all have a real default, and the $7,500 in the
  // plan box is the statutory maximum most plans allow rather than a figure we
  // invented about this visitor.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('expenses')) missing.push('your care bill');
    if (!touched.has('agi')) missing.push('your household income');
    return missing;
  },

  chips: (s) => {
    const items = [
      { step: KIDS, label: s.kids === '1' ? '1 person' : '2 or more' },
      { step: EXPENSES, label: `${usd(s.expenses)} of care` },
      { step: AGI, label: `${usd(s.agi)}/yr` },
      { step: FILING, label: FILING_WORDS[s.filing] || s.filing },
      { step: HASFSA, label: s.hasFsa === 'yes' ? 'plan at work' : 'no plan at work' }
    ];
    // Omitted when the plan card is off the path: a chip pointing at a step the
    // visitor no longer has would hand them forward to the answer instead.
    if (s.hasFsa === 'yes') items.push({ step: FSAMAX, label: `${usd(s.planMax)} allowed`, field: 'employerFsa' });
    return items;
  },

  announce: (s, r) => {
    const v = summarise(s, r);
    if (v.nothing) return 'Fill in your care bill and your household income to compare the two.';
    if (v.blankPlan) return `The credit is worth about ${usd(v.creditTotal)}. Say how much your job lets you set aside to compare the two.`;
    if (v.noPlan) return `With no plan at work, the childcare credit is your only option here, worth about ${usd(v.creditTotal)}.`;
    if (v.tie) return `Setting money aside at work and claiming the credit come out the same, about ${usd(v.creditTotal)} either way.`;
    const winner = v.fsaWins ? 'Setting money aside at work' : 'Claiming the childcare credit';
    return `${winner} wins by about ${usd(v.margin)}: ${usd(v.fsaTotal)} for the money set aside against ` +
      `${usd(v.creditTotal)} for the credit. It is one or the other, not a split.` +
      (careWarning(s) ? ' Check your numbers, there is a warning above the answer.' : '');
  }
});
