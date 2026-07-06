// test-obbba.js — unit tests for the OBBBA tips/overtime deduction engine.
// Run: node scripts/test-obbba.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { allowedDeduction, federalTaxSaved, overtimePremium, estimate, seniorDeduction, estimateSenior, saltCap, saltComparison } from '../src/engine/obbba-deduction.js';

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

// --- SALT cap (IRC §164(b)(6) as amended by OBBBA §70120) -------------------
// All 14 fixtures from the sourced spec (obbba-salt-cap-spec.md, §4).
// Fixture filing statuses map to engine ids: mfj->married, mfs->married_separate.
// est_tax_saving_vs_old_cap in the fixtures is ILLUSTRATIVE at the stated flat
// marginal rate (asserted as benefit × rate); the production taxSaved uses the
// exact bracket-diff machinery and is spot-checked separately below.
const SALT = obbba.federal.salt;
const sc = (a) => saltComparison({ ...a, params: SALT, fed });
function saltFixture(id, inputs, exp) {
  const r = sc(inputs);
  eq(`${id} salt_cap`, r.effectiveCap, exp.salt_cap);
  eq(`${id} allowed_salt`, r.allowedSalt, exp.allowed_salt);
  eq(`${id} itemized_total`, r.itemizedTotal, exp.itemized_total);
  eq(`${id} allowed_salt_old`, r.allowedSaltOld, exp.allowed_salt_old);
  if (exp.standard_deduction === null) {
    is(`${id} SD null`, r.standardDeduction, null);
    is(`${id} itemize null`, r.itemize, null);
  } else {
    eq(`${id} standard_deduction`, r.standardDeduction, exp.standard_deduction);
    is(`${id} itemize`, r.itemize, exp.itemize);
    eq(`${id} itemized_old`, r.itemizedTotalOld, exp.itemized_old);
    eq(`${id} old_best_deduction`, r.bestOld, exp.old_best_deduction);
    eq(`${id} deduction_benefit`, r.deductionBenefit, exp.deduction_benefit_vs_old_cap);
    if (exp.assumed_marginal_rate != null) {
      eq(`${id} est_tax_saving_at_assumed_rate`,
         r.deductionBenefit * exp.assumed_marginal_rate, exp.est_tax_saving_vs_old_cap);
    }
  }
  return r;
}

// F1 2025 MFJ full new cap
saltFixture('F1', { year: 2025, filingStatus: 'married', magi: 300000, saltPaid: 28000 + 20000, otherItemized: 10000 },
  { salt_cap: 40000, allowed_salt: 40000, itemized_total: 50000, standard_deduction: 31500, itemize: true, allowed_salt_old: 10000, itemized_old: 20000, old_best_deduction: 31500, deduction_benefit_vs_old_cap: 18500, assumed_marginal_rate: 0.24, est_tax_saving_vs_old_cap: 4440 });
// F2 2025 single, SALT between 10k and 40k
saltFixture('F2', { year: 2025, filingStatus: 'single', magi: 150000, saltPaid: 12000 + 6000, otherItemized: 2000 },
  { salt_cap: 40000, allowed_salt: 18000, itemized_total: 20000, standard_deduction: 15750, itemize: true, allowed_salt_old: 10000, itemized_old: 12000, old_best_deduction: 15750, deduction_benefit_vs_old_cap: 4250, assumed_marginal_rate: 0.24, est_tax_saving_vs_old_cap: 1020 });
// F3 2025 MFJ phase-down midpoint: 40,000 − 0.3×50,000 = 25,000
const f3 = saltFixture('F3', { year: 2025, filingStatus: 'married', magi: 550000, saltPaid: 35000 + 10000, otherItemized: 15000 },
  { salt_cap: 25000, allowed_salt: 25000, itemized_total: 40000, standard_deduction: 31500, itemize: true, allowed_salt_old: 10000, itemized_old: 25000, old_best_deduction: 31500, deduction_benefit_vs_old_cap: 8500, assumed_marginal_rate: 0.35, est_tax_saving_vs_old_cap: 2975 });
is('F3 torpedoZone', f3.torpedoZone, true);
eq('F3 reduction', f3.reduction, 15000);
// F4 2025 MFJ exact floor touch at MAGI 600,000
const f4 = saltFixture('F4', { year: 2025, filingStatus: 'married', magi: 600000, saltPaid: 40000 + 15000, otherItemized: 25000 },
  { salt_cap: 10000, allowed_salt: 10000, itemized_total: 35000, standard_deduction: 31500, itemize: true, allowed_salt_old: 10000, itemized_old: 35000, old_best_deduction: 35000, deduction_benefit_vs_old_cap: 0 });
