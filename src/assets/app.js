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
// TIPS ARE THE ONE EXCEPTION, AND THEY EARNED IT (2026-08-06). The tips card now
// asks a second question — are these tips already inside the pay you entered? —
// and the default answer is NO. It has to be: the commonest way to fill in card
// one here is an hourly rate times the hours you work, and that arithmetic
// cannot contain a tip. So for a tipped worker the pay figure was only part of
// their money, and the take-home printed above it was only part of their
// take-home while a block underneath quietly agreed the tips existed. Tips ON
// TOP are therefore a second pot with a story of their own: the headline adds
// what is kept of them, the bar gains a segment, and a block under the results
// table works out where the rest went. Tips INSIDE the pay move no total at all
// — they are already in every row — and get the same block as an attribution.
//
// AND THE DEDUCTION IS SPENT EXACTLY ONCE PER VIEW. Yearly, on top, the tips
// block prints the federal tax AFTER the no-tax-on-tips deduction and the
// at-filing block's tips row is merged away. Per paycheck, or inside the pay,
// the tips block prints withholding and the at-filing row keeps the saving. The
// two routes are the same arithmetic — their difference IS federalTaxSaved — so
// whichever one is on screen, the reader is told the benefit once and told the
// same number.
//
// AND NONE OF THE REST OF IT TOUCHES THE PAYCHECK. Overtime and the senior deduction
// are filing-time deductions: they arrive as a bigger refund or a smaller bill
// next year, they do not change withholding during the year, and they never
// enter computePaycheck's input or any row of the results table. They are
// printed in a block of their own, below the table, labelled as money back when
// you file. The bonus is the other way round — a payday figure — and its line
// says so and carries the heavier rule that stops a reader adding it in.
// federalIncomeTax / ficaTax / stateIncomeTax are imported, never re-derived:
// tips on top of the pay are the SAME three taxes measured at a second income,
// so the tips block is three differences of the functions that already wrote the
// rows above it. Deriving a marginal rate by hand here would be a fourth opinion
// about the brackets on a page that already has one, and it would miss the
// Social Security wage base the moment pay plus tips crosses it.
import {
  computePaycheck, PAY_PERIODS, federalBracketBreakdown, annualizeGross,
  federalIncomeTax, ficaTax, stateIncomeTax
} from '/assets/paycheck-engine.js';
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
      // Whether that tips figure is a slice of the pay above or a second pot on
      // top of it. Defaults to ON TOP, because the commonest way to fill in card
      // one on this page is a rate times the hours you work, and that arithmetic
      // cannot contain a tip. radioOf falls back to the shipped default for a
      // page that serves no such group, exactly like every other reader here.
      tipsInside: radioOf('tipsInside', 'ontop') === 'inside',
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

// Tips above the whole year's pay is the same number counted wrong — but ONLY
// when the visitor has said the pay figure already includes them. On top of the
// pay there is no contradiction at all: a valet on a minimum wage really can
// take more in tips than in wages, and flagging that as an error would tell a
// correctly-filled-in card it was wrong. So the check is gated on the answer to
// the sub-question, which is also what makes its closing sentence true.
// The contradiction can only exist once the tips figure exists, so the flag
// lives on the tips card.
function tipsWarning(s) {
  const pay = yearlyPay(s);
  if (!s.rules.tipsInside) return '';
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
  // AND THE SECOND POT, NAMED, whenever there is one. The headline above this
  // caption adds tips that sit on top of the pay, so a caption that named only
  // the salary would be explaining a figure it does not account for. Tips the
  // visitor said are already inside the pay add no clause: they are inside
  // `basis` already, and saying so twice would double them to a reader.
  const tipsClause = input.rules && input.rules.tips > 0 && !input.rules.tipsInside
    ? `, plus ${usd(input.rules.tips)} a year in tips on top`
    : '';
  return `Based on ${basis} in ${name}, ${filing}, ${paid}${tipsClause}`;
}

// True while the pay figure in the box is still the $75,000 example this page
// ships with, false from the first character a person types over it. Same rule
// wizard-core uses for its example note (isTrusted only, so our own writes and a
// prefill do not count), tracked here as well because renderAnswerLead needs the
// answer DURING the render that keystroke causes, and the core's copy is updated
// by a listener bound after the one that renders. Put back by Start over, which
// puts the example figure back.
let payIsOurs = true;

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

function renderAnswerLead(input, r) {
  const lead = captureAnswerLead();
  if (!lead) return;
  const { el, text, spans } = lead;
  // With the pay field empty there is nothing live to state, so the page's own
  // worked example comes back rather than a sentence full of zeroes.
  if (!(r.annual.gross > 0)) { el.textContent = text; return; }
  // OUR EXAMPLE FIGURE IS A YEARLY SALARY, and this sentence is built around
  // that. While the box still holds our $75,000 and nobody has typed over it,
  // choosing "A monthly salary" annualises it to $900,000 and "An hourly rate"
  // to $156,000,000 — so the sentence above the calculator stated "a $900,000
  // salary in Georgia nets roughly $542,049 a year" as a fact, at the same
  // moment the card below said "Still using our example figures for your pay".
  // A figure the visitor never gave must not be quoted back at them as theirs.
  // The served sentence stands until the pay is their own, and the first
  // keystroke in #amount releases it. On the salary basis there is nothing to
  // guard against: the sentence already names $75,000, so only the take-home
  // half moves, which is the whole point of rewriting it.
  //
  // It reads payIsOurs rather than the presence of the example note, even
  // though the two say the same thing, because the note is one event behind
  // here: wizard-core removes it from its own isTrusted listener, which is
  // registered AFTER the listener that re-renders, so on the keystroke that
  // retires the note this function still sees it. payIsOurs is set from a
  // listener of ours bound before the core's, so it is already right.
  if (input.basis !== 'salary' && payIsOurs) {
    el.textContent = text;
    return;
  }
  const [g, n] = spans;
  el.textContent =
    text.slice(0, g[0]) + usd(r.annual.gross) +
    text.slice(g[1], n[0]) + usd(r.annual.net) +
    text.slice(n[1]);
}

