// gas-cost-calculator.js — trip fuel-cost calculator, live results.
// Pure math via the shared fuel-cost module. No deps, nothing uploaded.
import { fuelCost } from '/assets/fuel-cost.js';

const $ = (id) => document.getElementById(id);

function money(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
}

// Cents-per-mile reads better than dollars for the per-mile figure.
function perMile(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 3
  });
}

function gallonsFmt(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' gal';
}

const isBlank = (id) => $(id).value.trim() === '';

function calc() {
  const big = $('resultBig');
  const sub = $('resultSub');
  const line1 = $('line1');
  const line2 = $('line2');
  const line3 = $('line3');
  const line1v = $('line1v');
  const line2v = $('line2v');
  const line3v = $('line3v');

  // default: hide detail lines, show a placeholder
  line1.hidden = true;
  line2.hidden = true;
  line3.hidden = true;
  big.textContent = '—';
  sub.textContent = '';

  if (isBlank('distance') || isBlank('mpg') || isBlank('price')) return;

  const roundTrip = $('roundTrip').checked;
  const split = $('split').checked;
  const people = split && !isBlank('people') ? $('people').value : 1;

  const r = fuelCost({
    distance: $('distance').value,
    mpg: $('mpg').value,
    pricePerGallon: $('price').value,
    roundTrip,
    people
  });

  if (!Number.isFinite(r.totalCost)) {
    sub.textContent = 'Enter a fuel efficiency (MPG) greater than zero.';
    return;
  }

  big.textContent = money(r.totalCost);
  sub.textContent = roundTrip ? 'Total fuel cost (round trip)' : 'Total fuel cost (one way)';

  line1.hidden = false;
  line1v.previousElementSibling.textContent = 'Fuel used';
  line1v.textContent = gallonsFmt(r.gallons);

  line2.hidden = false;
  line2v.previousElementSibling.textContent = 'Cost per mile';
  line2v.textContent = perMile(r.costPerMile);

  if (split) {
    const n = Math.max(1, Math.floor(parseFloat($('people').value) || 1));
    line3.hidden = false;
    line3v.previousElementSibling.textContent = `Per person (split ${n} ways)`;
    line3v.textContent = money(r.perPerson);
  }
}

function syncSplit() {
  $('peopleField').hidden = !$('split').checked;
  calc();
}

function init() {
  $('roundTrip').addEventListener('change', calc);
  $('split').addEventListener('change', syncSplit);
  document.querySelectorAll('#gasForm input[type="number"]').forEach((el) =>
    el.addEventListener('input', calc)
  );
  syncSplit();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
