// pay-frequency.js — pure, dependency-free paycheck-frequency math.
// Shared by the browser tool (biweekly-vs-semimonthly.js) and the unit tests.
// No deps, nothing uploaded.
//
// Two ways an employer can split the SAME annual salary across the year:
//   - Biweekly    = paid every two weeks   = 26 paychecks a year (salary / 26)
//   - Semimonthly = paid twice a month     = 24 paychecks a year (salary / 24)
// Both add up to the same annual gross; only the per-check size, the number of
// checks, and the timing differ. Because 26 > 24, each biweekly check is a bit
// smaller, but two months a year land a third biweekly paycheck.
//
// Money is in dollars (the caller's unit); no rounding inside the math — round at
// display time. Invalid input (bad number, negative salary) yields a NaN-filled
// result so the UI can stay quiet (mirrors cagr.js / compound-interest.js).

export const PAY_PERIODS = { biweekly: 26, semimonthly: 24 };
const MONTHS_PER_YEAR = 12;

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Per-paycheck gross for a given number of pay periods. Requires periods > 0.
export function perPaycheck(annualSalary, periods) {
  const s = num(annualSalary), p = num(periods);
  if (![s, p].every(Number.isFinite)) return NaN;
  if (s < 0 || p <= 0) return NaN;
  return s / p;
}

// One pay-schedule summary: how a salary is split across `periods` checks a year.
//   { periods, perCheck, monthly, annual }
// - perCheck : gross per paycheck (salary / periods)
// - monthly  : the average per-month amount these checks deliver
//              (perCheck * periods / 12 = salary / 12 — the same for both schedules)
// - annual   : the annual gross (equals the salary)
export function schedule(annualSalary, periods) {
  const s = num(annualSalary), p = num(periods);
  const bad = { periods: NaN, perCheck: NaN, monthly: NaN, annual: NaN };
  if (![s, p].every(Number.isFinite)) return bad;
  if (s < 0 || p <= 0) return bad;
  const perCheck = s / p;
  return {
    periods: p,
    perCheck,
    monthly: (perCheck * p) / MONTHS_PER_YEAR, // = s / 12
    annual: perCheck * p                        // = s
  };
}

// Full side-by-side comparison of biweekly vs semimonthly for one salary.
// Returns:
//   {
//     annualSalary,
//     biweekly:    { periods:26, perCheck, monthly, annual },
//     semimonthly: { periods:24, perCheck, monthly, annual },
//     perCheckDifference,   // semimonthly perCheck − biweekly perCheck (>= 0)
//     extraPaychecks,       // biweekly checks − semimonthly checks (= 2)
//     threePaycheckMonths   // how many months a year get a 3rd biweekly check (= 2)
//   }
// Invalid salary -> NaN-filled schedules so the UI can stay quiet.
export function compare(annualSalary) {
  const s = num(annualSalary);
  const bw = schedule(s, PAY_PERIODS.biweekly);
  const sm = schedule(s, PAY_PERIODS.semimonthly);

  const valid = Number.isFinite(s) && s >= 0;
  // Semimonthly checks are larger (24 < 26 periods), so semimonthly − biweekly >= 0.
  const perCheckDifference = valid ? sm.perCheck - bw.perCheck : NaN;
  // Biweekly delivers 26 checks vs semimonthly's 24 — two extra checks a year.
  const extraPaychecks = PAY_PERIODS.biweekly - PAY_PERIODS.semimonthly; // 2

  return {
    annualSalary: valid ? s : NaN,
    biweekly: bw,
    semimonthly: sm,
    perCheckDifference,
    extraPaychecks,
    // 26 biweekly checks across 12 months = 10 months with 2 checks + 2 months with 3.
    threePaycheckMonths: PAY_PERIODS.biweekly - (2 * MONTHS_PER_YEAR) // 26 - 24 = 2
  };
}
