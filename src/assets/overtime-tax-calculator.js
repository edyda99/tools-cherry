// overtime-tax-calculator.js — estimates the OBBBA "no tax on overtime" (IRC §225)
// federal deduction and tax saving. All logic client-side; nothing uploaded.
//
// SCOPE, since 2026-08-01: this file now serves the /embed/ build ONLY. The full
// /overtime-tax-calculator/ page was rewritten as a card-by-card wizard and runs
// src/assets/overtime-wizard.js instead. Everything below still reads every field
// with an optional guard, so the code paths that only the old full page had —
// the qKnown radios, the [data-reveal] wrapper check in knownAnswer(), the
// #outStatus announcer — simply return their "not on this page" branch on the
// embed. They are kept rather than deleted because the embed is a published
// iframe that was last fixed at f23326e, and pruning dead branches out of a
// shipped widget buys nothing and risks the one thing that must not change.
// The embed's markup, and only the embed's markup, is the contract for this file.
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
// 1,200 never sits next to a typed 1,200 as a bare "1200". Fractions are KEPT:
// the math runs on 500.5 hours, so quoting it back as "501" would be us naming
// a number the visitor did not type and did not get an answer for.
const count = (n) => Math.max(0, n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
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
// as an example until the visitor has supplied EVERY number the answer is built
// from. Clearing on the first edit to any one of them was the bug: somebody who
// typed only their overtime hours got their own label on an answer still made of
// our invented income and our invented hourly rate.
// The answer needs income, plus either a typed premium or BOTH rate and hours,
// so those are the sets that have to be complete. Erring towards "still an
// example" is the safe direction: it understates our confidence in the visitor's
// numbers, where the other way round overstates it.
const touchedFields = new Set();
function clearExampleNote() {
  document.querySelector('.calc-example')?.remove();
}
function noteFieldTouched(id) {
  touchedFields.add(id);
  const overtimeSupplied = touchedFields.has('premium') ||
    (touchedFields.has('regRate') && touchedFields.has('otHours'));
  if (touchedFields.has('income') && overtimeSupplied) clearExampleNote();
}
// Separate from the label above, and deliberately narrower: true once the
// visitor has typed a rate or hours of their own, which is what makes the
// derived premium a number worth checking a typed premium against. Without it
// the cross-check would compare somebody's real figure to OUR example rate and
// hours and accuse them of being wrong.
let otBasisTouched = false;

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
  if (Array.prototype.some.call(group, (el) => el.checked && el.value === 'yes')) return true;
  // DEGRADED-SCRIPT PATH. A "No" only means "ignore the premium box" while
  // question-flow.js is alive to hide that box and park it at 0. Its wrapper
  // ships VISIBLE by design, and question-flow's own catch block re-shows every
  // wrapper without un-parking, so a wrapper still on screen under a No means the
  // question was never wired up. The premium field is then editable, and treating
  // it as absent would silently discard whatever is typed into it — the exact
  // inverse of the bug this file was rewritten to remove. Fall back to the
  // no-radio rule (direct iff premium > 0) instead.
  const host = document.querySelector('[data-reveal="qKnown"]');
  if (host && !host.hidden) return null;
  return false;
}

