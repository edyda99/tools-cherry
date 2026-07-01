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
