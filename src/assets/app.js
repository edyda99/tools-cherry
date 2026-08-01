// app.js — wires the form to the engine and renders results live, on all 51
// /{state}-paycheck-calculator/ pages. Each generated state page injects
// window.__TAX_DATA__ (federal + that state) and window.__STATE_SLUG__ before
// this module loads.
//
// THE CARD FLOW (2026-08-01). The page used to be one .calc card with every
// control on screen at once and a Simple/Advanced mode toggle hiding five plain
// questions. It is now the card-by-card wizard the family shares:
// wizard-core.js drives the stepping, the dots, the Back/Next/Skip nav, the
// 350 ms inline-flag debounce, the answer chips and Start over. What stays here
// is everything that makes this page the paycheck calculator: reading the form,
// calling the engine, and writing the result.
//
// WHY THIS FILE DOES NOT USE spec.renderResult. Every other tool in the family
// hands wizard-core one HTML string for a single #out box. This page's answer is
// about twenty-five separately-identified elements (the headline, the caption,
// each withholding row, the state's disability/paid-leave rows, the rate row,
// the bracket table) and build.js PRE-RENDERS every one of them at build time
// from the same computation, so a crawler and a no-JS reader see the real
// figures. assertPanelParity() then fails the build if this file's first render
// would write a different string into any of them, if a row app.js writes has no
// pre-rendered value, or if the visible rows stop adding up to Net pay. So the
// page ships no #out at all, wizard-core never calls renderResult, and render()
// below writes the same ids it always did. Adding or removing one of those
// writes is a build.js change as well as a change here.
//
// EVERY INPUT STAYS IN THE DOM. readForm() and render() read most of those ids
// unguarded on every keystroke, and answeredYes() treats a MISSING qX radio
// group as "yes". Cards the visitor is not on are hidden by CSS, never
// unmounted; wizard-core is built the same way.
//
// THE FOUR RULE QUESTIONS COMPUTE (2026-08-01). Tips, extra hours, a bonus and
// turning 65 used to do one thing between them: filter which of this state's
// pointer lines the answer card showed. They now ask for the one or two figures
// the rule actually needs and the answer card says what each is worth, using the
// SAME engines the standalone calculators use — obbba-deduction.js for the three
// deductions and bonus-tax.js for the bonus. No math is re-derived here.
//
// AND NONE OF IT TOUCHES THE PAYCHECK. Tips, overtime and the senior deduction
// are filing-time deductions: they arrive as a bigger refund or a smaller bill
// next year, they do not change withholding during the year, and they never
// enter computePaycheck's input or any row of the results table. They are
// printed in a block of their own, below the table, labelled as money back when
// you file. The bonus is the other way round — a payday figure — and its line
// says so and carries the heavier rule that stops a reader adding it in.
import { computePaycheck, PAY_PERIODS, federalBracketBreakdown, annualizeGross } from '/assets/paycheck-engine.js';
import { allowedDeduction, federalTaxSaved, overtimePremium, seniorDeduction } from '/assets/obbba-deduction.js';
import { computeBonus } from '/assets/bonus-tax.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
// Imported, never re-derived: one shared reader for a radio group, one for a
// select, and the boot handshake that puts the site's "this calculator failed to
// load" banner on screen with the plain stacked form still visible underneath it.
// numOf is the shared reader for a plain number field: positive numbers only,
// fractions KEPT, because 12.5 overtime hours is 12.5 hours. countValue() below
// floors instead, on purpose, because you cannot claim half a dependent.
// count() quotes an hours figure back with its fractions intact, so 12.5 hours
// is never read back as "13". Imported rather than re-derived, like the readers.
import { createWizard, radioOf, selectOf, numOf, count } from '/assets/wizard-core.js';
const taxData = window.__TAX_DATA__;
const stateSlug = window.__STATE_SLUG__;

const usd = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n * 100).toFixed(1) + '%';
const ratePct = (n) => (+(n * 100).toFixed(3)).toString() + '%'; // 0.10 -> "10%", 0.00432 -> "0.432%"
const escLbl = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// What the three rate figures say while the pay field is empty. The honest
// behaviour is to decline to answer — a rate computed from no pay is not zero,
// it is unknown — but the previous placeholder said "n/a", an abbreviation
// aimed at a reader who already knows the convention, on pages whose whole
// premise is plain language. This says the same thing in words, and echoes the
// wording already under the headline figure ("Enter your pay above to see your
// take-home") so the panel speaks with one voice. All three rows share it, so
// they cannot drift apart.
const NO_PAY_YET = 'enter your pay';
// Sentence form of the same phrase, for the places that need a whole line rather
// than a table cell: the band caption and the Advanced echo. Derived from
// NO_PAY_YET rather than written out again, so the panel cannot end up saying two
// different things about the same state.
const NO_PAY_YET_ASK =
  NO_PAY_YET.charAt(0).toUpperCase() + NO_PAY_YET.slice(1) + ' above and this updates';

const $ = (id) => document.getElementById(id);
// Comma-safe: the advanced-mode deduction fields carry live thousands
// separators, so read them through moneyValue rather than a raw parseFloat,
// which would silently truncate "2,000" to 2.
const num = (id) => moneyValue($(id)) || 0;

// Same grouping style as money-input.js writes into the money fields, so a
// value we set programmatically keeps the separators the visitor sees.
const fmtAmount = (n, dp) => n.toLocaleString('en-US', { maximumFractionDigits: dp });

// --- The cards ---------------------------------------------------------------
// data-step on each card in state-page.html, named. PAY asks the KIND of pay and
// the figure together, in that order: they were two cards, and a visitor who
// typed 28 into the first met the word "hourly" only on the second, by which
// time the answer had already been worked out from a $28 salary. The five
// deduction cards come last because they are the only optional ones that change
// the paycheck; the four rule cards before them change no paycheck figure at all
// — they are worked out as filing-time money on the answer card. RESULT is never
// skipped.
const PAY = 0, HOURS = 1, FREQ = 2, FILING = 3;
const Q_TIPS = 4, Q_OT = 5, Q_BONUS = 6, Q_AGE = 7;
const Q_RETIRE = 8, Q_HEALTH = 9, Q_DEPS = 10, Q_EXTRA = 11, Q_POST = 12;
const RESULT = 13;

// --- The five deduction questions -------------------------------------------
// Each is a yes/no radio group on its own card; the money input it needs sits in
// a [data-reveal] wrapper that ships visible in the HTML and is hidden here when
// the answer is No. Answering No zeroes that field's contribution even if a
// number is still sitting in it, so flipping back to No always restores the
// plain answer.
const ADV_QUESTIONS = ['qRetire', 'qHealth', 'qDeps', 'qExtra', 'qPost'];

// --- The four rule questions -------------------------------------------------
// Three of them now reveal a figure of their own on the same card, on the same
// terms: the wrapper ships VISIBLE and is hidden when the answer is No, and a No
// contributes nothing to the answer whatever is still sitting in the box.
// qAge reveals nothing — its deduction is worked out from the pay and the filing
// status this page already has.
const RULE_QUESTIONS = ['qTips', 'qOt', 'qBonus'];
const REVEAL_QUESTIONS = RULE_QUESTIONS.concat(ADV_QUESTIONS);

// W-4 Step 3 arithmetic, UI layer only: the engine still receives one annual
// dollar figure in adv.dependentsCredit, exactly as before.
const CREDIT_PER_CHILD = 2000;
const CREDIT_PER_OTHER = 500;

// True when the question is answered Yes. A page that does not carry the
// question UI at all (no radios by that name) falls back to true, so the raw
// money field keeps working on its own.
function answeredYes(name) {
  const group = document.querySelectorAll(`input[name="${name}"]`);
  if (!group.length) return true;
  return Array.prototype.some.call(group, (el) => el.checked && el.value === 'yes');
}

const advMoney = (question, id) => (answeredYes(question) ? num(id) : 0);

