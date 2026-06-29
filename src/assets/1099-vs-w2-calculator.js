// 1099-vs-w2-calculator.js — compare estimated take-home: W-2 employee vs 1099
// self-employed. Pure math via the shared employment-tax engine. Federal + payroll
// /SE tax only — NO state tax. ESTIMATE. Nothing uploaded.
import { compare, TAX_YEAR } from '/assets/employment-tax.js';

const $ = (id) => document.getElementById(id);

function money(n, max = 0) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: max });
}

function val(id) {
  const raw = $(id).value.trim();
  if (raw === '') return NaN;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}

function setRow(prefix, r, grossId) {
  $(prefix + 'TakeHome').textContent = money(r.takeHome);
  $(grossId).textContent = money(r.gross ?? r.net);
  // Payroll/SE tax line.
  $(prefix + 'Payroll').textContent = money(prefix === 'w2' ? r.fica : r.seTax);
  $(prefix + 'Federal').textContent = money(r.federalTax);
}

function reset() {
  $('headline').textContent = '—';
  $('headlineSub').textContent = '';
  $('compareWrap').hidden = true;
  $('summaryBox').hidden = true;
}

function calc() {
  reset();

  const w2Gross = val('w2Gross');
  const contractNet = val('contractNet');
  const status = $('status').value === 'married' ? 'married' : 'single';

  if (!Number.isFinite(w2Gross) || w2Gross < 0) {
    $('headlineSub').textContent = 'Enter a W-2 salary to compare.';
    return;
  }
  if (!Number.isFinite(contractNet) || contractNet < 0) {
    $('headlineSub').textContent = 'Enter a 1099 contract / net amount to compare.';
    return;
  }

  const c = compare(w2Gross, contractNet, status);
  if (!Number.isFinite(c.w2.takeHome) || !Number.isFinite(c.se.takeHome)) return;

  setRow('w2', c.w2, 'w2Gross_');
  setRow('se', c.se, 'seGross');
  $('compareWrap').hidden = false;

  const gap = c.takeHomeGap; // w2 - se
  if (Math.abs(gap) < 1) {
    $('headline').textContent = 'About the same';
    $('headlineSub').textContent = 'The two keep roughly the same take-home pay after federal and payroll/SE tax.';
  } else if (gap > 0) {
    $('headline').textContent = money(gap) + ' more';
    $('headlineSub').textContent = `The W-2 job keeps about ${money(gap)} more per year after federal and payroll/SE tax (before benefits).`;
  } else {
    $('headline').textContent = money(-gap) + ' more';
    $('headlineSub').textContent = `The 1099 contract keeps about ${money(-gap)} more per year after federal and SE tax (before benefits).`;
  }

  // Benefits-gap framing: a 1099 worker self-funds the employer-side payroll tax,
  // health insurance, retirement match, and paid leave a W-2 employer typically
  // covers. Surface the SE-tax half the employer would have paid as a concrete,
  // computed floor for that gap.
  const employerHalfSe = c.se.seTaxDeduction; // = half the SE tax
  $('benefitsText').textContent =
    `As a 1099 contractor you cover the employer's share of payroll tax yourself — about ` +
    `${money(employerHalfSe)} a year here — plus health insurance, any retirement match, and ` +
    `paid time off that a W-2 employer would normally provide. Many contractors aim for a ` +
    `pay rate 25–40% above an equivalent salary to make up for that gap. Adjust the contract ` +
    `amount above to find the rate where the two come out even.`;

  $('summaryText').textContent =
    `On a ${money(w2Gross)} W-2 salary you'd keep about ${money(c.w2.takeHome)} after federal income tax ` +
    `and FICA. On ${money(contractNet)} of 1099 net earnings you'd keep about ${money(c.se.takeHome)} after ` +
    `federal income tax and self-employment tax (${money(c.se.seTax)}). This compares federal taxes only — ` +
    `it does not include state income tax, the QBI deduction, additional Medicare tax, or the value of benefits.`;
  $('summaryBox').hidden = false;
}

function init() {
  // Stamp the tax year into the dated-assumptions copy.
  document.querySelectorAll('[data-tax-year]').forEach((el) => { el.textContent = String(TAX_YEAR); });
  document.querySelectorAll('#w2Form input, #w2Form select').forEach((el) =>
    el.addEventListener('input', calc)
  );
  calc();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
