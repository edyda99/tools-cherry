// paycheck-engine.js — pure, framework-free paycheck math.
// Runs client-side (browser ESM) and in Node (build-time tests).
// All tax PARAMETERS live in tax-data-2026.json; this file is pure logic.

export const PAY_PERIODS = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  annual: 1
};

/**
 * Apply a progressive bracket table to an amount.
 * @param {number} taxable - annual taxable income (USD)
 * @param {Array<{rate:number, upTo:number|null}>} brackets - ascending, last upTo=null
 * @returns {number} annual tax
 */
export function applyBrackets(taxable, brackets) {
  if (taxable <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const band of brackets) {
    const upper = band.upTo == null ? Infinity : band.upTo;
    if (taxable > lower) {
      const slice = Math.min(taxable, upper) - lower;
      tax += slice * band.rate;
    }
    lower = upper;
    if (taxable <= upper) break;
  }
  return tax;
}

/**
 * Convert a wage input into annual gross.
 * @param {{type:'salary'|'hourly', amount:number, hoursPerWeek?:number}} wage
 */
export function annualizeGross(wage) {
  if (wage.type === 'hourly') {
    const hours = wage.hoursPerWeek > 0 ? wage.hoursPerWeek : 40;
    return Math.max(0, wage.amount) * hours * 52;
  }
  return Math.max(0, wage.amount); // salary already annual
}

/**
 * Federal income tax withholding estimate (annual).
 * @param {number} preTax - pre-tax amounts that reduce federal taxable income
 *                          (401(k)/403(b) + Section 125 cafeteria: HSA/FSA/premiums).
 */
export function federalIncomeTax(grossAnnual, filingStatus, fed, preTax = 0) {
  const stdDed = fed.standardDeduction[filingStatus] ?? fed.standardDeduction.single;
  const brackets = fed.brackets[filingStatus] ?? fed.brackets.single;
  const taxable = Math.max(0, grossAnnual - preTax - stdDed);
  return applyBrackets(taxable, brackets);
}

/**
 * Per-bracket breakdown of the federal income tax, for an educational panel:
 * how much income falls in each band, the tax from each, and the marginal rate
 * (the rate on the next dollar). Pure — reuses the brackets the engine already holds.
 * @returns {{taxable:number, stdDed:number, marginalRate:number, bands:Array<{rate,lower,upper,amount,tax}>}}
 */
export function federalBracketBreakdown(grossAnnual, filingStatus, fed, preTax = 0) {
  const stdDed = fed.standardDeduction[filingStatus] ?? fed.standardDeduction.single;
  const brackets = fed.brackets[filingStatus] ?? fed.brackets.single;
  const taxable = Math.max(0, grossAnnual - preTax - stdDed);
  const bands = [];
  let lower = 0;
  let marginalRate = brackets.length ? brackets[0].rate : 0;
  for (const b of brackets) {
    const upper = b.upTo == null ? Infinity : b.upTo;
    const amount = Math.max(0, Math.min(taxable, upper) - lower);
    if (taxable > lower) marginalRate = b.rate; // deepest band the income actually reaches
    bands.push({ rate: b.rate, lower, upper, amount, tax: amount * b.rate });
    if (taxable <= upper) break;
    lower = upper;
  }
  return { taxable, stdDed, marginalRate, bands };
}

/**
 * FICA: Social Security + Medicare + Additional Medicare (annual).
 * @param {number} preTaxFica - pre-tax amounts that ALSO reduce FICA wages
 *                              (Section 125 cafeteria only — 401(k) is still FICA-taxed).
 */
export function ficaTax(grossAnnual, filingStatus, fed, preTaxFica = 0) {
  const ficaWages = Math.max(0, grossAnnual - preTaxFica);
  const ss = Math.min(ficaWages, fed.fica.socialSecurity.wageBase) * fed.fica.socialSecurity.rate;
  const medicare = ficaWages * fed.fica.medicare.rate;
  const addlThreshold =
    fed.fica.additionalMedicare.threshold[filingStatus] ??
    fed.fica.additionalMedicare.threshold.single;
  const addlMedicare =
    Math.max(0, ficaWages - addlThreshold) * fed.fica.additionalMedicare.rate;
  return { socialSecurity: ss, medicare, additionalMedicare: addlMedicare, total: ss + medicare + addlMedicare };
}

