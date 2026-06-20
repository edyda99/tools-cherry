// test-date-math.js — unit tests for the pure date-math module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  localDate,
  daysBetween,
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  easter,
  holidayDate,
  nextHolidayOccurrence,
  daysInMonth,
  ageBreakdown,
  nextBirthday,
  businessDaysBetween
} from '../src/engine/date-math.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

// Compare a Date to an expected Y/M/D (month 1-12).
const isDate = (d, y, m, day) =>
  assert.ok(
    d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day,
    `got ${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}, want ${y}-${m}-${day}`
  );

t('daysBetween: same day is 0', () =>
  assert.equal(daysBetween(localDate(2026, 6, 15), localDate(2026, 6, 15)), 0));
t('daysBetween: forward is positive', () =>
  assert.equal(daysBetween(localDate(2026, 12, 24), localDate(2026, 12, 25)), 1));
t('daysBetween: backward is negative', () =>
  assert.equal(daysBetween(localDate(2026, 12, 26), localDate(2026, 12, 25)), -1));
t('daysBetween: ignores time-of-day', () => {
  const a = new Date(2026, 5, 15, 23, 59);
  const b = new Date(2026, 5, 16, 0, 1);
  assert.equal(daysBetween(a, b), 1);
});

t('nthWeekdayOfMonth: Thanksgiving 2026 = Nov 26 (4th Thu)', () =>
  isDate(nthWeekdayOfMonth(2026, 11, 4, 4), 2026, 11, 26));
t('nthWeekdayOfMonth: Thanksgiving 2025 = Nov 27', () =>
  isDate(nthWeekdayOfMonth(2025, 11, 4, 4), 2025, 11, 27));
t('nthWeekdayOfMonth: 1st Monday of June 2026 = Jun 1', () =>
  isDate(nthWeekdayOfMonth(2026, 6, 1, 1), 2026, 6, 1));

t('lastWeekdayOfMonth: Memorial Day 2026 = May 25 (last Mon)', () =>
  isDate(lastWeekdayOfMonth(2026, 5, 1), 2026, 5, 25));
t('lastWeekdayOfMonth: Memorial Day 2025 = May 26', () =>
  isDate(lastWeekdayOfMonth(2025, 5, 1), 2025, 5, 26));

t('easter: 2026 = April 5', () => isDate(easter(2026), 2026, 4, 5));
t('easter: 2027 = March 28', () => isDate(easter(2027), 2027, 3, 28));
t('easter: 2024 = March 31', () => isDate(easter(2024), 2024, 3, 31));
t('easter: 2025 = April 20', () => isDate(easter(2025), 2025, 4, 20));

t('holidayDate: Christmas is Dec 25', () =>
  isDate(holidayDate('christmas', 2026), 2026, 12, 25));
t('holidayDate: July 4th is Independence Day', () =>
  isDate(holidayDate('independence', 2026), 2026, 7, 4));
t('holidayDate: unknown key is null', () =>
  assert.equal(holidayDate('nope', 2026), null));

t('nextHolidayOccurrence: rolls to next year once passed', () => {
  // On Dec 26 2026, the next Christmas is Dec 25 2027.
  const today = localDate(2026, 12, 26);
  isDate(nextHolidayOccurrence('christmas', today), 2027, 12, 25);
});
t('nextHolidayOccurrence: same-day reads as today, not next year', () => {
  const today = localDate(2026, 12, 25);
  isDate(nextHolidayOccurrence('christmas', today), 2026, 12, 25);
});
t('nextHolidayOccurrence: upcoming this year stays this year', () => {
  const today = localDate(2026, 6, 15);
  isDate(nextHolidayOccurrence('christmas', today), 2026, 12, 25);
});

// --- daysInMonth -------------------------------------------------------------
t('daysInMonth: Feb 2024 (leap) = 29', () => assert.equal(daysInMonth(2024, 2), 29));
t('daysInMonth: Feb 2023 (non-leap) = 28', () => assert.equal(daysInMonth(2023, 2), 28));
t('daysInMonth: Feb 2000 (leap, /400) = 29', () => assert.equal(daysInMonth(2000, 2), 29));
t('daysInMonth: Feb 1900 (non-leap, /100) = 28', () => assert.equal(daysInMonth(1900, 2), 28));
t('daysInMonth: April = 30', () => assert.equal(daysInMonth(2026, 4), 30));

// --- ageBreakdown ------------------------------------------------------------
const age = (b, a) => ageBreakdown(localDate(...b), localDate(...a));

t('ageBreakdown: exact whole years', () =>
  assert.deepEqual(age([1990, 6, 15], [2026, 6, 15]), { years: 36, months: 0, days: 0 }));
t('ageBreakdown: day before birthday', () =>
  assert.deepEqual(age([1990, 6, 15], [2026, 6, 14]), { years: 35, months: 11, days: 30 }));
t('ageBreakdown: day after birthday', () =>
  assert.deepEqual(age([1990, 6, 15], [2026, 6, 16]), { years: 36, months: 0, days: 1 }));
t('ageBreakdown: born today is all zeros', () =>
  assert.deepEqual(age([2026, 6, 15], [2026, 6, 15]), { years: 0, months: 0, days: 0 }));
t('ageBreakdown: future birth date returns null', () =>
  assert.equal(age([2030, 1, 1], [2026, 6, 15]), null));

