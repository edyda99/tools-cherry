// test-dependent-care.js — unit tests for the DCFSA-vs-CDCTC engine (IRC §129
// dependent-care exclusion + IRC §21 child & dependent care credit, as amended by
// OBBBA §70404, effective TY2026). Run: node scripts/test-dependent-care.js
//
// All 10 fixtures are from the sourced spec (dcfsa-child-care-credit-spec.md, §7).
// Every dollar was RE-DERIVED against the real engine, which reuses the site's own
// exact bracket walk + wage-base-aware FICA on the 2026 tables (tax-data-2026.json)
// — matching the spec's verification script (§8). Filing statuses map to engine
// ids: MFJ -> married, MFS -> married_separate.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  applicablePercent, dcfsaLimit, creditableExpenses, cdctcCredit,
  dependentCareComparison
} from '../src/engine/dependent-care.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dc = JSON.parse(readFileSync(join(__dirname, '../src/data/dependent-care-2026.json'), 'utf8'));
const taxData = JSON.parse(readFileSync(join(__dirname, '../src/data/tax-data-2026.json'), 'utf8'));
const fed = taxData.federal;
const CDCTC = dc.cdctc;

let pass = 0, fail = 0;
const approx = (a, b, tol = 1) => Math.abs(a - b) <= tol;
function eq(name, got, want, tol = 1) {
  if (approx(got, want, tol)) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${got}, want ${want}`); }
}
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

// --- applicablePercent: every breakpoint in §1.2 --------------------------------
const p = (agi, status) => Math.round(applicablePercent(agi, status, CDCTC) * 100);
// single / HoH (stage 1 is NOT joint-doubled; stage 2 uses $75k + $2k steps)
is('ap single 10k = 50', p(10000, 'single'), 50);
is('ap single 15k = 50', p(15000, 'single'), 50);
is('ap single 15,001 = 49', p(15001, 'single'), 49);
is('ap single 17,001 = 48', p(17001, 'single'), 48);
is('ap single 43,000 = 36', p(43000, 'single'), 36);
is('ap single 43,001 = 35 (stage-1 floor)', p(43001, 'single'), 35);
is('ap single 75,000 = 35 (plateau)', p(75000, 'single'), 35);
is('ap single 75,001 = 34', p(75001, 'single'), 34);
is('ap single 90,000 = 27', p(90000, 'single'), 27);
is('ap single 103,000 = 21', p(103000, 'single'), 21);
is('ap single 103,001 = 20 (floor)', p(103001, 'single'), 20);
is('ap single 500k = 20 (no upper cutoff)', p(500000, 'single'), 20);
is('ap hoh 15,001 = 49 (same as single, not doubled)', p(15001, 'head_of_household'), 49);
// joint: stage 1 identical to single ($15k/$2k), stage 2 uses $150k + $4k steps
is('ap joint 15,001 = 49 (stage-1 NOT doubled)', p(15001, 'married'), 49);
is('ap joint 30k = 42', p(30000, 'married'), 42);
is('ap joint 43,001 = 35', p(43001, 'married'), 35);
is('ap joint 150,000 = 35 (plateau end)', p(150000, 'married'), 35);
is('ap joint 150,001 = 34', p(150001, 'married'), 34);
is('ap joint 206,000 = 21', p(206000, 'married'), 21);
is('ap joint 206,001 = 20 (floor)', p(206001, 'married'), 20);
is('ap joint 250k = 20', p(250000, 'married'), 20);

// --- dcfsaLimit: $7,500 all statuses, $3,750 MFS (exactly half) ------------------
is('dcfsa single 7500', dcfsaLimit('single', dc.dcfsa), 7500);
is('dcfsa married 7500', dcfsaLimit('married', dc.dcfsa), 7500);
is('dcfsa hoh 7500', dcfsaLimit('head_of_household', dc.dcfsa), 7500);
is('dcfsa MFS 3750 (exactly half)', dcfsaLimit('married_separate', dc.dcfsa), 3750);
is('MFS is exactly half of MFJ', dcfsaLimit('married_separate', dc.dcfsa) * 2, dcfsaLimit('married', dc.dcfsa));

// --- creditableExpenses: §21(c) min() with §129 cap reduction --------------------
// One-child cap $3,000: no FSA -> min(4000,3000)=3000.
eq('creditable 1-child no FSA', creditableExpenses({ expenses: 4000, fsa: 0, cap: 3000 }), 3000);
// Two-child cap $6,000: $5,000 FSA -> cap-fsa = 1000 binds.
eq('creditable 2-child $5k FSA', creditableExpenses({ expenses: 6000, fsa: 5000, cap: 6000 }), 1000);
// Maxing a $7,500 FSA against the $6,000 cap -> cap-fsa negative -> floored to 0.
eq('creditable $7.5k FSA zeroes cap', creditableExpenses({ expenses: 7500, fsa: 7500, cap: 6000 }), 0);
// Earned-income limit binds below the cap.
eq('creditable EI limit binds', creditableExpenses({ expenses: 6000, fsa: 0, cap: 6000, earnedIncomeLimit: 4000 }), 4000);
// Never below 0.
eq('creditable never negative', creditableExpenses({ expenses: 2000, fsa: 3000, cap: 6000 }), 0);

// --- Nonrefundable clamp: credit can never exceed income-tax liability -----------
// MFJ $30k, std $32,200 -> taxable ~0 -> liability 0 -> credit clamped to 0.
const lowLiab = cdctcCredit({ agi: 30000, filingStatus: 'married', creditable: 6000, cdctc: CDCTC, fed });
eq('nonrefundable clamp: $0 liability -> $0 credit', lowLiab.credit, 0);
is('nonrefundable clamp flag set', lowLiab.clampedByLiability, true);
// MFJ $35k -> taxable $2,800 -> liability $280 -> 40% x 6000 = 2400 nominal clamped to 280.
const clamp35 = cdctcCredit({ agi: 35000, filingStatus: 'married', creditable: 6000, cdctc: CDCTC, fed });
eq('nonrefundable clamp: $280 liability caps 40% credit', clamp35.credit, 280);

// --- MFS ineligibility: credit ALWAYS $0, never a crash, never a wrong nonzero ---
const mfsCredit = cdctcCredit({ agi: 80000, filingStatus: 'married_separate', creditable: 3000, cdctc: CDCTC, fed });
eq('MFS credit is exactly $0', mfsCredit.credit, 0, 0);
is('MFS ineligible flag set', mfsCredit.mfsIneligible, true);
is('MFS applicablePercent forced to 0', mfsCredit.applicablePercent, 0);

// --- FICA wage-base kink at $184,500 (Strategy B FSA FICA saving) ----------------
// Below the base: 7.65% saved. F1-style: $6,000 exclusion at $35k -> $459.
const belowBase = dependentCareComparison({ filingStatus: 'married', agi: 35000, numDependents: 2, careExpenses: 6000, dc, fed });
eq('FICA below wage base ~7.65%', belowBase.strategyB.fsaFicaSaved, 459);
// Above the base ($250k): only 1.45% Medicare on the excluded dollars -> ~$109 on $7,500.
const aboveBase = dependentCareComparison({ filingStatus: 'married', agi: 250000, numDependents: 2, careExpenses: 7500, dc, fed });
eq('FICA above wage base ~1.45%', aboveBase.strategyB.fsaFicaSaved, 109);

// --- The 10 spec fixtures (dependentCareComparison) ------------------------------
// benefitA = credit-only; benefitB = FSA income-tax + FICA + residual credit.
function fx(id, inputs, exp) {
  const r = dependentCareComparison({ ...inputs, dc, fed });
  eq(`${id} A benefit (credit only)`, r.strategyA.benefit, exp.benefitA);
  eq(`${id} B FSA income-tax saved`, r.strategyB.fsaIncomeTaxSaved, exp.fsaIncTax);
  eq(`${id} B FSA FICA saved`, r.strategyB.fsaFicaSaved, exp.fsaFica);
  eq(`${id} B benefit (max FSA)`, r.strategyB.benefit, exp.benefitB);
  is(`${id} recommended`, r.recommended, exp.rec);
  eq(`${id} delta`, r.delta, exp.delta);
  return r;
}
// F1 very-low-AGI, nonrefundable choke -> FSA wins on FICA
fx('F1', { filingStatus: 'married', agi: 35000, numDependents: 2, careExpenses: 6000 },
  { benefitA: 280, fsaIncTax: 280, fsaFica: 459, benefitB: 739, rec: 'max_fsa', delta: 459 });
// F2 zero-liability -> "50% credit worth $0" myth-bust
fx('F2', { filingStatus: 'married', agi: 30000, numDependents: 2, careExpenses: 6000 },
  { benefitA: 0, fsaIncTax: 0, fsaFica: 459, benefitB: 459, rec: 'max_fsa', delta: 459 });
// F3 moderate AGI -> credit wins
fx('F3', { filingStatus: 'married', agi: 85000, numDependents: 2, careExpenses: 6000 },
  { benefitA: 2100, fsaIncTax: 720, fsaFica: 459, benefitB: 1179, rec: 'skip_fsa', delta: 921 });
// F4 high AGI -> FSA wins (24% bracket + $7.5k zeroes credit)
const f4 = fx('F4', { filingStatus: 'married', agi: 250000, numDependents: 2, careExpenses: 7500 },
  { benefitA: 1200, fsaIncTax: 1778, fsaFica: 109, benefitB: 1887, rec: 'max_fsa', delta: 687 });
is('F4 max FSA zeroes credit', f4.strategyB.zeroesCredit, true);
is('F4 note max_fsa_zeroes_credit', f4.notes.includes('max_fsa_zeroes_credit'), true);
// F5 upper-mid single, 1 kid ($3,000 cap) -> FSA wins
fx('F5', { filingStatus: 'single', agi: 120000, numDependents: 1, careExpenses: 5000 },
  { benefitA: 600, fsaIncTax: 1100, fsaFica: 382, benefitB: 1482, rec: 'max_fsa', delta: 882 });
// F6 moderate single, 1 kid -> credit wins
fx('F6', { filingStatus: 'single', agi: 60000, numDependents: 1, careExpenses: 4000 },
  { benefitA: 1050, fsaIncTax: 480, fsaFica: 306, benefitB: 786, rec: 'skip_fsa', delta: 264 });
// F7 near break-even, AGI feedback -> FSA edges it (+$159)
fx('F7', { filingStatus: 'single', agi: 90000, numDependents: 2, careExpenses: 6000 },
  { benefitA: 1620, fsaIncTax: 1320, fsaFica: 459, benefitB: 1779, rec: 'max_fsa', delta: 159 });
// F8 MFS — credit UNAVAILABLE (§21(e)(2)); FSA cap $3,750; FSA is the only lever
const f8 = fx('F8', { filingStatus: 'married_separate', agi: 80000, numDependents: 1, careExpenses: 3000, employerFsaMax: 3750 },
  { benefitA: 0, fsaIncTax: 660, fsaFica: 230, benefitB: 890, rec: 'max_fsa', delta: 890 });
is('F8 MFS ineligible flag', f8.mfsIneligible, true);
is('F8 note mfs_no_credit', f8.notes.includes('mfs_no_credit'), true);
is('F8 Strategy A credit is exactly $0 (not a crash / wrong nonzero)', f8.strategyA.credit, 0);
eq('F8 FSA cap is $3,750 not $7,500', f8.fsaCap, 3750, 0);
// F9 two+, $7,500 FSA zeroes $6,000 credit cap, edges out (+$74)
const f9 = fx('F9', { filingStatus: 'married', agi: 140000, numDependents: 2, careExpenses: 7500 },
  { benefitA: 2100, fsaIncTax: 1600, fsaFica: 574, benefitB: 2174, rec: 'max_fsa', delta: 74 });
is('F9 max FSA zeroes credit', f9.strategyB.zeroesCredit, true);
// F10 expenses below the cap -> credit wins
fx('F10', { filingStatus: 'married', agi: 60000, numDependents: 1, careExpenses: 2000 },
  { benefitA: 700, fsaIncTax: 240, fsaFica: 153, benefitB: 393, rec: 'skip_fsa', delta: 307 });

// --- Corner-solution / crossover flips (§7 load-bearing notes) -------------------
// MFJ, 2 kids, $6,000 expenses: credit wins through ~$170k, MAX FSA takes over ~$172k.
const c85 = dependentCareComparison({ filingStatus: 'married', agi: 85000, numDependents: 2, careExpenses: 6000, dc, fed });
is('crossover MFJ 2-kid $6k: skip wins at $85k', c85.recommended, 'skip_fsa');
const c170 = dependentCareComparison({ filingStatus: 'married', agi: 170000, numDependents: 2, careExpenses: 6000, dc, fed });
is('crossover MFJ 2-kid $6k: skip still wins at $170k', c170.recommended, 'skip_fsa');
const c172 = dependentCareComparison({ filingStatus: 'married', agi: 172000, numDependents: 2, careExpenses: 6000, dc, fed });
is('crossover MFJ 2-kid $6k: MAX FSA wins at $172k', c172.recommended, 'max_fsa');
// Single, 1 kid, $3,000: credit wins to ~$84k, MAX FSA from ~$86k.
const s84 = dependentCareComparison({ filingStatus: 'single', agi: 84000, numDependents: 1, careExpenses: 3000, dc, fed });
is('crossover single 1-kid $3k: skip wins at $84k', s84.recommended, 'skip_fsa');
const s86 = dependentCareComparison({ filingStatus: 'single', agi: 86000, numDependents: 1, careExpenses: 3000, dc, fed });
is('crossover single 1-kid $3k: MAX FSA wins at $86k', s86.recommended, 'max_fsa');

// --- No employer plan -> the credit is the only lever ---------------------------
const noPlan = dependentCareComparison({ filingStatus: 'married', agi: 250000, numDependents: 2, careExpenses: 7500, employerFsaMax: 0, dc, fed });
is('no employer plan -> recommend skip_fsa (credit)', noPlan.recommended, 'skip_fsa');
is('no employer plan flagged', noPlan.notes.includes('no_employer_plan'), true);
eq('no employer plan -> FSA cap 0', noPlan.fsaCap, 0, 0);

// --- employerFsaMax clamped to the statutory limit ------------------------------
const overCap = dependentCareComparison({ filingStatus: 'married', agi: 200000, numDependents: 2, careExpenses: 10000, employerFsaMax: 20000, dc, fed });
eq('employerFsaMax clamped to $7,500', overCap.fsaCap, 7500, 0);

// --- structure / correction guards ----------------------------------------------
is('DCFSA permanent', dc.dcfsa.permanent, true);
is('DCFSA firstYear 2026', dc.dcfsa.firstYear, 2026);
is('CDCTC nonrefundable', dc.cdctc.refundable, false);
is('CDCTC MFS generally ineligible', dc.cdctc.mfsGenerallyIneligible, true);
is('stage 1 NOT joint-doubled', dc.cdctc.applicablePercent.stage1.jointDoubled, false);
is('interaction is a corner solution', dc.interaction.cornerSolution, true);
is('no-double-dip', dc.interaction.noDoubleDip, true);
is('expense cap 1 child $3,000', dc.cdctc.expenseCap.oneChild, 3000);
is('expense cap 2+ $6,000', dc.cdctc.expenseCap.twoOrMore, 6000);
// 9+ citations matching site rigor.
is('at least 9 sources', dc.sources.length >= 9, true);

console.log(`\nDependent-care engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
