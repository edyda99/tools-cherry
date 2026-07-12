// dependent-care.js — pure, framework-free math for the DCFSA-vs-CDCTC decision
// under OBBBA (P.L. 119-21, §70404), effective TY2026. Runs client-side (browser
// ESM) and in Node (build-time tests). All PARAMETERS live in
// dependent-care-2026.json + tax-data-2026.json; this file is pure logic.
//
// TWO federal child-care benefits, and they interact (no double-dip):
//   1. Dependent Care FSA / §129 exclusion — a Section 125 CAFETERIA pre-tax
//      salary reduction (up to $7,500; $3,750 MFS). It saves BOTH income tax AND
//      FICA (Social Security + Medicare), regardless of tax liability.
//   2. Child & Dependent Care Credit / §21 — a NONREFUNDABLE income-tax credit,
//      applicablePercent (50%→35%→20% AGI-tiered) × min(expenses, cap), clamped
//      to actual income-tax liability. Expense caps $3,000 (1) / $6,000 (2+).
//
// THE INTERACTION (the whole game):
//   - §21(c) reduces the $3,000/$6,000 cap DOLLAR-FOR-DOLLAR by the §129 exclusion.
//     Since the new max FSA ($7,500) EXCEEDS even the $6,000 two-child cap, maxing
//     the FSA ALWAYS zeroes the credit — for any family size. The choice is a
//     CORNER SOLUTION (max the FSA, or skip it and take the credit); there is no
//     smooth "optimal split."
//   - The credit is NONREFUNDABLE, so at low AGI (little/no tax) it is worth far
//     less than its nominal rate; the FSA's FICA saving is not liability-limited.
//   - MFS generally CANNOT take the CDCTC (§21(e)(2) needs a joint return); this
//     engine returns a $0 credit for married-filing-separately.
//
// Reuses paycheck-engine.js primitives (federalIncomeTax = exact bracket walk net
// of a pre-tax amount; ficaTax = wage-base-aware Social Security + Medicare +
// Additional Medicare, already modeling §125 cafeteria pre-tax reducing FICA).

import { federalIncomeTax, ficaTax, federalBracketBreakdown } from './paycheck-engine.js';

// Filing-status ids shared with the paycheck engine / tax-data-2026.json:
// 'single' | 'married' (MFJ) | 'head_of_household' | 'married_separate'.
// federalIncomeTax / ficaTax fall MFS through to the single tables (matching W-4
// withholding), which is exactly what we want for the FSA's tax-saved side.

/**
 * The §129 DCFSA exclusion cap for a filing status: $7,500, or $3,750 for MFS.
 * @param {string} filingStatus
 * @param {object} dcfsa   dc.dcfsa (limit map)
 */
export function dcfsaLimit(filingStatus, dcfsa) {
  return dcfsa.limit[filingStatus] ?? dcfsa.limit.single;
}

/**
 * §21(a)(2) applicable percentage as a decimal (0.50 … 0.20). Two-stage
 * phase-down, "or fraction thereof" = ceil:
 *   - Stage 1: 50%, reduced 1 pt per $2,000 of AGI over $15,000, floor 35%.
 *     NOT joint-doubled — same $15,000 threshold and $2,000 steps for single AND
 *     joint filers (the joint parentheticals appear only in stage 2).
 *   - Stage 2: from the stage-1 result, reduced 1 pt per $2,000 ($4,000 joint) of
 *     AGI over $75,000 ($150,000 joint), floor 20%.
 * @param {number} agi
 * @param {string} filingStatus
 * @param {object} cdctc   dc.cdctc
 * @returns {number} applicable percentage in [0.20, 0.50]
 */
