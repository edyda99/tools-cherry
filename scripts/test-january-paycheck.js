// test-january-paycheck.js — unit tests for the December 2026 vs January 2027
// paycheck diff engine behind /january-paycheck-change-calculator/. Run:
// node scripts/test-january-paycheck.js
//
// Reads the real data files, so a change to the 2026 tables, the publishers'
// projections or the 2027 wage base is exercised here too. The expected dollar
// figures are worked by hand in the comments, not copied from the engine.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDecJan, federal2027, state2027, paycheckLines, defaultYtd, CAUSE_ORDER, describeCause, signedUsd } from '../src/engine/january-paycheck.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const tax = readJSON('src/data/tax-data-2026.json');
const proj = readJSON('src/data/projections-2027.json');
const jp = readJSON('src/data/january-paycheck-2027.json');

let pass = 0, fail = 0;
function is(name, got, want) {
  if (got === want) pass++;
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error(`FAIL ${name}`); } }
function throws(name, fn) { try { fn(); fail++; console.error(`FAIL ${name}: did not throw`); } catch { pass++; } }

const wb27 = proj.ssaFactSheet2027.rows.find((r) => r.key === 'wageBase').after;
is('2027 wage base read from SSA fact sheet', wb27, 192300);

// --- picking the 2027 federal tables -----------------------------------------
const f27 = federal2027({ fed2026: tax.federal, wageBase2027: wb27, official2027: proj.official2027, projections: proj.thirdPartyProjections });
if (!proj.official2027) {
  is('no official2027 yet -> projected', f27.mode, 'projected');
  is('projected single standard deduction (all three publishers agree)', f27.federal.standardDeduction.single, 16600);
  is('projected married standard deduction', f27.federal.standardDeduction.married, 33200);
  is('head of household: publishers disagree, lowest used', f27.federal.standardDeduction.head_of_household, 24900);
  ok('head of household spread is reported', f27.spreads.some((s) => s.status === 'head_of_household' && s.what === 'standardDeduction' && s.values.join() === '24900,24925,24950'));
  ok('brackets agree, so no bracket spread', !f27.spreads.some((s) => s.what === 'brackets'));
  is('three publishers named', f27.publishers.length, 3);
}
is('2027 federal carries the 2027 wage base', f27.federal.fica.socialSecurity.wageBase, 192300);
is('2026 federal untouched', tax.federal.fica.socialSecurity.wageBase, 184500);
{
  const fake = { revenueProcedure: {}, federal: { standardDeduction: { single: 17000, married: 34000, head_of_household: 25500 }, brackets: tax.federal.brackets } };
  const o = federal2027({ fed2026: tax.federal, wageBase2027: wb27, official2027: fake, projections: proj.thirdPartyProjections });
  is('official2027 present -> official, flips automatically', o.mode, 'official');
  is('official2027 figures win over projections', o.federal.standardDeduction.single, 17000);
  const t = federal2027({ fed2026: tax.federal, wageBase2027: wb27, taxData2027Federal: { marker: 1 }, official2027: fake, projections: proj.thirdPartyProjections });
  is('tax-data-2027 federal wins over everything', t.federal.marker, 1);
  is('tax-data-2027 -> official', t.mode, 'official');
}
throws('no wage base and no tax-data-2027 -> refuses', () => federal2027({ fed2026: tax.federal, projections: proj.thirdPartyProjections }));

// --- picking the 2027 state tables --------------------------------------------
{
  const va = state2027({ slug: 'virginia', state2026: tax.states.virginia, overrides: jp.stateOverrides2027 });
  is('Virginia gets its statutory 2027 deduction', va.basis, 'override2027');
  is('Virginia single 9,200 + 930 exemption', va.state.tax.standardDeduction.single, 10130);
  is('Virginia brackets kept', va.state.tax.brackets.single.length, tax.states.virginia.tax.brackets.single.length);
  is('Virginia 2026 data not mutated', tax.states.virginia.tax.standardDeduction.single, 9680);
  const il = state2027({ slug: 'illinois', state2026: tax.states.illinois, overrides: jp.stateOverrides2027 });
  is('Illinois uses 2026 tables', il.basis, 'tables2026');
  const off = state2027({ slug: 'virginia', state2026: tax.states.virginia, taxData2027States: { virginia: { x: 1 } }, overrides: jp.stateOverrides2027 });
  is('tax-data-2027 state wins over the override', off.basis, 'taxData2027');
}

