// test-w2-decoder.js — unit tests for the 2026 W-2 Box 12 TA/TP/TT decoder +
// TTOC occupation lookup engine. Run: node scripts/test-w2-decoder.js
//
// All 11 fixtures (F1-F11) are from the sourced spec
// (docs/w2-decoder-spec.md, §7), plus structural guards over the data file:
// 71 occupations across 8 categories (26 CFR 1.224-1, Table 1 to paragraph
// (h)), the 3 final-rule additions (509/510/810 — any dataset missing them is
// the stale Sept 2025 proposed list), and the effective-date fields (final
// rule PUBLISHED 2026-04-13, EFFECTIVE 2026-06-12 — two different dates; the
// spec flags "effective April 2026" as a mis-statement that must not ship).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BOX12_INFO, decodeBox12, decodeBox14b, decodeW2,
  lookupTtoc, flattenOccupations, searchOccupations
} from '../src/engine/w2-box-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, '../src/data/ttoc-occupations.json'), 'utf8'));

let pass = 0, fail = 0;
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL ${name}`); }
}

// --- Structural guards over the data file ------------------------------------
const flat = flattenOccupations(data);
is('exactly 71 occupations (verified codified count, not the "70+" estimate)', flat.length, 71);
is('exactly 8 categories', data.categories.length, 8);
const catCounts = data.categories.map((c) => `${c.name}:${c.occupations.length}`).join('|');
is('per-category counts match the codified table',
  catCounts,
  'Beverage and Food Service:10|Entertainment and Events:11|Hospitality and Guest Services:4|Home Services:9|Personal Services:10|Personal Appearance and Wellness:11|Recreation and Instruction:6|Transportation and Delivery:10');
// F8/F9 regression anchor: the 3 occupations added between the Sept 2025
// proposed rule and the April 2026 final rule. A dataset missing any of these
// is the stale proposed list.
for (const code of ['509', '510', '810']) {
  const occ = lookupTtoc(code, data);
  ok(`final-rule addition ${code} present`, occ !== null);
  ok(`final-rule addition ${code} flagged addedInFinalRule`, occ && occ.addedInFinalRule === true);
}
is('codes are unique', new Set(flat.map((o) => o.code)).size, 71);
ok('every occupation has code/title/description/examples/soc',
  flat.every((o) => o.code && o.title && o.description && o.examples && o.soc));
// Effective-date discrepancy guard (spec §4 + §8): published and effective are
// DIFFERENT dates and both must be carried; "effective 2026-04-13" is wrong.
is('final rule published 2026-04-13', data.finalRule.publishedDate, '2026-04-13');
is('final rule effective 2026-06-12 (NOT the publication date)', data.finalRule.effectiveDate, '2026-06-12');
ok('applicability covers tax years after Dec 31, 2024', /December 31, 2024/.test(data.finalRule.applicability));

// --- Box 12 asymmetry (spec §2.4): only TA is excluded from Box 1 -------------
is('TA is excluded from Box 1', BOX12_INFO.TA.excludedFromBox1, true);
is('TP is NOT excluded from Box 1', BOX12_INFO.TP.excludedFromBox1, false);
is('TT is NOT excluded from Box 1', BOX12_INFO.TT.excludedFromBox1, false);
ok('TT copy says premium-only (the "half"), not the whole overtime paycheck',
  /half|premium/i.test(BOX12_INFO.TT.plain));
ok('TP carries the FICA-still-applies caveat', /FICA|Social Security/i.test(BOX12_INFO.TP.ficaNote));
ok('TT carries the FICA-still-applies caveat', /FICA|Social Security/i.test(BOX12_INFO.TT.ficaNote));
ok('unknown Box 12 code is flagged known:false, never guessed',
  decodeBox12([{ code: 'D', amount: 5000 }])[0].known === false);

// --- F1: full house — TA + TP + TT + 14b 101 ---------------------------------
{
  const r = decodeW2({
    box12: [
      { code: 'TA', amount: 2500 },
      { code: 'TP', amount: 9800 },
      { code: 'TT', amount: 1150 }
    ],
    box14b: ['101'],
    data
  });
  is('F1 TA excluded from Box 1', r.asymmetry.excludedFromBox1.join(','), 'TA');
  is('F1 TP+TT included in Box 1 (no adjustment shown)', r.asymmetry.includedInBox1.join(','), 'TP,TT');
  is('F1 TA total', r.totals.taExcluded, 2500);
  is('F1 TP total', r.totals.tpTips, 9800);
  is('F1 TT total', r.totals.ttOvertime, 1150);
  is('F1 14b applicable (TP present)', r.box14b.applicable, true);
  is('F1 14b code 101 matches', r.box14b.entries[0].status, 'match');
  is('F1 14b 101 = Bartenders', r.box14b.entries[0].occupation.title, 'Bartenders');
  is('F1 14b 101 category', r.box14b.entries[0].occupation.category, 'Beverage and Food Service');
}

// --- F2: only TP, 14b 603 ------------------------------------------------------
{
  const r = decodeW2({ box12: [{ code: 'TP', amount: 14200 }], box14b: ['603'], data });
  is('F2 no exclusion from Box 1', r.asymmetry.excludedFromBox1.length, 0);
  is('F2 TP fully included in Box 1', r.asymmetry.includedInBox1.join(','), 'TP');
  is('F2 14b 603 = Barbers, Hairdressers, Hairstylists, and Cosmetologists',
    r.box14b.entries[0].occupation.title, 'Barbers, Hairdressers, Hairstylists, and Cosmetologists');
  is('F2 14b 603 category', r.box14b.entries[0].occupation.category, 'Personal Appearance and Wellness');
  is('F2 no TT this year (overtime deduction not applicable)', r.flags.hasTT, false);
}

// --- F3: only TT — the fixture that most directly tests the 14b conditional ----
{
  const r = decodeW2({ box12: [{ code: 'TT', amount: 2300 }], box14b: [], data });
  is('F3 TT fully included in Box 1', r.asymmetry.includedInBox1.join(','), 'TT');
  is('F3 14b NOT applicable (no TP)', r.box14b.applicable, false);
  is('F3 empty 14b is CORRECT, not an error', r.box14b.absenceIsCorrect, true);
  ok('F3 note explains 14b only applies with code TP',
    r.box14b.notes.some((n) => /only.*TP|code TP/i.test(n)));
}

// --- F4: only TA ---------------------------------------------------------------
{
  const r = decodeW2({ box12: [{ code: 'TA', amount: 1800 }], box14b: [], data });
  is('F4 TA excluded from Box 1', r.asymmetry.excludedFromBox1.join(','), 'TA');
  is('F4 TA amount', r.totals.taExcluded, 1800);
  is('F4 no tips deduction flag', r.flags.hasTP, false);
  is('F4 no overtime deduction flag', r.flags.hasTT, false);
  is('F4 14b not applicable', r.box14b.applicable, false);
}

// --- F5: search "bartender" -> 101 ----------------------------------------------
{
  const r = searchOccupations('bartender', data);
  is('F5 top match is 101', r.matches[0] && r.matches[0].code, '101');
  is('F5 title Bartenders', r.matches[0].title, 'Bartenders');
  is('F5 category', r.matches[0].category, 'Beverage and Food Service');
}

// --- F6: search "uber driver" -> 802 via the examples field ---------------------
{
  const r = searchOccupations('uber driver', data);
  is('F6 top match is 802', r.matches[0] && r.matches[0].code, '802');
  is('F6 official title', r.matches[0].title, 'Taxi and Rideshare Drivers and Chauffeurs');
  is('F6 category', r.matches[0].category, 'Transportation and Delivery');
}

// --- F7: search "eyelash tech" -> 606 -------------------------------------------
{
  const r = searchOccupations('eyelash tech', data);
  is('F7 top match is 606', r.matches[0] && r.matches[0].code, '606');
  is('F7 title', r.matches[0].title, 'Eyebrow and Eyelash Technicians');
}

// --- F8: search "gas station attendant" -> 810 (final-rule addition) ------------
{
  const r = searchOccupations('gas station attendant', data);
  is('F8 top match is 810', r.matches[0] && r.matches[0].code, '810');
  is('F8 title', r.matches[0].title, 'Gas Pump Attendant');
  is('F8 category', r.matches[0].category, 'Transportation and Delivery');
  is('F8 flagged as a final-rule addition', r.matches[0].addedInFinalRule, true);
}

// --- F9: search "florist" -> 510 (the other notable final-rule addition) --------
{
  const r = searchOccupations('florist', data);
  is('F9 top match is 510', r.matches[0] && r.matches[0].code, '510');
  is('F9 title', r.matches[0].title, 'Floral Designers');
  is('F9 category', r.matches[0].category, 'Personal Services');
  is('F9 flagged as a final-rule addition', r.matches[0].addedInFinalRule, true);
}

// --- F10: "retail cashier" -> NOT FOUND with 107/303 did-you-mean ---------------
{
  const r = searchOccupations('retail cashier', data);
  is('F10 no matches', r.matches.length, 0);
  ok('F10 explicit not-found (never a blank state)', r.notFound !== null);
  is('F10 reason: considered and rejected', r.notFound.reason, 'rejected');
  const dym = r.notFound.didYouMean.map((o) => o.code).sort().join(',');
  is('F10 did-you-mean 107 + 303', dym, '107,303');
  ok('F10 explanation cites the preamble finding', /107|Fast Food/i.test(r.notFound.explanation));
}

// --- F11: "accountant" -> NOT FOUND, rejected, NO alternate suggestion ----------
{
  const r = searchOccupations('accountant', data);
  is('F11 no matches', r.matches.length, 0);
  is('F11 reason: considered and rejected', r.notFound.reason, 'rejected');
  is('F11 no did-you-mean', r.notFound.didYouMean.length, 0);
  ok('F11 explanation says considered and excluded', /considered|not included/i.test(r.notFound.explanation));
}

// --- Additional guards ----------------------------------------------------------
// "casino cashier" must NOT be swallowed by the retail-cashier rejected gate —
// it is a real listed occupation (203, Gambling Cage Workers).
{
  const r = searchOccupations('casino cashier', data);
  is('casino cashier -> 203 (not intercepted by the rejected gate)', r.matches[0] && r.matches[0].code, '203');
}
// "clergy" resolves via Event Officiants (505) — the preamble covers clergy
// only through that category, never as its own.
{
  const r = searchOccupations('clergy', data);
  is('clergy -> 505 Event Officiants', r.matches[0] && r.matches[0].code, '505');
}
// "000" in 14b is a nonqualifying flag, distinct from an unknown code.
{
  const r = decodeBox14b(['000', '101'], { hasTP: true, data });
  is('000 status is nonqualifying', r.entries[0].status, 'nonqualifying');
  ok('000 explanation says not all TP is deductible', /not all|NOT on/i.test(r.entries[0].explanation));
  is('the real code beside 000 still decodes', r.entries[1].status, 'match');
}
// An unknown 3-digit code is "unknown" (typo path), never silently 000/match.
{
  const r = decodeBox14b(['999'], { hasTP: true, data });
  is('999 status is unknown', r.entries[0].status, 'unknown');
  ok('999 explanation suggests typo/employer check', /typo|employer/i.test(r.entries[0].explanation));
}
// Two-code cap note (instructions: "any two" of 3+, no tie-break implied).
{
  const r = decodeBox14b(['101', '603'], { hasTP: true, data });
  ok('two codes trigger the not-necessarily-exhaustive note',
    r.notes.some((n) => /two/i.test(n)));
}

console.log(`\nW-2 box decoder + TTOC lookup engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
