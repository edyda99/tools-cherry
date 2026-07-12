// base-converter.js — binary / octal / decimal / hex converter UI.
// Pure logic via the shared number-base module. No deps, nothing uploaded.
import { parseInBase, formatInBase } from '/assets/number-base.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

// Each row: the input id, its base, and the error line id.
const ROWS = [
  { id: 'binInput', base: 2, err: 'binError' },
  { id: 'octInput', base: 8, err: 'octError' },
  { id: 'decInput', base: 10, err: 'decError' },
  { id: 'hexInput', base: 16, err: 'hexError' }
];

function clearErrors() {
  for (const r of ROWS) $(r.err).textContent = '';
}

// When the user types in one field, parse it and rewrite every other field.
function syncFrom(source) {
  clearErrors();
  const raw = $(source.id).value;
  if (!raw.trim()) {
    // Empty source clears all the other outputs too.
    for (const r of ROWS) {
      if (r.id !== source.id) $(r.id).value = '';
    }
    return;
  }
  let value;
  try {
    value = parseInBase(raw, source.base);
  } catch (e) {
    $(source.err).textContent = e.message;
    for (const r of ROWS) {
      if (r.id !== source.id) $(r.id).value = '';
    }
    return;
  }
  for (const r of ROWS) {
    if (r.id !== source.id) $(r.id).value = formatInBase(value, r.base);
  }
}

function init() {
  for (const r of ROWS) {
    $(r.id).addEventListener('input', () => syncFrom(r));
  }
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
