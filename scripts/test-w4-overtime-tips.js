// test-w4-overtime-tips.js — unit tests for the 2026 Form W-4 Step 4(b)
// overtime & tips withholding helper (estimateW4Adjustment). All expected
// values are the §8 fixtures from docs/w4-overtime-tips-spec.md, generated from
// the actual obbba-deduction.js engine against obbba-deductions-2026.json +
// tax-data-2026.json (2026 brackets, std ded $16,100/$32,200/$24,150).
// Run: node scripts/test-w4-overtime-tips.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  estimateW4Adjustment, W4_PAY_PERIODS, allowedDeduction, federalTaxSaved
} from '../src/engine/obbba-deduction.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const obbba = JSON.parse(readFileSync(join(__dirname, '../src/data/obbba-deductions-2026.json'), 'utf8'));
const taxData = JSON.parse(readFileSync(join(__dirname, '../src/data/tax-data-2026.json'), 'utf8'));
const federal = obbba.federal;
const fed = taxData.federal;

let pass = 0, fail = 0;
const approx = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
function eq(name, got, want, tol = 0.005) {
  if (approx(got, want, tol)) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${got}, want ${want}`); }
}
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${got}, want ${want}`); }
}
// Per-paycheck fixtures are the cent-rounded display of annualReduction/periods.
const cents = (n) => Math.round(n * 100) / 100;

const run = (o) => estimateW4Adjustment({ ...o, federal, fed });

// --- §8 fixtures (11 cases) -------------------------------------------------
// [id, status, income, freq, tipsIn, otPremiumIn, D_tips, D_ot, D_total, annualReduction, perPaycheck]
const F = [
  ['F1', 'single', 52000, 'weekly', 0, 3000, 0, 3000, 3000, 360.00, 6.92],
  ['F2', 'single', 38000, 'biweekly', 18000, 0, 18000, 0, 18000, 1990.00, 76.54],
  ['F3', 'married', 96000, 'semimonthly', 12000, 2500, 12000, 2500, 14500, 1740.00, 72.50],
  ['F4', 'head_of_household', 70000, 'monthly', 9000, 1760, 9000, 1760, 10760, 1291.20, 107.60],
  ['F5', 'single', 90000, 'weekly', 0, 15000, 0, 12500, 12500, 2750.00, 52.88],
  ['F6', 'single', 120000, 'monthly', 30000, 0, 25000, 0, 25000, 5500.00, 458.33],
  ['F7', 'single', 200000, 'biweekly', 0, 12500, 0, 7500, 7500, 1800.00, 69.23],
  ['F8', 'single', 420000, 'biweekly', 25000, 0, 0, 0, 0, 0.00, 0.00],
  ['F9', 'married', 280000, 'biweekly', 20000, 22000, 20000, 22000, 42000, 9968.00, 383.38],
  ['F10', 'single', 34000, 'weekly', 6000, 1350, 6000, 1350, 7350, 845.00, 16.25],
  ['F11', 'married', 340000, 'monthly', 0, 20000, 0, 20000, 20000, 4800.00, 400.00]
];

for (const [id, status, income, freq, tipsIn, otIn, eDt, eDo, eDtot, eAnn, ePer] of F) {
  const r = run({ income, filingStatus: status, tips: tipsIn, overtimePremium: otIn, payFrequency: freq });
  eq(`${id} D_tips (line 1a)`, r.dTips, eDt);
  eq(`${id} D_ot (line 1b)`, r.dOt, eDo);
  eq(`${id} D_total (line 15 add)`, r.dTotal, eDtot);
  eq(`${id} annual withholding reduction`, r.annualReduction, eAnn, 0.01); // cent-exact
  is(`${id} per paycheck`, cents(r.perPaycheck), ePer);                    // divisor check
  is(`${id} periodsPerYear`, r.periodsPerYear, W4_PAY_PERIODS[freq]);
}

// --- F9 load-bearing: ONE combined call, NOT the sum of two separate calls --
// $42k combined deduction crosses the MFJ 24%->22% edge -> exact $9,968, vs a
// naive per-deduction sum. Prove the engine uses the combined figure and that
// summing two separate federalTaxSaved calls gives a DIFFERENT (wrong) number.
{
  const income = 280000, status = 'married';
  const dTips = allowedDeduction({ eligibleAmount: 20000, filingStatus: status, magi: income, params: federal.tips }).deduction;
  const dOt = allowedDeduction({ eligibleAmount: 22000, filingStatus: status, magi: income, params: federal.overtime }).deduction;
  const combined = federalTaxSaved(income, status, dTips + dOt, fed).taxSaved;
  const summedSeparately = federalTaxSaved(income, status, dTips, fed).taxSaved
                         + federalTaxSaved(income, status, dOt, fed).taxSaved;
  eq('F9 combined == 9968', combined, 9968, 0.01);
  is('F9 combined != summed-separately', combined !== summedSeparately, true);
  eq('F9 engine uses combined', run({ income, filingStatus: status, tips: 20000, overtimePremium: 22000, payFrequency: 'biweekly' }).annualReduction, 9968, 0.01);
}

