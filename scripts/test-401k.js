// test-401k.js — unit tests for the pure 401(k) retirement projection module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  employerMatchForYear,
  project
} from '../src/engine/retirement-401k.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

t('employerMatchForYear: dollar-for-dollar within cap', () => {
  // 6% contrib, 100% match, 6% cap, $60k salary => 6% of 60k = 3600
  close(employerMatchForYear(60000, 6, 100, 6), 3600, 1e-9);
});

t('employerMatchForYear: contribution above cap is capped', () => {
  // 10% contrib but cap is 6% => match is on 6% only, full dollar => 3600
  close(employerMatchForYear(60000, 10, 100, 6), 3600, 1e-9);
});

t('employerMatchForYear: 50% match honored', () => {
  // 6% contrib, 50% match, 6% cap, $60k => 0.5 * 6% * 60k = 1800
  close(employerMatchForYear(60000, 6, 50, 6), 1800, 1e-9);
});

t('employerMatchForYear: contribution below cap matched only on what is given', () => {
  // 4% contrib, 100% match, 6% cap => match on 4% only => 2400
  close(employerMatchForYear(60000, 4, 100, 6), 2400, 1e-9);
});

t('project: known one-year scenario matches hand calc', () => {
  // age 64 -> 65 (1 year), start 100000, salary 100000, 10% contrib,
  // 100% match, 5% cap, 8% return, no salary growth.
  const r = project(64, 65, 100000, 100000, 10, 100, 5, 8, { salaryGrowthPct: 0 });
  const employee = 100000 * 0.10;            // 10000
  const match = 100000 * 0.05 * 1.0;         // 5000 (capped at 5%)
  const base = 100000 + employee + match;    // 115000
  const growth = base * 0.08;                // 9200
  const end = base + growth;                 // 124200
  close(r.totalEmployeeContributions, employee, 1e-9);
  close(r.totalEmployerMatch, match, 1e-9);
  close(r.totalGrowth, growth, 1e-9);
  close(r.projectedBalance, end, 1e-9);
  assert.equal(r.schedule.length, 1);
  assert.equal(r.schedule[0].age, 65);
});

t('project: growth = endBalance - startBalance - contributions - match', () => {
  const start = 25000;
  const r = project(30, 65, start, 60000, 6, 100, 6, 7, { salaryGrowthPct: 2 });
  const derivedGrowth =
    r.projectedBalance - start - r.totalEmployeeContributions - r.totalEmployerMatch;
  close(r.totalGrowth, derivedGrowth, 1e-4);
  assert.ok(r.totalGrowth > 0);
});

t('project: 35 years => 35 schedule rows, ages chain, balances chain', () => {
  const r = project(30, 65, 25000, 60000, 6, 100, 6, 7, { salaryGrowthPct: 2 });
  assert.equal(r.schedule.length, 35);
  assert.equal(r.schedule[0].age, 31);
  assert.equal(r.schedule[34].age, 65);
  // last row's end balance equals the headline projected balance
  close(r.schedule[34].balanceEnd, r.projectedBalance, 1e-6);
  // each row's growth recomputes from its own base
  for (let i = 0; i < r.schedule.length; i++) {
    const prevEnd = i === 0 ? 25000 : r.schedule[i - 1].balanceEnd;
    const base = prevEnd + r.schedule[i].employeeContribution + r.schedule[i].employerMatch;
    close(r.schedule[i].growth, base * 0.07, 1e-4);
    close(r.schedule[i].balanceEnd, base + base * 0.07, 1e-4);
  }
});

t('project: salary growth increases later contributions', () => {
  const r = project(30, 65, 0, 50000, 10, 0, 0, 6, { salaryGrowthPct: 3 });
  // first year contribution on 50000, later years on grown salary
  close(r.schedule[0].employeeContribution, 5000, 1e-6);
  assert.ok(r.schedule[34].employeeContribution > r.schedule[0].employeeContribution);
  // no employer match configured
  close(r.totalEmployerMatch, 0, 1e-9);
});

t('project: no employer match still grows from contributions + return', () => {
  const r = project(40, 41, 0, 100000, 10, 0, 0, 0, { salaryGrowthPct: 0 });
  // 1 year, 0% return => balance is just the contribution
  close(r.projectedBalance, 10000, 1e-9);
  close(r.totalGrowth, 0, 1e-9);
});

t('invalid input yields NaN, not a throw', () => {
  // retirement age not after current age
  assert.ok(Number.isNaN(project(65, 65, 1000, 50000, 6, 100, 6, 7).projectedBalance));
  assert.ok(Number.isNaN(project(70, 65, 1000, 50000, 6, 100, 6, 7).projectedBalance));
  // bad numeric input
  assert.ok(Number.isNaN(project('x', 65, 1000, 50000, 6, 100, 6, 7).projectedBalance));
  // negative balance
  assert.ok(Number.isNaN(project(30, 65, -1, 50000, 6, 100, 6, 7).projectedBalance));
  // employerMatchForYear bad input
  assert.ok(Number.isNaN(employerMatchForYear('x', 6, 100, 6)));
});

console.log(`\n${pass} passing`);
