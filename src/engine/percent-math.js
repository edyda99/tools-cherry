// percent-math.js — pure percentage arithmetic for the Percentage Calculator.
// No DOM, no locale dependency: callers pass plain numbers and get plain numbers
// back, so this is fully unit-testable in Node and behaves identically in the
// browser. Every function tolerates non-finite/NaN input by returning NaN, which
// the UI treats as "incomplete input" (nothing rendered) rather than throwing.

/** True only for a real, finite number. */
function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * What is P% of X?  e.g. percentOf(20, 50) -> 10
 * @returns {number} P/100 * X, or NaN if either input is non-finite.
 */
export function percentOf(percent, base) {
  const p = num(percent);
  const b = num(base);
  if (Number.isNaN(p) || Number.isNaN(b)) return NaN;
  return (p / 100) * b;
}

/**
 * X is what percent of Y?  e.g. percentIsWhatOf(10, 50) -> 20
 * @returns {number} X/Y * 100, or NaN if Y is 0 or either input is non-finite.
 */
export function percentIsWhatOf(part, whole) {
  const x = num(part);
  const y = num(whole);
  if (Number.isNaN(x) || Number.isNaN(y) || y === 0) return NaN;
  return (x / y) * 100;
}

/**
 * Percentage change from `from` to `to`.
 * e.g. percentChange(50, 75) -> 50 (a 50% increase); (75, 50) -> -33.33...
 * @returns {number} (to - from)/|from| * 100, or NaN if `from` is 0 or inputs
 *          are non-finite. A negative result is a decrease.
 */
export function percentChange(from, to) {
  const a = num(from);
  const b = num(to);
  if (Number.isNaN(a) || Number.isNaN(b) || a === 0) return NaN;
  return ((b - a) / Math.abs(a)) * 100;
}

/**
 * Round a number to a fixed number of decimals (default 2), returning a Number
 * (not a string) and avoiding binary-float drift like 1.005. Negative-safe.
 */
export function roundTo(value, decimals = 2) {
  const n = num(value);
  if (Number.isNaN(n)) return NaN;
  const f = 10 ** decimals;
  const sign = n < 0 ? -1 : 1;
  // Relative (not additive) epsilon: a fixed +EPSILON is too small to correct
  // drift once the scaled value is large (e.g. 1.005 * 100 = 100.4999…), so
  // nudge proportionally to the magnitude before rounding half-up.
  return (sign * Math.round(Math.abs(n) * f * (1 + Number.EPSILON))) / f;
}
