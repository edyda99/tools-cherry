// tools.js — the four Tools Berry MCP tools, as pure functions over the EXISTING
// site engine. No tax math is re-derived here: every figure comes from
// src/engine/paycheck-engine.js + src/engine/bonus-tax.js, driven by
// src/data/tax-data-2026.json + src/data/state-supplemental-2026.json, which are
// the same files the live pages are built from. This file only shapes input,
// picks the deep link, and formats text.
import { computePaycheck } from '../../src/engine/paycheck-engine.js';
import { computeBonus } from '../../src/engine/bonus-tax.js';
import taxData from '../../src/data/tax-data-2026.json' with { type: 'json' };
import suppData from '../../src/data/state-supplemental-2026.json' with { type: 'json' };

export const SITE = 'https://tools-berry.com';

// Mirrors build.js LADDER_STATES: the 25 states that have a
// /<slug>-take-home-pay/ hub, and CA_LADDER_SALARIES: the 9 rungs each hub
// builds a /<slug>-take-home-pay-<amount>/ page for. Keep in sync with build.js.
export const LADDER_STATES = new Set([
  'california', 'texas', 'florida', 'new-york', 'pennsylvania', 'illinois',
  'ohio', 'georgia', 'north-carolina', 'michigan', 'new-jersey', 'virginia',
  'washington', 'arizona', 'massachusetts', 'tennessee', 'indiana', 'missouri',
  'maryland', 'wisconsin', 'colorado', 'minnesota', 'south-carolina', 'alabama',
  'louisiana'
]);
export const LADDER_SALARIES = [30000, 40000, 50000, 70000, 80000, 100000, 120000, 150000, 200000];

export const FILING_STATUSES = taxData.filingStatuses.map((f) => f.id);

export class ToolInputError extends Error {}

// --- input coercion --------------------------------------------------------

const SLUG_BY_NAME = (() => {
  const m = new Map();
  for (const [slug, st] of Object.entries(taxData.states)) {
    m.set(slug, slug);
    m.set(st.name.toLowerCase(), slug);
    if (st.abbr) m.set(st.abbr.toLowerCase(), slug);
  }
  return m;
})();

export function resolveState(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new ToolInputError('state is required (name, two-letter code, or slug, e.g. "Ohio", "OH", "ohio")');
  }
  const key = input.trim().toLowerCase().replace(/\s+/g, '-');
  const slug = SLUG_BY_NAME.get(key) || SLUG_BY_NAME.get(key.replace(/-/g, ' '));
  if (!slug) throw new ToolInputError(`unknown state: ${JSON.stringify(input)}. Use a US state name, two-letter code, or slug (District of Columbia is "district-of-columbia").`);
  return slug;
}

export function resolveMoney(v, label, { max = 100_000_000 } = {}) {
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ToolInputError(`${label} must be a number`);
  if (n < 0) throw new ToolInputError(`${label} cannot be negative`);
  if (n > max) throw new ToolInputError(`${label} is above the supported ceiling of ${max.toLocaleString('en-US')}`);
  return n;
}

export function resolveFilingStatus(v) {
  if (v == null || v === '') return 'single';
  const k = String(v).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const alias = {
    single: 'single', s: 'single', married_filing_separately: 'single', mfs: 'single',
    married: 'married', married_filing_jointly: 'married', mfj: 'married', joint: 'married',
    head_of_household: 'head_of_household', hoh: 'head_of_household', head: 'head_of_household'
  };
  const id = alias[k];
  if (!id) throw new ToolInputError(`filingStatus must be one of: ${FILING_STATUSES.join(', ')} (aliases: mfj, mfs, hoh)`);
  return id;
}

// --- deep links ------------------------------------------------------------

/** Most specific live page for a state (+ salary): rung page > state hub > data study. */
export function deepLink(slug, salary) {
  if (LADDER_STATES.has(slug)) {
    if (salary != null && LADDER_SALARIES.includes(salary)) return `${SITE}/${slug}-take-home-pay-${salary}/`;
    return `${SITE}/${slug}-take-home-pay/`;
  }
  return `${SITE}/data/take-home-pay-by-state/`;
}

export const ATTRIBUTION = 'Source: Tools Berry (tools-berry.com), computed from IRS 2026 withholding tables and state DOR schedules';

function attribute(body, link) {
  return `${body}\n\n${ATTRIBUTION}\nSee it on the site: ${link}`;
}

const usd = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n * 100).toFixed(2) + '%';

// --- tools -----------------------------------------------------------------

