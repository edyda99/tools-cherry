// password.js — client-side Password Generator UI. Reads the options from the
// form and defers all generation + strength math to the pure engine
// (password-gen.js), which is the same code path the unit tests cover. The only
// browser surface here is the CSPRNG (crypto.getRandomValues) and the clipboard.
// No network, no storage — everything happens in the browser.

import {
  generatePassword, generatePassphrase, buildPool,
  estimateStrength, WORDLIST_SIZE
} from '/assets/password-gen.js';

const $ = (id) => document.getElementById(id);

// CSPRNG adapter matching the engine's rng(buf) contract.
const rng = (buf) => crypto.getRandomValues(buf);

function currentMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : 'password';
}

function passwordOpts() {
  return {
    length: Number($('length').value) || 16,
    lowercase: $('lowercase').checked,
    uppercase: $('uppercase').checked,
    numbers: $('numbers').checked,
    symbols: $('symbols').checked,
    avoidAmbiguous: $('avoidAmbiguous').checked
  };
}

function passphraseOpts() {
  return {
    words: Number($('words').value) || 4,
    separator: $('separator').value || '-',
    capitalize: $('capitalize').checked,
    number: $('addNumber').checked
  };
}

const BAR_CLASS = ['vw', 'weak', 'fair', 'strong', 'vs'];

function renderStrength(bits, label, score) {
  const bar = $('strengthBar');
  bar.style.width = `${Math.min(100, (score + 1) * 20)}%`;
  bar.className = 'strength-bar ' + (BAR_CLASS[score] || 'vw');
  const labelEl = $('strengthLabel');
  labelEl.textContent = label && bits > 0
    ? `${label} — ~${Math.round(bits)} bits of entropy`
    : '';
}

function generate() {
  const out = $('output');
  const errEl = $('error');
  errEl.hidden = true;
  try {
    if (currentMode() === 'passphrase') {
      const opts = passphraseOpts();
      const phrase = generatePassphrase(opts, rng);
      out.value = phrase;
      // Passphrase entropy: words * log2(listSize), plus the optional digit.
      const bits = opts.words * Math.log2(WORDLIST_SIZE) + (opts.number ? Math.log2(10) : 0);
      const s = estimateStrength(1, Math.pow(2, bits)); // reuse bucket labels
      renderStrength(bits, s.label, s.score);
    } else {
      const opts = passwordOpts();
      const { pool } = buildPool(opts);
      const pw = generatePassword(opts, rng);
      out.value = pw;
      const s = estimateStrength(pw.length, pool.length);
      renderStrength(s.bits, s.label, s.score);
    }
  } catch (e) {
    out.value = '';
    errEl.textContent = e.message || 'Could not generate a password.';
    errEl.hidden = false;
    renderStrength(0, '', 0);
  }
}

// Keep at least one character class selected in password mode.
function guardClasses(changed) {
  const boxes = ['lowercase', 'uppercase', 'numbers', 'symbols'].map($);
  if (!boxes.some((b) => b.checked)) {
    // Re-check the one the user just unchecked so a class is always active.
    changed.checked = true;
  }
}

async function copyOutput() {
  const out = $('output');
  if (!out.value) return;
  const btn = $('copyBtn');
  try {
    await navigator.clipboard.writeText(out.value);
  } catch (_) {
    // Fallback for browsers without the async clipboard API.
    out.select();
    document.execCommand('copy');
  }
  const prev = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = prev; }, 1200);
}

function syncModeUI() {
  const mode = currentMode();
  $('passwordOpts').hidden = mode !== 'password';
  $('passphraseOpts').hidden = mode !== 'passphrase';
  generate();
}

function syncLengthLabel() {
  $('lengthValue').textContent = $('length').value;
}

function syncWordsLabel() {
  $('wordsValue').textContent = $('words').value;
}

function init() {
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', syncModeUI));

  $('length').addEventListener('input', () => { syncLengthLabel(); generate(); });
  $('words').addEventListener('input', () => { syncWordsLabel(); generate(); });

  ['lowercase', 'uppercase', 'numbers', 'symbols'].forEach((id) =>
    $(id).addEventListener('change', (e) => { guardClasses(e.target); generate(); }));

  ['avoidAmbiguous', 'separator', 'capitalize', 'addNumber'].forEach((id) =>
    $(id).addEventListener('change', generate));

  $('regenBtn').addEventListener('click', generate);
  $('copyBtn').addEventListener('click', copyOutput);

  syncLengthLabel();
  syncWordsLabel();
  generate();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
