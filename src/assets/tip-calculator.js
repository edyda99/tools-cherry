// tip-calculator.js — tip calculator & bill splitter, live results.
// Pure math via the shared tip-math module. No deps, nothing uploaded.
import { splitBill } from '/assets/tip-math.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
const $ = (id) => document.getElementById(id);

function money(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
}

// A field is "blank" if empty/whitespace — stay quiet rather than render NaN
// while the user is mid-typing.
const isBlank = (id) => $(id).value.trim() === '';

// Reflect the active preset button (matches the typed tip %, if any).
function syncPresets() {
  const cur = parseFloat($('tipPercent').value);
  document.querySelectorAll('[data-tip]').forEach((btn) => {
    const on = Number.isFinite(cur) && parseFloat(btn.dataset.tip) === cur;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function calc() {
  syncPresets();

  const big = $('resultBig');
  const sub = $('resultSub');
  const lineTip = $('lineTip');
  const lineTotal = $('lineTotal');
  const linePerTip = $('linePerTip');

  // default: placeholder, detail lines hidden
  big.textContent = '—';
  sub.textContent = '';
  lineTip.hidden = true;
  lineTotal.hidden = true;
  linePerTip.hidden = true;

  if (isBlank('bill') || isBlank('tipPercent') || isBlank('people')) {
    sub.textContent = 'Enter the bill, a tip %, and how many people.';
    return;
  }

  const people = parseInt($('people').value, 10);
  const r = splitBill({
    bill: moneyValue($('bill')),
    tipPercent: $('tipPercent').value,
    people: $('people').value,
    roundUp: $('roundUp').checked,
    tax: moneyValue($('tax')),
    tipOnPreTax: $('tipPreTax').checked
  });

  if (!Number.isFinite(r.perPerson)) {
    sub.textContent = 'Enter a bill and at least 1 person.';
    return;
  }

  big.textContent = money(r.perPerson);
  sub.textContent =
    people === 1
      ? 'Total to pay'
      : `Each person pays · split ${people} ways` +
        ($('roundUp').checked ? ' · rounded up' : '');

  lineTip.hidden = false;
  lineTotal.hidden = false;
  $('lineTipV').textContent = money(r.tip);
  $('lineTotalV').textContent = money(r.total);

  if (people > 1) {
    linePerTip.hidden = false;
    $('linePerTipV').textContent = money(r.perPersonTip);
  }
}

// Step the people counter, clamped to a sensible minimum of 1.
function stepPeople(delta) {
  const cur = parseInt($('people').value, 10);
  const next = Math.max(1, (Number.isFinite(cur) ? cur : 1) + delta);
  $('people').value = next;
  calc();
}

function init() {
  initMoneyInputs();
  document.querySelectorAll('#tipForm input').forEach((el) =>
    el.addEventListener('input', calc)
  );

  // Tip presets fill the custom % field, then recompute.
  document.querySelectorAll('[data-tip]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $('tipPercent').value = btn.dataset.tip;
      calc();
    })
  );

  $('peopleMinus').addEventListener('click', () => stepPeople(-1));
  $('peoplePlus').addEventListener('click', () => stepPeople(1));

  calc();
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
