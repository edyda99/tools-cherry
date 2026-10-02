// test-tax-data.js — regression guard for the 2026 tax-data table.
// Pins the federal figures (which drive every state page) and a sample of
// per-state results so a careless edit to tax-data-2026.json fails CI.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePaycheck, stateIncomeTax, phaseOutStandardDeduction, federalTaxSubtraction } from '../src/engine/paycheck-engine.js';

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
// vermont joined 2026-07-30, LAST, and it was the guard's own blind spot. Its brackets were
// corrected to genuine 2026 indexed thresholds but its standard deduction is the TY2025 amount, and
// when it shipped there was no figureYearScope field, so moving figureYear would have mislabelled
// the brackets. A verification pass caught that it was serving 2025 figures under figureYear 2026,
// invisible to this very test.
// maryland joined 2026-07-31 after the $3,400 question was reopened and settled the other way. The
// Budget Reconciliation and Financing Act of 2025 really did repeal the old 15%-of-AGI structure,
// but that never mattered to the answer: the flat statute it left behind gives $3,350 to a single
// filer and $6,700 to a joint one, while the 2026 withholding guide prints ONE $3,400 for every
// filing status. A status-blind figure cannot be a status-differentiated statutory amount. So the
// $3,350/$6,700 stay, and what was actually wrong was the label: they are the TY2025 figures and
// the record claimed figureYear 2026. Maryland's cost-of-living adjustment first applies to tax
// years after 2025 and the 2026 amount has not been announced.
// district-of-columbia LEFT 2026-10-02: the FY2027 Budget Support Acts (D.C. Act 26-416 in force,
// 26-418 pending) set the 2025-2029 basic standard deduction with a cost-of-living base year of
// 2025, so the 2026 amount is the same $15,000 / $30,000 / $22,500 by law, not a prior-year floor.
const EXPECTED_FALLBACKS = ['arizona', 'california', 'idaho', 'maryland', 'vermont'];

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

