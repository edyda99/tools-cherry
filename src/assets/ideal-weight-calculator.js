// ideal-weight-calculator.js — ideal body weight (4 formulas) + an evidence-based
// daily nutrition plan: protein anchored to grams per kg of bodyweight, fat with
// a hormonal-health floor, carbs as the remainder, plus fiber and water targets.
// Optional body-fat % switches the calorie estimate to Katch-McArdle and sets
// protein per kg of lean mass. Pure math via the shared ideal-weight + calories
// engines. No deps, nothing uploaded.
import {
  idealWeights,
  macroPlan,
  leanMassKg,
  bmrKatch,
  proteinPerKg
} from '/assets/ideal-weight.js';
import { tdee, ACTIVITY, lbToKg, ftInToCm } from '/assets/calories.js';

const $ = (id) => document.getElementById(id);

// kg -> the active unit's weight (kg or lb), formatted to 1 dp.
function kgToUnit(kg, unit) {
  if (!Number.isFinite(kg)) return '';
  const v = unit === 'imperial' ? kg / 0.45359237 : kg;
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

// Whole-gram formatting for macros (never NaN).
function grams(n) {
  if (!Number.isFinite(n)) return '';
  return Math.round(n).toLocaleString('en-US') + ' g';
}

function kcal(n) {
  if (!Number.isFinite(n)) return '';
  return Math.round(n).toLocaleString('en-US');
}

// A whole-gram range "104–133 g" (collapses to a single value when low == high).
function gramsRange(lo, hi) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '';
  const a = Math.round(lo);
  const b = Math.round(hi);
  return a === b
    ? `${a.toLocaleString('en-US')} g`
    : `${a.toLocaleString('en-US')}–${b.toLocaleString('en-US')} g`;
}

const oneDp = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

// Litres, 1 dp, from millilitres.
function litres(ml) {
  if (!Number.isFinite(ml)) return '';
  return (ml / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' L';
}

const isBlank = (id) => !$(id) || $(id).value.trim() === '';

function activeUnit() {
  const pressed = document.querySelector('.unit-toggle button[aria-pressed="true"]');
  return pressed ? pressed.dataset.unit : 'metric';
}

function showUnit(unit) {
  $('metricBlock').hidden = unit !== 'metric';
  $('imperialBlock').hidden = unit !== 'imperial';
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.unit === unit))
  );
  $('unitLabel').textContent = unit === 'imperial' ? 'lb' : 'kg';
  calc();
}

// Goal calorie adjustment as a fraction of maintenance (TDEE), not a flat kcal
// step: −20% to lose (≈0.5–0.75% bodyweight/week), maintain, +10% to gain
// (lean surplus). Sourced from the ISSN position stand + standard cut/bulk calcs.
const GOAL_MULT = { lose: 0.8, maintain: 1.0, gain: 1.1 };

// Minimum daily calories below which we never prescribe (Harvard Health):
// 1500 men / 1200 women. The deficit target is clamped to this floor.
const CAL_FLOOR = { male: 1500, female: 1200 };

// Diet-style presets adjust the carb:fat division only — protein stays anchored
// to g/kg. fatPct = fraction of calories from fat; keto pins carbs to a gram cap.
const PRESETS = {
  balanced: { fatPct: 0.3 },
  lowcarb: { fatPct: 0.4 },
  highcarb: { fatPct: 0.25 },
  keto: { ketoCarbG: 30 }
};

const IBW_ROWS = [
  ['ibwDevine', 'devine'],
  ['ibwRobinson', 'robinson'],
  ['ibwMiller', 'miller'],
  ['ibwHamwi', 'hamwi']
];

function reset(msg) {
  $('rangeBig').textContent = '—';
  $('rangeSub').textContent = msg || 'Fill in your details to see your ideal weight range.';
  IBW_ROWS.forEach(([id]) => { if ($(id)) $(id).textContent = '—'; });
  if ($('ibwTable')) $('ibwTable').hidden = true;
  if ($('macroBlock')) $('macroBlock').hidden = true;
  ['mProtein', 'mCarb', 'mFat', 'mFatKcal',
    'mProteinPerKg', 'mFiber', 'mWater'].forEach((id) => {
    if ($(id)) $(id).textContent = '—';
  });
}

