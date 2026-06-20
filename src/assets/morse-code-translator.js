// morse-code-translator.js — translate between text and Morse code, live.
// Pure logic via the shared morse engine. No deps, nothing uploaded.
import { textToMorse, morseToText } from '/assets/morse.js';

const $ = (id) => document.getElementById(id);

function placeholderFor(mode) {
  return mode === 'decode'
    ? 'Paste Morse code, e.g. ... --- ...'
    : 'Type text to convert, e.g. Hello world';
}

function calc() {
  const mode = $('mode').value === 'decode' ? 'decode' : 'encode';
  const input = $('input');
  const out = $('out');
  const status = $('status');

  input.placeholder = placeholderFor(mode);
  const value = input.value;

  const result = mode === 'encode' ? textToMorse(value) : morseToText(value);
  out.value = result;

  if (!value.trim()) {
    status.textContent = mode === 'encode'
      ? 'Type some text to see the Morse code.'
      : 'Paste Morse code to decode it.';
  } else if (mode === 'decode' && result.includes('?')) {
    status.textContent = 'Decoded — “?” marks a sequence that isn’t valid Morse.';
  } else {
    status.textContent = mode === 'encode' ? 'Translated to Morse code.' : 'Decoded to text.';
  }
}

async function copyOut() {
  const out = $('out');
  if (!out.value) return;
  try {
    await navigator.clipboard.writeText(out.value);
    $('status').textContent = 'Copied to clipboard.';
  } catch (_) {
    out.select();
    document.execCommand && document.execCommand('copy');
    $('status').textContent = 'Copied.';
  }
}

function swap() {
  // Move the output into the input and flip the mode, so you can round-trip.
  const out = $('out').value;
  $('mode').value = $('mode').value === 'decode' ? 'encode' : 'decode';
  $('input').value = out;
  calc();
}

function init() {
  $('input').addEventListener('input', calc);
  $('mode').addEventListener('change', calc);
  $('copy').addEventListener('click', copyOut);
  $('swap').addEventListener('click', swap);
  calc();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
