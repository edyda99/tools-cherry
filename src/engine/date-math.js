// date-math.js — pure, dependency-free date helpers for the holiday countdown.
// Shared by the browser tool (holiday-countdown.js) and the unit tests.
// All dates are handled in the LOCAL time zone (the user's clock), which is what
// "days until" intuitively means. We never touch network or build-time clocks.

// Days in a 24h day, used for whole-day differences.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A local midnight Date for a given Y/M/D. month is 1-12 (human), not 0-11.
export function localDate(year, month, day) {
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

// Strip the time-of-day from a Date, returning local midnight of the same day.
export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

// Whole calendar days between two dates (b - a), ignoring time-of-day.
// Positive when b is after a. Used for the "X days until" headline number.
export function daysBetween(a, b) {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / MS_PER_DAY);
}

// Whole business days (Mon–Fri) between two dates, counting the days strictly
// *after* `a` up to and including `b` — i.e. the same "spans crossed" semantics
// as daysBetween, but only Mon–Fri are counted. Pure; order-independent in
// magnitude: swapping a and b flips the sign. Time-of-day is ignored.
//
// We count complete 7-day weeks (each contributes exactly 5 weekdays) and then
// walk the leftover days, so the cost is O(1) in week count, not O(total days).
//
// Examples:
//   Mon -> next Mon (7 days) = 5 business days
//   Fri -> following Mon (3 days) = 1 business day (only that Monday)
//   Sat -> Sun (same weekend) = 0
export function businessDaysBetween(a, b) {
  let from = startOfDay(a);
  let to = startOfDay(b);
  const sign = to.getTime() < from.getTime() ? -1 : 1;
  if (sign < 0) { const tmp = from; from = to; to = tmp; }

  const total = daysBetween(from, to); // whole days after `from` through `to`
  const fullWeeks = Math.floor(total / 7);
  let count = fullWeeks * 5;

  // Walk the remaining (< 7) days one at a time, stepping from the day after
  // `from` up to `to`, and count only the weekdays among them.
  const remainder = total - fullWeeks * 7;
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate() + fullWeeks * 7);
  for (let i = 0; i < remainder; i++) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay(); // 0=Sun .. 6=Sat
    if (dow !== 0 && dow !== 6) count++;
  }

  return sign * count;
}

// The Nth occurrence of a weekday in a month, e.g. 4th Thursday of November.
// weekday: 0=Sun .. 6=Sat. nth: 1-based. month: 1-12.
// e.g. nthWeekdayOfMonth(2026, 11, 4, 4) -> Thanksgiving 2026 (Nov 26).
export function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = localDate(year, month, 1);
  const shift = (weekday - first.getDay() + 7) % 7; // days to the first such weekday
  return localDate(year, month, 1 + shift + (nth - 1) * 7);
}

// The last occurrence of a weekday in a month, e.g. last Monday of May.
// e.g. lastWeekdayOfMonth(2026, 5, 1) -> Memorial Day 2026 (May 25).
export function lastWeekdayOfMonth(year, month, weekday) {
  // Day 0 of next month === last day of this month.
  const last = new Date(year, month, 0, 0, 0, 0, 0);
  const back = (last.getDay() - weekday + 7) % 7;
  return localDate(year, month, last.getDate() - back);
}

// Western (Gregorian) Easter Sunday via the Anonymous Gregorian "Computus"
// algorithm. Returns a local-midnight Date. Verified against known dates
// (e.g. 2026-04-05, 2027-03-28) — no lookup table needed, valid for all years.
export function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return localDate(year, month, day);
}

// Resolve a holiday key to its Date in a given year. Pure — no "today" involved.
// Returns a local-midnight Date, or null for an unknown key.
export function holidayDate(key, year) {
  switch (key) {
    case 'newyear':      return localDate(year, 1, 1);
    case 'valentines':   return localDate(year, 2, 14);
    case 'easter':       return easter(year);
    case 'memorial':     return lastWeekdayOfMonth(year, 5, 1);   // last Monday of May
    case 'independence': return localDate(year, 7, 4);
    case 'halloween':    return localDate(year, 10, 31);
    case 'thanksgiving': return nthWeekdayOfMonth(year, 11, 4, 4); // 4th Thursday of Nov
    case 'christmas':    return localDate(year, 12, 25);
    default:             return null;
  }
}