export function computeTakeHome(args = {}) {
  const slug = resolveState(args.state);
  const salary = resolveMoney(args.salary, 'salary');
  const filingStatus = resolveFilingStatus(args.filingStatus);
  const st = taxData.states[slug];

  const r = computePaycheck(
    { wage: { type: 'salary', amount: salary }, filingStatus, payFrequency: 'annual', stateSlug: slug },
    taxData
  );
  const a = r.annual;
  const data = {
    state: st.name,
    stateSlug: slug,
    taxYear: taxData.taxYear,
    filingStatus,
    grossAnnual: a.gross,
    federalIncomeTax: a.federal,
    socialSecurity: a.socialSecurity,
    medicare: a.medicare,
    stateIncomeTax: a.state,
    statePayrollPrograms: a.statePrograms,
    statePayrollProgramDetail: a.programs,
    totalTax: a.totalTax,
    netAnnual: a.net,
    netMonthly: a.net / 12,
    netBiweekly: a.net / 26,
    effectiveTaxRate: a.effectiveRate,
    takeHomeRate: a.takeHomeRate,
    link: deepLink(slug, salary)
  };
  const lines = [
    `${st.name} take-home pay on ${usd(salary)} (${taxData.taxYear}, ${filingStatus}, no pre-tax deductions):`,
    `  Gross:                  ${usd(a.gross)}`,
    `  Federal income tax:    -${usd(a.federal)}`,
    `  Social Security:       -${usd(a.socialSecurity)}`,
    `  Medicare:              -${usd(a.medicare)}`,
    `  State income tax:      -${usd(a.state)}`,
    ...(a.programs.length
      ? a.programs.map((p) => `  ${p.label}:`.padEnd(26) + `-${usd(p.amount)}`)
      : ['  State payroll programs: none']),
    `  Total tax:             -${usd(a.totalTax)}`,
    `  Net (annual):           ${usd(a.net)}`,
    `  Net (monthly):          ${usd(a.net / 12)}`,
    `  Net (biweekly):         ${usd(a.net / 26)}`,
    `  Effective tax rate:     ${pct(a.effectiveRate)}`
  ];
  return { text: attribute(lines.join('\n'), data.link), data };
}

export function computeBonusWithholding(args = {}) {
  const slug = resolveState(args.state);
  const bonus = resolveMoney(args.bonusAmount, 'bonusAmount');
  const filingStatus = resolveFilingStatus(args.filingStatus);
  const regIncome = args.salary == null ? 0 : resolveMoney(args.salary, 'salary');
  const st = taxData.states[slug];
  const supp = suppData.states[slug];

  const r = computeBonus({ bonus, regIncome, filingStatus, stateSlug: slug }, taxData, suppData);
  const data = {
    state: st.name,
    stateSlug: slug,
    taxYear: suppData.taxYear ?? taxData.taxYear,
    bonusAmount: bonus,
    federalSupplementalWithholding: r.withheld.federal,
    federalRuleApplied: bonus > suppData.federal.highThreshold
      ? '22% up to $1,000,000 of supplemental wages, 37% above'
      : 'flat 22% (IRS Pub 15 supplemental rate)',
    stateWithholding: r.withheld.state,
    stateMethod: supp ? supp.method : 'none',
    stateSupplementalRate: supp && supp.rate != null ? supp.rate : null,
    stateNote: supp ? (supp.note || supp.source || null) : null,
    fica: r.withheld.fica,
    totalWithheld: r.withheld.total,
    takeHome: r.withheld.keep,
    withheldPctOfBonus: r.withheld.pctOfBonus,
    link: deepLink(slug, null)
  };
  const lines = [
    `${st.name} withholding on a ${usd(bonus)} bonus (${data.taxYear}, ${filingStatus}):`,
    `  Federal supplemental:  -${usd(r.withheld.federal)}   (${data.federalRuleApplied})`,
    `  State (${supp ? supp.method : 'none'} method):`.padEnd(26) + `-${usd(r.withheld.state)}` +
      (supp && supp.method === 'flat' ? `   (${pct(supp.rate)} flat supplemental rate)` : ''),
    `  FICA (SS + Medicare):  -${usd(r.withheld.fica)}`,
    `  Total withheld:        -${usd(r.withheld.total)}  (${pct(r.withheld.pctOfBonus)} of the bonus)`,
    `  You take home:          ${usd(r.withheld.keep)}`,
    '',
    'This is WITHHOLDING, not final tax. The true bill is settled on your return.',
    ...(data.stateNote ? [`State note: ${data.stateNote}`] : [])
  ];
  return { text: attribute(lines.join('\n'), data.link), data };
}

