// ez-grader.js — EZ Grader test-score calculator, live results.
// Pure math via the shared grading engine. No deps, nothing uploaded.
import { grade, chart } from '/assets/grading.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);

function pct(n, dp = 1) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp }) + '%';
}
function fmt(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Read a number field; blank/whitespace -> NaN ("not set yet").
function val(id) {
  const el = $(id);
  if (!el) return NaN;
  const raw = el.value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}

function activeScale() {
  const checked = document.querySelector('input[name="scale"]:checked');
  return checked ? checked.value : 'simple';
}

function show(lineId, label, value) {
  const line = $(lineId);
  if (!line) return;
  line.hidden = false;
  const lbl = line.querySelector('.lbl');
  const v = line.querySelector('.val');
  if (lbl) lbl.textContent = label;
  if (v) v.textContent = value;
}

function reset() {
  $('scoreBig').textContent = '—';
  $('scoreSub').textContent = '';
  ['gradeLine', 'correctLine', 'wrongLine', 'totalLine', 'summaryBox', 'chartWrap'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = true;
  });
}

function buildChart(rows) {
  const tbody = $('chartBody');
  let html = '';
  for (const row of rows) {
    html += `<tr><td>${row.wrong}</td><td>${fmt(row.correct)}</td><td>${pct(row.scorePercent)}</td><td>${row.letter}</td></tr>`;
  }
  tbody.innerHTML = html;
}

function calc() {
  reset();

  const total = val('total');
  const wrongRaw = val('wrong');
  const scale = activeScale();

  if (!Number.isFinite(total) || total <= 0) {
    $('scoreSub').textContent = 'Enter how many questions (or points) the test is out of.';
    return;
  }

  // The engine clamps wrong into [0, total]; default a blank field to 0.
  const wrongInput = Number.isFinite(wrongRaw) ? wrongRaw : 0;
  const r = grade(total, wrongInput, scale);
  if (!Number.isFinite(r.scorePercent)) return;

  // If the typed value was out of range, gently nudge the field back in range
  // so the input and the result never disagree.
  if (Number.isFinite(wrongRaw) && (wrongRaw < 0 || wrongRaw > total)) {
    $('wrong').value = String(r.wrong);
  }

  $('scoreBig').textContent = pct(r.scorePercent);
  $('scoreSub').textContent =
    `${fmt(r.correct)} of ${fmt(r.total)} correct — grade ${r.letter}`;

  show('gradeLine', 'Letter grade', r.letter);
  show('correctLine', 'Correct', fmt(r.correct));
  show('wrongLine', 'Wrong', fmt(r.wrong));
  show('totalLine', 'Out of', fmt(r.total));
  $('totalLine').classList.add('total');

  $('summaryText').textContent =
    `A student who got ${fmt(r.wrong)} out of ${fmt(r.total)} wrong scores ` +
    `${pct(r.scorePercent)} — a ${r.letter} on the ` +
    `${scale === 'plusminus' ? 'plus/minus' : 'standard'} scale.`;
  $('summaryBox').hidden = false;

  buildChart(chart(total, scale));
  $('chartWrap').hidden = false;
}

function copyChart() {
  const btn = $('copyChartBtn');
  if (!btn) return;
  const rows = Array.from($('chartBody').querySelectorAll('tr'));
  if (!rows.length) return;

  const lines = ['Wrong\tCorrect\tScore\tGrade'];
  for (const tr of rows) {
    const cells = Array.from(tr.children).map((td) => td.textContent.trim());
    lines.push(cells.join('\t'));
  }
  const text = lines.join('\n');

  const done = () => {
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1400);
  };

  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (_) {
      /* clipboard unavailable — nothing more we can do silently */
    }
  };

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
      return;
    }
  } catch (_) {
    /* fall through */
  }
  fallback();
}

function init() {
  document.querySelectorAll('#graderForm input[type="number"]').forEach((el) =>
    el.addEventListener('input', calc)
  );
  document.querySelectorAll('input[name="scale"]').forEach((el) =>
    el.addEventListener('change', calc)
  );
  const copyBtn = $('copyChartBtn');
  if (copyBtn) copyBtn.addEventListener('click', copyChart);
  const printBtn = $('printChartBtn');
  if (printBtn) printBtn.addEventListener('click', () => window.print());
  calc();
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
