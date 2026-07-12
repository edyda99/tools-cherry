// holiday-countdown.js — live countdown to a holiday or any chosen date.
// Pure date math via the shared date-math module. No deps, nothing uploaded.
import {
  daysBetween,
  startOfDay,
  holidayDate,
  nextHolidayOccurrence
} from '/assets/date-math.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

// Friendly labels for the preset holidays.
const HOLIDAYS = {
  newyear:      "New Year's Day",
  valentines:   "Valentine's Day",
  easter:       'Easter Sunday',
  memorial:     'Memorial Day',
  independence: 'Independence Day (July 4th)',
  halloween:    'Halloween',
  thanksgiving: 'Thanksgiving',
  christmas:    'Christmas'
};

const pad = (n) => String(n).padStart(2, '0');

function fmtDate(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

// Current target as a local-midnight Date, plus a display label.
let target = null;
let label = '';

// Build the live tick: days/hours/minutes/seconds remaining until target
// midnight. When the target is today, it counts down the hours left in the day.
function tick() {
  if (!target) return;
  const now = new Date();
  const days = daysBetween(now, target);

  const headline = $('cdDays');
  const note = $('cdNote');

  if (days < 0) {
    // Shouldn't happen (presets roll forward), but custom dates can be in the past.
    headline.textContent = '—';
    $('cdH').textContent = $('cdM').textContent = $('cdS').textContent = '00';
    note.textContent = `${label} was ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago.`;
    return;
  }

  headline.textContent = days.toLocaleString('en-US');
  $('cdDaysLabel').textContent = days === 1 ? 'day' : 'days';

  // Time remaining until the start of the target day (its midnight).
  const ms = target.getTime() - now.getTime();
  if (days === 0) {
    note.textContent = `${label} is today — ${fmtDate(target)}.`;
  } else {
    note.textContent = `until ${label} — ${fmtDate(target)}.`;
  }
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3600000) % 24;
  const m = Math.floor(total / 60000) % 60;
  const s = Math.floor(total / 1000) % 60;
  $('cdH').textContent = pad(h);
  $('cdM').textContent = pad(m);
  $('cdS').textContent = pad(s);
}

function setHoliday(key) {
  target = nextHolidayOccurrence(key);
  label = HOLIDAYS[key] || 'the date';
  document.querySelectorAll('.preset').forEach((b) =>
    b.classList.toggle('on', b.dataset.holiday === key)
  );
  // Mirror the resolved date into the custom picker so the two stay in sync.
  if (target) {
    $('customDate').value =
      `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
  }
  tick();
}

function setCustom() {
  const v = $('customDate').value;
  if (!v) return;
  const [y, mo, d] = v.split('-').map(Number);
  if (!y || !mo || !d) return;
  target = new Date(y, mo - 1, d, 0, 0, 0, 0);
  label = 'your date';
  document.querySelectorAll('.preset').forEach((b) => b.classList.remove('on'));
  tick();
}

function init() {
  document.querySelectorAll('.preset').forEach((b) =>
    b.addEventListener('click', () => setHoliday(b.dataset.holiday))
  );
  $('customDate').addEventListener('input', setCustom);

  // Default to the next major holiday on the calendar so the page is never empty.
  // Pick whichever preset is soonest from today.
  const today = startOfDay(new Date());
  let best = null;
  for (const key of Object.keys(HOLIDAYS)) {
    const d = nextHolidayOccurrence(key, today);
    const days = daysBetween(today, d);
    if (!best || days < best.days) best = { key, days };
  }
  setHoliday(best ? best.key : 'christmas');

  setInterval(tick, 1000);
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
