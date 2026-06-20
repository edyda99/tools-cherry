// test-due-date.js — unit tests for the pure pregnancy due-date module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { localDate } from '../src/engine/date-math.js';
import {
  addDays,
  eddFromLmp,
  eddFromConception,
  gestationalAge,
  trimesterForWeeks,
  pregnancySummary,
  LMP_TO_EDD_DAYS,
  CONCEPTION_TO_EDD_DAYS
} from '../src/engine/due-date.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

t('addDays crosses month and year boundaries', () => {
  assert.equal(iso(addDays(localDate(2026, 1, 30), 5)), '2026-02-04');
  assert.equal(iso(addDays(localDate(2026, 12, 28), 10)), '2027-01-07');
  assert.equal(iso(addDays(localDate(2026, 3, 1), -1)), '2026-02-28');
});

t('eddFromLmp uses Naegele 280 days for a 28-day cycle', () => {
  // LMP 2026-01-01 + 280 days = 2026-10-08.
  assert.equal(iso(eddFromLmp(localDate(2026, 1, 1))), '2026-10-08');
});

t('eddFromLmp adjusts for cycle length', () => {
  const base = eddFromLmp(localDate(2026, 1, 1), 28);
  const long = eddFromLmp(localDate(2026, 1, 1), 35); // +7 days
  const short = eddFromLmp(localDate(2026, 1, 1), 21); // -7 days
  assert.equal(iso(long), iso(addDays(base, 7)));
  assert.equal(iso(short), iso(addDays(base, -7)));
});

t('eddFromLmp rejects bad cycle lengths and dates', () => {
  assert.throws(() => eddFromLmp(localDate(2026, 1, 1), 10));
  assert.throws(() => eddFromLmp(localDate(2026, 1, 1), 60));
  assert.throws(() => eddFromLmp(new Date('not a date')));
});

t('eddFromConception uses 266 days', () => {
  // conception 2026-01-15 + 266 = 2026-10-08.
  assert.equal(iso(eddFromConception(localDate(2026, 1, 15))), '2026-10-08');
  assert.throws(() => eddFromConception(new Date('nope')));
});

t('gestationalAge reports completed weeks plus days', () => {
  const lmp = localDate(2026, 1, 1);
  assert.deepEqual(gestationalAge(lmp, localDate(2026, 1, 1)), { totalDays: 0, weeks: 0, days: 0 });
  assert.deepEqual(gestationalAge(lmp, localDate(2026, 1, 11)), { totalDays: 10, weeks: 1, days: 3 });
  // 280 days later = 40w 0d.
  assert.deepEqual(gestationalAge(lmp, addDays(lmp, 280)), { totalDays: 280, weeks: 40, days: 0 });
});

t('trimesterForWeeks boundaries', () => {
  assert.equal(trimesterForWeeks(0), 1);
  assert.equal(trimesterForWeeks(12), 1);
  assert.equal(trimesterForWeeks(13), 2);
  assert.equal(trimesterForWeeks(27), 2);
  assert.equal(trimesterForWeeks(28), 3);
  assert.equal(trimesterForWeeks(40), 3);
  assert.equal(trimesterForWeeks(-1), null);
});

t('pregnancySummary (LMP) ties the pieces together', () => {
  const s = pregnancySummary({
    method: 'lmp',
    date: localDate(2026, 1, 1),
    today: localDate(2026, 4, 2) // 91 days = 13w 0d
  });
  assert.equal(iso(s.edd), '2026-10-08');
  assert.equal(s.gestationalAge.weeks, 13);
  assert.equal(s.gestationalAge.days, 0);
  assert.equal(s.trimester, 2);
  assert.equal(s.daysToGo, 189); // 2026-04-02 -> 2026-10-08
});

t('pregnancySummary (conception) back-derives the clinical LMP', () => {
  const s = pregnancySummary({
    method: 'conception',
    date: localDate(2026, 1, 15),
    today: localDate(2026, 1, 15)
  });
  assert.equal(iso(s.edd), '2026-10-08');
  // LMP = EDD - 280 = conception - 14.
  assert.equal(iso(s.lmp), '2026-01-01');
  // At conception date, gestational age is ~2 weeks on the clinical clock.
  assert.equal(s.gestationalAge.weeks, 2);
  assert.equal(LMP_TO_EDD_DAYS - CONCEPTION_TO_EDD_DAYS, 14);
});

console.log(`\n${pass} passing`);
