// obbba-deduction.js — pure, framework-free math for the 2025 One Big Beautiful
// Bill Act "no tax on tips" (IRC §224) and "no tax on overtime" (IRC §225)
// above-the-line federal deductions. Runs client-side (browser ESM) and in Node
// (build-time tests). All tax PARAMETERS live in obbba-deductions-2026.json +
// tax-data-2026.json; this file is pure logic.
//
// SCOPE: estimates the FEDERAL income-tax reduction from the deduction. The
// deduction does NOT reduce FICA (Social Security + Medicare), and state
// treatment is handled separately (see the conformity data). These caps and
// thresholds are FIXED statutory amounts for tax years 2025–2028.

import { federalIncomeTax } from './paycheck-engine.js';

// Filing-status ids shared with the paycheck engine / tax-data-2026.json:
// 'single' | 'married' (MFJ) | 'head_of_household'. Married-filing-separately is
// NOT eligible for these deductions, so it is intentionally not offered.
function pick(map, filingStatus) {
  return map[filingStatus] ?? map.single;
}

/**
 * The allowed deduction after the MAGI phase-out and the eligible-amount cap.
 * Phase-out: the statutory cap is reduced by `reductionPer1000` dollars for each
 * $1,000 (or fraction thereof) by which MAGI exceeds the threshold, never below 0.
 * The deduction can never exceed the actual eligible amount (premium or tips).
 *
 * @param {object} a
 * @param {number} a.eligibleAmount  overtime PREMIUM, or qualified tips (USD/yr)
 * @param {string} a.filingStatus    'single' | 'married' | 'head_of_household'
 * @param {number} a.magi            modified AGI (≈ total annual income)
 * @param {object} a.params          obbba.federal.overtime or .tips
 * @returns {{allowedCap:number, cappedByPhaseout:number, deduction:number, phasedOut:boolean}}
 */
export function allowedDeduction({ eligibleAmount, filingStatus, magi, params }) {
  const statutoryCap = pick(params.cap, filingStatus);
  const start = pick(params.phaseoutStartMagi, filingStatus);
  const per1000 = params.phaseoutReductionPer1000;

  let allowedCap = statutoryCap;
  if (magi > start) {
    const steps = Math.ceil((magi - start) / 1000); // "or fraction thereof"
    allowedCap = Math.max(0, statutoryCap - steps * per1000);
  }
  const eligible = Math.max(0, eligibleAmount || 0);
  const deduction = Math.max(0, Math.min(eligible, allowedCap));
  return {
    statutoryCap,
    allowedCap,
    deduction,
    phasedOut: allowedCap < statutoryCap,
    fullyPhasedOut: allowedCap <= 0
  };
}

/**
 * Federal income tax saved by an above-the-line deduction, computed EXACTLY as
 * (tax without the deduction) − (tax with it). This is exact across bracket
 * boundaries, unlike a flat marginal-rate estimate.
 *
 * @param {number} grossAnnual   total annual income (USD)
 * @param {string} filingStatus  'single' | 'married' | 'head_of_household'
 * @param {number} deduction     the allowed deduction (USD)
 * @param {object} fed           taxData.federal (brackets + standardDeduction)
 * @returns {{taxBefore:number, taxAfter:number, taxSaved:number, marginalRate:number}}
 */
export function federalTaxSaved(grossAnnual, filingStatus, deduction, fed) {
  const taxBefore = federalIncomeTax(grossAnnual, filingStatus, fed, 0);
  const taxAfter = federalIncomeTax(grossAnnual, filingStatus, fed, Math.max(0, deduction));
  const taxSaved = Math.max(0, taxBefore - taxAfter);
  const marginalRate = deduction > 0 ? taxSaved / deduction : 0;
  return { taxBefore, taxAfter, taxSaved, marginalRate };
}

/**
 * Overtime premium from a regular hourly rate and overtime hours. Only the
 * "half" above the regular rate qualifies, so premium = 0.5 × rate × hours.
 * (Time-and-a-half pays 1.5× the regular rate; the extra 0.5× is the premium.)
 */
export function overtimePremium(regularRate, overtimeHours) {
  const r = Math.max(0, regularRate || 0);
  const h = Math.max(0, overtimeHours || 0);
  return 0.5 * r * h;
}

