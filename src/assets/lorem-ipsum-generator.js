// lorem-ipsum-generator.js — Lorem Ipsum generator UI.
// Live results, graceful empty/invalid handling (never shows NaN).
// Pure generation via the shared lorem engine module. No deps, nothing uploaded.
import { generate } from '/assets/lorem.js';

const $ = (id) => document.getElementById(id);

const val = (id) => ($(id) ? $(id).value.trim() : '');
const numOrBlank = (id) => (val(id) === '' ? null : parseInt(val(id), 10));

function render() {
  const unit = val('unit') || 'paragraphs';
  const rawCount = numOrBlank('count');
  const count = rawCount == null || !(rawCount >= 0) ? 5 : rawCount;
  const startWithLorem = $('startWithLorem') ? $('startWithLorem').checked : true;
  const seed = window.__loremSeed || 1;

  const r = generate({ unit, count, startWithLorem, seed });

  const out = $('out');
  const sub = $('sub');

  if (!r.text) {
    out.value = '';
    sub.textContent = 'Enter a count greater than zero to generate placeholder text.';
    return;
  }

  out.value = r.text;
  const unitLabel = unit === 'words' ? 'word' : unit === 'sentences' ? 'sentence' : 'paragraph';
  sub.textContent =
    `${count.toLocaleString('en-US')} ${unitLabel}${count === 1 ? '' : 's'} · ` +
    `${r.words.toLocaleString('en-US')} words · ${r.text.length.toLocaleString('en-US')} characters`;
}

async function copyOut() {
  const out = $('out');
  const btn = $('copyBtn');
  if (!out.value) return;
  try {
    await navigator.clipboard.writeText(out.value);
    const prev = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = prev), 1500);
  } catch (_) {
    // Fallback: select the text so the user can copy manually.
    out.focus();
    out.select();
  }
}

function regenerate() {
  // New random seed → fresh text on each click of "Regenerate".
  window.__loremSeed = (Math.floor(Math.random() * 2147483647) || 1);
  render();
}

function init() {
  window.__loremSeed = 1;
  document.querySelectorAll('#loremForm input, #loremForm select').forEach((el) =>
    el.addEventListener('input', render)
  );
  const copyBtn = $('copyBtn');
  if (copyBtn) copyBtn.addEventListener('click', copyOut);
  const regenBtn = $('regenBtn');
  if (regenBtn) regenBtn.addEventListener('click', regenerate);
  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
