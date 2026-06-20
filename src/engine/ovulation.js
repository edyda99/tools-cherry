// ovulation.js — pure, dependency-free ovulation / fertile-window forecasting.
// Shared by the browser tool (ovulation-calculator.js) and the unit tests.
//
// Model (the standard consumer-calculator convention):
//   - A menstrual cycle starts on the first day of the last period (LMP).
//   - Ovulation happens ~14 days BEFORE the next period — i.e. the luteal phase
//     is assumed fixed at 14 days, so ovulation = LMP + (cycleLength - 14).
//   - The "fertile window" is the 5 days before ovulation plus ovulation day,
//     because sperm survive up to ~5 days and the egg ~24 hours.
//
// This is an estimate for planning only, not a contraceptive method and not
// medical advice — the UI carries that disclaimer.
//
// All dates are local-midnight (the user's clock). "today" is always passed in
// by the caller; nothing here touches the network or a build clock.

import { startOfDay, daysBetween } from './date-math.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Luteal phase length assumed constant (days from ovulation to next period).
export const LUTEAL_PHASE_DAYS = 14;
// Fertile window spans the FERTILE_WINDOW_BEFORE days before ovulation through
// the ovulation day itself (sperm survival + egg viability).
export const FERTILE_WINDOW_BEFORE = 5;

// Cycle-length sanity bounds (days). Outside this range the math is unreliable.
export const MIN_CYCLE = 20;
export const MAX_CYCLE = 45;

// Add a whole number of days to a Date, returning a fresh local-midnight Date.
export function addDays(date, days) {
  const d = startOfDay(date);
  return new Date(d.getTime() + days * MS_PER_DAY);
}

function validCycle(cycleLength) {
  const c = Number(cycleLength);
  if (!Number.isFinite(c) || c < MIN_CYCLE || c > MAX_CYCLE) {
    throw new Error(`Cycle length should be between ${MIN_CYCLE} and ${MAX_CYCLE} days.`);
  }
  return Math.round(c);
}

// Ovulation date for the cycle that began on `lmp` (first day of last period).
// ovulation = LMP + (cycleLength - 14).
export function ovulationDate(lmp, cycleLength = 28) {
  if (!(lmp instanceof Date) || isNaN(lmp)) throw new Error('Enter a valid last-period date.');
  const cycle = validCycle(cycleLength);
  return addDays(lmp, cycle - LUTEAL_PHASE_DAYS);
}

// Fertile window { start, end } around an ovulation date: the 5 days before
// ovulation through the ovulation day itself.
export function fertileWindow(ovulation) {
  if (!(ovulation instanceof Date) || isNaN(ovulation)) {
    throw new Error('Enter a valid ovulation date.');
  }
  return { start: addDays(ovulation, -FERTILE_WINDOW_BEFORE), end: startOfDay(ovulation) };
}

// First day of the next period for the cycle that began on `lmp`.
export function nextPeriodDate(lmp, cycleLength = 28) {
  if (!(lmp instanceof Date) || isNaN(lmp)) throw new Error('Enter a valid last-period date.');
  const cycle = validCycle(cycleLength);
  return addDays(lmp, cycle);
}

// Advance the LMP forward in whole cycles until the cycle's fertile window has
// not already fully passed relative to `today`. Returns the upcoming (or
// current) cycle's LMP so forecasts stay in the future even if the user enters
// a last period from several cycles ago. Pure.
export function upcomingCycleLmp(lmp, cycleLength, today) {
  const cycle = validCycle(cycleLength);
  let cur = startOfDay(lmp);
  // Guard against pathological inputs (e.g. far-past dates): cap the walk.
  for (let i = 0; i < 600; i++) {
    const ov = addDays(cur, cycle - LUTEAL_PHASE_DAYS);
    // Keep this cycle if ovulation is today or still ahead.
    if (daysBetween(today, ov) >= 0) return cur;
    cur = addDays(cur, cycle);
  }
  return cur;
}

// One-shot summary used by the UI. Given the first day of the last period, a
// cycle length, and "today", returns the upcoming cycle's ovulation date,
// fertile window, next-period date, and days-until figures. Pure.
//
// rollForward (default true) advances to the soonest cycle whose ovulation is
// not already in the past, so a stale LMP still yields a useful forecast.
export function ovulationSummary({ lmp, cycleLength = 28, today = new Date(), rollForward = true }) {
  if (!(lmp instanceof Date) || isNaN(lmp)) throw new Error('Enter a valid last-period date.');
  const cycle = validCycle(cycleLength);
  const t0 = startOfDay(today);
  const baseLmp = rollForward ? upcomingCycleLmp(lmp, cycle, t0) : startOfDay(lmp);

  const ovulation = ovulationDate(baseLmp, cycle);
  const window = fertileWindow(ovulation);
  const nextPeriod = nextPeriodDate(baseLmp, cycle);

  return {
    cycleLength: cycle,
    cycleStart: baseLmp,
    ovulation,
    fertileStart: window.start,
    fertileEnd: window.end,
    nextPeriod,
    daysToOvulation: daysBetween(t0, ovulation),
    daysToFertileStart: daysBetween(t0, window.start),
    daysToNextPeriod: daysBetween(t0, nextPeriod),
    // True when today falls within the fertile window (inclusive).
    inFertileWindow:
      daysBetween(window.start, t0) >= 0 && daysBetween(t0, window.end) >= 0
  };
}