// ---------------------------------------------------------------------------
// OBBBA "senior bonus" deduction (IRC §151(d)(5)(C), added by OBBBA §70103) —
// the $6,000-per-person deduction for taxpayers 65+ that is widely (and
// wrongly) marketed as "no tax on Social Security". Unlike tips/overtime it is
// BELOW the line, per-PERSON, phases out CONTINUOUSLY at 6% of the MAGI excess
// (no $1,000 steps), and is denied outright to married-filing-separately.
// Parameters live in obbba-deductions-2026.json federal.senior.

/**
 * The senior deduction for one return.
 * Rules (statute + Schedule 1-A): $6,000 per qualified individual (65 by the
 * end of the tax year, work-eligible SSN); married must file jointly (MFS = 0);
 * the PER-PERSON $6,000 is reduced by 6% of MAGI over $75,000 ($150,000 for a
 * joint return — all other statuses, incl. QSS/HoH, use $75,000), never below
 * zero; tax years 2025–2028 only, not indexed.
 *
 * @param {object} a
 * @param {number}  a.year          tax year (deduction exists 2025–2028)
 * @param {string}  a.filingStatus  'single' | 'married' (MFJ) | 'married_separate' | 'head_of_household' | 'qss'
 * @param {boolean} a.age65         taxpayer is 65+ by Dec 31 of the tax year
 * @param {boolean} a.spouseAge65   spouse is 65+ by Dec 31 (only counts when MFJ)
 * @param {number}  a.magi          modified AGI (AGI + §911/§931/§933 exclusions)
 * @param {object}  a.params        obbba.federal.senior
 * @returns {{eligibleCount:number, threshold:number, excess:number,
 *   perPersonReduction:number, deductionBeforePhaseout:number,
 *   phaseoutReduction:number, deduction:number, phasedOut:boolean,
 *   fullyPhasedOut:boolean, notes:string[]}}
 */
export function seniorDeduction({ year, filingStatus, age65, spouseAge65, magi, params }) {
  const amount = params.amountPerPerson;
  const threshold = pick(params.phaseoutStartMagi, filingStatus);
  const m = Math.max(0, magi || 0);
  const excess = Math.max(0, m - threshold);
  const perPersonReduction = Math.min(amount, params.phaseoutRate * excess);

  const notes = [];
  let eligibleCount = (age65 ? 1 : 0) + (filingStatus === 'married' && spouseAge65 ? 1 : 0);
  if (year < params.firstYear || year > params.lastYear) {
    eligibleCount = 0;
    notes.push('not_in_effect'); // Sec. 70103(c): taxable years 2025–2028 only
  } else if (filingStatus === 'married_separate') {
    eligibleCount = 0;
    notes.push('mfs_denied'); // clause (v): married taxpayers must file jointly
  } else if (eligibleCount === 0) {
    notes.push('not_65'); // nobody attained 65 before the close of the tax year
  }

  const deductionBeforePhaseout = eligibleCount * amount;
  const phaseoutReduction = eligibleCount * perPersonReduction;
  const deduction = Math.max(0, deductionBeforePhaseout - phaseoutReduction);
  const phasedOut = eligibleCount > 0 && perPersonReduction > 0;
  const fullyPhasedOut = eligibleCount > 0 && perPersonReduction >= amount;
  if (fullyPhasedOut) notes.push('fully_phased_out');
  else if (phasedOut) notes.push('phased_out');

  return {
    eligibleCount, threshold, excess, perPersonReduction,
    deductionBeforePhaseout, phaseoutReduction, deduction,
    phasedOut, fullyPhasedOut, notes
  };
}

// Bracket table to use for the tax-saved estimate. QSS uses the MFJ brackets
// under federal law (but keeps the $75,000 senior threshold above); MFS maps to
// single only for safety — its deduction is always $0, so nothing is computed.
const SENIOR_BRACKET_STATUS = {
  single: 'single',
  married: 'married',
  head_of_household: 'head_of_household',
  qss: 'married',
  married_separate: 'single'
};

/**
 * One-call estimate for the senior-deduction tool: the deduction plus the
 * federal income tax saved (same exact bracket-diff method as tips/overtime).
 * NOTE: the estimate treats MAGI as total income against the regular standard
 * deduction; it does not model the taxable-Social-Security computation or the
 * pre-existing extra standard deduction for 65+.
 */
