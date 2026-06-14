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

/** Federal income tax withholding estimate (annual). */
export function federalIncomeTax(grossAnnual, filingStatus, fed) {
  const stdDed = fed.standardDeduction[filingStatus] ?? fed.standardDeduction.single;
  const brackets = fed.brackets[filingStatus] ?? fed.brackets.single;
  const taxable = Math.max(0, grossAnnual - stdDed);
  return applyBrackets(taxable, brackets);
}

/** FICA: Social Security + Medicare + Additional Medicare (annual). */
export function ficaTax(grossAnnual, filingStatus, fed) {
  const ss = Math.min(grossAnnual, fed.fica.socialSecurity.wageBase) * fed.fica.socialSecurity.rate;
  const medicare = grossAnnual * fed.fica.medicare.rate;
  const addlThreshold =
    fed.fica.additionalMedicare.threshold[filingStatus] ??
    fed.fica.additionalMedicare.threshold.single;
  const addlMedicare =
    Math.max(0, grossAnnual - addlThreshold) * fed.fica.additionalMedicare.rate;
  return { socialSecurity: ss, medicare, additionalMedicare: addlMedicare, total: ss + medicare + addlMedicare };
}

/**
 * State income tax (annual). Data-driven so adding a state = adding JSON.
 * Supported tax.type: "none" | "flat" | "bracket".
 */
export function stateIncomeTax(grossAnnual, filingStatus, stateData) {
  if (!stateData || !stateData.hasIncomeTax || !stateData.tax) return 0;
  const t = stateData.tax;
  if (t.type === 'none') return 0;

  const stdDed = (t.standardDeduction && (t.standardDeduction[filingStatus] ?? t.standardDeduction.single)) || 0;
  const taxable = Math.max(0, grossAnnual - stdDed);

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
 * Full paycheck computation.
 * @param {object} input
 * @param {{type:'salary'|'hourly', amount:number, hoursPerWeek?:number}} input.wage
 * @param {string} input.filingStatus - one of tax-data filingStatuses ids
 * @param {keyof PAY_PERIODS} input.payFrequency
 * @param {object} taxData - parsed tax-data-2026.json
 * @param {string} input.stateSlug
 * @returns {object} annual + per-period breakdown
 */
export function computePaycheck({ wage, filingStatus, payFrequency, stateSlug }, taxData) {
  const fed = taxData.federal;
  const grossAnnual = annualizeGross(wage);
  const stateData = taxData.states ? taxData.states[stateSlug] : null;

  const federal = federalIncomeTax(grossAnnual, filingStatus, fed);
  const fica = ficaTax(grossAnnual, filingStatus, fed);
  const state = stateIncomeTax(grossAnnual, filingStatus, stateData);

  const totalTax = federal + fica.total + state;
  const netAnnual = Math.max(0, grossAnnual - totalTax);

  const periods = PAY_PERIODS[payFrequency] ?? 1;
  const perPeriod = (v) => v / periods;

  const annual = {
    gross: grossAnnual,
    federal,
    socialSecurity: fica.socialSecurity,
    medicare: fica.medicare + fica.additionalMedicare,
    state,
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
    totalTax: perPeriod(annual.totalTax),
    net: perPeriod(annual.net)
  };

  return { annual, perPaycheck, periods, payFrequency, filingStatus, stateSlug };
}