function render() {
  const income = money('income');
  const filing = raw('filing', 'single') || 'single';

  // ---- RENDER PRECEDENCE ------------------------------------------------
  // Direct mode when the qKnown radios exist AND "yes" is checked AND
  // premium > 0 -> eligible = the typed premium; otherwise derived mode ->
  // eligible = overtimePremium(rate, hours) = 0.5 * rate * hours. On pages
  // with no qKnown radios (the embed, and the no-JS-then-JS edge) the rule is:
  // direct mode iff premium > 0, else derived. knownAnswer() also returns that
  // no-radio null when the radios exist but their wrapper is still on screen
  // under a No, which only happens if question-flow.js never ran; see there.
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
  // Impossibilities and contradictions, not style notes, and they share one
  // most-likely cause: a whole overtime figure typed where only the extra half
  // belongs. We still compute and still show the answer; the warning sits above
  // it so the number is never read without the doubt attached. One at a time.
  const otPay = 1.5 * rate * hours; // what those hours pay in full, at time-and-a-half
  // Suppress the two income-relative checks while the income box has the caret.
  // money-input.js selects the whole field on entry, so retyping 80,000 passes
  // through 8, 80, 800 and 8,000, and each of those would insert and then remove
  // a warning block above the answer, shifting the panel on every keystroke.
  // #income re-renders on blur, so the check still runs, once, on the number
  // they meant. Nothing is skipped, only deferred to the end of the edit.
  const incomeEl = $('income');
  const incomeFocused = !!incomeEl && document.activeElement === incomeEl;
  // A typed premium that contradicts the rate and hours sitting on the same
  // screen. Both numbers are named, and so is which one the answer used: the
  // page holds three inputs that all describe the same overtime, and silently
  // preferring one of them is how a double-time worker gets told his whole
  // premium is deductible. Only checked once the visitor has typed a rate or
  // hours of their own (see otBasisTouched).
  const basisComparable = otBasisTouched && rate > 0 && hours > 0 && derivedPremium > 0;
  const basisMismatch = direct && basisComparable &&
    Math.abs(typedPremium - derivedPremium) > Math.max(100, 0.1 * derivedPremium);
  let warning = '';
  if (direct && !incomeFocused && income > 0 && typedPremium > income / 3) {
    // The hours that earn a premium are paid 1.5x, so they alone bring in three
    // times the premium. A premium above a third of total pay cannot happen.
    warning =
      `Check this number: ${usd(typedPremium)} is more than a third of the ${usd(income)} you entered for the year, ` +
      `and a premium can never be that big. Overtime pays one and a half times your normal rate, and only the extra ` +
      `half of that is the premium, so the premium is always a third of your overtime pay or less. ` +
      `You may have typed your whole overtime pay; only the extra half counts.`;
  } else if (basisMismatch) {
    warning =
      `Check this number: at ${usdRate(rate)} an hour, ${count(hours)} overtime hours make the required extra half ` +
      `${usd(derivedPremium)}, not the ${usd(typedPremium)} you typed. If ${usd(typedPremium)} is your whole overtime pay, ` +
      `or your pay at double time, only the required half of it counts. The answer below uses the ${usd(typedPremium)} ` +
      `you typed and ignores your rate and hours.`;
  } else if (!direct && !incomeFocused && income > 0 && otPay > income) {
    warning =
      `Check these two: ${count(hours)} overtime hours at ${usdRate(rate)} an hour come to ${usd(otPay)} of overtime pay on their own, ` +
      `more than the ${usd(income)} you entered as your pay for the whole year. Your hours, your rate or your yearly pay needs another look.`;
  }
  const warningBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  // The premium is bigger than the law will let this visitor deduct — either the
  // flat yearly cap or the cap after the income phase-out lowered it. EVERY
  // sentence that names a premium and a deductible amount keys off this, because
  // the two numbers stop being the same number the moment it is true, and the
  // wording that conflated them is what shipped a screen reading "$12,500, the
  // required extra half" over a $125,000 required extra half.
  const capBinds = r.eligibleAmount > r.allowedCap;
  const capReason = r.phasedOut
    ? `your income lowers the cap to ${usd(r.allowedCap)}`
    : `this deduction stops at ${usd(r.statutoryCap)} a year`;
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
  // And never the deductible amount described AS the required extra half: once
  // the cap or the phase-out binds they are different numbers, and the qualifier
  // is the whole sentence. Both branches therefore name the premium AND the
  // deductible part whenever those two differ.
  const statSubEarned = direct
    ? (capBinds
      ? `Your deductible overtime premium is ${usd(r.deduction)} of your ${usd(r.eligibleAmount)} premium, because ${capReason}.`
      : `Your deductible overtime premium is ${usd(r.deduction)} of your ${usd(r.eligibleAmount)} premium.`)
    : (capBinds
      ? `The required extra half on ${count(hours)} overtime hours is ${usd(r.eligibleAmount)}. Only ${usd(r.deduction)} of it is deductible, because ${capReason}.`
      : `Your deductible overtime premium is ${usd(r.deduction)}, the required extra half on ${count(hours)} overtime hours.`);
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

  // ---- The limit caveat, shown OUTSIDE the collapsed details ------------
  // The "(capped at $12,500)" row lives inside <details>, which is closed by
  // default, so a visitor who reads only the answer never sees the word cap. Any
  // time the limit actually costs them something it has to be on the no-click
  // surface, next to the number it explains.
  let headlineCaveat = '';
  if (benefits && capBinds) {
    headlineCaveat =
      `<div class="obbba-note${r.phasedOut ? ' phaseout-flag' : ''}">Heads up: ${usd(r.deduction)} of your ` +
      `${usd(r.eligibleAmount)} premium is deductible. ` +
      (r.phasedOut
        ? `Your income is above the phase-out threshold, so your cap drops to ${usd(r.allowedCap)}`
        : `This deduction stops at ${usd(r.statutoryCap)} a year`) +
      `, and the rest of the premium is taxed as usual (see the breakdown for the math).</div>`;
  } else if (benefits && r.phasedOut && !r.fullyPhasedOut) {
    headlineCaveat =
      `<div class="obbba-note phaseout-flag">Heads up: your income is above the phase-out threshold, so your deductible cap is lowered to ${usd(r.allowedCap)} (see the breakdown for the math).</div>`;
  }

  // ---- What is taxable and what is not ----------------------------------
  // The question every visitor actually arrives with. The three-row split needs
  // rate AND hours, so it can only be shown on the derived path; a typed premium
  // alone does not say what the other two thirds of that overtime pay were.
  // ROUNDED ONCE. The labels invite the reader to add rows 2 and 3 up to row 1,
  // so they have to add up: three independent Math.rounds do not (22.75/hr x 10h
  // renders $341 = $228 + $114). The normal-rate row is therefore DERIVED by
  // subtraction from the two rounded figures rather than rounded on its own.
  const otPayR = Math.round(otPay);
  const premiumR = Math.round(derivedPremium);
  const normalR = otPayR - premiumR;
  // The row for the required extra half claims deductibility ONLY when nothing
  // reduces it. When the cap or the phase-out binds, this block sits above the
  // collapsed details and would otherwise be the visible surface asserting the
  // larger, undeducted number as "the deductible part" while the stat card two
  // lines up said something smaller. So the claim moves to its own row, carrying
  // the figure that survives the limit.
  const splitRows = (!direct && rate > 0 && hours > 0)
    ? `<div class="obbba-note">How those ${count(hours)} overtime hours split up:</div>` +
      `<div class="line"><span>Total overtime pay, at the federal time-and-a-half minimum</span><span class="num">${usd(otPayR)}</span></div>` +
      `<div class="line"><span>Paid at your normal rate — taxed as usual</span><span class="num">${usd(normalR)}</span></div>` +
      `<div class="line"><span>The required extra half${capBinds ? '' : ' — the deductible part'}</span><span class="num">${usd(premiumR)}</span></div>` +
      (capBinds
        ? `<div class="line"><span>Deductible after ${r.phasedOut ? 'the income phase-out' : `the ${usd(r.statutoryCap)} yearly limit`}</span><span class="num">${usd(r.deduction)}</span></div>`
        : '') +
      `<div class="obbba-note">If your employer pays above the required half, double time for instance, that extra is taxed as usual and is not counted here.</div>`
    : '';
  // The double-time rule is the single most load-bearing sentence on the page for
  // somebody typing a premium, and gating the whole block on !direct deleted it
  // at exactly the moment a double-time worker types twice the right number.
  const directBasisNote = direct
    ? `<div class="obbba-note">Only the required extra half of time-and-a-half is deductible. If your employer pays above that, double time for instance, the part above the required half is taxed as usual and is not part of your premium.</div>`
    : '';
  const split = direct ? directBasisNote : splitRows;

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

  // The compare bars are the only other place the cap is visible and they are
  // aria-hidden, so without this a screen-reader user got the dollar figure and
  // no hint that a much larger premium had been cut down to reach it. The
  // warning is announced for the same reason: it is rendered inside #out, which
  // is not a live region.
  const capSpoken = capBinds && r.eligibleAmount > 0
    ? ` Your ${usd(r.eligibleAmount)} premium is limited to ${usd(r.deduction)} deductible ${r.phasedOut ? 'by the income phase-out' : 'by the yearly cap'}.`
    : '';
  announce(`Federal tax saved on your overtime premium: ${statValue}.${capSpoken}${warning ? ' Check your numbers, there is a warning above the answer.' : ''}`);
}

