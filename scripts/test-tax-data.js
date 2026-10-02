// test-tax-data.js — regression guard for the 2026 tax-data table.
// Pins the federal figures (which drive every state page) and a sample of
// per-state results so a careless edit to tax-data-2026.json fails CI.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePaycheck, stateIncomeTax, phaseOutStandardDeduction, federalTaxSubtraction, stateTaxOnSlice,
  stateTaxableIncome, stateOvertimeDeduction, stateOvertimeAtFiling, stateDeductionAtFiling } from '../src/engine/paycheck-engine.js';

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

// --- THE TIPS BLOCK'S STATE FIGURE: stateTaxOnSlice() (added 2026-10-02) -----------------------
// app.js's tipsSlice() prices the state tax on tips as stateTaxOnSlice(): the state tax at the pay
// with the tips in it, less the state tax at the pay without them. Each term is fed what
// computePaycheck feeds the state at that income, so with no tips deduction the slice is the
// difference of two computePaycheck state figures to the cent, in every state and with every W-4
// and pre-tax input (Massachusetts reads the FICA paid, the three subtraction states read the
// federal liability after W-4 credits and without 4(c) extra withholding).
const cpState = (slug, amount, fs, adv) => computePaycheck({ wage: { type: 'salary', amount },
  filingStatus: fs, payFrequency: 'annual', stateSlug: slug, adv }, tax).annual.state;
t('stateTaxOnSlice with no deduction = the difference of two computePaycheck state figures', () => {
  const adv = { retirement401k: 3000, cafeteria125: 1200, dependentsCredit: 2000, extraWithholding: 500 };
  for (const slug of ['alabama', 'missouri', 'oregon', 'massachusetts', 'california', 'connecticut', 'south-carolina']) {
    for (const fs of ['single', 'married', 'head_of_household']) {
      const got = stateTaxOnSlice({ base: 40000, top: 46000, filingStatus: fs, stateData: tax.states[slug],
        fed: tax.federal, preTaxIncome: 4200, preTaxFica: 1200, dependentsCredit: 2000 });
      const want = cpState(slug, 46000, fs, adv) - cpState(slug, 40000, fs, adv);
      assert.ok(Math.abs(got - want) < 1e-6, `${slug} ${fs}: slice ${got} vs computePaycheck ${want}`);
    }
  }
});
t('Alabama, $5,000 of tips inside $50,000 of pay: the tips deduction reaches the state, $250.00', () => {
  // Federal 2026 single: at 45,000 (the pay without the tips) taxable 28,900 -> 1,240 + 12% x 16,500
  // = 3,220. At 50,000 before the tips deduction taxable 33,900 -> 3,820; after the full $5,000
  // deduction (under the $25,000 cap, MAGI far under the $150,000 phase-out) taxable 28,900 -> 3,220.
  // Alabama: standard deduction $2,500 at both incomes (the floor from $35,500), and above $3,000
  // of taxable income the tax is 2% x 500 + 4% x 2,500 + 5% x (T - 3,000) = 5% x T - 40.
  //   without the tips: 45,000 - 2,500 - 3,220 = 39,280 -> 1,964 - 40 = 1,924.00
  //   with them, filed: 50,000 - 2,500 - 3,220 = 44,280 -> 2,214 - 40 = 2,174.00
  //   slice 2,174 - 1,924 = 250.00, which is 5% of all $5,000: once deducted the tips add no
  //   federal tax, so they add nothing to Alabama's federal subtraction either.
  const slice = stateTaxOnSlice({ base: 45000, top: 50000, filingStatus: 'single',
    stateData: tax.states.alabama, fed: tax.federal, federalDeduction: 5000 });
  approx(slice, 250, 0.005);
  // The pay without the tips is computePaycheck's own figure.
  approx(cpState('alabama', 45000, 'single'), 1924, 0.005);
  // computePaycheck at 50,000 with no tips input subtracts the pre-deduction 3,820:
  // 50,000 - 2,500 - 3,820 = 43,680 -> 2,144.00. The slice is $30.00 more, which is exactly
  // Alabama's 5% on the $600 of federal tax (3,820 - 3,220) the return never shows.
  approx(cpState('alabama', 50000, 'single'), 2144, 0.005);
  approx(slice - (cpState('alabama', 50000, 'single') - cpState('alabama', 45000, 'single')), 30, 0.005);
  // So the paycheck page, with the tips inside the pay, hands computePaycheck the deduction
  // (returnDeductions) and its state line is the 2,174.00 the return shows, which is the
  // slice on top of the pay without the tips.
  const withTips = computePaycheck({ wage: { type: 'salary', amount: 50000 }, filingStatus: 'single',
    payFrequency: 'annual', stateSlug: 'alabama', returnDeductions: { federal: 5000, state: 0 } }, tax).annual;
  approx(withTips.state, 2174, 0.005);
  approx(withTips.state - cpState('alabama', 45000, 'single'), slice, 1e-6);
});