// Pins the number the withholding guide keeps trying to pull us to. $3,400 is the percentage-method
// input an employer uses, printed once for every filing status; the statute is status-differentiated
// and says $3,350 / $6,700. Two separate proposals have tried to publish $3,400 as the single-filer
// amount, so the value is pinned here with the reason attached rather than left to a code comment.
t('Maryland standard deduction is the statutory 3350/6700, not the withholding 3400', () => {
  const sd = tax.states.maryland.tax.standardDeduction;
  assert.deepEqual(sd, { single: 3350, married: 6700, head_of_household: 6700 });
  assert.notEqual(sd.single, 3400,
    '3400 is the 2026 withholding percentage-method figure, printed status-blind for every filer. ' +
    'Md. Tax-General 10-217 gives 3350 single and 6700 joint, so one figure cannot be both.');
  // The old 15%-of-AGI structure is genuinely repealed. Nothing in Maryland's reader-facing copy
  // may describe it, or we would be explaining a rule that no longer exists.
  const prose = [tax.states.maryland._source, ...(tax.states.maryland.disclaimer || []),
    tax.states.maryland.notes || ''].join(' ');
  assert.ok(!/15%\s*of\s*(the\s*)?(individual'?s\s*)?Maryland adjusted gross/i.test(prose)
    || /repealed/i.test(prose),
    'Maryland copy may only mention the 15%-of-AGI rule to say it was repealed.');
});

// --- South Carolina SCIAD phase-down, S.C. Code 12-6-1140(15)(b)-(c) --------
// Act 110 of 2026 replaced the federal standard deduction with an income-tested one. Two details
// in the statute are easy to invert and both change the answer, so both are pinned:
//   (c) rounds the REDUCTION down to a multiple of ten, NOT the resulting deduction. At single
//       AGI 40,100 the statute gives reduction 20 and deduction 14,980; rounding the deduction
//       instead yields 14,970, a $10 error in the wrong direction. That case is the tripwire.
//   (b)(iv) the deduction is "not allowed" once the fraction reaches one, so the phase-out
//       completes exactly at over + denominator: 95,000 / 142,500 / 190,000.
// Every expected value below was derived from the enacted bill text and independently reproduced by
// two reviewers before being written here. NOTE the codified S.C. Code page is stale and still ends
// 12-6-1140 at item (14); the enacted act text governs.
t('South Carolina SCIAD phases down, rounding the reduction not the deduction', () => {
  const cases = [
    [35000, 'single', 398.00, 'below the phase-down, full 15,000 deduction'],
    [40100, 'single', 499.89, 'ROUNDING TRIPWIRE: reduction floors to 20, deduction 14,980'],
    [60000, 'single', 1662.44, 'mid-range, deduction 9,550'],
    [75000, 'single', 2657.03, 'headline case, deduction 5,460'],
    [95000, 'single', 3983.50, 'boundary: fully phased out, deduction 0'],
    [100000, 'head_of_household', 3639.64, 'exercises the 60,000/82,500 row'],
    [142500, 'head_of_household', 6458.25, 'HoH boundary, deduction 0'],
    [120000, 'married', 4290.89, 'exercises the 80,000/110,000 row'],
    [190000, 'married', 8933.00, 'MFJ boundary, deduction 0'],
  ];
  for (const [gross, fs, want, why] of cases) {
    approx(stateTax('south-carolina', gross, fs), want, 0.02);
  }
  // The deduction must never be negative, and must be exactly zero past the boundary rather than
  // going negative and adding tax back.
  for (const gross of [200000, 500000]) {
    const atBoundary = stateTax('south-carolina', 190000, 'married');
    assert.ok(stateTax('south-carolina', gross, 'married') > atBoundary,
      'past the boundary tax must keep rising, not jump from a negative deduction');
  }
  // Structural: the phase-down is opt-in, so a stray copy into a state that does not have one
  // would silently change that state's tax. The allow-list is therefore closed, not open-ended.
  // 2026-08-02: Wisconsin joined. Its sliding-scale standard deduction (Wis. Stat. 71.05(22)(dp),
  // published as the "2026 Standard Deduction" schedules in WI DOR Form 1-ES instructions, D-101A
  // R. 1-26) is the same shape of rule, so it reuses this mechanism rather than growing a second
  // one. Wisconsin's own parameters are pinned in the dedicated test below; what this list guards
  // is that no THIRD state acquires a phase-down by accident.
  // 2026-10-02: Alabama joined, with the stepped-to-a-floor row shape (Ala. Code 40-18-15(b)(4));
  // its parameters are pinned in the federal-tax-subtraction block at the end of this file.
  const users = Object.entries(tax.states)
    .filter(([, s]) => s.tax && s.tax.standardDeductionPhaseout)
    .map(([slug]) => slug)
    .sort();
  assert.deepEqual(users, ['alabama', 'south-carolina', 'wisconsin'],
    'standardDeductionPhaseout is Alabama + South Carolina + Wisconsin only');
  const cfg = tax.states['south-carolina'].tax.standardDeductionPhaseout;
  assert.equal(cfg.roundReductionDownTo, 10, 'statute rounds to ten dollars');
  assert.deepEqual(cfg.single, { over: 40000, denominator: 55000 });
  assert.deepEqual(cfg.head_of_household, { over: 60000, denominator: 82500 });
  assert.deepEqual(cfg.married, { over: 80000, denominator: 110000 });
});

// The reduction has to be computed with ONE division, at the end. Working out the fraction first
// and multiplying by the base rounds twice, and the second rounding lands a hair under a ten-dollar
// boundary often enough to matter: 22500 * (2970/82500) is 809.9999999999999 in IEEE-754, so the
// floor drops a whole step and the filer keeps $10 of deduction the statute does not allow. It only
// bites head-of-household, at 45 separate incomes between 62,970 and 118,080, which is exactly why
// the nine cases above all passed while the bug was live. This sweep is the guard: BigInt is exact,
// so it decides the right answer without borrowing the engine's arithmetic.
t('South Carolina SCIAD reduction survives the floating-point boundary', () => {
  const cfg = tax.states['south-carolina'].tax.standardDeductionPhaseout;
  const bases = { single: 15000, head_of_household: 22500, married: 30000 };
  const step = BigInt(cfg.roundReductionDownTo);
  const sc = tax.states['south-carolina'];
  // SC is two flat bands, 1.99% up to 30,000 then 5.21%, so the deduction is recoverable from the
  // tax. Both bands matter: at the bottom of each phase-down the taxable income is still under
  // 30,000, and inverting with the top rate alone would misread every one of those.
  const deductionFromTax = (gross, taxDue) => {
    const firstBand = 30000 * 0.0199;
    const taxable = taxDue <= firstBand ? taxDue / 0.0199 : 30000 + (taxDue - firstBand) / 0.0521;
    return gross - taxable;
  };
  let checked = 0;
  for (const [fs, base] of Object.entries(bases)) {
    const { over, denominator } = cfg[fs];
    for (let agi = over; agi < over + denominator; agi += 1) {
      const exact = Number((BigInt(base) * BigInt(agi - over)) / (BigInt(denominator) * step)) * Number(step);
      const want = base - exact;
      const got = deductionFromTax(agi, stateIncomeTax(agi, fs, sc));
      assert.ok(Math.abs(got - want) < 0.01,
        `${fs} AGI ${agi}: deduction ${got.toFixed(2)}, statute says ${want}`);
      checked++;
    }
  }
  assert.ok(checked > 240000, `sweep should cover every AGI in all three phase-downs, covered ${checked}`);
  // The three that used to be wrong, named, so a regression says which case broke.
  approx(stateTax('south-carolina', 62970, 'head_of_household'), 1184.69, 0.02);
  approx(stateTax('south-carolina', 85300, 'head_of_household'), 2665.37, 0.02);
  approx(stateTax('south-carolina', 110600, 'head_of_household'), 4342.99, 0.02);
});

// --- Wisconsin sliding-scale standard deduction, Wis. Stat. 71.05(22)(dp) ---
// Wisconsin has no flat standard deduction: it starts at a maximum and slides to zero. Until
// 2026-08-02 this repo modelled NO Wisconsin standard deduction at all, so every Wisconsin
// estimate was computed on the full wage and ran high (a $75,000 single filer was overtaxed by
// about $391 a year). The numbers below are the 2026 Standard Deduction schedules printed in the
// WI DOR 2026 Form 1-ES instructions (D-101A, R. 1-26), quoted exactly:
//   Single            $13,960 to $20,119, then "13,960 less 12% of the amount over 20,120", 0 at 136,453
//   Married jointly   $25,840 to $29,039, then "25,840 less 19.778% of the amount over 29,040", 0 at 159,690
//   Head of household $18,030 to $20,119, then "18,030 less 22.515% over 20,120" to 58,827,
//                     then it JOINS the single line, "13,960 less 12% over 20,120", 0 at 136,453
// denominator = base / percentage, so it is the income span over which the deduction reaches zero:
//   13,960 / 0.12     = 116,333.33 -> 20,120 + 116,333.33 = 136,453  (matches DOR)
//   25,840 / 0.19778  = 130,650.22 -> 29,040 + 130,650.22 = 159,690  (matches DOR)
// Head of household deliberately reuses the SINGLE row. The engine's phase-down is one straight
// line and the HoH schedule bends twice, so the exact rule is not expressible here; the single row
// is the second (and longer) of its two segments. That understates the HoH deduction below $58,827
// and the state's disclaimer says so, which is why the assertion below pins HoH == single ON
// PURPOSE rather than pinning 18,030 / 22.515%.
t('Wisconsin sliding-scale standard deduction matches WI DOR D-101A', () => {
  const wi = tax.states.wisconsin.tax;
  assert.deepEqual(wi.standardDeduction, { single: 13960, married: 25840, head_of_household: 13960 });
  const cfg = wi.standardDeductionPhaseout;
  // South Carolina's statute floors the reduction to a multiple of ten. Wisconsin's does not, and
  // borrowing SC's rounding would shift every Wisconsin answer, so its absence is load-bearing.
  assert.equal(cfg.roundReductionDownTo, undefined,
    'Wisconsin has no ten-dollar rounding rule; do not copy South Carolina\'s');
  assert.equal(cfg.single.over, 20120);
  assert.equal(cfg.married.over, 29040);
  assert.deepEqual(cfg.head_of_household, cfg.single, 'HoH follows the single row by design');
  // Recover the published percentage from the denominator, and the published zero-out income.
  approx(13960 / cfg.single.denominator, 0.12, 1e-9);
  approx(25840 / cfg.married.denominator, 0.19778, 1e-9);
  approx(cfg.single.over + cfg.single.denominator, 136453, 0.5);
  approx(cfg.married.over + cfg.married.denominator, 159690, 0.5);
  // End to end, against the schedule itself. The engine floors the reduction to whole dollars, so
  // it may sit up to $1 above the un-rounded schedule figure and never below it.
  const sched = (base, pct, over, agi) => (agi <= over - 1 ? base : Math.max(0, base - pct * (agi - over)));
  const cases = [
    ['single', 13960, 0.12, 20120, [20119, 25000, 50000, 75000, 100000, 136453, 200000]],
    ['married', 25840, 0.19778, 29040, [29039, 50000, 100000, 159690, 250000]],
  ];
  for (const [fs, base, pct, over, incomes] of cases) {
    for (const agi of incomes) {
      const want = sched(base, pct, over, agi);
      const taxable = agi - want;
      const bands = tax.states.wisconsin.tax.brackets[fs === 'married' ? 'married' : 'single'];
      let expectedTax = 0, prev = 0;
      for (const b of bands) {
        const up = b.upTo === null ? Infinity : b.upTo;
        if (taxable > prev) expectedTax += (Math.min(taxable, up) - prev) * b.rate;
        prev = up;
        if (taxable <= up) break;
      }
      const actual = stateTax('wisconsin', agi, fs);
      // A $1 deduction difference is at most 5.3 cents of tax.
      assert.ok(Math.abs(actual - expectedTax) <= 0.06,
        `wisconsin ${fs} ${agi}: engine ${actual.toFixed(2)}, D-101A schedule ${expectedTax.toFixed(2)}`);
    }
  }
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

// --- steppedRecapture: the opt-in stepped add-back, Connecticut only ----------
// Conn. Gen. Stat. 12-700(a)(10), subparagraphs (A)(ii) unmarried, (B)(ii) head of household,
// (C)(ii) married filing jointly: once Connecticut AGI passes a threshold, income is pushed
// out of the 2% band into the 4.5% band "for each five thousand dollars, or fraction thereof".
// The 2.5-point difference turns that into a flat dollar step, which a marginal bracket table
// cannot express, so it lives in its own field. DRS IP 2026(7) page 9 prints the same thing as
// "Table C - 2% Tax Rate Phase-Out Add-Back" and is what these numbers are checked against.
// THE PUBLISHED TABLE, TRANSCRIBED. Every number below is a LITERAL read off the printed
// "Table C - 2% Tax Rate Phase-Out Add-Back", not a value computed from tax-data-2026.json,
// and that is the whole point of the file: nothing here may be derived from the data under
// test, or a silent edit to the data would move the expectation with it and pass.
//
// SOURCE, READ 2026-08-02. The table is in the attachment "TPG-211, 2026 Withholding
// Calculation Rules (Rev. 12/25)" carried by CT DRS Informational Publication 2026(1),
// "Connecticut Employer's Tax Guide, Circular CT",
// https://portal.ct.gov/-/media/drs/publications/pubsip/2026/ip-2026-1.pdf (fetched live).
// Heads up for whoever revises this: the tax-data entries cite the same table as "IP
// 2026(7) page 9", and portal.ct.gov/-/media/drs/publications/pubsip/2026/ip-2026-7.pdf
// returns 404, and IP 2026(7) is the separate "Is My Connecticut Withholding Correct?".
// The FIGURES below were confirmed against IP 2026(1) either way, so they stand; it is the
// publication number in the citations that is unresolved.
//
// The statute behind it is Conn. Gen. Stat. 12-700(a)(10): (A)(ii) unmarried, (B)(ii) head
// of household, (C)(ii) married filing jointly, (D)(ii) married filing separately.
//
// capReachedAt is the income printed on the table's "and up" row, transcribed, not computed,
// precisely so that a wrong `step` or a wrong `max` in the data cannot hide behind a matching
// arithmetic.
//
// ONE DOLLAR OF CONVENTION, AND IT IS DELIBERATE. Table C prints half-open withholding rows,
// "at least $56,500 but less than $61,500", so the printed "and up" row is where the LAST rung
// begins: over + (rungs - 1) x step. The statute is written the other way round, "for each
// five thousand dollars, or fraction thereof, by which the taxpayer's Connecticut adjusted
// gross income EXCEEDS said amount", so a filer sitting exactly on a printed boundary has not
// yet exceeded it and is one rung lower. The engine follows the statute, because this is a
// return-time estimate and the withholding table is an approximation of it. The assertions
// below pin BOTH: the printed income yields max - amountPerStep, and one dollar past it
// yields max. Anything that moves either boundary breaks the test.
const TABLE_C = [
  { label: 'Code F, single', fs: 'single', over: 56500, step: 5000, amountPerStep: 25, max: 250, capReachedAt: 101500 },
  { label: 'Code B, head of household', fs: 'head_of_household', over: 78500, step: 4000, amountPerStep: 40, max: 400, capReachedAt: 114500 },
  { label: 'Code C, married filing jointly', fs: 'married', over: 100500, step: 5000, amountPerStep: 50, max: 500, capReachedAt: 145500 }
];
// Code A, MARRIED FILING SEPARATELY: over $50,250, $25 for each $2,500, max $250, "$72,750
// and up". Deliberately NOT in the list above, because it is not in the data either: this
// site's filing input offers single / married filing jointly / head of household, and folds
// a separate filer into the single bucket. A fourth ladder with no filing status able to
// select it would be dead weight that reads as coverage. Connecticut's disclaimer carries
// the gap in words instead, telling a separate filer their real tax can run up to about
// $150 higher (this ladder against the single one, worst case, at $72,750 of income).
//
// Code A is also the reason the single row above must be Code F. Table A settles it by
// personal exemption: Code A carries $12,000, the 12-702 married-filing-separately amount,
// and Code F carries $15,000, the unmarried amount. Reading Code A as "single" would start
// the ladder at $50,250 on $2,500 rungs and overcharge a $75,000 single filer by $150.

t('Connecticut carries the statutory 2% phase-out ladder for all three statuses', () => {
  const ladders = tax.states.connecticut.tax.steppedRecapture;
  assert.ok(Array.isArray(ladders) && ladders.length === 1, 'connecticut needs exactly one ladder');
  const l = ladders[0];
  // The data must equal the transcription, field for field, with nothing extra.
  for (const row of TABLE_C) {
    assert.deepEqual(l[row.fs], {
      over: row.over, step: row.step, amountPerStep: row.amountPerStep, max: row.max
    }, `${row.label}: does not match the printed Table C`);
  }
  assert.deepEqual(
    Object.keys(l).filter((k) => !k.startsWith('_') && k !== 'label').sort(),
    ['head_of_household', 'married', 'single'],
    'the ladder must encode exactly the three statuses this site can select'
  );
  // Two consistency checks on the TRANSCRIPTION itself, both literal-against-literal, so
  // they catch a typo in the table above rather than blessing the data. The ceiling is the
  // 2% band emptied once, so it is a whole number of rungs, and the "and up" income is the
  // income at which that last rung lands.
  for (const row of TABLE_C) {
    const rungsToCap = row.max / row.amountPerStep;
    assert.equal(rungsToCap, Math.round(rungsToCap), `${row.label}: cap is not a whole number of rungs`);
    assert.equal(row.capReachedAt, row.over + (rungsToCap - 1) * row.step,
      `${row.label}: the printed "and up" income does not start the last rung`);
  }
});

// Row-for-row against the published table. This is the check that would have caught a wrong
// Withholding Code column, a floor instead of a ceiling on the rung count, or a missing cap.
// The add-back is isolated by differencing Connecticut against a copy of itself with the
// ladder removed, so the bracket schedule cancels and only Table C is under test.
const ctNoLadder = JSON.parse(JSON.stringify(tax.states.connecticut));
delete ctNoLadder.tax.steppedRecapture;
const addBack = (fs, income) =>
  stateIncomeTax(income, fs, tax.states.connecticut) - stateIncomeTax(income, fs, ctNoLadder);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.001, `${msg}: ${a} !~= ${b}`);

t('Connecticut reproduces every row of the printed Table C', () => {
  let checked = 0;
  for (const { label, fs, over, step, amountPerStep: per, max, capReachedAt } of TABLE_C) {
    // At or below the threshold Table C prints $0.
    near(addBack(fs, over), 0, `${label}: threshold row must be 0`);
    checked++;
    // Rows 1..N, where N is taken from the printed cap and per-step amount, NOT from the
    // data. The whole of row n is (over + (n-1)*step, over + n*step] and prints min(n*per,
    // max), because "or fraction thereof" makes any part of a rung a whole rung.
    const rows = max / per;
    for (let n = 1; n <= rows; n++) {
      const lo = over + (n - 1) * step;
      const hi = over + n * step;
      const expect = Math.min(n * per, max);
      near(addBack(fs, lo + 1), expect, `${label}: row ${n} low end`);
      near(addBack(fs, hi), expect, `${label}: row ${n} high end`);
      checked += 2;
    }
    // The "and up" row, pinned at the income the table actually prints for it, on both
    // sides of the statute's "exceeds". A wrong step or a wrong ceiling in the data shows
    // up here as the cap arriving early or late.
    near(addBack(fs, capReachedAt), max - per, `${label}: printed and-up income ${capReachedAt} is one rung short under "exceeds"`);
    near(addBack(fs, capReachedAt + 1), max, `${label}: cap must be reached one dollar past ${capReachedAt}`);
    // Once the 2% band is empty, more income adds nothing, forever.
    near(addBack(fs, capReachedAt + 500000), max, `${label}: and-up row`);
    checked += 3;
  }
  assert.equal(checked, 72, 'measured the wrong number of Table C rows');
});

t('steppedRecapture is opt-in: Connecticut is the only state that carries it', () => {
  const carriers = Object.entries(tax.states)
    .filter(([, s]) => s.tax && s.tax.steppedRecapture)
    .map(([slug]) => slug)
    .sort();
  assert.deepEqual(carriers, ['connecticut'],
    'steppedRecapture is Connecticut only; a stray copy would silently raise another state');
});

t('every steppedRecapture ladder is well formed', () => {
  let checked = 0;
  for (const [slug, s] of Object.entries(tax.states)) {
    const ladders = s.tax && s.tax.steppedRecapture;
    if (!ladders) continue;
    assert.ok(Array.isArray(ladders), `${slug}: steppedRecapture must be an array`);
    for (const l of ladders) {
      assert.ok(l.label && l._statute && l._source, `${slug}: a ladder needs label, statute and source`);
      for (const fs of ['single', 'married', 'head_of_household']) {
        const r = l[fs];
        assert.ok(r, `${slug}: ladder is missing ${fs}`);
        assert.ok(r.over > 0 && r.step > 0 && r.amountPerStep > 0,
          `${slug}/${fs}: over, step and amountPerStep must all be positive`);
        assert.ok(r.max >= r.amountPerStep, `${slug}/${fs}: ceiling below one rung`);
        checked++;
      }
    }
  }
  assert.equal(checked, 3, 'measured nothing, refusing to pass');
});

// --- ficaPaidDeduction: the opt-in FICA deduction, Massachusetts only ---------
// M.G.L. c.62 s.3(B)(a)(3) deducts "Taxes paid to the United States under the provisions of
// the Federal Insurance Contributions Act", then caps the aggregate "attributable to any one
// taxpayer" at "two thousand dollars". MA DOR's Form 1 Line 11 instructions say the same and
// add that Medicare counts and that the cap cannot be shared between spouses. The cap is a
// fixed statutory figure, so it must NOT drift with inflation the way an indexed one would.
t('Massachusetts carries the statutory $2,000 FICA-deduction cap', () => {
  const d = tax.states.massachusetts.tax.ficaPaidDeduction;
  assert.ok(d, 'massachusetts.tax.ficaPaidDeduction is missing');
  assert.equal(d.cap, 2000);
  assert.ok(/two thousand dollars/.test(d._statute), 'the statutory cap wording must be quoted');
});

t('ficaPaidDeduction is opt-in: Massachusetts is the only state that carries it', () => {
  const carriers = Object.entries(tax.states)
    .filter(([, s]) => s.tax && s.tax.ficaPaidDeduction)
    .map(([slug]) => slug)
    .sort();
  assert.deepEqual(carriers, ['massachusetts'],
    'ficaPaidDeduction is Massachusetts only; a stray copy would silently cut another state');
});

t('Massachusetts deducts FICA PAID, not a flat $2,000', () => {
  // Below roughly $26,144 of wages the 7.65% employee share is under the cap, so the
  // deduction has to shrink with it. Hard-coding the cap would over-deduct for part-timers.
  // 20,000: FICA 1,530 -> taxable 20,000 - 4,400 - 1,530 = 14,070 -> 5% = 703.50
  approx(stateTax('massachusetts', 20000), 703.5, 0.01);
  // 75,000: FICA 5,737.50, capped at 2,000 -> 75,000 - 4,400 - 2,000 = 68,600 -> 3,430.00
  approx(stateTax('massachusetts', 75000), 3430, 0.01);
  // and the cap is worth exactly 2,000 x 5% = 100.00 a year to anyone who reaches it
  approx((75000 - 4400) * 0.05 - stateTax('massachusetts', 75000), 100, 0.01);
});


// --- legal-status watch: dated tripwires -------------------------------------
// A figure can match its source today and still rest on law with an expiry date,
// a revenue trigger, or an active dispute: DC's standard deduction sits on a
// temporary act Congress voted to disapprove. A freshness diff cannot see that,
// and a diary note in memory can be forgotten. `_watch.until` cannot: once the
// date passes, this fails until someone re-verifies the legal status and moves
// or clears the entry with the new evidence.
t('legal-status watches: well-formed, none expired', () => {
  const today = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const [slug, s] of Object.entries(tax.states)) {
    if (!s._watch) continue;
    n++;
    assert.match(s._watch.until || '', /^\d{4}-\d{2}-\d{2}$/, `${slug} _watch.until must be YYYY-MM-DD`);
    assert.ok(s._watch.what, `${slug} _watch must say what to re-verify`);
    assert.ok(s._watch.until >= today,
      `${slug} legal-status watch EXPIRED on ${s._watch.until}. ${s._watch.what}`);
  }
  assert.ok(n > 0, 'no _watch entries found; DC should carry one until its law is permanent');
});
// The tips/overtime conformity rows carry the same kind of tripwire.
{
  const obbba = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'obbba-deductions-2026.json'), 'utf8'));
  t('tips/overtime conformity watches: well-formed, none expired', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [slug, s] of Object.entries(obbba.states)) {
      if (!s || !s._watch) continue;
      assert.match(s._watch.until || '', /^\d{4}-\d{2}-\d{2}$/, `${slug} _watch.until must be YYYY-MM-DD`);
      assert.ok(s._watch.what, `${slug} _watch must say what to re-verify`);
      assert.ok(s._watch.until >= today,
        `${slug} tips/overtime legal-status watch EXPIRED on ${s._watch.until}. ${s._watch.what}`);
    }
  });

  // /what-applies-to-me/ prints a row's own checkedOn date when it has one, and
  // the file-wide _meta.lastSourced otherwise.
  const { buildWamParts } = await import('../src/content/what-applies-to-me.js');
  const readData = async (f) => JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', f), 'utf8'));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const wamRoster = await readData('states.json');
  const wam = buildWamParts({
    states: wamRoster,
    obbba,
    taxData: await readData('tax-data-2026.json'),
    payroll: await readData('state-payroll-2026.json'),
    supplemental: await readData('state-supplemental-2026.json'),
    esc,
  });
  const humanDay = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${new Date(Date.UTC(y, m - 1, d)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${y}`;
  };
  const verdictBlock = (slug) => {
    const start = wam.VERDICT_BLOCKS.indexOf(`<div class="g" data-st="${slug}">`);
    assert.ok(start >= 0, `no verdict block for ${slug}`);
    const next = wam.VERDICT_BLOCKS.indexOf('<div class="g" data-st="', start + 1);
    return wam.VERDICT_BLOCKS.slice(start, next < 0 ? undefined : next);
  };
  t('what-applies-to-me: tips/overtime verdicts date each row by its own checkedOn', () => {
    const globalLine = `We last checked this on ${humanDay(obbba._meta.lastSourced)}.`;
    let withOwnDate = 0;
    for (const { slug } of wamRoster) {
      const s = obbba.states[slug] || {};
      const block = verdictBlock(slug);
      if (s.checkedOn) {
        withOwnDate++;
        assert.match(s.checkedOn, /^\d{4}-\d{2}-\d{2}$/, `${slug} checkedOn must be YYYY-MM-DD`);
        const own = `We last checked this on ${humanDay(s.checkedOn)}.`;
        assert.equal(block.split(own).length - 1, 2, `${slug}: both verdict cards should print "${own}"`);
        if (s.checkedOn !== obbba._meta.lastSourced) {
          assert.ok(!block.includes(globalLine), `${slug}: verdict cards still print the file-wide "${globalLine}"`);
        }
      } else {
        assert.ok(block.includes(globalLine), `${slug}: verdict cards should print "${globalLine}"`);
      }
    }
    assert.ok(withOwnDate >= 1, 'expected at least one row (DC) with its own checkedOn');
    assert.ok(verdictBlock('district-of-columbia').includes('We last checked this on 2 October 2026.'),
      'DC verdict cards should carry their own 2 October 2026 check date');
  });
}

// --- FEDERAL INCOME TAX SUBTRACTION: Alabama, Missouri, Oregon (added 2026-10-02) -------------
// The engine models the ANNUAL RETURN, and these three states let the return subtract (some of)
// the federal income tax. The federal figure the engine hands the state is the federal liability
// after the W-4 credits, excluding W-4 extra withholding (a prepayment, not tax).
//
// 2026 federal income tax, hand-computed (standard deduction 16,100 single / 32,200 MFJ /
// 24,150 HoH; single 10% to 12,400, 12% to 50,400, 22% to 105,700, 24% to 201,775; MFJ 10% to
// 24,800, 12% to 100,800, 22% to 211,400, 24% above; HoH 10% to 17,700, 12% to 67,450, 22% to
// 105,700):
//   single  50,000: taxable 33,900  -> 1,240 + 12% x 21,500 = 3,820
//   single  75,000: taxable 58,900  -> 1,240 + 4,560 + 22% x 8,500 = 7,670
//   single 100,000: taxable 83,900  -> 5,800 + 22% x 33,500 = 13,170
//   single 125,000: taxable 108,900 -> 5,800 + 12,166 + 24% x 3,200 = 18,734
//   single 130,000: taxable 113,900 -> 17,966 + 24% x 8,200 = 19,934
//   single 140,000: taxable 123,900 -> 17,966 + 24% x 18,200 = 22,334
//   single 150,000: taxable 133,900 -> 17,966 + 24% x 28,200 = 24,734
//   MFJ    100,000: taxable 67,800  -> 2,480 + 12% x 43,000 = 7,640
//   MFJ    260,000: taxable 227,800 -> 2,480 + 9,120 + 22% x 110,600 + 24% x 16,400 = 39,868
//   HoH     75,000: taxable 50,850  -> 1,770 + 12% x 33,150 = 5,748
//   HoH    130,000: taxable 105,850 -> 1,770 + 5,970 + 22% x 38,250 + 24% x 150 = 16,191
t('federalTaxSubtraction is Alabama + Missouri + Oregon only, with the right withholding flag', () => {
  const users = Object.entries(tax.states)
    .filter(([, s]) => s.tax && s.tax.federalTaxSubtraction)
    .map(([slug]) => slug)
    .sort();
  assert.deepEqual(users, ['alabama', 'missouri', 'oregon']);
  // Alabama's and Oregon's withholding formulas subtract federal withholding; Missouri's does not.
  assert.equal(tax.states.alabama.tax.federalTaxSubtraction.inWithholdingFormula, true);
  assert.equal(tax.states.oregon.tax.federalTaxSubtraction.inWithholdingFormula, true);
  assert.equal(tax.states.missouri.tax.federalTaxSubtraction.inWithholdingFormula, false);
});

t('Oregon federal tax subtraction: 2026 limits by AGI and filing status (ORS 316.695(3))', () => {
  const cfg = tax.states.oregon.tax.federalTaxSubtraction;
  // 150-206-436 (Rev. 12-31-25): $8,750 below $125,000 single / $250,000 joint, then 7,000,
  // 5,250, 3,500, 1,750 in $5,000 ($10,000 joint) steps, zero from $145,000 / $290,000.
  // ORS 316.695(3)(e): head of household uses the JOINT bands.
  const owed = 1e6;
  const capAt = (agi, fs) => federalTaxSubtraction(owed, agi, fs, cfg);
  assert.deepEqual([124999, 125000, 129999, 130000, 135000, 140000, 144999, 145000].map((a) => capAt(a, 'single')),
    [8750, 7000, 7000, 5250, 3500, 1750, 1750, 0]);
  assert.deepEqual([249999, 250000, 260000, 270000, 280000, 289999, 290000].map((a) => capAt(a, 'married')),
    [8750, 7000, 5250, 3500, 1750, 1750, 0]);
  assert.equal(capAt(130000, 'head_of_household'), 8750, 'HoH is on the joint bands, single would be 5,250');
  // Under the limit the whole liability comes off.
  assert.equal(federalTaxSubtraction(7670, 75000, 'single', cfg), 7670);
});

// OREGON (single standard deduction 2,910, Chart S 4.75% to 4,550, 6.75% to 11,400, 8.75% to
// 125,000, 9.9% above, so the first two bands are 216.125 + 462.375 = 678.50; MFJ/HoH 5,820 and
// 4,650, Chart J 4.75% to 9,100, 6.75% to 22,800, 8.75% to 250,000, so 432.25 + 924.75 = 1,357).
t('Oregon single $50k: subtracts all 3,820 of federal tax', () =>
  // 50,000 - 2,910 - 3,820 = 43,270 -> 678.50 + 8.75% x 31,870 = 3,467.125
  approx(stateTax('oregon', 50000), 3467.125, 0.01));
t('Oregon single $75k: subtracts all 7,670 (under the 8,750 limit)', () =>
  // 75,000 - 2,910 - 7,670 = 64,420 -> 678.50 + 8.75% x 53,020 = 5,317.75 (was 5,988.88)
  approx(stateTax('oregon', 75000), 5317.75, 0.01));
t('Oregon single $100k: 13,170 of federal tax, capped at 8,750', () =>
  // 100,000 - 2,910 - 8,750 = 88,340 -> 678.50 + 8.75% x 76,940 = 7,410.75 (was 8,176.37)
  approx(stateTax('oregon', 100000), 7410.75, 0.01));
t('Oregon single $130k: inside the phase-out, limit 5,250', () =>
  // 130,000 - 2,910 - 5,250 = 121,840 -> 678.50 + 8.75% x 110,440 = 10,342.00
  approx(stateTax('oregon', 130000), 10342.00, 0.01));
t('Oregon single $140k: inside the phase-out, limit 1,750', () =>
  // 140,000 - 2,910 - 1,750 = 135,340 -> 678.50 + 8.75% x 113,600 + 9.9% x 10,340 = 11,642.16
  approx(stateTax('oregon', 140000), 11642.16, 0.01));
t('Oregon single $150k: above the phase-out, no subtraction', () =>
  // 150,000 - 2,910 = 147,090 -> 678.50 + 9,940 + 9.9% x 22,090 = 12,805.41 (unchanged)
  approx(stateTax('oregon', 150000), 12805.41, 0.01));
t('Oregon MFJ $100k: subtracts all 7,640', () =>
  // 100,000 - 5,820 - 7,640 = 86,540 -> 1,357 + 8.75% x 63,740 = 6,934.25
  approx(stateTax('oregon', 100000, 'married'), 6934.25, 0.01));
t('Oregon MFJ $260k: inside the joint phase-out, limit 5,250', () =>
  // 260,000 - 5,820 - 5,250 = 248,930 -> 1,357 + 8.75% x 226,130 = 21,143.375
  approx(stateTax('oregon', 260000, 'married'), 21143.375, 0.01));
t('Oregon HoH $130k: joint bands keep the full 8,750 limit a single filer has lost', () =>
  // 130,000 - 4,650 - 8,750 = 116,600 -> 1,357 + 8.75% x 93,800 = 9,564.50
  approx(stateTax('oregon', 130000, 'head_of_household'), 9564.50, 0.01));

// ALABAMA (single and head of family 2% to 500, 4% to 3,000, 5% above, so 10 + 100 = 110 below
// the top band; MFJ 2% to 1,000, 4% to 6,000, so 20 + 200 = 220). Standard deduction per
// Ala. Code 40-18-15(b)(4): $25 / $175 / $135 off per whole $500 of AGI over $25,500, floors
// 2,500 / 5,000 / 2,500, reached at $35,500. Federal income tax deduction in full, no cap.
t('Alabama standard deduction steps match the ADOR chart', () => {
  const cfg = tax.states.alabama.tax.standardDeductionPhaseout;
  assert.deepEqual(cfg.single, { over: 25500, per: 500, reduceBy: 25, minimum: 2500 });
  assert.deepEqual(cfg.married, { over: 25500, per: 500, reduceBy: 175, minimum: 5000 });
  assert.deepEqual(cfg.head_of_household, { over: 25500, per: 500, reduceBy: 135, minimum: 2500 });
  // Chart rows: "$ 0 – $25,999 $3,000", "$26,000 – $26,499 $2,975", "$30,000 – $30,499 $2,775",
  // "$35,500 and above $2,500"; MFJ "$30,000 – $30,499 $6,925", HoH "$30,000 – $30,499 $3,985".
  const sd = (base, agi, fs) => phaseOutStandardDeduction(base, agi, fs, cfg);
  assert.deepEqual([25999, 26000, 26499, 30000, 35499, 35500, 90000].map((a) => sd(3000, a, 'single')),
    [3000, 2975, 2975, 2775, 2525, 2500, 2500]);
  assert.equal(sd(8500, 30000, 'married'), 6925);
  assert.equal(sd(8500, 35500, 'married'), 5000);
  assert.equal(sd(5200, 30000, 'head_of_household'), 3985);
  assert.equal(sd(5200, 35500, 'head_of_household'), 2500);
});
t('Alabama single $30k: deduction 2,775 on the chart, federal 1,420 off', () =>
  // fed: 30,000 - 16,100 = 13,900 -> 1,240 + 12% x 1,500 = 1,420
  // 30,000 - 2,775 - 1,420 = 25,805 -> 110 + 5% x 22,805 = 1,250.25
  approx(stateTax('alabama', 30000), 1250.25, 0.01));
t('Alabama single $50k: all 3,820 of federal tax off', () =>
  // 50,000 - 2,500 - 3,820 = 43,680 -> 110 + 5% x 40,680 = 2,144.00
  approx(stateTax('alabama', 50000), 2144.00, 0.01));
t('Alabama single $75k: all 7,670 of federal tax off', () =>
  // 75,000 - 2,500 - 7,670 = 64,830 -> 110 + 5% x 61,830 = 3,201.50 (was 3,560.00)
  approx(stateTax('alabama', 75000), 3201.50, 0.01));
t('Alabama single $100k: all 13,170 of federal tax off', () =>
  // 100,000 - 2,500 - 13,170 = 84,330 -> 110 + 5% x 81,330 = 4,176.50 (was 4,810.00)
  approx(stateTax('alabama', 100000), 4176.50, 0.01));
t('Alabama single $150k: all 24,734 of federal tax off, no cap', () =>
  // 150,000 - 2,500 - 24,734 = 122,766 -> 110 + 5% x 119,766 = 6,098.30
  approx(stateTax('alabama', 150000), 6098.30, 0.01));
t('Alabama MFJ $100k: 5,000 floor deduction, 7,640 federal off', () =>
  // 100,000 - 5,000 - 7,640 = 87,360 -> 220 + 5% x 81,360 = 4,288.00
  approx(stateTax('alabama', 100000, 'married'), 4288.00, 0.01));
t('Alabama HoH $75k: head-of-family floor is 2,500, not the joint 5,000', () =>
  // 75,000 - 2,500 - 5,748 = 66,752 -> 110 + 5% x 63,752 = 3,297.60
  approx(stateTax('alabama', 75000, 'head_of_household'), 3297.60, 0.01));
t('Alabama: the federal figure is liability after W-4 credits, not extra withholding', () => {
  const run = (adv) => computePaycheck({ wage: { type: 'salary', amount: 75000 }, filingStatus: 'single',
    payFrequency: 'annual', stateSlug: 'alabama', adv }, tax).annual.state;
  // $2,000 of W-4 credits: federal owed 5,670, so 75,000 - 2,500 - 5,670 = 66,830 -> 110 + 5% x 63,830 = 3,301.50
  approx(run({ dependentsCredit: 2000 }), 3301.50, 0.01);
  // $1,000 of extra withholding is a prepayment, not tax: Alabama tax stays 3,201.50
  approx(run({ extraWithholding: 1000 }), 3201.50, 0.01);
});

// MISSOURI (single 16,100 / MFJ 32,200 / HoH 24,150 standard deduction; one schedule: 0% to
// 1,348, then 2%, 2.5%, 3%, 3.5%, 4%, 4.5% in 1,348 steps to 9,436, so 26.96 + 33.70 + 40.44 +
// 47.18 + 53.92 + 60.66 = 262.86 below the 4.7% top band). RSMo 143.171.2: 35% at $25,000 or less,
// 25% to $50,000, 15% to $100,000, 5% to $125,000, 0% above; cap 5,000, or 10,000 combined.
t('Missouri federal tax deduction: share bands and caps (RSMo 143.171.2)', () => {
  const cfg = tax.states.missouri.tax.federalTaxSubtraction;
  const share = (agi) => federalTaxSubtraction(1, agi, 'single', cfg);
  assert.deepEqual([25000, 25001, 50000, 50001, 100000, 100001, 125000, 125001].map(share),
    [0.35, 0.25, 0.25, 0.15, 0.15, 0.05, 0.05, 0]);
  // The cap applies after the percentage (MO-1040 line 13), and HoH keeps the single cap.
  assert.equal(federalTaxSubtraction(40000, 20000, 'single', cfg), 5000);
  assert.equal(federalTaxSubtraction(40000, 20000, 'head_of_household', cfg), 5000);
  assert.equal(federalTaxSubtraction(40000, 20000, 'married', cfg), 10000);
});
t('Missouri single $50k: 25% of 3,820 = 955 off', () =>
  // 50,000 - 16,100 - 955 = 32,945 -> 262.86 + 4.7% x 23,509 = 1,367.783
  approx(stateTax('missouri', 50000), 1367.783, 0.01));
t('Missouri single $75k: 15% of 7,670 = 1,150.50 off', () =>
  // 75,000 - 16,100 - 1,150.50 = 57,749.50 -> 262.86 + 4.7% x 48,313.50 = 2,533.5945 (was 2,587.67)
  approx(stateTax('missouri', 75000), 2533.5945, 0.01));
t('Missouri single $100k: 15% of 13,170 = 1,975.50 off', () =>
  // 100,000 - 16,100 - 1,975.50 = 81,924.50 -> 262.86 + 4.7% x 72,488.50 = 3,669.8195 (was 3,762.67)
  approx(stateTax('missouri', 100000), 3669.8195, 0.01));
t('Missouri single $150k: 0% share above $125,000', () =>
  // 150,000 - 16,100 = 133,900 -> 262.86 + 4.7% x 124,464 = 6,112.668 (unchanged)
  approx(stateTax('missouri', 150000), 6112.668, 0.01));
t('Missouri MFJ $100k: 15% of 7,640 = 1,146 off', () =>
  // 100,000 - 32,200 - 1,146 = 66,654 -> 262.86 + 4.7% x 57,218 = 2,952.106
  approx(stateTax('missouri', 100000, 'married'), 2952.106, 0.01));
t('Missouri HoH $75k: 15% of 5,748 = 862.20 off', () =>
  // 75,000 - 24,150 - 862.20 = 49,987.80 -> 262.86 + 4.7% x 40,551.80 = 2,168.7946
  approx(stateTax('missouri', 75000, 'head_of_household'), 2168.7946, 0.01));

console.log(`\n${pass} passing`);
