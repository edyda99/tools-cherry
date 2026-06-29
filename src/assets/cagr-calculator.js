// cagr-calculator.js — Compound Annual Growth Rate, live results.
// Pure math via the shared cagr engine. No deps, nothing uploaded.
import { project } from '/assets/cagr.js';

const $ = (id) => document.getElementById(id);

function money(n, max = 2) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: max });
}
function pct(frac, dp = 2) {
  if (!Number.isFinite(frac)) return '';
  return (frac * 100).toLocaleString('en-US', { maximumFractionDigits: dp }) + '%';
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

function show(lineId, label, value) {
  const line = $(lineId);
  if (!line) return;
  line.hidden = false;
  const lbl = line.querySelector('.lbl');
  const v = line.querySelector('.val');
  if (lbl) lbl.textContent = label;
  if (v) v.textContent = value;
}

function reset() {
  $('cagrBig').textContent = '—';
  $('cagrSub').textContent = '';
  ['growthLine', 'beginLine', 'endLine', 'yearsLine', 'summaryBox', 'scheduleWrap'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = true;
  });
}

function buildSchedule(schedule) {
  const tbody = $('scheduleBody');
  let rows = '';
  for (const row of schedule) {
    const yearLabel = Number.isInteger(row.year) ? row.year : fmt(row.year);
    rows += `<tr><td>${yearLabel}</td><td>${money(row.value)}</td></tr>`;
  }
  tbody.innerHTML = rows;
}

// The user picks ONE way to set the time span via the toggle, so only the
// active mode's inputs are read — never both at once.
function activeMode() {
  const checked = document.querySelector('input[name="timeMode"]:checked');
  return checked ? checked.value : 'years';
}

function resolveYears() {
  if (activeMode() === 'range') {
    const startY = val('startYear');
    const endY = val('endYear');
    if (Number.isFinite(startY) && Number.isFinite(endY) && endY > startY) {
      return endY - startY;
    }
    return NaN;
  }
  const direct = val('years');
  if (Number.isFinite(direct) && direct > 0) return direct;
  return NaN;
}

function calc() {
  reset();

  const beginning = val('beginning');
  const ending = val('ending');
  const years = resolveYears();

  if (!Number.isFinite(beginning) || beginning <= 0) {
    $('cagrSub').textContent = 'Enter a beginning value to start.';
    return;
  }
  if (!Number.isFinite(ending) || ending < 0) {
    $('cagrSub').textContent = 'Enter an ending value to start.';
    return;
  }
  if (!Number.isFinite(years) || years <= 0) {
    $('cagrSub').textContent = activeMode() === 'range'
      ? 'Enter a start year and a later end year.'
      : 'Enter the number of years.';
    return;
  }

  const r = project(beginning, ending, years);
  if (!Number.isFinite(r.cagr)) return;

  $('cagrBig').textContent = pct(r.cagr);
  $('cagrSub').textContent = `Compound annual growth rate over ${fmt(years)} year${years === 1 ? '' : 's'}`;

  show('growthLine', 'Total growth over the period', pct(r.totalGrowth));
  show('beginLine', 'Beginning value', money(r.beginning));
  show('endLine', 'Ending value', money(r.ending));
  show('yearsLine', 'Number of years', fmt(years));
  $('yearsLine').classList.add('total');

  const dir = r.totalGrowth >= 0 ? 'grew' : 'fell';
  $('summaryText').textContent =
    `Going from ${money(r.beginning)} to ${money(r.ending)} over ${fmt(years)} year${years === 1 ? '' : 's'} ` +
    `is a compound annual growth rate of ${pct(r.cagr)} a year. ` +
    `Over the whole period the value ${dir} ${pct(Math.abs(r.totalGrowth))}.`;
  $('summaryBox').hidden = false;

  buildSchedule(r.schedule);
  $('scheduleWrap').hidden = false;
}

function syncMode() {
  const range = activeMode() === 'range';
  $('yearsMode').hidden = range;
  $('rangeMode').hidden = !range;
}

function init() {
  document.querySelectorAll('#cagrForm input[type="number"]').forEach((el) =>
    el.addEventListener('input', calc)
  );
  document.querySelectorAll('input[name="timeMode"]').forEach((el) =>
    el.addEventListener('change', () => { syncMode(); calc(); })
  );
  syncMode();
  calc();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
