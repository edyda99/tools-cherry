// app.js — wires the form to the engine and renders results live.
// Each generated state page injects window.__TAX_DATA__ (federal + that state)
// and window.__STATE_SLUG__ before this module loads.
import { computePaycheck, PAY_PERIODS, federalBracketBreakdown } from '/assets/paycheck-engine.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
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

// True until the visitor edits the form, i.e. while the figure on screen is
// still the page's own worked example rather than the visitor's own numbers.
let exampleLive = true;

function currentMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : 'simple';
}

// --- Advanced: plain questions instead of jargon-labelled money fields -------
// Each question is a yes/no radio group; the money input it needs sits in a
// [data-reveal] wrapper that ships visible in the HTML and is hidden here when
// the answer is No. Answering No zeroes that field's contribution even if a
// number is still sitting in it, so flipping back to No always restores the
// Simple-mode result.
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
  const checked = document.querySelector('input[name="view"]:checked');
  return checked ? checked.value : 'period';
}

function readForm() {
  const wageType = $('wageType').value; // 'salary' | 'hourly'
  const amount = moneyValue($('amount')) || 0;
  const hoursPerWeek = parseFloat($('hours').value) || 40;
  const input = {
    wage: { type: wageType, amount, hoursPerWeek },
    filingStatus: $('filingStatus').value,
    payFrequency: $('payFrequency').value,
    stateSlug
  };
  if (currentMode() === 'advanced') {
    input.adv = {
      retirement401k: advMoney('qRetire', 'retirement401k'),
      cafeteria125: advMoney('qHealth', 'cafeteria125'),
      dependentsCredit: answeredYes('qDeps') ? dependentsCreditValue() : 0,
      extraWithholding: advMoney('qExtra', 'extraWithholding'),
      postTax: advMoney('qPost', 'postTax')
    };
  }
  return input;
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
  const input = readForm();
  // hourly fields visibility
  $('hoursField').style.display = input.wage.type === 'hourly' ? '' : 'none';

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
  $('netSub').textContent = isZero
    ? ''
    : (annualView
      ? `take-home per year · ${usd2(r.perPaycheck.net)} ${PERIOD_LABEL[r.payFrequency]}`
      : `take-home ${PERIOD_LABEL[r.payFrequency]} · ${usd(r.annual.net)}/yr`);

  // Only the state paycheck pages carry the caption; guard so shared consumers
  // of this module are unaffected.
  const lbl = $('netLabel');
  if (lbl) lbl.textContent = isZero ? NO_PAY_YET_ASK : netLabelText(input);

  // The Advanced questions run to y=1797 on a 390px viewport while the answer
  // band sits at y=394, so the last three questions change a figure one to two
  // screens above the thumb. This line lives at the foot of that panel.
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

function convertOnWageTypeSwitch() {
  const now = $('wageType').value;
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

function applyMode() {
  const adv = currentMode() === 'advanced';
  $('advancedFields').hidden = !adv;
  render();
}

function init() {
  initMoneyInputs();
  prevWageType = $('wageType').value;
  // Registered before the render listeners so the amount is already converted
  // by the time the render for this same event runs.
  ['change', 'input'].forEach((evt) =>
    $('wageType').addEventListener(evt, convertOnWageTypeSwitch));

  // The pre-filled figure is labelled as an example until the visitor touches
  // the form; after that the label must not claim to be an example any more.
  const form = $('paycheckForm');
  const dropExampleLabel = () => {
    exampleLive = false;
    const kicker = $('netKicker');
    if (kicker) kicker.textContent = 'Your estimated take-home pay';
    const big = $('netBig');
    if (big) big.classList.remove('is-example');
    document.querySelector('.calc-example')?.remove();
  };
  if (form) {
    form.addEventListener('input', dropExampleLabel, { once: true });
    form.addEventListener('change', dropExampleLabel, { once: true });
  }

  ['wageType', 'amount', 'hours', 'filingStatus', 'payFrequency',
   'retirement401k', 'cafeteria125', 'dependentsCredit', 'extraWithholding', 'postTax',
   'depChildren', 'depOther']
    .forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('input', id === 'depChildren' || id === 'depOther'
        ? () => { syncAdvancedQuestions(); render(); }
        : render);
    });
  ADV_QUESTIONS.forEach((name) => {
    document.querySelectorAll(`input[name="${name}"]`).forEach((el) =>
      el.addEventListener('change', () => { syncAdvancedQuestions(); render(); }));
  });
  syncAdvancedQuestions();
  document.querySelectorAll('input[name="mode"]').forEach((el) =>
    el.addEventListener('change', applyMode));
  document.querySelectorAll('input[name="view"]').forEach((el) =>
    el.addEventListener('change', render));
  const cmpPanel = $('comparePanel');
  if (cmpPanel) cmpPanel.addEventListener('toggle', () => { if (cmpPanel.open) populateCompare().then(renderCompare); });
  if ($('cmpState')) $('cmpState').addEventListener('change', renderCompare);
  applyMode();
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
