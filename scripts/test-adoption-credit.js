// test-adoption-credit.js — unit tests for the Adoption Tax Credit engine
// (docs/adoption-credit-calculator-spec.md). Run: node scripts/test-adoption-credit.js
//
// All 12 fixtures are from the sourced spec's §4 fixture table, including the
// IRS-worked-example regression anchor (F3, 2025 Instructions line-18 example)
// and the multi-child PER-CHILD-refundable-cap fixture (F10) — the one most
// likely to expose a per-return-instead-of-per-child bug, verified explicitly
// here. The parameter dataset is the REAL shipped file, so every statutory
// dollar ($17,670 cap / $5,120 refundable / $265,080–$305,080 phaseout for
// 2026; $17,280 / $5,000 / $259,190 for 2025) is asserted straight out of
// src/data/adoption-credit-2026.json. The spec's cross-check identities
// (§4 bottom) are asserted on every fixture result.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptionCredit, phaseoutRatio } from '../src/engine/adoption-credit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'adoption-credit-2026.json'), 'utf8'));

let pass = 0, fail = 0;
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL ${name}`); }
}

// Spec §4 cross-check identities — MUST hold for every credit-producing result.
function identities(name, r) {
  ok(`${name} identity: refundableTotal + nonrefundableCurrent = Σ allowed`,
    Math.abs((r.refundableTotal + r.nonrefundableCurrent) - r.allowedTotal) < 0.005);
  for (const c of r.perChild) {
    ok(`${name} identity: allowed ≤ base ≤ capRemaining (child ${c.index})`,
      c.allowed <= c.base + 0.005 && c.base <= c.capRemaining + 0.005);
    ok(`${name} identity: refundable ≤ min(allowed, refundableCap) (child ${c.index})`,
      c.refundable <= Math.min(c.allowed, r.refundableCap) + 0.005);
  }
  // Carryforward never contains refundable dollars, and no vintage survives past
  // yearArose + 5.
  for (const v of r.carryforwardOut) {
    ok(`${name} identity: vintage ${v.yearArose} within 5-yr life`, r.taxYear + 1 <= v.yearArose + (data.carryforwardYears || 5));
  }
}

// --- dataset sanity: every load-bearing figure, from the shipped file --------
is('data: 2026 cap $17,670 (RP 2025-32 §4.04)', data.params['2026'].cap, 17670);
is('data: 2026 refundable cap $5,120 PER CHILD (§4.04(3))', data.params['2026'].refundableCap, 5120);
is('data: 2026 phaseout start $265,080', data.params['2026'].phaseoutStart, 265080);
is('data: 2026 phaseout end $305,080', data.params['2026'].phaseoutEnd, 305080);
is('data: 2026 phaseout range $40,000 (unindexed)', data.params['2026'].phaseoutRange, 40000);
is('data: 2026 §137 exclusion cap $17,670', data.params['2026'].employerExclusionCap, 17670);
is('data: 2025 cap $17,280', data.params['2025'].cap, 17280);
is('data: 2025 refundable cap $5,000 (flat/unindexed)', data.params['2025'].refundableCap, 5000);
is('data: 2025 phaseout start $259,190', data.params['2025'].phaseoutStart, 259190);
is('data: phaseout range is $40,000 fixed = end − start (2026)', data.params['2026'].phaseoutEnd - data.params['2026'].phaseoutStart, 40000);
is('data: phaseout range is $40,000 fixed = end − start (2025)', data.params['2025'].phaseoutEnd - data.params['2025'].phaseoutStart, 40000);
is('data: carryforward 5 years (§23(c)(2))', data.carryforwardYears, 5);
ok('data: 2010–2011 refundability history recorded + "since 2011"/permanent framing', data.history.refundableYears2010_2011 === true && /since 2011/.test(data.history.note) && /permanent/i.test(data.history.note));
ok('data: firstTimeFraming rule documents the "since 2011"/permanent copy (not "first time ever")', /since 2011/.test(data._meta.firstTimeFraming) && /permanent/i.test(data._meta.firstTimeFraming));

// --- phaseout boundary: "in excess of" = strictly greater ---------------------
is('ratio: MAGI exactly at threshold → 0 (not "in excess")', phaseoutRatio(265080, data.params['2026']), 0);
is('ratio: MAGI $1 over threshold → tiny positive', phaseoutRatio(265081, data.params['2026']) > 0, true);
is('ratio: mid-phaseout $285,080 → 0.5', phaseoutRatio(285080, data.params['2026']), 0.5);
is('ratio: at full phaseout $305,080 → 1.0', phaseoutRatio(305080, data.params['2026']), 1);
is('ratio: above full phaseout → capped at 1.0', phaseoutRatio(400000, data.params['2026']), 1);

// === F1: expenses under refundable cap, zero liability — refundable-first =====
{
  const r = adoptionCredit({ taxYear: 2026, magi: 90000, taxLiability: 0, children: [{ qae: 4000 }], data });
  is('F1 allowed $4,000', r.allowedTotal, 4000);
  is('F1 refundable $4,000 (paid despite $0 liability — kills fixed $5,120/$12,550 framing)', r.refundableTotal, 4000);
  is('F1 nonrefundable current $0', r.nonrefundableCurrent, 0);
  is('F1 carryforward out $0', r.carryforwardOutTotal, 0);
  identities('F1', r);
}

// === F2: expenses exceed total cap ===========================================
{
  const r = adoptionCredit({ taxYear: 2026, magi: 100000, taxLiability: 20000, children: [{ qae: 25000 }], data });
  is('F2 base $17,670', r.perChild[0].base, 17670);
  is('F2 refundable $5,120', r.refundableTotal, 5120);
  is('F2 nonrefundable current $12,550', r.nonrefundableCurrent, 12550);
  is('F2 nonrefundable fully used', r.nonrefundableUsed, 12550);
  is('F2 carryforward $0', r.carryforwardOutTotal, 0);
  is('F2 $7,330 never claimable', r.neverClaimableTotal, 7330);
  identities('F2', r);
}

// === F3: IRS's own example (TY2025) — authoritative regression anchor ========
{
  const r = adoptionCredit({ taxYear: 2025, magi: 200000, taxLiability: 10000, children: [{ qae: 20000, specialNeedsFinalThisYear: false }], data });
  is('F3 refundable $5,000 (2025 flat cap)', r.refundableTotal, 5000);
  is('F3 nonrefundable used $10,000', r.nonrefundableUsed, 10000);
  is('F3 carryforward $2,280', r.carryforwardOutTotal, 2280);
  is('F3 carryforward vintage 2025 (expires after TY2030)', r.carryforwardOut[0].yearArose, 2025);
  ok('F3 vintage life = 2025+5 = through TY2030', r.carryforwardOut[0].yearArose + data.carryforwardYears === 2030);
  is('F3 $2,720 never claimable', r.neverClaimableTotal, 2720);
  identities('F3', r);
}

// === F4: MAGI mid-phaseout ===================================================
{
  const r = adoptionCredit({ taxYear: 2026, magi: 285080, taxLiability: 15000, children: [{ qae: 18000 }], data });
  is('F4 ratio 0.500', r.ratio, 0.5);
  is('F4 allowed $8,835', r.allowedTotal, 8835);
  is('F4 refundable $5,120', r.refundableTotal, 5120);
  is('F4 nonrefundable used $3,715', r.nonrefundableUsed, 3715);
  is('F4 carryforward $0', r.carryforwardOutTotal, 0);
  identities('F4', r);
}

// === F5: MAGI at full phaseout ===============================================
{
  const r = adoptionCredit({ taxYear: 2026, magi: 305080, taxLiability: 10000,
    children: [{ qae: 17670 }],
    employer: { benefits: 17670, hasWrittenProgram: true }, data });
  is('F5 ratio 1.000', r.ratio, 1);
  is('F5 allowed $0', r.allowedTotal, 0);
  is('F5 refundable $0', r.refundableTotal, 0);
  is('F5 nonrefundable $0', r.nonrefundableCurrent, 0);
  is('F5 §137 exclusion also $0 (same phaseout)', r.employerExclusion, 0);
  identities('F5', r);
}

// === F6: MAGI exactly at threshold (boundary) ================================
{
  const r = adoptionCredit({ taxYear: 2026, magi: 265080, taxLiability: 10000, children: [{ qae: 10000 }], data });
  is('F6 ratio 0 (not "in excess")', r.ratio, 0);
  is('F6 allowed $10,000', r.allowedTotal, 10000);
  is('F6 refundable $5,120', r.refundableTotal, 5120);
  is('F6 nonrefundable $4,880', r.nonrefundableCurrent, 4880);
  identities('F6', r);
}

// === F7: special needs, near-zero actual expenses ============================
{
  const r = adoptionCredit({ taxYear: 2026, magi: 150000, taxLiability: 6000,
    children: [{ qae: 1000, specialNeedsFinalThisYear: true }], data });
  is('F7 deemed QAE $17,670 (input $1,000 overridden by deeming)', r.perChild[0].qae, 17670);
  is('F7 base $17,670', r.perChild[0].base, 17670);
  is('F7 refundable $5,120', r.refundableTotal, 5120);
  is('F7 nonrefundable used $6,000', r.nonrefundableUsed, 6000);
  is('F7 carryforward $6,550', r.carryforwardOutTotal, 6550);
  is('F7 no over-cap never-claimable (deemed exactly to cap)', r.neverClaimableTotal, 0);
  identities('F7', r);
}

// === F8: multi-year carryforward with expiry (F7 family, L $1,500 2026–2031) ==
{
  // 2026 — the credit year.
  let r = adoptionCredit({ taxYear: 2026, magi: 150000, taxLiability: 1500,
    children: [{ qae: 1000, specialNeedsFinalThisYear: true }], data });
  is('F8 2026 refundable $5,120 paid', r.refundableTotal, 5120);
  is('F8 2026 nonrefundable used $1,500', r.nonrefundableUsed, 1500);
  is('F8 2026 carryforward $11,050 (vintage 2026)', r.carryforwardOutTotal, 11050);
  is('F8 2026 vintage year 2026', r.carryforwardOut[0].yearArose, 2026);
  identities('F8-2026', r);

  // 2027–2031 — draw down $1,500/yr, no new expenses.
  let cf = r.carryforwardOut;
  let usedAcross = 1500; // 2026's $1,500
  for (let y = 2027; y <= 2031; y++) {
    r = adoptionCredit({ taxYear: y, magi: 150000, taxLiability: 1500, children: [], carryforwardIn: cf, data });
    usedAcross = Math.round((usedAcross + r.nonrefundableUsed) * 100) / 100;
    cf = r.carryforwardOut;
  }
  is('F8 2027–2031 used $1,500 each ($7,500) → lifetime nonrefundable used $9,000', usedAcross, 9000);
  is('F8 vintage 2026 expires after TY2031 → $3,550 expired unused', r.expiredThisYear, 3550);
  is('F8 nothing carries past 2031', r.carryforwardOutTotal, 0);
  is('F8 lifetime realized $14,120 (refundable $5,120 + nonrefundable used $9,000)', Math.round((5120 + usedAcross) * 100) / 100, 14120);
  ok('F8 realized $14,120 + expired $3,550 = full $17,670 credit', 14120 + 3550 === 17670);
}

// === F9: employer-assistance coordination ====================================
{
  const r = adoptionCredit({ taxYear: 2026, magi: 120000, taxLiability: 5000,
    children: [{ qae: 20000, employerBenefits: 17670 }],
    employer: { benefits: 17670, hasWrittenProgram: true, exclusionMagi: 120000 }, data });
  is('F9 credit-side QAE = $2,330 (20,000 − 17,670 employer)', r.perChild[0].qae, 2330);
  is('F9 allowed $2,330', r.allowedTotal, 2330);
  is('F9 refundable $2,330', r.refundableTotal, 2330);
  is('F9 nonrefundable $0', r.nonrefundableCurrent, 0);
  is('F9 §137 exclusion $17,670 (separate cap, no double-dip)', r.employerExclusion, 17670);
  identities('F9', r);
}

// === F10: TWO children — PER-CHILD refundable cap (the anti-per-return test) ==
{
  const r = adoptionCredit({ taxYear: 2026, magi: 200000, taxLiability: 1000,
    children: [{ qae: 6000 }, { qae: 6000 }], data });
  is('F10 child A allowed $6,000', r.perChild[0].allowed, 6000);
  is('F10 child B allowed $6,000', r.perChild[1].allowed, 6000);
  is('F10 child A refundable $5,120 (min(6,000, 5,120) PER CHILD)', r.perChild[0].refundable, 5120);
  is('F10 child B refundable $5,120 (min(6,000, 5,120) PER CHILD)', r.perChild[1].refundable, 5120);
  is('F10 refundable total $10,240 — correctly EXCEEDS $5,120 per return', r.refundableTotal, 10240);
  is('F10 nonrefundable current $1,760', r.nonrefundableCurrent, 1760);
  is('F10 nonrefundable used $1,000', r.nonrefundableUsed, 1000);
  is('F10 carryforward $760', r.carryforwardOutTotal, 760);
  // The explicit anti-bug assertions: a per-RETURN cap would give $5,120
  // refundable + $6,880 nonrefundable. This engine must NOT.
  ok('F10 refundable is NOT the per-return $5,120', r.refundableTotal !== 5120);
  ok('F10 nonrefundable is NOT the per-return-bug $6,880', r.nonrefundableCurrent !== 6880);
  ok('F10 note flags the per-child cap explicitly', /per child/i.test(r.notes.join(' ')) && /each/i.test(r.notes.join(' ')));
  identities('F10', r);
}

// === F11: same child, second year of expenses (fresh refundable slice) =======
{
  const r = adoptionCredit({ taxYear: 2026, magi: 100000, taxLiability: 0,
    children: [{ qae: 10000, priorYearClaimed: 10000 }], data });
  is('F11 capRemaining $7,670 (17,670 − 10,000 prior)', r.perChild[0].capRemaining, 7670);
  is('F11 base $7,670', r.perChild[0].base, 7670);
  is('F11 refundable $5,120 (fresh per-year slice, not consumed by 2025 claim)', r.refundableTotal, 5120);
  is('F11 nonrefundable current $2,550', r.nonrefundableCurrent, 2550);
  is('F11 nonrefundable used $0 (L $0)', r.nonrefundableUsed, 0);
  is('F11 all $2,550 carried forward', r.carryforwardOutTotal, 2550);
  identities('F11', r);
}

// === F12: MFS gate ===========================================================
{
  const r = adoptionCredit({ taxYear: 2026, filingStatus: 'mfs', livedApartLast6Months: false,
    magi: 100000, taxLiability: 5000, children: [{ qae: 10000 }], data });
  is('F12 not eligible', r.eligible, false);
  is('F12 gate error', r.error, 'mfs_not_eligible');
  ok('F12 no credit math performed', r.refundableTotal === undefined && r.perChild === undefined);
  ok('F12 carryforward-only MFS exception surfaced', /joint return was filed/i.test(r.notes.join(' ')) && /carryforward/i.test(r.notes.join(' ')));
  // MFS lived-apart exception → proceeds normally.
  const r2 = adoptionCredit({ taxYear: 2026, filingStatus: 'mfs', livedApartLast6Months: true,
    magi: 100000, taxLiability: 5000, children: [{ qae: 10000 }], data });
  is('F12 MFS + lived-apart exception → eligible', r2.eligible, true);
  is('F12 lived-apart refundable $5,120', r2.refundableTotal, 5120);
}

// --- structure / guard checks -------------------------------------------------
is('guard: missing data → missing_data', adoptionCredit({ taxYear: 2026, children: [] }).error, 'missing_data');
is('guard: bad year WITH new expenses → bad_year', adoptionCredit({ taxYear: 2099, children: [{ qae: 5000 }], data }).error, 'bad_year');
{
  // Empty children (pure carryforward draw-down) must not crash.
  const r = adoptionCredit({ taxYear: 2027, magi: 100000, taxLiability: 2000, children: [], carryforwardIn: [{ yearArose: 2026, amount: 5000 }], data });
  is('empty children: refundable $0', r.refundableTotal, 0);
  is('empty children: nonrefundable used $2,000 from carryforward', r.nonrefundableUsed, 2000);
  is('empty children: $3,000 carries on', r.carryforwardOutTotal, 3000);
}
{
  // Negative inputs clamp to 0.
  const r = adoptionCredit({ taxYear: 2026, magi: -5, taxLiability: -100, children: [{ qae: -50 }], data });
  is('guard: negative qae → allowed $0', r.allowedTotal, 0);
  is('guard: negative magi → ratio 0', r.ratio, 0);
}
{
  // Already-expired incoming vintage is dropped, not used.
  const r = adoptionCredit({ taxYear: 2032, magi: 100000, taxLiability: 5000, children: [], carryforwardIn: [{ yearArose: 2026, amount: 4000 }], data });
  is('expired-in guard: 2026 vintage unusable in 2032 → used $0', r.nonrefundableUsed, 0);
  is('expired-in guard: reported as expired-in $4,000', r.carryforwardInExpired, 4000);
}

console.log(`\nAdoption credit engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
