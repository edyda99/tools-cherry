// w2-wage-boxes.js — reconciles W-2 Box 1, Box 3 and Box 5 from gross pay and
// the pre-tax amounts that were taken out of it.
//
// The three boxes are three different definitions of "wages", and they differ
// for two reasons that people conflate:
//
//   1. WHAT COMES OUT. A traditional 401(k)/403(b)/457(b) deferral is exempt
//      from federal INCOME tax but not from Social Security or Medicare tax, so
//      it lowers Box 1 and does NOT lower Box 3 or Box 5. A Section 125
//      cafeteria-plan amount (medical/dental premiums, a health FSA, a
//      dependent-care FSA, an HSA funded by payroll) is exempt from all three,
//      so it lowers all three. This single asymmetry is the answer to "why is
//      my Box 1 smaller than my Box 3".
//   2. THE CAP. Box 3 stops at the Social Security wage base for the year.
//      Box 5 has no cap. Above the wage base, Box 3 < Box 5 always.
//
// Going the other way, an amount can be taxable but not cash: group-term life
// insurance over $50,000, personal use of a company car, and similar imputed
// income are added to all three boxes, and a nonqualified deferred-compensation
// or equity item can be in Box 1 without being in Box 3/5 (or the reverse), so
// the tool takes them as two separate optional inputs rather than pretending
// every W-2 reduces to subtractions.
//
// Everything here is arithmetic on numbers the visitor types. Pure,
// dependency-free, no data fetched, nothing uploaded. Shared by the browser
// tool and the unit tests.

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const clamp0 = (n) => (n > 0 ? n : 0);

/**
 * @typedef {Object} WageBoxInput
 * @property {number} gross            total pay before any deduction
 * @property {number} [retirement401k] traditional 401(k)/403(b)/457(b) deferral (NOT Roth)
 * @property {number} [section125]     Section 125 cafeteria plan: medical/dental premiums, health FSA, dependent-care FSA, payroll-funded HSA
 * @property {number} [otherPreTax]    other amounts exempt from income tax only (e.g. qualified transit)
 * @property {number} [imputedIncome]  taxable non-cash pay added to all three boxes (group-term life over $50k, personal use of a company car)
 * @property {number} [box1Only]       taxable for income tax but not for FICA (certain nonqualified deferred comp / equity timing differences)
 */

/**
 * Reconcile the three wage boxes.
 * @param {WageBoxInput} input
 * @param {{socialSecurityWageBase:number, socialSecurityRate:number, medicareRate:number, additionalMedicareRate:number, additionalMedicareWithholdingThreshold:number}} year
 * @returns {{box1:number, box3:number, box5:number, box3Uncapped:number, cappedBy:number,
 *   socialSecurityTax:number, medicareTax:number, additionalMedicareTax:number,
 *   lines:{label:string, amount:number, box1:boolean, box3:boolean, box5:boolean, why:string}[],
 *   flags:string[]}}
 */
export function reconcileWageBoxes(input, year) {
  const gross = clamp0(num(input.gross));
  const r401k = clamp0(num(input.retirement401k));
  const s125 = clamp0(num(input.section125));
  const otherPreTax = clamp0(num(input.otherPreTax));
  const imputed = clamp0(num(input.imputedIncome));
  const box1Only = clamp0(num(input.box1Only));

  const base = gross + imputed;
  const box1 = clamp0(base - r401k - s125 - otherPreTax + box1Only);
  const box3Uncapped = clamp0(base - s125);
  const box5 = box3Uncapped;
  const cap = Number(year.socialSecurityWageBase);
  const box3 = Math.min(box3Uncapped, cap);
  const cappedBy = clamp0(box3Uncapped - box3);

  const socialSecurityTax = box3 * Number(year.socialSecurityRate);
  const medicareTax = box5 * Number(year.medicareRate);
  const addlBase = clamp0(box5 - Number(year.additionalMedicareWithholdingThreshold));
  const additionalMedicareTax = addlBase * Number(year.additionalMedicareRate);

  // The line-by-line "where each difference came from" breakdown. Only lines
  // the visitor actually entered are returned, so the explanation is about
  // their W-2 and not a generic list.
  const lines = [];
  const push = (label, amount, box1f, box3f, box5f, why) => {
    if (amount > 0) lines.push({ label, amount, box1: box1f, box3: box3f, box5: box5f, why });
  };
  push('Total pay before deductions', gross, true, true, true,
    'The starting point for all three boxes.');
  push('Taxable non-cash pay added in', imputed, true, true, true,
    'Things like group-term life insurance over $50,000 or personal use of a company car are taxable pay you never saw as cash, so they are added to all three boxes.');
  push('Traditional 401(k) / 403(b) / 457(b) put in', r401k, true, false, false,
    'Comes out of Box 1 only. Retirement deferrals escape federal income tax now, but Social Security and Medicare tax is charged on them the year you earn them, so Box 3 and Box 5 still count them. This is the single most common reason Box 1 is smaller than Box 3 and Box 5.');
  push('Health premiums, FSA or payroll HSA (Section 125 plan)', s125, true, true, true,
    'Comes out of all three boxes. Money run through a Section 125 cafeteria plan is exempt from federal income tax and from Social Security and Medicare tax alike.');
  push('Other pre-tax amounts', otherPreTax, true, false, false,
    'Comes out of Box 1 only, the same way a retirement deferral does.');
  push('Taxable for income tax but not for Social Security or Medicare', box1Only, true, false, false,
    'Added to Box 1 only. Certain nonqualified deferred compensation and equity items are counted for income tax in a different year than they are counted for Social Security and Medicare.');

  const flags = [];
  if (cappedBy > 0)
    flags.push(
      `Box 3 is capped. Social Security tax stops at the wage base of ${usd(cap)} for this year, ` +
      `so ${usd(cappedBy)} of your wages appears in Box 5 but not in Box 3. Box 3 being lower than ` +
      'Box 5 is normal and correct once you earn more than the wage base — Medicare has no cap.'
    );
  if (r401k > 0 && s125 === 0 && box1 < box3)
    flags.push(
      'Box 1 is lower than Box 3 and Box 5 by exactly your retirement contribution. That is what a ' +
      'correct W-2 looks like; it is not a mistake and it does not mean you were taxed twice.'
    );
  if (box1Only > 0 && box1 > box5)
    flags.push(
      'Box 1 is higher than Box 5 here. That does happen — it usually means income was counted for ' +
      'income tax in a year different from the year Social Security and Medicare counted it. Worth ' +
      'asking your payroll department to confirm.'
    );
  if (box1 === box3 && box3 === box5 && gross > 0)
    flags.push('All three boxes match. With no retirement deferral, no Section 125 benefits and wages under the Social Security wage base, that is exactly what you should see.');
  if (additionalMedicareTax > 0)
    flags.push(
      `Additional Medicare tax applies. Your employer must withhold an extra ` +
      `${(Number(year.additionalMedicareRate) * 100).toFixed(1)}% on the Box 5 wages above ` +
      `${usd(Number(year.additionalMedicareWithholdingThreshold))}, regardless of your filing status. ` +
      'It is folded into Box 6, not shown separately on the form.'
    );

  return {
    box1, box3, box5, box3Uncapped, cappedBy,
    socialSecurityTax, medicareTax, additionalMedicareTax,
    lines, flags,
  };
}

function usd(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}
