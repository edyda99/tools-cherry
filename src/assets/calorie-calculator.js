// calorie-calculator.js — daily calorie (TDEE) calculator UI with a metric/
// imperial unit toggle. Live results, graceful empty/invalid handling (never
// shows NaN). Pure math via the shared calories engine. No deps, nothing uploaded.
import {
  tdee,
  goals,
  lbToKg,
  ftInToCm
} from '/assets/calories.js';

const $ = (id) => document.getElementById(id);

function fmt(n) {
  if (!Number.isFinite(n)) return '';
  // Calorie targets are rounded to the nearest 10 — false precision otherwise.
  return Math.round(n / 10) * 10 === 0
    ? '0'
    : (Math.round(n / 10) * 10).toLocaleString('en-US');
}

const isBlank = (id) => !$(id) || $(id).value.trim() === '';

function showUnit(unit) {
  $('metricBlock').hidden = unit !== 'metric';
  $('imperialBlock').hidden = unit !== 'imperial';
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.unit === unit))
  );
  calc();
}

function activeUnit() {
  const pressed = document.querySelector('.unit-toggle button[aria-pressed="true"]');
  return pressed ? pressed.dataset.unit : 'metric';
}

const GOAL_ROWS = [
  ['rExtremeLoss', 'extremeLoss'],
  ['rLoss', 'loss'],
  ['rMildLoss', 'mildLoss'],
  ['rMaintain', 'maintain'],
  ['rMildGain', 'mildGain'],
  ['rGain', 'gain']
];

function reset(big, sub) {
  big.textContent = '—';
  sub.textContent = 'Fill in your details to see your daily calories.';
  GOAL_ROWS.forEach(([id]) => { if ($(id)) $(id).textContent = '—'; });
  if ($('goalTable')) $('goalTable').hidden = true;
}

function calc() {
  const unit = activeUnit();
  const big = $('resultBig');
  const sub = $('resultSub');

  const age = isBlank('age') ? NaN : parseFloat($('age').value);
  const sex = $('sex') ? $('sex').value : 'male';
  const activity = $('activity') ? $('activity').value : 'sedentary';

  let weightKg = NaN;
  let heightCm = NaN;

  if (unit === 'metric') {
    if (isBlank('kg') || isBlank('cm') || isBlank('age')) return reset(big, sub);
    weightKg = parseFloat($('kg').value);
    heightCm = parseFloat($('cm').value);
  } else {
    if (isBlank('lb') || (isBlank('ft') && isBlank('in')) || isBlank('age')) {
      return reset(big, sub);
    }
    weightKg = lbToKg($('lb').value);
    heightCm = ftInToCm($('ft').value, $('in').value);
  }

  const maintain = tdee({ weightKg, heightCm, age, sex, activity });
  if (!Number.isFinite(maintain)) return reset(big, sub);

  big.textContent = fmt(maintain);
  sub.textContent = 'calories/day to maintain your weight';

  const g = goals(maintain);
  GOAL_ROWS.forEach(([id, key]) => { if ($(id)) $(id).textContent = fmt(g[key]); });
  if ($('goalTable')) $('goalTable').hidden = false;
}

function init() {
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.addEventListener('click', () => showUnit(b.dataset.unit))
  );
  document.querySelectorAll('#calorieForm input, #calorieForm select').forEach((el) =>
    el.addEventListener('input', calc)
  );
  showUnit('metric');
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
