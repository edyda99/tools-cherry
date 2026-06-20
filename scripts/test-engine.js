// test-engine.js — smoke tests for the federal + FICA core, validated via Texas
// (no state tax). Run: npm test. Numbers depend on tax-data-2026.json figures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyBrackets,
  annualizeGross,
  computePaycheck,
  federalBracketBreakdown
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

// --- advanced mode: deductions + W-4 ----------------------------------------
t('adv omitted == adv all-zero (backward compatible)', () => {
  const base = { wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'texas' };
  const a = computePaycheck(base, taxData);
  const b = computePaycheck({ ...base, adv: { retirement401k: 0, cafeteria125: 0, dependentsCredit: 0, extraWithholding: 0, postTax: 0 } }, taxData);
  approx(a.annual.net, b.annual.net, 0.001);
  approx(a.annual.federal, b.annual.federal, 0.001);
});

t('401(k) cuts federal income tax but NOT FICA', () => {
  const base = { wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'texas' };
  const plain = computePaycheck(base, taxData);
  const r = computePaycheck({ ...base, adv: { retirement401k: 10000 } }, taxData);
  // federal taxable drops by 10000 -> at 12% marginal that's 1200 less federal
  approx(plain.annual.federal - r.annual.federal, 1200);
  // FICA unchanged (401k is FICA-taxable)
  approx(r.annual.socialSecurity + r.annual.medicare, plain.annual.socialSecurity + plain.annual.medicare, 0.01);
  // pre-tax shows in breakdown and reduces net by 401k + the federal tax saving
  approx(r.annual.preTax, 10000);
  approx(r.annual.net, plain.annual.net - 10000 + 1200);
});

t('cafeteria (HSA/premiums) cuts BOTH income tax and FICA', () => {
  const base = { wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'texas' };
  const plain = computePaycheck(base, taxData);
  const r = computePaycheck({ ...base, adv: { cafeteria125: 10000 } }, taxData);
  // FICA wages drop by 10000 -> 765 less FICA
  approx((plain.annual.socialSecurity + plain.annual.medicare) - (r.annual.socialSecurity + r.annual.medicare), 765);
  // federal also drops by 1200 (12% of 10000)
  approx(plain.annual.federal - r.annual.federal, 1200);
});

t('dependents credit reduces federal, floored at 0', () => {
  const base = { wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'texas' };
  const plain = computePaycheck(base, taxData);
  const r = computePaycheck({ ...base, adv: { dependentsCredit: 2000 } }, taxData);
  approx(plain.annual.federal - r.annual.federal, 2000);
  // huge credit can't push federal below 0
  const z = computePaycheck({ ...base, adv: { dependentsCredit: 999999 } }, taxData);
  assert.equal(z.annual.federal, 0);
});

t('extra withholding adds to federal; post-tax cuts net only', () => {
  const base = { wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'texas' };
  const plain = computePaycheck(base, taxData);
  const r = computePaycheck({ ...base, adv: { extraWithholding: 1200, postTax: 3000 } }, taxData);
  approx(r.annual.federal - plain.annual.federal, 1200);
  approx(r.annual.postTax, 3000);
  approx(r.annual.net, plain.annual.net - 1200 - 3000);
});

t('state tax also respects pre-tax (Pennsylvania flat)', () => {
  const base = { wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'pennsylvania' };
  const r = computePaycheck({ ...base, adv: { retirement401k: 10000 } }, taxData);
  approx(r.annual.state, (60000 - 10000) * 0.0307);
});

// --- federal bracket breakdown ----------------------------------------------
t('bracketBreakdown: bands sum to applyBrackets, marginal = top band', () => {
  const fed = taxData.federal;
  const bb = federalBracketBreakdown(60000, 'single', fed); // taxable 43,900
  approx(bb.taxable, 60000 - fed.standardDeduction.single, 0.01);
  const sumBandTax = bb.bands.reduce((s, b) => s + b.tax, 0);
  approx(sumBandTax, applyBrackets(bb.taxable, fed.brackets.single), 0.5);
  // 43,900 taxable falls in the 12% band (ends 50,400-ish) -> marginal 12%
  approx(bb.marginalRate, 0.12, 0.0001);
  // amounts only cover up to taxable (no empty higher bands beyond the one containing it)
  approx(bb.bands.reduce((s, b) => s + b.amount, 0), bb.taxable, 0.01);
});

t('bracketBreakdown: zero taxable -> first-band marginal, no tax', () => {
  const bb = federalBracketBreakdown(5000, 'single', taxData.federal); // below std deduction
  assert.equal(bb.taxable, 0);
  approx(bb.bands.reduce((s, b) => s + b.tax, 0), 0, 0.001);
});

console.log(`\n${pass} passing`);
