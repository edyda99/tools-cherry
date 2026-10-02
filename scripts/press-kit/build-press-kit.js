#!/usr/bin/env node
// build-press-kit.js: regenerate the 2027 press kit (charts + dataset) from the
// repo's own data and engines. Run with `npm run press-kit`.
//
// WRITES (committed, then shipped by build.js to /press/2027/, unlisted):
//   src/press-kit/2027/2027-cola-impact.{svg,png}
//   src/press-kit/2027/2027-federal-income-tax-change.{svg,png}
//   src/press-kit/2027/take-home-pay-by-state-2026.{svg,png}
//   src/press-kit/2027/tools-berry-2027-press-data.csv
//   src/press-kit/2027/manifest.json   (every number + status, read by build.js)
//
// NO TAX MATH HERE. COLA arithmetic is applyCola/colaPercent from
// src/engine/projections-2027.js; federal tax is federalIncomeTax and take-home
// is computePaycheck from src/engine/paycheck-engine.js, the same calls the
// calculators and /data/take-home-pay-by-state/ make.
//
// DAY-OF RUNBOOK (10-14 COLA day, and IRS Revenue Procedure day):
//   1. Put the official figure in the data (one of the slots below).
//   2. npm run press-kit        (regenerates every file above; needs Chrome)
//   3. npm test && npm run build, then deploy as usual.
// The labels flip by themselves: ESTIMATE -> OFFICIAL, PROJECTED -> OFFICIAL.
//
// WHERE THE GENERATOR LOOKS, in priority order:
//   COLA
//     a. projections-2027.json cpiw.officialCola =
//          { "percent": 2.8, "announcedDate": "2026-10-14", "sourceUrl": "https://www.ssa.gov/...", "title": "..." }
//        -> OFFICIAL. If (b) is also computable and disagrees, the run fails.
//     b. cpiw.q3_2026 fully published (the September value filled in) -> the
//        statutory formula gives the COLA -> CALCULATED (SSA confirmation pending).
//     c. otherwise cpiw.thirdPartyEstimates[0] (the figure the COLA page
//        pre-fills; TSCL 3.6% today) -> ESTIMATE.
//   2027 federal brackets + standard deduction
//     a. src/data/tax-data-2027.json `federal` (+ `_meta.revenueProcedure`) -> OFFICIAL
//     b. projections-2027.json official2027 =
//          { "federal": { "standardDeduction": {...}, "brackets": {...} },
//            "revenueProcedure": { "name": "Rev. Proc. 2026-NN", "publishedDate": "...", "sourceUrl": "..." } }
//        -> OFFICIAL
//     c. projections-2027.json thirdPartyProjections, if an item (or the block)
//        carries structured figures -> PROJECTED, attributed to its publishers
//     d. FALLBACK_2027_PROJECTION in scripts/press-kit/inputs.js -> PROJECTED
//        (TODO: remove once (c) lands)
//
// FLAGS
//   --svg-only              skip PNG rendering (no Chrome needed); PNGs left as they were
//   --allow-expired-watch   proceed when a state's legal-status `_watch` has lapsed;
//                           the state is then marked "under review" on the dot plot.
//                           Without it the run fails, same as build.js.
//   CHROME_PATH=...         override the Chrome binary.

