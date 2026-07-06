// test-obbba.js — unit tests for the OBBBA tips/overtime deduction engine.
// Run: node scripts/test-obbba.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { allowedDeduction, federalTaxSaved, overtimePremium, estimate, seniorDeduction, estimateSenior } from '../src/engine/obbba-deduction.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const obbba = JSON.parse(readFileSync(join(__dirname, '../src/data/obbba-deductions-2026.json'), 'utf8'));
const taxData = JSON.parse(readFileSync(join(__dirname, '../src/data/tax-data-2026.json'), 'utf8'));
const fed = taxData.federal;
const OT = obbba.federal.overtime;
const TIPS = obbba.federal.tips;

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

// --- allowedDeduction: cap + phase-out ------------------------------------
// OT single, below cap, no phase-out
eq('OT single below cap', allowedDeduction({ eligibleAmount: 5000, filingStatus: 'single', magi: 60000, params: OT }).deduction, 5000);
// OT single above cap -> capped at 12500
eq('OT single capped', allowedDeduction({ eligibleAmount: 20000, filingStatus: 'single', magi: 80000, params: OT }).deduction, 12500);
// OT single phase-out: MAGI 200k -> over 50k -> -50*100=5000 -> cap 7500
eq('OT single phaseout cap', allowedDeduction({ eligibleAmount: 30000, filingStatus: 'single', magi: 200000, params: OT }).allowedCap, 7500);
eq('OT single phaseout deduction', allowedDeduction({ eligibleAmount: 30000, filingStatus: 'single', magi: 200000, params: OT }).deduction, 7500);
// OT single full phase-out at/after 275k
is('OT single fully phased out', allowedDeduction({ eligibleAmount: 30000, filingStatus: 'single', magi: 280000, params: OT }).fullyPhasedOut, true);
eq('OT single full phaseout ded=0', allowedDeduction({ eligibleAmount: 30000, filingStatus: 'single', magi: 280000, params: OT }).deduction, 0);
// Phase-out "fraction thereof": MAGI 150001 -> 1 step -> cap 12400
eq('OT phaseout fraction', allowedDeduction({ eligibleAmount: 20000, filingStatus: 'single', magi: 150001, params: OT }).allowedCap, 12400);
// OT married cap 25000
eq('OT married cap', allowedDeduction({ eligibleAmount: 30000, filingStatus: 'married', magi: 120000, params: OT }).deduction, 25000);
// OT head_of_household uses single cap 12500
eq('OT hoh cap', allowedDeduction({ eligibleAmount: 30000, filingStatus: 'head_of_household', magi: 90000, params: OT }).deduction, 12500);

// Tips single cap 25000 (NOT doubled for joint)
eq('Tips single cap', allowedDeduction({ eligibleAmount: 30000, filingStatus: 'single', magi: 60000, params: TIPS }).deduction, 25000);
eq('Tips married cap (not doubled)', allowedDeduction({ eligibleAmount: 40000, filingStatus: 'married', magi: 120000, params: TIPS }).deduction, 25000);
// Tips full phase-out single at 400k
is('Tips single fully phased out at 400k', allowedDeduction({ eligibleAmount: 40000, filingStatus: 'single', magi: 400000, params: TIPS }).fullyPhasedOut, true);

// --- federalTaxSaved: exact bracket diff -----------------------------------
// $60k single, $5k deduction: taxable 43900 -> 38900, both in 12% band -> 600
eq('OT tax saved 12% band', federalTaxSaved(60000, 'single', 5000, fed).taxSaved, 600);
// $80k single, $12.5k deduction: taxable 63900 -> 51400, both >50400 (22%) -> 2750
eq('OT tax saved 22% band', federalTaxSaved(80000, 'single', 12500, fed).taxSaved, 2750);
// deduction spanning two bands: $55k single, $10k. taxable 38900 -> 28900.
// slice 38900..50400 not reached; both in 12% actually (38900<50400). saved=10000*.12=1200
eq('OT tax saved single 55k', federalTaxSaved(55000, 'single', 10000, fed).taxSaved, 1200);
// genuine band-spanning: taxable just above 50400. income 66600 single -> taxable 50500 (22%).
// deduct 5000 -> taxable 45500. 100 at 22% (50500->50400) + 4900 at 12% = 22+588=610
eq('OT tax saved spanning 22->12', federalTaxSaved(66600, 'single', 5000, fed).taxSaved, 610);
// zero deduction -> zero saved
eq('zero deduction zero saved', federalTaxSaved(60000, 'single', 0, fed).taxSaved, 0);

// --- overtimePremium -------------------------------------------------------
eq('premium 20/hr x100h', overtimePremium(20, 100), 1000);
eq('premium 0 rate', overtimePremium(0, 100), 0);

// --- estimate end-to-end ---------------------------------------------------
const e1 = estimate({ kind: 'overtime', eligibleAmount: 6000, grossAnnual: 60000, filingStatus: 'single', federal: obbba.federal, fed });
eq('estimate OT deduction', e1.deduction, 6000);
eq('estimate OT tax saved', e1.taxSaved, 720); // 6000 * 12%
is('estimate OT fica flag', e1.ficaStillApplies, true);
const e2 = estimate({ kind: 'tips', eligibleAmount: 30000, grossAnnual: 60000, filingStatus: 'single', federal: obbba.federal, fed });
eq('estimate tips deduction capped', e2.deduction, 25000);
eq('estimate tips tax saved', e2.taxSaved, 3000); // 25000 * 12% (taxable 43900->18900 both 12%)

