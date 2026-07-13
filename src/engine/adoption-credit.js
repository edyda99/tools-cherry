// adoption-credit.js — Adoption Tax Credit (26 U.S.C. §23) + employer
// adoption-assistance exclusion (§137) engine for tax years 2025/2026, per
// docs/adoption-credit-calculator-spec.md. Pure, framework-free. Runs
// client-side (browser ESM) and in Node (build-time tests). Every dollar
// PARAMETER comes from src/data/adoption-credit-2026.json — this file is pure
// §23 credit arithmetic. STANDALONE by design: adoption-credit policy, not the
// OBBBA deduction cluster — no reuse of obbba-deduction.js / paycheck-engine.js.
//
// THE LAW (all figures verified in the spec against P.L. 119-21 (OBBBA)
// §§70402–70403, 26 U.S.C. §§23 & 137, Rev. Proc. 2025-32 §§4.04/4.18, and the
// 2025 Form 8839 + Instructions):
//   * OBBBA §70402 added §23(a)(4): the FIRST DOLLARS of each year's allowed
//     credit are refundable, up to $5,000 (2025) / $5,120 (2026) — the first
//     PERMANENT refundable component. Refundable for the first time SINCE 2011
//     (fully refundable 2010–2011 under the ACA, then reverted), NOT "ever."
//   * THE REFUNDABLE CAP IS PER CHILD, NOT PER RETURN. Form 8839 line 11b is a
//     per-column (per-child) figure: refundable_i = min(allowed_i, $5,120). Two
//     children can yield $10,240 refundable on one return. Computing the cap
//     per-RETURN is the exact bug fixture F10 exposes — this engine must never
//     do that. See computeCredit(): the min() is inside the per-child loop.
//   * ORDER IS LOAD-BEARING: cap → MAGI phaseout → per-child refundable split →
//     nonrefundable-remainder liability limit → 5-year FIFO carryforward. The
//     phaseout hits the whole credit before the split (it doesn't protect either
//     portion); the refundable slice is the FIRST dollars of each child's
//     allowed credit.
//   * Only the NONREFUNDABLE remainder carries forward (§70402(c) amended
//     §23(c)(1)); FIFO, expires after the 5th taxable year following the year it
//     arose (§23(c)(2)). The refundable portion is paid regardless of liability
//     and never carries.
//   * SPECIAL NEEDS (§23(a)(3)): in the year the adoption becomes final, the
//     taxpayer is deemed to have paid QAE equal to the full cap remaining — the
//     full $17,670 even with $0 actual expenses. State OR (new, OBBBA §70403)
//     Indian tribal government determination.
//   * §137 employer exclusion: separate $17,670 cap, same phaseout, its own
//     MAGI (adds back the excluded benefits). No double-dip: employer-reimbursed
//     expenses aren't QAE for the credit.
//
// This engine performs NO eligibility determination beyond the MFS filing gate
// (§23(f): married taxpayers must file jointly, with the lived-apart exception).

