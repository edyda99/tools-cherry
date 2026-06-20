// due-date.js — pure, dependency-free pregnancy due-date math.
// Shared by the browser tool (due-date-calculator.js) and the unit tests.
//
// Two calculation methods, both reduced to a single "estimated due date" (EDD):
//   - 'lmp':        from the first day of the last menstrual period.
//                   Naegele's rule: EDD = LMP + 280 days (40 weeks), adjusted
//                   for a cycle length other than the standard 28 days.
//   - 'conception': from the (known) conception / ovulation date.
//                   EDD = conception + 266 days (38 weeks).
//
// All dates are local-midnight (the user's clock). Nothing here touches the
// network or a build clock; "today" is always passed in by the caller.

import { startOfDay, daysBetween } from './date-math.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Standard pregnancy lengths (in days), measured from each reference point.
export const LMP_TO_EDD_DAYS = 280;        // 40 weeks from LMP (Naegele's rule)
export const CONCEPTION_TO_EDD_DAYS = 266;  // 38 weeks from conception
export const STANDARD_CYCLE = 28;           // assumed cycle length in Naegele's rule

// Add a whole number of days to a Date, returning a fresh local-midnight Date.
export function addDays(date, days) {
  const d = startOfDay(date);
  return new Date(d.getTime() + days * MS_PER_DAY);
}

// Estimated due date (EDD) from the first day of the last menstrual period.
// cycleLength tunes Naegele's rule: a longer cycle ovulates later, pushing the
// due date out by (cycleLength - 28) days; a shorter cycle pulls it in.
export function eddFromLmp(lmp, cycleLength = STANDARD_CYCLE) {
  if (!(lmp instanceof Date) || isNaN(lmp)) throw new Error('Enter a valid last-period date.');
  const cycle = Number(cycleLength);
  if (!Number.isFinite(cycle) || cycle < 20 || cycle > 45) {
    throw new Error('Cycle length should be between 20 and 45 days.');
  }
  return addDays(lmp, LMP_TO_EDD_DAYS + (cycle - STANDARD_CYCLE));
}

// Estimated due date (EDD) from a known conception / ovulation date.
export function eddFromConception(conception) {
  if (!(conception instanceof Date) || isNaN(conception)) {
    throw new Error('Enter a valid conception date.');
  }
  return addDays(conception, CONCEPTION_TO_EDD_DAYS);
}

// Gestational age "as of" a date, expressed the clinical way: completed weeks
// plus extra days (e.g. 12w 3d). Measured from the LMP, which for the
// conception method is back-derived (conception ≈ LMP + ~14 days, so we treat
// the start of pregnancy as 280 days before the EDD).
//
// Returns { totalDays, weeks, days } where totalDays can be negative if `asOf`
// is before the LMP (i.e. before the pregnancy "starts" on the clinical clock).
export function gestationalAge(lmp, asOf) {
  const total = daysBetween(lmp, asOf);
  // Floor toward zero for negatives so weeks/days stay consistent in sign.
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  return { totalDays: total, weeks: sign * Math.floor(abs / 7), days: sign * (abs % 7) };
}

// The pregnancy trimester for a given completed-week count.
// Common convention: 1st = weeks 0–12, 2nd = 13–27, 3rd = 28+.
export function trimesterForWeeks(weeks) {
  if (weeks < 0) return null;
  if (weeks <= 12) return 1;
  if (weeks <= 27) return 2;
  return 3;
}

// One-shot summary used by the UI. Given a method, the relevant input date,
// an optional cycle length, and "today", returns the EDD plus today's
// gestational age, trimester, and a days-to-go figure. Pure.
//
// For the conception method we derive the clinical LMP as EDD - 280 days so the
// gestational-age clock matches what a clinician would read.
export function pregnancySummary({ method, date, cycleLength = STANDARD_CYCLE, today = new Date() }) {
  let edd, lmp;
  if (method === 'conception') {
    edd = eddFromConception(date);
    lmp = addDays(edd, -LMP_TO_EDD_DAYS);
  } else {
    edd = eddFromLmp(date, cycleLength);
    lmp = startOfDay(date);
  }
  const age = gestationalAge(lmp, today);
  const daysToGo = daysBetween(today, edd);
  return {
    edd,
    lmp,
    conceptionApprox: addDays(lmp, LMP_TO_EDD_DAYS - CONCEPTION_TO_EDD_DAYS), // ~LMP + 14
    gestationalAge: age,
    trimester: trimesterForWeeks(age.weeks),
    daysToGo
  };
}
