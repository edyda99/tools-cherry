// test-compound-interest.js — unit tests for the pure compound-interest module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  futureValuePrincipal,
  futureValueContributions,
  project
} from '../src/engine/compound-interest.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

t('futureValuePrincipal: annual compounding', () => {
  // $1000 at 5% for 10y, compounded yearly = 1000 * 1.05^10
  close(futureValuePrincipal(1000, 5, 10, 1), 1000 * Math.pow(1.05, 10), 1e-9);
  // 0% rate -> unchanged principal
  close(futureValuePrincipal(1000, 0, 10, 12), 1000, 1e-9);
  // 0 years -> unchanged principal
  close(futureValuePrincipal(2500, 7, 0, 12), 2500, 1e-9);
});

t('futureValuePrincipal: monthly compounding > annual', () => {
  const monthly = futureValuePrincipal(1000, 12, 1, 12);
  const yearly = futureValuePrincipal(1000, 12, 1, 1);
  assert.ok(monthly > yearly);
  close(monthly, 1000 * Math.pow(1 + 0.12 / 12, 12), 1e-9);
});

t('futureValueContributions: ordinary annuity closed form', () => {
  // $100/period, 1% per period, 12 periods (e.g. 12% annual monthly, 1 year)
  const r = 0.12 / 12, N = 12;
  const expected = 100 * (Math.pow(1 + r, N) - 1) / r;
  close(futureValueContributions(100, 12, 1, 12, false), expected, 1e-9);
});

t('futureValueContributions: 0% is just sum of deposits', () => {
  close(futureValueContributions(100, 0, 2, 12, false), 100 * 24, 1e-9);
});

t('futureValueContributions: annuity due > ordinary', () => {
  const due = futureValueContributions(100, 6, 5, 12, true);
  const ord = futureValueContributions(100, 6, 5, 12, false);
  assert.ok(due > ord);
  close(due, ord * (1 + 0.06 / 12), 1e-9);
});

t('project: future value = principal FV + contributions FV (ordinary)', () => {
  const P = 5000, C = 200, apr = 6, years = 20, n = 12;
  const r = project(P, C, apr, years, n, { atStart: false });
  const expected =
    futureValuePrincipal(P, apr, years, n) +
    futureValueContributions(C, apr, years, n, false);
  close(r.futureValue, expected, 1e-4);
});

t('project: totals decompose correctly', () => {
  const r = project(1000, 100, 5, 10, 12, { atStart: false });
  close(r.totalPrincipal, 1000, 1e-9);
  close(r.totalContributions, 100 * 120, 1e-9);
  close(r.totalInterest, r.futureValue - r.totalPrincipal - r.totalContributions, 1e-6);
  assert.ok(r.totalInterest > 0);
});

t('project: schedule has one row per year, balances chain', () => {
  const r = project(1000, 50, 4, 7, 12, { atStart: false });
  assert.equal(r.schedule.length, 7);
  assert.equal(r.schedule[0].year, 1);
  assert.equal(r.schedule[6].year, 7);
  // last year's end balance equals the headline future value
  close(r.schedule[6].balanceEnd, r.futureValue, 1e-6);
  // each year's start matches the prior year's end
  for (let i = 1; i < r.schedule.length; i++) {
    close(r.schedule[i].balanceStart, r.schedule[i - 1].balanceEnd, 1e-6);
  }
});

t('project: principal-only (no contributions) matches FV formula', () => {
  const r = project(10000, 0, 5, 30, 1, { atStart: false });
  close(r.totalContributions, 0, 1e-9);
  close(r.futureValue, futureValuePrincipal(10000, 5, 30, 1), 1e-4);
});

t('invalid input yields NaN, not a throw', () => {
  assert.ok(Number.isNaN(futureValuePrincipal('x', 5, 10, 12)));
  assert.ok(Number.isNaN(futureValuePrincipal(1000, 5, -1, 12)));
  assert.ok(Number.isNaN(futureValueContributions(100, 5, 5, 0, false)));
  const r = project(-100, 0, 5, 10, 12);
  assert.ok(Number.isNaN(r.futureValue));
});

console.log(`\n${pass} passing`);
