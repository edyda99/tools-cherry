// test-duration.js — unit tests for the pure duration module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { parseDuration, formatDuration, splitDuration } from '../src/engine/duration.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

// --- parseDuration -----------------------------------------------------------
t('parseDuration: 0/0/0 is 0ms', () => assert.equal(parseDuration(0, 0, 0), 0));
t('parseDuration: 1 hour = 3,600,000ms', () => assert.equal(parseDuration(1, 0, 0), 3600000));
t('parseDuration: 1 minute = 60,000ms', () => assert.equal(parseDuration(0, 1, 0), 60000));
t('parseDuration: 1 second = 1,000ms', () => assert.equal(parseDuration(0, 0, 1), 1000));
t('parseDuration: 1h 2m 3s', () =>
  assert.equal(parseDuration(1, 2, 3), 3600000 + 120000 + 3000));
t('parseDuration: 25 minutes (Pomodoro) = 1,500,000ms', () =>
  assert.equal(parseDuration(0, 25, 0), 1500000));
t('parseDuration: overflow minutes/seconds still add up (90s = 90,000ms)', () =>
  assert.equal(parseDuration(0, 0, 90), 90000));
t('parseDuration: negative values clamp to 0', () =>
  assert.equal(parseDuration(-5, -1, -1), 0));
t('parseDuration: blank/NaN strings clamp to 0', () =>
  assert.equal(parseDuration('', 'x', undefined), 0));
t('parseDuration: numeric strings parse', () =>
  assert.equal(parseDuration('0', '5', '30'), 5 * 60000 + 30000));
t('parseDuration: fractional input floors', () =>
  assert.equal(parseDuration(0, 1.9, 0), 60000));

// --- formatDuration ----------------------------------------------------------
t('formatDuration: 0ms -> 00:00:00', () => assert.equal(formatDuration(0), '00:00:00'));
t('formatDuration: 1000ms -> 00:00:01', () => assert.equal(formatDuration(1000), '00:00:01'));
t('formatDuration: 60,000ms -> 00:01:00', () => assert.equal(formatDuration(60000), '00:01:00'));
t('formatDuration: 1h -> 01:00:00', () => assert.equal(formatDuration(3600000), '01:00:00'));
t('formatDuration: 1h 2m 3s', () =>
  assert.equal(formatDuration(3600000 + 120000 + 3000), '01:02:03'));
t('formatDuration: 25 min -> 00:25:00', () => assert.equal(formatDuration(1500000), '00:25:00'));
t('formatDuration: rounds up partial second (1ms -> 00:00:01)', () =>
  assert.equal(formatDuration(1), '00:00:01'));
t('formatDuration: 1500ms rounds up to 00:00:02', () =>
  assert.equal(formatDuration(1500), '00:00:02'));
t('formatDuration: negative -> 00:00:00', () => assert.equal(formatDuration(-5000), '00:00:00'));
t('formatDuration: NaN -> 00:00:00', () => assert.equal(formatDuration(NaN), '00:00:00'));
t('formatDuration: 10 hours -> 10:00:00', () => assert.equal(formatDuration(36000000), '10:00:00'));

// --- splitDuration -----------------------------------------------------------
t('splitDuration: 1h 2m 3s', () =>
  assert.deepEqual(splitDuration(3600000 + 120000 + 3000), { hours: 1, minutes: 2, seconds: 3 }));
t('splitDuration: 0ms is all zeros', () =>
  assert.deepEqual(splitDuration(0), { hours: 0, minutes: 0, seconds: 0 }));
t('splitDuration: 90s -> 0h 1m 30s', () =>
  assert.deepEqual(splitDuration(90000), { hours: 0, minutes: 1, seconds: 30 }));

// Round-trip: parse then format should be stable for clean inputs.
t('round-trip: parse(1,2,3) -> format -> 01:02:03', () =>
  assert.equal(formatDuration(parseDuration(1, 2, 3)), '01:02:03'));

console.log(`\n${pass} passing`);
