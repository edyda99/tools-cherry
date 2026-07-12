// ovulation-calculator.js — ovulation & fertile-window calculator UI.
// Pure date math via the shared ovulation module. No deps, nothing uploaded —
// everything runs in the browser, in the user's local time zone.
import { startOfDay } from '/assets/date-math.js';
import { ovulationSummary, addDays } from '/assets/ovulation.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const nf = (n) => n.toLocaleString('en-US');

function fmtDate(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function fmtShort(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Parse a yyyy-mm-dd value into a local-midnight Date, or null if incomplete.
function parseInput(v) {
  if (!v) return null;
  const [y, mo, d] = v.split('-').map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}

function unit(n, word) {
  return `${nf(n)} ${word}${n === 1 ? '' : 's'}`;
}

// "in N days" / "today" / "N days ago" for a whole-day offset.
function relativeDays(n) {
  if (n === 0) return 'today';
  if (n > 0) return `in ${unit(n, 'day')}`;
  return `${unit(-n, 'day')} ago`;
}

function showResults(on) {
  $('ovResults').hidden = !on;
  $('ovPlaceholder').hidden = on;
}

function render() {
  const lmp = parseInput($('lmpDate').value);
  const cycleLength = Number($('cycle').value) || 28;

  const msg = $('ovMsg');
  msg.textContent = '';
  msg.hidden = true;

  if (!lmp) {
    showResults(false);
    return;
  }

  const today = startOfDay(new Date());

  let s;
  try {
    s = ovulationSummary({ lmp, cycleLength, today });
  } catch (e) {
    showResults(false);
    msg.hidden = false;
    msg.textContent = e.message;
    return;
  }

  showResults(true);

  // Headline: the estimated ovulation date.
  $('ovBig').textContent = fmtDate(s.ovulation);

  if (s.inFertileWindow) {
    $('ovSub').textContent =
      `You are in your estimated fertile window now — ovulation is ${relativeDays(s.daysToOvulation)}.`;
  } else if (s.daysToOvulation > 0) {
    $('ovSub').textContent =
      `Estimated ovulation is ${relativeDays(s.daysToOvulation)}; your fertile window opens ${relativeDays(s.daysToFertileStart)}.`;
  } else {
    $('ovSub').textContent =
      `Estimated ovulation was ${relativeDays(s.daysToOvulation)} for this cycle.`;
  }

  // Detail rows.
  $('ovWindow').textContent = `${fmtShort(s.fertileStart)} – ${fmtShort(s.fertileEnd)}`;
  $('ovOvulation').textContent = fmtShort(s.ovulation);
  $('ovNextPeriod').textContent = `${fmtShort(s.nextPeriod)} (${relativeDays(s.daysToNextPeriod)})`;

  // Next three cycles' fertile windows + ovulation, so users can plan ahead.
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const lmpI = addDays(s.cycleStart, i * s.cycleLength);
    const ci = ovulationSummary({ lmp: lmpI, cycleLength, today, rollForward: false });
    rows.push(
      `<tr><td>${fmtShort(ci.fertileStart)} – ${fmtShort(ci.fertileEnd)}</td><td>${fmtShort(ci.ovulation)}</td><td>${fmtShort(ci.nextPeriod)}</td></tr>`
    );
  }
  $('ovCycles').innerHTML = rows.join('');
}

function init() {
  const today = startOfDay(new Date());
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  $('lmpDate').value = todayStr;
  $('lmpDate').max = todayStr;

  $('lmpDate').addEventListener('input', render);
  $('cycle').addEventListener('input', render);

  render();
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