const countValue = (id) => {
  const el = $(id);
  if (!el) return 0;
  const v = Math.floor(parseFloat(el.value));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

// Dollar credit derived from the two dependent counts. Falls back to a plain
// dollar field if a page still ships one instead of the counts.
function dependentsCreditValue() {
  if (!$('depChildren') && !$('depOther')) return num('dependentsCredit');
  return countValue('depChildren') * CREDIT_PER_CHILD + countValue('depOther') * CREDIT_PER_OTHER;
}

function syncAdvancedQuestions() {
  for (const name of REVEAL_QUESTIONS) {
    const host = document.querySelector(`[data-reveal="${name}"]`);
    if (!host) continue;
    const show = answeredYes(name);
    // Never strand the keyboard inside a wrapper that is about to disappear.
    if (!show && host.contains(document.activeElement)) {
      const picked = document.querySelector(`input[name="${name}"]:checked`);
      if (picked) picked.focus();
    }
    host.hidden = !show;
  }
  // The one sub-reveal: "what is one normal hour of your work worth" is asked
  // only of a salaried visitor. An hourly one answered it on card one, and
  // asking twice is how two answers to one question end up disagreeing.
  const rateHost = document.querySelector('[data-reveal-basis="salary"]');
  if (rateHost) {
    const needRate = payBasis() !== 'hourly';
    if (!needRate && rateHost.contains(document.activeElement)) {
      const back = document.querySelector('input[name="qOt"]:checked');
      if (back) back.focus();
    }
    rateHost.hidden = !needRate;
  }
  const derived = $('depCredit');
  if (derived) derived.textContent = usd(dependentsCreditValue());
}

function currentView() {
  return radioOf('view', 'period');
}

// How the visitor said they are paid: 'salary' (a year), 'monthly' (a month) or
// 'hourly'. selectOf answers '' for a page that ships no such control, which
// falls back to the shipped default — the same value a no-JS submit would send.
const payBasis = () => selectOf('wageType') || 'salary';

// The one reader. wizard-core calls it too (spec.read), so the flow's path
// predicates, its answer chips and its inline flags all see exactly the figures
// the engine is about to be handed, rather than a second reading of the same
// fields that could disagree with it.
//
// Pay frequency and filing status are radio groups rather than <select>s since
// the card rewrite: a card asks one question, and a radio group answers it
// without a second tap into a dropdown. Pay type is the exception — three
// choices, two of which differ by one word, read better as a list, and it sits
// on the same card as the figure it describes.
//
// MONTHLY IS AN ADAPTER AND NOTHING MORE. paycheck-engine.js knows two kinds of
// wage, a yearly salary and an hourly rate, and it stays that way: a monthly
// figure is multiplied by twelve HERE, on its way in, and the engine is not
// touched. `basis` and `typed` carry the visitor's own answer alongside, so the
// caption, the chips and the labels can quote the number they actually typed
// rather than the annualised one.
function readForm() {
  const basis = payBasis();
  const amount = moneyValue($('amount')) || 0;
  const hoursPerWeek = parseFloat($('hours').value) || 40;
  const annualAmount = basis === 'monthly' ? amount * 12 : amount;
  return {
    basis,
    typed: amount,
    wage: { type: basis === 'hourly' ? 'hourly' : 'salary', amount: annualAmount, hoursPerWeek },
    filingStatus: radioOf('filingStatus', 'single'),
    payFrequency: radioOf('payFrequency', 'biweekly'),
    stateSlug,
    // The four rule answers and the figures they need. Read on every keystroke
    // like everything else here, and gated by their own question exactly as the
    // five deduction fields below are: a No is worth zero whatever is in the box.
    rules: {
      tips: answeredYes('qTips') ? num('tipsYear') : 0,
      otHours: answeredYes('qOt') ? numOf('otHours') : 0,
      otRate: answeredYes('qOt') ? num('otRate') : 0,
      // An hourly visitor's normal rate is the figure on card one; a salaried
      // one is asked for it, because a salary does not name an hourly rate.
      normalRate: answeredYes('qOt') ? (basis === 'hourly' ? amount : num('regRate')) : 0,
      bonus: answeredYes('qBonus') ? num('bonusAmount') : 0,
      age65: answeredYes('qAge')
    },
    // Always read, never gated on a mode toggle: the five questions are cards in
    // the flow now, every one of them ships answered No, and No zeroes its own
    // field. So the default flow produces exactly what the old Simple mode did,
    // which is what build.js pre-renders the results panel from.
    adv: {
      retirement401k: advMoney('qRetire', 'retirement401k'),
      cafeteria125: advMoney('qHealth', 'cafeteria125'),
      dependentsCredit: answeredYes('qDeps') ? dependentsCreditValue() : 0,
      extraWithholding: advMoney('qExtra', 'extraWithholding'),
      postTax: advMoney('qPost', 'postTax')
    }
  };
}

// --- Inline warnings ---------------------------------------------------------
// Never blocking: the answer still computes underneath every one of these, the
// doubt just travels with it. Each lives on the card that asks for the SECOND of
// the two numbers it compares, because that is where the visitor is standing the
// first moment the contradiction can exist. wizard-core debounces them to the
// settled value (350 ms) and flushes on blur and on step change, so a flag can
// never flicker mid-word and move the Next button under a thumb.
const yearlyPay = (s) => annualizeGross(s.wage);

// The expensive mistake this page can make: typing a yearly salary while the
// dropdown above it says hourly. It does not look wrong on the card, and the
// answer it produces is wrong by a factor of about two thousand.
// The one line between "a yearly salary" and "an hourly rate". Nobody is paid
// $1,000 an hour and nobody earns $1,000 a year, so a figure on the wrong side
// of it is the wrong KIND of number rather than an unusual one.
//
// There is deliberately no monthly-vs-yearly twin of this check. $75,000 is a
// perfectly ordinary yearly salary AND a possible monthly one, so the two
// answers cannot contradict each other the way a $75,000 hourly rate and a
// 40-hour week do; there is no line to put between them that would not be
// invented. The example label carries our $75,000 until the visitor types over
// it, which is the honest cover for that case.
const WAGE_KIND_LINE = 1000;

function wageTypeWarning(s) {
  if (s.wage.type !== 'hourly' || s.wage.amount < WAGE_KIND_LINE) return '';
  return `Check these numbers: ${usd2(s.wage.amount)} an hour over ${s.wage.hoursPerWeek} hours a week ` +
    `comes to ${usd(yearlyPay(s))} a year. If that figure is your yearly salary, choose "A yearly salary" above.`;
}

// Tips are part of your pay, so tips above the whole year's pay is the same
// number counted wrong. The contradiction can only exist once the tips figure
// exists, so the flag lives on the tips card.
function tipsWarning(s) {
  const pay = yearlyPay(s);
  if (pay <= 0 || s.rules.tips <= 0 || s.rules.tips <= pay) return '';
  return `Check these numbers: the ${usd(s.rules.tips)} you entered as tips is more than the ${usd(pay)} you entered ` +
    `as your pay for the whole year, and your pay is supposed to include your tips.`;
}

// Overtime pay alone larger than the whole year's pay. Same shape: the overtime
// hours are hours you were paid for, so they cannot come to more than the pay.
function overtimeWarning(s) {
  const pay = yearlyPay(s);
  const otPay = s.rules.otRate * s.rules.otHours;
  if (pay <= 0 || otPay <= 0 || otPay <= pay) return '';
  return `Check these numbers: ${count(s.rules.otHours)} extra hours at ${usd2(s.rules.otRate)} an hour comes to ` +
    `${usd(otPay)}, which is more than the ${usd(pay)} you entered as your pay for the whole year, and your pay ` +
    `is supposed to include what those hours paid.`;
}

function retireWarning(s) {
  const pay = yearlyPay(s);
  if (pay <= 0 || s.adv.retirement401k <= 0 || s.adv.retirement401k <= pay) return '';
  return `Check these numbers: the ${usd(s.adv.retirement401k)} going into your retirement plan is more than ` +
    `the ${usd(pay)} you are paid in a year, and it comes out of that pay.`;
}

function healthWarning(s) {
  const pay = yearlyPay(s);
  const before = s.adv.retirement401k + s.adv.cafeteria125;
  if (pay <= 0 || s.adv.cafeteria125 <= 0 || before <= pay) return '';
  return `Check these numbers: ${usd(before)} coming out before tax is more than the ${usd(pay)} you are paid ` +
    `in a year. Both figures are meant to be yearly totals.`;
}

function extraWarning(s) {
  const pay = yearlyPay(s);
  if (pay <= 0 || s.adv.extraWithholding <= 0 || s.adv.extraWithholding <= pay) return '';
  return `Check these numbers: ${usd(s.adv.extraWithholding)} of extra tax is more than the ${usd(pay)} you are ` +
    `paid in a year. If your W-4 shows a per-paycheck amount, multiply it by the number of paychecks you get.`;
}

function postWarning(s) {
  const pay = yearlyPay(s);
  if (pay <= 0 || s.adv.postTax <= 0 || s.adv.postTax <= pay) return '';
  return `Check these numbers: ${usd(s.adv.postTax)} coming out after tax is more than the ${usd(pay)} you are ` +
    `paid in a year.`;
}

const PERIOD_LABEL = {
  weekly: 'per week', biweekly: 'per 2 weeks', semimonthly: 'twice a month',
  monthly: 'per month', annual: 'per year'
};

// Caption for the headline figure, so a number and the assumptions behind it are
// provably computed from the same inputs. build.js pre-renders the default-input
// version of this exact sentence (stateNetLabel), so the first render overwrites
// it with an identical string and nothing visibly changes on load.
const PAID_LABEL = {
  weekly: 'paid every week', biweekly: 'paid every 2 weeks', semimonthly: 'paid twice a month',
  monthly: 'paid monthly', annual: 'paid once a year'
};
const FILING_LABEL = {
  single: 'single filer', married: 'married filing jointly', head_of_household: 'head of household'
};

function netLabelText(input) {
  const name = taxData.states[stateSlug]?.name;
  if (!name) return '';
  const filing = FILING_LABEL[input.filingStatus] || FILING_LABEL.single;
  const paid = PAID_LABEL[input.payFrequency] || PAID_LABEL.biweekly;
  // Quotes the figure the visitor typed, in the words they chose for it: a
  // monthly answer says "a $6,250 monthly salary", not the $75,000 the engine
  // was handed. The salary and hourly wordings are untouched, and the salary one
  // is byte-for-byte what build.js pre-renders (stateNetLabel) for the shipped
  // defaults, so hydration still changes nothing.
  const basis = input.basis === 'hourly'
    ? `${usd2(input.typed)} an hour over ${input.wage.hoursPerWeek} hours a week`
    : input.basis === 'monthly'
      ? `a ${usd(input.typed)} monthly salary`
      : `a ${usd(input.typed)} salary`;
  return `Based on ${basis} in ${name}, ${filing}, ${paid}`;
}

// --- the extractable answer sentence above the calculator -------------------
// build.js server-renders one sentence per state ("In Missouri for 2026, a
// $75,000 salary takes home about $59,005 per year after ...") so a crawler and
// a no-JavaScript visitor both get a complete answer. It stayed frozen at
// $75,000 while the calculator underneath it moved, so a visitor who typed
// 40,000 read two different take-home figures 200px apart on a money tool. The
// sentence stays in the served HTML exactly as before; render() now rewrites its
// two dollar figures from the live result.
//
// Rewriting figures rather than rebuilding the sentence is deliberate: build.js
// picks one of three wordings per state and appends a state-tax clause and a
// disability/paid-leave clause conditionally, none of which app.js can see. What
// it CAN rely on is the shape, and only the shape: every one of the 51 built
// pages carries exactly two dollar figures in this paragraph, the $75,000
// example salary first and its take-home second. Anything else is a sentence
// this code does not understand, so it is left untouched rather than guessed at.
//
// Always annual, never the per-paycheck view: the sentence says "per year" in
// all three wordings, so it must not follow the Per paycheck / Annual toggle.
let answerLead = null; // null = not looked at yet, false = leave it alone

function captureAnswerLead() {
  if (answerLead !== null) return answerLead;
  const host = document.querySelector('.answer-lead');
  const el = (host && host.querySelector('strong')) || host;
  if (!el) { answerLead = false; return answerLead; }
  const text = el.textContent;
  const spans = [];
  const re = /\$[\d,]+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(text)) !== null) spans.push([m.index, m.index + m[0].length]);
  answerLead = spans.length === 2 ? { el, text, spans } : false;
  return answerLead;
}

