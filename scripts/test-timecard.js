// test-timecard.js — unit tests for the pure timecard module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  parseTime,
  shiftMinutes,
  totalMinutes,
  minutesToDecimal,
  minutesToHhmm,
  formatDecimal,
  grossPay,
  overtimeSplit,
  grossPayOvertime
} from '../src/engine/timecard.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// --- parseTime ---------------------------------------------------------------
t('parseTime: 09:00 -> 540', () => assert.equal(parseTime('09:00'), 540));
t('parseTime: 9:5 -> 545 (9:05)', () => assert.equal(parseTime('9:5'), 545));
t('parseTime: 00:00 -> 0', () => assert.equal(parseTime('00:00'), 0));
t('parseTime: 23:59 -> 1439', () => assert.equal(parseTime('23:59'), 1439));
t('parseTime: blank is NaN', () => assert.ok(Number.isNaN(parseTime(''))));
t('parseTime: 25:00 out of range is NaN', () => assert.ok(Number.isNaN(parseTime('25:00'))));
t('parseTime: 12:60 out of range is NaN', () => assert.ok(Number.isNaN(parseTime('12:60'))));
t('parseTime: garbage is NaN', () => assert.ok(Number.isNaN(parseTime('abc'))));

// --- shiftMinutes ------------------------------------------------------------
t('shiftMinutes: 09:00->17:00 with 30m break = 7.5h', () => {
  const m = shiftMinutes('09:00', '17:00', 30);
  approx(m, 450); // 8h - 30m = 7h30m
  approx(minutesToDecimal(m), 7.5);
});
t('shiftMinutes: 09:00->17:00 no break = 8h', () =>
  approx(shiftMinutes('09:00', '17:00'), 480));
t('shiftMinutes: overnight 22:00->06:00 = 8h', () =>
  approx(shiftMinutes('22:00', '06:00'), 480));
t('shiftMinutes: overnight 23:30->07:30 with 60m break = 7h', () =>
  approx(shiftMinutes('23:30', '07:30', 60), 420));
t('shiftMinutes: equal start/end = 24h shift', () =>
  approx(shiftMinutes('08:00', '08:00'), MIN_PER_DAY_CHECK()));
t('shiftMinutes: break larger than shift clamps to 0', () =>
  approx(shiftMinutes('09:00', '10:00', 120), 0));
t('shiftMinutes: invalid time is NaN', () =>
  assert.ok(Number.isNaN(shiftMinutes('xx', '17:00'))));

function MIN_PER_DAY_CHECK() { return 1440; }

// --- totalMinutes (multi-row) ------------------------------------------------
t('totalMinutes: multi-row week total', () => {
  const rows = [
    { start: '09:00', end: '17:00', breakMin: 30 }, // 7.5h
    { start: '09:00', end: '17:30', breakMin: 30 }, // 8.0h
    { start: '22:00', end: '06:00', breakMin: 0 }   // 8.0h overnight
  ];
  const m = totalMinutes(rows);
  approx(m, 450 + 480 + 480); // 1410 min
  approx(minutesToDecimal(m), 23.5);
});
t('totalMinutes: skips incomplete/invalid rows', () => {
  const rows = [
    { start: '09:00', end: '17:00', breakMin: 0 }, // 8h
    { start: '', end: '17:00', breakMin: 0 },       // skipped
    { start: '09:00', end: '', breakMin: 0 }        // skipped
  ];
  approx(totalMinutes(rows), 480);
});
t('totalMinutes: empty list is 0', () => approx(totalMinutes([]), 0));

// --- formatting --------------------------------------------------------------
t('minutesToHhmm: 450 -> 7:30', () => assert.equal(minutesToHhmm(450), '7:30'));
t('minutesToHhmm: 90 -> 1:30', () => assert.equal(minutesToHhmm(90), '1:30'));
t('minutesToHhmm: 480 -> 8:00', () => assert.equal(minutesToHhmm(480), '8:00'));
t('minutesToHhmm: negative -> 0:00', () => assert.equal(minutesToHhmm(-5), '0:00'));
t('formatDecimal: 7.5 -> "7.50"', () => assert.equal(formatDecimal(7.5), '7.50'));
t('formatDecimal: 8 -> "8.00"', () => assert.equal(formatDecimal(8), '8.00'));
t('formatDecimal: NaN -> ""', () => assert.equal(formatDecimal(NaN), ''));

// --- grossPay ----------------------------------------------------------------
t('grossPay: 23.5h @ $20 = $470', () => approx(grossPay(23.5, 20), 470));
t('grossPay: accepts strings', () => approx(grossPay('40', '15'), 600));
t('grossPay: missing rate is NaN', () => assert.ok(Number.isNaN(grossPay(8, ''))));

// --- overtime (FLSA weekly model) --------------------------------------------
t('overtimeSplit: 46h over 40 -> 40 regular + 6 OT', () => {
  const s = overtimeSplit(46, 40);
  approx(s.regular, 40); approx(s.overtime, 6);
});
t('overtimeSplit: under threshold -> all regular, no OT', () => {
  const s = overtimeSplit(35, 40);
  approx(s.regular, 35); approx(s.overtime, 0);
});
t('overtimeSplit: custom threshold (e.g. 8 daily)', () => {
  const s = overtimeSplit(10, 8);
  approx(s.regular, 8); approx(s.overtime, 2);
});
t('overtimeSplit: invalid/zero -> zeros', () => {
  const s = overtimeSplit(NaN, 40);
  assert.equal(s.regular, 0); assert.equal(s.overtime, 0);
});

t('grossPayOvertime: 46h @ $20, 1.5x -> 40*20 + 6*30 = 980', () => {
  const p = grossPayOvertime(46, 20, { thresholdHours: 40, multiplier: 1.5 });
  approx(p.regularPay, 800); approx(p.overtimePay, 180); approx(p.total, 980);
});
t('grossPayOvertime: no OT when under threshold = flat pay', () => {
  const p = grossPayOvertime(38, 25, { thresholdHours: 40 });
  approx(p.regularPay, 950); approx(p.overtimePay, 0); approx(p.total, 950);
});
t('grossPayOvertime: 2x multiplier honored', () => {
  const p = grossPayOvertime(44, 10, { thresholdHours: 40, multiplier: 2 });
  approx(p.total, 400 + 4 * 10 * 2); // 400 + 80 = 480
});
t('grossPayOvertime: invalid rate -> NaN total', () =>
  assert.ok(Number.isNaN(grossPayOvertime(46, '', {}).total)));

console.log(`\n${pass} passing`);