export function estimateSenior({ year, filingStatus, age65, spouseAge65, magi, federal, fed }) {
  const d = seniorDeduction({ year, filingStatus, age65, spouseAge65, magi, params: federal.senior });
  const bracketStatus = SENIOR_BRACKET_STATUS[filingStatus] || 'single';
  const saved = federalTaxSaved(Math.max(0, magi || 0), bracketStatus, d.deduction, fed);
  return { ...d, taxSaved: saved.taxSaved, marginalRate: saved.marginalRate };
}

// ---------------------------------------------------------------------------
// OBBBA SALT deduction cap (IRC §164(b)(6), amended by OBBBA §70120) — the
// state-and-local-tax cap raise: $10,000 → $40,000 (2025), then 101%/yr
// through 2029, phased back down for high earners (30% of the MAGI excess
// over the threshold, never below the $10,000 floor), reverting to a flat
// $10,000 in 2030. Married-filing-separately gets HALF of every amount
// (cap, threshold, floor). Unlike tips/overtime/senior this is an ITEMIZED-
// deduction limit, so tools must always run the itemize-vs-standard
// comparison. Parameters live in obbba-deductions-2026.json federal.salt.

function saltStatusAmount(value, filingStatus) {
  return filingStatus === 'married_separate' ? value / 2 : value;
}

/**
 * The SALT deduction cap for one return, and the allowed deduction.
 * Rules (statute): cap $40,000 (2025) / $40,400 (2026) / $40,804 (2027),
 * 101%/yr through 2029 (2028–2029 rounding pending IRS guidance); MFS = half.
 * 2025–2029 the cap is reduced by 30% of MAGI over $500,000 / $505,000 /
 * $510,050 (MFS = half), never below $10,000 ($5,000 MFS). 2030+ is a flat
 * $10,000 ($5,000 MFS) with NO phase-down; pre-2025 is the old TCJA cap.
 *
 * @param {object} a
 * @param {number} a.year          tax year
 * @param {string} a.filingStatus  'single' | 'married' (MFJ) | 'married_separate' | 'head_of_household'
 * @param {number} a.magi          modified AGI (AGI + §911/§931/§933 exclusions ≈ AGI)
 * @param {number} a.saltPaid      state/local income (or sales) tax + property tax paid
 * @param {object} a.params        obbba.federal.salt
 * @returns {{baseCap:number, threshold:number|null, excess:number,
 *   reduction:number, floor:number, effectiveCap:number, allowedSalt:number,
 *   floorMagi:number|null, phasedDown:boolean, floorReached:boolean,
 *   torpedoZone:boolean, capBinding:boolean, notes:string[]}}
 */
export function saltCap({ year, filingStatus, magi, saltPaid, params }) {
  const floor = saltStatusAmount(params.floor, filingStatus);
  const paid = Math.max(0, saltPaid || 0);
  const m = Math.max(0, magi || 0);
  const notes = [];

  let baseCap;
  let threshold = null;
  let excess = 0;
  let reduction = 0; // raw 30% × excess, BEFORE the floor clamps it
  let effectiveCap;
  let floorMagi = null;

  if (year < params.firstYear) {
    // Old law (TCJA): flat $10,000 ($5,000 MFS), no phase-down.
    baseCap = effectiveCap = saltStatusAmount(params.revertCap, filingStatus);
    notes.push('not_in_effect');
  } else if (year > params.lastPhaseYear) {
    // 2030+: reverts to a flat $10,000 ($5,000 MFS), no phase-down at any income.
    baseCap = effectiveCap = saltStatusAmount(params.revertCap, filingStatus);
    notes.push('reverted');
  } else {
    baseCap = saltStatusAmount(params.capByYear[year], filingStatus);
    threshold = saltStatusAmount(params.thresholdByYear[year], filingStatus);
    excess = Math.max(0, m - threshold);
    reduction = params.phaseDownRate * excess;
    effectiveCap = Math.max(baseCap - reduction, floor);
    floorMagi = threshold + (baseCap - floor) / params.phaseDownRate;
    if ((params.pendingGuidanceYears || []).includes(year)) notes.push('pending_irs_guidance');
  }

  const allowedSalt = Math.min(paid, effectiveCap);
  const phasedDown = excess > 0;
  const floorReached = excess > 0 && baseCap - reduction <= floor;
  // Inside the phase-down band proper: cap still shrinking (the "SALT torpedo").
  const torpedoZone = excess > 0 && baseCap - reduction > floor;
  if (floorReached) notes.push('floor_reached');
  else if (phasedDown) notes.push('phased_down');

  return {
    year, baseCap, threshold, excess, reduction, floor, effectiveCap,
    allowedSalt, floorMagi, phasedDown, floorReached, torpedoZone,
    capBinding: paid >= effectiveCap && paid > 0, notes
  };
}

