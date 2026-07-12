// student-loan-cap-calculator.js — Federal student loan borrowing cap /
// funding gap calculator UI. Four modes: graduate, professional, Parent PLUS,
// and undergraduate info (limits unchanged). All logic runs client-side;
// nothing uploaded. The engine never classifies a program as graduate vs.
// professional — that question is mid-litigation (see the dataset's
// `litigation` block) — the user self-selects and professional-mode results
// carry a date-stamped caveat.
import { studentLoanPlan, parentPlusPlan, undergradInfo } from '/assets/student-loan-cap.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const LIMITS = window.__STUDENT_LOAN_LIMITS__ || {};

const usd = (n) => '$' + Math.max(0, Math.round(n || 0)).toLocaleString('en-US');

function num(id) {
  const el = $(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : 0;
}

const CONSTRAINT_LABELS = {
  coa: 'Cost of attendance − aid',
  annualCap: 'Annual cap',
  pool: 'Aggregate pool',
  lifetime: '$257,500 lifetime cap',
  aggregate: '$65,000 Parent PLUS aggregate'
};

function constraintLabel(yr, r) {
  if (yr.legacy) return 'Legacy exception (old rules)';
  if (yr.constraint === 'annualCap') return `Annual cap (${usd(r.annualCap)})`;
  if (yr.constraint === 'pool') return `${usd(r.poolCap)} pool`;
  return CONSTRAINT_LABELS[yr.constraint] || yr.constraint;
}

function updateVisibility() {
  const mode = $('mode').value;
  const student = mode === 'graduate' || mode === 'professional';
  $('studentFields').style.display = student ? '' : 'none';
  $('parentFields').style.display = mode === 'parentPlus' ? '' : 'none';
  $('undergradFields').style.display = mode === 'undergradInfo' ? '' : 'none';
  $('legacyField').style.display = mode === 'undergradInfo' ? 'none' : '';
  // Years/COA/aid fields are shared by student + parent modes.
  const shared = ['yearsRemaining', 'annualCoa', 'annualOtherAid'];
  shared.forEach((id) => {
    const el = $(id);
    if (el && el.closest('.field')) el.closest('.field').style.display = mode === 'undergradInfo' ? 'none' : '';
  });
  // The pool/everProfessional/lifetime inputs are student-only; the shared
  // COA fields live inside #studentFields in markup, so move is not needed —
  // parent mode re-shows them below.
  if (mode === 'parentPlus') {
    $('studentFields').style.display = '';
    ['poolField', 'everProfField', 'lifetimeField'].forEach((id) => { $(id).style.display = 'none'; });
  } else if (student) {
    ['poolField', 'lifetimeField'].forEach((id) => { $(id).style.display = ''; });
    $('everProfField').style.display = mode === 'graduate' ? '' : 'none';
  }
  const legacyLabel = $('legacyLabel');
  if (legacyLabel) {
    legacyLabel.textContent = mode === 'parentPlus'
      ? 'The student was enrolled in this program on June 30, 2026 AND a Direct Loan (to me or to the student) was made for it before July 1, 2026'
      : 'I was enrolled in this program on June 30, 2026 AND a Direct Loan was made for it before July 1, 2026';
  }
}

function yearTable(r) {
  const rows = r.years.map((yr) =>
    `<tr><td>Year ${yr.year}${yr.legacy ? ' (legacy)' : ''}</td>` +
    `<td class="num">${usd(yr.federal)}</td>` +
    `<td class="num">${usd(yr.gap)}</td>` +
    `<td>${constraintLabel(yr, r)}</td></tr>`
  ).join('');
  return `<div class="yr-scroll"><table class="yr-table"><thead><tr><th>Year</th><th>Federal capacity</th><th>Gap</th><th>What binds</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function render() {
  updateVisibility();
  const mode = $('mode').value;
  const out = $('out');

  if (mode === 'undergradInfo') {
    const r = undergradInfo({ dependent: $('ugDependency').value === 'dependent', yearNumber: parseInt($('ugYear').value, 10) || 1, limits: LIMITS });
    if (r.error) {
      out.innerHTML = `<div class="obbba-note warn-flag">${(r.notes && r.notes[0]) || 'Could not load the limit data.'}</div>`;
      return;
    }
    out.innerHTML =
      `<div class="line big"><span>Verdict</span><span class="num ok-flag">Your own limits are unchanged</span></div>` +
      `<div class="line"><span>Annual Direct Loan limit (year ${r.yearNumber >= 3 ? '3+' : r.yearNumber}, ${r.dependent ? 'dependent' : 'independent'})</span><span class="num">${usd(r.annual)}</span></div>` +
      (r.maxSubsidized != null ? `<div class="line"><span>Of which subsidized (max)</span><span class="num">${usd(r.maxSubsidized)}</span></div>` : '') +
      `<div class="line"><span>Aggregate limit</span><span class="num">${usd(r.aggregate)}</span></div>` +
      r.notes.map((n) => `<div class="takeaway">${n}</div>`).join('');
    return;
  }

  const yearsRemaining = parseInt($('yearsRemaining').value, 10) || 0;
  const annualCoa = num('annualCoa');
  const annualOtherAid = num('annualOtherAid');
  const legacyEligible = $('legacyEligible').checked;

  let r;
  if (mode === 'parentPlus') {
    r = parentPlusPlan({ yearsRemaining, annualCoa, annualOtherAid, parentPlusEverBorrowed: num('parentPlusEverBorrowed'), legacyEligible, limits: LIMITS });
  } else {
    r = studentLoanPlan({
      mode,
      yearsRemaining,
      annualCoa,
      annualOtherAid,
      priorPoolOutstanding: num('priorPoolOutstanding'),
      everProfessional: $('everProfessional').checked,
      lifetimeEverBorrowed: num('lifetimeEverBorrowed'),
      legacyEligible,
      limits: LIMITS
    });
  }

  if (r.error) {
    out.innerHTML = `<div class="obbba-note warn-flag">${(r.notes && r.notes[0]) || 'Enter valid amounts to see a result.'}</div>`;
    return;
  }

  const covered = r.totalNeed > 0 ? r.totalFederal / r.totalNeed : 1;
  let badgeText, badgeClass;
  if (r.totalNeed <= 0) {
    badgeText = 'Nothing left to borrow — aid covers the cost';
    badgeClass = 'ok-flag';
  } else if (r.totalGap <= 0) {
    badgeText = 'Federal loans can cover the full remaining cost';
    badgeClass = 'ok-flag';
  } else {
    badgeText = `Funding gap: ${usd(r.totalGap)}`;
    badgeClass = 'warn-flag';
  }

  const headline = r.totalNeed > 0
    ? `<div class="obbba-note">Under the caps in effect since July 1, 2026${r.legacyApplied ? ' (with your legacy exception applied)' : ''}, federal loans can cover <strong>${usd(r.totalFederal)}</strong> of your remaining <strong>${usd(r.totalNeed)}</strong> ${mode === 'parentPlus' ? "of this student's program cost (parent side)" : 'program cost'} — ${r.totalGap > 0 ? `a funding gap of <strong>${usd(r.totalGap)}</strong> (${Math.round((1 - covered) * 100)}% of the cost)` : 'no funding gap'}.</div>`
    : '';

  const lines = [
    ['Remaining program cost (after grants/aid)', usd(r.totalNeed)],
    ['Federal borrowing capacity', usd(r.totalFederal)],
    ['Funding gap', usd(r.totalGap)]
  ];
  if (mode === 'parentPlus') {
    lines.push([`${usd(r.aggregateCap)} aggregate remaining after this plan`, usd(r.poolRemainingEnd)]);
  } else {
    lines.push([`${usd(r.poolCap)} pool remaining after this plan`, usd(r.poolRemainingEnd)]);
    lines.push([`${usd(r.odometerCap)} lifetime cap remaining after this plan`, usd(r.odometerRemainingEnd)]);
  }

  const lineHtml = lines.map(([label, val]) => `<div class="line"><span>${label}</span><span class="num">${val}</span></div>`).join('');
  const legacyNotes = [];
  const otherNotes = [];
  (r.notes || []).forEach((n) => {
    if (/Legacy exception|exception has run out|pre-2026|exception years/.test(n)) legacyNotes.push(n);
    else if (r.litigationNote && n === r.litigationNote) otherNotes.push(`<div class="litigation-note">${n}</div>`);
    else otherNotes.push(`<div class="takeaway">${n}</div>`);
  });

  out.innerHTML =
    `<div class="line big"><span>Verdict</span><span class="num ${badgeClass}">${badgeText}</span></div>` +
    headline +
    yearTable(r) +
    lineHtml +
    legacyNotes.map((n) => `<div class="legacy-banner">${n}</div>`).join('') +
    otherNotes.join('') +
    (r.totalGap > 0
      ? `<div class="obbba-note">Where a gap like this gets covered is outside this tool's scope: students in this position typically look at institutional aid, outside scholarships, assistantships, employer education benefits, savings, or private/institutional loans. Those options differ enormously in cost and protections — this calculator doesn't evaluate or recommend any of them; it only computes the federal arithmetic.</div>`
      : '');
}

function init() {
  ['mode', 'yearsRemaining', 'annualCoa', 'annualOtherAid', 'priorPoolOutstanding', 'everProfessional', 'lifetimeEverBorrowed', 'parentPlusEverBorrowed', 'legacyEligible', 'ugDependency', 'ugYear'].forEach((id) => {
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
