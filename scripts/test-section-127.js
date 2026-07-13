// test-section-127.js — unit tests for the IRC §127 employer student-loan-
// repayment / educational-assistance tax-benefit engine
// (docs/section-127-student-loan-repayment-spec.md). Run: node scripts/test-section-127.js
//
// All 12 fixtures (F1-F12) are the spec's §4 fixture table, plus the spec's
// boundary sub-case (wage-base straddle), the roundToNearest50 indexing rule,
// and input guards. Constants for TY2026 are asserted straight out of the
// shipped dataset src/data/section-127-2026.json, so the statutory dollars
// ($5,250 cap, $184,500 SS wage base, 6.2% / 1.45% / 0.9% FICA) are locked to
// the real file the page ships.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSection127, capForYear, roundToNearest50, round2 } from '../src/engine/section-127.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const params = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'section-127-2026.json'), 'utf8'));

let pass = 0, fail = 0;
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL ${name}`); }
}

// --- dataset sanity: every statutory dollar/rate figure, from the shipped file -
is('data: cap $5,250', params.cap, 5250);
is('data: SS wage base $184,500', params.ficaWageBase, 184500);
is('data: OASDI 6.2%', params.oasdiRate, 0.062);
is('data: Medicare 1.45%', params.medicareRate, 0.0145);
is('data: Additional Medicare 0.9%', params.additionalMedicareRate, 0.009);
is('data: simple FICA 7.65%', params.ficaRate, 0.0765);
is('data: Additional Medicare threshold (single) $200,000', params.additionalMedicareThreshold.single, 200000);
is('data: first indexed year 2027', params.indexing.firstIndexedYear, 2027);
is('data: indexing base year 2025', params.indexing.baseYear, 2025);
is('data: rounds to nearest $50', params.indexing.roundToNearestIncrement, 50);
is('data: 2027 official cap not yet published (null)', params.indexing.official2027Cap, null);

// --- F1: full cap, all loan repayment, typical earner --------------------------
{
  const r = computeSection127({ wages: 60000, loanRepaymentBenefit: 5250, tuitionAssistanceUsed: 0, marginalFedRate: 0.22, params });
  is('F1 excludedLoan 5,250', r.excludedLoan, 5250);
  is('F1 excess 0', r.excessTaxable, 0);
  is('F1 empIncomeTaxSaved 1,155.00', r.empIncomeTaxSaved, 1155);
  is('F1 empFicaSaved 401.63', r.empFicaSaved, 401.63);
  is('F1 empFederalSaved 1,556.63', r.empFederalSaved, 1556.63);
  is('F1 erFicaSaved 401.63', r.erFicaSaved, 401.63);
}

// --- F2: combined use, split ---------------------------------------------------
{
  const r = computeSection127({ wages: 80000, tuitionAssistanceUsed: 3000, loanRepaymentBenefit: 3000, marginalFedRate: 0.22, params });
  is('F2 loanExclusionRoom 2,250', r.loanExclusionRoom, 2250);
  is('F2 excludedLoan 2,250', r.excludedLoan, 2250);
  is('F2 excess 750', r.excessTaxable, 750);
  is('F2 loan-leg IT saving 495.00', r.empIncomeTaxSaved, 495);
  is('F2 loan-leg FICA saving 172.13', r.empFicaSaved, 172.13);
  is('F2 loan-leg total federal saving 667.13', r.empFederalSaved, 667.13);
  is('F2 excess IT cost 165.00', r.empExcessIncomeTax, 165);
  is('F2 excess FICA cost 57.38', r.empExcessFica, 57.38);
  is('F2 erFicaSaved 401.63 (on 5,250 total excluded)', r.erFicaSaved, 401.63);
  is('F2 erExcessCost 57.38', r.erExcessCost, 57.38);
}

// --- F3: low bracket -----------------------------------------------------------
{
  const r = computeSection127({ wages: 35000, loanRepaymentBenefit: 5250, marginalFedRate: 0.12, params });
  is('F3 empIncomeTaxSaved 630.00', r.empIncomeTaxSaved, 630);
  is('F3 empFicaSaved 401.63', r.empFicaSaved, 401.63);
  is('F3 empFederalSaved 1,031.63', r.empFederalSaved, 1031.63);
  is('F3 erFicaSaved 401.63', r.erFicaSaved, 401.63);
}

// --- F4: 24% bracket -----------------------------------------------------------
{
  const r = computeSection127({ wages: 150000, loanRepaymentBenefit: 5250, marginalFedRate: 0.24, params });
  is('F4 empIncomeTaxSaved 1,260.00', r.empIncomeTaxSaved, 1260);
  is('F4 empFicaSaved 401.63', r.empFicaSaved, 401.63);
  is('F4 empFederalSaved 1,661.63', r.empFederalSaved, 1661.63);
  is('F4 erFicaSaved 401.63', r.erFicaSaved, 401.63);
}

// --- F5: above SS wage base, below $200k (OASDI drops off; headline $402 gone) --
{
  const r = computeSection127({ wages: 190000, loanRepaymentBenefit: 5250, marginalFedRate: 0.32, params });
  is('F5 empOasdiSaved 0 (above wage base)', r.empOasdiSaved, 0);
  is('F5 empFicaSaved = 5,250 x 1.45% = 76.13', r.empFicaSaved, 76.13);
  is('F5 empIncomeTaxSaved 1,680.00', r.empIncomeTaxSaved, 1680);
  is('F5 empFederalSaved 1,756.13', r.empFederalSaved, 1756.13);
  is('F5 erFicaSaved 76.13 (NOT 401.63)', r.erFicaSaved, 76.13);
  ok('F5 aboveWageBase flag set (suppress the "$402" headline)', r.aboveWageBase === true);
}

// --- F6: top bracket + Additional Medicare -------------------------------------
{
  const r = computeSection127({ wages: 700000, loanRepaymentBenefit: 5250, marginalFedRate: 0.37, filingStatus: 'single', params });
  is('F6 empFicaSaved = 5,250 x (1.45% + 0.9%) = 123.38', r.empFicaSaved, 123.38);
  is('F6 empAddlMedicareSaved 47.25', r.empAddlMedicareSaved, 47.25);
  is('F6 empIncomeTaxSaved 1,942.50', r.empIncomeTaxSaved, 1942.5);
  is('F6 empFederalSaved 2,065.88', r.empFederalSaved, 2065.88);
  is('F6 erFicaSaved 76.13 (no 0.9% employer match)', r.erFicaSaved, 76.13);
}

// --- F7: over-cap, loan only ---------------------------------------------------
{
  const r = computeSection127({ wages: 90000, loanRepaymentBenefit: 8000, marginalFedRate: 0.24, params });
  is('F7 excludedLoan 5,250', r.excludedLoan, 5250);
  is('F7 excess 2,750', r.excessTaxable, 2750);
  is('F7 empIncomeTaxSaved 1,260.00', r.empIncomeTaxSaved, 1260);
  is('F7 empFicaSaved 401.63', r.empFicaSaved, 401.63);
  is('F7 empFederalSaved 1,661.63', r.empFederalSaved, 1661.63);
  is('F7 excess IT cost 660.00', r.empExcessIncomeTax, 660);
  is('F7 excess FICA cost 210.38', r.empExcessFica, 210.38);
  is('F7 erFicaSaved 401.63', r.erFicaSaved, 401.63);
  is('F7 erExcessCost 210.38', r.erExcessCost, 210.38);
}

// --- F8: partial benefit under cap ---------------------------------------------
{
  const r = computeSection127({ wages: 55000, loanRepaymentBenefit: 2000, marginalFedRate: 0.22, params });
  is('F8 excludedLoan 2,000', r.excludedLoan, 2000);
  is('F8 empIncomeTaxSaved 440.00', r.empIncomeTaxSaved, 440);
  is('F8 empFicaSaved 153.00', r.empFicaSaved, 153);
  is('F8 empFederalSaved 593.00', r.empFederalSaved, 593);
  is('F8 erFicaSaved 153.00', r.erFicaSaved, 153);
  is('F8 remaining room 3,250', r.remainingRoom, 3250);
}

// --- F9: shared-cap edge — tuition already maxed, entire loan taxable ----------
{
  const r = computeSection127({ wages: 70000, tuitionAssistanceUsed: 5250, loanRepaymentBenefit: 1200, marginalFedRate: 0.22, params });
  is('F9 loanExclusionRoom 0', r.loanExclusionRoom, 0);
  is('F9 excludedLoan 0', r.excludedLoan, 0);
  is('F9 entire 1,200 taxable', r.excessTaxable, 1200);
  is('F9 excess IT cost 264.00', r.empExcessIncomeTax, 264);
  is('F9 excess FICA cost 91.80', r.empExcessFica, 91.8);
  is('F9 erExcessCost 91.80', r.erExcessCost, 91.8);
}

// --- F10: indexed future year (parameterized — no official figure yet) ---------
{
  const a = computeSection127({ year: 2027, colaRate: 0.025, loanRepaymentBenefit: 5250, marginalFedRate: 0.22, wages: 60000, params });
  is('F10a increase 131.25 -> nearest $50 = 150 (rounds UP) -> cap 5,400', a.cap, 5400);
  ok('F10a not pending (a COLA was supplied)', a.capPending === false);
  const b = computeSection127({ year: 2027, colaRate: 0.02, loanRepaymentBenefit: 5250, marginalFedRate: 0.22, wages: 60000, params });
  is('F10b increase 105.00 -> nearest $50 = 100 -> cap 5,350', b.cap, 5350);
  const c = computeSection127({ year: 2027, loanRepaymentBenefit: 5250, marginalFedRate: 0.22, wages: 60000, params });
  is('F10c no COLA supplied -> fail closed to 5,250', c.cap, 5250);
  ok('F10c capPending flag set', c.capPending === true);
  ok('F10c pending note mentions the Revenue Procedure', c.notes.some((n) => /Revenue Procedure/.test(n)));
  // roundToNearest50 unit checks (the nearest-$50 rule, can round up).
  is('roundToNearest50(131.25) = 150', roundToNearest50(131.25), 150);
  is('roundToNearest50(105) = 100', roundToNearest50(105), 100);
  is('roundToNearest50(124) = 100', roundToNearest50(124), 100);
  is('roundToNearest50(125) = 150 (half rounds up)', roundToNearest50(125), 150);
  // capForYear leaves 2025/2026 at the base.
  is('capForYear(2026) = 5,250', capForYear(2026, params, null).cap, 5250);
  is('capForYear(2025) = 5,250', capForYear(2025, params, null).cap, 5250);
}

// --- F11: two employers (individual-level aggregation) --------------------------
{
  // Employer A $3,000 + employer B $3,000 = $6,000; the exclusion is capped at
  // $5,250 per INDIVIDUAL, so $750 is taxable at filing. Only the income-tax
  // delta is modeled; the withholding mechanics are flagged, not modeled.
  const r = computeSection127({ loanRepaymentBenefit: 6000, marginalFedRate: 0.22, wages: 60000, multipleEmployers: true, params });
  is('F11 excludedLoan capped at 5,250', r.excludedLoan, 5250);
  is('F11 excess 750 taxable at filing', r.excessTaxable, 750);
  is('F11 income-tax math on 750 = 165.00', r.empExcessIncomeTax, 165);
  ok('F11 aggregation / reconciliation caveat present', r.notes.some((n) => /per INDIVIDUAL|aggregat|reconcil/i.test(n)));
}

// --- F12: California resident — CA does NOT conform ----------------------------
{
  const r = computeSection127({ wages: 90000, loanRepaymentBenefit: 5250, marginalFedRate: 0.22, stateConforms: false, stateMarginalRate: 0.093, params });
  is('F12 federal saving 1,556.63 (F1-style)', r.empFederalSaved, 1556.63);
  is('F12 CA does not conform -> $0 state saving', r.empStateSaved, 0);
  is('F12 CA state income tax still due on 5,250 = 488.25', r.stateTaxCost, 488.25);
  is('F12 net = 1,556.63 federal - 488.25 CA cost = 1,068.38', r.empTotalSaved, 1068.38);
  ok('F12 non-conformity caveat present', r.notes.some((n) => /does not conform|California/.test(n)));
}

// --- Boundary sub-case: wages 182,000 + loan 5,250 straddles the wage base ------
{
  const r = computeSection127({ wages: 182000, loanRepaymentBenefit: 5250, marginalFedRate: 0.32, params });
  // oasdiBase = 184,500 - 182,000 = 2,500 -> 2,500 x 6.2% + 5,250 x 1.45%
  is('straddle empOasdiSaved = 2,500 x 6.2% = 155.00', r.empOasdiSaved, 155);
  is('straddle empMedicareSaved = 5,250 x 1.45% = 76.13', r.empMedicareSaved, 76.13);
  is('straddle empFicaSaved = 155.00 + 76.13 = 231.13', r.empFicaSaved, 231.13);
  is('straddle erFicaSaved = 231.13 (same block, no addl medicare)', r.erFicaSaved, 231.13);
}

// --- Conforming-state saving (mirror of F12, positive side) --------------------
{
  const r = computeSection127({ wages: 90000, loanRepaymentBenefit: 5250, marginalFedRate: 0.22, stateConforms: true, stateMarginalRate: 0.05, params });
  is('conforming state: exclusion flows through as a saving 262.50', r.empStateSaved, 262.5);
  is('conforming state: no state tax cost', r.stateTaxCost, 0);
  is('conforming state: total = 1,556.63 + 262.50 = 1,819.13', r.empTotalSaved, 1819.13);
}

// --- Input guards --------------------------------------------------------------
is('guard: missing params -> missing_params', computeSection127({ loanRepaymentBenefit: 5250, marginalFedRate: 0.22 }).error, 'missing_params');
{
  const r = computeSection127({ loanRepaymentBenefit: 0, marginalFedRate: 0.22, wages: 60000, params });
  is('zero benefit: excludedLoan 0', r.excludedLoan, 0);
  is('zero benefit: empFederalSaved 0', r.empFederalSaved, 0);
  is('zero benefit: erFicaSaved 0', r.erFicaSaved, 0);
}
{
  // Negative inputs are clamped to 0 (no negative savings).
  const r = computeSection127({ loanRepaymentBenefit: -100, tuitionAssistanceUsed: -50, marginalFedRate: 0.22, wages: 60000, params });
  is('negative benefit clamped: excludedLoan 0', r.excludedLoan, 0);
  is('negative benefit clamped: excess 0', r.excessTaxable, 0);
}
// round2 half-up-to-cents sanity (the FICA figures rely on it).
is('round2(401.625) = 401.63', round2(401.625), 401.63);
is('round2(172.125) = 172.13', round2(172.125), 172.13);

console.log(`\nSection 127 employer student loan repayment engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
