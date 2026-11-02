// january-paycheck.js — "Why is my January 2027 paycheck different?"
//
// Runs the same salary through two paychecks, the last one of December 2026 and
// the first one of January 2027, and explains every line that moved. It does no
// tax math of its own:
//
//   * paycheck-engine.js computePaycheck() gives the federal and state income tax
//     withholding and the state payroll programs, run once per scenario with that
//     year's tables.
//   * ss-maxout-engine.js projectMaxOut() decides how much Social Security comes
//     out of the ONE paycheck being looked at, given what was already earned at
//     this job that year. paycheck-engine.js only knows the annual total spread
//     evenly, which is exactly wrong for December when the yearly limit has been
//     reached.
//   * pay-frequency.js perPaycheck() splits the salary into one paycheck.
//   * projections-2027.js figureValues()/TP_STATUSES read the publishers'
//     projections the same way /2027-tax-brackets/ does.
//
// "What changed" is a chain of single swaps from December to January, in a fixed
// order, each measured on take-home pay: the Social Security reset, the 401(k)
// election, the health premium, the federal tables, the state tables. Each step
// changes exactly one thing, so the steps add up to the whole difference to the
// cent, and every line on the side-by-side table is accounted for.
//
// Every money line is rounded to the cent BEFORE take-home pay is added up, the
// way a pay stub is, so the page's table always adds up and a worked example can
// be checked by hand.
//
// Pure, dependency-free apart from the engines above. Shared by build.js, the
// browser page and scripts/test-january-paycheck.js.

import { computePaycheck, PAY_PERIODS } from './paycheck-engine.js';
import { projectMaxOut } from './ss-maxout-engine.js';
import { perPaycheck } from './pay-frequency.js';
import { figureValues, TP_STATUSES } from './projections-2027.js';

/** Employers start the extra 0.9% Medicare once wages at the job pass $200,000 in a year,
 * whatever the filing status (IRS Q&A on the Additional Medicare Tax, and the note on
 * federal.fica.additionalMedicare.threshold in tax-data-2026.json). Statutory, not indexed. */
export const ADDL_MEDICARE_WITHHOLDING_START = 200000;

/** The last paycheck of December 2026 and the first of January 2027, as the
 * ss-maxout engine sees them. Only the year matters to it here: period 1 is the
 * paycheck being priced and nothing later is ever needed. */
const DEC_PAY_DATE = '2026-12-31';
const JAN_PAY_DATE = '2027-01-15';

/** The order the "what changed" chain swaps things in. */
export const CAUSE_ORDER = ['socialSecurity', 'retirement', 'premium', 'federalTables', 'stateTables'];

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

// ---------------------------------------------------------------------------
// Picking the 2027 federal tables.

const sameRows = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
  a.every((r, i) => r.rate === b[i].rate && r.upTo === b[i].upTo);

/**
 * The federal block a January 2027 paycheck is computed with, and how sure we are
 * of it. Official sources win, in this order: a tax-data-2027.json federal block,
 * then projections-2027.json official2027 (the IRS Revenue Procedure). Until one
 * exists the standard deduction and brackets come from the publishers in
 * thirdPartyProjections, and the result says so.
 *
 * Where the publishers agree there is one number. Where they do not, the LOWEST
 * standard deduction is used (it withholds slightly more, so a reader is never told
 * January is better than it turns out) and the spread is returned for the page to
 * print. Bracket tables that disagree use the first publisher's and are reported the
 * same way.
 *
 * @param {object} a
 * @param {object} a.fed2026          tax-data-2026.json federal
 * @param {number} a.wageBase2027     the 2027 Social Security wage base (SSA's fact sheet)
 * @param {object} [a.taxData2027Federal] tax-data-2027.json federal, when that file exists
 * @param {object} [a.official2027]   projections-2027.json official2027
 * @param {object} [a.projections]    projections-2027.json thirdPartyProjections
 * @returns {{mode:'official'|'projected', basis:string, federal:object, publishers:string[], spreads:Array<{status:string, what:string, values:number[]}>}}
 */
