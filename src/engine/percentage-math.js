// percentage-math.js — pure, dependency-free percentage calculations.
// Shared by the browser tool (percentage-calculator.js) and the unit tests.
// Every function returns a number, or NaN when an input is not a finite number
// (the UI is responsible for hiding NaN — keep these honest about bad input).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// "What is X% of Y?"  e.g. percentOf(20, 50) === 10
export function percentOf(percent, value) {
  const p = num(percent), v = num(value);
  return (p * v) / 100;
}

// "X is what percent of Y?"  e.g. whatPercent(10, 50) === 20
// Dividing by zero is undefined — return NaN so the UI can stay quiet.
export function whatPercent(part, whole) {
  const a = num(part), b = num(whole);
  if (b === 0) return NaN;
  return (a / b) * 100;
}

// Percent change from X to Y (positive = increase, negative = decrease).
// e.g. percentChange(100, 125) === 25 ; percentChange(100, 80) === -20
export function percentChange(from, to) {
  const a = num(from), b = num(to);
  if (a === 0) return NaN;
  return ((b - a) / a) * 100;
}

// Discount: price minus percentOff%. Returns the final price and amount saved.
// e.g. discount(80, 25) -> { final: 60, saved: 20 }
export function discount(price, percentOff) {
  const p = num(price), off = num(percentOff);
  const saved = (p * off) / 100;
  return { saved, final: p - saved };
}
