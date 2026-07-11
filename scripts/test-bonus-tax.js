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
  trueTaxOnBonus
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
  is('flat = 19', count('flat'), 19);
  is('regular = 20', count('regular'), 20);
  is('special = 3', count('special'), 3);
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

console.log(`\nbonus-tax: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
