// tips-tax-calculator.js — estimates the OBBBA "no tax on tips" (IRC §224)
// federal deduction and tax saving. All logic client-side; nothing uploaded.
import { estimate } from '/assets/obbba-deduction.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;
const STATES = window.__STATES__ || {};

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

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

function fillStates() {
  const sel = $('state');
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
  const slug = $('state').value;
  const e = STATES[slug];
  // An empty verdict box used to hide; personas skipped the unlabelled select
  // and left still asking "does my state tax tips?". The box now carries the
  // honest general answer (moved verbatim from the prose below) in the very
  // spot the specific one will appear once a state is picked.
  if (!slug || !e) {
    box.hidden = false;
    box.innerHTML = '<span class="muted-small">This deduction is federal. Whether it also lowers your <em>state</em> income tax depends on your state — many states do not conform, some conform only from 2026, and nine states have no wage income tax at all. Pick your state above to see how it treats them.</span>';
    return;
  }
  box.hidden = false;
  if (!e.hasWageTax) {
    box.innerHTML = `<strong>${e.name}:</strong> no state income tax — your federal saving is the whole benefit.`;
    return;
  }
  const y25 = e.tips.y2025, y26 = e.tips.y2026;
  box.innerHTML =
    `<strong>Tips deduction in ${e.name}:</strong> ` +
    `2025 — ${VERDICT[y25] || y25}; 2026–2028 — ${VERDICT[y26] || y26}.` +
    `<div class="obbba-note">${e.note}</div>`;
}

// Plain-words reason when there's $0 federal tax saved.
function zeroBenefitNote(r) {
  if (r.eligibleAmount <= 0) {
    return 'Enter your tips above to see your federal tax saving.';
  }
  if (r.fullyPhasedOut) {
    return 'Your income is high enough that the deduction is fully phased out, so there is nothing to deduct this year.';
  }
  return 'With these inputs there is no federal tax to save this year.';
}

function render() {
  const income = moneyValue($('income'));
  const tips = moneyValue($('tips'));
  const filing = $('filing').value;

  const r = estimate({ kind: 'tips', eligibleAmount: tips, grossAnnual: income, filingStatus: filing, federal: OBBBA, fed: FED });

  const capNote = r.eligibleAmount > r.statutoryCap
    ? ` <span class="obbba-note">(capped at ${usd(r.statutoryCap)})</span>`
    : '';
  const phaseNote = r.phasedOut
    ? `<div class="line"><span>Reduced by income phase-out</span><span class="num phaseout-flag">${r.fullyPhasedOut ? 'fully phased out' : 'yes — cap lowered to ' + usd(r.allowedCap)}</span></div>`
    : '';

  // ---- Answer-first summary (stat card) --------------------------------
  const benefits = r.taxSaved > 0;
  const statValue = benefits ? usd(r.taxSaved) : '$0';
  const statSub = benefits
    ? `${usd(r.deduction)} of your tips come off the income you are taxed on.`
    : zeroBenefitNote(r); // the "why" stays visible, never hidden in details
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Federal tax saved on your tips</p>` +
      `<p class="stat-value${benefits ? '' : ' is-zero'}">${statValue}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- Reported vs deductible comparison bars (decorative) --------------
  const barMax = Math.max(r.eligibleAmount, r.deduction, 1);
  const reportedPct = Math.min(100, (r.eligibleAmount / barMax) * 100).toFixed(1);
  const dedPct = Math.min(100, (r.deduction / barMax) * 100).toFixed(1);
  const compareBars = r.eligibleAmount > 0
    ? `<div class="compare-bars" aria-hidden="true">` +
        `<div class="cb-row"><span>Tips reported ${usd(r.eligibleAmount)}</span><span class="cb-track"><span class="cb-fill cb-over" style="width:${reportedPct}%"></span></span></div>` +
        `<div class="cb-row"><span>Deductible ${usd(r.deduction)}</span><span class="cb-track"><span class="cb-fill" style="width:${dedPct}%"></span></span></div>` +
      `</div>`
    : '';

  // ---- One headline caveat (phase-down) shown OUTSIDE the details -------
  const headlineCaveat = (benefits && r.phasedOut && !r.fullyPhasedOut)
    ? `<div class="obbba-note phaseout-flag">Heads up: your income is above the phase-out threshold, so your deductible cap is lowered to ${usd(r.allowedCap)} (see the breakdown for the math).</div>`
    : '';

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  // Label fix: this row previously mislabeled the taxSaved/deduction ratio
  // as your headline marginal rate; it's really the effective rate the
  // deduction was taxed at (it can straddle a bracket line). Matches SALT's
  // calculator wording.
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      `<div class="line"><span>Tips you entered</span><span class="num">${usd(r.eligibleAmount)}${capNote}</span></div>` +
      phaseNote +
      `<div class="line"><span>Deductible amount</span><span class="num">${usd(r.deduction)}</span></div>` +
      `<div class="line big"><span>Estimated federal tax saved</span><span class="num">${usd(r.taxSaved)}</span></div>` +
      `<div class="line"><span>Effective federal rate on this deduction</span><span class="num">${pct(r.marginalRate)}</span></div>` +
      // Moved verbatim off the end of the .takeaway below: it answers "so when do I
      // see this?", which is a second question, and the takeaway only has room for
      // the first one.
      `<div class="obbba-note">Your paychecks and their withholding don't change now.</div>` +
    `</details>`;

  // Out of the collapsed panel on purpose: both benchmark personas said that
  // with this sentence hidden they'd have left believing tips were tax-free
  // outright. It rides beside the good news, not behind a tap.
  const ficaNote =
    `<div class="obbba-note">Social Security and Medicare (FICA) still apply to your tips — the deduction lowers federal income tax only, claimed when you file. You must work in a customarily-tipped occupation.</div>`;

  // Preserve the user's open/closed choice across re-renders (default closed).
  const out = $('out');
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  out.innerHTML =
    statCard +
    compareBars +
    headlineCaveat +
    ficaNote +
    derivation +
    `<div class="takeaway">In plain terms: this lands as a bigger refund (or a smaller bill) when you file next year.</div>`;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;

  renderState();

  announce(`Federal tax saved on your tips: ${statValue}`);
}

function init() {
  initMoneyInputs();
  fillStates();
  ['income', 'tips', 'filing', 'state'].forEach((id) => {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  // A tap on a prefilled example field selects the whole value, so typing
  // replaces the example instead of appending digits to it.
  ['income', 'tips'].forEach((id) => $(id).addEventListener('focus', (ev) => ev.target.select()));
  const form = $('tipsForm');
  ['input', 'change'].forEach((evt) => form?.addEventListener(evt, clearExampleNote, { once: true }));
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
