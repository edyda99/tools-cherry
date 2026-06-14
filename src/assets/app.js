// app.js — wires the form to the engine and renders results live.
// Each generated state page injects window.__TAX_DATA__ (federal + that state)
// and window.__STATE_SLUG__ before this module loads.
import { computePaycheck, PAY_PERIODS } from '/assets/paycheck-engine.js';

const taxData = window.__TAX_DATA__;
const stateSlug = window.__STATE_SLUG__;

const usd = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n * 100).toFixed(1) + '%';

const $ = (id) => document.getElementById(id);

function readForm() {
  const wageType = $('wageType').value; // 'salary' | 'hourly'
  const amount = parseFloat($('amount').value) || 0;
  const hoursPerWeek = parseFloat($('hours').value) || 40;
  return {
    wage: { type: wageType, amount, hoursPerWeek },
    filingStatus: $('filingStatus').value,
    payFrequency: $('payFrequency').value,
    stateSlug
  };
}

const PERIOD_LABEL = {
  weekly: 'per week', biweekly: 'per 2 weeks', semimonthly: 'twice a month',
  monthly: 'per month', annual: 'per year'
};

function render() {
  const input = readForm();
  // hourly fields visibility
  $('hoursField').style.display = input.wage.type === 'hourly' ? '' : 'none';

  const r = computePaycheck(input, taxData);
  const p = r.perPaycheck;

  $('netBig').textContent = usd2(p.net);
  $('netSub').textContent = `take-home ${PERIOD_LABEL[r.payFrequency]} · ${usd(r.annual.net)}/yr`;

  $('rGross').textContent = usd2(p.gross);
  $('rFederal').textContent = '−' + usd2(p.federal);
  $('rSS').textContent = '−' + usd2(p.socialSecurity);
  $('rMedicare').textContent = '−' + usd2(p.medicare);
  $('rState').textContent = '−' + usd2(p.state);
  $('rNet').textContent = usd2(p.net);

  $('rEff').textContent = pct(r.annual.effectiveRate);
  $('rTake').textContent = pct(r.annual.takeHomeRate);

  // hide state row when the state has no income tax
  $('stateLine').style.display = taxData.states[stateSlug]?.hasIncomeTax ? '' : 'none';
}

function init() {
  ['wageType', 'amount', 'hours', 'filingStatus', 'payFrequency'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', render);
  });
  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