// --- per-frequency divisor unit tests (annualReduction / {52,26,24,12}) -----
// F3's annual reduction (1740) split across every frequency.
{
  const base = { income: 96000, filingStatus: 'married', tips: 12000, overtimePremium: 2500 };
  is('divisor map weekly', W4_PAY_PERIODS.weekly, 52);
  is('divisor map biweekly', W4_PAY_PERIODS.biweekly, 26);
  is('divisor map semimonthly', W4_PAY_PERIODS.semimonthly, 24);
  is('divisor map monthly', W4_PAY_PERIODS.monthly, 12);
  eq('per-paycheck weekly', run({ ...base, payFrequency: 'weekly' }).perPaycheck, 1740 / 52, 0.005);
  eq('per-paycheck biweekly', run({ ...base, payFrequency: 'biweekly' }).perPaycheck, 1740 / 26, 0.005);
  eq('per-paycheck semimonthly', run({ ...base, payFrequency: 'semimonthly' }).perPaycheck, 1740 / 24, 0.005);
  eq('per-paycheck monthly', run({ ...base, payFrequency: 'monthly' }).perPaycheck, 1740 / 12, 0.005);
}

// --- monthsRemaining < 12 proration (F3 with 6 months left) -----------------
// 6 months left of a semimonthly (24/yr) schedule -> 12 remaining periods ->
// 1740 / 12 = 145.00 per remaining check (higher than the full-year 72.50).
{
  const mid = run({ income: 96000, filingStatus: 'married', tips: 12000, overtimePremium: 2500, payFrequency: 'semimonthly', monthsRemaining: 6 });
  is('proration fullYear flag false', mid.fullYear, false);
  is('proration remainingPeriods', mid.remainingPeriods, 12);
  eq('proration per remaining check', mid.perPaycheckRemaining, 145.00, 0.005);
  is('proration per-remaining > full-year', mid.perPaycheckRemaining > mid.perPaycheck, true);
  // default (no monthsRemaining) is a full-year adjustment
  const full = run({ income: 96000, filingStatus: 'married', tips: 12000, overtimePremium: 2500, payFrequency: 'semimonthly' });
  is('default fullYear flag true', full.fullYear, true);
  is('default remainingPeriods == periodsPerYear', full.remainingPeriods, 24);
  eq('default perPaycheckRemaining == perPaycheck', full.perPaycheckRemaining, full.perPaycheck, 0.005);
}

// --- cap / phase-out flags surfaced for the UI ------------------------------
{
  const f5 = run({ income: 90000, filingStatus: 'single', tips: 0, overtimePremium: 15000, payFrequency: 'weekly' });
  is('F5 OT cap binds', f5.otCapBound, true);
  eq('F5 OT capped at 12500', f5.dOt, 12500);
  const f6 = run({ income: 120000, filingStatus: 'single', tips: 30000, overtimePremium: 0, payFrequency: 'monthly' });
  is('F6 tips cap binds', f6.tipsCapBound, true);
  eq('F6 tips capped at 25000', f6.dTips, 25000);
  const f7 = run({ income: 200000, filingStatus: 'single', tips: 0, overtimePremium: 12500, payFrequency: 'biweekly' });
  is('F7 OT gradual phase-out flag', f7.otPhasedOut, true);
  is('F7 anyPhasedOut', f7.anyPhasedOut, true);
  eq('F7 OT reduced to 7500', f7.dOt, 7500);
  const f8 = run({ income: 420000, filingStatus: 'single', tips: 25000, overtimePremium: 0, payFrequency: 'biweekly' });
  is('F8 tips fully phased out', f8.tips.fullyPhasedOut, true);
  eq('F8 D_total 0', f8.dTotal, 0);
  eq('F8 annual reduction 0', f8.annualReduction, 0);
  eq('F8 per paycheck 0', f8.perPaycheck, 0);
  is('F8 fica still applies', f8.ficaStillApplies, true);
}

console.log(`\nW-4 overtime/tips helper: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
