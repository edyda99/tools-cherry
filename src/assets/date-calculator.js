// date-calculator.js — add/subtract days, weeks, months, years from a date.
// Pure logic via the shared date-add module. No deps, nothing uploaded.
import { parseISODate, toISODate, addToDate, daysBetween, formatLong } from '/assets/date-add.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

// Set the start date input to today on first load.
function todayISO() {
  return toISODate(new Date());
}

function update() {
  const baseStr = $('startDate').value;
  const base = parseISODate(baseStr);

  const big = $('resultBig');
  const sub = $('resultSub');
  const lineDelta = $('lineDelta');

  if (!base) {
    big.textContent = '—';
    sub.textContent = 'Pick a start date.';
    lineDelta.hidden = true;
    return;
  }

  const dir = document.querySelector('input[name="direction"]:checked');
  const sign = dir && dir.value === 'subtract' ? -1 : 1;

  const offset = {
    years: $('years').value.trim() || 0,
    months: $('months').value.trim() || 0,
    weeks: $('weeks').value.trim() || 0,
    days: $('days').value.trim() || 0
  };

  const result = addToDate(base, offset, sign);
  if (!result) {
    big.textContent = '—';
    sub.textContent = 'Check your numbers.';
    lineDelta.hidden = true;
    return;
  }

  big.textContent = formatLong(result);
  sub.textContent = toISODate(result);

  // How far the result is from today, in whole days.
  const fromToday = daysBetween(new Date(), result);
  const abs = Math.abs(fromToday);
  let phrase;
  if (fromToday === 0) phrase = 'That is today.';
  else if (fromToday > 0) phrase = `${abs.toLocaleString('en-US')} day${abs === 1 ? '' : 's'} from today.`;
  else phrase = `${abs.toLocaleString('en-US')} day${abs === 1 ? '' : 's'} ago.`;
  $('lineDeltaV').textContent = phrase;
  lineDelta.hidden = false;
}

function init() {
  if (!$('startDate').value) $('startDate').value = todayISO();

  ['startDate', 'years', 'months', 'weeks', 'days'].forEach((id) =>
    $(id).addEventListener('input', update)
  );
  document.querySelectorAll('input[name="direction"]').forEach((r) =>
    r.addEventListener('change', update)
  );

  // Quick presets fill the day field and recalc.
  document.querySelectorAll('[data-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('years').value = '';
      $('months').value = '';
      $('weeks').value = '';
      $('days').value = btn.dataset.days;
      const add = document.querySelector('input[name="direction"][value="add"]');
      if (add) add.checked = true;
      update();
    });
  });

  $('todayBtn').addEventListener('click', () => {
    $('startDate').value = todayISO();
    update();
  });

  update();
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
