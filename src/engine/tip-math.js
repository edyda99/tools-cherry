// tip-math.js — pure money arithmetic for the Tip Calculator.
// No DOM, no locale dependency in the core math: callers pass plain numbers
// (all amounts in dollars) so this is fully unit-testable in Node and renders
// identically in the browser. All currency rounding is done to whole cents.

/** Round a dollar amount to whole cents (2 decimals), avoiding binary-float
 *  drift like 0.1 + 0.2. Returns a Number. */
export function roundCents(amount) {
  // Scale, round half-up on the absolute value to keep .005 -> .01 symmetric,
  // then restore sign. EPSILON nudges values that land just under .5 due to
  // float representation (e.g. 1.005 stored as 1.00499...).
  const sign = amount < 0 ? -1 : 1;
  const cents = Math.round(Math.abs(amount) * 100 + Number.EPSILON);
  return (sign * cents) / 100;
}

/**
 * Core tip/bill computation.
 *
 * @param {object} opts
 * @param {number} opts.bill        Pre-tip bill amount in dollars (>= 0).
 * @param {number} opts.tipPercent  Tip rate as a percentage, e.g. 18 for 18%.
 * @param {number} [opts.tax=0]     Tax already included in `bill`, in dollars.
 *                                  When `tipOnPreTax` is true the tip is taken
 *                                  on (bill - tax) instead of the full bill.
 * @param {boolean} [opts.tipOnPreTax=false]  Tip on the pre-tax subtotal.
 * @param {number} [opts.people=1]  Number of people splitting (>= 1).
 * @param {('none'|'total'|'tip')} [opts.round='none']
 *        Rounding mode: 'total' rounds the grand total up to the next whole
 *        dollar (tip absorbs the difference); 'tip' rounds the tip up to the
 *        next whole dollar; 'none' leaves cents as-is.
 *
 * @returns {{tip, total, perPerson, tipPerPerson, effectiveTipPercent}}
 *          All monetary fields are rounded to whole cents.
 */
export function computeTip(opts) {
  const bill = Math.max(0, Number(opts.bill) || 0);
  const tipPercent = Math.max(0, Number(opts.tipPercent) || 0);
  const tax = Math.max(0, Number(opts.tax) || 0);
  const tipOnPreTax = !!opts.tipOnPreTax;
  const people = Math.max(1, Math.floor(Number(opts.people) || 1));
  const round = opts.round || 'none';

  // Base the tip on the pre-tax subtotal when requested (and tax is sensible).
  const tipBase = tipOnPreTax ? Math.max(0, bill - Math.min(tax, bill)) : bill;
  let tip = roundCents(tipBase * (tipPercent / 100));
  let total = roundCents(bill + tip);

  if (round === 'tip') {
    tip = Math.ceil(tip);
    total = roundCents(bill + tip);
  } else if (round === 'total') {
    total = Math.ceil(total);
    tip = roundCents(total - bill); // tip absorbs the rounding gap
  }

  const perPerson = roundCents(total / people);
  const tipPerPerson = roundCents(tip / people);
  // Effective tip rate against the full bill (informational; 0 when bill is 0).
  const effectiveTipPercent = bill > 0 ? (tip / bill) * 100 : 0;

  return { tip, total, perPerson, tipPerPerson, effectiveTipPercent };
}
