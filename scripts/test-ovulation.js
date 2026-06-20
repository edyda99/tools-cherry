// test-ovulation.js — unit tests for the pure ovulation module. Run via `npm test`.
import assert from 'node:assert/strict';
import { localDate } from '../src/engine/date-math.js';
import {
  ovulationDate,
  fertileWindow,
  nextPeriodDate,
  upcomingCycleLmp,
  ovulationSummary,
  LUTEAL_PHASE_DAYS,
  FERTILE_WINDOW_BEFORE
} from '../src/engine/ovulation.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// LMP 2026-06-01, 28-day cycle -> ovulation on day 14 (28-14) = 2026-06-15.
t('ovulationDate: 28-day cycle ovulates LMP+14', () => {
  const ov = ovulationDate(localDate(2026, 6, 1), 28);
  assert.equal(iso(ov), '2026-06-15');
});

t('ovulationDate: longer cycle ovulates later (32-day -> LMP+18)', () => {
  const ov = ovulationDate(localDate(2026, 6, 1), 32);
  assert.equal(iso(ov), '2026-06-19');
});

t('ovulationDate: shorter cycle ovulates earlier (24-day -> LMP+10)', () => {
  const ov = ovulationDate(localDate(2026, 6, 1), 24);
  assert.equal(iso(ov), '2026-06-11');
});

t('fertileWindow: 5 days before ovulation through ovulation day', () => {
  const w = fertileWindow(localDate(2026, 6, 15));
  assert.equal(iso(w.start), '2026-06-10');
  assert.equal(iso(w.end), '2026-06-15');
});

t('nextPeriodDate: LMP + cycle length', () => {
  assert.equal(iso(nextPeriodDate(localDate(2026, 6, 1), 28)), '2026-06-29');
  assert.equal(iso(nextPeriodDate(localDate(2026, 6, 1), 30)), '2026-07-01');
});

t('constants are the standard convention', () => {
  assert.equal(LUTEAL_PHASE_DAYS, 14);
  assert.equal(FERTILE_WINDOW_BEFORE, 5);
});

t('upcomingCycleLmp: rolls a stale LMP forward to the current cycle', () => {
  // LMP three cycles ago; today after several cycles -> next cycle whose
  // ovulation is still upcoming.
  const lmp = localDate(2026, 1, 1);
  const today = localDate(2026, 6, 10);
  const rolled = upcomingCycleLmp(lmp, 28, today);
  // Each cycle advances 28 days from Jan 1: Jan1, Jan29, Feb26, Mar26, Apr23,
  // May21, Jun18. Ovulation for May21 cycle = Jun4 (past on Jun10), so it rolls
  // to the Jun18 cycle (ovulation Jul2, still ahead).
  assert.equal(iso(rolled), '2026-06-18');
});

t('upcomingCycleLmp: keeps current cycle when ovulation is today or ahead', () => {
  const lmp = localDate(2026, 6, 1);
  const today = localDate(2026, 6, 10); // ovulation Jun15 still ahead
  assert.equal(iso(upcomingCycleLmp(lmp, 28, today)), '2026-06-01');
});

t('ovulationSummary: full forecast with days-until figures', () => {
  const s = ovulationSummary({
    lmp: localDate(2026, 6, 1),
    cycleLength: 28,
    today: localDate(2026, 6, 10)
  });
  assert.equal(iso(s.ovulation), '2026-06-15');
  assert.equal(iso(s.fertileStart), '2026-06-10');
  assert.equal(iso(s.fertileEnd), '2026-06-15');
  assert.equal(iso(s.nextPeriod), '2026-06-29');
  assert.equal(s.daysToOvulation, 5);
  assert.equal(s.daysToFertileStart, 0);
  assert.equal(s.daysToNextPeriod, 19);
  assert.equal(s.inFertileWindow, true); // Jun10 is the start of the window
});

t('ovulationSummary: inFertileWindow false outside the window', () => {
  const s = ovulationSummary({
    lmp: localDate(2026, 6, 1),
    cycleLength: 28,
    today: localDate(2026, 6, 2)
  });
  assert.equal(s.inFertileWindow, false);
});

t('rejects invalid cycle length', () => {
  assert.throws(() => ovulationDate(localDate(2026, 6, 1), 10));
  assert.throws(() => ovulationDate(localDate(2026, 6, 1), 60));
});

t('rejects invalid date', () => {
  assert.throws(() => ovulationDate(new Date('not-a-date'), 28));
});

console.log(`\n${pass} passing`);
