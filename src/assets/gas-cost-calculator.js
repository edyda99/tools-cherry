// gas-cost-calculator.js — trip fuel-cost calculator, live results.
// Pure math via the shared fuel-cost module. No deps, nothing uploaded.
import { tripCost, fuelPrice } from '/assets/fuel-cost.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
const $ = (id) => document.getElementById(id);

// The same formatters as src/content/gas-cost-blocks.js, so the worked examples
// on the page and the live result print a trip the same way.
function money(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
}

// Cents-per-mile reads better with a third decimal than rounded to the cent.
function perUnit(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 3
  });
}

function qty(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Same decimals as the fuel economy calculator: MPG to 1, the metric units to 2.
function fixed(n, dp) {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
const ECON_TEXT = {
  mpg: (r) => `${fixed(r.mpg, 1)} MPG`,
  l100km: (r) => `${fixed(r.l100km, 2)} L/100km`,
  kmPerL: (r) => `${fixed(r.kmPerL, 2)} km/L`
};

const isBlank = (id) => $(id).value.trim() === '';

function hideLines() {
  ['lineFuel', 'linePer', 'lineEcon', 'linePerson'].forEach((id) => {
    $(id).hidden = true;
  });
}

function calc() {
  const big = $('resultBig');
  const sub = $('resultSub');
  hideLines();
  big.textContent = '—';
  sub.textContent = '';

  if (isBlank('distance') || isBlank('economy') || isBlank('price')) {
    sub.textContent = 'Enter a distance, fuel economy and gas price.';
    return;
  }

  const distUnit = $('distUnit').value;
  const econUnit = $('econUnit').value;
  const priceUnit = $('priceUnit').value;
  const roundTrip = $('roundTrip').checked;
  const split = $('split').checked;
  const people = split && !isBlank('people') ? $('people').value : 1;
  const distance = parseFloat($('distance').value);
  // price is a money field — read comma-safe so "1,250" isn't truncated to 1.
  const price = moneyValue($('price'));

  if (!(distance > 0)) {
    sub.textContent = 'Enter a trip distance greater than zero.';
    return;
  }

  const r = tripCost({
    distance,
    distUnit,
    economy: $('economy').value,
    economyUnit: econUnit,
    price,
    priceUnit,
    roundTrip,
    people
  });

  if (!Number.isFinite(r.totalCost)) {
    sub.textContent = 'Enter a fuel economy greater than zero.';
    return;
  }

  big.textContent = money(r.totalCost);
  sub.textContent = roundTrip ? 'Total gas cost (round trip)' : 'Total gas cost (one way)';

  // Fuel in the unit it is priced in: gallons at a per-gallon price, litres at a per-litre one.
  $('lineFuel').hidden = false;
  $('lineFuelV').textContent = priceUnit === 'l' ? `${qty(r.litres)} L` : `${qty(r.gallons)} gal`;

  $('linePer').hidden = false;
  $('linePer').querySelector('.lbl').textContent = distUnit === 'km' ? 'Cost per km' : 'Cost per mile';
  $('linePerV').textContent = perUnit(distUnit === 'km' ? r.costPerKm : r.costPerMile);

  // The two units the visitor did not type in, so the page doubles as a converter.
  $('lineEcon').hidden = false;
  $('lineEconV').textContent = Object.keys(ECON_TEXT)
    .filter((u) => u !== econUnit)
    .map((u) => ECON_TEXT[u](r))
    .join(' · ');

  if (split) {
    const n = Math.max(1, Math.floor(parseFloat($('people').value) || 1));
    $('linePerson').hidden = false;
    $('linePerson').querySelector('.lbl').textContent = `Per person (split ${n} ways)`;
    $('linePersonV').textContent = money(r.perPerson);
  }
}

// "How much is 25 gallons of gas?" at the price entered in the main form.
function calcFill() {
  const out = $('fillOut');
  const perLitre = $('priceUnit').value === 'l';
  const unit = perLitre ? 'litre' : 'gallon';
  $('fillLabel').textContent = perLitre ? 'Litres' : 'Gallons';

  const amount = parseFloat($('fillAmount').value);
  const price = isBlank('price') ? NaN : moneyValue($('price'));
  const cost = fuelPrice(amount, price);
  if (!Number.isFinite(cost)) {
    out.textContent = isBlank('price') ? 'Enter a gas price above.' : '—';
    return;
  }
  const plural = amount === 1 ? unit : unit + 's';
  out.textContent = `${qty(amount)} ${plural} at ${money(price)} a ${unit} = ${money(cost)}`;
}

function update() {
  calc();
  calcFill();
}

function syncSplit() {
  $('peopleField').hidden = !$('split').checked;
  update();
}

function init() {
  initMoneyInputs();
  $('roundTrip').addEventListener('change', update);
  $('split').addEventListener('change', syncSplit);
  ['distUnit', 'econUnit', 'priceUnit'].forEach((id) => $(id).addEventListener('change', update));
  document
    .querySelectorAll('#gasForm input[type="number"], #gasForm input[data-money], #fillAmount')
    .forEach((el) => el.addEventListener('input', update));
  syncSplit();
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
