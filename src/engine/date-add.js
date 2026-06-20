// date-add.js — pure, dependency-free date add/subtract calculations.
// Shared by the browser tool (date-calculator.js) and the unit tests.
// All dates are handled in the LOCAL time zone (the user's clock), which is what
// "X days from today" intuitively means. No network or build-time clocks.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Local midnight of the same day, time-of-day stripped.
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

// Days in a given month (month 1-12), accounting for leap years.
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Parse a "YYYY-MM-DD" string (the value of <input type="date">) into a
// local-midnight Date. Returns null for anything malformed or out of range,
// so callers can show a dash instead of an Invalid Date.
export function parseISODate(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(y, mo)) return null;
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}

// Format a Date as "YYYY-MM-DD" in local time (for <input type="date"> values).
export function toISODate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// Add a signed offset of years/months/weeks/days to a base date, in calendar
// terms. Returns a new local-midnight Date, or null for an invalid base.
//
// Order matters for end-of-month clamping: years and months are applied first
// (clamping the day to the target month's length, so Jan 31 + 1 month = Feb 28
// in a non-leap year), then weeks and days are added as exact day counts.
//
// `sign` of -1 subtracts. Non-finite offsets are treated as 0.
//
// Examples:
//   addToDate(2026-01-31, { months: 1 })            -> 2026-02-28
//   addToDate(2026-06-16, { days: 90 })             -> 2026-09-14
//   addToDate(2024-02-29, { years: 1 })             -> 2025-02-28
//   addToDate(2026-06-16, { weeks: 2 }, -1)         -> 2026-06-02
export function addToDate(base, { years = 0, months = 0, weeks = 0, days = 0 } = {}, sign = 1) {
  if (!(base instanceof Date) || Number.isNaN(base.getTime())) return null;
  const s = sign < 0 ? -1 : 1;
  const fin = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

  const dy = fin(years) * s;
  const dmo = fin(months) * s;
  const dd = (fin(weeks) * 7 + fin(days)) * s;

  const b = startOfDay(base);

  // Apply years + months with end-of-month clamping.
  let totalMonths = b.getFullYear() * 12 + b.getMonth() + dy * 12 + dmo;
  let targetYear = Math.floor(totalMonths / 12);
  let targetMonth = totalMonths - targetYear * 12; // 0-11
  const clampedDay = Math.min(b.getDate(), daysInMonth(targetYear, targetMonth + 1));
  let result = new Date(targetYear, targetMonth, clampedDay, 0, 0, 0, 0);

  // Apply the exact day count.
  result.setDate(result.getDate() + dd);
  return result;
}

// Whole calendar days between two dates (b - a), ignoring time-of-day.
// Positive when b is after a. Used to summarize the result vs. today.
export function daysBetween(a, b) {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / MS_PER_DAY);
}

// Long-form weekday + date label, e.g. "Monday, September 14, 2026".
export function formatLong(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}
