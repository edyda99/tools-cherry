// test-percentage.js — unit tests for the pure percentage-math module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  percentOf,
  whatPercent,
  percentChange,
  discount
} from '../src/engine/percentage-math.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('percentOf: 20% of 150 is 30', () => approx(percentOf(20, 150), 30));
t('percentOf: 0% of anything is 0', () => approx(percentOf(0, 999), 0));
t('percentOf: accepts string input', () => approx(percentOf('25', '80'), 20));

t('whatPercent: 30 of 120 is 25%', () => approx(whatPercent(30, 120), 25));
t('whatPercent: divide-by-zero is NaN', () =>
  assert.ok(Number.isNaN(whatPercent(5, 0))));

t('percentChange: 100 -> 125 is +25%', () => approx(percentChange(100, 125), 25));
t('percentChange: 100 -> 80 is -20%', () => approx(percentChange(100, 80), -20));
t('percentChange: from zero is NaN', () =>
  assert.ok(Number.isNaN(percentChange(0, 50))));

t('discount: $80 at 25% off -> $60 final, $20 saved', () => {
  const d = discount(80, 25);
  approx(d.final, 60);
  approx(d.saved, 20);
});

t('bad input yields NaN, not a wrong number', () =>
  assert.ok(Number.isNaN(percentOf('abc', 10))));

console.log(`\n${pass} passing`);
