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

// ---------------------------------------------------------------------------
// Third-party projections (projections-2027.json -> thirdPartyProjections).
//
// Somebody else's figures, shown under their name. They are the only 2027 dollar
// amounts the projected-brackets page carries while the C-CPI-U window is
// incomplete, so a typo here is a wrong tax figure on a live page with a
// respected publisher's name next to it. thirdPartyProblems() is the shape
// check build.js refuses to render without and the unit tests exercise with
// deliberately broken items.

/** Filing-status keys, the same ones tax-data-2026.json's federal block uses. */
export const TP_STATUSES = ['single', 'married', 'head_of_household'];
/** The seven federal income tax rates, lowest first. */
export const TP_RATES = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u);
const isText = (s, min = 1) => typeof s === 'string' && s.trim().length >= min;
// A standard deduction or bracket threshold is a whole-dollar amount in the
// thousands. The ceiling catches the classic transcription slip of an extra
// zero ("$15,7500"), which is a real error in one of the sources this file
// reads from.
const plausibleAmount = (v, max) => Number.isInteger(v) && v >= 1000 && v <= max;

const usdText = (v) => '$' + v.toLocaleString('en-US');

/**
 * A figure the publisher printed as two numbers for one line, e.g. "$24,925
 * ($24,950)". Kept as printed rather than resolved into one number, because
 * choosing between them is exactly the call the page says it does not make.
 * `values` must be the two numbers in the order printed, and `printed` must be
 * nothing but those two numbers in the "$A ($B)" form.
 * @returns {string[]} problems, prefixed with `where`
 */
function twoNumberProblems(f, where, max) {
  const p = [];
  if (!Array.isArray(f.values) || f.values.length !== 2 || !f.values.every((v) => plausibleAmount(v, max))) {
    p.push(`${where}.values is not a pair of whole-dollar amounts from $1,000 to $${max.toLocaleString('en-US')}`);
  } else if (typeof f.printed !== 'string' || f.printed !== `${usdText(f.values[0])} (${usdText(f.values[1])})`) {
    p.push(`${where}.printed is not exactly "${usdText(f.values[0])} (${usdText(f.values[1])})"`);
  }
  if (!('explanation' in f) || !(f.explanation === null || (isText(f.explanation) && !f.explanation.includes('\u2014'))))
    p.push(`${where}.explanation must be the publisher's own account of the second number, or null when it gives none`);
  return p;
}

/**
 * Every number a stored figure stands for: one for a plain amount, two for a
 * figure printed as two numbers.
 * @param {number|{values:number[]}} f
 * @returns {number[]}
 */
export function figureValues(f) {
  if (Number.isFinite(f)) return [f];
  return f && Array.isArray(f.values) ? f.values.filter(Number.isFinite) : [];
}

/**
 * Every way one filing status's bracket table is malformed: seven rows, the
 * statutory rates in order, rising whole-dollar thresholds, an open top band.
 * @param {*} rows the [{rate, upTo}] list
 * @param {string} where prefix for the messages, e.g. "brackets.single"
 * @returns {string[]}
 */
function bracketRowProblems(rows, where) {
  const p = [];
  if (!Array.isArray(rows) || rows.length !== TP_RATES.length) return [`${where} does not have ${TP_RATES.length} rows`];
  rows.forEach((r, i) => {
    if (!r || r.rate !== TP_RATES[i]) p.push(`${where}[${i}] rate is not ${TP_RATES[i]}`);
    const last = i === rows.length - 1;
    if (last) {
      if (r && r.upTo !== null) p.push(`${where}: the top bracket must have upTo null`);
    } else if (!r || !plausibleAmount(r.upTo, 5000000)) {
      p.push(`${where}[${i}].upTo is not a whole-dollar threshold`);
    } else if (i > 0 && rows[i - 1] && !(r.upTo > rows[i - 1].upTo)) {
      p.push(`${where}[${i}].upTo (${r.upTo}) does not rise above the bracket below it`);
    }
  });
  return p;
}

/**
 * Every way one third-party projection item is malformed, as readable strings.
 * An empty array means the item is fit to render.
 * @param {*} item one entry of thirdPartyProjections.items
 * @param {string} [checkedDate] the block's checkedDate; an item cannot be dated after it
 * @returns {string[]}
 */
