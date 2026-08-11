// projections-2027.js — the arithmetic and, more importantly, the REFUSAL rules
// behind /2027-tax-brackets/ and /2027-social-security-cola/.
//
// Both of those pages sit on statutory formulas whose inputs are monthly BLS
// index values, some of which are not published yet. The entire risk on those
// pages is publishing a dollar figure that looks computed but was actually
// filled in from a guess, so the guard functions here are the point of the file
// and the arithmetic is the easy part:
//
//   * windowStatus()   — reports exactly which months are in and which are not.
//   * average()        — THROWS on a null. It cannot be handed a partial series.
//   * assertComplete() — the gate build.js calls before it is allowed to render
//                        a projected dollar figure at all.
//
// No interpolation, no carry-forward, no "estimate the remaining months". A
// month BLS has not published is `null` and stays `null`.
//
// Pure, dependency-free, shared by build.js, the browser calculator and the
// unit tests. Rates are PERCENT where they are labelled percent.

/** A month key that is not published yet, or was never published at all. */
const isMissing = (m) => m === null || m === undefined;

/**
 * Value of one month entry, checked. Entries are `{ value, sourceUrl,
 * publishedDate, ... }` objects; anything else is a data-file error, not a
 * pending month, and is thrown rather than quietly treated as pending.
 * @param {string} key e.g. "2026-06"
 * @param {*} entry the raw entry from projections-2027.json
 * @returns {number|null} the index value, or null when the month is pending
 */
export function monthValue(key, entry) {
  if (isMissing(entry)) return null;
  if (typeof entry !== 'object' || !Number.isFinite(entry.value))
    throw new Error(`projections-2027: month ${key} is neither null nor an entry with a numeric value`);
  if (!entry.sourceUrl || !entry.publishedDate)
    throw new Error(`projections-2027: month ${key} has a value but no sourceUrl/publishedDate — every published number on this site carries its citation`);
  return entry.value;
}

/**
 * The 12 (or 3) month keys a window covers, inclusive, in order.
 * @param {string} start "YYYY-MM"
 * @param {string} end "YYYY-MM"
 * @returns {string[]}
 */
export function monthKeys(start, end) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(s));
    if (!m) throw new Error(`projections-2027: bad month key "${s}"`);
    return Number(m[1]) * 12 + (Number(m[2]) - 1);
  };
  const a = parse(start), b = parse(end);
  if (b < a) throw new Error(`projections-2027: window ends (${end}) before it starts (${start})`);
  const out = [];
  for (let i = a; i <= b; i++) out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  return out;
}

/**
 * Completeness report for a window. This is what the input-status table on the
 * page renders from, so it names each month rather than returning a count.
 * @param {string[]} keys month keys in order
 * @param {Record<string, *>} months the raw `months` object
 * @returns {{keys:string[], present:string[], missing:string[], total:number, complete:boolean}}
 */
export function windowStatus(keys, months) {
  const present = [];
  const missing = [];
  for (const k of keys) {
    if (monthValue(k, months[k]) === null) missing.push(k);
    else present.push(k);
  }
  return { keys, present, missing, total: keys.length, complete: missing.length === 0 };
}

/**
 * Mean of a window. Throws if ANY month is pending — a partial average is the
 * exact mistake this file exists to prevent, and a caller that wants a
 * partial-quarter figure has to ask for it by name (partialAverage).
 * @param {string[]} keys
 * @param {Record<string, *>} months
 * @returns {number}
 */
export function average(keys, months) {
  const st = windowStatus(keys, months);
  if (!st.complete)
    throw new Error(
      `projections-2027: refusing to average an incomplete window — ${st.missing.length} of ` +
      `${st.total} month(s) are unpublished (${st.missing.join(', ')}). Publishing a figure from ` +
      'a partial window would be a made-up number.'
    );
  return keys.reduce((s, k) => s + months[k].value, 0) / keys.length;
}

/**
 * Mean of only the months that ARE published, with the count, for an explicitly
 * labelled partial-quarter comparison. Returns null when nothing is published.
 * Callers MUST render `n` alongside the figure; the COLA page does.
 * @returns {{mean:number, n:number, of:number, keys:string[]}|null}
 */
