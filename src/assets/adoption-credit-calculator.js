// adoption-credit-calculator.js — Adoption Tax Credit Calculator UI (IRC §23,
// TY 2025/2026). Arithmetic-first: qualified expenses → $17,670 per-child cap →
// MAGI phase-out → PER-CHILD refundable split (up to $5,120 EACH, not per
// return) → nonrefundable liability limit → 5-year carryforward. All logic runs
// client-side; nothing uploaded. Renders 1–3 per-child input cards dynamically.
import { adoptionCredit } from '/assets/adoption-credit.js';
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

const $ = (id) => document.getElementById(id);
const DATA = window.__ADOPTION_DATA__ || {};

const usd = (n) => '$' + Math.max(0, Math.round(n || 0)).toLocaleString('en-US');

// Null-safe select/input value read (embed may omit optional fields).
const val = (id, dflt) => {
  const el = $(id);
  return el ? el.value : dflt;
};

// Comma-safe: money fields carry live thousands separators, so read them
// through moneyValue (strips separators) rather than a raw parseFloat, which
// would silently truncate "28,000" to 28.
function num(id) {
  const el = $(id);
  if (!el) return 0;
  return moneyValue(el);
}

function childCardHtml(i) {
  const n = i + 1;
  return (
    `<div class="childcard" data-child="${i}">` +
    `<h3>Child ${n}</h3>` +
    `<div class="field">` +
    `<label for="qae${i}">Qualified adoption expenses for child ${n} this year ($)</label>` +
    `<input type="text" id="qae${i}" class="qae" inputmode="decimal" data-money autocomplete="off" value="${i === 0 ? 15000 : 0}">` +
    `</div>` +
    `<div class="field">` +
    `<label for="special${i}">Is child ${n} a special-needs adoption that became final this year? (State or tribal determination)</label>` +
    `<select id="special${i}" class="special">` +
    `<option value="no" selected>No</option>` +
    `<option value="yes">Yes — use the full cap</option>` +
    `</select>` +
    `</div>` +
    `<details style="margin-top:4px"><summary class="muted-small">Claimed expenses for this child in a prior year?</summary>` +
    `<div class="field" style="margin-top:8px">` +
    `<label for="prior${i}">Adoption expenses already claimed for child ${n} in prior years ($)</label>` +
    `<input type="text" id="prior${i}" class="prior" inputmode="decimal" data-money autocomplete="off" value="0">` +
    `<p class="muted-small" style="margin-top:6px">Reduces the remaining per-child cap. A fresh refundable slice still applies to this year's new expenses.</p>` +
    `</div></details>` +
    `</div>`
  );
}

function renderChildren() {
  const host = $('children');
  if (!host) return;
  const count = parseInt(val('childCount', '1'), 10) || 1;
  const have = host.querySelectorAll('.childcard').length;
  if (have !== count) {
    let html = '';
    for (let i = 0; i < count; i++) html += childCardHtml(i);
    host.innerHTML = html;
    initMoneyInputs(host);
    host.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('input', render);
      el.addEventListener('change', render);
    });
  }
}

function updateVisibility() {
  const fs = $('filingStatus');
  const mfs = $('mfsField');
  if (fs && mfs) mfs.style.display = fs.value === 'mfs' ? '' : 'none';
  const hp = $('hasProgram');
  const ef = $('employerFields');
  if (hp && ef) ef.style.display = hp.value === 'yes' ? '' : 'none';
}

function collectChildren() {
  const cards = Array.from(document.querySelectorAll('.childcard'));
  const empBenefits = val('hasProgram', 'no') === 'yes' ? num('employerBenefits') : 0;
  return cards.map((card, i) => ({
    qae: num(`qae${i}`),
    specialNeedsFinalThisYear: ($(`special${i}`) || {}).value === 'yes',
    priorYearClaimed: num(`prior${i}`),
    // Employer benefits net the FIRST child's credit-side expenses (v1 keeps the
    // §137 coordination on one child; the note explains the separate caps).
    employerBenefits: i === 0 ? empBenefits : 0
  }));
}

