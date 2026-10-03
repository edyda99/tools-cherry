// test-ladder-rungs.js — the salary-ladder rungs, and specifically the $75,000
// rung, which exists for ONE reason: it is the exact MAGI at which the OBBBA
// senior deduction begins to phase out (IRC §151(d)(5)(C), added by OBBBA
// §70103). Run: node scripts/test-ladder-rungs.js
//
// Two things are under test and they fail for different reasons:
//
//   1. THE FIGURES. Every dollar the rung pages print is produced at build time
//      by computePaycheck against src/data/tax-data-2026.json. Here those same
//      figures are re-derived from the statutory schedules BY HAND — the band
//      arithmetic is written out below rather than read from the data — so a
//      silent change to a bracket, a standard deduction or the engine's own
//      arithmetic trips this before it reaches thirty-seven live pages.
//
//   2. THE CLAIM THE RUNG IS ON THE LADDER TO MAKE. The $75,000 page says the
//      senior deduction is still WHOLE at $75,000 because the taper takes 6% of
//      MAGI *above* the threshold, and 6% of nothing is nothing. That sentence is
//      only true while the phase-out start is exactly $75,000 and the reduction
//      is computed on the excess. If either changes, the rung stops earning its
//      page and the prose becomes false, so both are asserted directly.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computePaycheck, stateTaxableIncome, federalIncomeTax, ficaTax } from '../src/engine/paycheck-engine.js';
import { LADDER_SALARIES } from '../backend/mcp-server/tools.js';
import { carLoanDeduction } from '../src/engine/obbba-deduction.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(__dirname, p), 'utf8'));
const taxData = read('../src/data/tax-data-2026.json');
const obbba = read('../src/data/obbba-deductions-2026.json');
const dcare = read('../src/data/dependent-care-2026.json');

