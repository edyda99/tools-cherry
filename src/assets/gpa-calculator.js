// gpa-calculator.js — client-side GPA calculator UI on the standard US 4.0
// scale. Pure math (no network): everything runs in the browser.
import { gpaWeighted, GRADES, GRADE_POINTS } from '/assets/gpa.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const COURSE_TYPES = [
  { value: 'regular', label: 'Regular' },
  { value: 'honors', label: 'Honors (+0.5)' },
  { value: 'ap', label: 'AP/IB (+1.0)' }
];

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Options for the grade <select>, e.g. "A (4.0)". Default selection passed in.
function gradeOptions(selected) {
  return GRADES.map((g) => {
    const pts = GRADE_POINTS[g].toFixed(1);
    const sel = g === selected ? ' selected' : '';
    return `<option value="${g}"${sel}>${g} (${pts})</option>`;
  }).join('');
}

// --- course rows -------------------------------------------------------------
function typeOptions(selected) {
  return COURSE_TYPES.map((t) =>
    `<option value="${t.value}"${t.value === selected ? ' selected' : ''}>${t.label}</option>`).join('');
}

function courseRow(name = '', grade = 'A', credits = '3', type = 'regular') {
  const row = document.createElement('div');
  row.className = 'gpa-row';
  row.innerHTML =
    `<input class="cn" placeholder="Course (optional)" aria-label="Course name" value="${esc(name)}">` +
    `<select class="cg" aria-label="Letter grade">${gradeOptions(grade)}</select>` +
    `<select class="ct" aria-label="Course type">${typeOptions(type)}</select>` +
    `<input class="cc" type="number" min="0" step="any" inputmode="decimal" aria-label="Credit hours" value="${esc(credits)}">` +
    `<button type="button" class="rm" title="Remove course" aria-label="Remove course">×</button>`;
  row.querySelector('.rm').addEventListener('click', () => { row.remove(); render(); });
  row.querySelector('.cg').addEventListener('input', render);
  row.querySelector('.ct').addEventListener('input', render);
  row.querySelector('.cc').addEventListener('input', render);
  return row;
}

function readCourses() {
  return [...document.querySelectorAll('#courses .gpa-row')].map((row) => {
    const grade = row.querySelector('.cg').value;
    const credits = row.querySelector('.cc').value;
    const type = row.querySelector('.ct').value;
    return { gradePoints: GRADE_POINTS[grade], credits, type };
  });
}

// --- live results ------------------------------------------------------------
function render() {
  const courses = readCourses();
  const r = gpaWeighted(courses);
  const hasWeight = courses.some((c) => c.type && c.type !== 'regular');
  if (r.totalCredits > 0) {
    $('gpaBig').textContent = r.unweighted.toFixed(2);
    $('gpaSub').textContent = 'Unweighted GPA · 4.0 scale';
    $('weightedGpa').textContent = r.weighted.toFixed(2);
  } else {
    $('gpaBig').textContent = '—';
    $('gpaSub').textContent = 'Add at least one course with credit hours.';
    $('weightedGpa').textContent = '—';
  }
  $('totalCredits').textContent = r.totalCredits ? String(+r.totalCredits.toFixed(2)) : '0';
  $('qualityPoints').textContent = r.totalCredits ? String(+r.qualityPoints.toFixed(2)) : '0';
  $('weightedNote').hidden = !(r.totalCredits > 0 && hasWeight);
}

// --- init --------------------------------------------------------------------
function init() {
  const courses = $('courses');
  courses.innerHTML =
    '<div class="gpa-head"><span>Course</span><span>Grade</span><span>Type</span><span>Credits</span><span></span></div>';
  courses.appendChild(courseRow('', 'A', '3', 'regular'));
  courses.appendChild(courseRow('', 'B+', '3', 'honors'));
  courses.appendChild(courseRow('', 'A-', '4', 'ap'));
  courses.appendChild(courseRow('', 'B', '3', 'regular'));

  $('addCourse').addEventListener('click', () => { courses.appendChild(courseRow()); render(); });
  render();
}

function __bootInit() {
  try {
    init();
  } catch (err) {
    showCalculatorLoadError(err);
  }
}
if (document.readyState !== 'loading') __bootInit();
else document.addEventListener('DOMContentLoaded', __bootInit);
