// overtime-tax-calculator.js — estimates the OBBBA "no tax on overtime" (IRC §225)
// federal deduction and tax saving. All logic client-side; nothing uploaded.
import { estimate, overtimePremium } from '/assets/obbba-deduction.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;
const STATES = window.__STATES__ || {};

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';
// Counts (hours) get the same thousands separators money does, so a rendered
// 1,200 never sits next to a typed 1,200 as a bare "1200".
const count = (n) => Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
// Yearly totals round to whole dollars (usd above), but an HOURLY rate carries
// cents: a typed 22.50 must not be quoted back as "$23 an hour".
const usdRate = (n) => {
  const v = Math.max(0, n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

// EVERY field read below is optional-guarded. This one script serves both the
// full page and the /embed/ build, which ships a smaller form, so a missing
// element is a normal state and never an exception.
const money = (id) => { const el = $(id); return el ? moneyValue(el) : 0; };
const raw = (id, fallback) => { const el = $(id); return el ? el.value : fallback; };

// Non-money (count) fields still go through a plain parseFloat.
function num(id) {
  const el = $(id);
  const v = el ? parseFloat(el.value) : NaN;
  return Number.isFinite(v) ? v : 0;
}

// The page loads with example inputs nobody typed, so the answer is labelled
// as an example until the visitor edits a field. Optional-chained: the /embed/
// build of this calculator has no such note.
function clearExampleNote() {
  document.querySelector('.calc-example')?.remove();
}

// #outStatus is the ONLY live region on the page. #out rewrites its whole
// innerHTML on every keystroke, so leaving aria-live on it queued the entire
// result panel for re-reading each character. Instead we debounce one plain
// sentence, and only for user-driven recomputes (never the load render).
let statusTimer = null;
let announceReady = false;
function announce(text) {
  if (!announceReady) return;
  const el = $('outStatus');
  if (!el) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = text; }, 500);
}

// Populate the state dropdown from the conformity data (sorted by name).
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

function renderState() {
  const box = $('stateVerdict');
  const sel = $('state');
  if (!box || !sel) return;
  const slug = sel.value;
  const e = STATES[slug];
  if (!slug || !e) { box.hidden = true; return; }
  box.hidden = false;
  if (!e.hasWageTax) {
    box.innerHTML = `<strong>${e.name}:</strong> no state income tax — your federal saving is the whole benefit.`;
    return;
  }
  const y25 = e.overtime.y2025, y26 = e.overtime.y2026;
  box.innerHTML =
    `<strong>Overtime deduction in ${e.name}:</strong> ` +
    `2025 — ${VERDICT[y25] || y25}; 2026–2028 — ${VERDICT[y26] || y26}.` +
    `<div class="obbba-note">${e.note}</div>`;
}

// Plain-words reason when there's $0 federal tax saved.
function zeroBenefitNote(r, saidTheyKnow) {
  if (r.eligibleAmount <= 0) {
    // Point at the box this visitor said they would use. Keyed off the ANSWER,
    // not off the render mode: direct mode requires a premium above 0, so at
    // this point somebody who answered Yes has an empty premium box, and
    // telling them to fill in rate and hours instead would be the wrong box.
    return saidTheyKnow
      ? 'Enter your overtime premium above to see your federal tax saving.'
      : 'Fill in your normal hourly rate and your overtime hours above to see your federal tax saving.';
  }
  if (r.fullyPhasedOut) {
    return 'Your income is high enough that the deduction is fully phased out, so there is nothing to deduct this year.';
  }
  return 'With these inputs there is no federal tax to save this year.';
}

// True when the "do you already know your premium" question is answered Yes,
// false when it is answered No, and null on a page that ships no such question
// (the /embed/ build). Kept separate from the precedence rule below so the
// three-state answer reads as three states.
function knownAnswer() {
  const group = document.querySelectorAll('input[name="qKnown"]');
  if (!group.length) return null;
  return Array.prototype.some.call(group, (el) => el.checked && el.value === 'yes');
}

