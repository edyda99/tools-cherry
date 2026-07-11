// bonus-tax.js — supplemental-wage (bonus) withholding vs. true tax liability.
// Pure, framework-free. Runs client-side (browser ESM) and in Node (build-time
// tests). All tax PARAMETERS come from tax-data-2026.json (federal brackets /
// std deduction / FICA + per-state income tax) and state-supplemental-2026.json
// (per-state supplemental method + rate). This file is thin logic on top of the
// existing paycheck engine — it does NOT re-derive bracket math.
import { federalIncomeTax, stateIncomeTax } from './paycheck-engine.js';

/**
 * Federal supplemental (bonus) withholding: flat 22% up to the $1,000,000
 * cumulative supplemental-wage cap, then a mandatory 37% on the excess.
 * @param {number} bonus
 * @param {number} ytdSupp - supplemental wages already paid this year (for the $1M edge)
 * @param {{flatRate:number, highRate:number, highThreshold:number}} fedSupp
 */
export function federalSupplementalWithholding(bonus, ytdSupp, fedSupp) {
  const b = Math.max(0, bonus || 0);
  const ytd = Math.max(0, ytdSupp || 0);
  const roomAt22 = Math.max(0, fedSupp.highThreshold - ytd);
  const at22 = Math.min(b, roomAt22);
  const at37 = Math.max(0, b - at22);
  return at22 * fedSupp.flatRate + at37 * fedSupp.highRate;
}

/**
 * Wisconsin four-band supplemental rate, keyed on annual gross wages.
 * @param {number} annualGross
 * @param {Array<{upTo:number|null, rate:number}>} bands
 */
export function wisconsinBandedRate(annualGross, bands) {
  const g = Math.max(0, annualGross || 0);
  for (const band of bands) {
    // WI Pub W-166 bands are "at least X, but less than Y" — an exact-boundary
    // gross belongs to the HIGHER band, so use strict `<` (not `<=`).
    if (band.upTo == null || g < band.upTo) return band.rate;
  }
  return bands.length ? bands[bands.length - 1].rate : 0;
}

/**
 * State supplemental WITHHOLDING for the "withheld now" column.
 * Handles none / flat / special (ca_dual, pct_of_federal, wi_banded).
 * The `regular` (aggregate) method is NOT handled here — it needs the paycheck
 * engine and is computed in computeBonus(); calling this with a regular-method
 * state returns null so the caller routes it to the aggregate path.
 * @param {number} bonus
 * @param {object} supp - the state's entry from state-supplemental-2026.json
 * @param {{annualGross:number, federalWithheld:number, paymentType:string}} ctx
 * @returns {number|null} withholding, or null for the regular/aggregate path
 */
export function supplementalStateWithholding(bonus, supp, ctx = {}) {
  const b = Math.max(0, bonus || 0);
  if (!supp) return 0;
  switch (supp.method) {
    case 'none':
      return 0;
    case 'flat':
      return b * supp.rate;
    case 'special':
      if (supp.special === 'ca_dual') {
        // 10.23% on bonuses & stock options; 6.6% on "other" supplemental wages.
        const rate = ctx.paymentType === 'other' ? supp.rateOther : supp.rate;
        return b * rate;
      }
      if (supp.special === 'pct_of_federal') {
        // Vermont: a percent of the FEDERAL withholding, not of the bonus.
        return supp.rate * Math.max(0, ctx.federalWithheld || 0);
      }
      if (supp.special === 'wi_banded') {
        return b * wisconsinBandedRate(ctx.annualGross ?? b, supp.bands);
      }
      return 0;
    case 'regular':
      return null; // aggregate path — computeBonus handles it via the paycheck engine
    default:
      return 0;
  }
}

/**
 * Incremental FICA on the bonus. FICA is a TRUE tax (not a prepayment that trues
 * up), so it is identical in the "withheld" and "true liability" columns.
 * Social Security stops at the wage base; the 0.9% additional Medicare applies to
 * the portion of (regular + bonus) above the filing-status threshold.
 * @param {number} bonus
 * @param {number} regIncome - regular annual wages already earned (drives SS cap + addl-Medicare)
 * @param {string} filingStatus
 * @param {object} fed - taxData.federal (fica constants)
 */
export function bonusFicaWithholding(bonus, regIncome, filingStatus, fed) {
  const b = Math.max(0, bonus || 0);
  const reg = Math.max(0, regIncome || 0);
  const f = fed.fica;
  // Social Security only on the bonus dollars still under the wage base.
  const ssRoom = Math.max(0, f.socialSecurity.wageBase - reg);
  const socialSecurity = Math.min(b, ssRoom) * f.socialSecurity.rate;
  const medicare = b * f.medicare.rate;
  const addlThreshold =
    f.additionalMedicare.threshold[filingStatus] ?? f.additionalMedicare.threshold.single;
  // Additional Medicare on the bonus = the slice of (reg+bonus) over the threshold
  // that is attributable to the bonus.
  const addlOnTotal = Math.max(0, reg + b - addlThreshold) * f.additionalMedicare.rate;
  const addlOnReg = Math.max(0, reg - addlThreshold) * f.additionalMedicare.rate;
  const additionalMedicare = Math.max(0, addlOnTotal - addlOnReg);
  return {
    socialSecurity,
    medicare,
    additionalMedicare,
    total: socialSecurity + medicare + additionalMedicare
  };
}

