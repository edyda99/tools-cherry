// qcd-comparison.js — Qualified Charitable Distribution (QCD, IRC §408(d)(8))
// vs. "take the IRA distribution as income and deduct the gift" comparison.
// Pure, framework-free. Runs client-side (browser ESM) and in Node (build-time
// tests). QCD is NOT an OBBBA provision (it predates the 2025 law and is
// permanent), but it shares the same tax-parameter store (obbba-deductions-
// 2026.json federal.qcd) and reuses the shipped charitable-deduction engine.
//
// SCOPE (per the sourced spec, docs/qcd-vs-charitable-deduction-spec.md):
//   Path A (QCD): the gift goes directly IRA-trustee-to-charity. It is
//   EXCLUDED from gross income entirely (§408(d)(8)(A) "shall not be
//   includible in gross income") — it never enters AGI, and no separate
//   charitable deduction is allowed (no double-dip).
//   Path B (take + deduct): the distribution is ordinary income (AGI up),
//   then the gift is claimed as a charitable deduction — which only helps if
//   you itemize, and is capped by the same three OBBBA 2026 rules the
//   Charitable Deduction Calculator already models (the §170(p) non-itemizer
//   cap, the 0.5%-of-AGI floor, and the §68 "2/37" top-bracket haircut).
//
// REUSE, NOT REIMPLEMENTATION: every dollar of the Path-B (and Path-A
// remainder) deduction math is computed by the EXISTING `charitableComparison`
// from obbba-deduction.js — called twice, once for the full distribution
// (Path B) and once for the taxable remainder over the QCD limit (Path A's
// "overLimit"). This file adds only what's genuinely new: the QCD annual-limit
// lookup/partial-QCD split, the age-70½ eligibility gate (distinct from RMD
// age 73), the account-type guard, the age-65+ standard-deduction addition
// (charitableComparison only ever reads the BASE standard deduction), the
// RMD-satisfaction line, and the post-70½ deductible-contribution offset.
import { charitableComparison } from './obbba-deduction.js';
import { federalIncomeTax } from './paycheck-engine.js';

// Filing statuses this tool supports — mirrors the Charitable Deduction
// Calculator's own selector (married_separate/qss are not offered there
// either; tax-data-2026.json's standardDeduction/brackets only carry these
// three keys).
const SUPPORTED_STATUSES = ['single', 'married', 'head_of_household'];

function normalizeStatus(filingStatus) {
  return SUPPORTED_STATUSES.includes(filingStatus) ? filingStatus : 'single';
}

// Account types that flatly CANNOT do a QCD (an ongoing 401(k)/403(b)/457 or
// an ACTIVE SEP/SIMPLE — Pub 590-B: "other than an ongoing SEP or SIMPLE
// IRA"). A rollover to a traditional IRA is required first.
const HARD_INELIGIBLE_ACCOUNTS = new Set(['401k', '403b', '457', 'ongoing_sep_ira', 'ongoing_simple_ira']);

// Technically QCD-eligible under the statute, but the tool steers away from
// it: a Roth IRA QCD wastes the exclusion, because qualified Roth
// distributions are already tax-free — there's no income to exclude, so
// running the dollar comparison would be misleading, not just unflattering.
const STEER_AWAY_ACCOUNTS = new Set(['roth_ira']);

/**
 * The age-65+ ADDITIONAL standard deduction (IRC §63(f)) to stack onto the
 * base standard deduction — genuinely new vs. the shipped charitable engine,
 * which only ever reads `fed.standardDeduction[status]` (the base amount).
 * Every user of this tool is 70½+, so this addition always applies to the
 * account owner; `spouseAlsoQualifies` lets a joint filer add a second
 * spouse's amount for a married return (defaults to false — the
 * conservative choice when the spouse's age isn't known/entered).
 *
 * NOT the OBBBA $6,000/$12,000 "senior bonus" deduction (federal.senior) —
 * that is a separate, below-the-line, 2025–2028-only provision; the two must
 * never be summed together here.
 *
 * @param {object} a
 * @param {string} a.filingStatus  'single' | 'married' | 'head_of_household'
 * @param {boolean} [a.spouseAlsoQualifies]  MFJ only: spouse is also 65+
 * @param {number} a.year
 * @param {object} a.qcd  obbba.federal.qcd
 * @returns {number}
 */