export function thirdPartyProblems(item, checkedDate) {
  const p = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ['item is not an object'];
  if (!isText(item.publisher, 4)) p.push('publisher is missing');
  if (!isText(item.title)) p.push('title is missing');
  if (!ISO_DATE.test(item.asOf || '')) p.push('asOf is not an ISO date');
  else if (checkedDate && item.asOf > checkedDate) p.push(`asOf ${item.asOf} is after checkedDate ${checkedDate}`);
  if (!isHttps(item.sourceUrl)) p.push('sourceUrl is not an https URL');

  // How the publisher dealt with the window. A projection that does not say
  // which months it used is the thing this page exists to warn about.
  if (!Number.isInteger(item.monthsUsed) || item.monthsUsed < 1 || item.monthsUsed > 12)
    p.push('monthsUsed is not a whole number of months from 1 to 12');
  if (!Array.isArray(item.skipped) || !item.skipped.every((k) => MONTH_KEY.test(k)))
    p.push('skipped is not a list of YYYY-MM month keys');
  else if (Number.isInteger(item.monthsUsed) && item.monthsUsed + item.skipped.length !== 12)
    p.push(`monthsUsed (${item.monthsUsed}) plus skipped months (${item.skipped.length}) is not 12`);

  const sd = item.standardDeduction;
  const br = item.brackets;
  if (sd === undefined && br === undefined) p.push('carries no figures (neither standardDeduction nor brackets)');
  if (sd !== undefined) {
    if (!sd || typeof sd !== 'object' || Array.isArray(sd)) p.push('standardDeduction is not an object');
    else {
      const keys = Object.keys(sd).filter((k) => !k.startsWith('_'));
      if (!keys.length) p.push('standardDeduction is empty');
      for (const k of keys) {
        if (!TP_STATUSES.includes(k)) p.push(`standardDeduction has unknown filing status "${k}"`);
        else if (sd[k] && typeof sd[k] === 'object') p.push(...twoNumberProblems(sd[k], `standardDeduction.${k}`, 100000));
        else if (!plausibleAmount(sd[k], 100000)) p.push(`standardDeduction.${k} (${sd[k]}) is not a whole-dollar amount from $1,000 to $100,000`);
      }
    }
  }
  if (br !== undefined) {
    if (!br || typeof br !== 'object' || Array.isArray(br)) p.push('brackets is not an object');
    else {
      const keys = Object.keys(br).filter((k) => !k.startsWith('_'));
      if (!keys.length) p.push('brackets is empty');
      for (const k of keys) {
        if (!TP_STATUSES.includes(k)) { p.push(`brackets has unknown filing status "${k}"`); continue; }
        p.push(...bracketRowProblems(br[k], `brackets.${k}`));
      }
    }
  }

  // A fuller document from the same publisher that is not freely readable (a
  // report behind a sign-up form). Optional, and labelled on the page as such.
  if (item.fullReport !== undefined) {
    const f = item.fullReport;
    if (!f || typeof f !== 'object') p.push('fullReport is not an object');
    else {
      if (!isText(f.label) || f.label.includes('\u2014')) p.push('fullReport.label is missing or contains an em dash');
      if (!isText(f.title)) p.push('fullReport.title is missing');
      if (!isHttps(f.sourceUrl)) p.push('fullReport.sourceUrl is not an https URL');
    }
  }

  // `note` renders on the page. House style for page copy: no em dashes.
  if (item.note !== undefined && (!isText(item.note) || item.note.includes('—')))
    p.push('note is empty or contains an em dash');
  return p;
}

/**
 * Problems with the whole thirdPartyProjections block, each prefixed with the
 * item it belongs to. Empty means the block is fit to render.
 * @param {*} block projections-2027.json -> thirdPartyProjections
 * @returns {string[]}
 */
export function thirdPartyBlockProblems(block) {
  if (!block || typeof block !== 'object') return ['thirdPartyProjections is missing'];
  const p = [];
  if (!ISO_DATE.test(block.checkedDate || '')) p.push('checkedDate is not an ISO date');
  if (!Array.isArray(block.items)) return [...p, 'items is not an array'];
  const seen = new Set();
  block.items.forEach((it, i) => {
    const who = (it && it.publisher) || `items[${i}]`;
    if (seen.has(who)) p.push(`${who}: listed twice`);
    seen.add(who);
    for (const msg of thirdPartyProblems(it, block.checkedDate)) p.push(`${who}: ${msg}`);
  });
  return p;
}

