// chronological-age.js — pure, dependency-free chronological age math for the
// clinical "test scoring" framing used with norm-referenced assessments
// (WISC, WPPSI, Pearson, Brigance, etc.).
//
// Shared by the browser tool (chronological-age-calculator.js) and unit tests.
// No deps, nothing uploaded. No "today" is read inside these functions — the
// caller passes both the date of birth and the test date.
//
// THE TEST-SCORING BORROWING METHOD
// Test manuals compute chronological age by writing the test date over the
// birth date as year/month/day columns and subtracting column by column:
//
//        year  month  day
//   test  2026     6    23
//   born  2000     3    15
//   ----  ----  -----  ----
//          26     3     8   ->  26 years; 3 months; 8 days
//
// When the day column is negative you BORROW one month from the month column.
// The borrowed days equal the real number of days in the month *before* the
// test month (so February correctly contributes 28 or 29). When the month
// column is then negative you BORROW 12 months from the year column. This is
// the procedure printed in the WISC-V / WPPSI-IV / Brigance scoring manuals,
// and it can differ by a day from a pure anniversary count — by design, because
// that is the method the norm tables were built against.
//
// All values are integers. Dates are passed as { y, m, d } parts (m is 1-12,
// human) OR as JS Date objects; pass local-midnight Dates to avoid time-zone
// drift. Rates/totals are exact whole counts.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Days in a given month, accounting for leap years. month is 1-12 (human).
// Day 0 of the next month === the last day of this month.
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Normalise either a Date or a {y,m,d} object into integer parts {y, m, d}.
// Returns null if the input can't be read as a valid calendar date.
function toParts(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  const y = Number(value.y), m = Number(value.m), d = Number(value.d);
  if (![y, m, d].every(Number.isFinite)) return null;
  if (m < 1 || m > 12 || d < 1) return null;
  if (d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

// Local-midnight Date for {y,m,d} parts (m is 1-12), used for day-count totals.
function toDate(parts) {
  return new Date(parts.y, parts.m - 1, parts.d, 0, 0, 0, 0);
}

// Whole calendar days between two {y,m,d} parts (test - birth), ignoring time.
export function totalDaysBetween(birth, test) {
  const b = toParts(birth), t = toParts(test);
  if (!b || !t) return NaN;
  const ms = toDate(t).getTime() - toDate(b).getTime();
  return Math.round(ms / MS_PER_DAY);
}

// Core chronological age via the test-scoring column-subtraction + borrowing
// method. Returns { years, months, days } as non-negative integers, or null
// when the test date is before the date of birth.
//
// birth / test may each be a Date or a {y, m, d} object.
export function chronologicalAge(birth, test) {
  const b = toParts(birth), t = toParts(test);
  if (!b || !t) return null;
  if (toDate(t).getTime() < toDate(b).getTime()) return null;

  let years = t.y - b.y;
  let months = t.m - b.m;
  let days = t.d - b.d;

  // Borrow days from the previous calendar month(s), relative to the test date,
  // using each month's real day count so February (28/29) is handled correctly.
  // Usually one borrow suffices, but when the preceding month is shorter than
  // the deficit (e.g. a 31st-of-month birth vs. a short month) a single borrow
  // can still leave the day column negative, so we keep stepping back through
  // real calendar months until the days are non-negative.
  let borrowMonth = t.m; // the month we step back FROM (1-12)
  let borrowYear = t.y;
  while (days < 0) {
    months -= 1;
    borrowMonth -= 1;
    if (borrowMonth < 1) { borrowMonth = 12; borrowYear -= 1; }
    days += daysInMonth(borrowYear, borrowMonth);
  }

  // Borrow 12 months from the years column (months can be < -11 only in
  // impossible inputs, so a while-loop is just defensive).
  while (months < 0) {
    years -= 1;
    months += 12;
  }

  return { years, months, days };
}

// Round a {years, months, days} breakdown to the nearest whole month, the way
// many manuals collapse the day column for norm-table lookup: 15 (or 16) days
// and over rounds the month up. `threshold` is the day count at which to round
// up (manuals vary between 15 and 16; default 15). Returns { years, months }.
export function roundToNearestMonth(breakdown, threshold = 15) {
  if (!breakdown) return null;
  let years = breakdown.years;
  let months = breakdown.months;
  if (breakdown.days >= threshold) months += 1;
  if (months >= 12) { years += Math.floor(months / 12); months %= 12; }
  return { years, months };
}

// Full result bundle for the UI. Returns null when the test date precedes the
// date of birth (an invalid age). Otherwise:
//   {
//     years, months, days,        // exact Y;M;D (test-scoring method)
//     totalMonths,                // whole months = years*12 + months
//     totalDays,                  // exact whole-day difference
//     rounded: { years, months }, // nearest-month rounding (15+ days up)
//   }
export function ageResult(birth, test, roundThreshold = 15) {
  const exact = chronologicalAge(birth, test);
  if (!exact) return null;
  const totalDays = totalDaysBetween(birth, test);
  return {
    years: exact.years,
    months: exact.months,
    days: exact.days,
    totalMonths: exact.years * 12 + exact.months,
    totalDays: Number.isFinite(totalDays) ? totalDays : NaN,
    rounded: roundToNearestMonth(exact, roundThreshold)
  };
}