is('F4 floorReached', f4.floorReached, true);
is('F4 torpedoZone ends at floor', f4.torpedoZone, false);
eq('F4 floorMagi', f4.floorMagi, 600000);
// F5 2025 MFJ deep past floor (raw reduction 120,000 -> floor binds)
const f5 = saltFixture('F5', { year: 2025, filingStatus: 'married', magi: 900000, saltPaid: 60000 + 25000, otherItemized: 30000 },
  { salt_cap: 10000, allowed_salt: 10000, itemized_total: 40000, standard_deduction: 31500, itemize: true, allowed_salt_old: 10000, itemized_old: 40000, old_best_deduction: 40000, deduction_benefit_vs_old_cap: 0 });
is('F5 floorReached', f5.floorReached, true);
// F6 2025 MFS half cap + phase-down: 20,000 − 0.3×10,000 = 17,000, floor 5,000
const f6 = saltFixture('F6', { year: 2025, filingStatus: 'married_separate', magi: 260000, saltPaid: 15000 + 10000, otherItemized: 4000 },
  { salt_cap: 17000, allowed_salt: 17000, itemized_total: 21000, standard_deduction: 15750, itemize: true, allowed_salt_old: 5000, itemized_old: 9000, old_best_deduction: 15750, deduction_benefit_vs_old_cap: 5250, assumed_marginal_rate: 0.35, est_tax_saving_vs_old_cap: 1837.5 });
eq('F6 MFS base cap', f6.baseCap, 20000);
eq('F6 MFS threshold', f6.threshold, 250000);
eq('F6 MFS floor', f6.floor, 5000);
// F7 2025 single non-itemizer: standard deduction wins -> $0 benefit
const f7 = saltFixture('F7', { year: 2025, filingStatus: 'single', magi: 90000, saltPaid: 4000 + 2000, otherItemized: 3000 },
  { salt_cap: 40000, allowed_salt: 6000, itemized_total: 9000, standard_deduction: 15750, itemize: false, allowed_salt_old: 6000, itemized_old: 9000, old_best_deduction: 15750, deduction_benefit_vs_old_cap: 0 });
eq('F7 taxSaved 0', f7.taxSaved, 0);
// F8 2025 single, SALT below the old cap -> identical under both regimes
saltFixture('F8', { year: 2025, filingStatus: 'single', magi: 200000, saltPaid: 5000 + 3000, otherItemized: 9000 },
  { salt_cap: 40000, allowed_salt: 8000, itemized_total: 17000, standard_deduction: 15750, itemize: true, allowed_salt_old: 8000, itemized_old: 17000, old_best_deduction: 17000, deduction_benefit_vs_old_cap: 0 });
// F9 2026 MFJ indexed full cap ($40,400; threshold $505,000 not crossed)
saltFixture('F9', { year: 2026, filingStatus: 'married', magi: 480000, saltPaid: 36000 + 9000, otherItemized: 8000 },
  { salt_cap: 40400, allowed_salt: 40400, itemized_total: 48400, standard_deduction: 32200, itemize: true, allowed_salt_old: 10000, itemized_old: 18000, old_best_deduction: 32200, deduction_benefit_vs_old_cap: 16200, assumed_marginal_rate: 0.35, est_tax_saving_vs_old_cap: 5670 });
// F10 2026 MFJ phase-down: 40,400 − 0.3×15,000 = 35,900
saltFixture('F10', { year: 2026, filingStatus: 'married', magi: 520000, saltPaid: 42000 + 8000, otherItemized: 12000 },
  { salt_cap: 35900, allowed_salt: 35900, itemized_total: 47900, standard_deduction: 32200, itemize: true, allowed_salt_old: 10000, itemized_old: 22000, old_best_deduction: 32200, deduction_benefit_vs_old_cap: 15700, assumed_marginal_rate: 0.35, est_tax_saving_vs_old_cap: 5495 });
// F11 2026 single floor binds (40,400 − 31,500 = 8,900 < 10,000 -> floor)
const f11 = saltFixture('F11', { year: 2026, filingStatus: 'single', magi: 610000, saltPaid: 45000 + 12000, otherItemized: 8000 },
  { salt_cap: 10000, allowed_salt: 10000, itemized_total: 18000, standard_deduction: 16100, itemize: true, allowed_salt_old: 10000, itemized_old: 18000, old_best_deduction: 18000, deduction_benefit_vs_old_cap: 0 });
