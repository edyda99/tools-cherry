// random-number-generator.js — random number generator UI.
// Draws cryptographically strong random integers in a range, with optional
// "no repeats" and a copyable result. Pure math via the shared engine module;
// the entropy comes from crypto.getRandomValues (falls back to Math.random on
// ancient browsers). No deps, nothing uploaded.
import { normalizeRange, rangeSize, randomInts } from '/assets/random-number.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

// A randomFn returning a float in [0, 1), backed by the Web Crypto CSPRNG.
// Uses a fresh 32-bit unsigned int per call for uniform spread.
function cryptoRandom() {
  const c = globalThis.crypto || globalThis.msCrypto;
  if (c && c.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 4294967296; // [0, 1)
  }
  return Math.random();
}

const isBlank = (id) => !$(id) || $(id).value.trim() === '';

function reset(msg) {
  $('resultBig').textContent = '—';
  $('resultSub').textContent = msg || 'Set a range and press Generate.';
  $('resultList').hidden = true;
  $('resultList').innerHTML = '';
  $('copyBtn').hidden = true;
}

let lastText = '';

function generate() {
  if (isBlank('min') || isBlank('max') || isBlank('count')) {
    return reset('Enter a minimum, maximum, and how many numbers.');
  }

  const r = normalizeRange($('min').value, $('max').value);
  if (!r.ok) return reset('Enter whole numbers for the minimum and maximum.');

  let count = Math.trunc(parseFloat($('count').value));
  if (!Number.isFinite(count) || count < 1) {
    return reset('Enter how many numbers to generate (1 or more).');
  }
  count = Math.min(count, 1000); // sane cap for the on-page list

  const unique = $('unique').checked;
  const size = rangeSize(r.min, r.max);

  if (unique && count > size) {
    return reset(
      `Only ${size.toLocaleString('en-US')} unique number${size === 1 ? '' : 's'} ` +
      `fit in ${r.min}–${r.max}. Lower the count or turn off "No repeats".`
    );
  }

  const nums = randomInts(r.min, r.max, count, { unique, randomFn: cryptoRandom });
  if (!nums.length) return reset();

  lastText = nums.join(', ');

  if (nums.length === 1) {
    $('resultBig').textContent = nums[0].toLocaleString('en-US');
    $('resultSub').textContent = `Random number between ${r.min} and ${r.max}`;
    $('resultList').hidden = true;
    $('resultList').innerHTML = '';
  } else {
    $('resultBig').textContent = `${nums.length} numbers`;
    $('resultSub').textContent =
      `Between ${r.min} and ${r.max}${unique ? ', no repeats' : ''}`;
    const list = $('resultList');
    list.hidden = false;
    list.innerHTML = '';
    for (const n of nums) {
      const span = document.createElement('span');
      span.className = 'rng-chip';
      span.textContent = n.toLocaleString('en-US');
      list.appendChild(span);
    }
  }

  $('copyBtn').hidden = false;
}

async function copyResult() {
  if (!lastText) return;
  const btn = $('copyBtn');
  try {
    await navigator.clipboard.writeText(lastText);
  } catch {
    // Fallback for browsers without the async clipboard API.
    const ta = document.createElement('textarea');
    ta.value = lastText;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }
  const old = btn.textContent;
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = old;
    btn.classList.remove('copied');
  }, 1400);
}

function init() {
  $('genBtn').addEventListener('click', generate);
  $('copyBtn').addEventListener('click', copyResult);
  // Enter inside the form generates instead of submitting.
  $('rngForm').addEventListener('submit', (e) => {
    e.preventDefault();
    generate();
  });
  reset();
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