export function applicablePercent(agi, filingStatus, cdctc) {
  const ap = cdctc.applicablePercent;
  const joint = filingStatus === 'married';
  const m = Math.max(0, agi || 0);
  const top = ap.top * 100;          // 50
  const floor1 = ap.stage1Floor * 100; // 35
  const floor2 = ap.stage2Floor * 100; // 20

  let p = top;
  if (m > ap.stage1.threshold) {
    p = Math.max(floor1, top - Math.ceil((m - ap.stage1.threshold) / ap.stage1.increment));
  }
  const thr2 = joint ? ap.stage2.thresholdJoint : ap.stage2.thresholdSingle;
  const inc2 = joint ? ap.stage2.incrementJoint : ap.stage2.incrementSingle;
  if (m > thr2) {
    p = Math.max(floor2, p - Math.ceil((m - thr2) / inc2));
  }
  return p / 100;
}

/**
 * §21(c) creditable expenses after the §129 cap reduction and the earned-income
 * limit: max(0, min(expenses − fsa, cap − fsa, earnedIncomeLimit − fsa)).
 * Passing fsa = 0 gives the skip-FSA base min(expenses, cap, ei); passing the
 * FSA exclusion x gives the max-FSA residual (which is $0 whenever fsa ≥ cap).
 * @param {object} a
 * @param {number} a.expenses          total qualifying dependent-care expenses
 * @param {number} a.fsa               §129 exclusion actually used
 * @param {number} a.cap               $3,000 (1 dependent) / $6,000 (2+)
 * @param {number} [a.earnedIncomeLimit] lower-earner earned income (default ∞)
 */
export function creditableExpenses({ expenses, fsa, cap, earnedIncomeLimit }) {
  const x = Math.max(0, fsa || 0);
  const e = Math.max(0, expenses || 0);
  const ei = earnedIncomeLimit == null ? Infinity : Math.max(0, earnedIncomeLimit);
  return Math.max(0, Math.min(e - x, cap - x, ei - x));
}

/**
 * The §129 DCFSA benefit for excluding `x` of pay: the income-tax saved (exact
 * bracket-diff) PLUS the FICA saved (Section 125 cafeteria reduces FICA wages;
 * wage-base aware, so a high earner above $184,500 saves only 1.45% Medicare).
 * AGI is used as the wage proxy (the tool asks for household income, not W-2 box
 * 3), consistent with the sourced spec.
 * @param {number} agi
 * @param {string} filingStatus
 * @param {number} x            the FSA exclusion
 * @param {object} fed          taxData.federal (brackets + standardDeduction + fica)
 */
export function dcfsaBenefit(agi, filingStatus, x, fed) {
  const exclusion = Math.max(0, x || 0);
  const taxBefore = federalIncomeTax(agi, filingStatus, fed, 0);
  const taxAfter = federalIncomeTax(agi, filingStatus, fed, exclusion);
  const incomeTaxSaved = Math.max(0, taxBefore - taxAfter);
  const ficaSaved = Math.max(
    0,
    ficaTax(agi, filingStatus, fed, 0).total - ficaTax(agi, filingStatus, fed, exclusion).total
  );
  return { exclusion, incomeTaxSaved, ficaSaved, taxSaved: incomeTaxSaved + ficaSaved };
}

/**
 * The CDCTC for one scenario: nonrefundable, clamped to income-tax liability.
 * MFS is disallowed (§21(e)(2)) → credit $0 (never a crash, never a wrong nonzero).
 * @param {object} a
 * @param {number} a.agi              AGI used for the applicable-% lookup (post-FSA in the max scenario)
 * @param {string} a.filingStatus
 * @param {number} a.creditable       creditable expenses (already §129/EI-reduced)
 * @param {object} a.cdctc            dc.cdctc
 * @param {object} a.fed              taxData.federal
 * @returns {{applicablePercent:number, creditable:number, nominal:number, taxLiability:number, credit:number, clampedByLiability:boolean, mfsIneligible:boolean}}
 */