function renderAnswerLead(r) {
  const lead = captureAnswerLead();
  if (!lead) return;
  const { el, text, spans } = lead;
  // With the pay field empty there is nothing live to state, so the page's own
  // worked example comes back rather than a sentence full of zeroes.
  if (!(r.annual.gross > 0)) { el.textContent = text; return; }
  const [g, n] = spans;
  el.textContent =
    text.slice(0, g[0]) + usd(r.annual.gross) +
    text.slice(g[1], n[0]) + usd(r.annual.net) +
    text.slice(n[1]);
}

// --- the two slots build.js cannot pre-render --------------------------------
// READ THIS BEFORE ADDING A THIRD ONE.
//
// build.js's pre-render guard (scanAppFirstRender + assertPanelParity) scans
// THIS FILE for `$('someId').textContent = …` writes reachable from init(), and
// fails the build for any id statePanel() has no pre-rendered value for. That
// guard is right, and it is why twenty-five figures on this page are served real
// and hydrate to the identical string. It is also in build.js, which the pass
// that added these two elements was not allowed to edit, so these two are
// addressed by ATTRIBUTE and stay out of its denominator.
//
// Both are parity-neutral BY CONSTRUCTION, which is the only reason this is
// acceptable rather than a hole in the guard:
//   amountLabel — the template serves the SALARY wording and the select ships
//     "A yearly salary" selected, so the first render writes back the identical
//     string. scripts/test-ux-structure.js pins that identity, which is the
//     check build.js would otherwise be making.
//   filing     — ships EMPTY, and all four rule questions ship answered No, so
//     the first render writes the same empty string. It is a computed answer,
//     the one thing that has always been JavaScript-only here (#out everywhere
//     else in this family), and it hides nothing from a crawler: the per-state
//     pointer lines it sits above are server-rendered and stay visible.
//
// The right end state is two entries in statePanel().expected — one
// `{ expect: <the salary label> }` and one `{ expect: '' }` — and these writes
// moved back onto $('id'). That is a build.js change; see
// notes/state-page-phase5.md.
const slot = (name) => document.querySelector(`[data-otw-slot="${name}"]`);

// The amount field asks for one figure whose meaning is whatever the select
// above it says, so its label follows the select. Nothing else follows it: the
// VALUE is never rewritten, because a number the visitor typed under one label
// is not a number they typed under another.
const AMOUNT_LABEL = {
  salary: 'How much is that a year, before anything comes out?',
  monthly: 'How much is that a month, before anything comes out?',
  hourly: 'How much is that an hour, before anything comes out?'
};

function syncAmountLabel(basis) {
  const el = slot('amountLabel');
  if (!el) return;
  const text = AMOUNT_LABEL[basis] || AMOUNT_LABEL.salary;
  // Written only when it differs, so the served bytes are left alone on the
  // boot render rather than replaced with an identical string.
  if (el.textContent !== text) el.textContent = text;
}

// --- What the four rule answers are worth ------------------------------------
// The engines are the ones the standalone calculators use, called with the pay
// and the filing status this page already knows:
//   tips, overtime, turning 65 -> obbba-deduction.js  (FILING-TIME deductions)
//   a bonus in this state      -> bonus-tax.js        (a PAYDAY figure)
// Their PARAMETERS are not in window.__TAX_DATA__ (that payload is deliberately
// this state plus the federal tables and nothing else), so they are fetched from
// the two published data files the site already serves, on demand, the first
// time a rule is answered Yes. Same-origin static JSON, the same shape the
// build reads, and the same trick renderCompare() below already uses for the
// all-states file. Nothing is fetched for a visitor who answers No to all four.
const OBBBA_URL = '/data/obbba-deductions-2026.json';
const SUPP_URL = '/data/state-supplemental-withholding-rates-2026.json';
let ruleData = null;                 // { obbba, supp } once BOTH have landed
let ruleDataState = 'idle';          // idle -> loading -> ready | failed

