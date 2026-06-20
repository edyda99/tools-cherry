// average.js — pure, dependency-free descriptive-statistics math.
// Shared by the browser tool (average-calculator.js) and the unit tests.
//
// Takes a free-form list of numbers (separated by commas, spaces, tabs, or new
// lines) and reports the common "average" measures people look for: the mean
// (arithmetic average), the median (middle value), the mode (most frequent
// value(s)), plus the count, sum, min, max, and range. It also reports the
// population and sample standard deviation, since those are the next thing
// people reach for after the mean.
//
// Everything is plain numbers in; a plain result object out. No DOM, no I/O.

// Parse a free-form string into an array of finite numbers, preserving order.
// Accepts commas, whitespace, and new lines as separators. Ignores blank
// tokens; tokens that aren't valid numbers are returned separately so the UI
// can warn without silently dropping a typo.
export function parseNumbers(text = '') {
  const tokens = String(text)
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const numbers = [];
  const invalid = [];
  for (const tok of tokens) {
    // Number() is strict enough: it rejects "1.2.3" and "abc" (-> NaN) but
    // accepts "-3", "4.5", "1e3", and "+2".
    const v = Number(tok);
    if (Number.isFinite(v)) numbers.push(v);
    else invalid.push(tok);
  }
  return { numbers, invalid };
}

export function mean(nums = []) {
  if (!nums.length) return null;
  return sum(nums) / nums.length;
}

export function sum(nums = []) {
  let s = 0;
  for (const n of nums) s += n;
  return s;
}

export function median(nums = []) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// Mode: the value(s) that occur most often. Returns an array because a data set
// can be multi-modal. When every value is unique (each appears once), there is
// no mode, so the array is empty.
export function mode(nums = []) {
  if (!nums.length) return [];
  const counts = new Map();
  for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1);
  let max = 0;
  for (const c of counts.values()) if (c > max) max = c;
  if (max <= 1) return []; // all values unique -> no mode
  const modes = [];
  for (const [val, c] of counts) if (c === max) modes.push(val);
  return modes.sort((a, b) => a - b);
}

export function range(nums = []) {
  if (!nums.length) return null;
  return Math.max(...nums) - Math.min(...nums);
}

// Variance. population=true divides by N; population=false (sample) divides by
// N-1. Sample variance is undefined for a single value (N-1 = 0) -> null.
export function variance(nums = [], population = true) {
  const n = nums.length;
  if (!n) return null;
  const m = mean(nums);
  let ss = 0;
  for (const x of nums) ss += (x - m) * (x - m);
  const denom = population ? n : n - 1;
  if (denom <= 0) return null;
  return ss / denom;
}

export function stdDev(nums = [], population = true) {
  const v = variance(nums, population);
  return v == null ? null : Math.sqrt(v);
}

// One-shot summary used by the UI. Returns null fields (not NaN) when there is
// no data, so callers can render a clean placeholder.
export function summarize(text = '') {
  const { numbers, invalid } = parseNumbers(text);
  const count = numbers.length;
  if (!count) {
    return {
      count: 0, invalid,
      sum: null, mean: null, median: null, mode: [],
      min: null, max: null, range: null,
      stdDevPop: null, stdDevSample: null
    };
  }
  return {
    count,
    invalid,
    sum: sum(numbers),
    mean: mean(numbers),
    median: median(numbers),
    mode: mode(numbers),
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    range: range(numbers),
    stdDevPop: stdDev(numbers, true),
    stdDevSample: stdDev(numbers, false)
  };
}