// Given a holiday key and "today", return the next upcoming occurrence: this
// year's date if it is today or still ahead, otherwise next year's. Treating
// "today" as still upcoming means the countdown reads 0 days on the day itself
// rather than jumping a full year early.
export function nextHolidayOccurrence(key, today = new Date()) {
  const t0 = startOfDay(today);
  const y = t0.getFullYear();
  let d = holidayDate(key, y);
  if (!d) return null;
  if (daysBetween(t0, d) < 0) d = holidayDate(key, y + 1);
  return d;
}

// Number of days in a given month (month 1-12), accounting for leap years.
// Day 0 of the next month === the last day of this month.
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Exact calendar age from a birth date to an "as of" date, broken into whole
// years, months and days. Pure — no "today" unless the caller passes one.
//
// We count down from years → months → days, borrowing from the larger unit
// when a field would go negative. A borrowed month contributes the number of
// days in the month *before* the as-of month, so Feb (28/29) is handled
// correctly. Returns null when birth is after asOf (a future birth date).
//
// Examples:
//   ageBreakdown(2000-02-29, 2001-02-28) -> {years:0, months:11, days:30}
//   ageBreakdown(2000-01-31, 2000-03-01) -> {years:0, months:1,  days:1}
export function ageBreakdown(birthDate, asOfDate) {
  const b = startOfDay(birthDate);
  const a = startOfDay(asOfDate);
  if (a.getTime() < b.getTime()) return null;

  // Count whole years and months by stepping the birth anniversary forward as
  // far as it can go without passing the as-of date, then measure the leftover
  // days. The anniversary is clamped to the end of a shorter month (e.g. a
  // 31st-of-the-month birth lands on Feb 28/29), which keeps the day remainder
  // non-negative for every input — matching dateutil's relativedelta.
  let years = a.getFullYear() - b.getFullYear();
  let months = a.getMonth() - b.getMonth();
  if (months < 0) { years -= 1; months += 12; }

  // The anniversary date that is `years` years + `months` months after birth.
  const annivYear = b.getFullYear() + years + Math.floor((b.getMonth() + months) / 12);
  const annivMonth = (b.getMonth() + months) % 12; // 0-11
  const clampedDay = Math.min(b.getDate(), daysInMonth(annivYear, annivMonth + 1));
  let anniv = new Date(annivYear, annivMonth, clampedDay, 0, 0, 0, 0);

  // If we overshot (anniversary is after as-of), step back one month and redo.
  if (anniv.getTime() > a.getTime()) {
    months -= 1;
    if (months < 0) { years -= 1; months += 12; }
    const y2 = b.getFullYear() + years + Math.floor((b.getMonth() + months) / 12);
    const m2 = (b.getMonth() + months) % 12;
    const d2 = Math.min(b.getDate(), daysInMonth(y2, m2 + 1));
    anniv = new Date(y2, m2, d2, 0, 0, 0, 0);
  }

  const days = daysBetween(anniv, a);
  return { years, months, days };
}

// The next birthday on or after the as-of date, as a local-midnight Date.
// If today is the birthday, today is returned (the count reads 0, not a year).
// Handles Feb 29 birthdays in non-leap years by falling to Feb 28 — the same
// convention ageBreakdown uses for the yearly anniversary and the one the tool's
// FAQ promises — so the headline age, this countdown, and the FAQ all agree.
export function nextBirthday(birthDate, asOfDate = new Date()) {
  const b = startOfDay(birthDate);
  const a = startOfDay(asOfDate);
  const bMonth = b.getMonth() + 1; // 1-12
  const bDay = b.getDate();

  const occurrenceIn = (year) => {
    // Feb 29 in a non-leap year -> Feb 28 (matches ageBreakdown's tick-over).
    if (bMonth === 2 && bDay === 29 && daysInMonth(year, 2) < 29) {
      return localDate(year, 2, 28);
    }
    return localDate(year, bMonth, bDay);
  };

  let d = occurrenceIn(a.getFullYear());
  if (daysBetween(a, d) < 0) d = occurrenceIn(a.getFullYear() + 1);
  return d;
}
