// test-charitable.js — unit tests for the OBBBA charitable-deduction engine
// (IRC §170(p) non-itemizer deduction, §170(b)(1)(I) 0.5%-of-AGI floor, and the
// §68 "2/37 rule" top-bracket haircut). Run: node scripts/test-charitable.js
//
// All 10 fixtures are from the sourced spec (charitable-deduction-spec.md, §8).
// The fixtures' STATUTORY deduction outputs (§170(p) amount, floor, itemized
// charitable after floor, verdict) are load-bearing and hand-computed against
// the verified rules. The `taxSaved` values were REGENERATED here against the
// real exact-bracket-diff engine (2026 brackets + standard deductions), as the
// spec directed — the spec's hand-estimated taxSaved figures are illustrative
// and are NOT asserted. Filing statuses map to engine ids: mfj -> married.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  charitableNonItemizer, charitableFloor, section68Reduction, charitableComparison
} from '../src/engine/obbba-deduction.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const obbba = JSON.parse(readFileSync(join(__dirname, '../src/data/obbba-deductions-2026.json'), 'utf8'));
const taxData = JSON.parse(readFileSync(join(__dirname, '../src/data/tax-data-2026.json'), 'utf8'));
const fed = taxData.federal;
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

// --- charitableNonItemizer: §170(p) cap by status (cash only) ---------------
eq('P170 single under cap', charitableNonItemizer(600, 'single', CH), 600);
eq('P170 single at cap', charitableNonItemizer(1000, 'single', CH), 1000);
eq('P170 single over cap', charitableNonItemizer(3000, 'single', CH), 1000);
eq('P170 married cap 2000', charitableNonItemizer(5000, 'married', CH), 2000);
eq('P170 hoh cap 1000', charitableNonItemizer(5000, 'head_of_household', CH), 1000);
eq('P170 zero gift', charitableNonItemizer(0, 'single', CH), 0);

// --- charitableFloor: exactly 0.5% of AGI -----------------------------------
eq('floor 60k', charitableFloor(60000, CH), 300);
eq('floor 175k (BPC)', charitableFloor(175000, CH), 875);
eq('floor 200k', charitableFloor(200000, CH), 1000);
eq('floor 500k', charitableFloor(500000, CH), 2500);
eq('floor 2M', charitableFloor(2000000, CH), 10000);

// --- section68Reduction: only fires in the 37% bracket ----------------------
// Single 37% threshold 640,600. Just under -> no haircut; just over -> 2/37 fires.
is('s68 single under 37% no cut', section68Reduction({ agi: 640000, itemizedTotal: 50000, filingStatus: 'single', params: CH }).applies, false);
is('s68 single over 37% fires', section68Reduction({ agi: 700000, itemizedTotal: 50000, filingStatus: 'single', params: CH }).applies, true);
// Over by 59,400 (700,000-640,600); min(50,000, 59,400)=50,000; 2/37*50,000=2,702.70
eq('s68 single cut amount', section68Reduction({ agi: 700000, itemizedTotal: 50000, filingStatus: 'single', params: CH }).cut, 2702.70, 0.01);
// C7 married: min(540,000, 2,000,000-768,700)=540,000; 2/37*540,000=29,189.19
eq('s68 married C7 cut', section68Reduction({ agi: 2000000, itemizedTotal: 540000, filingStatus: 'married', params: CH }).cut, 29189.19, 0.01);
// Lesser-of picks taxable-income-over-threshold when it is smaller than itemized.
// agi 650,000 single (excess 9,400) with itemized 50,000 -> min = 9,400; 2/37*9,400=508.11
eq('s68 lesser-of picks excess', section68Reduction({ agi: 650000, itemizedTotal: 50000, filingStatus: 'single', params: CH }).cut, (2 / 37) * 9400, 0.01);

// --- The 10 spec fixtures (charitableComparison) ----------------------------
const cc = (a) => charitableComparison({ ...a, params: CH, fed });
function fixture(id, inputs, exp) {
  const r = cc(inputs);
  eq(`${id} nonItemizerDed`, r.nonItemizerDed, exp.nonItemizerDed);
  eq(`${id} floor`, r.floor, exp.floor);
  eq(`${id} charDeductible`, r.charDeductible, exp.charDeductible);
  is(`${id} itemize`, r.itemize, exp.itemize);
  eq(`${id} taxSaved`, r.taxSaved, exp.taxSaved);
  if (exp.topBracketCap != null) is(`${id} topBracketCap`, r.topBracketCap, exp.topBracketCap);
  return r;
}

// C1 non-itemizer under cap: single, 60k AGI, 600 cash
fixture('C1', { filingStatus: 'single', agi: 60000, cashGift: 600, otherItemized: 0 },
  { nonItemizerDed: 600, floor: 300, charDeductible: 300, itemize: false, taxSaved: 72 });
// C2 non-itemizer, cap binds: single, 80k, 3,000 cash
const c2 = fixture('C2', { filingStatus: 'single', agi: 80000, cashGift: 3000, otherItemized: 0 },
  { nonItemizerDed: 1000, floor: 400, charDeductible: 2600, itemize: false, taxSaved: 220 });
is('C2 cap-binds note', c2.notes.includes('nonitemizer_cap_binds'), true);
// C3 non-itemizer, cap binds (MFJ): married, 120k, 2,500 cash
fixture('C3', { filingStatus: 'married', agi: 120000, cashGift: 2500, otherItemized: 0 },
  { nonItemizerDed: 2000, floor: 600, charDeductible: 1900, itemize: false, taxSaved: 240 });
