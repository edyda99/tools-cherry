// hours-calculator.js — time-card / hours-worked calculator, live results.
// Pure math via the shared timecard module. No deps, nothing uploaded.
import {
  shiftMinutes,
  totalMinutes,
  minutesToDecimal,
  minutesToHhmm,
  formatDecimal,
  grossPay,
  overtimeSplit,
  grossPayOvertime
} from '/assets/timecard.js';
import { buildTimecardText, effectiveThreshold, effectiveMultiplier } from '/assets/timecard-export.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
const $ = (id) => document.getElementById(id);

function money(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
}

// --- day rows ----------------------------------------------------------------
// Default labels for a Mon–Sun week; extra rows beyond 7 get a generic label.
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function dayRow(label = '', start = '', end = '', brk = '') {
  const row = document.createElement('div');
  row.className = 'tc-row';
  row.innerHTML =
    `<div class="tc-f"><span class="dl">Day</span><input class="lbl-in" placeholder="Day" aria-label="Day label" value="${label}"></div>` +
    `<div class="tc-f"><span class="dl">Start</span><input class="start" type="time" aria-label="Start time" value="${start}"></div>` +
    `<div class="tc-f"><span class="dl">End</span><input class="end" type="time" aria-label="End time" value="${end}"></div>` +
    `<div class="tc-f"><span class="dl">Break (min)</span><input class="brk" type="number" min="0" step="any" inputmode="numeric" placeholder="0" aria-label="Unpaid break minutes" value="${brk}"></div>` +
    `<div class="tc-f"><span class="dl">Hours</span><span class="out" aria-live="polite">—</span></div>` +
    `<button type="button" class="rm" title="Remove row" aria-label="Remove day">×</button>`;
  row.querySelector('.rm').addEventListener('click', () => { row.remove(); render(); });
  row.querySelectorAll('input').forEach((el) => el.addEventListener('input', render));
  return row;
}

function nextDayLabel() {
  const n = document.querySelectorAll('#rows .tc-row').length;
  return DAY_LABELS[n] || `Day ${n + 1}`;
}

function readRows() {
  return [...document.querySelectorAll('#rows .tc-row')].map((row) => ({
    el: row,
    label: row.querySelector('.lbl-in').value,
    start: row.querySelector('.start').value,
    end: row.querySelector('.end').value,
    breakMin: row.querySelector('.brk').value
  }));
}

// --- live render -------------------------------------------------------------
function render() {
  const rows = readRows();

  // Per-row output: decimal + h:mm, or a dash / "—" while incomplete.
  rows.forEach((r) => {
    const out = r.el.querySelector('.out');
    if (!r.start || !r.end) { out.textContent = '—'; return; }
    const m = shiftMinutes(r.start, r.end, r.breakMin);
    if (!Number.isFinite(m)) { out.textContent = '—'; return; }
    out.textContent = `${formatDecimal(minutesToDecimal(m))} h  (${minutesToHhmm(m)})`;
  });

  const totMin = totalMinutes(rows.map((r) => ({ start: r.start, end: r.end, breakMin: r.breakMin })));
  const totHours = minutesToDecimal(totMin);

  $('totalDecimal').textContent = formatDecimal(totHours) + ' hours';
  $('totalHhmm').textContent = minutesToHhmm(totMin);

  // Overtime split (hours) — shown whenever the toggle is on, even before a rate.
  const otOn = $('otOn').checked;
  // `parseFloat(v) || 40` treated a deliberate 0 as missing, so a visitor who typed
  // 0 (meaning every hour counts as overtime) silently got 40, and the copied card
  // then stated 40 while the field on screen still read 0. These two helpers are the
  // same rules overtimeSplit and grossPayOvertime apply internally, so the number
  // here is provably the number the engine uses, and the label can quote it.
  const otThreshold = effectiveThreshold($('otThreshold').value);
  const otMult = effectiveMultiplier(parseFloat($('otMult').value));
  const split = otOn ? overtimeSplit(totHours, otThreshold) : { regular: totHours, overtime: 0 };
  const showOT = otOn && split.overtime > 0;
  $('otFields').hidden = !otOn;
  $('regLine').hidden = !showOT;
  $('otLine').hidden = !showOT;
  if (showOT) {
    $('regHours').textContent = formatDecimal(split.regular) + ' h';
    $('otHours').textContent = formatDecimal(split.overtime) + ' h';
  }

  // Optional gross pay (with OT breakdown when overtime applies).
  // Rate is a money field: read it comma-safe so "1,250" isn't truncated to 1.
  // Blank (or a stray non-numeric like ".") means "no rate yet" -> hide pay,
  // preserving the field's original optional/skip semantics.
  const rateEl = $('rate');
  const rateStr = rateEl.value.trim();
  const rate = moneyValue(rateEl);
  const payLine = $('payLine');
  const hidePay = () => {
    payLine.hidden = true; $('regPayLine').hidden = true; $('otPayLine').hidden = true;
  };
  if (rateStr === '' || !/\d/.test(rateStr)) {
    hidePay();
  } else if (otOn) {
    const pay = grossPayOvertime(totHours, rate, { thresholdHours: otThreshold, multiplier: otMult });
    payLine.hidden = false;
    $('grossPay').textContent = money(pay.total);
    $('regPayLine').hidden = !showOT;
    $('otPayLine').hidden = !showOT;
    if (showOT) { $('regPay').textContent = money(pay.regularPay); $('otPay').textContent = money(pay.overtimePay); }
  } else {
    const gross = grossPay(totHours, rate);
    payLine.hidden = !Number.isFinite(gross);
    $('regPayLine').hidden = true; $('otPayLine').hidden = true;
    if (Number.isFinite(gross)) $('grossPay').textContent = money(gross);
  }
}

