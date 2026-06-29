// double-time-pay.js — pure, dependency-free double-time / overtime pay math.
// Shared by the browser tool (double-time-pay-calculator.js) and the unit tests.
// No deps, nothing uploaded.
//
// Pay has three tiers, all driven by a single hourly rate:
//   regular pay    = rate × 1.0 × regular hours
//   overtime pay   = rate × 1.5 × overtime hours   (time-and-a-half)
//   double-time pay = rate × 2.0 × double-time hours (2×)
//   gross total    = the sum of the three.
//
// Money is in whatever currency unit the caller uses (dollars here). No rounding
// inside the math — round at display time. Multipliers are fixed by US wage
// convention: 1.5× for overtime, 2× for double time.
//
// Blank / invalid inputs are treated as 0 (a worker simply logged none of those
// hours), so the result is always a set of finite numbers — the UI never has to
// hide a NaN. A negative or non-finite value coerces to 0.

// Coerce any input to a non-negative finite number; anything invalid -> 0.
const nonNeg = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Fixed US wage multipliers.
export const OVERTIME_MULTIPLIER = 1.5; // time-and-a-half
export const DOUBLE_TIME_MULTIPLIER = 2; // double time

// Pay for a single tier: rate × multiplier × hours.
// e.g. tierPay(20, 2, 5) === 200  (double time: $20 × 2 × 5h)
export function tierPay(rate, multiplier, hours) {
  return nonNeg(rate) * nonNeg(multiplier) * nonNeg(hours);
}

// Full pay breakdown for one pay period. All inputs default to 0 (blank = none).
// Returns an object of finite, non-negative numbers:
//   {
//     rate, regularHours, overtimeHours, doubleHours, totalHours,
//     regularPay, overtimePay, doublePay, gross,
//     overtimeMultiplier, doubleMultiplier
//   }
//
// e.g. calculatePay({ rate: 20, regularHours: 40, overtimeHours: 5, doubleHours: 2 })
//   -> regularPay 800, overtimePay 150, doublePay 80, gross 1030, totalHours 47
export function calculatePay({
  rate = 0,
  regularHours = 0,
  overtimeHours = 0,
  doubleHours = 0
} = {}) {
  const r = nonNeg(rate);
  const reg = nonNeg(regularHours);
  const ot = nonNeg(overtimeHours);
  const dt = nonNeg(doubleHours);

  const regularPay = r * reg;
  const overtimePay = r * OVERTIME_MULTIPLIER * ot;
  const doublePay = r * DOUBLE_TIME_MULTIPLIER * dt;
  const gross = regularPay + overtimePay + doublePay;

  return {
    rate: r,
    regularHours: reg,
    overtimeHours: ot,
    doubleHours: dt,
    totalHours: reg + ot + dt,
    regularPay,
    overtimePay,
    doublePay,
    gross,
    overtimeMultiplier: OVERTIME_MULTIPLIER,
    doubleMultiplier: DOUBLE_TIME_MULTIPLIER
  };
}

// The effective hourly rate over all paid hours (blended across the three tiers).
// Useful context — what one "average" hour earned this period. Returns NaN when
// no hours were worked (avoids divide-by-zero), so the UI can hide it.
export function effectiveHourlyRate({
  rate = 0,
  regularHours = 0,
  overtimeHours = 0,
  doubleHours = 0
} = {}) {
  const { gross, totalHours } = calculatePay({ rate, regularHours, overtimeHours, doubleHours });
  if (!(totalHours > 0)) return NaN;
  return gross / totalHours;
}
