// roth-catchup.js — pure, framework-free logic for the SECURE 2.0 Act §603
// "mandatory Roth catch-up" rule (IRC §414(v)(7); final reg 26 CFR 1.414(v)-2).
// Runs client-side (browser ESM) and in Node (build-time tests). All hard
// PARAMETERS (thresholds, catch-up amounts, year gating) live in
// secure2-catchup-2026.json; this file is pure logic.
//
// The rule: starting with 2026 contributions, a participant who is 50+ AND whose
// prior-year Social Security (FICA / W-2 Box 3) wages from the plan-sponsoring
// employer EXCEED the threshold ($150,000 for 2026) can no longer make PRE-TAX
// catch-up contributions — every catch-up dollar must be a designated Roth
// (after-tax) contribution. The catch-up AMOUNT is unchanged; only the tax
// treatment changes. This is NOT an OBBBA provision and does not touch federal
// income-tax brackets — the tool asks for the marginal rate directly, so this
// engine has no dependency on the paycheck/tax-bracket machinery.

/**
 * Determine whether the mandatory-Roth catch-up rule applies, the participant's
 * catch-up band and dollar maximum for the year, and the reason string.
 *
 * Gate order (statutory / §3.2 of the spec):
 *   1. under 50            -> not eligible for any catch-up at all
 *   2. year not in effect  -> 2025 and earlier: transition relief, not enforced
 *   3. no prior FICA wages -> nothing to test (e.g. partner/sole-prop, SECA only)
 *   4. wages <= threshold  -> not a high earner; pre-tax catch-up still allowed
 *   5. plan has no Roth     -> subject, but can't catch up at all (max 0)
 *   6. otherwise            -> subject; every catch-up dollar must be Roth
 *
 * The threshold test is a strict "exceed": exactly $150,000 is NOT over the line.
 *
 * @param {object} a
 * @param {number}  a.taxYear             contribution tax year (drives the constants)
 * @param {number}  a.age                 age attained by the end of the tax year
 * @param {number}  a.priorYearFicaWages  prior-year Box 3 wages from THIS employer (USD)
 * @param {boolean} [a.planOffersRoth]    does the plan offer designated Roth? (default true)
 * @param {object}  a.params              secure2.rothCatchUp
 * @returns {{subject:boolean, applies:boolean, band:'none'|'standard'|'super',
 *   maxCatchUp:number|null, maxAllowedCatchUp:number|null, threshold:number|null,
 *   effect:'must_be_roth'|'plan_no_roth_cannot_catchup'|null, enforced:boolean|null,
 *   reason:string, wages:number, notes:string[]}}
 */
export function rothCatchUpStatus({ taxYear, age, priorYearFicaWages, planOffersRoth = true, params }) {
  const yr = params.byYear[taxYear] || params.byYear[String(taxYear)] || null;
  const minAge = params.catchUpMinAge;         // 50
  const superMin = params.superBand.minAge;    // 60
  const superMax = params.superBand.maxAge;    // 63
  const a = Math.max(0, age || 0);
  const wages = Math.max(0, priorYearFicaWages || 0);
  const notes = [];

  // Catch-up band + dollar max. The band label depends only on age; the dollar
  // amount needs the year's published constants (null when they aren't out yet).
  let band, maxCatchUp;
  if (a < minAge) { band = 'none'; maxCatchUp = 0; }
  else if (a >= superMin && a <= superMax) { band = 'super'; maxCatchUp = yr ? yr.cSuper : null; }
  else { band = 'standard'; maxCatchUp = yr ? yr.cStd : null; } // 50–59 and 64+ revert

  const subjectByAge = a >= minAge;
  const inEffectYear = taxYear >= params.firstEnforcedYear; // 2025 -> transition relief

  // Enforced year whose COLA constants aren't published yet (e.g. 2027). We can't
  // give a threshold or dollar max — surface pending guidance, don't fabricate.
  if (!yr) {
    if (inEffectYear) {
      notes.push('pending_irs_guidance');
      return {
        subject: false, applies: false, band, maxCatchUp: null, maxAllowedCatchUp: null,
        threshold: null, effect: null, enforced: true, reason: 'pending_irs_guidance', wages, notes
      };
    }
    // Pre-2026 year without constants shouldn't occur (2025 is present) — treat
    // defensively as transition relief.
    return {
      subject: false, applies: false, band, maxCatchUp: null, maxAllowedCatchUp: null,
      threshold: null, effect: null, enforced: false, reason: `transition_relief_${taxYear}`, wages,
      notes: ['transition_relief']
    };
  }

  const threshold = yr.threshold;
  const enforced = yr.enforced;
  const subjectByWages = wages > threshold; // strict "exceed"

  let applies, effect = null, reason, maxAllowedCatchUp = maxCatchUp;
  if (!subjectByAge) {
    applies = false; reason = 'under_50_no_catchup';
  } else if (!inEffectYear) {
    applies = false; reason = `transition_relief_${taxYear}`; notes.push('transition_relief');
  } else if (wages === 0) {
    applies = false; reason = 'no_prior_year_fica_wages';
  } else if (!subjectByWages) {
    applies = false; reason = 'wages_at_or_below_threshold';
  } else if (!planOffersRoth) {
    applies = true; effect = 'plan_no_roth_cannot_catchup'; reason = 'plan_no_roth_cannot_catchup';
    maxAllowedCatchUp = 0;
  } else {
    applies = true; effect = 'must_be_roth'; reason = 'must_be_roth';
  }

  return {
    subject: applies, applies, band, maxCatchUp, maxAllowedCatchUp, threshold,
    effect, enforced, reason, wages, notes
  };
}

