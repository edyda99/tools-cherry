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
import { computePaycheck, PAY_PERIODS, federalBracketBreakdown, annualizeGross } from '/assets/paycheck-engine.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
// Imported, never re-derived: one shared reader for a radio group, and the boot
// handshake that puts the site's "this calculator failed to load" banner on
// screen with the plain stacked form still visible underneath it.
import { createWizard, radioOf } from '/assets/wizard-core.js';
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
// data-step on each card in state-page.html, named. The five deduction cards
// come last because they are the only optional ones that change the figure, and
// the four rule cards before them change no figure at all: they decide which of
// this state's 2026 rule pointers the answer card shows. RESULT is never skipped.
const AMOUNT = 0, PAYTYPE = 1, HOURS = 2, FREQ = 3, FILING = 4;
const Q_TIPS = 5, Q_OT = 6, Q_BONUS = 7, Q_AGE = 8;
const Q_RETIRE = 9, Q_HEALTH = 10, Q_DEPS = 11, Q_EXTRA = 12, Q_POST = 13;
const RESULT = 14;

// --- The five deduction questions -------------------------------------------
// Each is a yes/no radio group on its own card; the money input it needs sits in
// a [data-reveal] wrapper that ships visible in the HTML and is hidden here when
// the answer is No. Answering No zeroes that field's contribution even if a
// number is still sitting in it, so flipping back to No always restores the
// plain answer.
const ADV_QUESTIONS = ['qRetire', 'qHealth', 'qDeps', 'qExtra', 'qPost'];

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
  for (const name of ADV_QUESTIONS) {
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
  const derived = $('depCredit');
  if (derived) derived.textContent = usd(dependentsCreditValue());
}

function currentView() {
  return radioOf('view', 'period');
}

