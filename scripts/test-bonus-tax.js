// test-bonus-tax.js — unit tests for the bonus (supplemental-wage) tax engine.
// Encodes all 11 fixtures from docs/bonus-tax-calculator-spec.md §5, computed
// against the SAME paycheck engine + tax-data-2026.json the tool ships, plus the
// state-supplemental-2026.json rates. Also exercises the special code paths
// (CA dual-rate, VT percent-of-federal, WI banded) and the $1M/37% federal edge.
// Run: node scripts/test-bonus-tax.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  computeBonus,
  federalSupplementalWithholding,
  supplementalStateWithholding,
  bonusFicaWithholding,
  wisconsinBandedRate,
  trueTaxOnBonus,
  bracketBaseIncome
} from '../src/engine/bonus-tax.js';
import { federalIncomeTax } from '../src/engine/paycheck-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const taxData = JSON.parse(readFileSync(join(__dirname, '../src/data/tax-data-2026.json'), 'utf8'));
const suppData = JSON.parse(readFileSync(join(__dirname, '../src/data/state-supplemental-2026.json'), 'utf8'));

let pass = 0, fail = 0;
const approx = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
function eq(name, got, want, tol = 0.01) {
  if (approx(got, want, tol)) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${got}, want ${want}`); }
}
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

const run = (input) => computeBonus(input, taxData, suppData);

// --- The 11 sourced fixtures (spec §5) -------------------------------------
// Columns asserted: federal WH, state WH, FICA, total WH, keep-now, true federal
// tax on the bonus, and the income-tax delta (refund + / owe -). All values are
// the paycheck engine's own output, so this doubles as an engine-parity check.

// F1 — TX no-tax, mid earner. 22% WH straddles the 12/22% true bands => refund.
{
  const r = run({ bonus: 10000, regIncome: 60000, filingStatus: 'single', stateSlug: 'texas' });
  eq('F1 fedWH', r.withheld.federal, 2200);
  eq('F1 stateWH', r.withheld.state, 0);
  eq('F1 fica', r.withheld.fica, 765);
  eq('F1 totalWH', r.withheld.total, 2965);
  eq('F1 keep', r.withheld.keep, 7035);
  eq('F1 whPct', r.withheld.pctOfBonus, 0.2965, 1e-4);
  eq('F1 trueFed', r.trueLiability.federal, 1550);
  eq('F1 delta', r.delta, 650);
  is('F1 refund', r.refund, true);
}

// F2 — CA bonus rate 10.23% (special ca_dual).
{
  const r = run({ bonus: 10000, regIncome: 60000, filingStatus: 'single', stateSlug: 'california' });
  eq('F2 fedWH', r.withheld.federal, 2200);
  eq('F2 stateWH', r.withheld.state, 1023);
  eq('F2 fica', r.withheld.fica, 765);
  eq('F2 totalWH', r.withheld.total, 3988);
  eq('F2 keep', r.withheld.keep, 6012);
  eq('F2 trueFed', r.trueLiability.federal, 1550);
  is('F2 stateMethod', r.withheld.stateMethod, 'special');
}

// F3 — NY own-supp 11.7% (flat). Reg 90k keeps the bonus in the 22% band => fed matches.
{
  const r = run({ bonus: 10000, regIncome: 90000, filingStatus: 'single', stateSlug: 'new-york' });
  eq('F3 fedWH', r.withheld.federal, 2200);
  eq('F3 stateWH', r.withheld.state, 1170);
  eq('F3 fica', r.withheld.fica, 765);
  eq('F3 totalWH', r.withheld.total, 4135);
  eq('F3 keep', r.withheld.keep, 5865);
  eq('F3 trueFed', r.trueLiability.federal, 2200);
}

// F4 — IL flat 4.95% via the regular/aggregate method (state WH == true state).
{
  const r = run({ bonus: 10000, regIncome: 60000, filingStatus: 'single', stateSlug: 'illinois' });
  eq('F4 fedWH', r.withheld.federal, 2200);
  eq('F4 stateWH', r.withheld.state, 495);
  eq('F4 fica', r.withheld.fica, 765);
  eq('F4 totalWH', r.withheld.total, 3460);
  eq('F4 keep', r.withheld.keep, 6540);
  eq('F4 trueFed', r.trueLiability.federal, 1550);
  eq('F4 trueState', r.trueLiability.state, 495); // regular method: withheld == true
  eq('F4 delta', r.delta, 650);
  is('F4 stateMethod', r.withheld.stateMethod, 'regular');
}

// F5 — PA flat 3.07% (regular), 12%-bracket earner => big refund.
{
  const r = run({ bonus: 5000, regIncome: 45000, filingStatus: 'single', stateSlug: 'pennsylvania' });
  eq('F5 fedWH', r.withheld.federal, 1100);
  eq('F5 stateWH', r.withheld.state, 153.50);
  eq('F5 fica', r.withheld.fica, 382.50);
  eq('F5 totalWH', r.withheld.total, 1636);
  eq('F5 keep', r.withheld.keep, 3364);
  eq('F5 trueFed', r.trueLiability.federal, 600);
  eq('F5 delta', r.delta, 500);
  is('F5 refund', r.refund, true);
}

// F6 — NM own-supp 5.9% (flat). Bonus stays in 22% => fed matches.
{
  const r = run({ bonus: 8000, regIncome: 70000, filingStatus: 'single', stateSlug: 'new-mexico' });
  eq('F6 fedWH', r.withheld.federal, 1760);
  eq('F6 stateWH', r.withheld.state, 472);
  eq('F6 fica', r.withheld.fica, 612);
  eq('F6 totalWH', r.withheld.total, 2844);
  eq('F6 keep', r.withheld.keep, 5156);
  eq('F6 trueFed', r.trueLiability.federal, 1760);
}

// F7 — OH own-supp (flat), refund. NOTE: the spec's 3.5% was the 2025 rate; the
// 2026 Ohio supplemental rate dropped to 2.75% (Ohio Admin. Rule 5703-7-10, flat-
// tax alignment), independently confirmed 2026-07-11 — so this fixture uses 2.75%.
{
  const r = run({ bonus: 3000, regIncome: 55000, filingStatus: 'single', stateSlug: 'ohio' });
  eq('F7 fedWH', r.withheld.federal, 660);
  eq('F7 stateWH', r.withheld.state, 82.50); // 3000 * 2.75%
  eq('F7 fica', r.withheld.fica, 229.50);
  eq('F7 totalWH', r.withheld.total, 972.00);
  eq('F7 keep', r.withheld.keep, 2028.00);
  eq('F7 trueFed', r.trueLiability.federal, 360);
}

// F8 — VT special: 30% of the FEDERAL withholding (0.30 * 2200 = 660), not of the bonus.
{
  const r = run({ bonus: 10000, regIncome: 60000, filingStatus: 'single', stateSlug: 'vermont' });
  eq('F8 fedWH', r.withheld.federal, 2200);
  eq('F8 stateWH', r.withheld.state, 660);
  eq('F8 fica', r.withheld.fica, 765);
  eq('F8 totalWH', r.withheld.total, 3625);
  eq('F8 keep', r.withheld.keep, 6375);
  eq('F8 trueFed', r.trueLiability.federal, 1550);
  is('F8 stateMethod', r.withheld.stateMethod, 'special');
}

// F9 — $1.5M edge, TX. 22% to $1M then 37%; SS capped; true 35-37% => big owe.
{
  const r = run({ bonus: 1500000, regIncome: 300000, filingStatus: 'single', stateSlug: 'texas' });
  eq('F9 fedWH', r.withheld.federal, 405000);
  eq('F9 stateWH', r.withheld.state, 0);
  eq('F9 fica', r.withheld.fica, 35250);
  eq('F9 totalWH', r.withheld.total, 440250);
  eq('F9 keep', r.withheld.keep, 1059750);
  eq('F9 trueFed', r.trueLiability.federal, 547866);
  eq('F9 delta', r.delta, -142866);
  is('F9 owe', r.refund, false);
}

// F10 — low earner refund, TX.
{
  const r = run({ bonus: 5000, regIncome: 30000, filingStatus: 'single', stateSlug: 'texas' });
  eq('F10 fedWH', r.withheld.federal, 1100);
  eq('F10 fica', r.withheld.fica, 382.50);
  eq('F10 totalWH', r.withheld.total, 1482.50);
  eq('F10 keep', r.withheld.keep, 3517.50);
  eq('F10 trueFed', r.trueLiability.federal, 600);
  eq('F10 delta', r.delta, 500);
}

// F11 — high earner owe-more, TX (35% real > 22% WH).
{
  const r = run({ bonus: 50000, regIncome: 500000, filingStatus: 'single', stateSlug: 'texas' });
  eq('F11 fedWH', r.withheld.federal, 11000);
  eq('F11 fica', r.withheld.fica, 1175);
  eq('F11 totalWH', r.withheld.total, 12175);
  eq('F11 keep', r.withheld.keep, 37825);
  eq('F11 trueFed', r.trueLiability.federal, 17500);
  eq('F11 delta', r.delta, -6500);
  is('F11 owe', r.refund, false);
}

// --- Federal 22/37 split, direct ------------------------------------------
{
  const fed = suppData.federal;
  eq('fed 500k bonus', federalSupplementalWithholding(500000, 0, fed), 110000);
  eq('fed $1M exact', federalSupplementalWithholding(1000000, 0, fed), 220000);
  eq('fed 1.5M', federalSupplementalWithholding(1500000, 0, fed), 405000); // 1M*.22 + .5M*.37
  eq('fed with ytd', federalSupplementalWithholding(500000, 800000, fed), 200000*0.22 + 300000*0.37); // only 200k room at 22%
}

// --- CA dual rate: 6.6% "other" supplemental path --------------------------
{
  const r = run({ bonus: 10000, regIncome: 60000, filingStatus: 'single', stateSlug: 'california', paymentType: 'other' });
  eq('CA other 6.6%', r.withheld.state, 660);
}

// --- VT deferred-comp alt rate present in data -----------------------------
{
  is('VT special flag', suppData.states.vermont.special, 'pct_of_federal');
  eq('VT deferred rate', suppData.states.vermont.rateDeferredComp, 0.06);
}

// --- WI banded rate lookup -------------------------------------------------
{
  const wi = suppData.states.wisconsin;
  eq('WI band1 (<12,760)', wisconsinBandedRate(10000, wi.bands), 0.0354);
  eq('WI band2 (12,760-25,520)', wisconsinBandedRate(20000, wi.bands), 0.0465);
  eq('WI band3 (25,520-280,950)', wisconsinBandedRate(100000, wi.bands), 0.053);
  eq('WI band4 (>280,950)', wisconsinBandedRate(400000, wi.bands), 0.0765);
  // Boundary: Pub W-166 bands are "at least X, but LESS THAN Y" — an exact
  // threshold falls in the HIGHER band, not the lower one.
  eq('WI boundary $12,760 -> band2', wisconsinBandedRate(12760, wi.bands), 0.0465);
  eq('WI boundary $25,520 -> band3', wisconsinBandedRate(25520, wi.bands), 0.053);
  eq('WI boundary $280,950 -> band4', wisconsinBandedRate(280950, wi.bands), 0.0765);
  eq('WI just under $12,760 -> band1', wisconsinBandedRate(12759, wi.bands), 0.0354);
  // computeBonus uses annual gross (reg+bonus) to pick the band.
  const r = run({ bonus: 10000, regIncome: 60000, filingStatus: 'single', stateSlug: 'wisconsin' });
  eq('WI bonus WH', r.withheld.state, 10000 * 0.053); // 70k gross -> band3
  is('WI stateMethod', r.withheld.stateMethod, 'special');
}

// --- Aggregate method reuses the graduated federal engine ------------------
{
  const flat = run({ bonus: 10000, regIncome: 60000, filingStatus: 'single', stateSlug: 'texas' });
  const agg = run({ bonus: 10000, regIncome: 60000, filingStatus: 'single', stateSlug: 'texas', method: 'aggregate' });
  // aggregate federal WH == the true federal tax on the bonus (annualized)
  eq('agg fedWH == trueFed', agg.withheld.federal, flat.trueLiability.federal);
}

// --- none-method states withhold 0 state and never over/under on state -----
{
  for (const slug of ['alaska', 'florida', 'nevada', 'new-hampshire', 'south-dakota', 'tennessee', 'texas', 'washington', 'wyoming']) {
    const r = run({ bonus: 10000, regIncome: 60000, filingStatus: 'single', stateSlug: slug });
    eq(`${slug} stateWH 0`, r.withheld.state, 0);
    eq(`${slug} trueState 0`, r.trueLiability.state, 0);
  }
}

// --- FICA: SS caps at the wage base; additional Medicare on the over-threshold slice
{
  const f = bonusFicaWithholding(1500000, 300000, 'single', taxData.federal);
  eq('FICA SS capped 0', f.socialSecurity, 0); // reg already over $184,500
  eq('FICA total F9', f.total, 35250);
}

// --- Structural: 51 jurisdictions, buckets sum correctly -------------------
{
  const st = suppData.states;
  const slugs = Object.keys(st);
  is('51 jurisdictions', slugs.length, 51);
  const count = (m) => slugs.filter((s) => st[s].method === m).length;
  is('none = 9', count('none'), 9);
  // 2026-07-29: maryland moved regular -> flat 6.5%, so flat 19->20 and regular 20->19. The
  // Comptroller's 2026 Employer Withholding Guide gives a flat 6.5% state rate on a lump-sum
  // annual bonus (county piggyback rides on top and is not modelled). These counts are a
  // deliberate tripwire on silent method churn, so they move only with a stated reason.
  // 2026-08-02: michigan moved regular -> flat 4.25%, so flat 20->21 and regular 19->18.
  // Michigan Form 446 (2026 Michigan Income Tax Withholding Guide, Rev. 02-26): "Bonuses and
  // other payments of employee compensation made separately from regular payroll payments are
  // subject to Michigan income tax withholding. The withholding amount equals the payment amount
  // multiplied by 4.25 percent (0.0425). Do not make any adjustment for exemptions." That is a
  // published separate-payment flat rate, not the aggregate method. Only the Rev. 02-26 edition was
  // read (michigan.gov returns 403 to automated fetch of older editions, so how far back the same
  // sentence runs is unverified). The entry was simply mis-bucketed here, its source read
  // "repoTaxData" and it carried no source URL.
  is('flat = 21', count('flat'), 21);
  is('regular = 18', count('regular'), 18);
  is('special = 3', count('special'), 3);
  is('buckets cover all 51', count('none') + count('flat') + count('regular') + count('special'), 51);
  // every entry has verified + source; flagged ones carry singleSourced
  for (const s of slugs) {
    if (typeof st[s].verified !== 'boolean') { fail++; console.error(`FAIL ${s} missing verified`); } else pass++;
    if (!st[s].source) { fail++; console.error(`FAIL ${s} missing source`); } else pass++;
  }
}

// --- Cross-check: computeBonus trueFed == the engine primitive directly -----
{
  const fed = taxData.federal;
  const direct = federalIncomeTax(70000, 'single', fed) - federalIncomeTax(60000, 'single', fed);
  const viaTrue = trueTaxOnBonus(10000, 60000, 'single', taxData.states.texas, fed).federal;
  eq('trueTaxOnBonus parity', viaTrue, direct);
}

// --- MARRIED FILING JOINTLY: the household income question -------------------
// Added 2026-08-02 with the household card. A joint return is taxed on BOTH
// incomes at once, so running the married brackets and the $32,200 married
// standard deduction on one spouse's pay invented a refund. The bracket math now
// takes the household figure; FICA never does, because Social Security stops at
// a wage base PER PERSON and the extra 0.9% Medicare is withheld on ONE person's
// wages. Every figure below is derived by hand from src/data/tax-data-2026.json
// (2026 MFJ standard deduction $32,200; MFJ bands 10% to $24,800, 12% to
// $100,800, 22% to $211,400, 24% to $403,550; SS 6.2% to the $184,500 wage base;
// Medicare 1.45%; the extra 0.9% above $250,000 for a joint filer) and, for
// Montana, its tax-data entry (married standard deduction $32,200; 4.7% to
// $95,000 then 5.65%) plus its 5% flat supplemental rate from
// state-supplemental-2026.json. No new tax parameter is introduced here.

// M1: the defect case, Montana. Own pay 70,000, household 140,000, bonus 10,000.
// HAND DERIVATION
//   federal, on the HOUSEHOLD: taxable 140,000 - 32,200 = 107,800, and with the
//     bonus 150,000 - 32,200 = 117,800. Both sit in the 22% band (100,800 to
//     211,400), so the true federal tax on the bonus is 10,000 x 0.22 = 2,200.
//   federal withheld: the flat supplemental rate, 10,000 x 0.22 = 2,200.
//   Montana, on the HOUSEHOLD: taxable 107,800 -> 117,800, both above 95,000, so
//     10,000 x 0.0565 = 565. Withheld is Montana's flat 5% of the bonus = 500.
//   FICA, on the PERSON: 70,000 is under the 184,500 wage base and the whole
//     bonus fits under it, so SS = 10,000 x 0.062 = 620, Medicare =
//     10,000 x 0.0145 = 145, and 70,000 + 10,000 is under 250,000 so no extra
//     0.9%. Total 765.
//   delta = (2,200 + 500) - (2,200 + 565) = -65, i.e. 65 still owed.
{
  const r = run({ bonus: 10000, regIncome: 70000, householdIncome: 140000, filingStatus: 'married', stateSlug: 'montana' });
  eq('M1 taxBase is the household', r.taxBase, 140000);
  is('M1 usesHousehold', r.usesHousehold, true);
  eq('M1 trueFed on 140k', r.trueLiability.federal, 2200);
  eq('M1 trueState on 140k', r.trueLiability.state, 565);
  eq('M1 fedWH unchanged', r.withheld.federal, 2200);
  eq('M1 stateWH unchanged', r.withheld.state, 500);
  eq('M1 fica on own pay', r.withheld.fica, 765);
  eq('M1 ss on own pay', r.withheld.ficaBreakdown.socialSecurity, 620);
  eq('M1 delta', r.delta, -65);
  is('M1 owes', r.refund, false);
}

// M1b: the same shape where FICA and the brackets DISAGREE, so the per-person
// rule is actually under test. Texas (no state tax), own pay 180,000, household
// 360,000, bonus 10,000.
// HAND DERIVATION
//   Social Security: only 184,500 - 180,000 = 4,500 of the bonus is still under
//     the wage base, so SS = 4,500 x 0.062 = 279. On the household figure there
//     would be no room at all and SS would be 0, which is the wrong answer: the
//     wage base is per person.
//   Medicare 10,000 x 0.0145 = 145. Extra 0.9%: 180,000 + 10,000 = 190,000 is
//     under the 250,000 joint threshold, so none. FICA total 424.
//   federal, on the HOUSEHOLD: taxable 360,000 - 32,200 = 327,800 -> 337,800,
//     both inside the 24% band (211,400 to 403,550), so 10,000 x 0.24 = 2,400.
//   Withheld 2,200 flat, so delta = 2,200 - 2,400 = -200.
{
  const r = run({ bonus: 10000, regIncome: 180000, householdIncome: 360000, filingStatus: 'married', stateSlug: 'texas' });
  eq('M1b ss is per person', r.withheld.ficaBreakdown.socialSecurity, 279);
  eq('M1b addl medicare per person', r.withheld.ficaBreakdown.additionalMedicare, 0);
  eq('M1b fica total', r.withheld.fica, 424);
  eq('M1b trueFed on 360k', r.trueLiability.federal, 2400);
  eq('M1b delta', r.delta, -200);
}

// M2: married with NO household figure is byte-identical to the behaviour that
// shipped before the input existed, and it is the single-earner answer.
// HAND DERIVATION (Montana, own pay 70,000, bonus 10,000)
//   federal: taxable 37,800 -> 47,800, both in the 12% band (24,800 to 100,800),
//     so 10,000 x 0.12 = 1,200.
//   Montana: taxable 37,800 -> 47,800, both under 95,000, so 10,000 x 0.047 = 470.
//   delta = (2,200 + 500) - (1,200 + 470) = 1,030 coming back.
{
  const base = { bonus: 10000, regIncome: 70000, filingStatus: 'married', stateSlug: 'montana' };
  const r = run(base);
  eq('M2 trueFed single-earner', r.trueLiability.federal, 1200);
  eq('M2 trueState single-earner', r.trueLiability.state, 470);
  eq('M2 delta', r.delta, 1030);
  is('M2 refund', r.refund, true);
  eq('M2 taxBase is own pay', r.taxBase, 70000);
  is('M2 usesHousehold', r.usesHousehold, false);
  // The three ways of not answering the question all mean the same thing, and
  // none of them may differ from the run that never had the key at all.
  const asJson = (x) => JSON.stringify(run(Object.assign({}, base, x)));
  is('M2 absent == 0', asJson({ householdIncome: 0 }), JSON.stringify(r));
  is('M2 absent == empty string', asJson({ householdIncome: '' }), JSON.stringify(r));
  is('M2 absent == undefined', asJson({ householdIncome: undefined }), JSON.stringify(r));
}

// M3: the clamp, and what the pages are then allowed to SAY about it.
// A household cannot earn less than the person in it, so a figure below the pay
// already entered is replaced by that pay, and the answer is the single-earner one.
//
// usesHousehold IS FALSE HERE. It used to be true whenever the box held anything at
// all, on the reasoning that the card had been answered. That let the wizard print
// "figured on the $90,000 the two of you earn together" for this exact input, where
// $90,000 is the visitor's OWN pay and the only household figure they ever typed was
// $50,000, a number the same screen was showing back to them on their summary chip.
// The flag now means "the household figure became the base", which is the only
// question the copy keyed on it is really asking.
//
// DERIVATION of the semantics, not of a tax figure: bracketBaseIncome returns
// max(reg, hh) for a joint filer, so the base moved off reg if and only if hh > reg.
// At hh == reg nothing moved either, so that is false too: the sentence "worked out
// on what the two of you earn together" would be true by coincidence, not because
// the figure was used, and the clamped-case sentence covers it correctly instead.
{
  const own = run({ bonus: 10000, regIncome: 90000, filingStatus: 'married', stateSlug: 'montana' });
  const under = run({ bonus: 10000, regIncome: 90000, householdIncome: 50000, filingStatus: 'married', stateSlug: 'montana' });
  eq('M3 clamped taxBase', under.taxBase, 90000);
  eq('M3 clamped trueFed == own-pay trueFed', under.trueLiability.federal, own.trueLiability.federal);
  eq('M3 clamped delta == own-pay delta', under.delta, own.delta);
  // The base never moved, so no page may claim a household figure was used.
  is('M3 usesHousehold is false when the figure was clamped away', under.usesHousehold, false);
  // Exactly equal is the same story: nothing moved.
  const equalHh = run({ bonus: 10000, regIncome: 90000, householdIncome: 90000, filingStatus: 'married', stateSlug: 'montana' });
  is('M3 usesHousehold is false when the figure equals own pay', equalHh.usesHousehold, false);
  // One dollar above own pay is the first input that genuinely moves the base.
  const overHh = run({ bonus: 10000, regIncome: 90000, householdIncome: 90001, filingStatus: 'married', stateSlug: 'montana' });
  is('M3 usesHousehold is true one dollar above own pay', overHh.usesHousehold, true);
  eq('M3 that base is the household figure', overHh.taxBase, 90001);
  // And the helper itself, directly.
  eq('M3 clamp helper below', bracketBaseIncome(90000, 'married', 50000), 90000);
  eq('M3 clamp helper equal', bracketBaseIncome(90000, 'married', 90000), 90000);
  eq('M3 clamp helper above', bracketBaseIncome(90000, 'married', 150000), 150000);
  eq('M3 clamp helper negative', bracketBaseIncome(90000, 'married', -5), 90000);
}

// M4: a household figure is ignored by every filing status but married. Both
// of the others are pinned, because both have brackets and a standard deduction
// of their own and neither is ever a two-person return.
{
  for (const status of ['single', 'head_of_household']) {
    const without = run({ bonus: 10000, regIncome: 70000, filingStatus: status, stateSlug: 'montana' });
    const with_ = run({ bonus: 10000, regIncome: 70000, householdIncome: 140000, filingStatus: status, stateSlug: 'montana' });
    is(`M4 ${status} ignores householdIncome`, JSON.stringify(with_), JSON.stringify(without));
    eq(`M4 ${status} taxBase is own pay`, with_.taxBase, 70000);
    is(`M4 ${status} usesHousehold false`, with_.usesHousehold, false);
    eq(`M4 ${status} clamp helper`, bracketBaseIncome(70000, status, 140000), 70000);
  }
}

// M5: trueTaxOnBonus takes the same optional argument, and omitting it is the
// pre-existing behaviour to the cent.
{
  const fed = taxData.federal;
  const mt = taxData.states.montana;
  eq('M5 household base', trueTaxOnBonus(10000, 70000, 'married', mt, fed, 140000).federal, 2200);
  eq('M5 omitted base', trueTaxOnBonus(10000, 70000, 'married', mt, fed).federal, 1200);
  eq('M5 zero base', trueTaxOnBonus(10000, 70000, 'married', mt, fed, 0).federal, 1200);
}

// --- MASSACHUSETTS: the FICA-paid deduction reaches the bonus tool ------------
// Added 2026-08-02. Massachusetts deducts the FICA the employee actually paid,
// capped at $2,000 (M.G.L. c.62 s.3(B)(a)(3)), and trueTaxOnBonus used to hand
// stateIncomeTax a zero for it at BOTH income levels on the theory that a constant
// cancels out of a difference. It is not a constant below the cap: 7.65% of wages
// only reaches $2,000 at about $26,144, so under that the deduction still grows
// with income and the difference keeps a share of it.
//
// HAND DERIVATION, every figure from src/data/tax-data-2026.json (MA: single
// standard deduction $4,400, flat 5% to $1,107,750, ficaPaidDeduction cap $2,000;
// federal FICA: SS 6.2% to the $184,500 wage base, Medicare 1.45%, extra 0.9% over
// $200,000 single). Own pay 20,000, bonus 10,000, single.
//
//   FICA the employee paid, on their OWN wages, before the bonus:
//     SS       20,000 x 0.062  = 1,240.00   (well under the 184,500 wage base)
//     Medicare 20,000 x 0.0145 =   290.00
//     extra 0.9%: 20,000 is under 200,000, so 0.00
//     ficaPaid1                = 1,530.00
//   and after the bonus, on 30,000:
//     SS       30,000 x 0.062  = 1,860.00
//     Medicare 30,000 x 0.0145 =   435.00
//     ficaPaid2                = 2,295.00
//
//   MA tax at 20,000: taxable 20,000 - 4,400 = 15,600, less min(2,000, 1,530)
//     = 1,530, so 14,070 x 0.05 = 703.50.
//   MA tax at 30,000: taxable 30,000 - 4,400 = 25,600, less min(2,000, 2,295)
//     = 2,000 (THE CAP BINDS HERE AND NOT BELOW), so 23,600 x 0.05 = 1,180.00.
//   true MA tax on the bonus = 1,180.00 - 703.50 = 476.50.
//
//   With the argument left at zero it was 1,280.00 - 780.00 = 500.00, i.e. the old
//   answer overstated the state tax on this bonus by 23.50, exactly 5% of the
//   470.00 of deduction the filer gains by earning the bonus.
{
  const r = run({ bonus: 10000, regIncome: 20000, filingStatus: 'single', stateSlug: 'massachusetts' });
  eq('MA1 true state tax on the bonus is FICA-aware', r.trueLiability.state, 476.50);
  // The withheld column is NOT FICA-aware and must not be: it is what comes off the
  // check on payday, and an employer's withholding tables do not carry a Form 1 line
  // 11 deduction the filer claims on the return. So Massachusetts genuinely
  // over-withholds here, and the 23.50 gap is a real refund, not a rounding artifact.
  eq('MA1 withheld state tax is the plain 5% aggregate delta', r.withheld.state, 500);
  eq('MA1 the gap shows up as delta', r.delta - (r.withheld.federal - r.trueLiability.federal), 23.50);
  // Above the crossover the cap binds at BOTH ends and the deduction really does
  // cancel, so a high earner's answer is unchanged by this fix.
  const hi = run({ bonus: 10000, regIncome: 90000, filingStatus: 'single', stateSlug: 'massachusetts' });
  eq('MA2 above the crossover the deduction cancels', hi.trueLiability.state, 500);
  eq('MA2 and matches the withheld column', hi.withheld.state, 500);
}

console.log(`\nbonus-tax: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
