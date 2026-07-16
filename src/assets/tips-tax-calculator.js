// tips-tax-calculator.js — estimates the OBBBA "no tax on tips" (IRC §224)
// federal deduction and tax saving. All logic client-side; nothing uploaded.
import { estimate } from '/assets/obbba-deduction.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const OBBBA = window.__OBBBA__;
const FED = window.__FED__;
const STATES = window.__STATES__ || {};

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

function num(id) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : 0;
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
  if (!slug || !e) { box.hidden = true; return; }
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

function render() {
  const income = num('income');
  const tips = num('tips');
  const filing = $('filing').value;

  const r = estimate({ kind: 'tips', eligibleAmount: tips, grossAnnual: income, filingStatus: filing, federal: OBBBA, fed: FED });

  const capNote = r.eligibleAmount > r.statutoryCap
    ? ` <span class="obbba-note">(capped at ${usd(r.statutoryCap)})</span>`
    : '';
  const phaseNote = r.phasedOut
    ? `<div class="line"><span>Reduced by income phase-out</span><span class="num phaseout-flag">${r.fullyPhasedOut ? 'fully phased out' : 'yes — cap lowered to ' + usd(r.allowedCap)}</span></div>`
    : '';

  $('out').innerHTML =
    `<div class="line"><span>Tips you entered</span><span class="num">${usd(r.eligibleAmount)}${capNote}</span></div>` +
    phaseNote +
    `<div class="line"><span>Deductible amount</span><span class="num">${usd(r.deduction)}</span></div>` +
    `<div class="line big"><span>Estimated federal tax saved</span><span class="num">${usd(r.taxSaved)}</span></div>` +
    `<div class="line"><span>Effective federal rate on this deduction</span><span class="num">${pct(r.marginalRate)}</span></div>` +
    `<div class="obbba-note">Social Security and Medicare (FICA) still apply to your tips — the deduction lowers federal income tax only, claimed when you file. You must work in a customarily-tipped occupation.</div>` +
    `<div class="takeaway">In plain terms: this lands as a bigger refund (or a smaller bill) when you file next year — your paychecks and their withholding don't change now.</div>`;

  renderState();
}

function init() {
  fillStates();
  ['income', 'tips', 'filing', 'state'].forEach((id) => {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  render();
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