// Month-borrow across a short month with a 31st-of-month birth: the monthly
// anniversary clamps to the end of the short month (Feb), so Jan 31 -> Mar 1 is
// 1 month and 1 day, and the day remainder is never negative.
t('ageBreakdown: 31st-birth borrow over leap Feb (Jan31 -> Mar1 2000) = 1mo 1d', () =>
  assert.deepEqual(age([2000, 1, 31], [2000, 3, 1]), { years: 0, months: 1, days: 1 }));
t('ageBreakdown: 31st-birth borrow over non-leap Feb (Jan31 -> Mar1 2023) = 1mo 1d', () =>
  assert.deepEqual(age([2023, 1, 31], [2023, 3, 1]), { years: 0, months: 1, days: 1 }));
// Day-borrow over January (31 days): Dec 31 -> Feb 1.
t('ageBreakdown: day borrow over Jan (Dec31 -> Feb1) = 1mo 1d', () =>
  assert.deepEqual(age([2025, 12, 31], [2026, 2, 1]), { years: 0, months: 1, days: 1 }));

// Leap-year birthday: born Feb 29 2000. In a non-leap year the anniversary
// clamps to Feb 28, so 2001-02-28 reads as exactly 1 year.
t('ageBreakdown: Feb29 born, Feb 28 next (non-leap) year = 1yr', () =>
  assert.deepEqual(age([2000, 2, 29], [2001, 2, 28]), { years: 1, months: 0, days: 0 }));
t('ageBreakdown: Feb29 born, Mar 1 next year = 1yr 1day', () =>
  assert.deepEqual(age([2000, 2, 29], [2001, 3, 1]), { years: 1, months: 0, days: 1 }));
t('ageBreakdown: Feb29 born, day before clamp (2001-02-27) = 11mo 29d', () =>
  assert.deepEqual(age([2000, 2, 29], [2001, 2, 27]), { years: 0, months: 11, days: 29 }));
t('ageBreakdown: Feb29 born, exact Feb29 four years on = 4yr', () =>
  assert.deepEqual(age([2000, 2, 29], [2004, 2, 29]), { years: 4, months: 0, days: 0 }));

// --- nextBirthday ------------------------------------------------------------
const nb = (b, a) => nextBirthday(localDate(...b), localDate(...a));

t('nextBirthday: later this year stays this year', () =>
  isDate(nb([1990, 12, 25], [2026, 6, 15]), 2026, 12, 25));
t('nextBirthday: already passed rolls to next year', () =>
  isDate(nb([1990, 3, 10], [2026, 6, 15]), 2027, 3, 10));
t('nextBirthday: today is the birthday returns today', () =>
  isDate(nb([1990, 6, 15], [2026, 6, 15]), 2026, 6, 15));
t('nextBirthday: Feb29 born, non-leap target year -> Mar 1', () =>
  isDate(nb([2000, 2, 29], [2026, 1, 1]), 2026, 3, 1));
t('nextBirthday: Feb29 born, leap target year stays Feb 29', () =>
  isDate(nb([2000, 2, 29], [2028, 1, 1]), 2028, 2, 29));

// --- businessDaysBetween -----------------------------------------------------
const bd = (a, b) => businessDaysBetween(localDate(...a), localDate(...b));

// 2026-06-15 is a Monday. Mon -> next Mon (7 days) = 5 weekdays.
t('businessDaysBetween: Mon -> next Mon = 5', () =>
  assert.equal(bd([2026, 6, 15], [2026, 6, 22]), 5));
t('businessDaysBetween: same day = 0', () =>
  assert.equal(bd([2026, 6, 15], [2026, 6, 15]), 0));
// Mon -> Fri same week = 4 (Tue, Wed, Thu, Fri).
t('businessDaysBetween: Mon -> Fri same week = 4', () =>
  assert.equal(bd([2026, 6, 15], [2026, 6, 19]), 4));
// Fri -> following Mon: only that Monday counts (Sat/Sun skipped) = 1.
t('businessDaysBetween: Fri -> following Mon = 1', () =>
  assert.equal(bd([2026, 6, 19], [2026, 6, 22]), 1));
// Sat -> Sun (same weekend) = 0.
t('businessDaysBetween: Sat -> Sun = 0', () =>
  assert.equal(bd([2026, 6, 20], [2026, 6, 21]), 0));
// Two full weeks = 10.
t('businessDaysBetween: Mon -> Mon two weeks = 10', () =>
  assert.equal(bd([2026, 6, 15], [2026, 6, 29]), 10));
// Reversed range flips the sign.
t('businessDaysBetween: reversed range is negative', () =>
  assert.equal(bd([2026, 6, 22], [2026, 6, 15]), -5));
// Whole month of June 2026 (Mon Jun 1 -> Tue Jun 30) = 21 weekdays after Jun 1.
t('businessDaysBetween: Jun 1 -> Jun 30 2026 = 21', () =>
  assert.equal(bd([2026, 6, 1], [2026, 6, 30]), 21));
// Ignores time-of-day.
t('businessDaysBetween: ignores time-of-day', () => {
  const a = new Date(2026, 5, 15, 23, 59);
  const b = new Date(2026, 5, 19, 0, 1);
  assert.equal(businessDaysBetween(a, b), 4);
});

console.log(`\n${pass} passing`);
