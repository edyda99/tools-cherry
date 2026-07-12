// able-contribution.js — ABLE account (26 U.S.C. §529A) annual contribution
// limit engine for tax year 2026, per docs/able-account-calculator-spec.md.
// Pure, framework-free. Runs client-side (browser ESM) and in Node (build-time
// tests). Every dollar PARAMETER comes from src/data/able-limits-2026.json —
// this file is pure §529A cap arithmetic. STANDALONE by design: savings-account
// policy, not tax/payroll — no reuse of paycheck-engine.js / obbba-deduction.js.
//
// THE LAW (all figures verified in the spec against 26 U.S.C. §529A as amended
// by SECURE 2.0 §124 and P.L. 119-21 §70115, Rev. Proc. 2025-32, Treas. Reg.
// §1.529A-2, and the HHS poverty guidelines):
//   * ELIGIBILITY: blindness/disability onset BEFORE age 46 (was 26) — first
//     effective for TY 2026. Onset-based, not current-age-based: onset at 30 +
//     currently 58 → eligible; onset at 47 → never eligible (spec §1.1). This
//     engine gates on that single statutory age; it performs NO medical or
//     benefits determination.
//   * BASE LIMIT: $20,000 for 2026 (Rev. Proc. 2025-32 §3.34) — NO LONGER the
//     gift-tax exclusion ($19,000): OBBBA §70115 decoupled the indexing.
//   * ABLE-TO-WORK (permanent as of OBBBA): an employed beneficiary with NO
//     contribution made on their behalf to a §414(i) DC plan / §403(b) /
//     §457(b) — employer-only matches block it too — may add, on top of the
//     base, the LESSER of their §219(f)(1) compensation or the one-person
//     federal poverty line for their state of residence. The FPL differs for
//     Alaska and Hawaii, hence the 3-bucket 48+DC / AK / HI lookup.
//   * Only the beneficiary's OWN money may occupy the bonus space; family
//     money can never use it (§529A(b)(2)(B)(ii)).
//   * ONE POOL per beneficiary per year, all contributors combined; a 529→ABLE
//     rollover counts against the BASE limit specifically (§529(c)(3)(C)(i))
//     and can never ride in the bonus space.
//   * EXCESS not returned by the return due date → 6% excise (§4973(a)(6),
//     Form 5329 Part VIII).
//
// FPL-YEAR AMBIGUITY (spec §7.1 — flagged, not guessed): the statute points to
// the poverty line "determined for the calendar year preceding the calendar
// year in which the taxable year begins" → the Jan-2025 HHS set ($15,650 /
// $19,550 AK / $17,990 HI), which is what the shipped dataset carries. The
// alternate reading (Pub 907 (2025) outlier pattern) would use the Jan-2026
// set ($15,960 / $19,950 / $18,360) — kept in the dataset under the stripped
// `_alternateFpl2026Reading` key and as commented alternate expectations in
// scripts/test-able-account.js, NOT as a second live mode. The default is the
// LOWER set, so this tool can never advise an over-contribution.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(n) {
  return Math.max(0, Number(n) || 0);
}