function render() {
  renderChildren();
  updateVisibility();
  const out = $('out');

  const taxYear = parseInt(val('taxYear', '2026'), 10) || 2026;
  const filingStatus = val('filingStatus', 'single');
  const hasProgram = val('hasProgram', 'no') === 'yes';
  const empBenefits = hasProgram ? num('employerBenefits') : 0;

  const carryforwardIn = [];
  const cfAmount = num('cfAmount');
  if (cfAmount > 0) carryforwardIn.push({ yearArose: parseInt(val('cfYear', String(taxYear - 1)), 10) || (taxYear - 1), amount: cfAmount });

  const r = adoptionCredit({
    taxYear,
    filingStatus,
    livedApartLast6Months: val('livedApart', 'no') === 'yes',
    magi: num('magi'),
    taxLiability: num('taxLiability'),
    children: collectChildren(),
    carryforwardIn,
    employer: hasProgram ? { benefits: empBenefits, hasWrittenProgram: true, exclusionMagi: num('magi') + empBenefits } : null,
    data: DATA
  });

  if (r.error === 'mfs_not_eligible' || r.eligible === false) {
    out.innerHTML =
      `<div class="stat-card"><p class="stat-kicker">Adoption credit you can claim</p>` +
      `<p class="stat-value is-zero">$0</p>` +
      `<p class="stat-sub">Not eligible this year: married filing separately generally can't claim the adoption credit (see below for the narrow exception).</p></div>` +
      (r.notes || []).map((n) => `<div class="info-note">${n}</div>`).join('');
    return;
  }
  if (r.error) {
    out.innerHTML =
      `<div class="stat-card"><p class="stat-kicker">Adoption credit you can claim</p>` +
      `<p class="stat-value is-zero">$0</p>` +
      `<p class="stat-sub">${(r.notes && r.notes[0]) || 'Could not compute the credit.'}</p></div>`;
    return;
  }

  const badgeText = r.refundableTotal > 0 || r.nonrefundableUsed > 0
    ? `${usd(r.totalBenefitThisYear)} credit this year`
    : 'No credit this year';
  const badgeClass = r.totalBenefitThisYear > 0 ? 'ok-flag' : 'warn-flag';

  const headline =
    `<div class="obbba-note">For ${r.taxYear}, your allowed adoption credit is <strong>${usd(r.allowedTotal)}</strong>` +
    (r.ratio > 0 ? ` (after a ${(r.ratio * 100).toFixed(1)}% income phase-out)` : '') +
    `. Of that, <strong>${usd(r.refundableTotal)}</strong> is refundable — paid to you even with no tax owed — and <strong>${usd(r.nonrefundableUsed)}</strong> of the nonrefundable part is used against your tax this year.</div>`;

  const lines = [
    ['Allowed credit (after cap &amp; phase-out)', usd(r.allowedTotal)],
    ['Refundable — paid regardless of tax owed', usd(r.refundableTotal)],
    ['Nonrefundable — used against your tax', usd(r.nonrefundableUsed)],
    ['Total benefit this year', usd(r.totalBenefitThisYear)]
  ];
  if (r.carryforwardOutTotal > 0) lines.push(['Carries forward (nonrefundable, up to 5 yrs)', usd(r.carryforwardOutTotal)]);
  if (r.expiredThisYear > 0) lines.push(['Expired carryforward (5-yr limit)', usd(r.expiredThisYear)]);
  if (r.neverClaimableTotal > 0) lines.push(['Over the cap — never claimable', usd(r.neverClaimableTotal)]);
  if (r.employerExclusion > 0) lines.push(['Employer §137 exclusion (separate)', usd(r.employerExclusion)]);

  const lineHtml = lines.map(([label, val]) => `<div class="line"><span>${label}</span><span class="num">${val}</span></div>`).join('');

  // Per-child breakdown — makes the PER-CHILD refundable cap visible.
  let breakdown = '';
  if (r.perChild.length > 1) {
    const rows = r.perChild.map((c) =>
      `<tr><td>Child ${c.index + 1}${c.specialNeeds ? ' (special needs)' : ''}</td>` +
      `<td>${usd(c.allowed)}</td><td>${usd(c.refundable)}</td><td>${usd(c.nonrefundable)}</td></tr>`
    ).join('');
    breakdown =
      `<div class="childbreak"><table>` +
      `<thead><tr><th>Per child</th><th>Allowed</th><th>Refundable</th><th>Nonrefundable</th></tr></thead>` +
      `<tbody>${rows}</tbody></table></div>`;
  }

  // ---- Answer-first summary (stat card) --------------------------------
  const benefits = r.allowedTotal > 0;
  const statSub = benefits
    ? `Of that, ${usd(r.refundableTotal)} is refundable — paid to you even with no tax owed.`
    : 'No qualified adoption expenses (or a fully phased-out credit) with these inputs — enter expenses above to see a credit.';
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Adoption credit you can claim</p>` +
      `<p class="stat-value${benefits ? '' : ' is-zero'}">${usd(r.allowedTotal)}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- Refundable vs nonrefundable comparison bars (decorative) --------
  const compareBars = benefits
    ? (() => {
        const barMax = Math.max(r.allowedTotal, 1);
        const refPct = Math.min(100, (r.refundableTotal / barMax) * 100).toFixed(1);
        const nonrefPct = Math.min(100, (r.nonrefundableCurrent / barMax) * 100).toFixed(1);
        return `<div class="compare-bars" aria-hidden="true">` +
          `<div class="cb-row"><span>Refundable ${usd(r.refundableTotal)}</span><span class="cb-track"><span class="cb-fill" style="width:${refPct}%"></span></span></div>` +
          `<div class="cb-row"><span>Nonrefundable ${usd(r.nonrefundableCurrent)}</span><span class="cb-track"><span class="cb-fill" style="width:${nonrefPct}%"></span></span></div>` +
        `</div>`;
      })()
    : '';

  // ---- One headline caveat (phase-out) shown OUTSIDE the details -------
  const headlineCaveat = (benefits && r.ratio > 0)
    ? `<div class="obbba-note phaseout-flag">Heads up: your income is above the ${usd(r.phaseoutStart)} phase-out threshold, so a ${(r.ratio * 100).toFixed(1)}% reduction already applies (see the breakdown for the math).</div>`
    : '';

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      `<div class="line big"><span>Verdict</span><span class="num ${badgeClass}">${badgeText}</span></div>` +
      headline +
      lineHtml +
      breakdown +
    `</details>`;

  // Preserve the user's open/closed choice across re-renders (default closed).
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  out.innerHTML =
    statCard +
    compareBars +
    headlineCaveat +
    derivation +
    (r.notes || []).map((n) => `<div class="takeaway">${n}</div>`).join('');

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;
}

function init() {
  initMoneyInputs();
  renderChildren();
  ['taxYear', 'filingStatus', 'livedApart', 'childCount', 'magi', 'taxLiability', 'hasProgram', 'employerBenefits', 'cfAmount', 'cfYear'].forEach((id) => {
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
