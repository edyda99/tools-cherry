// wage.js — pure, dependency-free salary <-> hourly wage conversions.
// Shared by the browser tool (salary-to-hourly.js) and the unit tests.
// All figures are GROSS (pre-tax). Functions return a number, or NaN when an
// input is not a valid positive value (the UI is responsible for hiding NaN —
// keep these honest about bad input).

const pos = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

// Hourly wage from an annual salary.
//   salaryToHourly(52000, 40, 52) === 25
export function salaryToHourly(annual, hoursPerWeek, weeksPerYear) {
  const a = pos(annual), h = pos(hoursPerWeek), w = pos(weeksPerYear);
  if (Number.isNaN(a) || Number.isNaN(h) || Number.isNaN(w)) return NaN;
  return a / (h * w);
}

// Annual salary from an hourly wage.
//   hourlyToSalary(20, 40, 52) === 41600
export function hourlyToSalary(hourly, hoursPerWeek, weeksPerYear) {
  const r = pos(hourly), h = pos(hoursPerWeek), w = pos(weeksPerYear);
  if (Number.isNaN(r) || Number.isNaN(h) || Number.isNaN(w)) return NaN;
  return r * h * w;
}

// All pay-period equivalents derived from an annual salary, the hours worked
// per week, and the weeks worked per year.
//   - weekly:   annual / weeksPerYear
//   - biweekly: weekly * 2
//   - monthly:  annual / 12
//   - daily:    weekly / (workdays per week, assuming 5-day weeks if hours allow,
//               otherwise derived so daily * workdays == weekly). We use a fixed
//               5-day work week for the daily figure, which is the common case.
//   - hourly:   annual / (hoursPerWeek * weeksPerYear)
//
// daysPerWeek defaults to 5. All values are GROSS.
export function breakdown(annual, hoursPerWeek, weeksPerYear, daysPerWeek = 5) {
  const a = pos(annual), h = pos(hoursPerWeek), w = pos(weeksPerYear);
  const d = pos(daysPerWeek);
  if (Number.isNaN(a) || Number.isNaN(h) || Number.isNaN(w) || Number.isNaN(d)) {
    return {
      hourly: NaN, daily: NaN, weekly: NaN,
      biweekly: NaN, monthly: NaN, annual: NaN
    };
  }
  const weekly = a / w;
  return {
    hourly: a / (h * w),
    daily: weekly / d,
    weekly,
    biweekly: weekly * 2,
    monthly: a / 12,
    annual: a
  };
}

// Weeks actually worked per year after subtracting unpaid vacation weeks from
// the 52-week year. Clamped to the open range (0, 52]; invalid input -> NaN.
//   weeksWorked(2) === 50 ; weeksWorked(0) === 52
export function weeksWorked(unpaidVacationWeeks) {
  const v = typeof unpaidVacationWeeks === 'number'
    ? unpaidVacationWeeks
    : parseFloat(unpaidVacationWeeks);
  const u = Number.isFinite(v) && v >= 0 ? v : 0;
  const w = 52 - u;
  return w > 0 && w <= 52 ? w : NaN;
}
