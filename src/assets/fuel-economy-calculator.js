// fuel-economy-calculator.js — fuel-economy (MPG / L/100km) calculator UI.
// Two modes: measure economy from distance + fuel, or convert an existing
// figure between units. Live results, never shows NaN. Pure math via the
// shared fuel-economy engine. No deps, nothing uploaded.
import { fuelEconomy, convertEconomy } from '/assets/fuel-economy.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

function fmt(n, dp = 1) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp
  });
}

const isBlank = (id) => !$(id) || $(id).value.trim() === '';

function showMode(mode) {
  $('measureBlock').hidden = mode !== 'measure';
  $('convertBlock').hidden = mode !== 'convert';
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
  );
  calc();
}

function activeMode() {
  const pressed = document.querySelector('.unit-toggle button[aria-pressed="true"]');
  return pressed ? pressed.dataset.mode : 'measure';
}

function reset(sub) {
  $('resultBig').textContent = '—';
  $('resultSub').textContent = sub;
  ['lineMpgUs', 'lineMpgUk', 'lineKmL', 'lineL100'].forEach((id) => {
    $(id).hidden = true;
  });
}

// Render the four equivalent figures. `big` picks which one is the headline.
function render(r, big) {
  if (!r || !Number.isFinite(r.mpgUs)) {
    return reset('Enter your numbers to see the fuel economy.');
  }
  const labels = {
    mpgUs: ['MPG (US)', `${fmt(r.mpgUs, 1)} mpg`],
    mpgUk: ['MPG (UK / imperial)', `${fmt(r.mpgUk, 1)} mpg`],
    kmPerL: ['Kilometres per litre', `${fmt(r.kmPerL, 2)} km/L`],
    l100km: ['Litres per 100 km', `${fmt(r.l100km, 2)} L/100km`]
  };

  $('resultBig').textContent = labels[big][1];
  $('resultSub').textContent = 'Lower L/100km — or higher MPG — means better economy.';

  const rows = {
    lineMpgUs: 'mpgUs',
    lineMpgUk: 'mpgUk',
    lineKmL: 'kmPerL',
    lineL100: 'l100km'
  };
  for (const [rowId, key] of Object.entries(rows)) {
    const row = $(rowId);
    // Don't repeat the headline figure in the breakdown list.
    if (key === big) { row.hidden = true; continue; }
    row.hidden = false;
    row.querySelector('.lbl').textContent = labels[key][0];
    row.querySelector('span:last-child').textContent = labels[key][1];
  }
}

function calc() {
  const mode = activeMode();

  if (mode === 'measure') {
    if (isBlank('distance') || isBlank('fuel')) {
      return reset('Enter your distance and fuel to see the economy.');
    }
    const r = fuelEconomy({
      distance: $('distance').value,
      fuel: $('fuel').value,
      distUnit: $('distUnit').value,
      fuelUnit: $('fuelUnit').value
    });
    // Headline matches the chosen fuel unit's natural economy unit.
    const big = $('fuelUnit').value === 'l' ? 'l100km' : 'mpgUs';
    render(r, big);
  } else {
    if (isBlank('convValue')) {
      return reset('Enter a value to convert between units.');
    }
    const from = $('convFrom').value;
    const r = convertEconomy($('convValue').value, from);
    const big = from === 'l100km' || from === 'kmPerL' ? 'l100km' : 'mpgUs';
    render(r, big);
  }
}

function init() {
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.addEventListener('click', () => showMode(b.dataset.mode))
  );
  document.querySelectorAll('#measureBlock input, #measureBlock select, #convertBlock input, #convertBlock select')
    .forEach((el) => {
      el.addEventListener('input', calc);
      el.addEventListener('change', calc);
    });
  showMode('measure');
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
