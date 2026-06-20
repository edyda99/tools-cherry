// test-ideal-weight.js — unit tests for the pure ideal-weight + macro module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  idealWeightKg,
  idealWeights,
  macros,
  macroPlan,
  proteinPerKg,
  proteinBand,
  leanMassKg,
  bmrKatch,
  KCAL_PER_GRAM
} from '../src/engine/ideal-weight.js';
// Reuse the existing TDEE engine, exactly as the browser tool does.
import { tdee } from '../src/engine/calories.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

const cm5ft10 = 70 * 2.54; // 5'10" in cm

t('Devine male 5\'10" ≈ 73 kg', () => {
  // 50 + 2.3 * (70 - 60) = 73
  close(idealWeightKg('devine', 'male', cm5ft10), 73, 1e-9);
});

t('Devine female 5\'10" ≈ 68.5 kg', () => {
  // 45.5 + 2.3 * 10 = 68.5
  close(idealWeightKg('devine', 'female', cm5ft10), 68.5, 1e-9);
});

t('Robinson male 5\'10" = 71 kg; Miller = 70.3; Hamwi = 75', () => {
  close(idealWeightKg('robinson', 'male', cm5ft10), 52 + 1.9 * 10, 1e-9); // 71
  close(idealWeightKg('miller', 'male', cm5ft10), 56.2 + 1.41 * 10, 1e-9); // 70.3
  close(idealWeightKg('hamwi', 'male', cm5ft10), 48 + 2.7 * 10, 1e-9); // 75
});

t('exactly 5 ft uses the formula base (no inches over)', () => {
  const cm5ft = 60 * 2.54;
  close(idealWeightKg('devine', 'male', cm5ft), 50, 1e-9);
  close(idealWeightKg('robinson', 'female', cm5ft), 49, 1e-9);
});

t('below 5 ft clamps to the base (no negative adjustment)', () => {
  const cm4ft10 = 58 * 2.54;
  close(idealWeightKg('devine', 'male', cm4ft10), 50, 1e-9);
});

t('idealWeights returns 4 formulas + low/high/average', () => {
  const r = idealWeights('male', cm5ft10);
  close(r.devine, 73, 1e-9);
  close(r.robinson, 71, 1e-9);
  close(r.miller, 70.3, 1e-9);
  close(r.hamwi, 75, 1e-9);
  close(r.low, 70.3, 1e-9);
  close(r.high, 75, 1e-9);
  close(r.average, (73 + 71 + 70.3 + 75) / 4, 1e-9);
});

t('unknown formula / bad height yields NaN', () => {
  assert.ok(Number.isNaN(idealWeightKg('bogus', 'male', cm5ft10)));
  assert.ok(Number.isNaN(idealWeightKg('devine', 'male', 0)));
  assert.ok(Number.isNaN(idealWeightKg('devine', 'male', 'x')));
  const bad = idealWeights('male', -1);
  assert.ok(Number.isNaN(bad.devine) && Number.isNaN(bad.average));
});

t('macros: default 30/40/30 split, kcal sums back to total', () => {
  const m = macros(2000);
  close(m.protein.kcal, 600, 1e-9);
  close(m.carb.kcal, 800, 1e-9);
  close(m.fat.kcal, 600, 1e-9);
  close(m.protein.kcal + m.carb.kcal + m.fat.kcal, 2000, 1e-9);
  // grams from Atwater factors
  close(m.protein.grams, 600 / 4, 1e-9); // 150 g
  close(m.carb.grams, 800 / 4, 1e-9); // 200 g
  close(m.fat.grams, 600 / 9, 1e-9); // ~66.7 g
});

t('macros: grams * kcal-per-gram reconstruct the calories', () => {
  const m = macros(2345);
  const reconstructed =
    m.protein.grams * KCAL_PER_GRAM.protein +
    m.carb.grams * KCAL_PER_GRAM.carb +
    m.fat.grams * KCAL_PER_GRAM.fat;
  close(reconstructed, 2345, 1e-9);
});

t('macros: custom ratios honored', () => {
  const m = macros(2000, { protein: 0.4, carb: 0.4, fat: 0.2 });
  close(m.protein.kcal, 800, 1e-9);
  close(m.fat.kcal, 400, 1e-9);
});

t('macros: bad input yields NaN fields', () => {
  const m = macros('x');
  assert.ok(Number.isNaN(m.protein.grams) && Number.isNaN(m.calories));
});

t('integration: TDEE from calories engine feeds the macro split', () => {
  // sedentary 30yo male, 175cm, 70kg -> known Mifflin TDEE
  const maintain = tdee({ weightKg: 70, heightCm: 175, age: 30, sex: 'male', activity: 'sedentary' });
  assert.ok(Number.isFinite(maintain) && maintain > 0);
  const m = macros(maintain);
  close(m.protein.kcal + m.carb.kcal + m.fat.kcal, maintain, 1e-6);
});

// --- Bodyweight-anchored nutrition plan ---------------------------------------