import { readFile, writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { federalIncomeTax, computePaycheck } from '../../src/engine/paycheck-engine.js';
import { applyCola, colaPercent, average, windowStatus } from '../../src/engine/projections-2027.js';
import { colaChart, federalChart, takeHomeChart, usd } from './svg-charts.js';
import {
  PRESS_KIT_CONFIG as CFG, FALLBACK_2027_PROJECTION, loadPressKitInputs, inputsFingerprint,
} from './inputs.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'src', 'press-kit', '2027');
const SITE = 'https://tools-berry.com';
const PAGE_PATH = '/press/2027/';
const CREDIT = 'Chart: tools-berry.com';

const FILES = {
  cola: '2027-cola-impact',
  federal: '2027-federal-income-tax-change',
  takeHome: 'take-home-pay-by-state-2026',
  csv: 'tools-berry-2027-press-data.csv',
};

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  const src = await readFile(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}
const SVG_ONLY = args.has('--svg-only');
const ALLOW_EXPIRED_WATCH = args.has('--allow-expired-watch');

// ---------------------------------------------------------------- helpers
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const humanDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : String(iso || '');
};
const listAnd = (a) => (a.length <= 1 ? (a[0] || '') : a.length === 2 ? `${a[0]} and ${a[1]}`
  : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const NUM_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const numWord = (n) => NUM_WORD[n] || String(n);
const pct1 = (p) => `${Number(p).toFixed(1)}%`;
const fail = (msg) => { throw new Error(`press-kit: ${msg}`); };
const need = (cond, msg) => { if (!cond) fail(msg); };

// ---------------------------------------------------------------- load
const inputs = await loadPressKitInputs(ROOT);
const { taxData, proj, roster, taxData2027 } = inputs;
const YEAR = taxData.taxYear;
const rp26 = taxData._meta.revenueProcedure;
need(rp26 && rp26.name && rp26.sourceUrl && rp26.publishedDate,
  'tax-data-2026.json _meta.revenueProcedure must carry name, sourceUrl and publishedDate');

// Same legal-status tripwire build.js enforces, so the kit cannot quietly
// chart a state on law that may have lapsed.
const today = new Date().toISOString().slice(0, 10);
const expiredWatch = Object.entries(taxData.states)
  .filter(([, s]) => s._watch && s._watch.until && s._watch.until < today)
  .map(([slug, s]) => ({ slug, name: s.name, until: s._watch.until }));
if (expiredWatch.length && !ALLOW_EXPIRED_WATCH) {
  fail(`legal-status watch EXPIRED for ${expiredWatch.map((w) => `${w.slug} (${w.until})`).join(', ')}. ` +
    'Fix the data (as build.js demands) or pass --allow-expired-watch to mark them "under review".');
}

// ---------------------------------------------------------------- COLA
function resolveCola() {
  const cw = proj.cpiw;
  const priorKeys = Object.keys(cw.q3_2025).sort();
  const curKeys = Object.keys(cw.q3_2026).sort();
  const cur = windowStatus(curKeys, cw.q3_2026);
  const computed = cur.complete
    ? colaPercent(average(priorKeys, cw.q3_2025), average(curKeys, cw.q3_2026)) : null;
  const sched = (cw.schedule || {})[curKeys[curKeys.length - 1]];
  const expected = sched && sched.due ? sched.due : null;
  if (cw.officialCola) {
    const o = cw.officialCola;
    need(Number.isFinite(o.percent) && o.announcedDate && o.sourceUrl,
      'cpiw.officialCola needs percent (number), announcedDate and sourceUrl');
    if (computed !== null && Math.abs(computed - o.percent) > 1e-9)
      fail(`cpiw.officialCola says ${o.percent}% but the published CPI-W months give ${computed}%. One of them is wrong.`);
    return { status: 'OFFICIAL', percent: o.percent, publisher: 'Social Security Administration',
      date: o.announcedDate, sourceUrl: o.sourceUrl, title: o.title || '2027 cost-of-living adjustment', expected };
  }
  if (computed !== null) {
    const last = cw.q3_2026[curKeys[curKeys.length - 1]];
    return { status: 'CALCULATED', percent: computed,
      publisher: 'Bureau of Labor Statistics (CPI-W), Social Security formula',
      date: last.publishedDate, sourceUrl: cw.seriesUrl, title: 'CPI-W, July to September 2026 vs 2025', expected };
  }
  const e = (cw.thirdPartyEstimates || [])[0];
  need(e && Number.isFinite(e.figure) && e.sourceUrl && e.asOf,
    'no official COLA, incomplete CPI-W quarter and no third-party estimate with a source: nothing to chart');
  // Display name without the parenthetical acronym, as the COLA page's chips do.
  return { status: 'ESTIMATE', percent: e.figure, publisher: e.publisher.replace(/\s*\(.*\)$/, ''), date: e.asOf,
    sourceUrl: e.sourceUrl, title: e.title || '', expected };
}

// ---------------------------------------------------------------- 2027 federal
const RATES = taxData.federal.brackets.single.map((b) => b.rate);
const STATUS_KEYS = {
  single: ['single'],
  married: ['married', 'mfj', 'marriedFilingJointly', 'married_filing_jointly'],
};
const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; };
const normRate = (r) => { const n = Number(String(r).replace('%', '')); return n > 1 ? n / 100 : n; };

