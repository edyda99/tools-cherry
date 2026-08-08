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

// --- Connecticut: the 2% tax-rate phase-out add-back -------------------------
// Conn. Gen. Stat. 12-700(a)(10)(A)(ii)/(B)(ii)/(C)(ii), printed as DRS IP 2026(7) Table C.
// Every figure below is derived by hand from the statutory bracket schedule plus the ladder,
// NOT read off the engine. Bracket tax first, then the add-back.
//
//   single brackets      2% to 10,000 | 4.5% to 50,000 | 5.5% to 100,000 | 6% to 200,000
//   married brackets     2% to 20,000 | 4.5% to 100,000 | 5.5% to 200,000 | 6% to 400,000
//   head of household    2% to 16,000 | 4.5% to 80,000 | 5.5% to 160,000 | 6% to 320,000
//
// Connecticut has no standard deduction here, so taxable income equals the wage figure.
const ctTax = (amount, fs) =>
  computePaycheck(
    { wage: { type: 'salary', amount }, filingStatus: fs, payFrequency: 'annual', stateSlug: 'connecticut' },
    taxData
  ).annual.state;

t('Connecticut at the single threshold, $56,500: no add-back for anyone', () => {
  // The ladder starts ABOVE the threshold, so at exactly 56,500 a single filer owes $0 of it,
  // and married (starts 100,500) and head of household (starts 78,500) are nowhere near theirs.
  // single   10,000@2%=200 + 40,000@4.5%=1,800 + 6,500@5.5%=357.50            = 2,357.50
  approx(ctTax(56500, 'single'), 2357.5, 0.01);
  // married  20,000@2%=400 + 36,500@4.5%=1,642.50                             = 2,042.50
  approx(ctTax(56500, 'married'), 2042.5, 0.01);
  // hoh      16,000@2%=320 + 40,500@4.5%=1,822.50                             = 2,142.50
  approx(ctTax(56500, 'head_of_household'), 2142.5, 0.01);
});

t('Connecticut $75,000: single pays exactly $100 of add-back, others pay none', () => {
  // THE AUDIT ANCHOR. Single excess = 75,000 - 56,500 = 18,500. "Or fraction thereof" rounds
  // the rung count UP: ceil(18,500 / 5,000) = 4 rungs x $25 = $100.00. Table C, Withholding
  // Code F, agrees: the row "more than $71,500, less than or equal to $76,500" prints $100.
  // single   200 + 1,800 + 25,000@5.5%=1,375 = 3,375, plus 100                 = 3,475
  approx(ctTax(75000, 'single'), 3475, 0.01);
  // married  400 + 55,000@4.5%=2,475 = 2,875, add-back 0 (starts at 100,500)   = 2,875
  approx(ctTax(75000, 'married'), 2875, 0.01);
  // hoh      320 + 59,000@4.5%=2,655 = 2,975, add-back 0 (starts at 78,500)    = 2,975
  approx(ctTax(75000, 'head_of_household'), 2975, 0.01);
});

t('Connecticut $200,000: every status is pinned at the top of Table C', () => {
  // The ceiling is the 2% band emptied: single $250, hoh $400, married $500. 200,000 clears
  // all three "and up" rows (single above 101,500, hoh above 114,500, married above 145,500).
  // single   200 + 1,800 + 50,000@5.5%=2,750 + 100,000@6%=6,000 = 10,750, +250  = 11,000
  approx(ctTax(200000, 'single'), 11000, 0.01);
  // married  400 + 80,000@4.5%=3,600 + 100,000@5.5%=5,500 = 9,500, +500         = 10,000
  approx(ctTax(200000, 'married'), 10000, 0.01);
  // hoh      320 + 64,000@4.5%=2,880 + 80,000@5.5%=4,400 + 40,000@6%=2,400
  //          = 10,000, +400                                                     = 10,400
  approx(ctTax(200000, 'head_of_household'), 10400, 0.01);
});

t('Connecticut add-back steps on the first dollar past the threshold', () => {
  // "Or fraction thereof": $1 of excess buys a whole rung. The threshold test is strictly
  // greater than, so 56,500 itself is clean and 56,501 already carries the first $25.
  approx(ctTax(56501, 'single') - ctTax(56500, 'single'), 25 + 0.055, 0.01);
});

// --- Massachusetts: the FICA-paid deduction ----------------------------------
// M.G.L. c.62 s.3(B)(a)(3): deduct the FICA you paid, capped at $2,000 per taxpayer.
// MA gives a $4,400 personal exemption (single) and taxes at 5%. Employee FICA is 7.65%
// of wages up to the Social Security wage base, so the $2,000 cap binds from about
// $26,144 of wages upward and the deduction is worth a flat $2,000 x 5% = $100.00 a year.
const maTax = (amount, fs = 'single') =>
  computePaycheck(
    { wage: { type: 'salary', amount }, filingStatus: fs, payFrequency: 'annual', stateSlug: 'massachusetts' },
    taxData
  ).annual.state;

t('Massachusetts $40,000 single: cap binds, deduction is the full $2,000', () => {
  // FICA = 40,000 x 0.0765 = 3,060, above the cap. taxable = 40,000 - 4,400 - 2,000 = 33,600
  approx(maTax(40000), 33600 * 0.05, 0.01); // 1,680.00
});

t('Massachusetts $75,000 single: the audit anchor, exactly $100 less tax', () => {
  // FICA = 75,000 x 0.0765 = 5,737.50, above the cap. 75,000 - 4,400 - 2,000 = 68,600
  approx(maTax(75000), 68600 * 0.05, 0.01); // 3,430.00
  // and the deduction is worth exactly 2,000 x 5% = 100.00 versus the no-deduction figure
  approx((75000 - 4400) * 0.05 - maTax(75000), 100, 0.01);
});

t('Massachusetts $200,000 single: cap still binds, still $100', () => {
  // FICA = 184,500@6.2% = 11,439 + 200,000@1.45% = 2,900 -> 14,339, far above the cap.
  // taxable = 200,000 - 4,400 - 2,000 = 193,600, all below the 1,107,750 surtax line.
  approx(maTax(200000), 193600 * 0.05, 0.01); // 9,680.00
});

t('Massachusetts below the cap: the deduction is the FICA actually paid', () => {
  // The statute deducts FICA PAID, not a flat 2,000. At 20,000 of wages FICA is
  // 20,000 x 0.0765 = 1,530, under the cap, so only 1,530 comes off.
  // taxable = 20,000 - 4,400 - 1,530 = 14,070
  approx(maTax(20000), 14070 * 0.05, 0.01); // 703.50
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
