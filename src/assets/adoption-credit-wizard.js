// adoption-credit-wizard.js — the card-by-card flow on /adoption-credit-calculator/.
// Estimates the federal adoption tax credit (IRC §23) for tax years 2025/2026:
// costs up to the per-child cap, the MAGI phase-out, the PER-CHILD refundable
// slice, the nonrefundable remainder against your tax, and the 5-year
// carryforward. All logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// #adoptForm and is still served by adoption-credit-calculator.js; the two must
// stay independent, so nothing here reads or writes an id the embed also ships
// except through its own page's DOM.
//
// A CONVERSION ONTO wizard-core.js. Everything about "how a card flow behaves" —
// stepping, dots, focus, the 350 ms flag debounce, the polite status line, the
// example label, Start over, data-js last — lives in the core. What is left here
// is only what makes this the adoption credit: eleven questions (three of them
// on a branch), one call into the shared §23 engine, and the answer written out
// as a story.
//
// THE MATH is one engine call, unchanged. adoptionCredit() applies the per-child
// cap, the phase-out, the per-child refundable split (the whole point of this
// page — the refundable limit is PER CHILD, not per return), the liability limit
// on the nonrefundable remainder and the FIFO carryforward, in that order.
//
// THE CHILDREN. The old page BUILT its per-child expense fields with innerHTML,
// so a reader with JavaScript off had no expense field at all. All three ship as
// real markup now; the count radio only decides how many cards the flow steps
// through and how many children this module hands the engine.
import { adoptionCredit } from '/assets/adoption-credit.js';
import { mountWizard, moneyOf, numOf, radioOf, selectOf, usd } from '/assets/wizard-core.js';

const DATA = window.__ADOPTION_DATA__ || {};
const CF_YEARS = DATA.carryforwardYears || 5;

// data-step on each card. RESULT is the last card and is never skipped.
const CHILD1 = 0, COUNT = 1, CHILD2 = 2, CHILD3 = 3, YEAR = 4, FILING = 5,
  MFS = 6, MAGI = 7, TAX = 8, EMPLOYER = 9, CARRY = 10, RESULT = 11;

const FILING_WORDS = {
  single: 'on my own',
  mfj: 'married, one return',
  hoh: 'head of household',
  qw: 'surviving spouse',
  mfs: 'married, separate returns'
};

// ---- Reading the cards ------------------------------------------------------
function read() {
  const taxYear = Number(radioOf('taxYear', '2026')) || 2026;
  const childCount = Number(radioOf('childCount', '1')) || 1;
  // Only a WRITTEN plan keeps employer money out of taxable pay, and only then is
  // it excluded from the costs you claim here. Without one the payment is
  // ordinary taxable pay and the expenses it covered are still yours to claim,
  // so the figure is read but deliberately not applied — same rule the old page
  // used, said out loud on the answer card.
  const hasProgram = selectOf('hasProgram') === 'yes';
  const employerEntered = moneyOf('employerBenefits');
  const employerBenefits = hasProgram ? employerEntered : 0;

  const children = [];
  for (let i = 0; i < childCount; i++) {
    children.push({
      qae: moneyOf('qae' + i),
      specialNeedsFinalThisYear: selectOf('special' + i) === 'yes',
      priorYearClaimed: moneyOf('prior' + i),
      // Employer money nets the FIRST child's credit-side costs, which is what
      // the engine expects and what the employer card's helper says.
      employerBenefits: i === 0 ? employerBenefits : 0
    });
  }

  return {
    taxYear,
    childCount,
    filingStatus: radioOf('filingStatus', 'single'),
    livedApart: radioOf('livedApart', 'no') === 'yes',
    magi: moneyOf('magi'),
    taxLiability: moneyOf('taxLiability'),
    hasProgram,
    employerEntered,
    employerBenefits,
    cfAmount: moneyOf('cfAmount'),
    // A blank year is not year zero. The engine drops a carryforward older than
    // five years, so an empty box read as 0 would silently delete the visitor's
    // leftover credit; fall back to the year before the one being filed.
    cfYear: numOf('cfYear') || (taxYear - 1),
    children,
    spendTotal: children.reduce((a, c) => a + c.qae, 0),
    specialCount: children.filter((c) => c.specialNeedsFinalThisYear).length
  };
}

