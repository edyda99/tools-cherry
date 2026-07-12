// ss-maxout-engine.js — Social Security (OASDI) wage-base max-out date engine.
// Pure, framework-free. Runs client-side (browser ESM) and in Node (build-time
// tests). All hard PARAMETERS (2026 wage base $184,500, employee rate 6.2%)
// come from src/data/tax-data-2026.json (federal.fica.socialSecurity) — this
// file is pure calendar-scheduling + cumulative-sum logic, built new for this
// tool (per the sourced spec, docs/ss-wage-base-calculator-spec.md §3.10:
// paycheck-engine.js has annual FICA math but NO pay-date scheduling at all).
//
// THE HOOK: a W-2 employee's 6.2% Social Security withholding STOPS for the
// rest of the calendar year the moment their year-to-date Social Security
// wages (W-2 Box 3 — NOT gross, NOT Box 1) cross the annual wage base at THAT
// employer. Net pay visibly jumps by 6.2% of gross starting the very next
// paycheck. On January 1 the cap resets to $0 and withholding resumes. No
// incumbent calculator computes this DATE — every existing tool computes only
// the annual dollar amount (spec §7).
//
// PER-EMPLOYER INDEPENDENCE (spec §3.4): the cap is per employer, not per
// person. A mid-year job change resets YTD-at-this-employer to $0 regardless
// of what a prior employer withheld this same year. Someone with two+
// employers can have MORE than the annual max ($11,439.00 for 2026) withheld
// in aggregate with nothing ever "stopping" at either job — that's the
// excess-FICA case (excessFica() below), the flip side of this same rule.
//
// THE SINGLE-EMPLOYER WRINKLE (spec §3.7, IRS Topic 608, verbatim): if ONE
// employer over-withholds Social Security, that excess is NOT a 1040 credit —
// "your employer should adjust the excess for you... [else] use Form 843."
// Only an AGGREGATE overpayment across TWO OR MORE employers is a Schedule 3,
// Part II credit. Getting this backwards is the tool's most consequential
// possible error, so excessFica() hard-codes the branch on numEmployers.

const MAX_PERIODS = 400; // generous safety bound; a real year never needs more than 53

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatISODate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function daysInMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

// Same day-of-month, clamped to the last valid day (e.g. Jan 31 + 1mo -> Feb 28).
function addMonthsClamped(date, n) {
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() + n;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = totalMonths - newYear * 12;
  const day = Math.min(date.getUTCDate(), daysInMonth(newYear, newMonth));
  return new Date(Date.UTC(newYear, newMonth, day));
}

// Semimonthly convention (spec §5, open uncertainty #3 — an illustrative
// default, not a fact about any specific employer): pay dates alternate the
// 15th and the calendar last day of the month. Given any date, decide which
// side of that alternation it's on by checking whether it IS the month's
// last day.
function nextSemimonthlyDate(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const dim = daysInMonth(y, m);
  if (d >= dim) {
    // On (or past) the last day of the month -> next payday is the 15th of
    // the following month.
    const totalMonths = y * 12 + m + 1;
    const newYear = Math.floor(totalMonths / 12);
    const newMonth = totalMonths - newYear * 12;
    return new Date(Date.UTC(newYear, newMonth, 15));
  }
  // On/before the mid-month half -> next payday is the last day of this month.
  return new Date(Date.UTC(y, m, dim));
}

/**
 * Generate `count` upcoming pay dates, period 1 = `nextPayDate` itself. Pay
 * dates are always user-overridable in the UI (spec §5 #3) — this scheduler
 * only fills in the illustrative default for periods 2+.
 * @param {string|Date} nextPayDate  ISO 'YYYY-MM-DD' string or a Date
 * @param {'weekly'|'biweekly'|'semimonthly'|'monthly'} payFrequency
 * @param {number} count
 * @returns {Date[]}
 */
