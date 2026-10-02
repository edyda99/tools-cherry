#!/usr/bin/env node
// test-projections-2027.js — the guard rails on /2027-tax-brackets/ and
// /2027-social-security-cola/.
//
// Most of these assertions check that the code REFUSES to do something. That is
// deliberate: the whole risk on those two pages is a dollar figure that looks
// computed but was filled in from a guess, so "average() throws on a partial
// window" matters more here than any arithmetic result.
//
// The data file itself is validated too — every non-null month must carry a
// sourceUrl and a publishedDate, and no month may be simultaneously listed as
// pending in `schedule` and non-null in `months`.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  monthKeys, monthValue, windowStatus, average, partialAverage,
  assertComplete, colaPercent, applyCola, roundIncrease,
  thirdPartyProblems, thirdPartyBlockProblems, TP_RATES, figureValues,
} from '../src/engine/projections-2027.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) { console.error('FAIL: ' + msg); failed++; }
};
const near = (a, b, eps, msg) => ok(Math.abs(a - b) < eps, `${msg} (got ${a}, want ~${b})`);
function throws(fn, re, msg) {
  try { fn(); } catch (e) { ok(re.test(e.message), `${msg}: message was "${e.message}"`); return; }
  ok(false, `${msg}: expected a throw, got none`);
}

// --- monthKeys -------------------------------------------------------------
ok(monthKeys('2025-09', '2026-08').length === 12, 'a Sept-to-Aug window is 12 months');
ok(monthKeys('2025-09', '2026-08')[0] === '2025-09', 'window starts at its start month');
ok(monthKeys('2025-09', '2026-08')[11] === '2026-08', 'window ends at its end month');
ok(monthKeys('2026-07', '2026-09').join(',') === '2026-07,2026-08,2026-09', 'a quarter is three months');
throws(() => monthKeys('2026-1', '2026-09'), /bad month key/, 'a malformed month key throws');
throws(() => monthKeys('2026-09', '2026-07'), /ends .* before it starts/, 'a backwards window throws');

// --- monthValue ------------------------------------------------------------
const good = { value: 180.196, sourceUrl: 'https://x', publishedDate: '2025-10-24' };
ok(monthValue('2025-09', good) === 180.196, 'a complete entry yields its value');
ok(monthValue('2026-07', null) === null, 'null means pending');
throws(() => monthValue('2026-07', { value: 1 }), /sourceUrl/,
  'a value without a citation throws — no number ships uncited');
throws(() => monthValue('2026-07', { sourceUrl: 'x', publishedDate: 'y' }), /numeric value/,
  'an entry with no numeric value is a data error, not a pending month');
throws(() => monthValue('2026-07', 180.2), /neither null nor an entry/,
  'a bare number is not an acceptable entry');

// --- windowStatus / average ------------------------------------------------
const partial = { '2026-07': good, '2026-08': null, '2026-09': null };
const st = windowStatus(['2026-07', '2026-08', '2026-09'], partial);
ok(!st.complete, 'a window with a pending month is not complete');
ok(st.missing.join(',') === '2026-08,2026-09', 'status names the missing months');
ok(st.present.join(',') === '2026-07', 'status names the published months');
throws(() => average(['2026-07', '2026-08', '2026-09'], partial), /refusing to average an incomplete window/,
  'average() refuses a partial window — this is the fabrication line');
throws(() => assertComplete(st, 'projected bracket thresholds'), /BUILD REFUSED/,
  'assertComplete throws so a build cannot ship a projected figure from partial inputs');

const full = {
  a: { value: 10, sourceUrl: 'u', publishedDate: 'd' },
  b: { value: 20, sourceUrl: 'u', publishedDate: 'd' },
  c: { value: 30, sourceUrl: 'u', publishedDate: 'd' },
};
near(average(['a', 'b', 'c'], full), 20, 1e-9, 'average of a complete window');
ok(windowStatus(['a', 'b', 'c'], full).complete, 'a full window is complete');
assertComplete(windowStatus(['a', 'b', 'c'], full), 'anything'); // must not throw