// C4 itemizer wins (SALT+mortgage): married, 250k, 20,000 cash, 30,000 other
const c4 = fixture('C4', { filingStatus: 'married', agi: 250000, cashGift: 20000, otherItemized: 30000 },
  { nonItemizerDed: 2000, floor: 1250, charDeductible: 18750, itemize: true, taxSaved: 3769, topBracketCap: false });
eq('C4 itemizedAllowed', c4.itemizedAllowed, 48750);
eq('C4 stdWorldDeduction', c4.stdWorldDeduction, 34200); // 32,200 + 2,000 §170(p)
eq('C4 baseDeduction (no gift -> standard 32,200)', c4.baseDeduction, 32200);
// C5 floor FULLY binds: single, 200k, 1,000 cash, 18,000 other. Floor 1,000 = gift
// -> charitable = 0; itemizes on SALT+mortgage anyway -> gift adds $0.
const c5 = fixture('C5', { filingStatus: 'single', agi: 200000, cashGift: 1000, otherItemized: 18000 },
  { nonItemizerDed: 1000, floor: 1000, charDeductible: 0, itemize: true, taxSaved: 0 });
is('C5 floor_fully_binds note', c5.notes.includes('floor_fully_binds'), true);
// C6 floor PARTIALLY binds (Bipartisan Policy Center example): single, 175k,
// 2,500 cash, 20,000 other -> floor 875 -> deductible 1,625.
fixture('C6', { filingStatus: 'single', agi: 175000, cashGift: 2500, otherItemized: 20000 },
  { nonItemizerDed: 1000, floor: 875, charDeductible: 1625, itemize: true, taxSaved: 390 });
// C7 the 35% cap (§68) in the 37% bracket: married, 2M AGI, 500k cash, 50k other.
// floor 10,000 -> charitable 490,000; §68 haircut 29,189.19; benefit rate 35%.
const c7 = fixture('C7', { filingStatus: 'married', agi: 2000000, cashGift: 500000, otherItemized: 50000 },
  { nonItemizerDed: 2000, floor: 10000, charDeductible: 490000, itemize: true, taxSaved: 171500, topBracketCap: true });
eq('C7 s68Cut', c7.s68Cut, 29189.19, 0.01);
eq('C7 effectiveRate 35%', c7.effectiveRate, 0.35, 0.0005);
is('C7 top_bracket_cap note', c7.notes.includes('top_bracket_cap'), true);
// C8 $0 contribution edge: single, 50k, no gift -> no effect, no error.
fixture('C8', { filingStatus: 'single', agi: 50000, cashGift: 0, otherItemized: 0 },
  { nonItemizerDed: 0, floor: 250, charDeductible: 0, itemize: false, taxSaved: 0 });
// C9 non-cash gift, not §170(p) eligible: married, 90k, 0 cash, 2,000 non-cash.
// §170(p) = 0 (non-cash); itemized charitable after floor 1,550 < standard -> $0.
const c9 = fixture('C9', { filingStatus: 'married', agi: 90000, cashGift: 0, otherCharitable: 2000, otherItemized: 0 },
  { nonItemizerDed: 0, floor: 450, charDeductible: 1550, itemize: false, taxSaved: 0 });
is('C9 standard wins', c9.itemize, false);
// C10 cash to a DAF (excluded from §170(p)): single, 70k, 1,000 to a DAF.
// §170(p) = 0 (DAF excluded); still itemizable (650 after floor) but standard wins.
fixture('C10', { filingStatus: 'single', agi: 70000, cashGift: 0, otherCharitable: 1000, otherItemized: 0 },
  { nonItemizerDed: 0, floor: 350, charDeductible: 650, itemize: false, taxSaved: 0 });

// --- itemize-vs-standard flip point -----------------------------------------
// Single, 300k AGI, other itemized 16,000 (just under 16,100 standard). A small
// cash gift of 200 -> after floor 0.5%*300k=1,500 gives charitable 0, itemized
// 16,000 < 16,100 -> standard. Bump other to 16,200 -> itemize flips true.
is('flip: under standard -> standard', cc({ filingStatus: 'single', agi: 300000, cashGift: 200, otherItemized: 16000 }).itemize, false);
is('flip: over standard -> itemize', cc({ filingStatus: 'single', agi: 300000, cashGift: 5000, otherItemized: 16200 }).itemize, true);

// --- structure / correction guards ------------------------------------------
// CORRECTION 1: the non-itemizer deduction does NOT reduce AGI (§63(b)(4)).
is('reducesAgi is false', CH.nonItemizer.reducesAgi, false);
is('belowTheLine true', CH.nonItemizer.belowTheLine, true);
// CORRECTION 2: the provision is PERMANENT (no sunset).
is('permanent true', CH.permanent, true);
is('firstYear 2026', CH.firstYear, 2026);
// CORRECTION 3: §68 cap applies to ALL itemized deductions, not just charitable.
is('s68 not charitable-specific', CH.topBracketCap.appliesToAllItemizedNotJustCharitable, true);
eq('s68 effective benefit rate 0.35', CH.topBracketCap.effectiveBenefitRate, 0.35, 0.0001);
// 9-source citation list per the spec.
is('nine sources', CH.sources.length, 9);

console.log(`\nCharitable engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
