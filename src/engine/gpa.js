// gpa.js — pure, dependency-free GPA (Grade Point Average) calculations on the
// standard US 4.0 scale. Shared by the browser tool (gpa-calculator.js) and the
// unit tests. No DOM, no I/O.
//
// Standard 4.0 letter-grade point values:
//   A+ / A = 4.0, A- = 3.7, B+ = 3.3, B = 3.0, B- = 2.7,
//   C+ = 2.3, C = 2.0, C- = 1.7, D+ = 1.3, D = 1.0, D- = 0.7, F = 0.0

export const GRADE_POINTS = {
  'A+': 4.0,
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  'D-': 0.7,
  F: 0.0
};

// Ordered list of grades, useful for building dropdowns in the UI.
export const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Weighted GPA on the 4.0 scale.
//   courses: [{ gradePoints, credits }, ...]
// A course is counted only when its credits parse to a positive number; rows
// with 0, blank, or invalid credits are ignored (matches "empty rows" UX).
// Returns:
//   { gpa, totalCredits, qualityPoints }
//   gpa = qualityPoints / totalCredits, or 0 when no countable credits exist.
export function gpa(courses = []) {
  let totalCredits = 0;
  let qualityPoints = 0;

  for (const c of courses) {
    if (!c) continue;
    const credits = num(c.credits);
    const points = num(c.gradePoints);
    if (Number.isNaN(credits) || credits <= 0 || Number.isNaN(points)) continue;
    totalCredits += credits;
    qualityPoints += points * credits;
  }

  const value = totalCredits > 0 ? qualityPoints / totalCredits : 0;
  return { gpa: value, totalCredits, qualityPoints };
}

// Typical weighted-GPA bumps by course difficulty. Widely-used convention
// (Honors +0.5, AP/IB +1.0) — schools vary, so the UI labels them "typical".
// An AP "A" reaches 5.0; an Honors "A" reaches 4.5.
export const WEIGHT_BUMP = { regular: 0, honors: 0.5, ap: 1.0 };

// Weighted + unweighted GPA in one pass.
//   courses: [{ gradePoints, credits, type }] where type is 'regular'|'honors'|'ap'
// Unweighted ignores `type`; weighted adds the difficulty bump to each course's
// points before credit-weighting. Same row-filtering rules as gpa().
// Returns { totalCredits, unweighted, weighted, qualityPoints }.
export function gpaWeighted(courses = []) {
  let totalCredits = 0;
  let qpUnweighted = 0;
  let qpWeighted = 0;

  for (const c of courses) {
    if (!c) continue;
    const credits = num(c.credits);
    const points = num(c.gradePoints);
    if (Number.isNaN(credits) || credits <= 0 || Number.isNaN(points)) continue;
    const bump = WEIGHT_BUMP[c.type] != null ? WEIGHT_BUMP[c.type] : 0;
    totalCredits += credits;
    qpUnweighted += points * credits;
    qpWeighted += (points + bump) * credits;
  }

  return {
    totalCredits,
    unweighted: totalCredits > 0 ? qpUnweighted / totalCredits : 0,
    weighted: totalCredits > 0 ? qpWeighted / totalCredits : 0,
    qualityPoints: qpUnweighted
  };
}

// Convenience: map a letter grade to its 4.0-scale points, or NaN if unknown.
export function pointsForGrade(letter) {
  const key = String(letter == null ? '' : letter).trim().toUpperCase();
  return key in GRADE_POINTS ? GRADE_POINTS[key] : NaN;
}
