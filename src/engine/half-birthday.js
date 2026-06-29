// half-birthday.js — pure, dependency-free half-birthday math.
// Shared by the browser tool (half-birthday-calculator.js) and unit tests.
// No deps, nothing uploaded. NO "today" is read inside these functions — when a
// current date is needed (days-until-next), the caller passes it in as an arg.
//
// A "half birthday" is the day exactly halfway through the year from a birthday.
// There are two common ways to define it, and this engine returns both:
//
//   1) CALENDAR method (the default, what most people mean): the same day six
//      calendar months after the birthday. A 14 March birthday → 14 September.
//      When the +6-month landing day doesn't exist (e.g. 31 August + 6 months =
//      31 February), the day is CLAMPED to the last valid day of that month, so
//      31 August → 28 February (or 29 February in a leap year).
//
//   2) MIDPOINT method: the birthday plus 182.5 days (half of 365). This lands a
//      day or so away from the calendar half-birthday and is offered as a
//      secondary readout for people who want the literal halfway point.
//
// Dates are passed as JS Date objects OR as {y, m, d} parts (m is 1-12, human).
// Use local-midnight Dates to avoid time-zone drift. All returned counts are
// exact whole integers; the half-birthday month/day are returned as parts so
// the caller controls display (year is not meaningful for a recurring date).

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Days in a given month, accounting for leap years. month is 1-12 (human).
// Day 0 of the next month === the last day of this month.
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Normalise either a Date or a {y,m,d} object into integer parts {y, m, d}.
// Returns null if the input can't be read as a valid calendar date.
export function toParts(value) {
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

// Local-midnight Date for {y,m,d} parts (m is 1-12).
function toDate(parts) {
  return new Date(parts.y, parts.m - 1, parts.d, 0, 0, 0, 0);
}

// CALENDAR half-birthday: the birthday's month/day shifted forward six calendar
// months, clamping the day to the month's real length when it overflows
// (e.g. 31 Aug + 6 mo → 28/29 Feb). Returns { month, day, clamped } where month
// is 1-12 (human) and `clamped` is true when the day had to be shortened.
//
// The result is year-independent (a recurring date), EXCEPT that February's
// length depends on the year, so an explicit `year` — the calendar year the
// half-birthday LANDS in — may be supplied to decide whether a clamped 29→ vs
// 28→ February applies. When `year` is omitted the clamp uses the year the
// landing month would fall in derived from the birth year (good enough for the
// month/day, which is all the calendar half-birthday needs; the asset re-clamps
// per target year via daysUntilNextHalfBirthday).
export function halfBirthday(birth, year) {
  const b = toParts(birth);
  if (!b) return null;

  // Shift six months forward, wrapping the month into the next calendar year.
  let m = b.m + 6;
  const wraps = m > 12;
  if (wraps) m -= 12;

  // Year used only to ask "how many days does the landing month have" (matters
  // for February). If the caller gave the landing year, use it directly;
  // otherwise derive it from the birth year, bumping when the month wrapped.
  const yForClamp = (year != null && Number.isFinite(Number(year)))
    ? Number(year)
    : (wraps ? b.y + 1 : b.y);

  const maxDay = daysInMonth(yForClamp, m);
  const clamped = b.d > maxDay;
  const day = clamped ? maxDay : b.d;

  return { month: m, day, clamped };
}

// MIDPOINT half-birthday: birthday + 182.5 days (half of a 365-day year),
// rounded to the nearest whole day (so the .5 rounds up by convention). Needs a
// concrete year because it returns an actual date; pass the year the midpoint
// should be measured from. Returns { y, m, d } parts, or null on bad input.
export function midpointHalfBirthday(birth, year) {
  const b = toParts(birth);
  if (!b) return null;
  const baseYear = (year != null && Number.isFinite(Number(year))) ? Number(year) : b.y;
  // Anchor on the birthday in the requested year, then add half a year of days.
  const anchor = toDate({ y: baseYear, m: b.m, d: Math.min(b.d, daysInMonth(baseYear, b.m)) });
  const mid = new Date(anchor.getTime() + Math.round(182.5) * MS_PER_DAY);
  return { y: mid.getFullYear(), m: mid.getMonth() + 1, d: mid.getDate() };
}

// The weekday index (0 = Sunday … 6 = Saturday) for a {y,m,d} date. Useful for
// labelling which day of the week a half-birthday falls on in a given year.
export function weekdayIndex(parts) {
  const p = toParts(parts);
  if (!p) return NaN;
  return toDate(p).getDay();
}

// Whole calendar days from `from` to `to` ({y,m,d} or Date), ignoring time.
// Positive when `to` is after `from`. NaN on bad input.
export function daysBetween(from, to) {
  const a = toParts(from), b = toParts(to);
  if (!a || !b) return NaN;
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / MS_PER_DAY);
}

// Days until the NEXT upcoming CALENDAR half-birthday, measured from a `today`
// that the CALLER passes in (so this stays pure — no Date.now() here). Returns
// { days, date } where `date` is the {y,m,d} of the next half-birthday and
// `days` is the whole-day count from today to it (0 means it is today). Returns
// null on bad input.
//
// The half-birthday recurs every year, so we find the half-birthday for this
// year; if it has already passed, we roll forward to next year. The day is
// re-clamped for each candidate year so a 31 Aug birth lands on 28 or 29 Feb
// correctly depending on that year's calendar.
export function daysUntilNextHalfBirthday(birth, today) {
  const b = toParts(birth), t = toParts(today);
  if (!b || !t) return null;

  // Build the calendar half-birthday {y,m,d} for a given target year, clamping
  // the day to that year's month length.
  const half = halfBirthday(b); // month/day are year-independent except Feb clamp
  if (!half) return null;

  const candidateFor = (yr) => {
    const maxDay = daysInMonth(yr, half.month);
    // Re-clamp the ORIGINAL birth day against this year's month length, so a
    // 29 Feb landing only appears in leap years.
    const day = Math.min(b.d, maxDay);
    return { y: yr, m: half.month, d: day };
  };

  let cand = candidateFor(t.y);
  if (daysBetween(t, cand) < 0) {
    cand = candidateFor(t.y + 1);
  }
  return { days: daysBetween(t, cand), date: cand };
}
