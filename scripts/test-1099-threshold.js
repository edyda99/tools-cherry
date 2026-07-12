// test-1099-threshold.js — unit tests for the 1099-K / 1099-NEC / 1099-MISC
// threshold-checker engine (IRC §6050W network/card split, restored by OBBBA
// §70432; IRC §6041/§6041A NEC/MISC floor, amended by OBBBA §70433). Run:
// node scripts/test-1099-threshold.js
//
// All 10 fixtures + the bonus assertion are from the sourced spec
// (docs/1099-threshold-checker-spec.md, §7). Fixtures 6/7/8/10 need to
// distinguish 1099-NEC (services) from 1099-MISC (rent/other) by name; the
// spec's own §4.2 pseudocode collapses both into one combined string
// ("1099-NEC (services) or 1099-MISC (rent/other)") since they share an
// identical threshold and inequality, but its §7 fixture table expects
// distinct "1099-NEC (payer)" / "1099-MISC (payer)" outputs. Resolved (per
// task instructions: conservative choice, noted, not silently guessed) by
// adding a `paymentPurpose` engine parameter ('services' default -> 1099-NEC,
// 'rent_other' -> 1099-MISC) that changes ONLY the form name shown, never a
// dollar figure or inequality — both forms remain governed by the exact same
// byYear threshold table.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  checkNetworkForm, checkCardForm, necMiscThreshold, checkDirectPaymentForm,
  stateOverlayNote, check1099
} from '../src/engine/form-1099-checker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, '../src/data/form-1099-thresholds.json'), 'utf8'));