// Accepts the engine's own [{rate, upTo}] shape, a [{rate, from|floor|over|min|start}]
// floor list, or a {rate: floor} map. Always returns the engine's shape, and
// refuses anything whose rates are not the statutory seven.
function normBrackets(b, label) {
  let floors;
  if (Array.isArray(b) && b.length && 'upTo' in b[0]) {
    const out = b.map((x) => ({ rate: normRate(x.rate), upTo: x.upTo == null ? null : Number(x.upTo) }));
    floors = null;
    checkRates(out.map((x) => x.rate), label);
    return out;
  }
  if (Array.isArray(b)) {
    floors = b.map((x) => ({ rate: normRate(x.rate),
      floor: Number(pick(x, ['from', 'floor', 'over', 'min', 'start', 'threshold'])) }));
  } else if (b && typeof b === 'object') {
    floors = Object.entries(b).map(([r, f]) => ({ rate: normRate(r), floor: Number(f) }));
  } else fail(`${label}: no bracket table`);
  floors.sort((a, c) => a.floor - c.floor);
  if (floors[0].floor > 0) floors.unshift({ rate: RATES[0], floor: 0 });
  need(floors.every((f) => Number.isFinite(f.floor)), `${label}: a bracket floor is not a number`);
  checkRates(floors.map((f) => f.rate), label);
  return floors.map((f, i) => ({ rate: f.rate, upTo: i + 1 < floors.length ? floors[i + 1].floor : null }));
}
function checkRates(rates, label) {
  const ok = rates.length === RATES.length && rates.every((r, i) => Math.abs(r - RATES[i]) < 1e-9);
  need(ok, `${label}: rates ${rates.join(',')} are not the statutory ${RATES.join(',')}`);
}
function normFed(node, label) {
  const sd = node.standardDeduction;
  const br = node.brackets || node.bracketFloors || node.floors;
  need(sd && br, `${label}: needs standardDeduction and brackets`);
  const out = { standardDeduction: {}, brackets: {} };
  for (const [id, keys] of Object.entries(STATUS_KEYS)) {
    const s = Number(pick(sd, keys));
    need(Number.isFinite(s) && s > 0, `${label}: no ${id} standard deduction`);
    out.standardDeduction[id] = s;
    out.brackets[id] = normBrackets(pick(br, keys), `${label} ${id}`);
  }
  return out;
}
// Find structured figures anywhere sensible on a third-party item.
function extractFed(o) {
  if (!o || typeof o !== 'object') return null;
  for (const n of [o, o.figures, o.federal, o.projection, o.projected]) {
    if (n && typeof n === 'object' && n.standardDeduction && (n.brackets || n.bracketFloors || n.floors)) return n;
  }
  return null;
}

function resolveFederal2027() {
  if (taxData2027 && taxData2027.federal) {
    const rp = taxData2027._meta && taxData2027._meta.revenueProcedure;
    need(rp && rp.name && rp.sourceUrl && rp.publishedDate,
      'tax-data-2027.json exists but _meta.revenueProcedure lacks name/sourceUrl/publishedDate');
    return { status: 'OFFICIAL', fed: normFed(taxData2027.federal, 'tax-data-2027.json federal'),
      source: { kind: 'irs', name: rp.name, sourceUrl: rp.sourceUrl, date: rp.publishedDate } };
  }
  if (proj.official2027 && proj.official2027.federal) {
    const rp = proj.official2027.revenueProcedure;
    need(rp && rp.name && rp.sourceUrl && rp.publishedDate,
      'projections-2027.json official2027 needs revenueProcedure {name, publishedDate, sourceUrl}');
    return { status: 'OFFICIAL', fed: normFed(proj.official2027.federal, 'official2027.federal'),
      source: { kind: 'irs', name: rp.name, sourceUrl: rp.sourceUrl, date: rp.publishedDate } };
  }
  const tp = proj.thirdPartyProjections || {};
  const found = [];
  for (const it of tp.items || []) {
    const n = extractFed(it);
    if (n) found.push({ fed: normFed(n, `thirdPartyProjections item "${it.publisher}"`), item: it });
  }
  const block = extractFed(tp);
  if (block && !found.length) {
    found.push({ fed: normFed(block, 'thirdPartyProjections'), item: { publisher: null } });
  }
  if (found.length) {
    const ref = JSON.stringify(found[0].fed);
    for (const f of found)
      need(JSON.stringify(f.fed) === ref, `thirdPartyProjections disagree (${f.item.publisher} differs). ` +
        'The chart would have to say whose figures it uses; decide that before regenerating.');
    const publishers = (tp.items || []).map((i) => i.publisher).filter(Boolean);
    need(publishers.length, 'thirdPartyProjections has figures but no named publisher');
    return { status: 'PROJECTED', fed: found[0].fed,
      source: { kind: 'thirdParty', publishers,
        items: (tp.items || []).map((i) => ({ publisher: i.publisher, date: i.publishedDate || i.asOf || null,
          sourceUrl: i.sourceUrl || null })) } };
  }
  console.warn('press-kit: thirdPartyProjections has no structured 2027 figures yet; using ' +
    'FALLBACK_2027_PROJECTION from scripts/press-kit/inputs.js (TODO: switch to the JSON).');
  return { status: 'PROJECTED',
    fed: normFed({ standardDeduction: FALLBACK_2027_PROJECTION.standardDeduction,
      brackets: FALLBACK_2027_PROJECTION.bracketFloors }, 'FALLBACK_2027_PROJECTION'),
    source: { kind: 'thirdParty', fallback: true, publishers: FALLBACK_2027_PROJECTION.publishers,
      items: FALLBACK_2027_PROJECTION.publishers.map((p) => ({ publisher: p, date: null, sourceUrl: null })) } };
}

