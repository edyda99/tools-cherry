// uuid-generator.js — random UUID (v4) generator. All randomness comes from the
// browser's crypto.getRandomValues via the pure uuid engine; nothing is uploaded.

import { generateMany, NIL_UUID } from '/assets/uuid.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

function currentOpts() {
  return {
    uppercase: $('uppercase').checked,
    hyphens: !$('nohyphens').checked,
    braces: $('braces').checked
  };
}

function setStatus(text) {
  const el = $('status');
  el.textContent = text || '';
  el.hidden = !text;
}

function generate() {
  const n = Number($('count').value) || 1;
  const list = generateMany(n, currentOpts());
  $('output').value = list.join('\n');
  setStatus(`Generated ${list.length} UUID${list.length === 1 ? '' : 's'}.`);
}

function copy(btn) {
  const text = $('output').value;
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
  const label = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = label; }, 1200);
}

function nil() {
  $('output').value = NIL_UUID;
  setStatus('Inserted the nil (all-zero) UUID.');
}

function clear() {
  $('output').value = '';
  setStatus('');
}

function init() {
  $('generateBtn').addEventListener('click', generate);
  $('copyBtn').addEventListener('click', () => copy($('copyBtn')));
  $('nilBtn').addEventListener('click', nil);
  $('clearBtn').addEventListener('click', clear);
  // Re-generate when formatting options or count change, if there's output to update.
  ['uppercase', 'nohyphens', 'braces', 'count'].forEach((id) => {
    $(id).addEventListener('change', () => { if ($('output').value) generate(); });
  });
  // Generate one on load so the tool is useful immediately.
  generate();
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
