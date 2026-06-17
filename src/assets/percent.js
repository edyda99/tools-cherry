// percent.js — client-side Percentage Calculator UI. Three independent modes
// (What is P% of X · X is what % of Y · percent change from A to B) each read
// their own inputs and defer all arithmetic to the pure engine (percent-math.js)
// so the math is the same code path the unit tests cover. No network, no
// storage — every calculation runs in the browser.

import { percentOf, percentIsWhatOf, percentChange, roundTo } from '/assets/percent-math.js';

const $ = (id) => document.getElementById(id);

// Format a number for display: trim to 2 decimals but drop trailing zeros so
// whole results read cleanly (10 not 10.00) while fractions keep precision.
function fmt(n) {
  if (!Number.isFinite(n)) return '';
  const r = roundTo(n, 2);
  return r.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Read a numeric input; empty string -> NaN so partial input renders nothing.
function val(id) {
  const el = $(id);
  if (!el) return NaN;
  const raw = el.value.trim();
  if (raw === '') return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function setOut(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function renderOf() {
  const p = val('ofPercent');
  const b = val('ofBase');
  const r = percentOf(p, b);
  setOut('ofResult', Number.isNaN(r)
    ? '—'
    : `${fmt(p)}% of ${fmt(b)} is ${fmt(r)}`);
}

function renderWhat() {
  const part = val('whatPart');
  const whole = val('whatWhole');
  const r = percentIsWhatOf(part, whole);
  setOut('whatResult', Number.isNaN(r)
    ? '—'
    : `${fmt(part)} is ${fmt(r)}% of ${fmt(whole)}`);
}

function renderChange() {
  const from = val('changeFrom');
  const to = val('changeTo');
  const r = percentChange(from, to);
  if (Number.isNaN(r)) { setOut('changeResult', '—'); return; }
  const dir = r > 0 ? 'increase' : r < 0 ? 'decrease' : 'change';
  setOut('changeResult', `From ${fmt(from)} to ${fmt(to)} is a ${fmt(Math.abs(r))}% ${dir}`);
}

function wire(ids, fn) {
  ids.forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', fn);
  });
  fn();
}

function init() {
  wire(['ofPercent', 'ofBase'], renderOf);
  wire(['whatPart', 'whatWhole'], renderWhat);
  wire(['changeFrom', 'changeTo'], renderChange);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