// ---------------------------------------------------------------- compute
const cola = resolveCola();
const colaRows = CFG.colaExampleBenefits.map((b) => {
  const r = applyCola(b, cola.percent);
  need(Number.isFinite(r.newMonthly), `applyCola(${b}, ${cola.percent}) returned no figure`);
  return { benefit: b, newMonthly: r.newMonthly, monthlyIncrease: r.monthlyIncrease, annualIncrease: r.annualIncrease };
});

const fed27 = resolveFederal2027();
const fed26 = taxData.federal;
const fedGroups = CFG.federalStatuses.map((st) => ({
  id: st.id,
  label: st.label,
  rows: CFG.federalWages.map((w) => {
    // Rounded first, then differenced, so the change always equals the two
    // amounts printed beside it.
    const tax2026 = Math.round(federalIncomeTax(w, st.id, fed26));
    const tax2027 = Math.round(federalIncomeTax(w, st.id, fed27.fed));
    return { wages: w, tax2026, tax2027, change: tax2026 - tax2027 };
  }),
}));

const salaries = CFG.takeHomeSalaries;
const expiredSet = new Set(expiredWatch.map((w) => w.slug));
const thRows = roster.filter((s) => taxData.states[s.slug]).map((s) => {
  const st = taxData.states[s.slug];
  const per = salaries.map((amount) => {
    const a = computePaycheck({ wage: { type: 'salary', amount }, filingStatus: 'single',
      payFrequency: 'annual', stateSlug: s.slug }, taxData).annual;
    return { salary: amount, net: a.net, federal: a.federal, fica: a.socialSecurity + a.medicare,
      stateTax: a.state, programs: a.statePrograms };
  });
  const priorYear = Number(st.figureYear) && Number(st.figureYear) !== Number(YEAR)
    ? { year: Number(st.figureYear), scope: st.figureYearScope || 'brackets' } : null;
  return { slug: s.slug, name: st.name, abbr: st.abbr, per, priorYear, underReview: expiredSet.has(s.slug) };
});
need(thRows.length === 51, `expected 51 jurisdictions, got ${thRows.length}`);
const lastIdx = salaries.length - 1;
// Sorted on the UNROUNDED take-home at the higher salary, ties by name, the
// same order the take-home study uses.
thRows.sort((a, b) => b.per[lastIdx].net - a.per[lastIdx].net || a.name.localeCompare(b.name));
const spreads = salaries.map((_, i) => {
  const vals = thRows.map((r) => Math.round(r.per[i].net));
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  return { salary: salaries[i], max, min, spread: max - min,
    best: thRows.filter((r) => Math.round(r.per[i].net) === max).map((r) => r.name),
    worst: thRows.filter((r) => Math.round(r.per[i].net) === min).map((r) => r.name) };
});