/**
 * State income tax (annual). Data-driven so adding a state = adding JSON.
 * Supported tax.type: "none" | "flat" | "bracket".
 * @param {number} preTax - pre-tax amounts that reduce state taxable income
 *                          (most states conform to 401(k) + cafeteria pre-tax treatment).
 */
export function stateIncomeTax(grossAnnual, filingStatus, stateData, preTax = 0) {
  if (!stateData || !stateData.hasIncomeTax || !stateData.tax) return 0;
  const t = stateData.tax;
  if (t.type === 'none') return 0;

  const stdDed = (t.standardDeduction && (t.standardDeduction[filingStatus] ?? t.standardDeduction.single)) || 0;
  const taxable = Math.max(0, grossAnnual - preTax - stdDed);

  if (t.type === 'flat') {
    return taxable * t.rate;
  }
  if (t.type === 'bracket') {
    const brackets = t.brackets[filingStatus] ?? t.brackets.single;
    return applyBrackets(taxable, brackets);
  }
  return 0;
}

/**
 * State employee-side disability / paid-leave contributions (SDI / TDI / PFML /
 * FLI / FAMLI). These are POST-TAX payroll deductions withheld on GROSS wages:
 * they do NOT reduce federal or state taxable income and are independent of
 * income-tax withholding. Purely data-driven — a state opts in by carrying an
 * `employeePrograms` array in tax-data-2026.json.
 *
 * Program shape: {label, rate, wageBase?, annualMax?, weeklyMax?}
 *   rate       decimal employee rate (e.g. 0.013 = 1.3%)
 *   wageBase   annual taxable-wage ceiling in USD; rate stops applying above it
 *   annualMax  hard annual contribution cap in USD (e.g. NY PFL $411.91)
 *   weeklyMax  per-WEEK contribution cap in USD (e.g. HI TDI $7.50, NY DBL $0.60)
 *
 * Cap math, honest across pay frequencies: the annual contribution is
 * rate × min(gross, wageBase), then clamped to an annual dollar ceiling.
 * A weekly dollar cap is converted to its annual equivalent (weeklyMax × 52).
 * Because this calculator assumes even wages across the year (it annualises a
 * single wage input), capping each week at weeklyMax is EXACTLY weeklyMax × 52
 * annually, which then divides cleanly into any pay frequency — no rounding
 * approximation is introduced.
 * @param {number} grossAnnual
 * @param {object} stateData - the single-state entry from tax-data
 * @returns {Array<{label:string, rate:number, annual:number}>}
 */
export function stateEmployeePrograms(grossAnnual, stateData) {
  const list = stateData && Array.isArray(stateData.employeePrograms) ? stateData.employeePrograms : [];
  const g = Math.max(0, grossAnnual);
  return list.map((pr) => {
    const base = pr.wageBase != null ? Math.min(g, pr.wageBase) : g;
    let annual = base * (pr.rate || 0);
    const annualCap = pr.annualMax != null
      ? pr.annualMax
      : (pr.weeklyMax != null ? pr.weeklyMax * 52 : null);
    if (annualCap != null) annual = Math.min(annual, annualCap);
    return { label: pr.label, rate: pr.rate || 0, annual };
  });
}

/**
 * Optional advanced inputs (W-4 + deductions). All annual USD, all default 0
 * so omitting `adv` reproduces the simple-mode result exactly.
 * @typedef {object} AdvancedInputs
 * @property {number} retirement401k  Traditional 401(k)/403(b): cuts income tax, NOT FICA.
 * @property {number} cafeteria125    HSA/FSA + health premiums (Section 125): cuts income tax AND FICA.
 * @property {number} dependentsCredit W-4 step 3 tax credits ($2,000/child etc.): cuts federal tax.
 * @property {number} extraWithholding W-4 step 4(c): flat extra federal withholding.
 * @property {number} postTax         After-tax deductions (Roth, garnishments…): cut net only.
 */
