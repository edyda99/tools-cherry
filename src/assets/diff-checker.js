// diff-checker.js — compare two blocks of text and render a line-by-line diff.
// All comparison happens in the browser via the pure text-diff engine; nothing
// is uploaded.

import { diffLines, diffStats } from '/assets/text-diff.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

const SIGN = { equal: ' ', add: '+', remove: '-' };

function currentOpts() {
  return {
    ignoreCase: $('ignoreCase').checked,
    ignoreWhitespace: $('ignoreWhitespace').checked
  };
}

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text || '';
  el.hidden = !text;
  el.classList.remove('ok', 'err');
  if (kind) el.classList.add(kind);
}

function render() {
  const a = $('textA').value;
  const b = $('textB').value;
  const out = $('output');
  out.textContent = '';

  if (!a && !b) {
    setStatus('Paste text in both boxes to compare.', '');
    return;
  }

  const rows = diffLines(a, b, currentOpts());
  const frag = document.createDocumentFragment();
  rows.forEach((r) => {
    const div = document.createElement('div');
    div.className = 'diff-row diff-' + r.type;
    const sign = document.createElement('span');
    sign.className = 'diff-sign';
    sign.textContent = SIGN[r.type];
    const text = document.createElement('span');
    text.className = 'diff-text';
    // Preserve empty lines visibly by falling back to a zero-width space.
    text.textContent = r.line === '' ? '​' : r.line;
    div.appendChild(sign);
    div.appendChild(text);
    frag.appendChild(div);
  });
  out.appendChild(frag);

  const s = diffStats(rows);
  if (s.added === 0 && s.removed === 0) {
    setStatus('The two texts are identical.', 'ok');
  } else {
    setStatus(`${s.added} added · ${s.removed} removed · ${s.unchanged} unchanged.`, '');
  }
}

function swap() {
  const a = $('textA').value;
  $('textA').value = $('textB').value;
  $('textB').value = a;
  render();
}

function clear() {
  $('textA').value = '';
  $('textB').value = '';
  $('output').textContent = '';
  setStatus('', '');
}

function init() {
  $('compareBtn').addEventListener('click', render);
  $('swapBtn').addEventListener('click', swap);
  $('clearBtn').addEventListener('click', clear);
  ['textA', 'textB'].forEach((id) => $(id).addEventListener('input', render));
  ['ignoreCase', 'ignoreWhitespace'].forEach((id) =>
    $(id).addEventListener('change', render));
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