function calc() {
  const unit = activeUnit();
  const age = isBlank('age') ? NaN : parseFloat($('age').value);
  const sex = $('sex') ? $('sex').value : 'male';
  const activity = $('activity') ? $('activity').value : 'sedentary';
  const goal = $('goal') ? $('goal').value : 'maintain';
  const preset = $('preset') ? $('preset').value : 'balanced';
  const bodyFat = isBlank('bodyfat') ? NaN : parseFloat($('bodyfat').value);

  let weightKg = NaN;
  let heightCm = NaN;

  if (unit === 'metric') {
    if (isBlank('cm')) return reset();
    heightCm = parseFloat($('cm').value);
    if (!isBlank('kg')) weightKg = parseFloat($('kg').value);
  } else {
    if (isBlank('ft') && isBlank('in')) return reset();
    heightCm = ftInToCm($('ft').value, $('in').value);
    if (!isBlank('lb')) weightKg = lbToKg($('lb').value);
  }

  // --- Ideal body weight range (height only) ---
  const ibw = idealWeights(sex, heightCm);
  if (!Number.isFinite(ibw.average)) return reset();

  const u = unit === 'imperial' ? 'lb' : 'kg';
  $('rangeBig').textContent = `${kgToUnit(ibw.low, unit)}–${kgToUnit(ibw.high, unit)} ${u}`;
  $('rangeSub').textContent = `Healthy target range across four formulas (about ${kgToUnit(ibw.average, unit)} ${u} on average).`;
  IBW_ROWS.forEach(([id, key]) => { if ($(id)) $(id).textContent = `${kgToUnit(ibw[key], unit)} ${u}`; });
  if ($('ibwTable')) $('ibwTable').hidden = false;

  // --- Nutrition plan (needs weight + age) ---
  if (!Number.isFinite(weightKg) || !Number.isFinite(age)) {
    if ($('macroBlock')) $('macroBlock').hidden = true;
    return;
  }

  // Maintenance calories: Katch-McArdle when body-fat% is supplied (more
  // accurate for lean/muscular users), otherwise Mifflin–St Jeor TDEE.
  const leanKg = leanMassKg(weightKg, bodyFat);
  const usingLean = Number.isFinite(leanKg);
  let maintain;
  if (usingLean) {
    const mult = ACTIVITY[activity] || ACTIVITY.sedentary;
    maintain = bmrKatch(weightKg, bodyFat) * mult;
  } else {
    maintain = tdee({ weightKg, heightCm, age, sex, activity });
  }
  if (!Number.isFinite(maintain)) {
    if ($('macroBlock')) $('macroBlock').hidden = true;
    return;
  }

  // Apply the goal adjustment, then clamp a fat-loss target to the calorie floor.
  let target = maintain * (GOAL_MULT[goal] || 1);
  const floor = CAL_FLOOR[sex] || CAL_FLOOR.male;
  let floored = false;
  if (target < floor) { target = floor; floored = true; }

  const presetOpts = PRESETS[preset] || PRESETS.balanced;
  const plan = macroPlan({
    calories: target,
    weightKg,
    goal,
    activity,
    leanKg: usingLean ? leanKg : undefined,
    ...presetOpts
  });
  if (!Number.isFinite(plan.calories)) {
    if ($('macroBlock')) $('macroBlock').hidden = true;
    return;
  }

  // Header: calorie target + how protein was anchored.
  const basis = usingLean ? 'lean body mass' : 'body weight';
  const goalWord = goal === 'lose' ? 'fat loss' : goal === 'gain' ? 'muscle gain' : 'maintenance';
  let header = `Daily plan for ${kcal(target)} kcal/day (${goalWord})`;
  if (floored) header += ' — at the safe minimum';
  header += '.';
  $('macroHeader').textContent = header;

  const gpkTxt = Number.isFinite(plan.protein.gPerKgLow)
    ? `${oneDp(plan.protein.gPerKgLow)}–${oneDp(plan.protein.gPerKgHigh)} g/kg ${basis}`
    : '';

  // Protein and carbs are shown as ranges (a recommendation is a band, not a
  // point); fat, fiber and water are single floor/adequate-intake targets.
  $('mProtein').textContent = gramsRange(plan.protein.gramsLow, plan.protein.gramsHigh);
  $('mProteinPerKg').textContent = gpkTxt;
  $('mCarb').textContent = gramsRange(plan.carb.gramsLow, plan.carb.gramsHigh);
  $('mFat').textContent = grams(plan.fat.grams);
  $('mFatKcal').textContent = kcal(plan.fat.kcal);
  $('mFiber').textContent = grams(plan.fiberGrams);
  $('mWater').textContent = litres(plan.waterMl);

  if ($('macroNote')) {
    $('macroNote').textContent = plan.note ? `Note: ${plan.note}.` : '';
    $('macroNote').hidden = !plan.note;
  }
  if ($('macroBlock')) $('macroBlock').hidden = false;
}

function init() {
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.addEventListener('click', () => showUnit(b.dataset.unit))
  );
  document.querySelectorAll('#idealForm input, #idealForm select').forEach((el) =>
    el.addEventListener('input', calc)
  );
  showUnit('metric');
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