export function nextPayDates(nextPayDate, payFrequency, count) {
  const start = typeof nextPayDate === 'string' ? parseISODate(nextPayDate) : nextPayDate;
  const dates = [start];
  for (let k = 2; k <= count; k++) {
    if (payFrequency === 'monthly') {
      dates.push(addMonthsClamped(start, k - 1));
    } else if (payFrequency === 'weekly') {
      dates.push(addDaysUTC(start, (k - 1) * 7));
    } else if (payFrequency === 'biweekly') {
      dates.push(addDaysUTC(start, (k - 1) * 14));
    } else if (payFrequency === 'semimonthly') {
      dates.push(nextSemimonthlyDate(dates[k - 2]));
    } else {
      throw new Error(`Unknown payFrequency: ${payFrequency}`);
    }
  }
  return dates;
}

/**
 * Project forward from YTD Social Security wages to the pay date where
 * cumulative SS wages first meet/exceed the year's wage base AT THIS
 * EMPLOYER (spec §3.3-§3.6). Pure function; `params` must supply
 * {wageBase, ssRate} for `taxYear` (reuse tax-data-<year>.json's
 * federal.fica.socialSecurity — do not re-key the numbers).
 *
 * @param {object} a
 * @param {number} a.taxYear
 * @param {number} a.ytdSSWages       YTD Social Security wages (W-2 Box 3) at THIS employer, as of asOfDate.
 * @param {'weekly'|'biweekly'|'semimonthly'|'monthly'} a.payFrequency
 * @param {string} a.nextPayDate      ISO date of the next paycheck (= future period 1).
 * @param {number} a.perPeriodSSWages flat SS wages per future pay period (pre-raise level).
 * @param {{effectiveOnPeriod:number, newPerPeriodSSWages:number}} [a.payRaise]  optional one-time raise (spec §3.6).
 * @param {Object<number,{wageBase:number, ssRate:number}>} a.params  keyed by taxYear.
 */
export function projectMaxOut(a) {
  const { taxYear, ytdSSWages, payFrequency, nextPayDate, perPeriodSSWages, payRaise, params } = a;

  const yearParams = params && params[taxYear];
  if (!yearParams) {
    return { error: 'unsupported_tax_year', notes: [`No Social Security wage-base data for tax year ${taxYear}.`] };
  }
  const { wageBase, ssRate } = yearParams;
  const maxSS = round2(wageBase * ssRate);
  const ytd = Math.max(0, Number(ytdSSWages) || 0);

  // Already-maxed guard (spec F6) — checked BEFORE any future-period walk.
  if (ytd >= wageBase) {
    return {
      alreadyMaxed: true,
      willNotMaxOutThisYear: false,
      capReachedPeriod: null,
      capReachedDate: null,
      firstZeroSSDate: null,
      ssOnCrossing: 0,
      bumpAmount: 0,
      totalSSForYear: maxSS,
      rolledIntoNextYear: false,
      taxYear, wageBase, ssRate, maxSS,
      notes: [
        `Your Social Security wages at this employer have already reached the $${wageBase.toLocaleString('en-US')} cap this year — withholding is already $0 and stays $0 through December 31.`
      ]
    };
  }

  const basePerPeriod = Math.max(0, Number(perPeriodSSWages) || 0);
  const hasRaise = payRaise && Number.isFinite(payRaise.effectiveOnPeriod) && Number.isFinite(payRaise.newPerPeriodSSWages);
  const raiseAt = hasRaise ? payRaise.effectiveOnPeriod : Infinity;
  const raiseAmt = hasRaise ? Math.max(0, payRaise.newPerPeriodSSWages) : 0;
  const scheduleForPeriod = (k) => (k >= raiseAt ? raiseAmt : basePerPeriod);

  // Guard: nothing to project (spec §3.3 "cannot project").
  if (scheduleForPeriod(1) <= 0 && !(hasRaise && raiseAmt > 0)) {
    return { error: 'invalid_per_period', notes: ['Enter a per-period Social Security wage amount greater than $0 to project a date.'] };
  }

  const dates = nextPayDates(nextPayDate, payFrequency, MAX_PERIODS);

  let cumulative = ytd;
  let kStar = null;
  let taxedOnCrossing = 0;
  let capReachedDate = null;

  for (let k = 1; k <= MAX_PERIODS; k++) {
    const periodDate = dates[k - 1];
    if (periodDate.getUTCFullYear() > taxYear) break; // out of pay periods for this tax year, at this employer

    const w = scheduleForPeriod(k);
    const prev = cumulative;
    cumulative += w;

    if (cumulative >= wageBase) {
      kStar = k;
      taxedOnCrossing = round2(wageBase - prev);
      capReachedDate = periodDate;
      break;
    }
  }

  if (kStar == null) {
    // Never reaches the cap within this tax year at this employer (spec F3, F5).
    return {
      alreadyMaxed: false,
      willNotMaxOutThisYear: true,
      capReachedPeriod: null,
      capReachedDate: null,
      firstZeroSSDate: null,
      ssOnCrossing: 0,
      bumpAmount: 0,
      totalSSForYear: round2(cumulative * ssRate),
      rolledIntoNextYear: false,
      taxYear, wageBase, ssRate, maxSS,
      notes: [
        `At this pace, Social Security wages at this employer will not reach the $${wageBase.toLocaleString('en-US')} cap by December 31 — withholding continues all year. A prior or later employer this same year does not change this: the cap resets to $0 at every new employer.`
      ]
    };
  }

  const capReachedDateStr = formatISODate(capReachedDate);
  const firstZeroSSPeriod = kStar + 1;
  const firstZeroSSDate = dates[firstZeroSSPeriod - 1];
  const firstZeroSSDateStr = formatISODate(firstZeroSSDate);
  const rolledIntoNextYear = firstZeroSSDate.getUTCFullYear() > taxYear;
  const bumpAmount = round2(scheduleForPeriod(firstZeroSSPeriod) * ssRate);
  const ssOnCrossing = round2(taxedOnCrossing * ssRate);

  const notes = [];
  if (rolledIntoNextYear) {
    notes.push(
      `You reach the cap on your last paycheck of ${taxYear} (${capReachedDateStr}) — withholding simply ends with the year and resets on January 1. There is no separate "bigger paycheck" moment before year-end; the very next paycheck already falls in the new year, back at 6.2% from $0.`
    );
  } else {
    notes.push(
      `Take-home pay goes up by about $${bumpAmount.toFixed(2)} starting the ${firstZeroSSDateStr} paycheck, when Social Security withholding at this employer drops to $0 for the rest of ${taxYear}.`
    );
  }

  return {
    alreadyMaxed: false,
    willNotMaxOutThisYear: false,
    capReachedPeriod: kStar,
    capReachedDate: capReachedDateStr,
    firstZeroSSDate: firstZeroSSDateStr,
    ssOnCrossing,
    bumpAmount,
    totalSSForYear: maxSS,
    rolledIntoNextYear,
    taxYear, wageBase, ssRate, maxSS,
    notes
  };
}