// Bracket table for the SALT tax-saved estimate. MFS maps to single — the
// closest published table we carry (identical brackets except the top-rate
// threshold); the estimate is labeled approximate in the tools.
const SALT_BRACKET_STATUS = {
  single: 'single',
  married: 'married',
  married_separate: 'single',
  head_of_household: 'head_of_household'
};

/**
 * Full comparison for the SALT tool: new-law cap vs the old $10,000/$5,000
 * cap (same-year counterfactual), the itemize-vs-standard verdict, and the
 * federal tax saved via the exact bracket-diff machinery.
 * Standard deductions are published (and encoded) for 2025–2026 only; for
 * other years standardDeduction/itemize/bestNew/bestOld/deductionBenefit/
 * taxSaved come back null and only the SALT-level delta is computed.
 *
 * @param {object} a
 * @param {number} a.year, {string} a.filingStatus, {number} a.magi
 * @param {number} a.saltPaid       SALT actually paid (income/sales + property)
 * @param {number} a.otherItemized  non-SALT Schedule A items (mortgage interest, charity, …)
 * @param {object} a.params         obbba.federal.salt
 * @param {object} [a.fed]          taxData.federal (brackets + standardDeduction) — optional
 */
export function saltComparison({ year, filingStatus, magi, saltPaid, otherItemized, params, fed }) {
  const cap = saltCap({ year, filingStatus, magi, saltPaid, params });
  const paid = Math.max(0, saltPaid || 0);
  const other = Math.max(0, otherItemized || 0);

  // Same-year counterfactual under the old TCJA $10,000 ($5,000 MFS) cap.
  const oldCap = saltStatusAmount(params.revertCap, filingStatus);
  const allowedSaltOld = Math.min(paid, oldCap);

  const sdTable = params.standardDeductionByYear[year] || null;
  const standardDeduction = sdTable ? (sdTable[filingStatus] ?? sdTable.single) : null;

  const itemizedTotal = cap.allowedSalt + other;
  const itemizedTotalOld = allowedSaltOld + other;
  const saltDeductionDelta = cap.allowedSalt - allowedSaltOld;

  let itemize = null, bestNew = null, bestOld = null, deductionBenefit = null;
  let taxSaved = null, marginalRate = null;
  if (standardDeduction != null) {
    bestNew = Math.max(itemizedTotal, standardDeduction);
    bestOld = Math.max(itemizedTotalOld, standardDeduction);
    itemize = itemizedTotal > standardDeduction;
    deductionBenefit = bestNew - bestOld;
    if (fed) {
      // Exact bracket-diff: tax on (MAGI − old best deduction) minus tax on
      // (MAGI − new best deduction). federalIncomeTax subtracts its own
      // standard deduction, so pass the remainder as the preTax amount —
      // (best − fedSd) may be negative, which the engine handles exactly.
      const bracketStatus = SALT_BRACKET_STATUS[filingStatus] || 'single';
      const fedSd = fed.standardDeduction[bracketStatus] ?? fed.standardDeduction.single;
      const income = Math.max(0, magi || 0);
      const taxOld = federalIncomeTax(income, bracketStatus, fed, bestOld - fedSd);
      const taxNew = federalIncomeTax(income, bracketStatus, fed, bestNew - fedSd);
      taxSaved = Math.max(0, taxOld - taxNew);
      marginalRate = deductionBenefit > 0 ? taxSaved / deductionBenefit : 0;
    }
  }

  return {
    ...cap, oldCap, allowedSaltOld, standardDeduction,
    itemizedTotal, itemizedTotalOld, saltDeductionDelta,
    itemize, bestNew, bestOld, deductionBenefit, taxSaved, marginalRate
  };
}