export function compareStates(args = {}) {
  const list = args.states;
  if (!Array.isArray(list) || list.length < 2) throw new ToolInputError('states must be an array of at least 2 states');
  if (list.length > 51) throw new ToolInputError('states may name at most 51 jurisdictions');
  const salary = resolveMoney(args.salary, 'salary');
  const filingStatus = resolveFilingStatus(args.filingStatus);

  const rows = list.map((s) => {
    const slug = resolveState(s);
    const r = computePaycheck(
      { wage: { type: 'salary', amount: salary }, filingStatus, payFrequency: 'annual', stateSlug: slug },
      taxData
    );
    return {
      state: taxData.states[slug].name,
      stateSlug: slug,
      netAnnual: r.annual.net,
      stateIncomeTax: r.annual.state,
      statePayrollPrograms: r.annual.statePrograms,
      totalTax: r.annual.totalTax,
      effectiveTaxRate: r.annual.effectiveRate,
      link: deepLink(slug, salary)
    };
  }).sort((a, b) => b.netAnnual - a.netAnnual);

  const best = rows[0];
  for (const r of rows) {
    r.vsBest = r.netAnnual - best.netAnnual; // 0 for the winner, negative below it
  }
  const data = {
    salary, filingStatus, taxYear: taxData.taxYear,
    best: best.state, spread: best.netAnnual - rows[rows.length - 1].netAnnual,
    rows
  };
  const lines = [
    `Take-home on ${usd(salary)} (${taxData.taxYear}, ${filingStatus}), best first:`,
    ...rows.map((r) => `  ${r.state.padEnd(22)} net ${usd(r.netAnnual).padStart(13)}   state tax ${usd(r.stateIncomeTax).padStart(11)}   vs best ${usd(r.vsBest).padStart(12)}`),
    '',
    `Spread from best to worst: ${usd(data.spread)}.`
  ];
  return { text: attribute(lines.join('\n'), deepLink(best.stateSlug, salary)), data };
}

export function getStateRates(args = {}) {
  const slug = resolveState(args.state);
  const st = taxData.states[slug];
  const supp = suppData.states[slug];
  const filingStatus = resolveFilingStatus(args.filingStatus);
  const tax = st.tax || {};
  const brackets = tax.brackets ? (tax.brackets[filingStatus] || tax.brackets.single) : null;

  const data = {
    state: st.name,
    stateSlug: slug,
    abbr: st.abbr,
    taxYear: st.figureYear ?? taxData.taxYear,
    hasIncomeTax: !!st.hasIncomeTax,
    taxType: tax.type ?? 'none',
    flatRate: tax.type === 'flat' ? tax.rate : null,
    brackets: brackets ? brackets.map((b) => ({ rate: b.rate, upTo: b.upTo })) : null,
    standardDeduction: tax.standardDeduction ?? null,
    personalExemption: tax.personalExemption ?? null,
    employeePrograms: (st.employeePrograms || []).map((p) => ({
      label: p.label, rate: p.rate, wageBase: p.wageBase ?? null, annualMax: p.annualMax ?? null
    })),
    supplementalWithholding: supp ? { method: supp.method, rate: supp.rate ?? null, note: supp.note ?? null } : null,
    source: st._source ?? null,
    link: deepLink(slug, null)
  };
  const lines = [
    `${st.name} (${st.abbr}) — ${data.taxYear} state schedule:`,
    st.hasIncomeTax
      ? (tax.type === 'flat'
        ? `  Income tax: flat ${pct(tax.rate)}`
        : `  Income tax: graduated, ${brackets.length} band(s) for ${filingStatus}:\n` +
          brackets.map((b) => `    ${pct(b.rate)} up to ${b.upTo == null ? 'no limit' : usd(b.upTo)}`).join('\n'))
      : '  Income tax: none on wages',
    ...(data.standardDeduction != null ? [`  State standard deduction: ${JSON.stringify(data.standardDeduction)}`] : []),
    data.employeePrograms.length
      ? '  Employee payroll programs:\n' + data.employeePrograms.map((p) => `    ${p.label}: ${pct(p.rate)}${p.wageBase ? ` on the first ${usd(p.wageBase)}` : ''}${p.annualMax ? ` (max ${usd(p.annualMax)})` : ''}`).join('\n')
      : '  Employee payroll programs: none',
    data.supplementalWithholding
      ? `  Bonus/supplemental withholding: ${data.supplementalWithholding.method}${data.supplementalWithholding.rate != null ? ` at ${pct(data.supplementalWithholding.rate)}` : ''}`
      : '',
    ...(data.source ? ['', `State source: ${data.source}`] : [])
  ].filter(Boolean);
  return { text: attribute(lines.join('\n'), data.link), data };
}