async function ensureRuleData() {
  if (ruleDataState !== 'idle') return;
  ruleDataState = 'loading';
  try {
    const [obbba, supp] = await Promise.all([
      fetch(OBBBA_URL).then((res) => res.json()),
      fetch(SUPP_URL).then((res) => res.json())
    ]);
    // Both or neither: half the data would compute two of the four rules and
    // silently drop the others, which reads as "this rule is worth nothing".
    if (!obbba || !obbba.federal || !supp || !supp.states) throw new Error('rule data incomplete');
    ruleData = { obbba, supp };
    ruleDataState = 'ready';
  } catch (e) {
    ruleDataState = 'failed';
  }
  render();
}

// The state's own 2026 verdict on the federal tips deduction, in the same words
// /tips-tax-calculator/ uses for the same four verdicts, so one visitor reading
// both pages is told the same thing twice rather than two different things.
const CONFORMITY = {
  yes: (name) => `deductible on your ${name} return too`,
  no: (name) => `still taxed by ${name}`,
  partial: (name) => `and ${name} adds a smaller capped state break of its own`,
  unclear: (name) => `not yet confirmed by ${name}`
};

function conformityClause(kind) {
  const e = ruleData && ruleData.obbba.states && ruleData.obbba.states[stateSlug];
  const name = taxData.states[stateSlug]?.name || '';
  if (!e || !name) return '';
  if (!e.hasWageTax) return `${name} taxes no wages, so the federal deduction is the whole story here.`;
  const v = e[kind] && e[kind].y2026;
  const say = CONFORMITY[v];
  if (!say) return '';
  const lead = v === 'partial' ? 'It is federally deductible' : `In ${name} it is`;
  return `${lead} ${say(name)}.`;
}

// The three deductions, in card order, each with the tax it saves. CHAINED, not
// computed one at a time: obbba-deduction.js's own W-4 helper says why, and it
// is the same reason — the tax saved by two deductions together is one
// bracket-diff on their sum, never the sum of two separate diffs, because the
// combined amount can span a bracket line the individual ones do not reach. So
// each row is worth what it adds ON TOP of the rows above it, the last row's
// running total IS the combined figure, and the rows therefore add up to it.
function filingRows(input, income) {
  const fed = taxData.federal;
  const obbba = ruleData.obbba.federal;
  const filing = input.filingStatus;
  const rules = input.rules;
  const rows = [];
  let running = 0;
  let savedSoFar = 0;
  const chain = (deduction) => {
    running += Math.max(0, deduction);
    const total = federalTaxSaved(income, filing, running, fed).taxSaved;
    const mine = total - savedSoFar;
    savedSoFar = total;
    return mine;
  };

  if (rules.tips > 0) {
    const d = allowedDeduction({
      eligibleAmount: rules.tips, filingStatus: filing, magi: income, params: obbba.tips
    });
    rows.push({
      label: 'Tips',
      saved: chain(d.deduction),
      // Both numbers, always, the moment the cap or the phase-out binds: "your
      // tips" and "the deductible amount" are the same figure only until it does.
      note: d.deduction < rules.tips
        ? `${usd(d.deduction)} of your ${usd(rules.tips)} in tips is deductible` +
          (d.fullyPhasedOut
            ? `: your pay is high enough that the deduction is fully phased out.`
            : d.phasedOut
              ? `: the ${usd(d.statutoryCap)} cap falls to ${usd(d.allowedCap)} at your income, and the rest of your tips is taxed as usual.`
              : `. The deduction stops at ${usd(d.allowedCap)} a year, and the rest of your tips is taxed as usual.`)
        : `All ${usd(rules.tips)} of your tips comes off the income you are taxed on.`,
      extra: conformityClause('tips')
    });
  }

  if (rules.otHours > 0 || rules.otRate > 0 || rules.normalRate > 0) {
    // The shipped overtime pattern, not a 1.5x assumption: only the required
    // "half" above the normal rate is deductible, and only as much of it as was
    // actually paid. Double time pays more than the half and the excess is
    // taxed as usual; an employer paying less than time and a half pays less
    // than the half, and that smaller figure is what comes off.
    const paidExtra = Math.max(0, rules.otRate - rules.normalRate) * rules.otHours;
    const requiredHalf = overtimePremium(rules.normalRate, rules.otHours);
    const premium = Math.min(paidExtra, requiredHalf);
    const d = allowedDeduction({
      eligibleAmount: premium, filingStatus: filing, magi: income, params: obbba.overtime
    });
    let note;
    if (rules.normalRate <= 0) {
      note = 'Fill in what one normal hour of your work is worth and this fills in.';
    } else if (rules.otHours <= 0) {
      note = 'Fill in how many extra hours you will work this year and this fills in.';
    } else if (paidExtra <= 0) {
      note = `Those hours pay ${usd2(rules.otRate)}, which is not above your normal ${usd2(rules.normalRate)}, ` +
        `so they paid no premium and there is nothing to deduct. If the two rates went in the wrong way round, swap them.`;
    } else if (d.deduction < premium) {
      note = `${usd(d.deduction)} of your ${usd(premium)} overtime premium is deductible` +
        (d.fullyPhasedOut
          ? `: your pay is high enough that the deduction is fully phased out.`
          : `: the deduction stops at ${usd(d.allowedCap)} a year, and the rest is taxed as usual.`);
    } else {
      note = `Only the extra "half" above your normal rate counts, which is ${usd(premium)} of the ` +
        `${usd(rules.otRate * rules.otHours)} those ${count(rules.otHours)} hours pay.`;
    }
    rows.push({ label: 'Extra hours', saved: chain(d.deduction), note, extra: conformityClause('overtime') });
  }

  if (rules.age65) {
    const d = seniorDeduction({
      year: Number(taxData.taxYear), filingStatus: filing, age65: true, spouseAge65: false,
      magi: income, params: obbba.senior
    });
    const perPerson = obbba.senior.amountPerPerson;
    let note;
    if (d.fullyPhasedOut) {
      note = `The ${usd(perPerson)} senior deduction is fully phased out at your income, so it is worth nothing this year.`;
    } else if (d.phasedOut) {
      note = `${usd(d.deduction)} of the ${usd(perPerson)} senior deduction survives at your income; it shrinks by ` +
        `6 cents for every dollar of pay over ${usd(d.threshold)}.`;
    } else {
      note = `${usd(d.deduction)} comes off the income you are taxed on for being 65 or over.`;
    }
    rows.push({
      label: 'Turning 65',
      saved: chain(d.deduction),
      note,
      // Counted for ONE person, because the card asks one question about two
      // people. Saying so is the difference between an estimate and a wrong
      // answer for a couple who both turn 65.
      extra: filing === 'married'
        ? 'Counted for one of you. If you both turn 65 this year it is doubled, which the senior calculator works out.'
        : ''
    });
  }
  return { rows, total: savedSoFar };
}

// What a bonus does, from the bonus engine, for THIS state. A payday figure, not
// a filing-time one: it is what lands in the account when the bonus is paid,
// after the flat federal prepayment, this state's supplemental withholding and
// FICA. It is never added to the deductions above it.
function bonusLine(input, income) {
  const b = computeBonus(
    {
      bonus: input.rules.bonus, regIncome: income, filingStatus: input.filingStatus,
      stateSlug, ytdSupp: 0, method: 'flat', paymentType: 'bonus'
    },
    taxData, ruleData.supp
  );
  return { bonus: Math.round(b.bonus), lands: Math.round(b.withheld.keep) };
}