export function federal2027({ fed2026, wageBase2027, taxData2027Federal, official2027, projections }) {
  if (!fed2026 || !fed2026.fica) throw new Error('january-paycheck: fed2026 is missing');
  if (taxData2027Federal) {
    return { mode: 'official', basis: 'taxData2027', federal: taxData2027Federal, publishers: [], spreads: [] };
  }
  if (!Number.isFinite(wageBase2027) || wageBase2027 < 100000)
    throw new Error('january-paycheck: the 2027 Social Security wage base is missing');
  const fica = {
    ...fed2026.fica,
    socialSecurity: { ...fed2026.fica.socialSecurity, wageBase: wageBase2027 },
  };
  if (official2027 && official2027.federal) {
    const f = official2027.federal;
    return {
      mode: 'official', basis: 'official2027',
      federal: { standardDeduction: { ...f.standardDeduction }, brackets: { ...f.brackets }, fica },
      publishers: [], spreads: [],
    };
  }
  const items = (projections && Array.isArray(projections.items)) ? projections.items : [];
  if (!items.length) throw new Error('january-paycheck: no official 2027 figures and no projections to fall back on');
  const standardDeduction = {};
  const brackets = {};
  const spreads = [];
  for (const st of TP_STATUSES) {
    const sds = items.flatMap((it) => (it.standardDeduction && it.standardDeduction[st] !== undefined)
      ? figureValues(it.standardDeduction[st]) : []);
    if (!sds.length) throw new Error(`january-paycheck: no projected 2027 standard deduction for ${st}`);
    const uniq = [...new Set(sds)].sort((x, y) => x - y);
    standardDeduction[st] = uniq[0];
    if (uniq.length > 1) spreads.push({ status: st, what: 'standardDeduction', values: uniq });
    const tables = items.map((it) => it.brackets && it.brackets[st]).filter(Array.isArray);
    if (!tables.length) throw new Error(`january-paycheck: no projected 2027 brackets for ${st}`);
    brackets[st] = tables[0].map((r) => ({ rate: r.rate, upTo: r.upTo }));
    if (!tables.every((t) => sameRows(t, tables[0]))) spreads.push({ status: st, what: 'brackets', values: [] });
  }
  return {
    mode: 'projected', basis: 'projections',
    federal: { standardDeduction, brackets, fica },
    publishers: items.map((it) => it.publisher),
    spreads,
  };
}

/**
 * The state entry a January 2027 paycheck is computed with. A tax-data-2027.json
 * state wins outright. Otherwise the 2026 entry, with a statutory 2027 change
 * from january-paycheck-2027.json patched into its `tax` block where the repo has
 * one (Virginia's standard deduction, North Carolina's rate).
 * @returns {{state:object|null, basis:'taxData2027'|'override2027'|'tables2026', override:object|null}}
 */
export function state2027({ slug, state2026, taxData2027States, overrides }) {
  if (taxData2027States && taxData2027States[slug])
    return { state: taxData2027States[slug], basis: 'taxData2027', override: null };
  const o = overrides && overrides[slug];
  if (o && o.tax && state2026) {
    return { state: { ...state2026, tax: { ...state2026.tax, ...o.tax } }, basis: 'override2027', override: o };
  }
  return { state: state2026 || null, basis: 'tables2026', override: null };
}

// ---------------------------------------------------------------------------
// One paycheck.

/**
 * Social Security on this one paycheck, from the ss-maxout engine.
 * @returns {{tax:number, capHitBefore:boolean, capHitOnThisCheck:boolean}}
 */
function ssOnPaycheck({ ssWages, ytd, taxYear, payFrequency, payDate, ss }) {
  if (!(ssWages > 0)) return { tax: 0, capHitBefore: ytd >= ss.wageBase, capHitOnThisCheck: false };
  const r = projectMaxOut({
    taxYear, ytdSSWages: ytd, payFrequency, nextPayDate: payDate, perPeriodSSWages: ssWages,
    params: { [taxYear]: { wageBase: ss.wageBase, ssRate: ss.rate } },
  });
  if (r.error) throw new Error(`january-paycheck: ss-maxout engine refused (${r.error})`);
  if (r.alreadyMaxed) return { tax: 0, capHitBefore: true, capHitOnThisCheck: false };
  if (r.capReachedPeriod === 1) return { tax: r.ssOnCrossing, capHitBefore: false, capHitOnThisCheck: true };
  return { tax: round2(ssWages * ss.rate), capHitBefore: false, capHitOnThisCheck: false };
}