/**
 * The extra federal income tax this year from forcing the catch-up into Roth:
 * the upfront deduction you forgo on the after-tax catch-up dollars. This is the
 * concrete, assumption-free number (unlike the future-value comparison).
 *
 * @param {object} a
 * @param {number} a.effectiveCatchUp    catch-up dollars actually contributed (USD)
 * @param {number} a.currentMarginalRate current federal marginal rate (decimal, .24 = 24%)
 * @returns {{extraTaxThisYear:number}}
 */
export function rothCatchUpCost({ effectiveCatchUp, currentMarginalRate }) {
  const c = Math.max(0, effectiveCatchUp || 0);
  const rate = Math.max(0, currentMarginalRate || 0);
  return { extraTaxThisYear: c * rate };
}

/**
 * Roth-vs-pre-tax break-even at retirement, using the standard Roth/traditional
 * equivalence (assumes the pre-tax route reinvests its upfront deduction C·tc at
 * the same growth g in a tax-advantaged bucket — state this in the UI):
 *
 *   rothAdvantageAtRetirement = C × (1+g)^n × (tr − tc)
 *
 *   > 0  forced-Roth wins (retirement rate higher than current)
 *   < 0  forced-Roth costs you (retirement rate lower)
 *   = 0  at tr = tc, the break-even
 *
 * @param {object} a
 * @param {number} a.catchUp         catch-up dollars C (USD)
 * @param {number} a.years           years to retirement n
 * @param {number} a.growth          expected annual growth g (decimal, .06 = 6%)
 * @param {number} a.currentRate     current marginal rate tc (decimal)
 * @param {number} a.retirementRate  expected retirement marginal rate tr (decimal)
 * @returns {{rothAdvantage:number, breakEvenRate:number, futureValue:number}}
 */
export function rothVsPretax({ catchUp, years, growth, currentRate, retirementRate }) {
  const C = Math.max(0, catchUp || 0);
  const n = Math.max(0, years || 0);
  const g = growth || 0;
  const tc = currentRate || 0;
  const tr = retirementRate || 0;
  const futureValue = C * Math.pow(1 + g, n);
  return { rothAdvantage: futureValue * (tr - tc), breakEvenRate: tc, futureValue };
}

/**
 * End-to-end estimate for the tool: the mandate determination, the effective
 * (band-capped) catch-up, the extra-tax-this-year, and the Roth-vs-pre-tax
 * future-value comparison. Mirrors estimateSenior / estimateCarLoan.
 *
 * Numeric conventions for the "n/a" vs "$0" distinction the UI relies on:
 *   - extraTaxThisYear is null (n/a) when there is no catch-up concept at all
 *     (under 50) or the year's constants are pending; 0 when a catch-up exists
 *     but the mandate doesn't force Roth (not a high earner, no catch-up elected,
 *     or a no-Roth plan); and the computed cost when the mandate actually bites.
 *   - rothAdvantage/breakEvenRate are null unless the mandate bites AND both
 *     marginal rates were supplied.
 *
 * @param {object} a  (taxYear, age, priorYearFicaWages, planOffersRoth,
 *   catchUpAmount, currentMarginalRate, retirementMarginalRate, yearsToRetirement,
 *   growthRate, params)
 */
export function estimateRothCatchUp({
  taxYear, age, priorYearFicaWages, planOffersRoth = true,
  catchUpAmount, currentMarginalRate, retirementMarginalRate,
  yearsToRetirement, growthRate, params
}) {
  const st = rothCatchUpStatus({ taxYear, age, priorYearFicaWages, planOffersRoth, params });

  // Effective catch-up: what the participant can actually contribute, capped to
  // the band max (or 0 when a no-Roth plan bars catch-ups). When the year's max
  // is unknown (pending constants) fall back to the requested amount uncapped.
  const desired = Math.max(0, catchUpAmount || 0);
  let effectiveCatchUp;
  if (st.effect === 'plan_no_roth_cannot_catchup') effectiveCatchUp = 0;
  else if (st.maxCatchUp == null) effectiveCatchUp = desired;
  else effectiveCatchUp = Math.min(desired, st.maxCatchUp);

  const mandateBites = st.applies && st.effect === 'must_be_roth' && effectiveCatchUp > 0;

  const notes = [...st.notes];
  if (st.applies && st.effect === 'must_be_roth' && desired === 0) notes.push('no_catchup_elected');

  let extraTaxThisYear;
  if (st.band === 'none' || st.reason === 'pending_irs_guidance') extraTaxThisYear = null; // n/a
  else if (mandateBites) extraTaxThisYear = rothCatchUpCost({ effectiveCatchUp, currentMarginalRate }).extraTaxThisYear;
  else extraTaxThisYear = 0;

  let rothAdvantage = null, breakEvenRate = null, futureValue = null;
  if (mandateBites && currentMarginalRate != null && retirementMarginalRate != null) {
    const r = rothVsPretax({
      catchUp: effectiveCatchUp, years: yearsToRetirement, growth: growthRate,
      currentRate: currentMarginalRate, retirementRate: retirementMarginalRate
    });
    rothAdvantage = r.rothAdvantage;
    breakEvenRate = r.breakEvenRate;
    futureValue = r.futureValue;
  }

  return {
    ...st, catchUpAmount: desired, effectiveCatchUp, mandateBites,
    extraTaxThisYear, rothAdvantage, breakEvenRate, futureValue, notes
  };
}
