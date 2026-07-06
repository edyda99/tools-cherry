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