/**
 * Every line of one paycheck, each rounded to the cent, and take-home pay as the
 * sum of the rounded lines.
 * @param {object} s
 * @param {number} s.salary
 * @param {string} s.payFrequency  weekly | biweekly | semimonthly | monthly
 * @param {string} s.filingStatus  single | married | head_of_household
 * @param {string} s.stateSlug
 * @param {number} s.k401Pct       traditional 401(k), percent of each paycheck
 * @param {number} s.premium       pre-tax health premium per paycheck (Section 125)
 * @param {object} s.federal       the federal block for the year whose tables apply
 * @param {object|null} s.state    the state entry for the year whose tables apply
 * @param {'dec'|'jan'} s.ssMode   'dec': Social Security and the extra Medicare see the
 *                                 year's earnings so far; 'jan': both start again from $0
 * @param {number} s.ytd           earnings at this job in 2026 before December's last paycheck
 *                                 (Social Security wages), used only in 'dec' mode
 * @param {{wageBase:number, rate:number}} s.ss2026
 * @param {{wageBase:number, rate:number}} s.ss2027
 * @param {object} s.taxDataShell  { filingStatuses, ... } carried through to computePaycheck
 */
export function paycheckLines(s) {
  const periods = PAY_PERIODS[s.payFrequency];
  if (!periods || periods === 1) throw new Error(`january-paycheck: unsupported pay frequency "${s.payFrequency}"`);
  const salary = Math.max(0, num(s.salary));
  const gross = round2(perPaycheck(salary, periods));
  const pct = Math.min(100, Math.max(0, num(s.k401Pct)));
  const retirement = round2(gross * pct / 100);
  // The premium cannot take more than is left after the 401(k).
  const premium = round2(Math.min(Math.max(0, num(s.premium)), Math.max(0, gross - retirement)));

  const states = s.state ? { [s.stateSlug]: s.state } : {};
  const pc = computePaycheck({
    wage: { type: 'salary', amount: salary },
    filingStatus: s.filingStatus,
    payFrequency: s.payFrequency,
    stateSlug: s.stateSlug,
    adv: { retirement401k: retirement * periods, cafeteria125: premium * periods },
  }, { ...(s.taxDataShell || {}), federal: s.federal, states });

  const ficaWages = Math.max(0, gross - premium);   // a 401(k) does not lower these; a Section 125 premium does
  const dec = s.ssMode === 'dec';
  const ss = dec ? s.ss2026 : s.ss2027;
  const ytd = dec ? Math.max(0, num(s.ytd)) : 0;
  const ssr = ssOnPaycheck({
    ssWages: ficaWages, ytd, taxYear: dec ? 2026 : 2027,
    payFrequency: s.payFrequency, payDate: dec ? DEC_PAY_DATE : JAN_PAY_DATE, ss,
  });
  const medRate = s.federal.fica.medicare.rate;
  const addlRate = s.federal.fica.additionalMedicare.rate;
  const addlWages = Math.max(0, Math.min(ficaWages, ytd + ficaWages - ADDL_MEDICARE_WITHHOLDING_START));
  const medicareBase = round2(ficaWages * medRate);
  const medicareExtra = round2(addlWages * addlRate);

  const lines = {
    gross,
    retirement,
    premium,
    federal: round2(pc.perPaycheck.federal),
    socialSecurity: ssr.tax,
    medicare: round2(medicareBase + medicareExtra),
    state: round2(pc.perPaycheck.state),
    statePrograms: round2(pc.perPaycheck.statePrograms),
  };
  const net = round2(lines.gross - lines.retirement - lines.premium - lines.federal - lines.socialSecurity -
    lines.medicare - lines.state - lines.statePrograms);
  return {
    ...lines, net, periods,
    medicareExtra,
    ss: { ...ssr, wageBase: ss.wageBase, ytd },
  };
}