// --- copy to clipboard -------------------------------------------------------
// Local calendar date, never toISOString(): a US evening visitor would otherwise
// see tomorrow's date stamped on their own time card.
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A line exists in the export if and only if the matching element is visible on
// screen right now. render() runs first so the .hidden flags read below are the
// ones the page is currently showing; nothing here re-derives showOT or the
// rate test, and no number is scraped from textContent (which carries $ and
// thousands separators).
function timecardText() {
  render();
  return buildTimecardText({
    rows: readRows().map((r) => ({
      label: r.label, start: r.start, end: r.end, breakMin: r.breakMin
    })),
    show: {
      otHours: !$('regLine').hidden,
      pay: !$('payLine').hidden,
      otPay: !$('regPayLine').hidden
    },
    otOn: $('otOn').checked,
    otThreshold: effectiveThreshold($('otThreshold').value),
    otMult: effectiveMultiplier(parseFloat($('otMult').value)),
    rate: moneyValue($('rate')),   // comma-safe: parseFloat("1,250") would give 1
    today: localToday()
  });
}

// The transient "Copied!" label. `idleLabel` is captured ONLY while no reset is
// pending, i.e. only while the button is showing its real text, so a second
// click inside the window can never capture "Copied!" and restore that forever,
// which is what a plain `const old = btn.textContent` did. Re-read on every idle
// click rather than frozen at module load, so a future translated or re-rendered
// label still restores correctly. The pending timer is always cancelled first,
// so any number of clicks in any rhythm ends on the real label.
const COPIED_MS = 1400;
let labelTimer = null;
let idleLabel = null;

function restoreLabel(btn) {
  if (labelTimer !== null) { clearTimeout(labelTimer); labelTimer = null; }
  if (idleLabel !== null) { btn.textContent = idleLabel; idleLabel = null; }
  btn.classList.remove('copied');
}

function flashCopied(btn) {
  if (labelTimer !== null) clearTimeout(labelTimer);
  else idleLabel = btn.textContent;
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  labelTimer = setTimeout(() => { restoreLabel(btn); }, COPIED_MS);
}

// One announcer for the copy outcome (#copyStatus, role="status", sr-only).
// A polite live region only speaks when its text CHANGES, so the same message
// twice in a row would be silent: clear it, then write on a later task.
// On failure the same element also becomes visible via the site's
// .muted-small.error convention, so the bad news is seen as well as spoken.
let statusTimer = null;
function setCopyStatus(msg, isError) {
  const el = $('copyStatus');
  if (!el) return;
  el.className = isError ? 'muted-small error' : 'sr-only';
  el.textContent = '';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = msg; }, 60);
}

const COPY_OK = 'Time card copied to the clipboard: every day, the totals and any pay estimate.';
const COPY_FAIL = 'Nothing was copied. Your browser blocked clipboard access, so select the times on this page and copy them yourself.';

function copyOutcome(btn, ok) {
  if (ok) {
    flashCopied(btn);
    setCopyStatus(COPY_OK, false);
  } else {
    // Never leave a stale "Copied!" standing over a failure.
    restoreLabel(btn);
    setCopyStatus(COPY_FAIL, true);
  }
}

function copyCard() {
  const btn = $('copyCard');
  if (!btn) return;
  const text = timecardText();

  // document.execCommand('copy') returns false WITHOUT throwing when the copy is
  // refused, so the old unconditional success call told the visitor "Copied!"
  // over an empty clipboard. Take the return value as the answer, and remove the
  // textarea in a finally so a throw can't strand it in the DOM.
  const fallback = () => {
    let ok = false;
    const ta = document.createElement('textarea');
    try {
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      ok = document.execCommand('copy') === true;
    } catch (_) {
      ok = false;
    } finally {
      if (ta.parentNode) ta.parentNode.removeChild(ta);
    }
    copyOutcome(btn, ok);
  };

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // Two-arg then, not .then().catch(): with a trailing .catch, a throw inside
      // the success handler would be mistaken for a clipboard rejection and would
      // run the fallback after we had already reported success.
      navigator.clipboard.writeText(text).then(() => copyOutcome(btn, true), fallback);
      return;
    }
  } catch (_) {
    /* fall through */
  }
  fallback();
}

// --- init --------------------------------------------------------------------
function init() {
  initMoneyInputs();
  const rows = $('rows');
  // Seed a Mon–Fri work week with a sensible 9–5 example on the first day.
  rows.appendChild(dayRow('Monday', '09:00', '17:00', '30'));
  rows.appendChild(dayRow('Tuesday', '09:00', '17:00', '30'));
  rows.appendChild(dayRow('Wednesday'));
  rows.appendChild(dayRow('Thursday'));
  rows.appendChild(dayRow('Friday'));

  $('addRow').addEventListener('click', () => {
    rows.appendChild(dayRow(nextDayLabel()));
    render();
  });
  $('rate').addEventListener('input', render);
  $('otOn').addEventListener('change', render);
  $('otThreshold').addEventListener('input', render);
  $('otMult').addEventListener('input', render);
  $('copyCard').addEventListener('click', copyCard);
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
