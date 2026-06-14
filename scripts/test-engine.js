// test-engine.js — smoke tests for the federal + FICA core, validated via Texas
// (no state tax). Run: npm test. Numbers depend on tax-data-2026.json figures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyBrackets,
  annualizeGross,
  computePaycheck
} from '../src/engine/paycheck-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const taxData = JSON.parse(
  await readFile(join(__dirname, '..', 'src', 'data', 'tax-data-2026.json'), 'utf8')
);

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 0.5) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// --- bracket math ------------------------------------------------------------
t('applyBrackets: zero/negative income is 0', () => {
  assert.equal(applyBrackets(0, taxData.federal.brackets.single), 0);
  assert.equal(applyBrackets(-5, taxData.federal.brackets.single), 0);
});

t('applyBrackets: first-band only (single)', () => {
  // 10,000 taxable, all in 10% band
  approx(applyBrackets(10000, taxData.federal.brackets.single), 1000);
});

t('applyBrackets: spans 10% + 12% bands (single)', () => {
  // band1 ends 12,400 -> 1,240 ; remaining (20,000-12,400)=7,600 @12% = 912
  approx(applyBrackets(20000, taxData.federal.brackets.single), 1240 + 912);
});

// --- annualize ---------------------------------------------------------------
t('annualizeGross: hourly = rate*hours*52', () => {
  assert.equal(annualizeGross({ type: 'hourly', amount: 25, hoursPerWeek: 40 }), 52000);
});
t('annualizeGross: salary passthrough', () => {
  assert.equal(annualizeGross({ type: 'salary', amount: 80000 }), 80000);
});

// --- full paycheck, Texas (no state tax) -------------------------------------
t('Texas $60k single biweekly: state tax = 0, sane net', () => {
  const r = computePaycheck(
    { wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'biweekly', stateSlug: 'texas' },
    taxData
  );
  assert.equal(r.annual.state, 0);
  // FICA = 60000 * (0.062+0.0145) = 4590
  approx(r.annual.socialSecurity + r.annual.medicare, 4590);
  // Federal: taxable = 60000-16100 = 43900. 12400@10=1240; (43900-12400)@12=3780 => 5020
  approx(r.annual.federal, 5020);
  // net annual = 60000 - 5020 - 4590 = 50390
  approx(r.annual.net, 50390);
  // biweekly net = 50390/26
  approx(r.perPaycheck.net, 50390 / 26, 0.01);
});

t('SS caps at wage base for high earners', () => {
  const r = computePaycheck(
    { wage: { type: 'salary', amount: 500000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'texas' },
    taxData
  );
  approx(r.annual.socialSecurity, taxData.federal.fica.socialSecurity.wageBase * 0.062);
});

// --- state tax paths ---------------------------------------------------------
t('Pennsylvania flat, no deduction: 3.07% of gross', () => {
  const r = computePaycheck(
    { wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'pennsylvania' },
    taxData
  );
  approx(r.annual.state, 60000 * 0.0307);
});

t('North Carolina flat after standard deduction', () => {
  const r = computePaycheck(
    { wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'north-carolina' },
    taxData
  );
  approx(r.annual.state, (60000 - 12750) * 0.0399);
});

t('Mississippi 0% on first $10k of taxable income', () => {
  const r = computePaycheck(
    { wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'mississippi' },
    taxData
  );
  // taxable = 60000 - 8300 = 51700; first 10000 @0%, remaining 41700 @4% = 1668
  approx(r.annual.state, 1668);
});

console.log(`\n${pass} passing`);
