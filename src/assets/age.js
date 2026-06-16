// age.js — client-side Age Calculator UI. Parses the date inputs into plain
// {year,month,day} parts and defers all calendar arithmetic to the pure
// engine (age-math.js) so the math is the same code path the unit tests cover.
// No network, no storage — everything runs in the browser.

import { ageBreakdown, nextBirthday, weekdayName, daysBetween } from '/assets/age-math.js';

const $ = (id) => document.getElementById(id);

// Parse a yyyy-mm-dd value from <input type="date"> into {year,month,day}.
// Returns null for empty/invalid input. We parse the string directly rather
// than via new Date() to avoid local-timezone off-by-one shifts.
function parseDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const year = +m[1], month = +m[2], day = +m[3];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // reject impossible days (e.g. Feb 30) by round-tripping through Date
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

function todayParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function ymdString(p) {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

function longDate(p) {
  // locale-independent readable date, e.g. "17 June 2025"
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  return `${p.day} ${months[p.month - 1]} ${p.year}`;
}

function render() {
  const status = $('ageStatus');
  const results = $('ageResults');
  const birth = parseDate($('birthDate').value);
  const ref = parseDate($('refDate').value) || todayParts();

  if (!birth) {
    results.hidden = true;
    status.textContent = 'Enter your date of birth to calculate your age.';
    return;
  }

  const breakdown = ageBreakdown(birth, ref);
  if (!breakdown) {
    results.hidden = true;
    status.textContent = 'The "as of" date is before the date of birth — adjust the dates.';
    return;
  }

  status.textContent = '';
  results.hidden = false;

  const { years, months, days, totalDays, totalWeeks, totalMonths } = breakdown;
  const totalHours = totalDays * 24;
  const totalMinutes = totalHours * 60;

  $('ageMain').textContent = `${plural(years, 'year')}, ${plural(months, 'month')}, ${plural(days, 'day')}`;

  $('ageAlt').innerHTML = [
    `<li><strong>${totalMonths.toLocaleString('en-US')}</strong> months</li>`,
    `<li><strong>${totalWeeks.toLocaleString('en-US')}</strong> weeks</li>`,
    `<li><strong>${totalDays.toLocaleString('en-US')}</strong> days</li>`,
    `<li><strong>${totalHours.toLocaleString('en-US')}</strong> hours</li>`,
    `<li><strong>${totalMinutes.toLocaleString('en-US')}</strong> minutes</li>`
  ].join('');

  // born-on day of week
  $('ageBorn').textContent = `You were born on a ${weekdayName(birth)} (${longDate(birth)}).`;

  // next birthday — only meaningful when the reference date is today
  const nb = nextBirthday(birth, ref);
  const turning = nb.date.year - birth.year;
  $('ageNext').textContent = nb.daysUntil === 0
    ? `Happy birthday! Today you turn ${turning}.`
    : `Next birthday: ${longDate(nb.date)} — in ${plural(nb.daysUntil, 'day')}, when you turn ${turning} (a ${weekdayName(nb.date)}).`;
}

function init() {
  const ref = $('refDate');
  // default the "as of" date to today and cap the DOB at today
  const today = todayParts();
  if (ref && !ref.value) ref.value = ymdString(today);
  const birth = $('birthDate');
  if (birth) birth.max = ymdString(today);

  ['birthDate', 'refDate'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', render);
  });
  const reset = $('refReset');
  if (reset) reset.addEventListener('click', () => { ref.value = ymdString(todayParts()); render(); });

  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
