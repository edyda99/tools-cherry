// pace.js — pure, dependency-free running/walking pace calculations.
// Shared by the browser tool (pace-calculator.js) and the unit tests.
//
// The three quantities — distance, time, pace — are linked by:
//   pace (seconds per unit distance) = time (seconds) / distance (units)
// Given any two, the third is determined. Each solver returns a number of
// seconds (for time/pace) or a number of units (for distance), or NaN when an
// input is not a valid positive value. The UI is responsible for hiding NaN.

const pos = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

// 1 mile = 1.609344 km exactly.
export const KM_PER_MILE = 1.609344;

// Convert a distance between km and miles.
export function convertDistance(value, from, to) {
  const v = pos(value);
  if (Number.isNaN(v)) return NaN;
  if (from === to) return v;
  if (from === 'mi' && to === 'km') return v * KM_PER_MILE;
  if (from === 'km' && to === 'mi') return v / KM_PER_MILE;
  return NaN;
}

// Total seconds from hours/minutes/seconds parts. Blank parts count as 0; the
// whole thing is invalid (NaN) only if every part is blank or the total is <= 0.
export function toSeconds(h, m, s) {
  const num = (v) => {
    if (v === '' || v == null) return 0;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const hh = num(h), mm = num(m), ss = num(s);
  if (Number.isNaN(hh) || Number.isNaN(mm) || Number.isNaN(ss)) return NaN;
  const total = hh * 3600 + mm * 60 + ss;
  return total > 0 ? total : NaN;
}

// Format a number of seconds as H:MM:SS (or M:SS when under an hour).
// Rounds to the nearest second. Returns '' for non-finite input.
export function formatHMS(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '';
  let secs = Math.round(totalSeconds);
  const h = Math.floor(secs / 3600);
  secs -= h * 3600;
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

// pace = time / distance. Returns seconds per unit, or NaN.
export function pace(totalSeconds, distance) {
  const t = pos(totalSeconds), d = pos(distance);
  if (Number.isNaN(t) || Number.isNaN(d)) return NaN;
  return t / d;
}

// time = pace * distance. Returns total seconds, or NaN.
export function time(paceSecondsPerUnit, distance) {
  const p = pos(paceSecondsPerUnit), d = pos(distance);
  if (Number.isNaN(p) || Number.isNaN(d)) return NaN;
  return p * d;
}

// distance = time / pace. Returns units, or NaN.
export function distance(totalSeconds, paceSecondsPerUnit) {
  const t = pos(totalSeconds), p = pos(paceSecondsPerUnit);
  if (Number.isNaN(t) || Number.isNaN(p)) return NaN;
  return t / p;
}

// Average speed (distance units per hour) from total seconds and distance.
export function speed(totalSeconds, dist) {
  const t = pos(totalSeconds), d = pos(dist);
  if (Number.isNaN(t) || Number.isNaN(d)) return NaN;
  return d / (t / 3600);
}

// Convert a pace (seconds per unit) between km and miles.
// A min/km pace is "tighter" (fewer seconds) than the same min/mile pace.
export function convertPace(paceSecondsPerUnit, from, to) {
  const p = pos(paceSecondsPerUnit);
  if (Number.isNaN(p)) return NaN;
  if (from === to) return p;
  if (from === 'km' && to === 'mi') return p * KM_PER_MILE; // sec per mile = sec per km * km per mile
  if (from === 'mi' && to === 'km') return p / KM_PER_MILE;
  return NaN;
}

// Common race distances (in km) for the finish-time table.
export const RACE_DISTANCES = [
  { name: '1 km', km: 1 },
  { name: '1 mile', km: KM_PER_MILE },
  { name: '5K', km: 5 },
  { name: '10K', km: 10 },
  { name: 'Half marathon', km: 21.0975 },
  { name: 'Marathon', km: 42.195 }
];

// Given a pace in seconds per km, return finish times (seconds) for each
// standard race distance. Useful for the "predicted finish times" table.
export function raceFinishTimes(paceSecondsPerKm) {
  const p = pos(paceSecondsPerKm);
  if (Number.isNaN(p)) return [];
  return RACE_DISTANCES.map((r) => ({ name: r.name, seconds: p * r.km }));
}