// ---------------------------------------------------------------------------
// OBBBA car-loan interest deduction (IRC §163(h)(4) "qualified passenger
// vehicle loan interest", added by OBBBA §70203) — up to $10,000 of loan
// INTEREST (per RETURN, not per vehicle) on a loan for a NEW, US-final-
// assembly, personal-use vehicle originated after 2024-12-31 (not a lease).
// BELOW the line but available to non-itemizers; it does NOT reduce AGI.
// Unlike tips/overtime/senior, married-filing-separately IS eligible (its own
// $10,000 cap, $100,000 threshold). Phase-out: $200 per $1,000 (or portion
// thereof) of MAGI over $100,000 ($200,000 for a joint return only),
// subtracted from the CAPPED interest AFTER the $10,000 ceiling, never below
// zero. Tax years 2025–2028, not indexed. Parameters live in
// obbba-deductions-2026.json federal.carLoan.

/**
 * First-year interest on an amortizing car loan from its terms — the amount
 * that becomes the deductible base (before the $10,000 cap). Assumes a fully
 * amortizing fixed-rate loan with `monthsPaid` payments in the first tax year
 * (12 for a full year; fewer if the term is shorter). Uses the closed-form
 * balance after k payments Bk = P(1+r)^k − M((1+r)^k − 1)/r, so the interest
 * paid over those k months = k·M − (P − Bk).
 *
 * @param {object} a
 * @param {number} a.amount        loan principal P (USD)
 * @param {number} a.apr           annual percentage rate as a decimal (0.065 = 6.5%)
 * @param {number} a.termMonths    loan term n (months)
 * @param {number} [a.monthsPaid]  payments in the first tax year (default min(12, n))
 * @returns {{monthlyPayment:number, firstYearInterest:number, months:number}}
 */
export function carLoanFirstYearInterest({ amount, apr, termMonths, monthsPaid }) {
  const P = Math.max(0, amount || 0);
  const n = Math.max(0, Math.round(termMonths || 0));
  const r = (apr || 0) / 12;
  if (P <= 0 || n <= 0) return { monthlyPayment: 0, firstYearInterest: 0, months: 0 };
  const k = Math.min(monthsPaid && monthsPaid > 0 ? Math.round(monthsPaid) : 12, n);
  if (r <= 0) {
    return { monthlyPayment: P / n, firstYearInterest: 0, months: k }; // 0% loan: no interest
  }
  const M = P * r / (1 - Math.pow(1 + r, -n));
  const Bk = P * Math.pow(1 + r, k) - M * (Math.pow(1 + r, k) - 1) / r;
  const firstYearInterest = Math.max(0, k * M - (P - Bk));
  return { monthlyPayment: M, firstYearInterest, months: k };
}

// Filing statuses that get the JOINT $200,000 threshold. Everything else —
// single, head of household, and (unlike tips/overtime) married-filing-
// separately — uses $100,000; the map in params.phaseoutStartMagi encodes this.

/**
 * The car-loan interest deduction for one return.
 * Rules (statute): min(interest, $10,000) reduced by $200 for each $1,000 (or
 * portion thereof) of MAGI over the threshold ($100,000; $200,000 only for a
 * joint return — single, HoH, and MFS all use $100,000), never below zero.
 * The reduction hits the CAPPED interest, not the $10,000 ceiling (statutory
 * clause order: apply the cap first, then subtract the reduction). Gated on
 * eligibility (new / US final assembly / personal-use / non-lease loan
 * originated after 2024-12-31) and on the 2025–2028 window.
 *
 * @param {object} a
 * @param {number}  a.year          tax year (deduction exists 2025–2028)
 * @param {string}  a.filingStatus  'single' | 'married' (MFJ) | 'head_of_household' | 'married_separate'
 * @param {number}  a.magi          modified AGI (AGI + §911/§931/§933 exclusions)
 * @param {number}  a.interest      qualified interest paid in the year (USD)
 * @param {boolean} [a.eligible]    vehicle/loan passes the eligibility checklist (default true)
 * @param {object}  a.params        obbba.federal.carLoan
 * @returns {{statutoryCap:number, threshold:number, excess:number,
 *   reduction:number, cappedInterest:number, deduction:number,
 *   phasedOut:boolean, fullyPhasedOut:boolean, inWindow:boolean,
 *   eligible:boolean, notes:string[]}}
 */
