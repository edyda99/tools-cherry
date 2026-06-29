// chronological-age-calculator.js — exact chronological age in years; months;
// days using the standard test-scoring borrowing method (WISC, WPPSI, Pearson,
// Brigance). Pure math via the shared chronological-age engine. No deps,
// nothing uploaded — all in the browser, local time zone.
import { ageResult } from '/assets/chronological-age.js';

const $ = (id) => document.getElementById(id);

const pad = (n) => String(n).padStart(2, '0');
const nf = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—');

function fmtDate(parts) {
  const d = new Date(parts.y, parts.m - 1, parts.d, 0, 0, 0, 0);
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

// "1 year", "2 years" — singular/plural helper.
function unit(n, word) {
  return `${nf(n)} ${word}${n === 1 ? '' : 's'}`;
}

// Parse a yyyy-mm-dd input value into {y, m, d}, or null if incomplete.
function parseInput(v) {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function showResults(on) {
  $('ageResults').hidden = !on;
  $('agePlaceholder').hidden = on;
}

function render() {
  const birth = parseInput($('birthDate').value);
  const test = parseInput($('testDate').value);

  const msg = $('ageMsg');
  msg.textContent = '';
  msg.hidden = true;

  // Need both dates before showing anything.
  if (!birth || !test) {
    showResults(false);
    return;
  }

  const r = ageResult(birth, test);

  // Test date earlier than birth -> friendly error, never negatives.
  if (!r) {
    showResults(false);
    msg.hidden = false;
    msg.textContent =
      'The test date is before the date of birth, so there is no age to show. Check both dates.';
    return;
  }

  showResults(true);

  // Headline: exact years; months; days (the test-scoring default).
  $('ageBig').textContent =
    `${unit(r.years, 'year')}; ${unit(r.months, 'month')}; ${unit(r.days, 'day')}`;
  $('ageSub').textContent =
    `Born ${fmtDate(birth)} · tested ${fmtDate(test)}.`;

  // Compact years;months readout (the form most norm tables are indexed by).
  $('ymReadout').textContent = `${r.years} : ${pad(r.months)}`;

  // Totals.
  $('totMonths').textContent = nf(r.totalMonths);
  $('totDays').textContent = nf(r.totalDays);

  // Optional nearest-month rounding, shown only when the box is ticked.
  const roundOn = $('roundToggle').checked;
  const roundWrap = $('roundWrap');
  if (roundOn && r.rounded) {
    roundWrap.hidden = false;
    const rm = r.rounded;
    $('roundedReadout').textContent =
      `${unit(rm.years, 'year')}, ${unit(rm.months, 'month')} (${rm.years} : ${pad(rm.months)})`;
    const note = r.days >= 15
      ? `Rounded up because the day count (${r.days}) is 15 or more.`
      : `Rounded down because the day count (${r.days}) is under 15.`;
    $('roundedNote').textContent = note;
  } else {
    roundWrap.hidden = true;
  }
}

function init() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const birthEl = $('birthDate');
  const testEl = $('testDate');

  // Default the test/assessment date to today; cap birth at today.
  birthEl.max = todayStr;
  testEl.value = todayStr;

  birthEl.addEventListener('input', render);
  testEl.addEventListener('input', render);
  $('roundToggle').addEventListener('change', render);

  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
