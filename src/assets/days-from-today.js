// days-from-today.js — fills in the answer on the fixed-interval date pages
// (/30-days-from-today/, /12-weeks-from-today/, /10-business-days-from-today/,
// /90-days-ago/ and their siblings).
//
// The answer CANNOT be baked at build time: "30 days from today" is a different
// date every day, so a static page would start lying the morning after it was
// deployed. The interval itself is static and lives in the markup; the clock
// comes from the reader's own device at page load.
//
// Everything is computed through the shared date engine, so these pages can
// never disagree with /date-calculator/ or /days-between-dates/.
import { toISODate, addToDate, addBusinessDays, formatLong } from '/assets/date-add.js';
import { businessDaysBetween } from '/assets/date-math.js';
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';

const $ = (id) => document.getElementById(id);

// A whole-number attribute, or 0 when the markup is malformed.
const intAttr = (el, name) => {
  const v = Number(el.getAttribute(name));
  return Number.isFinite(v) ? Math.trunc(v) : 0;
};

const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${Math.abs(n) === 1 ? '' : 's'}`;

function render() {
  const box = $('dft');
  if (!box) return;

  const amount = intAttr(box, 'data-amount');
  const unit = box.getAttribute('data-unit') || 'day';   // day | week | business
  const sign = box.getAttribute('data-dir') === 'back' ? -1 : 1;

  const today = new Date();

  let result;
  if (unit === 'business') result = addBusinessDays(today, amount, sign);
  else if (unit === 'week') result = addToDate(today, { weeks: amount }, sign);
  else result = addToDate(today, { days: amount }, sign);

  if (!result) return; // leaves the em-dash placeholder rather than printing junk

  // The headline answer.
  $('dftBig').textContent = formatLong(result);

  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };

  set('dftToday', formatLong(today));
  set('dftIso', toISODate(result));
  set('dftDow', result.toLocaleDateString('en-US', { weekday: 'long' }));

  // The cross-check line: for a calendar-day interval, how many of those days
  // are working days; for a business-day interval, how many calendar days the
  // count actually spans once weekends are put back in.
  const calSpan = Math.round(
    (new Date(result.getFullYear(), result.getMonth(), result.getDate()) -
     new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000
  );
  const biz = Math.abs(businessDaysBetween(today, result));
  const absCal = Math.abs(calSpan);

  if (unit === 'business') {
    set('dftCross', `${plural(amount, 'business day')} spans ${plural(absCal, 'calendar day')} once weekends are counted back in.`);
  } else {
    set('dftCross', `${plural(absCal, 'calendar day')} — ${plural(biz, 'weekday')} and ${plural(absCal - biz, 'weekend day')}.`);
  }

  const sub = $('dftSub');
  if (sub) {
    sub.textContent = sign < 0
      ? `${plural(absCal, 'day')} before today.`
      : `${plural(absCal, 'day')} after today.`;
  }
}

function __bootInit() {
  try {
    render();
  } catch (err) {
    showCalculatorLoadError(err);
  }
}
if (document.readyState !== 'loading') __bootInit();
else document.addEventListener('DOMContentLoaded', __bootInit);
