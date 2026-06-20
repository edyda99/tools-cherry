// test-sleep.js — unit tests for the pure sleep module. Run via `npm test`.
import assert from 'node:assert/strict';
import {
  bedtimesForWake,
  wakeTimesForBed,
  normalizeMinutes,
  formatClock,
  parseClock,
  isIdeal,
  CYCLE_MIN
} from '../src/engine/sleep.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('normalizeMinutes wraps negatives and overflow', () => {
  assert.equal(normalizeMinutes(-135), 1305);
  assert.equal(normalizeMinutes(1845), 405);
  assert.equal(normalizeMinutes(0), 0);
});

t('bedtimesForWake: wake 7:00 AM (420) cycle boundaries', () => {
  const r = bedtimesForWake(420, { cycles: [6, 5, 4, 3] });
  // 6 cycles: 420 - 15 - 540 = -135 -> 21:45 (9:45 PM)
  assert.equal(r[0].timeMin, 1305);
  // 5 cycles: 420 - 15 - 450 = -45 -> 23:15 (11:15 PM)
  assert.equal(r[1].timeMin, 1395);
  // 4 cycles: 420 - 15 - 360 = 45 -> 12:45 AM
  assert.equal(r[2].timeMin, 45);
  // 3 cycles: 420 - 15 - 270 = 135 -> 2:15 AM
  assert.equal(r[3].timeMin, 135);
});

t('bedtimesForWake: cycle/sleep metadata', () => {
  const r = bedtimesForWake(420);
  assert.equal(r[0].cycles, 6);
  assert.equal(r[0].sleepMinutes, 6 * CYCLE_MIN);
  assert.equal(r[0].sleepHours, 9);
});

t('wakeTimesForBed: bed 11:00 PM (1380) cycle boundaries', () => {
  const r = wakeTimesForBed(1380, { cycles: [6, 5, 4] });
  // asleep at 1395; 6 cycles +540 = 1935 -> 8:15 AM (495)
  assert.equal(r[0].timeMin, 495);
  // 5 cycles +450 = 1845 -> 6:45 AM (405)
  assert.equal(r[1].timeMin, 405);
  // 4 cycles +360 = 1755 -> 5:15 AM (315)
  assert.equal(r[2].timeMin, 315);
});

t('fall-asleep override changes the result', () => {
  const r = bedtimesForWake(420, { cycles: [5], fallAsleep: 0 });
  // 420 - 0 - 450 = -30 -> 23:30
  assert.equal(r[0].timeMin, 1410);
});

t('formatClock 12-hour', () => {
  assert.equal(formatClock(0), '12:00 AM');
  assert.equal(formatClock(720), '12:00 PM');
  assert.equal(formatClock(1305), '9:45 PM');
  assert.equal(formatClock(405), '6:45 AM');
});

t('formatClock 24-hour', () => {
  assert.equal(formatClock(1305, { h24: true }), '21:45');
  assert.equal(formatClock(405, { h24: true }), '06:45');
});

t('parseClock 24-hour input', () => {
  assert.equal(parseClock('07:30'), 450);
  assert.equal(parseClock('23:05'), 1385);
  assert.equal(parseClock('00:00'), 0);
});

t('parseClock 12-hour input', () => {
  assert.equal(parseClock('7:30 AM'), 450);
  assert.equal(parseClock('12:00 AM'), 0);
  assert.equal(parseClock('12:30 PM'), 750);
  assert.equal(parseClock('11:15 pm'), 1395);
});

t('parseClock rejects junk', () => {
  assert.equal(parseClock('nope'), null);
  assert.equal(parseClock('25:00'), null);
  assert.equal(parseClock('7:75'), null);
  assert.equal(parseClock(''), null);
});

t('isIdeal flags 5 and 6 cycles', () => {
  assert.equal(isIdeal(6), true);
  assert.equal(isIdeal(5), true);
  assert.equal(isIdeal(4), false);
  assert.equal(isIdeal(3), false);
});

t('round-trip: bedtime then wake returns original wake', () => {
  const wake = 420;
  const bed = bedtimesForWake(wake, { cycles: [5] })[0];
  const back = wakeTimesForBed(bed.timeMin, { cycles: [5] })[0];
  assert.equal(back.timeMin, wake);
});

console.log(`\n${pass} passing`);
