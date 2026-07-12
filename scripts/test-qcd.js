// test-qcd.js — unit tests for the QCD vs. Charitable Deduction engine
// (src/engine/qcd-comparison.js). Run: node scripts/test-qcd.js
//
// All 12 fixtures are from the sourced spec (docs/qcd-vs-charitable-deduction-
// spec.md, §8, Q1-Q12). Per the spec's own instruction, the spec's hand-
// estimated dollar figures are ILLUSTRATIVE ONLY (they said so verbatim: "the
// dollar taxA/taxB/qcdSavesFederalTax below are illustrative ... regenerate
// every dollar at build time with the real engine and lock, exactly as the
// charitable/SALT/W-4 specs did"). The dollar assertions below were
// REGENERATED against the real exact-bracket-diff engine (2026 brackets +
// standard deduction + the 65+ addition) and are what's asserted — they turn
// out to match the spec's illustrative figures almost exactly (Q1 $1,125,
// Q2 $2,160, Q3 $228, Q5 $0, Q6 $896 — all exact), which cross-checks both
// the spec's hand math and this engine.
//
// Load-bearing structural checks (per spec §8): AGI on each path, qcdAmount,
// overLimit, RMD-satisfied, eligibility, the itemize verdict, and the SIGN of
// qcdSavesFederalTax (never negative; $0 at/below the §170(p) cap, per
// CORRECTION 2 — QCD never loses on federal income tax, but it can tie).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { qcdComparison, additionalStdDeduction65 } from '../src/engine/qcd-comparison.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const obbba = JSON.parse(readFileSync(join(__dirname, '../src/data/obbba-deductions-2026.json'), 'utf8'));
const taxData = JSON.parse(readFileSync(join(__dirname, '../src/data/tax-data-2026.json'), 'utf8'));
const fed = taxData.federal;
const QCD = obbba.federal.qcd;
const CH = obbba.federal.charitable;

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
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL ${name}: condition false`); }
}

const cc = (a) => qcdComparison({ ...a, qcd: QCD, charitable: CH, fed, year: a.year ?? 2026 });

// --- Data/statute guards ------------------------------------------------
is('2026 QCD limit is $111,000 (NOT the stale $108,000)', QCD.annualLimitByYear['2026'], 111000);
is('2025 QCD limit is $108,000', QCD.annualLimitByYear['2025'], 108000);
is('2026 one-time split-interest is $55,000', QCD.splitInterestOneTimeByYear['2026'], 55000);
is('age eligible is 70.5, NOT the RMD age', QCD.ageEligible, 70.5);
is('RMD age is 73', QCD.rmdAge2023plus, 73);
is('QCD excluded from gross income', QCD.excludedFromGrossIncome, true);
is('QCD not subject to withholding', QCD.notSubjectToWithholding, true);
is('2026 age-65+ addition (single/HoH) is $2,050', QCD.ageStandardDeductionAddition.byYear['2026'].single, 2050);
is('2026 age-65+ addition per MFJ spouse is $1,650', QCD.ageStandardDeductionAddition.byYear['2026'].marriedPerSpouse, 1650);

// --- additionalStdDeduction65 helper -------------------------------------
eq('sd65 add single', additionalStdDeduction65({ filingStatus: 'single', year: 2026, qcd: QCD }), 2050);
eq('sd65 add HoH', additionalStdDeduction65({ filingStatus: 'head_of_household', year: 2026, qcd: QCD }), 2050);
eq('sd65 add MFJ one spouse (default)', additionalStdDeduction65({ filingStatus: 'married', year: 2026, qcd: QCD }), 1650);
eq('sd65 add MFJ both spouses 65+', additionalStdDeduction65({ filingStatus: 'married', spouseAlsoQualifies: true, year: 2026, qcd: QCD }), 3300);

// --- Q1: non-itemizer, clear win (single, 75, 60k AGI, $10,000 donation) ---
const q1 = cc({ filingStatus: 'single', age: 75, donation: 10000, baseAgi: 60000, otherItemized: 0 });
is('Q1 eligible', q1.eligible, true);
eq('Q1 sd65 = 16,100 + 2,050', q1.sd65, 18150);
eq('Q1 qcdAmount', q1.qcdAmount, 10000);
eq('Q1 overLimit', q1.overLimit, 0);
eq('Q1 agiA (unchanged)', q1.agiA, 60000);
eq('Q1 agiB (full distribution taxable)', q1.agiB, 70000);
is('Q1 itemize B (standard wins)', q1.resB.itemize, false);
eq('Q1 nonItemizerDed = $1,000 cap', q1.resB.nonItemizerDed, 1000);
eq('Q1 qcdSavesFederalTax', q1.qcdSavesFederalTax, 1125, 1);
eq('Q1 agiKeptLowerBy == qcdAmount', q1.agiKeptLowerBy, q1.qcdAmount);

// --- Q2: non-itemizer, MFJ (married, 74, 90k AGI, $20,000 donation) --------
const q2 = cc({ filingStatus: 'married', age: 74, donation: 20000, baseAgi: 90000, otherItemized: 0 });
is('Q2 eligible', q2.eligible, true);
eq('Q2 sd65 = 32,200 + 1,650', q2.sd65, 33850);
eq('Q2 qcdAmount', q2.qcdAmount, 20000);
eq('Q2 agiA', q2.agiA, 90000);
eq('Q2 agiB', q2.agiB, 110000);
eq('Q2 nonItemizerDed = $2,000 MFJ cap', q2.resB.nonItemizerDed, 2000);
eq('Q2 qcdSavesFederalTax', q2.qcdSavesFederalTax, 2160, 1);

// --- Q3: itemizer near the floor (single, 72, 150k AGI, $40,000 donation, $25,000 other) ---
const q3 = cc({ filingStatus: 'single', age: 72, donation: 40000, baseAgi: 150000, otherItemized: 25000 });
is('Q3 eligible', q3.eligible, true);
eq('Q3 qcdAmount', q3.qcdAmount, 40000);
eq('Q3 agiA (unchanged)', q3.agiA, 150000);
eq('Q3 agiB', q3.agiB, 190000);
is('Q3 itemize B', q3.resB.itemize, true);
// floor lost on Path B = 0.5% x 190,000 = 950; tax edge ~= floor x marginal 24% = 228
eq('Q3 qcdSavesFederalTax ~= floor x marginal rate', q3.qcdSavesFederalTax, 228, 2);
ok('Q3 qcdSavesFederalTax > 0', q3.qcdSavesFederalTax > 0);

// --- Q4: over the $111k limit (hybrid) (single, 78, 200k AGI, $150,000 donation) ---
const q4 = cc({ filingStatus: 'single', age: 78, donation: 150000, baseAgi: 200000, otherItemized: 0 });
is('Q4 eligible', q4.eligible, true);
eq('Q4 qcdAmount = $111,000 cap', q4.qcdAmount, 111000);
eq('Q4 overLimit = $39,000 remainder', q4.overLimit, 39000);
eq('Q4 agiA = base + overLimit', q4.agiA, 239000);
eq('Q4 agiB = base + full donation', q4.agiB, 350000);
eq('Q4 agiKeptLowerBy = $111,000', q4.agiKeptLowerBy, 111000);
ok('Q4 over_annual_limit note present', q4.notes.includes('over_annual_limit'));
ok('Q4 qcdSavesFederalTax >= 0 (small; AGI gap is the real story)', q4.qcdSavesFederalTax >= 0);

// --- Q5: gift <= §170(p) cap -- TIE on tax (CORRECTION 2) ------------------
const q5 = cc({ filingStatus: 'single', age: 71, donation: 900, baseAgi: 55000, otherItemized: 0 });
is('Q5 eligible', q5.eligible, true);
eq('Q5 qcdAmount', q5.qcdAmount, 900);
eq('Q5 agiB', q5.agiB, 55900);
eq('Q5 qcdSavesFederalTax == 0 (TIE)', q5.qcdSavesFederalTax, 0, 0.01);
ok('Q5 tax_tie note present', q5.notes.includes('tax_tie'));
eq('Q5 agiKeptLowerBy still 900 (AGI is where QCD wins)', q5.agiKeptLowerBy, 900);

// --- Q6: high-AGI itemizer, floor bites (married, 76, 500k AGI, $60,000 donation, $45,000 other) ---
const q6 = cc({ filingStatus: 'married', age: 76, donation: 60000, baseAgi: 500000, otherItemized: 45000 });
is('Q6 eligible', q6.eligible, true);
is('Q6 itemize B', q6.resB.itemize, true);
eq('Q6 qcdSavesFederalTax ~= floor x marginal rate', q6.qcdSavesFederalTax, 896, 2);

// --- Q7: UNDER 70½ -- not eligible (single, 68, 80k AGI, $5,000 donation) --
const q7 = cc({ filingStatus: 'single', age: 68, donation: 5000, baseAgi: 80000, otherItemized: 0 });
is('Q7 NOT eligible (under 70.5)', q7.eligible, false);
ok('Q7 under_70_half note present', q7.notes.includes('under_70_half'));
is('Q7 qcdAmount blocked at 0', q7.qcdAmount, 0);
is('Q7 agiA is null (no QCD column)', q7.agiA, null);
is('Q7 taxA is null', q7.taxA, null);
eq('Q7 agiB = base + full donation (Path B only)', q7.agiB, 85000);
is('Q7 qcdSavesFederalTax is null (not computed)', q7.qcdSavesFederalTax, null);

// --- Q8: RMD-satisfying QCD (single, 75, 70k AGI, $8,000 donation) ---------
const q8 = cc({ filingStatus: 'single', age: 75, donation: 8000, baseAgi: 70000, otherItemized: 0, rmdAmount: 20000 });
is('Q8 eligible', q8.eligible, true);
is('Q8 isRmdAge (75 >= 73)', q8.isRmdAge, true);
eq('Q8 rmdSatisfiedByQcd = min(8000, 20000)', q8.rmdSatisfiedByQcd, 8000);
ok('Q8 qcdSavesFederalTax > 0 (QCD wins)', q8.qcdSavesFederalTax > 0);

// --- Q9: QCD exactly at the limit (married, 80, 300k AGI, $111,000 donation, $20,000 other) ---
const q9 = cc({ filingStatus: 'married', age: 80, donation: 111000, baseAgi: 300000, otherItemized: 20000 });
is('Q9 eligible', q9.eligible, true);
eq('Q9 qcdAmount exactly at the $111,000 limit', q9.qcdAmount, 111000);
eq('Q9 overLimit = 0 (boundary)', q9.overLimit, 0);
eq('Q9 agiA (unchanged)', q9.agiA, 300000);
eq('Q9 agiB', q9.agiB, 411000);
ok('Q9 qcdSavesFederalTax > 0', q9.qcdSavesFederalTax > 0);

// --- Q10: post-70½ deductible-contribution offset (single, 73, 120k AGI, $15,000 donation, $5,000 offset) ---
const q10 = cc({ filingStatus: 'single', age: 73, donation: 15000, baseAgi: 120000, otherItemized: 0, post70DeductibleContribs: 5000 });
is('Q10 eligible', q10.eligible, true);
eq('Q10 qcdAmount reduced to $10,000 (15,000 - 5,000 offset)', q10.qcdAmount, 10000);
eq('Q10 overLimit = $5,000 taxable', q10.overLimit, 5000);
eq('Q10 agiA = base + 5,000 remainder', q10.agiA, 125000);
eq('Q10 agiB = base + full 15,000', q10.agiB, 135000);
ok('Q10 post70_offset_applied note present', q10.notes.includes('post70_offset_applied'));

// --- Q11: §68 top-bracket itemizer (married, 77, 900k AGI, $100,000 donation, $60,000 other) ---
const q11 = cc({ filingStatus: 'married', age: 77, donation: 100000, baseAgi: 900000, otherItemized: 60000 });
is('Q11 eligible', q11.eligible, true);
is('Q11 itemize B', q11.resB.itemize, true);
is('Q11 §68 applies on Path B', q11.resB.topBracketCap, true);
// The QCD'd gift itself never touches Schedule A on Path A (fully excluded via
// QCD, overLimit=0) — so it contributes $0 to Path A's charitable deduction and
// is never subject to the floor or the §68 cut on the gift's account. (Path A's
// OTHER $60,000 of itemized items can still independently trip §68 at this AGI —
// that's correct and expected; it's just unrelated to the gift.)
eq('Q11 Path A charitable gift on Schedule A is $0 (excluded via QCD)', q11.resA.totalCharitableGift, 0);
eq('Q11 Path A charitable-specific floor loss is $0', q11.resA.floorLost, 0);
ok('Q11 qcdSavesFederalTax > 0 (widest lead — avoids the floor + §68 ON THE GIFT)', q11.qcdSavesFederalTax > 0);

// --- Q12: Roth IRA / account-type flag (single, 74, 65k AGI, $10,000 donation) ---
const q12 = cc({ filingStatus: 'single', age: 74, donation: 10000, baseAgi: 65000, otherItemized: 0, accountType: 'roth_ira' });
is('Q12 NOT run as a normal QCD (Roth steered away)', q12.eligible, false);
ok('Q12 account_roth_not_recommended note present', q12.notes.includes('account_roth_not_recommended'));
is('Q12 agiA is null (no misleading comparison)', q12.agiA, null);

// --- 401(k): hard-ineligible account guard ---------------------------------
const q401k = cc({ filingStatus: 'single', age: 74, donation: 10000, baseAgi: 65000, otherItemized: 0, accountType: '401k' });
is('401(k) NOT eligible', q401k.eligible, false);
is('401(k) accountEligible flag false', q401k.accountEligible, false);
ok('401(k) account_ineligible note present', q401k.notes.includes('account_ineligible'));

// --- structural invariants --------------------------------------------------
// agiKeptLowerBy must always equal qcdAmount when eligible (spec's load-bearing check).
for (const [id, r] of [['Q1', q1], ['Q2', q2], ['Q3', q3], ['Q4', q4], ['Q5', q5], ['Q6', q6], ['Q8', q8], ['Q9', q9], ['Q10', q10], ['Q11', q11]]) {
  eq(`${id} agiKeptLowerBy == qcdAmount`, r.agiKeptLowerBy, r.qcdAmount);
  ok(`${id} qcdSavesFederalTax never negative`, r.qcdSavesFederalTax >= 0);
}

// min(donation, limit) at/over the boundary.
eq('min(donation,111000) under the limit', Math.min(50000, QCD.annualLimitByYear['2026']), 50000);
eq('min(donation,111000) at the limit', Math.min(111000, QCD.annualLimitByYear['2026']), 111000);
eq('min(donation,111000) over the limit', Math.min(200000, QCD.annualLimitByYear['2026']), 111000);

console.log(`\nQCD engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
