// embed-paycheck.js — the compact all-states take-home paycheck widget served at
// /embed/paycheck-calculator/ for third-party sites to iframe. Same engine and
// data as the 51 state pages (window.__PAYCHECK_EMBED__ is injected at build from
// tax-data-2026.json); if this widget ever disagreed with a state page, that is a
// bug. All math runs in the visitor's browser; nothing is uploaded.
import { computePaycheck } from '/assets/paycheck-engine.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const taxData = window.__PAYCHECK_EMBED__ || { federal: {}, states: {} };

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const usd2 = (n) => '$' + (Math.max(0, n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Caption phrase per pay frequency — reads as "take-home every 2 weeks".
const FREQ_PHRASE = {
  weekly: 'every week',
  biweekly: 'every 2 weeks',
  semimonthly: 'twice a month',
  monthly: 'every month',
  annual: 'a year'
};

// Bar fills only (never text): fixed hexes read fine on the light and dark track.
const BAR = { net: '#146c43', federal: '#4a648c', fica: '#b3872e', state: '#b4126b' };

function buildStateSelect() {
  const sel = $('state');
  const entries = Object.entries(taxData.states || {})
    .map(([slug, s]) => [slug, s.name || slug])
    .sort((a, b) => a[1].localeCompare(b[1]));
  sel.innerHTML = entries.map(([slug, name]) => `<option value="${slug}">${esc(name)}</option>`).join('');
  // Default to a familiar large state; ?state=<slug> (the gallery's preselect
  // option) wins when it names a real state.
  if (taxData.states.california) sel.value = 'california';
  const pre = new URLSearchParams(location.search).get('state');
  // hasOwnProperty, not a plain truthy lookup: ?state=constructor (or toString,
  // valueOf, __proto__) hits Object.prototype and reads as a real state, which
  // sets sel.value to a slug no <option> carries. The select silently falls back
  // to '', render() finds no state and returns, and the visitor gets a blank
  // panel inside somebody else's page.
  if (pre && Object.prototype.hasOwnProperty.call(taxData.states, pre)) sel.value = pre;
}

function seg(color, frac) {
  const w = Math.max(0, Math.min(1, frac || 0)) * 100;
  return `<i style="background:${color};width:${w}%"></i>`;
}

function row(label, amount, cls) {
  return `<div class="pw-row${cls ? ' ' + cls : ''}"><span>${label}</span><span>${amount}</span></div>`;
}

function render() {
  const salary = moneyValue($('salary'));
  const slug = $('state').value;
  const st = taxData.states[slug];
  if (!st) return;
  const freq = $('frequency').value;
  const r = computePaycheck({
    wage: { type: 'salary', amount: Math.max(0, salary || 0) },
    filingStatus: $('filingStatus').value,
    payFrequency: freq,
    stateSlug: slug
  }, taxData);
  const A = r.annual;
  const P = r.perPaycheck;
  const g = A.gross || 1;
  const fica = A.socialSecurity + A.medicare;

  const rows = [
    row('Federal income tax', usd2(P.federal)),
    row('Social Security', usd2(P.socialSecurity)),
    row('Medicare', usd2(P.medicare)),
    row(st.hasIncomeTax ? esc(st.name) + ' income tax' : esc(st.name) + ': no state income tax', usd2(P.state))
  ];
  for (const p of P.programs || []) rows.push(row(esc(p.label), usd2(p.amount)));
  rows.push(row('Take-home', usd2(P.net), 'pw-total'));

  $('out').innerHTML =
    `<p class="pw-big">${usd2(P.net)} <small>take-home ${FREQ_PHRASE[freq] || ''}</small></p>` +
    `<p class="pw-sub">of ${usd2(P.gross)} gross · ${pct1(A.effectiveRate)} total tax · ${usd(A.net)} a year</p>` +
    `<div class="pw-bar" aria-hidden="true">${seg(BAR.net, A.net / g)}${seg(BAR.federal, A.federal / g)}${seg(BAR.fica, fica / g)}${seg(BAR.state, (A.state + A.statePrograms) / g)}</div>` +
    `<p class="pw-legend" aria-hidden="true"><span><b style="background:${BAR.net}"></b>Take-home</span><span><b style="background:${BAR.federal}"></b>Federal</span><span><b style="background:${BAR.fica}"></b>FICA</span><span><b style="background:${BAR.state}"></b>State</span></p>` +
    `<div class="pw-rows">${rows.join('')}</div>` +
    `<p class="pw-more"><a href="/${slug}-paycheck-calculator/" target="_blank" rel="noopener">See the full ${esc(st.name)} breakdown</a></p>`;
}

function init() {
  initMoneyInputs();
  buildStateSelect();
  ['salary', 'state', 'filingStatus', 'frequency'].forEach((id) => {
    const el = $(id);
    el?.addEventListener('input', render);
    el?.addEventListener('change', render);
  });
  $('salary')?.addEventListener('focus', (ev) => ev.target.select());
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
