// tip.js — client-side Tip Calculator UI. Reads the bill, tip percentage,
// optional tax, split count, and rounding mode from the form and defers all
// money arithmetic to the pure engine (tip-math.js) so the math is the same
// code path the unit tests cover. No network, no storage — runs in the browser.

import { computeTip } from '/assets/tip-math.js';

const $ = (id) => document.getElementById(id);

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Tip presets (percent). The custom field overrides the active preset.
const PRESETS = [10, 15, 18, 20, 25];

let activePreset = 18; // default to "good service"

function selectedTipPercent() {
  const custom = $('tipCustom');
  const raw = custom && custom.value.trim();
  if (raw !== '' && raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return activePreset;
}

function render() {
  const bill = Number($('bill').value) || 0;
  const tax = Number($('tax').value) || 0;
  const people = Math.max(1, Math.floor(Number($('people').value) || 1));
  const tipPercent = selectedTipPercent();
  const tipOnPreTax = $('preTax').checked;
  const round = $('round').value;

  const r = computeTip({ bill, tipPercent, tax, tipOnPreTax, people, round });

  $('outTip').textContent = money.format(r.tip);
  $('outTotal').textContent = money.format(r.total);

  // Per-person row only matters when splitting.
  const splitRow = $('splitRow');
  if (people > 1) {
    splitRow.hidden = false;
    $('outPerPerson').textContent = money.format(r.perPerson);
    $('peopleLabel').textContent = `each (${people} people)`;
  } else {
    splitRow.hidden = true;
  }

  // Effective rate note (shows when rounding shifted the rate).
  const note = $('effNote');
  if (round !== 'none' && bill > 0) {
    note.hidden = false;
    note.textContent = `Effective tip: ${r.effectiveTipPercent.toFixed(1)}% of the bill after rounding.`;
  } else {
    note.hidden = true;
  }
}

function setPreset(pct) {
  activePreset = pct;
  const custom = $('tipCustom');
  if (custom) custom.value = '';
  document.querySelectorAll('#tipPresets .btn-secondary').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.tip) === pct));
  });
  render();
}

function buildPresets() {
  const wrap = $('tipPresets');
  if (!wrap) return;
  wrap.innerHTML = PRESETS.map((p) =>
    `<button type="button" class="btn-secondary" data-tip="${p}" aria-pressed="${p === activePreset}">${p}%</button>`
  ).join('');
  wrap.querySelectorAll('.btn-secondary').forEach((b) => {
    b.addEventListener('click', () => setPreset(Number(b.dataset.tip)));
  });
}

function step(delta) {
  const el = $('people');
  const next = Math.max(1, Math.floor(Number(el.value) || 1) + delta);
  el.value = String(next);
  render();
}

function init() {
  buildPresets();

  ['bill', 'tax', 'people', 'tipCustom', 'round', 'preTax'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      // Typing a custom tip clears the active preset highlight.
      if (id === 'tipCustom' && el.value.trim() !== '') {
        document.querySelectorAll('#tipPresets .btn-secondary').forEach((b) =>
          b.setAttribute('aria-pressed', 'false'));
      }
      render();
    });
  });

  const minus = $('peopleMinus');
  const plus = $('peoplePlus');
  if (minus) minus.addEventListener('click', () => step(-1));
  if (plus) plus.addEventListener('click', () => step(1));

  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
