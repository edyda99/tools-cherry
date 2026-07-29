// test-tax-data.js — regression guard for the 2026 tax-data table.
// Pins the federal figures (which drive every state page) and a sample of
// per-state results so a careless edit to tax-data-2026.json fails CI.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePaycheck } from '../src/engine/paycheck-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tax = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'tax-data-2026.json'), 'utf8'));

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  - ' + name); };
const approx = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);
const stateTax = (slug, amount, fs = 'single') =>
  computePaycheck({ wage: { type: 'salary', amount }, filingStatus: fs, payFrequency: 'annual', stateSlug: slug }, tax).annual.state;

// --- federal figures (IRS Rev. Proc. 2025-32 + SSA 2026), drive ALL pages ----
t('federal standard deduction 2026', () => {
  assert.equal(tax.federal.standardDeduction.single, 16100);
  assert.equal(tax.federal.standardDeduction.married, 32200);
  assert.equal(tax.federal.standardDeduction.head_of_household, 24150);
});
t('federal single bracket thresholds 2026', () => {
  const b = tax.federal.brackets.single.map((x) => x.upTo);
  assert.deepEqual(b, [12400, 50400, 105700, 201775, 256225, 640600, null]);
});
t('federal Social Security wage base 2026 = 184500', () =>
  assert.equal(tax.federal.fica.socialSecurity.wageBase, 184500));

// --- coverage: all 50 states + DC present and structurally sound -------------
t('51 jurisdictions present', () => assert.equal(Object.keys(tax.states).length, 51));
t('every state: slug matches key, valid bracket shape, decimal rates', () => {
  for (const [slug, s] of Object.entries(tax.states)) {
    assert.equal(s.slug, slug, `${slug} slug mismatch`);
    assert.ok(s.name && s.abbr, `${slug} missing name/abbr`);
    if (s.hasIncomeTax && s.tax.type === 'bracket') {
      for (const fs of ['single', 'married', 'head_of_household']) {
        const bands = s.tax.brackets[fs];
        assert.ok(Array.isArray(bands) && bands.length, `${slug}.${fs} missing brackets`);
        let prev = -1;
        bands.forEach((x, i) => {
          assert.ok(x.rate >= 0 && x.rate < 1, `${slug}.${fs} rate ${x.rate} not a decimal`);
          if (i === bands.length - 1) assert.equal(x.upTo, null, `${slug}.${fs} last band must be null`);
          const up = x.upTo === null ? Infinity : x.upTo;
          assert.ok(up > prev, `${slug}.${fs} non-ascending threshold`);
          prev = up;
        });
      }
    }
    if (s.hasIncomeTax && s.tax.type === 'flat') assert.ok(s.tax.rate >= 0 && s.tax.rate < 1, `${slug} flat rate ${s.tax.rate}`);
  }
});

// --- pinned per-state results ($75k single, annual state tax) ----------------
t('New York $75k single ≈ $3,453', () => approx(stateTax('new-york', 75000), 3453, 1));
t('Delaware $75k single = $3,719.00', () => approx(stateTax('delaware', 75000), 3719.0));
t('New Mexico $75k single = $2,359.30', () => approx(stateTax('new-mexico', 75000), 2359.30, 0.05));
t('Utah $75k single = $2,621.05 (flat 4.45%)', () => approx(stateTax('utah', 75000), 2621.05, 0.05));
t('Texas has no state income tax', () => assert.equal(stateTax('texas', 75000), 0));

// --- prior-year fallback states are labeled (figureYear 2025, not 2026) ------
// Nebraska moved to official 2026 figures (1040N-ES, Rev. 11-2025) on 2026-07-21.
// Oklahoma moved to 2026 on 2026-07-29: HB2764 (approved 2025-05-28) supplies the
// statutory schedule and OTC Packet OW-2 Rev 11-2025 corroborates it, so the old
// "not published in verifiable form yet" premise was simply false.
// 2026-07-30: arizona and district-of-columbia joined california on prior-year figures, both
// deliberately. Arizona's shipped 8350/16700/16700 matched no published year and collapsed
// head-of-household onto married; DC shipped the FEDERAL amounts while D.C. Code 47-1801.04(3A)
// decouples. In both cases the correct 2026 figure is unpublished, so the 2025 statutory amount
// is the honest floor.
//
// This test used to assert the fallback list was exactly ['california']. That only caught a
// CHANGE in the list, not the thing that actually harms a reader: a state quietly sitting on
// prior-year figures without telling anyone. So it now asserts both, and the second assertion
// is the one with teeth.
// idaho joined 2026-07-30: its zero-rate thresholds (4,811 single / 9,622 joint and HoH) are the
// 2025 CPI-indexed amounts. Idaho Code 63-3024(3) re-indexes annually and the published series
// moves about 3% a year, so a 2026 figure exists but the Tax Commission had not published its 2026
// schedule. The record claimed figureYear 2026 while shipping 2025 thresholds.
const EXPECTED_FALLBACKS = ['arizona', 'california', 'district-of-columbia', 'idaho'];

