// days-between-dates.js — duration between two dates: total days, a
// years/months/days breakdown, total weeks, and business days (Mon–Fri). Plus a
// small "add/subtract days" helper. Pure date math via the shared date-math
// module. No deps, nothing uploaded — all in the browser, local time zone.
import {
  daysBetween,
  startOfDay,
  ageBreakdown,
  businessDaysBetween
} from '/assets/date-math.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

const pad = (n) => String(n).padStart(2, '0');
const nf = (n) => n.toLocaleString('en-US');

function fmtDate(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

// Parse a yyyy-mm-dd value into a local-midnight Date, or null if incomplete.
function parseInput(v) {
  if (!v) return null;
  const [y, mo, d] = v.split('-').map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}

// "1 day", "2 days" — singular/plural helper.
function unit(n, word) {
  return `${nf(n)} ${word}${n === 1 ? '' : 's'}`;
}

// Plain-English breakdown like "1 year, 2 months and 3 days" (zero parts dropped,
// but always keep at least one).
function phrase(b) {
  const parts = [];
  if (b.years) parts.push(unit(b.years, 'year'));
  if (b.months) parts.push(unit(b.months, 'month'));
  if (b.days || !parts.length) parts.push(unit(b.days, 'day'));
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

function showResults(on) {
  $('durResults').hidden = !on;
  $('durPlaceholder').hidden = on;
}

function render() {
  let start = parseInput($('startDate').value);
  let end = parseInput($('endDate').value);
  const includeEnd = $('includeEnd').checked;

  const msg = $('durMsg');
  msg.textContent = '';
  msg.hidden = true;

  if (!start || !end) {
    showResults(false);
    return;
  }

  start = startOfDay(start);
  end = startOfDay(end);

  // Direction handling: if the end is before the start, we still show the
  // absolute span but note that the dates run backwards.
  const reversed = end.getTime() < start.getTime();
  const lo = reversed ? end : start;
  const hi = reversed ? start : end;

  showResults(true);

  // Total whole days between the two dates. "Include the end date" adds one so a
  // single-day range (e.g. a hotel stay counted inclusively) reads as 1, not 0.
  let totalDays = daysBetween(lo, hi);
  let business = businessDaysBetween(lo, hi);
  if (includeEnd) {
    totalDays += 1;
    // The end day itself counts as a business day only if it's a weekday.
    const endDow = hi.getDay();
    if (endDow !== 0 && endDow !== 6) business += 1;
  }

  const totalWeeks = totalDays / 7;
  const breakdown = ageBreakdown(lo, hi); // years/months/days of the calendar span

  // Headline: the years/months/days breakdown of the calendar span (this does
  // not change with the include-end toggle, which only affects the day count).
  $('durBig').textContent = phrase(breakdown);

  const inc = includeEnd ? ' (end date included)' : '';
  $('durSub').textContent = reversed
    ? `${fmtDate(end)} is before ${fmtDate(start)} — showing the span between them${inc}.`
    : `From ${fmtDate(start)} to ${fmtDate(end)}${inc}.`;

  $('totDays').textContent = nf(totalDays);
  // Weeks: show whole weeks plus leftover days when it isn't an exact multiple.
  const wholeWeeks = Math.trunc(totalWeeks);
  const leftover = totalDays - wholeWeeks * 7;
  $('totWeeks').textContent = leftover
    ? `${nf(wholeWeeks)} (${unit(wholeWeeks, 'week')}, ${unit(leftover, 'day')})`
    : nf(wholeWeeks);
  $('totBiz').textContent = nf(business);

  if (reversed) {
    msg.hidden = false;
    msg.textContent = 'The end date is earlier than the start date, so the dates run backwards. The figures above show the absolute span.';
  }
}

// --- Add / subtract days helper ----------------------------------------------
function renderAdd() {
  const base = parseInput($('addBase').value);
  const rawN = $('addDays').value;
  const out = $('addResult');

  if (!base || rawN === '' || rawN === '-') {
    out.textContent = 'Pick a date and a number of days.';
    return;
  }

  const n = Number(rawN);
  if (!Number.isFinite(n)) {
    out.textContent = 'Enter a whole number of days.';
    return;
  }

  const result = new Date(base.getFullYear(), base.getMonth(), base.getDate() + Math.trunc(n), 0, 0, 0, 0);
  const verb = n < 0 ? 'before' : 'after';
  const absN = Math.abs(Math.trunc(n));
  out.textContent = `${unit(absN, 'day')} ${verb} ${fmtDate(base)} is ${fmtDate(result)}.`;
}

function init() {
  const today = startOfDay(new Date());
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  // Sensible defaults: start = today, end = today + 30 days, so the page shows a
  // live example on first load.
  const end30 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);
  const end30Str = `${end30.getFullYear()}-${pad(end30.getMonth() + 1)}-${pad(end30.getDate())}`;

  $('startDate').value = todayStr;
  $('endDate').value = end30Str;
  $('addBase').value = todayStr;

  for (const id of ['startDate', 'endDate']) $(id).addEventListener('input', render);
  $('includeEnd').addEventListener('change', render);
  for (const id of ['addBase', 'addDays']) $(id).addEventListener('input', renderAdd);

  render();
  renderAdd();
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