// The overtime rate starts at one and a half times the normal rate, the usual
// overtime rate, and STOPS following the moment the visitor types their own:
// their number outranks our guess for the rest of the session. Copied in shape
// from /overtime-tax-calculator/, which is where the rule was settled — the
// calculator does not assume time and a half, it offers it and then believes
// what it is told, because employers break the assumption in both directions.
let otRateTouched = false;

function syncOtRate() {
  if (otRateTouched) return;
  const el = $('otRate');
  if (!el) return;
  const normal = payBasis() === 'hourly' ? (moneyValue($('amount')) || 0) : num('regRate');
  const v = Math.round(normal * 1.5 * 100) / 100;
  const next = v > 0 ? fmtAmount(v, 2) : '';
  if (el.value !== next) el.value = next;
}

// The block itself. Empty is a real answer here and the commonest one: four
// questions answered No have nothing to say.
function renderAtFiling(input, r) {
  const box = slot('filing');
  if (!box) return;
  const rules = input.rules;
  const anyYes = rules.tips > 0 || rules.bonus > 0 || rules.age65 ||
    rules.otHours > 0 || rules.otRate > 0 || rules.normalRate > 0 ||
    answeredYes('qTips') || answeredYes('qOt') || answeredYes('qBonus');
  if (!anyYes) { box.innerHTML = ''; return; }

  ensureRuleData();
  const income = r.annual.gross;
  if (!(income > 0)) {
    box.innerHTML = `<p class="otw-note">Enter your pay above and we work out what these are worth to you.</p>`;
    return;
  }
  if (ruleDataState === 'failed') {
    box.innerHTML = `<p class="otw-note">We could not load the 2026 deduction figures just now, so these are not ` +
      `worked out here. The links below still do it in full.</p>`;
    return;
  }
  if (ruleDataState !== 'ready') {
    box.innerHTML = `<p class="otw-note">Working out what these are worth to you…</p>`;
    return;
  }

  const { rows, total } = filingRows(input, income);

  // ROUNDED ONCE, THEN DERIVED. The labels invite a reader to add these up, so
  // the printed rows have to come to the printed total: every row but the last
  // is rounded on its own and the last is DERIVED from the already-rounded
  // total. (If that derivation ever came out negative — possible only when the
  // last row is worth almost nothing and the others round up — the total
  // becomes the sum of the rounded rows instead, so the two are never at odds.)
  const amounts = rows.map((row) => Math.round(row.saved));
  let totalR = Math.round(total);
  if (rows.length > 1) {
    const derived = totalR - amounts.slice(0, -1).reduce((a, b) => a + b, 0);
    if (derived >= 0) amounts[amounts.length - 1] = derived;
    else totalR = amounts.reduce((a, b) => a + b, 0);
  }

  // The rows carry the money and nothing else; every qualifying sentence goes
  // BELOW the list, named for the row it qualifies. A note nested inside a flex
  // row would sit on the same line as the label it belongs to.
  const items = rows.map((row, i) =>
    `<li><span>${escLbl(row.label)}</span>` +
    `<span class="otw-amt otw-free">+${usd(amounts[i])}</span></li>`
  ).join('');

  const totalRow = rows.length > 1
    ? `<li class="otw-after"><span>Back when you file, all together</span>` +
      `<span class="otw-amt otw-free">+${usd(totalR)}</span></li>`
    : '';

  // The bonus is a PAYDAY figure sitting in a filing-time block, so it carries
  // the heavier rule that stops a reader adding it in, and its own words say
  // when it happens.
  let bonusRow = '';
  const stateName = taxData.states[stateSlug]?.name || '';
  const notes = rows.filter((row) => row.note || row.extra)
    .map((row) => `<p class="otw-note"><strong>${escLbl(row.label)}.</strong> ${escLbl(row.note)}` +
      `${row.extra ? ' ' + escLbl(row.extra) : ''}</p>`);
  if (rules.bonus > 0) {
    const b = bonusLine(input, income);
    bonusRow = `<li class="otw-after"><span>Your ${usd(b.bonus)} bonus lands as about this on payday</span>` +
      `<span class="otw-amt">${usd(b.lands)}</span></li>`;
    notes.push(`<p class="otw-note"><strong>Bonus.</strong> That is what arrives the day it is paid, after the flat ` +
      `federal prepayment, ${escLbl(stateName)} withholding and Social Security and Medicare. It is not filing-time ` +
      // Only claim there is a total to keep it out of when there IS one.
      `money${rows.length ? ', so it is not part of the total above' : ''}. Some of the federal part usually comes ` +
      `back when you file, which the bonus calculator works out.</p>`);
  }

  const story = (items || bonusRow)
    ? `<ul class="otw-story">${items}${totalRow}${bonusRow}</ul>${notes.join('')}`
    : '';
  const lead = rows.length
    ? `<p class="otw-lead">None of this changes the paycheck above. It arrives when you file:</p>`
    : '';

  // The three sentences the whole family of filing-time deduction tools has to
  // say, because without them readers left believing this money was tax-free
  // outright: it comes back at filing, Social Security and Medicare are still
  // owed on every dollar of it, and the paycheck during the year does not move.
  // A bonus-only answer gets none of them: not one of the three is true of it,
  // and pasting a FICA note onto a tool it does not describe is how a page ends
  // up confidently explaining the wrong thing.
  let plain = '';
  if (rows.length) {
    plain = `<div class="otw-plain">This is money back when you file next year, as a bigger refund or a smaller ` +
      `bill, not extra in each paycheck. Social Security and Medicare are still owed on every dollar of it, and ` +
      `your take-home above does not change because of it. Ask your employer about your W-4 if you would rather ` +
      `have it during the year.</div>`;
  } else if (!bonusRow) {
    plain = `<div class="otw-plain">Nothing to claim at filing from your answers so far. Fill in the figures on ` +
      `the cards you answered Yes to and this fills in.</div>`;
  }

  // The heading names what is actually below it. "At filing next year" over a
  // lone bonus row would be flatly wrong: a bonus is paid, and taxed, on payday.
  const kick = rows.length ? 'At filing next year' : (bonusRow ? 'When that bonus is paid' : 'At filing next year');

  box.innerHTML = `<p class="otw-kick">${kick}</p>` + lead + story + plain;
}

// --- zero state -------------------------------------------------------------
// The money rows the results panel prints unconditionally. With no pay entered
// they used to read "−$0.00" five times under a "$0.00" headline, which asserts
// an answer instead of asking for input, and this is the primary path, not an
// edge case, because the salary field ships pre-filled so most visitors clear it
// before they type. style.display rather than [hidden] for the same reason the
// deduction rows below use it: author .line{display:flex} beats the UA [hidden]
// rule.
//
// .rate-row is deliberately NOT in here. Those three figures already decline to
// answer in this state (NO_PAY_YET, "enter your pay"), which is the behaviour
// this change is extending to the rest of the panel, not something to undo. It
// also keeps the card from going completely blank: one row still says what to do
// next, which is the point.
const ALWAYS_ON_ROW_IDS = ['rGross', 'rFederal', 'rSS', 'rMedicare', 'rNet'];

function showResultRows(show) {
  const value = show ? '' : 'none';
  for (const id of ALWAYS_ON_ROW_IDS) {
    const el = $(id);
    const row = el && el.closest('.line');
    if (row) row.style.display = value;
  }
}

function renderBreakdown(r) {
  const g = r.annual.gross;
  if (g <= 0) { $('breakdown').style.display = 'none'; return; }
  $('breakdown').style.display = '';
  const taxes = r.annual.totalTax;
  const ded = r.annual.preTax + r.annual.postTax + (r.annual.statePrograms || 0);
  const net = r.annual.net;
  const w = (v) => (v / g * 100).toFixed(2) + '%';
  $('segNet').style.width = w(net);
  $('segTax').style.width = w(taxes);
  $('segDed').style.width = w(ded);
  $('lgNet').textContent = pct(net / g);
  $('lgTax').textContent = pct(taxes / g);
  $('lgDed').textContent = pct(ded / g);
  $('lgDedWrap').style.display = ded > 0 ? '' : 'none';
}

