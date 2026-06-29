// employment-tax.js — pure, dependency-free 1099 (self-employed) vs W-2 (employee)
// take-home ESTIMATE math. Shared by the browser tool and the unit tests.
// No deps, nothing uploaded.
//
// SCOPE / ASSUMPTIONS (federal only — NO state tax):
//   * W-2 employee FICA = 7.65% of gross wages (6.2% Social Security up to the
//     wage base + 1.45% Medicare, no cap).
//   * 1099 self-employment tax = 15.3% on 92.35% of net earnings (12.4% Social
//     Security up to the wage base + 2.9% Medicare, no cap). The employer-half
//     of SE tax (50%) is deductible from income before federal income tax.
//   * Federal income tax estimated from the bracket table + standard deduction.
//   * Additional Medicare and the QBI deduction are intentionally omitted to keep
//     the estimate simple and transparent.
//
// TAX YEAR: 2026. Figures below are the IRS 2026 values (Rev. Proc. 2025-32 for the
// standard deduction & brackets; SSA 2026 COLA for the Social Security wage base).
// Update TAX_YEAR and the constants together when a new year's figures publish.

export const TAX_YEAR = 2026;

// Social Security wage base (2026). Social Security stops at this; Medicare has none.
const SS_WAGE_BASE = 184500;
const SS_RATE = 0.124;        // combined employer+employee SS (SE basis)
const MEDICARE_RATE = 0.029;  // combined employer+employee Medicare (SE basis)
const FICA_EMPLOYEE_SS = 0.062;
const FICA_EMPLOYEE_MEDICARE = 0.0145;
const SE_NET_FACTOR = 0.9235; // SE tax applies to 92.35% of net earnings

// 2026 federal standard deduction and brackets, by supported filing status.
const STD_DEDUCTION = { single: 16100, married: 32200 };
const BRACKETS = {
  single: [
    { rate: 0.10, upTo: 12400 },
    { rate: 0.12, upTo: 50400 },
    { rate: 0.22, upTo: 105700 },
    { rate: 0.24, upTo: 201775 },
    { rate: 0.32, upTo: 256225 },
    { rate: 0.35, upTo: 640600 },
    { rate: 0.37, upTo: Infinity }
  ],
  married: [
    { rate: 0.10, upTo: 24800 },
    { rate: 0.12, upTo: 100800 },
    { rate: 0.22, upTo: 211400 },
    { rate: 0.24, upTo: 403550 },
    { rate: 0.32, upTo: 512450 },
    { rate: 0.35, upTo: 768700 },
    { rate: 0.37, upTo: Infinity }
  ]
};

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Progressive federal income tax on a given taxable income for a filing status.
export function federalIncomeTax(taxableIncome, status = 'single') {
  const ti = num(taxableIncome);
  if (!Number.isFinite(ti) || ti <= 0) return 0;
  const brackets = BRACKETS[status] || BRACKETS.single;
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    if (ti > lower) {
      const slice = Math.min(ti, b.upTo) - lower;
      tax += slice * b.rate;
      lower = b.upTo;
    } else break;
  }
  return tax;
}

// W-2 employee estimate from annual gross wages.
// Returns { gross, fica, federalTax, takeHome }.
export function w2Estimate(grossWages, status = 'single') {
  const gross = num(grossWages);
  if (!Number.isFinite(gross) || gross < 0) {
    return { gross: NaN, fica: NaN, federalTax: NaN, takeHome: NaN };
  }
  const ss = Math.min(gross, SS_WAGE_BASE) * FICA_EMPLOYEE_SS;
  const medicare = gross * FICA_EMPLOYEE_MEDICARE;
  const fica = ss + medicare;
  const std = STD_DEDUCTION[status] || STD_DEDUCTION.single;
  const taxable = Math.max(0, gross - std);
  const federalTax = federalIncomeTax(taxable, status);
  const takeHome = gross - fica - federalTax;
  return { gross, fica, federalTax, takeHome };
}

// 1099 self-employed estimate from annual net earnings (gross contract income
// minus business expenses — the caller passes the net figure).
// Returns { net, seTax, seTaxDeduction, federalTax, takeHome }.
export function se1099Estimate(netEarnings, status = 'single') {
  const net = num(netEarnings);
  if (!Number.isFinite(net) || net < 0) {
    return { net: NaN, seTax: NaN, seTaxDeduction: NaN, federalTax: NaN, takeHome: NaN };
  }
  // SE tax base = 92.35% of net earnings.
  const seBase = net * SE_NET_FACTOR;
  const ssTax = Math.min(seBase, SS_WAGE_BASE) * SS_RATE;
  const medicareTax = seBase * MEDICARE_RATE;
  const seTax = ssTax + medicareTax;
  // Half the SE tax is deductible from income before federal income tax.
  const seTaxDeduction = seTax / 2;
  const std = STD_DEDUCTION[status] || STD_DEDUCTION.single;
  const taxable = Math.max(0, net - seTaxDeduction - std);
  const federalTax = federalIncomeTax(taxable, status);
  const takeHome = net - seTax - federalTax;
  return { net, seTax, seTaxDeduction, federalTax, takeHome };
}

// Compare a W-2 wage offer against a 1099 net-earnings figure at the same status.
// Returns { w2, se, takeHomeGap } where takeHomeGap = w2.takeHome - se.takeHome
// (positive => the W-2 keeps more after federal + payroll/SE tax, before the
// value of any employer benefits is considered).
export function compare(grossWages, netEarnings, status = 'single') {
  const w2 = w2Estimate(grossWages, status);
  const se = se1099Estimate(netEarnings, status);
  const takeHomeGap = (Number.isFinite(w2.takeHome) && Number.isFinite(se.takeHome))
    ? w2.takeHome - se.takeHome
    : NaN;
  return { w2, se, takeHomeGap, taxYear: TAX_YEAR };
}
