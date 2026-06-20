// test-pace.js — unit tests for the pure pace module. Run via `npm test`.
import assert from 'node:assert/strict';
import {
  KM_PER_MILE,
  convertDistance,
  toSeconds,
  formatHMS,
  pace,
  time,
  distance,
  speed,
  convertPace,
  raceFinishTimes
} from '../src/engine/pace.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-2) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// --- distance conversion ---
t('convertDistance: 1 mi -> ~1.609 km', () => approx(convertDistance(1, 'mi', 'km'), KM_PER_MILE));
t('convertDistance: 5 km -> ~3.107 mi', () => approx(convertDistance(5, 'km', 'mi'), 3.10686, 1e-3));
t('convertDistance: same unit passthrough', () => assert.equal(convertDistance(10, 'km', 'km'), 10));
t('convertDistance: bad input is NaN', () => assert.ok(Number.isNaN(convertDistance('x', 'km', 'mi'))));

// --- toSeconds ---
t('toSeconds: 0h 25m 30s = 1530', () => assert.equal(toSeconds(0, 25, 30), 1530));
t('toSeconds: 1h 0m 0s = 3600', () => assert.equal(toSeconds(1, '', ''), 3600));
t('toSeconds: blank-only fields = NaN', () => assert.ok(Number.isNaN(toSeconds('', '', ''))));
t('toSeconds: negative part = NaN', () => assert.ok(Number.isNaN(toSeconds(0, -5, 0))));

// --- formatHMS ---
t('formatHMS: 1530s -> 25:30', () => assert.equal(formatHMS(1530), '25:30'));
t('formatHMS: 3661s -> 1:01:01', () => assert.equal(formatHMS(3661), '1:01:01'));
t('formatHMS: 5s -> 0:05', () => assert.equal(formatHMS(5), '0:05'));
t('formatHMS: rounds 89.6 -> 1:30', () => assert.equal(formatHMS(89.6), '1:30'));
t('formatHMS: NaN -> empty', () => assert.equal(formatHMS(NaN), ''));

// --- core solvers (10 km in 50:00 -> 5:00/km) ---
t('pace: 3000s over 10 -> 300 s/unit', () => approx(pace(3000, 10), 300));
t('time: 300 s/unit * 10 -> 3000', () => approx(time(300, 10), 3000));
t('distance: 3000s / 300 s/unit -> 10', () => approx(distance(3000, 300), 10));
t('round-trip: distance(time(p,d),p) == d', () => approx(distance(time(285, 13.1), 285), 13.1));

// --- speed ---
t('speed: 10 km in 3000s -> 12 km/h', () => approx(speed(3000, 10), 12));
t('speed: bad input is NaN', () => assert.ok(Number.isNaN(speed(0, 10))));

// --- pace conversion ---
t('convertPace: 300 s/km -> ~482.8 s/mi', () => approx(convertPace(300, 'km', 'mi'), 300 * KM_PER_MILE));
t('convertPace: same unit passthrough', () => assert.equal(convertPace(300, 'mi', 'mi'), 300));

// --- race finish times ---
t('raceFinishTimes: marathon at 5:00/km ≈ 3:30:59', () => {
  const rows = raceFinishTimes(300);
  const marathon = rows.find((r) => r.name === 'Marathon');
  approx(marathon.seconds, 300 * 42.195, 0.5);
  assert.equal(formatHMS(marathon.seconds), '3:30:59');
});
t('raceFinishTimes: includes all six standard distances', () => {
  assert.equal(raceFinishTimes(300).length, 6);
});
t('raceFinishTimes: bad pace -> empty array', () => assert.deepEqual(raceFinishTimes(0), []));

console.log(`\n${pass} passing`);