export function carLoanDeduction({ year, filingStatus, magi, interest, eligible = true, params }) {
  const cap = params.interestCap;
  const threshold = pick(params.phaseoutStartMagi, filingStatus);
  const per1000 = params.phaseoutReductionPer1000;
  const paidInterest = Math.max(0, interest || 0);
  const cappedInterest = Math.min(paidInterest, cap);
  const m = Math.max(0, magi || 0);
  const excess = Math.max(0, m - threshold);
  const steps = excess > 0 ? Math.ceil(excess / 1000) : 0; // "$1,000 or portion thereof"
  const reduction = steps * per1000;

  const notes = [];
  const inWindow = year >= params.firstYear && year <= params.lastYear;
  if (!inWindow) notes.push('not_in_effect'); // §70203: taxable years 2025–2028 only
  if (!eligible) notes.push('ineligible');

  const deduction = (inWindow && eligible) ? Math.max(0, cappedInterest - reduction) : 0;
  const phasedOut = inWindow && eligible && reduction > 0;
  const fullyPhasedOut = inWindow && eligible && cappedInterest > 0 && reduction >= cappedInterest;
  if (fullyPhasedOut) notes.push('fully_phased_out');
  else if (phasedOut) notes.push('phased_out');

  return {
    statutoryCap: cap, threshold, excess, reduction, cappedInterest,
    deduction, phasedOut, fullyPhasedOut, inWindow, eligible, notes
  };
}

// Bracket table for the car-loan tax-saved estimate. MFS maps to single — the
// closest published table carried (MFS IS eligible here, unlike tips/overtime),
// so the estimate is labeled approximate for MFS in the tool.
const CAR_LOAN_BRACKET_STATUS = {
  single: 'single',
  married: 'married',
  head_of_household: 'head_of_household',
  married_separate: 'single'
};

/**
 * One-call estimate for the car-loan tool: the allowed deduction plus the
 * federal income tax saved (exact bracket-diff, same as the siblings). The
 * deduction is below-the-line but available to non-itemizers, so it stacks on
 * the standard deduction and reduces taxable income only (NOT AGI).
 */
export function estimateCarLoan({ year, filingStatus, magi, interest, eligible = true, federal, fed }) {
  const d = carLoanDeduction({ year, filingStatus, magi, interest, eligible, params: federal.carLoan });
  const bracketStatus = CAR_LOAN_BRACKET_STATUS[filingStatus] || 'single';
  const saved = federalTaxSaved(Math.max(0, magi || 0), bracketStatus, d.deduction, fed);
  return { ...d, interest: Math.max(0, interest || 0), taxSaved: saved.taxSaved, marginalRate: saved.marginalRate };
}

// ---------------------------------------------------------------------------
// 2026 Form W-4 Step 4(b) Deductions Worksheet helper for the OBBBA tips
// (line 1a) and overtime-premium (line 1b) deductions. This turns the SAME
// filing-time deduction the tips/overtime tools already compute into a
// PAYCHECK-NOW adjustment: how much to add to the W-4 Step 4(b) Deductions
// Worksheet so the employer withholds less each payday, instead of the worker
// over-withholding all year and getting it back as a refund.
//
// IMPORTANT (per the sourced spec): this is Step 4(b) — DEDUCTIONS, which LOWER
// withholding (more take-home now). It is NOT Step 4(c), which is EXTRA
// withholding (the opposite direction). Pub 15-T subtracts Step 4(b)
// dollar-for-dollar from the annualized wage before the brackets apply, so the
// annual withholding reduction ≈ federalTaxSaved(income, status, D_total) — one
// COMBINED exact-bracket-diff on the summed deduction, never the sum of two
// separate single-deduction calls (that mis-handles a bracket boundary the
// combined deduction spans; see spec fixture F9 at $280k MFJ).

// Pay periods per year for the per-paycheck divisor (the only new literal —
// mirrors PAY_PERIODS in paycheck-engine.js but scoped to the four the W-4
// helper offers; MFS-ineligible tips/overtime never use 'annual').
export const W4_PAY_PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