function usd(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// 3-bucket 51-state FPL lookup (Treas. Reg. §1.529A-2(g)(2): the poverty line
// is for "the State of residence of the employed designated beneficiary", and
// HHS publishes separate one-person figures for Alaska and Hawaii). Every
// state/DC other than AK/HI maps to the 48-contiguous-states + DC figure.
export function fplBucket(stateAbbr) {
  const s = String(stateAbbr || '').toUpperCase();
  if (s === 'AK') return 'AK';
  if (s === 'HI') return 'HI';
  return 'contiguousDC';
}

// Statutory onset gate (§529A(e)(1), SECURE 2.0 §124): eligible only if the
// blindness/disability occurred BEFORE the date the individual attained the
// limit age (46 for TY 2026). Strict less-than: onset ON the 46th birthday
// fails; the day before passes (spec §1.1 edge).
export function onsetEligible(onsetAge, limits) {
  const limit = (limits && limits.eligibility && limits.eligibility.onsetAgeLimit) || 46;
  const a = Number(onsetAge);
  return Number.isFinite(a) && a < limit;
}

/**
 * ABLE annual contribution limit / room / excess for one beneficiary, TY 2026.
 *
 * @param {object} a
 * @param {boolean} a.onsetBefore46   statutory eligibility gate — the beneficiary's blindness/disability began before they turned 46 (use onsetEligible() to derive from a numeric onset age). false → gate result, no math.
 * @param {string}  a.state           beneficiary's state of residence, 2-letter abbr (longest-residence state for movers). Mapped internally to the 3 FPL buckets.
 * @param {boolean} a.employed        beneficiary has W-2 or self-employment compensation this year.
 * @param {number}  a.compensation    §219(f)(1) compensation includible in the beneficiary's gross income for 2026 ($).
 * @param {boolean} a.planContribution ANY contribution made for the beneficiary this year — including employer-only matches/nonelectives — to a §414(i) DC plan, §403(b), or §457(b). Blocks the bonus entirely.
 * @param {number}  a.others          contributions from family/friends/trusts/anyone other than the beneficiary ($).
 * @param {number}  a.own             the beneficiary's OWN contributions ($) — the only money that may occupy bonus space.
 * @param {number}  [a.rollover529]   529→ABLE rollover this year ($) — counts against the BASE limit only.
 * @param {object}  a.limits          src/data/able-limits-2026.json.
 */
export function ableContribution(a) {
  const { limits } = a;
  if (!limits || !limits.baseLimit || !limits.ableToWork || !limits.ableToWork.fplOnePerson) {
    return { error: 'missing_limits', notes: ['ABLE limit data failed to load.'] };
  }

  // Eligibility gate (informational, statutory age only — never a medical or
  // benefits determination). Fixture 10: gate stops before any math; no
  // contribution limit exists for a non-eligible individual.
  if (a.onsetBefore46 === false) {
    const limitAge = (limits.eligibility && limits.eligibility.onsetAgeLimit) || 46;
    return {
      eligible: false,
      error: 'not_eligible',
      notes: [
        `Only an "eligible individual" can have an ABLE account, and for tax years beginning after December 31, 2025 that means the blindness or disability began (onset) before age ${limitAge} — up from 26 under SECURE 2.0 §124. What matters is the age when the disability BEGAN, not the current age: someone whose disability began at 30 who is now 58 qualifies; onset at ${limitAge + 1} does not qualify at any current age. If the onset was at ${limitAge} or later, no ABLE contribution limit exists because an ABLE account can't be opened for that person. See ssa.gov and your state ABLE program for the eligibility paths (SSA title II/XVI benefits, or a disability certification).`
      ]
    };
  }

  const base = limits.baseLimit;
  const bucket = fplBucket(a.state);
  const fpl = limits.ableToWork.fplOnePerson[bucket];

  const employed = !!a.employed;
  const planContribution = !!a.planContribution;
  const compensation = money(a.compensation);
  const others = money(a.others);
  const own = money(a.own);
  const rollover529 = money(a.rollover529);

  // ABLE-to-Work (§529A(b)(2)(B)(ii), (b)(7)): employed AND no contribution —
  // including employer-only — to a §414(i) DC plan / §403(b) / §457(b).
  const bonusEligible = employed && !planContribution;
  const bonusCap = bonusEligible ? round2(Math.min(compensation, fpl)) : 0;

  // Only the beneficiary's own contributions may occupy bonus space (spec
  // Correction 3), so the limit this household actually gets is base plus the
  // part of `own` that fits in the bonus.
  const bonusUsed = round2(Math.min(own, bonusCap));
  const totalLimit = round2(base + bonusUsed);

  const totalContrib = round2(others + rollover529 + own);
  const excess = round2(Math.max(0, totalContrib - totalLimit));

  // Room displays (spec §3.3). Base pool usage: others + rollover + the
  // beneficiary's spillover beyond the bonus; bonus pool usage: beneficiary
  // only.
  const baseNonOwn = round2(others + rollover529);
  const ownSpill = round2(Math.max(0, own - bonusCap));
  const baseUsed = round2(Math.min(base, baseNonOwn + ownSpill));
  const ownAllowed = round2(Math.max(0, base - baseNonOwn) + bonusCap);
  const roomOwn = round2(Math.max(0, ownAllowed - own));
  const roomOthers = round2(Math.max(0, base - baseNonOwn - ownSpill));
  const combinedMax = round2(base + bonusCap);

  const notes = [];

  if (employed && planContribution) {
    notes.push(
      `No ABLE-to-Work bonus this year: a contribution is being made on your behalf to a workplace retirement plan (401(k)-type, 403(b), or 457(b)). The statute blocks the bonus when ANY such contribution is made — including an employer-only match or automatic contribution you didn't elect (26 U.S.C. §529A(b)(7)). Only those three plan types block it; a pension (defined-benefit) accrual does not.`
    );
  }
  if (bonusEligible && bonusCap > 0) {
    notes.push(
      `Your ABLE-to-Work bonus space is ${usd(bonusCap)} — the lesser of your compensation (${usd(compensation)}) and the one-person federal poverty line for ${bucket === 'AK' ? 'Alaska' : bucket === 'HI' ? 'Hawaii' : 'the 48 contiguous states and D.C.'} (${usd(fpl)}). Only money you contribute yourself can use this space — family contributions can't. And you (not your ABLE program) are solely responsible for staying within it: "The employed designated beneficiary, or the person acting on his or her behalf, is solely responsible for ensuring that the requirements in section 529A(b)(2)(B)(ii) … are met" (Treas. Reg. §1.529A-2(g)(2)).`
    );
  }
  if (rollover529 > 0) {
    notes.push(
      `Your 529→ABLE rollover of ${usd(rollover529)} counts against the ${usd(base)} base limit — it shares the same per-beneficiary pool as everyone's cash contributions and can never use the ABLE-to-Work space (26 U.S.C. §529(c)(3)(C)(i)). 529→ABLE rollovers are permanent as of 2026 (they had been scheduled to expire January 1, 2026).${excess > 0 ? ' Any part of a 529→ABLE rollover that exceeds the base limit loses rollover treatment — it is a taxable 529 distribution, not just an excess ABLE contribution.' : ''}`
    );
  }
  if (excess > 0) {
    notes.push(
      `You are ${usd(excess)} over the limit. Excess contributions (and their earnings) that the ABLE program doesn't return to the contributors by the due date of the beneficiary's tax return — including extensions — incur a 6% excise tax, figured on Form 5329, Part VIII (26 U.S.C. §4973(a)(6)). Ask the program to return the excess before the due date and it's treated as never contributed.`
    );
  }

  return {
    eligible: true,
    taxYear: limits.taxYear || 2026,
    bucket,
    base,
    fpl,
    bonusEligible,
    bonusCap,
    combinedMax,
    totalLimit,
    others,
    own,
    rollover529,
    totalContrib,
    excess,
    baseUsed,
    bonusUsed,
    ownAllowed,
    roomOwn,
    roomOthers,
    notes
  };
}

export { round2, usd };
