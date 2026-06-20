// test-discount.js — unit tests for the pure discount module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { salePrice, discountBreakdown, percentOffFromPrices } from '../src/engine/discount.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

t('salePrice basic values', () => {
  close(salePrice(80, 25), 60);
  close(salePrice(100, 0), 100);
  close(salePrice(100, 100), 0);
  close(salePrice(50, 10), 45);
});

t('salePrice rejects bad input with NaN', () => {
  assert.ok(Number.isNaN(salePrice('', 25)));
  assert.ok(Number.isNaN(salePrice(80, 'abc')));
});

t('discountBreakdown without tax or quantity', () => {
  const r = discountBreakdown({ price: 80, percentOff: 25 });
  close(r.saved, 20);
  close(r.sale, 60);
  close(r.taxAmount, 0);
  close(r.finalEach, 60);
  close(r.finalTotal, 60);
  assert.equal(r.quantity, 1);
});

t('discountBreakdown applies tax to the discounted price', () => {
  const r = discountBreakdown({ price: 100, percentOff: 20, taxPercent: 10 });
  close(r.sale, 80);
  close(r.taxAmount, 8);
  close(r.finalEach, 88);
  close(r.finalTotal, 88);
});

t('discountBreakdown multiplies by quantity', () => {
  const r = discountBreakdown({ price: 50, percentOff: 50, taxPercent: 0, quantity: 3 });
  close(r.saved, 75);   // 25 saved each × 3
  close(r.sale, 75);    // 25 each × 3
  close(r.finalEach, 25);
  close(r.finalTotal, 75);
  assert.equal(r.quantity, 3);
});

t('discountBreakdown floors fractional quantity', () => {
  const r = discountBreakdown({ price: 10, percentOff: 0, quantity: 2.9 });
  assert.equal(r.quantity, 2);
  close(r.finalTotal, 20);
});

t('discountBreakdown returns NaN for invalid input', () => {
  const bad = discountBreakdown({ price: '', percentOff: 25 });
  assert.ok(Number.isNaN(bad.finalTotal));
  const zeroQty = discountBreakdown({ price: 10, percentOff: 10, quantity: 0 });
  assert.ok(Number.isNaN(zeroQty.finalTotal));
});

t('percentOffFromPrices reverse calc', () => {
  close(percentOffFromPrices(80, 60), 25);
  close(percentOffFromPrices(100, 75), 25);
  close(percentOffFromPrices(50, 50), 0);
});

t('percentOffFromPrices rejects bad input with NaN', () => {
  assert.ok(Number.isNaN(percentOffFromPrices(0, 10)));
  assert.ok(Number.isNaN(percentOffFromPrices('', 10)));
});

console.log(`\n${pass} passing`);
