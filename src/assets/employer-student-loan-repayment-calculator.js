// employer-student-loan-repayment-calculator.js — UI for the IRC §127 employer
// student-loan-repayment / educational-assistance tax-benefit calculator. All
// logic runs client-side; nothing is uploaded. The engine (section-127.js) does
// the statutory arithmetic; this file only reads inputs and renders results.
import { computeSection127 } from '/assets/section-127.js';
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

const $ = (id) => document.getElementById(id);
const PARAMS = window.__SECTION127__ || {};

const usd = (n) => '$' + Math.max(0, Math.round(n || 0)).toLocaleString('en-US');
const usd2 = (n) => '$' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Comma-safe: money fields carry live thousands separators, so read them
// through moneyValue (strips separators) rather than a raw parseFloat, which
// would silently truncate "28,000" to 28.
function num(id) {
  const el = $(id);
  if (!el) return 0;
  return moneyValue(el);
}

function render() {
  const out = $('out');
  const stateConforms = $('stateConforms') ? $('stateConforms').value !== 'no' : true;
  const r = computeSection127({
    loanRepaymentBenefit: num('loanRepaymentBenefit'),
    tuitionAssistanceUsed: num('tuitionAssistanceUsed'),
    marginalFedRate: parseFloat($('marginalFedRate').value) || 0,
    wages: num('wages'),
    filingStatus: $('filingStatus') ? $('filingStatus').value : 'single',
    stateMarginalRate: num('stateMarginalRate') / 100,
    stateConforms,
    params: PARAMS
  });

  if (r.error) {
    out.innerHTML =
      `<div class="stat-card"><p class="stat-kicker">Tax-free employer repayment</p>` +
      `<p class="stat-value is-zero">$0</p>` +
      `<p class="stat-sub">${(r.notes && r.notes[0]) || 'Enter valid amounts to see a result.'}</p></div>`;
    return;
  }

  const totalSide = r.empTotalSaved;
  const badgeClass = r.excludedLoan > 0 ? 'ok-flag' : 'warn-flag';
  const badgeText = r.excludedLoan > 0
    ? `Employee saves ${usd2(totalSide)} this year`
    : 'No room left under the $5,250 cap for loan repayment';

  // Shared-cap meter (used vs. remaining of the year's cap).
  const usedPct = r.cap > 0 ? Math.min(100, Math.round((r.totalExcluded / r.cap) * 100)) : 0;
  const meter =
    `<div class="cap-meter" role="img" aria-label="${usd(r.totalExcluded)} of the ${usd(r.cap)} cap used">` +
    `<div class="cap-fill" style="width:${usedPct}%"></div></div>` +
    `<div class="obbba-note">Shared $${r.cap.toLocaleString('en-US')} cap: <strong>${usd(r.totalExcluded)}</strong> used` +
    `${r.excludedTuition > 0 ? ` (${usd(r.excludedTuition)} tuition + ${usd(r.excludedLoan)} loan)` : ''}, ` +
    `<strong>${usd(r.remainingRoom)}</strong> remaining. Tuition-type assistance and loan repayment share one cap — you can't get $5,250 of each.</div>`;

  // Employee-side FICA detail (surfaces the wage-base straddle honestly).
  const ficaDetail = [];
  if (r.empOasdiSaved > 0) ficaDetail.push(`${usd2(r.empOasdiSaved)} Social Security (6.2%)`);
  if (r.empMedicareSaved > 0) ficaDetail.push(`${usd2(r.empMedicareSaved)} Medicare (1.45%)`);
  if (r.empAddlMedicareSaved > 0) ficaDetail.push(`${usd2(r.empAddlMedicareSaved)} Additional Medicare (0.9%)`);
  const ficaNote = r.aboveWageBase && r.excludedLoan > 0
    ? `<div class="obbba-note">You're already over the $${PARAMS.ficaWageBase.toLocaleString('en-US')} Social Security wage base, so the 6.2% doesn't apply here — your FICA saving is Medicare only, not the full 7.65%.</div>`
    : '';

  const empLines = [];
  if (r.excludedLoan > 0) {
    empLines.push(`<div class="line"><span>Federal income tax saved (on ${usd(r.excludedLoan)} excluded)</span><span class="num">${usd2(r.empIncomeTaxSaved)}</span></div>`);
    empLines.push(`<div class="line"><span>FICA saved${ficaDetail.length ? ` <span class="muted-small">(${ficaDetail.join(' + ')})</span>` : ''}</span><span class="num">${usd2(r.empFicaSaved)}</span></div>`);
    if (r.empStateSaved > 0) empLines.push(`<div class="line"><span>State income tax saved (state conforms)</span><span class="num">${usd2(r.empStateSaved)}</span></div>`);
    if (r.stateTaxCost > 0) empLines.push(`<div class="line"><span class="warn-flag">Less: state income tax still due (state does NOT conform)</span><span class="num warn-flag">-${usd2(r.stateTaxCost)}</span></div>`);
    empLines.push(`<div class="line big"><span>Employee total saving</span><span class="num ${totalSide >= 0 ? 'ok-flag' : 'warn-flag'}">${usd2(totalSide)}</span></div>`);
  }

  // Employer-side.
  const erHeadline = r.totalExcluded > 0
    ? `<div class="line"><span>Employer payroll-tax (FICA) saved on ${usd(r.totalExcluded)} excluded${r.aboveWageBase ? ', Medicare only above the wage base' : ''}</span><span class="num">${usd2(r.erFicaSaved)}</span></div>` +
      `<div class="obbba-note">This is the employer's saving <em>versus paying the same amount as taxable wages or a bonus</em> — the income-tax deduction is a wash either way, so avoided FICA is the whole difference. No employer 0.9% Additional Medicare match; FUTA adds ~$0 (its $7,000 base is already used up).</div>`
    : '';

  // Over-cap excess (both sides taxable).
  const excessBlock = r.excessTaxable > 0
    ? `<div class="mythbust"><h2 style="font-size:1rem">Over the $${r.cap.toLocaleString('en-US')} cap: ${usd(r.excessTaxable)} is taxable wages</h2>` +
      `<div class="line"><span>Employee cost on the excess (income tax + FICA${r.empExcessState > 0 ? ' + state' : ''})</span><span class="num warn-flag">${usd2(r.empExcessCost)}</span></div>` +
      `<div class="line"><span>Employer FICA cost on the excess</span><span class="num warn-flag">${usd2(r.erExcessCost)}</span></div>` +
      `<p class="obbba-note" style="margin-bottom:0">Amounts over $${r.cap.toLocaleString('en-US')} (or paid outside a qualifying written plan) are ordinary taxable wages for both sides — Pub 15-B (2026).</p></div>`
    : '';

  const notesHtml = (r.notes || []).map((n) => `<div class="takeaway">${n}</div>`).join('');

  // ---- Answer-first summary (stat card) --------------------------------
  const benefits = r.excludedLoan > 0;
  const statSub = benefits
    ? `Employee saves ${usd2(totalSide)} this year in income tax and FICA combined.`
    : 'No room left under the shared $5,250 cap for tax-free loan repayment this year.';
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Tax-free employer repayment</p>` +
      `<p class="stat-value${benefits ? '' : ' is-zero'}">${usd(r.excludedLoan)}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- Employee saving vs employer saving comparison bars (decorative) --
  const compareBars = benefits
    ? (() => {
        const barMax = Math.max(totalSide, r.erFicaSaved, 1);
        const empPct = Math.min(100, (totalSide / barMax) * 100).toFixed(1);
        const erPct = Math.min(100, (r.erFicaSaved / barMax) * 100).toFixed(1);
        return `<div class="compare-bars" aria-hidden="true">` +
          `<div class="cb-row"><span>Employee saves ${usd2(totalSide)}</span><span class="cb-track"><span class="cb-fill" style="width:${empPct}%"></span></span></div>` +
          `<div class="cb-row"><span>Employer saves ${usd2(r.erFicaSaved)}</span><span class="cb-track"><span class="cb-fill" style="width:${erPct}%"></span></span></div>` +
        `</div>`;
      })()
    : '';

  // ---- One headline caveat shown OUTSIDE the details --------------------
  const headlineCaveat = r.excessTaxable > 0
    ? `<div class="obbba-note ineligible-flag">Heads up: ${usd(r.excessTaxable)} of what you entered is over the shared $5,250 cap and counts as ordinary taxable wages (see the breakdown).</div>`
    : (r.stateTaxCost > 0
        ? `<div class="obbba-note ineligible-flag">Heads up: your state doesn't conform to this exclusion, so ${usd2(r.stateTaxCost)} of state income tax still applies (see the breakdown).</div>`
        : '');

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      `<div class="line big"><span>Verdict</span><span class="num ${badgeClass}">${badgeText}</span></div>` +
      meter +
      (empLines.length ? `<div class="section-label">Employee</div>${empLines.join('')}${ficaNote}` : '') +
      (erHeadline ? `<div class="section-label">Employer</div>${erHeadline}` : '') +
      excessBlock +
    `</details>`;

  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  out.innerHTML =
    statCard +
    compareBars +
    headlineCaveat +
    derivation +
    notesHtml;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;
}

function init() {
  initMoneyInputs();
  ['loanRepaymentBenefit', 'tuitionAssistanceUsed', 'marginalFedRate', 'wages', 'filingStatus', 'stateMarginalRate', 'stateConforms'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  render();
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
