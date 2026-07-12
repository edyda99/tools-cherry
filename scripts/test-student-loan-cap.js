// test-student-loan-cap.js — unit tests for the federal student loan
// borrowing-cap / funding-gap engine (docs/student-loan-cap-calculator-spec.md).
// Run: node scripts/test-student-loan-cap.js
//
// All 12 fixtures are from the sourced spec's §8 fixture table, regenerated
// against the engine and locked, plus the spec's listed unit-test additions
// (binding-constraint argmin, F4 exact-boundary pool exhaustion, ETC gating,
// the F11-vs-F12 odometer-vs-restorable asymmetry, Parent PLUS never touching
// the $257,500, and the COA rule capping even inside the legacy exception).
// The limits dataset is the REAL shipped file, so the statutory dollars
// ($20,500 / $50,000 / $100,000 / $200,000 / $257,500 / $20,000 / $65,000)
// are asserted straight out of src/data/student-loan-limits-2026.json.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { studentLoanPlan, parentPlusPlan, undergradInfo, expectedTimeToCredential } from '../src/engine/student-loan-cap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const limits = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'student-loan-limits-2026.json'), 'utf8'));

let pass = 0, fail = 0;
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL ${name}`); }
}

// --- dataset sanity: every statutory dollar figure, from the shipped file ------
is('data: graduate annual $20,500', limits.graduate.annual, 20500);
is('data: graduate aggregate $100,000', limits.graduate.aggregate, 100000);
is('data: professional annual $50,000', limits.professional.annual, 50000);
is('data: professional aggregate $200,000 (shared pool)', limits.professional.aggregate, 200000);
ok('data: grad/professional pool is flagged restorable', limits.graduate.aggregateRestorable === true && limits.professional.aggregateRestorable === true);
is('data: lifetime cap $257,500', limits.lifetime.cap, 257500);
ok('data: lifetime cap is flagged odometer', limits.lifetime.odometer === true);
is('data: Parent PLUS annual $20,000', limits.parentPlus.annual, 20000);
is('data: Parent PLUS aggregate $65,000', limits.parentPlus.aggregate, 65000);
ok('data: Parent PLUS aggregate is flagged odometer', limits.parentPlus.odometer === true);
is('data: dependent undergrad yr2 annual unchanged $6,500', limits.undergraduate.dependent.annualByYear[1], 6500);
is('data: dependent undergrad aggregate unchanged $31,000', limits.undergraduate.dependent.aggregate, 31000);
is('data: legacy pre-OBBBA grad aggregate $138,500', limits.legacyException.preObbbaGradAggregate, 138500);
is('data: legacy pre-OBBBA health aggregate $224,000', limits.legacyException.preObbbaHealthAggregate, 224000);
ok('data: litigation block present + date-stamped', !!(limits.litigation && limits.litigation.asOf && limits.litigation.interimListCount === 29));

// --- F1: grad, under the annual cap — COA rule binds, gap $0 -------------------
{
  const r = studentLoanPlan({ mode: 'graduate', yearsRemaining: 2, annualCoa: 22000, annualOtherAid: 6000, priorPoolOutstanding: 0, lifetimeEverBorrowed: 0, legacyEligible: false, limits });
  is('F1 yr1 federal $16,000', r.years[0].federal, 16000);
  is('F1 yr1 constraint = COA rule (not the cap)', r.years[0].constraint, 'coa');
  is('F1 yr2 federal $16,000', r.years[1].federal, 16000);
  is('F1 totalFederal $32,000', r.totalFederal, 32000);
  is('F1 totalGap $0', r.totalGap, 0);
}

// --- F2: grad, exceeds the annual cap ------------------------------------------
{
  const r = studentLoanPlan({ mode: 'graduate', yearsRemaining: 2, annualCoa: 45000, annualOtherAid: 5000, priorPoolOutstanding: 0, lifetimeEverBorrowed: 0, legacyEligible: false, limits });
  is('F2 yr1 federal $20,500', r.years[0].federal, 20500);
  is('F2 yr1 constraint = annual cap', r.years[0].constraint, 'annualCap');
  is('F2 yr1 gap $19,500', r.years[0].gap, 19500);
  is('F2 yr2 federal $20,500', r.years[1].federal, 20500);
  is('F2 totalGap $39,000', r.totalGap, 39000);
}

// --- F3: grad hits the $100k pool ----------------------------------------------
{
  const r = studentLoanPlan({ mode: 'graduate', yearsRemaining: 2, annualCoa: 30000, annualOtherAid: 0, priorPoolOutstanding: 85000, lifetimeEverBorrowed: 85000, legacyEligible: false, limits });
  is('F3 poolCap $100,000 (never-professional grad)', r.poolCap, 100000);
  is('F3 yr1 federal $15,000', r.years[0].federal, 15000);
  is('F3 yr1 constraint = pool', r.years[0].constraint, 'pool');
  is('F3 yr2 federal $0', r.years[1].federal, 0);
  is('F3 yr2 constraint = pool', r.years[1].constraint, 'pool');
  is('F3 totalGap $45,000', r.totalGap, 45000);
}

// --- F4: flagship 4-yr M.D. — pool exhausts EXACTLY at yr 4, annual cap labels --
{
  const r = studentLoanPlan({ mode: 'professional', yearsRemaining: 4, annualCoa: 85000, annualOtherAid: 0, priorPoolOutstanding: 0, lifetimeEverBorrowed: 0, legacyEligible: false, limits });
  is('F4 yr1 federal $50,000', r.years[0].federal, 50000);
  is('F4 yr4 federal $50,000', r.years[3].federal, 50000);
  is('F4 yr4 constraint = annual cap (tie with pool resolves to annual cap)', r.years[3].constraint, 'annualCap');
  is('F4 totalFederal $200,000', r.totalFederal, 200000);
  is('F4 pool hits exactly $0 at the final disbursement', r.poolRemainingEnd, 0);
  is('F4 totalGap $140,000', r.totalGap, 140000);
}

// --- F5: professional who was previously a grad student (shared $200k pool) ----
{
  const r = studentLoanPlan({ mode: 'professional', yearsRemaining: 3, annualCoa: 75000, annualOtherAid: 10000, priorPoolOutstanding: 60000, lifetimeEverBorrowed: 60000, legacyEligible: false, limits });
  is('F5 pool remaining at start $140,000', r.poolRemainingStart, 140000);
  is('F5 yr1 federal $50,000 (annual cap)', r.years[0].federal, 50000);
  is('F5 yr1 constraint', r.years[0].constraint, 'annualCap');
  is('F5 yr2 federal $50,000 (annual cap)', r.years[1].federal, 50000);
  is('F5 yr3 federal $40,000', r.years[2].federal, 40000);
  is('F5 yr3 constraint = shared $200k pool', r.years[2].constraint, 'pool');
  is('F5 totalGap $55,000', r.totalGap, 55000);
}

// --- F6: grandfathered, fits inside 3 years — old rules, gap $0 ----------------
{
  const r = studentLoanPlan({ mode: 'graduate', yearsRemaining: 2, annualCoa: 60000, annualOtherAid: 0, priorPoolOutstanding: 0, lifetimeEverBorrowed: 0, legacyEligible: true, limits });
  is('F6 ETC = min(3, 2 remaining) = 2', r.etcYears, 2);
  is('F6 yr1 legacy', r.years[0].legacy, true);
  is('F6 yr1 federal = full $60,000 (unsub + Grad PLUS top-up)', r.years[0].federal, 60000);
  is('F6 yr1 unsub portion $20,500', r.years[0].unsubPortion, 20500);
  is('F6 yr1 Grad PLUS portion $39,500', r.years[0].legacyPlusPortion, 39500);
  is('F6 yr2 federal $60,000', r.years[1].federal, 60000);
  is('F6 totalGap $0', r.totalGap, 0);
  ok('F6 legacy banner shown', r.legacyApplied && /June 30, 2026|Withdrawing/.test(r.notes.join(' ')));
}

// --- F7: grandfather expires mid-program (5-yr program, 1 yr done = 4 left) ----
{
  const r = studentLoanPlan({ mode: 'graduate', yearsRemaining: 4, annualCoa: 40000, annualOtherAid: 0, priorPoolOutstanding: 0, lifetimeEverBorrowed: 0, legacyEligible: true, limits });
  is('F7 ETC = min(3, 4 remaining) = 3', r.etcYears, 3);
  is('F7 yrs 1-3 old rules: federal $40,000/yr', r.years[0].federal + r.years[1].federal + r.years[2].federal, 120000);
  is('F7 yr4 new rules: federal $20,500', r.years[3].federal, 20500);
  is('F7 yr4 constraint = annual cap', r.years[3].constraint, 'annualCap');
  is('F7 yr4 gap $19,500 (only gap in the plan)', r.totalGap, 19500);
  // Spec §7.4: exception-era unsub (3 × $20,500 = $61,500) consumed the new
  // pool; ALL exception-era borrowing ($120,000) consumed the odometer.
  is('F7 pool after: $100,000 - $61,500 - $20,500 = $18,000', r.poolRemainingEnd, 18000);
  is('F7 odometer after: $257,500 - $120,000 - $20,500 = $117,000', r.odometerRemainingEnd, 117000);
}

// --- F8: new Parent PLUS caps bind ---------------------------------------------
{
  const r = parentPlusPlan({ yearsRemaining: 4, annualCoa: 45000, annualOtherAid: 5000, parentPlusEverBorrowed: 0, legacyEligible: false, limits });
  is('F8 yr1 federal $20,000 (annual cap)', r.years[0].federal, 20000);
  is('F8 yr1 constraint', r.years[0].constraint, 'annualCap');
  is('F8 yr3 federal $20,000', r.years[2].federal, 20000);
  is('F8 yr4 federal $5,000', r.years[3].federal, 5000);
  is('F8 yr4 constraint = $65,000 aggregate', r.years[3].constraint, 'aggregate');
  is('F8 parent capacity $65,000', r.totalFederal, 65000);
  is('F8 parent-side gap $95,000 vs $160,000 need', r.totalGap, 95000);
  ok('F8 note: student\'s own Stafford is separate', /separate/.test(r.notes.join(' ')));
}

// --- F9: legacy parent — COA-based, caps not applied ---------------------------
{
  const r = parentPlusPlan({ yearsRemaining: 2, annualCoa: 45000, annualOtherAid: 5000, parentPlusEverBorrowed: 0, legacyEligible: true, limits });
  is('F9 ETC covers both years', r.etcYears, 2);
  is('F9 yr1 federal $40,000 (COA-based, no caps)', r.years[0].federal, 40000);
  is('F9 yr2 federal $40,000', r.years[1].federal, 40000);
  is('F9 totalGap $0', r.totalGap, 0);
  ok('F9 withdrawal-voids-it warning shown', /withdraws|ceases enrollment/.test(r.notes.join(' ')));
}

// --- F10: undergrad out-of-scope handling — limits unchanged -------------------
{
  const r = undergradInfo({ dependent: true, yearNumber: 2, limits });
  is('F10 unchanged flag', r.unchanged, true);
  is('F10 dependent sophomore annual $6,500', r.annual, 6500);
  is('F10 aggregate $31,000', r.aggregate, 31000);
  ok('F10 no OBBBA math applied (no gap/federal fields)', r.totalGap === undefined && r.years === undefined);
  ok('F10 points the parent to Parent PLUS mode', /Parent PLUS/.test(r.notes.join(' ')));
}

// --- F11: $257,500 odometer binds BELOW the pool (repayment did NOT restore it) -
{
  const r = studentLoanPlan({ mode: 'professional', yearsRemaining: 2, annualCoa: 60000, annualOtherAid: 0, priorPoolOutstanding: 20000, lifetimeEverBorrowed: 240000, legacyEligible: false, limits });
  is('F11 pool remaining $180,000', r.poolRemainingStart, 180000);
  is('F11 odometer remaining only $17,500', r.odometerRemainingStart, 17500);
  is('F11 yr1 federal $17,500', r.years[0].federal, 17500);
  is('F11 yr1 constraint = $257,500 lifetime', r.years[0].constraint, 'lifetime');
  is('F11 yr2 federal $0', r.years[1].federal, 0);
  is('F11 yr2 constraint = lifetime', r.years[1].constraint, 'lifetime');
  is('F11 odometer exhausted', r.odometerRemainingEnd, 0);
  ok('F11 note: repaying does NOT restore the lifetime cap', /Repaying does NOT restore/.test(r.notes.join(' ')));
}

// --- F12: repayment restores the POOL (but not the odometer) — the asymmetry ---
{
  // Borrowed $100,000 grad unsub ever, repaid $35,000 → outstanding $65,000
  // goes in the pool input; the full $120,000 ever-borrowed (incl. other
  // federal loans) goes in the odometer input.
  const r = studentLoanPlan({ mode: 'graduate', yearsRemaining: 2, annualCoa: 25000, annualOtherAid: 0, priorPoolOutstanding: 65000, lifetimeEverBorrowed: 120000, legacyEligible: false, limits });
  is('F12 pool remaining $35,000 (repayment restored room)', r.poolRemainingStart, 35000);
  is('F12 odometer remaining $137,500 (repayment ignored)', r.odometerRemainingStart, 137500);
  is('F12 yr1 federal $20,500 (annual cap)', r.years[0].federal, 20500);
  is('F12 yr1 constraint', r.years[0].constraint, 'annualCap');
  is('F12 yr2 federal $14,500', r.years[1].federal, 14500);
  is('F12 yr2 constraint = pool', r.years[1].constraint, 'pool');
  is('F12 totalGap $15,000', r.totalGap, 15000);
  ok('F12 odometer never binds ($137,500 left at start)', r.years.every((y) => y.constraint !== 'lifetime'));
}

// --- structure / correction guards (spec §8 unit-test additions) ----------------
// ETC gating: nothing remaining -> ETC 0; the 3-year ceiling; non-legacy = 0.
is('ETC: legacy with 0 years remaining = 0', expectedTimeToCredential(true, 0), 0);
is('ETC: legacy capped at 3 academic years', expectedTimeToCredential(true, 5), 3);
is('ETC: not legacy-eligible = 0', expectedTimeToCredential(false, 3), 0);

// COA rule caps even inside the legacy-exception path (fed = need, never more).
{
  const r = studentLoanPlan({ mode: 'graduate', yearsRemaining: 1, annualCoa: 10000, annualOtherAid: 4000, priorPoolOutstanding: 0, lifetimeEverBorrowed: 0, legacyEligible: true, limits });
  is('legacy year still capped by COA minus aid ($6,000)', r.years[0].federal, 6000);
  is('legacy year unsub portion = min($20,500, need) = $6,000', r.years[0].unsubPortion, 6000);
}

// Graduate who is (or has been) a professional student -> shared $200,000 pool.
{
  const r = studentLoanPlan({ mode: 'graduate', yearsRemaining: 1, annualCoa: 60000, annualOtherAid: 0, priorPoolOutstanding: 150000, everProfessional: true, lifetimeEverBorrowed: 150000, legacyEligible: false, limits });
  is('mixed-status grad poolCap $200,000', r.poolCap, 200000);
  is('mixed-status grad yr1 federal $20,500 (grad annual cap still applies)', r.years[0].federal, 20500);
}

// Parent PLUS never touches the $257,500 lifetime cap.
{
  const r = parentPlusPlan({ yearsRemaining: 3, annualCoa: 300000, annualOtherAid: 0, parentPlusEverBorrowed: 0, legacyEligible: false, limits });
  ok('parentPlus result is flagged excluded from the lifetime cap', r.excludedFromLifetimeCap === true);
  ok('parentPlus result carries no odometer fields', r.odometerCap === undefined && r.odometerRemainingEnd === undefined);
  is('parentPlus yr1 capped at $20,000 regardless of size', r.years[0].federal, 20000);
}

// Parent PLUS aggregate already exhausted (ever-borrowed, ignoring repayment).
{
  const r = parentPlusPlan({ yearsRemaining: 1, annualCoa: 30000, annualOtherAid: 0, parentPlusEverBorrowed: 65000, legacyEligible: false, limits });
  is('parentPlus pool exhausted -> $0', r.years[0].federal, 0);
  is('parentPlus constraint = aggregate', r.years[0].constraint, 'aggregate');
}

// Litigation handling: professional mode carries the date-stamped caveat;
// the engine never classifies — graduate mode does not carry it.
{
  const p = studentLoanPlan({ mode: 'professional', yearsRemaining: 1, annualCoa: 60000, annualOtherAid: 0, priorPoolOutstanding: 0, lifetimeEverBorrowed: 0, legacyEligible: false, limits });
  ok('professional mode: litigation note present + date-stamped', /litigation/.test(p.litigationNote || '') && /Jul 10, 2026/.test(p.litigationNote || ''));
  const g = studentLoanPlan({ mode: 'graduate', yearsRemaining: 1, annualCoa: 30000, annualOtherAid: 0, priorPoolOutstanding: 0, lifetimeEverBorrowed: 0, legacyEligible: false, limits });
  is('graduate mode: no litigation note on the result', g.litigationNote, null);
}

// Input guards.
is('guard: yearsRemaining 0 -> invalid_years', studentLoanPlan({ mode: 'graduate', yearsRemaining: 0, annualCoa: 1, annualOtherAid: 0, limits }).error, 'invalid_years');
is('guard: yearsRemaining 7 -> invalid_years', studentLoanPlan({ mode: 'graduate', yearsRemaining: 7, annualCoa: 1, annualOtherAid: 0, limits }).error, 'invalid_years');
is('guard: unknown mode -> invalid_mode', studentLoanPlan({ mode: 'undergrad', yearsRemaining: 1, annualCoa: 1, limits }).error, 'invalid_mode');
is('guard: parentPlus yearsRemaining 0 -> invalid_years', parentPlusPlan({ yearsRemaining: 0, annualCoa: 1, limits }).error, 'invalid_years');
is('guard: missing limits -> missing_limits', studentLoanPlan({ mode: 'graduate', yearsRemaining: 1, annualCoa: 1 }).error, 'missing_limits');
{
  // aid > COA clamps need to 0 -> nothing to borrow, no negative gap.
  const r = studentLoanPlan({ mode: 'graduate', yearsRemaining: 1, annualCoa: 5000, annualOtherAid: 9000, priorPoolOutstanding: 0, lifetimeEverBorrowed: 0, legacyEligible: false, limits });
  is('aid > COA: federal $0', r.years[0].federal, 0);
  is('aid > COA: gap $0', r.totalGap, 0);
}

console.log(`\nStudent loan cap engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
