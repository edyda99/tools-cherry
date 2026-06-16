// age-math.js — pure calendar arithmetic for the Age Calculator.
// No DOM/Date-locale dependency for the core math: callers pass plain
// {year, month, day} parts (month is 1-12) so this is fully unit-testable in
// Node and renders identically in the browser. The UI layer parses the
// <input type="date"> values into these parts before calling in.

/** Days in a given month (1-12) of a given year, leap-year aware. */
export function daysInMonth(year, month) {
  // month is 1-12; new Date(y, m, 0) gives the last day of month m (1-based).
  return new Date(year, month, 0).getDate();
}

/** True if `year` is a Gregorian leap year. */
export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Serialize a date part triple to a UTC-midnight epoch (ms) for span math.
 *  Using UTC avoids DST shifting whole-day counts by an hour. */
function toUTC({ year, month, day }) {
  return Date.UTC(year, month - 1, day);
}

const MS_PER_DAY = 86400000;

/** Whole days between two date-part triples (b - a). Can be negative. */
export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / MS_PER_DAY);
}

/**
 * Calendar breakdown of the span from `from` to `to` as years/months/days,
 * using the human convention of borrowing from the days of the *previous*
 * month when the to-day is earlier than the from-day. End-of-month births are
 * handled by clamping the borrow to that previous month's real length.
 *
 * Both args are {year, month, day} with month 1-12. Returns null if `to`
 * is strictly before `from` (the caller treats that as invalid input).
 *
 * @returns {{years, months, days, totalDays, totalWeeks, totalMonths}|null}
 */
export function ageBreakdown(from, to) {
  if (toUTC(to) < toUTC(from)) return null;

  let years = to.year - from.year;
  let months = to.month - from.month;
  let days = to.day - from.day;

  if (days < 0) {
    months -= 1;
    // Borrow the length of the month before `to`'s month. Clamp the from-day
    // to that month's length first: a start on the 31st must not overshoot a
    // shorter borrow month (e.g. Jan 31 -> Mar 1 is "1 month, 1 day", not -2).
    const prevMonth = to.month - 1 === 0 ? 12 : to.month - 1;
    const prevYear = to.month - 1 === 0 ? to.year - 1 : to.year;
    const borrow = daysInMonth(prevYear, prevMonth);
    days = to.day + (borrow - Math.min(from.day, borrow));
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const totalDays = daysBetween(from, to);
  const totalWeeks = Math.floor(totalDays / 7);
  const totalMonths = years * 12 + months;

  return { years, months, days, totalDays, totalWeeks, totalMonths };
}

/**
 * The next anniversary of `birth` strictly after `today` (i.e. the upcoming
 * birthday). Handles Feb-29 births by rolling to Mar-1 in non-leap years —
 * the common civil convention. Returns {date:{year,month,day}, daysUntil}.
 */
export function nextBirthday(birth, today) {
  const makeBday = (year) => {
    let m = birth.month, d = birth.day;
    if (m === 2 && d === 29 && !isLeapYear(year)) { m = 3; d = 1; } // Feb 29 -> Mar 1
    return { year, month: m, day: d };
  };
  let cand = makeBday(today.year);
  if (toUTC(cand) <= toUTC(today)) cand = makeBday(today.year + 1);
  return { date: cand, daysUntil: daysBetween(today, cand) };
}

/** Day-of-week name for a date-part triple (0=Sunday locale-independent). */
export function weekdayName(part) {
  const idx = new Date(toUTC(part)).getUTCDay();
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][idx];
}
