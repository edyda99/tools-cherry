// test-mip.js — unit tests for the OBBBA mortgage insurance premium (MIP/PMI)
// deduction engine (IRC §163(h)(3)(E), revived permanently by OBBBA §70108).
// Run: node scripts/test-mip.js
//
// All 14 fixtures are from the sourced spec (docs/pmi-deduction-calculator-spec.md,
// §7). The fixtures' STATUTORY deduction outputs (qualifying premium, phaseout
// steps/fraction, deductible amount, itemize verdict, ineligibility flags) are
// load-bearing and hand-verified against the statute. The `taxSaved` values were
// REGENERATED here against the real exact-bracket-diff engine (2026 brackets +
// standard deductions), same convention as test-charitable.js — the spec
// describes taxSaved qualitatively ("bracket-diff on $X"), not as fixed dollar
// figures, so the engine's own output is asserted once verified by hand for a
// couple of anchor cases. Filing statuses map to engine ids: mfs -> married_separate.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  prepaidMipSlice, mipQualifyingPremium, mipDeduction, mipComparison
} from '../src/engine/obbba-deduction.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const obbba = JSON.parse(readFileSync(join(__dirname, '../src/data/obbba-deductions-2026.json'), 'utf8'));
const taxData = JSON.parse(readFileSync(join(__dirname, '../src/data/tax-data-2026.json'), 'utf8'));
const fed = taxData.federal;
const MIP = obbba.federal.mip;

let pass = 0, fail = 0;
const approx = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
function eq(name, got, want, tol = 0.5) {
  if (approx(got, want, tol)) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${got}, want ${want}`); }
}
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${got}, want ${want}`); }
}

// --- prepaidMipSlice: 84-month (or shorter term) ratable allocation --------
// F11: $6,125 UFMIP, closed June 2026 (month 6), 360-month (30-yr) term.
// amortMonths = min(84, 360) = 84; monthsIn2026 = 13-6 = 7; slice = 6125*7/84.
eq('prepaidMipSlice F11 slice', prepaidMipSlice({ upfrontPremium: 6125, closingMonth: 6, termMonths: 360, amortizationMonthsMax: 84 }).slice, 510.42, 0.01);
is('prepaidMipSlice F11 amortMonths', prepaidMipSlice({ upfrontPremium: 6125, closingMonth: 6, termMonths: 360, amortizationMonthsMax: 84 }).amortMonths, 84);
is('prepaidMipSlice F11 monthsIn2026', prepaidMipSlice({ upfrontPremium: 6125, closingMonth: 6, termMonths: 360, amortizationMonthsMax: 84 }).monthsIn2026, 7);
// Zero upfront premium -> zero slice, no error.
eq('prepaidMipSlice zero upfront', prepaidMipSlice({ upfrontPremium: 0, closingMonth: 6, termMonths: 360 }).slice, 0);
// A term SHORTER than 84 months (rare) caps the amortization to the term.
eq('prepaidMipSlice short term (36mo)', prepaidMipSlice({ upfrontPremium: 3600, closingMonth: 1, termMonths: 36 }).slice, 3600 / 36 * 12, 0.01);

// --- mipQualifyingPremium: VA/USDA exempt from amortization ----------------
const vaQP = mipQualifyingPremium({ mortgageInsuranceType: 'va', recurringPremiums: 0, upfrontPremium: 8000, params: MIP });
is('VA upfront exempt from amortization', vaQP.exemptFromAmortization, true);
eq('VA upfront fully qualifies', vaQP.qualifyingPremium, 8000);
const fhaQP = mipQualifyingPremium({ mortgageInsuranceType: 'fha', recurringPremiums: 1600, upfrontPremium: 6125, closingMonth: 6, termMonths: 360, params: MIP });
is('FHA upfront amortized (not exempt)', fhaQP.exemptFromAmortization, false);
eq('FHA qualifying premium (recurring + slice)', fhaQP.qualifyingPremium, 1600 + 510.42, 0.01);

// --- mipDeduction: the AGI phaseout (percentage-of-premium haircut) --------
// Fully phased out at exactly $109,000+1 (steps=10), still 10% alive AT $109,000 (steps=9).
is('phased out AT $109,000 exactly is NOT fully out', mipDeduction({ filingStatus: 'single', agi: 109000, qualifyingPremium: 2400, params: MIP }).fullyPhasedOut, false);
is('fully out just above $109,000', mipDeduction({ filingStatus: 'single', agi: 109001, qualifyingPremium: 2400, params: MIP }).fullyPhasedOut, true);
// MFS: eliminated above $54,500, NOT $55,000.
is('MFS not fully out at exactly $54,500', mipDeduction({ filingStatus: 'married_separate', agi: 54500, qualifyingPremium: 2000, params: MIP }).fullyPhasedOut, false);
is('MFS fully out just above $54,500', mipDeduction({ filingStatus: 'married_separate', agi: 54501, qualifyingPremium: 2000, params: MIP }).fullyPhasedOut, true);
// MFJ shares the single/HoH $100,000 threshold (no separate joint threshold).
is('MFJ shares the $100,000 threshold with single', MIP.phaseout.threshold.married, MIP.phaseout.threshold.single);
// Pre-2007 contract gate.
is('pre-2007 contract -> $0, ineligible flag', mipDeduction({ filingStatus: 'married', agi: 80000, qualifyingPremium: 2500, contractIssuedAfter2006: false, params: MIP }).deduction, 0);
is('pre-2007 contract note', mipDeduction({ filingStatus: 'married', agi: 80000, qualifyingPremium: 2500, contractIssuedAfter2006: false, params: MIP }).notes.includes('ineligible_pre2007'), true);

