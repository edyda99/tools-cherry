// words-to-minutes.js — Words to Minutes (Speech Time Calculator), live results.
// Pure math via the shared words-to-time engine. No deps, nothing uploaded.
//
// One obvious way to provide the word count: you either type a number OR paste
// text. Pasting text auto-counts and fills the count field; typing in the count
// field on its own works too. Whichever you touch last wins, and the count
// field always shows the number actually used.
import { compute, countWords, PACE_PRESETS } from '/assets/words-to-time.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');

// Read a non-negative integer word count from the count field; '' -> NaN.
function countVal() {
  const raw = $('wordCount').value.trim();
  if (raw === '') return NaN;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

// Read the active speaking pace in wpm. A preset button sets the custom field;
// the custom field is always the source of truth so there is one value to read.
function paceVal() {
  const raw = $('wpm').value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function reset() {
  $('speakBig').textContent = '—';
  $('speakSub').textContent = '';
  ['readLine', 'wordsLine', 'paceLine', 'summaryBox'].forEach((id) => {
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

// Highlight the preset whose wpm matches the current custom value (if any).
function syncPresetButtons(wpm) {
  document.querySelectorAll('#pacePresets button[data-wpm]').forEach((btn) => {
    const match = Number(btn.dataset.wpm) === wpm;
    btn.setAttribute('aria-pressed', match ? 'true' : 'false');
  });
}

function calc() {
  reset();

  const words = countVal();
  const wpm = paceVal();

  syncPresetButtons(wpm);

  if (!Number.isFinite(words)) {
    $('speakSub').textContent = 'Enter a word count, or paste your text above.';
    return;
  }
  if (words === 0) {
    $('speakSub').textContent = 'Enter a word count, or paste your text above.';
    return;
  }
  if (!Number.isFinite(wpm)) {
    $('speakSub').textContent = 'Pick a speaking pace or enter words per minute.';
    return;
  }

  const r = compute(words, wpm);
  if (!r.valid) return;

  // Big number: speaking time as m:ss; sub: the friendly "about X minutes".
  $('speakBig').textContent = r.speakingClock;
  $('speakSub').textContent =
    `Speaking time — ${r.speakingFriendly} at ${nf.format(r.wpm)} words per minute`;

  show('readLine', 'Silent reading time (≈238 wpm)', `${r.readingClock} (${r.readingFriendly})`);
  show('wordsLine', 'Word count', nf.format(r.words));
  show('paceLine', 'Speaking pace', `${nf.format(r.wpm)} wpm`);
  $('paceLine').classList.add('total');

  $('summaryText').textContent =
    `${nf.format(r.words)} word${r.words === 1 ? '' : 's'} take ${r.speakingFriendly} to say ` +
    `at ${nf.format(r.wpm)} words per minute (${r.speakingClock}), and ${r.readingFriendly} ` +
    `to read silently at about 238 words per minute (${r.readingClock}).`;
  $('summaryBox').hidden = false;
}

// Pasting/typing text updates the count field, then recalculates. The textarea
// is a convenience to get the number — the count field shows what's actually used.
function syncFromText() {
  const text = $('text').value;
  if (text.trim() === '') {
    // Don't clobber a hand-typed count when the textarea is empty.
    calc();
    return;
  }
  $('wordCount').value = String(countWords(text));
  calc();
}

// Typing directly in the count field means the user is overriding the textarea,
// so clear the textarea to avoid two competing sources of the same number.
function syncFromCount() {
  if ($('text').value.trim() !== '') $('text').value = '';
  calc();
}

function init() {
  $('text').addEventListener('input', syncFromText);
  $('wordCount').addEventListener('input', syncFromCount);
  $('wpm').addEventListener('input', calc);

  // Preset buttons just set the custom wpm field (single source of truth).
  document.querySelectorAll('#pacePresets button[data-wpm]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('wpm').value = btn.dataset.wpm;
      calc();
    });
  });

  // Default the custom field to the Average preset if it starts blank.
  if ($('wpm').value.trim() === '') $('wpm').value = String(PACE_PRESETS.average);

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
