// test-age.js — unit tests for the pure calendar math (no DOM needed).
import assert from 'node:assert/strict';
import {
  daysInMonth, isLeapYear, daysBetween, ageBreakdown, nextBirthday, weekdayName
} from '../src/engine/age-math.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  - ' + name); };

t('isLeapYear: divisible-by-4 rule with century exceptions', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2023), false);
  assert.equal(isLeapYear(1900), false); // century not /400
  assert.equal(isLeapYear(2000), true);  // /400
});

t('daysInMonth: Feb leap vs non-leap, 30/31 months', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2023, 2), 28);
  assert.equal(daysInMonth(2025, 4), 30);
  assert.equal(daysInMonth(2025, 1), 31);
});

t('daysBetween: simple span and direction', () => {
  assert.equal(daysBetween({ year: 2025, month: 1, day: 1 }, { year: 2025, month: 1, day: 31 }), 30);
  assert.equal(daysBetween({ year: 2025, month: 1, day: 31 }, { year: 2025, month: 1, day: 1 }), -30);
});

t('ageBreakdown: exact whole years on a birthday', () => {
  const r = ageBreakdown({ year: 1990, month: 6, day: 15 }, { year: 2025, month: 6, day: 15 });
  assert.equal(r.years, 35);
  assert.equal(r.months, 0);
  assert.equal(r.days, 0);
  assert.equal(r.totalMonths, 35 * 12);
});

t('ageBreakdown: day-before birthday is years-1 with full months/days', () => {
  const r = ageBreakdown({ year: 1990, month: 6, day: 15 }, { year: 2025, month: 6, day: 14 });
  assert.equal(r.years, 34);
  assert.equal(r.months, 11);
  // May->Jun borrow: prev month (May) has 31 days; 14-15 = -1 -> +31 then borrow
  assert.equal(r.days, 30);
});

t('ageBreakdown: month borrow uses the correct previous-month length', () => {
  // from Jan 31 to Mar 1, 2025: months diff = 2, days = 1-31 = -30, borrow Feb(2025)=28
  const r = ageBreakdown({ year: 2025, month: 1, day: 31 }, { year: 2025, month: 3, day: 1 });
  assert.equal(r.years, 0);
  assert.equal(r.months, 1);
  assert.equal(r.days, 1); // from-day 31 clamped to Feb's 28 before borrow
});

t('ageBreakdown: returns null when `to` precedes `from`', () => {
  assert.equal(ageBreakdown({ year: 2025, month: 1, day: 2 }, { year: 2025, month: 1, day: 1 }), null);
});

t('ageBreakdown: totals are consistent (weeks = floor(days/7))', () => {
  const r = ageBreakdown({ year: 2025, month: 1, day: 1 }, { year: 2025, month: 1, day: 20 });
  assert.equal(r.totalDays, 19);
  assert.equal(r.totalWeeks, 2);
});

t('nextBirthday: upcoming this year', () => {
  const r = nextBirthday({ year: 1990, month: 12, day: 25 }, { year: 2025, month: 6, day: 17 });
  assert.deepEqual(r.date, { year: 2025, month: 12, day: 25 });
  assert.ok(r.daysUntil > 0);
});

t('nextBirthday: rolls to next year once passed', () => {
  const r = nextBirthday({ year: 1990, month: 1, day: 1 }, { year: 2025, month: 6, day: 17 });
  assert.equal(r.date.year, 2026);
});

t('nextBirthday: Feb 29 birth rolls to Mar 1 in non-leap year', () => {
  const r = nextBirthday({ year: 2000, month: 2, day: 29 }, { year: 2025, month: 6, day: 17 });
  // 2026 is non-leap -> Mar 1
  assert.deepEqual(r.date, { year: 2026, month: 3, day: 1 });
});

t('nextBirthday: Feb 29 stays Feb 29 in a leap year', () => {
  const r = nextBirthday({ year: 2000, month: 2, day: 29 }, { year: 2023, month: 6, day: 17 });
  assert.deepEqual(r.date, { year: 2024, month: 2, day: 29 });
});

t('weekdayName: known reference date', () => {
  // 2025-06-17 is a Tuesday
  assert.equal(weekdayName({ year: 2025, month: 6, day: 17 }), 'Tuesday');
});

console.log(`\n${pass} passing`);
