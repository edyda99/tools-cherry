// test-cagr.js — unit tests for the pure CAGR module. Run via `npm test`.
import assert from 'node:assert/strict';
import { cagr, totalGrowth, project } from '../src/engine/cagr.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

t('cagr: doubling over a known period', () => {
  // 1000 -> 2000 over 10y: (2)^(1/10) - 1
  close(cagr(1000, 2000, 10), Math.pow(2, 1 / 10) - 1);
  // 100 -> 200 over 1y = 100% growth
  close(cagr(100, 200, 1), 1);
});

t('cagr: no growth and decline', () => {
  close(cagr(500, 500, 5), 0);          // flat
  close(cagr(1000, 500, 1), -0.5);      // halved in a year = -50%
});

t('cagr: invalid input -> NaN', () => {
  assert.ok(Number.isNaN(cagr(0, 1000, 5)));     // beginning must be > 0
  assert.ok(Number.isNaN(cagr(1000, 2000, 0)));  // years must be > 0
  assert.ok(Number.isNaN(cagr(-100, 200, 5)));   // negative beginning
  assert.ok(Number.isNaN(cagr('x', 200, 5)));    // non-numeric
});

t('totalGrowth: simple ratio', () => {
  close(totalGrowth(1000, 2500), 1.5);  // +150%
  close(totalGrowth(1000, 1000), 0);
  close(totalGrowth(2000, 1000), -0.5);
});

t('project: schedule endpoints and length', () => {
  const r = project(1000, 2000, 10);
  close(r.cagr, Math.pow(2, 1 / 10) - 1);
  close(r.totalGrowth, 1);
  assert.equal(r.schedule.length, 11);          // year 0..10
  close(r.schedule[0].value, 1000);
  close(r.schedule[10].value, 2000);            // pinned to ending
  close(r.schedule[10].year, 10);
});

t('project: each step grows at the constant rate', () => {
  const r = project(1000, 2000, 10);
  const ratio = r.schedule[2].value / r.schedule[1].value;
  close(ratio, 1 + r.cagr, 1e-9);
});

t('project: fractional years pin the tail to ending', () => {
  const r = project(1000, 1500, 5.5);
  const last = r.schedule[r.schedule.length - 1];
  close(last.year, 5.5);
  close(last.value, 1500);
});

t('project: invalid -> NaN-filled', () => {
  const r = project(0, 100, 5);
  assert.ok(Number.isNaN(r.cagr));
  assert.deepEqual(r.schedule, []);
});

console.log(`\n${pass} CAGR test(s) passed.`);