// --- partialAverage --------------------------------------------------------
const pa = partialAverage(['2026-07', '2026-08', '2026-09'], partial);
ok(pa && pa.n === 1 && pa.of === 3, 'partialAverage reports how many of how many');
near(pa.mean, 180.196, 1e-9, 'partialAverage averages only what is published');
ok(partialAverage(['x', 'y'], { x: null, y: null }) === null, 'nothing published yields null, not zero');

// --- colaPercent -----------------------------------------------------------
near(colaPercent(100, 103.8), 3.8, 1e-9, 'a 3.8% rise is a 3.8% COLA');
near(colaPercent(100, 103.84), 3.8, 1e-9, 'COLA rounds to the nearest tenth (down)');
near(colaPercent(100, 103.86), 3.9, 1e-9, 'COLA rounds to the nearest tenth (up)');
ok(colaPercent(100, 98) === 0, 'a fall in prices yields a 0.0% COLA, never a cut');
ok(colaPercent(100, 100) === 0, 'no change yields 0.0%');
ok(Number.isNaN(colaPercent(0, 100)), 'a zero base is not a percentage');
// Worked against the real Q3 2025 CPI-W average this repo carries, so the
// denominator the COLA page will use is exercised, not just synthetic numbers.
const q3_2025avg = (316.349 + 317.306 + 318.139) / 3;
near(q3_2025avg, 317.2646667, 1e-5, 'Q3 2025 CPI-W average');
near(colaPercent(q3_2025avg, q3_2025avg * 1.038), 3.8, 1e-9, 'a 3.8% Q3-over-Q3 rise reads as 3.8%');

// --- applyCola -------------------------------------------------------------
const a = applyCola(2000, 3.8);
ok(a.newMonthly === 2076, `a $2,000 benefit at 3.8% becomes $2,076 (got ${a.newMonthly})`);
near(a.monthlyIncrease, 76, 1e-9, 'monthly increase');
near(a.annualIncrease, 912, 1e-9, 'annual increase is twelve monthly increases');
ok(applyCola(2000, 0).newMonthly === 2000, 'a 0% COLA leaves the benefit alone');
ok(applyCola(1234.56, 3.8).newMonthly === 1281, 'the adjusted benefit is rounded down to the whole dollar');
ok(Number.isNaN(applyCola('abc', 3.8).newMonthly), 'junk input yields NaN, not a number');
ok(Number.isNaN(applyCola(-5, 3.8).newMonthly), 'a negative benefit is refused');

// --- roundIncrease (26 U.S.C. 1(f)(7)) -------------------------------------
ok(roundIncrease(12400, 449, false) === 12800, 'an increase rounds DOWN to the next lowest $50 (449 -> 400)');
ok(roundIncrease(12400, 450, false) === 12850, 'an exact multiple of $50 is kept whole');
ok(roundIncrease(12400, 449, true) === 12825, 'married filing separately steps by $25');
ok(roundIncrease(100, 49, false) === 100, 'an increase under $50 rounds away entirely, per the statute');

// --- the data file ---------------------------------------------------------
const data = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'projections-2027.json'), 'utf8'));