// --- TIPS INSIDE THE PAY: the page's state line and the tips block agree (added 2026-10-02) -----
// With tips inside the pay, the tips block prices the state tax on them as the state's return
// WITH the tips deduction less the return without the tips, and the page's state line is the
// first of those two terms. The line used to ignore the deduction, so in Oregon the block said
// the tips cost $0.00 of Oregon tax while the line charged $385 for them.
t('Oregon, $5,000 of tips inside $50,000 of pay: state line $3,082.13, tips block $0.00', () => {
  // Federal 2026 single: 3,220 at 45,000; 3,820 at 50,000 before the tips deduction and 3,220
  // after the full $5,000 (Oregon follows the deduction for 2026, so its own base drops by the
  // same $5,000). Oregon: standard deduction 2,910, federal tax subtracted in full (under the
  // $8,750 limit); 4.75% to 4,550, 6.75% to 11,400, 8.75% to 125,000.
  //   without the tips, at 45,000:  45,000 - 2,910 - 3,220 = 38,870 -> 678.50 + 8.75% x 27,470 = 3,082.125
  //   tips inside, return:  50,000 - 5,000 - 2,910 - 3,220 = 38,870 -> 3,082.125
  //   tips inside, old line: 50,000 - 2,910 - 3,820 = 43,270 -> 678.50 + 8.75% x 31,870 = 3,467.125
  const bands = (taxable) => 4550 * 0.0475 + 6850 * 0.0675 + (taxable - 11400) * 0.0875;
  const or = tax.states.oregon;
  const slice = stateTaxOnSlice({ base: 45000, top: 50000, filingStatus: 'single', stateData: or,
    fed: tax.federal, federalDeduction: 5000, stateDeduction: 5000 });
  approx(slice, 0, 0.005);
  const line = (rd) => computePaycheck({ wage: { type: 'salary', amount: 50000 }, filingStatus: 'single',
    payFrequency: 'annual', stateSlug: 'oregon', returnDeductions: rd }, tax).annual;
  approx(line().state, bands(50000 - 2910 - 3820), 0.005);
  approx(line().state, 3467.125, 0.005);
  approx(line({ federal: 5000, state: 5000 }).state, bands(50000 - 5000 - 2910 - 3220), 0.005);
  approx(line({ federal: 5000, state: 5000 }).state, 3082.125, 0.005);
  // The two agree: the line less the pay without the tips is the block's figure.
  approx(line({ federal: 5000, state: 5000 }).state - cpState('oregon', 45000, 'single'), slice, 1e-6);
  // And only the state line moves: gross, the federal line and FICA are unchanged.
  const a = line(), b = line({ federal: 5000, state: 5000 });
  assert.equal(b.gross, a.gross);
  assert.equal(b.federal, a.federal);
  assert.equal(b.socialSecurity + b.medicare, a.socialSecurity + a.medicare);
});
t('returnDeductions at zero reproduces every state figure exactly', () => {
  const adv = { retirement401k: 3000, cafeteria125: 1200, dependentsCredit: 2000, extraWithholding: 500 };
  for (const slug of Object.keys(tax.states)) {
    for (const fs of ['single', 'married', 'head_of_household']) {
      const run = (rd) => computePaycheck({ wage: { type: 'salary', amount: 61234 }, filingStatus: fs,
        payFrequency: 'annual', stateSlug: slug, adv, returnDeductions: rd }, tax).annual.state;
      assert.equal(run({ federal: 0, state: 0 }), run(undefined), `${slug} ${fs}`);
    }
  }
});
t('Massachusetts, $2,000 of tips on $20,000: the FICA deduction moves with the tips, $92.35', () => {
  // FICA 7.65%: 1,530 at 20,000, 1,683 at 22,000, both under the $2,000 cap, so both deducted in full.
  //   20,000 - 4,400 - 1,530 = 14,070 -> 5% = 703.50
  //   22,000 - 4,400 - 1,683 = 15,917 -> 5% = 795.85
  //   slice 92.35 (the old tips block passed no FICA and printed 5% x 2,000 = 100.00)
  approx(stateTaxOnSlice({ base: 20000, top: 22000, filingStatus: 'single',
    stateData: tax.states.massachusetts, fed: tax.federal, federalDeduction: 2000 }), 92.35, 0.005);
});