function render() {
  const income = money('income');
  const filing = raw('filing', 'single') || 'single';

  // ---- RENDER PRECEDENCE ------------------------------------------------
  // Direct mode when the qKnown radios exist AND "yes" is checked AND
  // premium > 0 -> eligible = the typed premium; otherwise derived mode ->
  // eligible = overtimePremium(rate, hours) = 0.5 * rate * hours. On pages
  // with no qKnown radios (the embed, and the no-JS-then-JS edge) the rule is:
  // direct mode iff premium > 0, else derived.
  // The two modes NEVER write into each other's boxes. The old code silently
  // overwrote #premium from rate x hours, which locked the field and put a
  // number the visitor never typed under a label that called it theirs.
  const rate = money('regRate');
  const hours = num('otHours');
  const typedPremium = money('premium');
  const known = knownAnswer();
  const direct = known === null ? typedPremium > 0 : (known === true && typedPremium > 0);
  const derivedPremium = overtimePremium(rate, hours);
  const premium = direct ? typedPremium : derivedPremium;

  const r = estimate({ kind: 'overtime', eligibleAmount: premium, grossAnnual: income, filingStatus: filing, federal: OBBBA, fed: FED });

  // ---- Input sanity warnings (visible, and never blocking) --------------
  // Both are impossibilities rather than style notes, and both have the same
  // most-likely cause: a whole overtime figure typed where only the extra half
  // belongs. We still compute and still show the answer; the warning sits above
  // it so the number is never read without the doubt attached.
  const otPay = 1.5 * rate * hours; // what those hours pay in full, at time-and-a-half
  let warning = '';
  if (direct && income > 0 && typedPremium > income / 3) {
    // The hours that earn a premium are paid 1.5x, so they alone bring in three
    // times the premium. A premium above a third of total pay cannot happen.
    warning =
      `Check this number: ${usd(typedPremium)} is more than a third of the ${usd(income)} you entered for the year, ` +
      `which the premium can never be — the overtime hours themselves pay three times their own premium. ` +
      `You may have typed your whole overtime pay; only the extra half counts.`;
  } else if (!direct && income > 0 && otPay > income) {
    warning =
      `Check these two: ${count(hours)} overtime hours at ${usdRate(rate)} an hour come to ${usd(otPay)} of overtime pay on their own, ` +
      `more than the ${usd(income)} you entered as your pay for the whole year. Your hours, your rate or your yearly pay needs another look.`;
  }
  const warningBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  const capNote = r.eligibleAmount > r.statutoryCap
    ? ` <span class="obbba-note">(capped at ${usd(r.statutoryCap)})</span>`
    : '';
  const phaseNote = r.phasedOut
    ? `<div class="line"><span>Reduced by income phase-out</span><span class="num phaseout-flag">${r.fullyPhasedOut ? 'fully phased out' : 'yes — cap lowered to ' + usd(r.allowedCap)}</span></div>`
    : '';

  // ---- Answer-first summary (stat card) --------------------------------
  // The headline number the user came for, surfaced above the derivation.
  const benefits = r.taxSaved > 0;
  const statValue = benefits ? usd(r.taxSaved) : '$0';
  // Never "the $X you earned": in derived mode nobody typed that figure, and in
  // direct mode calling it earnings is what encouraged whole-overtime-pay entry.
  const statSubEarned = direct
    ? `Your deductible overtime premium is ${usd(r.deduction)} of your ${usd(r.eligibleAmount)} premium.`
    : `Your deductible overtime premium is ${usd(r.deduction)}, the required extra half on ${count(hours)} overtime hours.`;
  const statSub = benefits
    ? statSubEarned
    : zeroBenefitNote(r, known === true); // the "why" stays visible, never hidden in details
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Federal tax saved on your overtime premium</p>` +
      `<p class="stat-value${benefits ? '' : ' is-zero'}">${statValue}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- Earned vs deductible comparison bars (decorative, so aria-hidden) -
  const barMax = Math.max(r.eligibleAmount, r.deduction, 1);
  const earnedPct = Math.min(100, (r.eligibleAmount / barMax) * 100).toFixed(1);
  const dedPct = Math.min(100, (r.deduction / barMax) * 100).toFixed(1);
  const compareBars = r.eligibleAmount > 0
    ? `<div class="compare-bars" aria-hidden="true">` +
        `<div class="cb-row"><span>Premium earned ${usd(r.eligibleAmount)}</span><span class="cb-track"><span class="cb-fill cb-over" style="width:${earnedPct}%"></span></span></div>` +
        `<div class="cb-row"><span>Deductible ${usd(r.deduction)}</span><span class="cb-track"><span class="cb-fill" style="width:${dedPct}%"></span></span></div>` +
      `</div>`
    : '';

  // ---- One headline caveat (phase-down) shown OUTSIDE the details -------
  const headlineCaveat = (benefits && r.phasedOut && !r.fullyPhasedOut)
    ? `<div class="obbba-note phaseout-flag">Heads up: your income is above the phase-out threshold, so your deductible cap is lowered to ${usd(r.allowedCap)} (see the breakdown for the math).</div>`
    : '';

  // ---- What is taxable and what is not (derived mode only) --------------
  // The question every visitor actually arrives with. It needs rate AND hours,
  // so it can only be shown on the derived path; a typed premium alone does not
  // say what the other two thirds of that overtime pay were.
  const split = (!direct && rate > 0 && hours > 0)
    ? `<div class="obbba-note">How those ${count(hours)} overtime hours split up:</div>` +
      `<div class="line"><span>Total overtime pay, at time-and-a-half</span><span class="num">${usd(otPay)}</span></div>` +
      `<div class="line"><span>Paid at your normal rate — taxed as usual</span><span class="num">${usd(rate * hours)}</span></div>` +
      `<div class="line"><span>The required extra half — the deductible part</span><span class="num">${usd(derivedPremium)}</span></div>` +
      `<div class="obbba-note">If your employer pays above the required half, double time for instance, that extra is taxed as usual and is not counted here.</div>`
    : '';

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  // Label fix: this row previously mislabeled the taxSaved/deduction ratio
  // as your headline marginal rate; it's really the effective rate the
  // deduction was taxed at (it can straddle a bracket line). Matches SALT's
  // calculator wording.
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      `<div class="line"><span>Your overtime premium</span><span class="num">${usd(r.eligibleAmount)}${capNote}</span></div>` +
      phaseNote +
      `<div class="line"><span>Deductible amount</span><span class="num">${usd(r.deduction)}</span></div>` +
      `<div class="line big"><span>Estimated federal tax saved</span><span class="num">${usd(r.taxSaved)}</span></div>` +
      `<div class="line"><span>Effective federal rate on this deduction</span><span class="num">${pct(r.marginalRate)}</span></div>` +
      `<div class="obbba-note">Social Security and Medicare (FICA) still apply to this overtime — the deduction lowers federal income tax only, claimed when you file.</div>` +
    `</details>`;

  // Preserve the user's open/closed choice across re-renders (default closed).
  const out = $('out');
  if (!out) { renderState(); return; }
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  out.innerHTML =
    warningBox +
    statCard +
    compareBars +
    headlineCaveat +
    split +
    derivation +
    `<div class="takeaway">In plain terms: this lands as a bigger refund (or a smaller bill) when you file next year — your weekly paycheck and its withholding don't change now.</div>`;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;

  renderState();

  announce(`Federal tax saved on your overtime premium: ${statValue}`);
}

function init() {
  initMoneyInputs();
  fillStates();
  ['income', 'premium', 'regRate', 'otHours', 'filing', 'state'].forEach((id) => {
    const el = $(id);
    if (!el) return; // the /embed/ build ships a subset of these
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  // Answering the premium question flips the whole render precedence, so it has
  // to recompute. question-flow.js does dispatch input on #premium when it parks
  // or restores the field, but only when the value actually changes, so this
  // listener is what makes the mode switch unconditional.
  document.querySelectorAll('input[name="qKnown"]').forEach((el) => el.addEventListener('change', render));

  // The example label goes away when the visitor edits one of the OVERTIME
  // numbers the example is made of. Editing income or filing status alone used
  // to strip it while the answer still ran on our example rate and hours, which
  // presented example figures as the visitor's own.
  // isTrusted filters out question-flow.js's synthetic park/restore events: a
  // programmatic write is not somebody typing their own number.
  ['regRate', 'otHours', 'premium'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    ['input', 'change'].forEach((evt) => el.addEventListener(evt, (e) => {
      if (e.isTrusted) clearExampleNote();
    }));
  });
  render();
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
