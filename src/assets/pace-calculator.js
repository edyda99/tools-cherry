// pace-calculator.js — running/walking pace calculator UI.
// Three modes: solve for Pace, Time, or Distance from the other two.
// Live results, graceful empty/invalid handling (never shows NaN).
// Pure math via the shared pace engine module. No deps, nothing uploaded.
import {
  convertDistance,
  toSeconds,
  formatHMS,
  pace,
  time,
  distance,
  speed,
  convertPace,
  raceFinishTimes
} from '/assets/pace.js';

const $ = (id) => document.getElementById(id);
const isBlank = (id) => !$(id) || $(id).value.trim() === '';

function fmt(n, dp = 2) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp
  });
}

function activeMode() {
  const pressed = document.querySelector('.unit-toggle button[aria-pressed="true"]');
  return pressed ? pressed.dataset.mode : 'pace';
}

function activeUnit() {
  return $('unit').value === 'mi' ? 'mi' : 'km';
}

// Show only the input rows relevant to the active mode (hide the one we solve).
function showMode(mode) {
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
  );
  $('distRow').hidden = mode === 'distance';
  $('timeRow').hidden = mode === 'time';
  $('paceRow').hidden = mode === 'pace';
  calc();
}

function reset(msg) {
  $('resultBig').textContent = '—';
  $('resultSub').textContent = msg || 'Fill in the fields above to see your result.';
  $('extra').hidden = true;
  $('racePanel').hidden = true;
}

// Pace fields are minutes + seconds (per unit); read them as total seconds.
function readPaceSeconds() {
  if (isBlank('paceMin') && isBlank('paceSec')) return NaN;
  return toSeconds(0, $('paceMin').value, $('paceSec').value);
}

function readTimeSeconds() {
  if (isBlank('h') && isBlank('m') && isBlank('s')) return NaN;
  return toSeconds($('h').value, $('m').value, $('s').value);
}

function setExtra(label, value) {
  $('extra').hidden = false;
  $('extra').querySelector('.lbl').textContent = label;
  $('extraV').textContent = value;
}

// Build the predicted finish-times table from a pace in seconds/km.
function showRaceTable(paceSecondsPerKm) {
  const rows = raceFinishTimes(paceSecondsPerKm);
  if (!rows.length) {
    $('racePanel').hidden = true;
    return;
  }
  const body = $('raceBody');
  body.innerHTML = rows
    .map((r) => `<tr><td>${r.name}</td><td>${formatHMS(r.seconds)}</td></tr>`)
    .join('');
  $('racePanel').hidden = false;
}

function calc() {
  const mode = activeMode();
  const unit = activeUnit();
  const unitLabel = unit === 'mi' ? 'mile' : 'km';

  if (mode === 'pace') {
    const dist = isBlank('dist') ? NaN : convertDistance($('dist').value, unit, unit);
    const secs = readTimeSeconds();
    const p = pace(secs, dist);
    if (!Number.isFinite(p)) return reset('Enter a distance and a time to see your pace.');
    $('resultBig').textContent = `${formatHMS(p)} /${unitLabel}`;
    $('resultSub').textContent = `Pace per ${unitLabel}`;
    const spd = speed(secs, dist);
    setExtra('Average speed', `${fmt(spd, 2)} ${unit}/h`);
    showRaceTable(unit === 'mi' ? convertPace(p, 'mi', 'km') : p);
  } else if (mode === 'time') {
    const dist = isBlank('dist') ? NaN : parseFloat($('dist').value);
    const p = readPaceSeconds();
    const total = time(p, dist);
    if (!Number.isFinite(total)) return reset('Enter a distance and a pace to see your finish time.');
    $('resultBig').textContent = formatHMS(total);
    $('resultSub').textContent = `Total time for ${fmt(dist, 2)} ${unit}`;
    const spd = speed(total, dist);
    setExtra('Average speed', `${fmt(spd, 2)} ${unit}/h`);
    showRaceTable(unit === 'mi' ? convertPace(p, 'mi', 'km') : p);
  } else {
    // distance
    const secs = readTimeSeconds();
    const p = readPaceSeconds();
    const d = distance(secs, p);
    if (!Number.isFinite(d)) return reset('Enter a time and a pace to see how far you went.');
    $('resultBig').textContent = `${fmt(d, 2)} ${unit}`;
    $('resultSub').textContent = `Distance covered`;
    const spd = speed(secs, d);
    setExtra('Average speed', `${fmt(spd, 2)} ${unit}/h`);
    showRaceTable(unit === 'mi' ? convertPace(p, 'mi', 'km') : p);
  }
}

function init() {
  document.querySelectorAll('.unit-toggle button').forEach((b) =>
    b.addEventListener('click', () => showMode(b.dataset.mode))
  );
  document.querySelectorAll('#paceForm input').forEach((el) =>
    el.addEventListener('input', calc)
  );
  $('unit').addEventListener('change', () => {
    // Update the per-unit suffix on the pace row when units change.
    const u = activeUnit() === 'mi' ? 'mile' : 'km';
    document.querySelectorAll('.pace-unit-label').forEach((el) => (el.textContent = '/' + u));
    calc();
  });
  showMode('pace');
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