// ---------------------------------------------------------------------------
// The official figures (projections-2027.json -> cpiw.officialCola and
// official2027). These are the day-of slots: when SSA announces the COLA and
// when the IRS publishes the tax-year-2027 Revenue Procedure, the figure goes
// here and the pages, the press kit and the gates all switch to OFFICIAL from
// the data alone. A typo here is an official-looking wrong figure, so build.js
// refuses to render either slot unless its validator returns nothing.

/**
 * Problems with cpiw.officialCola. Empty means it is fit to render.
 * Shape: { percent, announcedDate, sourceUrl, title? }. percent is the COLA as
 * SSA announced it, e.g. 2.8, which is always a multiple of 0.1.
 * @param {*} o
 * @returns {string[]}
 */
export function officialColaProblems(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['officialCola is not an object'];
  const p = [];
  if (!Number.isFinite(o.percent) || o.percent < 0 || o.percent > 20)
    p.push('officialCola.percent is not a number from 0 to 20');
  else if (Math.abs(Math.round(o.percent * 10) / 10 - o.percent) > 1e-9)
    p.push(`officialCola.percent (${o.percent}) is not rounded to one decimal place, as every COLA is`);
  if (!ISO_DATE.test(o.announcedDate || '')) p.push('officialCola.announcedDate is not an ISO date');
  if (!isHttps(o.sourceUrl)) p.push('officialCola.sourceUrl is not an https URL');
  if (o.title !== undefined && (!isText(o.title) || o.title.includes('\u2014')))
    p.push('officialCola.title is empty or contains an em dash');
  return p;
}

/**
 * Problems with official2027. Empty means it is fit to render.
 * Shape: { revenueProcedure: { name: "Rev. Proc. 2026-NN", publishedDate,
 * sourceUrl, newsroomUrl? }, federal: { standardDeduction: {single, married,
 * head_of_household}, brackets: {single, married, head_of_household} } }, with
 * brackets in the same [{rate, upTo}] shape tax-data-2026.json uses. All three
 * filing statuses are required: the official page prints all three.
 * Optional gapNote { quote, sourceUrl }: the IRS's own words on how it treated
 * October 2025, verbatim; the page says nothing about that month without it.
 * @param {*} o
 * @returns {string[]}
 */
export function official2027Problems(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['official2027 is not an object'];
  const p = [];
  const rp = o.revenueProcedure;
  if (!rp || typeof rp !== 'object') p.push('official2027.revenueProcedure is missing');
  else {
    if (typeof rp.name !== 'string' || !/^Rev\. Proc\. 20\d\d-\d{1,3}$/.test(rp.name))
      p.push('official2027.revenueProcedure.name is not of the form "Rev. Proc. 2026-NN"');
    if (!ISO_DATE.test(rp.publishedDate || '')) p.push('official2027.revenueProcedure.publishedDate is not an ISO date');
    if (!isHttps(rp.sourceUrl)) p.push('official2027.revenueProcedure.sourceUrl is not an https URL');
    if (rp.newsroomUrl !== undefined && !isHttps(rp.newsroomUrl))
      p.push('official2027.revenueProcedure.newsroomUrl is not an https URL');
  }
  const fed = o.federal;
  if (!fed || typeof fed !== 'object') return [...p, 'official2027.federal is missing'];
  const sd = fed.standardDeduction;
  const br = fed.brackets;
  for (const k of TP_STATUSES) {
    if (!sd || !plausibleAmount(sd[k], 100000))
      p.push(`official2027.federal.standardDeduction.${k} is not a whole-dollar amount from $1,000 to $100,000`);
    p.push(...bracketRowProblems(br && br[k], `official2027.federal.brackets.${k}`));
  }
  if (o.gapNote !== undefined) {
    const g = o.gapNote;
    if (!g || !isText(g.quote, 20) || !isHttps(g.sourceUrl))
      p.push('official2027.gapNote needs the IRS\'s own words (quote) and an https sourceUrl');
  }
  return p;
}
