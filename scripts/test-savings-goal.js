// test-savings-goal.js — unit tests for the pure savings-goal module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { requiredContribution, timeToGoal, futureValue } from '../src/engine/savings-goal.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('requiredContribution with zero interest splits the gap evenly', () => {
  // No interest, no starting balance: $1200 over 1 year monthly = $100/mo.
  const r = requiredContribution(1200, 0, 0, 1, 12);
  close(r.contribution, 100);
  assert.equal(r.periods, 12);
  close(r.totalContributions, 1200);
  close(r.totalInterest, 0);
});

t('requiredContribution accounts for the starting balance (zero rate)', () => {
  // $1200 goal, $600 already saved, no interest, 1 year monthly => $50/mo.
  const r = requiredContribution(1200, 600, 0, 1, 12);
  close(r.contribution, 50);
  close(r.totalContributions, 600);
});

t('requiredContribution with interest round-trips through futureValue', () => {
  // Solve for C, then confirm P + that C grows to exactly the target.
  const target = 50000, P = 5000, apr = 6, years = 10, n = 12;
  const r = requiredContribution(target, P, apr, years, n);
  assert.ok(r.contribution > 0);
  const fv = futureValue(P, r.contribution, apr / 100 / n, r.periods);
  close(fv, target, 1e-3);
});

t('requiredContribution returns 0 when the starting balance already reaches the goal', () => {
  // $1000 at 10%/yr for 5 years already exceeds a $1200 target.
  const r = requiredContribution(1200, 1000, 10, 5, 12);
  assert.equal(r.contribution, 0);
  close(r.totalContributions, 0);
});

t('requiredContribution rejects invalid input with NaN', () => {
  assert.ok(Number.isNaN(requiredContribution('x', 0, 5, 10, 12).contribution));
  assert.ok(Number.isNaN(requiredContribution(1000, 0, 5, 0, 12).contribution));   // zero years
  assert.ok(Number.isNaN(requiredContribution(1000, 0, 5, 10, 0).contribution));   // zero periods
  assert.ok(Number.isNaN(requiredContribution(-1, 0, 5, 10, 12).contribution));    // negative target
});

t('timeToGoal with zero interest counts periods exactly', () => {
  // $100/mo, no interest, goal $1000 => 10 months.
  const r = timeToGoal(1000, 0, 0, 100, 12);
  assert.equal(r.periods, 10);
  assert.equal(r.years, 0);
  assert.equal(r.months, 10);
});

t('timeToGoal reaches goal sooner with interest than without', () => {
  const withInterest = timeToGoal(20000, 0, 8, 200, 12).periods;
  const without = timeToGoal(20000, 0, 0, 200, 12).periods;
  assert.ok(withInterest < without, `${withInterest} should be < ${without}`);
});

t('timeToGoal returns 0 periods when already at or above the goal', () => {
  const r = timeToGoal(1000, 1500, 5, 100, 12);
  assert.equal(r.periods, 0);
  assert.equal(r.finalBalance, 1500);
});

t('timeToGoal is NaN when the goal is unreachable within the cap', () => {
  // No starting balance, no contribution, no interest: never reaches $1000.
  const r = timeToGoal(1000, 0, 0, 0, 12);
  assert.ok(Number.isNaN(r.periods));
});

t('futureValue matches the closed-form annuity at zero rate', () => {
  close(futureValue(100, 50, 0, 12), 100 + 50 * 12);
});

console.log(`\n${pass} passing`);