// The one reader. wizard-core calls it too (spec.read), so the flow's path
// predicates, its answer chips and its inline flags all see exactly the figures
// the engine is about to be handed, rather than a second reading of the same
// fields that could disagree with it.
//
// The three closed choices are radio groups rather than <select>s since the card
// rewrite: a card asks one question, and a radio group answers it without a
// second tap into a dropdown. radioOf falls back to the shipped default when
// nothing is checked, which is also what a no-JS submit would have sent.
function readForm() {
  const wageType = radioOf('wageType', 'salary'); // 'salary' | 'hourly'
  const amount = moneyValue($('amount')) || 0;
  const hoursPerWeek = parseFloat($('hours').value) || 40;
  return {
    wage: { type: wageType, amount, hoursPerWeek },
    filingStatus: radioOf('filingStatus', 'single'),
    payFrequency: radioOf('payFrequency', 'biweekly'),
    stateSlug,
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
// pay-type card says hourly. It does not look wrong on the card, and the answer
// it produces is wrong by a factor of about two thousand.
function wageTypeWarning(s) {
  if (s.wage.type !== 'hourly' || s.wage.amount < 1000) return '';
  return `Check these numbers: ${usd2(s.wage.amount)} an hour over ${s.wage.hoursPerWeek} hours a week ` +
    `comes to ${usd(yearlyPay(s))} a year. If that figure is your yearly salary, choose "A yearly salary" above.`;
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
  const basis = input.wage.type === 'hourly'
    ? `${usd2(input.wage.amount)} an hour over ${input.wage.hoursPerWeek} hours a week`
    : `a ${usd(input.wage.amount)} salary`;
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
  // Show or hide each deduction question's money field for the answer beside it
  // before anything is read, so a field that has just been switched off is not
  // still on screen while its contribution is already zero. There is no separate
  // "hours" toggle any more: hours is its own card, and wizard-core drops it
  // from the path (and from the dots) the moment the pay type is a salary.
  syncAdvancedQuestions();

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

  // deduction rows: only show when non-zero (style.display, since .line { display:flex }
  // overrides the [hidden] attribute via specificity)
  if (!isZero && p.preTax > 0) { $('preTaxLine').style.display = ''; $('rPreTax').textContent = '−' + usd2(p.preTax); }
  else $('preTaxLine').style.display = 'none';
  if (!isZero && p.postTax > 0) { $('postTaxLine').style.display = ''; $('rPostTax').textContent = '−' + usd2(p.postTax); }
  else $('postTaxLine').style.display = 'none';

  renderBreakdown(r);
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

// --- pay type switch --------------------------------------------------------
// Switching salary <-> hourly used to leave the old number in place, so an
// annual salary was read as an hourly rate. Convert the visitor's own figure
// instead; no tax figure is involved.
let prevWageType = null;

// The live flow controller, held rather than mounted and forgotten, for the one
// thing below that needs it.
let wizard = null;

// Pay type is the only answer on this page that changes the SHAPE of the flow:
// hourly adds the hours card, salary drops it. wizard-core repaints the progress
// dots and the "Step 3 of 5" label from every FIELD event, but a radio answer
// only re-renders the result, so the dots kept describing a flow one card longer
// than the one the visitor was in until they pressed Next. Re-showing the
// current step is the core's own public way to make it re-derive the path: it
// normalises forward if the card underfoot has just left the path, and passing
// false keeps it from stealing focus off the radio the visitor is using.
// (Reported as a wizard-core gap rather than patched there: the core is shared
// by the whole calculator family and is not this page's to change.)
function repaintFlowShape() {
  if (wizard) wizard.show(wizard.step, false);
}

function convertOnWageTypeSwitch() {
  const now = radioOf('wageType', 'salary');
  const from = prevWageType;
  if (from === null || from === now) { prevWageType = now; return; }
  prevWageType = now;

  const amountEl = $('amount');
  const current = moneyValue(amountEl);
  if (!Number.isFinite(current) || current <= 0) return;
  const hoursPerYear = (parseFloat($('hours').value) || 40) * 52;
  if (!(hoursPerYear > 0)) return;

  if (from === 'salary' && now === 'hourly') {
    amountEl.value = fmtAmount(Math.round((current / hoursPerYear) * 100) / 100, 2);
  } else if (from === 'hourly' && now === 'salary') {
    amountEl.value = fmtAmount(Math.round(current * hoursPerYear), 0);
  }
}

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
// to the card that asked. The four rule cards are deliberately not here: their
// answers are the ticked chips inside the applies panel on the same card, which
// state-flow.js keeps in step with them in both directions.
function answerChips(s) {
  const list = [
    { step: AMOUNT, field: 'amount', label: s.wage.type === 'hourly' ? `${usd2(s.wage.amount)}/hr` : `${usd(s.wage.amount)}/yr` },
    { step: PAYTYPE, label: s.wage.type === 'hourly' ? 'paid hourly' : 'salaried' }
  ];
  if (s.wage.type === 'hourly') list.push({ step: HOURS, field: 'hours', label: `${s.wage.hoursPerWeek} hrs/week` });
  list.push({ step: FREQ, label: PAID_LABEL[s.payFrequency] || PAID_LABEL.biweekly });
  list.push({ step: FILING, label: FILING_LABEL[s.filingStatus] || FILING_LABEL.single });
  return list;
}

function init() {
  initMoneyInputs();
  prevWageType = radioOf('wageType', 'salary');
  // Registered BEFORE wizard-core binds its own listeners to the same radios, so
  // the typed amount is already converted by the time the render for this same
  // change event runs. Listener order on one element is registration order.
  document.querySelectorAll('input[name="wageType"]').forEach((el) =>
    el.addEventListener('change', () => { convertOnWageTypeSwitch(); repaintFlowShape(); }));

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
  // load" banner up if anything in here throws, which is all mountWizard adds,
  // and holding the controller is what repaintFlowShape() needs.
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
      { step: AMOUNT, fields: ['amount'] },
      { step: PAYTYPE, radios: 'wageType', flags: [{ id: 'otwWageTypeFlag', text: wageTypeWarning }] },
      // Off the path entirely on a salary, so it leaves the dots and the "Step 3
      // of 5" count on the keystroke that changes the pay type, not on the next
      // Next. The input stays in the DOM: readForm() reads it unguarded.
      { step: HOURS, fields: ['hours'], when: (s) => s.wage.type === 'hourly' },
      { step: FREQ, radios: 'payFrequency' },
      { step: FILING, radios: 'filingStatus' },

      // The four rule checks. They change no figure, so they carry no flag, and
      // each carries a Skip: a visitor who only wants the take-home number should
      // never have to answer nine more questions to see it.
      { step: Q_TIPS, radios: 'qTips' },
      { step: Q_OT, radios: 'qOt' },
      { step: Q_BONUS, radios: 'qBonus' },
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
    onReset: () => {
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
