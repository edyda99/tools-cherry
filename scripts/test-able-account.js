// test-able-account.js — unit tests for the ABLE account contribution limit
// engine (docs/able-account-calculator-spec.md).
// Run: node scripts/test-able-account.js
//
// All 12 fixtures are from the sourced spec's §4 fixture table (TY 2026, FPL
// set per the spec's §1.4 decision = the Jan-2025 HHS guidelines), plus the
// spec §3.3 equivalence-note proof obligation (compact vs. decomposed excess,
// exercised through the fixture-11 spill branch), the 3-bucket state lookup,
// the onset gate edges, and input guards. The limits dataset is the REAL
// shipped file, so the statutory dollars ($20,000 base / $15,650 / $19,550 AK
// / $17,990 HI / $19,000 gift exclusion / 6% excise / onset 46) are asserted
// straight out of src/data/able-limits-2026.json.
//
// ALTERNATE EXPECTATIONS (spec §7.1 / §4 cross-check note — commented, NOT
// live): if the FPL-year ambiguity resolves to the 2026-guideline reading
// ($15,960 / $19,950 AK / $18,360 HI, 91 FR 1797 — kept in the dataset's
// stripped `_alternateFpl2026Reading` key), flip the dataset's
// ableToWork.fplOnePerson and these fixtures change to:
//   F4:  bonusCap 15,960  totalLimit 35,960  excess 0
//   F5:  unchanged (bonus binds at compensation $6,000, below either FPL)
//   F7:  bonusCap 19,950  totalLimit 39,950  excess 0   (AK)
//   F8:  bonusCap 18,360  totalLimit 38,360  excess 0   (HI)
//   F11: bonusCap 15,960  totalLimit 35,960  excess 2,040
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ableContribution, fplBucket, onsetEligible } from '../src/engine/able-contribution.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const limits = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'able-limits-2026.json'), 'utf8'));