// --- ALABAMA OVERTIME PREMIUM DEDUCTION (added 2026-10-02) ------------------------------------
// Act 2026-604 (HB527, 2026 RS) adds Ala. Code 40-18-15(a)(29): for tax years 2026 through 2028,
// "qualified overtime compensation received during the taxable year, not to exceed one thousand
// dollars ($1,000) per taxpayer", defined by 26 U.S.C. 225, so the premium above the regular rate
// only. ADOR: "the lesser of the actual overtime premium or a maximum annual amount of $1,000 per
// taxpayer", no income limit, and the W-2 box 12 code TT entry "will not change wages,
// withholdings, or taxes", so it is claimed at filing and is not in the withholding figure.
// It is a subsection (a) deduction, taken AFTER AGI, so the standard-deduction chart is read at
// the AGI before it. Alabama's top band is 5% above $3,000 of taxable income (single), so there
// the tax is 5% x T - 40, and every dollar of deduction is worth 5 cents.
const AL = tax.states.alabama;
t('overtimePremiumDeduction is Alabama only: $1,000, 2026 to 2028, not in withholding', () => {
  const users = Object.entries(tax.states).filter(([, s]) => s.tax && s.tax.overtimePremiumDeduction).map(([k]) => k);
  assert.deepEqual(users, ['alabama']);
  const cfg = AL.tax.overtimePremiumDeduction;
  assert.equal(cfg.cap, 1000);
  assert.equal(cfg.firstTaxYear, 2026);
  assert.equal(cfg.lastTaxYear, 2028);
  assert.equal(cfg.inWithholdingFormula, false);
  assert.ok(cfg.firstTaxYear <= tax.taxYear && tax.taxYear <= cfg.lastTaxYear, 'the data year must be inside the act window');
  assert.match(cfg._source, /HB527-enr\.pdf/);
  assert.match(cfg._source, /overtime-premium-deduction-act-2026-604/);
});
t('stateOvertimeDeduction: the premium, never above the $1,000 cap, zero without a rule', () => {
  const cfg = AL.tax.overtimePremiumDeduction;
  assert.deepEqual([0, 600, 999.99, 1000, 3333.33, 25000, -50].map((p) => stateOvertimeDeduction(p, cfg)),
    [0, 600, 999.99, 1000, 1000, 1000, 0]);
  assert.equal(stateOvertimeDeduction(5000, undefined), 0);
  assert.equal(stateOvertimeDeduction(5000, tax.states.georgia.tax.overtimePremiumDeduction), 0);
});
t('Alabama single $70k: the paycheck figure is unchanged, the deduction is not in withholding', () =>
  // fed: 70,000 - 16,100 = 53,900 -> 1,240 + 4,560 + 22% x 3,500 = 6,570
  // AL: 70,000 - 2,500 - 6,570 = 60,930 -> 5% x 60,930 - 40 = 3,006.50 (same as before the act)
  approx(stateTax('alabama', 70000), 3006.50, 0.005));
