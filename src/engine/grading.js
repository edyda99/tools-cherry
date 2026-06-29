// grading.js — pure, dependency-free test-score / EZ-grader math.
// Shared by the browser tool (ez-grader.js) and the unit tests.
// No deps, nothing uploaded.
//
// The score for a test is the share of questions (or points) answered
// correctly, expressed as a percentage:
//     score% = (total - wrong) / total * 100
// A letter grade is then read off a grading scale. Two scales are built in:
//   'simple'      — A>=90, B>=80, C>=70, D>=60, else F  (the default)
//   'plusminus'   — the common 4.0 plus/minus bands (A+, A, A-, B+, ... F)
//
// Percentages are returned already rounded to 1 decimal place (the figure a
// teacher actually writes down). The wrong count is clamped to [0, total] so a
// stray value never produces a nonsensical score. Invalid input (total <= 0,
// non-numbers) yields NaN-filled results so the UI can stay quiet.

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Round to a fixed number of decimal places, avoiding the usual float drift
// (e.g. 1.005 -> 1.0 instead of 1.01). Returns NaN for non-finite input.
export function round(value, dp = 1) {
  const n = num(value);
  if (!Number.isFinite(n)) return NaN;
  const f = Math.pow(10, dp);
  return Math.round((n + Number.EPSILON) * f) / f;
}

// Letter-grade bands, highest threshold first. `min` is the inclusive lower
// bound (in percent) for that letter. The first band whose threshold the score
// meets wins; the final band is the catch-all (F at 0).
export const SCALES = {
  simple: [
    { letter: 'A', min: 90 },
    { letter: 'B', min: 80 },
    { letter: 'C', min: 70 },
    { letter: 'D', min: 60 },
    { letter: 'F', min: 0 },
  ],
  plusminus: [
    { letter: 'A+', min: 97 },
    { letter: 'A', min: 93 },
    { letter: 'A-', min: 90 },
    { letter: 'B+', min: 87 },
    { letter: 'B', min: 83 },
    { letter: 'B-', min: 80 },
    { letter: 'C+', min: 77 },
    { letter: 'C', min: 73 },
    { letter: 'C-', min: 70 },
    { letter: 'D+', min: 67 },
    { letter: 'D', min: 63 },
    { letter: 'D-', min: 60 },
    { letter: 'F', min: 0 },
  ],
};

// Letter grade for a percentage score on the named scale. Returns '' for
// non-finite scores so the UI never prints "undefined".
export function letterGrade(scorePercent, scale = 'simple') {
  const s = num(scorePercent);
  if (!Number.isFinite(s)) return '';
  const bands = SCALES[scale] || SCALES.simple;
  for (const band of bands) {
    if (s >= band.min) return band.letter;
  }
  return bands[bands.length - 1].letter;
}

// Clamp the wrong count into the valid range [0, total]. Non-finite -> 0.
export function clampWrong(wrong, total) {
  const w = num(wrong);
  const t = num(total);
  if (!Number.isFinite(t) || t <= 0) return NaN;
  if (!Number.isFinite(w)) return 0;
  if (w < 0) return 0;
  if (w > t) return t;
  return w;
}

// Score one result. `total` is the number of questions or points on the test;
// `wrong` is how many were missed (clamped to [0, total]). Returns:
//   { total, wrong, correct, scorePercent, letter, scale }
// scorePercent is a PERCENT (0-100) already rounded to 1 dp.
// Invalid input (total <= 0) yields a NaN-filled result with an empty letter.
export function grade(total, wrong, scale = 'simple') {
  const t = num(total);
  const bad = {
    total: NaN, wrong: NaN, correct: NaN,
    scorePercent: NaN, letter: '', scale,
  };
  if (!Number.isFinite(t) || t <= 0) return bad;

  const w = clampWrong(wrong, t);
  const correct = t - w;
  const scorePercent = round((correct / t) * 100, 1);
  return {
    total: t,
    wrong: w,
    correct,
    scorePercent,
    letter: letterGrade(scorePercent, scale),
    scale,
  };
}

// Full printable chart: one row for every wrong count from 0 up to `total`.
// Each row is { wrong, correct, scorePercent, letter }. `total` is rounded down
// to a whole number of rows (you can't get half a question wrong on the chart),
// but fractional totals are still scored against the exact total. Returns [] for
// invalid input.
export function chart(total, scale = 'simple') {
  const t = num(total);
  if (!Number.isFinite(t) || t <= 0) return [];
  const rows = [];
  const maxWrong = Math.floor(t);
  for (let w = 0; w <= maxWrong; w++) {
    const correct = t - w;
    const scorePercent = round((correct / t) * 100, 1);
    rows.push({ wrong: w, correct, scorePercent, letter: letterGrade(scorePercent, scale) });
  }
  return rows;
}
