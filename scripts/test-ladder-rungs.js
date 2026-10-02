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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computePaycheck, stateTaxableIncome, federalIncomeTax, ficaTax } from '../src/engine/paycheck-engine.js';
import { LADDER_SALARIES } from '../backend/mcp-server/tools.js';

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
//   ohio       a 0% opening band PLUS ORC 5747.02(A)(3)'s flat $332 base amount
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
  // Ohio subtracts nothing, so taxable is the whole salary.
  const ohTax = (75000 - 26050) * 0.0275 + 332;
  eq('ohio state tax includes the statutory $332', oh.state, ohTax);
  eq('ohio state tax', oh.state, 1678.125);
  eq('ohio take-home', oh.net, 75000 - FED_TAX - SS - MED - ohTax);
}
{
  const ca = net('california', RUNG);
  const caTaxable = 75000 - 5706;
  const caTax = 11079 * 0.01 + (26264 - 11079) * 0.02 + (41452 - 26264) * 0.04
    + (57542 - 41452) * 0.06 + (caTaxable - 57542) * 0.08;
  eq('california income tax', ca.state, caTax);
  eq('california income tax', ca.state, 2927.57);
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
  // California crosses its own 8% -> 9.3% edge between the rung and $80,000, so
  // the two steps are NOT equal there. The $75,000 page prints both.
  const c70 = net('california', 70000).net, c75 = net('california', 75000).net, c80 = net('california', 80000).net;
  is('california keeps less of the step above than the step below', (c80 - c75) < (c75 - c70), true);
  eq('california step up from $70,000', c75 - c70, 3052.9, 0.5);
  eq('california step on to $80,000', c80 - c75, 3032.36, 0.5);
}

// --- 7. THE FEDERAL-TAX SUBTRACTION on the $75,000 rung (added 2026-10-02). Alabama, Missouri
// and Oregon subtract (some of) the federal income tax, FED_TAX = 7,670 above, from the income
// they tax. Written out by hand from each state's schedule.
{
  // Oregon: 75,000 - 2,910 - 7,670 (under the 8,750 limit) = 64,420;
  //   4.75% x 4,550 + 6.75% x 6,850 + 8.75% x 53,020 = 216.125 + 462.375 + 4,639.25 = 5,317.75
  eq('oregon $75k state tax, all 7,670 subtracted', net('oregon', RUNG).state,
    4550 * 0.0475 + 6850 * 0.0675 + (75000 - 2910 - FED_TAX - 11400) * 0.0875);
  // Alabama: deduction at its 2,500 floor; 75,000 - 2,500 - 7,670 = 64,830;
  //   2% x 500 + 4% x 2,500 + 5% x 61,830 = 3,201.50
  eq('alabama $75k state tax, all 7,670 subtracted', net('alabama', RUNG).state,
    500 * 0.02 + 2500 * 0.04 + (75000 - 2500 - FED_TAX - 3000) * 0.05);
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

console.log(`\nSalary-ladder rungs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
