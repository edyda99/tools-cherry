// test-bmi.js — unit tests for the pure bmi module. Run via `npm test`.
import assert from 'node:assert/strict';
import {
  bmiMetric,
  bmiImperial,
  category,
  healthyWeightRange
} from '../src/engine/bmi.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-2) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('bmiMetric: 70kg / 175cm ≈ 22.86', () => approx(bmiMetric(70, 175), 22.86));
t('bmiMetric: accepts string input', () => approx(bmiMetric('70', '175'), 22.86));
t('bmiImperial: 180lb / 70in ≈ 25.83', () => approx(bmiImperial(180, 70), 25.83));

t('category: 22.86 is Normal', () => assert.equal(category(22.86), 'Normal'));
t('category: 25.83 is Overweight', () => assert.equal(category(25.83), 'Overweight'));
t('category: 17 is Underweight', () => assert.equal(category(17), 'Underweight'));
t('category: 32 is Obese', () => assert.equal(category(32), 'Obese'));
t('category: 18.5 boundary is Normal', () => assert.equal(category(18.5), 'Normal'));
t('category: 25 boundary is Overweight', () => assert.equal(category(25), 'Overweight'));
t('category: 30 boundary is Obese', () => assert.equal(category(30), 'Obese'));

t('healthyWeightRange metric: 175cm ≈ 56.66–76.26 kg (BMI 18.5–24.9)', () => {
  const r = healthyWeightRange({ cm: 175 });
  approx(r.minKg, 56.66);
  approx(r.maxKg, 76.256);
});
t('healthyWeightRange imperial: 70in ≈ 128.9–173.6 lb (BMI 18.5–24.9)', () => {
  const r = healthyWeightRange({ inches: 70 });
  approx(r.minLb, 128.93, 0.1);
  approx(r.maxLb, 173.55, 0.1);
});

t('bad input yields NaN, not a wrong number', () => {
  assert.ok(Number.isNaN(bmiMetric('abc', 175)));
  assert.ok(Number.isNaN(bmiMetric(70, 0)));
  assert.ok(Number.isNaN(bmiImperial(-5, 70)));
});
t('category of NaN is empty string', () => assert.equal(category(NaN), ''));

console.log(`\n${pass} passing`);
