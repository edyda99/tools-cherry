// hours-calculator.js — time-card / hours-worked calculator, live results.
// Pure math via the shared timecard module. No deps, nothing uploaded.
import {
  shiftMinutes,
  totalMinutes,
  minutesToDecimal,
  minutesToHhmm,
  formatDecimal,
  grossPay,
  overtimeSplit,
  grossPayOvertime
} from '/assets/timecard.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

function money(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
}

// --- day rows ----------------------------------------------------------------
// Default labels for a Mon–Sun week; extra rows beyond 7 get a generic label.
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function dayRow(label = '', start = '', end = '', brk = '') {
  const row = document.createElement('div');
  row.className = 'tc-row';
  row.innerHTML =
    `<input class="lbl-in" placeholder="Day" aria-label="Day label" value="${label}">` +
    `<input class="start" type="time" aria-label="Start time" value="${start}">` +
    `<input class="end" type="time" aria-label="End time" value="${end}">` +
    `<input class="brk" type="number" min="0" step="any" inputmode="numeric" placeholder="0" aria-label="Unpaid break minutes" value="${brk}">` +
    `<span class="out" aria-live="polite">—</span>` +
    `<button type="button" class="rm" title="Remove row" aria-label="Remove day">×</button>`;
  row.querySelector('.rm').addEventListener('click', () => { row.remove(); render(); });
  row.querySelectorAll('input').forEach((el) => el.addEventListener('input', render));
  return row;
}

function nextDayLabel() {
  const n = document.querySelectorAll('#rows .tc-row').length;
  return DAY_LABELS[n] || `Day ${n + 1}`;
}

function readRows() {
  return [...document.querySelectorAll('#rows .tc-row')].map((row) => ({
    el: row,
    start: row.querySelector('.start').value,
    end: row.querySelector('.end').value,
    breakMin: row.querySelector('.brk').value
  }));
}

// --- live render -------------------------------------------------------------
function render() {
  const rows = readRows();

  // Per-row output: decimal + h:mm, or a dash / "—" while incomplete.
  rows.forEach((r) => {
    const out = r.el.querySelector('.out');
    if (!r.start || !r.end) { out.textContent = '—'; return; }
    const m = shiftMinutes(r.start, r.end, r.breakMin);
    if (!Number.isFinite(m)) { out.textContent = '—'; return; }
    out.textContent = `${formatDecimal(minutesToDecimal(m))} h  (${minutesToHhmm(m)})`;
  });

  const totMin = totalMinutes(rows.map((r) => ({ start: r.start, end: r.end, breakMin: r.breakMin })));
  const totHours = minutesToDecimal(totMin);

  $('totalDecimal').textContent = formatDecimal(totHours) + ' hours';
  $('totalHhmm').textContent = minutesToHhmm(totMin);

  // Overtime split (hours) — shown whenever the toggle is on, even before a rate.
  const otOn = $('otOn').checked;
  const otThreshold = parseFloat($('otThreshold').value) || 40;
  const otMult = parseFloat($('otMult').value) || 1.5;
  const split = otOn ? overtimeSplit(totHours, otThreshold) : { regular: totHours, overtime: 0 };
  const showOT = otOn && split.overtime > 0;
  $('otFields').hidden = !otOn;
  $('regLine').hidden = !showOT;
  $('otLine').hidden = !showOT;
  if (showOT) {
    $('regHours').textContent = formatDecimal(split.regular) + ' h';
    $('otHours').textContent = formatDecimal(split.overtime) + ' h';
  }

  // Optional gross pay (with OT breakdown when overtime applies).
  const rateRaw = $('rate').value.trim();
  const payLine = $('payLine');
  const hidePay = () => {
    payLine.hidden = true; $('regPayLine').hidden = true; $('otPayLine').hidden = true;
  };
  if (rateRaw === '' || !Number.isFinite(parseFloat(rateRaw))) {
    hidePay();
  } else if (otOn) {
    const pay = grossPayOvertime(totHours, rateRaw, { thresholdHours: otThreshold, multiplier: otMult });
    payLine.hidden = false;
    $('grossPay').textContent = money(pay.total);
    $('regPayLine').hidden = !showOT;
    $('otPayLine').hidden = !showOT;
    if (showOT) { $('regPay').textContent = money(pay.regularPay); $('otPay').textContent = money(pay.overtimePay); }
  } else {
    const gross = grossPay(totHours, rateRaw);
    payLine.hidden = !Number.isFinite(gross);
    $('regPayLine').hidden = true; $('otPayLine').hidden = true;
    if (Number.isFinite(gross)) $('grossPay').textContent = money(gross);
  }
}

// --- init --------------------------------------------------------------------
function init() {
  const rows = $('rows');
  // Seed a Mon–Fri work week with a sensible 9–5 example on the first day.
  rows.appendChild(dayRow('Monday', '09:00', '17:00', '30'));
  rows.appendChild(dayRow('Tuesday', '09:00', '17:00', '30'));
  rows.appendChild(dayRow('Wednesday'));
  rows.appendChild(dayRow('Thursday'));
  rows.appendChild(dayRow('Friday'));

  $('addRow').addEventListener('click', () => {
    rows.appendChild(dayRow(nextDayLabel()));
    render();
  });
  $('rate').addEventListener('input', render);
  $('otOn').addEventListener('change', render);
  $('otThreshold').addEventListener('input', render);
  $('otMult').addEventListener('input', render);
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
