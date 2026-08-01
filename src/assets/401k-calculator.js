// 401k-calculator.js — the card-by-card flow on /401k-calculator/.
// Projects a 401(k) balance forward to the age you stop working. Pure math via
// the shared retirement-401k engine. All client-side; nothing uploaded.
//
// There is NO /embed/ twin of this page, so this file was rewritten in place
// onto wizard-core.js rather than split into a second -wizard.js asset. It is
// the page's only script.
//
// Everything about "how a card flow behaves" — stepping, dots, focus, the 350 ms
// flag debounce, the polite status line, the example label, Start over, data-js
// last — lives in wizard-core.js. What is left here is only what makes this the
// 401(k) calculator: nine questions, one call into the retirement-401k engine,
// and the answer written out as a story.
//
// NOT A TAX TOOL. Every other page in this family estimates a deduction and ends
// with "this is a bigger refund when you file, and FICA is still owed". None of
// that applies here: this is a projection of a balance, so the plain-terms box
// says what a projection actually is (a steady return that no real market gives
// you, and a figure that is still before the tax a traditional 401(k) owes on the
// way out) instead of pasting a FICA note that would be simply wrong.
import { project } from '/assets/retirement-401k.js';
import { mountWizard, $, moneyOf, numOf, usd, count } from '/assets/wizard-core.js';

// data-step on each card. RESULT is the last card and is never skipped.
const AGE = 0, RETIRE = 1, BALANCE = 2, SALARY = 3, CONTRIB = 4,
  RETURN = 5, MATCH = 6, CAP = 7, GROWTH = 8, RESULT = 9;

// ---- Reading the cards ------------------------------------------------------
// The two ages are the one pair where BLANK and ZERO have to stay different.
// numOf() answers 0 for both, which would read an emptied age box as "age 0" and
// happily project 65 years of saving for a newborn; the old form's val() drew the
// same line and this keeps it. Everything else is genuinely zero-able — 0% into
// the account, a 0-cent match, 0% raises and a $0 starting balance are all real
// answers — so those go through the core's readers unchanged.
function ageOf(id) {
  const el = $(id);
  if (!el) return NaN;
  const raw = String(el.value == null ? '' : el.value).trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}

function read() {
  return {
    currentAge: ageOf('currentAge'),
    retirementAge: ageOf('retirementAge'),
    currentBalance: moneyOf('currentBalance'),
    annualSalary: moneyOf('annualSalary'),
    employeeContrib: numOf('employeeContrib'),
    annualReturn: numOf('annualReturn'),
    employerMatch: numOf('employerMatch'),
    matchCap: numOf('matchCap'),
    salaryGrowth: numOf('salaryGrowth')
  };
}

// The engine returns a NaN-filled result rather than throwing on bad input, so
// this call is safe with a half-filled form and needs no guarding of its own.
const compute = (s) => project(
  s.currentAge, s.retirementAge, s.currentBalance, s.annualSalary,
  s.employeeContrib, s.employerMatch, s.matchCap, s.annualReturn,
  { salaryGrowthPct: s.salaryGrowth }
);

const yearsOf = (s) =>
  (Number.isFinite(s.currentAge) && Number.isFinite(s.retirementAge))
    ? Math.round(s.retirementAge - s.currentAge)
    : NaN;

// ---- The two impossibilities these nine answers allow -----------------------
// Never blocking: the answer still computes underneath, the doubt just travels
// with it, and it travels to BOTH places — the card that asks for the second of
// the two numbers, and the answer, because a visitor who reaches the answer by
// pressing Next may never come back to the card.

// You cannot stop working before you started. Lives on the retirement-age card:
// it is the second of the pair, so it is the number being typed when the
// contradiction first exists.
function ageWarning(s) {
  if (!Number.isFinite(s.currentAge) || !Number.isFinite(s.retirementAge)) return '';
  if (s.retirementAge > s.currentAge) return '';
  return `Check these two ages: you put ${count(s.currentAge)} as your age now and ${count(s.retirementAge)} as the age you ` +
    `stop working, so there are no years left to save in. The second one needs to be the larger of the two.`;
}

// You cannot put more into the account than you are paid. The likely cause is
// real and worth naming: the box wants a share of your pay, and somebody who
// types the DOLLARS they save lands here every time.
function contribWarning(s) {
  if (!(s.employeeContrib > 100)) return '';
  return `Check this number: ${count(s.employeeContrib)}% is more than all of your pay, and you cannot save more than you earn. ` +
    `This box wants a share of your pay rather than an amount, so 6 means six cents of every dollar you are paid.`;
}

