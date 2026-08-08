// bonus-tax.js — supplemental-wage (bonus) withholding vs. true tax liability.
// Pure, framework-free. Runs client-side (browser ESM) and in Node (build-time
// tests). All tax PARAMETERS come from tax-data-2026.json (federal brackets /
// std deduction / FICA + per-state income tax) and state-supplemental-2026.json
// (per-state supplemental method + rate). This file is thin logic on top of the
// existing paycheck engine — it does NOT re-derive bracket math.
import { federalIncomeTax, stateIncomeTax, ficaTax } from './paycheck-engine.js';

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
 * WHICH INCOME THE BRACKETS RUN ON, the one place that answers it.
 *
 * A joint return is taxed on BOTH incomes together, against the married brackets
 * and the $32,200 married standard deduction. Running those on one spouse's pay
 * alone put a two-earner household several bands too low and invented a refund
 * (a $70,000 own-pay entry answered as though the household earned $70,000).
 * So when the visitor files jointly AND has told us what the two of them earn
 * together, that household figure is the base the true-liability deltas are
 * computed from.
 *
 * THE CLAMP: a household cannot earn less than the person in it. If the figure
 * given is below the pay already entered (a typo, or one spouse's share typed
 * twice), the entered pay is used instead. That is stated in the card's own
 * helper copy too, so the reader is not silently overruled.
 *
 * FICA IS NOT ROUTED THROUGH HERE ON PURPOSE. Social Security stops at a wage
 * base PER PERSON and the extra 0.9% Medicare is withheld on ONE person's wages,
 * so bonusFicaWithholding keeps taking regIncome whatever this returns. Same for
 * the amounts WITHHELD on payday: an employer computes those from this
 * employee's own wages and knows nothing about a spouse.
 *
 * @param {number} regIncome - this person's own annual pay
 * @param {string} filingStatus
 * @param {number} [householdIncome=0] - both spouses' pay, married filers only
 * @returns {number} the income the graduated brackets and deductions run on
 */
export function bracketBaseIncome(regIncome, filingStatus, householdIncome = 0) {
  const reg = Math.max(0, regIncome || 0);
  const hh = Math.max(0, householdIncome || 0);
  if (filingStatus !== 'married' || hh <= 0) return reg;
  return Math.max(reg, hh);
}

/**
 * TRUE income tax on the bonus at year-end = f(base + bonus) - f(base), over the
 * graduated federal brackets and the state income tax. Thin wrapper over the
 * paycheck engine — no bracket re-derivation.
 *
 * `base` is the person's own pay, except for a joint filer who has given a
 * household figure, where it is the household's, see bracketBaseIncome above.
 * Omit householdIncome and this behaves exactly as it did before it existed.
 *
 * THE FICA ARGUMENT TO THE STATE TERMS. Massachusetts lets a filer deduct the FICA they
 * actually paid, capped at $2,000 (M.G.L. c.62 s.3(B)(a)(3)), so its taxable income moves
 * with FICA and the two state terms below cannot both be handed a zero. They are handed
 * DIFFERENT figures on purpose: the deduction only cancels out of the difference once the
 * $2,000 cap binds at both income levels, and below about $26,144 of wages it does not,
 * because 7.65% of those wages is still under the cap. Leaving it at zero there charged
 * Massachusetts tax on the deduction the filer really gets and overstated the state tax on
 * the bonus.
 *
 * Both figures are computed on THIS earner's OWN wages, before and after the bonus, never
 * on the household figure: the cap is per taxpayer and the statute forbids pooling it
 * between spouses, so a joint filer's own deduction is the one that belongs here. That is
 * also exactly what computePaycheck() hands the state side, so the Massachusetts paycheck
 * page and this page cannot disagree about the same earner. Every state without a
 * `tax.ficaPaidDeduction` ignores the argument, so nothing else moves.
 * @returns {{federal:number, state:number}}
 */
export function trueTaxOnBonus(bonus, regIncome, filingStatus, stateData, fed, householdIncome = 0) {
  const b = Math.max(0, bonus || 0);
  const reg = Math.max(0, regIncome || 0);
  const base = bracketBaseIncome(regIncome, filingStatus, householdIncome);
  const federal =
    federalIncomeTax(base + b, filingStatus, fed) - federalIncomeTax(base, filingStatus, fed);
  const ficaPaid1 = ficaTax(reg, filingStatus, fed).total;
  const ficaPaid2 = ficaTax(reg + b, filingStatus, fed).total;
  const state =
    stateIncomeTax(base + b, filingStatus, stateData, 0, ficaPaid2) -
    stateIncomeTax(base, filingStatus, stateData, 0, ficaPaid1);
  return { federal: Math.max(0, federal), state: Math.max(0, state) };
}

/**
 * Full bonus computation: what's withheld now vs. what you'll actually owe.
 * @param {object} input
 * @param {number} input.bonus
 * @param {number} [input.regIncome=0] - this person's own regular annual income
 *        (drives FICA always, and the true liability when there is no household figure)
 * @param {number} [input.householdIncome=0] - both spouses' annual pay, INCLUDING
 *        input.regIncome. Used only when filingStatus === 'married', and only for the
 *        federal and state bracket math. Never for FICA, which is per person. Omit it
 *        and every figure below is what it was before this input existed.
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
  // The brackets and the standard deduction run on this; FICA and everything
  // withheld on payday keep running on regIncome. Equal to regIncome unless a
  // joint filer gave a household figure above their own pay.
  const taxBase = bracketBaseIncome(regIncome, filingStatus, input.householdIncome);
  // True ONLY when the household figure actually became the base, i.e. it is ABOVE
  // the pay already entered. Answering the question is not enough. A joint filer who
  // enters 90,000 of own pay and 50,000 "together" is clamped back to 90,000 by
  // bracketBaseIncome, and the copy keyed on this flag says the deltas were "figured
  // on the $90,000 the two of you earn together", a household figure the visitor
  // never gave, contradicting the 50,000 their own summary chip is showing back to
  // them. So the flag tracks whether the base MOVED, not whether the box was filled,
  // and the pages carry a second sentence for the clamped case that says their own
  // pay was used and why.
  const usesHousehold = filingStatus === 'married' && Math.max(0, input.householdIncome || 0) > regIncome;
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
  // The only half that takes the household figure. Column A above is what an
  // employer withholds, and an employer computes that from this employee's own
  // wages: it cannot know a spouse's pay, so nothing in it may move with it.
  const trueIncome = trueTaxOnBonus(bonus, regIncome, filingStatus, stateData, fed, input.householdIncome);
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
    // What the brackets ran on, and whether that figure came from the household
    // question or from this person's own pay. The pages read these two to say which
    // income the refund estimate was figured on rather than guessing it back from
    // their own inputs. taxBase is always the number that was actually used, so a
    // page that prints taxBase is safe whichever way usesHousehold went.
    taxBase,
    usesHousehold,
    method,
    paymentType,
    stateSlug
  };
}