t('Alabama single $70k, $600 of premium: all 600 comes off, $30.00 less tax', () => {
  // 70,000 - 2,500 - 6,570 - 600 = 60,330 -> 5% x 60,330 - 40 = 2,976.50
  approx(stateIncomeTax(70000, 'single', AL, 0, 0, 6570, 600), 2976.50, 0.005);
  approx(stateIncomeTax(70000, 'single', AL, 0, 0, 6570, 0) - stateIncomeTax(70000, 'single', AL, 0, 0, 6570, 600), 30, 0.005);
});
t('Alabama: the deduction is taken after AGI, so the standard-deduction chart does not move', () => {
  // Single $30,000: AGI 30,000 -> chart $2,775 (3,000 - 25 x 9 whole $500 steps over 25,500);
  // fed 30,000 - 16,100 = 13,900 -> 1,240 + 12% x 1,500 = 1,420.
  //   30,000 - 2,775 - 1,420 - 1,000 = 24,805 -> 5% x 24,805 - 40 = 1,200.25
  // Had it lowered AGI to 29,000 the chart would give 2,825 and the tax 1,197.75.
  const r = stateTaxableIncome(30000, 'single', AL, 0, 0, 1420, 1000);
  assert.equal(r.agi, 30000);
  assert.equal(r.standardDeduction, 2775);
  assert.equal(r.overtimeDeduction, 1000);
  assert.equal(r.taxable, 24805);
  approx(stateIncomeTax(30000, 'single', AL, 0, 0, 1420, 1000), 1200.25, 0.005);
});
t('Other states ignore an overtime premium (no rule, no deduction)', () => {
  for (const slug of ['georgia', 'missouri', 'oregon', 'california', 'new-york']) {
    const s = tax.states[slug];
    assert.equal(stateIncomeTax(70000, 'single', s, 0, 5355, 6570, 3000), stateIncomeTax(70000, 'single', s, 0, 5355, 6570, 0), slug);
    assert.equal(stateOvertimeAtFiling({ income: 70000, filingStatus: 'single', stateData: s, fed: tax.federal, premium: 3000 }), null, slug);
  }
});
t('Alabama at filing, single $70k with $10,000 of time-and-a-half overtime: $13.33 net', () => {
  // $10,000 of overtime pay at 1.5x the normal rate: the premium is a third of it, 3,333.33,
  // under the $12,500 federal cap with MAGI far under $150,000, so the federal deduction is
  // all 3,333.33. Fed after it: 53,900 - 3,333.33 = 50,566.67 -> 5,800 + 22% x 166.67 = 5,836.67,
  // a federal saving of 733.33 (22% of 3,333.33).
  //   before:        70,000 - 2,500 - 6,570.00          = 60,930.00 -> 3,006.50
  //   federal only:  70,000 - 2,500 - 5,836.67          = 61,663.33 -> 3,043.17 (knock-on +36.67)
  //   both:          70,000 - 2,500 - 5,836.67 - 1,000  = 60,663.33 -> 2,993.17 (AL deduction -50.00)
  //   net 3,006.50 - 2,993.17 = 13.33 less Alabama tax
  const prem = 10000 / 3;
  const r = stateOvertimeAtFiling({ income: 70000, filingStatus: 'single', stateData: AL, fed: tax.federal,
    federalOvertimeDeduction: prem, premium: prem });
  assert.equal(r.deduction, 1000);
  assert.equal(r.cap, 1000);
  approx(r.before, 3006.50, 0.005);
  approx(r.before, stateTax('alabama', 70000), 1e-9);
  approx(r.federalKnockOn, 36.67, 0.005);
  approx(r.stateSaving, 50, 0.005);
  approx(r.net, 13.33, 0.005);
  approx(r.after, 2993.17, 0.005);
});
t('Alabama at filing, single $50k, $600 of premium under the cap: $26.40 net', () => {
  // fed 3,820; after the 600 federal deduction 33,300 -> 1,240 + 12% x 20,900 = 3,748, saving 72.
  //   knock-on 5% x 72 = 3.60; Alabama deduction 5% x 600 = 30.00; net 26.40
  //   before 2,144.00 (pinned above) -> after 2,117.60
  const r = stateOvertimeAtFiling({ income: 50000, filingStatus: 'single', stateData: AL, fed: tax.federal,
    federalOvertimeDeduction: 600, premium: 600 });
  assert.equal(r.deduction, 600);
  approx(r.federalKnockOn, 3.60, 0.005);
  approx(r.stateSaving, 30, 0.005);
  approx(r.net, 26.40, 0.005);
  approx(r.after, 2117.60, 0.005);
});
t('Alabama at filing, single $90k with a $10,000 premium: the knock-on wins, $60.00 MORE tax', () => {
  // fed 90,000 - 16,100 = 73,900 -> 5,800 + 22% x 23,500 = 10,970; after the 10,000 deduction
  // 63,900 -> 5,800 + 22% x 13,500 = 8,770, saving 2,200.
  //   before 90,000 - 2,500 - 10,970 = 76,530 -> 3,786.50
  //   knock-on 5% x 2,200 = +110.00; Alabama deduction capped at 1,000 -> -50.00; net -60.00
  const r = stateOvertimeAtFiling({ income: 90000, filingStatus: 'single', stateData: AL, fed: tax.federal,
    federalOvertimeDeduction: 10000, premium: 10000 });
  approx(r.before, 3786.50, 0.005);
  approx(r.federalKnockOn, 110, 0.005);
  approx(r.stateSaving, 50, 0.005);
  approx(r.net, -60, 0.005);
  approx(r.after, 3846.50, 0.005);
});
t('Alabama at filing, single $300k: federal deduction phased out, Alabama has no income limit', () => {
  // The federal $12,500 is gone at MAGI $300,000 (100 x 150 = 15,000 off), so no knock-on.
  // fed 300,000 - 16,100 = 283,900 -> 17,966 + 24% x 96,075 + 32% x 54,450 + 35% x 27,675 = 68,134.25
  //   before 300,000 - 2,500 - 68,134.25 = 229,365.75 -> 5% x 229,365.75 - 40 = 11,428.2875
  //   Alabama deduction 1,000 -> -50.00, net 50.00
  const r = stateOvertimeAtFiling({ income: 300000, filingStatus: 'single', stateData: AL, fed: tax.federal,
    federalOvertimeDeduction: 0, premium: 5000 });
  approx(r.before, 11428.2875, 0.005);
  approx(r.federalKnockOn, 0, 1e-9);
  approx(r.net, 50, 0.005);
});
t('Alabama at filing, MFJ $100k, one earner with a $2,000 premium: capped at $1,000, $38.00 net', () => {
  // MFJ fed 7,640 (above); after 2,000: taxable 65,800 -> 2,480 + 12% x 41,000 = 7,400, saving 240.
  //   before 4,288.00 (pinned above); knock-on 5% x 240 = 12.00; deduction 1,000 -> 50.00; net 38.00
  const r = stateOvertimeAtFiling({ income: 100000, filingStatus: 'married', stateData: AL, fed: tax.federal,
    federalOvertimeDeduction: 2000, premium: 2000 });
  assert.equal(r.deduction, 1000);
  approx(r.before, 4288, 0.005);
  approx(r.federalKnockOn, 12, 0.005);
  approx(r.net, 38, 0.005);
});
t('Alabama at filing: a tips deduction ahead in the chain is the starting point, not counted again', () => {
  // Single $50k with $5,000 of tips already deducted federally: fed 28,900 -> 3,220 (the tips
  // block's figure above). The $600 overtime deduction on top: 28,300 -> 1,240 + 12% x 15,900 =
  // 3,148, saving 72.
  //   before 50,000 - 2,500 - 3,220 = 44,280 -> 2,174.00 (the tips test's "with them, filed")
  //   knock-on 3.60, deduction 30.00, net 26.40, after 2,147.60
  const r = stateOvertimeAtFiling({ income: 50000, filingStatus: 'single', stateData: AL, fed: tax.federal,
    federalDeductionBefore: 5000, federalOvertimeDeduction: 600, premium: 600 });
  approx(r.before, 2174, 0.005);
  approx(r.federalKnockOn, 3.60, 0.005);
  approx(r.net, 26.40, 0.005);
  approx(r.after, 2147.60, 0.005);
});
t('Alabama at filing: W-4 credits and pre-tax money are fed exactly as computePaycheck feeds them', () => {
  // Same pay as computePaycheck with a 401(k), a Section 125 premium and $2,000 of W-4 credits:
  // with nothing deducted the `before` term is that page's own state figure to the cent.
  const adv = { retirement401k: 3000, cafeteria125: 1200, dependentsCredit: 2000, extraWithholding: 500 };
  const r = stateOvertimeAtFiling({ income: 70000, filingStatus: 'single', stateData: AL, fed: tax.federal,
    preTaxIncome: 4200, preTaxFica: 1200, dependentsCredit: 2000, federalOvertimeDeduction: 0, premium: 0 });
  approx(r.before, cpState('alabama', 70000, 'single', adv), 1e-9);
  approx(r.net, 0, 1e-9);
});

