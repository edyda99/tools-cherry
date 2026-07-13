// section-127.js — Employer Student Loan Repayment / Educational Assistance
// tax-benefit engine (IRC §127), per docs/section-127-student-loan-repayment-spec.md.
// Pure, framework-free. Runs client-side (browser ESM) and in Node (build-time
// tests). Every dollar/rate PARAMETER (the $5,250 cap, the FICA wage base, the
// FICA rates, the Additional-Medicare thresholds, the indexing rule) comes from
// src/data/section-127-2026.json — this file is pure §127 arithmetic.
//
// THE LAW (all figures verified in the spec against the codified IRC at
// law.cornell.edu, IRS FS-2026-10, Pub 15-B (2026), and the SSA 2026 COLA):
//   * §127(a)(2): an employer's educational assistance is excluded from the
//     employee's gross income up to $5,250 PER INDIVIDUAL PER CALENDAR YEAR.
//   * §127(c)(1)(B) (made PERMANENT by OBBBA §70412, effective for payments
//     after 12/31/2025): "educational assistance" includes the payment by an
//     employer, to the employee OR to a lender, of principal or interest on a
//     qualified education loan incurred by the employee for the employee's OWN
//     education.
//   * THE SHARED CAP: tuition-type assistance (subparagraph (A)) and loan
//     repayment (subparagraph (B)) are one defined term under one $5,250 cap.
//     loanExclusionRoom = max(0, cap - tuitionAssistanceUsed). You cannot get
//     $5,250 of tuition AND another $5,250 of loan repayment in the same year.
//   * DUAL EMPLOYEE EXCLUSION: the excluded amount is NOT wages for income-tax
//     withholding (§3401(a)(18)) NOR FICA (§3121(a)(18)) NOR FUTA (§3306(b)(13)).
//     Employee saves marginal income tax + FICA; employer saves its matching
//     FICA (7.65%, versus paying the same amount as taxable wages/bonus).
//   * THE WAGE-BASE STRADDLE: OASDI (6.2%) applies only to the slice of the
//     hypothetical extra wages that sits under the Social Security wage base
//     ($184,500 in 2026). Medicare (1.45%) always applies. So the 7.65% FICA
//     saving collapses toward 1.45% for an employee already over the wage base,
//     and the "~$402 employer saving" headline is wrong for high earners.
//     The employer NEVER matches the 0.9% Additional Medicare (employee-only).
//   * INDEXING (§127(d), 2027+): the $5,250 is inflation-adjusted for taxable
//     years beginning after 2026; the INCREASE rounds to the NEAREST $50 (can
//     round UP — unusual). The official 2027 figure comes from the annual IRS
//     Rev. Proc.; this engine fails closed to $5,250 until it is parameterized.

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// §127(d)(2): the INCREASE rounds to the NEAREST multiple of $50 (not the usual
// round-DOWN pattern), so it can round up (e.g. a $131.25 increase -> $150).
export function roundToNearest50(x) {
  return 50 * Math.round(x / 50);
}

