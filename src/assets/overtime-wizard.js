// overtime-wizard.js — the card-by-card flow on /overtime-tax-calculator/.
// Estimates the OBBBA "no tax on overtime" (IRC §225) federal deduction and the
// tax it saves. All logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// form and is still served by overtime-tax-calculator.js; the two must stay
// independent, so nothing here reads or writes an id the embed also ships except
// through its own page's DOM.
//
// THE MATH, and why it is not 1.5x. The wizard asks what one overtime hour
// actually pays instead of assuming time-and-a-half, because the two employers
// who break that assumption break it in opposite directions and both used to get
// a wrong answer:
//   paidExtra    = max(0, otRate - rate) x hours   what overtime really adds
//   requiredHalf = 0.5 x rate x hours              the half the FLSA requires
//   premium      = min(paidExtra, requiredHalf)    the only part §225 deducts
//   generosity   = max(0, paidExtra - requiredHalf) paid above the half, taxed
// Double time (otRate = 2x rate) produces generosity, and only the required half
// is deductible. An employer paying less than time-and-a-half produces a premium
// smaller than the required half, and we deduct what was actually paid, never
// the half they should have been given.
import { estimate, overtimePremium } from '/assets/obbba-deduction.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';

const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;
const STATES = window.__STATES__ || {};

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
// An HOURLY rate carries cents: a typed 22.50 must not be quoted back as "$23".
const usdRate = (n) => {
  const v = Math.max(0, n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
// Counts (hours) get thousands separators but KEEP fractions: the math runs on
// 500.5 hours, so quoting it back as "501" would name a number nobody typed.
const count = (n) => Math.max(0, n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

const money = (id) => { const el = $(id); return el ? moneyValue(el) : 0; };
function num(id) {
  const el = $(id);
  const v = el ? parseFloat(el.value) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// ---- Steps ------------------------------------------------------------------
// data-step on each card. RESULT is the last card and is never "skipped".
const RATE = 0, OTRATE = 1, HOURS = 2, INCOME = 3, FILING = 4, STATE = 5, RESULT = 6;
const FILING_WORDS = { single: 'single', married: 'married, filing together', head_of_household: 'head of household' };

let cards = [];
let step = RATE;
let otRateTouched = false;

// Direct mode: a premium typed into the escape on the first card. It outranks
// rate/otRate/hours entirely, so the two cards that only feed those are skipped
// rather than asked and ignored.
const isDirect = () => money('premium') > 0;

function nextOf(s, direct) {
  if (s === RATE) return direct ? INCOME : OTRATE;
  return Math.min(s + 1, RESULT);
}
function prevOf(s, direct) {
  if (s === INCOME) return direct ? RATE : HOURS;
  return Math.max(s - 1, RATE);
}
// The steps this visitor will actually see, in order, ending at RESULT.
function pathOf(direct) {
  const p = [];
  let s = RATE;
  for (let guard = 0; guard <= RESULT + 1; guard++) {
    p.push(s);
    if (s === RESULT) break;
    s = nextOf(s, direct);
  }
  return p;
}

// ---- The one polite live region --------------------------------------------
// #out rewrites its whole innerHTML on every keystroke, so it is NOT a live
// region; a single debounced sentence goes to #outStatus instead, and never for
// the load render.
let statusTimer = null;
let announceReady = false;
function announce(text) {
  if (!announceReady) return;
  const el = $('outStatus');
  if (!el) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = text; }, 500);
}

// ---- The example label ------------------------------------------------------
// The page loads with numbers nobody typed, so the answer is labelled as an
// example until the visitor has supplied EVERY figure it is built from: income,
// plus either a typed premium or BOTH a rate and hours. Clearing it on the first
// edit to any one field presented an answer still made of our invented income
// and our invented rate as the visitor's own.
const touchedFields = new Set();
function noteFieldTouched(id) {
  touchedFields.add(id);
  const overtimeSupplied = touchedFields.has('premium') ||
    (touchedFields.has('regRate') && touchedFields.has('otHours'));
  if (touchedFields.has('income') && overtimeSupplied) document.querySelector('.calc-example')?.remove();
}

// ---- State dropdown + conformity verdict ------------------------------------
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

function renderStateNote() {
  const box = $('otwStateNote');
  const sel = $('state');
  if (!box || !sel) return;
  const e = STATES[sel.value];
  if (!sel.value || !e) { box.hidden = true; box.open = false; return; }
  box.hidden = false;
  const sum = box.querySelector('summary');
  const body = box.querySelector('.otw-state-body');
  if (!e.hasWageTax) {
    sum.textContent = 'What about my state? Nothing to do';
    body.innerHTML = `<strong>${e.name}:</strong> no state income tax on wages, so the federal saving above is the whole story.`;
    return;
  }
  sum.textContent = 'What about my state?';
  const y25 = e.overtime.y2025, y26 = e.overtime.y2026;
  body.innerHTML =
    `<strong>Overtime deduction in ${e.name}:</strong> ` +
    `2025 — ${VERDICT[y25] || y25}; 2026–2028 — ${VERDICT[y26] || y26}.` +
    `<div class="otw-note">${e.note}</div>`;
}

// ---- Inline card flags ------------------------------------------------------
function otRateFlag() {
  const el = $('otwOtRateFlag');
  if (!el) return;
  const rate = money('regRate');
  const otRate = money('otRate');
  const min = rate * 1.5;
  if (rate > 0 && otRate > 0 && otRate < min - 0.004) {
    el.hidden = false;
    el.textContent =
      `Overtime usually pays at least time-and-a-half, which would be ${usdRate(min)} an hour for you. ` +
      `If ${usdRate(otRate)} is right, we count only the extra you actually get.`;
  } else {
    el.hidden = true;
  }
}

// Both income-relative checks share one most likely cause: a whole overtime
// figure typed where only the extra half belongs. Never blocking — the answer
// still computes, the doubt just travels with it.
function incomeWarning() {
  const income = money('income');
  if (income <= 0) return '';
  if (isDirect()) {
    const p = money('premium');
    // The hours that earn a premium are paid at least 1.5x, so they alone bring
    // in three times the premium. A premium above a third of total pay cannot
    // happen.
    if (p > income / 3) {
      return `Check this number: ${usd(p)} is more than a third of the ${usd(income)} you entered for the year, ` +
        `and a premium can never be that big. Overtime pays at least one and a half times your normal rate, and only the ` +
        `extra half of that is the premium, so the premium is always a third of your overtime pay or less. ` +
        `You may have typed your whole overtime pay; only the extra half counts.`;
    }
    return '';
  }
  const otRate = money('otRate');
  const hours = num('otHours');
  const otPay = otRate * hours;
  if (otRate > 0 && hours > 0 && otPay > income) {
    return `Check these: ${count(hours)} overtime hours at ${usdRate(otRate)} an hour come to ${usd(otPay)} on their own, ` +
      `more than the ${usd(income)} you entered as your pay for the whole year. Your hours, your overtime rate or your ` +
      `yearly pay needs another look.`;
  }
  return '';
}

function incomeFlag() {
  const el = $('otwIncomeFlag');
  if (!el) return;
  // While #income has the caret, money-input.js has selected the whole field, so
  // retyping 80,000 passes through 8, 80, 800 and 8,000 — each of which would
  // insert and remove this block and shift the card on every keystroke. #income
  // re-checks on blur, so nothing is skipped, only deferred to the end of the edit.
  const incomeEl = $('income');
  if (incomeEl && document.activeElement === incomeEl) return;
  const w = incomeWarning();
  el.hidden = !w;
  el.textContent = w;
}

// ---- The answer -------------------------------------------------------------
function readInputs() {
  const filingEl = document.querySelector('input[name="filing"]:checked');
  return {
    rate: money('regRate'),
    otRate: money('otRate'),
    hours: num('otHours'),
    income: money('income'),
    typedPremium: money('premium'),
    filing: filingEl ? filingEl.value : 'single',
    state: $('state') ? $('state').value : ''
  };
}

function basisOf(s) {
  const paidExtra = Math.max(0, s.otRate - s.rate) * s.hours;
  const requiredHalf = overtimePremium(s.rate, s.hours); // 0.5 x rate x hours
  return {
    otPay: s.otRate * s.hours,
    paidExtra,
    requiredHalf,
    premium: Math.min(paidExtra, requiredHalf),
    generosity: Math.max(0, paidExtra - requiredHalf)
  };
}

function zeroBenefitNote(r, direct) {
  if (r.eligibleAmount <= 0) {
    return direct
      ? 'Enter your overtime premium to see your federal tax saving.'
      : 'Fill in your normal rate, your overtime rate and your overtime hours to see your federal tax saving.';
  }
  if (r.fullyPhasedOut) {
    return 'Your income is high enough that the deduction is fully phased out, so there is nothing to deduct this year.';
  }
  return 'With these numbers there is no federal tax to save this year.';
}

function render() {
  const out = $('out');
  if (!out) return;
  const s = readInputs();
  const direct = s.typedPremium > 0;
  const b = basisOf(s);
  const eligible = direct ? s.typedPremium : b.premium;

  const r = estimate({
    kind: 'overtime', eligibleAmount: eligible, grossAnnual: s.income,
    filingStatus: s.filing, federal: OBBBA, fed: FED
  });

  const warning = incomeWarning();
  const warnBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  const benefits = r.taxSaved > 0;
  const head =
    `<p class="otw-kick">When you file your taxes next year</p>` +
    `<p class="otw-big${benefits ? '' : ' otw-zero'}">${usd(r.taxSaved)}</p>`;

  // ---- The story --------------------------------------------------------
  // ROUNDED ONCE. The labels invite the reader to add the lower rows up to the
  // top one, so they have to add up: three independent Math.rounds do not
  // ($22.75/hr x 10h renders $341 = $228 + $114). The normal-rate row is
  // therefore DERIVED by subtraction from the rounded figures, never rounded
  // on its own.
  let lead = '';
  let rows = '';
  let extraNote = '';
  if (!benefits && r.eligibleAmount <= 0) {
    lead = `<p class="otw-lead">${zeroBenefitNote(r, direct)}</p>`;
  } else if (direct) {
    lead = `<p class="otw-lead">Here is what your ${usd(r.eligibleAmount)} overtime premium does:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>The overtime premium you entered</span><span class="otw-amt">${usd(r.eligibleAmount)}</span></li>` +
      `<li><span>Taken off your federal taxable income</span><span class="otw-amt otw-free">${usd(r.deduction)}</span></li>` +
      `<li><span>Federal tax you don't pay because of it</span><span class="otw-amt otw-free">${usd(r.taxSaved)}</span></li>` +
      `</ul>`;
    // With no rate and hours there is no "employer's extra" row to make the
    // point, and this is the single most load-bearing sentence for somebody
    // typing a figure of their own.
    extraNote = `<p class="otw-note">Only the required extra half of time-and-a-half counts. If your employer pays above that, ` +
      `double time for instance, the part above the required half is taxed as usual and is not part of your premium.</p>`;
  } else {
    const otPayR = Math.round(b.otPay);
    const premR = Math.round(b.premium);
    const genR = Math.round(b.generosity);
    const normR = otPayR - premR - genR;
    lead = `<p class="otw-lead">Here is what happened inside your ${count(s.hours)} overtime hours:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>They paid you about</span><span class="otw-amt">${usd(otPayR)}</span></li>` +
      `<li><span>Your normal rate for those hours — taxed like all your pay</span><span class="otw-amt otw-taxed">${usd(normR)}</span></li>` +
      `<li><span>The required overtime "half" — the government skips tax on this</span><span class="otw-amt otw-free">${usd(premR)}</span></li>` +
      (genR > 0
        ? `<li><span>Your employer's extra, above the required half — taxed as usual</span><span class="otw-amt otw-taxed">${usd(genR)}</span></li>`
        : '') +
      `</ul>`;
  }

  // ---- The limit, named with BOTH numbers --------------------------------
  // The premium and the deductible amount stop being the same number the moment
  // a cap or the phase-out binds, and the wording that conflated them is what
  // once shipped a screen reading "$12,500, the required extra half" over a
  // $125,000 required extra half. Every sentence here names both.
  const capBinds = r.eligibleAmount > r.allowedCap;
  let capFlag = '';
  if (benefits && capBinds) {
    capFlag = `<p class="otw-flag">Heads up: ${usd(r.deduction)} of your ${usd(r.eligibleAmount)} premium is deductible. ` +
      (r.phasedOut
        ? `Your income is above the phase-out threshold, so your cap drops to ${usd(r.allowedCap)}`
        : `This deduction stops at ${usd(r.statutoryCap)} a year`) +
      `, and the rest of the premium is taxed as usual.</p>`;
  } else if (benefits && r.phasedOut && !r.fullyPhasedOut) {
    capFlag = `<p class="otw-flag">Heads up: your income is above the phase-out threshold, so your deductible cap is ` +
      `lowered to ${usd(r.allowedCap)}.</p>`;
  }

  const plain = benefits
    ? `<div class="otw-plain">Skipping federal tax on ${usd(r.deduction)} puts about ${usd(r.taxSaved)} back in your ` +
      `pocket, as a bigger refund (or a smaller bill) when you file. Social Security and Medicare still come out of ` +
      `your overtime, and your paycheck during the year does not change.</div>`
    : `<div class="otw-plain">${zeroBenefitNote(r, direct)}</div>`;

  out.innerHTML = warnBox + head + lead + rows + capFlag + plain + extraNote;

  renderStateNote();
  renderAnswerChips(s, direct, r);

  const capSpoken = capBinds && r.eligibleAmount > 0
    ? ` Your ${usd(r.eligibleAmount)} premium is limited to ${usd(r.deduction)} deductible ${r.phasedOut ? 'by the income phase-out' : 'by the yearly cap'}.`
    : '';
  announce(`Federal tax saved on your overtime premium: ${usd(r.taxSaved)}.${capSpoken}` +
    (warning ? ' Check your numbers, there is a warning above the answer.' : ''));
}

// Each chip names an answer and jumps back to the card that asked for it.
function renderAnswerChips(s, direct, r) {
  const box = $('otwAnswers');
  if (!box) return;
  const stateName = s.state && STATES[s.state] ? STATES[s.state].name : 'no state';
  const items = direct
    ? [[RATE, `${usd(r.eligibleAmount)} premium`]]
    : [[RATE, `${usdRate(s.rate)}/hr normal`], [OTRATE, `${usdRate(s.otRate)}/hr overtime`], [HOURS, `${count(s.hours)} OT hours`]];
  items.push([INCOME, `${usd(s.income)}/yr`]);
  items.push([FILING, FILING_WORDS[s.filing] || s.filing]);
  items.push([STATE, stateName]);
  box.innerHTML = items
    .map(([target, label]) => `<button type="button" data-otw-goto="${target}">${label} ✎</button>`)
    .join('');
}

// ---- Stepping ---------------------------------------------------------------
function renderProgress(path) {
  const dots = $('otwDots');
  const label = $('otwStepnum');
  const at = path.indexOf(step);
  if (dots) {
    dots.innerHTML = path.map((_, i) => `<span${i <= at ? ' class="otw-on"' : ''}></span>`).join('');
  }
  if (label) {
    label.textContent = step === RESULT ? 'Your answer' : `Step ${at + 1} of ${path.length - 1}`;
  }
}

function focusCard(card) {
  if (!card) return;
  let target = null;
  if (Number(card.dataset.step) === FILING) {
    target = card.querySelector('input[name="filing"]:checked') || card.querySelector('input[name="filing"]');
  } else if (Number(card.dataset.step) !== RESULT) {
    // Only a control that is actually on screen: #premium lives inside a closed
    // <details> and must not steal focus from the rate box in front of it.
    target = [...card.querySelectorAll('.otw-in')].find((el) => el.offsetParent !== null) || null;
  }
  if (!target) target = card.querySelector('.otw-q');
  if (!target) return;
  try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
}

function show(n, withFocus = true) {
  const direct = isDirect();
  const path = pathOf(direct);
  let target = n;
  // A step that is not on this visitor's path (the overtime-rate and hours cards
  // once a premium is typed) hands off to the next step that is.
  for (let guard = 0; !path.includes(target) && guard <= RESULT; guard++) target = nextOf(target, direct);
  step = target;
  let active = null;
  cards.forEach((c) => {
    const on = Number(c.dataset.step) === step;
    c.classList.toggle('otw-on', on);
    if (on) active = c;
  });
  renderProgress(path);
  if (step === RESULT) render();
  if (withFocus) focusCard(active);
}

// The overtime rate follows 1.5x the normal rate until the visitor edits it
// themselves, and then it stops following: their number outranks our guess for
// the rest of the session.
function syncOtRate() {
  if (otRateTouched) return;
  const el = $('otRate');
  if (!el) return;
  const v = Math.round(money('regRate') * 1.5 * 100) / 100;
  el.value = v > 0 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
}

function init() {
  const stage = $('otWizard');
  if (!stage) return;
  cards = [...stage.querySelectorAll('.otw-card')].sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step));
  initMoneyInputs();
  fillStates();

  // Only now does the stack become a stepped wizard: everything above ships
  // visible so a crawler, a blocked script or a no-JS reader gets the whole form.
  stage.dataset.js = 'on';

  stage.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !stage.contains(t)) return;
    if (t.classList.contains('otw-next')) { show(nextOf(step, isDirect())); return; }
    if (t.classList.contains('otw-back')) { show(prevOf(step, isDirect())); return; }
    if (t.classList.contains('otw-skip')) {
      const sel = $('state');
      if (sel) sel.value = '';
      show(RESULT);
      return;
    }
    if (t.dataset.otwHours) {
      const el = $('otHours');
      if (el) { el.value = t.dataset.otwHours; noteFieldTouched('otHours'); incomeFlag(); render(); }
      return;
    }
    if (t.dataset.otwGoto !== undefined) { show(Number(t.dataset.otwGoto)); return; }
    if (t.id === 'otwRestart') { show(RATE); }
  });

  // Enter advances, except on a <summary> (where it opens the helper) and on the
  // answer card (where there is nothing to advance to).
  stage.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.tagName === 'SUMMARY' || e.target.tagName === 'BUTTON') return;
    if (step === RESULT) return;
    e.preventDefault();
    show(nextOf(step, isDirect()));
  });

  const recompute = () => { otRateFlag(); incomeFlag(); render(); };

  $('regRate')?.addEventListener('input', () => { syncOtRate(); recompute(); });
  $('otRate')?.addEventListener('input', (e) => { if (e.isTrusted) otRateTouched = true; recompute(); });
  ['otHours', 'income', 'premium'].forEach((id) => $(id)?.addEventListener('input', recompute));
  $('income')?.addEventListener('blur', recompute);
  $('state')?.addEventListener('change', () => { renderStateNote(); render(); });
  document.querySelectorAll('input[name="filing"]').forEach((el) => el.addEventListener('change', () => {
    render();
    // Choosing an option IS the answer to this card, so it moves on by itself.
    if (step === FILING) show(nextOf(FILING, isDirect()));
  }));

  // isTrusted filters programmatic writes: only somebody typing their own number
  // retires the example label.
  ['income', 'regRate', 'otRate', 'otHours', 'premium'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    ['input', 'change'].forEach((evt) => el.addEventListener(evt, (e) => { if (e.isTrusted) noteFieldTouched(id); }));
  });

  otRateFlag();
  incomeFlag();
  // Render the answer once up front rather than only on arrival at the last
  // card: #out is the page's [data-tb-result] anchor, and an empty one leaves
  // report-widget.js with nothing to attach its "Report a wrong result" link to.
  render();
  show(RATE, false); // never steal focus on load
  announceReady = true;
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