// ---- The employer match, named with BOTH numbers ----------------------------
// What you put in and what your employer will match stop being the same number
// the moment either one passes the other, and a sentence naming only one of them
// is how a screen ends up reading "your employer adds $X" over a visitor who is
// collecting half the match on offer. Every sentence here names both.
//
// It lives on the match-cap card because the cap is the SECOND of the pair (the
// contribution percentage was asked three cards earlier), which is where the
// visitor is standing when the gap first exists.
function matchNote(s) {
  if (!(s.employerMatch > 0)) return '';
  if (!(s.matchCap > 0)) {
    return `These two do not fit together: you said your employer adds ${count(s.employerMatch)} cents for every dollar you save, ` +
      `but stops at 0% of your pay, which adds up to nothing at all. If they match you up to 6% of your pay, put 6 here.`;
  }
  if (s.employeeContrib > 0 && s.employeeContrib < s.matchCap) {
    return `Heads up: you are putting in ${count(s.employeeContrib)}% of your pay and your employer keeps adding money up to ` +
      `${count(s.matchCap)}%. Going up to ${count(s.matchCap)}% would collect the rest of the match, which is money your ` +
      `employer is offering you and you are not taking.`;
  }
  if (s.employeeContrib > s.matchCap) {
    return `Worth knowing: your employer only adds money on the first ${count(s.matchCap)}% of your pay, and you are putting in ` +
      `${count(s.employeeContrib)}%. That last ${count(s.employeeContrib - s.matchCap)}% is still saved and still grows, it just is not matched.`;
  }
  return '';
}

// ---- The answer -------------------------------------------------------------
// Why there is nothing to project, in the visitor's own numbers. "Fill in your
// age" over a filled-in age box names the wrong problem, so each branch is
// keyed to what is actually missing or contradictory.
function blockedReason(s) {
  if (!Number.isFinite(s.currentAge) || !Number.isFinite(s.retirementAge)) {
    return 'Fill in how old you are now and the age you want to stop working, and the projection appears here.';
  }
  if (s.retirementAge <= s.currentAge) {
    return `You put ${count(s.currentAge)} as your age now and ${count(s.retirementAge)} as the age you stop working, so there ` +
      `are no years left to save in. Put a later age for when you stop and the projection appears here.`;
  }
  if (!(yearsOf(s) >= 1)) {
    return 'Those two ages are less than a year apart, so there is no year of saving to project yet.';
  }
  return 'One of the numbers above is not one this can work with. Check them and the projection appears here.';
}

// The year-by-year table used to be a separate <details class="amort"> block
// halfway down the page, populated by hand. It is computed, so it belongs with
// the rest of the computed answer inside #out — where the core also carries its
// open/closed state across re-renders for free. Its fold is .otw-help, the one
// in-card idiom, rather than a fourth one of its own; only the table keeps its
// page-scoped classes.
//
// Every interpolated value is a number formatted by usd(), or row.age which the
// engine builds by arithmetic — never raw user input — so the markup stays
// injection-safe.
function scheduleTable(schedule) {
  if (!schedule || !schedule.length) return '';
  let rows = '';
  for (const row of schedule) {
    rows += `<tr><td>${row.age}</td><td>${usd(row.employeeContribution)}</td>` +
      `<td>${usd(row.employerMatch)}</td><td>${usd(row.growth)}</td>` +
      `<td>${usd(row.balanceEnd)}</td></tr>`;
  }
  return `<details class="otw-help" id="otwSchedule"><summary>Show the year-by-year breakdown</summary>` +
    `<div class="amort-table-wrap"><table class="amort-table">` +
    `<thead><tr><th>Age</th><th>Your contribution</th><th>Employer match</th><th>Growth</th><th>Balance</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div></details>`;
}