// ---------------------------------------------------------------- copy
const colaDateH = humanDate(cola.date);
const expectedH = cola.expected ? humanDate(cola.expected) : null;
const colaMin = Math.min(...colaRows.map((r) => r.monthlyIncrease));
const colaMax = Math.max(...colaRows.map((r) => r.monthlyIncrease));
const benefitsText = `${usd(CFG.colaExampleBenefits[0])} to ${usd(CFG.colaExampleBenefits[CFG.colaExampleBenefits.length - 1])}`;
const colaCopy = {
  ESTIMATE: {
    badge: 'ESTIMATE',
    title: `A ${pct1(cola.percent)} COLA would add ${usd(colaMin)} to ${usd(colaMax)} a month to Social Security checks of ${benefitsText}`,
    subtitle: `ESTIMATE, not the official 2027 figure. Uses the ${pct1(cola.percent)} forecast published by ${cola.publisher} on ${colaDateH}.` +
      (expectedH ? ` The Social Security Administration is expected to announce the official COLA on ${expectedH}.` : ''),
    sourceCola: `COLA: ${cola.publisher} estimate, ${colaDateH}.`,
  },
  CALCULATED: {
    badge: 'CALCULATED',
    title: `A ${pct1(cola.percent)} COLA adds ${usd(colaMin)} to ${usd(colaMax)} a month to Social Security checks of ${benefitsText}`,
    subtitle: `Calculated from the official inflation data with the formula Social Security uses (CPI-W, July to September 2026 vs 2025). The Social Security Administration's own announcement is the final word.`,
    sourceCola: `COLA: calculated from Bureau of Labor Statistics CPI-W data published ${colaDateH}.`,
  },
  OFFICIAL: {
    badge: 'OFFICIAL',
    title: `The ${pct1(cola.percent)} COLA for 2027 adds ${usd(colaMin)} to ${usd(colaMax)} a month to Social Security checks of ${benefitsText}`,
    subtitle: `Official 2027 cost-of-living adjustment announced by the Social Security Administration on ${colaDateH}. It takes effect with January 2027 payments.`,
    sourceCola: `COLA: Social Security Administration, announced ${colaDateH}.`,
  },
}[cola.status];

const changes = fedGroups.flatMap((g) => g.rows.map((r) => r.change));
const chMin = Math.min(...changes);
const chMax = Math.max(...changes);
const fedOfficial = fed27.status === 'OFFICIAL';
const pubs = fed27.source.publishers || [];
const fedTitle = chMin >= 0
  ? `${fedOfficial ? 'New' : 'Projected'} 2027 brackets ${fedOfficial ? 'cut' : 'would cut'} federal income tax by ${usd(chMin)} to ${usd(chMax)} on unchanged pay`
  : `${fedOfficial ? 'New' : 'Projected'} 2027 brackets ${fedOfficial ? 'change' : 'would change'} federal income tax by ${usd(Math.abs(chMin))} more to ${usd(chMax)} less on unchanged pay`;
const fedSubtitle = fedOfficial
  ? `Official 2027 figures from the IRS (${fed27.source.name}, published ${humanDate(fed27.source.date)}) compared with official 2026 figures (${rp26.name}). Federal income tax on wages, standard deduction, before credits.`
  : `PROJECTED: the IRS has not published official 2027 figures yet. 2027 uses the brackets and standard deduction projected by ${listAnd(pubs)}${pubs.length > 1 ? ', which agree on every figure' : ''}; 2026 uses the official IRS figures (${rp26.name}). Federal income tax on wages, standard deduction, before credits.`;
const fedSource = fedOfficial
  ? `Source: Tools Berry calculation (tools-berry.com/2027-tax-brackets/). 2027: IRS ${fed27.source.name}. 2026: IRS ${rp26.name}.`
  : `Source: Tools Berry calculation (tools-berry.com/2027-tax-brackets/). 2027 projections: ${listAnd(pubs)}. 2026: IRS ${rp26.name}.`;
const label2027 = fedOfficial ? 'in 2027' : 'projected for 2027';

const hi = spreads[lastIdx];
const bestCount = hi.best.length;
const thTitle = `State taxes swing take-home pay on a ${usd(hi.salary)} salary by up to ${usd(hi.spread)} a year`;
const bestPhrase = bestCount === 1
  ? `${hi.best[0]} keeps the most (${usd(hi.max)})`
  : `${numWord(bestCount)} states tie for the most (${usd(hi.max)})`;
const thSubtitle = `Annual take-home pay for a single filer under ${YEAR} federal and state tax rules, all 50 states and DC. ` +
  `On ${usd(hi.salary)}, ${bestPhrase} and ${listAnd(hi.worst)} the least (${usd(hi.min)}). ` +
  'Dots mark positions on each scale; the scales do not start at zero.';
