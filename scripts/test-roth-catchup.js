// test-roth-catchup.js — unit tests for the SECURE 2.0 §603 mandatory Roth
// catch-up engine. Encodes all 14 fixtures from docs/roth-catchup-spec.md §4,
// plus structural + pending-year checks. Run: node scripts/test-roth-catchup.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rothCatchUpStatus, rothCatchUpCost, rothVsPretax, estimateRothCatchUp } from '../src/engine/roth-catchup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const secure2 = JSON.parse(readFileSync(join(__dirname, '../src/data/secure2-catchup-2026.json'), 'utf8'));
const RC = secure2.rothCatchUp;

let pass = 0, fail = 0;
const approx = (a, b, tol = 0.01) => (a == null || b == null) ? a === b : Math.abs(a - b) <= tol;
function eq(name, got, want, tol = 0.01) {
  if (approx(got, want, tol)) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${got}, want ${want}`); }
}
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

// One-call helper mirroring the tool's front-end call.
const est = (a) => estimateRothCatchUp({ ...a, params: RC });

// --- The 14 sourced fixtures (spec §4) -------------------------------------
// Constants: 2026 -> cStd=8000, cSuper=11250, threshold=150000, enforced=true.
//            2025 -> threshold=145000, enforced=false. (1.06)^5=1.3382255776,
//            (1.06)^10=1.7908476965.

// R1 — under 50, not applicable at all
{
  const r = est({ taxYear: 2026, age: 45, priorYearFicaWages: 200000, catchUpAmount: 8000, currentMarginalRate: 0.24 });
  is('R1 subject', r.subject, false);
  is('R1 band', r.band, 'none');
  eq('R1 maxCatchUp', r.maxCatchUp, 0);
  is('R1 reason', r.reason, 'under_50_no_catchup');
  is('R1 extraTax n/a', r.extraTaxThisYear, null);
}

// R2 — threshold just UNDER
{
  const r = est({ taxYear: 2026, age: 50, priorYearFicaWages: 149999, catchUpAmount: 8000, currentMarginalRate: 0.24 });
  is('R2 subject', r.subject, false);
  is('R2 reason', r.reason, 'wages_at_or_below_threshold');
  is('R2 band', r.band, 'standard');
  eq('R2 maxCatchUp', r.maxCatchUp, 8000);
  eq('R2 extraTax $0', r.extraTaxThisYear, 0);
}

// R3 — threshold just OVER
{
  const r = est({ taxYear: 2026, age: 50, priorYearFicaWages: 150001, catchUpAmount: 8000, currentMarginalRate: 0.24 });
  is('R3 subject', r.subject, true);
  is('R3 effect', r.effect, 'must_be_roth');
  eq('R3 maxCatchUp', r.maxCatchUp, 8000);
  eq('R3 extraTaxThisYear', r.extraTaxThisYear, 1920.00);
}

// R4 — threshold EXACTLY $150,000 ("exceed", so NOT subject)
{
  const r = est({ taxYear: 2026, age: 52, priorYearFicaWages: 150000, catchUpAmount: 8000, currentMarginalRate: 0.24 });
  is('R4 subject', r.subject, false);
  is('R4 reason', r.reason, 'wages_at_or_below_threshold');
}

// R5 — 59, still standard band
{
  const r = est({ taxYear: 2026, age: 59, priorYearFicaWages: 300000, catchUpAmount: 8000, currentMarginalRate: 0.32 });
  is('R5 subject', r.subject, true);
  is('R5 band', r.band, 'standard');
  eq('R5 maxCatchUp', r.maxCatchUp, 8000);
  eq('R5 extraTax', r.extraTaxThisYear, 2560.00);
}

// R6 — 60, super band lower edge
{
  const r = est({ taxYear: 2026, age: 60, priorYearFicaWages: 300000, catchUpAmount: 11250, currentMarginalRate: 0.35 });
  is('R6 subject', r.subject, true);
  is('R6 band', r.band, 'super');
  eq('R6 maxCatchUp', r.maxCatchUp, 11250);
  eq('R6 extraTax', r.extraTaxThisYear, 3937.50);
}

// R7 — 63, super band upper edge
{
  const r = est({ taxYear: 2026, age: 63, priorYearFicaWages: 300000, catchUpAmount: 11250, currentMarginalRate: 0.35 });
  is('R7 subject', r.subject, true);
  is('R7 band', r.band, 'super');
  eq('R7 maxCatchUp', r.maxCatchUp, 11250);
  eq('R7 extraTax', r.extraTaxThisYear, 3937.50);
}

// R8 — 64, reverts to standard; requested 11250 capped down to 8000
{
  const r = est({ taxYear: 2026, age: 64, priorYearFicaWages: 300000, catchUpAmount: 11250, currentMarginalRate: 0.35 });
  is('R8 subject', r.subject, true);
  is('R8 band', r.band, 'standard');
  eq('R8 maxCatchUp', r.maxCatchUp, 8000);
  eq('R8 effectiveCatchUp capped', r.effectiveCatchUp, 8000);
  eq('R8 extraTax', r.extraTaxThisYear, 2800.00);
}

// R9 — over threshold but does NO catch-up -> n/a (not an error)
{
  const r = est({ taxYear: 2026, age: 62, priorYearFicaWages: 155000, catchUpAmount: 0, currentMarginalRate: 0.35 });
  is('R9 subject', r.subject, true);
  is('R9 mandateBites false', r.mandateBites, false);
  is('R9 no_catchup_elected note', r.notes.includes('no_catchup_elected'), true);
  eq('R9 extraTax $0', r.extraTaxThisYear, 0);
  is('R9 rothAdvantage n/a', r.rothAdvantage, null);
}

// R10 — self-employed / no FICA wages
{
  const r = est({ taxYear: 2026, age: 55, priorYearFicaWages: 0, catchUpAmount: 8000, currentMarginalRate: 0.24 });
  is('R10 subject', r.subject, false);
  is('R10 reason', r.reason, 'no_prior_year_fica_wages');
  is('R10 band', r.band, 'standard');
}

// R11 — over threshold, plan has NO Roth
{
  const r = est({ taxYear: 2026, age: 58, priorYearFicaWages: 500000, planOffersRoth: false, catchUpAmount: 8000, currentMarginalRate: 0.35 });
  is('R11 subject', r.subject, true);
  is('R11 effect', r.effect, 'plan_no_roth_cannot_catchup');
  eq('R11 maxAllowedCatchUp', r.maxAllowedCatchUp, 0);
  eq('R11 effectiveCatchUp', r.effectiveCatchUp, 0);
  eq('R11 extraTax $0', r.extraTaxThisYear, 0);
}

// R12 — 2025, transition relief, not enforced
{
  const r = est({ taxYear: 2025, age: 60, priorYearFicaWages: 200000, catchUpAmount: 11250, currentMarginalRate: 0.35 });
  is('R12 subject', r.subject, false);
  is('R12 reason', r.reason, 'transition_relief_2025');
}

// R13 — future value, retirement rate LOWER -> Roth costs you
{
  const r = est({ taxYear: 2026, age: 60, priorYearFicaWages: 300000, catchUpAmount: 11250, currentMarginalRate: 0.35, retirementMarginalRate: 0.24, yearsToRetirement: 5, growthRate: 0.06 });
  eq('R13 extraTaxThisYear', r.extraTaxThisYear, 3937.50);
  eq('R13 rothAdvantage', r.rothAdvantage, -1656.05, 0.02);
}

// R14 — future value, retirement rate HIGHER -> Roth wins
{
  const r = est({ taxYear: 2026, age: 55, priorYearFicaWages: 300000, catchUpAmount: 8000, currentMarginalRate: 0.24, retirementMarginalRate: 0.32, yearsToRetirement: 10, growthRate: 0.06 });
  eq('R14 extraTaxThisYear', r.extraTaxThisYear, 1920.00);
  eq('R14 rothAdvantage', r.rothAdvantage, 1146.14, 0.02);
}

// --- Unit-level checks on the pure helpers ---------------------------------
eq('cost 8000x24%', rothCatchUpCost({ effectiveCatchUp: 8000, currentMarginalRate: 0.24 }).extraTaxThisYear, 1920);
eq('cost zero catchup', rothCatchUpCost({ effectiveCatchUp: 0, currentMarginalRate: 0.35 }).extraTaxThisYear, 0);
{
  const r = rothVsPretax({ catchUp: 11250, years: 5, growth: 0.06, currentRate: 0.35, retirementRate: 0.24 });
  eq('rothVsPretax advantage', r.rothAdvantage, -1656.05, 0.02);
  eq('rothVsPretax breakEven = current rate', r.breakEvenRate, 0.35);
  eq('rothVsPretax wash at equal rates', rothVsPretax({ catchUp: 11250, years: 5, growth: 0.06, currentRate: 0.30, retirementRate: 0.30 }).rothAdvantage, 0);
}

// --- Structural / edge checks ----------------------------------------------
// Status object shape (spec §3.6): subject-by-age+wages sets effect must_be_roth.
{
  const s = rothCatchUpStatus({ taxYear: 2026, age: 55, priorYearFicaWages: 300000, params: RC });
  is('status must_be_roth', s.effect, 'must_be_roth');
  eq('status threshold 2026', s.threshold, 150000);
  is('status enforced 2026', s.enforced, true);
}
// 2025 constants present and not enforced.
{
  const s = rothCatchUpStatus({ taxYear: 2025, age: 55, priorYearFicaWages: 300000, params: RC });
  is('status 2025 not enforced -> transition relief', s.reason, 'transition_relief_2025');
  is('status 2025 transition note', s.notes.includes('transition_relief'), true);
}
// Pending-year gate (2027 constants not published): pending_irs_guidance, no fabricated numbers.
{
  const s = rothCatchUpStatus({ taxYear: 2027, age: 55, priorYearFicaWages: 300000, params: RC });
  is('2027 reason pending', s.reason, 'pending_irs_guidance');
  is('2027 threshold null', s.threshold, null);
  is('2027 maxCatchUp null', s.maxCatchUp, null);
  const e = est({ taxYear: 2027, age: 55, priorYearFicaWages: 300000, catchUpAmount: 8000, currentMarginalRate: 0.24 });
  is('2027 extraTax n/a', e.extraTaxThisYear, null);
  is('2027 pending note', e.notes.includes('pending_irs_guidance'), true);
}
// Band boundaries by age (2026 dollar maxima).
eq('age 50 -> standard 8000', rothCatchUpStatus({ taxYear: 2026, age: 50, priorYearFicaWages: 0, params: RC }).maxCatchUp, 8000);
eq('age 59 -> standard 8000', rothCatchUpStatus({ taxYear: 2026, age: 59, priorYearFicaWages: 0, params: RC }).maxCatchUp, 8000);
eq('age 60 -> super 11250', rothCatchUpStatus({ taxYear: 2026, age: 60, priorYearFicaWages: 0, params: RC }).maxCatchUp, 11250);
eq('age 63 -> super 11250', rothCatchUpStatus({ taxYear: 2026, age: 63, priorYearFicaWages: 0, params: RC }).maxCatchUp, 11250);
eq('age 64 -> standard 8000', rothCatchUpStatus({ taxYear: 2026, age: 64, priorYearFicaWages: 0, params: RC }).maxCatchUp, 8000);
is('age 49 -> band none', rothCatchUpStatus({ taxYear: 2026, age: 49, priorYearFicaWages: 999999, params: RC }).band, 'none');

console.log(`\nRoth catch-up engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
