// test-amortization.js — unit tests for the pure amortization module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { monthlyPayment, amortize, monthsToPayoff } from '../src/engine/amortization.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// Known textbook example: $200,000 at 6% for 30 years ≈ $1,199.10/mo.
t('monthlyPayment: $200k at 6% for 30y ≈ $1199.10', () =>
  approx(monthlyPayment(200000, 6, 360), 1199.101050, 1e-3));

t('monthlyPayment: 0% interest is straight division', () =>
  approx(monthlyPayment(12000, 0, 12), 1000));

t('monthlyPayment: 0% does not produce NaN', () =>
  assert.ok(Number.isFinite(monthlyPayment(12000, 0, 24))));

t('monthlyPayment: negative principal is NaN', () =>
  assert.ok(Number.isNaN(monthlyPayment(-100, 5, 12))));

t('monthlyPayment: zero/negative term is NaN', () => {
  assert.ok(Number.isNaN(monthlyPayment(1000, 5, 0)));
  assert.ok(Number.isNaN(monthlyPayment(1000, 5, -12)));
});

t('monthlyPayment: bad input yields NaN', () =>
  assert.ok(Number.isNaN(monthlyPayment('abc', 5, 12))));

t('amortize: totalPaid = principal + totalInterest', () => {
  const r = amortize(200000, 6, 360);
  approx(r.totalPaid, 200000 + r.totalInterest, 1e-4);
});

t('amortize: $200k at 6% for 30y total interest ≈ $231,676', () => {
  const r = amortize(200000, 6, 360);
  approx(r.totalInterest, 231676.38, 1);
});

t('amortize: schedule length equals term months', () => {
  const r = amortize(200000, 6, 360);
  assert.equal(r.schedule.length, 360);
});

t('amortize: final balance is exactly zero (rounding settled)', () => {
  const r = amortize(200000, 6, 360);
  approx(r.schedule[r.schedule.length - 1].balance, 0, 1e-6);
});

t('amortize: 0% interest pays only principal back', () => {
  const r = amortize(12000, 0, 12);
  approx(r.totalInterest, 0);
  approx(r.totalPaid, 12000);
  approx(r.monthlyPayment, 1000);
});

t('amortize: { schedule: false } skips the schedule array', () => {
  const r = amortize(200000, 6, 360, { schedule: false });
  assert.equal(r.schedule.length, 0);
  assert.ok(Number.isFinite(r.monthlyPayment));
});

t('amortize: invalid input gives NaN totals, empty schedule', () => {
  const r = amortize(-5, 6, 360);
  assert.ok(Number.isNaN(r.monthlyPayment));
  assert.ok(Number.isNaN(r.totalPaid));
  assert.equal(r.schedule.length, 0);
});

// --- monthsToPayoff (debt payoff "by monthly payment" mode) -----------------

t('monthsToPayoff: $5,000 at 20% APR paying $200/mo ≈ 33 months', () => {
  const r = monthsToPayoff(5000, 20, 200);
  assert.equal(r.months, 33);
  assert.equal(r.neverPayoff, false);
});

t('monthsToPayoff: totalPaid = balance + totalInterest', () => {
  const r = monthsToPayoff(5000, 20, 200);
  approx(r.totalPaid, 5000 + r.totalInterest, 1e-6);
});

t('monthsToPayoff: payment below monthly interest flags never-payoff', () => {
  const r = monthsToPayoff(5000, 20, 80); // monthly interest is $83.33
  assert.equal(r.neverPayoff, true);
  approx(r.minPayment, 5000 * 0.20 / 12, 1e-9);
});

t('monthsToPayoff: payment exactly equal to interest never pays off', () => {
  const r = monthsToPayoff(5000, 24, 100); // 24% APR → $100/mo interest
  assert.equal(r.neverPayoff, true);
});

t('monthsToPayoff: 0% interest is balance / payment, rounded up', () => {
  const r = monthsToPayoff(1200, 0, 100);
  assert.equal(r.months, 12);
  approx(r.totalInterest, 0);
  assert.equal(r.neverPayoff, false);
});

t('monthsToPayoff: 0% with remainder rounds up to a final partial month', () => {
  const r = monthsToPayoff(1000, 0, 300);
  assert.equal(r.months, 4); // 300*3 = 900, last month clears 100
});

t('monthsToPayoff: invalid input yields NaN, not never-payoff', () => {
  const r = monthsToPayoff(-5, 20, 200);
  assert.ok(Number.isNaN(r.months));
  assert.equal(r.neverPayoff, false);
});

t('monthsToPayoff: zero/negative payment is NaN', () => {
  assert.ok(Number.isNaN(monthsToPayoff(5000, 20, 0).months));
  assert.ok(Number.isNaN(monthsToPayoff(5000, 20, -50).months));
});

console.log(`\n${pass} passing`);