t('proteinPerKg: goal/activity table + fallbacks', () => {
  close(proteinPerKg('maintain', 'light'), 1.6, 1e-9);
  close(proteinPerKg('lose', 'veryActive'), 2.4, 1e-9);
  close(proteinPerKg('gain', 'sedentary'), 1.6, 1e-9);
  close(proteinPerKg('bogus', 'light'), 1.6, 1e-9); // unknown goal -> maintain row
  close(proteinPerKg('lose', 'bogus'), 2.0, 1e-9); // unknown activity -> moderate col
});

t('leanMassKg + bmrKatch: lean mass and Katch-McArdle', () => {
  close(leanMassKg(80, 25), 60, 1e-9); // 80 * (1 - .25)
  close(bmrKatch(80, 25), 370 + 21.6 * 60, 1e-9);
  assert.ok(Number.isNaN(leanMassKg(80, 0))); // bad body-fat%
  assert.ok(Number.isNaN(leanMassKg(80, 100)));
  assert.ok(Number.isNaN(bmrKatch(80, '')));
});

t('macroPlan: the 74 kg male regression — ~118 g protein at maintenance, not 175', () => {
  const maintain = tdee({ weightKg: 74, heightCm: 174, age: 27, sex: 'male', activity: 'light' });
  const plan = macroPlan({ calories: maintain, weightKg: 74, goal: 'maintain', activity: 'light' });
  close(plan.protein.gPerKg, 1.6, 1e-9);
  close(plan.protein.grams, 1.6 * 74, 1e-9); // 118.4 g
  assert.ok(plan.protein.grams < 130, 'protein must be far below the old 175 g');
});

t('macroPlan: protein + fat + carb kcal reconstruct the calorie target', () => {
  const plan = macroPlan({ calories: 2334, weightKg: 74, goal: 'maintain', activity: 'light' });
  const total = plan.protein.kcal + plan.carb.kcal + plan.fat.kcal;
  close(total, 2334, 1e-6);
});

t('macroPlan: fat never drops below the 0.8 g/kg floor', () => {
  // High protein + low calories: 25% fat would be tiny, floor must kick in.
  const plan = macroPlan({ calories: 1500, weightKg: 90, goal: 'lose', activity: 'veryActive', fatPct: 0.25 });
  assert.ok(plan.fat.grams >= 0.8 * 90 - 1e-9, 'fat held at the 0.8 g/kg floor');
});

t('macroPlan: lean-mass basis lowers protein vs bodyweight basis', () => {
  const byWeight = macroPlan({ calories: 2400, weightKg: 90, goal: 'lose', activity: 'active' });
  const byLean = macroPlan({ calories: 2400, weightKg: 90, goal: 'lose', activity: 'active', leanKg: 72 });
  assert.ok(byLean.protein.grams < byWeight.protein.grams);
  close(byLean.protein.grams, byLean.protein.gPerKg * 72, 1e-9);
});

t('macroPlan: keto pins carbs to the cap and floors fat', () => {
  const plan = macroPlan({ calories: 2000, weightKg: 80, goal: 'maintain', activity: 'light', ketoCarbG: 30 });
  close(plan.carb.grams, 30, 1e-9);
  assert.ok(plan.fat.grams >= 0.8 * 80 - 1e-9);
});

t('macroPlan: fiber 14 g/1000 kcal and water 35 ml/kg', () => {
  const plan = macroPlan({ calories: 2000, weightKg: 80, goal: 'maintain', activity: 'light' });
  close(plan.fiberGrams, 28, 1e-9); // 2000/1000 * 14
  close(plan.waterMl, 80 * 35, 1e-9); // 2800 ml
});

t('macroPlan: bad input yields NaN fields', () => {
  const plan = macroPlan({ calories: 'x', weightKg: 80 });
  assert.ok(Number.isNaN(plan.protein.grams) && Number.isNaN(plan.calories));
});

t('proteinBand: recommended value is the midpoint of the band', () => {
  const [lo, hi] = proteinBand('maintain', 'light');
  close(lo, 1.4, 1e-9);
  close(hi, 1.8, 1e-9);
  close(proteinPerKg('maintain', 'light'), (lo + hi) / 2, 1e-9); // 1.6
});

t('macroPlan: protein is a band straddling the recommended value', () => {
  const plan = macroPlan({ calories: 2334, weightKg: 74, goal: 'maintain', activity: 'light' });
  close(plan.protein.gramsLow, 1.4 * 74, 1e-9); // 103.6
  close(plan.protein.gramsHigh, 1.8 * 74, 1e-9); // 133.2
  assert.ok(plan.protein.gramsLow < plan.protein.grams && plan.protein.grams < plan.protein.gramsHigh);
});

t('macroPlan: carb band is the inverse of the protein band (more protein -> fewer carbs)', () => {
  const plan = macroPlan({ calories: 2334, weightKg: 74, goal: 'maintain', activity: 'light' });
  // carbLow pairs with the TOP of the protein band, carbHigh with the bottom.
  assert.ok(plan.carb.gramsLow < plan.carb.gramsHigh);
  close(plan.carb.gramsLow, plan.carb.gramsHigh - (plan.protein.gramsHigh - plan.protein.gramsLow), 1e-6);
});

console.log(`\n${pass} passing`);