let pass = 0, fail = 0;
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL ${name}`); }
}

// --- dataset sanity: every load-bearing figure, from the shipped file ----------
is('data: base limit $20,000 (Rev. Proc. 2025-32 §3.34)', limits.baseLimit, 20000);
is('data: gift-tax exclusion $19,000 — MUST differ from the base', limits.giftTaxExclusion, 19000);
ok('data: base ≠ gift exclusion (OBBBA §70115 decoupling)', limits.baseLimit !== limits.giftTaxExclusion);
is('data: FPL 48+DC $15,650', limits.ableToWork.fplOnePerson.contiguousDC, 15650);
is('data: FPL Alaska $19,550', limits.ableToWork.fplOnePerson.AK, 19550);
is('data: FPL Hawaii $17,990', limits.ableToWork.fplOnePerson.HI, 17990);
is('data: FPL guideline year 2025 (spec §1.4 decision)', limits.ableToWork.fplGuidelineYear, 2025);
ok('data: ABLE-to-Work flagged permanent (OBBBA §70115)', limits.ableToWork.permanent === true);
is('data: onset age limit 46 (SECURE 2.0 §124)', limits.eligibility.onsetAgeLimit, 46);
is('data: 6% excise rate', limits.excess.exciseRate, 0.06);
is('data: 2025 comparison base $19,000', limits.comparison2025.baseLimit, 19000);
is('data: 2025 comparison onset age 26', limits.comparison2025.onsetAgeLimit, 26);
is('data: 2025 comparison FPL 48+DC $15,060 (final Rev. Apr 2025 instr.)', limits.comparison2025.fplOnePerson.contiguousDC, 15060);
ok('data: §7.1 alternate 2026-guideline set present but NOT live (stripped _ key)',
  limits.ableToWork._alternateFpl2026Reading
  && limits.ableToWork._alternateFpl2026Reading.fplOnePerson.contiguousDC === 15960
  && limits.ableToWork._alternateFpl2026Reading.fplOnePerson.AK === 19950
  && limits.ableToWork._alternateFpl2026Reading.fplOnePerson.HI === 18360);
ok('data: alternate set is the HIGHER set (default is conservative)',
  limits.ableToWork._alternateFpl2026Reading.fplOnePerson.contiguousDC > limits.ableToWork.fplOnePerson.contiguousDC);

// Spec §0 combined-max table cross-check (base + full bonus per bucket).
is('data: combined max 48+DC $35,650', limits.baseLimit + limits.ableToWork.fplOnePerson.contiguousDC, 35650);
is('data: combined max AK $39,550', limits.baseLimit + limits.ableToWork.fplOnePerson.AK, 39550);
is('data: combined max HI $37,990', limits.baseLimit + limits.ableToWork.fplOnePerson.HI, 37990);

// --- 3-bucket 51-state lookup ---------------------------------------------------
is('bucket: AK', fplBucket('AK'), 'AK');
is('bucket: HI', fplBucket('HI'), 'HI');
is('bucket: CA → contiguousDC', fplBucket('CA'), 'contiguousDC');
is('bucket: DC → contiguousDC', fplBucket('DC'), 'contiguousDC');
is('bucket: lowercase ak normalizes', fplBucket('ak'), 'AK');
is('bucket: unknown/empty → contiguousDC (safe default)', fplBucket(''), 'contiguousDC');

// --- onset gate edges (spec §1.1: strict before-46) ------------------------------
ok('onset 30 → eligible', onsetEligible(30, limits) === true);
ok('onset 45 → eligible (day-before-46 side)', onsetEligible(45, limits) === true);
ok('onset 46 → NOT eligible (on-the-birthday edge fails)', onsetEligible(46, limits) === false);
ok('onset 47 → NOT eligible', onsetEligible(47, limits) === false);
ok('onset non-numeric → NOT eligible', onsetEligible(undefined, limits) === false);

// Shared decomposed-excess check (spec §3.3 equivalence note): compact `excess`
// must equal max(0, others+roll−BASE) + max(0, own − (max(0, BASE−others−roll) + bonusCap))
// whenever the base is not overfilled by others alone.
function decomposedExcess(r) {
  const nonOwn = r.others + r.rollover529;
  return Math.max(0, nonOwn - r.base) + Math.max(0, r.own - (Math.max(0, r.base - nonOwn) + r.bonusCap));
}
function checkEquivalence(name, r) {
  if (r.others + r.rollover529 <= r.base) is(`${name} equivalence: compact excess = decomposed excess`, r.excess, decomposedExcess(r));
}

// --- F1: under base, no work ------------------------------------------------------
{
  const r = ableContribution({ onsetBefore46: true, state: 'TX', employed: false, others: 10000, own: 0, limits });
  is('F1 bonusCap $0', r.bonusCap, 0);
  is('F1 totalLimit $20,000', r.totalLimit, 20000);
  is('F1 excess $0', r.excess, 0);
  is('F1 room for others $10,000', r.roomOthers, 10000);
  is('F1 combinedMax $20,000 (no bonus)', r.combinedMax, 20000);
  checkEquivalence('F1', r);
}

// --- F2: exactly at base — no-bonus beneficiary money counts against base ---------
{
  const r = ableContribution({ onsetBefore46: true, state: 'OH', employed: false, others: 12000, own: 8000, limits });
  is('F2 bonusCap $0', r.bonusCap, 0);
  is('F2 totalLimit $20,000', r.totalLimit, 20000);
  is('F2 excess $0', r.excess, 0);
  is('F2 room for others $0', r.roomOthers, 0);
  is('F2 room for own $0', r.roomOwn, 0);
  is('F2 base pool used in full', r.baseUsed, 20000);
  checkEquivalence('F2', r);
}

// --- F3: over base, no work — 6% excise messaging ----------------------------------
{
  const r = ableContribution({ onsetBefore46: true, state: 'NY', employed: false, others: 25000, own: 0, limits });
  is('F3 totalLimit $20,000', r.totalLimit, 20000);
  is('F3 excess $5,000', r.excess, 5000);
  ok('F3 6% excise / return-by-due-date note shown', /6% excise|Form 5329/.test(r.notes.join(' ')));
  checkEquivalence('F3', r);
}

// --- F4: full ABLE-to-Work — headline combined-max case -----------------------------
{
  const r = ableContribution({ onsetBefore46: true, state: 'FL', employed: true, compensation: 30000, planContribution: false, others: 20000, own: 15650, limits });
  is('F4 bonusCap $15,650 (FPL binds below comp)', r.bonusCap, 15650);
  is('F4 totalLimit $35,650', r.totalLimit, 35650);
  is('F4 excess $0', r.excess, 0);
  is('F4 combinedMax matches spec §0 table', r.combinedMax, 35650);
  ok('F4 solely-responsible note shown', /solely responsible/.test(r.notes.join(' ')));
  checkEquivalence('F4', r);
  // ALTERNATE (spec §7.1, 2026-guideline reading — do not enable):
  // is('F4-alt bonusCap $15,960', r.bonusCap, 15960);
  // is('F4-alt totalLimit $35,960', r.totalLimit, 35960);
}

// --- F5: comp-limited bonus — min(own, bonusCap) binds at compensation ---------------
{
  const r = ableContribution({ onsetBefore46: true, state: 'PA', employed: true, compensation: 6000, planContribution: false, others: 16000, own: 10000, limits });
  is('F5 bonusCap $6,000 (= comp < FPL)', r.bonusCap, 6000);
  is('F5 totalLimit $26,000', r.totalLimit, 26000);
  is('F5 excess $0', r.excess, 0);
  is('F5 bonus space used $6,000', r.bonusUsed, 6000);
  is('F5 base usage $20,000 exactly (others 16,000 + own spill 4,000)', r.baseUsed, 20000);
  checkEquivalence('F5', r);
  // ALTERNATE (spec §7.1): F5 unchanged — the bonus binds at comp ($6,000) under either FPL set.
}

// --- F6: bonus blocked by an EMPLOYER-ONLY match (spec Correction 2) ------------------
{
  const r = ableContribution({ onsetBefore46: true, state: 'IL', employed: true, compensation: 30000, planContribution: true, others: 18000, own: 5000, limits });
  is('F6 bonusCap $0 (employer-only contribution blocks)', r.bonusCap, 0);
  is('F6 totalLimit $20,000', r.totalLimit, 20000);
  is('F6 excess $3,000', r.excess, 3000);
  ok('F6 employer-only blocker note shown', /employer-only|didn't elect/.test(r.notes.join(' ')));
  checkEquivalence('F6', r);
}

// --- F7: Alaska, full bonus — AK FPL ≠ 48-state FPL -----------------------------------
{
  const r = ableContribution({ onsetBefore46: true, state: 'AK', employed: true, compensation: 50000, planContribution: false, others: 20000, own: 19550, limits });
  is('F7 bucket AK', r.bucket, 'AK');
  is('F7 bonusCap $19,550', r.bonusCap, 19550);
  is('F7 totalLimit $39,550', r.totalLimit, 39550);
  is('F7 excess $0', r.excess, 0);
  checkEquivalence('F7', r);
  // ALTERNATE (spec §7.1): bonusCap 19,950 / totalLimit 39,950.
}

// --- F8: Hawaii, full bonus — the third distinct FPL value ------------------------------
{
  const r = ableContribution({ onsetBefore46: true, state: 'HI', employed: true, compensation: 50000, planContribution: false, others: 20000, own: 17990, limits });
  is('F8 bucket HI', r.bucket, 'HI');
  is('F8 bonusCap $17,990', r.bonusCap, 17990);
  is('F8 totalLimit $37,990', r.totalLimit, 37990);
  is('F8 excess $0', r.excess, 0);
  checkEquivalence('F8', r);
  // ALTERNATE (spec §7.1): bonusCap 18,360 / totalLimit 38,360.
}

// --- F9: onset 30, now 58 — onset governs, current age is irrelevant --------------------
{
  ok('F9 onset 30 passes the gate regardless of current age (58)', onsetEligible(30, limits));
  const r = ableContribution({ onsetBefore46: onsetEligible(30, limits), state: 'AZ', employed: false, others: 20000, own: 0, limits });
  is('F9 proceeds normally: eligible', r.eligible, true);
  is('F9 totalLimit $20,000', r.totalLimit, 20000);
  is('F9 excess $0', r.excess, 0);
}

// --- F10: onset 47, now 40 — gate stops before math --------------------------------------
{
  ok('F10 onset 47 fails the gate regardless of current age (40)', !onsetEligible(47, limits));
  const r = ableContribution({ onsetBefore46: onsetEligible(47, limits), state: 'TX', employed: true, compensation: 30000, others: 5000, own: 5000, limits });
  is('F10 not an eligible individual', r.eligible, false);
  is('F10 gate error', r.error, 'not_eligible');
  ok('F10 no contribution math performed', r.totalLimit === undefined && r.excess === undefined && r.bonusCap === undefined);
  ok('F10 SECURE 2.0 explainer with onset-not-current-age correction', /SECURE 2.0 §124/.test(r.notes.join(' ')) && /began at 30 who is now 58/.test(r.notes.join(' ')));
}

// --- F11: beneficiary-heavy overflow — the §3.3 equivalence-note spill branch ------------
{
  const r = ableContribution({ onsetBefore46: true, state: 'GA', employed: true, compensation: 40000, planContribution: false, others: 18000, own: 20000, limits });
  is('F11 bonusCap $15,650', r.bonusCap, 15650);
  is('F11 totalLimit $35,650', r.totalLimit, 35650);
  is('F11 excess $2,350', r.excess, 2350);
  is('F11 own fills the bonus in full ($15,650)', r.bonusUsed, 15650);
  is('F11 base pool full (others 18,000 + own spill 2,000)', r.baseUsed, 20000);
  is('F11 decomposed excess matches (spill branch)', decomposedExcess(r), 2350);
  checkEquivalence('F11', r);
  // ALTERNATE (spec §7.1): bonusCap 15,960 / totalLimit 35,960 / excess 2,040.
}

// --- F12: 529 rollover eats base — counts against (i) only --------------------------------
{
  const r = ableContribution({ onsetBefore46: true, state: 'WA', employed: false, others: 16000, own: 0, rollover529: 5000, limits });
  is('F12 bonusCap $0', r.bonusCap, 0);
  is('F12 totalLimit $20,000', r.totalLimit, 20000);
  is('F12 excess $1,000', r.excess, 1000);
  ok('F12 rollover-loses-treatment message (§529(c)(3)(C)(i))', /loses rollover treatment/.test(r.notes.join(' ')));
  checkEquivalence('F12', r);
}

// --- structure / correction guards ----------------------------------------------------------
// Bonus space is beneficiary-only: family money never raises the limit, even
// when the beneficiary is bonus-eligible but contributes nothing themself.
{
  const r = ableContribution({ onsetBefore46: true, state: 'CO', employed: true, compensation: 30000, planContribution: false, others: 30000, own: 0, limits });
  is('beneficiary-only: own=0 → totalLimit stays $20,000 despite full bonus room', r.totalLimit, 20000);
  is('beneficiary-only: others $30,000 → excess $10,000 (bonus can\'t absorb it)', r.excess, 10000);
  is('beneficiary-only: bonusCap still reported ($15,650) for the room display', r.bonusCap, 15650);
  is('beneficiary-only: roomOwn = base room 0 + bonus 15,650', r.roomOwn, 15650);
}

// Not employed → no bonus regardless of the plan checkbox.
{
  const r = ableContribution({ onsetBefore46: true, state: 'TX', employed: false, compensation: 50000, planContribution: false, others: 0, own: 25000, limits });
  is('not employed: bonusCap $0', r.bonusCap, 0);
  is('not employed: own $25,000 vs $20,000 base → excess $5,000', r.excess, 5000);
}

// Zero compensation while employed → bonus is $0 (lesser-of binds at comp).
{
  const r = ableContribution({ onsetBefore46: true, state: 'TX', employed: true, compensation: 0, planContribution: false, others: 0, own: 0, limits });
  is('employed, $0 comp: bonusCap $0', r.bonusCap, 0);
}

// Input guards.
is('guard: missing limits → missing_limits', ableContribution({ onsetBefore46: true, state: 'TX', others: 0, own: 0 }).error, 'missing_limits');
{
  const r = ableContribution({ onsetBefore46: true, state: 'TX', employed: false, others: -500, own: -100, rollover529: -1, limits });
  is('guard: negative inputs clamp to 0 — excess $0', r.excess, 0);
  is('guard: negative inputs clamp to 0 — roomOthers full $20,000', r.roomOthers, 20000);
}

console.log(`\nABLE contribution engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
