// timecard.js — pure, dependency-free time-card / hours-worked math.
// Shared by the browser tool (hours-calculator.js) and the unit tests.
// All times are "HH:MM" 24-hour strings; durations are tracked in minutes.
// Every function is honest about bad input: it returns NaN (or skips a bad row)
// rather than guessing — the UI is responsible for hiding NaN.

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 1440;

// parseTime("HH:MM") -> minutes since midnight (0..1439), or NaN if unparseable.
// Accepts "9:00", "09:00", "9:5" (= 09:05). Rejects out-of-range hours/minutes.
export function parseTime(str) {
  if (typeof str !== 'string') return NaN;
  const m = str.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return NaN;
  if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
  return h * MIN_PER_HOUR + min;
}

// Clamp a break value to a finite, non-negative number of minutes.
function breakMinutes(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// shiftMinutes(start, end, breakMin) -> paid minutes worked for one shift, or NaN.
// start/end are "HH:MM" strings; breakMin is unpaid break minutes (optional).
// Overnight handling: when end <= start, the shift is assumed to cross midnight,
// so a full day (1440 min) is added to end before subtracting (e.g. 22:00 -> 06:00
// = 8h). An equal start and end is treated as a full 24-hour shift, not 0.
// The unpaid break is subtracted; the result never goes below 0.
export function shiftMinutes(start, end, breakMin = 0) {
  const s = parseTime(start);
  let e = parseTime(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return NaN;
  if (e <= s) e += MIN_PER_DAY; // crosses midnight (or full 24h when equal)
  const worked = e - s - breakMinutes(breakMin);
  return worked > 0 ? worked : 0;
}

// Sum an array of rows ({ start, end, breakMin }) into total paid minutes.
// Rows that don't parse (incomplete/invalid) are skipped, so a half-filled
// row never poisons the running total.
export function totalMinutes(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, r) => {
    const m = shiftMinutes(r.start, r.end, r.breakMin);
    return Number.isFinite(m) ? sum + m : sum;
  }, 0);
}

// Minutes -> decimal hours (e.g. 450 -> 7.5). NaN passes through.
export function minutesToDecimal(min) {
  if (!Number.isFinite(min)) return NaN;
  return min / MIN_PER_HOUR;
}

// Minutes -> "h:mm" string (e.g. 450 -> "7:30", 90 -> "1:30").
// Negative/invalid reads as "0:00". Minutes are always zero-padded.
export function minutesToHhmm(min) {
  const total = Math.round(Number.isFinite(min) && min > 0 ? min : 0);
  const h = Math.floor(total / MIN_PER_HOUR);
  const m = total % MIN_PER_HOUR;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// Format decimal hours to a fixed 2-decimal string (e.g. 7.5 -> "7.50").
// Returns '' for non-finite input so the UI can show a dash.
export function formatDecimal(hours) {
  if (!Number.isFinite(hours)) return '';
  return hours.toFixed(2);
}

// grossPay(totalHours, rate) -> estimated gross pay, or NaN if either input is
// not a finite number. No rounding here — the UI formats as currency.
export function grossPay(totalHours, rate) {
  const h = typeof totalHours === 'number' ? totalHours : parseFloat(totalHours);
  const r = typeof rate === 'number' ? rate : parseFloat(rate);
  if (!Number.isFinite(h) || !Number.isFinite(r)) return NaN;
  return h * r;
}

// Split total hours into regular and overtime per the FLSA weekly model:
// hours over `thresholdHours` (federal default 40/week) are overtime.
// overtimeSplit(46, 40) -> { regular: 40, overtime: 6 }. NaN/invalid -> zeros.
export function overtimeSplit(totalHours, thresholdHours = 40) {
  const h = typeof totalHours === 'number' ? totalHours : parseFloat(totalHours);
  const t = typeof thresholdHours === 'number' ? thresholdHours : parseFloat(thresholdHours);
  if (!Number.isFinite(h) || h <= 0) return { regular: 0, overtime: 0 };
  const thr = Number.isFinite(t) && t >= 0 ? t : 40;
  const regular = Math.min(h, thr);
  const overtime = Math.max(0, h - thr);
  return { regular, overtime };
}

// Gross pay with FLSA weekly overtime: regular hours at `rate`, overtime hours
// (over `thresholdHours`) at `rate * multiplier` (federal default 1.5×).
// Returns { regularPay, overtimePay, total } or NaN fields on invalid input.
export function grossPayOvertime(totalHours, rate, { thresholdHours = 40, multiplier = 1.5 } = {}) {
  const r = typeof rate === 'number' ? rate : parseFloat(rate);
  const m = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1.5;
  if (!Number.isFinite(r)) return { regularPay: NaN, overtimePay: NaN, total: NaN };
  const { regular, overtime } = overtimeSplit(totalHours, thresholdHours);
  const regularPay = regular * r;
  const overtimePay = overtime * r * m;
  return { regularPay, overtimePay, total: regularPay + overtimePay };
}