function render() {
  // Show or hide each question's money field for the answer beside it before
  // anything is read, so a field that has just been switched off is not still on
  // screen while its contribution is already zero. There is no separate "hours"
  // toggle any more: hours is its own card, and wizard-core drops it from the
  // path (and from the dots) the moment the pay type is not an hourly rate.
  syncAdvancedQuestions();
  // Both of these write a field or a label, so they run BEFORE the form is read
  // and never after: a value written after the read would be one keystroke stale
  // in the answer underneath it.
  //
  // The label on the amount field follows the dropdown above it. Its VALUE never
  // does: the number means what the dropdown says it means, and rewriting a
  // figure the visitor typed is how $28 an hour became $0.01 an hour once.
  syncAmountLabel(payBasis());
  // The overtime rate follows one and a half times the normal rate until the
  // visitor types their own, and then it stops following.
  syncOtRate();

  const input = readForm();
  const r = computePaycheck(input, taxData);
  const annualView = currentView() === 'annual';
  const p = annualView ? r.annual : r.perPaycheck;

  // "No pay entered yet", the state the three rate rows below decline to answer
  // in. Written as !(x > 0) rather than x <= 0 so a NaN gross — an unparseable
  // field — counts as no pay rather than as a real zero.
  const isZero = !(r.annual.gross > 0);

  // Nothing entered yet: ask, do not answer. A blank headline and a caption that
  // says what to do next beat "$0.00" under "Based on a $0 salary", which is a
  // confident wrong answer about the visitor's own pay.
  $('netBig').textContent = isZero ? '' : usd2(p.net);
  // The headline drops to body colour while there is nothing to report, so the
  // accent is spent on a real answer. announceResult() reads the same class.
  $('netBig').classList.toggle('is-zero', isZero);
  // The muted "this is our example, not yours" treatment, kept in step with the
  // note that says so out loud rather than dropped on the first keystroke
  // anywhere in the form. wizard-core owns that note: it keeps it on screen, and
  // keeps it naming which figure is still ours, until #amount is the visitor's
  // own number, and removes it then. Reading its presence rather than tracking a
  // second flag here is what stops the muted figure and the caption disagreeing.
  $('netBig').classList.toggle('is-example', !!document.querySelector('.calc-example'));
  $('netSub').textContent = isZero
    ? ''
    : (annualView
      ? `take-home per year · ${usd2(r.perPaycheck.net)} ${PERIOD_LABEL[r.payFrequency]}`
      : `take-home ${PERIOD_LABEL[r.payFrequency]} · ${usd(r.annual.net)}/yr`);

  // Only the state paycheck pages carry the caption; guard so shared consumers
  // of this module are unaffected.
  const lbl = $('netLabel');
  if (lbl) lbl.textContent = isZero ? NO_PAY_YET_ASK : netLabelText(input);

  // The running answer. It sits OUTSIDE the cards, under whichever one is on
  // screen, so the figure travels with the visitor: the answer itself is on the
  // last card, and without this every question after the first changes a number
  // that is nowhere on screen. onRender below hides it on the answer card, where
  // the real figure is right there.
  const echo = $('advEcho');
  if (echo) {
    echo.textContent = isZero
      ? NO_PAY_YET_ASK
      : `Take-home now: ${usd2(p.net)} ${annualView ? PERIOD_LABEL.annual : PERIOD_LABEL[r.payFrequency]}`;
  }

  showResultRows(!isZero);
  renderAnswerLead(r);

  $('rGross').textContent = usd2(p.gross);
  $('rFederal').textContent = '−' + usd2(p.federal);
  $('rSS').textContent = '−' + usd2(p.socialSecurity);
  $('rMedicare').textContent = '−' + usd2(p.medicare);
  // Optional element. On the nine states with no income tax the build omits this
  // row from the HTML entirely rather than serving "Texas income tax −$0.00",
  // which is a withholding line that does not exist being asserted to every
  // crawler and search snippet that never runs this file. The row was always
  // display:none there once this function ran, so nothing visible changes; what
  // changes is what a reader of the served HTML is told. Guarded, not assumed:
  // build.js only permits an element to be missing when every use of it here is
  // null-checked.
  const rStateEl = $('rState');
  if (rStateEl) rStateEl.textContent = '−' + usd2(p.state);
  $('rNet').textContent = usd2(p.net);

  $('rEff').textContent = isZero ? NO_PAY_YET : pct(r.annual.effectiveRate);
  // Guarded like its two neighbours: with no pay entered there is no take-home
  // share to report, and "0.0%" would claim the visitor keeps none of their pay.
  $('rTake').textContent = isZero ? NO_PAY_YET : pct(r.annual.takeHomeRate);

  // federal bracket-by-bracket breakdown + marginal rate (reuses the engine's brackets)
  const preTax = input.adv ? (input.adv.retirement401k || 0) + (input.adv.cafeteria125 || 0) : 0;
  const bb = federalBracketBreakdown(r.annual.gross, input.filingStatus, taxData.federal, preTax);
  $('rMarginal').textContent = isZero ? NO_PAY_YET : ratePct(bb.marginalRate);
  renderBrackets(bb);

  // hide state row when the state has no income tax, and in the zero state,
  // where showResultRows() has already hidden its neighbours. Absent on the
  // no-income-tax pages, where the build ships no such row at all.
  const stateLineEl = $('stateLine');
  if (stateLineEl) {
    stateLineEl.style.display =
      (!isZero && taxData.states[stateSlug]?.hasIncomeTax) ? '' : 'none';
  }

  // state disability / paid-leave employee contributions — one labeled line each,
  // e.g. "CA SDI (1.3%)". Rebuilt from the current view (per-period vs annual).
  const progHost = $('programLines');
  if (progHost) {
    const progs = isZero ? [] : (p.programs || []);
    progHost.innerHTML = progs.map((pr) =>
      `<div class="line"><span class="lbl">${escLbl(pr.label)} (${ratePct(pr.rate)})</span><span>−${usd2(pr.amount)}</span></div>`
    ).join('');
  }

  // Deduction rows: shown only when there is one to show. BOTH switches have to
  // move. The rows ship carrying the `hidden` ATTRIBUTE (state-page.html), and
  // styles.css answers that with `.line[hidden] { display: none }`, an author
  // rule that outranks the inline `display: ''` this used to set on its own — so
  // the row stayed invisible while its money was already inside Net pay, and the
  // visible column stopped subtracting to the total printed under it. A visitor
  // with a $12,000 retirement plan saw six rows adding to $2,343.65 over a Net
  // pay of $1,882.11, with the bar legend beside it reporting deductions of
  // 17.3% and no deduction row on screen.
  //
  // Written out longhand, one id per line, on purpose: build.js's pre-render
  // guard derives its denominator by scanning THIS file for literal
  // dollar-sign-with-a-quoted-id textContent writes, so folding these four into
  // a helper that takes the ids as arguments would make #rPreTax and #rPostTax
  // invisible to the scan and fail the build. (Spelled out in words rather than
  // in code because the scan reads comments too.)
  const preTaxOn = !isZero && p.preTax > 0;
  $('preTaxLine').hidden = !preTaxOn;
  $('preTaxLine').style.display = preTaxOn ? '' : 'none';
  $('rPreTax').textContent = preTaxOn ? '−' + usd2(p.preTax) : usd2(p.preTax);
  const postTaxOn = !isZero && p.postTax > 0;
  $('postTaxLine').hidden = !postTaxOn;
  $('postTaxLine').style.display = postTaxOn ? '' : 'none';
  $('rPostTax').textContent = postTaxOn ? '−' + usd2(p.postTax) : usd2(p.postTax);

  renderBreakdown(r);
  // The four rule answers, worked out. Deliberately AFTER every row above and
  // outside the results table: not one figure in it belongs to the paycheck, so
  // none of it may be subtracted from Net pay or appear as a row that a reader
  // would take off the top line.
  renderAtFiling(input, r);
  renderCompare();
  announceResult();
}