const compute = (s) => adoptionCredit({
  taxYear: s.taxYear,
  filingStatus: s.filingStatus,
  livedApartLast6Months: s.livedApart,
  magi: s.magi,
  taxLiability: s.taxLiability,
  children: s.children,
  carryforwardIn: s.cfAmount > 0 ? [{ yearArose: s.cfYear, amount: s.cfAmount }] : [],
  employer: s.hasProgram
    ? { benefits: s.employerBenefits, hasWrittenProgram: true, exclusionMagi: s.magi + s.employerBenefits }
    : null,
  data: DATA
});

// ---- The three cross-checks these answers allow -----------------------------
// Never blocking: the answer still computes underneath, the doubt just travels
// with it, and it travels to BOTH places — the card that asks for the SECOND of
// the two numbers, and the answer, because a visitor who reaches the answer by
// pressing Next may never come back to the card.

// Federal income tax is computed on taxable income, which is never more than the
// income entered, and the top rate is 37%. More than half the income in this box
// is not a big tax bill, it is the wrong figure — almost always the income
// itself, or everything withheld from the pay including Social Security and
// Medicare. Half rather than 37% leaves room for the odd extra tax the Credit
// Limit Worksheet folds in, so the flag only fires where the number is beyond
// argument.
function taxWarning(s) {
  if (s.magi <= 0 || s.taxLiability <= 0) return '';
  if (s.taxLiability <= s.magi * 0.5) return '';
  return `Check these numbers: the ${usd(s.taxLiability)} you entered as the federal income tax you owe is more than ` +
    `half the ${usd(s.magi)} you entered as your income for the year. Federal income tax never reaches that share of ` +
    `an income — the top rate is 37% — so this box has probably got your income, or everything withheld from your pay, ` +
    `in it rather than the income tax on your return.`;
}

// The costs question asks for the whole bill, before anybody paid any of it
// back. Employer help larger than the whole bill means the visitor already
// subtracted it once, which quietly deletes their credit.
function employerWarning(s) {
  if (s.employerEntered <= 0 || s.spendTotal <= 0) return '';
  if (s.employerEntered <= s.spendTotal) return '';
  return `Check these numbers: the ${usd(s.employerEntered)} you entered as your employer's help is more than the ` +
    `${usd(s.spendTotal)} you entered as what the adoption has cost you. The cost question wants the whole bill, ` +
    `before your employer paid any of it, so if you have already taken their share off, add it back.`;
}

// A leftover can only come from a year already filed, and it dies five years
// after the year it arose.
function carryWarning(s) {
  if (s.cfAmount <= 0) return '';
  if (s.cfYear >= s.taxYear) {
    return `Check these numbers: you entered ${s.cfYear} as the year your leftover ${usd(s.cfAmount)} came from, but ` +
      `you are filing a ${s.taxYear} return. A leftover can only come from a year you have already filed, so this is ` +
      `probably ${s.taxYear - 1}.`;
  }
  if (s.cfYear + CF_YEARS < s.taxYear) {
    return `Check these numbers: a leftover credit lasts ${CF_YEARS} years after the year it came from, so the ` +
      `${usd(s.cfAmount)} you entered from ${s.cfYear} ran out after ${s.cfYear + CF_YEARS} and cannot be used on a ` +
      `${s.taxYear} return. It is left out of the answer below.`;
  }
  return '';
}

const warningsOf = (s) => [taxWarning(s), employerWarning(s), carryWarning(s)].filter(Boolean);

