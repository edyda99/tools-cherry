// json-formatter.js — JSON formatter, validator and minifier. All parsing runs
// in the browser via the pure json-format engine; nothing is uploaded.

import { validateJson, formatJson, minifyJson } from '/assets/json-format.js';

const $ = (id) => document.getElementById(id);

function setStatus(kind, text) {
  const el = $('status');
  el.textContent = text || '';
  el.hidden = !text;
  el.className = 'json-status' + (kind ? ' ' + kind : '');
}

function currentIndent() {
  const v = $('indent').value;
  return v === 'tab' ? 'tab' : Number(v);
}

function validate() {
  const r = validateJson($('input').value);
  if (r.ok) {
    setStatus('ok', 'Valid JSON.');
  } else {
    const where = r.line ? ` (line ${r.line}, column ${r.column})` : '';
    setStatus('err', r.message + where);
  }
  return r.ok;
}

function format() {
  try {
    $('input').value = formatJson($('input').value, currentIndent());
    setStatus('ok', 'Formatted.');
  } catch (e) {
    const where = e.line ? ` (line ${e.line}, column ${e.column})` : '';
    setStatus('err', e.message + where);
  }
}

function minify() {
  try {
    $('input').value = minifyJson($('input').value);
    setStatus('ok', 'Minified.');
  } catch (e) {
    const where = e.line ? ` (line ${e.line}, column ${e.column})` : '';
    setStatus('err', e.message + where);
  }
}

function copy(btn) {
  const text = $('input').value;
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
  const label = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = label; }, 1200);
}

function clear() {
  $('input').value = '';
  setStatus('', '');
  $('input').focus();
}

function init() {
  $('formatBtn').addEventListener('click', format);
  $('minifyBtn').addEventListener('click', minify);
  $('validateBtn').addEventListener('click', validate);
  $('copyBtn').addEventListener('click', () => copy($('copyBtn')));
  $('clearBtn').addEventListener('click', clear);
  // Clear stale status as soon as the user starts editing again.
  $('input').addEventListener('input', () => setStatus('', ''));
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
