// student-loan-cap.js — Federal student loan borrowing cap / funding gap
// engine, per docs/student-loan-cap-calculator-spec.md. Pure, framework-free.
// Runs client-side (browser ESM) and in Node (build-time tests). Every dollar
// PARAMETER (caps, aggregates, legacy figures) comes from
// src/data/student-loan-limits-2026.json — this file is pure Title IV cap
// arithmetic. STANDALONE by design (spec §5): this is federal student-aid
// policy, not tax/payroll — no reuse of paycheck-engine.js / obbba-deduction.js.
//
// THE LAW (all figures verified in the spec against 20 U.S.C. §1087e(a), as
// amended by P.L. 119-21 §81001, and ED's RISE final rule, 91 FR 23768):
// for periods of enrollment beginning on or after JULY 1, 2026 —
//   * Grad PLUS is GONE for new borrowers (§1087e(a)(3)).
//   * Graduate students: $20,500/yr Direct Unsubsidized, $100,000 aggregate.
//   * Professional students: $50,000/yr, $200,000 aggregate — and grad +
//     professional borrowing share ONE $200,000 pool (§1087e(a)(4)(B)).
//   * Parent PLUS got its OWN new caps: $20,000/yr and $65,000 aggregate PER
//     DEPENDENT STUDENT across ALL parents combined (§1087e(a)(5)) — it is
//     excluded from the $257,500, not "uncapped".
//   * $257,500 LIFETIME cap on all federal loans borrowed for your own
//     education (§1087e(a)(6)) — Direct + FFEL, incl. old Grad PLUS; excl.
//     Parent PLUS borrowed on your behalf as a parent.
//
// THE CORE SUBTLETY — two different counting regimes (spec Correction 2):
//   * The $100k/$200k grad/professional aggregates are RESTORABLE pools:
//     ED's preamble — a borrower at the aggregate "may not receive additional
//     Unsubsidized loans until they are repaid, whether in full or in part."
//     So the pool input is OUTSTANDING principal (repayment frees up room).
//   * The $257,500 lifetime cap and the $65,000 Parent PLUS aggregate are
//     TRUE ODOMETERS: "without regard to any amounts repaid, forgiven,
//     canceled, or otherwise discharged." Their inputs are EVER-BORROWED
//     totals, ignoring repayment. Fixtures F11/F12 lock this asymmetry.
//
// LEGACY ("interim") EXCEPTION (§1087e(a)(8), spec Correction 3): enrolled in
// the program as of June 30, 2026 AND a Direct Loan made for that program
// before July 1, 2026 → the old rules (incl. Grad PLUS up to COA) keep
// applying for the LESSER of 3 academic years or the remaining program
// length; voided by withdrawal; while it lasts it switches off ALL the new
// limits — annual, aggregate, Parent PLUS, and the $257,500. Exception-era
// unsubsidized borrowing still counts against the new pool afterwards, and
// everything (incl. Grad PLUS taken during the exception) counts against the
// $257,500 odometer (spec §7.4, fixture F7).
//
// LITIGATION (spec Correction 4 — load-bearing, handled honestly, not
// silently resolved): the professional-degree definition (34 CFR 685.102) was
// preliminarily stayed in federal court on June 24, 2026; ED's interim list
// (FSA EA updated July 10, 2026) recognizes 29 professional programs. This
// engine NEVER classifies a program — the caller self-selects a mode, and
// professional-mode results carry a date-stamped litigation note built from
// the dataset's `litigation` block.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(n) {
  return Math.max(0, Number(n) || 0);
}