// ---- The answer -------------------------------------------------------------
const row = (label, amount, cls) =>
  `<li${cls && cls.li ? ` class="${cls.li}"` : ''}><span>${label}</span>` +
  `<span class="otw-amt${cls && cls.amt ? ' ' + cls.amt : ''}">${usd(amount)}</span></li>`;

function zeroReason(s, r) {
  if (s.spendTotal <= 0 && s.specialCount === 0) {
    return 'Enter what the adoption has cost you out of your own pocket, and your credit appears here.';
  }
  if (r.ratio >= 1) {
    return `Your income of ${usd(s.magi)} is above ${usd(r.phaseoutEnd)}, where this credit is completely phased out, ` +
      `so there is nothing to claim for ${r.taxYear}.`;
  }
  if (r.perChild.length && r.perChild.every((c) => c.capRemaining <= 0)) {
    return `You have already claimed the full ${usd(r.cap)} for ${r.perChild.length > 1 ? 'each of these children' : 'this child'}, ` +
      `and that limit covers the whole adoption rather than each year of it, so there is nothing left to claim now.`;
  }
  const emp = r.perChild.length ? r.perChild[0].employerBenefits : 0;
  if (emp > 0 && emp >= s.spendTotal) {
    return `Your employer's ${usd(emp)} covered the whole ${usd(s.spendTotal)} bill. Those dollars are kept out of ` +
      `your taxable pay under their own separate limit instead, so there are no costs of your own left to claim a ` +
      `credit on.`;
  }
  return `With these numbers there is no adoption credit for ${r.taxYear}.`;
}

function perChildBox(r) {
  if (!r.perChild || r.perChild.length < 2) return '';
  const rows = r.perChild.map((c) =>
    `<tr><td>Child ${c.index + 1}${c.specialNeeds ? ' (special needs)' : ''}</td>` +
    `<td>${usd(c.allowed)}</td><td>${usd(c.refundable)}</td><td>${usd(c.nonrefundable)}</td></tr>`
  ).join('');
  // The id is what makes the open/closed state stick. wizard-core keys the
  // preserved state on `d.id || '#' + i`, and this fold's index inside #out
  // MOVES when the child count changes (the two lists above it grow and shrink),
  // so without an id a visitor who opened the breakdown and then changed the
  // number of children had it open or close on its own.
  return `<details class="otw-help" id="acPerChild"><summary>How this splits between your children</summary>` +
    `<div class="childbreak"><table>` +
    `<thead><tr><th>Per child</th><th>Credit</th><th>Paid to you</th><th>Against your tax</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div></details>`;
}

