// 1099-threshold-checker.js — the 1099-K / 1099-NEC / 1099-MISC threshold
// checker. Tells the user which form (if any) they should expect from a given
// payment, why, the headroom to the next threshold, and an optional state
// 1099-K overlay note. All logic runs client-side; nothing is uploaded.
import { check1099 } from '/assets/form-1099-checker.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const DATA = window.__FORM1099__;
const STATES = window.__FORM1099_STATES__ || [];

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const num0 = (n) => Math.round(Math.max(0, n || 0)).toLocaleString('en-US');

function num(id) {
  const el = $(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : 0;
}

function populateStates() {
  const sel = $('state');
  if (!sel || sel.dataset.populated) return;
  const opts = ['<option value="">Not sure / skip</option>'].concat(
    STATES.slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => `<option value="${s.abbr}">${s.name}</option>`)
  );
  sel.innerHTML = opts.join('');
  sel.dataset.populated = '1';
}

const STATE_NAME = {};
STATES.forEach((s) => { STATE_NAME[s.abbr] = s.name; });

function updateFieldVisibility() {
  const payerType = $('payerType').value;
  const txnField = $('txnField');
  const natureField = $('natureField');
  const purposeField = $('purposeField');
  if (txnField) txnField.style.display = payerType === 'network' ? '' : 'none';
  if (natureField) natureField.style.display = payerType === 'network' ? '' : 'none';
  if (purposeField) purposeField.style.display = payerType === 'direct' ? '' : 'none';
}

// Plain-English "why" line, plugging in the user's own numbers, per branch.
function whyLine(r, ctx) {
  const { amount, transactions } = ctx;
  if (r.payerType === 'network') {
    if (r.reason === 'personal_transfer') return r.note;
    if (r.dollarsExceeded && r.txnsExceeded) {
      return `${usd(amount)} exceeds $20,000 <strong>and</strong> ${num0(transactions)} transactions exceeds 200 — both conditions are met, so the platform must issue a 1099-K.`;
    }
    if (r.dollarsExceeded && !r.txnsExceeded) {
      return `${usd(amount)} exceeds $20,000, but ${num0(transactions)} transactions does <strong>not</strong> exceed 200 — both conditions must be met, so no 1099-K yet.`;
    }
    if (!r.dollarsExceeded && r.txnsExceeded) {
      return `${num0(transactions)} transactions exceeds 200, but ${usd(amount)} does <strong>not</strong> exceed $20,000 — both conditions must be met, so no 1099-K yet.`;
    }
    return `${usd(amount)} does not exceed $20,000, and ${num0(transactions)} transactions does not exceed 200 — neither condition is met.`;
  }
  if (r.payerType === 'card') {
    if (amount <= 0) return `You entered $0, so there's nothing yet to report.`;
    return `Card processors have <strong>no minimum</strong> — any amount above $0 is reportable, so a 1099-K is issued for this ${usd(amount)} payment.`;
  }
  // direct
  const formName = r.form || (ctx.paymentPurpose === 'rent_other' ? '1099-MISC' : '1099-NEC');
  const floorTxt = r.indexed ? `about ${usd(r.floor)} (inflation-adjusted estimate)` : usd(r.floor);
  if (r.willIssue) {
    return `${usd(amount)} is at or above the ${floorTxt} threshold for tax year ${ctx.taxYear} — the payer should issue a ${formName}.`;
  }
  return `${usd(amount)} is below the ${floorTxt} threshold for tax year ${ctx.taxYear}, so no ${formName} is expected from this payer.`;
}

function headroomLine(r) {
  if (r.willIssue || r.reason === 'personal_transfer' || r.payerType === 'card') return '';
  if (r.payerType === 'network' && r.headroom) {
    return `<div class="obbba-note">You could receive <strong>${usd(r.headroom.dollarsToGo)} more</strong> and have <strong>${num0(r.headroom.txnsToGo)} more transactions</strong> before a 1099-K is triggered — you'd need to cross <strong>both</strong> $20,000 and 200 transactions, not just one.</div>`;
  }
  if (r.payerType === 'direct' && r.headroom) {
    return `<div class="obbba-note">You could receive <strong>${usd(r.headroom.dollarsToGo)} more</strong> from this payer this year before a ${r.form || 'form'} is triggered.</div>`;
  }
  return '';
}

function stateNoteLine(r) {
  if (!r.stateOverlay) return '';
  const name = STATE_NAME[r.stateOverlay.state] || r.stateOverlay.state;
  const cond = r.stateOverlay.condition ? ` (${r.stateOverlay.condition})` : '';
  // Phrasing must stay accurate whether or not a federal 1099-K is ALSO
  // expected (e.g. the card-processor branch, or a state whose threshold sits
  // below the federal $20k/200 line) — "even without a federal 1099-K" is
  // only true when r.willIssue is false.
  const phrase = r.willIssue
    ? `${name} also requires reporting at ${usd(r.stateOverlay.threshold)}${cond} — you may get a state 1099-K in addition to the federal one.`
    : `Even without a federal 1099-K, ${name} requires reporting at ${usd(r.stateOverlay.threshold)}${cond} — you may still get a state 1099-K.`;
  return `<div class="obbba-note info-flag">${phrase}</div>`;
}

function render() {
  updateFieldVisibility();

  const taxYear = parseInt($('taxYear').value, 10);
  const payerType = $('payerType').value;
  const amount = num('amount');
  const transactions = payerType === 'network' ? num('transactions') : 0;
  const paymentNature = payerType === 'network' ? $('paymentNature').value : 'business';
  const paymentPurpose = payerType === 'direct' ? $('paymentPurpose').value : 'services';
  const stateEl = $('state');
  const state = stateEl ? stateEl.value : '';

  const r = check1099({ taxYear, payerType, amount, transactions, paymentNature, paymentPurpose, state, data: DATA });

  // --- Verdict badge -----------------------------------------------------------
  let badgeText, badgeClass;
  if (r.reason === 'personal_transfer') {
    badgeText = 'Not income — no form expected';
    badgeClass = 'ok-flag';
  } else if (r.willIssue) {
    badgeText = `Expect a ${r.form}`;
    badgeClass = 'warn-flag';
  } else {
    badgeText = 'No 1099 expected';
    badgeClass = 'ok-flag';
  }

  const issuerLine = r.willIssue && r.issuer
    ? `<div class="line"><span>Who issues it</span><span class="num">${r.issuer}</span></div>`
    : '';

  const why = whyLine(r, { amount, transactions, taxYear, paymentPurpose });
  const headroom = headroomLine(r);
  const stateNote = stateNoteLine(r);

  $('out').innerHTML =
    `<div class="line big"><span>Verdict</span><span class="num ${badgeClass}">${badgeText}</span></div>` +
    issuerLine +
    `<div class="obbba-note"><strong>Why:</strong> ${why}</div>` +
    headroom +
    stateNote +
    `<div class="takeaway">A 1099 is paperwork, not a new tax. Whether or not you get one, taxable income is still taxable and must be reported — no form does not mean no tax.</div>`;
}

function init() {
  populateStates();
  ['taxYear', 'payerType', 'amount', 'transactions', 'paymentNature', 'paymentPurpose', 'state'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', render);
    el.addEventListener('change', render);
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