let pass = 0, fail = 0;
function eq(name, got, want, tol = 0.01) {
  if (got != null && want != null && Math.abs(got - want) <= tol) pass++;
  else { fail++; console.error(`FAIL ${name}: got ${got}, want ${want}`); }
}
function is(name, got, want) {
  if (got === want) pass++;
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

const RUNG = 75000;
const net = (slug, amount, status = 'single') => computePaycheck(
  { wage: { type: 'salary', amount }, filingStatus: status, payFrequency: 'annual', stateSlug: slug },
  taxData).annual;

// --- 1. The rung is on the ladder, and the mirror the MCP server serves agrees.
is('$75,000 is a published rung', LADDER_SALARIES.includes(RUNG), true);
is('rungs are strictly ascending', LADDER_SALARIES.every((v, i, a) => i === 0 || a[i - 1] < v), true);

// --- 2. WHY THIS RUNG EXISTS. The senior deduction phase-out start, and the
// arithmetic of the sentence the page prints at it.
const sen = obbba.federal.senior;
eq('senior phase-out starts at the rung', sen.phaseoutStartMagi.single, RUNG, 0);
is('HoH and QSS share the single threshold',
  sen.phaseoutStartMagi.head_of_household === RUNG && sen.phaseoutStartMagi.qss === RUNG, true);
is('a joint return does NOT use it', sen.phaseoutStartMagi.married === RUNG, false);
eq('the taper rate the page quotes', sen.phaseoutRate, 0.06, 1e-12);
eq('the per-person amount the page quotes', sen.amountPerPerson, 6000, 0);
eq('the page\'s "runs out entirely at" figure', sen.fullPhaseoutMagi.single, 175000, 0);
// The load-bearing claim: AT the threshold the excess is zero, so nothing is lost.
const seniorLeft = (magi) => Math.max(0,
  sen.amountPerPerson - Math.max(0, magi - sen.phaseoutStartMagi.single) * sen.phaseoutRate);
eq('at exactly $75,000 the whole deduction survives', seniorLeft(75000), 6000, 0);
eq('one dollar more starts taking it', seniorLeft(75001), 6000 - 0.06, 1e-9);
eq('the rung below keeps all of it too', seniorLeft(70000), 6000, 0);
eq('the rung above has lost some', seniorLeft(80000), 6000 - 5000 * 0.06, 1e-9);
// And it is genuinely a BELOW-the-line §151 deduction, not a withholding change —
// which is why the page scopes the sentence to filers 65+ and says the take-home
// figures never count on it.
is('senior deduction is below-the-line', sen.belowTheLine, true);

// --- 3. The §21 childcare rate at the rung. $75,000 is the TOP of the flat 35%
// stretch, not the first point below it, so "at $75,000 it is 35.0%" is a
// boundary claim and is asserted as one.
const ap = dcare.cdctc.applicablePercent;
eq('stage 2 starts at the rung for a single filer', ap.stage2.thresholdSingle, RUNG, 0);
const cdcRate = (agi) => {
  const s1 = Math.max(0, Math.ceil(Math.max(0, agi - ap.stage1.threshold) / ap.stage1.increment)) * 0.01;
  let r = Math.max(ap.stage1Floor, ap.top - s1);
  if (agi > ap.stage2.thresholdSingle) {
    const s2 = Math.ceil((agi - ap.stage2.thresholdSingle) / ap.stage2.incrementSingle) * 0.01;
    r = Math.max(ap.stage2Floor, r - s2);
  }
  return r;
};
eq('at $75,000 the credit rate is still 35%', cdcRate(75000), 0.35, 1e-9);
eq('the flat stretch starts at $45,000', cdcRate(45000), 0.35, 1e-9);
eq('above the rung it erodes', cdcRate(77000), 0.34, 1e-9);

// --- 4. THE FEDERAL FIGURES, hand-derived. Standard deduction $16,100 (Rev.
// Proc. 2025-32) leaves $58,900 taxable; the 2026 single schedule charges 10% to
// $12,400, 12% to $50,400 and 22% above it.
const FED_TAXABLE = 75000 - 16100;
eq('taxable income at the rung', FED_TAXABLE, 58900, 0);
const FED_TAX = 12400 * 0.10 + (50400 - 12400) * 0.12 + (FED_TAXABLE - 50400) * 0.22;
eq('hand-derived federal tax', FED_TAX, 7670, 0);
const SS = 75000 * 0.062, MED = 75000 * 0.0145;
eq('Social Security at the rung', SS, 4650, 0);
eq('Medicare at the rung', MED, 1087.5, 0);
is('the rung is under the Social Security wage base', 75000 < taxData.federal.fica.socialSecurity.wageBase, true);

// --- 5. FIVE STATES, one of each shape the ladder builds, each with its state
// tax written out from the statutory schedule rather than read from the engine.
//   texas      no income tax and no employee programs
//   ohio       a personal exemption, a 0% opening band PLUS ORC 5747.02(A)(3)'s flat $332 base amount
//   california bracket schedule + an uncapped 1.30% SDI premium
//   arkansas   bracket schedule opening on a 0% band
//   wisconsin  a standard deduction that PHASES DOWN with income
{
  const tx = net('texas', RUNG);
  eq('texas state tax is nothing', tx.state, 0);
  eq('texas take-home', tx.net, 75000 - FED_TAX - SS - MED);
  eq('texas take-home is the published figure', tx.net, 61592.5);
}
{
  const oh = net('ohio', RUNG);
  // Ohio subtracts one personal exemption, $2,150 for income from $40,001 to $80,000 (ORC 5747.025).
  const ohTax = (75000 - 2150 - 26050) * 0.0275 + 332;
  eq('ohio state tax includes the statutory $332', oh.state, ohTax);
  eq('ohio state tax', oh.state, 1619);
  eq('ohio take-home', oh.net, 75000 - FED_TAX - SS - MED - ohTax);
}
{
  const ca = net('california', RUNG);
  const caTaxable = 75000 - 5900;
  const caTax = 11456 * 0.01 + (27157 - 11456) * 0.02 + (42861 - 27157) * 0.04
    + (59498 - 42861) * 0.06 + (caTaxable - 59498) * 0.08;
  eq('california income tax', ca.state, caTax);
  eq('california income tax', ca.state, 2823.12);
  eq('california SDI is uncapped at this salary', ca.statePrograms, 75000 * 0.013);
  eq('california take-home', ca.net, 75000 - FED_TAX - SS - MED - caTax - 975);
}
{
  const ar = net('arkansas', RUNG);
  const arTaxable = 75000 - 2470;
  const arTax = (11199 - 5599) * 0.02 + (15999 - 11199) * 0.03
    + (26399 - 15999) * 0.034 + (arTaxable - 26399) * 0.037;
  eq('arkansas income tax', ar.state, arTax);
  eq('arkansas take-home', ar.net, 75000 - FED_TAX - SS - MED - arTax);
}
{
  // Wis. Stat. 71.05(22)(dp): the deduction comes down 12% of AGI over $20,120.
  // The page prints the PHASED figure, never the $13,960 published maximum, so
  // that is what is asserted here.
  const wi = net('wisconsin', RUNG);
  const wiDed = taxData.states.wisconsin.tax.standardDeduction.single;
  is('wisconsin publishes the maximum this rung must NOT print', wiDed, 13960);
  const wiTaxable = 75000 - 7375;
  eq('wisconsin taxable after the phase-down', wiTaxable, 67625, 0);
  is('the phased deduction is smaller than the published one', 7375 < wiDed, true);
  // The engine's tax, re-derived on the phased taxable figure.
  const b = taxData.states.wisconsin.tax.brackets.single;
  let rest = wiTaxable, lo = 0, wiTax = 0;
  for (const band of b) {
    const up = band.upTo == null ? Infinity : band.upTo;
    const slice = Math.max(0, Math.min(rest, up - lo));
    wiTax += slice * band.rate; rest -= slice; lo = up;
    if (rest <= 0) break;
  }
  eq('wisconsin income tax on the phased base', wi.state, wiTax);
}

// --- 6. THE NEIGHBOUR ARITHMETIC the rung pages print, and that inserting this
// rung rewrote on the $70,000 and $80,000 pages. Both steps are $5,000 of gross;
// what survives is what those pages claim.
{
  const a70 = net('texas', 70000).net, a75 = net('texas', 75000).net, a80 = net('texas', 80000).net;
  eq('texas $70k -> $75k take-home gained', a75 - a70, 3517.5);
  eq('texas $75k -> $80k take-home gained', a80 - a75, 3517.5);
  eq('share of the raise surviving', (a75 - a70) / 5000, 0.7035, 1e-9);
}
{
  // California's 8% band runs to $75,197 of taxable income in 2026, $81,097 of salary, so both
  // steps stay inside it and are equal. The $75,000 page prints both.
  const c70 = net('california', 70000).net, c75 = net('california', 75000).net, c80 = net('california', 80000).net;
  eq('california step up from $70,000', c75 - c70, 3052.5, 0.005);
  eq('california step on to $80,000', c80 - c75, 3052.5, 0.005);
}

// --- 7. THE FEDERAL-TAX SUBTRACTION on the $75,000 rung (added 2026-10-02). Alabama, Missouri
// and Oregon subtract (some of) the federal income tax, FED_TAX = 7,670 above, from the income
// they tax. Written out by hand from each state's schedule.
{
  // Oregon: 75,000 - 2,910 - 7,670 (under the 8,750 limit) = 64,420;
  //   4.75% x 4,550 + 6.75% x 6,850 + 8.75% x 53,020 = 216.125 + 462.375 + 4,639.25 = 5,317.75
  eq('oregon $75k state tax, all 7,670 subtracted', net('oregon', RUNG).state,
    4550 * 0.0475 + 6850 * 0.0675 + (75000 - 2910 - FED_TAX - 11400) * 0.0875);
  // Alabama: deduction at its 2,500 floor plus the 1,500 personal exemption; 75,000 - 4,000 - 7,670
  //   = 63,330; 2% x 500 + 4% x 2,500 + 5% x 60,330 = 3,126.50
  eq('alabama $75k state tax, all 7,670 subtracted', net('alabama', RUNG).state,
    500 * 0.02 + 2500 * 0.04 + (75000 - 4000 - FED_TAX - 3000) * 0.05);
  // Missouri: 15% of 7,670 = 1,150.50; 75,000 - 16,100 - 1,150.50 = 57,749.50;
  //   262.86 below 9,436 (six 1,348 bands at 0/2/2.5/3/3.5/4/4.5%) + 4.7% x 48,313.50 = 2,533.5945
  eq('missouri $75k state tax, 15% of 7,670 subtracted', net('missouri', RUNG).state,
    1348 * (0.02 + 0.025 + 0.03 + 0.035 + 0.04 + 0.045) + (75000 - 16100 - 0.15 * FED_TAX - 9436) * 0.047);
  // The Oregon $75,000 page says a raise of $58,161 reaches the 9.9% band, not the $60,580 gap in
  // taxable income: past $125,000 of salary the limit falls to 5,250, so at 133,161 taxable is
  // 133,161 - 2,910 - 5,250 = 125,001, one dollar over the edge, and at 133,160 it is exactly 125,000.
  const orTaxable = (salary) => stateTaxableIncome(salary, 'single', taxData.states.oregon, 0,
    ficaTax(salary, 'single', taxData.federal).total, federalIncomeTax(salary, 'single', taxData.federal)).taxable;
  eq('oregon taxable at $133,160 sits on the 9.9% edge', orTaxable(133160), 125000);
  eq('oregon taxable at $133,161 is one dollar into it', orTaxable(133161), 125001);
}

// --- 8. THE RAISE TO THE NEXT BAND WHERE THE DEDUCTION SHRINKS (added 2026-10-02). Wisconsin
// and South Carolina take their standard deduction down as income rises, so a raise adds to
// taxable income twice (once as pay, again as the deduction it removes) and the raise that
// reaches the next band is SMALLER than the gap in taxable income. The pages used to print the
// gap as the raise. Each deduction is written out by hand from its statute.
{
  const taxableAt = (slug, salary) => stateTaxableIncome(salary, 'single', taxData.states[slug], 0,
    ficaTax(salary, 'single', taxData.federal).total, federalIncomeTax(salary, 'single', taxData.federal)).taxable;
  // Wisconsin, Wis. Stat. 71.05(22)(dp): 13,960 less 12% of income over 20,120, whole dollars.
  // The $50,000 page: deduction 13,960 - 3,585 = 10,375, taxable 39,625, so the 5.3% band at
  // 51,950 is 12,325 of taxable income away. The engine leaves out the $700 personal exemption
  // (Wis. Stat. 71.05(23)(b)), so the filer's real taxable income is the engine's less 700 and
  // clears 51,950 only once the engine's figure clears 52,650. The page says $11,630 gets there:
  //   at 61,629: 12% x 41,509 = 4,981.08 -> 4,981 off, deduction 8,979, taxable 52,650, real 51,950 (on the edge)
  //   at 61,630: 12% x 41,510 = 4,981.20 -> 4,981 off, deduction 8,979, taxable 52,651, real 51,951 (one dollar in)
  // Without the exemption it would be $11,005 (61,005: 4,906 off, taxable 51,951), $625 early.
  eq('wisconsin $50k taxable', taxableAt('wisconsin', 50000), 39625);
  eq('wisconsin taxable at $61,629 sits $700 above the 5.3% edge', taxableAt('wisconsin', 61629), 52650);
  eq('wisconsin taxable at $61,630 is one dollar past edge plus exemption', taxableAt('wisconsin', 61630), 52651);
  eq('wisconsin taxable at $61,005 is one dollar into the edge before the exemption', taxableAt('wisconsin', 61005), 51951);
  // South Carolina, S.C. Code 12-6-1140(15): 15,000 less 15,000 x (income over 40,000) / 55,000,
  // the reduction rounded down to $10. The $40,000 page: taxable 25,000, the 5.21% band at 30,000
  // is 5,000 away, and the page says a raise of $3,931 gets there:
  //   at 43,930: 15,000 x 3,930 / 55,000 = 1,071.8 -> 1,070 off, taxable 30,000 (on the edge)
  //   at 43,931: 15,000 x 3,931 / 55,000 = 1,072.1 -> 1,070 off, taxable 30,001 (one dollar in)
  // The $30,000 page needs $10,000 more to reach $40,000 first, so its raise is $13,931.
  eq('south carolina $40k taxable', taxableAt('south-carolina', 40000), 25000);
  eq('south carolina taxable at $43,930 sits on the 5.21% edge', taxableAt('south-carolina', 43930), 30000);
  eq('south carolina taxable at $43,931 is one dollar into it', taxableAt('south-carolina', 43931), 30001);
  // And the built pages print those raises, not the gaps.
  const page = (slug, amount) => {
    try { return readFileSync(join(__dirname, '..', 'dist', `${slug}-take-home-pay-${amount}`, 'index.html'), 'utf8'); }
    catch { return null; }
  };
  const wi50 = page('wisconsin', 50000), sc40 = page('south-carolina', 40000), sc30 = page('south-carolina', 30000);
  if (wi50 && sc40 && sc30) {
    is('wisconsin $50k page prints the $11,630 raise', wi50.includes('a raise of about $11,630 gets you there'), true);
    is('wisconsin $50k page no longer prints the raise without the exemption', wi50.includes('$11,005'), false);
    is('wisconsin $50k page says the raise counts the $700 exemption',
      wi50.includes('counts the $700 personal exemption Wisconsin gives a single filer'), true);
    is('wisconsin $50k page no longer prints the gap as the raise', wi50.includes('A raise of $12,325'), false);
    const wi100 = page('wisconsin', 100000);
    if (wi100) is('wisconsin $100k page prints the $233,421 raise', wi100.includes('a raise of about $233,421 gets you there'), true);
    is('south carolina $40k page prints the $3,931 raise', sc40.includes('a raise of about $3,931 gets you there'), true);
    is('south carolina $30k page prints the $13,931 raise', sc30.includes('a raise of about $13,931 gets you there'), true);
  }
}

// --- 9. THE CAR-LOAN INTEREST PHASE-OUT ROUNDS UP. IRC 163(h)(4)(C)(ii)(I) cuts the $10,000
// allowance "by $200 for each $1,000 (or portion thereof)" of modified AGI over $100,000, so a part
// of a $1,000 counts as a whole one. The ladder used to round the steps DOWN with Math.floor; it
// now prints what the engine computes. The rungs all sit on round thousands, where the two agree,
// so the case that tells them apart is a non-round salary, worked by hand:
//   $120,500: 20,500 over -> 21 steps (the last $500 counts) -> 21 x 200 = 4,200 off -> 5,800 left
//   (rounding down would have counted 20 steps and left 6,000)
{
  const CL = obbba.federal.carLoan;
  const allow = (magi) => carLoanDeduction({ year: Number(taxData.taxYear), filingStatus: 'single', magi,
    interest: CL.interestCap, params: CL });
  eq('car loan $120,500 keeps $5,800 (21 steps, the part step counts)', allow(120500).deduction, 5800, 0);
  is('car loan $120,500 is not the round-down $6,000', allow(120500).deduction === 6000, false);
  // $100,000 is the line itself: nothing over it, nothing cut, so not yet "partially phased out".
  eq('car loan $100,000 keeps the full $10,000', allow(100000).deduction, 10000, 0);
  is('car loan $100,000 is not phased out at all', allow(100000).phasedOut, false);
  // One dollar over is a whole step: 10,000 - 200 = 9,800.
  eq('car loan $100,001 already loses a $200 step', allow(100001).deduction, 9800, 0);
  // $149,001: 49,001 over -> 50 steps -> 10,000 off, so it is gone before $150,000.
  eq('car loan $149,001 is already gone', allow(149001).deduction, 0, 0);
  is('car loan $149,001 is fully phased out', allow(149001).fullyPhasedOut, true);
  eq('car loan $120,000 rung keeps $6,000', allow(120000).deduction, 6000, 0);
  // $149,000: 49,000 over -> 49 steps -> 9,800 off -> 200 left, so the last single MAGI with any
  // allowance is $149,000 and the page says "up to $149,000", not "below $150,000". Joint is the
  // same shape from $200,000: $249,000 keeps $200, $249,001 keeps nothing.
  eq('car loan $149,000 still keeps $200', allow(149000).deduction, 200, 0);
  const allowJ = (magi) => carLoanDeduction({ year: Number(taxData.taxYear), filingStatus: 'married', magi,
    interest: CL.interestCap, params: CL });
  eq('car loan joint $249,000 still keeps $200', allowJ(249000).deduction, 200, 0);
  eq('car loan joint $249,001 is already gone', allowJ(249001).deduction, 0, 0);

  const page = (amount) => {
    try { return readFileSync(join(__dirname, '..', 'dist', `texas-take-home-pay-${amount}`, 'index.html'), 'utf8'); }
    catch { return null; }
  };
  const p100 = page(100000), p120 = page(120000), p150 = page(150000);
  if (p100 && p120 && p150) {
    is('$120,000 page prints the engine allowance', p120.includes('roughly $6,000 of the allowance survives'), true);
    is('$120,000 page says a part of $1,000 counts', p120.includes('counting any part of $1,000 as a whole one'), true);
    is('$120,000 page lists the loan deduction as partly phased out',
      p120.includes('the partially phased-out new-vehicle loan interest deduction'), true);
    is('$100,000 page no longer calls it partly phased out',
      p100.includes('the partially phased-out new-vehicle loan interest deduction'), false);
    is('$100,000 FAQ says the full allowance survives', p100.includes('Yes, the full $10,000 allowance.'), true);
    is('$100,000 FAQ no longer says "all of it"', p100.includes('Yes, all of it.'), false);
    is('$150,000 FAQ says none of it is left', p150.includes('none of it is left at $150,000'), true);
    is('$150,000 page says the deduction runs up to $149,000',
      p150.includes('but only up to $149,000 of modified AGI for a single filer'), true);
    is('$150,000 page no longer says only below $150,000', p150.includes('only below $150,000'), false);
  }
}

// --- 10. ALABAMA'S RAISE, BOTH WAYS AT ONCE (added 2026-10-02). Alabama's standard deduction
// steps down with income (Ala. Code 40-18-15(b)(4): $3,000 less $25 for each $500 over $25,500,
// to a $2,500 floor at $35,500) and it subtracts all of the federal income tax (40-18-15(c)). A
// raise therefore adds the lost deduction to taxable income and takes the extra federal tax off
// it. The pages explained each in its own paragraph as if the other did not exist, and on $30,000
// they said both "rises faster than the bracket rates alone would suggest" and "takes a little
// less of the raise than its band rate suggests". The net, by hand, is less:
//   federal 2026 single: 30,000 -> 13,900 -> 1,240 + 12% x 1,500 = 1,420
//                        40,000 -> 23,900 -> 1,240 + 12% x 11,500 = 2,620
//                        50,000 -> 3,820;  70,000 -> 53,900 -> 5,800 + 22% x 3,500 = 6,570
//   Alabama deduction:   30,000 -> 9 steps of $25 over 25,500 -> 2,775;  40,000 and up -> 2,500
//   Alabama taxable:     30,000 - 4,275 - 1,420 = 24,305;  40,000 - 4,000 - 2,620 = 33,380
//                        50,000 - 4,000 - 3,820 = 42,180;  70,000 - 4,000 - 6,570 = 59,430
//   (each deduction is the chart amount plus the $1,500 personal exemption)
//   Alabama tax, 5% x T - 40 above $3,000: 1,175.25;  1,629.00;  2,069.00;  2,931.50
//   $30,000 -> $40,000: deduction -275, subtraction +1,200, taxable +9,075, tax +453.75 (not 500.00)
//   $30,000 -> $50,000: subtraction +2,400, taxable +17,875
//   $50,000 -> $70,000: subtraction +2,750, taxable +17,250, tax +862.50 (not 1,000.00)
{
  const AL = taxData.states.alabama;
  const parts = (salary) => stateTaxableIncome(salary, 'single', AL, 0,
    ficaTax(salary, 'single', taxData.federal).total, federalIncomeTax(salary, 'single', taxData.federal));
  const alTax = (salary) => computePaycheck({ wage: { type: 'salary', amount: salary }, filingStatus: 'single',
    payFrequency: 'annual', stateSlug: 'alabama' }, taxData).annual.state;
  eq('alabama $30k deduction', parts(30000).standardDeduction, 4275, 0);
  eq('alabama $40k deduction is the floor', parts(40000).standardDeduction, 4000, 0);
  eq('alabama $30k subtraction', parts(30000).federalTaxSubtraction, 1420, 0);
  eq('alabama $40k subtraction', parts(40000).federalTaxSubtraction, 2620, 0);
  eq('alabama $70k subtraction', parts(70000).federalTaxSubtraction, 6570, 0);
  eq('alabama $30k taxable', parts(30000).taxable, 24305, 0);
  eq('alabama $40k taxable', parts(40000).taxable, 33380, 0);
  eq('alabama $50k taxable', parts(50000).taxable, 42180, 0);
  eq('alabama $70k taxable', parts(70000).taxable, 59430, 0);
  eq('alabama tax on the $30k -> $40k raise', alTax(40000) - alTax(30000), 453.75, 0.005);
  eq('alabama tax on the $50k -> $70k raise', alTax(70000) - alTax(50000), 862.50, 0.005);
  is('alabama: the net of both effects is less than the band rate', alTax(40000) - alTax(30000) < 0.05 * 10000, true);

  const page = (amount) => {
    try { return readFileSync(join(__dirname, '..', 'dist', `alabama-take-home-pay-${amount}`, 'index.html'), 'utf8'); }
    catch { return null; }
  };
  const p30 = page(30000), p50 = page(50000);
  if (p30 && p50) {
    is('$30k page measures the raise to $40,000 with both effects',
      p30.includes("On the raise to $40,000 it grows by $1,200, while Alabama's standard deduction plus personal exemption falls by $275, " +
        'so Alabama taxes $9,075 of the $10,000 raise and takes $453.75 of it, not the $500.00 its 5% rate on the ' +
        'whole raise would be.'), true);
    is('$30k deduction paragraph names the subtraction that outweighs it',
      p30.includes('going up to $40,000 takes another $275 of it away. But Alabama also lets you subtract federal ' +
        'income tax, and over that raise the amount subtracted grows by $1,200, which more than makes up for it: ' +
        'Alabama taxable income rises by $9,075 on $10,000 of extra pay, less than the raise itself.'), true);
    is('$30k page no longer says the share rises faster than the bracket rates',
      p30.includes('rises faster than the bracket rates alone would suggest'), false);
    is('$30k page no longer says "a little less of the raise"',
      p30.includes('takes a little less of the raise than its band rate suggests'), false);
    is('$50k deduction paragraph measures the raise from the bottom rung',
      p50.includes('so the $20,000 raise from there to $50,000 took $275 of deduction away, a cost no bracket ' +
        'table shows. Alabama also lets you subtract federal income tax, and over the same raise the amount ' +
        'subtracted grew by $2,400, which more than makes up for it: Alabama taxable income rose by $17,875 on ' +
        '$20,000 of extra pay, less than the raise itself.'), true);
    is('$50k page measures the raise to $70,000',
      p50.includes('On the raise to $70,000 it grows by $2,750, so Alabama taxes $17,250 of the $20,000 raise and ' +
        'takes $862.50 of it, not the $1,000.00 its 5% rate on the whole raise would be.'), true);
    is('$50k page no longer calls the lost deduction the whole story',
      p50.includes('the gap between those two is a real cost of the raise that no bracket table shows'), false);
    is('$50k worth clause names the subtraction',
      p50.includes('The subtraction is worth $191.00 of Alabama income tax at this salary'), true);
  }
}

// --- 12. UTAH'S CREDIT IS DESCRIBED AS A CREDIT (added 2026-10-03). The engine models Utah's
// taxpayer tax credit as the deduction worth the same at 4.45% ($21,708 single), a figure Utah
// never publishes. Pages that printed it implied about $1,704 of tax at $60,000, where Utah charges
// $2,247. Every Utah page now says: 4.45% on every dollar, less a credit that shrinks. The same
// section pins the October presentation fixes: prior-year amounts said to be prior-year, Ohio's
// tiers, Maine's phase-out, and the Oregon transit tax citation.
{
  const DIST = join(__dirname, '..', 'dist');
  const read = (p) => { try { return readFileSync(join(DIST, p, 'index.html'), 'utf8'); } catch { return null; } };
  const visible = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');
  const utahPages = existsSync(DIST) ? readdirSync(DIST).filter((d) => /^utah-/.test(d)) : [];
  if (utahPages.length) {
    const shared = ['bonus-tax-calculator', 'embed/paycheck-calculator', 'embed/bonus-tax-calculator'];
    const leaks = [];
    for (const d of [...utahPages, ...shared]) {
      const h = read(d);
      if (!h) continue;
      if (h.includes('credit-equivalent')) leaks.push(`${d}: credit-equivalent`);
      if (!/^utah-/.test(d)) continue;
      const v = visible(h);
      for (const bad of ['21,708', '21,707', '43,416', 'Utah taxable income', 'Utah subtracts', 'subtracts first',
        'deduction is smaller at', 'not the published figure', 'neither applies to the whole salary']) {
        if (v.includes(bad)) leaks.push(`${d}: "${bad}"`);
      }
    }
    is('no Utah page prints the modelled deduction or calls the credit a deduction', leaks.slice(0, 6).join(' | '), '');
    const pc = read('utah-paycheck-calculator');
    is('Utah paycheck headline: the rate on every dollar, then the credit',
      pc.includes('taxes every dollar of income at the single flat rate of <strong>4.45%</strong>, then subtracts a ' +
        'taxpayer tax credit: up to $966 for single filers and $1,932 for married couples filing jointly. The credit ' +
        'is cut by 1.3 cents for each dollar of income over $18,213 ($36,426 married), so it is gone by about ' +
        '$92,500 ($185,000 married).'), true);
    is('Utah paycheck headline: the $60,000 credit and tax, from the engine',
      pc.includes('a single filer earning $60,000 gets a taxpayer tax credit of about $423, so pays about $2,247 ' +
        'in Utah income tax'), true);
    const p50 = read('utah-take-home-pay-50000');
    const p100 = read('utah-take-home-pay-100000');
    is('Utah $50k method line', p50.includes('4.45% on the whole $50,000 ($2,225), less the $553 taxpayer tax credit → $1,672.'), true);
    is('Utah $50k: the raise from the bottom rung costs credit',
      p50.includes('the same filer keeps $813 of it, so the raise from there to $50,000 costs $260 of credit on top of ' +
        '4.45% of the extra pay'), true);
    is('Utah $50k: the next dollar costs the rate plus the credit cut',
      p50.includes('each extra dollar of pay costs 5.75% in Utah tax, the 4.45% rate plus the 1.3 cents of credit it ' +
        'takes away'), true);
    is('Utah $100k method line', p100.includes('4.45% on the whole $100,000 ($4,450), with the taxpayer tax credit run out ' +
      'at this salary → $4,450.'), true);
    is('Utah hub method clause',
      read('utah-take-home-pay').includes('Utah income tax is 4.45% of the whole salary, less a taxpayer tax credit that ' +
        'shrinks as the ladder climbs, from $813 at $30,000 to $0 at $200,000'), true);
  }
  const vt = read('vermont-paycheck-calculator');
  if (vt) {
    is('Vermont headline says its deduction is the 2025 amount',
      vt.includes('Vermont has not published its 2026 standard deduction plus personal exemption yet, so this page ' +
        'uses its 2025 amounts until it does: $12,950 for single filers'), true);
    is('Vermont headline no longer calls it the 2026 figure',
      vt.includes("For 2026, Vermont's state standard deduction plus personal exemption is"), false);
    const oh = read('ohio-paycheck-calculator');
    is('Ohio headline: 2025 amounts and each tier, including the $2,150 its $60,000 example uses',
      oh.includes('Ohio has not published its 2026 personal exemption yet, so this page uses its 2025 amounts until it ' +
        'does: $2,400 for single filers and $4,800 for married couples filing jointly, stepping down to $2,150 above ' +
        '$40,000 of income and $1,900 above $80,000 ($4,300 and $3,800 for married couples filing jointly), and to ' +
        'nothing from $500,000'), true);
    is('Maine headline says where its deduction starts shrinking',
      read('maine-paycheck-calculator').includes('shrinking above $102,250 of income for single filers and $204,550 ' +
        'for married couples filing jointly'), true);
    is('Rhode Island headline no longer says "to $0 and $0"',
      read('rhode-island-paycheck-calculator').includes('shrinking above $261,000 of income and gone above $290,800'), true);
    is('New Jersey calls its subtraction a personal exemption',
      read('new-jersey-paycheck-calculator').includes("For 2026, New Jersey's state personal exemption is $1,000"), true);
    const or50 = read('oregon-take-home-pay-50000');
    if (or50) {
      is('Oregon ladder cites the transit tax page by name',
        or50.includes('<a href="https://www.oregon.gov/dor/programs/businesses/pages/statewide-transit-tax.aspx" ' +
          'rel="noopener" target="_blank">Oregon Department of Revenue: statewide transit tax</a>'), true);
    }
  }
}

// --- 11. EVERY SOURCE LINK SAYS WHAT IT IS (added 2026-10-02). Most states' own URLs were all
// captioned "<State>: source for the state figures on this page", so Maryland printed that line
// five times over five different documents. The titles now live beside each URL in
// tax-data-2026.json (_sourceTitles); a URL with no title falls back to the bare address. Every
// take-home page is swept: no generic caption, no bare address, no title used twice for
// different links, and no link listed twice.
{
  const DIST = join(__dirname, '..', 'dist');
  const dirs = existsSync(DIST) ? readdirSync(DIST).filter((d) => /-take-home-pay(-\d+)?$/.test(d)) : [];
  let pages = 0, links = 0;
  const bad = [];
  for (const d of dirs) {
    const f = join(DIST, d, 'index.html');
    if (!existsSync(f)) continue;
    const html = readFileSync(f, 'utf8');
    const m = html.match(/<h2 id="sources">Sources<\/h2>\s*<ul>([\s\S]*?)<\/ul>/);
    if (!m) continue;
    pages++;
    const items = [...m[1].matchAll(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((x) => ({ url: x[1], title: x[2] }));
    links += items.length;
    const titles = new Map();
    const urls = new Set();
    for (const { url, title } of items) {
      if (/source for the state figures/i.test(title)) bad.push(`${d}: generic caption on ${url}`);
      if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(title)) bad.push(`${d}: no title for ${url}`);
      if (titles.has(title) && titles.get(title) !== url) bad.push(`${d}: "${title}" on two links`);
      if (urls.has(url)) bad.push(`${d}: ${url} listed twice`);
      titles.set(title, url);
      urls.add(url);
    }
  }
  if (dirs.length) {
    is('take-home pages with a sources list were found', pages > 300, true);
    is('every take-home source link has its own accurate title', bad.slice(0, 5).join(' | '), '');
    is('links were read', links > pages * 5, true);
    const md = readFileSync(join(DIST, 'maryland-take-home-pay-50000', 'index.html'), 'utf8');
    is('Maryland names the statute', md.includes('>Maryland Code, Tax-General 10-217: the standard deduction</a>'), true);
    is('Maryland names the withholding guide',
      md.includes('>Comptroller of Maryland: 2026 Employer Withholding Guide</a>'), true);
  }
}

console.log(`\nSalary-ladder rungs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