/**
 * TRUE income tax on the bonus at year-end = f(reg + bonus) - f(reg), over the
 * graduated federal brackets and the state income tax. Thin wrapper over the
 * paycheck engine — no bracket re-derivation.
 * @returns {{federal:number, state:number}}
 */
export function trueTaxOnBonus(bonus, regIncome, filingStatus, stateData, fed) {
  const b = Math.max(0, bonus || 0);
  const reg = Math.max(0, regIncome || 0);
  const federal =
    federalIncomeTax(reg + b, filingStatus, fed) - federalIncomeTax(reg, filingStatus, fed);
  const state =
    stateIncomeTax(reg + b, filingStatus, stateData) - stateIncomeTax(reg, filingStatus, stateData);
  return { federal: Math.max(0, federal), state: Math.max(0, state) };
}

/**
 * Full bonus computation: what's withheld now vs. what you'll actually owe.
 * @param {object} input
 * @param {number} input.bonus
 * @param {number} [input.regIncome=0] - regular annual income (drives true liability + FICA)
 * @param {string} [input.filingStatus='single']
 * @param {string} input.stateSlug
 * @param {number} [input.ytdSupp=0] - supplemental wages already paid this year (for the $1M/37% edge)
 * @param {'flat'|'aggregate'} [input.method='flat'] - federal withholding method
 * @param {'bonus'|'other'} [input.paymentType='bonus'] - CA dual-rate selector
 * @param {object} taxData - parsed tax-data-2026.json
 * @param {object} suppData - parsed state-supplemental-2026.json
 */
export function computeBonus(input, taxData, suppData) {
  const bonus = Math.max(0, input.bonus || 0);
  const regIncome = Math.max(0, input.regIncome || 0);
  const filingStatus = input.filingStatus || 'single';
  const stateSlug = input.stateSlug;
  const ytdSupp = Math.max(0, input.ytdSupp || 0);
  const method = input.method === 'aggregate' ? 'aggregate' : 'flat';
  const paymentType = input.paymentType === 'other' ? 'other' : 'bonus';

  const fed = taxData.federal;
  const stateData = taxData.states ? taxData.states[stateSlug] : null;
  const supp = suppData.states ? suppData.states[stateSlug] : null;
  const fedSupp = suppData.federal;

  // --- Column A: withheld from the check now -------------------------------
  // Federal: flat 22/37 by default; aggregate reuses the graduated engine on
  // (regular + bonus) and subtracts the regular-wage tax.
  const federalWithheld = method === 'aggregate'
    ? Math.max(0, federalIncomeTax(regIncome + bonus, filingStatus, fed) - federalIncomeTax(regIncome, filingStatus, fed))
    : federalSupplementalWithholding(bonus, ytdSupp, fedSupp);

  const annualGross = regIncome + bonus;
  let stateWithheld = supplementalStateWithholding(bonus, supp, {
    annualGross, federalWithheld, paymentType
  });
  let stateWithholdingMethod = supp ? supp.method : 'none';
  // regular-method states (or the aggregate override) -> paycheck-engine aggregate delta
  if (stateWithheld === null || (method === 'aggregate' && supp && supp.method === 'flat')) {
    stateWithheld = Math.max(0, stateIncomeTax(regIncome + bonus, filingStatus, stateData) - stateIncomeTax(regIncome, filingStatus, stateData));
    stateWithholdingMethod = 'regular';
  }

  const fica = bonusFicaWithholding(bonus, regIncome, filingStatus, fed);

  const withheldIncomeTax = federalWithheld + stateWithheld;
  const totalWithheld = withheldIncomeTax + fica.total;
  const keepNow = bonus - totalWithheld;

  // --- Column B: true tax at filing ----------------------------------------
  const trueIncome = trueTaxOnBonus(bonus, regIncome, filingStatus, stateData, fed);
  const trueIncomeTax = trueIncome.federal + trueIncome.state;
  const trueTotalTax = trueIncomeTax + fica.total; // FICA identical to column A
  const trueKeep = bonus - trueTotalTax;

  // --- The headline delta (income tax only; FICA is not a prepayment) ------
  const delta = withheldIncomeTax - trueIncomeTax; // + => refund expected; - => you'll owe

  return {
    bonus,
    withheld: {
      federal: federalWithheld,
      state: stateWithheld,
      stateMethod: stateWithholdingMethod,
      fica: fica.total,
      ficaBreakdown: fica,
      incomeTax: withheldIncomeTax,
      total: totalWithheld,
      keep: keepNow,
      pctOfBonus: bonus > 0 ? totalWithheld / bonus : 0
    },
    trueLiability: {
      federal: trueIncome.federal,
      state: trueIncome.state,
      fica: fica.total,
      incomeTax: trueIncomeTax,
      total: trueTotalTax,
      keep: trueKeep,
      pctOfBonus: bonus > 0 ? trueTotalTax / bonus : 0
    },
    delta,
    refund: delta >= 0,
    method,
    paymentType,
    stateSlug
  };
}
