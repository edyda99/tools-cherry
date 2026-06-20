// test-inflation.js — unit tests for the pure inflation (CPI-U) math module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inflationValue,
  totalPercentChange,
  annualizedRate
} from '../src/engine/inflation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// --- inflationValue ----------------------------------------------------------
t('inflationValue: same CPI returns the amount unchanged', () =>
  approx(inflationValue(100, 200, 200), 100));
t('inflationValue: doubling the price level doubles the value', () =>
  approx(inflationValue(100, 100, 200), 200));
t('inflationValue: deflation reduces the value', () =>
  approx(inflationValue(100, 200, 100), 50));
t('inflationValue: accepts string input', () =>
  approx(inflationValue('50', '100', '150'), 75));
t('inflationValue: zero starting CPI is NaN (no divide-by-zero)', () =>
  assert.ok(Number.isNaN(inflationValue(100, 0, 200))));
t('inflationValue: bad amount is NaN', () =>
  assert.ok(Number.isNaN(inflationValue('abc', 100, 200))));

// --- totalPercentChange ------------------------------------------------------
t('totalPercentChange: 100 -> 125 is +25%', () =>
  approx(totalPercentChange(100, 125), 25));
t('totalPercentChange: 200 -> 100 is -50%', () =>
  approx(totalPercentChange(200, 100), -50));
t('totalPercentChange: zero start is NaN', () =>
  assert.ok(Number.isNaN(totalPercentChange(0, 100))));

// --- annualizedRate ----------------------------------------------------------
t('annualizedRate: doubling over 1 year is +100%', () =>
  approx(annualizedRate(100, 200, 1), 100));
t('annualizedRate: same year (0 years) is 0', () =>
  approx(annualizedRate(100, 200, 0), 0));
t('annualizedRate: compound check 100->121 over 2 years is ~10%/yr', () =>
  approx(annualizedRate(100, 121, 2), 10, 1e-6));
t('annualizedRate: negative years is NaN', () =>
  assert.ok(Number.isNaN(annualizedRate(100, 200, -3))));
t('annualizedRate: zero start CPI is NaN', () =>
  assert.ok(Number.isNaN(annualizedRate(0, 200, 5))));

// --- real-data sanity check against the bundled CPI table --------------------
const cpi = JSON.parse(
  await readFile(join(__dirname, '..', 'src', 'data', 'cpi-us.json'), 'utf8')
);

t('cpi-us.json: declares a BLS source and a throughYear', () => {
  assert.ok(/BLS|Bureau of Labor Statistics/i.test(cpi.source));
  assert.ok(Number.isInteger(cpi.throughYear));
});

t('cpi-us.json: throughYear is present in data and is the latest key', () => {
  const years = Object.keys(cpi.data).map(Number);
  assert.ok(cpi.data[String(cpi.throughYear)] > 0);
  assert.equal(Math.max(...years), cpi.throughYear);
});

t('cpi-us.json: every value is a positive finite number', () => {
  for (const [yr, v] of Object.entries(cpi.data)) {
    assert.ok(typeof v === 'number' && v > 0, `bad CPI for ${yr}: ${v}`);
  }
});

t('real data: $100 in 2000 is more than $150 by 2024', () => {
  const v = inflationValue(100, cpi.data['2000'], cpi.data['2024']);
  assert.ok(v > 150 && v < 250, `unexpected 2000->2024 value: ${v}`);
});

console.log(`\n${pass} passing`);