eq('F11 floorMagi 2026 single', f11.floorMagi, 505000 + 30400 / 0.3, 0.01);
// F12 2026 MFS phase-down above floor: 20,200 − 0.3×47,500 = 5,950
saltFixture('F12', { year: 2026, filingStatus: 'married_separate', magi: 300000, saltPaid: 9000 + 4000, otherItemized: 12000 },
  { salt_cap: 5950, allowed_salt: 5950, itemized_total: 17950, standard_deduction: 16100, itemize: true, allowed_salt_old: 5000, itemized_old: 17000, old_best_deduction: 17000, deduction_benefit_vs_old_cap: 950, assumed_marginal_rate: 0.35, est_tax_saving_vs_old_cap: 332.5 });
// F13 2027 MFJ indexed phase-down: cap 40,804, threshold 510,050 (exact integers);
// SD not yet published -> assert cap math + SALT-level delta only
const f13 = saltFixture('F13', { year: 2027, filingStatus: 'married', magi: 530050, saltPaid: 30000 + 12000, otherItemized: 10000 },
  { salt_cap: 34804, allowed_salt: 34804, itemized_total: 44804, standard_deduction: null, allowed_salt_old: 10000 });
eq('F13 salt_deduction_delta_vs_old_cap', f13.saltDeductionDelta, 24804);
// F14 2030 reversion: flat $10,000, NO phase-down at any income; SD unknown
const f14 = saltFixture('F14', { year: 2030, filingStatus: 'married', magi: 300000, saltPaid: 30000 + 18000, otherItemized: 10000 },
  { salt_cap: 10000, allowed_salt: 10000, itemized_total: 20000, standard_deduction: null, allowed_salt_old: 10000 });
is('F14 phase_down_applies false', f14.phasedDown, false);
is('F14 reverted note', f14.notes.includes('reverted'), true);

// Structure + spec-mandated extras beyond the 14 fixtures
// Pre-2025: old law, not-in-effect note, $10,000 cap
const pre = saltCap({ year: 2024, filingStatus: 'married', magi: 300000, saltPaid: 30000, params: SALT });
eq('SALT 2024 old cap', pre.effectiveCap, 10000);
is('SALT 2024 note', pre.notes.includes('not_in_effect'), true);
// 2030 MFS reversion is $5,000
eq('SALT 2030 MFS cap', saltCap({ year: 2030, filingStatus: 'married_separate', magi: 100000, saltPaid: 20000, params: SALT }).effectiveCap, 5000);
// Floor-reach endpoints from the spec: 2025 MFS -> $300,000; 2026 MFS -> $303,166.67
eq('SALT 2025 MFS floorMagi', saltCap({ year: 2025, filingStatus: 'married_separate', magi: 0, saltPaid: 0, params: SALT }).floorMagi, 300000);
eq('SALT 2026 MFS floorMagi', saltCap({ year: 2026, filingStatus: 'married_separate', magi: 0, saltPaid: 0, params: SALT }).floorMagi, 303166.67, 0.01);
// 2028-2029 pending-guidance flag (values publisher-rounded, not offered in the UI)
is('SALT 2028 pending note', saltCap({ year: 2028, filingStatus: 'single', magi: 0, saltPaid: 0, params: SALT }).notes.includes('pending_irs_guidance'), true);
// Bracket-diff taxSaved spot check, F1: MFJ, MAGI 300,000. Old best 31,500 ->
// taxable 268,500; new best 50,000 -> taxable 250,000. Both inside the 24%
// MFJ band (211,400–403,550) -> saved = 18,500 × 0.24 = 4,440.
const f1b = sc({ year: 2025, filingStatus: 'married', magi: 300000, saltPaid: 48000, otherItemized: 10000 });
eq('SALT F1 bracket-diff taxSaved', f1b.taxSaved, 4440);
eq('SALT F1 marginalRate', f1b.marginalRate, 0.24, 0.001);
// Genuine band-spanning diff, F3 inputs: MFJ, MAGI 550,000. Old best 31,500 ->
// taxable 518,500 (35% band, >512,450); new best 40,000 -> taxable 510,000 (32%).
// Saved = 6,050×0.35 + 2,450×0.32 = 2,901.50 on an 8,500 benefit.
const f3b = sc({ year: 2025, filingStatus: 'married', magi: 550000, saltPaid: 45000, otherItemized: 15000 });
eq('SALT F3 bracket-diff spanning 35->32', f3b.taxSaved, 2901.5);
// Benefit 0 -> taxSaved 0 through the bracket machinery too (F4 inputs)
eq('SALT F4 taxSaved 0', sc({ year: 2025, filingStatus: 'married', magi: 600000, saltPaid: 55000, otherItemized: 25000 }).taxSaved, 0);

console.log(`\nOBBBA engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