t('every prior-year state is expected AND discloses it to the reader', () => {
  for (const s of ['nebraska', 'oklahoma']) {
    assert.equal(tax.states[s].figureYear, 2026, `${s} should carry official 2026 figures`);
  }
  const fallbacks = Object.entries(tax.states)
    .filter(([, s]) => s.figureYear && s.figureYear !== 2026)
    .map(([slug]) => slug)
    .sort();
  assert.deepEqual(
    fallbacks, EXPECTED_FALLBACKS,
    'the set of prior-year states changed. If that is intended, update EXPECTED_FALLBACKS and ' +
    'make sure the new state discloses the prior year in its disclaimer.',
  );
  // The assertion that matters: a fallback the reader is not told about is the defect. Every
  // one of these renders its disclaimer on the live page, so require the year to appear there.
  for (const slug of fallbacks) {
    const st = tax.states[slug];
    const year = String(st.figureYear);
    // figureYearScope decides which sentence the on-page banner prints. Without it the banner
    // defaults to claiming the BRACKETS are prior-year, which was false for arizona and DC
    // (their rates are current, only the standard deduction lags). A fallback state with no
    // scope therefore publishes a false statement, so require it explicitly.
    assert.ok(
      ['brackets', 'standardDeduction'].includes(st.figureYearScope),
      `${slug} is on ${year} figures but has no valid figureYearScope. The banner would then ` +
      'claim its brackets are prior-year, which may be false. Set "brackets" or "standardDeduction".',
    );
    // Only disclaimer and notes count. `_source` is removed by stripInternal() before
    // dist/data/tax-data-2026.json is published, so a year disclosed ONLY there is invisible to
    // anyone consuming the feed. Idaho shipped exactly that on 2026-07-30 and this test passed it,
    // which is why the accepted fields are now narrowed to the published ones.
    const prose = [].concat(st.disclaimer || [], st.notes || '').join(' ');
    assert.ok(
      prose.includes(year),
      `${slug} is on ${year} figures but says so only in _source, which is stripped from the ` +
      'published JSON. Put the year in disclaimer or notes so feed consumers see it too.',
    );
  }
});

// --- head-of-household ladders, the defect class a single-filer sweep cannot see ---
// Five states shipped HoH thresholds copied from the SINGLE column when the statute puts head of
// household on the MARRIED ladder (or gives it its own). Every one computed a correct single-filer
// figure, so nothing caught them: a 2026-07-29 coverage scan found these states in ZERO test files,
// which means ten money corrections would have gone equally green had they been wrong. These pins
// are per-status on purpose.
t('head-of-household ladders are not the single ladder', () => {
  const b = (slug) => tax.states[slug].tax.brackets;
  // idaho: 63-3024(2)(b) treats a HoH return as a joint return, so HoH == married exactly.
  assert.deepEqual(b('idaho').head_of_household, b('idaho').married, 'idaho HoH must equal married');
  assert.equal(b('idaho').head_of_household[0].upTo, 9622, 'idaho HoH zero-band');
  assert.equal(b('idaho').single[0].upTo, 4811, 'idaho single zero-band (half of HoH)');
  // new-mexico: NMSA 7-2-7 puts HoH on the married table.
  assert.deepEqual(b('new-mexico').head_of_household, b('new-mexico').married, 'NM HoH must equal married');
  // vermont and north-dakota publish a DISTINCT HoH ladder, between single and married.
  for (const slug of ['vermont', 'north-dakota']) {
    const hoh = b(slug).head_of_household[0].upTo;
    assert.ok(hoh > b(slug).single[0].upTo, `${slug} HoH first threshold must exceed single`);
    assert.ok(hoh < b(slug).married[0].upTo, `${slug} HoH first threshold must be below married`);
  }
  assert.equal(b('vermont').head_of_household[0].upTo, 68000, 'vermont HoH first threshold');
  assert.equal(b('north-dakota').head_of_household[0].upTo, 66400, 'north-dakota HoH first threshold');
  // montana: HoH is 1.5x single, distinct from both.
  assert.equal(b('montana').head_of_household[0].upTo, 71250, 'montana HoH threshold');
  assert.equal(b('montana').single[0].upTo, 47500, 'montana single threshold');
});