export function additionalStdDeduction65({ filingStatus, spouseAlsoQualifies = false, year, qcd }) {
  const table = qcd.ageStandardDeductionAddition.byYear;
  const row = table[String(year)] || table['2026'];
  if (filingStatus === 'married') {
    const qualifyingSpouses = 1 + (spouseAlsoQualifies ? 1 : 0); // account owner is always 70.5+, so always qualifies
    return row.marriedPerSpouse * qualifyingSpouses;
  }
  return row[filingStatus] ?? row.single;
}

// Clones `fed` (taxData.federal shape: {standardDeduction, brackets, ...})
// with ONE filing status's standard deduction swapped for the 65+ amount.
// This is the whole trick for "pass sd65 into charitableComparison, not the
// base fed.standardDeduction" — charitableComparison and federalIncomeTax are
// never modified; they just read a `fed` object whose standardDeduction[status]
// happens to already include the 65+ addition.
function fedWithSd65(fed, filingStatus, sd65) {
  return { ...fed, standardDeduction: { ...fed.standardDeduction, [filingStatus]: sd65 } };
}

/**
 * Full QCD vs. take-and-deduct comparison for one return.
 *
 * @param {object} a
 * @param {string}  a.filingStatus   'single' | 'married' | 'head_of_household'
 * @param {number}  a.age            the IRA owner's age (decimal, e.g. 70.5)
 * @param {boolean} [a.spouseAlsoQualifies]  MFJ only: spouse is also 65+ (default false)
 * @param {number}  a.donation       the gift amount, same dollars either path
 * @param {number}  a.baseAgi        AGI EXCLUDING any IRA distribution for this gift
 * @param {number}  [a.otherItemized]  non-charitable Schedule A items (SALT-after-cap, mortgage interest, medical over floor)
 * @param {number}  [a.rmdAmount]      this year's required minimum distribution, if any (0 = none / not RMD age)
 * @param {number}  [a.post70DeductibleContribs]  cumulative post-70½ DEDUCTED IRA contributions (anti-abuse offset; advanced/optional)
 * @param {string}  [a.accountType]  'traditional_ira' (default) | 'inactive_sep_ira' | 'inactive_simple_ira' | 'roth_ira' | '401k' | '403b' | '457' | 'ongoing_sep_ira' | 'ongoing_simple_ira'
 * @param {number}  [a.year]         tax year (default 2026)
 * @param {object}  a.qcd            obbba.federal.qcd
 * @param {object}  a.charitable     obbba.federal.charitable
 * @param {object}  a.fed            taxData.federal (brackets + standardDeduction)
 * @returns {object}
 */
