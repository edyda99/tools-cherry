// half-birthday-calculator.js — your half birthday (six months from your
// birthday), the weekday it lands on, and a countdown to the next one. Pure date
// math via the shared half-birthday engine. No deps, nothing uploaded — all in
// the browser, local time zone.
import {
  halfBirthday,
  midpointHalfBirthday,
  daysUntilNextHalfBirthday,
  weekdayIndex
} from '/assets/half-birthday.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

const pad = (n) => String(n).padStart(2, '0');
const nf = (n) => n.toLocaleString('en-US');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Month + day only (recurring date — no year), e.g. "14 September".
function fmtMonthDay(month, day) {
  if (!month || !day) return '';
  return `${day} ${MONTHS[month - 1]}`;
}

// Full date with weekday, e.g. "Monday, 14 September 2026".
function fmtFull(parts) {
  if (!parts) return '';
  const d = new Date(parts.y, parts.m - 1, parts.d, 0, 0, 0, 0);
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

// "1 day", "2 days" — singular/plural helper.
function unit(n, word) {
  return `${nf(n)} ${word}${n === 1 ? '' : 's'}`;
}

// Parse a yyyy-mm-dd value into {y, m, d} parts, or null if incomplete.
function parseInput(v) {
  if (!v) return null;
  const [y, mo, d] = v.split('-').map(Number);
  if (!y || !mo || !d) return null;
  return { y, m: mo, d };
}

function showResults(on) {
  $('hbResults').hidden = !on;
  $('hbPlaceholder').hidden = on;
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

function render() {
  const birth = parseInput($('birthDate').value);

  const msg = $('hbMsg');
  msg.textContent = '';
  msg.hidden = true;

  if (!birth) {
    showResults(false);
    return;
  }

  // The calendar half-birthday is a recurring month/day (year-independent).
  const half = halfBirthday(birth);
  if (!half) {
    showResults(false);
    msg.hidden = false;
    msg.textContent = 'That date doesn’t look right — pick a valid birth date.';
    return;
  }

  // "today" is read HERE in the asset (not in the pure engine) and passed in.
  const now = new Date();
  const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };

  const next = daysUntilNextHalfBirthday(birth, today);
  if (!next) {
    showResults(false);
    return;
  }

  showResults(true);

  // Headline: the recurring half-birthday date (month + day).
  $('hbBig').textContent = fmtMonthDay(half.month, half.day);

  const clampNote = half.clamped
    ? ' (your birth day doesn’t exist six months later, so it’s clamped to the last day of that month)'
    : '';
  $('hbSub').textContent =
    `Your half birthday is six calendar months after your birthday${clampNote}.`;

  // The exact next occurrence, the weekday it lands on, and the countdown.
  const wd = weekdayIndex(next.date);
  show('weekdayLine', 'Day of the week (next one)',
    Number.isInteger(wd) ? WEEKDAYS[wd] : '—');
  show('nextDateLine', 'Next half birthday', fmtFull(next.date));

  if (next.days === 0) {
    show('countdownLine', 'Countdown', 'Today — happy half birthday!');
  } else {
    show('countdownLine', 'Days until the next one', unit(next.days, 'day'));
  }

  // Secondary readout: the literal 182.5-day midpoint, measured from the
  // birthday in the next half-birthday's year so it sits next to the calendar
  // date for comparison.
  const mid = midpointHalfBirthday(birth, next.date.y);
  if (mid) {
    show('midpointLine', '182.5-day midpoint (alternative)', fmtFull(mid));
  }

  // Plain-English summary.
  const summaryWeekday = Number.isInteger(wd) ? WEEKDAYS[wd] : '';
  $('summaryText').textContent =
    `Your half birthday falls on ${fmtMonthDay(half.month, half.day)} each year. ` +
    `The next one is ${fmtFull(next.date)}` +
    (summaryWeekday ? ` — a ${summaryWeekday}` : '') +
    (next.days === 0 ? ' — that’s today!' : `, which is ${unit(next.days, 'day')} away.`);
  $('summaryBox').hidden = false;
}

function init() {
  const birthEl = $('birthDate');
  if (!birthEl) return;

  // Cap the birth-date picker at today.
  const now = new Date();
  birthEl.max = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  birthEl.addEventListener('input', render);
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
