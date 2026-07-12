// time-zone-converter.js — convert a date & time from one time zone to another,
// entirely in the browser using the Intl time-zone database. No deps, no network.
import {
  listTimeZones, convert, formatOffset, zonedWallTime, tzOffsetMinutes
} from '/assets/timezone.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// Turn "America/New_York" into "America / New York" for the dropdown label.
function prettyZone(tz) {
  return tz.replace(/_/g, ' ').replace(/\//g, ' / ');
}

// Best-effort detection of the visitor's own zone (used to preselect "from").
function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Fill both <select>s with the full zone list.
function populateZones() {
  const zones = listTimeZones();
  const opts = zones.map((z) => `<option value="${z}">${prettyZone(z)}</option>`).join('');
  $('fromZone').innerHTML = opts;
  $('toZone').innerHTML = opts;

  const here = localZone();
  if (zones.includes(here)) $('fromZone').value = here;
  // Pick a sensible, different default for "to".
  const toDefault = here === 'UTC' ? 'America/New_York' : 'UTC';
  $('toZone').value = zones.includes(toDefault) ? toDefault : zones[0];
}

// Prefill the date & time inputs with "now" in the visitor's local zone.
function prefillNow() {
  const now = new Date();
  const w = zonedWallTime(localZone(), now);
  const pad = (n) => String(n).padStart(2, '0');
  $('date').value = `${w.year}-${pad(w.month)}-${pad(w.day)}`;
  $('time').value = `${pad(w.hour)}:${pad(w.minute)}`;
}

function dayLabel(w) {
  // Build a Date purely to derive the weekday name for these wall-clock numbers.
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day));
  const dow = DOW[d.getUTCDay()];
  return `${dow}, ${MON[w.month - 1]} ${w.day}, ${w.year}`;
}

function timeLabel(w) {
  const pad = (n) => String(n).padStart(2, '0');
  const h12 = ((w.hour + 11) % 12) + 1;
  const ampm = w.hour < 12 ? 'AM' : 'PM';
  return `${h12}:${pad(w.minute)} ${ampm}`;
}

// Same calendar day in both zones? Note any +1/-1 day shift for the user.
function dayShiftNote(from, to) {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  const diff = Math.round((b - a) / 86400000);
  if (diff === 0) return '';
  if (diff === 1) return ' (next day)';
  if (diff === -1) return ' (previous day)';
  return diff > 0 ? ` (+${diff} days)` : ` (${diff} days)`;
}

function update() {
  const err = $('error');
  const dateStr = $('date').value;
  const timeStr = $('time').value;
  if (!dateStr || !timeStr) {
    err.textContent = 'Pick a date and time to convert.';
    $('resultCard').hidden = true;
    return;
  }

  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  if (![y, mo, d, hh, mm].every(Number.isFinite)) {
    err.textContent = 'Enter a valid date and time.';
    $('resultCard').hidden = true;
    return;
  }

  const fromTz = $('fromZone').value;
  const toTz = $('toZone').value;
  const r = convert(fromTz, toTz, { year: y, month: mo, day: d, hour: hh, minute: mm, second: 0 });

  err.textContent = '';
  $('resultCard').hidden = false;

  $('fromName').textContent = prettyZone(fromTz);
  $('fromOffset').textContent = formatOffset(r.from.offset);
  $('fromTime').textContent = timeLabel(r.from);
  $('fromDate').textContent = dayLabel(r.from);

  $('toName').textContent = prettyZone(toTz);
  $('toOffset').textContent = formatOffset(r.to.offset);
  $('toTime').textContent = timeLabel(r.to) + dayShiftNote(r.from, r.to);
  $('toDate').textContent = dayLabel(r.to);

  // Plain-language summary of the time difference between the two zones.
  const diffMin = r.to.offset - r.from.offset;
  const ahead = diffMin > 0;
  const absH = Math.floor(Math.abs(diffMin) / 60);
  const absM = Math.abs(diffMin) % 60;
  let diffText;
  if (diffMin === 0) {
    diffText = `${prettyZone(toTz)} is the same time as ${prettyZone(fromTz)}.`;
  } else {
    const hrPart = absH ? `${absH} hour${absH === 1 ? '' : 's'}` : '';
    const mnPart = absM ? `${absM} minute${absM === 1 ? '' : 's'}` : '';
    const span = [hrPart, mnPart].filter(Boolean).join(' and ');
    diffText = `${prettyZone(toTz)} is ${span} ${ahead ? 'ahead of' : 'behind'} ${prettyZone(fromTz)}.`;
  }
  $('diff').textContent = diffText;
}

function swapZones() {
  const a = $('fromZone').value;
  $('fromZone').value = $('toZone').value;
  $('toZone').value = a;
  update();
}

function init() {
  populateZones();
  prefillNow();
  ['fromZone', 'toZone', 'date', 'time'].forEach((id) =>
    $(id).addEventListener('input', update));
  $('swapBtn').addEventListener('click', swapZones);
  $('nowBtn').addEventListener('click', () => { prefillNow(); update(); });
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