const byName = (a, b) => a.name.localeCompare(b.name);
const priorBy = (scope) => thRows.filter((r) => r.priorYear && r.priorYear.scope === scope).sort(byName);
const priorNotes = [];
{
  const sd = priorBy('standardDeduction');
  const br = thRows.filter((r) => r.priorYear && r.priorYear.scope !== 'standardDeduction').sort(byName);
  const bits = [];
  if (sd.length) bits.push(`the ${sd[0].priorYear.year} standard deduction for ${listAnd(sd.map((r) => r.name))}`);
  if (br.length) bits.push(`${br[0].priorYear.year} income tax brackets for ${listAnd(br.map((r) => r.name))}`);
  if (bits.length) priorNotes.push(`* Uses ${bits.join(', and ')}, because the ${YEAR} amounts were not yet published.`);
}
if (expiredWatch.length) {
  priorNotes.push(`† Under review: the legal basis for ${listAnd(expiredWatch.map((w) => w.name))}'s figures was due for ` +
    `re-verification on ${humanDate(expiredWatch[0].until)}; this figure may change.`);
}
const thSource = `Source: Tools Berry paycheck calculator (tools-berry.com/data/take-home-pay-by-state/). IRS ${rp26.name} ` +
  `brackets and standard deduction, ${YEAR} Social Security and Medicare rates, and each state's published income tax ` +
  'and payroll rules. Standard deduction, no other deductions or credits; excludes city and county income taxes.';

// ---------------------------------------------------------------- charts
const charts = {
  cola: colaChart({
    title: colaCopy.title,
    subtitle: colaCopy.subtitle,
    badge: colaCopy.badge,
    rows: colaRows,
    notes: ['Social Security rounds each new monthly payment down to the whole dollar, and the increases shown ' +
      'are after that rounding. Amounts are gross, before Medicare premiums or tax withholding come out.'],
    source: `Source: Tools Berry calculation (tools-berry.com/2027-social-security-cola/). ${colaCopy.sourceCola}`,
    credit: CREDIT,
  }),
  federal: federalChart({
    title: fedTitle,
    subtitle: fedSubtitle,
    badge: fedOfficial ? 'OFFICIAL' : 'PROJECTED',
    groups: fedGroups,
    label2027,
    notes: ['Pay is held at the same dollar amount in both years; the brackets and standard deduction rise with ' +
      'inflation each year. Excludes the deductions for tips, overtime, seniors and car-loan interest, and all credits.'],
    source: fedSource,
    credit: CREDIT,
  }),
  takeHome: takeHomeChart({
    title: thTitle,
    subtitle: thSubtitle,
    badge: null,
    panels: salaries.map((s) => ({ salary: s, label: `${usd(s)} salary` })),
    rows: thRows.map((r, ri) => ({
      name: r.name,
      mark: `${r.priorYear ? '*' : ''}${r.underReview ? '†' : ''}`,
      values: r.per.map((p) => p.net),
      // Direct labels on the extremes only: the first row (most kept at the
      // higher salary) and the last row (least kept). The rest live in the CSV.
      label: ri === 0 ? r.per.map((p) => ({ text: usd(p.net), side: 'left' }))
        : ri === thRows.length - 1 ? r.per.map((p) => ({ text: usd(p.net), side: 'right' })) : null,
    })),
    notes: priorNotes,
    source: thSource,
    credit: CREDIT,
  }),
};

// ---------------------------------------------------------------- dataset
const csvEsc = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const header = ['chart', 'figure_status', 'jurisdiction', 'state_abbr', 'filing_status', 'input_basis',
  'input_amount_usd', 'measure', 'value_usd', 'cola_percent', 'source'];
const csv = [header];
const colaSrc = cola.status === 'ESTIMATE'
  ? `${cola.publisher}, COLA estimate published ${colaDateH} (${cola.sourceUrl}); Tools Berry calculation`
  : cola.status === 'OFFICIAL'
    ? `Social Security Administration, announced ${colaDateH} (${cola.sourceUrl}); Tools Berry calculation`
    : `Bureau of Labor Statistics CPI-W (${cola.sourceUrl}), Social Security COLA formula; Tools Berry calculation`;
for (const r of colaRows) {
  for (const [measure, v] of [['new monthly payment', r.newMonthly], ['monthly increase', r.monthlyIncrease],
    ['annual increase', r.annualIncrease]]) {
    csv.push(['2027 Social Security COLA', cola.status, 'United States', '', '', 'current monthly payment',
      r.benefit, measure, v, cola.percent, colaSrc]);
  }
}
const src26 = `IRS ${rp26.name} (${rp26.sourceUrl}); Tools Berry calculation`;
const src27 = fedOfficial
  ? `IRS ${fed27.source.name} (${fed27.source.sourceUrl}); Tools Berry calculation`
  : `Projected by ${listAnd(pubs)}; Tools Berry calculation`;