// --- The 14 spec fixtures (mipComparison) -----------------------------------
const mc = (a) => mipComparison({ ...a, params: MIP, fed });
function fixture(id, inputs, exp) {
  const r = mc(inputs);
  eq(`${id} qualifyingPremium`, r.qualifyingPremium, exp.qualifyingPremium, 0.01);
  eq(`${id} deduction`, r.deduction, exp.deduction, 0.01);
  if (exp.phasedOut != null) is(`${id} phasedOut`, r.phasedOut, exp.phasedOut);
  if (exp.fullyPhasedOut != null) is(`${id} fullyPhasedOut`, r.fullyPhasedOut, exp.fullyPhasedOut);
  if (exp.itemize != null) is(`${id} itemize`, r.itemize, exp.itemize);
  if (exp.taxSaved != null) eq(`${id} taxSaved`, r.taxSaved, exp.taxSaved);
  if (exp.notes) exp.notes.forEach((n) => is(`${id} has note ${n}`, r.notes.includes(n), true));
  return r;
}

// F1 clear full deduction below floor: single, 85k AGI, 2,400 monthly PMI, 18,000 other.
fixture('F1', { filingStatus: 'single', agi: 85000, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 2400, otherItemized: 18000 },
  { qualifyingPremium: 2400, deduction: 2400, phasedOut: false, itemize: true, taxSaved: 528 });

// F2 exactly at threshold: single, 100k AGI, 1,800, 17,000 other -> full, not phased out.
fixture('F2', { filingStatus: 'single', agi: 100000, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 1800, otherItemized: 17000 },
  { qualifyingPremium: 1800, deduction: 1800, phasedOut: false, itemize: true, taxSaved: 396 });

// F3 mid-phaseout: single, 104,500 AGI, 2,400, 18,000 other. excess 4,500 -> 5 steps -> 50% -> 1,200.
fixture('F3', { filingStatus: 'single', agi: 104500, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 2400, otherItemized: 18000 },
  { qualifyingPremium: 2400, deduction: 1200, phasedOut: true, itemize: true, taxSaved: 264 });

// F4 top edge, still alive: single, EXACTLY 109,000 AGI. 9 steps -> 90% off -> 240 (nonzero).
fixture('F4', { filingStatus: 'single', agi: 109000, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 2400, otherItemized: 18000 },
  { qualifyingPremium: 2400, deduction: 240, phasedOut: true, fullyPhasedOut: false, itemize: true, taxSaved: 52.8 });

// F5 fully phased out (corrects "$110k" press error): single, 109,001 AGI -> 10 steps -> $0.
fixture('F5', { filingStatus: 'single', agi: 109001, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 2400, otherItemized: 18000 },
  { qualifyingPremium: 2400, deduction: 0, fullyPhasedOut: true, itemize: true, taxSaved: 0, notes: ['fully_phased_out'] });

// F6 fraction-thereof step: single, 100,001 AGI, 2,000 premium. excess $1 -> 1 step -> 10% off -> 1,800.
fixture('F6', { filingStatus: 'single', agi: 100001, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 2000, otherItemized: 17000 },
  { qualifyingPremium: 2000, deduction: 1800, phasedOut: true, itemize: true, taxSaved: 396 });

// F7 MFS mid-phaseout: 52,250 AGI, 2,000 premium, 17,000 other. excess 2,250/500 -> 5 steps -> 50% -> 1,000.
fixture('F7', { filingStatus: 'married_separate', agi: 52250, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 2000, otherItemized: 17000 },
  { qualifyingPremium: 2000, deduction: 1000, phasedOut: true, itemize: true, taxSaved: 120 });

// F8 MFS fully out: 54,501 AGI (not $55k) -> ceil(4,501/500)=10 -> $0.
fixture('F8', { filingStatus: 'married_separate', agi: 54501, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 2000, otherItemized: 17000 },
  { qualifyingPremium: 2000, deduction: 0, fullyPhasedOut: true, itemize: true, taxSaved: 0 });