function usd(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

const MAX_YEARS = 6;

// Expected time to credential under the legacy exception: lesser of 3 academic
// years (clock from July 1, 2026) or the remaining program length
// (34 CFR 685.102(b)). `yearsRemaining` IS "program length minus portion
// completed", so no separate years-completed input is needed.
export function expectedTimeToCredential(legacyEligible, yearsRemaining) {
  if (!legacyEligible) return 0;
  return Math.min(3, Math.max(0, Math.floor(Number(yearsRemaining) || 0)));
}

// Named binding constraint = the argmin of the per-year min(). Tie-break
// priority is fixed so ties are deterministic and match the spec fixtures
// (F4: annual cap wins over a simultaneously-exhausting pool).
function bindingConstraint(fed, need, annualCap, poolRemaining, odometerRemaining) {
  if (fed === need) return 'coa';
  if (fed === annualCap) return 'annualCap';
  if (fed === poolRemaining) return 'pool';
  if (odometerRemaining != null && fed === odometerRemaining) return 'lifetime';
  return 'coa';
}

function litigationNote(limits) {
  const lit = limits && limits.litigation;
  if (!lit) return null;
  return `Professional-vs-graduate classification is in active federal litigation (definition stayed ${fmtDate(lit.stayDate)}; ED's interim list of ${lit.interimListCount} professional programs last updated ${fmtDate(lit.interimListUpdated)}, as of ${fmtDate(lit.asOf)}). If your program is later classified the other way, your caps change between $50,000/yr with the $200,000 pool and $20,500/yr with the $100,000 pool. Confirm your program's status with your financial aid office and ED's current list.`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Student modes (graduate | professional): year-by-year federal borrowing
 * capacity vs. program cost under the post-July-1-2026 caps, with the legacy
 * exception and the restorable-pool / lifetime-odometer split.
 *
 * @param {object} a
 * @param {'graduate'|'professional'} a.mode  self-selected — see litigation note; the engine never classifies a program.
 * @param {number} a.yearsRemaining           remaining program years (1–6). Also the "remaining program length" for the exception clock.
 * @param {number} a.annualCoa                cost of attendance per year ($).
 * @param {number} a.annualOtherAid           grants/scholarships/assistantships and other aid per year ($).
 * @param {number} a.priorPoolOutstanding     OUTSTANDING Direct Unsubsidized principal from prior graduate/professional study ($) — the restorable $100k/$200k pool consumption (repayment restores room; old Grad PLUS and undergrad loans do NOT belong here).
 * @param {boolean} [a.everProfessional]      graduate mode only: student is (or has been) a professional student too → the shared $200,000 pool applies instead of $100,000.
 * @param {number} a.lifetimeEverBorrowed     ALL federal student loans EVER borrowed for the student's own education ($) — undergrad + grad + professional, Direct + FFEL, incl. old Grad PLUS, IGNORING repayment/forgiveness (the $257,500 odometer).
 * @param {boolean} a.legacyEligible          enrolled in this program as of June 30, 2026 AND a Direct Loan was made for it before July 1, 2026.
 * @param {object} a.limits                   src/data/student-loan-limits-2026.json.
 */
export function studentLoanPlan(a) {
  const { mode, limits } = a;
  if (!limits || !limits.graduate || !limits.professional || !limits.lifetime) {
    return { error: 'missing_limits', notes: ['Loan limit data failed to load.'] };
  }
  if (mode !== 'graduate' && mode !== 'professional') {
    return { error: 'invalid_mode', notes: [`Unknown mode: ${mode}. Use graduate, professional, or the Parent PLUS / undergraduate helpers.`] };
  }
  const yearsRemaining = Math.floor(Number(a.yearsRemaining) || 0);
  if (yearsRemaining < 1 || yearsRemaining > MAX_YEARS) {
    return { error: 'invalid_years', notes: [`Enter remaining program years between 1 and ${MAX_YEARS}.`] };
  }

  const annualCoa = money(a.annualCoa);
  const annualOtherAid = money(a.annualOtherAid);
  const priorPoolOutstanding = money(a.priorPoolOutstanding);
  const lifetimeEverBorrowed = money(a.lifetimeEverBorrowed);
  const legacyEligible = !!a.legacyEligible;
  const everProfessional = mode === 'professional' ? true : !!a.everProfessional;

  const annualCap = mode === 'professional' ? limits.professional.annual : limits.graduate.annual;
  // One shared $200,000 grad+professional pool; $100,000 only for a graduate
  // student who is not (and has not been) a professional student
  // (20 U.S.C. §1087e(a)(4)(B)).
  const poolCap = everProfessional ? limits.professional.aggregate : limits.graduate.aggregate;
  const odometerCap = limits.lifetime.cap;
  const oldAnnualUnsub = (limits.legacyException && limits.legacyException.oldAnnualUnsub) || limits.graduate.annual;

  let poolRemaining = Math.max(0, poolCap - priorPoolOutstanding);
  let odometerRemaining = Math.max(0, odometerCap - lifetimeEverBorrowed);
  const poolRemainingStart = poolRemaining;
  const odometerRemainingStart = odometerRemaining;

  const etcYears = expectedTimeToCredential(legacyEligible, yearsRemaining);
  const need = Math.max(0, round2(annualCoa - annualOtherAid));

  const years = [];
  let totalFederal = 0;
  let totalGap = 0;
  let legacyUnsubBorrowed = 0;

  for (let y = 1; y <= yearsRemaining; y++) {
    if (y <= etcYears) {
      // Legacy exception year: OLD rules. New annual/aggregate/$257,500 limits
      // do not apply (§1087e(a)(8)); the only ceiling is COA minus other aid
      // (34 CFR 685.203(j)(1) applies under the old rules too): Direct Unsub
      // up to the pre-OBBBA $20,500 + Grad PLUS top-up to COA.
      const fed = need;
      const unsubPortion = round2(Math.min(oldAnnualUnsub, need));
      const plusPortion = round2(fed - unsubPortion);
      // Exception-era unsub still consumes the new pool for any post-exception
      // years (spec §7.4 / fixture F7); everything consumes the odometer.
      poolRemaining = Math.max(0, round2(poolRemaining - unsubPortion));
      odometerRemaining = Math.max(0, round2(odometerRemaining - fed));
      legacyUnsubBorrowed = round2(legacyUnsubBorrowed + unsubPortion);
      years.push({ year: y, legacy: true, need, federal: fed, unsubPortion, legacyPlusPortion: plusPortion, gap: 0, constraint: 'coa' });
      totalFederal = round2(totalFederal + fed);
    } else {
      const fed = round2(Math.max(0, Math.min(annualCap, need, poolRemaining, odometerRemaining)));
      const constraint = bindingConstraint(fed, need, annualCap, poolRemaining, odometerRemaining);
      poolRemaining = Math.max(0, round2(poolRemaining - fed));
      odometerRemaining = Math.max(0, round2(odometerRemaining - fed));
      const gap = round2(Math.max(0, need - fed));
      years.push({ year: y, legacy: false, need, federal: fed, unsubPortion: fed, gap, constraint });
      totalFederal = round2(totalFederal + fed);
      totalGap = round2(totalGap + gap);
    }
  }

  const totalNeed = round2(need * yearsRemaining);
  const notes = [];

  if (etcYears > 0) {
    const legacyEx = limits.legacyException || {};
    notes.push(
      `Legacy exception applied to year${etcYears > 1 ? 's 1–' + etcYears : ' 1'}: because you were enrolled in this program on June 30, 2026 and a Direct Loan was made for it before July 1, 2026, the old rules (including Grad PLUS up to cost of attendance) keep applying for the lesser of 3 academic years or your remaining program length — never past ${fmtDate(legacyEx.outerBound) || 'June 30, 2029'}. Withdrawing or ceasing enrollment cancels the exception.`
    );
    notes.push(
      `During exception years the pre-2026 unsubsidized aggregate applies instead (${usd(legacyEx.preObbbaGradAggregate || 138500)}, including undergraduate loans; ${usd(legacyEx.preObbbaHealthAggregate || 224000)} for certain health-professions programs per ED's NSLDS guidance) — it rarely binds and is not enforced by this calculator. Exception-era unsubsidized borrowing still counts against the new ${usd(poolCap)} pool afterwards, and all of it counts against the ${usd(odometerCap)} lifetime cap.`
    );
    if (etcYears < yearsRemaining) {
      notes.push(`From year ${etcYears + 1} on, the exception has run out and the new caps apply to the remaining years.`);
    }
  }

  if (years.some((yr) => yr.constraint === 'pool')) {
    notes.push(
      `The ${usd(poolCap)} ${everProfessional ? 'shared graduate/professional' : 'graduate'} aggregate is a restorable pool, not a lifetime number: it counts outstanding Direct Unsubsidized principal from graduate/professional study (undergraduate loans and old Grad PLUS balances do not count), and repaying it — in full or in part — frees up room again (ED final rule preamble, 91 FR 23768).`
    );
  }
  if (years.some((yr) => yr.constraint === 'lifetime')) {
    notes.push(
      `The ${usd(odometerCap)} lifetime cap is a true odometer: it counts every federal loan ever borrowed for your own education — undergraduate, graduate, and professional, Direct and FFEL, including old Grad PLUS — "without regard to any amounts repaid, forgiven, canceled, or otherwise discharged" (20 U.S.C. §1087e(a)(6)). Repaying does NOT restore it.`
    );
  }

  const litNote = mode === 'professional' ? litigationNote(limits) : null;
  if (litNote) notes.push(litNote);

  return {
    mode,
    yearsRemaining,
    annualCap,
    poolCap,
    poolLabel: everProfessional ? 'shared $200,000 graduate/professional pool' : '$100,000 graduate pool',
    poolRestorable: true,
    odometerCap,
    poolRemainingStart,
    odometerRemainingStart,
    poolRemainingEnd: poolRemaining,
    odometerRemainingEnd: odometerRemaining,
    etcYears,
    legacyApplied: etcYears > 0,
    legacyUnsubBorrowed,
    years,
    totalNeed,
    totalFederal,
    totalGap,
    litigationNote: litNote,
    notes
  };
}

/**
 * Parent PLUS mode: NEW caps of $20,000/academic year and $65,000 aggregate
 * PER DEPENDENT STUDENT across ALL parents combined (20 U.S.C. §1087e(a)(5)).
 * The aggregate is a true odometer ("without regard to any amounts repaid").
 * Parent PLUS is excluded from the $257,500 lifetime cap — no odometer
 * interaction here by construction.
 *
 * @param {object} a
 * @param {number} a.yearsRemaining            remaining program years (1–6).
 * @param {number} a.annualCoa                 dependent student's cost of attendance per year ($).
 * @param {number} a.annualOtherAid            other aid per year ($).
 * @param {number} a.parentPlusEverBorrowed    Parent PLUS EVER borrowed for THIS student by ALL parents combined ($), ignoring repayment.
 * @param {boolean} a.legacyEligible           student enrolled as of June 30, 2026 AND a Direct Loan (to the parent OR to the student) made for this program before July 1, 2026.
 * @param {object} a.limits                    src/data/student-loan-limits-2026.json.
 */
export function parentPlusPlan(a) {
  const { limits } = a;
  if (!limits || !limits.parentPlus) {
    return { error: 'missing_limits', notes: ['Loan limit data failed to load.'] };
  }
  const yearsRemaining = Math.floor(Number(a.yearsRemaining) || 0);
  if (yearsRemaining < 1 || yearsRemaining > MAX_YEARS) {
    return { error: 'invalid_years', notes: [`Enter remaining program years between 1 and ${MAX_YEARS}.`] };
  }

  const annualCoa = money(a.annualCoa);
  const annualOtherAid = money(a.annualOtherAid);
  const everBorrowed = money(a.parentPlusEverBorrowed);
  const legacyEligible = !!a.legacyEligible;

  const annualCap = limits.parentPlus.annual;
  const aggregateCap = limits.parentPlus.aggregate;
  let poolRemaining = Math.max(0, aggregateCap - everBorrowed);
  const poolRemainingStart = poolRemaining;

  const etcYears = expectedTimeToCredential(legacyEligible, yearsRemaining);
  const need = Math.max(0, round2(annualCoa - annualOtherAid));

  const years = [];
  let totalFederal = 0;
  let totalGap = 0;

  for (let y = 1; y <= yearsRemaining; y++) {
    if (y <= etcYears) {
      // Legacy exception year: pre-2026 Parent PLUS rules — up to COA minus
      // other aid, no annual/aggregate cap (§1087e(a)(8); 34 CFR 685.203(f)(1)).
      const fed = need;
      // Exception-era Parent PLUS still counts toward the $65,000 odometer for
      // any post-exception years — the statute counts all PLUS ever borrowed
      // on the student's behalf, without regard to repayment (conservative
      // reading, spec §7.4 symmetry).
      poolRemaining = Math.max(0, round2(poolRemaining - fed));
      years.push({ year: y, legacy: true, need, federal: fed, gap: 0, constraint: 'coa' });
      totalFederal = round2(totalFederal + fed);
    } else {
      const fed = round2(Math.max(0, Math.min(annualCap, need, poolRemaining)));
      let constraint;
      if (fed === need) constraint = 'coa';
      else if (fed === annualCap) constraint = 'annualCap';
      else constraint = 'aggregate';
      poolRemaining = Math.max(0, round2(poolRemaining - fed));
      const gap = round2(Math.max(0, need - fed));
      years.push({ year: y, legacy: false, need, federal: fed, gap, constraint });
      totalFederal = round2(totalFederal + fed);
      totalGap = round2(totalGap + gap);
    }
  }

  const notes = [];
  notes.push(
    `The ${usd(annualCap)}/year and ${usd(aggregateCap)} Parent PLUS caps apply per dependent student, combined across ALL parents — not per parent borrower — and the ${usd(aggregateCap)} aggregate never resets: it counts everything ever borrowed for this student "without regard to any amounts repaid, forgiven, canceled, or otherwise discharged" (20 U.S.C. §1087e(a)(5)).`
  );
  notes.push(
    `Parent PLUS is excluded from the student's ${usd((limits.lifetime && limits.lifetime.cap) || 257500)} lifetime cap, and the student's own unchanged undergraduate Stafford loans ($5,500–$7,500/yr for dependent students, $31,000 aggregate) are separate from these parent-side figures.`
  );
  if (etcYears > 0) {
    notes.push(
      `Legacy exception applied to year${etcYears > 1 ? 's 1–' + etcYears : ' 1'}: the student was enrolled on June 30, 2026 and a Direct Loan (to the parent or to the student) was made for this program before July 1, 2026, so pre-2026 rules (Parent PLUS up to cost of attendance minus other aid) apply for the lesser of 3 academic years or the remaining program length. If the student withdraws or ceases enrollment, the exception ends.`
    );
    if (etcYears < yearsRemaining) {
      notes.push(`From year ${etcYears + 1} on, the exception has run out and the new Parent PLUS caps apply.`);
    }
  }

  return {
    mode: 'parentPlus',
    yearsRemaining,
    annualCap,
    aggregateCap,
    aggregateRestorable: false,
    excludedFromLifetimeCap: true,
    poolRemainingStart,
    poolRemainingEnd: poolRemaining,
    etcYears,
    legacyApplied: etcYears > 0,
    years,
    totalNeed: round2(need * yearsRemaining),
    totalFederal,
    totalGap,
    notes
  };
}

/**
 * Undergraduate info mode — the student's own Stafford limits are UNCHANGED
 * by P.L. 119-21 (CRS R48727; 34 CFR 685.203(a)-(d) untouched). No new-cap
 * math applies to the student's own undergraduate loans; only the parent
 * (Parent PLUS) side changed.
 *
 * @param {object} a
 * @param {boolean} a.dependent   dependent (true) vs independent (false) undergraduate.
 * @param {number} a.yearNumber   1 = first year, 2 = second year, 3+ = third year and beyond.
 * @param {object} a.limits       src/data/student-loan-limits-2026.json.
 */
export function undergradInfo(a) {
  const { limits } = a;
  if (!limits || !limits.undergraduate) {
    return { error: 'missing_limits', notes: ['Loan limit data failed to load.'] };
  }
  const dependent = a.dependent !== false;
  const yearNumber = Math.max(1, Math.floor(Number(a.yearNumber) || 1));
  const table = dependent ? limits.undergraduate.dependent : limits.undergraduate.independent;
  const idx = Math.min(yearNumber, table.annualByYear.length) - 1;
  const annual = table.annualByYear[idx];
  const aggregate = table.aggregate;
  return {
    mode: 'undergradInfo',
    unchanged: true,
    dependent,
    yearNumber,
    annual,
    aggregate,
    maxSubsidized: dependent && table.maxSubsidizedByYear ? table.maxSubsidizedByYear[idx] : null,
    notes: [
      `Undergraduate Direct Loan limits are unchanged by the 2026 rule: ${usd(annual)} for year ${yearNumber >= 3 ? '3+' : yearNumber} as a ${dependent ? 'dependent' : 'independent'} student, ${usd(aggregate)} aggregate. No new-cap math applies to your own undergraduate loans.`,
      `What DID change on the undergraduate side is the parent piece: Parent PLUS now has its own caps of $20,000/year and $65,000 total per dependent student across all parents — use the Parent PLUS mode to see the parent-side numbers.`
    ]
  };
}

export { round2, fmtDate };
