// w2-box-1-vs-box-3-vs-box-5.js — the Box 1 / Box 3 / Box 5 reconciliation UI.
// All arithmetic lives in the shared engine; this file only reads the form,
// renders three figures and the line-by-line reason each one differs.
// Nothing is uploaded.
import { reconcileWageBoxes } from '/assets/w2-wage-boxes.js';
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';

const $ = (id) => document.getElementById(id);
const CFG = (typeof window !== 'undefined' && window.__W2BOXES__) || { years: {} };

const usd = (n) => (Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  : '—');

function num(id) {
  const el = $(id);
  if (!el) return 0;
  const raw = String(el.value || '').replace(/[$,\s]/g, '').trim();
  if (raw === '') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function activeYear() {
  const el = $('taxYear');
  const key = el ? el.value : CFG.defaultYear;
  return CFG.years[key] || CFG.years[CFG.defaultYear];
}

const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function render(r, year) {
  $('box1Val').textContent = usd(r.box1);
  $('box3Val').textContent = usd(r.box3);
  $('box5Val').textContent = usd(r.box5);

  const rows = r.lines.map((l) => {
    const mark = (on) => (on
      ? '<span class="wb-yes" aria-label="affects this box">&minus;</span>'
      : '<span class="wb-no" aria-label="does not affect this box">&middot;</span>');
    return `<tr><th scope="row">${escHtml(l.label)}</th><td class="num">${usd(l.amount)}</td>` +
      `<td class="mark">${mark(l.box1)}</td><td class="mark">${mark(l.box3)}</td>` +
      `<td class="mark">${mark(l.box5)}</td><td class="why">${escHtml(l.why)}</td></tr>`;
  }).join('');
  $('wbLines').innerHTML = rows ||
    '<tr><td colspan="6">Enter your total pay above to see the breakdown.</td></tr>';

  $('wbFlags').innerHTML = r.flags.length
    ? r.flags.map((f) => `<li>${escHtml(f)}</li>`).join('')
    : '';
  $('wbFlagsWrap').hidden = !r.flags.length;

  let summary;
  if (r.box1 === r.box3 && r.box3 === r.box5) {
    summary = `All three boxes come to ${usd(r.box1)}. Nothing came out before tax and your pay is ` +
      `under the ${usd(year.socialSecurityWageBase)} Social Security wage base, so there is nothing to reconcile.`;
  } else {
    const parts = [];
    // Compare Box 1 against the UNCAPPED figure, not against Box 3. Once wages
    // pass the wage base, Box 3 has been truncated by the cap, so "Box 1 is
    // $49,500 higher than Box 3" describes the cap while sounding like it
    // describes a deduction — two unrelated causes fused into one wrong
    // sentence. The cap gets its own clause below.
    const diff15 = r.box5 - r.box1;
    if (diff15 !== 0) {
      parts.push(`Box 1 is ${usd(Math.abs(diff15))} ${diff15 > 0 ? 'lower' : 'higher'} than Box 5`);
    }
    if (r.cappedBy > 0) {
      parts.push(`Box 3 is ${usd(r.cappedBy)} lower than Box 5 because Social Security tax stops at ` +
        `${usd(year.socialSecurityWageBase)}`);
    }
    summary = `Box 1 ${usd(r.box1)}, Box 3 ${usd(r.box3)}, Box 5 ${usd(r.box5)}. ` +
      (parts.length ? parts.join(', and ') + '. ' : '') +
      'The table below shows which box each amount came out of.';
  }
  $('wbSummary').textContent = summary;
  const status = $('wbStatus');
  if (status) status.textContent = summary;
}

function calc() {
  const year = activeYear();
  if (!year) return;
  const capNote = $('wbCapNote');
  if (capNote) capNote.textContent = usd(year.socialSecurityWageBase);
  const r = reconcileWageBoxes({
    gross: num('gross'),
    retirement401k: num('r401k'),
    section125: num('s125'),
    otherPreTax: num('otherPreTax'),
    imputedIncome: num('imputed'),
    box1Only: num('box1Only'),
  }, year);
  render(r, year);
}

function init() {
  ['gross', 'r401k', 's125', 'otherPreTax', 'imputed', 'box1Only'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', calc);
  });
  const y = $('taxYear');
  if (y) y.addEventListener('change', calc);
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
