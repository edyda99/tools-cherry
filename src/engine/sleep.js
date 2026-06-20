// sleep.js — pure, dependency-free sleep-cycle math.
// Shared by the browser tool (sleep-calculator.js) and the unit tests.
//
// Sleep runs in roughly 90-minute cycles; waking at the end of a cycle (rather
// than mid-cycle) tends to feel more refreshed. People also take ~15 minutes to
// fall asleep. So:
//   bedtime  = waketime − fallAsleep − cycles × 90 min
//   waketime = bedtime  + fallAsleep + cycles × 90 min
// Times are minutes from midnight (0–1439); arithmetic wraps across midnight.

export const CYCLE_MIN = 90;
export const FALL_ASLEEP_MIN = 15;
export const DEFAULT_CYCLES = [6, 5, 4, 3];
const DAY = 1440;

const num = (n) => {
  const v = typeof n === 'number' ? n : parseFloat(n);
  return Number.isFinite(v) ? v : 0;
};

// Wrap any minute value into the 0–1439 range (handles negatives and >1 day).
export function normalizeMinutes(m) {
  return (((Math.round(num(m)) % DAY) + DAY) % DAY);
}

function option(cycles, timeMin) {
  const sleepMinutes = cycles * CYCLE_MIN;
  return { cycles, sleepMinutes, sleepHours: sleepMinutes / 60, timeMin: normalizeMinutes(timeMin) };
}

// Given a target wake time, the bedtimes that land you on a full cycle boundary.
export function bedtimesForWake(wakeMin, { cycles = DEFAULT_CYCLES, fallAsleep = FALL_ASLEEP_MIN } = {}) {
  const w = normalizeMinutes(wakeMin);
  const fa = Math.max(0, num(fallAsleep));
  return cycles.map((c) => option(c, w - fa - c * CYCLE_MIN));
}

// Given a bedtime (or "now"), the wake times that fall on a full cycle boundary.
export function wakeTimesForBed(bedMin, { cycles = DEFAULT_CYCLES, fallAsleep = FALL_ASLEEP_MIN } = {}) {
  const b = normalizeMinutes(bedMin);
  const fa = Math.max(0, num(fallAsleep));
  return cycles.map((c) => option(c, b + fa + c * CYCLE_MIN));
}

// 5–6 cycles (7.5–9 hours) is the commonly recommended range for adults.
export function isIdeal(cycles) {
  return cycles === 5 || cycles === 6;
}

// Format minutes-from-midnight as a clock string. 12-hour by default.
export function formatClock(min, { h24 = false } = {}) {
  const m = normalizeMinutes(min);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  const mmStr = String(mm).padStart(2, '0');
  if (h24) return `${String(hh).padStart(2, '0')}:${mmStr}`;
  const ap = hh < 12 ? 'AM' : 'PM';
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${mmStr} ${ap}`;
}

// Parse "HH:MM" (24h, as <input type=time> gives) or "h:mm AM/PM" to minutes.
// Returns null on anything unparseable.
export function parseClock(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  const m = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (min > 59) return null;
  const ap = m[3] ? m[3].toLowerCase() : null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'am') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) {
    return null;
  }
  return normalizeMinutes(h * 60 + min);
}
