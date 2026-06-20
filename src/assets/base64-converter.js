// base64-converter.js — encode/decode text to and from Base64 in the browser.
// All conversion runs locally via the pure base64 engine; nothing is uploaded.

import { encodeBase64, decodeBase64 } from '/assets/base64.js';

const $ = (id) => document.getElementById(id);

function urlSafe() {
  return $('urlSafe').checked;
}

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text || '';
  el.hidden = !text;
  el.classList.remove('ok', 'err');
  if (kind) el.classList.add(kind);
}

function run() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const input = $('input').value;
  const out = $('output');

  if (!input.trim()) {
    out.value = '';
    setStatus(mode === 'encode' ? 'Type text to encode.' : 'Paste Base64 to decode.', '');
    return;
  }

  try {
    out.value = mode === 'encode'
      ? encodeBase64(input, { urlSafe: urlSafe() })
      : decodeBase64(input, { urlSafe: urlSafe() });
    setStatus(mode === 'encode' ? 'Encoded.' : 'Decoded.', 'ok');
  } catch (err) {
    out.value = '';
    setStatus(err.message, 'err');
  }
}

// Keep the field labels in sync with the chosen direction.
function syncLabels() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  $('inputLabel').textContent = mode === 'encode' ? 'Text to encode' : 'Base64 to decode';
  $('outputLabel').textContent = mode === 'encode' ? 'Base64 result' : 'Decoded text';
  $('input').placeholder = mode === 'encode'
    ? 'Type or paste text…'
    : 'Paste Base64 here…';
}

async function copyOut() {
  const text = $('output').value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied to clipboard.', 'ok');
  } catch {
    setStatus('Copy failed — select the text and copy manually.', 'err');
  }
}

function clearAll() {
  $('input').value = '';
  $('output').value = '';
  setStatus('', '');
  $('input').focus();
}

function init() {
  $('input').addEventListener('input', run);
  $('urlSafe').addEventListener('change', run);
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => { syncLabels(); run(); }));
  $('copyBtn').addEventListener('click', copyOut);
  $('clearBtn').addEventListener('click', clearAll);
  syncLabels();
  run();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
