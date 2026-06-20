// test-date-add.js — unit tests for the pure date add/subtract module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { parseISODate, toISODate, addToDate, daysBetween, formatLong } from '../src/engine/date-add.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('parseISODate parses a valid date', () => {
  const d = parseISODate('2026-06-16');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 5); // June, 0-based
  assert.equal(d.getDate(), 16);
});

t('parseISODate rejects malformed / out-of-range input', () => {
  assert.equal(parseISODate('2026-13-01'), null);
  assert.equal(parseISODate('2026-02-30'), null);
  assert.equal(parseISODate('not a date'), null);
  assert.equal(parseISODate(''), null);
  assert.equal(parseISODate(null), null);
});

t('parseISODate accepts Feb 29 only in leap years', () => {
  assert.ok(parseISODate('2024-02-29')); // leap year
  assert.equal(parseISODate('2025-02-29'), null); // not a leap year
});

t('toISODate round-trips with parseISODate', () => {
  assert.equal(toISODate(parseISODate('2026-09-14')), '2026-09-14');
  assert.equal(toISODate(new Date(NaN)), '');
});

t('addToDate adds whole days', () => {
  const d = addToDate(parseISODate('2026-06-16'), { days: 90 });
  assert.equal(toISODate(d), '2026-09-14');
});

t('addToDate adds weeks as 7-day blocks', () => {
  const d = addToDate(parseISODate('2026-06-16'), { weeks: 2 });
  assert.equal(toISODate(d), '2026-06-30');
});

t('addToDate subtracts when sign is -1', () => {
  const d = addToDate(parseISODate('2026-06-16'), { weeks: 2 }, -1);
  assert.equal(toISODate(d), '2026-06-02');
});

t('addToDate clamps end-of-month for months', () => {
  // Jan 31 + 1 month -> Feb 28 (2026 is not a leap year)
  assert.equal(toISODate(addToDate(parseISODate('2026-01-31'), { months: 1 })), '2026-02-28');
  // Jan 31 + 1 month -> Feb 29 in a leap year
  assert.equal(toISODate(addToDate(parseISODate('2024-01-31'), { months: 1 })), '2024-02-29');
});

t('addToDate clamps Feb 29 when adding a year', () => {
  assert.equal(toISODate(addToDate(parseISODate('2024-02-29'), { years: 1 })), '2025-02-28');
});

t('addToDate applies months before days', () => {
  // Jan 31 + 1 month (-> Feb 28) + 1 day = Mar 1
  const d = addToDate(parseISODate('2026-01-31'), { months: 1, days: 1 });
  assert.equal(toISODate(d), '2026-03-01');
});

t('addToDate combines years, months, weeks, days', () => {
  const d = addToDate(parseISODate('2026-06-16'), { years: 1, months: 2, weeks: 1, days: 3 });
  // +1y2m -> 2027-08-16, +10 days -> 2027-08-26
  assert.equal(toISODate(d), '2027-08-26');
});

t('addToDate truncates fractional offsets and ignores non-finite', () => {
  assert.equal(toISODate(addToDate(parseISODate('2026-06-16'), { days: 2.9 })), '2026-06-18');
  assert.equal(toISODate(addToDate(parseISODate('2026-06-16'), { days: NaN })), '2026-06-16');
});

t('addToDate returns null for invalid base', () => {
  assert.equal(addToDate(null, { days: 5 }), null);
  assert.equal(addToDate(new Date(NaN), { days: 5 }), null);
});

t('daysBetween counts whole calendar days', () => {
  assert.equal(daysBetween(parseISODate('2026-06-16'), parseISODate('2026-09-14')), 90);
  assert.equal(daysBetween(parseISODate('2026-09-14'), parseISODate('2026-06-16')), -90);
  assert.equal(daysBetween(parseISODate('2026-06-16'), parseISODate('2026-06-16')), 0);
});

t('formatLong produces a weekday label', () => {
  const s = formatLong(parseISODate('2026-09-14'));
  assert.ok(s.includes('2026'));
  assert.ok(s.includes('September'));
  assert.equal(formatLong(new Date(NaN)), '');
});

console.log(`\n${pass} passing`);