const ctxFor = (slug) => ({
  federal2026: tax.federal,
  federal2027: f27.federal,
  state2026: tax.states[slug],
  state2027: state2027({ slug, state2026: tax.states[slug], overrides: jp.stateOverrides2027 }).state,
  taxDataShell: { taxYear: 2026, filingStatuses: tax.filingStatuses },
});

// --- the no-change case ----------------------------------------------------------
// Texas (no income tax), same 401(k) and premium, and a YTD far below the cap, so
// December and January differ only by the federal table change. With the federal
// tables also held at 2026 the two paychecks must be identical to the cent.
{
  const input = { salary: 52000, payFrequency: 'biweekly', filingStatus: 'single', stateSlug: 'texas',
    k401Pct2026: 5, k401Pct2027: 5, premium2026: 80, premium2027: 80, ytd2026: 50000 };
  const same = compareDecJan(input, { ...ctxFor('texas'), federal2027: { ...tax.federal } });
  is('no change: take-home identical', same.change, 0);
  is('no change: every cause is $0', same.causes.every((c) => c.delta === 0), true);
  is('no change: Dec net equals Jan net', same.dec.net, same.jan.net);
  // Hand check of the December paycheck: gross 52,000/26 = 2,000.00; 401(k) 5% = 100.00;
  // premium 80.00; FICA wages 1,920.00 -> SS 119.04, Medicare 27.84.
  // Federal: (52,000 - 2,600 - 2,080 - 16,100) = 31,220 taxable; 10% x 12,400 + 12% x 18,820
  // = 1,240 + 2,258.40 = 3,498.40 a year, / 26 = 134.55.
  // Net = 2,000 - 100 - 80 - 134.55 - 119.04 - 27.84 = 1,538.57.
  is('no change: gross', same.dec.gross, 2000);
  is('no change: SS 6.2% of 1,920', same.dec.socialSecurity, 119.04);
  is('no change: Medicare 1.45% of 1,920', same.dec.medicare, 27.84);
  is('no change: federal withholding', same.dec.federal, 134.55);
  is('no change: take-home', same.dec.net, 1538.57);

  // The same person with the real 2027 tables: only the federal line moves, and only
  // because of the projected tables (std deduction 16,600, 10% band to 12,800).
  // 2027: taxable 52,000 - 2,600 - 2,080 - 16,600 = 30,720; 1,280 + 12% x 17,920 (2,150.40)
  // = 3,430.40 / 26 = 131.94, so January is 2.61 better.
  const r = compareDecJan(input, ctxFor('texas'));
  is('tables only: change', r.change, 2.61);
  is('tables only: biggest cause is the federal tables', r.causes[0].key, 'federalTables');
  is('tables only: SS cause is $0', r.causes.find((c) => c.key === 'socialSecurity').delta, 0);
}

// --- the Social Security cap-reset case ---------------------------------------
// $200,000, biweekly, single, Texas, 401(k) 6% both years, no premium, YTD left blank.
// Gross 7,692.31. Default YTD = 7,692.31 x 25 = 192,307.75, already past 184,500, so
// December has $0 Social Security. January: 6.2% x 7,692.31 = 476.92.
{
  const input = { salary: 200000, payFrequency: 'biweekly', filingStatus: 'single', stateSlug: 'texas',
    k401Pct2026: 6, k401Pct2027: 6, premium2026: 0, premium2027: 0, ytd2026: null };
  const r = compareDecJan(input, ctxFor('texas'));
  ok('cap: YTD was assumed', r.ytdAssumed);
  is('cap: assumed YTD', r.ytd, 192307.75);
  is('cap: December Social Security is $0', r.dec.socialSecurity, 0);
  is('cap: January Social Security restarts', r.jan.socialSecurity, 476.92);
  is('cap: biggest cause is the Social Security reset', r.causes[0].key, 'socialSecurity');
  // December's extra 0.9% Medicare: YTD + this check = 200,000.06, so 0.06 x 0.9% = 0.00.
  is('cap: SS cause = -476.92 on take-home', r.causes[0].delta, -476.92);
  is('cap: 401(k) cause is $0', r.causes.find((c) => c.key === 'retirement').delta, 0);
  ok('cap: causes sum to the whole change', Math.abs(r.causes.reduce((s, c) => s + c.delta, 0) - r.change) < 0.005);
  ok('cap: January is smaller', r.change < 0);

  // A partial December: YTD 180,000 leaves 4,500 under the cap -> 6.2% x 4,500 = 279.00.
  const p = compareDecJan({ ...input, ytd2026: 180000 }, ctxFor('texas'));
  is('cap crossed on the December check: partial SS', p.dec.socialSecurity, 279);
  ok('cap crossed on the December check: flagged', p.dec.ss.capHitOnThisCheck);

  // Way past $200,000 by December: the extra 0.9% Medicare is on the whole check in
  // December and gone in January. 300,000 YTD: 0.9% x 7,692.31 = 69.23.
  const m = compareDecJan({ ...input, ytd2026: 300000 }, ctxFor('texas'));
  is('extra Medicare on the December check', m.dec.medicareExtra, 69.23);
  is('extra Medicare gone in January', m.jan.medicareExtra, 0);
  is('SS cause carries the Medicare reset too', m.causes.find((c) => c.key === 'socialSecurity').lines.medicare, -69.23);
}