/**
 * Excess-FICA (multi-employer) check (spec §3.7). Branches on numEmployers —
 * this is the load-bearing correction: only an AGGREGATE overpayment across
 * TWO OR MORE employers is a 1040 credit (Schedule 3, Part II). A SINGLE
 * employer's own over-withholding is never a 1040 credit (IRS Topic 608,
 * verbatim): the employer must adjust it, or the employee files Form 843.
 * @param {object} a
 * @param {number[]} a.ssWithheldByEmployer  actual SS TAX withheld per employer this year ($, not wages).
 * @param {number} [a.numEmployers]          defaults to ssWithheldByEmployer.length.
 * @param {number} a.maxSS                   the year's max employee SS tax (e.g. $11,439.00 for 2026).
 */
export function excessFica({ ssWithheldByEmployer, numEmployers, maxSS }) {
  const withheld = (ssWithheldByEmployer || []).map((v) => Math.max(0, Number(v) || 0));
  const n = Number.isFinite(numEmployers) ? numEmployers : withheld.length;
  const totalSSWithheld = round2(withheld.reduce((sum, v) => sum + v, 0));
  const excess = round2(Math.max(0, totalSSWithheld - maxSS));
  const claimableOn1040 = n >= 2;
  const remedy = claimableOn1040
    ? 'Claim the excess as a credit on Schedule 3 (Form 1040), Part II — it flows into your refund.'
    : "Not a 1040 credit: this employer must adjust/refund the over-withholding. If they don't, file Form 843 with the IRS.";
  return { totalSSWithheld, excess, claimableOn1040, remedy, numEmployers: n };
}

export { formatISODate, parseISODate };