export function partialAverage(keys, months) {
  const st = windowStatus(keys, months);
  if (!st.present.length) return null;
  const mean = st.present.reduce((s, k) => s + months[k].value, 0) / st.present.length;
  return { mean, n: st.present.length, of: keys.length, keys: st.present };
}

/**
 * The gate. build.js calls this immediately before rendering any projected
 * dollar amount; it throws with a message that names the missing months, so a
 * build that would have shipped a fabricated figure dies loudly instead.
 * @param {{missing:string[], total:number, complete:boolean}} status
 * @param {string} what what was about to be rendered, for the error message
 */
export function assertComplete(status, what) {
  if (!status.complete)
    throw new Error(
      `projections-2027: BUILD REFUSED — tried to render ${what} while ${status.missing.length} of ` +
      `${status.total} required month(s) are unpublished (${status.missing.join(', ')}). ` +
      'The page must stay in partial-data mode until BLS publishes them.'
    );
}

/**
 * Social Security COLA: the percentage by which one third-quarter CPI-W average
 * exceeds the prior one, rounded to the nearest one tenth of one percent, and
 * never negative (a fall in prices yields a 0.0% COLA, it does not cut
 * benefits).
 * @param {number} priorQ3 average CPI-W for the base third quarter
 * @param {number} currentQ3 average CPI-W for the measuring third quarter
 * @returns {number} percent, e.g. 3.8
 */
export function colaPercent(priorQ3, currentQ3) {
  if (!Number.isFinite(priorQ3) || !Number.isFinite(currentQ3) || priorQ3 <= 0) return NaN;
  const raw = (currentQ3 / priorQ3 - 1) * 100;
  if (raw <= 0) return 0;
  return Math.round(raw * 10) / 10;
}

/**
 * What a given COLA does to a given monthly benefit. This is the part of the
 * COLA page that works on day one, at any percentage the visitor types, with no
 * dependency on unpublished data at all.
 * @param {number} monthlyBenefit current gross monthly benefit in dollars
 * @param {number} colaPct the COLA as a percent, e.g. 3.8
 * @returns {{current:number, newMonthly:number, monthlyIncrease:number, annualIncrease:number, newAnnual:number, colaPct:number}}
 */
export function applyCola(monthlyBenefit, colaPct) {
  const b = Number(monthlyBenefit), p = Number(colaPct);
  const bad = { current: NaN, newMonthly: NaN, monthlyIncrease: NaN, annualIncrease: NaN, newAnnual: NaN, colaPct: NaN };
  if (!Number.isFinite(b) || b < 0 || !Number.isFinite(p)) return bad;
  // SSA rounds each person's adjusted monthly benefit DOWN to the whole dollar.
  const newMonthly = Math.floor((b * (1 + p / 100)) * 100) / 100;
  const rounded = Math.floor(newMonthly);
  return {
    current: b,
    newMonthly: rounded,
    monthlyIncrease: rounded - b,
    annualIncrease: (rounded - b) * 12,
    newAnnual: rounded * 12,
    colaPct: p,
  };
}

/**
 * 26 U.S.C. § 1(f)(7)(A) rounding: the INCREASE, not the resulting amount, is
 * rounded to the next LOWEST multiple of $50 ($25 for a married individual
 * filing separately, per § 1(f)(7)(B)). Exported and tested even though no page
 * currently renders a projected figure, because the moment the window completes
 * this is the rule the figures have to come out of, and a rounding rule
 * discovered on deadline is a rounding rule taken from memory.
 * @param {number} baseAmount the unindexed statutory dollar amount
 * @param {number} increase the raw computed increase
 * @param {boolean} [mfs=false] married filing separately
 * @returns {number}
 */
export function roundIncrease(baseAmount, increase, mfs = false) {
  const step = mfs ? 25 : 50;
  if (!Number.isFinite(baseAmount) || !Number.isFinite(increase)) return NaN;
  return baseAmount + Math.floor(increase / step) * step;
}