// --- senior deduction (IRC §151(d)(5)(C)) ----------------------------------
// All 12 fixtures from the sourced spec (obbba-senior-deduction-spec.md, §5).
// Fixture filing statuses map to engine ids: mfj->married, hoh->head_of_household,
// mfs->married_separate. Ages map to booleans (65+ by Dec 31 of the tax year).
const SR = obbba.federal.senior;
const sr = (a) => seniorDeduction({ ...a, params: SR }).deduction;

// #1 single_full: MAGI 50,000 <= 75,000 -> 1 x 6,000
eq('SR single full', sr({ year: 2025, filingStatus: 'single', age65: true, spouseAge65: false, magi: 50000 }), 6000);
// #2 mfj_both_full: MAGI 100,000 <= 150,000 -> 2 x 6,000
eq('SR mfj both full', sr({ year: 2025, filingStatus: 'married', age65: true, spouseAge65: true, magi: 100000 }), 12000);
// #3 mfj_one_spouse_full: ages [66,60], MAGI 120,000 -> 1 x 6,000
eq('SR mfj one spouse full', sr({ year: 2026, filingStatus: 'married', age65: true, spouseAge65: false, magi: 120000 }), 6000);
// #4 hoh_partial_phaseout: HoH threshold is 75,000 (NOT 150,000). 6,000 - 6%*25,000 = 4,500
eq('SR hoh partial phaseout', sr({ year: 2026, filingStatus: 'head_of_household', age65: true, spouseAge65: false, magi: 100000 }), 4500);
// #5 mfj_both_midpoint: excess 50,000 -> per-person 3,000 x 2 = 6,000
eq('SR mfj both midpoint', sr({ year: 2025, filingStatus: 'married', age65: true, spouseAge65: true, magi: 200000 }), 6000);
// #6 single_exact_zero: excess 100,000 -> reduction 6,000 -> 0 (full phase-out point 175,000)
eq('SR single exact zero', sr({ year: 2025, filingStatus: 'single', age65: true, spouseAge65: false, magi: 175000 }), 0);
// #7 mfj_both_fully_phased: 260,000 -> per-person clamps to 0 (joint zero-out is 250,000, NOT 350,000)
eq('SR mfj both fully phased', sr({ year: 2027, filingStatus: 'married', age65: true, spouseAge65: true, magi: 260000 }), 0);
// #8 mfj_one_spouse_partial: excess 50,000 -> per-person 3,000, 1 qualified -> 3,000
eq('SR mfj one spouse partial', sr({ year: 2026, filingStatus: 'married', age65: true, spouseAge65: false, magi: 200000 }), 3000);
// #9 age_64_ineligible: not 65 by year-end -> 0
eq('SR age 64 ineligible', sr({ year: 2025, filingStatus: 'single', age65: false, spouseAge65: false, magi: 40000 }), 0);
// #10 mfs_disallowed: married but not filing jointly -> statute clause (v) denies -> 0
eq('SR mfs disallowed', sr({ year: 2025, filingStatus: 'married_separate', age65: true, spouseAge65: false, magi: 40000 }), 0);
// #11 expired_2029: only taxable years 2025-2028 -> 0
eq('SR expired 2029', sr({ year: 2029, filingStatus: 'single', age65: true, spouseAge65: false, magi: 50000 }), 0);
// #12 edge_born_jan_1: born 1961-01-01 -> Schedule 1-A 'born before January 2, 1961'
// QUALIFIES for TY2025 (attains 65 the day before the 65th birthday), i.e. age65=true
eq('SR born Jan 1 1961 qualifies', sr({ year: 2025, filingStatus: 'single', age65: true, spouseAge65: false, magi: 60000 }), 6000);

// Structure + spec-mandated extras beyond the 12 fixtures
// QSS uses the $75,000 threshold (statute grants $150,000 only to 'a joint return')
eq('SR qss threshold 75k', sr({ year: 2025, filingStatus: 'qss', age65: true, spouseAge65: false, magi: 100000 }), 4500);
const mid = seniorDeduction({ year: 2025, filingStatus: 'married', age65: true, spouseAge65: true, magi: 200000, params: SR });
is('SR midpoint eligibleCount', mid.eligibleCount, 2);
eq('SR midpoint before-phaseout', mid.deductionBeforePhaseout, 12000);
eq('SR midpoint reduction', mid.phaseoutReduction, 6000);
is('SR midpoint phasedOut flag', mid.phasedOut, true);
is('SR mfs note', seniorDeduction({ year: 2025, filingStatus: 'married_separate', age65: true, spouseAge65: false, magi: 40000, params: SR }).notes.includes('mfs_denied'), true);
is('SR expired note', seniorDeduction({ year: 2029, filingStatus: 'single', age65: true, spouseAge65: false, magi: 50000, params: SR }).notes.includes('not_in_effect'), true);

// estimateSenior end-to-end: single 65+, MAGI 50k -> taxable 33,900 -> 27,900, both 12% band -> 720
const s1 = estimateSenior({ year: 2025, filingStatus: 'single', age65: true, spouseAge65: false, magi: 50000, federal: obbba.federal, fed });
eq('SR estimate deduction', s1.deduction, 6000);
eq('SR estimate tax saved 12% band', s1.taxSaved, 720);
// MFS end-to-end: deduction 0 -> saved 0
eq('SR estimate mfs saved 0', estimateSenior({ year: 2025, filingStatus: 'married_separate', age65: true, spouseAge65: false, magi: 40000, federal: obbba.federal, fed }).taxSaved, 0);

console.log(`\nOBBBA engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
