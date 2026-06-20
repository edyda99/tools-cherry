// roman-numeral-converter.js — two-way Roman numeral converter UI.
// Pure logic via the shared roman module. No deps, nothing uploaded.
import { toRoman, fromRoman } from '/assets/roman.js';

const $ = (id) => document.getElementById(id);

// Convert a number (typed in the "number" box) to a Roman numeral.
function updateToRoman() {
  const raw = $('numInput').value.trim();
  const out = $('romanOut');
  const err = $('numError');
  if (!raw) {
    out.textContent = '—';
    err.textContent = '';
    return;
  }
  const n = Number(raw);
  try {
    out.textContent = toRoman(n);
    err.textContent = '';
  } catch (e) {
    out.textContent = '—';
    err.textContent = e.message;
  }
}

// Convert a Roman numeral (typed in the "roman" box) to a number.
function updateFromRoman() {
  const raw = $('romanInput').value;
  const out = $('numOut');
  const err = $('romanError');
  if (!raw.trim()) {
    out.textContent = '—';
    err.textContent = '';
    return;
  }
  try {
    out.textContent = fromRoman(raw).toLocaleString('en-US');
    err.textContent = '';
  } catch (e) {
    out.textContent = '—';
    err.textContent = e.message;
  }
}

function init() {
  $('numInput').addEventListener('input', updateToRoman);
  $('romanInput').addEventListener('input', () => {
    // Keep the Roman input tidy: uppercase as the user types.
    const el = $('romanInput');
    const pos = el.selectionStart;
    el.value = el.value.toUpperCase();
    el.setSelectionRange(pos, pos);
    updateFromRoman();
  });
  updateToRoman();
  updateFromRoman();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