const checkSeries = (label, months, sched) => {
  for (const [k, v] of Object.entries(months)) {
    if (v === null) {
      ok(sched && sched[k], `${label}: pending month ${k} must have a schedule entry saying when it is due or why it never arrives`);
      continue;
    }
    ok(Number.isFinite(v.value), `${label}: ${k} has a numeric value`);
    ok(typeof v.sourceUrl === 'string' && /^https:\/\//.test(v.sourceUrl), `${label}: ${k} has an https sourceUrl`);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(v.publishedDate || ''), `${label}: ${k} has an ISO publishedDate`);
    ok(['initial', 'interim', 'final'].includes(v.vintage), `${label}: ${k} declares its BLS vintage`);
    ok(!(sched && sched[k] && sched[k].status === 'scheduled'),
      `${label}: ${k} is non-null but still listed as pending in schedule — the two disagree`);
  }
};
const cc = data.ccpiu;
const ccKeys = monthKeys(cc.window.start, cc.window.end);
ok(ccKeys.length === 12, 'the C-CPI-U window in the data file is 12 months');
ok(ccKeys.every((k) => k in cc.months), 'every window month has an entry (null or otherwise) in the data file');
ok(Object.keys(cc.months).length === 12, 'the data file carries exactly the window months, no strays');
checkSeries('ccpiu', cc.months, cc.schedule);

const q3prior = monthKeys('2025-07', '2025-09');
const q3cur = monthKeys('2026-07', '2026-09');
ok(q3prior.every((k) => k in data.cpiw.q3_2025), 'Q3 2025 CPI-W is complete in the data file');
ok(q3cur.every((k) => k in data.cpiw.q3_2026), 'Q3 2026 CPI-W months are all present as keys');
checkSeries('cpiw.q3_2025', data.cpiw.q3_2025, data.cpiw.schedule);
checkSeries('cpiw.q3_2026', data.cpiw.q3_2026, data.cpiw.schedule);
ok(windowStatus(q3prior, data.cpiw.q3_2025).complete, 'the COLA denominator (Q3 2025) is fully published');

for (const e of data.cpiw.thirdPartyEstimates) {
  ok(typeof e.publisher === 'string' && e.publisher.length > 3, 'each third-party estimate names its publisher');
  ok(Number.isFinite(e.figure), 'each third-party estimate carries a numeric figure');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(e.asOf || ''), `third-party estimate from ${e.publisher} has an asOf date`);
  ok(/^https:\/\//.test(e.sourceUrl || ''), `third-party estimate from ${e.publisher} has an https sourceUrl`);
}
for (const [k, s] of Object.entries(data.statute)) {
  // "_"-prefixed keys are the repo's convention for internal notes, not data.
  if (k.startsWith('_')) continue;
  ok(typeof s.cite === 'string' && s.cite.includes('U.S.C.'), `statute.${k} carries a U.S. Code citation`);
  ok(typeof s.quote === 'string' && s.quote.length > 40, `statute.${k} carries the statutory text, not a paraphrase`);
  ok(/^https:\/\//.test(s.sourceUrl || ''), `statute.${k} links to the statute`);
}

// --- quote fidelity -------------------------------------------------------
// A quotation mark is a promise, and these four quotes are the page's entire
// claim to authority. Each assertion below locks in a specific way the quote was
// wrong once: words inserted inside the quotation marks, statutory (i)/(ii)
// structure smoothed into flowing prose, and punctuation "corrected" to what the
// drafter should have written rather than what they did write.
const q = (k) => data.statute[k].quote;
ok(q('ccpiuDefinition').startsWith('The C-CPI-U for any calendar year is the average'),
  '§1(f)(6)(B) is quoted from its first word — no "the value of" spliced in ahead of it');
ok(q('cumulativeBase').includes('(i)') && q('cumulativeBase').includes('(ii)'),
  '§1(f)(3)(A) keeps the statute\'s (i)/(ii) structure rather than flattening it into one sentence');
ok(q('cumulativeBase').includes('percentage (if any) by which—'),
  '§1(f)(3)(A) keeps the statute\'s em-dash before the clauses');
ok(q('roundingBrackets').includes('section 68(b)(2) or section 151(d)(4)'),
  '§1(f)(7)(A) reproduces the missing serial comma the U.S. Code marks "so in original"');
ok(!q('roundingBrackets').includes('68(b)(2), or'),
  '§1(f)(7)(A) has no comma added before "or section 151(d)(4)"');
for (const [k, s] of Object.entries(data.statute)) {
  if (k.startsWith('_')) continue;
  ok(!/^[a-z]/.test(s.quote), `statute.${k}: a quote starting mid-sentence needs a bracket or ellipsis`);
}

// --- third-party projections ----------------------------------------------
// Somebody else's 2027 figures, shown under their name. They are the only dollar
// amounts the projected page carries while the window is incomplete, so every
// way an item can be malformed is pinned here with a deliberately broken copy.
const tpBlock = data.thirdPartyProjections;
ok(/^\d{4}-\d{2}-\d{2}$/.test(tpBlock.checkedDate || ''), 'thirdPartyProjections has an ISO checkedDate');
ok(Array.isArray(tpBlock.items), 'thirdPartyProjections.items is an array');
{
  const live = thirdPartyBlockProblems(tpBlock);
  ok(live.length === 0, `the live thirdPartyProjections block validates cleanly: ${live.join(' | ')}`);
}
ok(!/\bnone had published\b|\bEmpty as of\b/i.test(tpBlock._note || '') || tpBlock.items.length === 0,
  'the _note no longer says nobody has published once items exist');
for (const i of tpBlock.items) {
  ok(i.asOf <= tpBlock.checkedDate, `${i.publisher}: published on or before the date we last checked`);
  ok(typeof i._methodQuote === 'string' && i._methodQuote.length > 40,
    `${i.publisher}: carries the source's own sentence on the missing month, for audit`);
  // The 37% bracket starts where the 35% one ends, so a bracket table is six
  // thresholds; the married-joint ones are twice the single ones up to 32% in
  // every recent year, which catches a digit dropped from either table.
  if (i.brackets && i.brackets.single && i.brackets.married)
    for (let r = 0; r < 5; r++)
      ok(i.brackets.married[r].upTo === 2 * i.brackets.single[r].upTo,
        `${i.publisher}: married-joint ${TP_RATES[r] * 100}% threshold is twice the single one`);
  if (i.standardDeduction && Number.isFinite(i.standardDeduction.single) && Number.isFinite(i.standardDeduction.married))
    ok(i.standardDeduction.married === 2 * i.standardDeduction.single,
      `${i.publisher}: married-joint standard deduction is twice the single one`);
}

// The fixture is the item with the most optional parts (a two-number figure and
// a full-report link), so every branch of the validator is exercised.
const goodTp = () => JSON.parse(JSON.stringify(tpBlock.items.find((i) => i.fullReport
  && Object.values(i.standardDeduction || {}).some((f) => f && typeof f === 'object')) || tpBlock.items[0]));
const tpBroken = (label, mutate, re) => {
  const item = goodTp();
  mutate(item);
  const probs = thirdPartyProblems(item, tpBlock.checkedDate);
  ok(probs.some((m) => re.test(m)), `malformed item is rejected (${label}); problems were: ${probs.join(' | ') || 'none'}`);
};
ok(thirdPartyProblems(goodTp(), tpBlock.checkedDate).length === 0, 'the fixture item itself is valid');
ok(thirdPartyProblems(null).length > 0, 'a null item is rejected');
tpBroken('no publisher', (i) => { delete i.publisher; }, /publisher is missing/);
tpBroken('no title', (i) => { i.title = ' '; }, /title is missing/);
tpBroken('http source', (i) => { i.sourceUrl = 'http://example.com/x'; }, /sourceUrl is not an https URL/);
tpBroken('US-style date', (i) => { i.asOf = '09/11/2026'; }, /asOf is not an ISO date/);
tpBroken('dated after the check', (i) => { i.asOf = '2099-01-01'; }, /after checkedDate/);
tpBroken('no window statement', (i) => { delete i.monthsUsed; }, /monthsUsed/);
tpBroken('months do not add to 12', (i) => { i.monthsUsed = 12; }, /is not 12/);
tpBroken('bad skipped key', (i) => { i.skipped = ['2025-13']; }, /skipped is not a list/);
tpBroken('no figures at all', (i) => { delete i.standardDeduction; delete i.brackets; }, /carries no figures/);
tpBroken('extra zero typed into a deduction ("$15,7500")', (i) => { i.standardDeduction.single = 157500; },
  /standardDeduction\.single .* is not a whole-dollar amount/);
tpBroken('deduction as a string', (i) => { i.standardDeduction.married = '33,200'; }, /standardDeduction\.married/);
tpBroken('unknown filing status', (i) => { i.standardDeduction.mfs = 16600; }, /unknown filing status "mfs"/);
tpBroken('a bracket row missing', (i) => { i.brackets.single.pop(); }, /does not have 7 rows/);
tpBroken('a wrong rate', (i) => { i.brackets.single[2].rate = 0.21; }, /rate is not 0\.22/);
tpBroken('thresholds out of order ("$105,7000")', (i) => { i.brackets.single[2].upTo = 1057000; },
  /does not rise above the bracket below it/);
tpBroken('top bracket capped', (i) => { i.brackets.married[6].upTo = 900000; }, /top bracket must have upTo null/);
// A line the publisher printed as two numbers, e.g. "$24,925 ($24,950)".
const twoKey = (i) => Object.keys(i.standardDeduction).find((k) => i.standardDeduction[k] && typeof i.standardDeduction[k] === 'object');
ok(!!twoKey(goodTp()), 'the fixture carries a figure printed as two numbers');
tpBroken('two-number figure whose printed text disagrees with its values',
  (i) => { i.standardDeduction[twoKey(i)].printed = '$24,925 ($24,900)'; }, /printed is not exactly/);
tpBroken('two-number figure collapsed to one value', (i) => { i.standardDeduction[twoKey(i)].values = [24950]; },
  /values is not a pair/);
tpBroken('two-number figure with the printed text reworded',
  (i) => { const f = i.standardDeduction[twoKey(i)]; f.printed = `${f.printed} (estimate)`; }, /printed is not exactly/);
tpBroken('two-number figure that does not say whether the publisher explained it',
  (i) => { delete i.standardDeduction[twoKey(i)].explanation; }, /explanation must be/);
tpBroken('two-number figure with an extra zero', (i) => { i.standardDeduction[twoKey(i)].values = [249250, 24950]; },
  /values is not a pair/);
tpBroken('full report without a link', (i) => { i.fullReport.sourceUrl = 'pro.bloombergtax.com/?p=17932'; },
  /fullReport\.sourceUrl/);
tpBroken('full report without a label', (i) => { delete i.fullReport.label; }, /fullReport\.label/);
{
  const two = goodTp().standardDeduction[twoKey(goodTp())];
  ok(figureValues(two).length === 2 && figureValues(16600).join() === '16600',
    'figureValues returns both numbers of a two-number figure and the one number of a plain one');
}
tpBroken('em dash in rendered note', (i) => { i.note = 'Figures \u2014 as reported.'; }, /em dash/);
{
  const twice = { checkedDate: tpBlock.checkedDate, items: [goodTp(), goodTp()] };
  ok(thirdPartyBlockProblems(twice).some((m) => /listed twice/.test(m)), 'the same publisher listed twice is rejected');
  ok(thirdPartyBlockProblems({ checkedDate: 'soon', items: [] }).some((m) => /checkedDate/.test(m)),
    'a block without an ISO checkedDate is rejected');
  ok(thirdPartyBlockProblems({ checkedDate: '2026-10-02', items: [] }).length === 0,
    'an empty items list is valid: nobody has published is a legitimate state');
}

// The whole reason the projected-brackets page ships without dollar figures.
const liveStatus = windowStatus(ccKeys, cc.months);
if (liveStatus.complete) {
  console.log('NOTE: the C-CPI-U window is now complete — /2027-tax-brackets/ may publish projected figures.');
} else {
  ok(liveStatus.missing.length > 0, 'partial-data mode is what the live data says');
  console.log(`  (C-CPI-U window: ${liveStatus.present.length}/12 published, missing ${liveStatus.missing.join(', ')})`);
}

if (failed) {
  console.error(`\ntest-projections-2027: ${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('test-projections-2027: OK');