export function cdctcCredit({ agi, filingStatus, creditable, cdctc, fed }) {
  const mfsIneligible = filingStatus === 'married_separate';
  const p = mfsIneligible ? 0 : applicablePercent(agi, filingStatus, cdctc);
  const c = mfsIneligible ? 0 : Math.max(0, creditable || 0);
  const nominal = p * c;
  const taxLiability = federalIncomeTax(agi, filingStatus, fed, 0); // nonrefundable ceiling
  const credit = mfsIneligible ? 0 : Math.min(nominal, taxLiability);
  return {
    applicablePercent: p,
    creditable: c,
    nominal,
    taxLiability,
    credit,
    clampedByLiability: !mfsIneligible && nominal > taxLiability,
    mfsIneligible
  };
}

/**
 * Full DCFSA-vs-CDCTC comparison. Computes BOTH corners exactly:
 *   Strategy A — SKIP the FSA, take the credit (income-tax reduction only).
 *   Strategy B — MAX the FSA (income-tax + FICA saved + any residual credit).
 * then recommends the corner that nets more, with the dollar delta. There is no
 * interior "optimal split" to recommend: §129 erodes the §21 cap 1:1, so total
 * benefit is linear in the FSA amount and the optimum is always an endpoint.
 *
 * @param {object} a
 * @param {string} a.filingStatus     'single' | 'married' | 'head_of_household' | 'married_separate'
 * @param {number} a.agi              household AGI BEFORE any FSA (the engine derives post-FSA AGI)
 * @param {number} a.numDependents    qualifying individuals under 13 (or disabled); 1 → $3,000 cap, 2+ → $6,000
 * @param {number} a.careExpenses     annual eligible dependent-care spend
 * @param {number} [a.employerFsaMax] max the employer's DCAP allows (capped at the statutory limit; default = limit; 0 = no plan)
 * @param {number} [a.lowerEarnerIncome] lower-earning spouse's earned income (caps both benefits; default = AGI, non-binding)
 * @param {object} a.dc               parsed dependent-care-2026.json
 * @param {object} a.fed              taxData.federal (brackets + standardDeduction + fica)
 */