// --- the 401(k) change case -----------------------------------------------------
// $75,000 biweekly single Illinois, 401(k) 5% -> 8%, nothing else changes, YTD low.
// Gross 2,884.62. 401(k) 144.23 -> 230.77 (+86.54). Federal and Illinois tax both fall
// because the 401(k) comes off taxable pay, so take-home falls by LESS than 86.54.
{
  const input = { salary: 75000, payFrequency: 'biweekly', filingStatus: 'single', stateSlug: 'illinois',
    k401Pct2026: 5, k401Pct2027: 8, premium2026: 0, premium2027: 0, ytd2026: 60000 };
  const r = compareDecJan(input, { ...ctxFor('illinois'), federal2027: { ...tax.federal } });
  const k = r.causes.find((c) => c.key === 'retirement');
  is('401k: biggest cause', r.causes[0].key, 'retirement');
  is('401k: 401(k) line +86.54', k.lines.retirement, 86.54);
  ok('401k: federal tax falls', k.lines.federal < 0);
  ok('401k: state tax falls', k.lines.state < 0);
  ok('401k: take-home falls by less than the extra saving', k.delta < 0 && k.delta > -86.54);
  ok('401k: Social Security unchanged by a 401(k)', !('socialSecurity' in k.lines));
  // Federal: taxable 75,000 - 3,750 - 16,100 = 55,150 sits in the 22% band (12% ends at
  // 50,400 in 2026) and stays there after the extra 2,250/yr: 22% x 2,250 = 495 / 26 = 19.04.
  // Illinois 4.95% x 2,250 = 111.375 / 26 = 4.28. Take-home: -86.54 + 19.04 + 4.28 = -63.22.
  is('401k: federal saving', k.lines.federal, -19.04);
  is('401k: Illinois saving', k.lines.state, -4.28);
  is('401k: take-home change', k.delta, -63.22);
  is('401k: whole change = 401(k) step', r.change, -63.22);
}

// --- premium change and ranking -------------------------------------------------
{
  const input = { salary: 75000, payFrequency: 'semimonthly', filingStatus: 'married', stateSlug: 'texas',
    k401Pct2026: 5, k401Pct2027: 5, premium2026: 100, premium2027: 160, ytd2026: 60000 };
  const r = compareDecJan(input, { ...ctxFor('texas'), federal2027: { ...tax.federal } });
  const pr = r.causes.find((c) => c.key === 'premium');
  is('premium: line +60', pr.lines.premium, 60);
  ok('premium: lowers Social Security and Medicare too', pr.lines.socialSecurity < 0 && pr.lines.medicare < 0);
  is('premium ranks first', r.causes[0].key, 'premium');
  is('chain order exported', CAUSE_ORDER.join(), 'retirement,premium,federalTables,stateTables,socialSecurity,statePrograms');
}

// --- Virginia's 2027 deduction shows up as a state-table cause ------------------
{
  const input = { salary: 60000, payFrequency: 'monthly', filingStatus: 'single', stateSlug: 'virginia',
    k401Pct2026: 0, k401Pct2027: 0, premium2026: 0, premium2027: 0, ytd2026: 55000 };
  const r = compareDecJan(input, ctxFor('virginia'));
  // 450 more deduction x 5.75% = 25.875 a year / 12 = 2.16 less a month.
  is('Virginia: state-table cause', r.causes.find((c) => c.key === 'stateTables').lines.state, -2.16);
}

