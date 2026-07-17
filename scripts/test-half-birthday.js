// test-half-birthday.js — unit tests for the pure half-birthday module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  halfBirthday,
  midpointHalfBirthday,
  daysUntilNextHalfBirthday,
  daysBetween
} from '../src/engine/half-birthday.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

// --- calendar half-birthday --------------------------------------------------
t('halfBirthday: 14 March -> 14 September', () => {
  const h = halfBirthday({ y: 1990, m: 3, d: 14 });
  assert.deepEqual({ month: h.month, day: h.day }, { month: 9, day: 14 });
});
t('halfBirthday: 15 September wraps -> 15 March', () => {
  const h = halfBirthday({ y: 1990, m: 9, d: 15 });
  assert.deepEqual({ month: h.month, day: h.day }, { month: 3, day: 15 });
});
t('halfBirthday: 31 August clamps -> 28/29 February', () => {
  const h = halfBirthday({ y: 1990, m: 8, d: 31 });
  assert.equal(h.month, 2);
  assert.ok(h.clamped);
});

// --- midpoint (182.5-day) half-birthday --------------------------------------
// The midpoint must sit ~a day or two from the CALENDAR half-birthday of the
// same landing year — never ~a year away. Regression guard for the July–December
// (wrapping) birthday bug: the 182.5 days must be added to the birthday that
// PRECEDES the displayed landing year, not the birthday IN the landing year.
const within2 = (a, b) => Math.abs(daysBetween(a, b)) <= 2;

t('midpointHalfBirthday: Jan–Jun birth (14 Mar, land 2026) ~ Sep 14 calendar', () => {
  const birth = { y: 1990, m: 3, d: 14 };
  const mid = midpointHalfBirthday(birth, 2026);
  assert.deepEqual(mid, { y: 2026, m: 9, d: 13 });        // 14 Mar + 183 days
  assert.ok(within2({ y: 2026, m: 9, d: 14 }, mid));      // ~ calendar 14 Sep
});

t('midpointHalfBirthday: Jul–Dec birth (15 Sep, land 2027) ~ Mar 15 calendar, NOT a year off', () => {
  const birth = { y: 1990, m: 9, d: 15 };
  const mid = midpointHalfBirthday(birth, 2027);
  assert.deepEqual(mid, { y: 2027, m: 3, d: 17 });        // 15 Sep 2026 + 183 days
  const calendar = { y: 2027, m: 3, d: 15 };
  assert.ok(within2(calendar, mid), `midpoint ${JSON.stringify(mid)} not near ${JSON.stringify(calendar)}`);
  // Guard against the old bug (midpoint landed ~365 days away in Mar 2028).
  assert.ok(Math.abs(daysBetween(calendar, mid)) < 30);
});

// --- end-to-end: mirrors the asset's call `midpointHalfBirthday(birth, next.date.y)` ---
t('midpoint via daysUntilNextHalfBirthday: Sep 15 birth in Jul 2026 lands ~2 days off, not ~a year', () => {
  const birth = { y: 1990, m: 9, d: 15 };
  const today = { y: 2026, m: 7, d: 1 };                  // Mar 15 2026 already passed
  const next = daysUntilNextHalfBirthday(birth, today);
  assert.deepEqual(next.date, { y: 2027, m: 3, d: 15 });  // rolls to next year
  const mid = midpointHalfBirthday(birth, next.date.y);
  assert.ok(within2(next.date, mid), `midpoint ${JSON.stringify(mid)} not near ${JSON.stringify(next.date)}`);
});

console.log(`\n${pass} passing`);
