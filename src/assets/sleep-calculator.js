// sleep-calculator.js — bedtime / wake-time calculator using 90-minute cycles.
// Live results, graceful empty handling. Pure math via the shared sleep engine.
// No deps, nothing uploaded.
import {
  bedtimesForWake,
  wakeTimesForBed,
  formatClock,
  parseClock,
  isIdeal
} from '/assets/sleep.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function reset(out, sub, detail, msg) {
  out.textContent = '—';
  sub.textContent = msg || 'Pick a time to see your options.';
  detail.innerHTML = '';
}

function row(opt, mode) {
  const time = formatClock(opt.timeMin);
  const hrs = Number.isInteger(opt.sleepHours) ? opt.sleepHours : opt.sleepHours.toFixed(1);
  const tag = isIdeal(opt.cycles) ? ' <span class="lbl">· ideal</span>' : '';
  const label = `${opt.cycles} cycles · ${hrs} hrs${tag}`;
  return `<li><span class="lbl">${label}</span><span>${time}</span></li>`;
}

function calc() {
  const out = $('out');
  const sub = $('sub');
  const detail = $('detail');

  const mode = $('mode').value === 'bed' ? 'bed' : 'wake';
  const fallRaw = $('fall').value.trim();
  const fallAsleep = fallRaw === '' ? 15 : parseFloat(fallRaw);

  const t = $('time').value; // "HH:MM" from <input type=time>, or ''
  const mins = t ? parseClock(t) : null;
  if (mins == null) return reset(out, sub, detail, 'Pick a time to see your options.');

  const opts = mode === 'wake'
    ? bedtimesForWake(mins, { fallAsleep })
    : wakeTimesForBed(mins, { fallAsleep });

  // Headline = the recommended (6-cycle / most-rest) option, shown big.
  const best = opts[0];
  out.textContent = formatClock(best.timeMin);
  if (mode === 'wake') {
    sub.textContent = `To wake at ${formatClock(mins)} feeling rested, head to bed at one of these times (about ${fallAsleep} min to fall asleep included):`;
  } else {
    sub.textContent = `If you fall asleep around ${formatClock(mins)}, wake at one of these times to rise at the end of a cycle:`;
  }
  detail.innerHTML = opts.map((o) => row(o, mode)).join('');
}

function init() {
  // Default the time field to "now" so the page is useful immediately.
  const d = new Date();
  $('time').value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  $('useNow').addEventListener('click', () => {
    const n = new Date();
    $('time').value = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    calc();
  });

  document.querySelectorAll('#sleepForm input, #sleepForm select').forEach((el) =>
    el.addEventListener('input', calc)
  );
  calc();
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