const st27 = fedOfficial ? 'OFFICIAL' : 'PROJECTED';
const statusLabel = Object.fromEntries(CFG.federalStatuses.map((s) => [s.id, s.label.toLowerCase().replace(' filer', '')]));
for (const g of fedGroups) {
  for (const r of g.rows) {
    csv.push(['Federal income tax 2027 vs 2026', 'OFFICIAL', 'United States', '', statusLabel[g.id], 'annual wages',
      r.wages, 'federal income tax, 2026', r.tax2026, '', src26]);
    csv.push(['Federal income tax 2027 vs 2026', st27, 'United States', '', statusLabel[g.id], 'annual wages',
      r.wages, 'federal income tax, 2027', r.tax2027, '', src27]);
    csv.push(['Federal income tax 2027 vs 2026', st27, 'United States', '', statusLabel[g.id], 'annual wages',
      r.wages, 'reduction in federal income tax, 2027 vs 2026', r.change, '', src27]);
  }
}
for (const g of CFG.federalStatuses) {
  for (const [yr, fed, st, src] of [[YEAR, fed26, 'OFFICIAL', `IRS ${rp26.name} (${rp26.sourceUrl})`],
    [YEAR + 1, fed27.fed, st27, fedOfficial ? `IRS ${fed27.source.name} (${fed27.source.sourceUrl})` : `Projected by ${listAnd(pubs)}`]]) {
    csv.push(['Federal tax inputs', st, 'United States', '', statusLabel[g.id], '', '',
      `standard deduction, ${yr}`, fed.standardDeduction[g.id], '', src]);
    let lower = 0;
    for (const b of fed.brackets[g.id]) {
      csv.push(['Federal tax inputs', st, 'United States', '', statusLabel[g.id], '', '',
        `taxable income where the ${Math.round(b.rate * 100)}% rate starts, ${yr}`, lower, '', src]);
      lower = b.upTo;
    }
  }
}
const thSrc = `Tools Berry paycheck engine; IRS ${rp26.name}; each state's published ${YEAR} income tax and payroll rules`;
for (const r of [...thRows].sort((a, b) => a.name.localeCompare(b.name))) {
  const note = [r.priorYear ? `uses ${r.priorYear.year} ${r.priorYear.scope === 'standardDeduction' ? 'standard deduction' : 'brackets'}` : '',
    r.underReview ? 'under review' : ''].filter(Boolean).join('; ');
  for (const p of r.per) {
    for (const [measure, v] of [['annual take-home pay', p.net], ['federal income tax', p.federal],
      ['Social Security and Medicare', p.fica], ['state income tax', p.stateTax],
      ['state payroll programs (disability, paid leave and similar)', p.programs]]) {
      csv.push([`Take-home pay by state, ${YEAR}`, `${YEAR} rules${note ? ` (${note})` : ''}`, r.name, r.abbr,
        'single', 'annual salary', p.salary, measure, Math.round(v), '', thSrc]);
    }
  }
}
const dataAsOf = [cola.date, taxData._meta.lastSourced, fed27.source.date].filter(Boolean).sort().pop();
const citation = `Tools Berry (tools-berry.com). 2027 Social Security COLA and federal tax press data. ` +
  `Data as of ${humanDate(dataAsOf)}. ${SITE}${PAGE_PATH}`;
csv.push(['Citation', '', '', '', '', '', '', '', '', '', citation]);

// ---------------------------------------------------------------- write
await mkdir(OUT, { recursive: true });
for (const [k, c] of Object.entries(charts)) await writeFile(join(OUT, `${FILES[k]}.svg`), c.svg);
await writeFile(join(OUT, FILES.csv), csv.map((r) => r.map(csvEsc).join(',')).join('\n') + '\n');

