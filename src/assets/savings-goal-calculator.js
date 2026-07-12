// savings-goal-calculator.js — "how much to save" / "how long to save" tool.
// Pure math via the shared savings-goal engine. No deps, nothing uploaded.
import { requiredContribution, timeToGoal } from '/assets/savings-goal.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

function money(n, max = 2) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: max
  });
}

function fmt(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Required field: blank/whitespace -> NaN ("not set yet").
function val(id) {
  const raw = $(id).value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}
// Optional field: blank -> 0, negatives ignored.
function optVal(id) {
  const raw = $(id).value.trim();
  if (raw === '') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function reset() {
  $('outBig').textContent = '—';
  $('outSub').textContent = '';
  ['startLine', 'depositsLine', 'interestLine', 'summaryBox'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = true;
  });
}

function show(lineId, label, value) {
  const line = $(lineId);
  if (!line) return;
  line.hidden = false;
  const lbl = line.querySelector('.lbl');
  const v = line.querySelector('.val');
  if (lbl) lbl.textContent = label;
  if (v) v.textContent = value;
}

function periodWord(perYear) {
  return perYear === 12 ? 'month' : perYear === 26 ? 'two weeks'
    : perYear === 52 ? 'week' : 'year';
}
function periodAdverb(perYear) {
  return perYear === 12 ? 'monthly' : perYear === 26 ? 'every two weeks'
    : perYear === 52 ? 'weekly' : 'yearly';
}

function durationText(years, months) {
  const parts = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' ') : 'less than a month';
}

function calcContribution(target, principal, ratePct, perYear) {
  const years = val('years');
  if (!Number.isFinite(years) || years <= 0) {
    $('outSub').textContent = 'Enter how many years you have to save.';
    return;
  }

  const r = requiredContribution(target, principal, ratePct, years, perYear);
  if (!Number.isFinite(r.contribution)) return;

  const word = periodWord(perYear);
  const adverb = periodAdverb(perYear);

  if (r.contribution === 0) {
    $('outBig').textContent = money(0);
    $('outSub').textContent = `Your ${money(principal)} alone reaches ${money(target)} in ${fmt(years)} year${years === 1 ? '' : 's'}.`;
  } else {
    $('outBig').textContent = money(r.contribution);
    $('outSub').textContent = `to save per ${word} to reach ${money(target)} in ${fmt(years)} year${years === 1 ? '' : 's'}`;
  }

  show('startLine', 'Starting balance', money(principal));
  show('depositsLine', 'Total you deposit', money(r.totalContributions));
  show('interestLine', 'Interest earned', money(r.totalInterest));
  $('interestLine').classList.add('total');

  $('summaryText').textContent = r.contribution === 0
    ? `With ${money(principal)} already saved at ${fmt(ratePct)}% a year, you reach your ${money(target)} goal in ${fmt(years)} year${years === 1 ? '' : 's'} without adding anything.`
    : `To reach ${money(target)} in ${fmt(years)} year${years === 1 ? '' : 's'}, save about ${money(r.contribution)} ${adverb}` +
      `${principal > 0 ? ` on top of your ${money(principal)} starting balance` : ''}, assuming ${fmt(ratePct)}% interest a year. ` +
      `You deposit ${money(r.totalContributions)} in total and earn ${money(r.totalInterest)} in interest.`;
  $('summaryBox').hidden = false;
}

function calcTime(target, principal, ratePct, perYear) {
  const contribution = optVal('deposit');
  if (contribution <= 0 && principal < target) {
    $('outSub').textContent = `Enter how much you can save per ${periodWord(perYear)}.`;
    return;
  }

  const r = timeToGoal(target, principal, ratePct, contribution, perYear);
  if (!Number.isFinite(r.periods)) {
    $('outBig').textContent = '—';
    $('outSub').textContent = 'At this rate the goal is not reached within 100 years. Increase your deposit or rate.';
    return;
  }

  const adverb = periodAdverb(perYear);
  $('outBig').textContent = durationText(r.years, r.months);
  $('outSub').textContent = `to reach ${money(target)} saving ${money(contribution)} ${adverb}`;

  show('startLine', 'Starting balance', money(principal));
  show('depositsLine', 'Total you deposit', money(r.totalContributions));
  show('interestLine', 'Interest earned', money(r.totalInterest));
  $('interestLine').classList.add('total');

  $('summaryText').textContent =
    `Saving ${money(contribution)} ${adverb}` +
    `${principal > 0 ? ` on top of ${money(principal)} already saved` : ''} at ${fmt(ratePct)}% a year, ` +
    `you reach ${money(target)} in about ${durationText(r.years, r.months)}. ` +
    `You deposit ${money(r.totalContributions)} and earn ${money(r.totalInterest)} in interest.`;
  $('summaryBox').hidden = false;
}

function calc() {
  reset();

  const mode = $('mode').value; // 'contribution' or 'time'
  const target = val('target');
  const principal = optVal('principal');
  const ratePct = optVal('rate');
  const perYear = parseInt($('frequency').value, 10) || 12;

  if (!Number.isFinite(target) || target <= 0) {
    $('outSub').textContent = 'Enter your savings goal to start.';
    return;
  }

  if (mode === 'time') calcTime(target, principal, ratePct, perYear);
  else calcContribution(target, principal, ratePct, perYear);
}

// Show the right input (years vs. deposit) for the chosen mode.
function syncMode() {
  const mode = $('mode').value;
  $('yearsField').hidden = mode !== 'contribution';
  $('depositField').hidden = mode !== 'time';
  calc();
}

function init() {
  $('mode').addEventListener('change', syncMode);
  document.querySelectorAll('#goalForm input, #goalForm select').forEach((el) =>
    el.addEventListener('input', calc)
  );
  syncMode();
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