// --- THE KNOCK-ON EVERYWHERE: stateDeductionAtFiling() (added 2026-10-02) -----------------------
// Alabama, Missouri and Oregon subtract federal income tax, so every federal deduction (tips,
// overtime, the senior deduction) lowers what they subtract and raises the state tax. The paycheck
// page prints that as a row of its own, from this one helper, for tips (inside the tips block),
// overtime and the senior deduction (at filing). Federal 2026 single, from the tests above:
// 10% to 12,400, 12% to 50,400 (5,800 there), 22% to 105,700 (17,966 there), standard deduction
// 16,100.
const MO = tax.states.missouri;
const OR = tax.states.oregon;
const atFiling = (stateData, income, fedDed, stDed = 0, extra = {}) => stateDeductionAtFiling({ income,
  filingStatus: 'single', stateData, fed: tax.federal, federalDeduction: fedDed, stateDeduction: stDed, ...extra });
t('knock-on, Alabama tips on top: $5,000 on $50,000 costs $30.00 of Alabama tax, inside the $250.00', () => {
  // At 55,000 (pay plus tips): fed 38,900 -> 1,240 + 12% x 26,500 = 4,420; after the $5,000
  // deduction 33,900 -> 3,820, a $600 saving. Alabama standard deduction $2,500 (the floor).
  //   before        55,000 - 2,500 - 4,420 = 48,080 -> 5% x 48,080 - 40 = 2,364.00
  //   federal only  55,000 - 2,500 - 3,820 = 48,680 -> 5% x 48,680 - 40 = 2,394.00, knock-on 30.00
  // Alabama has no tips deduction of its own, so nothing comes back.
  const r = atFiling(AL, 55000, 5000);
  approx(r.before, 2364, 0.005);
  approx(r.federalKnockOn, 30, 0.005);
  approx(r.stateSaving, 0, 1e-9);
  approx(r.net, -30, 0.005);
  approx(r.federalTaxBefore - r.federalTaxAfter, 600, 0.005);
  // The tips block's state figure is 2,394.00 - 2,144.00 (Alabama at the pay alone) = 250.00:
  // 220.00 of Alabama tax on the tips and this 30.00 knock-on, which it now prints on its own row.
  const slice = stateTaxOnSlice({ base: 50000, top: 55000, filingStatus: 'single', stateData: AL,
    fed: tax.federal, federalDeduction: 5000 });
  approx(slice, 250, 0.005);
  approx(slice - r.federalKnockOn, 220, 0.005);
});
t('knock-on, Missouri overtime: $3,000 of premium on $75,000 costs $4.65 of Missouri tax', () => {
  // $30 an hour, 200 hours at time and a half: premium 200 x $15 = 3,000, all deductible (under
  // $12,500, MAGI under $150,000). Fed 58,900 -> 5,800 + 22% x 8,500 = 7,670; after 55,900 ->
  // 5,800 + 22% x 5,500 = 7,010, a $660 saving.
  // Missouri: AGI 75,000 -> 15% of the federal tax, under the $5,000 cap.
  //   subtraction 15% x 7,670 = 1,150.50 before, 15% x 7,010 = 1,051.50 after: 99.00 less
  //   75,000 - 16,100 - 1,150.50 = 57,749.50 and 57,848.50, both in the 4.7% band: 4.7% x 99 = 4.653
  // Missouri has no overtime deduction of its own (verdict "no").
  const r = atFiling(MO, 75000, 3000);
  approx(r.subtractionBefore, 1150.5, 0.005);
  approx(r.subtractionAfter, 1051.5, 0.005);
  approx(r.federalKnockOn, 4.653, 0.0005);
  approx(r.stateSaving, 0, 1e-9);
  approx(r.before, cpState('missouri', 75000, 'single'), 1e-9);
});
t('knock-on, Oregon overtime under the limit: $3,000 on $50,000, +$262.50 Oregon deduction, -$31.50 knock-on', () => {
  // $20 an hour, 300 hours: premium 300 x $10 = 3,000. Fed 3,820; after 30,900 -> 1,240 + 12% x
  // 18,500 = 3,460, a $360 saving. Oregon: AGI 50,000, limit $8,750, so all of it is subtracted.
  //   before        50,000 - 2,910 - 3,820         = 43,270 -> 678.50 + 8.75% x 31,870 = 3,467.125
  //   federal only  50,000 - 2,910 - 3,460         = 43,630 -> 3,498.625, knock-on 8.75% x 360 = 31.50
  //   both          50,000 - 2,910 - 3,460 - 3,000 = 40,630 -> 3,236.125, Oregon deduction 262.50
  //   net 231.00 less Oregon tax
  const r = atFiling(OR, 50000, 3000, 3000);
  approx(r.before, 3467.125, 0.005);
  approx(r.federalKnockOn, 31.5, 0.005);
  approx(r.stateSaving, 262.5, 0.005);
  approx(r.net, 231, 0.005);
  approx(r.after, 3236.125, 0.005);
});
t('knock-on, Oregon overtime over the limit: $4,000 on $100,000, knock-on $0.00', () => {
  // $40 an hour, 200 hours: premium 4,000. Fed 83,900 -> 5,800 + 22% x 33,500 = 13,170; after
  // 79,900 -> 12,290, an $880 saving. Oregon AGI 100,000 (under $125,000): limit $8,750, and the
  // federal tax is over it before AND after, so 8,750 is subtracted both times and nothing moves.
  //   before 100,000 - 2,910 - 8,750 = 88,340 -> 678.50 + 8.75% x 76,940 = 7,410.75
  //   Oregon deduction 8.75% x 4,000 = 350.00, net 350.00
  const r = atFiling(OR, 100000, 4000, 4000);
  assert.equal(r.subtractionBefore, 8750);
  assert.equal(r.subtractionAfter, 8750);
  approx(r.federalTaxBefore - r.federalTaxAfter, 880, 0.005);
  approx(r.federalKnockOn, 0, 1e-9);
  approx(r.before, 7410.75, 0.005);
  approx(r.stateSaving, 350, 0.005);
  approx(r.net, 350, 0.005);
});
t('a state that follows the overtime deduction prices its own saving, with no knock-on', () => {
  // The paycheck page now prints a state saving row for every 2026 overtime "yes" state, not only
  // the three that subtract federal tax. Same $3,000 premium on $50,000, by hand:
  //   Arizona 2.5% flat, deduction 15,750: 34,250 -> 856.25, after 31,250 -> 781.25, saving 75.00
  //   Michigan 4.25% flat, 5,900: 44,100 -> 1,874.25, after 41,100 -> 1,746.75, saving 127.50
  //   DC 6% band from 10,000 to 40,000, deduction 15,000: 35,000 -> 400 + 6% x 25,000 = 1,900.00,
  //     after 32,000 -> 1,720.00, saving 180.00
  //   North Dakota 0% to 49,575, deduction 16,100: 33,900 and 30,900 both untaxed, saving 0.00, so
  //     the page prints no row for it
  const az = atFiling(tax.states.arizona, 50000, 3000, 3000);
  approx(az.before, 856.25, 0.005);
  approx(az.stateSaving, 75, 0.005);
  approx(az.federalKnockOn, 0, 1e-9);
  approx(az.net, 75, 0.005);
  const mi = atFiling(tax.states.michigan, 50000, 3000, 3000);
  approx(mi.before, 1874.25, 0.005);
  approx(mi.stateSaving, 127.5, 0.005);
  const dc = atFiling(tax.states['district-of-columbia'], 50000, 3000, 3000);
  approx(dc.before, 1900, 0.005);
  approx(dc.stateSaving, 180, 0.005);
  approx(atFiling(tax.states['north-dakota'], 50000, 3000, 3000).stateSaving, 0, 1e-9);
});
t('knock-on, Oregon at $150,000: the limit is $0, so no knock-on', () => {
  // AGI 150,000 is past the last step ($145,000), so Oregon subtracts nothing before or after.
  const r = atFiling(OR, 150000, 4000, 4000);
  assert.equal(r.subtractionBefore, 0);
  assert.equal(r.subtractionAfter, 0);
  approx(r.federalKnockOn, 0, 1e-9);
});
t('knock-on, the senior deduction at $50,000: Alabama $36.00, Missouri $8.46, Oregon $63.00', () => {
  // $6,000 senior deduction (MAGI under $75,000): fed 33,900 -> 3,820 and 27,900 -> 3,100, $720.
  //   Alabama 5% x 720 = 36.00
  //   Missouri 25% share at AGI 50,000: subtraction 955.00 -> 775.00, 4.7% x 180 = 8.46
  //   Oregon under the limit: 8.75% x 720 = 63.00
  // None of the three has a senior verdict in obbba-deductions-2026.json, so no state deduction.
  approx(atFiling(AL, 50000, 6000).federalKnockOn, 36, 0.005);
  approx(atFiling(MO, 50000, 6000).federalKnockOn, 8.46, 0.005);
  approx(atFiling(OR, 50000, 6000).federalKnockOn, 63, 0.005);
});
t('knock-on: zero in every state that subtracts no federal tax', () => {
  for (const [slug, s] of Object.entries(tax.states)) {
    if (s.tax && s.tax.federalTaxSubtraction) continue;
    const r = atFiling(s, 60000, 3000);
    if (r === null) continue;
    assert.ok(Math.abs(r.federalKnockOn) < 1e-9, `${slug}: ${r.federalKnockOn}`);
  }
  assert.equal(atFiling(tax.states.texas, 60000, 3000), null);
});
t('chained: a deduction ahead in the chain is the starting point on both sides', () => {
  // Alabama $50,000, $5,000 of tips ahead, then the $6,000 senior deduction: fed 28,900 -> 3,220,
  // then 22,900 -> 1,240 + 12% x 10,500 = 2,500, $720 again; knock-on 36.00 on top of the tips.
  const r = atFiling(AL, 50000, 6000, 0, { federalDeductionBefore: 5000 });
  approx(r.before, 2174, 0.005);
  approx(r.federalKnockOn, 36, 0.005);
  // Oregon follows the tips: a $5,000 state deduction ahead lowers taxable income, not the knock-on rate.
  const o = atFiling(OR, 50000, 6000, 0, { federalDeductionBefore: 5000, stateDeductionBefore: 5000 });
  approx(o.before, 3082.125, 0.005);
  approx(o.federalKnockOn, 63, 0.005);
});
t('stateOvertimeAtFiling is stateDeductionAtFiling run with Alabama\'s own capped deduction', () => {
  const prem = 10000 / 3;
  const a = stateOvertimeAtFiling({ income: 70000, filingStatus: 'single', stateData: AL, fed: tax.federal,
    federalOvertimeDeduction: prem, premium: prem });
  const b = atFiling(AL, 70000, prem, 1000);
  for (const k of ['stateSaving', 'federalKnockOn', 'net', 'before', 'after']) approx(a[k], b[k], 1e-9);
});
t('a state deduction is taken below AGI: Oregon $128,000 keeps the $7,000 limit with $5,000 deducted', () => {
  // Fed with the $5,000 tips deduction: 128,000 - 16,100 - 5,000 = 106,900 -> 17,966 + 24% x 1,200
  // = 18,254. AGI stays 128,000 (the tips deduction is below federal AGI), so Oregon's limit is the
  // $7,000 step (125,000 to 130,000), not the $8,750 that AGI 123,000 would read.
  //   128,000 - 2,910 - 7,000 - 5,000 = 113,090 -> 678.50 + 8.75% x 101,690 = 9,576.375
  const r = stateTaxableIncome(128000, 'single', OR, 0, 0, 18254, 0, 5000);
  assert.equal(r.agi, 128000);
  assert.equal(r.federalTaxSubtraction, 7000);
  assert.equal(r.deductionAfterAgi, 5000);
  assert.equal(r.taxable, 113090);
  approx(stateIncomeTax(128000, 'single', OR, 0, 0, 18254, 0, 5000), 9576.375, 0.005);
  // The paycheck page's tips-inside line goes through the same path.
  const line = computePaycheck({ wage: { type: 'salary', amount: 128000 }, filingStatus: 'single',
    payFrequency: 'annual', stateSlug: 'oregon', returnDeductions: { federal: 5000, state: 5000 } }, tax).annual;
  approx(line.state, 9576.375, 0.005);
});

console.log(`\n${pass} passing`);