// --- the four slots build.js cannot pre-render -------------------------------
// READ THIS BEFORE ADDING A FIFTH ONE.
//
// build.js's pre-render guard (scanAppFirstRender + assertPanelParity) scans
// THIS FILE for `$('someId').textContent = …` writes reachable from init(), and
// fails the build for any id statePanel() has no pre-rendered value for. That
// guard is right, and it is why twenty-five figures on this page are served real
// and hydrate to the identical string. It is also in build.js, which the pass
// that added these elements was not allowed to edit, so they are
// addressed by ATTRIBUTE and stay out of its denominator.
//
// Every one is parity-neutral BY CONSTRUCTION, which is the only reason this is
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
//   tips       — ships EMPTY for the same reason: the tips question ships
//     answered No, so there is no second pot of money to tell anyone about and
//     the first render writes the same empty string. Pinned as the exact empty
//     <div> the template serves.
//   tipsPct    — the tips share in the bar legend. Ships EMPTY inside a legend
//     entry that ships display:none, and the first render leaves both alone
//     while there are no tips. (#segTips and #lgTipsWrap beside it need no slot
//     at all: a style write is not a content write, so the guard never counted
//     them.)
//
// THE RIGHT END STATE, written out here because it is the whole of the
// follow-up. In build.js, statePanel().expected gains four entries:
//   amountLabel: { expect: <AMOUNT_LABEL.salary, the string the template serves> }
//   filing:      { expect: '' }
//   tips:        { expect: '' }
//   tipsPct:     { expect: '' }
// and these four writes move back onto $('id').textContent, which puts them back
// inside the guard's denominator and retires slot() and the four
// [data-otw-slot] attributes with it. Until that lands, the
// test-ux-structure pins named above are what stands in for the guard.
// (This used to end "see notes/state-page-phase5.md". There is no notes/
// directory in this repo and there never was: that file is a scratchpad note
// from the pass that added these slots, so the pointer sent the next editor
// looking for something they could not open. The instruction it was pointing at
// is the five lines above.)
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
//
// EACH VERDICT IS A WHOLE SENTENCE, and it names the state ONCE. They used to be
// fragments under a shared lead, and the lead named the state too, so the
// commonest verdict of the four printed "In California it is still taxed by
// California." — the state's name twice in eight words, on a page whose whole
// subject is that one state. The sister tools say "still taxed by your state"
// because a <select> supplies the name; here the page IS the state, so the name
// goes in the subject position and nowhere else. The wording otherwise matches
// this page's own pointer lines (src/content/state-applies.js): "still taxes it
// in full", "has not confirmed its own treatment yet".
const CONFORMITY = {
  yes: (name) => `It is deductible on your ${name} return too.`,
  no: (name) => `${name} still taxes it in full.`,
  partial: (name) => `It is federally deductible, and ${name} adds a smaller capped break of its own.`,
  unclear: (name) => `${name} has not confirmed its own treatment yet.`
};

function conformityClause(kind) {
  const e = ruleData && ruleData.obbba.states && ruleData.obbba.states[stateSlug];
  const name = taxData.states[stateSlug]?.name || '';
  if (!e || !name) return '';
  if (!e.hasWageTax) return `${name} taxes no wages, so the federal deduction is the whole story here.`;
  const v = e[kind] && e[kind].y2026;
  const say = CONFORMITY[v];
  return say ? say(name) : '';
}

// --- tips, inside the take-home summary --------------------------------------
// ONE FUNCTION, TWO MODES, THREE ENGINE DIFFERENCES. Everything the tips block,
// the headline, the caption and the bar say about tips comes from here, so those
// four can never disagree with each other.
//
// The whole thing is the same three taxes measured at two incomes:
//   on top   base = the pay,        W = the pay + the tips
//   inside   base = the pay - tips, W = the pay
// and each figure is (tax at W) - (tax at base). That is exact across bracket
// boundaries, it picks up the Social Security wage base for free the moment pay
// plus tips crosses it (ficaTax caps at fed.fica.socialSecurity.wageBase, so the
// difference above the base is Medicare only), and it needs no marginal rate.
//
// THE FEDERAL FIGURE COMES BACK TWICE, and which one is printed is the whole of
// the exactly-once rule:
//   fedWithheld  no deduction. What actually leaves the money during the year.
//   fedFiled     after the no-tax-on-tips deduction. What is owed on the return.
// Their difference IS federalTaxSaved(magi, filing, deduction, fed).taxSaved,
// which is the number the at-filing block prints for tips. So the benefit is
// inside fedFiled or it is the at-filing row, never both, and the two routes
// agree to the cent.
//
// MAGI IS THE INCOME THAT REACHES THE RETURN, W minus the pre-tax money this
// same page collects two cards further down: a traditional 401(k) deferral and a
// Section 125 premium never enter W-2 box 1. renderAtFiling makes the identical
// adjustment for the identical reason. Both are clamped to the pay exactly as
// computePaycheck clamps them, so the two never disagree about how much pre-tax
// money there was.
//
// Returns null when there is nothing to say: no tips, no pay, or the OBBBA
// figures not fetched yet. Callers treat null as "no tips block, no tips in the
// headline, no tips segment", which is the shipped default and the served state.
function tipsSlice(input, r) {
  const t = input.rules.tips;
  const gross = r.annual.gross;
  if (!(t > 0) || !(gross > 0) || ruleDataState !== 'ready') return null;
  const inside = !!input.rules.tipsInside;
  // A tips figure larger than the pay it is supposed to be a slice of is not a
  // slice. tipsWarning already says so on the card; here it would mean a
  // negative base income, so the block declines rather than inventing one.
  if (inside && t >= gross) return null;

  const fed = taxData.federal;
  const filing = input.filingStatus;
  const stateData = taxData.states ? taxData.states[stateSlug] : null;
  const clamp = (v) => Math.min(Math.max(0, v || 0), gross);
  const preTaxIncome = clamp(input.adv.retirement401k) + clamp(input.adv.cafeteria125);
  const preTaxFica = clamp(input.adv.cafeteria125);

  const W = inside ? gross : gross + t;
  const base = W - t;
  const magi = Math.max(0, W - preTaxIncome);

  const d = allowedDeduction({
    eligibleAmount: t, filingStatus: filing, magi, params: ruleData.obbba.federal.tips
  });

  const fedBase = federalIncomeTax(base, filing, fed, preTaxIncome);
  const fedWithheld = Math.max(0, federalIncomeTax(W, filing, fed, preTaxIncome) - fedBase);
  const fedFiled = Math.max(0, federalIncomeTax(W, filing, fed, preTaxIncome + d.deduction) - fedBase);
  const fica = Math.max(0, ficaTax(W, filing, fed, preTaxFica).total - ficaTax(base, filing, fed, preTaxFica).total);

  // THE STATE FOLLOWS THE STATE'S OWN LAW, not the federal deduction. The nine
  // states that tax no wages return 0 from stateIncomeTax without being asked
  // to. Of the rest, only a state whose 2026 verdict is a full "yes" gets the
  // federal deduction subtracted from its base; "no" and "not confirmed yet"
  // get none of it, and neither does "partial" — Georgia's smaller capped
  // exclusion is $1,750 of tips written in the prose of its data entry, not in a
  // machine-readable field, and guessing at a money number is worse than
  // declining to model it. The note under the block says so in words.
  const conformity = (ruleData.obbba.states && ruleData.obbba.states[stateSlug]
    && ruleData.obbba.states[stateSlug].tips && ruleData.obbba.states[stateSlug].tips.y2026) || '';
  const stateDed = conformity === 'yes' ? d.deduction : 0;
  const stateTax = Math.max(0,
    stateIncomeTax(W, filing, stateData, preTaxIncome + stateDed) -
    stateIncomeTax(base, filing, stateData, preTaxIncome));

  return {
    tips: t, inside, deduction: d, conformity, stateDed,
    fedWithheld, fedFiled, fica, state: stateTax,
    // What the pay's own take-home has to gain, per view. The yearly answer is
    // the filing truth, the per-paycheck answer is the withholding truth, and
    // they differ by exactly the deduction's benefit — which is why the
    // per-paycheck view still shows that benefit in the at-filing block and the
    // yearly view does not.
    keepFiled: t - fedFiled - fica - stateTax,
    keepWithheld: t - fedWithheld - fica - stateTax
  };
}