async function renderPng(svg, width, height, outPng) {
  const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  need(existsSync(chrome), `Chrome not found at ${chrome}. Set CHROME_PATH, or run with --svg-only.`);
  const dir = await mkdtemp(join(tmpdir(), 'tb-press-kit-'));
  try {
    const html = join(dir, 'chart.html');
    await writeFile(html, '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;' +
      `background:#fff;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`);
    // A fresh profile per shot: a reused --user-data-dir can hang on the lock.
    const argv = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      '--no-default-browser-check', `--user-data-dir=${join(dir, 'profile')}`, '--force-device-scale-factor=2',
      `--window-size=${width},${height}`, '--default-background-color=ffffffff',
      `--screenshot=${outPng}`, pathToFileURL(html).href];
    await rm(outPng, { force: true });
    // Headless Chrome on macOS writes the file within a couple of seconds but
    // often never exits, so wait for its "bytes written to file" line and then
    // stop the whole process group ourselves.
    await new Promise((res, rej) => {
      const p = spawn(chrome, argv, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      let done = false;
      const stop = () => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* already gone */ } };
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        stop();
        err ? rej(err) : res();
      };
      const t = setTimeout(() => finish(new Error('press-kit: Chrome timed out after 90s')), 90000);
      const watch = (buf) => { if (/bytes written to file/.test(String(buf))) setTimeout(() => finish(), 300); };
      p.stdout.on('data', watch);
      p.stderr.on('data', watch);
      p.on('error', (e) => finish(e));
      p.on('exit', (code) => (existsSync(outPng) ? finish() : finish(new Error(`press-kit: Chrome exited ${code} without writing ${outPng}`))));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const head = await readFile(outPng);
  const w = head.readUInt32BE(16);
  const h = head.readUInt32BE(20);
  need(w === width * 2 && h === height * 2, `${outPng} is ${w}x${h}, expected ${width * 2}x${height * 2}`);
  need(w >= 1600, `${outPng} is only ${w}px wide; press images need at least 1600px`);
  return { w, h };
}

const pngSizes = {};
if (!SVG_ONLY) {
  for (const [k, c] of Object.entries(charts)) {
    pngSizes[k] = await renderPng(c.svg, c.width, c.height, join(OUT, `${FILES[k]}.png`));
  }
} else {
  console.warn('press-kit: --svg-only, PNGs NOT regenerated; they may now disagree with the SVGs.');
}

const manifest = {
  _comment: 'GENERATED by scripts/press-kit/build-press-kit.js. Do not edit; run `npm run press-kit`.',
  inputsFingerprint: inputsFingerprint(inputs, CFG),
  pngsRendered: !SVG_ONLY,
  dataAsOf,
  pagePath: PAGE_PATH,
  citation,
  taxYear: YEAR,
  files: {
    csv: FILES.csv,
    charts: Object.fromEntries(Object.entries(charts).map(([k, c]) => [k, {
      svg: `${FILES[k]}.svg`, png: `${FILES[k]}.png`, width: c.width, height: c.height,
      pngWidth: c.width * 2, pngHeight: c.height * 2 }])),
  },
  cola: { status: cola.status, percent: cola.percent, publisher: cola.publisher, date: cola.date,
    sourceUrl: cola.sourceUrl, sourceTitle: cola.title, expectedAnnouncement: cola.expected,
    title: colaCopy.title, subtitle: colaCopy.subtitle, rows: colaRows },
  federal: { status2027: fed27.status, source2027: fed27.source,
    source2026: { name: rp26.name, sourceUrl: rp26.sourceUrl, date: rp26.publishedDate },
    standardDeduction: { [YEAR]: fed26.standardDeduction, [YEAR + 1]: fed27.fed.standardDeduction },
    title: fedTitle, subtitle: fedSubtitle, groups: fedGroups },
  takeHome: { year: YEAR, salaries, filingStatus: 'single', title: thTitle, subtitle: thSubtitle,
    spreads, notes: priorNotes, underReview: expiredWatch,
    rows: thRows.map((r) => ({ name: r.name, abbr: r.abbr, slug: r.slug, priorYear: r.priorYear,
      underReview: r.underReview, takeHome: r.per.map((p) => Math.round(p.net)) })) },
};
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`press-kit: wrote ${OUT}`);
console.log(`  COLA        ${cola.status} ${pct1(cola.percent)} (${cola.publisher}, ${cola.date})`);
console.log(`  2027 federal ${fed27.status}${fed27.source.fallback ? ' (FALLBACK constant)' : ''}: ${pubs.join(', ') || fed27.source.name}`);
console.log(`  take-home   ${thRows.length} jurisdictions x ${salaries.length} salaries${expiredWatch.length ? `, UNDER REVIEW: ${expiredWatch.map((w) => w.slug).join(', ')}` : ''}`);
for (const [k, s] of Object.entries(pngSizes)) console.log(`  ${FILES[k]}.png ${s.w}x${s.h}`);
console.log(`  fingerprint ${manifest.inputsFingerprint}`);