export function qcdComparison({
  filingStatus, age, spouseAlsoQualifies = false, donation, baseAgi,
  otherItemized, rmdAmount, post70DeductibleContribs,
  accountType = 'traditional_ira', year = 2026, qcd, charitable, fed
}) {
  const status = normalizeStatus(filingStatus);
  const donationAmt = Math.max(0, donation || 0);
  const baseAgiAmt = Math.max(0, baseAgi || 0);
  const otherItem = Math.max(0, otherItemized || 0);
  const rmd = Math.max(0, rmdAmount || 0);
  const offset = Math.max(0, post70DeductibleContribs || 0);
  const ageNum = Number.isFinite(age) ? age : 0;

  const qcdLimit = qcd.annualLimitByYear[String(year)] ?? qcd.annualLimitByYear['2026'];
  const qcdEligibleAge = ageNum >= qcd.ageEligible; // 70.5, NOT the RMD age (73)
  const isRmdAge = ageNum >= qcd.rmdAge2023plus;

  const accountHardIneligible = HARD_INELIGIBLE_ACCOUNTS.has(accountType);
  const accountSteerAway = STEER_AWAY_ACCOUNTS.has(accountType);
  const notes = [];
  if (accountHardIneligible) notes.push('account_ineligible');
  if (accountSteerAway) notes.push('account_roth_not_recommended');
  if (!qcdEligibleAge) notes.push('under_70_half');

  const sd65 = fed.standardDeduction[status] + additionalStdDeduction65({ filingStatus: status, spouseAlsoQualifies, year, qcd });
  const fed65 = fedWithSd65(fed, status, sd65);

  const eligible = qcdEligibleAge && !accountHardIneligible && !accountSteerAway;

  // Path B is always computable (it's just "take the distribution and try to
  // deduct it") — used both as the normal comparison side AND, when QCD isn't
  // available/advisable, as the sole informational output (never silently
  // compute a QCD the user can't legally/sensibly make — spec fixtures Q7/Q12).
  const agiB = baseAgiAmt + donationAmt;
  const resB = charitableComparison({
    filingStatus: status, agi: agiB, cashGift: donationAmt, otherItemized: otherItem,
    params: charitable, fed: fed65
  });
  const taxB = federalIncomeTax(agiB, status, fed65, resB.bestDeduction - sd65);

  if (!eligible) {
    return {
      eligible: false, accountEligible: !accountHardIneligible, accountSteerAway,
      qcdEligibleAge, isRmdAge, qcdLimit, sd65,
      qcdAmount: 0, overLimit: donationAmt,
      agiA: null, taxA: null, resA: null,
      agiB, taxB, resB,
      qcdSavesFederalTax: null, agiKeptLowerBy: 0, rmdSatisfiedByQcd: 0,
      notes
    };
  }

  // ---- QCD amount (partial if over the annual limit), minus the anti-abuse
  // post-70½ deducted-contribution offset (Pub 590-B "QCD Adjustment Worksheet").
  let qcdAmount = Math.min(donationAmt, qcdLimit);
  if (donationAmt > qcdLimit) notes.push('over_annual_limit');
  qcdAmount = Math.max(0, qcdAmount - offset);
  if (offset > 0) notes.push('post70_offset_applied');
  const overLimit = Math.max(0, donationAmt - qcdAmount);

  // ---- Path A: QCD. Only the non-QCD remainder (usually $0) is taxable
  // income; the QCD gift itself is NEVER deductible (no double-dip) — reuse
  // charitableComparison with cashGift = overLimit so ONE code path drives
  // both the itemize-vs-standard check and the tax on whatever remainder
  // (if any) exceeds the annual QCD limit.
  const agiA = baseAgiAmt + overLimit;
  const resA = charitableComparison({
    filingStatus: status, agi: agiA, cashGift: overLimit, otherItemized: otherItem,
    params: charitable, fed: fed65
  });
  const taxA = federalIncomeTax(agiA, status, fed65, resA.bestDeduction - sd65);

  const qcdSavesFederalTax = Math.max(0, taxB - taxA);
  const agiKeptLowerBy = agiB - agiA; // == qcdAmount
  const rmdSatisfiedByQcd = Math.min(qcdAmount, rmd);

  // CORRECTION 2 (spec): at/below the §170(p) cap, take-and-deduct removes the
  // SAME dollars from taxable income as the QCD excludes -> tax TIES. Flag it
  // so the tool never overclaims a tax win that isn't there.
  if (qcdSavesFederalTax < 0.005) notes.push('tax_tie');
  if (isRmdAge && rmd > 0) notes.push('rmd_context');

  return {
    eligible: true, accountEligible: !accountHardIneligible, accountSteerAway,
    qcdEligibleAge, isRmdAge, qcdLimit, sd65,
    qcdAmount, overLimit,
    agiA, taxA, resA,
    agiB, taxB, resB,
    qcdSavesFederalTax, agiKeptLowerBy, rmdSatisfiedByQcd,
    notes
  };
}