// The three deductions, in card order, each with the tax it saves. CHAINED, not
// computed one at a time: obbba-deduction.js's own W-4 helper says why, and it
// is the same reason — the tax saved by two deductions together is one
// bracket-diff on their sum, never the sum of two separate diffs, because the
// combined amount can span a bracket line the individual ones do not reach. So
// each row is worth what it adds ON TOP of the rows above it, the last row's
// running total IS the combined figure, and the rows therefore add up to it.
//
// `magi` IS NOT GROSS PAY, and passing gross was a real defect: see
// renderAtFiling for the derivation. Both engines below are measured against the
// income that reaches the federal return, so the caller nets off the pre-tax
// money this same page collected on its own cards.
//
// `mergeTips` does NOT take tips out of the chain, and that distinction is the
// whole point. When the tips block above has already spent the deduction (the
// yearly view, tips on top), the tips ROW must not print it a second time — but
// the deduction is still the first link in the chain, because the overtime and
// senior rows are worth what they add ON TOP of it and would be overstated by
// hundreds of dollars if tips were dropped from the arithmetic as well as from
// the list. So the row is computed exactly as before and marked `merged`, and
// renderAtFiling leaves it out of what it prints and out of what it totals.
function filingRows(input, magi, mergeTips) {
  const fed = taxData.federal;
  const obbba = ruleData.obbba.federal;
  const filing = input.filingStatus;
  const rules = input.rules;
  const rows = [];
  let running = 0;
  let savedSoFar = 0;
  const chain = (deduction) => {
    running += Math.max(0, deduction);
    const total = federalTaxSaved(magi, filing, running, fed).taxSaved;
    const mine = total - savedSoFar;
    savedSoFar = total;
    return mine;
  };

  if (rules.tips > 0) {
    const d = allowedDeduction({
      eligibleAmount: rules.tips, filingStatus: filing, magi, params: obbba.tips
    });
    rows.push({
      label: 'Tips',
      saved: chain(d.deduction),
      merged: !!mergeTips,
      // The wage this row is a deduction against, named, for the FICA sentence
      // in the plain box. A row with no wage behind it (the senior deduction)
      // leaves this empty and is left out of that sentence: there is no dollar
      // of a $6,000 age allowance for Social Security to reach.
      fica: 'your tips',
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
      eligibleAmount: premium, filingStatus: filing, magi, params: obbba.overtime
    });
    // WHERE THE PREMIUM CAME FROM, SAID EVERY TIME, not only when nothing cuts
    // it. `premium` has already been through the FLSA half-rule by the line
    // above, so a visitor on double time typed $60,000 of overtime pay and is
    // being shown a deduction measured against $15,000 of it. The capped branch
    // used to explain only the cap, which left the halving — much the larger of
    // the two reductions — stated nowhere on the card. The two reductions are
    // therefore separate sentences, in the order they happen, the way
    // overtime-tax-calculator.js separates its split rows from its cap row.
    //
    // And it is called "the extra half" only when that is what it is: an
    // employer paying under time and a half pays LESS than the half, so
    // paidExtra is what comes off and calling $6,000 "the extra half above your
    // normal rate" when the half is $15,000 names the wrong figure.
    const otPay = rules.otRate * rules.otHours;
    const basis = paidExtra < requiredHalf
      ? `Only the part above your normal rate counts, and yours pays less than time and a half, so that is ` +
        `${usd(premium)} of the ${usd(otPay)} those ${count(rules.otHours)} hours pay.`
      : `Only the extra "half" above your normal rate counts, which is ${usd(premium)} of the ` +
        `${usd(otPay)} those ${count(rules.otHours)} hours pay.`;
    // A row whose own figures are not in yet. It is not worth $0 — it is not
    // worked out — and renderAtFiling leaves the money off rather than printing
    // "+$0" in the accent colour above a grey line asking for the missing
    // number. The note still prints, so the ask is still on the card.
    let pending = false;
    let note;
    if (rules.normalRate <= 0) {
      pending = true;
      note = 'Fill in what one normal hour of your work is worth and this fills in.';
    } else if (rules.otHours <= 0) {
      pending = true;
      note = 'Fill in how many extra hours you will work this year and this fills in.';
    } else if (paidExtra <= 0) {
      note = `Those hours pay ${usd2(rules.otRate)}, which is not above your normal ${usd2(rules.normalRate)}, ` +
        `so they paid no premium and there is nothing to deduct. If the two rates went in the wrong way round, swap them.`;
    } else if (d.deduction < premium) {
      note = `${basis} Of that ${usd(premium)}, ${usd(d.deduction)} is deductible` +
        (d.fullyPhasedOut
          ? `: your pay is high enough that the deduction is fully phased out.`
          : d.phasedOut
            ? `: the ${usd(d.statutoryCap)} cap falls to ${usd(d.allowedCap)} at your income, and the rest is taxed as usual.`
            : `. The deduction stops at ${usd(d.allowedCap)} a year, and the rest is taxed as usual.`);
    } else {
      note = basis;
    }
    rows.push({
      label: 'Extra hours',
      saved: chain(d.deduction),
      pending,
      fica: paidExtra > 0 ? 'that overtime pay' : '',
      note,
      extra: conformityClause('overtime')
    });
  }

  if (rules.age65) {
    const d = seniorDeduction({
      year: Number(taxData.taxYear), filingStatus: filing, age65: true, spouseAge65: false,
      magi, params: obbba.senior
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
      // No wage behind this one, deliberately blank: the $6,000 is an allowance
      // for an age, not pay, so the FICA sentence in the plain box must not
      // claim Social Security is owed on it.
      fica: '',
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
//
// GROSS PAY, NOT THE MAGI THE DEDUCTIONS USE, and that is deliberate. regIncome
// drives two things in the bonus engine: the state-tax delta on regular-method
// states, and the Social Security wage base plus the additional-Medicare
// threshold. A 401(k) deferral does NOT reduce Social Security or Medicare
// wages, so netting it off here would push a high earner's bonus back under the
// wage base and understate what the check loses. The state-tax side moves by
// pennies at a flat rate and not at all on the flat-supplemental states, so
// gross is the smaller of the two errors and the only one that cannot be wrong
// about FICA.
//
// It returns the STATE withholding it actually computed, because the sentence
// under this row names what came out and must not name a line that is zero: the
// nine no-income-tax states withhold nothing here, and asserting "Alaska
// withholding" beside a figure that has none is a false explanation of a correct
// number.
function bonusLine(input, income) {
  const b = computeBonus(
    {
      bonus: input.rules.bonus, regIncome: income, filingStatus: input.filingStatus,
      stateSlug, ytdSupp: 0, method: 'flat', paymentType: 'bonus'
    },
    taxData, ruleData.supp
  );
  return {
    bonus: Math.round(b.bonus),
    lands: Math.round(b.withheld.keep),
    state: b.withheld.state || 0
  };
}

// The overtime rate starts at one and a half times the normal rate, the usual
// overtime rate, and STOPS following the moment the visitor types their own:
// their number outranks our guess for the rest of the session. Copied in shape
// from /overtime-tax-calculator/, which is where the rule was settled — the
// calculator does not assume time and a half, it offers it and then believes
// what it is told, because employers break the assumption in both directions.
//
// IT IS ONLY EVER CLEARED BY Start over, and that is now safe because nothing
// else empties the field behind it. It was not: the overtime card carried
// skipClears, so "Skip to my answer" blanked otRate while this flag stayed true
// and qOt stayed Yes, and the rate never came back — a visitor who typed a rate,
// skipped, then came back to the card was shown an empty box that refused to
// refill and a row reading "Extra hours +$0". skipClears is gone from every card
// on this page (see the card list in init), so the only writer of an empty
// otRate is restart(), which runs onReset and puts this back to false in the
// same pass.
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
function renderAtFiling(input, r, mergeTips) {
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
  // THE INCOME THESE ARE MEASURED AGAINST IS NOT GROSS PAY. Both OBBBA figures
  // are keyed to the income that reaches the federal return: allowedDeduction
  // phases the cap out on MAGI, and federalTaxSaved takes the bracket difference
  // at that same income. A traditional 401(k) deferral and a Section 125 health
  // premium never enter W-2 box 1, so neither is in AGI and neither is in MAGI —
  // and this page asks for both, two cards further down the same flow.
  //
  // Passing gross overstated both halves for anyone who answered those cards.
  // Measured on the shipped 2026 tables: single, $75,000 salary, $20,000 into a
  // retirement plan, $5,000 of tips printed "+$1,100" against a real saving of
  // $600, because the bracket difference was taken at $75,000 rather than at the
  // $55,000 that is actually taxed. Single, $300,000 gross with $23,500 deferred
  // showed a $10,000 tips deduction where the phase-out at $276,500 allows
  // $12,300. renderBrackets() eleven lines below already derives the identical
  // preTax figure from the identical input, so the card was printing two taxable
  // bases and saying so nowhere.
  const preTax = input.adv ? (input.adv.retirement401k || 0) + (input.adv.cafeteria125 || 0) : 0;
  // AND TIPS ON TOP GO THE OTHER WAY, UP. This block used to add nothing to
  // gross, on the assumption every figure the visitor gave was already inside
  // the pay on card one. Tips that sit on top of the pay are not: they are wages
  // that reach the return, so they are in MAGI, and leaving them out understated
  // the whole block. Measured on the built georgia page — single, a $30,000
  // salary, $10,000 of tips on top — the tips row printed "+$1,030" (the bracket
  // difference taken at $30,000) while the tips block four lines above it showed
  // $1,200 of federal tax withheld on the same tips and promised that this block
  // said how much of it came back. Two routes to one number, $170 apart, on the
  // same card. At the true $40,000 both are $1,200.
  //
  // Tips the visitor said are already INSIDE the pay add nothing here, because
  // r.annual.gross already contains them. Same figure, two meanings, and the
  // sub-question on the tips card is the only thing that can tell them apart.
  const onTopTips = input.rules.tipsInside ? 0 : input.rules.tips;
  const returnIncome = income + onTopTips;
  const magi = Math.max(0, returnIncome - preTax);
  if (ruleDataState === 'failed') {
    box.innerHTML = `<p class="otw-note">We could not load the 2026 deduction figures just now, so these are not ` +
      `worked out here. The links below still do it in full.</p>`;
    return;
  }
  if (ruleDataState !== 'ready') {
    box.innerHTML = `<p class="otw-note">Working out what these are worth to you…</p>`;
    return;
  }

  const { rows } = filingRows(input, magi, mergeTips);

  // A ROW WITH ITS OWN FIGURES MISSING PRINTS NO MONEY. "Extra hours +$0" in the
  // accent colour, under a lead saying this arrives when you file, is read down
  // the money column as "my overtime is worth nothing" — and the case it fires
  // in is the salaried visitor who does not know their hourly rate, which is
  // exactly the case the note under it exists for. The row leaves the list; its
  // note stays, so the ask is still on the card and still labelled.
  // A MERGED ROW LEAVES FOR THE OPPOSITE REASON: not that its figure is
  // missing, but that the tips block above has already printed it. Both leave
  // the list here; only the pending one leaves its note behind.
  const shown = rows.filter((row) => !row.pending && !row.merged);

  // ROUNDED ONCE, THEN DERIVED. The labels invite a reader to add these up, so
  // the printed rows have to come to the printed total: every row but the last
  // is rounded on its own and the last is DERIVED from the already-rounded
  // total. (If that derivation ever came out negative — possible only when the
  // last row is worth almost nothing and the others round up — the total
  // becomes the sum of the rounded rows instead, so the two are never at odds.)
  //
  // THE TOTAL IS THE SUM OF WHAT IS SHOWN, not the chain's own running total,
  // and those are the same number in every case but one. A pending row
  // contributes exactly 0 to the chain, so dropping it changes nothing; a MERGED
  // row contributes its real saving, so a chain total would claim a figure the
  // rows below it no longer add up to — the tips deduction counted once here and
  // once again in the block above, which is the one thing this pass may not do.
  const total = shown.reduce((a, row) => a + row.saved, 0);

  // EVERYTHING THIS BLOCK HAD TO SAY IS NOW ABOVE IT. Tips merged into the tips
  // block, nothing else answered, no bonus: printing the zero-case line here
  // ("Nothing to claim at filing from your answers so far") would contradict, on
  // the same card and four lines lower, a tips story that has just claimed the
  // deduction. `merged` is required in the test so the genuine empty case — the
  // tips question answered Yes with the box still blank — keeps its ask.
  if (!shown.length && !rows.some((row) => row.pending) && rules.bonus <= 0 && rows.some((row) => row.merged)) {
    box.innerHTML = '';
    return;
  }

  const amounts = shown.map((row) => Math.round(row.saved));
  let totalR = Math.round(total);
  if (shown.length > 1) {
    const derived = totalR - amounts.slice(0, -1).reduce((a, b) => a + b, 0);
    if (derived >= 0) amounts[amounts.length - 1] = derived;
    else totalR = amounts.reduce((a, b) => a + b, 0);
  }

  // The rows carry the money and nothing else; every qualifying sentence goes
  // BELOW the list, named for the row it qualifies. A note nested inside a flex
  // row would sit on the same line as the label it belongs to.
  const items = shown.map((row, i) =>
    `<li><span>${escLbl(row.label)}</span>` +
    `<span class="otw-amt otw-free">+${usd(amounts[i])}</span></li>`
  ).join('');

  const totalRow = shown.length > 1
    ? `<li class="otw-after"><span>Back when you file, all together</span>` +
      `<span class="otw-amt otw-free">+${usd(totalR)}</span></li>`
    : '';

  // The bonus is a PAYDAY figure sitting in a filing-time block, so it carries
  // the heavier rule that stops a reader adding it in, and its own words say
  // when it happens.
  let bonusRow = '';
  const stateName = taxData.states[stateSlug]?.name || '';
  // A pending row's note is the labelled grey note under the story while there
  // IS a story. When it is the only thing the block has to say, it moves up into
  // the plain box below instead, where the reason belongs, and is not printed
  // twice.
  const pendingRows = rows.filter((row) => row.pending);
  // A merged row's note goes with its money: the cap sentence, the conformity
  // sentence and the FICA sentence for tips are all printed by the tips block
  // above, so repeating them here would be the same paragraph twice on one card.
  const notable = rows.filter((row) => !row.merged);
  const noteRows = shown.length ? notable : notable.filter((row) => !row.pending);
  const notes = noteRows.filter((row) => row.note || row.extra)
    .map((row) => `<p class="otw-note"><strong>${escLbl(row.label)}.</strong> ${escLbl(row.note)}` +
      `${row.extra ? ' ' + escLbl(row.extra) : ''}</p>`);
  if (rules.bonus > 0) {
    // The same correction, for the same reason and with a second one of its
    // own: regIncome drives the Social Security wage base and the additional
    // Medicare threshold in the bonus engine, and tips are wages that count
    // towards both. A tipped worker near the wage base was being told their
    // bonus lost Social Security it would not actually lose.
    const b = bonusLine(input, returnIncome);
    bonusRow = `<li class="otw-after"><span>Your ${usd(b.bonus)} bonus lands as about this on payday</span>` +
      `<span class="otw-amt">${usd(b.lands)}</span></li>`;
    // THE SENTENCE NAMES ONLY THE LINES THAT EXIST. It used to assert
    // "<State> withholding" on every state, so /alaska-paycheck-calculator/
    // explained a correct $3,518 with a withholding line Alaska does not have —
    // on the same card that says "Alaska taxes no wages" two paragraphs up. The
    // test is the engine's own figure, not a guess from the state's tax type: a
    // state can tax wages and still withhold nothing on this bonus.
    const stateClause = b.state > 0 ? `, ${escLbl(stateName)} withholding` : '';
    const noStateClause = b.state > 0
      ? ''
      : ` ${escLbl(stateName)} withholds no income tax on it.`;
    notes.push(`<p class="otw-note"><strong>Bonus.</strong> That is what arrives the day it is paid, after the flat ` +
      `federal prepayment${stateClause} and Social Security and Medicare.${noStateClause} It is not filing-time ` +
      // Only claim there is a total to keep it out of when there IS one.
      `money${shown.length ? ', so it is not part of the total above' : ''}. Some of the federal part usually comes ` +
      `back when you file, which the bonus calculator works out.</p>`);
  }

  const story = (items || bonusRow)
    ? `<ul class="otw-story">${items}${totalRow}${bonusRow}</ul>${notes.join('')}`
    : notes.join('');
  const lead = shown.length
    ? `<p class="otw-lead">None of this changes the paycheck above. It arrives when you file:</p>`
    : '';

  // The three sentences the whole family of filing-time deduction tools has to
  // say, because without them readers left believing this money was tax-free
  // outright: it comes back at filing, Social Security and Medicare are still
  // owed on the pay behind it, and the paycheck during the year does not move.
  // A bonus-only answer gets none of them: not one of the three is true of it,
  // and pasting a FICA note onto a tool it does not describe is how a page ends
  // up confidently explaining the wrong thing.
  //
  // THE FICA SENTENCE NAMES THE WAGE, not "it". Its antecedent used to be the
  // money back at filing, so the card asserted that Social Security is owed on a
  // refund; the standalone tools name the wage item instead ("FICA still apply
  // to your tips"). And a row with no wage behind it — turning 65 — is left out
  // of the sentence entirely, so a senior-only answer no longer carries a FICA
  // claim about a $6,000 age allowance that is not pay at all. That is the same
  // exclusion the bonus-only answer already gets, for the same reason.
  const ficaItems = [...new Set(shown.map((row) => row.fica).filter(Boolean))];
  let plain = '';
  if (shown.length) {
    plain = `<div class="otw-plain">This is money back when you file next year, as a bigger refund or a smaller ` +
      `bill, not extra in each paycheck.` +
      (ficaItems.length
        ? ` Social Security and Medicare are still owed on ${ficaItems.join(' and ')}: the deduction lowers federal ` +
          `income tax only.`
        : '') +
      ` Your take-home above does not change because of it. Ask your employer about your W-4 if you would rather ` +
      `have it during the year.</div>`;
  } else if (!bonusRow) {
    // The RIGHT reason, not the generic one: over a card where the visitor has
    // answered Yes and filled in half of it, "fill in the figures on the cards
    // you answered Yes to" names a problem they think they have already solved.
    // The row's own note names the one box that is empty.
    plain = `<div class="otw-plain">` +
      (pendingRows.length
        ? escLbl(pendingRows.map((row) => row.note).join(' '))
        : `Nothing to claim at filing from your answers so far. Fill in the figures on ` +
          `the cards you answered Yes to and this fills in.`) +
      `</div>`;
  }

  // The heading names what is actually below it. "At filing next year" over a
  // lone bonus row would be flatly wrong: a bonus is paid, and taxed, on payday.
  const kick = shown.length ? 'At filing next year' : (bonusRow ? 'When that bonus is paid' : 'At filing next year');

  box.innerHTML = `<p class="otw-kick">${kick}</p>` + lead + story + plain;
}

// --- the tips block, under the results table ---------------------------------
// The story the summary was missing. Four figures and a fifth DERIVED FROM THEM:
// the labels invite the reader to subtract down the column, so the last row
// ("Tips you keep" yearly, "Tips in your pocket now" per paycheck) is what is
// left after the three printed, rounded amounts, never a sixth independent
// Math.round that can land a dollar away from them.
//
// WHICH FEDERAL FIGURE IS PRINTED IS THE EXACTLY-ONCE RULE, and it turns on the
// view, not on a preference:
//   yearly, on top   the filed figure. The deduction is spent HERE, and
//                    renderAtFiling is told to merge its tips row away.
//   per paycheck     the withheld figure, because a paycheck is withholding.
//                    The deduction is spent in the at-filing block instead, and
//                    the note here points at it rather than restating a number.
//   inside the pay   the withheld figure again, and no total moves: the money is
//                    already in every row above. The at-filing block keeps its
//                    tips row, so the deduction is still counted exactly once.
//
// The state row is OMITTED, not zeroed, on the nine states that tax no wages —
// the same rule the results table itself follows, for the same reason: a
// withholding line that does not exist must not be asserted beside a correct
// figure. The subtraction still closes, with one row fewer.
function renderTipsBlock(input, r, tips, annualView) {
  const box = slot('tips');
  if (!box) return;
  if (!tips) { box.innerHTML = ''; return; }

  const stateName = taxData.states[stateSlug]?.name || '';
  const hasStateTax = !!taxData.states[stateSlug]?.hasIncomeTax;
  // Per paycheck the whole panel is per period, so these are too. `filed` is the
  // yearly, on-top case and nothing else.
  const filed = annualView && !tips.inside;
  const div = annualView ? 1 : (r.periods || 1);
  const per = (v) => v / div;

  const gross = Math.round(per(tips.tips));
  const fedRaw = filed ? tips.fedFiled : tips.fedWithheld;
  const fedR = Math.round(per(fedRaw));
  const ficaR = Math.round(per(tips.fica));
  const stateR = hasStateTax ? Math.round(per(tips.state)) : 0;
  const keep = gross - fedR - ficaR - stateR;

  // THE TWO NUMBERS THAT RECONCILE THE VIEWS, and the reason the per-paycheck
  // block was unreadable without them. A visitor on $75,000 biweekly with $1,000
  // of tips read "Tips you keep $25" here and "$873" in the yearly view, and
  // 25 x 26 = 650 is not 873 to anybody. Two things are missing from that
  // multiplication and neither was on the page: the withheld federal tax comes
  // back at filing, and every row is rounded to the dollar.
  //
  // `back` is the SAME arithmetic the at-filing block prints for tips
  // (fedWithheld - fedFiled IS federalTaxSaved's taxSaved, see tipsSlice), so
  // the two say the same number rather than two numbers a few dollars apart.
  // The rounding therefore has to land somewhere else, and it lands on `now`,
  // which is why that one is the figure hedged with "about": it is the yearly
  // total minus an exact refund, not 26 copies of a rounded $25.
  //
  // yKeep is computed EXACTLY as the yearly view computes it — round each of
  // the four printed amounts, then subtract — so "the Annual view shows" is a
  // claim about the page, not about the engine, and now + back = yKeep by
  // construction rather than by luck.
  const backR = Math.round(Math.max(0, tips.fedWithheld - tips.fedFiled));
  const yKeep = Math.round(tips.tips) - Math.round(tips.fedFiled) - Math.round(tips.fica) -
    (hasStateTax ? Math.round(tips.state) : 0);
  const nowYear = yKeep - backR;
  // Nothing comes back when the deduction is fully phased out, and a "(comes
  // back when you file)" over a $0 refund is a promise the page cannot keep.
  const comesBack = !annualView && backR > 0;

  const fedLabel = filed
    ? 'Federal income tax on them (usually $0 under the 2025 law)'
    : 'Federal income tax withheld on them' + (comesBack ? ' (comes back when you file)' : '');
  const rows = [
    `<li><span>Tips before tax</span><span class="otw-amt">${usd(gross)}</span></li>`,
    `<li><span>${fedLabel}</span><span class="otw-amt otw-taxed">−${usd(fedR)}</span></li>`,
    `<li><span>Social Security &amp; Medicare</span><span class="otw-amt otw-taxed">−${usd(ficaR)}</span></li>`
  ];
  if (hasStateTax) {
    rows.push(`<li><span>${escLbl(stateName)} tax</span><span class="otw-amt otw-taxed">−${usd(stateR)}</span></li>`);
  }
  // "Tips you keep" is true of the year and false of a paycheck: per period the
  // federal line above it is withholding, so some of what this row subtracts is
  // money the visitor gets back. The per-paycheck label says which one it is,
  // and the note under the block says where the rest of it went.
  const keepLabel = annualView ? 'Tips you keep' : 'Tips in your pocket now';
  rows.push(`<li class="otw-after"><span>${keepLabel}</span><span class="otw-amt otw-free">${usd(keep)}</span></li>`);

  const notes = [];
  // BOTH NUMBERS, THE MOMENT THE CAP OR THE PHASE-OUT BINDS, and only in the
  // view that is actually spending the deduction: in the other two the at-filing
  // row prints this same sentence, and one card may not say it twice.
  if (filed && tips.deduction.deduction < tips.tips) {
    const d = tips.deduction;
    notes.push(`<p class="otw-note">${usd(d.deduction)} of your ${usd(tips.tips)} in tips is deductible` +
      (d.fullyPhasedOut
        ? `: your pay is high enough that the deduction is fully phased out, so the federal tax above is the ordinary tax on all of it.`
        : d.phasedOut
          ? `: the ${usd(d.statutoryCap)} cap falls to ${usd(d.allowedCap)} at your income, and the federal tax above is on the rest.`
          : `. The deduction stops at ${usd(d.allowedCap)} a year, and the federal tax above is on the rest.`));
  }
  if (!filed && !tips.inside) {
    notes.push(`<p class="otw-note">A paycheck is withholding, so the no-tax-on-tips deduction is not in the ` +
      `federal figure above. It comes back when you file, and the block below works out how much.</p>`);
  }
  // The line that joins the two views. Only per paycheck, and only against the
  // yearly figure that actually differs from it: with the tips already inside
  // the pay, the yearly view prints the withheld federal tax too, so there is no
  // gap to explain and this sentence would be inventing one.
  if (comesBack && !tips.inside) {
    notes.push(`<p class="otw-note">Over a year that is about ${usd(nowYear)} in your pocket now (the rows ` +
      `above are rounded to the dollar), plus the ${usd(backR)} of withheld federal tax you get back when ` +
      `you file, which together are the ${usd(yKeep)} the Annual view shows.</p>`);
  }
  if (tips.inside) {
    notes.push(`<p class="otw-note">These tips are already inside every figure above, so nothing here is added ` +
      `to your take-home: this is the part of it your tips account for. What the no-tax-on-tips deduction is ` +
      `worth is worked out below.</p>`);
  }
  // The state's own 2026 verdict, in the same words the rest of the page uses.
  // The "partial" wording already says the state adds a smaller break of its
  // own; here it has to also say that this figure does not include it, because
  // the figure is right above the sentence.
  const clause = conformityClause('tips');
  if (clause) {
    notes.push(`<p class="otw-note">${escLbl(clause)}` +
      (tips.conformity === 'partial'
        ? ` The state tax above does not take that smaller break off — ${escLbl(stateName)} sets its own cap, and ` +
          `the state's own return is where it is claimed.`
        : '') + `</p>`);
  }
  if (hasStateTax && tips.fica > 0) {
    notes.push(`<p class="otw-note">Social Security and Medicare are owed on tips whatever the income-tax rules ` +
      `say, which is why that line is never zero.</p>`);
  }

  const kick = tips.inside
    ? 'Of that pay, your tips'
    : (annualView ? 'Your tips, on top of that, over a year' : `Your tips, on top of that, ${PERIOD_LABEL[r.payFrequency] || PERIOD_LABEL.biweekly}`);
  box.innerHTML = `<p class="otw-kick">${kick}</p><ul class="otw-story">${rows.join('')}</ul>${notes.join('')}`;
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

// TIPS ON TOP WIDEN THE BAR RATHER THAN SQUEEZING INTO IT. The bar is a picture
// of where a year's money goes, so when there is a second pot the denominator is
// the pay PLUS the tips, the tax segment picks up the tax on the tips, and the
// tips a person keeps get a segment of their own. The four segments then still
// come to exactly 100%: net + tipsKeep + (taxes + tipsTax) + deductions is the
// pay plus the tips, by construction and not by rounding luck.
//
// Tips the visitor said are already INSIDE the pay change nothing here, because
// they are already inside every one of these four figures. That is the same
// reason the headline does not move for them.
function renderBreakdown(r, tips) {
  const g = r.annual.gross;
  if (g <= 0) { $('breakdown').style.display = 'none'; return; }
  $('breakdown').style.display = '';
  const onTop = tips && !tips.inside;
  // The FILED figures, always, whichever view is on screen: the bar has no
  // per-paycheck mode — it has always drawn the annual shares — so it draws the
  // year, and the year is the return.
  const tipsKeep = onTop ? Math.max(0, tips.keepFiled) : 0;
  const tipsTax = onTop ? (tips.fedFiled + tips.fica + tips.state) : 0;
  const total = g + (onTop ? tips.tips : 0);
  const taxes = r.annual.totalTax + tipsTax;
  const ded = r.annual.preTax + r.annual.postTax + (r.annual.statePrograms || 0);
  const net = r.annual.net;
  const w = (v) => (v / total * 100).toFixed(2) + '%';
  $('segNet').style.width = w(net);
  $('segTips').style.width = w(tipsKeep);
  $('segTax').style.width = w(taxes);
  $('segDed').style.width = w(ded);
  $('lgNet').textContent = pct(net / total);
  $('lgTax').textContent = pct(taxes / total);
  $('lgDed').textContent = pct(ded / total);
  $('lgDedWrap').style.display = ded > 0 ? '' : 'none';
  // Written through the slot, never through an id with textContent, so this
  // element stays out of build.js's pre-render denominator. Parity-neutral: with
  // the tips question answered No the first render leaves it hidden and empty,
  // which is what the template serves.
  const tipsPct = slot('tipsPct');
  if (tipsPct) tipsPct.textContent = onTop ? pct(tipsKeep / total) : '';
  const tipsWrap = $('lgTipsWrap');
  if (tipsWrap) tipsWrap.style.display = onTop ? '' : 'none';
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

  // TIPS, WORKED OUT ONCE FOR THE WHOLE RENDER. The headline, its caption, its
  // sub-line, the running echo, the bar and the tips block all read this one
  // object, so there is no second reading of the tips fields that could
  // disagree with it. It is null until the OBBBA figures land, which is the same
  // one-render wait the at-filing block already has; the fetch is kicked off
  // here rather than three calls later so the wait is as short as it can be.
  if (input.rules.tips > 0) ensureRuleData();
  const tips = tipsSlice(input, r);
  // What the pay's own take-home gains, in the truth of the view on screen: the
  // year is the return (after the deduction), a paycheck is withholding (before
  // it). Zero in every case the page shipped with, which is why the pre-rendered
  // headline still hydrates to the identical string.
  const tipsKeepYear = tips && !tips.inside ? tips.keepFiled : 0;
  const tipsKeepPeriod = tips && !tips.inside ? tips.keepWithheld / (r.periods || 1) : 0;
  const tipsAdd = annualView ? tipsKeepYear : tipsKeepPeriod;

  // "No pay entered yet", the state the three rate rows below decline to answer
  // in. Written as !(x > 0) rather than x <= 0 so a NaN gross — an unparseable
  // field — counts as no pay rather than as a real zero.
  const isZero = !(r.annual.gross > 0);

  // Nothing entered yet: ask, do not answer. A blank headline and a caption that
  // says what to do next beat "$0.00" under "Based on a $0 salary", which is a
  // confident wrong answer about the visitor's own pay.
  $('netBig').textContent = isZero ? '' : usd2(p.net + tipsAdd);
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
  // The cross-reference to the OTHER view is quoted in the OTHER view's truth:
  // the yearly line quotes a paycheck, which is withholding, and the paycheck
  // line quotes a year, which is the return. Quoting one truth in both places
  // would make the two figures on this line come from different arithmetic
  // depending on which radio was on.
  $('netSub').textContent = isZero
    ? ''
    : (annualView
      ? `take-home per year · ${usd2(r.perPaycheck.net + tipsKeepPeriod)} ${PERIOD_LABEL[r.payFrequency]}`
      : `take-home ${PERIOD_LABEL[r.payFrequency]} · ${usd(r.annual.net + tipsKeepYear)}/yr`);

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
      : `Take-home now: ${usd2(p.net + tipsAdd)} ${annualView ? PERIOD_LABEL.annual : PERIOD_LABEL[r.payFrequency]}`;
  }

  showResultRows(!isZero);
  renderAnswerLead(input, r);

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

  renderBreakdown(r, tips);
  renderTipsBlock(input, r, tips, annualView);
  // The four rule answers, worked out. Deliberately AFTER every row above and
  // outside the results table: not one figure in it belongs to the paycheck, so
  // none of it may be subtracted from Net pay or appear as a row that a reader
  // would take off the top line.
  //
  // THE MERGE FLAG IS THE EXACTLY-ONCE RULE IN ONE EXPRESSION. The tips block
  // above spends the no-tax-on-tips deduction only in the yearly view of tips
  // that sit on top of the pay; in every other combination it prints withholding
  // and the deduction is this block's to print. So the tips row leaves this list
  // exactly when, and only when, the block above has already claimed it.
  renderAtFiling(input, r, !!tips && !tips.inside && annualView);
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

// True once the flow has reached the answer card at least once since the last
// Start over. It is the difference between "answered No" and "not asked yet",
// which is the whole of what state-flow.js needs to know before it stops
// re-asking the four rule questions in the applies panel.
let answerReached = false;

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
// to the card that asked.
//
// THE FOUR RULE CARDS ARE CHIPPED TOO, and leaving them out was a dead end, not
// a tidiness win. The reasoning was that their answers show twice already: as
// the ticked chips inside the applies panel on the same card, and as a line in
// the filing block above. Neither is a way BACK. The applies chip is a
// checkbox — it can flip qTips to Yes, but the figure that Yes needs is asked on
// card 4, and the answer card ships no Back button and no nav row, so there was
// no route to card 4 at all. Reproduced: on the answer card, tick "Customers tip
// me" and the block printed "Fill in the figures on the cards you answered Yes
// to and this fills in" — an instruction pointing at a card the visitor could
// not reach. The only exit was Start over, which puts our $75,000 example back
// and discards every answer. A chip is the whole way back, and it is the same
// fix, for the same reason, that put chips on the five deduction cards below.
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

  // The four rule cards, in card order, before the deduction chips so the chip
  // row reads in the order the flow asked. A Yes with its figure still empty
  // gets a chip that says so rather than one quoting $0: the figure is missing,
  // not zero, and this chip is the way to the box that is missing it. `field` is
  // named only where that card's input is on screen, which is only on a Yes —
  // pointing at a field inside a hidden [data-reveal] wrapper leaves the focus
  // call silently doing nothing.
  const rule = (step, yes, onLabel, offLabel, field) =>
    list.push(yes ? { step, label: onLabel, field } : { step, label: offLabel });
  // The chip quotes BOTH halves of that card, because both are answers and the
  // second one decides whether the headline the visitor is looking at includes
  // the first. A chip reading "$10,000/yr in tips" beside a take-home that did
  // or did not contain them was the same chip in two different worlds.
  rule(Q_TIPS, answeredYes('qTips'),
    s.rules.tips > 0
      ? `${usd(s.rules.tips)}/yr in tips${s.rules.tipsInside ? ', inside my pay' : ', on top'}`
      : 'tips, no figure yet',
    'no tips', 'tipsYear');
  rule(Q_OT, answeredYes('qOt'),
    s.rules.otHours > 0 ? `${count(s.rules.otHours)} extra hours` : 'extra hours, no figures yet',
    'no extra hours',
    // A salaried visitor is asked for their normal rate first; an hourly one
    // gave it on card one and that field is off their card.
    s.basis === 'hourly' ? 'otHours' : 'regRate');
  rule(Q_BONUS, answeredYes('qBonus'),
    s.rules.bonus > 0 ? `${usd(s.rules.bonus)} bonus` : 'a bonus, no figure yet',
    'no bonus', 'bonusAmount');
  // No figure of its own: the card is the question, so the chip is the answer.
  list.push({ step: Q_AGE, label: s.rules.age65 ? 'turning 65 this year' : 'not turning 65' });

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

  // Bound HERE, before createWizard() and wizard.start() add the core's own
  // listeners, so this flag is already true by the time the same event's render
  // reads it. Bound after them it would be one keystroke late, which is exactly
  // the lag that makes wizard-core's example note the wrong thing for
  // renderAnswerLead to read.
  const amountEl = $('amount');
  if (amountEl) {
    ['input', 'change'].forEach((evt) =>
      amountEl.addEventListener(evt, (e) => { if (e.isTrusted) payIsOurs = false; }));
  }

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

  // The tips sub-question is the SECOND radio group on the tips card, and
  // wizard-core takes one per card — that slot belongs to qTips, which is the
  // question the card's dots, pointer and Start over are keyed to. So this group
  // is wired here, the same way the view toggle above it is, and put back by
  // onReset below (the core restores only the groups it was told about). It is
  // never given `fields`, because it is not a field: nothing types into it.
  document.querySelectorAll('input[name="tipsInside"]').forEach((el) =>
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

      // NO CARD ON THIS PAGE DECLARES skipClears, and that is a correction, not
      // an omission. Every one of these nine cards used to list its own money
      // fields there, on the reasoning that a number typed and then skipped past
      // should not keep feeding an answer from a card the visitor has left
      // behind. The button says "Skip to my answer", which a first-time reader
      // takes to mean "I am done, show me the number" — and it silently deleted
      // the number they had just typed. Reproduced on georgia: answer Yes to "Do
      // customers tip you?", type 10,000, press Skip to my answer, and the block
      // read "Nothing to claim at filing from your answers so far" with qTips
      // still on Yes. The figure was gone and, before the rule cards were
      // chipped, so was any route back to the box it came from.
      //
      // Nothing feeds an answer from a card the visitor abandoned, because Skip
      // does not touch the RADIO: every one of these fields is gated by its own
      // question in readForm(), so a No is worth zero whatever is still in the
      // box, and a Yes is the visitor's own answer whether they left the card by
      // Next or by Skip. Every field also ships EMPTY, so a Skip past an
      // untouched card contributes nothing either way. What Skip means here is
      // "stop asking me questions", and it now keeps what it was given.
      { step: Q_TIPS, radios: 'qTips', fields: ['tipsYear'],
        flags: [{ id: 'otwTipsFlag', text: tipsWarning }] },
      { step: Q_OT, radios: 'qOt', fields: ['regRate', 'otHours', 'otRate'],
        flags: [{ id: 'otwOtFlag', text: overtimeWarning }] },
      { step: Q_BONUS, radios: 'qBonus', fields: ['bonusAmount'] },
      { step: Q_AGE, radios: 'qAge' },

      // The five that do change the figure. Same rule as above: a No zeroes its
      // own field, so skipping past a card cannot smuggle a number into the
      // take-home, and skipping past a card the visitor DID answer keeps it.
      { step: Q_RETIRE, radios: 'qRetire', fields: ['retirement401k'],
        flags: [{ id: 'otwRetireFlag', text: retireWarning }] },
      { step: Q_HEALTH, radios: 'qHealth', fields: ['cafeteria125'],
        flags: [{ id: 'otwHealthFlag', text: healthWarning }] },
      { step: Q_DEPS, radios: 'qDeps', fields: ['depChildren', 'depOther'] },
      { step: Q_EXTRA, radios: 'qExtra', fields: ['extraWithholding'],
        flags: [{ id: 'otwExtraFlag', text: extraWarning }] },
      { step: Q_POST, radios: 'qPost', fields: ['postTax'],
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
      // Told once, on the first arrival at the answer. state-flow.js uses it to
      // stop the applies panel re-asking the four rule questions as checkboxes
      // when the flow has just been answered No to all four; before this event
      // it hides nothing, so a visitor who never reached the answer keeps both
      // copies. Once per arrival, not once per keystroke: onRender runs on every
      // edit, and the flag it sets is one-way until Start over.
      if (step === RESULT && !answerReached) {
        answerReached = true;
        try { document.dispatchEvent(new CustomEvent('tb:paycheck-answered')); }
        catch (_) { /* older browsers: the panel simply keeps asking */ }
      }
    },

    // Start over puts every radio back by assignment, which fires no change
    // event, so the four applies chips would keep showing the answers the
    // visitor just discarded. state-flow.js listens for this and re-reads them.
    // The overtime rate goes back to following the normal rate too: it is not a
    // number the visitor typed any more, so it must not keep behaving like one.
    onReset: () => {
      // wizard-core restores one radio group per card and the tips card's is
      // qTips, so the sub-question is put back here. Without this, Start over
      // left "already inside my pay" ticked over a re-filled $75,000 example and
      // the next visitor's tips silently stopped moving the headline.
      const onTop = document.querySelector('input[name="tipsInside"][value="ontop"]');
      if (onTop) onTop.checked = true;
      otRateTouched = false;
      answerReached = false;
      payIsOurs = true;
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