function renderResult({ state: s, result: r }) {
  const ok = Number.isFinite(r.projectedBalance) && r.schedule && r.schedule.length > 0;

  // The doubt is meant to travel from the card to the answer, because the card
  // that carries the flag may be five screens back. But when there is no
  // projection at all, blockedReason() below explains the SAME contradiction in
  // the same words, and both landed on the same screen three lines apart: "you
  // put 30 as your age now and 25 as the age you stop working, so there are no
  // years left to save in", twice. The flag stands down where the reason has
  // already said it.
  const ageDoubled = !ok && !!ageWarning(s);
  const warnings = [ageDoubled ? '' : ageWarning(s), contribWarning(s)]
    .filter(Boolean)
    .map((t) => `<div class="ot-input-warning">${t}</div>`)
    .join('');

  if (!ok) {
    // An em dash rather than "$0": a projection that cannot be made has no
    // number, and printing $0 over a form the visitor has half filled in reads
    // as an answer rather than as a missing one.
    return warnings +
      `<p class="otw-kick">Your projected balance</p>` +
      `<p class="otw-big otw-zero">&mdash;</p>` +
      `<div class="otw-plain">${blockedReason(s)}</div>`;
  }

  const years = yearsOf(s);

  // ROUNDED ONCE. The labels invite the reader to add the rows up to the number
  // at the top, so they have to add up: the growth row is DERIVED by subtraction
  // from the already-rounded figures above it rather than rounded on its own,
  // which is the only way four independent Math.round()s cannot print a total
  // that is a dollar or two off its own parts.
  const total = Math.round(r.projectedBalance);
  const startR = Math.round(Math.max(0, s.currentBalance));
  const mineR = Math.round(r.totalEmployeeContributions);
  const bossR = Math.round(r.totalEmployerMatch);
  const growthR = total - startR - mineR - bossR;
  const paidIn = startR + mineR + bossR;

  const head =
    `<p class="otw-kick">By the time you stop working, at ${count(s.retirementAge)}</p>` +
    `<p class="otw-big${total > 0 ? '' : ' otw-zero'}">${usd(total)}</p>`;

  const lead = `<p class="otw-lead">Here is where that ${usd(total)} comes from, over the ${count(years)} year` +
    `${years === 1 ? '' : 's'} between now and then:</p>`;

  // .otw-free is the accent colour. On the tax pages it marks money the
  // government skips tax on; there is no such thing here, so it marks the two
  // rows that are money you did not have to save yourself — what your employer
  // added, and what the balance earned. Named in the notes as a deliberate
  // reuse of the accent rather than of the tax meaning.
  const rows =
    `<ul class="otw-story">` +
    `<li><span>Already in the account today</span><span class="otw-amt">${usd(startR)}</span></li>` +
    `<li><span>What you pay in yourself over those years</span><span class="otw-amt">${usd(mineR)}</span></li>` +
    (bossR > 0
      ? `<li><span>What your employer adds on top</span><span class="otw-amt otw-free">${usd(bossR)}</span></li>`
      : '') +
    `<li><span>Growth, earned on the whole balance year after year</span>` +
      `<span class="otw-amt${growthR > 0 ? ' otw-free' : ''}">${usd(growthR)}</span></li>` +
    // Not part of the split above — it is the first rows restated — so it carries
    // the heavier rule that stops a reader adding it in on top.
    //
    // The label names only the people who are actually putting money in, and
    // names the starting balance separately, because this row is startR + mineR
    // + bossR. It read "Paid in altogether, by you and your employer" whatever
    // the numbers said: with the match at zero the employer row was correctly
    // dropped from the story above while the total below it still credited them,
    // and the $25,000 that was already sitting in the account was folded into a
    // figure the lead sentence frames as money paid in "over those years".
    `<li class="otw-after"><span>Already there, plus everything ` +
      `${bossR > 0 ? 'you and your employer pay' : 'you pay'} in</span>` +
      `<span class="otw-amt">${usd(paidIn)}</span></li>` +
    `</ul>`;

  const note = matchNote(s);
  const noteHtml = note ? `<p class="otw-flag">${note}</p>` : '';

  // The plain-terms box. This tool is a projection, not a filing-time deduction,
  // so it says what a projection is: the assumptions it is standing on, in the
  // visitor's own numbers, and that the figure is still before tax.
  let plain = '';
  if (mineR + bossR <= 0) {
    plain = `Nothing new is going into the account with these numbers, so this is just the ${usd(startR)} you already have, ` +
      `growing at ${count(s.annualReturn)}% a year for ${count(years)} year${years === 1 ? '' : 's'}. ` +
      (s.annualSalary <= 0
        ? 'Fill in what you earn in a year, and how much of it you save, to see the rest.'
        : 'Say how much of your pay goes into the account to see the rest.');
  } else {
    plain = `This is a projection, not a promise: it grows your savings by ${count(s.annualReturn)}% every single year, and no ` +
      `real market does that. It also assumes you keep putting in ${count(s.employeeContrib)}% of your pay for the whole ` +
      `${count(years)} year${years === 1 ? '' : 's'}` +
      (s.salaryGrowth > 0 ? `, with your pay rising ${count(s.salaryGrowth)}% a year` : `, and your pay never changing`) +
      `. And the ${usd(total)} is before tax: money in a traditional 401(k) is taxed when you take it out in retirement.`;
  }

  return warnings + head + lead + rows + noteHtml +
    `<div class="otw-plain">${plain}</div>` +
    scheduleTable(r.schedule);
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'retire401kWizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: AGE, fields: ['currentAge'] },
    { step: RETIRE, fields: ['retirementAge'], flags: [{ id: 'otwRetireFlag', text: ageWarning }] },
    { step: BALANCE, fields: ['currentBalance'] },
    { step: SALARY, fields: ['annualSalary'] },
    { step: CONTRIB, fields: ['employeeContrib'], flags: [{ id: 'otwContribFlag', text: contribWarning }] },
    { step: RETURN, fields: ['annualReturn'] },
    { step: MATCH, fields: ['employerMatch'] },
    // The old page's `qMatch` Yes/No question, answered by the match figure
    // itself: 0 cents on the dollar IS "my employer adds nothing", and it drops
    // this card off the path on the keystroke that types it rather than on the
    // next Next. The card still ships visible in the HTML — the core only stops
    // showing it — so a no-JS visitor still meets the question.
    {
      step: CAP,
      fields: ['matchCap'],
      when: (s) => s.employerMatch > 0,
      flags: [{ id: 'otwMatchFlag', text: matchNote }]
    },
    // Last question before the answer, and the only skippable one, because the
    // core's Skip jumps straight to the result: a Skip anywhere earlier would
    // vault the visitor over questions they still need. Skipping blanks the
    // field, which the engine reads as pay that never rises — the same thing the
    // old page's `qGrowth` = No did.
    { step: GROWTH, fields: ['salaryGrowth'], skipClears: ['salaryGrowth'] },
    { step: RESULT, result: true }
  ],

  // The page loads with nine numbers nobody typed, so the answer stays labelled
  // an example until the five that describe THIS VISITOR are their own. The
  // other four are not listed: the expected return, the match rate, the match cap
  // and the pay rise are assumptions the page openly recommends and the answer
  // card names in words, not facts about the person, and requiring all nine would
  // leave the label on a screen that is already fully personal.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('currentAge')) missing.push('your age');
    if (!touched.has('retirementAge')) missing.push('when you stop working');
    if (!touched.has('currentBalance')) missing.push('what is in the account today');
    if (!touched.has('annualSalary')) missing.push('your yearly pay');
    if (!touched.has('employeeContrib')) missing.push('what you put in');
    return missing;
  },

  chips: (s) => {
    const list = [
      { step: AGE, label: Number.isFinite(s.currentAge) ? `${count(s.currentAge)} now` : 'age not set' },
      { step: RETIRE, label: Number.isFinite(s.retirementAge) ? `stop at ${count(s.retirementAge)}` : 'no finish age' },
      { step: BALANCE, label: `${usd(s.currentBalance)} saved` },
      { step: SALARY, label: `${usd(s.annualSalary)}/yr` },
      { step: CONTRIB, label: `${count(s.employeeContrib)}% of pay in` },
      { step: RETURN, label: `${count(s.annualReturn)}% a year` },
      { step: MATCH, label: s.employerMatch > 0 ? `${count(s.employerMatch)}&cent; per dollar` : 'no employer match' }
    ];
    // Only when there is a match to cap: the card itself is off the path
    // otherwise, and a chip is a link back to a card.
    if (s.employerMatch > 0) list.push({ step: CAP, label: `matched to ${count(s.matchCap)}% of pay` });
    list.push({ step: GROWTH, label: s.salaryGrowth > 0 ? `${count(s.salaryGrowth)}% raises` : 'no raises' });
    return list;
  },

  announce: (s, r) => {
    if (!Number.isFinite(r.projectedBalance) || !r.schedule || !r.schedule.length) return blockedReason(s);
    const flagged = ageWarning(s) || contribWarning(s);
    const m = matchNote(s);
    return `Projected balance at age ${count(s.retirementAge)}: ${usd(r.projectedBalance)}.` +
      (m ? ' ' + m : '') +
      (flagged ? ' Check your numbers, there is a warning above the answer.' : '');
  }
});