// ---------------------------------------------------------------------------
// December against January.

/**
 * The default for the "earned so far" question when it is left blank: a full year at
 * this salary, so everything except the December paycheck itself.
 */
export function defaultYtd({ salary, payFrequency, premium2026 }) {
  const periods = PAY_PERIODS[payFrequency] || 26;
  const gross = round2(perPaycheck(Math.max(0, num(salary)), periods));
  const prem = Math.min(Math.max(0, num(premium2026)), gross);
  return round2((gross - prem) * (periods - 1));
}

/**
 * Run both paychecks and the chain between them.
 * @param {object} input
 * @param {number} input.salary
 * @param {string} input.payFrequency
 * @param {string} input.filingStatus
 * @param {string} input.stateSlug
 * @param {number} input.k401Pct2026
 * @param {number} input.k401Pct2027
 * @param {number} [input.premium2026]
 * @param {number} [input.premium2027]
 * @param {number|null} [input.ytd2026]  null/undefined = assume a full year at this salary
 * @param {object} ctx
 * @param {object} ctx.federal2026
 * @param {object} ctx.federal2027
 * @param {object|null} ctx.state2026
 * @param {object|null} ctx.state2027
 * @param {object} [ctx.taxDataShell]
 * @returns {{dec:object, jan:object, change:number, causes:Array, ytd:number, ytdAssumed:boolean}}
 */
export function compareDecJan(input, ctx) {
  const ytdAssumed = input.ytd2026 === null || input.ytd2026 === undefined || input.ytd2026 === '' ||
    !Number.isFinite(num(input.ytd2026, NaN));
  const ytd = ytdAssumed ? defaultYtd(input) : Math.max(0, num(input.ytd2026));
  const ss2026 = { wageBase: ctx.federal2026.fica.socialSecurity.wageBase, rate: ctx.federal2026.fica.socialSecurity.rate };
  const ss2027 = { wageBase: ctx.federal2027.fica.socialSecurity.wageBase, rate: ctx.federal2027.fica.socialSecurity.rate };
  const base = {
    salary: input.salary, payFrequency: input.payFrequency, filingStatus: input.filingStatus,
    stateSlug: input.stateSlug, ytd, ss2026, ss2027, taxDataShell: ctx.taxDataShell,
  };
  // The chain. Each step changes one thing from the step before it.
  const steps = [
    { key: null, k401Pct: input.k401Pct2026, premium: input.premium2026, federal: ctx.federal2026, state: ctx.state2026, ssMode: 'dec' },
  ];
  const swap = (key, patch) => steps.push({ ...steps[steps.length - 1], key, ...patch });
  swap('socialSecurity', { ssMode: 'jan' });
  swap('retirement', { k401Pct: input.k401Pct2027 });
  swap('premium', { premium: input.premium2027 });
  swap('federalTables', { federal: ctx.federal2027 });
  swap('stateTables', { state: ctx.state2027 });

  const runs = steps.map((st) => paycheckLines({ ...base, ...st }));
  const LINE_KEYS = ['retirement', 'premium', 'federal', 'socialSecurity', 'medicare', 'state', 'statePrograms'];
  const causes = [];
  for (let i = 1; i < runs.length; i++) {
    const before = runs[i - 1], after = runs[i];
    const lines = {};
    for (const k of LINE_KEYS) {
      const d = round2(after[k] - before[k]);
      if (d !== 0) lines[k] = d;
    }
    causes.push({ key: steps[i].key, delta: round2(after.net - before.net), lines, before, after });
  }
  const dec = runs[0];
  const jan = runs[runs.length - 1];
  const change = round2(jan.net - dec.net);
  // Biggest effect on take-home pay first; ties keep the chain order.
  const ranked = causes
    .map((c, i) => ({ ...c, order: i }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.order - b.order);
  return { dec, jan, change, causes: ranked, ytd, ytdAssumed };
}