// --- the rate cuts corrected 2026-07-29, none of which had a pin ------------
t('west-virginia and arkansas carry their post-cut 2026 rates', () => {
  const wv = tax.states['west-virginia'].tax.brackets.single.map((r) => r.rate);
  assert.deepEqual(wv, [0.0211, 0.0281, 0.0316, 0.0422, 0.0458], 'WV SB 392 rates');
  const ar = tax.states.arkansas.tax.brackets.single;
  assert.equal(ar[ar.length - 1].rate, 0.037, 'arkansas top rate after Act 1 of 2026');
});

// --- arizona and DC standard deductions corrected 2026-07-30 ----------------
t('arizona and DC standard deductions are their own, not federal', () => {
  assert.deepEqual(tax.states.arizona.tax.standardDeduction,
    { single: 15750, married: 31500, head_of_household: 23625 }, 'arizona 2025 published amounts');
  assert.deepEqual(tax.states['district-of-columbia'].tax.standardDeduction,
    { single: 15000, married: 30000, head_of_household: 22500 }, 'DC decoupled amounts');
  // The federal set must NOT reappear in either: that was the original defect for DC.
  const fed = tax.federal.standardDeduction;
  for (const slug of ['arizona', 'district-of-columbia']) {
    assert.notDeepEqual(tax.states[slug].tax.standardDeduction, fed, `${slug} must not use federal`);
  }
  // arizona previously collapsed HoH onto married. Under every candidate HoH sits strictly between.
  const az = tax.states.arizona.tax.standardDeduction;
  assert.ok(az.head_of_household > az.single && az.head_of_household < az.married,
    'arizona HoH must sit strictly between single and married');
});

// --- Oklahoma 2026, HB2764 -------------------------------------------------
// Guards the specific wrong numbers this repo published: a six-bracket
// 0.25%-4.75% schedule (repealed, applied only to 2024 and 2025) and a
// think-tank claim of "three brackets, 0.50% to 4.50%". 0.50% has never been an
// Oklahoma rate in any year.
t('Oklahoma 2026 is four bands at 0/2.5/3.5/4.5 percent', () => {
  const b = tax.states.oklahoma.tax.brackets;
  assert.equal(b.single.length, 4, 'single should have four bands');
  assert.deepEqual(b.single.map((r) => r.rate), [0, 0.025, 0.035, 0.045]);
  assert.deepEqual(b.single.map((r) => r.upTo), [3750, 4900, 7200, null]);
  assert.deepEqual(b.married.map((r) => r.upTo), [7500, 9800, 14400, null]);
  assert.deepEqual(b.head_of_household, b.married, 'HoH shares the married schedule');
  const rates = JSON.stringify(b);
  assert.ok(!rates.includes('0.005'), '0.50% is not an Oklahoma rate in any year');
  assert.ok(!rates.includes('0.0475'), '4.75% applied only to 2024 and 2025');
});

// --- baseAmount: the opt-in flat step, Ohio only -----------------------------
// ORC 5747.02(A)(3)(c): "For taxable years beginning in 2026 and thereafter,
// $332.00 plus 2.75% of the amount in excess of $26,050." A marginal bracket
// table cannot express that step, so it lives in its own field. These tests
// exist so nobody re-derives it from the withholding tables, which are an
// administrative approximation and print entirely different numbers.
t('Ohio 2026 carries the statutory $332 base over $26,050', () => {
  const b = tax.states.ohio.tax.baseAmount;
  assert.ok(b, 'ohio.tax.baseAmount is missing');
  assert.equal(b.over, 26050);
  assert.equal(b.amount, 332.0);
});

t('baseAmount is opt-in: Ohio is the only state that carries it', () => {
  const carriers = Object.entries(tax.states)
    .filter(([, s]) => s.tax && s.tax.baseAmount)
    .map(([slug]) => slug);
  assert.deepEqual(carriers, ['ohio']);
});

t('every baseAmount is well formed and sits on a bracket state', () => {
  let checked = 0;
  for (const [slug, s] of Object.entries(tax.states)) {
    const b = s.tax && s.tax.baseAmount;
    if (!b) continue;
    checked++;
    assert.equal(s.tax.type, 'bracket', `${slug}: baseAmount needs a bracket schedule`);
    assert.ok(b.over > 0 && b.amount > 0, `${slug}: over and amount must be positive`);
    const zeroBand = s.tax.brackets.single.find((r) => r.rate === 0);
    assert.ok(zeroBand && zeroBand.upTo === b.over,
      `${slug}: baseAmount.over must equal the top of the 0% band`);
  }
  assert.ok(checked > 0, 'measured nothing, refusing to pass');
});

t('Ohio steps at the threshold, strictly above it', () => {
  assert.equal(stateTax('ohio', 26050), 0);
  approx(stateTax('ohio', 26051), 332.03, 0.01);
  approx(stateTax('ohio', 75000), 1678.13, 0.01);
});

console.log(`\n${pass} passing`);