// --- North Carolina's 2027 rate cut (S.L. 2026-41: 3.99% -> 3.49%) ---------------
{
  const nc = state2027({ slug: 'north-carolina', state2026: tax.states['north-carolina'], overrides: jp.stateOverrides2027 });
  is('North Carolina gets its statutory 2027 rate', nc.state.tax.rate, 0.0349);
  is('North Carolina 2026 data not mutated', tax.states['north-carolina'].tax.rate, 0.0399);
  const input = { salary: 60000, payFrequency: 'monthly', filingStatus: 'single', stateSlug: 'north-carolina',
    k401Pct2026: 0, k401Pct2027: 0, premium2026: 0, premium2027: 0, ytd2026: 55000 };
  const r = compareDecJan(input, ctxFor('north-carolina'));
  // (60,000 - 12,750) x 0.5% = 236.25 a year / 12 = 19.69 less a month.
  is('North Carolina: state-table cause', r.causes.find((c) => c.key === 'stateTables').lines.state, -19.69);
}

// --- the page's worked example: the Social Security cause equals the table line --
// $200,000 biweekly single Texas, 401(k) 6% both years, premium 150 -> 165, YTD blank.
// January SS = 6.2% x (7,692.31 - 165) = 6.2% x 7,527.31 = 466.69. Because the reset is
// measured last, its amount is exactly that line, not 6.2% of December's premium.
{
  const r = compareDecJan({ salary: 200000, payFrequency: 'biweekly', filingStatus: 'single', stateSlug: 'texas',
    k401Pct2026: 6, k401Pct2027: 6, premium2026: 150, premium2027: 165, ytd2026: null }, ctxFor('texas'));
  const ssc = r.causes.find((c) => c.key === 'socialSecurity');
  is('example: January SS', r.jan.socialSecurity, 466.69);
  is('example: SS cause = -January SS line', ssc.delta, -466.69);
  is('example: assumed YTD = 25 x (7,692.31 - 150)', r.ytd, 188557.75);
  ok('example: causes sum to the change', Math.abs(r.causes.reduce((s, c) => s + c.delta, 0) - r.change) < 0.005);
}