/**
 * Estimate the 2026 W-4 Step 4(b) adjustment for tips + overtime.
 * Computes the allowed tips deduction (worksheet line 1a) and the allowed
 * overtime-PREMIUM deduction (line 1b) — each after its own statutory cap and
 * gradual MAGI phase-out via allowedDeduction — sums them into D_total (the
 * amount they add to the Step 4(b) total on worksheet line 15), then estimates:
 *   - annualReduction ≈ federalTaxSaved(income, status, D_total)  (ONE combined call)
 *   - perPaycheck     = annualReduction / payPeriodsPerYear       (full-year adjustment)
 *   - perPaycheckRemaining = annualReduction / remainingPeriods   (if adjusting mid-year)
 *
 * @param {object} a
 * @param {number}  a.income           total expected 2026 income (≈ MAGI)
 * @param {string}  a.filingStatus     'single' | 'married' (MFJ) | 'head_of_household'
 * @param {number}  a.tips             expected qualified tips for the year (0 = tips off)
 * @param {number}  a.overtimePremium  the overtime PREMIUM (0.5× portion) for the year
 * @param {keyof W4_PAY_PERIODS} a.payFrequency
 * @param {number}  [a.monthsRemaining] months left in the year (default 12 = full year)
 * @param {object}  a.federal          obbba.federal (uses .tips and .overtime)
 * @param {object}  a.fed              taxData.federal (brackets + standardDeduction)
 * @returns {{tips:object, overtime:object, dTips:number, dOt:number, dTotal:number,
 *   tipsCapBound:boolean, otCapBound:boolean, tipsPhasedOut:boolean, otPhasedOut:boolean,
 *   anyPhasedOut:boolean, annualReduction:number, marginalRate:number,
 *   periodsPerYear:number, remainingPeriods:number, fullYear:boolean,
 *   perPaycheck:number, perPaycheckRemaining:number, ficaStillApplies:boolean}}
 */
export function estimateW4Adjustment({ income, filingStatus, tips, overtimePremium, payFrequency, monthsRemaining, federal, fed }) {
  const magi = Math.max(0, income || 0);
  const tipsIn = Math.max(0, tips || 0);
  const otIn = Math.max(0, overtimePremium || 0);

  // Line 1a (tips) and line 1b (overtime premium): cap + gradual phase-out.
  const tipsRes = allowedDeduction({ eligibleAmount: tipsIn, filingStatus, magi, params: federal.tips });
  const otRes = allowedDeduction({ eligibleAmount: otIn, filingStatus, magi, params: federal.overtime });
  const dTips = tipsRes.deduction;
  const dOt = otRes.deduction;
  const dTotal = dTips + dOt;

  // Annual withholding reduction: ONE combined exact-bracket-diff on D_total.
  const saved = federalTaxSaved(magi, filingStatus, dTotal, fed);

  const periodsPerYear = W4_PAY_PERIODS[payFrequency] ?? 52;
  const fullYear = !(monthsRemaining > 0 && monthsRemaining < 12);
  const monthsLeft = fullYear ? 12 : monthsRemaining;
  const remainingPeriods = Math.max(1, Math.round((periodsPerYear * monthsLeft) / 12));

  return {
    tips: tipsRes,
    overtime: otRes,
    dTips,
    dOt,
    dTotal,
    // The entered amount exceeded the (possibly phased-down) allowed cap.
    tipsCapBound: tipsIn > tipsRes.allowedCap && tipsRes.allowedCap > 0,
    otCapBound: otIn > otRes.allowedCap && otRes.allowedCap > 0,
    tipsPhasedOut: tipsRes.phasedOut,
    otPhasedOut: otRes.phasedOut,
    anyPhasedOut: tipsRes.phasedOut || otRes.phasedOut,
    annualReduction: saved.taxSaved,
    marginalRate: saved.marginalRate,
    periodsPerYear,
    remainingPeriods,
    fullYear,
    perPaycheck: saved.taxSaved / periodsPerYear,
    perPaycheckRemaining: saved.taxSaved / remainingPeriods,
    ficaStillApplies: true
  };
}

/**
 * One-call estimate for a tool: given the eligible amount + income + status,
 * return the allowed deduction and the federal tax saved.
 * @param {'overtime'|'tips'} kind
 */
export function estimate({ kind, eligibleAmount, grossAnnual, filingStatus, federal, fed }) {
  const params = federal[kind];
  const magi = Math.max(0, grossAnnual || 0);
  const d = allowedDeduction({ eligibleAmount, filingStatus, magi, params });
  const saved = federalTaxSaved(magi, filingStatus, d.deduction, fed);
  return {
    kind,
    eligibleAmount: Math.max(0, eligibleAmount || 0),
    statutoryCap: d.statutoryCap,
    allowedCap: d.allowedCap,
    deduction: d.deduction,
    phasedOut: d.phasedOut,
    fullyPhasedOut: d.fullyPhasedOut,
    taxSaved: saved.taxSaved,
    marginalRate: saved.marginalRate,
    ficaStillApplies: true
  };
}