export function dependentCareComparison({ filingStatus, agi, numDependents, careExpenses, employerFsaMax, lowerEarnerIncome, dc, fed }) {
  const cdctc = dc.cdctc;
  const dcfsa = dc.dcfsa;
  const income = Math.max(0, agi || 0);
  const expenses = Math.max(0, careExpenses || 0);
  const cap = (numDependents >= 2) ? cdctc.expenseCap.twoOrMore : cdctc.expenseCap.oneChild;
  const statutoryFsaLimit = dcfsaLimit(filingStatus, dcfsa);
  // employerFsaMax defaults to the statutory limit; always clamped to it (a plan
  // can't exceed the statutory cap). 0 (or no plan) → the FSA lever is unavailable.
  const rawEmployerMax = (employerFsaMax == null) ? statutoryFsaLimit : Math.max(0, employerFsaMax);
  const fsaCap = Math.min(rawEmployerMax, statutoryFsaLimit);
  const hasEmployerPlan = fsaCap > 0;
  // Lower-earner income caps both benefits (§129(b)/§21(d)); default AGI is non-binding.
  const eiLimit = (lowerEarnerIncome != null && lowerEarnerIncome > 0) ? lowerEarnerIncome : income;
  const mfsIneligible = filingStatus === 'married_separate';

  // ---------- Strategy A: SKIP FSA, take the credit ----------
  const creditableA = creditableExpenses({ expenses, fsa: 0, cap, earnedIncomeLimit: eiLimit });
  const creditResA = cdctcCredit({ agi: income, filingStatus, creditable: creditableA, cdctc, fed });
  const strategyA = {
    fsa: 0,
    agi: income,
    applicablePercent: creditResA.applicablePercent,
    creditableExpenses: creditableA,
    fsaIncomeTaxSaved: 0,
    fsaFicaSaved: 0,
    credit: creditResA.credit,
    creditClampedByLiability: creditResA.clampedByLiability,
    benefit: creditResA.credit
  };

  // ---------- Strategy B: MAX the FSA ----------
  const x = Math.min(expenses, fsaCap, eiLimit);
  const agiB = income - x;
  const fsa = dcfsaBenefit(income, filingStatus, x, fed);
  const creditableB = creditableExpenses({ expenses, fsa: x, cap, earnedIncomeLimit: eiLimit });
  const creditResB = cdctcCredit({ agi: agiB, filingStatus, creditable: creditableB, cdctc, fed });
  const strategyB = {
    fsa: x,
    agi: agiB,
    applicablePercent: creditResB.applicablePercent,
    creditableExpenses: creditableB,
    fsaIncomeTaxSaved: fsa.incomeTaxSaved,
    fsaFicaSaved: fsa.ficaSaved,
    credit: creditResB.credit,
    creditClampedByLiability: creditResB.clampedByLiability,
    benefit: fsa.incomeTaxSaved + fsa.ficaSaved + creditResB.credit,
    zeroesCredit: x >= cap
  };

  // ---------- Recommendation (a CORNER — never a blend) ----------
  const EPS = 0.5; // sub-dollar ties treated as ties
  let recommended;
  if (!hasEmployerPlan) {
    recommended = 'skip_fsa'; // no DCAP offered → the credit is the only lever
  } else if (strategyB.benefit > strategyA.benefit + EPS) {
    recommended = 'max_fsa';
  } else if (strategyA.benefit > strategyB.benefit + EPS) {
    recommended = 'skip_fsa';
  } else {
    recommended = 'tie';
  }
  const delta = Math.abs(strategyB.benefit - strategyA.benefit);

  // ---------- Break-even framing ----------
  // FSA per-dollar rate ≈ marginal income-tax rate + marginal FICA rate. Derive
  // the marginal income rate from the brackets; the marginal FICA rate from the
  // exact FICA diff on the excluded dollars (falls to Medicare-only above the SS
  // wage base). creditRate = the skip-scenario applicable percentage.
  const marginalIncomeRate = federalBracketBreakdown(income, filingStatus, fed, 0).marginalRate;
  const marginalFicaRate = x > 0 ? fsa.ficaSaved / x : marginalFicaAt(income, filingStatus, fed);
  const fsaRate = marginalIncomeRate + marginalFicaRate;
  const creditRate = strategyA.applicablePercent;

  const notes = [];
  if (mfsIneligible) notes.push('mfs_no_credit');
  if (!hasEmployerPlan) notes.push('no_employer_plan');
  if (strategyB.zeroesCredit && hasEmployerPlan) notes.push('max_fsa_zeroes_credit');
  if (creditResA.clampedByLiability) notes.push('credit_clamped_low_liability');
  if (recommended === 'tie') notes.push('tie');

  return {
    cap,
    statutoryFsaLimit,
    fsaCap,
    hasEmployerPlan,
    mfsIneligible,
    earnedIncomeLimit: eiLimit,
    strategyA,
    strategyB,
    recommended,   // 'max_fsa' | 'skip_fsa' | 'tie'
    delta,
    breakEven: { fsaRate, creditRate, marginalIncomeRate, marginalFicaRate },
    notes
  };
}

// Marginal FICA rate on the next dollar of wages (used only when no FSA dollars
// are excluded, so the diff method can't be applied). Below the SS wage base:
// 6.2% + 1.45% (+0.9% over the Additional Medicare threshold). Above it: 1.45%
// (+0.9% over the threshold).
function marginalFicaAt(wages, filingStatus, fed) {
  const f = fed.fica;
  const w = Math.max(0, wages || 0);
  let rate = f.medicare.rate;
  if (w <= f.socialSecurity.wageBase) rate += f.socialSecurity.rate;
  const thr = f.additionalMedicare.threshold[filingStatus] ?? f.additionalMedicare.threshold.single;
  if (w > thr) rate += f.additionalMedicare.rate;
  return rate;
}
