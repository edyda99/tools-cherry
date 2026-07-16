// 401k-calculator.js — 401(k) retirement projection, live results.
// Pure math via the shared retirement-401k engine. No deps, nothing uploaded.
import { project } from '/assets/retirement-401k.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

function money(n, max = 0) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: max
  });
}

function fmt(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Required field: blank/whitespace -> NaN ("not set yet").
function val(id) {
  const raw = $(id).value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}
// Optional field: blank -> 0, negatives ignored.
function optVal(id) {
  const raw = $(id).value.trim();
  if (raw === '') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function reset() {
  $('fvBig').textContent = '—';
  $('fvSub').textContent = '';
  ['startingLine', 'employeeLine', 'employerLine', 'growthLine', 'summaryBox', 'scheduleWrap'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = true;
  });
}

function show(lineId, label, value) {
  const line = $(lineId);
  if (!line) return;
  line.hidden = false;
  const lbl = line.querySelector('.lbl');
  const v = line.querySelector('.val');
  if (lbl) lbl.textContent = label;
  if (v) v.textContent = value;
}

function buildSchedule(schedule) {
  const tbody = $('scheduleBody');
  let rows = '';
  // Every interpolated value is a number formatted by money() — never raw user
  // input — so the markup stays injection-safe.
  for (const row of schedule) {
    rows += `<tr><td>${row.age}</td><td>${money(row.employeeContribution)}</td>` +
      `<td>${money(row.employerMatch)}</td><td>${money(row.growth)}</td>` +
      `<td>${money(row.balanceEnd)}</td></tr>`;
  }
  tbody.innerHTML = rows;
}

function calc() {
  reset();

  const currentAge = val('currentAge');
  const retirementAge = val('retirementAge');
  const currentBalance = optVal('currentBalance');
  const annualSalary = val('annualSalary');
  const employeeContribPct = val('employeeContrib');
  const employerMatchPct = optVal('employerMatch');
  const matchCapPct = optVal('matchCap');
  const annualReturnPct = val('annualReturn');
  const salaryGrowthPct = optVal('salaryGrowth');

  if (!Number.isFinite(currentAge) || !Number.isFinite(retirementAge) || retirementAge <= currentAge) {
    $('fvSub').textContent = 'Enter your current age and a later retirement age.';
    return;
  }
  if (!Number.isFinite(annualSalary) || annualSalary <= 0) {
    $('fvSub').textContent = 'Enter your annual salary to start.';
    return;
  }
  if (!Number.isFinite(employeeContribPct) || employeeContribPct < 0) {
    $('fvSub').textContent = 'Enter your contribution percentage to start.';
    return;
  }
  if (!Number.isFinite(annualReturnPct) || annualReturnPct < 0) {
    $('fvSub').textContent = 'Enter an expected annual return to start.';
    return;
  }

  const r = project(
    currentAge, retirementAge, currentBalance, annualSalary,
    employeeContribPct, employerMatchPct, matchCapPct, annualReturnPct,
    { salaryGrowthPct }
  );
  if (!Number.isFinite(r.projectedBalance)) return;

  const years = Math.round(retirementAge - currentAge);

  $('fvBig').textContent = money(r.projectedBalance);
  $('fvSub').textContent = `Projected balance at age ${fmt(retirementAge)}`;

  show('startingLine', 'Starting balance', money(currentBalance));
  show('employeeLine', 'Your contributions', money(r.totalEmployeeContributions));
  show('employerLine', 'Employer match', money(r.totalEmployerMatch));
  show('growthLine', 'Investment growth', money(r.totalGrowth));
  $('growthLine').classList.add('total');

  const matchPart = r.totalEmployerMatch > 0
    ? ` Your employer adds ${money(r.totalEmployerMatch)} in matching contributions.`
    : '';
  $('summaryText').textContent =
    `Saving ${fmt(employeeContribPct)}% of a ${money(annualSalary)} salary from age ` +
    `${fmt(currentAge)} to ${fmt(retirementAge)} at a ${fmt(annualReturnPct)}% annual return, ` +
    `your 401(k) grows to about ${money(r.projectedBalance)} over ${years} year` +
    `${years === 1 ? '' : 's'}.${matchPart} Of that, ${money(r.totalEmployeeContributions)} comes ` +
    `from your own contributions and ${money(r.totalGrowth)} is investment growth on top.`;
  $('summaryBox').hidden = false;

  buildSchedule(r.schedule);
  $('scheduleWrap').hidden = false;
}

function init() {
  document.querySelectorAll('#retire401kForm input, #retire401kForm select').forEach((el) =>
    el.addEventListener('input', calc)
  );
  calc();
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
