// rule-of-72.js — pure, dependency-free "Rule of 72" doubling-time math.
// Shared by the browser tool (rule-of-72-calculator.js) and the unit tests.
// No deps, nothing uploaded.
//
// The Rule of 72 is a mental-math shortcut for compound growth:
//   years to double  ≈ 72 / annual interest rate (in percent)
//   rate to double   ≈ 72 / number of years
// e.g. at 6% a year your money doubles in about 72 / 6 = 12 years.
//
// The same shortcut works with other constants. 70 (the Rule of 70) and the
// more precise 69.3 (= 100 × ln 2, which matches CONTINUOUS compounding) trade
// off mental-math friendliness against accuracy. 72 wins in practice because it
// is evenly divisible by 2, 3, 4, 6, 8, 9 and 12, and is most accurate for the
// 6–10% rates people use most often.
//
// Rates here are PERCENT per year (6 means 6%, not 0.06). All functions return a
// plain number; invalid or non-positive input yields NaN so the UI can stay
// quiet (mirrors cagr.js).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Years to double a value at a given annual percentage rate, using the divisor
// (72, 70, or 69.3). rate is PERCENT per year and must be > 0.
//   years = divisor / rate
export function yearsToDouble(rate, divisor = 72) {
  const r = num(rate), d = num(divisor);
  if (!Number.isFinite(r) || !Number.isFinite(d)) return NaN;
  if (r <= 0 || d <= 0) return NaN;
  return d / r;
}

// Annual percentage rate needed to double a value in a given number of years,
// using the divisor (72, 70, or 69.3). years must be > 0.
//   rate = divisor / years   (returned as PERCENT per year)
export function rateToDouble(years, divisor = 72) {
  const t = num(years), d = num(divisor);
  if (!Number.isFinite(t) || !Number.isFinite(d)) return NaN;
  if (t <= 0 || d <= 0) return NaN;
  return d / t;
}

// The exact answer (no rule-of-thumb), for the accuracy comparison.
//   exact years to double at rate r% = ln(2) / ln(1 + r/100)
export function exactYearsToDouble(rate) {
  const r = num(rate);
  if (!Number.isFinite(r) || r <= 0) return NaN;
  return Math.log(2) / Math.log(1 + r / 100);
}

// The exact annual rate (PERCENT) needed to double in t years.
//   exact rate = (2^(1/t) − 1) × 100
export function exactRateToDouble(years) {
  const t = num(years);
  if (!Number.isFinite(t) || t <= 0) return NaN;
  return (Math.pow(2, 1 / t) - 1) * 100;
}

// The three divisor constants, in display order, with a short note on each.
export const DIVISORS = [
  { value: 72, label: 'Rule of 72', note: 'Most popular; easy to divide and most accurate around 6–10%.' },
  { value: 70, label: 'Rule of 70', note: 'Slightly more accurate at low rates; common in demographics.' },
  { value: 69.3, label: 'Rule of 69.3', note: 'Matches continuous compounding (69.3 = 100 × ln 2).' }
];

// Full result for "I know the rate" mode. Returns the rule-of-72 doubling time,
// the same figure for 70 and 69.3, and the exact (no-shortcut) doubling time.
//   { mode: 'rate', rate, years72, years70, years693, exactYears }
export function fromRate(rate) {
  const r = num(rate);
  const bad = { mode: 'rate', rate: NaN, years72: NaN, years70: NaN, years693: NaN, exactYears: NaN };
  if (!Number.isFinite(r) || r <= 0) return bad;
  return {
    mode: 'rate',
    rate: r,
    years72: yearsToDouble(r, 72),
    years70: yearsToDouble(r, 70),
    years693: yearsToDouble(r, 69.3),
    exactYears: exactYearsToDouble(r)
  };
}

// Full result for "I know the timeframe" mode. Returns the rule-of-72 required
// rate, the same figure for 70 and 69.3, and the exact (no-shortcut) rate.
//   { mode: 'years', years, rate72, rate70, rate693, exactRate }
export function fromYears(years) {
  const t = num(years);
  const bad = { mode: 'years', years: NaN, rate72: NaN, rate70: NaN, rate693: NaN, exactRate: NaN };
  if (!Number.isFinite(t) || t <= 0) return bad;
  return {
    mode: 'years',
    years: t,
    rate72: rateToDouble(t, 72),
    rate70: rateToDouble(t, 70),
    rate693: rateToDouble(t, 69.3),
    exactRate: exactRateToDouble(t)
  };
}
