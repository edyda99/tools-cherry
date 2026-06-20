// fraction-calculator.js — fraction calculator UI.
// Add, subtract, multiply, or divide two fractions (mixed numbers allowed).
// Live results, graceful empty/invalid handling (never shows NaN).
// Pure math via the shared fraction engine. No deps, nothing uploaded.
import { calcFraction } from '/assets/fraction.js';

const $ = (id) => document.getElementById(id);

const OP_SIGN = { '+': '+', '-': '−', '*': '×', '/': '÷' };

const val = (id) => ($(id) ? $(id).value.trim() : '');
const intOrZero = (id) => {
  const v = val(id);
  if (v === '') return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
const intOrBlank = (id) => {
  const v = val(id);
  if (v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

function operandText({ whole, numer, denom }) {
  const w = whole || 0;
  const n = numer || 0;
  const d = denom;
  if (n === 0) return String(w);
  if (w === 0) return `${n}/${d}`;
  return `${w} ${n}/${d}`;
}

function mixedText(m) {
  if (!m) return '';
  const sign = m.sign < 0 ? '−' : '';
  if (m.numer === 0) return `${sign}${m.whole}`;
  if (m.whole === 0) return `${sign}${m.numer}/${m.denom}`;
  return `${sign}${m.whole} ${m.numer}/${m.denom}`;
}

function fmtDecimal(n) {
  if (!Number.isFinite(n)) return '';
  // Up to 6 decimal places, trimming trailing zeros.
  return parseFloat(n.toFixed(6)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function reset(out, sub, detail, msg) {
  out.textContent = '—';
  sub.textContent = msg || 'Enter two fractions to calculate.';
  detail.innerHTML = '';
}

function row(label, value) {
  return `<li><span class="lbl">${label}</span><span>${value}</span></li>`;
}

function calc() {
  const out = $('out');
  const sub = $('sub');
  const detail = $('detail');

  const op = val('op');

  // Denominators must be present and non-zero for a meaningful fraction; a blank
  // numerator/whole defaults to 0 (so "3/" or "2 _/4" still reads sensibly).
  const aDenom = intOrBlank('aDenom');
  const bDenom = intOrBlank('bDenom');
  if (!aDenom || !bDenom) return reset(out, sub, detail);

  const a = { whole: intOrZero('aWhole'), numer: intOrZero('aNumer'), denom: aDenom };
  const b = { whole: intOrZero('bWhole'), numer: intOrZero('bNumer'), denom: bDenom };

  const r = calcFraction({ a, op, b });
  if (r.error) return reset(out, sub, detail, r.error);

  const resultFrac = r.denom === 1 ? String(r.numer) : `${r.numer}/${r.denom}`;
  out.textContent = resultFrac;

  const expr = `${operandText(a)} ${OP_SIGN[op] || op} ${operandText(b)}`;
  sub.textContent = `${expr} = ${resultFrac}`;

  const detailRows = [
    row('Simplified', resultFrac),
    row('Mixed number', mixedText(r.mixed) || resultFrac),
    row('Decimal', fmtDecimal(r.decimal))
  ];
  detail.innerHTML = detailRows.join('');
}

function init() {
  document.querySelectorAll('#fractionForm input, #fractionForm select').forEach((el) =>
    el.addEventListener('input', calc)
  );
  calc();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
