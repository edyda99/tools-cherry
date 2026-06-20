// test-gpa.js — unit tests for the pure gpa module. Run via `npm test`.
import assert from 'node:assert/strict';
import { gpa, gpaWeighted, pointsForGrade, GRADE_POINTS, WEIGHT_BUMP } from '../src/engine/gpa.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('grade point map: standard values', () => {
  assert.equal(GRADE_POINTS['A+'], 4.0);
  assert.equal(GRADE_POINTS.A, 4.0);
  assert.equal(GRADE_POINTS['A-'], 3.7);
  assert.equal(GRADE_POINTS['B+'], 3.3);
  assert.equal(GRADE_POINTS.B, 3.0);
  assert.equal(GRADE_POINTS['C-'], 1.7);
  assert.equal(GRADE_POINTS.F, 0.0);
});

t('A (4.0)/3cr + B (3.0)/3cr → GPA 3.50', () => {
  const r = gpa([
    { gradePoints: 4.0, credits: 3 },
    { gradePoints: 3.0, credits: 3 }
  ]);
  approx(r.gpa, 3.5);
  assert.equal(r.totalCredits, 6);
  approx(r.qualityPoints, 21);
});

t('weighted by differing credits', () => {
  // A (4.0) × 4cr = 16, C (2.0) × 1cr = 2 → 18 / 5 = 3.6
  const r = gpa([
    { gradePoints: 4.0, credits: 4 },
    { gradePoints: 2.0, credits: 1 }
  ]);
  approx(r.gpa, 3.6);
  assert.equal(r.totalCredits, 5);
  approx(r.qualityPoints, 18);
});

t('empty list → GPA 0, 0 credits', () => {
  const r = gpa([]);
  assert.equal(r.gpa, 0);
  assert.equal(r.totalCredits, 0);
  assert.equal(r.qualityPoints, 0);
});

t('rows with 0/blank/invalid credits are ignored', () => {
  const r = gpa([
    { gradePoints: 4.0, credits: 3 },
    { gradePoints: 3.0, credits: 0 },
    { gradePoints: 3.7, credits: '' },
    { gradePoints: 2.0, credits: 'abc' },
    { gradePoints: 1.0, credits: -2 }
  ]);
  // only the first row counts: 4.0 × 3 / 3 = 4.0
  approx(r.gpa, 4.0);
  assert.equal(r.totalCredits, 3);
});

t('string credits parse like numbers', () => {
  const r = gpa([
    { gradePoints: 4.0, credits: '3' },
    { gradePoints: 3.0, credits: '3' }
  ]);
  approx(r.gpa, 3.5);
  assert.equal(r.totalCredits, 6);
});

t('all F → GPA 0 but credits still count', () => {
  const r = gpa([
    { gradePoints: 0.0, credits: 3 },
    { gradePoints: 0.0, credits: 4 }
  ]);
  assert.equal(r.gpa, 0);
  assert.equal(r.totalCredits, 7);
});

t('pointsForGrade: known + unknown', () => {
  assert.equal(pointsForGrade('A'), 4.0);
  assert.equal(pointsForGrade('b-'), 2.7);
  assert.equal(pointsForGrade(' a+ '), 4.0);
  assert.ok(Number.isNaN(pointsForGrade('Z')));
  assert.ok(Number.isNaN(pointsForGrade('')));
});

t('fractional credits (e.g. 1.5) weight correctly', () => {
  // A (4.0) × 1.5 = 6, B (3.0) × 1.5 = 4.5 → 10.5 / 3 = 3.5
  const r = gpa([
    { gradePoints: 4.0, credits: 1.5 },
    { gradePoints: 3.0, credits: 1.5 }
  ]);
  approx(r.gpa, 3.5);
  approx(r.totalCredits, 3);
});

// --- weighted GPA ------------------------------------------------------------
t('gpaWeighted: all regular -> weighted equals unweighted', () => {
  const courses = [{ gradePoints: 4.0, credits: 3, type: 'regular' }, { gradePoints: 3.0, credits: 3, type: 'regular' }];
  const r = gpaWeighted(courses);
  approx(r.unweighted, 3.5);
  approx(r.weighted, 3.5);
  approx(r.totalCredits, 6);
});

t('gpaWeighted: AP "A" reaches 5.0, Honors "A" 4.5', () => {
  approx(gpaWeighted([{ gradePoints: 4.0, credits: 3, type: 'ap' }]).weighted, 5.0);
  approx(gpaWeighted([{ gradePoints: 4.0, credits: 3, type: 'honors' }]).weighted, 4.5);
});

t('gpaWeighted: mixed types credit-weighted correctly', () => {
  // A regular(4.0,3cr) + B+ honors(3.3+0.5=3.8,3cr) + A- AP(3.7+1.0=4.7,4cr)
  // unweighted qp = 4*3 + 3.3*3 + 3.7*4 = 12 + 9.9 + 14.8 = 36.7 over 10cr = 3.67
  // weighted   qp = 4*3 + 3.8*3 + 4.7*4 = 12 + 11.4 + 18.8 = 42.2 over 10cr = 4.22
  const r = gpaWeighted([
    { gradePoints: 4.0, credits: 3, type: 'regular' },
    { gradePoints: 3.3, credits: 3, type: 'honors' },
    { gradePoints: 3.7, credits: 4, type: 'ap' }
  ]);
  approx(r.unweighted, 3.67, 0.005);
  approx(r.weighted, 4.22, 0.005);
  approx(r.totalCredits, 10);
});

t('gpaWeighted: unknown/missing type treated as regular', () => {
  const r = gpaWeighted([{ gradePoints: 4.0, credits: 3 }]);
  approx(r.weighted, 4.0);
  assert.equal(WEIGHT_BUMP.regular, 0);
});

console.log(`\n${pass} passing`);
