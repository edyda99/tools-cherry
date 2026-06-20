// bmi-calculator.js — BMI calculator UI with imperial/metric unit toggle.
// Live results, graceful empty/invalid handling (never shows NaN).
// Pure math via the shared bmi engine module. No deps, nothing uploaded.
import {
  bmiMetric,
  bmiImperial,
  category,
  healthyWeightRange
} from '/assets/bmi.js';

const $ = (id) => document.getElementById(id);

function fmt(n, dp = 1) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp
  });
}

const isBlank = (id) => !$(id) || $(id).value.trim() === '';

// Map a category to a CSS modifier so we can colour the badge.
const CAT_CLASS = {
  Underweight: 'cat-under',
  Normal: 'cat-normal',
  Overweight: 'cat-over',
  Obese: 'cat-obese'
};

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

function reset(big, sub, badge, range) {
  big.textContent = '—';
  sub.textContent = 'Enter your height and weight to see your BMI.';
  badge.textContent = '';
  badge.className = 'bmi-badge';
  range.hidden = true;
}

function calc() {
  const unit = activeUnit();
  const big = $('resultBig');
  const sub = $('resultSub');
  const badge = $('catBadge');
  const range = $('rangeLine');
  const rangeV = $('rangeLineV');

  let bmi = NaN;
  let healthy = {};

  if (unit === 'metric') {
    if (isBlank('cm') || isBlank('kg')) return reset(big, sub, badge, range);
    bmi = bmiMetric($('kg').value, $('cm').value);
    healthy = healthyWeightRange({ cm: parseFloat($('cm').value) });
  } else {
    // total inches from feet + inches; either may be blank but not both
    if (isBlank('lb') || (isBlank('ft') && isBlank('in'))) {
      return reset(big, sub, badge, range);
    }
    const ft = isBlank('ft') ? 0 : parseFloat($('ft').value);
    const inch = isBlank('in') ? 0 : parseFloat($('in').value);
    const totalInches = ft * 12 + inch;
    bmi = bmiImperial($('lb').value, totalInches);
    healthy = healthyWeightRange({ inches: totalInches });
  }

  if (!Number.isFinite(bmi)) return reset(big, sub, badge, range);

  const cat = category(bmi);
  big.textContent = fmt(bmi, 1);
  sub.textContent = 'Your Body Mass Index';
  badge.textContent = cat;
  badge.className = 'bmi-badge ' + (CAT_CLASS[cat] || '');

  if (unit === 'metric' && Number.isFinite(healthy.maxKg)) {
    range.hidden = false;
    range.querySelector('.lbl').textContent = 'Healthy weight for your height';
    rangeV.textContent = `${fmt(healthy.minKg, 1)}–${fmt(healthy.maxKg, 1)} kg`;
  } else if (unit === 'imperial' && Number.isFinite(healthy.maxLb)) {
    range.hidden = false;
    range.querySelector('.lbl').textContent = 'Healthy weight for your height';
    rangeV.textContent = `${fmt(healthy.minLb, 0)}–${fmt(healthy.maxLb, 0)} lb`;
  } else {
    range.hidden = true;
  }
}

function init() {
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.addEventListener('click', () => showUnit(b.dataset.unit))
  );
  document.querySelectorAll('#bmiForm input').forEach((el) =>
    el.addEventListener('input', calc)
  );
  showUnit('metric');
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