// --- screen-reader status ---------------------------------------------------
// The results block is no longer aria-live (it would read the whole table on
// every keystroke). Instead one debounced sentence goes to #outStatus, and only
// for renders the visitor caused, never the boot render.
let booted = false;
let statusTimer = null;

function announceResult() {
  const out = $('outStatus');
  if (!out || !booted) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    // In the zero state #netSub is now blank, so the caption is what carries the
    // meaning. Reading it keeps the announcement in step with the screen, which
    // is the whole point of a single announcer.
    if ($('netBig').classList.contains('is-zero')) {
      out.textContent = $('netLabel') ? $('netLabel').textContent : NO_PAY_YET_ASK;
      return;
    }
    const sub = $('netSub').textContent.replace(/ · /g, ', ').replace(/\/yr/g, ' per year');
    out.textContent = `Take-home ${$('netBig').textContent}, ${sub}`;
  }, 500);
}

// --- pay type ----------------------------------------------------------------
// NOTHING HERE CONVERTS THE TYPED FIGURE, and that is the whole point of the
// merged first card. There used to be a convertOnWageTypeSwitch() that divided
// or multiplied the amount by 2,080 when the pay type changed, plus a helper
// under the radios promising it would. It could not be made right: the two cards
// meant the visitor typed a figure BEFORE saying what kind of figure it was, so
// the conversion had to guess from the size of the number which side of the line
// it was on, and it guessed wrong in both directions ($28 typed as an hourly
// rate became $0.01 an hour; $75,000 typed as a salary became $156,000,000 a
// year). Asking the KIND first and labelling the box to match removes the guess
// entirely: the amount means exactly what the dropdown above it says, and
// changing the dropdown changes the label, never the number.
//
// The flow controller is still held rather than mounted and forgotten, because
// init() starts it by hand.
let wizard = null;

// --- compare with another state (fetches the published full tax data on demand) ---
let fullData = null;

async function ensureFullData() {
  if (fullData) return fullData;
  try { fullData = await fetch('/data/tax-data-2026.json').then((r) => r.json()); }
  catch (e) { fullData = null; }
  return fullData;
}