function money(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function rate(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * The §127 cap for a given year.
 *  - 2025 and 2026 stay at the base $5,250.
 *  - 2027+ ("taxable year beginning after 2026"): base + roundToNearest50(base x cola),
 *    where cola is the §1(f)(3) chained-CPI adjustment (base year 2025). The engine
 *    never guesses this: if the caller supplies a colaRate it is applied; if the
 *    dataset carries an official published figure it wins; otherwise the cap FAILS
 *    CLOSED to $5,250 and `pending` is set so the UI can say "official 2027 figure
 *    pending the IRS Rev. Proc." (spec F10, §6).
 *
 * @returns {{cap:number, pending:boolean, indexed:boolean, increase?:number, official?:boolean}}
 */
export function capForYear(year, params, colaRate) {
  const base = params.cap;
  const y = Math.floor(Number(year) || params.taxYear || 2026);
  const idx = params.indexing || {};
  const firstIndexed = idx.firstIndexedYear || 2027;
  if (y < firstIndexed) return { cap: base, pending: false, indexed: false };
  // An officially published figure (e.g. once the 2027 Rev. Proc. lands and the
  // dataset is updated) takes precedence and is never overridden by a guess.
  if (idx.official2027Cap && y === firstIndexed) {
    return { cap: idx.official2027Cap, pending: false, indexed: true, official: true };
  }
  const cola = colaRate == null ? null : rate(colaRate);
  if (cola == null || cola <= 0) return { cap: base, pending: true, indexed: true };
  const increment = idx.roundToNearestIncrement || 50;
  const increase = increment * Math.round((base * cola) / increment);
  return { cap: base + increase, pending: false, indexed: true, increase };
}

/**
 * Employer Student Loan Repayment / §127 educational-assistance tax benefit.
 *
 * @param {object} input
 * @param {object} input.params                 src/data/section-127-2026.json (required).
 * @param {number} [input.year=2026]            calendar/tax year (drives the cap + indexing).
 * @param {number} input.loanRepaymentBenefit   annual employer loan-repayment benefit ($).
 * @param {number} [input.tuitionAssistanceUsed=0] tuition-type §127 assistance already used
 *                                               this year (shares the one $5,250 cap).
 * @param {number} input.marginalFedRate        employee marginal federal rate (e.g. 0.22).
 * @param {number} [input.wages=0]              employee's OTHER wages this year, excluding the
 *                                               benefit (drives the wage-base / Additional-Medicare
 *                                               FICA logic). Under the base -> simple 7.65%.
 * @param {string} [input.filingStatus='single'] Additional-Medicare threshold selector.
 * @param {boolean} [input.stateConforms=true]  does the employee's state conform to the §127
 *                                               loan-repayment exclusion? California does NOT.
 * @param {number} [input.stateMarginalRate=0]  state marginal income-tax rate.
 * @param {number|null} [input.colaRate=null]   §1(f)(3) COLA for an indexed (2027+) year.
 * @param {boolean} [input.multipleEmployers=false] flags the two-employers aggregation caveat.
 */
export function computeSection127(input) {
  const params = input && input.params;
  if (!params || !params.cap) {
    return { error: 'missing_params', notes: ['Calculator data failed to load.'] };
  }

  const year = Math.floor(Number(input.year) || params.taxYear || 2026);
  const capInfo = capForYear(year, params, input.colaRate);
  const cap = capInfo.cap;

  const loanBenefit = money(input.loanRepaymentBenefit);
  const tuitionUsed = money(input.tuitionAssistanceUsed);
  const marginalFedRate = rate(input.marginalFedRate);
  const wages = money(input.wages);
  const stateMarginalRate = rate(input.stateMarginalRate);
  const stateConforms = input.stateConforms !== false;
  const filingStatus = input.filingStatus || 'single';

  // ---- The SHARED cap: one $5,250 for tuition-type + loan repayment combined.
  const excludedTuition = Math.min(tuitionUsed, cap);
  const loanExclusionRoom = Math.max(0, cap - tuitionUsed);
  const excludedLoan = Math.min(loanBenefit, loanExclusionRoom);
  const totalExcluded = Math.min(excludedTuition + excludedLoan, cap);
  const remainingRoom = Math.max(0, cap - totalExcluded);

  // Anything over the room (or tuition already over the whole cap) is taxable wages.
  const loanExcess = Math.max(0, loanBenefit - loanExclusionRoom);
  const tuitionExcess = Math.max(0, tuitionUsed - cap);
  const excessTaxable = loanExcess + tuitionExcess;

  // ---- FICA parameters + the wage-base / Additional-Medicare straddle helper.
  const wb = params.ficaWageBase;
  const oasdiRate = params.oasdiRate;
  const medRate = params.medicareRate;
  const addlRate = params.additionalMedicareRate;
  const thresholds = params.additionalMedicareThreshold || {};
  const addlThreshold = thresholds[filingStatus] != null
    ? thresholds[filingStatus]
    : (thresholds.single != null ? thresholds.single : 200000);

  // FICA on `base` dollars that stack on top of `stackBase` of other wages.
  //  * OASDI (6.2%) only on the slice of `base` under the SS wage base.
  //  * Medicare (1.45%) on all of `base`.
  //  * Additional Medicare (0.9%, employee-only) only on the slice of `base`
  //    above the filing-status threshold — prorating the straddle.
  function fica(base, stackBase, includeAddl) {
    const b = Math.max(0, base);
    const oasdiBase = Math.min(Math.max(wb - stackBase, 0), b);
    const oasdi = oasdiBase * oasdiRate;
    const medicare = b * medRate;
    let addl = 0;
    if (includeAddl) {
      const addlBase = Math.min(Math.max((stackBase + b) - addlThreshold, 0), b);
      addl = addlBase * addlRate;
    }
    return { oasdi, medicare, addl, total: oasdi + medicare + addl, oasdiBase };
  }

  // The excluded amounts are not wages, so the counterfactual "paid as taxable
  // wages instead" stacks on top of the employee's REAL wages (other wages plus
  // any over-cap excess, which IS real wages).
  const savingStackBase = wages + excessTaxable;

  // ---- Employee saving on the excluded LOAN repayment (the tool's subject).
  const empFicaObj = fica(excludedLoan, savingStackBase, true);
  const empIncomeTaxSaved = round2(excludedLoan * marginalFedRate);
  const empFicaSaved = round2(empFicaObj.total);
  const empOasdiSaved = round2(empFicaObj.oasdi);
  const empMedicareSaved = round2(empFicaObj.medicare);
  const empAddlMedicareSaved = round2(empFicaObj.addl);
  const empFederalSaved = round2(empIncomeTaxSaved + empFicaSaved);

  // State side: conforming states let the exclusion flow through (a saving);
  // California does NOT conform for the loan-repayment leg -> the benefit is
  // still taxable CA wages, so it is a COST, not a saving (spec §1.9 / F12).
  let empStateSaved = 0;
  let stateTaxCost = 0;
  if (stateMarginalRate > 0 && excludedLoan > 0) {
    if (stateConforms) empStateSaved = round2(excludedLoan * stateMarginalRate);
    else stateTaxCost = round2(excludedLoan * stateMarginalRate);
  }
  const empTotalSaved = round2(empFederalSaved + empStateSaved - stateTaxCost);

  // ---- Employer saving on the TOTAL §127-excluded amount (tuition + loan),
  // versus paying it as taxable wages. Matching FICA only; NO 0.9% Additional
  // Medicare (employee-only); FUTA adds ~$0 (the $7,000 base is already used up);
  // the income-tax deduction is a wash. Collapses to 1.45% above the wage base.
  const erFicaObj = fica(totalExcluded, savingStackBase, false);
  const erFicaSaved = round2(erFicaObj.total);

  // ---- Over-cap excess: ordinary taxable wages on BOTH sides.
  const excessFicaEmp = fica(excessTaxable, wages, true);
  const excessFicaEr = fica(excessTaxable, wages, false);
  const empExcessIncomeTax = round2(excessTaxable * marginalFedRate);
  const empExcessFica = round2(excessFicaEmp.total);
  const empExcessState = stateMarginalRate > 0 ? round2(excessTaxable * stateMarginalRate) : 0;
  const empExcessCost = round2(empExcessIncomeTax + empExcessFica + empExcessState);
  const erExcessCost = round2(excessFicaEr.total);

  // ---- Notes (informational; the statutory-panel copy lives in the template).
  const notes = [];
  if (capInfo.pending) {
    notes.push(`For ${year} the $5,250 cap is inflation-adjusted (IRC §127(d)), but the official figure has not been published yet — the IRS sets it in its annual inflation-adjustment Revenue Procedure (expected fall 2026). This shows the ${params.cap.toLocaleString('en-US')} base until then.`);
  }
  if (input.multipleEmployers && excessTaxable > 0) {
    notes.push(`The $${cap.toLocaleString('en-US')} exclusion is per INDIVIDUAL per calendar year, aggregated across all employers — two employers each paying does not double it. Each employer may reasonably exclude its own payment (the §3121(a)(18) "reasonable to believe" standard), so the over-cap amount is typically reconciled on your tax return; this tool shows the income-tax delta and does not model the withholding mechanics.`);
  }
  if (stateMarginalRate > 0 && !stateConforms && excludedLoan > 0) {
    notes.push(`Your state does not conform to the §127 student-loan-repayment exclusion (this is California's position — its static IRC conformity date predates the CARES Act clause, and conformity bill AB 386 failed on Feb 2, 2026). The employer loan repayment is therefore still taxable wages for state income tax, costing about $${stateTaxCost.toLocaleString('en-US')} — it does NOT change the federal saving above.`);
  }

  return {
    mode: 'section127',
    year,
    cap,
    capPending: capInfo.pending,
    capIndexed: capInfo.indexed,
    capIncrease: capInfo.increase != null ? capInfo.increase : null,
    // shared-cap breakdown
    loanExclusionRoom,
    excludedLoan,
    excludedTuition,
    totalExcluded,
    remainingRoom,
    loanExcess,
    tuitionExcess,
    excessTaxable,
    // employee (on excludedLoan)
    empIncomeTaxSaved,
    empFicaSaved,
    empOasdiSaved,
    empMedicareSaved,
    empAddlMedicareSaved,
    empFederalSaved,
    empStateSaved,
    stateConforms,
    stateTaxCost,
    empTotalSaved,
    // employer (on totalExcluded)
    erFicaSaved,
    aboveWageBase: wages >= wb,
    // over-cap excess (both sides)
    empExcessIncomeTax,
    empExcessFica,
    empExcessState,
    empExcessCost,
    erExcessCost,
    notes
  };
}

export default computeSection127;