function renderResult({ state: s, result: r }) {
  const warnBox = warningsOf(s).map((w) => `<div class="ot-input-warning">${w}</div>`).join('');

  if (!r || r.error === 'missing_data') {
    return warnBox +
      `<p class="otw-kick">On the tax return you file</p><p class="otw-big otw-zero">$0</p>` +
      `<div class="otw-plain">The adoption-credit figures did not load, so nothing can be worked out. Reload the page ` +
      `and try again.</div>`;
  }

  if (r.error === 'mfs_not_eligible' || r.eligible === false) {
    return warnBox +
      `<p class="otw-kick">On the tax return you file for ${r.taxYear}</p>` +
      `<p class="otw-big otw-zero">$0</p>` +
      `<div class="otw-plain">Married couples who send in separate returns generally cannot claim the adoption credit ` +
      `at all: it needs a joint return. There is one exception, and it is the three-part question above — if you lived ` +
      `apart from your husband or wife for the last six months of the year, the child lived in your home for more than ` +
      `half the year, and you paid more than half the cost of running that home, answer "Yes, all three" and the ` +
      `credit is worked out. One narrower case this tool does not cover: if a joint return was filed in the year the ` +
      `costs first became claimable, a spouse who later files separately can still claim a leftover from it.</div>`;
  }

  if (r.error) {
    return warnBox +
      `<p class="otw-kick">On the tax return you file</p><p class="otw-big otw-zero">$0</p>` +
      `<div class="otw-plain">${(r.notes && r.notes[0]) || 'The credit could not be worked out from these numbers.'}</div>`;
  }

  const cap = r.cap;
  const refCap = r.refundableCap;
  const baseTotal = r.perChild.reduce((a, c) => a + c.base, 0);
  const empApplied = r.perChild.length ? r.perChild[0].employerBenefits : 0;
  const special = s.specialCount > 0;

  // ---- The story -----------------------------------------------------------
  // ROUNDED ONCE. The labels invite the reader to add the rows up, so they have
  // to add up: exactly ONE row per list is DERIVED by subtraction from the
  // already-rounded figures around it, rather than rounded on its own. Three
  // independent Math.rounds do not reconcile, and a list that is a dollar out is
  // a list the reader stops trusting.
  const allowedR = Math.round(r.allowedTotal);
  const spendR = Math.round(s.spendTotal);
  let empR = Math.min(spendR, Math.round(empApplied));
  let overR = Math.round(r.neverClaimableTotal);
  let phaseR = spendR - empR - overR - allowedR;
  // The clamp order matters: give the rounding slack back to the over-cap row
  // first (it is the one derived from the same two figures), then to the
  // employer row, and only then flatten it.
  if (phaseR < 0) { overR = Math.max(0, overR + phaseR); phaseR = spendR - empR - overR - allowedR; }
  if (phaseR < 0) { empR = Math.max(0, empR + phaseR); phaseR = spendR - empR - overR - allowedR; }
  if (phaseR < 0) phaseR = 0;

  // Special-needs deeming breaks the spend-based split outright: the law treats
  // the full cap as paid whatever was actually spent, so "what you spent" minus
  // the reductions no longer lands on the credit. That case gets its own,
  // shorter list anchored on what counts rather than on what was paid.
  const baseR = Math.round(baseTotal);
  const specialPhaseR = Math.max(0, baseR - allowedR);

  // A prior-year claim eats into the SAME per-child limit, so once one exists the
  // row cannot say "above the $17,670 limit" — the limit that bit is whatever was
  // left of it.
  const priorAny = r.perChild.some((c) => c.priorClaimed > 0);
  // Employer help larger than the whole bill is the flagged contradiction, not a
  // story: clamping it to make the rows add up would print a figure the visitor
  // never typed. The warning above the answer and the plain box below both name
  // the two real numbers instead.
  const empOverruns = empApplied > s.spendTotal;

  let lead1 = '';
  let list1 = '';
  if (special && specialPhaseR > 0) {
    lead1 = `<p class="otw-lead">Here is how your credit is worked out:</p>`;
    list1 =
      `<ul class="otw-story">` +
      row('Counts toward the credit', baseR) +
      row('Cut by the income phase-out', specialPhaseR, { amt: 'otw-taxed' }) +
      row(`Your ${r.taxYear} adoption credit`, allowedR, { amt: allowedR > 0 ? 'otw-free' : '' }) +
      `</ul>`;
  } else if (!special && !empOverruns && (empR > 0 || overR > 0 || phaseR > 0)) {
    lead1 = `<p class="otw-lead">Here is what happens to the ${usd(spendR)} the adoption has cost you:</p>`;
    list1 =
      `<ul class="otw-story">` +
      row('What the adoption has cost you this year', spendR) +
      (empR > 0 ? row('Paid by your employer — it counts under their limit, not here', empR, { amt: 'otw-taxed' }) : '') +
      (overR > 0
        ? row(priorAny
          ? `Above what is left of the ${usd(cap)}-per-child limit — never claimable`
          : `Above the ${usd(cap)}-per-child limit — never claimable`, overR, { amt: 'otw-taxed' })
        : '') +
      (phaseR > 0 ? row('Cut by the income phase-out', phaseR, { amt: 'otw-taxed' }) : '') +
      row(`Your ${r.taxYear} adoption credit`, allowedR, { amt: allowedR > 0 ? 'otw-free' : '' }) +
      `</ul>`;
  }

  // ---- What the credit does -------------------------------------------------
  const carryInR = Math.round(r.carryforwardInTotal);
  const availR = allowedR + carryInR;
  const refundR = Math.min(availR, Math.round(r.refundableTotal));
  let leftR = Math.round(r.carryforwardOutTotal);
  let expiredR = Math.round(r.expiredThisYear);
  let usedR = availR - refundR - leftR - expiredR;   // DERIVED, so the list adds up
  if (usedR < 0) { leftR = Math.max(0, leftR + usedR); usedR = availR - refundR - leftR - expiredR; }
  if (usedR < 0) { expiredR = Math.max(0, expiredR + usedR); usedR = availR - refundR - leftR - expiredR; }
  if (usedR < 0) usedR = 0;
  const benefitR = refundR + usedR;

  let lead2 = '';
  let list2 = '';
  if (availR > 0) {
    if (list1) {
      lead2 = `<p class="otw-lead">And here is what that ${usd(allowedR)} credit does:</p>`;
    } else if (special) {
      // Deliberately NOT "so your credit is X because it was special needs": with
      // one special-needs child among several, the credit is part deemed and part
      // real spending, and a sentence crediting the deeming for all of it is
      // wrong. The deeming gets its own note below, which is true either way.
      lead2 = `<p class="otw-lead">Here is what your ${r.taxYear} credit of ${usd(allowedR)} does:</p>`;
    } else {
      lead2 = `<p class="otw-lead">All ${usd(spendR)} you have spent counts, so your ${r.taxYear} credit is ` +
        `${usd(allowedR)}. Here is what it does:</p>`;
    }
    list2 =
      `<ul class="otw-story">` +
      row(`Your ${r.taxYear} credit${carryInR > 0 ? `, plus ${usd(carryInR)} left over from ${s.cfYear}` : ''}`, availR) +
      row('Paid to you as a refund, even if you owe no federal income tax', refundR,
        { amt: refundR > 0 ? 'otw-free' : '' }) +
      row('Taken off the federal income tax you owe', usedR, { amt: usedR > 0 ? 'otw-free' : '' }) +
      (leftR > 0
        ? row(`Still left over — it waits for you, for up to ${CF_YEARS} years`, leftR, { amt: 'otw-taxed' })
        : '') +
      (expiredR > 0
        ? row(`Out of time — the ${CF_YEARS}-year limit ran out on it`, expiredR, { amt: 'otw-taxed' })
        : '') +
      `</ul>`;
  }

  const head =
    `<p class="otw-kick">On the tax return you file for ${r.taxYear}</p>` +
    `<p class="otw-big${benefitR > 0 ? '' : ' otw-zero'}">${usd(benefitR)}</p>`;

  // ---- The limits, each naming BOTH numbers ---------------------------------
  // A limit is decided from the CREDIT, never from "did any money come back": a
  // family can be capped all the way to nothing and still see a $0 headline over
  // a row claiming the whole bill counted. The moment a limit binds, "what you
  // spent" and "what counts" stop being the same number, so every sentence here
  // names both of them.
  let flags = '';
  if (r.neverClaimableTotal > 0) {
    // Built from the children the cap actually bit, never from the totals: a
    // special-needs child is DEEMED to have spent the whole cap, so its base is
    // unrelated to anything typed, and comparing the return-wide base against the
    // return-wide spend printed "$35,340 of the $20,000 you entered".
    const capped = r.perChild.filter((c) => c.neverClaimable > 0);
    const spentOnThem = Math.round(capped.reduce((a, c) => a + Math.max(0, c.grossQae - c.employerBenefits), 0));
    const lost = Math.round(r.neverClaimableTotal);
    const counts = spentOnThem - lost;
    const forWhom = r.perChild.length === 1
      ? ''
      : (capped.length > 1 ? ' for those children' : ` for child ${capped[0].index + 1}`);
    flags += `<p class="otw-flag">Heads up: ${usd(counts)} of the ${usd(spentOnThem)} you entered${forWhom} counts ` +
      `toward the credit. The limit is ${usd(cap)} per child and it covers the whole adoption rather than each year ` +
      `of it` +
      (capped.some((c) => c.priorClaimed > 0)
        ? `, and what you have already claimed comes off it`
        : '') +
      `, so the ${usd(lost)} above it can never be claimed, in this year or any other.</p>`;
  }
  if (r.ratio > 0 && r.ratio < 1) {
    flags += `<p class="otw-flag">Heads up: your income of ${usd(s.magi)} is above ${usd(r.phaseoutStart)}, so your ` +
      `credit is cut to ${usd(allowedR)} of the ${usd(baseR)} it would otherwise be. It disappears completely at ` +
      `${usd(r.phaseoutEnd)}.</p>`;
  }

  // ---- The plain box -------------------------------------------------------
  // NOT a filing-time deduction, so no FICA sentence: this is a credit, and what
  // a reader needs is what "refundable" actually buys them, what the rest can and
  // cannot do, and when it arrives.
  let plain;
  if (benefitR > 0) {
    const nonref = allowedR - refundR;
    plain = `<div class="otw-plain">A credit is money off your tax bill, not a deduction from your income. ` +
      `${usd(refundR)} of your ${usd(allowedR)} credit is refundable: it is paid to you when you file even if you owe ` +
      `no federal income tax` +
      (r.refundableTotal > 0 && allowedR > refundR ? `, because the refundable part stops at ${usd(refCap)} per child` : '') +
      `.` +
      (nonref > 0
        ? ` The other ${usd(nonref)} can only cancel tax you owe` +
          (leftR > 0 ? `, and the ${usd(leftR)} your tax could not absorb waits for a later year, for up to ${CF_YEARS} of them` : '') +
          `.`
        : '') +
      ` None of this changes your paycheck during the year — you claim it on IRS Form 8839 with your return.</div>`;
  } else {
    plain = `<div class="otw-plain">${zeroReason(s, r)}</div>`;
  }

  // ---- Notes that are not part of the story --------------------------------
  let notes = '';
  if (s.specialCount > 0) {
    const whose = r.perChild.length === 1
      ? 'what you typed above'
      : (s.specialCount > 1 ? 'what you typed for those children' : 'what you typed for that child');
    notes += `<p class="otw-note">A special-needs adoption that became final this year is treated as having cost the ` +
      `full ${usd(cap)} for that child, whatever was actually spent on it, so ${whose} does not change the ` +
      `answer.</p>`;
  }
  if (r.perChild.length > 1 && r.refundableTotal > refCap) {
    notes += `<p class="otw-note">You are claiming ${r.perChild.length} children, so the ${usd(refCap)} refundable ` +
      `limit applies to each of them separately. That is why ${usd(refundR)} comes back to you rather than ` +
      `${usd(refCap)} — pages that treat it as one limit per return get this wrong.</p>`;
  }
  if (r.employerExclusion > 0) {
    notes += `<p class="otw-note">Separately, ${usd(r.employerExclusion)} of your employer's help stays out of your ` +
      `taxable pay under its own ${usd(cap)} limit. That is a different limit from the credit's, so you can use both ` +
      `— just not for the same dollar of costs.</p>`;
  }
  if (s.employerEntered > 0 && !s.hasProgram) {
    notes += `<p class="otw-note">You entered ${usd(s.employerEntered)} from your employer but said it was not part ` +
      `of a written plan. Without one, that money counts as ordinary taxable pay, so it does not come off the costs ` +
      `you claim here and it is left out of the figures above.</p>`;
  }

  return warnBox + head + lead1 + list1 + lead2 + list2 + flags + plain + notes + perChildBox(r);
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'adoptionWizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: CHILD1, fields: ['qae0', 'special0', 'prior0'] },
    { step: COUNT, radios: 'childCount' },
    { step: CHILD2, fields: ['qae1', 'special1', 'prior1'], when: (s) => s.childCount >= 2 },
    { step: CHILD3, fields: ['qae2', 'special2', 'prior2'], when: (s) => s.childCount >= 3 },
    { step: YEAR, radios: 'taxYear' },
    { step: FILING, radios: 'filingStatus' },
    // The three-part test only exists for one filing status, so only that
    // visitor is ever asked it.
    { step: MFS, radios: 'livedApart', when: (s) => s.filingStatus === 'mfs' },
    { step: MAGI, fields: ['magi'] },
    {
      step: TAX,
      fields: ['taxLiability'],
      // On the tax card rather than the income card: it is the second of the two
      // numbers, so it is the one being typed when the contradiction first exists.
      flags: [{ id: 'otwTaxFlag', text: taxWarning }]
    },
    {
      step: EMPLOYER,
      fields: ['employerBenefits', 'hasProgram'],
      flags: [{ id: 'otwEmployerFlag', text: employerWarning }],
      skipClears: ['employerBenefits']
    },
    {
      step: CARRY,
      fields: ['cfAmount', 'cfYear'],
      flags: [{ id: 'otwCarryFlag', text: carryWarning }],
      skipClears: ['cfAmount']
    },
    { step: RESULT, result: true }
  ],

  // The page loads with numbers nobody typed, so the answer stays labelled an
  // example until every figure it is built from is the visitor's own. Clearing
  // it on the first edit to any one field presented an answer still made of our
  // invented income as theirs, and $15,000 of costs on $120,000 of income with
  // an $8,000 tax bill is ordinary enough to be somebody's real return. The
  // other fields are not listed: the year, the child count and the filing status
  // all have a real default that is true for most visitors, the second and third
  // children start at zero because most visitors have neither, and the employer
  // and leftover boxes start at zero because most visitors have neither.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('qae0')) missing.push('what the adoption cost you');
    if (!touched.has('magi')) missing.push('your income');
    if (!touched.has('taxLiability')) missing.push('the tax you owe');
    return missing;
  },

  chips: (s) => {
    const out = [
      { step: CHILD1, label: `${usd(s.spendTotal)} in costs` },
      { step: COUNT, label: s.childCount === 1 ? '1 child' : `${s.childCount} children` },
      { step: YEAR, label: `tax year ${s.taxYear}` },
      { step: FILING, label: FILING_WORDS[s.filingStatus] || s.filingStatus },
      { step: MAGI, label: `${usd(s.magi)} income` },
      { step: TAX, label: `${usd(s.taxLiability)} tax` }
    ];
    if (s.employerEntered > 0) out.push({ step: EMPLOYER, label: `${usd(s.employerEntered)} from work` });
    if (s.cfAmount > 0) out.push({ step: CARRY, label: `${usd(s.cfAmount)} left over` });
    return out;
  },

  announce: (s, r) => {
    if (!r || r.error) return 'No adoption credit with these numbers. There is an explanation above.';
    const refundR = Math.round(r.refundableTotal);
    const benefit = Math.round(r.totalBenefitThisYear);
    const capSpoken = r.neverClaimableTotal > 0
      ? ` ${usd(r.neverClaimableTotal)} of your costs is above the ${usd(r.cap)}-per-child limit and can never be claimed.`
      : (r.ratio > 0 && r.ratio < 1 ? ` Your income phases part of the credit out.` : '');
    return `Adoption credit on your ${r.taxYear} return: ${usd(benefit)}, of which ${usd(refundR)} is paid to you as a ` +
      `refund.${capSpoken}` +
      (warningsOf(s).length ? ' Check your numbers, there is a warning above the answer.' : '');
  }
});
