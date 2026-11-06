// tax-year.js: which tax year's tables a paycheck calculator uses today.
//
// Every page ships the 2026 tables and the 2027 tables side by side, and the
// browser picks by its own date, so the calculators change over at midnight on
// 1 January 2027 with no deploy. Until then nothing computes with 2027 figures.
// Built pages stay on tax-data-2026.json: their prose, tables and examples are
// written for 2026 and are moved over by a build, not by this file.
//
// Pure, dependency-free. Shared by the browser and scripts/test-tax-data-2027.js.

/** The first tax year the 2027 tables apply to. */
export const NEXT_TAX_YEAR = 2027;

/**
 * The tax year for a moment, read on the visitor's own calendar: a paycheck dated
 * 1 January is 2027 wherever it is paid. An unreadable date stays on 2026.
 * @param {Date} [now]
 * @returns {2026|2027}
 */
export function taxYearFor(now = new Date()) {
  return now.getFullYear() >= NEXT_TAX_YEAR ? NEXT_TAX_YEAR : NEXT_TAX_YEAR - 1;
}

/**
 * The tables to compute with. The 2026 tables are the fallback if a page was
 * served without its 2027 copy.
 * @param {object} data2026
 * @param {object} [data2027]
 * @param {Date} [now]
 * @returns {object}
 */
export function pickTaxData(data2026, data2027, now = new Date()) {
  return taxYearFor(now) === NEXT_TAX_YEAR && data2027 ? data2027 : data2026;
}

/**
 * The one sentence pair a calculator shows once it runs on 2027 tables. '' while
 * it is on 2026, so nothing about 2027 appears before 1 January.
 * @param {object} taxData  the tables in use
 * @param {string} slug     the state, if one is chosen
 * @returns {string} plain text
 */
export function taxYearNote(taxData, slug) {
  if (!taxData || Number(taxData.taxYear) < NEXT_TAX_YEAR) return '';
  const yr = taxData.taxYear;
  const federal = `Federal tax and the Social Security limit use the official ${yr} figures.`;
  const st = taxData.states && taxData.states[slug];
  if (!st || !st.hasIncomeTax) return federal;
  const fy = st.figureYear;
  if (st.yearNoteLabel)
    return `${federal} ${st.yearNoteLabel} is used here. ${st.name}'s other state figures stay at ${fy} ` +
      `until the state publishes ${yr}.`;
  return `${federal} ${st.name}'s state tax uses its ${fy} figures until the state publishes ${yr}.`;
}