let pass = 0, fail = 0;
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL ${name}`); }
}

// --- checkNetworkForm: strict `>` on BOTH conditions, "and" logic ---------------
is('network under both', checkNetworkForm({ amount: 8000, transactions: 60, data }).form, null);
is('network over both', checkNetworkForm({ amount: 25000, transactions: 300, data }).form, '1099-K');
is('network dollars-over-but-count-fails', checkNetworkForm({ amount: 30000, transactions: 150, data }).form, null);
is('network count-over-but-dollars-fail', checkNetworkForm({ amount: 18000, transactions: 250, data }).form, null);
// Exact-at-the-line: needs to STRICTLY exceed both — equal is not enough.
is('network exactly at $20,000/200 -> None (strict >, not >=)', checkNetworkForm({ amount: 20000, transactions: 200, data }).form, null);
is('network $20,001/201 -> 1099-K (just over)', checkNetworkForm({ amount: 20001, transactions: 201, data }).form, '1099-K');
// Headroom
const headroomCase = checkNetworkForm({ amount: 18000, transactions: 190, data });
is('network headroom dollarsToGo', headroomCase.headroom.dollarsToGo, 2001);
is('network headroom txnsToGo', headroomCase.headroom.txnsToGo, 11);
is('network issuer is the TPSO', checkNetworkForm({ amount: 25000, transactions: 300, data }).issuer, 'third-party settlement organization (TPSO)');

// --- checkCardForm: NO de minimis — any amount over $0 triggers -----------------
is('card zero -> no 1099-K', checkCardForm({ amount: 0, data }).form, null);
is('card $0.01 -> 1099-K (no minimum)', checkCardForm({ amount: 0.01, data }).form, '1099-K');
is('card $500 (spec fixture 5) -> 1099-K', checkCardForm({ amount: 500, data }).form, '1099-K');
is('card $25,000,000 -> still 1099-K (no ceiling either)', checkCardForm({ amount: 25000000, data }).form, '1099-K');
is('card issuer is the processor', checkCardForm({ amount: 500, data }).issuer, 'payment card processor / merchant acquirer');

// --- necMiscThreshold: year-keyed floor, including the 2027 indexed case -------
is('NEC/MISC floor 2025 = $600', necMiscThreshold(2025, data), 600);
is('NEC/MISC floor 2026 = $2,000', necMiscThreshold(2026, data), 2000);
ok('NEC/MISC 2027 is an indexed object, not a fabricated number', typeof necMiscThreshold(2027, data) === 'object');
is('NEC/MISC 2027 approx figure is $2,000 (base year 2025)', necMiscThreshold(2027, data).approx, 2000);
is('NEC/MISC floor before 2025 falls back to earliest known ($600)', necMiscThreshold(2020, data), 600);

// --- checkDirectPaymentForm: "$X or more" (>=), not the 1099-K's strict `>` ----
is('direct $2,500 TY2026 -> 1099-NEC (services, default)', checkDirectPaymentForm({ amount: 2500, taxYear: 2026, data }).form, '1099-NEC');
is('direct $1,500 TY2026 -> None (under $2,000 floor)', checkDirectPaymentForm({ amount: 1500, taxYear: 2026, data }).form, null);
is('direct $1,500 TY2025 -> 1099-NEC (still $600 floor that year)', checkDirectPaymentForm({ amount: 1500, taxYear: 2025, data }).form, '1099-NEC');
is('direct $1,800 TY2026 -> None (the $600-$2,000 "used to trigger" gap)', checkDirectPaymentForm({ amount: 1800, taxYear: 2026, data }).form, null);
// Exact-$2,000 boundary: the inequality is >=, so exactly at the floor DOES trigger.
is('direct EXACTLY $2,000 TY2026, rent -> 1099-MISC (>= boundary, contrast the 1099-K\'s strict >)',
  checkDirectPaymentForm({ amount: 2000, taxYear: 2026, paymentPurpose: 'rent_other', data }).form, '1099-MISC');
is('direct $1,999.99 TY2026 -> None (one cent under the floor)', checkDirectPaymentForm({ amount: 1999.99, taxYear: 2026, data }).form, null);
const directHeadroom = checkDirectPaymentForm({ amount: 1200, taxYear: 2026, data });
is('direct headroom dollarsToGo', directHeadroom.headroom.dollarsToGo, 800);
is('direct issuer is the paying business', directHeadroom.issuer, 'the paying business');

// --- stateOverlayNote: informational overlay, AND-logic states (Illinois) -----
is('state overlay: no state selected -> null', stateOverlayNote({ amount: 700, state: undefined, data }), null);
is('state overlay: untracked state -> null', stateOverlayNote({ amount: 700, state: 'CA', data }), null);
ok('state overlay: MA $700 triggers ($600 floor)', stateOverlayNote({ amount: 700, state: 'MA', data }).triggered);
ok('state overlay: MA $500 does not trigger', !stateOverlayNote({ amount: 500, state: 'MA', data }).triggered);
ok('state overlay: IL AND logic — dollars over but txns under -> not triggered',
  !stateOverlayNote({ amount: 1200, transactions: 2, state: 'IL', data }).triggered);
ok('state overlay: IL AND logic — both over -> triggered',
  stateOverlayNote({ amount: 1200, transactions: 5, state: 'IL', data }).triggered);
is('state overlay: AR carries its withholding condition note', stateOverlayNote({ amount: 3000, state: 'AR', data }).condition, 'when no state tax was withheld');

// --- check1099: the 10 spec fixtures (§7) + the bonus assertion ---------------
function fx(id, inputs, expectedForm) {
  const r = check1099({ ...inputs, data });
  is(`${id} form`, r.form, expectedForm);
  ok(`${id} always carries the myth-bust line`, typeof r.mythBust === 'string' && r.mythBust.length > 0);
  return r;
}

// F1: casual seller, under both K limits -> None (still taxable if business income,
// but that's the myth-bust's job, not the form-issuance job).
fx('F1 casual seller under both limits', { taxYear: 2026, payerType: 'network', amount: 8000, transactions: 60 }, null);

// F2: over 1099-K, both limits -> 1099-K (TPSO).
const f2 = fx('F2 over both K limits', { taxYear: 2026, payerType: 'network', amount: 25000, transactions: 300 }, '1099-K');
is('F2 issuer is the TPSO', f2.issuer, 'third-party settlement organization (TPSO)');

// F3: count fails (dollars alone don't trigger) -> None.
fx('F3 count fails, dollars over', { taxYear: 2026, payerType: 'network', amount: 30000, transactions: 150 }, null);

// F4: dollars fail (count alone doesn't trigger) -> None. Mirror edge.
fx('F4 dollars fail, count over', { taxYear: 2026, payerType: 'network', amount: 18000, transactions: 250 }, null);

// F5: card processor, no threshold -> 1099-K (card processor), regardless of the
// tiny amount/count — Correction 2, the tool's core differentiator.
const f5 = fx('F5 card processor no threshold', { taxYear: 2026, payerType: 'card', amount: 500, transactions: 5 }, '1099-K');
is('F5 issuer is the card processor', f5.issuer, 'payment card processor / merchant acquirer');

// F6: direct contractor, over $2,000 -> 1099-NEC (payer).
fx('F6 direct contractor over $2,000', { taxYear: 2026, payerType: 'direct', amount: 2500 }, '1099-NEC');

// F7: direct contractor, under $2,000 in 2026 -- but the SAME amount in 2025 differs
// (year-boundary, Correction 3).
fx('F7 direct $1,500 TY2026', { taxYear: 2026, payerType: 'direct', amount: 1500 }, null);
fx('F7 direct $1,500 TY2025 (still $600 floor)', { taxYear: 2025, payerType: 'direct', amount: 1500 }, '1099-NEC');

// F8: the "$600-$2,000 gap" (used to trigger, now doesn't) -> None. Myth-bust must
// still fire: still taxable self-employment income, no form != no tax.
const f8 = fx('F8 the $600-$2,000 gap', { taxYear: 2026, payerType: 'direct', amount: 1800 }, null);
ok('F8 myth-bust explicitly says no form does not mean no tax', /no tax/i.test(f8.mythBust));

// F9: state lower threshold beats federal -> None (federal) + state 1099-K note.
const f9 = fx('F9 state lower threshold beats federal', { taxYear: 2026, payerType: 'network', amount: 700, transactions: 10, state: 'MA' }, null);
ok('F9 state overlay note IS attached (MA $600 < federal $20,000)', f9.stateOverlay !== null);
is('F9 state overlay state code', f9.stateOverlay.state, 'MA');

// F10: exact-$2,000 NEC boundary (rent, 1099-MISC) -> "or more" (>=) boundary triggers.
fx('F10 exact $2,000 boundary, rent -> 1099-MISC', { taxYear: 2026, payerType: 'direct', amount: 2000, paymentPurpose: 'rent_other' }, '1099-MISC');

// Bonus assertion (not numbered in the spec, but explicitly called out as "the
// single most common misread of the rule"): 1099-K exactly at the line needs to
// EXCEED both $20,000 and 200 txns — equal is NOT enough.
fx('Bonus: network exactly at $20,000/200 txns -> None (must exceed, not equal)', { taxYear: 2026, payerType: 'network', amount: 20000, transactions: 200 }, null);

// --- Personal-transfer branch: not income, warns about platform miscategorization
const personal = check1099({ taxYear: 2026, payerType: 'network', amount: 25000, transactions: 300, paymentNature: 'personal', data });
is('personal transfer -> no form regardless of amount/count', personal.form, null);
ok('personal transfer note warns about platform miscategorization', /goods & services/i.test(personal.note));

// --- Who-issues-what disambiguation (§1.3): never both forms for the same dollars
is('direct payerType never returns a 1099-K', check1099({ taxYear: 2026, payerType: 'direct', amount: 50000, data }).form, '1099-NEC');
is('card payerType never returns a 1099-NEC/MISC', check1099({ taxYear: 2026, payerType: 'card', amount: 50000, data }).form, '1099-K');

// --- structure / correction guards ---------------------------------------------
is('network logic is AND (both conditions)', data.form1099K.network.logic, 'AND');
is('network appliesToYears includes 2025 AND 2026 (Correction 1 — not "TY2026 only")', data.form1099K.network.appliesToYears.join(','), '2025,2026');
is('card logic is NONE (no de minimis) — Correction 2', data.form1099K.card.logic, 'NONE');
is('NEC/MISC inequality is atOrAbove ("or more"), contrasting the 1099-K\'s strict exceeds', data.form1099NEC_MISC.inequality, 'atOrAbove');
is('network inequality is exceeds (strict >)', data.form1099K.network.grossInequality, 'exceeds');
ok('at least 5 myth-busts shipped', data.mythBusts.length >= 5);
ok('at least 5 sources shipped (site rigor)', data.sources.length >= 5);

console.log(`\n1099 threshold-checker engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
