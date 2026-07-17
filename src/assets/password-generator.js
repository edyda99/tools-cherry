// password-generator.js — strong random password generator, fully on-device.
// Randomness comes from the browser's CSPRNG (crypto.getRandomValues) with
// rejection sampling to avoid modulo bias. The deterministic parts (charset
// building, generation loop, strength scoring) live in the shared engine module
// so they can be unit-tested. Nothing is ever uploaded.
import {
  buildCharset,
  buildPools,
  generateFromPools,
  passwordStrength,
  entropyBits
} from '/assets/password.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

// --- Passphrase wordlist -----------------------------------------------------
// A small embedded list of short, common words. Embedded (not fetched) so the
// passphrase mode stays 100% client-side with no network. Entropy per word is
// log2(WORDLIST.length); 4+ words gives a strong, memorable passphrase.
const WORDLIST = [
  'apple', 'river', 'maple', 'stone', 'cloud', 'ember', 'frost', 'grove',
  'haven', 'ivory', 'jolly', 'koala', 'lemon', 'mango', 'noble', 'ocean',
  'pearl', 'quilt', 'raven', 'solar', 'tiger', 'umbra', 'vivid', 'wheat',
  'xenon', 'yacht', 'zebra', 'amber', 'brave', 'coral', 'delta', 'eagle',
  'flint', 'glide', 'honey', 'inlet', 'jewel', 'kayak', 'lunar', 'meadow',
  'nectar', 'olive', 'piano', 'quartz', 'rapid', 'spark', 'tulip', 'unity',
  'velvet', 'willow', 'yodel', 'zenith', 'breeze', 'canyon', 'dragon', 'falcon'
];

// Crypto-backed, unbiased integer in [0, maxExclusive). Rejection sampling:
// draw a full byte (0..255) and discard values in the biased tail so every
// index is equally likely. maxExclusive is always <= 256 here (our largest
// charset is well under that), so a single byte per draw is sufficient.
function cryptoRandomInt(maxExclusive) {
  if (maxExclusive <= 0) return 0;
  const limit = 256 - (256 % maxExclusive); // largest multiple of max that fits in a byte
  const buf = new Uint8Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % maxExclusive;
}

// Which generator the user has selected: 'password' (random chars) or
// 'passphrase' (random words). Falls back to 'password'.
function currentMode() {
  const el = $('pwMode');
  return el && el.value === 'passphrase' ? 'passphrase' : 'password';
}

// Read the current option toggles + length off the form.
function readOptions() {
  return {
    length: parseInt($('length').value, 10),
    uppercase: $('optUpper').checked,
    lowercase: $('optLower').checked,
    numbers: $('optNumbers').checked,
    symbols: $('optSymbols').checked,
    excludeAmbiguous: $('optAmbiguous').checked
  };
}

// Read the passphrase options off the form.
function readPassphraseOptions() {
  return {
    words: parseInt($('words').value, 10) || 4,
    separator: $('separator').value,
    capitalize: $('capitalize').checked,
    addNumber: $('addNumber').checked
  };
}

// Build a word-based passphrase, e.g. "River-Maple-Stone-Cloud7". Each word is
// drawn uniformly from WORDLIST via the same unbiased crypto RNG used for
// passwords; the optional trailing digit is appended to one random word.
function generatePassphrase(opts) {
  const count = Math.min(12, Math.max(2, Math.floor(opts.words) || 4));
  const sep = typeof opts.separator === 'string' ? opts.separator : '-';
  const words = [];
  for (let i = 0; i < count; i++) {
    let w = WORDLIST[cryptoRandomInt(WORDLIST.length)];
    if (opts.capitalize) w = w[0].toUpperCase() + w.slice(1);
    words.push(w);
  }
  if (opts.addNumber) {
    const which = cryptoRandomInt(count);
    words[which] += String(cryptoRandomInt(10));
  }
  return words.join(sep);
}

const STRENGTH_CLASS = ['vw', 'weak', 'fair', 'strong', 'vs'];
// Plain-English guess-difficulty gloss, indexed the same as STRENGTH_CLASS /
// the 0..4 score. Shown instead of a raw entropy-bits count.
const GUESS_DESC = ['extremely easy to guess', 'easy to guess', 'somewhat guessable', 'hard to guess', 'extremely hard to guess'];

function renderStrength(pw, bits) {
  const { score, label } = passwordStrength(pw);
  const bar = $('strengthBar');
  const txt = $('strengthLabel');
  bar.className = 'strength-bar ' + (STRENGTH_CLASS[score] || 'vw');
  bar.style.width = ((score / 4) * 100) + '%';
  txt.textContent = pw ? `${label} (${GUESS_DESC[score] || GUESS_DESC[0]})` : '';
}

