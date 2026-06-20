// inflation.js — pure, dependency-free CPI-U inflation math.
// Shared by the browser tool (inflation-calculator.js) and the unit tests.
// CPI values are BLS CPI-U annual averages (1982-84=100). Every function
// returns a number, or NaN when an input is not a finite, usable number
// (the UI is responsible for hiding NaN — keep these honest about bad input).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Equivalent value of `amount` when the price level moves from cpiFrom to cpiTo.
// value_to = amount * (cpiTo / cpiFrom)
// Returns NaN on bad input or a non-positive starting CPI (divide-by-zero guard).
export function inflationValue(amount, cpiFrom, cpiTo) {
  const a = num(amount), from = num(cpiFrom), to = num(cpiTo);
  if (!(from > 0)) return NaN;
  if (Number.isNaN(a) || Number.isNaN(to)) return NaN;
  return a * (to / from);
}

// Total percent change in the price level from cpiFrom to cpiTo.
// e.g. CPI 100 -> 125 is +25 ; CPI 100 -> 80 is -20.
export function totalPercentChange(cpiFrom, cpiTo) {
  const from = num(cpiFrom), to = num(cpiTo);
  if (!(from > 0)) return NaN;
  if (Number.isNaN(to)) return NaN;
  return ((to - from) / from) * 100;
}

// Approximate average annual inflation rate (percent) between two years, using
// compound growth: ((cpiTo / cpiFrom) ^ (1 / years) - 1) * 100.
// `years` is the number of whole years between the two (yearTo - yearFrom).
// Returns NaN on bad input; returns 0 when years === 0 (same year).
export function annualizedRate(cpiFrom, cpiTo, years) {
  const from = num(cpiFrom), to = num(cpiTo), y = num(years);
  if (!(from > 0)) return NaN;
  if (Number.isNaN(to) || Number.isNaN(y)) return NaN;
  if (!(to > 0)) return NaN;
  if (y === 0) return 0;
  if (y < 0) return NaN;
  return (Math.pow(to / from, 1 / y) - 1) * 100;
}