function money(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function usd(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/**
 * Shared MAGI phaseout ratio (§23(b)(2)(A)). "In excess of" ⇒ strictly greater,
 * so MAGI exactly at the threshold yields ratio 0. Engine keeps the EXACT ratio
 * (Form 8839 allows ≥3-decimal rounding; divergence ≤ ~$9/child on messy
 * inputs). Range denominator ($40,000) is NOT indexed.
 */
export function phaseoutRatio(magi, p) {
  const excess = Math.max(0, money(magi) - p.phaseoutStart);
  return Math.min(1, excess / p.phaseoutRange);
}

/**
 * §137 employer adoption-assistance exclusion (informational panel). Separate
 * per-child cap from the credit, same phaseout, but its OWN MAGI (§137(b)(3)
 * adds the excluded benefits back — so it can be higher than the credit's MAGI).
 * Special-needs deeming requires the employer to HAVE a written program.
 *
 * @returns {number} excludable amount (dollars), phased and capped.
 */
export function employerExclusion(employer, p) {
  if (!employer) return 0;
  const cap = p.employerExclusionCap;
  const hasProgram = !!employer.hasWrittenProgram;
  // Special-needs deeming: full cap even with $0 paid, but only with a program.
  const benefits = employer.specialNeedsFinalThisYear && hasProgram
    ? cap
    : (hasProgram ? money(employer.benefits) : 0);
  const base = Math.min(cap, benefits);
  // §137 uses its own MAGI (defaults to the credit's MAGI if not supplied, but
  // the caller should add the benefits back).
  const magi137 = employer.exclusionMagi != null ? employer.exclusionMagi : employer.magi;
  const ratio = phaseoutRatio(magi137, p);
  return round2(base - base * ratio);
}

/**
 * Core §23 credit computation for one tax year.
 *
 * @param {object} a
 * @param {number}  a.taxYear         2025 | 2026 (selects params).
 * @param {string}  [a.filingStatus]  'single'|'mfj'|'hoh'|'qw'|'mfs'. MFS gates.
 * @param {boolean} [a.livedApartLast6Months] MFS lived-apart exception (+ child in home >½ year, paid >½ home cost).
 * @param {number}  a.magi            modified AGI (§23(b)(2)(B)).
 * @param {number}  a.taxLiability    federal income tax before this credit, after other credits (Credit Limit Wksht simplification, spec §7.8).
 * @param {Array}   a.children        [{ qae, specialNeedsFinalThisYear, priorYearClaimed, employerBenefits }]. employerBenefits net the child's credit-side QAE dollar-for-dollar (no double-dip).
 * @param {Array}   [a.carryforwardIn] [{ yearArose, amount }] nonrefundable carryforward vintages carried INTO this year.
 * @param {object}  [a.employer]      §137 panel: { benefits, hasWrittenProgram, specialNeedsFinalThisYear, exclusionMagi }.
 * @param {object}  a.data            src/data/adoption-credit-2026.json.
 */
export function adoptionCredit(a) {
  const data = a && a.data;
  if (!data || !data.params) {
    return { error: 'missing_data', notes: ['Adoption credit parameter data failed to load.'] };
  }
  const taxYear = Number(a.taxYear) || data.defaultYear || 2026;
  const children = Array.isArray(a.children) ? a.children : [];
  let p = data.params[String(taxYear)];
  if (!p) {
    // A carryforward-only projection year (no NEW expenses) doesn't need the
    // annual dollar figures — only the 5-year FIFO clock, which lives on `data`,
    // not `p`. Fall back to the nearest defined year's params for display
    // fields. A year with NEW children genuinely needs published figures → error.
    if (children.length > 0) {
      return { error: 'bad_year', notes: [`No adoption-credit parameters for tax year ${taxYear}. Enter expenses only for a year with published IRS figures (${Object.keys(data.params).join(', ')}).`] };
    }
    const years = Object.keys(data.params).map(Number).sort((x, y) => x - y);
    const fallbackYear = years.filter((y) => y <= taxYear).pop() ?? years[years.length - 1];
    p = data.params[String(fallbackYear)];
  }

  // MFS gate (§23(f) → rules similar to §21(e)(2): married must file jointly,
  // with the lived-apart exception). No credit OR exclusion this year; the
  // carryforward-only MFS exception is surfaced as a note. Runs BEFORE any math.
  if (a.filingStatus === 'mfs' && !a.livedApartLast6Months) {
    return {
      eligible: false,
      error: 'mfs_not_eligible',
      taxYear,
      notes: [
        'Married filing separately: you generally can\'t claim the adoption credit or the employer-assistance exclusion for this year. The credit requires filing a joint return (26 U.S.C. §23(f), which borrows §21(e)(2)\'s rules), unless you lived apart from your spouse for the last 6 months of the year AND the child lived in your home more than half the year AND you paid more than half the cost of keeping up that home. One narrow exception: if a joint return was filed in the year the expenses first became allowable, a spouse who later files separately can still claim a CARRYFORWARD from that earlier joint claim.'
      ]
    };
  }

  const ratio = phaseoutRatio(a.magi, p);

  // --- per-child pass (cap → phaseout → PER-CHILD refundable split) ---------
  const perChild = children.map((c, i) => {
    const priorClaimed = money(c && c.priorYearClaimed);
    // §23(b)(1): per-child cumulative cap across ALL years — prior claims reduce
    // this year's remaining cap (Form 8839 lines 2-4).
    const capRemaining = round2(Math.max(0, p.cap - priorClaimed));

    // Employer-reimbursed expenses are NOT qualified adoption expenses for the
    // credit (§23(b)(3), no double-dip) — net them off the entered QAE.
    const grossQae = money(c && c.qae);
    const employerBenefits = money(c && c.employerBenefits);
    const netQae = round2(Math.max(0, grossQae - employerBenefits));

    // §23(a)(3) deeming: special-needs final this year ⇒ deemed QAE = the full
    // remaining cap, "even if you didn't have any qualified adoption expenses"
    // (Form 8839 line 5). Overrides the entered amount.
    const specialNeeds = !!(c && c.specialNeedsFinalThisYear);
    const qae = specialNeeds ? capRemaining : netQae;

    const base = round2(Math.min(capRemaining, qae));       // Form 8839 line 6
    const phaseoutLost = round2(base * ratio);               // line 10
    const allowed = round2(base - phaseoutLost);             // line 11a (per child)
    // THE PER-CHILD REFUNDABLE CAP (line 11b). This min() is deliberately inside
    // the per-child loop — computing it on the SUM would be the F10 bug.
    const refundable = round2(Math.min(allowed, p.refundableCap));
    const nonrefundable = round2(allowed - refundable);
    // Over-cap expenses that can NEVER be claimed (informational). Special-needs
    // deeming has no over-cap concept (deemed exactly to the cap).
    const neverClaimable = specialNeeds ? 0 : round2(Math.max(0, grossQae - employerBenefits - base));

    return {
      index: i,
      specialNeeds,
      priorClaimed,
      capRemaining,
      grossQae,
      employerBenefits,
      qae: round2(qae),
      base,
      ratio,
      phaseoutLost,
      allowed,
      refundable,
      nonrefundable,
      neverClaimable
    };
  });

  const refundableTotal = round2(perChild.reduce((s, c) => s + c.refundable, 0));
  const allowedTotal = round2(perChild.reduce((s, c) => s + c.allowed, 0));
  const nonrefundableCurrent = round2(perChild.reduce((s, c) => s + c.nonrefundable, 0));
  const neverClaimableTotal = round2(perChild.reduce((s, c) => s + c.neverClaimable, 0));
  const phaseoutLostTotal = round2(perChild.reduce((s, c) => s + c.phaseoutLost, 0));

  // --- nonrefundable-remainder liability limit + 5-year FIFO carryforward ----
  const cfYears = data.carryforwardYears || 5;
  const taxLiability = money(a.taxLiability);

  // Drop already-expired vintages (safety net): a vintage arising in year Y is
  // usable in taxYear only if taxYear ≤ Y + cfYears. Sort oldest-first (FIFO).
  const incoming = (Array.isArray(a.carryforwardIn) ? a.carryforwardIn : [])
    .map((v) => ({ yearArose: Number(v.yearArose), amount: money(v.amount) }))
    .filter((v) => Number.isFinite(v.yearArose) && v.amount > 0 && taxYear <= v.yearArose + cfYears)
    .sort((x, y) => x.yearArose - y.yearArose);

  const carryforwardInExpired = round2(
    (Array.isArray(a.carryforwardIn) ? a.carryforwardIn : [])
      .map((v) => ({ yearArose: Number(v.yearArose), amount: money(v.amount) }))
      .filter((v) => Number.isFinite(v.yearArose) && v.amount > 0 && taxYear > v.yearArose + cfYears)
      .reduce((s, v) => s + v.amount, 0)
  );

  // Consume liability FIFO: oldest carryforward vintages first, then this year's
  // nonrefundable (vintage = taxYear).
  const vintages = incoming.slice();
  if (nonrefundableCurrent > 0) vintages.push({ yearArose: taxYear, amount: nonrefundableCurrent });

  let remaining = taxLiability;
  let nonrefundableUsed = 0;
  const survivors = [];
  for (const v of vintages) {
    const take = round2(Math.min(v.amount, Math.max(0, remaining)));
    nonrefundableUsed = round2(nonrefundableUsed + take);
    remaining = round2(remaining - take);
    const leftover = round2(v.amount - take);
    if (leftover > 0) survivors.push({ yearArose: v.yearArose, amount: leftover });
  }

  // A surviving vintage carries to taxYear+1 only if taxYear+1 ≤ yearArose +
  // cfYears; otherwise it EXPIRES this year (§23(c)(2)).
  const carryforwardOut = [];
  let expiredThisYear = 0;
  for (const v of survivors) {
    if (taxYear + 1 <= v.yearArose + cfYears) carryforwardOut.push(v);
    else expiredThisYear = round2(expiredThisYear + v.amount);
  }
  const carryforwardOutTotal = round2(carryforwardOut.reduce((s, v) => s + v.amount, 0));

  const totalBenefitThisYear = round2(refundableTotal + nonrefundableUsed);

  // §137 employer exclusion (informational, separate cap — never nets the
  // credit here; the per-child employerBenefits already did the QAE netting).
  const exclusion = a.employer
    ? employerExclusion({ ...a.employer, magi: a.magi }, p)
    : 0;

  const notes = [];
  if (refundableTotal > 0) {
    notes.push(
      `Because of the 2025 law (OBBBA §70402), ${usd(refundableTotal)} of this credit is refundable — paid to you even if you owe no tax. This is the first time the adoption credit has been refundable since 2011, and the first time it is permanent. The refundable amount is figured per child (up to ${usd(p.refundableCap)} each), not per return.`
    );
  }
  if (children.length > 1 && refundableTotal > p.refundableCap) {
    notes.push(
      `You have more than one adopted child, so the ${usd(p.refundableCap)} refundable cap applies to EACH child separately — your refundable total (${usd(refundableTotal)}) correctly exceeds ${usd(p.refundableCap)}. Sites that treat ${usd(p.refundableCap)} as a per-return limit get this wrong.`
    );
  }
  if (carryforwardOutTotal > 0) {
    const oldest = carryforwardOut.reduce((m, v) => Math.min(m, v.yearArose), Infinity);
    notes.push(
      `${usd(carryforwardOutTotal)} of nonrefundable credit is left over and carries forward (up to 5 years, oldest used first). Only the nonrefundable part can carry — the refundable part is already paid out. The oldest carried amount here (from ${oldest}) can be used through ${oldest + cfYears}, then it expires.`
    );
  }
  if (expiredThisYear > 0) {
    notes.push(
      `${usd(expiredThisYear)} of an old nonrefundable carryforward expired this year — it reached the 5-year limit (§23(c)(2)) without enough tax liability to absorb it, and can never be claimed.`
    );
  }
  if (neverClaimableTotal > 0) {
    notes.push(
      `${usd(neverClaimableTotal)} of your expenses is above the ${usd(p.cap)} per-child cap and can never be claimed as a credit in any year.`
    );
  }
  if (exclusion > 0) {
    notes.push(
      `Separately, up to ${usd(exclusion)} of employer adoption-assistance benefits can be excluded from your wages under §137. The §137 exclusion and the §23 credit have separate ${usd(p.employerExclusionCap)} caps — you can use both — but not for the SAME expenses (no double-dip).`
    );
  }

  return {
    eligible: true,
    taxYear,
    ratio,
    cap: p.cap,
    refundableCap: p.refundableCap,
    phaseoutStart: p.phaseoutStart,
    phaseoutEnd: p.phaseoutEnd,
    perChild,
    allowedTotal,
    refundableTotal,
    nonrefundableCurrent,
    carryforwardInTotal: round2(incoming.reduce((s, v) => s + v.amount, 0)),
    carryforwardInExpired,
    nonrefundableUsed,
    carryforwardOut,
    carryforwardOutTotal,
    expiredThisYear,
    totalBenefitThisYear,
    neverClaimableTotal,
    phaseoutLostTotal,
    employerExclusion: exclusion,
    notes
  };
}

export { money, round2, usd };