// F9 non-itemizer — inform, don't block: MFJ 95k AGI, 3,000 premium, 20,000 other.
// Deductible in full (3,000) but 23,000 < 32,200 std -> benefit $0; gap to itemize = $9,200.
const f9 = fixture('F9', { filingStatus: 'married', agi: 95000, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 3000, otherItemized: 20000 },
  { qualifyingPremium: 3000, deduction: 3000, phasedOut: false, itemize: false, taxSaved: 0 });
eq('F9 needMoreToItemize', f9.needMoreToItemize, 9200);

// F10 itemization tipping + phaseout combined: MFJ 105k AGI, 4,000 premium, 31,000 other.
// 5 steps -> allowed 2,000; total 33,000 > 32,200 -> itemize; incremental benefit over std = $800 only.
const f10 = fixture('F10', { filingStatus: 'married', agi: 105000, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 4000, otherItemized: 31000 },
  { qualifyingPremium: 4000, deduction: 2000, phasedOut: true, itemize: true, taxSaved: 96 });
eq('F10 deductionBenefit ($800 only)', f10.deductionBenefit, 800);

// F11 FHA UFMIP amortization: single, 90k AGI, UFMIP $6,125 (350k*1.75%) closed June 2026,
// 30-yr term, + $1,600 annual MIP. slice = 6,125*7/84 = 510.42; P = 2,110.42; no phaseout.
fixture('F11', { filingStatus: 'single', agi: 90000, mortgageInsuranceType: 'fha', recurringPremiums: 1600, upfrontPremium: 6125, closingMonth: 6, termMonths: 360, otherItemized: 19000 },
  { qualifyingPremium: 2110.42, deduction: 2110.42, phasedOut: false, itemize: true, taxSaved: 464.29 });

// F12 VA funding fee — year-paid in full: MFJ 98k AGI, $8,000 VA fee, no monthly MI, no amortization.
fixture('F12', { filingStatus: 'married', agi: 98000, mortgageInsuranceType: 'va', recurringPremiums: 0, upfrontPremium: 8000, otherItemized: 26000 },
  { qualifyingPremium: 8000, deduction: 8000, phasedOut: false, itemize: true, taxSaved: 216 });

// F13 upfront premium + fully phased out: single, 115k AGI, same UFMIP slice as F11 (no recurring).
// Phaseout wipes it to $0 regardless of amortization having already happened.
fixture('F13', { filingStatus: 'single', agi: 115000, mortgageInsuranceType: 'fha', recurringPremiums: 0, upfrontPremium: 6125, closingMonth: 6, termMonths: 360, otherItemized: 20000 },
  { qualifyingPremium: 510.42, deduction: 0, fullyPhasedOut: true, itemize: true, taxSaved: 0 });

// F14 pre-2007 contract: MFJ 80k AGI, 2,500 premium, contract issued 2006 -> $0, ineligible banner.
fixture('F14', { filingStatus: 'married', agi: 80000, mortgageInsuranceType: 'monthly_pmi', recurringPremiums: 2500, contractIssuedAfter2006: false, otherItemized: 35000 },
  { qualifyingPremium: 0, deduction: 0, taxSaved: 0, notes: ['ineligible_pre2007'] });

// --- structure / correction guards ------------------------------------------
// CORRECTION 1: fully eliminated above $109,000 ($54,500 MFS) — NOT $110,000/$55,000.
is('eliminatedAboveAgi single is 109000, not 110000', MIP.phaseout.eliminatedAboveAgi.single, 109000);
is('eliminatedAboveAgi MFS is 54500, not 55000', MIP.phaseout.eliminatedAboveAgi.married_separate, 54500);
// CORRECTION 2: no separate MFJ threshold — married/single/HoH all share $100,000.
is('married threshold == single threshold', MIP.phaseout.threshold.married, MIP.phaseout.threshold.single);
is('head_of_household threshold == single threshold', MIP.phaseout.threshold.head_of_household, MIP.phaseout.threshold.single);
is('MFS threshold is half ($50,000)', MIP.phaseout.threshold.married_separate, 50000);
// CORRECTION 3: permanent (no 2028 sunset), first year 2026.
is('permanent true', MIP.permanent, true);
is('firstYear 2026', MIP.firstYear, 2026);
is('not indexed', MIP.notIndexed, true);
// CORRECTION 4: VA/RHS exempt from the 84-month amortization rule.
is('VA/RHS exempt providers', JSON.stringify(MIP.prepaid.exemptProviders), JSON.stringify(['VA', 'RHS']));
is('amortization cap is 84 months', MIP.prepaid.amortizationMonthsMax, 84);
is('unamortized balance lost on early payoff', MIP.prepaid.unamortizedLostOnPayoff, true);
// CORRECTION 5: keys off AGI (not MAGI); itemizers only (no non-itemizer alternative).
is('agiBasis is AGI', MIP.agiBasis, 'AGI');
is('itemized-only (no non-itemizer alternative)', MIP.itemizedOnly, true);
// Seven-source citation list (statute + regs + IRS instructions + Pub 936 + Rev Proc).
is('seven sources', MIP.sources.length, 7);

console.log(`\nMIP engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
