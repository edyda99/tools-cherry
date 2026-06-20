// average-calculator.js — average / mean-median-mode calculator UI.
// Live results, graceful empty/invalid handling (never shows NaN).
// Pure math via the shared average engine module. No deps, nothing uploaded.
import { summarize } from '/assets/average.js';

const $ = (id) => document.getElementById(id);

// Format a number for display: trims pointless trailing zeros but keeps real
// decimals. Falls back to a dash for null (no data).
function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  // Round to a sane number of places, then strip trailing zeros.
  const rounded = Math.round(n * 1e6) / 1e6;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function fmtList(arr) {
  if (!arr || !arr.length) return 'none';
  return arr.map(fmt).join(', ');
}

function row(label, value) {
  return `<li><span class="lbl">${label}</span><span>${value}</span></li>`;
}

function reset(out, sub, detail, msg) {
  out.textContent = '—';
  sub.textContent = msg || 'Enter some numbers to see the average and more.';
  detail.innerHTML = '';
}

function calc() {
  const out = $('out');
  const sub = $('sub');
  const detail = $('detail');
  const warn = $('warn');

  const r = summarize($('numbers') ? $('numbers').value : '');

  // Surface any tokens that weren't valid numbers, without dropping silently.
  if (warn) {
    if (r.invalid && r.invalid.length) {
      warn.textContent = `Ignored ${r.invalid.length} entr${r.invalid.length === 1 ? 'y' : 'ies'} that aren't numbers: ${r.invalid.slice(0, 8).join(', ')}${r.invalid.length > 8 ? '…' : ''}`;
      warn.hidden = false;
    } else {
      warn.textContent = '';
      warn.hidden = true;
    }
  }

  if (!r.count) return reset(out, sub, detail);

  out.textContent = fmt(r.mean);
  sub.textContent =
    r.count === 1
      ? 'Mean (average) of 1 value'
      : `Mean (average) of ${r.count.toLocaleString('en-US')} values`;

  const detailRows = [
    row('Count', r.count.toLocaleString('en-US')),
    row('Sum', fmt(r.sum)),
    row('Mean (average)', fmt(r.mean)),
    row('Median (middle)', fmt(r.median)),
    row('Mode (most frequent)', fmtList(r.mode)),
    row('Minimum', fmt(r.min)),
    row('Maximum', fmt(r.max)),
    row('Range', fmt(r.range)),
    row('Std. deviation (population)', fmt(r.stdDevPop)),
    row('Std. deviation (sample)', fmt(r.stdDevSample))
  ];
  detail.innerHTML = detailRows.join('');
}

function init() {
  const input = $('numbers');
  if (input) input.addEventListener('input', calc);
  calc();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
