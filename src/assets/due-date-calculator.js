// due-date-calculator.js — pregnancy due-date calculator UI. Pure date math via
// the shared due-date module (Naegele's rule / conception date). No deps,
// nothing uploaded — everything runs in the browser, local time zone.
import { startOfDay } from '/assets/date-math.js';
import { pregnancySummary, gestationalAge, addDays } from '/assets/due-date.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const nf = (n) => n.toLocaleString('en-US');

function fmtDate(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function fmtShort(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Parse a yyyy-mm-dd value into a local-midnight Date, or null if incomplete.
function parseInput(v) {
  if (!v) return null;
  const [y, mo, d] = v.split('-').map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}

function unit(n, word) {
  return `${nf(n)} ${word}${n === 1 ? '' : 's'}`;
}

// "12w 3d" style gestational-age label.
function ageLabel(age) {
  if (age.totalDays < 0) return 'not started yet';
  return `${age.weeks}w ${age.days}d`;
}

function showResults(on) {
  $('ddResults').hidden = !on;
  $('ddPlaceholder').hidden = on;
}

const ORDINAL = { 1: 'First', 2: 'Second', 3: 'Third' };

function render() {
  const method = document.querySelector('input[name="method"]:checked').value;
  const date = parseInput($('refDate').value);
  const cycleLength = Number($('cycle').value) || 28;

  const msg = $('ddMsg');
  msg.textContent = '';
  msg.hidden = true;

  if (!date) {
    showResults(false);
    return;
  }

  const today = startOfDay(new Date());

  let summary;
  try {
    summary = pregnancySummary({ method, date, cycleLength, today });
  } catch (e) {
    showResults(false);
    msg.hidden = false;
    msg.textContent = e.message;
    return;
  }

  showResults(true);

  // Headline: the estimated due date.
  $('ddBig').textContent = fmtDate(summary.edd);

  const age = summary.gestationalAge;
  if (age.totalDays < 0) {
    $('ddSub').textContent =
      `Based on a ${method === 'conception' ? 'conception' : 'last-period'} date in the future — the figures below assume that date.`;
  } else if (summary.daysToGo >= 0) {
    $('ddSub').textContent =
      `You are about ${ageLabel(age)} along today — roughly ${unit(summary.daysToGo, 'day')} to go.`;
  } else {
    $('ddSub').textContent =
      `That estimated due date has passed (${unit(Math.abs(summary.daysToGo), 'day')} ago).`;
  }

  // Detail rows.
  $('ddGest').textContent = age.totalDays < 0 ? '—' : ageLabel(age);
  $('ddTrimester').textContent =
    summary.trimester && age.totalDays >= 0 ? `${ORDINAL[summary.trimester]} trimester` : '—';
  $('ddConception').textContent = fmtShort(summary.conceptionApprox);
  $('ddLmp').textContent = fmtShort(summary.lmp);

  // Milestones table: end of each trimester + the EDD, with the date for each.
  // Trimester ends at completed weeks 13, 27 and 40 (delivery) on the clinical
  // clock measured from the LMP.
  const milestones = [
    ['End of first trimester (13 weeks)', addDays(summary.lmp, 13 * 7)],
    ['End of second trimester (27 weeks)', addDays(summary.lmp, 27 * 7)],
    ['Full term begins (37 weeks)', addDays(summary.lmp, 37 * 7)],
    ['Estimated due date (40 weeks)', summary.edd]
  ];
  $('ddMilestones').innerHTML = milestones
    .map(([label, d]) => {
      const a = gestationalAge(summary.lmp, today);
      const reached = today.getTime() >= startOfDay(d).getTime();
      const tag = reached && a.totalDays >= 0 ? ' <span class="muted-small">(passed)</span>' : '';
      return `<tr><td>${label}</td><td>${fmtShort(d)}${tag}</td></tr>`;
    })
    .join('');
}

// Show the cycle-length field only for the LMP method (it has no meaning for a
// known conception date).
function syncCycleVisibility() {
  const method = document.querySelector('input[name="method"]:checked').value;
  $('cycleField').hidden = method !== 'lmp';
  const label = $('refLabel');
  label.textContent =
    method === 'conception' ? 'Conception / ovulation date' : 'First day of your last period';
}

function init() {
  const today = startOfDay(new Date());
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  $('refDate').value = todayStr;

  for (const el of document.querySelectorAll('input[name="method"]')) {
    el.addEventListener('change', () => { syncCycleVisibility(); render(); });
  }
  $('refDate').addEventListener('input', render);
  $('cycle').addEventListener('input', render);

  syncCycleVisibility();
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
