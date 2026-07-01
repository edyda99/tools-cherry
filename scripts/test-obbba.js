// test-obbba.js — unit tests for the OBBBA tips/overtime deduction engine.
// Run: node scripts/test-obbba.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { allowedDeduction, federalTaxSaved, overtimePremium, estimate } from '../src/engine/obbba-deduction.js';

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

console.log(`\nOBBBA engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
