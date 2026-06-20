// test-sales-tax.js — unit tests for the pure sales-tax module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { addTax, removeTax } from '../src/engine/sales-tax.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('addTax: $100 + 8.25% -> $8.25 tax, $108.25 total', () => {
  const r = addTax(100, 8.25);
  approx(r.tax, 8.25);
  approx(r.total, 108.25);
  approx(r.price, 100);
});

t('addTax: 0% adds no tax', () => {
  const r = addTax(50, 0);
  approx(r.tax, 0);
  approx(r.total, 50);
});

t('addTax: accepts string input', () => {
  const r = addTax('200', '10');
  approx(r.tax, 20);
  approx(r.total, 220);
});

t('removeTax: $108.25 @ 8.25% -> $100.00 pre-tax, $8.25 tax', () => {
  const r = removeTax(108.25, 8.25);
  approx(r.price, 100);
  approx(r.tax, 8.25);
  approx(r.total, 108.25);
});

t('removeTax: 0% leaves price unchanged', () => {
  const r = removeTax(75, 0);
  approx(r.price, 75);
  approx(r.tax, 0);
});

t('roundtrip: addTax then removeTax recovers the price', () => {
  const added = addTax(249.99, 7.5);
  const removed = removeTax(added.total, 7.5);
  approx(removed.price, 249.99);
});

t('removeTax: -100% (zero divisor) yields NaN', () =>
  assert.ok(Number.isNaN(removeTax(100, -100).price)));

t('addTax: bad input yields NaN, not a wrong number', () =>
  assert.ok(Number.isNaN(addTax('abc', 10).tax)));

console.log(`\n${pass} passing`);
