// cagr.js — pure, dependency-free Compound Annual Growth Rate math.
// Shared by the browser tool (cagr-calculator.js) and the unit tests.
// No deps, nothing uploaded.
//
// CAGR is the constant yearly rate that takes a beginning value to an ending
// value over a number of years:
//     CAGR = (ending / beginning)^(1 / years) - 1
// Total growth is the simple ending/beginning - 1 over the whole period.
//
// Money/values are in whatever unit the caller uses (no rounding inside the
// math — round at display time). Rates are returned as a DECIMAL fraction, e.g.
// 0.07 means 7% per year; multiply by 100 for a percent at display time.
//
// Invalid input (bad numbers, non-positive values, non-positive years) yields a
// NaN-filled result so the UI can stay quiet (mirrors compound-interest.js).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// CAGR as a decimal fraction. Requires beginning > 0, ending >= 0, years > 0.
export function cagr(beginning, ending, years) {
  const B = num(beginning), E = num(ending), t = num(years);
  if (![B, E, t].every(Number.isFinite)) return NaN;
  if (B <= 0 || E < 0 || t <= 0) return NaN;
  return Math.pow(E / B, 1 / t) - 1;
}

// Simple total growth over the whole period, as a decimal fraction.
//   (ending - beginning) / beginning
export function totalGrowth(beginning, ending) {
  const B = num(beginning), E = num(ending);
  if (![B, E].every(Number.isFinite)) return NaN;
  if (B <= 0 || E < 0) return NaN;
  return (E - B) / B;
}

// Full projection. Returns:
//   { cagr, totalGrowth, beginning, ending, years, schedule }
// cagr and totalGrowth are DECIMAL fractions.
// schedule is one row per whole year (year 0 = beginning, year N = ending):
//   { year, value } — value grows at the constant CAGR each year, so the final
//   row equals the ending value (within floating point). If `years` is not a
//   whole number the last row is the fractional end point.
export function project(beginning, ending, years) {
  const B = num(beginning), E = num(ending), t = num(years);
  const bad = {
    cagr: NaN, totalGrowth: NaN,
    beginning: NaN, ending: NaN, years: NaN, schedule: []
  };
  if (![B, E, t].every(Number.isFinite)) return bad;
  if (B <= 0 || E < 0 || t <= 0) return bad;

  const rate = Math.pow(E / B, 1 / t) - 1;
  const growth = (E - B) / B;

  const schedule = [{ year: 0, value: B }];
  const wholeYears = Math.floor(t);
  for (let y = 1; y <= wholeYears; y++) {
    schedule.push({ year: y, value: B * Math.pow(1 + rate, y) });
  }
  // Fractional tail year (e.g. 5.5 years) — pin the final row to the ending value.
  if (t > wholeYears) {
    schedule.push({ year: t, value: E });
  } else {
    // Whole number of years: make the last row land exactly on the ending value
    // (avoids floating-point drift like 1999.9999).
    schedule[schedule.length - 1].value = E;
  }

  return { cagr: rate, totalGrowth: growth, beginning: B, ending: E, years: t, schedule };
}