// Map an entropy estimate (bits) onto the same 0..4 meter scale used by the
// char-password strength scorer, so passphrases get a fair, length-aware bar
// instead of being marked weak for being all-lowercase words.
function strengthFromBits(bits) {
  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
  let score;
  if (bits < 28) score = 0;
  else if (bits < 36) score = 1;
  else if (bits < 60) score = 2;
  else if (bits < 128) score = 3;
  else score = 4;
  return { score, label: labels[score] };
}

// Render the meter from a precomputed { score, label } and entropy bits.
function renderMeter(score, label, bits, hasValue) {
  const bar = $('strengthBar');
  const txt = $('strengthLabel');
  bar.className = 'strength-bar ' + (STRENGTH_CLASS[score] || 'vw');
  bar.style.width = ((score / 4) * 100) + '%';
  txt.textContent = hasValue ? `${label} (${GUESS_DESC[score] || GUESS_DESC[0]})` : '';
}

function generatePasswordOutput() {
  const opts = readOptions();
  const charset = buildCharset(opts);
  const out = $('output');
  const err = $('genError');

  // Guard: at least one character set must be selected.
  if (!charset) {
    out.value = '';
    err.hidden = false;
    err.textContent = 'Pick at least one character type (uppercase, lowercase, numbers, or symbols).';
    renderStrength('', 0);
    return;
  }
  err.hidden = true;

  const pools = buildPools(opts);
  const pw = generateFromPools(pools, opts.length, cryptoRandomInt);
  out.value = pw;
  renderStrength(pw, entropyBits(charset.length, pw.length));
}

function generatePassphraseOutput() {
  const opts = readPassphraseOptions();
  const phrase = generatePassphrase(opts);
  $('output').value = phrase;
  $('genError').hidden = true;
  // Passphrase entropy: words × log2(listSize), plus the optional appended digit.
  const bits = opts.words * Math.log2(WORDLIST.length) + (opts.addNumber ? Math.log2(10) : 0);
  const { score, label } = strengthFromBits(bits);
  renderMeter(score, label, bits, !!phrase);
}

function generate() {
  if (currentMode() === 'passphrase') generatePassphraseOutput();
  else generatePasswordOutput();
}

async function copyToClipboard() {
  const text = $('output').value;
  if (!text) return;
  const btn = $('copyBtn');
  const done = () => {
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = old;
      btn.classList.remove('copied');
    }, 1400);
  };

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      done();
      return;
    }
  } catch (_) {
    // fall through to the legacy path below
  }

  // Fallback for older browsers / insecure contexts: select + execCommand.
  const out = $('output');
  out.removeAttribute('readonly');
  out.select();
  out.setSelectionRange(0, text.length);
  try {
    document.execCommand('copy');
    done();
  } catch (_) {
    /* clipboard unavailable — leave the value selected for manual copy */
  }
  out.setAttribute('readonly', 'readonly');
}

function syncLength() {
  $('lengthVal').textContent = $('length').value;
}

function syncWords() {
  const el = $('wordsVal');
  if (el) el.textContent = $('words').value;
}

// Show the option group for the active mode and update the Generate button label.
function syncMode() {
  const mode = currentMode();
  const pwGroup = $('passwordOpts');
  const ppGroup = $('passphraseOpts');
  if (pwGroup) pwGroup.hidden = mode !== 'password';
  if (ppGroup) ppGroup.hidden = mode !== 'passphrase';
  const btn = $('genBtn');
  if (btn) btn.textContent = mode === 'passphrase' ? 'Generate passphrase' : 'Generate password';
  generate();
}

function init() {
  // Keep the number readout in sync and regenerate live as options change.
  $('length').addEventListener('input', () => { syncLength(); generate(); });
  ['optUpper', 'optLower', 'optNumbers', 'optSymbols', 'optAmbiguous'].forEach((id) =>
    $(id).addEventListener('change', generate)
  );

  const mode = $('pwMode');
  if (mode) mode.addEventListener('change', syncMode);

  // Passphrase controls (present only when the template includes the mode UI).
  const words = $('words');
  if (words) words.addEventListener('input', () => { syncWords(); generate(); });
  ['separator', 'capitalize', 'addNumber'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('change', generate);
  });

  $('genBtn').addEventListener('click', generate);
  $('copyBtn').addEventListener('click', copyToClipboard);

  syncLength();
  syncWords();
  syncMode(); // sets visible group + label and generates one ready to use
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