function init() {
  initMoneyInputs();
  fillStates();
  ['income', 'premium', 'regRate', 'otHours', 'filing', 'state'].forEach((id) => {
    const el = $(id);
    if (!el) return; // the /embed/ build ships a subset of these
    // otBasisTouched is set HERE rather than alongside the example-note
    // bookkeeping below, so it is already true by the time this same event's
    // render() reads it. Bound in a later listener it would be one keystroke
    // behind, and the typed-premium cross-check would miss the edit that
    // triggered it.
    const onEdit = (e) => {
      if (e.isTrusted && (id === 'regRate' || id === 'otHours')) otBasisTouched = true;
      render();
    };
    el.addEventListener('input', onEdit);
    el.addEventListener('change', onEdit);
  });
  // Answering the premium question flips the whole render precedence, so it has
  // to recompute. question-flow.js does dispatch input on #premium when it parks
  // or restores the field, but only when the value actually changes, so this
  // listener is what makes the mode switch unconditional.
  document.querySelectorAll('input[name="qKnown"]').forEach((el) => el.addEventListener('change', render));

  // The two income-relative warnings are held back while #income has the caret
  // (see render), so the field has to recompute when it loses focus even if its
  // value is unchanged since the last change event.
  $('income')?.addEventListener('blur', render);

  // The example label goes away only once EVERY number the answer is built from
  // has been typed by the visitor (see noteFieldTouched). Clearing it on the
  // first edit to any one field presented an answer still made of our example
  // income and our example hourly rate as the visitor's own.
  // isTrusted filters out question-flow.js's synthetic park/restore events: a
  // programmatic write is not somebody typing their own number.
  ['income', 'regRate', 'otHours', 'premium'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    ['input', 'change'].forEach((evt) => el.addEventListener(evt, (e) => {
      if (e.isTrusted) noteFieldTouched(id);
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