async function populateCompare() {
  const sel = $('cmpState');
  if (!sel || sel.options.length > 1) return; // already populated
  const data = await ensureFullData();
  if (!data || !data.states) { sel.parentElement.insertAdjacentHTML('beforeend', '<p class="muted-small">Comparison data unavailable.</p>'); return; }
  Object.entries(data.states)
    .filter(([slug]) => slug !== stateSlug)
    .map(([slug, s]) => ({ slug, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((e) => { const o = document.createElement('option'); o.value = e.slug; o.textContent = e.name; sel.appendChild(o); });
}

function renderCompare() {
  const sel = $('cmpState'); const box = $('cmpResult');
  if (!sel || !box) return;
  const other = sel.value;
  if (!other || !fullData) { box.innerHTML = ''; return; }
  const input = readForm();
  const annualView = currentView() === 'annual';
  const netOf = (r) => (annualView ? r.annual.net : r.perPaycheck.net);
  const here = computePaycheck({ ...input, stateSlug }, fullData);
  const there = computePaycheck({ ...input, stateSlug: other }, fullData);
  const hereNet = netOf(here), thereNet = netOf(there);
  const diff = thereNet - hereNet;
  const hereName = fullData.states[stateSlug].name, otherName = fullData.states[other].name;
  const per = annualView ? '/yr' : ` ${PERIOD_LABEL[here.payFrequency]}`;
  const verb = diff === 0 ? 'the same as' : (diff > 0 ? 'more than' : 'less than');
  // Flag a state whose figures are a prior-year fallback (e.g. CA/NE/OK on 2025 rates)
  const fyTag = (slug) => {
    const fy = fullData.states[slug].figureYear;
    return fy && fy !== fullData.taxYear ? ` <span class="cmp-fy">(${fy} rates)</span>` : '';
  };
  box.innerHTML =
    `<div class="cmp-row"><span>${hereName}${fyTag(stateSlug)}</span><strong>${usd2(hereNet)}</strong></div>` +
    `<div class="cmp-row"><span>${otherName}${fyTag(other)}</span><strong>${usd2(thereNet)}</strong></div>` +
    (diff === 0
      ? `<p class="cmp-delta">Same take-home in both states for these inputs.</p>`
      : `<p class="cmp-delta">${otherName} take-home is <strong>${usd2(Math.abs(diff))}${per}</strong> ${verb} ${hereName}.</p>`);
}

function renderBrackets(bb) {
  const body = $('bracketBody');
  if (!body) return;
  if (!bb.bands.length || bb.taxable <= 0) {
    body.innerHTML = '<tr><td colspan="3">No federal income tax, taxable income is $0 after the standard deduction.</td></tr>';
    $('bracketNote').textContent = '';
    return;
  }
  body.innerHTML = bb.bands.map((b) => {
    const range = b.upper === Infinity ? `over ${usd(b.lower)}` : `${usd(b.lower)} – ${usd(b.upper)}`;
    return `<tr><td>${ratePct(b.rate)} <span class="bk-range">(${range})</span></td><td>${usd(b.amount)}</td><td>${usd(b.tax)}</td></tr>`;
  }).join('');
  $('bracketNote').textContent =
    `Taxable income ${usd(bb.taxable)} after the ${usd(bb.stdDed)} standard deduction. ` +
    `Your federal marginal rate is ${ratePct(bb.marginalRate)}, the federal tax on your next dollar earned.`;
}

// --- Which answers still belong to us ---------------------------------------
// The page loads with a $75,000 salary nobody typed, so the answer stays
// labelled an example until that figure is the visitor's own. It is the ONLY
// invented number on the page: salary, every-two-weeks, single, 40 hours and No
// to all nine questions are real defaults that are true for a great many people
// and invent nothing, so none of them is listed here and none of them retires
// the label on its own. wizard-core clears the note when this returns empty.
function exampleStillOurs(state, touched) {
  return touched.has('amount') ? [] : ['your pay'];
}

// The chips under the answer, one per figure the flow asked for, each a way back
// to the card that asked. The four rule cards are still not chipped here: their
// answers are the ticked chips inside the applies panel on the same card, which
// state-flow.js keeps in step with them in both directions, and a Yes now also
// prints a line of its own in the filing block above — three ways of showing one
// answer is two too many.
//
// The five deduction cards ARE here, and every one of them chips whether it was
// answered Yes or No. They were left out at first on the reasoning that a No is
// not a figure worth quoting back — but the answer card ships no Back and the
// other thirteen cards are hidden once the flow is running, so a visitor who
// answered No to "do you put part of your pay into a retirement plan" and then
// remembered that they do had no route to that card at all. The only exit was
// Start over, which puts the salary back to our $75,000 example and throws away
// every answer. A chip is the whole way back.
//
// `field` is passed only where that card's money input is actually on screen,
// which is only when the question was answered Yes. Pointing a chip at a field
// inside a hidden [data-reveal] wrapper would leave the focus call silently
// doing nothing; with no field named, the core focuses the question's radios
// instead, which is the control the visitor needs first anyway.
function answerChips(s) {
  // ONE chip for the first card, because it is now one card. It quotes the
  // figure the visitor typed AND the basis they chose for it, which is exactly
  // what that card asked, and both halves are wrong together or right together.
  const paid = s.basis === 'hourly'
    ? `${usd2(s.typed)}/hr`
    : s.basis === 'monthly' ? `${usd(s.typed)}/month` : `${usd(s.typed)}/yr`;
  const list = [{ step: PAY, field: 'amount', label: paid }];
  if (s.basis === 'hourly') list.push({ step: HOURS, field: 'hours', label: `${s.wage.hoursPerWeek} hrs/week` });
  list.push({ step: FREQ, label: PAID_LABEL[s.payFrequency] || PAID_LABEL.biweekly });
  list.push({ step: FILING, label: FILING_LABEL[s.filingStatus] || FILING_LABEL.single });

  const ded = (step, on, yes, no, field) =>
    list.push(on ? { step, label: yes, field } : { step, label: no });
  ded(Q_RETIRE, answeredYes('qRetire') && s.adv.retirement401k > 0,
    `${usd(s.adv.retirement401k)}/yr to retirement`, 'no retirement plan', 'retirement401k');
  ded(Q_HEALTH, answeredYes('qHealth') && s.adv.cafeteria125 > 0,
    `${usd(s.adv.cafeteria125)}/yr for health cover`, 'no health cover', 'cafeteria125');
  ded(Q_DEPS, answeredYes('qDeps') && s.adv.dependentsCredit > 0,
    `${usd(s.adv.dependentsCredit)} of dependent credit`, 'no dependents', 'depChildren');
  ded(Q_EXTRA, answeredYes('qExtra') && s.adv.extraWithholding > 0,
    `${usd(s.adv.extraWithholding)}/yr extra tax`, 'no extra withholding', 'extraWithholding');
  ded(Q_POST, answeredYes('qPost') && s.adv.postTax > 0,
    `${usd(s.adv.postTax)}/yr taken after tax`, 'nothing taken after tax', 'postTax');
  return list;
}

function init() {
  initMoneyInputs();
  // The overtime rate stops following one and a half times the normal rate the
  // moment a person types in it. isTrusted only: syncOtRate()'s own writes fire
  // no event, and a chip or a prefill is OUR number until someone types over it.
  const otRateEl = $('otRate');
  if (otRateEl) otRateEl.addEventListener('input', (e) => { if (e.isTrusted) otRateTouched = true; });

  // #netKicker is not on a state paycheck page and never has been: it belongs to
  // the sibling templates whose headline carries a kicker line. The write stays
  // because build.js derives the pre-render guard's denominator from THIS file
  // and declares the id absent-but-null-guarded on the strength of it; deleting
  // the write makes that declaration stale and fails the build. The visible half
  // of the example label is wizard-core's note and the is-example class render()
  // keeps in step with it.
  const form = $('paycheckForm');
  const dropExampleLabel = () => {
    const kicker = $('netKicker');
    if (kicker) kicker.textContent = 'Your estimated take-home pay';
  };
  if (form) {
    form.addEventListener('input', dropExampleLabel, { once: true });
    form.addEventListener('change', dropExampleLabel, { once: true });
  }

  // The view toggle and the comparison live on the answer card, outside the
  // flow's question set, so they keep their own listeners. Everything else is
  // wired by wizard-core from the card list below.
  document.querySelectorAll('input[name="view"]').forEach((el) =>
    el.addEventListener('change', render));
  const cmpPanel = $('comparePanel');
  if (cmpPanel) cmpPanel.addEventListener('toggle', () => { if (cmpPanel.open) populateCompare().then(renderCompare); });
  if ($('cmpState')) $('cmpState').addEventListener('change', renderCompare);

  // createWizard rather than mountWizard: __bootInit() below already does the
  // readyState handshake and already puts the shared "this calculator failed to
  // load" banner up if anything in here throws, which is all mountWizard adds.
  wizard = createWizard({
    stage: 'paycheckWizard',
    read: readForm,
    // The engine call belongs to render(), which has to make it anyway to write
    // twenty-five elements. Computing here as well would run the whole state and
    // federal calculation twice per keystroke for a figure nothing reads.
    compute: () => null,
    // Never called: this page ships no #out, see the header. Present because the
    // core's contract asks for it, and because an empty string is the honest
    // answer to "what HTML goes in the result box" when there is no result box.
    renderResult: () => '',

    cards: [
      // Both answers on one card, so both are FIELDS: the pay type is a select
      // now, and a select is a field to wizard-core, which means the dots, the
      // "Step 2 of 5" line and the flag below are all repainted on the keystroke
      // that changes it rather than on the next Next. (As two cards this needed a
      // hand-rolled repaint, because the core does not re-derive the path from a
      // radio answer. One less thing that can drift out of step.)
      { step: PAY, fields: ['wageType', 'amount'],
        flags: [{ id: 'otwWageTypeFlag', text: wageTypeWarning }] },
      // Off the path entirely unless the pay is hourly, so it leaves the dots and
      // the step count on the keystroke that changes the pay type, not on the
      // next Next. The input stays in the DOM: readForm() reads it unguarded.
      { step: HOURS, fields: ['hours'], when: (s) => s.basis === 'hourly' },
      { step: FREQ, radios: 'payFrequency' },
      { step: FILING, radios: 'filingStatus' },

      // The four rule checks. They change no paycheck figure, so a Skip past them
      // still yields the right take-home; what they change is the filing-time
      // block on the answer card, which is worked out from the figures they ask
      // for here. skipClears empties those figures on the way past, so a number
      // typed and then skipped cannot keep feeding an answer from a card the
      // visitor has left behind.
      { step: Q_TIPS, radios: 'qTips', fields: ['tipsYear'], skipClears: ['tipsYear'],
        flags: [{ id: 'otwTipsFlag', text: tipsWarning }] },
      { step: Q_OT, radios: 'qOt', fields: ['regRate', 'otHours', 'otRate'],
        skipClears: ['regRate', 'otHours', 'otRate'],
        flags: [{ id: 'otwOtFlag', text: overtimeWarning }] },
      { step: Q_BONUS, radios: 'qBonus', fields: ['bonusAmount'], skipClears: ['bonusAmount'] },
      { step: Q_AGE, radios: 'qAge' },

      // The five that do change the figure. skipClears empties the card's own
      // money field on the way past, so a number typed and then skipped cannot
      // keep feeding the answer from a card the visitor has left behind.
      { step: Q_RETIRE, radios: 'qRetire', fields: ['retirement401k'], skipClears: ['retirement401k'],
        flags: [{ id: 'otwRetireFlag', text: retireWarning }] },
      { step: Q_HEALTH, radios: 'qHealth', fields: ['cafeteria125'], skipClears: ['cafeteria125'],
        flags: [{ id: 'otwHealthFlag', text: healthWarning }] },
      { step: Q_DEPS, radios: 'qDeps', fields: ['depChildren', 'depOther'], skipClears: ['depChildren', 'depOther'] },
      { step: Q_EXTRA, radios: 'qExtra', fields: ['extraWithholding'], skipClears: ['extraWithholding'],
        flags: [{ id: 'otwExtraFlag', text: extraWarning }] },
      { step: Q_POST, radios: 'qPost', fields: ['postTax'], skipClears: ['postTax'],
        flags: [{ id: 'otwPostFlag', text: postWarning }] },

      { step: RESULT, result: true }
    ],

    exampleMissing: exampleStillOurs,
    chips: answerChips,

    // The core announces only from its own renderResult path, and this page has
    // none, so announceResult() below stays the page's single announcer: one
    // debounced sentence into #outStatus, never on the boot render.
    onRender: ({ step }) => {
      const echo = $('advEcho');
      if (echo) echo.style.display = step === RESULT ? 'none' : '';
      render();
    },

    // Start over puts every radio back by assignment, which fires no change
    // event, so the four applies chips would keep showing the answers the
    // visitor just discarded. state-flow.js listens for this and re-reads them.
    // The overtime rate goes back to following the normal rate too: it is not a
    // number the visitor typed any more, so it must not keep behaving like one.
    onReset: () => {
      otRateTouched = false;
      try { document.dispatchEvent(new CustomEvent('tb:paycheck-reset')); } catch (_) { /* older browsers */ }
    }
  });

  // start() renders once, THEN sets data-js="on" and shows card one, in that
  // order on purpose: a throw in the render leaves the plain stacked form on
  // screen under the error banner rather than an invisible one.
  wizard.start();

  booted = true;
}

function __bootInit() {
  try {
    init();
  } catch (err) {
    showCalculatorLoadError(err);
  }
}
if (document.readyState !== 'loading') __bootInit();
else document.addEventListener('DOMContentLoaded', __bootInit);