const ZERO_ADV = { retirement401k: 0, cafeteria125: 0, dependentsCredit: 0, extraWithholding: 0, postTax: 0 };

/**
 * Full paycheck computation.
 * @param {object} input
 * @param {{type:'salary'|'hourly', amount:number, hoursPerWeek?:number}} input.wage
 * @param {string} input.filingStatus - one of tax-data filingStatuses ids
 * @param {keyof PAY_PERIODS} input.payFrequency
 * @param {string} input.stateSlug
 * @param {AdvancedInputs} [input.adv] - optional advanced-mode inputs (default all 0)
 * @param {object} taxData - parsed tax-data-2026.json
 * @returns {object} annual + per-period breakdown
 */
export function computePaycheck({ wage, filingStatus, payFrequency, stateSlug, adv }, taxData) {
  const fed = taxData.federal;
  const grossAnnual = annualizeGross(wage);
  const stateData = taxData.states ? taxData.states[stateSlug] : null;

  const a = { ...ZERO_ADV, ...(adv || {}) };
  // clamp negatives; pre-tax can't exceed gross
  const retirement401k = Math.min(Math.max(0, a.retirement401k), grossAnnual);
  const cafeteria125 = Math.min(Math.max(0, a.cafeteria125), grossAnnual);
  const dependentsCredit = Math.max(0, a.dependentsCredit);
  const extraWithholding = Math.max(0, a.extraWithholding);
  const postTax = Math.max(0, a.postTax);

  const preTaxIncome = retirement401k + cafeteria125;   // reduces income-tax base (fed + state)
  const preTaxFica = cafeteria125;                       // only cafeteria reduces FICA wages

  // federal: bracket tax on adjusted income, then credits, then extra withholding
  const fedBracket = federalIncomeTax(grossAnnual, filingStatus, fed, preTaxIncome);
  const federal = Math.max(0, fedBracket - dependentsCredit) + extraWithholding;

  const fica = ficaTax(grossAnnual, filingStatus, fed, preTaxFica);
  const state = stateIncomeTax(grossAnnual, filingStatus, stateData, preTaxIncome);

  // State disability / paid-leave employee contributions: post-tax, on gross
  // wages, kept OUT of totalTax and out of annual.state (so tax-only rates and
  // the pinned state-tax regression tests are unaffected).
  const programs = stateEmployeePrograms(grossAnnual, stateData);
  const statePrograms = programs.reduce((s, p) => s + p.annual, 0);

  const totalTax = federal + fica.total + state;
  const preTaxDeductions = preTaxIncome;                 // 401k + cafeteria leave the paycheck too
  const netAnnual = Math.max(0, grossAnnual - totalTax - preTaxDeductions - postTax - statePrograms);

  const periods = PAY_PERIODS[payFrequency] ?? 1;
  const perPeriod = (v) => v / periods;

  const annual = {
    gross: grossAnnual,
    federal,
    socialSecurity: fica.socialSecurity,
    medicare: fica.medicare + fica.additionalMedicare,
    state,
    statePrograms,
    programs: programs.map((p) => ({ label: p.label, rate: p.rate, amount: p.annual })),
    preTax: preTaxDeductions,
    postTax,
    totalTax,
    net: netAnnual,
    effectiveRate: grossAnnual > 0 ? totalTax / grossAnnual : 0,
    takeHomeRate: grossAnnual > 0 ? netAnnual / grossAnnual : 0
  };

  const perPaycheck = {
    gross: perPeriod(annual.gross),
    federal: perPeriod(annual.federal),
    socialSecurity: perPeriod(annual.socialSecurity),
    medicare: perPeriod(annual.medicare),
    state: perPeriod(annual.state),
    statePrograms: perPeriod(statePrograms),
    programs: programs.map((p) => ({ label: p.label, rate: p.rate, amount: perPeriod(p.annual) })),
    preTax: perPeriod(annual.preTax),
    postTax: perPeriod(annual.postTax),
    totalTax: perPeriod(annual.totalTax),
    net: perPeriod(annual.net)
  };

  return { annual, perPaycheck, periods, payFrequency, filingStatus, stateSlug };
}
