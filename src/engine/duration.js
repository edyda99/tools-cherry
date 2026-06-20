// duration.js — pure, dependency-free duration helpers for the countdown timer.
// Shared by the browser tool (countdown-timer.js) and the unit tests.
// A "duration" is a non-negative number of milliseconds. No clock, no network.

const MS_PER_HOUR = 3600000;
const MS_PER_MIN = 60000;
const MS_PER_SEC = 1000;

// Clamp any input to a finite, non-negative integer. Used to sanitise the
// hours/minutes/seconds form fields, which may be blank, NaN, or negative.
function toCount(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// parseDuration(h, m, s) -> total milliseconds. Inputs are clamped to
// non-negative integers; minutes/seconds beyond 59 still add up (e.g. 90s = 1m30s).
export function parseDuration(h, m, s) {
  return toCount(h) * MS_PER_HOUR + toCount(m) * MS_PER_MIN + toCount(s) * MS_PER_SEC;
}

// formatDuration(ms) -> "HH:MM:SS". Negative or invalid input reads as 00:00:00.
// Rounds up to the next whole second so a timer shows "00:00:01" until it truly
// hits zero (no premature "00:00:00" with time still on the clock).
export function formatDuration(ms) {
  let total = Math.ceil((Number.isFinite(ms) && ms > 0 ? ms : 0) / MS_PER_SEC);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Split milliseconds into rounded-up whole {hours, minutes, seconds} parts.
// Handy when the UI wants the segments separately rather than a joined string.
export function splitDuration(ms) {
  let total = Math.ceil((Number.isFinite(ms) && ms > 0 ? ms : 0) / MS_PER_SEC);
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60
  };
}
