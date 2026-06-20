// test-calories.js — unit tests for the pure calories module. Run via `npm test`.
import assert from 'node:assert/strict';
import {
  bmr,
  tdee,
  goals,
  lbToKg,
  ftInToCm,
  ACTIVITY
} from '../src/engine/calories.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-2) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// Mifflin–St Jeor worked examples.
// Male 80kg, 180cm, 30y: 10*80 + 6.25*180 − 5*30 + 5 = 800 + 1125 − 150 + 5 = 1780
t('bmr male 80kg/180cm/30y = 1780', () =>
  approx(bmr({ weightKg: 80, heightCm: 180, age: 30, sex: 'male' }), 1780));
// Female 65kg, 165cm, 30y: 10*65 + 6.25*165 − 5*30 − 161 = 650 + 1031.25 − 150 − 161 = 1370.25
t('bmr female 65kg/165cm/30y = 1370.25', () =>
  approx(bmr({ weightKg: 65, heightCm: 165, age: 30, sex: 'female' }), 1370.25));
t('bmr accepts string input', () =>
  approx(bmr({ weightKg: '80', heightCm: '180', age: '30', sex: 'male' }), 1780));

t('tdee = bmr × moderate (1.55)', () =>
  approx(tdee({ weightKg: 80, heightCm: 180, age: 30, sex: 'male', activity: 'moderate' }), 1780 * 1.55));
t('tdee unknown activity defaults to sedentary', () =>
  approx(tdee({ weightKg: 80, heightCm: 180, age: 30, sex: 'male', activity: 'bogus' }), 1780 * 1.2));
t('ACTIVITY has the five standard tiers', () =>
  assert.deepEqual(Object.keys(ACTIVITY), ['sedentary', 'light', 'moderate', 'active', 'veryActive']));

t('goals offsets from a 2000 maintenance', () => {
  const g = goals(2000);
  assert.equal(g.maintain, 2000);
  assert.equal(g.mildLoss, 1750);
  assert.equal(g.loss, 1500);
  assert.equal(g.extremeLoss, 1000);
  assert.equal(g.mildGain, 2250);
  assert.equal(g.gain, 2500);
});

t('lbToKg 154lb ≈ 69.85kg', () => approx(lbToKg(154), 69.8532, 1e-3));
t('ftInToCm 5ft9in ≈ 175.26cm', () => approx(ftInToCm(5, 9), 175.26));
t('ftInToCm allows a blank inches part', () => approx(ftInToCm(6, ''), 182.88));

t('bad input yields NaN, not a wrong number', () => {
  assert.ok(Number.isNaN(bmr({ weightKg: 'abc', heightCm: 180, age: 30, sex: 'male' })));
  assert.ok(Number.isNaN(bmr({ weightKg: 80, heightCm: 0, age: 30, sex: 'male' })));
  assert.ok(Number.isNaN(tdee({ weightKg: -5, heightCm: 180, age: 30, sex: 'male', activity: 'light' })));
  assert.ok(Number.isNaN(lbToKg(-1)));
  assert.ok(Number.isNaN(ftInToCm('', '')));
});
t('goals of NaN yields NaN fields', () => assert.ok(Number.isNaN(goals(NaN).maintain)));

console.log(`\n${pass} passing`);
