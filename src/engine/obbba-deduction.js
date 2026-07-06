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