// --- capped state payroll programs reset in January -------------------------------
const sumsTo = (r) => Math.abs(r.causes.reduce((s, c) => s + c.delta, 0) - r.change) < 0.005;
const prog = (pc, label) => pc.programs.find((p) => p.label === label).amount;
{
  // New York, $250,000 weekly, single, nothing else changes. Gross 250,000 / 52 = 4,807.69.
  // NY PFL 0.432% of 4,807.69 = 20.77 a week, capped at $411.91 a year. Before the last
  // December paycheck: 51 x 4,807.69 = 245,192.19 earned, 0.432% of that is far past
  // 411.91, so December's PFL is $0 and January's is 20.77. NY DBL is a weekly cap
  // (0.5%, at most $0.60 a week) and is $0.60 both weeks.
  const input = { salary: 250000, payFrequency: 'weekly', filingStatus: 'single', stateSlug: 'new-york',
    k401Pct2026: 0, k401Pct2027: 0, premium2026: 0, premium2027: 0, ytd2026: null };
  const r = compareDecJan(input, { ...ctxFor('new-york'), federal2027: { ...tax.federal } });
  is('NY: December PFL is $0', prog(r.dec, 'NY PFL'), 0);
  is('NY: January PFL', prog(r.jan, 'NY PFL'), 20.77);
  is('NY: DBL same both weeks (Dec)', prog(r.dec, 'NY DBL'), 0.6);
  is('NY: DBL same both weeks (Jan)', prog(r.jan, 'NY DBL'), 0.6);
  is('NY: December programs line', r.dec.statePrograms, 0.6);
  is('NY: January programs line', r.jan.statePrograms, 21.37);
  const c = r.causes.find((x) => x.key === 'statePrograms');
  is('NY: program-reset cause', c.delta, -20.77);
  ok('NY: reasons sum to the total', sumsTo(r));
  const d = describeCause(c, { input, fedMode: 'official', stateName: 'New York', stateHasIncomeTax: true, stateBasis: 'tables2026' });
  is('NY: cause title', d.title, 'State payroll program limits reset');
  ok('NY: names the program', d.text.includes('NY PFL') && d.text.includes('$20.77'));
}
{
  // New Jersey, $60,000 biweekly, single. Gross 2,307.69. UI 0.3825% (8.83) + WF 0.0425%
  // (0.98) = 9.81, both stopping at $44,800 of wages; 25 x 2,307.69 = 57,692.25 is past
  // that, so December has $0 of them. TDI (0.19%, 4.38) and FLI (0.23%, 5.31) stop at
  // $171,100 and are still being charged in December.
  const input = { salary: 60000, payFrequency: 'biweekly', filingStatus: 'single', stateSlug: 'new-jersey',
    k401Pct2026: 0, k401Pct2027: 0, premium2026: 0, premium2027: 0, ytd2026: null };
  const r = compareDecJan(input, { ...ctxFor('new-jersey'), federal2027: { ...tax.federal } });
  is('NJ: December UI', prog(r.dec, 'NJ UI'), 0);
  is('NJ: January UI', prog(r.jan, 'NJ UI'), 8.83);
  is('NJ: January WF', prog(r.jan, 'NJ WF/SWF'), 0.98);
  is('NJ: TDI unchanged', prog(r.dec, 'NJ TDI'), prog(r.jan, 'NJ TDI'));
  is('NJ: TDI amount', prog(r.jan, 'NJ TDI'), 4.38);
  const c = r.causes.find((x) => x.key === 'statePrograms');
  is('NJ: UI + WF reset = 9.81', c.delta, -9.81);
  is('NJ: whole change is the reset', r.change, -9.81);
  ok('NJ: reasons sum to the total', sumsTo(r));
  // Crossing the $44,800 limit on the December check: 800 left -> UI 3.06, WF 0.34.
  const p = compareDecJan({ ...input, ytd2026: 44000 }, { ...ctxFor('new-jersey'), federal2027: { ...tax.federal } });
  is('NJ: partial December UI', prog(p.dec, 'NJ UI'), 3.06);
  is('NJ: partial December WF', prog(p.dec, 'NJ WF/SWF'), 0.34);
  ok('NJ partial: reasons sum to the total', sumsTo(p));
}
{
  // An uncapped program (California SDI) is the same both months.
  const r = compareDecJan({ salary: 300000, payFrequency: 'semimonthly', filingStatus: 'single', stateSlug: 'california',
    k401Pct2026: 0, k401Pct2027: 0, ytd2026: null }, { ...ctxFor('california'), federal2027: { ...tax.federal } });
  is('CA SDI: no program reset', r.causes.find((x) => x.key === 'statePrograms').delta, 0);
  ok('CA: reasons sum to the total', sumsTo(r));
}

// --- input clamps and money formatting ------------------------------------------
{
  const base = { salary: 52000, payFrequency: 'biweekly', filingStatus: 'single', stateSlug: 'texas',
    premium2026: 0, premium2027: 0, ytd2026: 1000 };
  const hi = compareDecJan({ ...base, k401Pct2026: 75, k401Pct2027: 150 }, ctxFor('texas'));
  is('401(k) % clamps to 75', hi.jan.retirement, 1500);
  const neg = compareDecJan({ ...base, k401Pct2026: -5, k401Pct2027: 0 }, ctxFor('texas'));
  is('401(k) % clamps to 0', neg.dec.retirement, 0);
  is('negative money reads -$47.23', signedUsd(-47.23), '-$47.23');
  is('positive money reads +$47.23', signedUsd(47.23), '+$47.23');
}

// --- guards ------------------------------------------------------------------------
is('defaultYtd monthly 120k', defaultYtd({ salary: 120000, payFrequency: 'monthly', premium2026: 0 }), 110000);
throws('annual pay frequency refused', () => paycheckLines({ salary: 1, payFrequency: 'annual' }));
{
  const z = compareDecJan({ salary: 0, payFrequency: 'weekly', filingStatus: 'single', stateSlug: 'texas',
    k401Pct2026: 0, k401Pct2027: 0, ytd2026: null }, ctxFor('texas'));
  is('zero salary: no crash, zero take-home', z.jan.net, 0);
}

console.log(`\nJanuary paycheck diff engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
