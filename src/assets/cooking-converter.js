// cooking-converter.js — kitchen measurement converter + recipe scaler, live.
// Pure math via the shared cooking-units module. No deps, nothing uploaded.
import {
  VOLUME,
  WEIGHT,
  LABELS,
  convert,
  fahrenheitToCelsius,
  celsiusToFahrenheit,
  gasMarkForCelsius,
  scaleAmount,
  servingsMultiplier,
  DENSITY_G_PER_CUP,
  volumeToGramsApprox
} from '/assets/cooking-units.js';

const $ = (id) => document.getElementById(id);

// Format a number for display: thousands separators, sensible decimals, no
// trailing-zero noise. Returns '' for non-finite input so the UI shows a dash.
function fmt(n, maxFrac = 2) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac });
}

const isBlank = (id) => $(id).value.trim() === '';

const UNITS_BY_CATEGORY = {
  volume: Object.keys(VOLUME),
  weight: Object.keys(WEIGHT)
};

// Fill the from/to unit dropdowns for the current category.
function populateUnits(category, preferFrom, preferTo) {
  const units = UNITS_BY_CATEGORY[category];
  const from = $('fromUnit');
  const to = $('toUnit');
  from.innerHTML = '';
  to.innerHTML = '';
  units.forEach((u) => {
    const o1 = document.createElement('option');
    o1.value = u;
    o1.textContent = LABELS[u];
    from.appendChild(o1);
    const o2 = document.createElement('option');
    o2.value = u;
    o2.textContent = LABELS[u];
    to.appendChild(o2);
  });
  from.value = preferFrom && units.includes(preferFrom) ? preferFrom : units[0];
  to.value = preferTo && units.includes(preferTo) ? preferTo : units[1] || units[0];
}

function showCategory(category) {
  const tempBlock = $('tempBlock');
  const unitBlock = $('unitBlock');
  if (category === 'temperature') {
    tempBlock.hidden = false;
    unitBlock.hidden = true;
  } else {
    tempBlock.hidden = true;
    unitBlock.hidden = false;
    populateUnits(category);
  }
  convertNow();
}

function convertNow() {
  const category = $('category').value;
  const big = $('resultBig');
  const sub = $('resultSub');
  big.textContent = '—';
  sub.textContent = '';

  if (category === 'temperature') {
    if (isBlank('tempValue')) return;
    const dir = $('tempDir').value;
    const v = parseFloat($('tempValue').value);
    if (!Number.isFinite(v)) return;
    if (dir === 'f2c') {
      const c = fahrenheitToCelsius(v);
      big.textContent = fmt(c, 1) + ' °C';
      const gm = gasMarkForCelsius(c);
      sub.textContent = `${fmt(v, 1)} °F` + (gm ? ` · gas mark ${gm}` : '');
    } else {
      const f = celsiusToFahrenheit(v);
      big.textContent = fmt(f, 1) + ' °F';
      const gm = gasMarkForCelsius(v);
      sub.textContent = `${fmt(v, 1)} °C` + (gm ? ` · gas mark ${gm}` : '');
    }
    return;
  }

  if (isBlank('amount')) return;
  const amount = parseFloat($('amount').value);
  const fromU = $('fromUnit').value;
  const toU = $('toUnit').value;
  const r = convert(amount, fromU, toU, category);
  if (!Number.isFinite(r)) return;
  big.textContent = fmt(r);
  sub.textContent = `${fmt(amount)} ${LABELS[fromU]} = ${fmt(r)} ${LABELS[toU]}`;
}

function swapUnits() {
  const from = $('fromUnit');
  const to = $('toUnit');
  const tmp = from.value;
  from.value = to.value;
  to.value = tmp;
  convertNow();
}

// --- Recipe scaler ---------------------------------------------------------
function scaleNow() {
  const big = $('scaleBig');
  const sub = $('scaleSub');
  big.textContent = '—';
  sub.textContent = '';
  if (isBlank('scaleAmount')) return;
  const amount = parseFloat($('scaleAmount').value);
  if (!Number.isFinite(amount)) return;

  const mode = $('scaleMode').value;
  let mult;
  if (mode === 'servings') {
    if (isBlank('origServings') || isBlank('newServings')) return;
    mult = servingsMultiplier($('origServings').value, $('newServings').value);
    if (!Number.isFinite(mult)) {
      sub.textContent = 'Enter original servings greater than zero.';
      return;
    }
  } else {
    mult = parseFloat(mode);
  }
  const scaled = scaleAmount(amount, mult);
  if (!Number.isFinite(scaled)) return;
  big.textContent = fmt(scaled);
  sub.textContent = `${fmt(amount)} × ${fmt(mult)} = ${fmt(scaled)}`;
}

function toggleScaleMode() {
  const isServings = $('scaleMode').value === 'servings';
  $('servingsRow').hidden = !isServings;
  scaleNow();
}

// --- Approximate density helper (volume → weight) --------------------------
function densityNow() {
  const big = $('densBig');
  const sub = $('densSub');
  big.textContent = '—';
  sub.textContent = '';
  if (isBlank('densAmount')) return;
  const amount = parseFloat($('densAmount').value);
  if (!Number.isFinite(amount)) return;
  const unit = $('densUnit').value;
  const ing = $('densIngredient').value;
  const grams = volumeToGramsApprox(amount, unit, ing);
  if (!Number.isFinite(grams)) return;
  big.textContent = '≈ ' + fmt(grams, 1) + ' g';
  sub.textContent = `${fmt(amount)} ${LABELS[unit]} of ${ing} (approximate)`;
}

function init() {
  // Converter
  showCategory($('category').value);
  $('category').addEventListener('change', () => showCategory($('category').value));
  ['amount', 'fromUnit', 'toUnit', 'tempValue', 'tempDir'].forEach((id) => {
    const el = $(id);
    if (el) {
      el.addEventListener('input', convertNow);
      el.addEventListener('change', convertNow);
    }
  });
  $('swapBtn').addEventListener('click', swapUnits);

  // Recipe scaler
  $('scaleMode').addEventListener('change', toggleScaleMode);
  ['scaleAmount', 'origServings', 'newServings'].forEach((id) =>
    $(id).addEventListener('input', scaleNow)
  );
  toggleScaleMode();

  // Density helper: populate volume-unit and ingredient dropdowns
  const du = $('densUnit');
  Object.keys(VOLUME).forEach((u) => {
    const o = document.createElement('option');
    o.value = u;
    o.textContent = LABELS[u];
    du.appendChild(o);
  });
  du.value = 'cup';
  const di = $('densIngredient');
  Object.keys(DENSITY_G_PER_CUP).forEach((ing) => {
    const o = document.createElement('option');
    o.value = ing;
    o.textContent = ing;
    di.appendChild(o);
  });
  ['densAmount', 'densUnit', 'densIngredient'].forEach((id) => {
    $(id).addEventListener('input', densityNow);
    $(id).addEventListener('change', densityNow);
  });
  densityNow();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
