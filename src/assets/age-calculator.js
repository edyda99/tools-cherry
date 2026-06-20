// age-calculator.js — exact age in years/months/days, totals, and a live
// countdown to the next birthday. Pure date math via the shared date-math
// module. No deps, nothing uploaded — all in the browser, local time zone.
import {
  daysBetween,
  startOfDay,
  ageBreakdown,
  nextBirthday
} from '/assets/date-math.js';

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

// "1 year", "2 years" — singular/plural helper.
function unit(n, word) {
  return `${nf(n)} ${word}${n === 1 ? '' : 's'}`;
}

// Plain-English headline like "36 years, 0 months and 14 days".
function phrase(b) {
  const parts = [unit(b.years, 'year'), unit(b.months, 'month'), unit(b.days, 'day')];
  return parts.slice(0, 2).join(', ') + ' and ' + parts[2];
}

function showResults(on) {
  $('ageResults').hidden = !on;
  $('agePlaceholder').hidden = on;
}

function render() {
  const birth = parseInput($('birthDate').value);
  const asOf = parseInput($('asOfDate').value) || startOfDay(new Date());

  const msg = $('ageMsg');
  msg.textContent = '';
  msg.hidden = true;

  if (!birth) {
    showResults(false);
    return;
  }

  if (startOfDay(birth).getTime() > startOfDay(asOf).getTime()) {
    showResults(false);
    msg.hidden = false;
    msg.textContent = asOf.getTime() === startOfDay(new Date()).getTime()
      ? "That date is in the future, so there's no age to show yet. Pick a birth date on or before today."
      : 'The birth date is after the “age at” date, so there’s no age to show. Check both dates.';
    return;
  }

  const b = ageBreakdown(birth, asOf);
  if (!b) { showResults(false); return; }

  showResults(true);

  $('ageBig').textContent = phrase(b);

  const totalDays = daysBetween(birth, asOf);
  const totalWeeks = Math.floor(totalDays / 7);
  const totalMonths = b.years * 12 + b.months;
  const totalHours = totalDays * 24;
  const totalMinutes = totalHours * 60;

  const asOfIsToday = startOfDay(asOf).getTime() === startOfDay(new Date()).getTime();
  $('ageSub').textContent = asOfIsToday
    ? `Born ${fmtDate(birth)} — your age today.`
    : `Born ${fmtDate(birth)} — age on ${fmtDate(asOf)}.`;

  $('totDays').textContent = nf(totalDays);
  $('totWeeks').textContent = nf(totalWeeks);
  $('totMonths').textContent = nf(totalMonths);
  $('totHours').textContent = nf(totalHours);
  $('totMinutes').textContent = nf(totalMinutes);

  // Next birthday — measured from the as-of date so a chosen date stays
  // consistent with the rest of the figures.
  const nb = nextBirthday(birth, asOf);
  const daysToBday = daysBetween(asOf, nb);
  const turning = nb.getFullYear() - birth.getFullYear();
  if (daysToBday === 0) {
    $('bdayLine').textContent = asOfIsToday
      ? `Happy birthday! You turn ${turning} today.`
      : `That date is birthday number ${turning} — ${fmtDate(nb)}.`;
  } else {
    $('bdayLine').textContent =
      `${unit(daysToBday, 'day')} until the next birthday (turning ${turning}) on ${fmtDate(nb)}.`;
  }
}

function init() {
  const today = startOfDay(new Date());
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const birthEl = $('birthDate');
  const asOfEl = $('asOfDate');

  // Cap the birth-date picker at today and default the "age at" field to today.
  birthEl.max = todayStr;
  asOfEl.value = todayStr;
  asOfEl.max = ''; // an "age at" date may be in the future (e.g. "how old on …")

  birthEl.addEventListener('input', render);
  asOfEl.addEventListener('input', render);

  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
